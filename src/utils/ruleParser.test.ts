import { describe, expect, it } from 'vitest'
import type { ShiftType, Staff } from '../types'
import { parseRule } from './ruleParser'

const mkStaff = (id: string, name: string): Staff => ({
  id,
  name,
  roleIds: [],
  level: 1,
  hourlyWage: 1100,
  isMinor: false,
  maxShifts: null,
  maxConsecutive: null,
  weeklyMaxHours: null,
  weeklyMaxDays: null,
  unavailableDates: [],
  allowedShiftIds: [],
})

const staff = [mkStaff('t', '田中'), mkStaff('s', '佐藤'), mkStaff('k', '高橋')]
const shifts: ShiftType[] = [
  { id: 'early', name: '早番', start: '09:00', end: '17:00' },
  { id: 'late', name: '遅番', start: '13:00', end: '22:00' },
]

describe('parseRule（自然文のルールベース解釈・AI不使用）', () => {
  it('NGペア', () => {
    const r = parseRule('田中と佐藤は同じ日に入れない', staff, shifts)
    expect(r.parsed).toEqual({ kind: 'pairAvoid', a: 't', b: 's' })
  })
  it('NGペア（別表現）', () => {
    const r = parseRule('田中さんと佐藤さんは同じ日に出勤させない', staff, shifts)
    expect(r.parsed).toEqual({ kind: 'pairAvoid', a: 't', b: 's' })
  })
  it('一緒に入れたいペア（ソフト）', () => {
    const r = parseRule('高橋と田中はなるべく同じ日に入れる', staff, shifts)
    expect(r.parsed).toEqual({ kind: 'pairTogether', a: 'k', b: 't' })
  })
  it('曜日NG', () => {
    const r = parseRule('高橋は火曜は休み', staff, shifts)
    expect(r.parsed).toEqual({ kind: 'forbidWeekday', staffId: 'k', weekday: 2 })
  })
  it('週N日まで', () => {
    const r = parseRule('佐藤は週3日まで', staff, shifts)
    expect(r.parsed).toEqual({ kind: 'maxDaysPerWeek', staffId: 's', days: 3 })
  })
  it('全角数字にも対応', () => {
    const r = parseRule('佐藤は週３日まで', staff, shifts)
    expect(r.parsed).toEqual({ kind: 'maxDaysPerWeek', staffId: 's', days: 3 })
  })
  it('N連勤まで', () => {
    const r = parseRule('田中は4連勤まで', staff, shifts)
    expect(r.parsed).toEqual({ kind: 'maxConsecutive', staffId: 't', days: 4 })
  })
  it('シフトNG', () => {
    const r = parseRule('高橋は遅番に入れない', staff, shifts)
    expect(r.parsed).toEqual({ kind: 'forbidShift', staffId: 'k', shiftId: 'late' })
  })
  it('シフト限定', () => {
    const r = parseRule('高橋は早番のみ', staff, shifts)
    expect(r.parsed).toEqual({ kind: 'onlyShift', staffId: 'k', shiftId: 'early' })
  })
  it('曜日固定', () => {
    const r = parseRule('田中は金曜は早番固定', staff, shifts)
    expect(r.parsed).toEqual({ kind: 'fixWeekdayShift', staffId: 't', weekday: 5, shiftId: 'early' })
  })
  it('解釈できない文は null（メモとして保持）', () => {
    const r = parseRule('雨の日は多めに配置してほしい', staff, shifts)
    expect(r.parsed).toBeNull()
    expect(r.description).toContain('メモ')
  })
})
