import { describe, expect, it } from 'vitest'
import { handleApi, type D1Database, type D1PreparedStatement } from './index'

/**
 * D1 のインメモリ・フェイク。
 * worker/index.ts が発行する固定SQLパターンのみ解釈する。
 */
function fakeDb() {
  let settings: { json: string; updated_at: string } | null = null
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
          throw new Error(`unexpected first(): ${query}`)
        },
        async run() {
          if (query.startsWith('INSERT INTO settings ')) {
            settings = { json: bound[0] as string, updated_at: bound[1] as string }
            return
          }
          if (query.startsWith('INSERT INTO settings_history')) {
            history.push({ id: ++seq, json: bound[0] as string, saved_at: bound[1] as string })
            return
          }
          if (query.startsWith('DELETE FROM settings_history')) {
            const keep = bound[0] as number
            history = history.slice(-keep)
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
  return { db, inspect: () => ({ settings, history }) }
}

const APP_DATA = { roles: [], staff: [], shifts: [] }

const put = (body: unknown) =>
  new Request('http://x/api/settings', { method: 'PUT', body: JSON.stringify(body) })
const get = (path = '/api/settings') => new Request(`http://x${path}`, { method: 'GET' })

describe('worker /api/settings', () => {
  it('未保存なら GET は 404', async () => {
    const { db } = fakeDb()
    const res = await handleApi(get(), db)
    expect(res.status).toBe(404)
  })

  it('PUT で保存し GET で取得できる', async () => {
    const { db } = fakeDb()
    const res = await handleApi(put({ data: APP_DATA, expectedUpdatedAt: null }), db)
    expect(res.status).toBe(200)
    const { updatedAt } = (await res.json()) as { updatedAt: string }
    expect(updatedAt).toBeTruthy()

    const res2 = await handleApi(get(), db)
    expect(res2.status).toBe(200)
    const body = (await res2.json()) as { data: unknown; updatedAt: string }
    expect(body.data).toEqual(APP_DATA)
    expect(body.updatedAt).toBe(updatedAt)
  })

  it('expectedUpdatedAt が不一致なら 409（楽観ロック）', async () => {
    const { db } = fakeDb()
    await handleApi(put({ data: APP_DATA, expectedUpdatedAt: null }), db)
    // 別端末を想定: 古い(null)ベースで再保存 → 競合
    const res = await handleApi(put({ data: APP_DATA, expectedUpdatedAt: null }), db)
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: string; updatedAt: string }
    expect(body.error).toBe('conflict')
    expect(body.updatedAt).toBeTruthy()
  })

  it('force=true なら競合しても上書きできる', async () => {
    const { db } = fakeDb()
    await handleApi(put({ data: APP_DATA, expectedUpdatedAt: null }), db)
    const res = await handleApi(put({ data: APP_DATA, expectedUpdatedAt: null, force: true }), db)
    expect(res.status).toBe(200)
  })

  it('一致する expectedUpdatedAt なら通常保存できる', async () => {
    const { db } = fakeDb()
    const r1 = await handleApi(put({ data: APP_DATA, expectedUpdatedAt: null }), db)
    const { updatedAt } = (await r1.json()) as { updatedAt: string }
    const r2 = await handleApi(put({ data: APP_DATA, expectedUpdatedAt: updatedAt }), db)
    expect(r2.status).toBe(200)
  })

  it('形が不正なデータは 400', async () => {
    const { db } = fakeDb()
    const res = await handleApi(put({ data: { hello: 1 }, expectedUpdatedAt: null }), db)
    expect(res.status).toBe(400)
  })

  it('履歴が保存され /api/history で取得できる', async () => {
    const { db } = fakeDb()
    await handleApi(put({ data: APP_DATA, expectedUpdatedAt: null }), db)
    await handleApi(put({ data: APP_DATA, expectedUpdatedAt: null, force: true }), db)
    const res = await handleApi(get('/api/history'), db)
    const body = (await res.json()) as { history: { id: number; saved_at: string }[] }
    expect(body.history).toHaveLength(2)
    expect(body.history[0].id).toBeGreaterThan(body.history[1].id)
  })
})
