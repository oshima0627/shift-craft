import type { AppData, BusynessLevel } from '../types'
import { dayCategoryOf } from './date'

/**
 * その日の忙しさ段階ID。
 * 優先: 個別指定(dayBusyness) ＞ 曜日タイプ別の既定。
 * 既定は段階の並び順（低→高）から自動決定する:
 *  - 土日祝 → 最も忙しい段階（末尾）
 *  - 平日   → 中間の段階
 */
export function busynessIdOf(data: AppData, date: string): string {
  const explicit = data.dayBusyness[date]
  if (explicit && data.busynessLevels.some((l) => l.id === explicit)) return explicit

  const levels = data.busynessLevels
  if (levels.length === 0) return ''
  const cat = dayCategoryOf(date)
  if (cat !== 'weekday') return levels[levels.length - 1].id // 土日祝=最も忙しい
  return levels[Math.floor((levels.length - 1) / 2)].id // 平日=中間
}

/** その日の忙しさ段階（オブジェクト） */
export function busynessOf(data: AppData, date: string): BusynessLevel | undefined {
  const id = busynessIdOf(data, date)
  return data.busynessLevels.find((l) => l.id === id)
}
