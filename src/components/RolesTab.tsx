import { useState } from 'react'
import { useStore } from '../state/store'

const PALETTE = ['#3b6fe0', '#e0733b', '#2fa36b', '#a855f7', '#e0417a', '#0891b2', '#ca8a04']

export default function RolesTab() {
  const roles = useStore((s) => s.data.roles)
  const addRole = useStore((s) => s.addRole)
  const updateRole = useStore((s) => s.updateRole)
  const removeRole = useStore((s) => s.removeRole)
  const [name, setName] = useState('')

  const handleAdd = () => {
    if (!name.trim()) return
    addRole(name.trim(), PALETTE[roles.length % PALETTE.length])
    setName('')
  }

  return (
    <div className="space-y-4">
      <h2 className="text-base font-bold text-slate-700">役割（ロール）</h2>
      <p className="text-sm text-slate-500">
        例: ホール、キッチン、レジ など。スタッフはここで定義した役割を担当できます。
      </p>

      <div className="card flex gap-2">
        <input
          className="input flex-1"
          placeholder="役割名を入力"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
        />
        <button className="btn-primary" onClick={handleAdd}>
          追加
        </button>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {roles.map((role) => (
          <div key={role.id} className="card flex items-center gap-3">
            <input
              type="color"
              className="h-8 w-8 cursor-pointer rounded border-0 bg-transparent p-0"
              value={role.color}
              onChange={(e) => updateRole(role.id, { color: e.target.value })}
            />
            <input
              className="input flex-1"
              value={role.name}
              onChange={(e) => updateRole(role.id, { name: e.target.value })}
            />
            <button
              className="btn-danger"
              onClick={() => {
                if (confirm(`役割「${role.name}」を削除しますか？関連する必要人数設定も削除されます。`))
                  removeRole(role.id)
              }}
            >
              削除
            </button>
          </div>
        ))}
        {roles.length === 0 && (
          <p className="text-sm text-slate-400">役割がありません。追加してください。</p>
        )}
      </div>
    </div>
  )
}
