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

// ===== 認証（アプリ内ログイン） =====

export type AuthStatus =
  | { backend: true; configured: boolean; authenticated: boolean }
  | { backend: false }

/** 認証状態を取得。バックエンド未接続（ローカル開発等）なら backend:false */
export async function getAuthStatus(): Promise<AuthStatus> {
  try {
    const res = await fetch('/api/auth/status', { headers: { accept: 'application/json' } })
    const ct = res.headers.get('content-type') ?? ''
    if (!ct.includes('application/json')) return { backend: false }
    const body = (await res.json()) as { configured?: boolean; authenticated?: boolean }
    if (typeof body.configured !== 'boolean') return { backend: false }
    return { backend: true, configured: body.configured, authenticated: !!body.authenticated }
  } catch {
    return { backend: false }
  }
}

async function postJson(path: string, body: unknown): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) return { ok: true }
    const b = (await res.json().catch(() => ({}))) as { error?: string }
    return { ok: false, error: b.error }
  } catch {
    return { ok: false, error: 'network' }
  }
}

/** 初回パスワード設定（未設定時のみ） */
export function setupPassword(password: string) {
  return postJson('/api/auth/setup', { password })
}

/** ログイン */
export function login(password: string) {
  return postJson('/api/auth/login', { password })
}

/** ログアウト */
export async function logout(): Promise<void> {
  try {
    await fetch('/api/auth/logout', { method: 'POST' })
  } catch {
    // ignore
  }
}

// ===== 自動同期 =====

// 直近にクラウドと一致していた設定JSON（冗長な保存・保存ループを防ぐ）
let lastSyncedJson: string | null = null

/** 実質的に空のデータか（役割・スタッフ・シフトがすべて無い） */
function isEmptyData(d: AppData): boolean {
  return (
    (d.roles?.length ?? 0) === 0 &&
    (d.staff?.length ?? 0) === 0 &&
    (d.shifts?.length ?? 0) === 0
  )
}

/**
 * クラウドの設定を取り込む（ログイン直後に呼ぶ）。
 * クラウドに中身のある保存があれば取り込む。クラウドが無い/空の場合は、
 * 現在のローカル（既存の作業内容）をクラウドへ保存する（空データで上書きしない）。
 */
export async function pullCloudIntoStore(
  getData: () => AppData,
  setData: (data: AppData) => void,
): Promise<void> {
  const cloud = await fetchCloud()
  if (cloud && !isEmptyData(cloud.data)) {
    setData(cloud.data)
    lastSyncedJson = JSON.stringify(getData())
    setLastSyncedAt(cloud.updatedAt)
  } else {
    // クラウドが無い/空 → ローカルを保存（初回はローカルを正とする）
    const res = await saveCloud(getData(), null, true)
    if (res.ok) {
      lastSyncedJson = JSON.stringify(getData())
      setLastSyncedAt(res.updatedAt)
    }
  }
}

/**
 * 変更があればクラウドへ保存（自動同期）。
 * 競合（別端末が先に保存）時はリモートを採用して取り込む。
 */
export async function pushCloudIfChanged(
  getData: () => AppData,
  setData: (data: AppData) => void,
): Promise<void> {
  const json = JSON.stringify(getData())
  if (json === lastSyncedJson) return
  const res = await saveCloud(getData(), getLastSyncedAt())
  if (res.ok) {
    lastSyncedJson = json
    setLastSyncedAt(res.updatedAt)
  } else {
    // 競合 → リモートを正として取り込む
    await pullCloudIntoStore(getData, setData)
  }
}
