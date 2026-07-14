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
  const req = data.requirements.find((r) => r.roleId === roleId && r.shiftId === shiftId)
  if (!req) return 0
  const levelId = busynessIdOf(data, date)
  return Math.max(0, req.counts[levelId] ?? 0)
}
