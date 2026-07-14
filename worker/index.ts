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
interface AuthRow {
  password_hash: string
  session_secret: string
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

async function signSession(secret: string): Promise<string> {
  const payload = b64(enc.encode(JSON.stringify({ exp: Date.now() + SESSION_TTL_MS })))
  const sig = await hmac(secret, payload)
  return `${payload}.${sig}`
}

async function verifySessionToken(token: string, secret: string): Promise<boolean> {
  const dot = token.indexOf('.')
  if (dot < 0) return false
  const payload = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expected = await hmac(secret, payload)
  if (!timingSafeEqual(sig, expected)) return false
  try {
    const { exp } = JSON.parse(dec.decode(fromB64(payload))) as { exp: number }
    return typeof exp === 'number' && Date.now() < exp
  } catch {
    return false
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
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS auth (
         id INTEGER PRIMARY KEY CHECK (id = 1),
         password_hash TEXT NOT NULL, session_secret TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    )
    .run()
}

async function getAuth(db: D1Database): Promise<AuthRow | null> {
  return db
    .prepare('SELECT password_hash, session_secret FROM auth WHERE id = 1')
    .first<AuthRow>()
}

/** リクエストが有効なセッションを持つか */
async function isAuthenticated(request: Request, auth: AuthRow | null): Promise<boolean> {
  if (!auth) return false
  const token = readCookie(request, SESSION_COOKIE)
  if (!token) return false
  return verifySessionToken(token, auth.session_secret)
}

// ---------- APIハンドラ ----------

export async function handleApi(request: Request, db: D1Database): Promise<Response> {
  await ensureSchema(db)
  const url = new URL(request.url)
  const path = url.pathname
  const auth = await getAuth(db)

  // ---- 認証エンドポイント ----
  if (path === '/api/auth/status' && request.method === 'GET') {
    return json({ configured: !!auth, authenticated: await isAuthenticated(request, auth) })
  }

  if (path === '/api/auth/setup' && request.method === 'POST') {
    if (auth) return json({ error: 'already_configured' }, 409)
    const body = await readJson<{ password?: string }>(request)
    const password = (body?.password ?? '').trim()
    if (password.length < 4) return json({ error: 'weak_password' }, 400)
    const password_hash = await hashPassword(password)
    const session_secret = b64(crypto.getRandomValues(new Uint8Array(32)))
    await db
      .prepare(
        'INSERT INTO auth (id, password_hash, session_secret, updated_at) VALUES (1, ?1, ?2, ?3)',
      )
      .bind(password_hash, session_secret, new Date().toISOString())
      .run()
    const token = await signSession(session_secret)
    return json({ ok: true }, 200, { 'set-cookie': sessionCookie(token) })
  }

  if (path === '/api/auth/login' && request.method === 'POST') {
    if (!auth) return json({ error: 'not_configured' }, 400)
    const body = await readJson<{ password?: string }>(request)
    const password = body?.password ?? ''
    if (!(await verifyPassword(password, auth.password_hash))) {
      return json({ error: 'invalid_credentials' }, 401)
    }
    const token = await signSession(auth.session_secret)
    return json({ ok: true }, 200, { 'set-cookie': sessionCookie(token) })
  }

  if (path === '/api/auth/logout' && request.method === 'POST') {
    return json({ ok: true }, 200, { 'set-cookie': clearCookie() })
  }

  // ---- ここから先は要ログイン ----
  if (!(await isAuthenticated(request, auth))) {
    return json({ error: 'unauthorized' }, 401)
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
