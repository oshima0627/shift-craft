import { eachDayOfInterval, format, getDay, parseISO } from 'date-fns'
import type { DayCategory, PeriodSettings } from '../types'
import { isJapaneseHoliday } from './jpHolidays'

export const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']

/** "yyyy-MM-dd" 文字列を Date に */
export function parse(dateStr: string): Date {
  return parseISO(dateStr)
}

/** Date を "yyyy-MM-dd" に */
export function fmt(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

/** 期間内の全日付を "yyyy-MM-dd" 配列で返す */
export function enumerateDates(period: PeriodSettings): string[] {
  const start = parse(period.start)
  const end = parse(period.end)
  if (end < start) return []
  return eachDayOfInterval({ start, end }).map(fmt)
}

/**
 * 日付の曜日区分を判定する。祝日は日本の祝日を自動判定する。
 * 優先度: 祝日 > 日 > 土 > 平日
 */
export function dayCategoryOf(dateStr: string): DayCategory {
  if (isJapaneseHoliday(dateStr)) return 'holiday'
  const dow = getDay(parse(dateStr)) // 0=日, 6=土
  if (dow === 0) return 'sunday'
  if (dow === 6) return 'saturday'
  return 'weekday'
}

/** 曜日ラベル（例: 月） */
export function weekdayLabel(dateStr: string): string {
  return WEEKDAY_LABELS[getDay(parse(dateStr))]
}

/** 表示用（例: 7/14(月)） */
export function displayDate(dateStr: string): string {
  const d = parse(dateStr)
  return `${d.getMonth() + 1}/${d.getDate()}(${weekdayLabel(dateStr)})`
}

/** 土日祝かどうか */
export function isRestDay(dateStr: string): boolean {
  return dayCategoryOf(dateStr) !== 'weekday'
}
