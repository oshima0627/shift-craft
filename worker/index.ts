/**
 * Cloudflare Worker: 静的アセット配信 + 認証付き設定保存API（D1）。
 *
 * 認証（アプリ内ログイン）:
 *  GET  /api/auth/status          → { configured, authenticated }
 *  POST /api/auth/setup               → 初回アカウント作成 { username, password }（未設定時のみ）
 *  POST /api/auth/signup              → 新規登録（公開）{ username, password }。仮登録し確認メールを送る
 *  GET  /api/auth/verify              → メールアドレス確認（メール内リンク・署名トークン）→ 有効化
 *  POST /api/auth/resend-verification → 確認メールの再送 { email }（存在有無は返さない）
 *  POST /api/auth/login               → ログイン { username, password } → セッションCookie発行
 *  POST /api/auth/logout              → ログアウト（Cookie失効）
 *  POST /api/auth/forgot-password     → パスワード再設定メールの送信 { email }（存在有無は返さない）
 *  POST /api/auth/reset-password      → 新しいパスワードを設定 { token, password }
 *
 * 設定（要ログイン）:
 *  GET  /api/settings     → { data, updatedAt }（未保存なら404）
 *  PUT  /api/settings     → 保存 { data, expectedUpdatedAt, force? }（楽観ロック）
 *  GET  /api/history      → 保存履歴のメタ情報一覧
 *
 * パスワードはPBKDF2でハッシュ化してD1に保存。セッションはHMAC署名付きトークンを
 * HttpOnly Cookie で管理する。テーブルは初回アクセス時に自動作成する。
 * 新規登録は管理者の承認は不要だが、メールアドレスの確認（本人のメールに届くリンクの
 * クリック）を済ませるまではログインできない。
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

export interface Env {
  DB: D1Database
  ASSETS: { fetch(request: Request): Promise<Response> }
  /**
   * Claude APIキー。`wrangler secret put ANTHROPIC_API_KEY` で設定する。
   * 未設定の場合はAI解釈機能が無効になる（他機能は影響なし）。
   */
  ANTHROPIC_API_KEY?: string
  /** Stripe 秘密鍵（`wrangler secret put STRIPE_SECRET_KEY`）。未設定で課金機能は無効 */
  STRIPE_SECRET_KEY?: string
  /** Stripe Webhook 署名シークレット（`whsec_...`） */
  STRIPE_WEBHOOK_SECRET?: string
  /** 月額プランの Price ID（`price_...`） */
  STRIPE_PRICE_MONTHLY?: string
  /** 年額プランの Price ID（`price_...`） */
  STRIPE_PRICE_YEARLY?: string
  /** 決済後の戻り先ベースURL（未設定はリクエストのoriginを使用） */
  APP_URL?: string
  /**
   * Resend APIキー（`wrangler secret put RESEND_API_KEY`）。
   * パスワード再設定リンクを利用者（任意のメールアドレス）へ送るのに使う。
   * 未設定の場合はメールを送れないため、パスワード再設定は利用できない。
   */
  RESEND_API_KEY?: string
}

/** Stripe 関連の設定（env から集約） */
export interface StripeConfig {
  secretKey?: string
  webhookSecret?: string
  priceMonthly?: string
  priceYearly?: string
  appUrl?: string
}

/** 送信元アドレス（Resend で検証済みの独自ドメインのアドレス） */
const MAIL_FROM = 'noreply@nexeed-lab.com'
/** パスワード再設定リンクの有効期限（1時間） */
const RESET_TTL_MS = 60 * 60 * 1000
/** メールアドレス確認リンクの有効期限（24時間） */
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000

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
  /** 'active'=ログイン可 / 'pending'=メールアドレス未確認（確認リンクを開くと active になる） */
  status?: string
  email?: string | null
  /** Stripe購読状態: 'active'/'trialing'/'past_due'/'canceled'/'comp'（無料招待）等。null=未購読 */
  subscription_status?: string | null
  /** アプリ内無料トライアルの終了時刻（ISO）。この期間はフルアクセス */
  trial_ends_at?: string | null
  stripe_customer_id?: string | null
  stripe_subscription_id?: string | null
}

