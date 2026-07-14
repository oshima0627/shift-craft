import { getDay } from 'date-fns'
import type { ShiftType } from '../types'
import { fmt, parse } from './date'

/** "HH:mm" → 0時からの分 */
export function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

/** 分 → "H時間M分" 表示 */
export function minToLabel(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h === 0) return `${m}分`
  if (m === 0) return `${h}時間`
  return `${h}時間${m}分`
}

/**
 * シフトの開始・終了を分で返す。終了が開始以前なら翌日終了（+24h）とみなす。
 * 例: 17:00〜25:00深夜営業は end "01:00" と入力 → endMin = 1500
 */
export function shiftSpan(shift: Pick<ShiftType, 'start' | 'end'>): {
  startMin: number
  endMin: number
} {
  const startMin = toMin(shift.start)
  let endMin = toMin(shift.end)
  if (endMin <= startMin) endMin += 1440
  return { startMin, endMin }
}

/** 拘束時間（分） */
export function boundMin(shift: Pick<ShiftType, 'start' | 'end'>): number {
  const { startMin, endMin } = shiftSpan(shift)
  return endMin - startMin
}

/**
 * 法定休憩（分）。労基法34条:
 * 実働が6時間を超える場合45分以上、8時間を超える場合1時間以上。
 * 拘束時間から逆算する（拘束-60分の実働が8hを超えるなら60分…）。
 */
export function legalBreakMin(bound: number): number {
  // 45分休憩では実働が8hを超えてしまう拘束時間（>8h45m）は60分必要
  if (bound - 45 > 480) return 60
  if (bound > 360) return 45 // 拘束6h超は実働も6h超（休憩0のままなら）→45分必要
  return 0
}

/** 実働時間（分）＝ 拘束 − 法定休憩 */
export function paidMin(shift: Pick<ShiftType, 'start' | 'end'>): number {
  const bound = boundMin(shift)
  return bound - legalBreakMin(bound)
}

/**
 * 深夜時間帯（22:00〜翌5:00）と重なる分数。割増賃金25%の対象（労基法37条）。
 * 休憩の位置は不定のため、拘束時間ベースの概算（保守的に多め）。
 */
export function nightMin(shift: Pick<ShiftType, 'start' | 'end'>): number {
  const { startMin, endMin } = shiftSpan(shift)
  // 深夜帯: [0,300](〜5:00), [1320,1740](22:00〜翌5:00), [2760,3180](翌22:00〜)
  const windows: [number, number][] = [
    [0, 300],
    [1320, 1740],
    [2760, 3180],
  ]
  let total = 0
  for (const [ws, we] of windows) {
    total += Math.max(0, Math.min(endMin, we) - Math.max(startMin, ws))
  }
  return total
}

/**
 * 18歳未満（年少者）に割り当て不可のシフトか。
 * 労基法61条: 原則22:00〜翌5:00の深夜帯に使用できない。
 * → 終了が22:00を超える、または開始が5:00より前のシフトは不可。
 */
export function isMinorForbidden(shift: Pick<ShiftType, 'start' | 'end'>): boolean {
  const { startMin, endMin } = shiftSpan(shift)
  return endMin > 1320 || startMin < 300
}

/**
 * 勤務間インターバル（分）: 前日シフトの終業 → 翌日シフトの始業。
 * 例: 前日 17:00-23:00、翌日 9:00 開始 → (1440-1380)+540 = 600分(10h)
 */
export function restBetweenMin(
  prevShift: Pick<ShiftType, 'start' | 'end'>,
  nextShift: Pick<ShiftType, 'start' | 'end'>,
): number {
  const prev = shiftSpan(prevShift)
  const next = shiftSpan(nextShift)
  return 1440 + next.startMin - prev.endMin
}

/** 週キー（日曜起算）。"yyyy-MM-dd" → その週の日曜日の "yyyy-MM-dd" */
export function weekKeyOf(dateStr: string): string {
  const d = parse(dateStr)
  const dow = getDay(d) // 0=日
  const sunday = new Date(d)
  sunday.setDate(d.getDate() - dow)
  return fmt(sunday)
}
