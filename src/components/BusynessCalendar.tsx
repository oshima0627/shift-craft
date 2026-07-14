import { useMemo } from 'react'
import { useStore } from '../state/store'
import { busynessIdOf } from '../utils/busyness'
import { fmt } from '../utils/date'

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']

/**
 * 忙しさカレンダー。
 * - 月を切り替えて対象期間を決める（期間タブの代わり）
 * - 各日をクリックして忙しさ段階を切り替える（段階ごとに色付け）
 * - 忙しさ段階は可変（追加・削除・改名・色変更）。既定は平日／土日祝で別々に指定
 * 必要人数はこの忙しさ段階ごとに設定する。
 */
export default function BusynessCalendar() {
  const period = useStore((s) => s.data.period)
  const levels = useStore((s) => s.data.busynessLevels)
  const weekdayDefault = useStore((s) => s.data.defaultBusynessLevelId)
  const weekendDefault = useStore((s) => s.data.weekendBusynessLevelId)
  const data = useStore((s) => s.data)
  const updatePeriod = useStore((s) => s.updatePeriod)
  const setDayBusyness = useStore((s) => s.setDayBusyness)
  const addBusynessLevel = useStore((s) => s.addBusynessLevel)
  const updateBusynessLevel = useStore((s) => s.updateBusynessLevel)
  const removeBusynessLevel = useStore((s) => s.removeBusynessLevel)
  const setDefaultBusynessLevel = useStore((s) => s.setDefaultBusynessLevel)
  const setWeekendBusynessLevel = useStore((s) => s.setWeekendBusynessLevel)
  const setWeekendsToLevel = useStore((s) => s.setWeekendsToLevel)

  const [year, month] = useMemo(() => {
    const [y, m] = period.start.split('-').map(Number)
    return [y, (m || 1) - 1]
  }, [period.start])

  const setMonth = (y: number, m: number) => {
    const start = new Date(y, m, 1)
    const end = new Date(y, m + 1, 0)
    updatePeriod({ start: fmt(start), end: fmt(end) })
  }
  const prevMonth = () => setMonth(month === 0 ? year - 1 : year, month === 0 ? 11 : month - 1)
  const nextMonth = () => setMonth(month === 11 ? year + 1 : year, month === 11 ? 0 : month + 1)

  const cells = useMemo(() => {
    const first = new Date(year, month, 1)
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const lead = first.getDay()
    const arr: (string | null)[] = []
    for (let i = 0; i < lead; i++) arr.push(null)
    for (let d = 1; d <= daysInMonth; d++) arr.push(fmt(new Date(year, month, d)))
    while (arr.length % 7 !== 0) arr.push(null)
    return arr
  }, [year, month])

  const levelById = new Map(levels.map((l) => [l.id, l]))

  const cycleDay = (date: string) => {
    const curId = busynessIdOf(data, date)
    const idx = levels.findIndex((l) => l.id === curId)
    const next = levels[(idx + 1) % levels.length]
    if (next) setDayBusyness(date, next.id)
  }

  const addHoliday = (d: string) => {
    if (d && !period.holidays.includes(d)) {
      updatePeriod({ holidays: [...period.holidays, d].sort() })
    }
  }
  const removeHoliday = (d: string) =>
    updatePeriod({ holidays: period.holidays.filter((x) => x !== d) })

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-bold text-slate-700">忙しさカレンダー</h2>
        <p className="text-sm text-slate-500">
          月を切り替えて対象期間を決め、各日の忙しさをクリックで設定します（クリックで次の段階へ）。
          必要人数は忙しさ段階ごとに設定します。
        </p>
      </div>

      {/* 忙しさ段階エディタ */}
      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-700">忙しさの段階（可変）</h3>
          <button className="btn-ghost text-sm" onClick={addBusynessLevel}>
            ＋ 段階を追加
          </button>
        </div>
        <div className="space-y-2">
          {levels.map((l) => (
            <div key={l.id} className="flex flex-wrap items-center gap-2">
              <input
                type="color"
                className="h-8 w-10 cursor-pointer rounded border border-slate-200"
                value={l.color}
                onChange={(e) => updateBusynessLevel(l.id, { color: e.target.value })}
              />
              <input
                className="input max-w-[10rem]"
                value={l.name}
                onChange={(e) => updateBusynessLevel(l.id, { name: e.target.value })}
              />
              {levels.length > 1 && (
                <button
                  className="text-slate-400 hover:text-red-600"
                  onClick={() => removeBusynessLevel(l.id)}
                  title="この段階を削除"
                >
                  削除
                </button>
              )}
            </div>
          ))}
        </div>

        {/* 曜日タイプ別の既定 */}
        <div className="grid gap-3 border-t border-slate-100 pt-3 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <span className="w-24">平日の既定</span>
            <select
              className="input"
              value={weekdayDefault}
              onChange={(e) => setDefaultBusynessLevel(e.target.value)}
            >
              {levels.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <span className="w-24">土日祝の既定</span>
            <select
              className="input"
              value={weekendDefault}
              onChange={(e) => setWeekendBusynessLevel(e.target.value)}
            >
              {levels.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-xs text-slate-400">
          個別に設定していない日は、平日／土日祝それぞれの既定が適用されます（初期値: 平日=普通・土日祝=忙しい）。
        </p>
      </div>

      {/* 月カレンダー */}
      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <button className="btn-ghost" onClick={prevMonth}>
            ◀ 前月
          </button>
          <div className="text-base font-bold text-slate-700">
            {year}年 {month + 1}月
          </div>
          <button className="btn-ghost" onClick={nextMonth}>
            翌月 ▶
          </button>
        </div>

        <div className="flex justify-end">
          <button
            className="btn-ghost text-xs"
            onClick={() => setWeekendsToLevel()}
            title="この月の土日祝をすべて『土日祝の既定』段階にします"
          >
            土日祝をすべて「{levelById.get(weekendDefault)?.name ?? '忙しい'}」にする
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1">
          {WEEKDAY_LABELS.map((w, i) => (
            <div
              key={w}
              className={`py-1 text-center text-xs font-semibold ${
                i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : 'text-slate-500'
              }`}
            >
              {w}
            </div>
          ))}
          {cells.map((date, i) => {
            if (!date) return <div key={i} />
            const day = Number(date.split('-')[2])
            const level = levelById.get(busynessIdOf(data, date))
            const isHoliday = period.holidays.includes(date)
            return (
              <button
                key={date}
                onClick={() => cycleDay(date)}
                className="flex h-20 flex-col items-center justify-center rounded-md border border-slate-200 text-sm font-medium transition hover:ring-2 hover:ring-brand-400"
                style={{ backgroundColor: level ? level.color + '55' : undefined }}
                title="クリックで次の忙しさ段階へ"
              >
                <span className="text-slate-700">
                  {day}
                  {isHoliday && <span className="ml-0.5 text-[10px] text-red-500">祝</span>}
                </span>
                <span
                  className="mt-0.5 rounded px-1 text-[10px] text-white"
                  style={{ backgroundColor: level?.color }}
                >
                  {level?.name ?? ''}
                </span>
              </button>
            )
          })}
        </div>

        <div className="flex flex-wrap gap-3 text-xs text-slate-500">
          {levels.map((l) => (
            <span key={l.id} className="flex items-center gap-1">
              <span className="inline-block h-4 w-4 rounded" style={{ backgroundColor: l.color }} />
              {l.name}
            </span>
          ))}
        </div>
      </div>

      {/* 祝日 */}
      <div className="card space-y-2">
        <h3 className="text-sm font-bold text-slate-700">祝日</h3>
        <p className="text-xs text-slate-500">
          登録した日は「土日祝の既定」の忙しさが適用されます（個別指定があればそちらが優先）。
        </p>
        <input
          type="date"
          className="input max-w-[12rem]"
          onChange={(e) => {
            addHoliday(e.target.value)
            e.target.value = ''
          }}
        />
        <div className="flex flex-wrap gap-2">
          {period.holidays.map((d) => (
            <span key={d} className="chip bg-red-50 text-red-600">
              {Number(d.split('-')[1])}/{Number(d.split('-')[2])}
              <button className="ml-1 text-red-300 hover:text-red-600" onClick={() => removeHoliday(d)}>
                ×
              </button>
            </span>
          ))}
          {period.holidays.length === 0 && <span className="text-xs text-slate-400">未登録</span>}
        </div>
      </div>

      <div className="text-xs text-slate-400">
        対象期間: {period.start} 〜 {period.end}
      </div>
    </div>
  )
}