/** 無料トライアル日数 */
const TRIAL_DAYS = 14

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

/**
 * 用途別の署名トークン（HMAC）。sub=ユーザー名, act=用途（reset/verify）。
 * メール内リンクでの本人確認に使う（パスワード再設定・メールアドレス確認）。
 */
async function signToken(
  secret: string,
  username: string,
  act: 'reset' | 'verify',
  ttlMs: number,
): Promise<string> {
  const payload = b64(enc.encode(JSON.stringify({ exp: Date.now() + ttlMs, sub: username, act })))
  const sig = await hmac(secret, payload)
  return `${payload}.${sig}`
}

/** 指定した用途(act)の有効なトークンならユーザー名を返す。無効なら null */
async function verifyToken(
  token: string,
  secret: string,
  act: 'reset' | 'verify',
): Promise<string | null> {
  const dot = token.indexOf('.')
  if (dot < 0) return null
  const payload = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expected = await hmac(secret, payload)
  if (!timingSafeEqual(sig, expected)) return null
  try {
    const parsed = JSON.parse(dec.decode(fromB64(payload))) as {
      exp: number
      sub: string
      act: string
    }
    if (typeof parsed.exp !== 'number' || Date.now() >= parsed.exp) return null
    if (typeof parsed.sub !== 'string' || parsed.act !== act) return null
    return parsed.sub
  } catch {
    return null
  }
}

/** パスワード再設定リンク用トークン（有効期限 RESET_TTL_MS） */
export function signReset(secret: string, username: string): Promise<string> {
  return signToken(secret, username, 'reset', RESET_TTL_MS)
}

/** メールアドレス確認リンク用トークン（有効期限 VERIFY_TTL_MS） */
export function signVerify(secret: string, username: string): Promise<string> {
  return signToken(secret, username, 'verify', VERIFY_TTL_MS)
}

/**
 * Resend（外部配信サービス）経由で任意のメールアドレスにメールを送る。
 * パスワード再設定リンクを不特定の利用者へ送るのに使う。
 * キー未設定なら送らず false を返す。
 */
async function sendViaResend(
  apiKey: string | undefined,
  to: string,
  subject: string,
  text: string,
): Promise<boolean> {
  if (!apiKey) return false
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ from: `ShiftCraft <${MAIL_FROM}>`, to, subject, text }),
  })
  return res.ok
}

/**
 * メールアドレス確認メールを送る（署名トークン付きの確認リンク）。
 * リンクを開くとアカウントが有効化されてログインできるようになる。送信できたら true。
 */
async function sendVerifyEmail(
  resendKey: string | undefined,
  origin: string,
  secret: string,
  email: string,
): Promise<boolean> {
  const token = await signVerify(secret, email)
  const verifyUrl = `${origin}/api/auth/verify?token=${encodeURIComponent(token)}`
  return sendViaResend(
    resendKey,
    email,
    '【ShiftCraft】メールアドレスの確認',
    [
      'ShiftCraft にご登録いただきありがとうございます。',
      '',
      '下記のリンクを開くと登録が完了し、ログインできるようになります（有効期限24時間）。',
      verifyUrl,
      '',
      'このメールに心当たりが無い場合は、このメールを破棄してください。登録は完了しません。',
    ].join('\n'),
  )
}

