import { useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { busynessIdOf } from '../utils/busyness'
import { fmt } from '../utils/date'
import { isClosedDay } from '../utils/requirements'
import { isJapaneseHoliday } from '../utils/jpHolidays'

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']

function weekdayOf(date: string): number {
  return new Date(date + 'T00:00:00').getDay()
}

/** "yyyy-MM-dd" → "M月D日（曜）" */
function dateLabel(date: string): string {
  const [, m, d] = date.split('-').map(Number)
  return `${m}月${d}日（${WEEKDAY_LABELS[weekdayOf(date)]}）`
}

/**
 * 忙しさカレンダー。
 * - 月を切り替えて対象期間を決める
 * - 各日をクリックしてメニューを開き、忙しさ段階の変更・定休日/営業日の切替を行う
 * - 忙しさ段階は可変（追加・削除・改名・色変更）
 * - 定休日は「毎週の曜日」と「特定の日」の両方で設定できる
 * 個別に設定していない日は自動判定（土日祝＝既定の忙しさ / 平日＝既定の忙しさ）。
 * 祝日は日本の祝日を自動で判定する。
 */
export default function BusynessCalendar() {
  const period = useStore((s) => s.data.period)
  const levels = useStore((s) => s.data.busynessLevels)
  const data = useStore((s) => s.data)
  const constraints = useStore((s) => s.data.constraints)
  const updatePeriod = useStore((s) => s.updatePeriod)
  const setDayBusyness = useStore((s) => s.setDayBusyness)
  const clearDayBusyness = useStore((s) => s.clearDayBusyness)
  const addBusynessLevel = useStore((s) => s.addBusynessLevel)
  const updateBusynessLevel = useStore((s) => s.updateBusynessLevel)
  const removeBusynessLevel = useStore((s) => s.removeBusynessLevel)
  const updateConstraints = useStore((s) => s.updateConstraints)

  const [menuDate, setMenuDate] = useState<string | null>(null)

  const closedWeekdays = new Set(constraints.closedWeekdays ?? [])

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

  // 特定日を定休日にする（net で必ず「休業」になるよう配列を整える）
  const makeDayClosed = (date: string) => {
    const weekdayClosed = closedWeekdays.has(weekdayOf(date))
    const openDates = (constraints.openDates ?? []).filter((d) => d !== date)
    let closedDates = constraints.closedDates ?? []
    if (!weekdayClosed && !closedDates.includes(date)) {
      closedDates = [...closedDates, date].sort()
    }
    updateConstraints({ openDates, closedDates })
  }

  // 特定日を営業日にする（net で必ず「営業」になるよう配列を整える）
  const makeDayOpen = (date: string) => {
    const weekdayClosed = closedWeekdays.has(weekdayOf(date))
    const closedDates = (constraints.closedDates ?? []).filter((d) => d !== date)
    let openDates = constraints.openDates ?? []
    if (weekdayClosed && !openDates.includes(date)) {
      openDates = [...openDates, date].sort()
    }
    updateConstraints({ closedDates, openDates })
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="page-title">忙しさカレンダー</h2>
        <p className="page-desc">
          月を切り替えて対象期間を決め、各日をクリックして忙しさや定休日を設定します。
          個別に設定していない日は自動判定（土日祝＝最も忙しい／平日＝中間）。祝日は自動で判定します。
        </p>
      </div>

      {/* 忙しさ段階エディタ */}
      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="section-title">忙しさの段階（可変）</h3>
          <button className="btn-ghost btn-sm" onClick={addBusynessLevel}>
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
        <p className="section-desc">
          段階を追加・削除しても、他の日に設定した忙しさは変わりません。設定していた段階を削除した日は「普通」になります。
        </p>
      </div>

      {/* 定休日（毎週の休業曜日） */}
      <div className="card space-y-3">
        <div className="space-y-1">
          <h3 className="section-title">定休日（毎週の休業日）</h3>
          <p className="section-desc">
            チェックした曜日はお店が休みとして、下のカレンダーで「定休日」と表示され、シフトも割り当てません。
            特定の日だけの休業・営業は、下のカレンダーの日付をクリックして設定できます。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {WEEKDAY_LABELS.map((label, wd) => {
            const on = closedWeekdays.has(wd)
            return (
              <button
                key={wd}
                onClick={() => {
                  const cur = constraints.closedWeekdays ?? []
                  updateConstraints({
                    closedWeekdays: on ? cur.filter((d) => d !== wd) : [...cur, wd].sort(),
                  })
                }}
                className={`min-h-[2.75rem] min-w-[3rem] rounded-xl border px-3 text-base font-semibold transition-colors ${
                  on
                    ? 'border-slate-500 bg-slate-500 text-white shadow-sm'
                    : `border-slate-200 bg-white hover:border-brand-300 hover:bg-brand-50 ${
                        wd === 0 ? 'text-red-500' : wd === 6 ? 'text-blue-500' : 'text-slate-600'
                      }`
                }`}
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>

      {/* 月カレンダー */}
      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <button className="btn-ghost" onClick={prevMonth}>
            ◀ 前月
          </button>
          <div className="text-xl font-bold text-slate-800">
            {year}年 {month + 1}月
          </div>
          <button className="btn-ghost" onClick={nextMonth}>
            翌月 ▶
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1">
          {WEEKDAY_LABELS.map((w, i) => (
            <div
              key={w}
              className={`py-1 text-center text-sm font-semibold ${
                i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : 'text-slate-500'
              }`}
            >
              {w}
            </div>
          ))}
          {cells.map((date, i) => {
            if (!date) return <div key={i} />
            const day = Number(date.split('-')[2])
            const holiday = isJapaneseHoliday(date)
            if (isClosedDay(data, date)) {
              // 定休日はグレーアウトして「定休日」と表示。クリックでメニューを開く
              return (
                <button
                  key={date}
                  onClick={() => setMenuDate(date)}
                  className="flex h-20 flex-col items-center justify-center rounded-lg border border-slate-300 bg-slate-300 text-base font-medium transition hover:ring-2 hover:ring-brand-400"
                  title="クリックで営業日/忙しさを変更"
                >
                  <span className="text-base font-semibold text-slate-600">
                    {day}
                    {holiday && <span className="ml-0.5 text-[11px] text-red-500">祝</span>}
                  </span>
                  <span className="mt-0.5 rounded bg-slate-600 px-1.5 text-[11px] font-semibold text-white">
                    定休日
                  </span>
                </button>
              )
            }
            const level = levelById.get(busynessIdOf(data, date))
            return (
              <button
                key={date}
                onClick={() => setMenuDate(date)}
                className="flex h-20 flex-col items-center justify-center rounded-lg border border-slate-200 text-base font-medium transition hover:ring-2 hover:ring-brand-400"
                style={{ backgroundColor: level ? level.color + '55' : undefined }}
                title="クリックで忙しさ/定休日を変更"
              >
                <span className="text-base font-semibold text-slate-800">
                  {day}
                  {holiday && <span className="ml-0.5 text-[11px] text-red-500">祝</span>}
                </span>
                <span
                  className="mt-0.5 rounded px-1.5 text-[11px] font-semibold text-white"
                  style={{ backgroundColor: level?.color }}
                >
                  {level?.name ?? ''}
                </span>
              </button>
            )
          })}
        </div>

        <div className="flex flex-wrap gap-4 text-sm text-slate-500">
          {levels.map((l) => (
            <span key={l.id} className="flex items-center gap-1.5">
              <span className="inline-block h-4 w-4 rounded" style={{ backgroundColor: l.color }} />
              {l.name}
            </span>
          ))}
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-4 w-4 rounded bg-slate-300" />
            定休日
          </span>
        </div>
      </div>

      <div className="text-sm text-slate-400">
        対象期間: {period.start} 〜 {period.end}
      </div>

      {/* 日付クリックのメニュー（忙しさ変更・定休日/営業日の切替） */}
      {menuDate && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setMenuDate(null)}
        >
          <div
            className="card w-full max-w-xs space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h4 className="section-title">{dateLabel(menuDate)}</h4>
              <button
                className="text-slate-400 hover:text-slate-700"
                onClick={() => setMenuDate(null)}
                title="閉じる"
              >
                ✕
              </button>
            </div>

            {isClosedDay(data, menuDate) ? (
              <div className="space-y-2">
                <p className="text-sm text-slate-500">この日は定休日（休業）です。</p>
                <button
                  className="btn w-full"
                  onClick={() => {
                    makeDayOpen(menuDate)
                    setMenuDate(null)
                  }}
                >
                  この日を営業日にする
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-slate-600">忙しさを選ぶ</p>
                  <div className="flex flex-wrap gap-2">
                    {levels.map((l) => (
                      <button
                        key={l.id}
                        className="min-h-[2.5rem] rounded-xl border px-3 text-base font-semibold text-white shadow-sm"
                        style={{ backgroundColor: l.color, borderColor: l.color }}
                        onClick={() => {
                          setDayBusyness(menuDate, l.id)
                          setMenuDate(null)
                        }}
                      >
                        {l.name}
                      </button>
                    ))}
                    <button
                      className="min-h-[2.5rem] rounded-xl border border-slate-200 bg-white px-3 text-base font-semibold text-slate-600 hover:border-brand-300 hover:bg-brand-50"
                      onClick={() => {
                        clearDayBusyness(menuDate)
                        setMenuDate(null)
                      }}
                    >
                      自動
                    </button>
                  </div>
                </div>
                <button
                  className="btn-ghost w-full"
                  onClick={() => {
                    makeDayClosed(menuDate)
                    setMenuDate(null)
                  }}
                >
                  この日を定休日にする
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
