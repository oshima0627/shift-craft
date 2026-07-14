import { useState } from 'react'
import { useStore } from '../state/store'
import { displayDate } from '../utils/date'

export default function PeriodTab() {
  const period = useStore((s) => s.data.period)
  const updatePeriod = useStore((s) => s.updatePeriod)
  const [holidayInput, setHolidayInput] = useState('')

  const addHoliday = () => {
    if (!holidayInput) return
    if (!period.holidays.includes(holidayInput)) {
      updatePeriod({ holidays: [...period.holidays, holidayInput].sort() })
    }
    setHolidayInput('')
  }

  return (
    <div className="space-y-4">
      <h2 className="text-base font-bold text-slate-700">期間・祝日の設定</h2>
      <div className="card grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label">開始日</label>
          <input
            type="date"
            className="input"
            value={period.start}
            onChange={(e) => updatePeriod({ start: e.target.value })}
          />
        </div>
        <div>
          <label className="label">終了日</label>
          <input
            type="date"
            className="input"
            value={period.end}
            onChange={(e) => updatePeriod({ end: e.target.value })}
          />
        </div>
      </div>

      <div className="card space-y-3">
        <div>
          <label className="label">祝日を追加（この日は「祝」区分の必要人数が適用されます）</label>
          <div className="flex gap-2">
            <input
              type="date"
              className="input flex-1"
              value={holidayInput}
              onChange={(e) => setHolidayInput(e.target.value)}
            />
            <button className="btn-primary" onClick={addHoliday}>
              追加
            </button>
          </div>
        </div>
        {period.holidays.length === 0 ? (
          <p className="text-sm text-slate-400">祝日は未登録です。</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {period.holidays.map((h) => (
              <span key={h} className="chip bg-red-50 text-red-600">
                {displayDate(h)}
                <button
                  className="ml-1 text-red-400 hover:text-red-600"
                  onClick={() =>
                    updatePeriod({ holidays: period.holidays.filter((x) => x !== h) })
                  }
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
