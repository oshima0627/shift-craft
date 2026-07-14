import { useMemo } from 'react'
import { useStore } from '../state/store'
import { dayCategoryOf, enumerateDates, parse, weekdayLabel } from '../utils/date'
import { busynessOf } from '../utils/busyness'

/**
 * 希望休カレンダー（全休・時間休対応）。
 * スタッフ（行）× 日付（列）のマスをクリックすると、休みの種類が順に切り替わる
 * （なし → 全休 → 午前休 → 午後休 → … → なし）。
 * 時間休はその時間帯に重なるシフトにだけ入れなくなる。
 * 休みの種類は可変（追加・削除・改名・時間変更）。
 */
export default function DayOffCalendar() {
  const staff = useStore((s) => s.data.staff)
  const period = useStore((s) => s.data.period)
  const leaveTypes = useStore((s) => s.data.leaveTypes)
  const data = useStore((s) => s.data)
  const setStaffLeave = useStore((s) => s.setStaffLeave)
  const addLeaveType = useStore((s) => s.addLeaveType)
  const updateLeaveType = useStore((s) => s.updateLeaveType)
  const removeLeaveType = useStore((s) => s.removeLeaveType)

  const dates = useMemo(() => enumerateDates(period), [period])
  const typeById = new Map(leaveTypes.map((t) => [t.id, t]))

  // date -> 休み人数
  const offCountByDate = useMemo(() => {
    const m = new Map<string, number>()
    for (const d of dates) m.set(d, 0)
    for (const st of staff) {
      for (const lv of st.leaves) {
        if (m.has(lv.date)) m.set(lv.date, (m.get(lv.date) ?? 0) + 1)
      }
    }
    return m
  }, [staff, dates])

  // クリックで次の休み種類へ（なし → 各種類 → なし）
  const order: (string | null)[] = [null, ...leaveTypes.map((t) => t.id)]
  const cycle = (staffId: string, date: string, curId: string | null) => {
    const idx = order.indexOf(curId ?? null)
    setStaffLeave(staffId, date, order[(idx + 1) % order.length])
  }

  const isFull = (t: { start: string; end: string }) => t.start === '00:00' && t.end === '24:00'
  const abbr = (name: string) => name.replace(/休$/, '').slice(0, 2) || name.slice(0, 2)

  const catClass = (date: string) => {
    const cat = dayCategoryOf(date)
    if (cat === 'holiday' || cat === 'sunday') return 'text-red-500'
    if (cat === 'saturday') return 'text-blue-500'
    return 'text-slate-500'
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-bold text-slate-700">希望休カレンダー</h2>
        <p className="text-sm text-slate-500">
          マスをクリックすると休みの種類が切り替わります（なし → {leaveTypes.map((t) => t.name).join(' → ')} → なし）。
          時間休はその時間帯に重なるシフトにだけ入れなくなります。期間: {period.start} 〜 {period.end}。
        </p>
      </div>

      {/* 休みの種類エディタ */}
      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-700">休みの種類（可変）</h3>
          <button className="btn-ghost text-sm" onClick={addLeaveType}>
            ＋ 時間休を追加
          </button>
        </div>
        <div className="space-y-2">
          {leaveTypes.map((t) => {
            const full = isFull(t)
            return (
              <div key={t.id} className="flex flex-wrap items-center gap-2">
                <input
                  className="input max-w-[9rem]"
                  value={t.name}
                  onChange={(e) => updateLeaveType(t.id, { name: e.target.value })}
                />
                {full ? (
                  <span className="text-xs text-slate-400">（終日）</span>
                ) : (
                  <div className="flex items-center gap-1 text-sm text-slate-500">
                    <input
                      type="time"
                      className="input"
                      value={t.start}
                      onChange={(e) => updateLeaveType(t.id, { start: e.target.value })}
                    />
                    <span>〜</span>
                    <input
                      type="time"
                      className="input"
                      value={t.end}
                      onChange={(e) => updateLeaveType(t.id, { end: e.target.value })}
                    />
                  </div>
                )}
                {leaveTypes.length > 1 && (
                  <button
                    className="text-slate-400 hover:text-red-600"
                    onClick={() => removeLeaveType(t.id)}
                    title="この休みの種類を削除"
                  >
                    削除
                  </button>
                )}
              </div>
            )
          })}
        </div>
        <p className="text-xs text-slate-400">
          例: 午前休 9:00〜15:00 / 午後休 17:00〜21:00。全休（終日）はすべてのシフトに掛かります。
        </p>
      </div>

      {dates.length === 0 || staff.length === 0 ? (
        <p className="text-sm text-slate-500">
          スタッフと対象期間（忙しさタブ）を設定すると、ここに希望休カレンダーが表示されます。
        </p>
      ) : (
        <div className="card">
          <table className="w-full table-fixed border-collapse text-sm">
            <colgroup>
              <col className="w-[5.5rem]" />
              {dates.map((d) => (
                <col key={d} />
              ))}
              <col className="w-[2.5rem]" />
            </colgroup>
            <thead>
              <tr>
                <th className="border-b border-slate-200 px-1 py-1 text-left text-xs">スタッフ</th>
                {dates.map((date) => (
                  <th
                    key={date}
                    className={`border-b border-slate-200 py-1 text-center font-medium ${catClass(date)}`}
                  >
                    <div className="text-xs">{parse(date).getDate()}</div>
                    <div className="text-[10px]">{weekdayLabel(date)}</div>
                  </th>
                ))}
                <th className="border-b border-slate-200 py-1 text-center text-xs">計</th>
              </tr>
              {/* 忙しさの色 */}
              <tr>
                <th className="px-1 py-0.5 text-right text-[10px] font-normal text-slate-400">忙しさ</th>
                {dates.map((date) => {
                  const level = busynessOf(data, date)
                  return (
                    <th key={date} className="p-0">
                      <div className="h-2 w-full" style={{ backgroundColor: level?.color }} title={level?.name} />
                    </th>
                  )
                })}
                <th />
              </tr>
            </thead>
            <tbody>
              {staff.map((st) => {
                const leaveByDate = new Map(st.leaves.map((l) => [l.date, l.typeId]))
                return (
                  <tr key={st.id}>
                    <td className="border-b border-slate-100 px-1 py-1 font-medium text-slate-700 whitespace-nowrap text-xs">
                      {st.name}
                    </td>
                    {dates.map((date) => {
                      const typeId = leaveByDate.get(date) ?? null
                      const t = typeId ? typeById.get(typeId) : undefined
                      const full = t ? isFull(t) : false
                      const rest = dayCategoryOf(date) !== 'weekday'
                      return (
                        <td
                          key={date}
                          className={`border-b border-l border-slate-100 p-0 ${rest ? 'bg-slate-50' : ''}`}
                        >
                          <button
                            onClick={() => cycle(st.id, date, typeId)}
                            title={
                              t
                                ? `${st.name} / ${t.name}${full ? '' : `（${t.start}〜${t.end}）`}`
                                : `${st.name} / ${parse(date).getMonth() + 1}/${parse(date).getDate()}`
                            }
                            className={`flex aspect-square w-full items-center justify-center text-[9px] font-bold transition-colors ${
                              t
                                ? full
                                  ? 'bg-red-500 text-white hover:bg-red-600'
                                  : 'bg-amber-400 text-white hover:bg-amber-500'
                                : 'text-slate-300 hover:bg-brand-50'
                            }`}
                          >
                            {t ? abbr(t.name) : '・'}
                          </button>
                        </td>
                      )
                    })}
                    <td className="border-b border-l border-slate-100 py-1 text-center text-slate-600 text-xs">
                      {st.leaves.filter((l) => dates.includes(l.date)).length}
                    </td>
                  </tr>
                )
              })}
              {/* 日別の休み人数 */}
              <tr className="bg-slate-50 font-medium">
                <td className="bg-slate-50 px-1 py-1 text-slate-600 whitespace-nowrap text-xs">休み人数</td>
                {dates.map((date) => {
                  const n = offCountByDate.get(date) ?? 0
                  const ratio = staff.length > 0 ? n / staff.length : 0
                  const tone =
                    n === 0
                      ? 'text-slate-300'
                      : ratio >= 0.5
                        ? 'bg-red-100 text-red-700'
                        : ratio >= 0.34
                          ? 'bg-amber-100 text-amber-700'
                          : 'text-slate-600'
                  return (
                    <td key={date} className={`border-l border-slate-200 py-1 text-center text-xs ${tone}`}>
                      {n || ''}
                    </td>
                  )
                })}
                <td className="border-l border-slate-200 py-1 text-center text-slate-500 text-xs">
                  {staff.reduce((acc, st) => acc + st.leaves.filter((l) => dates.includes(l.date)).length, 0)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1">
          <span className="inline-block h-4 w-4 rounded bg-red-500" /> 全休
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-4 w-4 rounded bg-amber-400" /> 時間休
        </span>
      </div>
    </div>
  )
}
