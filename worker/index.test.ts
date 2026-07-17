import { describe, expect, it } from 'vitest'
import {
  handleApi,
  evaluateAiUse,
  AI_LIMITS,
  computeEntitlement,
  verifyStripeSignature,
  type D1Database,
  type D1PreparedStatement,
} from './index'

/**
 * D1 のインメモリ・フェイク。worker/index.ts が発行する固定SQLパターンのみ解釈する。
 */
function fakeDb() {
  let settings: { json: string; updated_at: string } | null = null
  let meta: { session_secret: string } | null = null
  const users = new Map<
    string,
    { username: string; password_hash: string; status: string; email: string | null }
  >()
  let history: { id: number; json: string; saved_at: string }[] = []
  let seq = 0

  const db: D1Database = {
    prepare(query: string): D1PreparedStatement {
      let bound: unknown[] = []
      const stmt: D1PreparedStatement = {
        bind(...values: unknown[]) {
          bound = values
          return stmt
        },
        async first<T>() {
          if (query.includes('FROM settings WHERE id = 1')) {
            return (settings ? { ...settings } : null) as T | null
          }
          if (query.includes('FROM auth_meta WHERE id = 1')) {
            return (meta ? { ...meta } : null) as T | null
          }
          if (query.includes('COUNT(*) AS n FROM users')) {
            return { n: users.size } as T
          }
          if (query.includes('FROM users WHERE username')) {
            const u = users.get(bound[0] as string)
            return (u ? { ...u } : null) as T | null
          }
          throw new Error(`unexpected first(): ${query}`)
        },
        async run() {
          if (query.startsWith('CREATE TABLE')) return
          if (query.startsWith('INSERT INTO settings ')) {
            settings = { json: bound[0] as string, updated_at: bound[1] as string }
            return
          }
          if (query.startsWith('INSERT INTO settings_history')) {
            history.push({ id: ++seq, json: bound[0] as string, saved_at: bound[1] as string })
            return
          }
          if (query.startsWith('DELETE FROM settings_history')) {
            history = history.slice(-(bound[0] as number))
            return
          }
          if (query.includes('INTO auth_meta')) {
            if (!meta) meta = { session_secret: bound[0] as string }
            return
          }
          if (query.startsWith('INSERT INTO users')) {
            users.set(bound[0] as string, {
              username: bound[0] as string,
              password_hash: bound[1] as string,
              status: (bound[3] as string) ?? 'active',
              email: (bound[4] as string | null) ?? null,
            })
            return
          }
          if (query.startsWith('UPDATE users SET status') || query.startsWith('DELETE FROM users')) {
            // 承認/却下（テストでは未使用だが、SQL到達時に落ちないように受ける）
            return
          }
          throw new Error(`unexpected run(): ${query}`)
        },
        async all<T>() {
          if (query.includes('FROM settings_history')) {
            const keep = bound[0] as number
            const results = [...history]
              .sort((a, b) => b.id - a.id)
              .slice(0, keep)
              .map(({ id, saved_at }) => ({ id, saved_at }))
            return { results: results as T[] }
          }
          throw new Error(`unexpected all(): ${query}`)
        },
      }
      return stmt
    },
  }
  return db
}

const APP_DATA = { roles: [], staff: [], shifts: [] }
const USER = 'tencho'
const PW = 'pass1234'

