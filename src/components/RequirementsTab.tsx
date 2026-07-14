import { useState } from 'react'
import { useStore } from '../state/store'
import type { Requirement } from '../types'
import { displayDate } from '../utils/date'

export default function RequirementsTab() {
  const roles = useStore((s) => s.data.roles)
  const shifts = useStore((s) => s.data.shifts)
  const levels = useStore((s) => s.data.busynessLevels)
  const requirements = useStore((s) => s.data.requirements)
  const setRequirement = useStore((s) => s.setRequirement)

  const getCounts = (roleId: string, shiftId: string): Requirement['counts'] => {
    const req = requirements.find((r) => r.roleId === roleId && r.shiftId === shiftId)
    return req ? req.counts : {}
  }

  const setCount = (roleId: string, shiftId: string, levelId: string, value: number) => {
    const counts = { ...getCounts(roleId, shiftId), [levelId]: Math.max(0, value) }
    setRequirement(roleId, shiftId, counts)
  }

  if (roles.length === 0 || shifts.length === 0) {
    return (
      <p className="text-base text-slate-500">先に「役割」と「時間帯」を登録してください。</p>
    )
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="page-title">必要人数</h2>
        <p className="page-desc">
          役割 × 時間帯ごとに、<b>忙しさ段階</b>別の必要人数を設定します。各日の忙しさは「忙しさ」タブで設定します。
        </p>
      </div>

      <div className="space-y-5">
        {shifts.map((shift) => (
          <div key={shift.id} className="card">
            <h3 className="mb-3 section-title">
              🕒 {shift.name}
              <span className="ml-2 text-sm font-normal text-slate-400">
                {shift.start}〜{shift.end}
              </span>
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[28rem] text-sm">
                <thead>
                  <tr className="text-slate-500">
                    <th className="pb-2 text-left font-medium">役割</th>
                    {levels.map((l) => (
                      <th key={l.id} className="pb-2 text-center font-medium">
                        <span
                          className="inline-block rounded-md px-2.5 py-1 text-sm text-white"
                          style={{ backgroundColor: l.color }}
                        >
                          {l.name}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {roles.map((role) => {
                    const counts = getCounts(role.id, shift.id)
                    return (
                      <tr key={role.id} className="border-t border-slate-100">
                        <td className="py-2">
                          <span
                            className="chip text-white"
                            style={{ backgroundColor: role.color }}
                          >
                            {role.name}
                          </span>
                        </td>
                        {levels.map((l) => (
                          <td key={l.id} className="py-2 text-center">
                            <input
                              type="number"
                              min={0}
                              className="input w-16 text-center"
                              value={counts[l.id] ?? 0}
                              onChange={(e) =>
                                setCount(role.id, shift.id, l.id, Number(e.target.value))
                              }
                            />
                          </td>
                        ))}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>

      <OverridesCard />
    </div>
  )
}

/** 特定日の必要人数の上書き（「この日は◯人」） */
function OverridesCard() {
  const roles = useStore((s) => s.data.roles)
  const shifts = useStore((s) => s.data.shifts)
  const overrides = useStore((s) => s.data.overrides)
  const setOverride = useStore((s) => s.setOverride)
  const removeOverride = useStore((s) => s.removeOverride)
  const [date, setDate] = useState('')
  const [roleId, setRoleId] = useState('')
  const [shiftId, setShiftId] = useState('')
  const [count, setCount] = useState(2)

  const add = () => {
    if (!date || !roleId || !shiftId) return
    setOverride({ date, roleId, shiftId, count: Math.max(0, count) })
    setDate('')
  }

  const nameOf = (id: string, list: { id: string; name: string }[]) =>
    list.find((x) => x.id === id)?.name ?? '(不明)'

  return (
    <div className="card space-y-3">
      <div className="space-y-1">
        <h3 className="section-title">📌 特定日の人数上書き</h3>
        <p className="section-desc">
          イベント日など「この日は◯人」を指定できます。忙しさ段階の設定より優先されます（0人で「この日はこの枠なし」も可）。
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="date"
          className="input max-w-[11rem]"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <select className="input max-w-[9rem]" value={shiftId} onChange={(e) => setShiftId(e.target.value)}>
          <option value="">時間帯</option>
          {shifts.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select className="input max-w-[9rem]" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
          <option value="">役割</option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <input
          type="number"
          min={0}
          className="input w-16 text-center"
          value={count}
          onChange={(e) => setCount(Number(e.target.value))}
        />
        <span className="text-sm text-slate-500">名</span>
        <button className="btn-primary" onClick={add}>
          追加
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {overrides.map((o) => (
          <span key={`${o.date}|${o.roleId}|${o.shiftId}`} className="chip bg-indigo-50 text-indigo-700">
            {displayDate(o.date)} {nameOf(o.shiftId, shifts)} / {nameOf(o.roleId, roles)} = {o.count}名
            <button
              className="ml-1 text-indigo-300 hover:text-red-600"
              onClick={() => removeOverride(o)}
            >
              ×
            </button>
          </span>
        ))}
        {overrides.length === 0 && <span className="text-sm text-slate-400">上書きはありません。</span>}
      </div>
    </div>
  )
}
