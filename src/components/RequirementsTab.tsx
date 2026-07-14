import { useStore } from '../state/store'
import {
  DAY_CATEGORY_LABELS,
  DAY_CATEGORY_ORDER,
  type DayCategory,
  type Requirement,
} from '../types'

const EMPTY_COUNTS: Requirement['counts'] = {
  weekday: 0,
  saturday: 0,
  sunday: 0,
  holiday: 0,
}

export default function RequirementsTab() {
  const roles = useStore((s) => s.data.roles)
  const shifts = useStore((s) => s.data.shifts)
  const requirements = useStore((s) => s.data.requirements)
  const setRequirement = useStore((s) => s.setRequirement)

  const getCounts = (roleId: string, shiftId: string): Requirement['counts'] => {
    const req = requirements.find((r) => r.roleId === roleId && r.shiftId === shiftId)
    return req ? req.counts : EMPTY_COUNTS
  }

  const setCount = (
    roleId: string,
    shiftId: string,
    cat: DayCategory,
    value: number,
  ) => {
    const counts = { ...getCounts(roleId, shiftId), [cat]: Math.max(0, value) }
    setRequirement(roleId, shiftId, counts)
  }

  if (roles.length === 0 || shifts.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        先に「役割」と「時間帯」を登録してください。
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <h2 className="text-base font-bold text-slate-700">必要人数</h2>
      <p className="text-sm text-slate-500">
        役割 × 時間帯ごとに、曜日区分（平日 / 土 / 日 / 祝）別の必要人数を設定します。
      </p>

      <div className="space-y-5">
        {shifts.map((shift) => (
          <div key={shift.id} className="card">
            <h3 className="mb-3 text-sm font-bold text-slate-700">
              🕒 {shift.name}
              <span className="ml-2 text-xs font-normal text-slate-400">
                {shift.start}〜{shift.end}
              </span>
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[28rem] text-sm">
                <thead>
                  <tr className="text-slate-500">
                    <th className="pb-2 text-left font-medium">役割</th>
                    {DAY_CATEGORY_ORDER.map((cat) => (
                      <th key={cat} className="pb-2 text-center font-medium">
                        {DAY_CATEGORY_LABELS[cat]}
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
                        {DAY_CATEGORY_ORDER.map((cat) => (
                          <td key={cat} className="py-2 text-center">
                            <input
                              type="number"
                              min={0}
                              className="input w-16 text-center"
                              value={counts[cat]}
                              onChange={(e) =>
                                setCount(role.id, shift.id, cat, Number(e.target.value))
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
    </div>
  )
}
