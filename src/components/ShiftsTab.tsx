import { useState } from 'react'
import { useStore } from '../state/store'

export default function ShiftsTab() {
  const shifts = useStore((s) => s.data.shifts)
  const addShift = useStore((s) => s.addShift)
  const updateShift = useStore((s) => s.updateShift)
  const removeShift = useStore((s) => s.removeShift)
  const [name, setName] = useState('')

  const handleAdd = () => {
    if (!name.trim()) return
    addShift({ name: name.trim(), start: '09:00', end: '17:00' })
    setName('')
  }

  return (
    <div className="space-y-4">
      <h2 className="text-base font-bold text-slate-700">シフト時間帯</h2>
      <p className="text-sm text-slate-500">
        例: 早番 09:00〜17:00、遅番 13:00〜22:00 など。開始・終了時刻を細かく設定できます。
      </p>

      <div className="card flex gap-2">
        <input
          className="input flex-1"
          placeholder="時間帯名（例: 早番）"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
        />
        <button className="btn-primary" onClick={handleAdd}>
          追加
        </button>
      </div>

      <div className="grid gap-2">
        {shifts.map((shift) => (
          <div key={shift.id} className="card flex flex-wrap items-end gap-3">
            <div className="min-w-[8rem] flex-1">
              <label className="label">名称</label>
              <input
                className="input"
                value={shift.name}
                onChange={(e) => updateShift(shift.id, { name: e.target.value })}
              />
            </div>
            <div>
              <label className="label">開始</label>
              <input
                type="time"
                className="input"
                value={shift.start}
                onChange={(e) => updateShift(shift.id, { start: e.target.value })}
              />
            </div>
            <div>
              <label className="label">終了</label>
              <input
                type="time"
                className="input"
                value={shift.end}
                onChange={(e) => updateShift(shift.id, { end: e.target.value })}
              />
            </div>
            <button
              className="btn-danger"
              onClick={() => {
                if (confirm(`時間帯「${shift.name}」を削除しますか？`)) removeShift(shift.id)
              }}
            >
              削除
            </button>
          </div>
        ))}
        {shifts.length === 0 && (
          <p className="text-sm text-slate-400">時間帯がありません。追加してください。</p>
        )}
      </div>
    </div>
  )
}