/** 確認リンクの結果をブラウザに返す簡易HTMLページ */
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
  // status: 'active'=ログイン可 / 'pending'=メールアドレス未確認。email: 連絡先（既定はID=メール）。
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
  // 課金（サブスク）関連のカラム
  let subColumnAdded = false
  await db
    .prepare(`ALTER TABLE users ADD COLUMN subscription_status TEXT`)
    .run()
    .then(() => {
      subColumnAdded = true
    })
    .catch(() => {})
  if (subColumnAdded) {
    // この変更以前から居るユーザーは既存利用者としてフルアクセス（comp=無料招待扱い）
    await db.prepare(`UPDATE users SET subscription_status = 'comp'`).run().catch(() => {})
  }
  await db.prepare(`ALTER TABLE users ADD COLUMN trial_ends_at TEXT`).run().catch(() => {})
  await db.prepare(`ALTER TABLE users ADD COLUMN stripe_customer_id TEXT`).run().catch(() => {})
  await db.prepare(`ALTER TABLE users ADD COLUMN stripe_subscription_id TEXT`).run().catch(() => {})
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
    .prepare(
      'SELECT username, password_hash, status, email, subscription_status, trial_ends_at, stripe_customer_id, stripe_subscription_id FROM users WHERE username = ?1',
    )
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

// ---------- アクセス権限（サブスク／トライアル） ----------

/** アクセス層。active/trialing=フルアクセス、free=ロック（AI・書き出し等） */
export type Tier = 'active' | 'trialing' | 'free'

/**
 * users行からアクセス権限を判定する（純粋関数・テスト可能）。
 * - Stripe購読が active/trialing、または comp（無料招待）→ active（フル）
 * - アプリ内トライアル期間内 → trialing（フル）
 * - それ以外 → free（ロック）
 */
export function computeEntitlement(
  subscriptionStatus: string | null | undefined,
  trialEndsAt: string | null | undefined,
  nowMs: number,
): { tier: Tier; entitled: boolean; trialEndsAt: string | null } {
  const s = subscriptionStatus ?? ''
  if (s === 'active' || s === 'trialing' || s === 'comp') {
    return { tier: 'active', entitled: true, trialEndsAt: trialEndsAt ?? null }
  }
  if (trialEndsAt) {
    const end = Date.parse(trialEndsAt)
    if (!Number.isNaN(end) && nowMs < end) {
      return { tier: 'trialing', entitled: true, trialEndsAt }
    }
  }
  return { tier: 'free', entitled: false, trialEndsAt: trialEndsAt ?? null }
}

// ---------- AI 利用回数の上限（アクセス層別） ----------

/** アクセス層別のAI利用上限。trialing=お試し（累計）/ active=月額課金中（毎月）/ free=不可 */
export const AI_LIMITS = { trialing: 5, active: 30, free: 0 } as const
export type AiTier = keyof typeof AI_LIMITS

/** 'YYYY-MM' を返す */
function monthKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 7)
}

/**
 * アクセス層と使用状況から、いま1回AIを使えるか判定する（純粋関数・テスト可能）。
 * active は毎月30回（月替わりでリセット）、trialing は累計5回、free は0（不可）。
 */
export function evaluateAiUse(
  tier: string | null | undefined,
  aiUsed: number,
  aiPeriod: string | null | undefined,
  nowMonth: string,
): { tier: AiTier; limit: number; period: string; used: number; allowed: boolean; remaining: number } {
  const t: AiTier = tier === 'active' ? 'active' : tier === 'free' ? 'free' : 'trialing'
  const limit = AI_LIMITS[t]
  const period = t === 'active' ? nowMonth : t
  // 期間が変わっていたらカウントは0からやり直し（月額の月替わりリセット）
  const used = aiPeriod === period ? Math.max(0, Math.floor(Number(aiUsed)) || 0) : 0
  return { tier: t, limit, period, used, allowed: used < limit, remaining: Math.max(0, limit - used) }
}

/** DBから権限＋AI利用状況を読み、判定結果を返す */
async function readAiUsage(db: D1Database, username: string) {
  const row = await db
    .prepare(
      'SELECT subscription_status, trial_ends_at, ai_used, ai_period FROM users WHERE username = ?1',
    )
    .bind(username)
    .first<{
      subscription_status?: string
      trial_ends_at?: string
      ai_used?: number
      ai_period?: string
    }>()
  const ent = computeEntitlement(row?.subscription_status, row?.trial_ends_at, Date.now())
  return evaluateAiUse(ent.tier, Number(row?.ai_used ?? 0), row?.ai_period, monthKey())
}

