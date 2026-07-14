import { useRef, useState } from 'react'
import { useStore } from '../state/store'
import type { AppData } from '../types'

export default function DataMenu() {
  const data = useStore((s) => s.data)
  const importData = useStore((s) => s.importData)
  const resetData = useStore((s) => s.resetData)
  const [open, setOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

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
          <div className="absolute right-0 z-20 mt-1 w-52 rounded-md border border-slate-200 bg-white py-1 shadow-lg">
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
            <div className="my-1 border-t border-slate-100" />
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
