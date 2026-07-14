import { describe, expect, it } from 'vitest'
import type { AppData } from '../types'
import { generateSchedule } from './scheduler'

function baseData(overrides: Partial<AppData> = {}): AppData {
  const data: AppData = {
    roles: [{ id: 'r1', name: 'ホール', color: '#3b6fe0' }],
    shifts: [{ id: 's1', name: '早番', start: '09:00', end: '17:00' }],
    staff: [],
    requirements: [
      { roleId: 'r1', shiftId: 's1', counts: { weekday: 1, saturday: 1, sunday: 1, holiday: 1 } },
    ],
    constraints: {
      incompatiblePairs: [],
      minExperiencedPerShift: 0,
      weights: { fairness: 1, preference: 1 },
      notes: '',
    },
    period: { start: '2026-08-01', end: '2026-08-07', holidays: [] },
    ...overrides,
  }
  return data
}

const staff = (
  id: string,
  opts: Partial<AppData['staff'][number]> = {},
): AppData['staff'][number] => ({
  id,
  name: id,
  roleIds: ['r1'],
  level: 1,
  maxShifts: null,
  maxConsecutive: null,
  unavailableDates: [],
  allowedShiftIds: [],
  ...opts,
})

describe('generateSchedule', () => {
  it('必要人数を満たす（十分な人数がいる場合）', () => {
    const data = baseData({ staff: [staff('a'), staff('b'), staff('c')] })
    const res = generateSchedule(data)
    expect(res.unfilled).toHaveLength(0)
    // 7日 × 1名 = 7割り当て
    expect(res.assignments).toHaveLength(7)
  })

  it('人数不足なら unfilled として報告する', () => {
    const data = baseData({
      staff: [staff('a', { maxShifts: 2 })],
      // 1人しかいないので7日埋められない
    })
    const res = generateSchedule(data)
    const shortage = res.unfilled.reduce((n, u) => n + (u.needed - u.filled), 0)
    expect(shortage).toBeGreaterThan(0)
  })

  it('H4: 出勤不可日には割り当てない', () => {
    const data = baseData({
      staff: [staff('a', { unavailableDates: ['2026-08-03'] }), staff('b')],
    })
    const res = generateSchedule(data)
    const aOn3 = res.assignments.find((x) => x.staffId === 'a' && x.date === '2026-08-03')
    expect(aOn3).toBeUndefined()
  })

  it('H5: 出勤上限を超えない', () => {
    const data = baseData({
      staff: [staff('a', { maxShifts: 3 }), staff('b'), staff('c')],
    })
    const res = generateSchedule(data)
    expect(res.staffLoad['a']).toBeLessThanOrEqual(3)
  })

  it('H5: 連勤上限を超えない', () => {
    const data = baseData({
      period: { start: '2026-08-01', end: '2026-08-10', holidays: [] },
      requirements: [
        { roleId: 'r1', shiftId: 's1', counts: { weekday: 1, saturday: 1, sunday: 1, holiday: 1 } },
      ],
      staff: [staff('a', { maxConsecutive: 2 })],
    })
    const res = generateSchedule(data)
    // a の出勤日で3連勤が発生していないこと
    const aDates = res.assignments
      .filter((x) => x.staffId === 'a')
      .map((x) => x.date)
      .sort()
    let run = 1
    let maxRun = aDates.length ? 1 : 0
    for (let i = 1; i < aDates.length; i++) {
      const prev = new Date(aDates[i - 1])
      const cur = new Date(aDates[i])
      const diff = (cur.getTime() - prev.getTime()) / 86400000
      if (diff === 1) run++
      else run = 1
      maxRun = Math.max(maxRun, run)
    }
    expect(maxRun).toBeLessThanOrEqual(2)
  })

  it('H2: NGペアは同じ日に割り当てない', () => {
    const data = baseData({
      requirements: [
        { roleId: 'r1', shiftId: 's1', counts: { weekday: 2, saturday: 2, sunday: 2, holiday: 2 } },
      ],
      staff: [staff('a'), staff('b'), staff('c'), staff('d')],
      constraints: {
        incompatiblePairs: [{ a: 'a', b: 'b' }],
        minExperiencedPerShift: 0,
        weights: { fairness: 1, preference: 1 },
        notes: '',
      },
    })
    const res = generateSchedule(data)
    // 各日 a と b が同居していないこと
    const byDate = new Map<string, Set<string>>()
    for (const x of res.assignments) {
      if (!byDate.has(x.date)) byDate.set(x.date, new Set())
      byDate.get(x.date)!.add(x.staffId)
    }
    for (const set of byDate.values()) {
      expect(set.has('a') && set.has('b')).toBe(false)
    }
  })

  it('H3: 各シフトに経験者を最低1名配置する', () => {
    const data = baseData({
      requirements: [
        { roleId: 'r1', shiftId: 's1', counts: { weekday: 2, saturday: 2, sunday: 2, holiday: 2 } },
      ],
      // 新人2名 + 経験者2名
      staff: [
        staff('n1', { level: 0 }),
        staff('n2', { level: 0 }),
        staff('e1', { level: 1 }),
        staff('e2', { level: 2 }),
      ],
      constraints: {
        incompatiblePairs: [],
        minExperiencedPerShift: 1,
        weights: { fairness: 1, preference: 1 },
        notes: '',
      },
    })
    const res = generateSchedule(data)
    const experienced = new Set(['e1', 'e2'])
    const byDate = new Map<string, string[]>()
    for (const x of res.assignments) {
      if (!byDate.has(x.date)) byDate.set(x.date, [])
      byDate.get(x.date)!.push(x.staffId)
    }
    for (const [, ids] of byDate) {
      const expCount = ids.filter((id) => experienced.has(id)).length
      expect(expCount).toBeGreaterThanOrEqual(1)
    }
    // 警告(経験者不足)が出ていないこと
    expect(res.warnings.filter((w) => w.severity === 'warning')).toHaveLength(0)
  })

  it('H6: 同じ人を同じ日に重複させない', () => {
    const data = baseData({
      shifts: [
        { id: 's1', name: '早番', start: '09:00', end: '13:00' },
        { id: 's2', name: '遅番', start: '13:00', end: '21:00' },
      ],
      requirements: [
        { roleId: 'r1', shiftId: 's1', counts: { weekday: 1, saturday: 1, sunday: 1, holiday: 1 } },
        { roleId: 'r1', shiftId: 's2', counts: { weekday: 1, saturday: 1, sunday: 1, holiday: 1 } },
      ],
      staff: [staff('a'), staff('b')],
    })
    const res = generateSchedule(data)
    const seen = new Map<string, Set<string>>()
    for (const x of res.assignments) {
      const key = x.date
      if (!seen.has(key)) seen.set(key, new Set())
      const set = seen.get(key)!
      expect(set.has(x.staffId)).toBe(false) // 同日重複なし
      set.add(x.staffId)
    }
  })

  it('S1: 出勤回数が概ね公平になる', () => {
    const data = baseData({
      staff: [staff('a'), staff('b'), staff('c'), staff('d'), staff('e'), staff('f'), staff('g')],
    })
    const res = generateSchedule(data)
    const loads = Object.values(res.staffLoad)
    const max = Math.max(...loads)
    const min = Math.min(...loads)
    // 7日を7人で回すので偏りは小さいはず
    expect(max - min).toBeLessThanOrEqual(2)
  })

  it('決定的: 同じ入力からは同じ結果', () => {
    const data = baseData({ staff: [staff('a'), staff('b'), staff('c')] })
    const r1 = generateSchedule(data)
    const r2 = generateSchedule(data)
    expect(r1.assignments).toEqual(r2.assignments)
  })
})
