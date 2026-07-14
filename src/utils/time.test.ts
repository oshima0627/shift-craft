import { describe, expect, it } from 'vitest'
import {
  boundMin,
  isMinorForbidden,
  legalBreakMin,
  nightMin,
  paidMin,
  restBetweenMin,
  weekKeyOf,
} from './time'

describe('legalBreakMin（労基法34条）', () => {
  it('実働6時間以下は休憩不要', () => {
    expect(legalBreakMin(360)).toBe(0) // 拘束6h → 実働6h（超えない）
    expect(legalBreakMin(240)).toBe(0)
  })
  it('実働6時間超〜8時間以下は45分', () => {
    expect(legalBreakMin(361)).toBe(45)
    expect(legalBreakMin(480)).toBe(45) // 拘束8h - 45分 = 実働7h15m
    expect(legalBreakMin(525)).toBe(45) // 拘束8h45m - 45m = 実働8h（8hちょうどは45分でよい）
  })
  it('45分では実働8時間を超える拘束時間は60分', () => {
    expect(legalBreakMin(540)).toBe(60) // 拘束9h: 45分だと実働8h15m>8h → 60分必要
    expect(legalBreakMin(526)).toBe(60) // 拘束8h46m: 45分だと実働8h1m → 60分
    expect(legalBreakMin(600)).toBe(60) // 拘束10h
  })
})

describe('shift time helpers', () => {
  it('日をまたぐシフトの拘束時間', () => {
    expect(boundMin({ start: '17:00', end: '01:00' })).toBe(480)
  })
  it('実働 = 拘束 - 法定休憩', () => {
    expect(paidMin({ start: '09:00', end: '17:00' })).toBe(480 - 45)
    expect(paidMin({ start: '10:00', end: '14:00' })).toBe(240)
  })
  it('深夜時間（22時〜翌5時）の算出', () => {
    expect(nightMin({ start: '17:00', end: '23:00' })).toBe(60)
    expect(nightMin({ start: '17:00', end: '01:00' })).toBe(180) // 22-25時
    expect(nightMin({ start: '09:00', end: '17:00' })).toBe(0)
  })
  it('年少者の深夜禁止判定（労基法61条）', () => {
    expect(isMinorForbidden({ start: '15:00', end: '22:00' })).toBe(false) // 22時ちょうど終了はOK
    expect(isMinorForbidden({ start: '15:00', end: '22:30' })).toBe(true)
    expect(isMinorForbidden({ start: '04:00', end: '10:00' })).toBe(true) // 5時前開始
    expect(isMinorForbidden({ start: '17:00', end: '01:00' })).toBe(true)
  })
  it('勤務間インターバルの算出', () => {
    // 前日 17:00-23:00 → 翌日 09:00 開始 = 10時間
    expect(restBetweenMin({ start: '17:00', end: '23:00' }, { start: '09:00', end: '14:00' })).toBe(600)
    // 前日 17:00-01:00（翌1時） → 翌日 09:00 = 8時間
    expect(restBetweenMin({ start: '17:00', end: '01:00' }, { start: '09:00', end: '14:00' })).toBe(480)
  })
  it('週キーは日曜起算', () => {
    expect(weekKeyOf('2026-08-05')).toBe('2026-08-02') // 水曜 → その週の日曜
    expect(weekKeyOf('2026-08-02')).toBe('2026-08-02') // 日曜はそのまま
    expect(weekKeyOf('2026-08-01')).toBe('2026-07-26') // 土曜 → 前の日曜
  })
})
