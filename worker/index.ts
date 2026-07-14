/**
 * Cloudflare Worker: 静的アセット配信 + 設定保存API（D1）。
 *
 * ルート:
 *  GET /api/settings   → 現在の設定 { data, updatedAt }（未保存なら404）
 *  PUT /api/settings   → 保存 { data, expectedUpdatedAt, force? }
 *                        expectedUpdatedAt がサーバーと不一致なら 409（force=true で上書き）
 *  GET /api/history    → 保存履歴のメタ情報一覧（直近20件）
 *  その他              → 静的アセット（Vite の dist/）
 *
 * 認証は Cloudflare Access でサイト全体を保護する前提（docs/deploy-cloudflare.md）。
 */

// ---- D1 の最小型定義（@cloudflare/workers-types 非依存で自己完結） ----
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
const MAX_BODY_BYTES = 1_000_000 // 設定JSONは高々数十KBの想定。1MBで打ち切り

interface SettingsRow {
  json: string
  updated_at: string
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/** 保存データの最低限の形チェック（壊れたJSONでの上書き事故を防ぐ） */
function looksLikeAppData(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false
  const d = v as Record<string, unknown>
  return Array.isArray(d.roles) && Array.isArray(d.staff) && Array.isArray(d.shifts)
}

export async function handleApi(request: Request, db: D1Database): Promise<Response> {
  const url = new URL(request.url)

  if (url.pathname === '/api/settings' && request.method === 'GET') {
    const row = await db
      .prepare('SELECT json, updated_at FROM settings WHERE id = 1')
      .first<SettingsRow>()
    if (!row) return json({ error: 'not_found' }, 404)
    return json({ data: JSON.parse(row.json), updatedAt: row.updated_at })
  }

  if (url.pathname === '/api/settings' && request.method === 'PUT') {
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

    // 楽観ロック: 呼び出し側が知っている更新時刻とサーバーが不一致 → 競合
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
    // 履歴は直近 HISTORY_KEEP 件のみ保持
    await db
      .prepare(
        `DELETE FROM settings_history WHERE id NOT IN (
           SELECT id FROM settings_history ORDER BY id DESC LIMIT ?1)`,
      )
      .bind(HISTORY_KEEP)
      .run()

    return json({ updatedAt })
  }

  if (url.pathname === '/api/history' && request.method === 'GET') {
    const { results } = await db
      .prepare('SELECT id, saved_at FROM settings_history ORDER BY id DESC LIMIT ?1')
      .bind(HISTORY_KEEP)
      .all<{ id: number; saved_at: string }>()
    return json({ history: results })
  }

  return json({ error: 'not_found' }, 404)
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
