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

import Anthropic from '@anthropic-ai/sdk'

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

/** Email Routing 送信バインディング（cloudflare:email）の最小型 */
export interface SendEmailBinding {
  send(message: unknown): Promise<void>
}

export interface Env {
  DB: D1Database
  ASSETS: { fetch(request: Request): Promise<Response> }
  /**
   * Claude APIキー。`wrangler secret put ANTHROPIC_API_KEY` で設定する。
   * 未設定の場合はAI解釈機能が無効になる（他機能は影響なし）。
   */
  ANTHROPIC_API_KEY?: string
  /** 承認メール送信用（wrangler.jsonc の send_email バインディング） */
  SEND_EMAIL?: SendEmailBinding
}

/** 新規登録の承認メールの宛先（管理者） */
const ADMIN_EMAIL = 'oshima6.27@gmail.com'
/** 送信元アドレス（Email Routing を有効化した独自ドメインのアドレス） */
const MAIL_FROM = 'noreply@nexeed-lab.com'
/** 承認リンクの有効期限（7日） */
const APPROVAL_TTL_MS = 7 * 24 * 60 * 60 * 1000

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
  /** 'active'=ログイン可 / 'pending'=承認待ち */
  status?: string
  email?: string | null
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

/** 承認/却下リンク用の署名トークン（HMAC）。sub=ユーザー名, act=approve|deny */
async function signApproval(secret: string, username: string, act: 'approve' | 'deny'): Promise<string> {
  const payload = b64(enc.encode(JSON.stringify({ exp: Date.now() + APPROVAL_TTL_MS, sub: username, act })))
  const sig = await hmac(secret, payload)
  return `${payload}.${sig}`
}

async function verifyApproval(
  token: string,
  secret: string,
): Promise<{ sub: string; act: 'approve' | 'deny' } | null> {
  const dot = token.indexOf('.')
  if (dot < 0) return null
  const payload = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expected = await hmac(secret, payload)
  if (!timingSafeEqual(sig, expected)) return null
  try {
    const { exp, sub, act } = JSON.parse(dec.decode(fromB64(payload))) as {
      exp: number
      sub: string
      act: 'approve' | 'deny'
    }
    if (typeof exp !== 'number' || Date.now() >= exp) return null
    if (typeof sub !== 'string' || (act !== 'approve' && act !== 'deny')) return null
    return { sub, act }
  } catch {
    return null
  }
}

/** 管理者へ承認依頼メールを送る（Email Routing 送信バインディング経由） */
async function sendApprovalMail(
  binding: SendEmailBinding | undefined,
  origin: string,
  username: string,
  requesterEmail: string | null,
  approveToken: string,
  denyToken: string,
): Promise<void> {
  if (!binding) throw new Error('send_email binding not configured')
  // cloudflare:email は Workers ランタイム専用モジュール（動的importでテスト環境の解決を避ける）
  // @ts-ignore
  const { EmailMessage } = await import('cloudflare:email')
  const { createMimeMessage } = await import('mimetext')
  const approveUrl = `${origin}/api/auth/approve?token=${encodeURIComponent(approveToken)}`
  const denyUrl = `${origin}/api/auth/deny?token=${encodeURIComponent(denyToken)}`
  const msg = createMimeMessage()
  msg.setSender({ name: 'ShiftCraft', addr: MAIL_FROM })
  msg.setRecipient(ADMIN_EMAIL)
  msg.setSubject(`【ShiftCraft】新規登録の承認依頼: ${username}`)
  msg.addMessage({
    contentType: 'text/plain',
    data: [
      'ShiftCraft に新しい登録申請がありました。',
      '',
      `ユーザーID: ${username}`,
      `連絡先: ${requesterEmail || '（未入力）'}`,
      '',
      '▼ 承認する（このユーザーがログインできるようになります）',
      approveUrl,
      '',
      '▼ 却下する（申請を削除します）',
      denyUrl,
      '',
      '心当たりが無い場合は「却下」を押してください。リンクの有効期限は7日間です。',
    ].join('\n'),
  })
  const email = new EmailMessage(MAIL_FROM, ADMIN_EMAIL, msg.asRaw())
  await binding.send(email)
}

