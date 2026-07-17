import type { AppData } from '../types'
import { busynessIdOf } from './busyness'

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
  // 定休日（毎週の休業曜日）は必要人数0（＝誰も割り当てない）。個別の上書きがあればそちらが優先。
  const weekday = new Date(date + 'T00:00:00').getDay()
  if (data.constraints.closedWeekdays?.includes(weekday)) return 0
  const req = data.requirements.find((r) => r.roleId === roleId && r.shiftId === shiftId)
  if (!req) return 0
  const levelId = busynessIdOf(data, date)
  return Math.max(0, req.counts[levelId] ?? 0)
}
