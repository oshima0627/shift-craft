import { useState } from 'react'
import { getDay } from 'date-fns'
import type { AppData, Assignment, ScheduleResult } from '../types'
import { dayCategoryOf, enumerateDates, parse } from '../utils/date'
import { weekKeyOf } from '../utils/time'

interface Props {
  data: AppData
  result: ScheduleResult
  onChange: (assignments: Assignment[]) => void
}

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']

/**
 * スタッフ×日付のシフト表。横スクロールを避けるため「週ごと」に縦積みで表示する。
 * 各セルをクリックして手動調整でき、分割勤務（同日複数シフト）も表示・編集できる。
 */
export default function ScheduleGrid({ data, result, onChange }: Props) {
  const dates = enumerateDates(data.period)
  const roleById = new Map(data.roles.map((r) => [r.id, r]))
  const shiftById = new Map(data.shifts.map((s) => [s.id, s]))
  const [editing, setEditing] = useState<{ staffId: string; date: string } | null>(null)

  const cellsOf = (staffId: string, date: string): Assignment[] =>
    result.assignments.filter((a) => a.staffId === staffId && a.date === date)

  const setCells = (staffId: string, date: string, next: Assignment[]) => {
    const others = result.assignments.filter((a) => !(a.staffId === staffId && a.date === date))
    onChange([...others, ...next])
  }

  // 週（日曜起算）ごとに、日〜土の7列へ日付を配置する
  const weekMap = new Map<string, (string | null)[]>()
  for (const date of dates) {
    const wk = weekKeyOf(date)
    if (!weekMap.has(wk)) weekMap.set(wk, [null, null, null, null, null, null, null])
    weekMap.get(wk)![getDay(parse(date))] = date
  }
  const weeks = [...weekMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))

  return (
    <div className="space-y-4">
      {weeks.map(([wk, days]) => (
        <div key={wk} className="card">
          <table className="w-full table-fixed border-collapse text-base">
            <colgroup>
              <col className="w-[8rem]" />
              {days.map((_, i) => (
                <col key={i} />
              ))}
              <col className="w-[3rem]" />
            </colgroup>
            <thead>
              <tr>
                <th className="border-b border-slate-200 px-2 py-1.5 text-left text-sm text-slate-500">
                  スタッフ
                </th>
                {days.map((date, i) => {
                  const cat = date ? dayCategoryOf(date, data.period.holidays) : 'weekday'
                  const color =
                    i === 0 || cat === 'holiday' || cat === 'sunday'
                      ? 'text-red-500'
                      : i === 6 || cat === 'saturday'
                        ? 'text-blue-500'
                        : 'text-slate-500'
                  return (
                    <th
                      key={i}
                      className={`border-b border-l border-slate-200 px-1 py-1.5 text-center font-semibold ${color} ${date ? '' : 'bg-slate-50/50'}`}
                    >
                      <div className="text-sm">{date ? parse(date).getDate() : ''}</div>
                      <div className="text-xs font-normal">{WEEKDAY_LABELS[i]}</div>
                    </th>
                  )
                })}
                <th className="border-b border-l border-slate-200 px-1 py-1.5 text-center text-sm text-slate-500">
                  計
                </th>
              </tr>
            </thead>
            <tbody>
              {data.staff.map((st) => {
                let weekTotal = 0
                const rowCells = days.map((date, i) => {
                  if (!date) {
                    return (
                      <td key={i} className="border-b border-l border-slate-100 bg-slate-50/40" />
                    )
                  }
                  const cells = cellsOf(st.id, date)
                  weekTotal += cells.length
                  const unavailable = st.unavailableDates.includes(date)
                  const rest = dayCategoryOf(date, data.period.holidays) !== 'weekday'
                  return (
                    <td
                      key={i}
                      onClick={() => setEditing({ staffId: st.id, date })}
                      className={`h-14 cursor-pointer border-b border-l border-slate-100 p-1 text-center align-middle ${
                        rest ? 'bg-slate-50/60' : ''
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
                            ? '希望休'
                            : 'クリックで割り当て'
                      }
                    >
                      {cells.length > 0 ? (
                        <div className="flex flex-col items-stretch gap-0.5">
                          {cells.map((a, idx) => {
                            const role = roleById.get(a.roleId)
                            const shift = shiftById.get(a.shiftId)
                            return (
                              <span
                                key={idx}
                                className="w-full truncate rounded px-1 py-0.5 text-xs font-semibold text-white"
                                style={{ backgroundColor: role?.color ?? '#64748b' }}
                              >
                                {shift?.name ?? '○'}
                              </span>
                            )
                          })}
                        </div>
                      ) : unavailable ? (
                        <span className="text-sm text-red-300">×</span>
                      ) : (
                        <span className="text-slate-200">·</span>
                      )}
                    </td>
                  )
                })
                return (
                  <tr key={st.id} className="hover:bg-slate-50/50">
                    <td className="border-b border-slate-100 px-2 py-1 font-medium">
                      {st.name}
                      {st.level === 0 && <span className="ml-1 text-xs text-amber-500">新</span>}
                    </td>
                    {rowCells}
                    <td className="border-b border-l border-slate-100 px-1 py-1 text-center font-semibold text-slate-600">
                      {weekTotal}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ))}

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
      <div className="w-full max-w-md rounded-lg bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-1 text-sm font-bold text-slate-700">
          {staff.name} / {parse(date).getMonth() + 1}月{parse(date).getDate()}日
        </h3>
        <p className="mb-3 text-xs text-slate-400">
          複数追加すると同じ日に分割勤務（早番＋遅番など）を割り当てられます。
        </p>
        {staffRoles.length === 0 ? (
          <p className="text-sm text-red-500">このスタッフは役割が未設定です。</p>
        ) : (
          <div className="space-y-2">
            {rows.length === 0 && <p className="text-sm text-slate-400">割り当てなし（休み）。</p>}
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
