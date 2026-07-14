import { useState } from 'react'
import { useStore } from '../state/store'
import type { ShiftType } from '../types'
import { boundMin, isMinorForbidden, legalBreakMin, minToLabel, nightMin, paidMin } from '../utils/time'

function ShiftInfo({ shift }: { shift: ShiftType }) {
  const bound = boundMin(shift)
  const brk = legalBreakMin(bound)
  const paid = paidMin(shift)
  const night = nightMin(shift)
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="chip bg-slate-100 text-slate-600">拘束 {minToLabel(bound)}</span>
      <span className="chip bg-slate-100 text-slate-600">実働 {minToLabel(paid)}</span>
      <span
        className={`chip ${brk > 0 ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-500'}`}
        title="労基法34条: 実働6時間超は45分以上、8時間超は1時間以上の休憩"
      >
        法定休憩 {brk > 0 ? minToLabel(brk) : '不要'}
      </span>
      {night > 0 && (
        <span
          className="chip bg-indigo-100 text-indigo-700"
          title="22時〜翌5時は25%以上の割増賃金（労基法37条）"
        >
          深夜 {minToLabel(night)}（割増25%）
        </span>
      )}
      {isMinorForbidden(shift) && (
        <span
          className="chip bg-purple-100 text-purple-700"
          title="18歳未満は22時〜翌5時に勤務不可（労基法61条）"
        >
          18歳未満 不可
        </span>
      )}
    </div>
  )
}

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
          <div key={shift.id} className="card space-y-2">
            <div className="flex flex-wrap items-end gap-3">
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
            <ShiftInfo shift={shift} />
          </div>
        ))}
        {shifts.length === 0 && (
          <p className="text-sm text-slate-400">時間帯がありません。追加してください。</p>
        )}
      </div>
    </div>
  )
}
