/**
 * Cloudflare Worker: 静的アセット配信 + 認証付き設定保存API（D1）。
 *
 * 認証（アプリ内ログイン）:
 *  GET  /api/auth/status  → { configured, authenticated }
 *  POST /api/auth/setup   → 初回パスワード設定 { password }（未設定時のみ）
 *  POST /api/auth/login   → ログイン { password } → セッションCookie発行
 *  POST /api/auth/logout  → ログアウト（Cookie失効）
 *
 * 設定（要ログイン）:
 *  GET  /api/settings     → { data, updatedAt }（未保存なら404）
 *  PUT  /api/settings     → 保存 { data, expectedUpdatedAt, force? }（楽観ロック）
 *  GET  /api/history      → 保存履歴のメタ情報一覧
 *
 * パスワードはPBKDF2でハッシュ化してD1に保存。セッションはHMAC署名付きトークンを
 * HttpOnly Cookie で管理する。テーブルは初回アクセス時に自動作成する。
 */

// ---- D1 の最小型定義（自己完結） ----
export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  first<T = Record<string, unknown>>(): Promise<T | null>
  run(): Promise<unknown>
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>
}
export interface D1Database {
  prepare(query: string): D1PreparedStatement
}

export interface Env {
  DB: D1Database
  ASSETS: { fetch(request: Request): Promise<Response> }
}

const HISTORY_KEEP = 20
const MAX_BODY_BYTES = 1_000_000
const SESSION_COOKIE = 'sc_session'
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30日
const PBKDF2_ITERS = 100_000

interface SettingsRow {
  json: string
  updated_at: string
}
interface UserRow {
  username: string
  password_hash: string
}

// ---------- 共通ユーティリティ ----------

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  })
}

const enc = new TextEncoder()
const dec = new TextDecoder()

function b64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}
function fromB64(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERS, hash: 'SHA-256' },
    key,
    256,
  )
  return `pbkdf2:${PBKDF2_ITERS}:${b64(salt)}:${b64(new Uint8Array(bits))}`
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, itersStr, saltB64, hashB64] = stored.split(':')
  if (scheme !== 'pbkdf2') return false
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: fromB64(saltB64), iterations: Number(itersStr), hash: 'SHA-256' },
    key,
    256,
  )
  return timingSafeEqual(b64(new Uint8Array(bits)), hashB64)
}

async function hmac(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg))
  return b64(new Uint8Array(sig))
}

async function signSession(secret: string, username: string): Promise<string> {
  const payload = b64(
    enc.encode(JSON.stringify({ exp: Date.now() + SESSION_TTL_MS, sub: username })),
  )
  const sig = await hmac(secret, payload)
  return `${payload}.${sig}`
}

/** 有効ならユーザー名を返す。無効なら null */
async function verifySessionToken(token: string, secret: string): Promise<string | null> {
  const dot = token.indexOf('.')
  if (dot < 0) return null
  const payload = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expected = await hmac(secret, payload)
  if (!timingSafeEqual(sig, expected)) return null
  try {
    const { exp, sub } = JSON.parse(dec.decode(fromB64(payload))) as { exp: number; sub: string }
    if (typeof exp !== 'number' || Date.now() >= exp) return null
    return typeof sub === 'string' ? sub : null
  } catch {
    return null
  }
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return v.join('=')
  }
  return null
}

function sessionCookie(token: string): string {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000)
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`
}
function clearCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`
}

// ---------- スキーマ・認証状態 ----------

