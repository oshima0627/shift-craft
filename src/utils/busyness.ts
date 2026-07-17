import type { AppData, BusynessLevel } from '../types'
import { dayCategoryOf } from './date'

/** 段階の並びから平日の既定（中間）を求める */
export function positionalWeekdayLevel(levels: BusynessLevel[]): string {
  return levels[Math.floor((levels.length - 1) / 2)]?.id ?? ''
}
/** 段階の並びから土日祝の既定（末尾＝最も忙しい）を求める */
export function positionalWeekendLevel(levels: BusynessLevel[]): string {
  return levels[levels.length - 1]?.id ?? ''
}

/**
 * その日の忙しさ段階ID。
 * 優先: 個別指定(dayBusyness) ＞ 曜日タイプ別の既定(defaultWeekday/WeekendLevel)。
 * 既定は段階IDで固定されているため、段階の追加・削除で他の日の判定はずれない。
 * 既定が未設定のときは段階の並び順（平日=中間 / 土日祝=末尾）にフォールバックする。
 */
export function busynessIdOf(data: AppData, date: string): string {
  const explicit = data.dayBusyness[date]
  if (explicit && data.busynessLevels.some((l) => l.id === explicit)) return explicit

  const levels = data.busynessLevels
  if (levels.length === 0) return ''
  const cat = dayCategoryOf(date)
  const preferred = cat === 'weekday' ? data.defaultWeekdayLevel : data.defaultWeekendLevel
  if (preferred && levels.some((l) => l.id === preferred)) return preferred
  return cat === 'weekday' ? positionalWeekdayLevel(levels) : positionalWeekendLevel(levels)
}

/** その日の忙しさ段階（オブジェクト） */
export function busynessOf(data: AppData, date: string): BusynessLevel | undefined {
  const id = busynessIdOf(data, date)
  return data.busynessLevels.find((l) => l.id === id)
}
