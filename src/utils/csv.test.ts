import { describe, expect, it } from 'vitest'
import type { AppData, ScheduleResult } from '../types'
import { buildCsvRows, toCsvText } from './csv'

function baseData(overrides: Partial<AppData> = {}): AppData {
  return {
    roles: [{ id: 'r1', name: 'ホール', color: '#000' }],
    shifts: [
      { id: 'early', name: '早番', start: '10:00', end: '14:00' },
      { id: 'late', name: '遅番', start: '17:00', end: '21:00' },
    ],
    staff: [
      { id: 'sato', name: '佐藤', roleIds: ['r1'], level: 1, hourlyWage: 1100, isMinor: false, maxShifts: null, maxConsecutive: null, weeklyMaxHours: null, weeklyMaxDays: null, leaves: [], allowedShiftIds: [] },
      { id: 'suzuki', name: '鈴木', roleIds: ['r1'], level: 1, hourlyWage: 1100, isMinor: false, maxShifts: null, maxConsecutive: null, weeklyMaxHours: null, weeklyMaxDays: null, leaves: [], allowedShiftIds: [] },
    ],
    leaveTypes: [{ id: 'full', name: '全休', start: '00:00', end: '24:00' }],
    busynessLevels: [{ id: 'mid', name: '普通', color: '#a7b3c2' }],
    dayBusyness: {},
    requirements: [],
    overrides: [],
    constraints: {
      incompatiblePairs: [],
      minExperiencedPerShift: 0,
      maxConsecutiveDefault: 6,
      restIntervalHours: 0,
      restIntervalHard: false,
      weeklyHoursCap: 40,
      allowSplitShifts: true,
      preferSplitShifts: false,
      weights: { fairness: 1, preference: 1, weekendFairness: 1, cost: 0 },
      customRules: [],
      notes: '',
    },
    cost: { salesTarget: null, targetLaborRate: 30, includeWelfare: false },
    period: { start: '2026-07-01', end: '2026-07-01', holidays: [] },
    ...overrides,
  }
}

describe('CSV出力（分割勤務は行を分ける）', () => {
  it('同じ日に早番+遅番の人はシフトごとに行が分かれる', () => {
    const result: ScheduleResult = {
      assignments: [
        { date: '2026-07-01', shiftId: 'early', roleId: 'r1', staffId: 'sato' },
        { date: '2026-07-01', shiftId: 'late', roleId: 'r1', staffId: 'sato' },
        { date: '2026-07-01', shiftId: 'late', roleId: 'r1', staffId: 'suzuki' },
      ],
      unfilled: [],
      warnings: [],
      staffLoad: { sato: 2, suzuki: 1 },
      score: 0,
    }
    const rows = buildCsvRows(baseData(), result)
    // ヘッダ
    expect(rows[0]).toEqual(['スタッフ', '7/1(水)', '出勤数'])
    // 佐藤: 1行目=早番（名前＋出勤数）、2行目=遅番（名前空欄）
    expect(rows[1]).toEqual(['佐藤', '早番', '2'])
    expect(rows[2]).toEqual(['', '遅番', ''])
    // 鈴木: 1コマなので1行だけ
    expect(rows[3]).toEqual(['鈴木', '遅番', '1'])
    expect(rows).toHaveLength(4)
  })

  it('シフトは定義順（早番→遅番）に並ぶ（割り当て順に依存しない）', () => {
    const result: ScheduleResult = {
      assignments: [
        // わざと遅番を先に入れても、出力は早番→遅番
        { date: '2026-07-01', shiftId: 'late', roleId: 'r1', staffId: 'sato' },
        { date: '2026-07-01', shiftId: 'early', roleId: 'r1', staffId: 'sato' },
      ],
      unfilled: [],
      warnings: [],
      staffLoad: { sato: 2, suzuki: 0 },
      score: 0,
    }
    const rows = buildCsvRows(baseData(), result)
    expect(rows[1]).toEqual(['佐藤', '早番', '2'])
    expect(rows[2]).toEqual(['', '遅番', ''])
    // 出勤なしの鈴木は1行・空欄
    expect(rows[3]).toEqual(['鈴木', '', '0'])
  })

  it('toCsvText は各セルを引用符で囲みCRLF区切りにする', () => {
    const text = toCsvText([
      ['スタッフ', '7/1(水)'],
      ['佐藤', '早番'],
    ])
    expect(text).toBe('"スタッフ","7/1(水)"\r\n"佐藤","早番"')
  })
})
