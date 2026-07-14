import { useState } from 'react'
import type { AppData, Assignment, ScheduleResult } from '../types'
import { dayCategoryOf, enumerateDates, isRestDay, weekdayLabel } from '../utils/date'
import { parse } from '../utils/date'

interface Props {
  data: AppData
  result: ScheduleResult
  onChange: (assignments: Assignment[]) => void
}

/** スタッフ×日付のシフト表。セルをクリックして手動調整できる。 */
export default function ScheduleGrid({ data, result, onChange }: Props) {
  const dates = enumerateDates(data.period)
  const roleById = new Map(data.roles.map((r) => [r.id, r]))
  const shiftById = new Map(data.shifts.map((s) => [s.id, s]))
  const [editing, setEditing] = useState<{ staffId: string; date: string } | null>(null)

  const cellOf = (staffId: string, date: string): Assignment | undefined =>
    result.assignments.find((a) => a.staffId === staffId && a.date === date)

  const setCell = (staffId: string, date: string, shiftId: string | null, roleId: string | null) => {
    // 既存のその人・その日の割り当てを除去
    let next = result.assignments.filter((a) => !(a.staffId === staffId && a.date === date))
    if (shiftId && roleId) {
      next = [...next, { staffId, date, shiftId, roleId }]
    }
    onChange(next)
    setEditing(null)
  }

  return (
    <div className="card overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 border-b border-slate-200 bg-white px-2 py-1 text-left">
              スタッフ
            </th>
            {dates.map((date) => {
              const rest = isRestDay(date, data.period.holidays)
              const cat = dayCategoryOf(date, data.period.holidays)
              return (
                <th
                  key={date}
                  className={`border-b border-slate-200 px-1 py-1 text-center font-medium ${
                    cat === 'holiday' || cat === 'sunday'
                      ? 'text-red-500'
                      : cat === 'saturday'
                        ? 'text-blue-500'
                        : 'text-slate-500'
                  } ${rest ? 'bg-slate-50' : ''}`}
                >
                  <div>{parse(date).getDate()}</div>
                  <div className="text-[10px]">{weekdayLabel(date)}</div>
                </th>
              )
            })}
            <th className="border-b border-slate-200 px-2 py-1 text-center">計</th>
          </tr>
        </thead>
        <tbody>
          {data.staff.map((st) => (
            <tr key={st.id} className="hover:bg-slate-50/50">
              <td className="sticky left-0 z-10 whitespace-nowrap border-b border-slate-100 bg-white px-2 py-1 font-medium">
                {st.name}
                {st.level === 0 && (
                  <span className="ml-1 text-[10px] text-amber-500">新</span>
                )}
              </td>
              {dates.map((date) => {
                const a = cellOf(st.id, date)
                const role = a ? roleById.get(a.roleId) : undefined
                const shift = a ? shiftById.get(a.shiftId) : undefined
                const unavailable = st.unavailableDates.includes(date)
                const rest = isRestDay(date, data.period.holidays)
                return (
                  <td
                    key={date}
                    onClick={() => setEditing({ staffId: st.id, date })}
                    className={`cursor-pointer border-b border-l border-slate-100 px-0.5 py-1 text-center align-middle ${
                      rest ? 'bg-slate-50/60' : ''
                    } ${unavailable ? 'bg-red-50' : ''} hover:ring-1 hover:ring-brand-400`}
                    title={
                      unavailable
                        ? '出勤不可日'
                        : a
                          ? `${role?.name ?? ''} / ${shift?.name ?? ''}`
                          : 'クリックで割り当て'
                    }
                  >
                    {a && role ? (
                      <span
                        className="inline-block w-full truncate rounded px-1 text-[10px] font-medium text-white"
                        style={{ backgroundColor: role.color }}
                      >
                        {shift?.name ?? '○'}
                      </span>
                    ) : unavailable ? (
                      <span className="text-[10px] text-red-300">×</span>
                    ) : (
                      <span className="text-slate-200">·</span>
                    )}
                  </td>
                )
              })}
              <td className="border-b border-l border-slate-100 px-2 py-1 text-center font-medium text-slate-600">
                {result.staffLoad[st.id] ?? 0}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {editing && (
        <CellEditor
          data={data}
          staffId={editing.staffId}
          date={editing.date}
          current={cellOf(editing.staffId, editing.date)}
          onClose={() => setEditing(null)}
          onSet={setCell}
        />
      )}
    </div>
  )
}

function CellEditor({
  data,
  staffId,
  date,
  current,
  onClose,
  onSet,
}: {
  data: AppData
  staffId: string
  date: string
  current: Assignment | undefined
  onClose: () => void
  onSet: (staffId: string, date: string, shiftId: string | null, roleId: string | null) => void
}) {
  const staff = data.staff.find((s) => s.id === staffId)!
  const staffRoles = data.roles.filter((r) => staff.roleIds.includes(r.id))
  const [roleId, setRoleId] = useState(current?.roleId ?? staffRoles[0]?.id ?? '')
  const [shiftId, setShiftId] = useState(current?.shiftId ?? data.shifts[0]?.id ?? '')

  return (
    <div
      className="no-print fixed inset-0 z-20 flex items-center justify-center bg-black/30 p-4"
      onClick={onClose}
    >
      <div className="w-full max-w-xs rounded-lg bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 text-sm font-bold text-slate-700">
          {staff.name} / {parse(date).getMonth() + 1}月{parse(date).getDate()}日
        </h3>
        {staffRoles.length === 0 ? (
          <p className="text-sm text-red-500">このスタッフは役割が未設定です。</p>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="label">役割</label>
              <select className="input" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
                {staffRoles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">時間帯</label>
              <select className="input" value={shiftId} onChange={(e) => setShiftId(e.target.value)}>
                {data.shifts.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}（{s.start}〜{s.end}）
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
        <div className="mt-4 flex justify-between gap-2">
          <button className="btn-danger" onClick={() => onSet(staffId, date, null, null)}>
            割り当て解除
          </button>
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={onClose}>
              閉じる
            </button>
            <button
              className="btn-primary"
              disabled={!roleId || !shiftId}
              onClick={() => onSet(staffId, date, shiftId, roleId)}
            >
              設定
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
