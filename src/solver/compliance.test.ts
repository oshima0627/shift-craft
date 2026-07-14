import { describe, expect, it } from 'vitest'
import type { AppData, Assignment } from '../types'
import { validateSchedule } from './compliance'
import { computeCostReport } from './cost'

function data(overrides: Partial<AppData> = {}): AppData {
  return {
    roles: [{ id: 'r1', name: 'ホール', color: '#000' }],
    shifts: [
      { id: 'early', name: '早番', start: '09:00', end: '14:00' },
      { id: 'late', name: '遅番', start: '17:00', end: '23:30' },
    ],
    staff: [
      {
        id: 'a',
        name: 'A',
        roleIds: ['r1'],
        level: 1,
        hourlyWage: 1200,
        isMinor: false,
        maxShifts: null,
        maxConsecutive: null,
        weeklyMaxHours: null,
        weeklyMaxDays: null,
        unavailableDates: [],
        allowedShiftIds: [],
      },
      {
        id: 'm',
        name: 'M',
        roleIds: ['r1'],
        level: 0,
        hourlyWage: 1050,
        isMinor: true,
        maxShifts: null,
        maxConsecutive: null,
        weeklyMaxHours: null,
        weeklyMaxDays: null,
        unavailableDates: [],
        allowedShiftIds: [],
      },
    ],
    busynessLevels: [
      { id: 'low', name: '暇', color: '#86c9a0' },
      { id: 'mid', name: '普通', color: '#a7b3c2' },
      { id: 'high', name: '忙しい', color: '#e08a8a' },
    ],
    defaultBusynessLevelId: 'mid',
    weekendBusynessLevelId: 'high',
    dayBusyness: {},
    requirements: [],
    overrides: [],
    constraints: {
      incompatiblePairs: [],
      minExperiencedPerShift: 1,
      maxConsecutiveDefault: 6,
      restIntervalHours: 11,
      restIntervalHard: false,
      weeklyHoursCap: 40,
      allowSplitShifts: false,
      preferSplitShifts: false,
      weights: { fairness: 1, preference: 1, weekendFairness: 1, cost: 0 },
      customRules: [],
      notes: '',
    },
    cost: { salesTarget: 1000000, targetLaborRate: 30, includeWelfare: false },
    period: { start: '2026-08-02', end: '2026-08-15', holidays: [] },
    ...overrides,
  }
}

describe('validateSchedule（法令チェックエンジン）', () => {
  it('年少者の深夜シフトをエラーにする（労基法61条）', () => {
    const assignments: Assignment[] = [
      { date: '2026-08-03', shiftId: 'late', roleId: 'r1', staffId: 'm' },
    ]
    const { warnings } = validateSchedule(data(), assignments)
    const law = warnings.filter((w) => w.kind === 'law' && w.severity === 'error')
    expect(law.some((w) => w.message.includes('18歳未満'))).toBe(true)
  })

  it('クローピング（遅番→翌早番）を警告する', () => {
    const assignments: Assignment[] = [
      { date: '2026-08-03', shiftId: 'late', roleId: 'r1', staffId: 'a' },
      { date: '2026-08-04', shiftId: 'early', roleId: 'r1', staffId: 'a' },
    ]
    const { warnings } = validateSchedule(data(), assignments)
    // 23:30終業 → 9:00始業 = 9.5h < 11h
    expect(warnings.some((w) => w.message.includes('クローピング'))).toBe(true)
  })

  it('7連勤をエラーにする（週1休・労基法35条）', () => {
    const assignments: Assignment[] = []
    for (let d = 2; d <= 8; d++) {
      assignments.push({
        date: `2026-08-${String(d).padStart(2, '0')}`,
        shiftId: 'early',
        roleId: 'r1',
        staffId: 'a',
      })
    }
    const { warnings } = validateSchedule(data(), assignments)
    expect(
      warnings.some((w) => w.kind === 'law' && w.severity === 'error' && w.message.includes('連勤')),
    ).toBe(true)
  })

  it('新人のみのシフトを警告する', () => {
    const assignments: Assignment[] = [
      { date: '2026-08-03', shiftId: 'early', roleId: 'r1', staffId: 'm' },
    ]
    const { warnings } = validateSchedule(data(), assignments)
    expect(warnings.some((w) => w.kind === 'staffing')).toBe(true)
  })

  it('人数不足を検出する', () => {
    const d = data({
      requirements: [{ roleId: 'r1', shiftId: 'early', counts: { low: 1, mid: 1, high: 1 } }],
      // 2026-08-03 は既定段階 'mid' → mid:1 が要求される
      period: { start: '2026-08-03', end: '2026-08-03', holidays: [] },
    })
    const { unfilled } = validateSchedule(d, [])
    expect(unfilled).toHaveLength(1)
    expect(unfilled[0]).toMatchObject({ needed: 1, filled: 0 })
  })
})

describe('computeCostReport（人件費エンジン）', () => {
  it('基本給・深夜割増・指標を計算する', () => {
    const d = data()
    const assignments: Assignment[] = [
      // 遅番: 拘束6.5h、休憩45分、実働5.75h、深夜1.5h(22:00-23:30)
      { date: '2026-08-03', shiftId: 'late', roleId: 'r1', staffId: 'a' },
    ]
    const r = computeCostReport(d, assignments)
    const a = r.perStaff.find((x) => x.staffId === 'a')!
    expect(a.workMin).toBe(345) // 390 - 45
    expect(a.nightMin).toBe(90)
    expect(a.baseCost).toBe(Math.round((345 / 60) * 1200))
    expect(a.nightPremium).toBe(Math.round((90 / 60) * 1200 * 0.25))
    expect(r.grandTotal).toBe(a.total)
    expect(r.laborRate).toBeCloseTo((r.grandTotal / 1000000) * 100, 5)
    expect(r.salesPerLaborHour).toBeCloseTo(1000000 / (345 / 60), 5)
  })

  it('法定福利費15%を含められる', () => {
    const d = data({ cost: { salesTarget: null, targetLaborRate: 30, includeWelfare: true } })
    const assignments: Assignment[] = [
      { date: '2026-08-03', shiftId: 'early', roleId: 'r1', staffId: 'a' },
    ]
    const r = computeCostReport(d, assignments)
    expect(r.welfareCost).toBe(Math.round(r.totalCost * 0.15))
    expect(r.grandTotal).toBe(r.totalCost + r.welfareCost)
    expect(r.laborRate).toBeNull()
  })
})
