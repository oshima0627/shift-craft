import type { AppData, ScheduleResult } from '../types'
import { enumerateDates, displayDate } from './date'

/** スタッフ×日付のグリッドをCSV化してダウンロード */
export function exportCsv(data: AppData, result: ScheduleResult): void {
  const dates = enumerateDates(data.period)
  const shiftById = new Map(data.shifts.map((s) => [s.id, s]))

  // ヘッダ
  const header = ['スタッフ', ...dates.map((d) => displayDate(d)), '出勤数']
  const rows: string[][] = [header]

  for (const st of data.staff) {
    const row = [st.name]
    for (const date of dates) {
      // 分割勤務では同日に複数シフト → 「早番+遅番」のように連結
      const names = result.assignments
        .filter((x) => x.staffId === st.id && x.date === date)
        .map((x) => shiftById.get(x.shiftId)?.name ?? '○')
      row.push(names.join('+'))
    }
    row.push(String(result.staffLoad[st.id] ?? 0))
    rows.push(row)
  }

  const csv = rows
    .map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(','))
    .join('\r\n')

  // BOM付きでExcelの文字化けを防ぐ
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `shift_${data.period.start}_${data.period.end}.csv`
  link.click()
  URL.revokeObjectURL(url)
}
