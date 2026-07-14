import { useRef, useState } from 'react'
import { useStore } from '../state/store'
import type { AppData } from '../types'
import {
  fetchCloud,
  formatSyncTime,
  getLastSyncedAt,
  registerAccount,
  saveCloud,
  setLastSyncedAt,
} from '../utils/cloud'

export default function DataMenu({ authed = false }: { authed?: boolean }) {
  const data = useStore((s) => s.data)
  const importData = useStore((s) => s.importData)
  const resetData = useStore((s) => s.resetData)
  const loadSampleData = useStore((s) => s.loadSampleData)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleAddAccount = async () => {
    const username = prompt('追加するアカウントのID（ユーザー名）を入力してください')
    if (!username || !username.trim()) return
    const password = prompt('そのアカウントのパスワード（4文字以上）を入力してください')
    if (!password || password.length < 4) {
      alert('パスワードは4文字以上にしてください。')
      return
    }
    const res = await registerAccount(username.trim(), password)
    if (res.ok) alert(`アカウント「${username.trim()}」を追加しました。このID＋パスワードでログインできます。`)
    else if (res.error === 'username_taken') alert('そのIDは既に使われています。')
    else alert('追加に失敗しました。')
    setOpen(false)
  }

  const cloudUnavailableMsg =
    'クラウドに接続できませんでした。Cloudflareにデプロイした本番URLで開いているか確認してください（ローカル開発ではクラウド保存は使えません）。'

  const handleCloudSave = async () => {
    setBusy(true)
    try {
      const res = await saveCloud(data, getLastSyncedAt())
      if (res.ok) {
        setLastSyncedAt(res.updatedAt)
        alert(`クラウドに保存しました（${formatSyncTime(res.updatedAt)}）。`)
      } else if (
        confirm(
          `クラウド上に別の保存があります（${formatSyncTime(res.conflictUpdatedAt)}）。\nこの端末の内容で上書きしますか？`,
        )
      ) {
        const forced = await saveCloud(data, null, true)
        if (forced.ok) {
          setLastSyncedAt(forced.updatedAt)
          alert(`クラウドに保存しました（${formatSyncTime(forced.updatedAt)}）。`)
        }
      }
    } catch {
      alert(cloudUnavailableMsg)
    } finally {
      setBusy(false)
      setOpen(false)
    }
  }

  const handleCloudLoad = async () => {
    setBusy(true)
    try {
      const cloud = await fetchCloud()
      if (!cloud) {
        alert('クラウドに保存データがまだありません。先に「クラウドに保存」してください。')
      } else if (
        confirm(
          `クラウドの設定（${formatSyncTime(cloud.updatedAt)} 保存）で、この端末の設定を置き換えますか？`,
        )
      ) {
        importData(cloud.data)
        setLastSyncedAt(cloud.updatedAt)
        alert('クラウドから読み込みました。')
      }
    } catch {
      alert(cloudUnavailableMsg)
    } finally {
      setBusy(false)
      setOpen(false)
    }
  }

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'shiftcraft-settings.json'
    link.click()
    URL.revokeObjectURL(url)
    setOpen(false)
  }

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result as string) as AppData
        if (!parsed.roles || !parsed.staff || !parsed.shifts) {
          alert('設定ファイルの形式が正しくありません。')
          return
        }
        importData(parsed)
        alert('設定を読み込みました。')
      } catch {
        alert('JSONの読み込みに失敗しました。')
      }
    }
    reader.readAsText(file)
    e.target.value = ''
    setOpen(false)
  }

  return (
    <div className="relative">
      <button className="btn-ghost" onClick={() => setOpen(!open)}>
        ⋯ データ
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-60 rounded-md border border-slate-200 bg-white py-1 shadow-lg">
            <button
              className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-100 disabled:opacity-50"
              onClick={handleCloudSave}
              disabled={busy}
            >
              ☁️ クラウドに保存
            </button>
            <button
              className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-100 disabled:opacity-50"
              onClick={handleCloudLoad}
              disabled={busy}
            >
              ☁️ クラウドから読込
            </button>
            {getLastSyncedAt() && (
              <p className="px-3 pb-1 text-[10px] text-slate-400">
                最終同期: {formatSyncTime(getLastSyncedAt()!)}
              </p>
            )}
            <div className="my-1 border-t border-slate-100" />
            <button
              className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-100"
              onClick={handleExport}
            >
              ⬇️ 設定をエクスポート
            </button>
            <button
              className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-100"
              onClick={() => fileRef.current?.click()}
            >
              ⬆️ 設定をインポート
            </button>
            {authed && (
              <>
                <div className="my-1 border-t border-slate-100" />
                <button
                  className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-100"
                  onClick={handleAddAccount}
                >
                  👤 アカウントを追加
                </button>
              </>
            )}
            <div className="my-1 border-t border-slate-100" />
            <button
              className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-100"
              onClick={() => {
                if (
                  confirm('従業員15人のテストデータを投入しますか？現在の設定は置き換わります。')
                ) {
                  loadSampleData()
                  setOpen(false)
                }
              }}
            >
              🧪 テストデータ投入（15人）
            </button>
            <button
              className="block w-full px-3 py-1.5 text-left text-sm text-red-600 hover:bg-red-50"
              onClick={() => {
                if (confirm('すべての設定を初期状態（サンプル）に戻しますか？')) {
                  resetData()
                  setOpen(false)
                }
              }}
            >
              🗑️ 初期化（サンプルに戻す）
            </button>
          </div>
        </>
      )}
      <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={handleImport} />
    </div>
  )
}
