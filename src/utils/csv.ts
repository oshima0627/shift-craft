import type { AppData, ScheduleResult } from '../types'
import { enumerateDates, displayDate } from './date'

/**
 * スタッフ×日付のグリッドを2次元配列（行×列）に組み立てる（純粋関数・テスト可能）。
 * 同じ日に複数シフト（分割勤務）がある人は、シフトごとに行を分ける
 * （例: 佐藤が7/1に早番+遅番 → 佐藤の行=早番、次の行=遅番）。
 * スタッフ名・出勤数は各人の先頭行にのみ入れ、2行目以降は空欄（結合セル風）。
 */
export function buildCsvRows(data: AppData, result: ScheduleResult): string[][] {
  const dates = enumerateDates(data.period)
  const shiftById = new Map(data.shifts.map((s) => [s.id, s]))
  const shiftOrder = new Map(data.shifts.map((s, i) => [s.id, i]))

  const header = ['スタッフ', ...dates.map((d) => displayDate(d)), '出勤数']
  const rows: string[][] = [header]

  for (const st of data.staff) {
    // 日付ごとに、その人のシフト名を開始（定義）順に並べる
    const shiftsByDate = new Map<string, string[]>()
    let maxPerDay = 1
    for (const date of dates) {
      const names = result.assignments
        .filter((x) => x.staffId === st.id && x.date === date)
        .sort((a, b) => (shiftOrder.get(a.shiftId) ?? 0) - (shiftOrder.get(b.shiftId) ?? 0))
        .map((x) => shiftById.get(x.shiftId)?.name ?? '○')
      shiftsByDate.set(date, names)
      if (names.length > maxPerDay) maxPerDay = names.length
    }
    // 最大コマ数だけ行を作る。1行目に名前と出勤数、2行目以降は空欄。
    for (let i = 0; i < maxPerDay; i++) {
      const row = [i === 0 ? st.name : '']
      for (const date of dates) {
        row.push(shiftsByDate.get(date)?.[i] ?? '')
      }
      row.push(i === 0 ? String(result.staffLoad[st.id] ?? 0) : '')
      rows.push(row)
    }
  }
  return rows
}

/** 2次元配列をCSVテキスト（RFC4180風、CRLF区切り）に変換する */
export function toCsvText(rows: string[][]): string {
  return rows
    .map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(','))
    .join('\r\n')
}

/** スタッフ×日付のグリッドをCSV化してダウンロード */
export function exportCsv(data: AppData, result: ScheduleResult): void {
  const csv = toCsvText(buildCsvRows(data, result))
  // BOM付きでExcelの文字化けを防ぐ
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `shift_${data.period.start}_${data.period.end}.csv`
  link.click()
  URL.revokeObjectURL(url)
}
