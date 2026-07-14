import { describe, expect, it } from 'vitest'
import { isJapaneseHoliday } from './jpHolidays'

describe('isJapaneseHoliday（日本の祝日 自動判定）', () => {
  it('固定日の祝日', () => {
    expect(isJapaneseHoliday('2026-01-01')).toBe(true) // 元日
    expect(isJapaneseHoliday('2026-02-11')).toBe(true) // 建国記念の日
    expect(isJapaneseHoliday('2026-02-23')).toBe(true) // 天皇誕生日
    expect(isJapaneseHoliday('2026-05-05')).toBe(true) // こどもの日
    expect(isJapaneseHoliday('2026-11-03')).toBe(true) // 文化の日
  })

  it('ハッピーマンデー（成人の日=1月第2月曜）', () => {
    expect(isJapaneseHoliday('2026-01-12')).toBe(true) // 2026年の成人の日
    expect(isJapaneseHoliday('2026-01-05')).toBe(false) // 第1月曜は祝日でない
  })

  it('春分・秋分', () => {
    expect(isJapaneseHoliday('2026-03-20')).toBe(true) // 春分の日 2026
    expect(isJapaneseHoliday('2026-09-23')).toBe(true) // 秋分の日 2026
  })

  it('振替休日（憲法記念日5/3が日曜→5/6が振替）', () => {
    expect(isJapaneseHoliday('2026-05-06')).toBe(true)
  })

  it('平日は祝日でない', () => {
    expect(isJapaneseHoliday('2026-01-06')).toBe(false)
    expect(isJapaneseHoliday('2026-07-01')).toBe(false)
  })
})