function req(path: string, method: string, body?: unknown, cookie?: string): Request {
  const headers: Record<string, string> = {}
  if (cookie) headers['cookie'] = cookie
  if (body !== undefined) headers['content-type'] = 'application/json'
  return new Request(`http://x${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function cookieFrom(res: Response): string {
  return (res.headers.get('set-cookie') ?? '').split(';')[0]
}

async function authed() {
  const db = fakeDb()
  const res = await handleApi(req('/api/auth/setup', 'POST', { username: USER, password: PW }), db)
  expect(res.status).toBe(200)
  return { db, cookie: cookieFrom(res) }
}

describe('worker 認証（ID＋パスワード）', () => {
  it('初期状態は未設定・未認証', async () => {
    const db = fakeDb()
    const res = await handleApi(req('/api/auth/status', 'GET'), db)
    expect(await res.json()).toMatchObject({ configured: false, authenticated: false })
  })

  it('初回セットアップでアカウント作成＆セッション発行', async () => {
    const db = fakeDb()
    const res = await handleApi(req('/api/auth/setup', 'POST', { username: USER, password: PW }), db)
    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toContain('sc_session=')
    const status = await handleApi(req('/api/auth/status', 'GET', undefined, cookieFrom(res)), db)
    expect(await status.json()).toMatchObject({ configured: true, authenticated: true, username: USER })
  })

  it('ID未入力は拒否', async () => {
    const db = fakeDb()
    const res = await handleApi(req('/api/auth/setup', 'POST', { username: '', password: PW }), db)
    expect(res.status).toBe(400)
  })

  it('短すぎるパスワードは拒否', async () => {
    const db = fakeDb()
    const res = await handleApi(req('/api/auth/setup', 'POST', { username: USER, password: '12' }), db)
    expect(res.status).toBe(400)
  })

  it('設定済みなら再セットアップ不可', async () => {
    const { db } = await authed()
    const res = await handleApi(req('/api/auth/setup', 'POST', { username: 'x', password: 'yyyy' }), db)
    expect(res.status).toBe(409)
  })

  it('正しいID＋パスワードでログイン', async () => {
    const { db } = await authed()
    const res = await handleApi(req('/api/auth/login', 'POST', { username: USER, password: PW }), db)
    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toContain('sc_session=')
  })

  it('誤ったパスワードは401', async () => {
    const { db } = await authed()
    const res = await handleApi(req('/api/auth/login', 'POST', { username: USER, password: 'wrong' }), db)
    expect(res.status).toBe(401)
  })

  it('存在しないIDは401', async () => {
    const { db } = await authed()
    const res = await handleApi(req('/api/auth/login', 'POST', { username: 'nobody', password: PW }), db)
    expect(res.status).toBe(401)
  })

  it('未ログインでは /api/settings は401', async () => {
    const { db } = await authed()
    const res = await handleApi(req('/api/settings', 'GET'), db)
    expect(res.status).toBe(401)
  })

  it('ログイン中は別アカウントを追加でき、そのIDでログインできる', async () => {
    const { db, cookie } = await authed()
    const reg = await handleApi(
      req('/api/auth/register', 'POST', { username: 'staff2', password: 'abcd' }, cookie),
      db,
    )
    expect(reg.status).toBe(200)
    const login = await handleApi(req('/api/auth/login', 'POST', { username: 'staff2', password: 'abcd' }), db)
    expect(login.status).toBe(200)
  })

  it('重複IDの追加は409', async () => {
    const { db, cookie } = await authed()
    const reg = await handleApi(
      req('/api/auth/register', 'POST', { username: USER, password: 'abcd' }, cookie),
      db,
    )
    expect(reg.status).toBe(409)
  })

  it('未ログインでのアカウント追加は401', async () => {
    const { db } = await authed()
    const reg = await handleApi(req('/api/auth/register', 'POST', { username: 'x', password: 'abcd' }), db)
    expect(reg.status).toBe(401)
  })
})

describe('worker 新規登録の申請＆承認', () => {
  it('管理者未作成なら申請不可（400）', async () => {
    const db = fakeDb()
    const res = await handleApi(
      req('/api/auth/request-access', 'POST', { username: 'newbie', password: 'abcd' }),
      db,
    )
    expect(res.status).toBe(400)
  })

  it('申請すると承認待ちで作成され、メール未設定でも申請自体は成立', async () => {
    const { db } = await authed()
    const res = await handleApi(
      req('/api/auth/request-access', 'POST', {
        username: 'newbie',
        password: 'abcd',
        email: 'n@example.com',
      }),
      db,
    )
    expect(res.status).toBe(200)
    // メール送信バインディング未指定 → emailed:false（申請は成立）
    expect(await res.json()).toMatchObject({ ok: true, emailed: false })
  })

  it('承認待ちアカウントはログイン不可（403 pending_approval）', async () => {
    const { db } = await authed()
    await handleApi(
      req('/api/auth/request-access', 'POST', { username: 'newbie', password: 'abcd' }),
      db,
    )
    const res = await handleApi(
      req('/api/auth/login', 'POST', { username: 'newbie', password: 'abcd' }),
      db,
    )
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: 'pending_approval' })
  })

  it('既存IDでの申請は409', async () => {
    const { db } = await authed()
    const res = await handleApi(
      req('/api/auth/request-access', 'POST', { username: USER, password: 'abcd' }),
      db,
    )
    expect(res.status).toBe(409)
  })

  it('不正な承認トークンはHTMLでエラー表示（200）', async () => {
    const { db } = await authed()
    const res = await handleApi(req('/api/auth/approve?token=bogus', 'GET'), db)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(await res.text()).toContain('リンクが無効です')
  })
})

describe('worker /api/settings（要ログイン）', () => {
  it('未保存なら GET は 404', async () => {
    const { db, cookie } = await authed()
    const res = await handleApi(req('/api/settings', 'GET', undefined, cookie), db)
    expect(res.status).toBe(404)
  })

  it('PUT で保存し GET で取得できる', async () => {
    const { db, cookie } = await authed()
    const res = await handleApi(
      req('/api/settings', 'PUT', { data: APP_DATA, expectedUpdatedAt: null }, cookie),
      db,
    )
    expect(res.status).toBe(200)
    const { updatedAt } = (await res.json()) as { updatedAt: string }
    const res2 = await handleApi(req('/api/settings', 'GET', undefined, cookie), db)
    const body = (await res2.json()) as { data: unknown; updatedAt: string }
    expect(body.data).toEqual(APP_DATA)
    expect(body.updatedAt).toBe(updatedAt)
  })

  it('expectedUpdatedAt 不一致なら 409（楽観ロック）', async () => {
    const { db, cookie } = await authed()
    await handleApi(req('/api/settings', 'PUT', { data: APP_DATA, expectedUpdatedAt: null }, cookie), db)
    const res = await handleApi(
      req('/api/settings', 'PUT', { data: APP_DATA, expectedUpdatedAt: null }, cookie),
      db,
    )
    expect(res.status).toBe(409)
  })

  it('force=true なら競合しても上書き', async () => {
    const { db, cookie } = await authed()
    await handleApi(req('/api/settings', 'PUT', { data: APP_DATA, expectedUpdatedAt: null }, cookie), db)
    const res = await handleApi(
      req('/api/settings', 'PUT', { data: APP_DATA, expectedUpdatedAt: null, force: true }, cookie),
      db,
    )
    expect(res.status).toBe(200)
  })

  it('形が不正なデータは 400', async () => {
    const { db, cookie } = await authed()
    const res = await handleApi(
      req('/api/settings', 'PUT', { data: { hello: 1 }, expectedUpdatedAt: null }, cookie),
      db,
    )
    expect(res.status).toBe(400)
  })

  it('履歴が /api/history で取得できる', async () => {
    const { db, cookie } = await authed()
    await handleApi(req('/api/settings', 'PUT', { data: APP_DATA, expectedUpdatedAt: null }, cookie), db)
    await handleApi(
      req('/api/settings', 'PUT', { data: APP_DATA, expectedUpdatedAt: null, force: true }, cookie),
      db,
    )
    const res = await handleApi(req('/api/history', 'GET', undefined, cookie), db)
    const body = (await res.json()) as { history: { id: number; saved_at: string }[] }
    expect(body.history).toHaveLength(2)
  })
})

describe('AI利用回数の上限（evaluateAiUse）', () => {
  const MONTH = '2026-07'

  it('trialing は累計5回まで（リセットなし）', () => {
    expect(AI_LIMITS.trialing).toBe(5)
    let u = evaluateAiUse('trialing', 0, 'trialing', MONTH)
    expect(u.limit).toBe(5)
    expect(u.allowed).toBe(true)
    expect(u.remaining).toBe(5)
    expect(u.period).toBe('trialing')
    u = evaluateAiUse('trialing', 4, 'trialing', MONTH)
    expect(u.remaining).toBe(1)
    u = evaluateAiUse('trialing', 5, 'trialing', MONTH)
    expect(u.allowed).toBe(false)
    expect(u.remaining).toBe(0)
  })

  it('active は毎月30回まで', () => {
    expect(AI_LIMITS.active).toBe(30)
    const u = evaluateAiUse('active', 29, MONTH, MONTH)
    expect(u.limit).toBe(30)
    expect(u.allowed).toBe(true)
    expect(u.remaining).toBe(1)
    expect(evaluateAiUse('active', 30, MONTH, MONTH).allowed).toBe(false)
  })

  it('free は0回（利用不可）', () => {
    expect(AI_LIMITS.free).toBe(0)
    const u = evaluateAiUse('free', 0, 'free', MONTH)
    expect(u.limit).toBe(0)
    expect(u.allowed).toBe(false)
    expect(u.remaining).toBe(0)
  })

  it('active は月が変わるとカウントが0にリセットされる', () => {
    const u = evaluateAiUse('active', 30, '2026-06', '2026-07')
    expect(u.used).toBe(0)
    expect(u.allowed).toBe(true)
    expect(u.remaining).toBe(30)
    expect(u.period).toBe('2026-07')
  })

  it('trialing→active で上限が30/月に上がる', () => {
    expect(evaluateAiUse('trialing', 5, 'trialing', MONTH).allowed).toBe(false)
    const upgraded = evaluateAiUse('active', 5, 'trialing', MONTH)
    expect(upgraded.used).toBe(0)
    expect(upgraded.allowed).toBe(true)
  })

  it('未知の層は trialing 扱い（安全側）', () => {
    const u = evaluateAiUse(undefined, 0, '', MONTH)
    expect(u.tier).toBe('trialing')
    expect(u.limit).toBe(5)
  })
})

describe('アクセス権限（computeEntitlement）', () => {
  const NOW = Date.parse('2026-07-17T00:00:00Z')
  const future = new Date(NOW + 3 * 86400000).toISOString()
  const past = new Date(NOW - 3 * 86400000).toISOString()

  it('購読 active はフルアクセス', () => {
    const e = computeEntitlement('active', null, NOW)
    expect(e.tier).toBe('active')
    expect(e.entitled).toBe(true)
  })

  it('comp（無料招待）はフルアクセス', () => {
    expect(computeEntitlement('comp', null, NOW).entitled).toBe(true)
  })

  it('トライアル期間内は trialing でフルアクセス', () => {
    const e = computeEntitlement(null, future, NOW)
    expect(e.tier).toBe('trialing')
    expect(e.entitled).toBe(true)
  })

  it('トライアル切れ・未購読は free（ロック）', () => {
    const e = computeEntitlement(null, past, NOW)
    expect(e.tier).toBe('free')
    expect(e.entitled).toBe(false)
  })

  it('解約後（canceled）はトライアルも切れていれば free', () => {
    expect(computeEntitlement('canceled', past, NOW).tier).toBe('free')
    // ただしトライアル期間内なら trialing 扱い
    expect(computeEntitlement('canceled', future, NOW).tier).toBe('trialing')
  })

  it('past_due はフルアクセスに含めない（トライアルも無ければ free）', () => {
    expect(computeEntitlement('past_due', null, NOW).tier).toBe('free')
  })
})

describe('Stripe Webhook 署名検証（verifyStripeSignature）', () => {
  const secret = 'whsec_test_secret'
  const body = '{"type":"customer.subscription.updated"}'

  async function hmacHex(msg: string): Promise<string> {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg))
    return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
  }

  it('正しい署名は通る', async () => {
    const nowMs = Date.parse('2026-07-17T00:00:00Z')
    const t = Math.floor(nowMs / 1000)
    const v1 = await hmacHex(`${t}.${body}`)
    const ok = await verifyStripeSignature(body, `t=${t},v1=${v1}`, secret, nowMs)
    expect(ok).toBe(true)
  })

  it('署名が違えば拒否', async () => {
    const nowMs = Date.parse('2026-07-17T00:00:00Z')
    const t = Math.floor(nowMs / 1000)
    const ok = await verifyStripeSignature(body, `t=${t},v1=deadbeef`, secret, nowMs)
    expect(ok).toBe(false)
  })

  it('古いタイムスタンプ（許容超え）は拒否', async () => {
    const nowMs = Date.parse('2026-07-17T00:00:00Z')
    const t = Math.floor(nowMs / 1000) - 10 * 60 // 10分前
    const v1 = await hmacHex(`${t}.${body}`)
    const ok = await verifyStripeSignature(body, `t=${t},v1=${v1}`, secret, nowMs)
    expect(ok).toBe(false)
  })
})
