import { useMemo } from 'react'
import { useStore } from '../state/store'
import { dayCategoryOf, enumerateDates, parse, weekdayLabel } from '../utils/date'
import { busynessOf } from '../utils/busyness'

/**
 * 希望休カレンダー。
 * スタッフ（行）× 対象期間の日付（列）のマス目で、
 * クリックすると各スタッフの希望休（出勤不可日）を登録／解除できる。
 * 日ごとの希望休人数を最下段に表示し、休み希望が集中する日を可視化する。
 */
export default function DayOffCalendar() {
  const staff = useStore((s) => s.data.staff)
  const period = useStore((s) => s.data.period)
  const data = useStore((s) => s.data)
  const toggleUnavailable = useStore((s) => s.toggleUnavailable)

  const dates = useMemo(() => enumerateDates(period), [period])

  // date -> 希望休の人数
  const offCountByDate = useMemo(() => {
    const m = new Map<string, number>()
    for (const d of dates) m.set(d, 0)
    for (const st of staff) {
      for (const d of st.unavailableDates) {
        if (m.has(d)) m.set(d, (m.get(d) ?? 0) + 1)
      }
    }
    return m
  }, [staff, dates])

  const catClass = (date: string) => {
    const cat = dayCategoryOf(date, period.holidays)
    if (cat === 'holiday' || cat === 'sunday') return 'text-red-500'
    if (cat === 'saturday') return 'text-blue-500'
    return 'text-slate-500'
  }

  if (dates.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        期間が正しく設定されていません。「期間」タブで開始日 ≤ 終了日 を設定してください。
      </p>
    )
  }
  if (staff.length === 0) {
    return <p className="text-sm text-slate-500">先に「スタッフ」を登録してください。</p>
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-bold text-slate-700">希望休カレンダー</h2>
        <p className="text-sm text-slate-500">
          マスをクリックして各スタッフの希望休を登録します（もう一度クリックで解除）。
          期間: {period.start} 〜 {period.end}（{dates.length}日）。最下段に日別の希望休人数を表示します。
        </p>
      </div>

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
                    <div
                      className="h-2 w-full"
                      style={{ backgroundColor: level?.color }}
                      title={level?.name}
                    />
                  </th>
                )
              })}
              <th />
            </tr>
          </thead>
          <tbody>
            {staff.map((st) => {
              const offSet = new Set(st.unavailableDates)
              return (
                <tr key={st.id}>
                  <td className="border-b border-slate-100 px-1 py-1 font-medium text-slate-700 whitespace-nowrap text-xs">
                    {st.name}
                  </td>
                  {dates.map((date) => {
                    const off = offSet.has(date)
                    const rest = dayCategoryOf(date, period.holidays) !== 'weekday'
                    return (
                      <td
                        key={date}
                        className={`border-b border-l border-slate-100 p-0 ${rest ? 'bg-slate-50' : ''}`}
                      >
                        <button
                          onClick={() => toggleUnavailable(st.id, date)}
                          title={`${st.name} / ${parse(date).getMonth() + 1}/${parse(date).getDate()}`}
                          className={`flex aspect-square w-full items-center justify-center text-xs transition-colors ${
                            off
                              ? 'bg-red-500 font-bold text-white hover:bg-red-600'
                              : 'text-slate-300 hover:bg-brand-50'
                          }`}
                        >
                          {off ? '休' : '・'}
                        </button>
                      </td>
                    )
                  })}
                  <td className="border-b border-l border-slate-100 py-1 text-center text-slate-600 text-xs">
                    {st.unavailableDates.filter((d) => offSet.has(d) && dates.includes(d)).length}
                  </td>
                </tr>
              )
            })}
            {/* 日別の希望休人数 */}
            <tr className="bg-slate-50 font-medium">
              <td className="bg-slate-50 px-1 py-1 text-slate-600 whitespace-nowrap text-xs">
                希望休人数
              </td>
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
                {staff.reduce((acc, st) => acc + st.unavailableDates.filter((d) => dates.includes(d)).length, 0)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1">
          <span className="inline-block h-4 w-4 rounded bg-red-500" /> 希望休
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-4 w-4 rounded bg-amber-100" /> 休み希望が1/3以上の日
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-4 w-4 rounded bg-red-100" /> 休み希望が半数以上の日（要注意）
        </span>
      </div>
    </div>
  )
}
