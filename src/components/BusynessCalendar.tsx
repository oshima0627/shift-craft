import { useMemo } from 'react'
import { useStore } from '../state/store'
import { busynessIdOf } from '../utils/busyness'
import { fmt } from '../utils/date'

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']

/**
 * 忙しさカレンダー。
 * - 月を切り替えて対象期間を決める（期間タブの代わり）
 * - 各日をクリックして忙しさ段階を切り替える（段階ごとに色付け）
 * - 忙しさ段階は可変（追加・削除・改名・色変更・既定設定）
 * 必要人数はこの忙しさ段階ごとに設定する。
 */
export default function BusynessCalendar() {
  const period = useStore((s) => s.data.period)
  const levels = useStore((s) => s.data.busynessLevels)
  const defaultId = useStore((s) => s.data.defaultBusynessLevelId)
  const data = useStore((s) => s.data)
  const updatePeriod = useStore((s) => s.updatePeriod)
  const setDayBusyness = useStore((s) => s.setDayBusyness)
  const addBusynessLevel = useStore((s) => s.addBusynessLevel)
  const updateBusynessLevel = useStore((s) => s.updateBusynessLevel)
  const removeBusynessLevel = useStore((s) => s.removeBusynessLevel)
  const setDefaultBusynessLevel = useStore((s) => s.setDefaultBusynessLevel)

  // 対象月は period.start の年月から決める
  const [year, month] = useMemo(() => {
    const [y, m] = period.start.split('-').map(Number)
    return [y, (m || 1) - 1] // month は0-based
  }, [period.start])

  const setMonth = (y: number, m: number) => {
    const start = new Date(y, m, 1)
    const end = new Date(y, m + 1, 0)
    updatePeriod({ start: fmt(start), end: fmt(end) })
  }
  const prevMonth = () => setMonth(month === 0 ? year - 1 : year, month === 0 ? 11 : month - 1)
  const nextMonth = () => setMonth(month === 11 ? year + 1 : year, month === 11 ? 0 : month + 1)

  // 月のカレンダーセル（先頭に空白、日〜土で7列）
  const cells = useMemo(() => {
    const first = new Date(year, month, 1)
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const lead = first.getDay() // 0=日
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

  const setDayLevel = (date: string, levelId: string) => setDayBusyness(date, levelId)

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
              <label className="flex items-center gap-1 text-xs text-slate-500">
                <input
                  type="radio"
                  name="default-busyness"
                  className="accent-brand-500"
                  checked={defaultId === l.id}
                  onChange={() => setDefaultBusynessLevel(l.id)}
                />
                未設定日の既定
              </label>
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
            const levelId = busynessIdOf(data, date)
            const level = levelById.get(levelId)
            return (
              <button
                key={date}
                onClick={() => cycleDay(date)}
                className="flex aspect-square flex-col items-center justify-center rounded-md border border-slate-200 text-sm font-medium transition hover:ring-2 hover:ring-brand-400"
                style={{ backgroundColor: level ? level.color + '55' : undefined }}
                title="クリックで次の忙しさ段階へ"
              >
                <span className="text-slate-700">{day}</span>
                <span className="mt-0.5 rounded px-1 text-[10px] text-white" style={{ backgroundColor: level?.color }}>
                  {level?.name ?? ''}
                </span>
              </button>
            )
          })}
        </div>

        {/* クイック設定の凡例（クリックで一括ではなく個別だが、色の対応を表示） */}
        <div className="flex flex-wrap gap-3 text-xs text-slate-500">
          {levels.map((l) => (
            <span key={l.id} className="flex items-center gap-1">
              <span className="inline-block h-4 w-4 rounded" style={{ backgroundColor: l.color }} />
              {l.name}
            </span>
          ))}
        </div>
        <p className="text-xs text-slate-400">
          セルを右の段階へ切り替えるにはクリック。特定の段階に直接したい場合は、下の一覧から選べます。
        </p>
        {/* 直接設定（各日 select は場所を取るため、選択中の色で分かるクリック切替を主とする） */}
      </div>

      <div className="text-xs text-slate-400">
        対象期間: {period.start} 〜 {period.end}
      </div>

      {/* 祝日など個別に段階を直接指定したいとき用の簡易セレクタ */}
      <DirectPicker
        cells={cells.filter((c): c is string => !!c)}
        levels={levels}
        valueOf={(date) => busynessIdOf(data, date)}
        onSet={setDayLevel}
      />
    </div>
  )
}

function DirectPicker({
  cells,
  levels,
  valueOf,
  onSet,
}: {
  cells: string[]
  levels: { id: string; name: string; color: string }[]
  valueOf: (date: string) => string
  onSet: (date: string, levelId: string) => void
}) {
  return (
    <details className="card">
      <summary className="cursor-pointer text-sm font-medium text-slate-600">
        日付ごとに段階を直接指定する
      </summary>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {cells.map((date) => {
          const [, m, d] = date.split('-')
          return (
            <label key={date} className="flex items-center gap-1 text-xs">
              <span className="w-12 text-slate-500">
                {Number(m)}/{Number(d)}
              </span>
              <select
                className="input py-1 text-xs"
                value={valueOf(date)}
                onChange={(e) => onSet(date, e.target.value)}
              >
                {levels.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
          )
        })}
      </div>
    </details>
  )
}
