import { describe, expect, it } from 'vitest'
import { handleApi, type D1Database, type D1PreparedStatement } from './index'

/**
 * D1 のインメモリ・フェイク。worker/index.ts が発行する固定SQLパターンのみ解釈する。
 */
function fakeDb() {
  let settings: { json: string; updated_at: string } | null = null
  let meta: { session_secret: string } | null = null
  const users = new Map<string, { username: string; password_hash: string }>()
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
            })
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
