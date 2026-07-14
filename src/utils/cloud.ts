import type { AppData } from '../types'

/**
 * クラウド同期（Cloudflare Workers + D1）クライアント。
 * 明示的な「保存 / 読込」のみ。自動同期はしない（競合事故を避ける設計判断）。
 * 最後に同期したサーバー側 updatedAt を localStorage に控え、楽観ロックに使う。
 */

const SYNCED_AT_KEY = 'shiftcraft-cloud-synced-at'

export function getLastSyncedAt(): string | null {
  try {
    return localStorage.getItem(SYNCED_AT_KEY)
  } catch {
    return null
  }
}

export function setLastSyncedAt(v: string | null): void {
  try {
    if (v === null) localStorage.removeItem(SYNCED_AT_KEY)
    else localStorage.setItem(SYNCED_AT_KEY, v)
  } catch {
    // localStorage 不可の環境では同期時刻を保持しない（毎回確認ダイアログになるだけ）
  }
}

export type SaveResult =
  | { ok: true; updatedAt: string }
  | { ok: false; conflictUpdatedAt: string }

export async function fetchCloud(): Promise<{ data: AppData; updatedAt: string } | null> {
  const res = await fetch('/api/settings', { method: 'GET' })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`GET /api/settings failed: ${res.status}`)
  return (await res.json()) as { data: AppData; updatedAt: string }
}

export async function saveCloud(
  data: AppData,
  expectedUpdatedAt: string | null,
  force = false,
): Promise<SaveResult> {
  const res = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ data, expectedUpdatedAt, force }),
  })
  if (res.status === 409) {
    const body = (await res.json()) as { updatedAt: string }
    return { ok: false, conflictUpdatedAt: body.updatedAt }
  }
  if (!res.ok) throw new Error(`PUT /api/settings failed: ${res.status}`)
  const body = (await res.json()) as { updatedAt: string }
  return { ok: true, updatedAt: body.updatedAt }
}

/** ISO文字列をユーザー向け表示に（例: 2026/7/14 18:30） */
export function formatSyncTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