/** 承認/却下の結果をブラウザに返す簡易HTMLページ */
function htmlPage(title: string, body: string): Response {
  return new Response(
    `<!doctype html><html lang="ja"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width, initial-scale=1">` +
      `<title>${title}</title></head>` +
      `<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:12vh auto;padding:0 1.5rem;color:#1e293b;line-height:1.7">` +
      `<h1 style="font-size:1.4rem">${title}</h1><p>${body}</p>` +
      `<p><a href="/" style="color:#2f59c4">ShiftCraft を開く</a></p></body></html>`,
    { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } },
  )
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
  // ユーザー（ID＋パスワード）。複数アカウント可。
  // status: 'active'=ログイン可 / 'pending'=承認待ち。email: 申請者の連絡先（任意）。
  // plan: 'trial'=お試し（AI累計5回）/ 'active'=月額課金中（AI毎月30回）。
  // ai_used/ai_period: AI利用回数の集計（period は 'trial' か 'YYYY-MM'）。
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS users (
         username TEXT PRIMARY KEY, password_hash TEXT NOT NULL, created_at TEXT NOT NULL,
         status TEXT NOT NULL DEFAULT 'active', email TEXT,
         plan TEXT NOT NULL DEFAULT 'trial', ai_used INTEGER NOT NULL DEFAULT 0,
         ai_period TEXT NOT NULL DEFAULT '')`,
    )
    .run()
  // 既存DB（旧スキーマ）へのカラム追加。既にあれば無視する。
  await db
    .prepare(`ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`)
    .run()
    .catch(() => {})
  await db.prepare(`ALTER TABLE users ADD COLUMN email TEXT`).run().catch(() => {})
  // 課金プラン・AI利用回数のカラム（旧DBへの追加）。
  let planColumnAdded = false
  await db
    .prepare(`ALTER TABLE users ADD COLUMN plan TEXT NOT NULL DEFAULT 'trial'`)
    .run()
    .then(() => {
      planColumnAdded = true
    })
    .catch(() => {})
  if (planColumnAdded) {
    // この変更以前から居るユーザーは既存利用者として active 扱い（お試し制限で困らせない）
    await db.prepare(`UPDATE users SET plan = 'active'`).run().catch(() => {})
  }
  await db
    .prepare(`ALTER TABLE users ADD COLUMN ai_used INTEGER NOT NULL DEFAULT 0`)
    .run()
    .catch(() => {})
  await db.prepare(`ALTER TABLE users ADD COLUMN ai_period TEXT NOT NULL DEFAULT ''`).run().catch(() => {})
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
    .prepare('SELECT username, password_hash, status, email FROM users WHERE username = ?1')
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

// ---------- AI（Claude）による自由文条件の解釈 ----------

/**
 * 切り替え可能なモデル。クライアントから来た値はこの許可リストで必ず検証する
 * （任意のモデル文字列を外部から指定させない）。
 */
const AI_MODELS = ['claude-sonnet-5', 'claude-opus-4-8'] as const
type AiModel = (typeof AI_MODELS)[number]
const DEFAULT_AI_MODEL: AiModel = 'claude-sonnet-5'

function normalizeModel(v: unknown): AiModel {
  return AI_MODELS.includes(v as AiModel) ? (v as AiModel) : DEFAULT_AI_MODEL
}

// ---------- AI 利用回数の上限（プラン別） ----------

/** プラン別のAI利用上限。trial=お試し（累計）/ active=月額課金中（毎月リセット） */
export const AI_LIMITS = { trial: 5, active: 30 } as const
export type AiPlan = keyof typeof AI_LIMITS

/** 'YYYY-MM' を返す */
function monthKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 7)
}

/**
 * 現在の利用状況から、いま1回AIを使えるか判定する（純粋関数・テスト可能）。
 * trial は累計5回まで（リセットなし）、active は毎月30回まで（月替わりで0に戻る）。
 */
export function evaluateAiUse(
  plan: string | null | undefined,
  aiUsed: number,
  aiPeriod: string | null | undefined,
  nowMonth: string,
): { plan: AiPlan; limit: number; period: string; used: number; allowed: boolean; remaining: number } {
  const p: AiPlan = plan === 'active' ? 'active' : 'trial'
  const limit = AI_LIMITS[p]
  const period = p === 'active' ? nowMonth : 'trial'
  // 期間が変わっていたらカウントは0からやり直し（月額の月替わりリセット）
  const used = aiPeriod === period ? Math.max(0, Math.floor(Number(aiUsed)) || 0) : 0
  return { plan: p, limit, period, used, allowed: used < limit, remaining: Math.max(0, limit - used) }
}

/** DBから利用状況を読み、判定結果を返す */
async function readAiUsage(db: D1Database, username: string) {
  const row = await db
    .prepare('SELECT plan, ai_used, ai_period FROM users WHERE username = ?1')
    .bind(username)
    .first<{ plan?: string; ai_used?: number; ai_period?: string }>()
  return evaluateAiUse(row?.plan, Number(row?.ai_used ?? 0), row?.ai_period, monthKey())
}

/** ParsedRule（src/types.ts）に対応する構造化出力スキーマ */
const idProp = { type: 'string' } as const
const RULE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['parsed', 'description'],
  properties: {
    description: { type: 'string' },
    parsed: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'a', 'b'],
          properties: { kind: { const: 'pairAvoid' }, a: idProp, b: idProp },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'a', 'b'],
          properties: { kind: { const: 'pairTogether' }, a: idProp, b: idProp },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'staffId', 'weekday'],
          properties: { kind: { const: 'forbidWeekday' }, staffId: idProp, weekday: { type: 'integer' } },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'staffId', 'shiftId'],
          properties: { kind: { const: 'forbidShift' }, staffId: idProp, shiftId: idProp },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'staffId', 'shiftId'],
          properties: { kind: { const: 'onlyShift' }, staffId: idProp, shiftId: idProp },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'staffId', 'days'],
          properties: { kind: { const: 'maxDaysPerWeek' }, staffId: idProp, days: { type: 'integer' } },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'staffId', 'days'],
          properties: { kind: { const: 'maxConsecutive' }, staffId: idProp, days: { type: 'integer' } },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'staffId', 'weekday', 'shiftId'],
          properties: {
            kind: { const: 'fixWeekdayShift' },
            staffId: idProp,
            weekday: { type: 'integer' },
            shiftId: idProp,
          },
        },
      ],
    },
  },
}

const AI_SYSTEM_PROMPT = `あなたは日本の飲食店のシフト作成条件を解釈するアシスタントです。
ユーザーが自由文で書いた「1つの」条件を、次のいずれかの構造化ルールに変換してください。
該当するルールが無い、または登場人物・時間帯が与えられた一覧に存在しない場合は parsed を null にしてください。

