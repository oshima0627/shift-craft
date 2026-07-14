import type { AppData, BusynessLevel } from '../types'
import { dayCategoryOf } from './date'

/**
 * その日の忙しさ段階ID。
 * 優先: 個別指定(dayBusyness) ＞ 曜日タイプ別の既定（平日=defaultBusynessLevelId /
 * 土日祝=weekendBusynessLevelId）。存在しないIDは既定/先頭にフォールバック。
 */
export function busynessIdOf(data: AppData, date: string): string {
  const explicit = data.dayBusyness[date]
  let id = explicit
  if (!id) {
    const cat = dayCategoryOf(date, data.period.holidays)
    id = cat === 'weekday' ? data.defaultBusynessLevelId : data.weekendBusynessLevelId
  }
  if (data.busynessLevels.some((l) => l.id === id)) return id
  // フォールバック
  if (data.busynessLevels.some((l) => l.id === data.defaultBusynessLevelId)) {
    return data.defaultBusynessLevelId
  }
  return data.busynessLevels[0]?.id ?? ''
}

/** その日の忙しさ段階（オブジェクト） */
export function busynessOf(data: AppData, date: string): BusynessLevel | undefined {
  const id = busynessIdOf(data, date)
  return data.busynessLevels.find((l) => l.id === id)
}