// ---------- Stripe（fetch + Web Crypto） ----------

/** HMAC-SHA256 を16進文字列で返す（Stripe署名検証用） */
async function hmacHex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Stripe Webhook 署名を検証する（純粋・テスト可能）。
 * Stripe-Signature ヘッダ `t=...,v1=...` と本文から署名を再計算して比較する。
 */
export async function verifyStripeSignature(
  rawBody: string,
  sigHeader: string,
  secret: string,
  nowMs: number,
  toleranceSec = 300,
): Promise<boolean> {
  const parts: Record<string, string> = {}
  for (const kv of sigHeader.split(',')) {
    const i = kv.indexOf('=')
    if (i > 0) parts[kv.slice(0, i).trim()] = kv.slice(i + 1).trim()
  }
  const t = Number(parts.t)
  const v1 = parts.v1
  if (!t || !v1) return false
  if (Math.abs(nowMs / 1000 - t) > toleranceSec) return false
  const expected = await hmacHex(secret, `${t}.${rawBody}`)
  return timingSafeEqual(expected, v1)
}

/** Stripe REST を form-encoded で呼ぶ */
async function stripeCall(
  secretKey: string,
  path: string,
  params: Record<string, string>,
): Promise<Record<string, unknown>> {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${secretKey}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params).toString(),
  })
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    const err = (data.error ?? {}) as { message?: string }
    throw new Error(err.message || `stripe_error_${res.status}`)
  }
  return data
}

