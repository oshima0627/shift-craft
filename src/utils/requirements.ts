import type { AppData } from '../types'
import { busynessIdOf } from './busyness'

/**
 * その日が休業日か（お店が休み）を判定する共通ヘルパー。
 * 優先順位: 特定日の営業(openDates) ＞ 特定日の休業(closedDates) ＞ 曜日の定休日(closedWeekdays)。
 * 忙しさカレンダー・シフト表・必要人数の判定はすべてこれを使う。
 */
export function isClosedDay(data: AppData, date: string): boolean {
  const c = data.constraints
  if (c.openDates?.includes(date)) return false
  if (c.closedDates?.includes(date)) return true
  const weekday = new Date(date + 'T00:00:00').getDay()
  return c.closedWeekdays?.includes(weekday) ?? false
}

/**
 * その日・その役割・その時間帯の必要人数。
 * 特定日の上書き（overrides）＞ 忙しさ段階別の必要人数（requirements） の優先で解決する。
 */
export function neededCount(
  data: AppData,
  date: string,
  roleId: string,
  shiftId: string,
): number {
  const ov = data.overrides.find(
    (o) => o.date === date && o.roleId === roleId && o.shiftId === shiftId,
  )
  if (ov) return Math.max(0, ov.count)
  // 休業日（曜日の定休日／特定日の休業）は必要人数0＝誰も割り当てない。人数上書きがあればそちらが優先。
  if (isClosedDay(data, date)) return 0
  const req = data.requirements.find((r) => r.roleId === roleId && r.shiftId === shiftId)
  if (!req) return 0
  const levelId = busynessIdOf(data, date)
  return Math.max(0, req.counts[levelId] ?? 0)
}
