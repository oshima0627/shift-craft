import { useState } from 'react'
import type { AppData, Assignment, ScheduleResult } from '../types'
import { dayCategoryOf, enumerateDates, isRestDay, parse, weekdayLabel } from '../utils/date'
import { busynessOf } from '../utils/busyness'

interface Props {
  data: AppData
  result: ScheduleResult
  onChange: (assignments: Assignment[]) => void
}

/**
 * シフト表。縦軸=従業員、横軸=日にちの1枚の表。
 * 横に長い場合は表内で横スクロールする（スタッフ名列は固定）。
 * 各セルをクリックして手動調整でき、分割勤務（同日複数シフト）も表示・編集できる。
 */
export default function ScheduleGrid({ data, result, onChange }: Props) {
  const dates = enumerateDates(data.period)
  const roleById = new Map(data.roles.map((r) => [r.id, r]))
  const shiftById = new Map(data.shifts.map((s) => [s.id, s]))
  const [editing, setEditing] = useState<{ staffId: string; date: string } | null>(null)

  const closedSet = new Set(data.constraints.closedWeekdays ?? [])
  const isClosed = (date: string) => closedSet.has(new Date(date + 'T00:00:00').getDay())

  const cellsOf = (staffId: string, date: string): Assignment[] =>
    result.assignments.filter((a) => a.staffId === staffId && a.date === date)

  const setCells = (staffId: string, date: string, next: Assignment[]) => {
    const others = result.assignments.filter((a) => !(a.staffId === staffId && a.date === date))
    onChange([...others, ...next])
  }

  return (
    <div className="card overflow-x-auto p-2 sm:p-3">
      <table className="border-collapse text-sm">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 border-b border-slate-200 bg-white px-2 py-1 text-left">
              スタッフ
            </th>
            {dates.map((date) => {
              const rest = isRestDay(date)
              const cat = dayCategoryOf(date)
              const closed = isClosed(date)
              return (
                <th
                  key={date}
                  className={`border-b border-slate-200 px-1 py-1 text-center font-semibold ${
                    closed
                      ? 'text-slate-400'
                      : cat === 'holiday' || cat === 'sunday'
                        ? 'text-red-500'
                        : cat === 'saturday'
                          ? 'text-blue-500'
                          : 'text-slate-500'
                  } ${closed ? 'bg-slate-100' : rest ? 'bg-slate-50' : ''}`}
                >
                  <div>{parse(date).getDate()}</div>
                  <div className="text-[10px] font-normal">{closed ? '休業' : weekdayLabel(date)}</div>
                </th>
              )
            })}
            <th className="border-b border-slate-200 px-2 py-1 text-center">計</th>
          </tr>
          {/* 忙しさの色 */}
          <tr>
            <th className="sticky left-0 z-10 bg-white px-2 py-0.5 text-right text-[10px] font-normal text-slate-400">
              忙しさ
            </th>
            {dates.map((date) => {
              const level = busynessOf(data, date)
              return (
                <th key={date} className="p-0">
                  <div className="h-1.5 w-full" style={{ backgroundColor: level?.color }} title={level?.name} />
                </th>
              )
            })}
            <th />
          </tr>
        </thead>
        <tbody>
          {data.staff.map((st) => (
            <tr key={st.id} className="hover:bg-slate-50/50">
              <td className="sticky left-0 z-10 whitespace-nowrap border-b border-slate-100 bg-white px-2 py-1 text-base font-semibold">
                {st.name}
                {st.level === 0 && <span className="ml-1 text-[11px] text-amber-500">新</span>}
              </td>
              {dates.map((date) => {
                const cells = cellsOf(st.id, date)
                const leave = st.leaves.find((l) => l.date === date)
                const leaveName = leave
                  ? data.leaveTypes.find((t) => t.id === leave.typeId)?.name
                  : undefined
                const unavailable = !!leave
                const rest = isRestDay(date)
                const closed = isClosed(date)
                return (
                  <td
                    key={date}
                    onClick={() => setEditing({ staffId: st.id, date })}
                    className={`h-10 min-w-[2.75rem] cursor-pointer border-b border-l border-slate-100 p-0.5 text-center align-middle ${
                      closed ? 'bg-slate-100' : rest ? 'bg-slate-50/60' : ''
                    } ${unavailable && cells.length === 0 ? 'bg-red-50' : ''} hover:ring-2 hover:ring-brand-400`}
                    title={
                      cells.length > 0
                        ? cells
                            .map(
                              (a) =>
                                `${roleById.get(a.roleId)?.name ?? ''} / ${shiftById.get(a.shiftId)?.name ?? ''}`,
                            )
                            .join('、')
                        : unavailable
                          ? `休み（${leaveName ?? ''}）`
                          : 'クリックで割り当て'
                    }
                  >
                    {cells.length > 0 ? (
                      <div className="flex flex-col items-stretch gap-0.5">
                        {cells.map((a, i) => {
                          const role = roleById.get(a.roleId)
                          const shift = shiftById.get(a.shiftId)
                          return (
                            <span
                              key={i}
                              className="w-full truncate rounded px-1 py-0.5 text-[11px] font-semibold text-white"
                              style={{ backgroundColor: role?.color ?? '#64748b' }}
                            >
                              {shift?.name ?? '○'}
                            </span>
                          )
                        })}
                      </div>
                    ) : unavailable ? (
                      <span className="text-[11px] font-semibold text-red-400">{leaveName ?? '休'}</span>
                    ) : (
                      <span className="text-slate-300">·</span>
                    )}
                  </td>
                )
              })}
              <td className="border-b border-l border-slate-100 px-2 py-1 text-center text-base font-bold text-slate-700">
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
          current={cellsOf(editing.staffId, editing.date)}
          onClose={() => setEditing(null)}
          onSave={(next) => {
            setCells(editing.staffId, editing.date, next)
            setEditing(null)
          }}
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
  onSave,
}: {
  data: AppData
  staffId: string
  date: string
  current: Assignment[]
  onClose: () => void
  onSave: (next: Assignment[]) => void
}) {
  const staff = data.staff.find((s) => s.id === staffId)!
  const staffRoles = data.roles.filter((r) => staff.roleIds.includes(r.id))
  const [rows, setRows] = useState<{ roleId: string; shiftId: string }[]>(
    current.map((a) => ({ roleId: a.roleId, shiftId: a.shiftId })),
  )

  const addRow = () =>
    setRows([...rows, { roleId: staffRoles[0]?.id ?? '', shiftId: data.shifts[0]?.id ?? '' }])
  const removeRow = (i: number) => setRows(rows.filter((_, idx) => idx !== i))
  const patchRow = (i: number, patch: Partial<{ roleId: string; shiftId: string }>) =>
    setRows(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))

  const save = () => {
    const next: Assignment[] = rows
      .filter((r) => r.roleId && r.shiftId)
      .map((r) => ({ staffId, date, roleId: r.roleId, shiftId: r.shiftId }))
    onSave(next)
  }

  return (
    <div
      className="no-print fixed inset-0 z-20 flex items-center justify-center bg-black/30 p-4"
      onClick={onClose}
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-1 text-lg font-bold text-slate-800">
          {staff.name} / {parse(date).getMonth() + 1}月{parse(date).getDate()}日
        </h3>
        <p className="mb-4 text-sm text-slate-400">
          複数追加すると同じ日に分割勤務（早番＋遅番など）を割り当てられます。
        </p>
        {staffRoles.length === 0 ? (
          <p className="text-base text-red-500">このスタッフは役割が未設定です。</p>
        ) : (
          <div className="space-y-2">
            {rows.length === 0 && <p className="text-base text-slate-400">割り当てなし（休み）。</p>}
            {rows.map((row, i) => (
              <div key={i} className="flex items-center gap-2">
                <select
                  className="input flex-1"
                  value={row.roleId}
                  onChange={(e) => patchRow(i, { roleId: e.target.value })}
                >
                  {staffRoles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
                <select
                  className="input flex-1"
                  value={row.shiftId}
                  onChange={(e) => patchRow(i, { shiftId: e.target.value })}
                >
                  {data.shifts.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}（{s.start}〜{s.end}）
                    </option>
                  ))}
                </select>
                <button
                  className="text-slate-400 hover:text-red-600"
                  onClick={() => removeRow(i)}
                  title="この割り当てを削除"
                >
                  ×
                </button>
              </div>
            ))}
            <button className="btn-ghost text-sm" onClick={addRow}>
              ＋ シフトを追加
            </button>
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>
            キャンセル
          </button>
          <button className="btn-primary" onClick={save}>
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