/** Webhook イベントを処理して users のサブスク状態を更新する */
async function handleStripeEvent(db: D1Database, event: Record<string, unknown>): Promise<void> {
  const type = String(event.type ?? '')
  const obj = ((event.data as Record<string, unknown>)?.object ?? {}) as Record<string, unknown>
  if (type === 'checkout.session.completed') {
    const username = String(obj.client_reference_id ?? '')
    const customer = obj.customer ? String(obj.customer) : null
    const subscription = obj.subscription ? String(obj.subscription) : null
    if (username) {
      await db
        .prepare(
          "UPDATE users SET subscription_status = 'active', stripe_customer_id = COALESCE(?1, stripe_customer_id), stripe_subscription_id = ?2 WHERE username = ?3",
        )
        .bind(customer, subscription, username)
        .run()
        .catch(() => {})
    }
    return
  }
  if (type === 'customer.subscription.updated' || type === 'customer.subscription.created') {
    const customer = obj.customer ? String(obj.customer) : ''
    const status = String(obj.status ?? '')
    const subId = obj.id ? String(obj.id) : null
    if (customer) {
      await db
        .prepare(
          'UPDATE users SET subscription_status = ?1, stripe_subscription_id = ?2 WHERE stripe_customer_id = ?3',
        )
        .bind(status, subId, customer)
        .run()
        .catch(() => {})
    }
    return
  }
  if (type === 'customer.subscription.deleted') {
    const customer = obj.customer ? String(obj.customer) : ''
    if (customer) {
      await db
        .prepare(
          "UPDATE users SET subscription_status = 'canceled', stripe_subscription_id = NULL WHERE stripe_customer_id = ?1",
        )
        .bind(customer)
        .run()
        .catch(() => {})
    }
    return
  }
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
  stripe?: StripeConfig,
  resendKey?: string,
): Promise<Response> {
  await ensureSchema(db)
  const url = new URL(request.url)
  const path = url.pathname

  // ---- 認証エンドポイント（ID＋パスワード） ----
  if (path === '/api/auth/status' && request.method === 'GET') {
    const configured = (await countUsers(db)) > 0
    const user = await authedUser(request, db)
    if (!user) return json({ configured, authenticated: false })
    const row = await getUser(db, user)
    const ent = computeEntitlement(row?.subscription_status, row?.trial_ends_at, Date.now())
    const u = await readAiUsage(db, user)
    return json({
      configured,
      authenticated: true,
      username: user,
      tier: ent.tier,
      entitled: ent.entitled,
      trialEndsAt: ent.trialEndsAt,
      billingConfigured: !!(stripe?.secretKey && stripe?.priceMonthly),
      aiTier: u.tier,
      aiLimit: u.limit,
      aiUsed: u.used,
      aiRemaining: u.remaining,
    })
  }

  // ---- Stripe Webhook（公開・署名で認可） ----
  if (path === '/api/stripe/webhook' && request.method === 'POST') {
    if (!stripe?.webhookSecret) return json({ error: 'not_configured' }, 501)
    const sig = request.headers.get('stripe-signature') ?? ''
    const raw = await request.text()
    const ok = await verifyStripeSignature(raw, sig, stripe.webhookSecret, Date.now())
    if (!ok) return json({ error: 'bad_signature' }, 400)
    let event: Record<string, unknown>
    try {
      event = JSON.parse(raw)
    } catch {
      return json({ error: 'invalid_json' }, 400)
    }
    await handleStripeEvent(db, event)
    return json({ received: true })
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
    // 最初のアカウント（運営者）は課金対象外（comp=無料招待）でフルアクセス
    await db
      .prepare(
        'INSERT INTO users (username, password_hash, created_at, status, email, plan, subscription_status) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)',
      )
      .bind(username, await hashPassword(password), new Date().toISOString(), 'active', null, 'active', 'comp')
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
    // メールアドレス未確認（仮登録）のアカウントはログイン不可
    if (user && user.status === 'pending') return json({ error: 'email_unverified' }, 403)
    const secret = await ensureSessionSecret(db)
    const token = await signSession(secret, username)
    return json({ ok: true }, 200, { 'set-cookie': sessionCookie(token) })
  }

  if (path === '/api/auth/logout' && request.method === 'POST') {
    return json({ ok: true }, 200, { 'set-cookie': clearCookie() })
  }

  // ---- 一般ユーザーの新規登録（公開・メールアドレス確認が必要） ----
  // 登録時点では status='pending'（仮登録）。確認メールのリンクを開くと 'active' になりログイン可能。
  if (path === '/api/auth/signup' && request.method === 'POST') {
    // 初回アカウント（運営者）が未作成なら登録不可（先に /setup が必要）
    if ((await countUsers(db)) === 0) return json({ error: 'not_configured' }, 400)
    const body = await readJson<{ username?: string; password?: string; email?: string }>(request)
    // メールアドレスをそのままIDとして運用する（username = email）
    const username = normalizeUsername(body?.username)
    const password = (body?.password ?? '').trim()
    // 確認メールを送るため、メールアドレスの形式を必須にする
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username)) return json({ error: 'invalid_email' }, 400)
    if (password.length < 4) return json({ error: 'weak_password' }, 400)
    if (await getUser(db, username)) return json({ error: 'username_taken' }, 409)

    const secret = await ensureSessionSecret(db)
    // 新規登録は 14日間の無料トライアルで開始。確認メール後に有効化する。
    const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString()
    await db
      .prepare(
        'INSERT INTO users (username, password_hash, created_at, status, email, plan, subscription_status, trial_ends_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)',
      )
      .bind(
        username,
        await hashPassword(password),
        new Date().toISOString(),
        'pending',
        username,
        'trial',
        null,
        trialEndsAt,
      )
      .run()

    // 確認メールを送信（送れなくても仮登録は成立。emailed で状況を返す）
    let emailed = false
    try {
      emailed = await sendVerifyEmail(resendKey, url.origin, secret, username)
    } catch {
      emailed = false
    }
    // ログイン状態にはしない（確認完了まで）
    return json({ ok: true, emailed })
  }

  // ---- メールアドレスの確認（メール内リンク。署名トークンで認可） ----
  if (path === '/api/auth/verify' && request.method === 'GET') {
    const secret = await getSessionSecret(db)
    const token = url.searchParams.get('token') ?? ''
    const username = secret ? await verifyToken(token, secret, 'verify') : null
    if (!username) {
      return htmlPage(
        'リンクが無効です',
        'リンクの有効期限が切れているか、正しくありません。お手数ですが、ログイン画面から確認メールを再送してください。',
      )
    }
    const user = await getUser(db, username)
    if (!user) {
      return htmlPage('リンクが無効です', 'アカウントが見つかりませんでした。')
    }
    // 既に確認済みでも同じ完了ページを返す（冪等）
    await db
      .prepare("UPDATE users SET status = 'active' WHERE username = ?1 AND status = 'pending'")
      .bind(username)
      .run()
    return htmlPage(
      'メールアドレスを確認しました',
      'ご登録ありがとうございます。登録が完了しました。下のリンクからログインしてご利用ください。',
    )
  }

  // ---- 確認メールの再送（公開・存在有無は漏らさない） ----
  if (path === '/api/auth/resend-verification' && request.method === 'POST') {
    const body = await readJson<{ email?: string }>(request)
    const email = normalizeUsername(body?.email)
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      const user = await getUser(db, email)
      // 未確認（pending）のアカウントにだけ再送する
      if (user && user.status === 'pending') {
        try {
          const secret = await ensureSessionSecret(db)
          await sendVerifyEmail(resendKey, url.origin, secret, email)
        } catch {
          // 送信失敗でもレスポンスは変えない（列挙を防ぐ）
        }
      }
    }
    return json({ ok: true })
  }

  // ---- パスワード再設定リンクの送信（公開） ----
  if (path === '/api/auth/forgot-password' && request.method === 'POST') {
    const body = await readJson<{ email?: string }>(request)
    // メールアドレスをそのままIDとして運用しているため username = email
    const email = normalizeUsername(body?.email)
    // アカウントの有無は返さない（存在漏洩を防ぐため常に ok を返す）
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      const user = await getUser(db, email)
      if (user) {
        try {
          const secret = await ensureSessionSecret(db)
          const token = await signReset(secret, email)
          const resetUrl = `${url.origin}/reset?token=${encodeURIComponent(token)}`
          await sendViaResend(
            resendKey,
            user.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email) ? user.email : email,
            '【ShiftCraft】パスワード再設定のご案内',
            [
              'ShiftCraft のパスワード再設定リクエストを受け付けました。',
              '',
              '下記のリンクを開き、新しいパスワードを設定してください（有効期限1時間）。',
              resetUrl,
              '',
              'このリクエストに心当たりが無い場合は、このメールを破棄してください。',
              'パスワードは変更されません。',
            ].join('\n'),
          )
        } catch {
          // 送信失敗でもレスポンスは変えない（存在漏洩・列挙を防ぐ）
        }
      }
    }
    return json({ ok: true })
  }

  // ---- 新しいパスワードの設定（公開・署名トークンで認可） ----
  if (path === '/api/auth/reset-password' && request.method === 'POST') {
    const body = await readJson<{ token?: string; password?: string }>(request)
    const token = typeof body?.token === 'string' ? body.token : ''
    const password = (body?.password ?? '').trim()
    if (password.length < 4) return json({ error: 'weak_password' }, 400)
    const secret = await getSessionSecret(db)
    const username = secret ? await verifyToken(token, secret, 'reset') : null
    if (!username) return json({ error: 'invalid_token' }, 400)
    if (!(await getUser(db, username))) return json({ error: 'invalid_token' }, 400)
    await db
      .prepare('UPDATE users SET password_hash = ?1 WHERE username = ?2')
      .bind(await hashPassword(password), username)
      .run()
    // 再設定と同時にログイン状態にする
    const loginToken = await signSession(secret!, username)
    return json({ ok: true }, 200, { 'set-cookie': sessionCookie(loginToken) })
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
    // 管理者による追加は即時有効（承認不要）・comp（無料招待）でフルアクセス
    await db
      .prepare(
        'INSERT INTO users (username, password_hash, created_at, status, email, plan, subscription_status) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)',
      )
      .bind(username, await hashPassword(password), new Date().toISOString(), 'active', null, 'active', 'comp')
      .run()
    return json({ ok: true })
  }

  // ---- 課金（Stripe Checkout / 顧客ポータル） ----
  if (path === '/api/billing/checkout' && request.method === 'POST') {
    if (!stripe?.secretKey || !stripe.priceMonthly) return json({ error: 'not_configured' }, 501)
    const body = await readJson<{ plan?: 'monthly' | 'yearly' }>(request)
    const price = body?.plan === 'yearly' ? stripe.priceYearly : stripe.priceMonthly
    if (!price) return json({ error: 'not_configured' }, 501)
    try {
      const dbUser = await getUser(db, currentUser)
      let customerId = dbUser?.stripe_customer_id ?? null
      if (!customerId) {
        const cust = await stripeCall(stripe.secretKey, 'customers', {
          'metadata[username]': currentUser,
          ...(dbUser?.email ? { email: dbUser.email } : {}),
        })
        customerId = String(cust.id)
        await db
          .prepare('UPDATE users SET stripe_customer_id = ?1 WHERE username = ?2')
          .bind(customerId, currentUser)
          .run()
      }
      const base = stripe.appUrl || url.origin
      const session = await stripeCall(stripe.secretKey, 'checkout/sessions', {
        mode: 'subscription',
        customer: customerId,
        'line_items[0][price]': price,
        'line_items[0][quantity]': '1',
        client_reference_id: currentUser,
        'subscription_data[metadata][username]': currentUser,
        allow_promotion_codes: 'true',
        success_url: `${base}/?checkout=success`,
        cancel_url: `${base}/?checkout=cancel`,
      })
      return json({ url: String(session.url) })
    } catch (e) {
      return json({ error: 'stripe_failed', message: String(e) }, 502)
    }
  }

  if (path === '/api/billing/portal' && request.method === 'POST') {
    if (!stripe?.secretKey) return json({ error: 'not_configured' }, 501)
    const dbUser = await getUser(db, currentUser)
    if (!dbUser?.stripe_customer_id) return json({ error: 'no_customer' }, 400)
    try {
      const base = stripe.appUrl || url.origin
      const session = await stripeCall(stripe.secretKey, 'billing_portal/sessions', {
        customer: dbUser.stripe_customer_id,
        return_url: base,
      })
      return json({ url: String(session.url) })
    } catch (e) {
      return json({ error: 'stripe_failed', message: String(e) }, 502)
    }
  }

  // ---- AI（Claude）による自由文条件の解釈 ----
  if (path === '/api/ai/parse-rule' && request.method === 'POST') {
    if (!apiKey) return json({ error: 'ai_not_configured' }, 501)
    // 利用回数の上限チェック（プラン別。呼び出し前に確認して超過なら429）
    const usage = await readAiUsage(db, currentUser)
    if (!usage.allowed) {
      return json(
        { error: 'ai_limit', tier: usage.tier, limit: usage.limit, used: usage.used, remaining: 0 },
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
        aiTier: usage.tier,
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
        const stripe: StripeConfig = {
          secretKey: env.STRIPE_SECRET_KEY,
          webhookSecret: env.STRIPE_WEBHOOK_SECRET,
          priceMonthly: env.STRIPE_PRICE_MONTHLY,
          priceYearly: env.STRIPE_PRICE_YEARLY,
          appUrl: env.APP_URL,
        }
        return await handleApi(request, env.DB, env.ANTHROPIC_API_KEY, stripe, env.RESEND_API_KEY)
      } catch (e) {
        return json({ error: 'internal', message: String(e) }, 500)
      }
    }
    return env.ASSETS.fetch(request)
  },
}