async function ensureSchema(db: D1Database): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS settings (
         id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    )
    .run()
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS settings_history (
         id INTEGER PRIMARY KEY AUTOINCREMENT, json TEXT NOT NULL, saved_at TEXT NOT NULL)`,
    )
    .run()
  // ユーザー（ID＋パスワード）。複数アカウント可
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS users (
         username TEXT PRIMARY KEY, password_hash TEXT NOT NULL, created_at TEXT NOT NULL)`,
    )
    .run()
  // セッション署名用の共有シークレット（単一行）
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS auth_meta (
         id INTEGER PRIMARY KEY CHECK (id = 1), session_secret TEXT NOT NULL)`,
    )
    .run()
}

async function getSessionSecret(db: D1Database): Promise<string | null> {
  const row = await db
    .prepare('SELECT session_secret FROM auth_meta WHERE id = 1')
    .first<{ session_secret: string }>()
  return row?.session_secret ?? null
}

/** セッションシークレットを取得（無ければ生成して保存） */
async function ensureSessionSecret(db: D1Database): Promise<string> {
  const existing = await getSessionSecret(db)
  if (existing) return existing
  const secret = b64(crypto.getRandomValues(new Uint8Array(32)))
  await db
    .prepare('INSERT OR IGNORE INTO auth_meta (id, session_secret) VALUES (1, ?1)')
    .bind(secret)
    .run()
  return (await getSessionSecret(db)) ?? secret
}

async function countUsers(db: D1Database): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>()
  return row?.n ?? 0
}

async function getUser(db: D1Database, username: string): Promise<UserRow | null> {
  return db
    .prepare('SELECT username, password_hash FROM users WHERE username = ?1')
    .bind(username)
    .first<UserRow>()
}

/** リクエストが有効なセッションを持つか（ユーザー名 or null） */
async function authedUser(request: Request, db: D1Database): Promise<string | null> {
  const token = readCookie(request, SESSION_COOKIE)
  if (!token) return null
  const secret = await getSessionSecret(db)
  if (!secret) return null
  return verifySessionToken(token, secret)
}

function normalizeUsername(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

// ---------- APIハンドラ ----------

export async function handleApi(request: Request, db: D1Database): Promise<Response> {
  await ensureSchema(db)
  const url = new URL(request.url)
  const path = url.pathname

  // ---- 認証エンドポイント（ID＋パスワード） ----
  if (path === '/api/auth/status' && request.method === 'GET') {
    const configured = (await countUsers(db)) > 0
    const user = await authedUser(request, db)
    return json({ configured, authenticated: !!user, username: user ?? undefined })
  }

  if (path === '/api/auth/setup' && request.method === 'POST') {
    // 最初のアカウント作成（ユーザーが1人も居ないときのみ）
    if ((await countUsers(db)) > 0) return json({ error: 'already_configured' }, 409)
    const body = await readJson<{ username?: string; password?: string }>(request)
    const username = normalizeUsername(body?.username)
    const password = (body?.password ?? '').trim()
    if (username.length < 1) return json({ error: 'invalid_username' }, 400)
    if (password.length < 4) return json({ error: 'weak_password' }, 400)
    const secret = await ensureSessionSecret(db)
    await db
      .prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?1, ?2, ?3)')
      .bind(username, await hashPassword(password), new Date().toISOString())
      .run()
    const token = await signSession(secret, username)
    return json({ ok: true }, 200, { 'set-cookie': sessionCookie(token) })
  }

  if (path === '/api/auth/login' && request.method === 'POST') {
    if ((await countUsers(db)) === 0) return json({ error: 'not_configured' }, 400)
    const body = await readJson<{ username?: string; password?: string }>(request)
    const username = normalizeUsername(body?.username)
    const password = body?.password ?? ''
    const user = await getUser(db, username)
    const ok = user ? await verifyPassword(password, user.password_hash) : false
    if (!ok) return json({ error: 'invalid_credentials' }, 401)
    const secret = await ensureSessionSecret(db)
    const token = await signSession(secret, username)
    return json({ ok: true }, 200, { 'set-cookie': sessionCookie(token) })
  }

  if (path === '/api/auth/logout' && request.method === 'POST') {
    return json({ ok: true }, 200, { 'set-cookie': clearCookie() })
  }

  // ---- ここから先は要ログイン ----
  const currentUser = await authedUser(request, db)
  if (!currentUser) {
    return json({ error: 'unauthorized' }, 401)
  }

  // ログイン中ユーザーが別アカウントを追加できる
  if (path === '/api/auth/register' && request.method === 'POST') {
    const body = await readJson<{ username?: string; password?: string }>(request)
    const username = normalizeUsername(body?.username)
    const password = (body?.password ?? '').trim()
    if (username.length < 1) return json({ error: 'invalid_username' }, 400)
    if (password.length < 4) return json({ error: 'weak_password' }, 400)
    if (await getUser(db, username)) return json({ error: 'username_taken' }, 409)
    await db
      .prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?1, ?2, ?3)')
      .bind(username, await hashPassword(password), new Date().toISOString())
      .run()
    return json({ ok: true })
  }

  if (path === '/api/settings' && request.method === 'GET') {
    const row = await db
      .prepare('SELECT json, updated_at FROM settings WHERE id = 1')
      .first<SettingsRow>()
    if (!row) return json({ error: 'not_found' }, 404)
    return json({ data: JSON.parse(row.json), updatedAt: row.updated_at })
  }

  if (path === '/api/settings' && request.method === 'PUT') {
    const text = await request.text()
    if (text.length > MAX_BODY_BYTES) return json({ error: 'too_large' }, 413)
    let body: { data?: unknown; expectedUpdatedAt?: string | null; force?: boolean }
    try {
      body = JSON.parse(text)
    } catch {
      return json({ error: 'invalid_json' }, 400)
    }
    if (!looksLikeAppData(body.data)) return json({ error: 'invalid_data' }, 400)

    const current = await db
      .prepare('SELECT json, updated_at FROM settings WHERE id = 1')
      .first<SettingsRow>()

    if (!body.force && current && (body.expectedUpdatedAt ?? null) !== current.updated_at) {
      return json({ error: 'conflict', updatedAt: current.updated_at }, 409)
    }

    const updatedAt = new Date().toISOString()
    const payload = JSON.stringify(body.data)
    await db
      .prepare(
        `INSERT INTO settings (id, json, updated_at) VALUES (1, ?1, ?2)
         ON CONFLICT(id) DO UPDATE SET json = ?1, updated_at = ?2`,
      )
      .bind(payload, updatedAt)
      .run()
    await db
      .prepare('INSERT INTO settings_history (json, saved_at) VALUES (?1, ?2)')
      .bind(payload, updatedAt)
      .run()
    await db
      .prepare(
        `DELETE FROM settings_history WHERE id NOT IN (
           SELECT id FROM settings_history ORDER BY id DESC LIMIT ?1)`,
      )
      .bind(HISTORY_KEEP)
      .run()
    return json({ updatedAt })
  }

  if (path === '/api/history' && request.method === 'GET') {
    const { results } = await db
      .prepare('SELECT id, saved_at FROM settings_history ORDER BY id DESC LIMIT ?1')
      .bind(HISTORY_KEEP)
      .all<{ id: number; saved_at: string }>()
    return json({ history: results })
  }

  return json({ error: 'not_found' }, 404)
}

async function readJson<T>(request: Request): Promise<T | null> {
  try {
    const text = await request.text()
    if (text.length > MAX_BODY_BYTES) return null
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

function looksLikeAppData(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false
  const d = v as Record<string, unknown>
  return Array.isArray(d.roles) && Array.isArray(d.staff) && Array.isArray(d.shifts)
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env.DB)
      } catch (e) {
        return json({ error: 'internal', message: String(e) }, 500)
      }
    }
    return env.ASSETS.fetch(request)
  },
}