ルールの種類(kind):
- pairAvoid { a, b }: スタッフ a と b を同じ日に一緒に出勤させない
- pairTogether { a, b }: スタッフ a と b をなるべく同じ日に出勤させる
- forbidWeekday { staffId, weekday }: そのスタッフを指定曜日に出勤させない
- forbidShift { staffId, shiftId }: そのスタッフを指定シフトに入れない
- onlyShift { staffId, shiftId }: そのスタッフは指定シフトのみに入れる
- maxDaysPerWeek { staffId, days }: そのスタッフは週 days 日まで
- maxConsecutive { staffId, days }: そのスタッフは days 連勤まで
- fixWeekdayShift { staffId, weekday, shiftId }: そのスタッフは指定曜日は指定シフト固定

weekday は 0=日,1=月,2=火,3=水,4=木,5=金,6=土 の整数。
a・b・staffId には必ず与えられたスタッフの id を、shiftId には与えられた時間帯の id を使ってください（名前ではなく id）。
description には解釈内容を日本語で簡潔に書いてください（parsed が null のときはその理由）。`

interface NameId {
  id: string
  name: string
}
interface AiParseResult {
  parsed: Record<string, unknown> | null
  description: string
}

/** Claude を呼び出して自由文条件を1つの構造化ルールに解釈する */
async function aiParseRule(
  apiKey: string,
  model: AiModel,
  text: string,
  staff: NameId[],
  shifts: NameId[],
): Promise<AiParseResult> {
  const client = new Anthropic({ apiKey })
  const userPrompt = [
    '# スタッフ一覧（名前: id）',
    staff.map((s) => `${s.name}: ${s.id}`).join('\n') || '（なし）',
    '',
    '# 時間帯一覧（名前: id）',
    shifts.map((s) => `${s.name}: ${s.id}`).join('\n') || '（なし）',
    '',
    '# 解釈したい条件文',
    text,
  ].join('\n')

  const msg = await client.messages.create({
    model,
    max_tokens: 1024,
    thinking: { type: 'disabled' },
    output_config: { effort: 'low', format: { type: 'json_schema', schema: RULE_SCHEMA } },
    system: AI_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  })

  if (msg.stop_reason === 'refusal') {
    return { parsed: null, description: 'この条件は解釈できませんでした。メモとして保存します。' }
  }

  const textBlock = msg.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
  let raw: AiParseResult
  try {
    raw = JSON.parse(textBlock?.text ?? '') as AiParseResult
  } catch {
    return { parsed: null, description: 'AIの応答を解釈できませんでした。メモとして保存します。' }
  }

  // 幻の id を弾く（存在しないスタッフ/時間帯を参照していないか検証）
  const staffIds = new Set(staff.map((s) => s.id))
  const shiftIds = new Set(shifts.map((s) => s.id))
  const p = raw.parsed
  if (p && typeof p === 'object') {
    const okStaff = (k: string) => typeof p[k] === 'string' && staffIds.has(p[k] as string)
    const okShift = (k: string) => typeof p[k] === 'string' && shiftIds.has(p[k] as string)
    const kind = p.kind
    let valid = false
    if (kind === 'pairAvoid' || kind === 'pairTogether') valid = okStaff('a') && okStaff('b')
    else if (kind === 'forbidWeekday') valid = okStaff('staffId') && typeof p.weekday === 'number'
    else if (kind === 'forbidShift' || kind === 'onlyShift') valid = okStaff('staffId') && okShift('shiftId')
    else if (kind === 'maxDaysPerWeek' || kind === 'maxConsecutive')
      valid = okStaff('staffId') && typeof p.days === 'number' && (p.days as number) > 0
    else if (kind === 'fixWeekdayShift')
      valid = okStaff('staffId') && okShift('shiftId') && typeof p.weekday === 'number'
    if (!valid) {
      return {
        parsed: null,
        description: '登場するスタッフ・時間帯が登録内容と一致しませんでした。メモとして保存します。',
      }
    }
  }

  return { parsed: raw.parsed ?? null, description: String(raw.description ?? '') }
}

// ---------- APIハンドラ ----------

export async function handleApi(
  request: Request,
  db: D1Database,
  apiKey?: string,
  sendEmail?: SendEmailBinding,
): Promise<Response> {
  await ensureSchema(db)
  const url = new URL(request.url)
  const path = url.pathname

  // ---- 認証エンドポイント（ID＋パスワード） ----
  if (path === '/api/auth/status' && request.method === 'GET') {
    const configured = (await countUsers(db)) > 0
    const user = await authedUser(request, db)
    if (!user) return json({ configured, authenticated: false })
    const u = await readAiUsage(db, user)
    return json({
      configured,
      authenticated: true,
      username: user,
      aiPlan: u.plan,
      aiLimit: u.limit,
      aiUsed: u.used,
      aiRemaining: u.remaining,
    })
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
    // 最初のアカウント（運営者）は課金対象外の active 扱い
    await db
      .prepare(
        'INSERT INTO users (username, password_hash, created_at, status, email, plan) VALUES (?1, ?2, ?3, ?4, ?5, ?6)',
      )
      .bind(username, await hashPassword(password), new Date().toISOString(), 'active', null, 'active')
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
    // 承認待ちのアカウントはログイン不可
    if (user && user.status === 'pending') return json({ error: 'pending_approval' }, 403)
    const secret = await ensureSessionSecret(db)
    const token = await signSession(secret, username)
    return json({ ok: true }, 200, { 'set-cookie': sessionCookie(token) })
  }

  if (path === '/api/auth/logout' && request.method === 'POST') {
    return json({ ok: true }, 200, { 'set-cookie': clearCookie() })
  }

  // ---- 一般ユーザーの新規登録申請（公開・管理者の承認が必要） ----
  if (path === '/api/auth/request-access' && request.method === 'POST') {
    // 管理者アカウント（承認者）が未作成なら申請不可
    if ((await countUsers(db)) === 0) return json({ error: 'not_configured' }, 400)
    const body = await readJson<{ username?: string; password?: string; email?: string }>(request)
    const username = normalizeUsername(body?.username)
    const password = (body?.password ?? '').trim()
    const email = typeof body?.email === 'string' ? body.email.trim().slice(0, 200) : ''
    if (username.length < 1) return json({ error: 'invalid_username' }, 400)
    if (password.length < 4) return json({ error: 'weak_password' }, 400)
    if (await getUser(db, username)) return json({ error: 'username_taken' }, 409)

    const secret = await ensureSessionSecret(db)
    // 一般ユーザーの新規登録は trial（お試し。AI累計5回まで）で開始
    await db
      .prepare(
        'INSERT INTO users (username, password_hash, created_at, status, email, plan) VALUES (?1, ?2, ?3, ?4, ?5, ?6)',
      )
      .bind(username, await hashPassword(password), new Date().toISOString(), 'pending', email || null, 'trial')
      .run()

    // 承認メールを送信（失敗しても申請自体は成立させる。emailed で状況を返す）
    let emailed = false
    try {
      const approveToken = await signApproval(secret, username, 'approve')
      const denyToken = await signApproval(secret, username, 'deny')
      await sendApprovalMail(sendEmail, url.origin, username, email || null, approveToken, denyToken)
      emailed = true
    } catch {
      emailed = false
    }
    return json({ ok: true, emailed })
  }

  // ---- 承認 / 却下（メール内リンク。署名トークンで認可） ----
  if ((path === '/api/auth/approve' || path === '/api/auth/deny') && request.method === 'GET') {
    const secret = await getSessionSecret(db)
    const token = url.searchParams.get('token') ?? ''
    const v = secret ? await verifyApproval(token, secret) : null
    const wantAct = path.endsWith('approve') ? 'approve' : 'deny'
    if (!v || v.act !== wantAct) {
      return htmlPage('リンクが無効です', 'リンクの有効期限が切れているか、正しくありません。')
    }
    if (v.act === 'approve') {
      await db
        .prepare("UPDATE users SET status = 'active' WHERE username = ?1 AND status = 'pending'")
        .bind(v.sub)
        .run()
      return htmlPage(
        '承認しました',
        `ユーザー「${v.sub}」を承認しました。本人はこのIDとパスワードでログインできます。`,
      )
    }
    await db
      .prepare("DELETE FROM users WHERE username = ?1 AND status = 'pending'")
      .bind(v.sub)
      .run()
    return htmlPage('却下しました', `ユーザー「${v.sub}」の登録申請を削除しました。`)
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
    // 管理者による追加は即時有効（承認不要）・active 扱い
    await db
      .prepare(
        'INSERT INTO users (username, password_hash, created_at, status, email, plan) VALUES (?1, ?2, ?3, ?4, ?5, ?6)',
      )
      .bind(username, await hashPassword(password), new Date().toISOString(), 'active', null, 'active')
      .run()
    return json({ ok: true })
  }

  // ---- AI（Claude）による自由文条件の解釈 ----
  if (path === '/api/ai/parse-rule' && request.method === 'POST') {
    if (!apiKey) return json({ error: 'ai_not_configured' }, 501)
    // 利用回数の上限チェック（プラン別。呼び出し前に確認して超過なら429）
    const usage = await readAiUsage(db, currentUser)
    if (!usage.allowed) {
      return json(
        { error: 'ai_limit', plan: usage.plan, limit: usage.limit, used: usage.used, remaining: 0 },
        429,
      )
    }
    const body = await readJson<{
      text?: string
      staff?: NameId[]
      shifts?: NameId[]
      model?: string
    }>(request)
    const text = (body?.text ?? '').trim()
    if (!text) return json({ error: 'empty_text' }, 400)
    const cleanList = (arr: unknown): NameId[] =>
      Array.isArray(arr)
        ? arr
            .filter(
              (x): x is NameId =>
                !!x && typeof (x as NameId).id === 'string' && typeof (x as NameId).name === 'string',
            )
            .map((x) => ({ id: x.id, name: x.name }))
        : []
    try {
      const result = await aiParseRule(
        apiKey,
        normalizeModel(body?.model),
        text.slice(0, 500),
        cleanList(body?.staff),
        cleanList(body?.shifts),
      )
      // 成功したら1回消費（月替わり時は period も更新して0からカウント）
      const newUsed = usage.used + 1
      await db
        .prepare('UPDATE users SET ai_used = ?1, ai_period = ?2 WHERE username = ?3')
        .bind(newUsed, usage.period, currentUser)
        .run()
      return json({
        ...result,
        aiPlan: usage.plan,
        aiLimit: usage.limit,
        aiRemaining: Math.max(0, usage.limit - newUsed),
      })
    } catch (e) {
      return json({ error: 'ai_failed', message: String(e) }, 502)
    }
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
        return await handleApi(request, env.DB, env.ANTHROPIC_API_KEY, env.SEND_EMAIL)
      } catch (e) {
        return json({ error: 'internal', message: String(e) }, 500)
      }
    }
    return env.ASSETS.fetch(request)
  },
}
