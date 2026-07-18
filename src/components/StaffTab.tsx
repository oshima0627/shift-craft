import { useState } from 'react'
import { useStore } from '../state/store'
import { EXPERIENCE_LABELS, type ExperienceLevel, type Staff } from '../types'

export default function StaffTab() {
  const staff = useStore((s) => s.data.staff)
  const addStaff = useStore((s) => s.addStaff)
  const [name, setName] = useState('')

  const handleAdd = () => {
    if (!name.trim()) return
    addStaff(name.trim())
    setName('')
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="page-title">スタッフ</h2>
        <p className="page-desc">
          各スタッフの担当役割・経験レベル・出勤上限・連勤上限・出勤不可日などを設定します。
        </p>
      </div>

      <div className="card flex flex-col gap-2 sm:flex-row">
        <input
          className="input flex-1"
          placeholder="スタッフ名を入力"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
        />
        <button className="btn-primary" onClick={handleAdd}>
          追加
        </button>
      </div>

      <div className="space-y-2">
        {staff.map((st) => (
          <StaffRow key={st.id} staff={st} />
        ))}
        {staff.length === 0 && (
          <p className="text-base text-slate-400">スタッフがいません。追加してください。</p>
        )}
      </div>
    </div>
  )
}

function StaffRow({ staff }: { staff: Staff }) {
  const roles = useStore((s) => s.data.roles)
  const shifts = useStore((s) => s.data.shifts)
  const updateStaff = useStore((s) => s.updateStaff)
  const removeStaff = useStore((s) => s.removeStaff)
  const [open, setOpen] = useState(false)

  const toggleRole = (roleId: string) => {
    const has = staff.roleIds.includes(roleId)
    updateStaff(staff.id, {
      roleIds: has ? staff.roleIds.filter((r) => r !== roleId) : [...staff.roleIds, roleId],
    })
  }

  const toggleShift = (shiftId: string) => {
    const has = staff.allowedShiftIds.includes(shiftId)
    updateStaff(staff.id, {
      allowedShiftIds: has
        ? staff.allowedShiftIds.filter((s) => s !== shiftId)
        : [...staff.allowedShiftIds, shiftId],
    })
  }


  const levelColor =
    staff.level === 0 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'

  return (
    <div className="card space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
        <input
          className="input w-full font-semibold sm:max-w-[11rem]"
          value={staff.name}
          onChange={(e) => updateStaff(staff.id, { name: e.target.value })}
        />
        {/* 経験区分・役割チップ（スマホでは名前の下の行にまとめて折り返し） */}
        <div className="flex flex-wrap items-center gap-2 sm:flex-1">
          <span className={`chip ${levelColor}`}>{EXPERIENCE_LABELS[staff.level]}</span>
          {staff.isMinor && (
            <span className="chip bg-purple-100 text-purple-700">18歳未満</span>
          )}
          {staff.roleIds.map((rid) => {
            const role = roles.find((r) => r.id === rid)
            if (!role) return null
            return (
              <span
                key={rid}
                className="chip text-white"
                style={{ backgroundColor: role.color }}
              >
                {role.name}
              </span>
            )
          })}
          {staff.roleIds.length === 0 && (
            <span className="text-xs text-red-500">役割未設定</span>
          )}
        </div>
        {/* 操作ボタン（スマホでは最下段に横並び） */}
        <div className="flex gap-2">
          <button className="btn-ghost btn-sm" onClick={() => setOpen(!open)}>
            {open ? '閉じる' : '詳細'}
          </button>
          <button
            className="btn-danger btn-sm"
            onClick={() => {
              if (confirm(`スタッフ「${staff.name}」を削除しますか？`)) removeStaff(staff.id)
            }}
          >
            削除
          </button>
        </div>
      </div>

      {open && (
        <div className="grid grid-cols-1 gap-4 border-t border-slate-100 pt-3 sm:grid-cols-2">
          <div>
            <label className="label">担当できる役割</label>
            <div className="flex flex-wrap gap-1.5">
              {roles.map((role) => {
                const on = staff.roleIds.includes(role.id)
                return (
                  <button
                    key={role.id}
                    onClick={() => toggleRole(role.id)}
                    className={`chip border ${on ? 'text-white' : 'text-slate-500'}`}
                    style={on ? { backgroundColor: role.color, borderColor: role.color } : {}}
                  >
                    {role.name}
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <label className="label">経験レベル</label>
            <select
              className="input"
              value={staff.level}
              onChange={(e) =>
                updateStaff(staff.id, { level: Number(e.target.value) as ExperienceLevel })
              }
            >
              <option value={0}>新人（経験者にカウントしない）</option>
              <option value={1}>一般</option>
              <option value={2}>ベテラン</option>
            </select>
          </div>

          <div className="flex items-end pb-1">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                className="h-4 w-4 accent-brand-500"
                checked={staff.isMinor}
                onChange={(e) => updateStaff(staff.id, { isMinor: e.target.checked })}
              />
              18歳未満（高校生等）
              <span className="text-xs text-slate-400">
                — 22時以降のシフトに入りません（労基法61条）
              </span>
            </label>
          </div>

          <div>
            <label className="label">週の労働時間上限（時間・空欄=法定に従う）</label>
            <input
              type="number"
              min={1}
              className="input"
              value={staff.weeklyMaxHours ?? ''}
              onChange={(e) =>
                updateStaff(staff.id, {
                  weeklyMaxHours: e.target.value === '' ? null : Number(e.target.value),
                })
              }
              placeholder="例: 扶養内なら20など"
            />
          </div>

          <div>
            <label className="label">週の出勤日数上限（空欄=法定の週6日まで）</label>
            <input
              type="number"
              min={1}
              max={6}
              className="input"
              value={staff.weeklyMaxDays ?? ''}
              onChange={(e) =>
                updateStaff(staff.id, {
                  weeklyMaxDays: e.target.value === '' ? null : Number(e.target.value),
                })
              }
            />
          </div>

          <div>
            <label className="label">出勤上限（期間内の最大日数・空欄=無制限）</label>
            <input
              type="number"
              min={0}
              className="input"
              value={staff.maxShifts ?? ''}
              onChange={(e) =>
                updateStaff(staff.id, {
                  maxShifts: e.target.value === '' ? null : Number(e.target.value),
                })
              }
            />
          </div>

          <div>
            <label className="label">連勤上限（連続出勤日数・空欄=無制限）</label>
            <input
              type="number"
              min={1}
              className="input"
              value={staff.maxConsecutive ?? ''}
              onChange={(e) =>
                updateStaff(staff.id, {
                  maxConsecutive: e.target.value === '' ? null : Number(e.target.value),
                })
              }
            />
          </div>

          <div className="sm:col-span-2">
            <label className="label">
              割り当て可能なシフト時間帯（未選択=すべて可 / 選択=その時間帯を希望・限定）
            </label>
            <div className="flex flex-wrap gap-1.5">
              {shifts.map((shift) => {
                const on = staff.allowedShiftIds.includes(shift.id)
                return (
                  <button
                    key={shift.id}
                    onClick={() => toggleShift(shift.id)}
                    className={`chip border ${
                      on ? 'border-brand-500 bg-brand-500 text-white' : 'border-slate-300 text-slate-500'
                    }`}
                  >
                    {shift.name}（{shift.start}〜{shift.end}）
                  </button>
                )
              })}
            </div>
          </div>

          <div className="sm:col-span-2">
            <label className="label">休み（全休・時間休）</label>
            <p className="text-xs text-slate-500">
              休みは「休み」タブのカレンダーで登録します（全休・午前休・午後休など）。
              現在の登録数: {staff.leaves.length}件
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
