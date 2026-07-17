import { describe, expect, it } from 'vitest'
import type { AppData } from '../types'
import { busynessIdOf } from './busyness'
import { isClosedDay } from './requirements'

function baseData(overrides: Partial<AppData> = {}): AppData {
  return {
    roles: [{ id: 'r1', name: 'ホール', color: '#000' }],
    shifts: [{ id: 's1', name: '早番', start: '09:00', end: '17:00' }],
    staff: [],
    leaveTypes: [{ id: 'full', name: '全休', start: '00:00', end: '24:00' }],
    busynessLevels: [
      { id: 'low', name: '暇', color: '#86c9a0' },
      { id: 'mid', name: '普通', color: '#a7b3c2' },
      { id: 'high', name: '忙しい', color: '#e08a8a' },
    ],
    dayBusyness: {},
    defaultWeekdayLevel: 'mid',
    defaultWeekendLevel: 'high',
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
    period: { start: '2026-08-01', end: '2026-08-31', holidays: [] },
    ...overrides,
  }
}

describe('busynessIdOf 既定段階の固定', () => {
  const weekday = '2026-08-03' // 月曜
  const weekend = '2026-08-02' // 日曜

  it('平日は defaultWeekdayLevel、土日は defaultWeekendLevel を使う', () => {
    const data = baseData()
    expect(busynessIdOf(data, weekday)).toBe('mid')
    expect(busynessIdOf(data, weekend)).toBe('high')
  })

  it('段階を末尾に追加しても既定（固定ID）を指すので判定はずれない', () => {
    // 「段階4」を末尾に追加したのと同じ状態。既定IDは mid/high のまま
    const data = baseData({
      busynessLevels: [
        { id: 'low', name: '暇', color: '#86c9a0' },
        { id: 'mid', name: '普通', color: '#a7b3c2' },
        { id: 'high', name: '忙しい', color: '#e08a8a' },
        { id: 'busy4', name: '段階4', color: '#8a9ce0' },
      ],
    })
    // 末尾に追加しても土日は「忙しい(high)」のまま。「段階4」に変わらない
    expect(busynessIdOf(data, weekend)).toBe('high')
    expect(busynessIdOf(data, weekday)).toBe('mid')
  })

  it('既定IDが未設定なら段階の並びにフォールバックする（後方互換）', () => {
    const data = baseData({ defaultWeekdayLevel: undefined, defaultWeekendLevel: undefined })
    expect(busynessIdOf(data, weekend)).toBe('high') // 末尾
    expect(busynessIdOf(data, weekday)).toBe('mid') // 中間
  })

  it('個別指定(dayBusyness)は既定より優先される', () => {
    const data = baseData({ dayBusyness: { [weekend]: 'low' } })
    expect(busynessIdOf(data, weekend)).toBe('low')
  })
})

describe('isClosedDay 特定日の休業・営業', () => {
  it('曜日の定休日は休業', () => {
    const monday = '2026-08-03'
    const data = baseData({
      constraints: { ...baseData().constraints, closedWeekdays: [1] },
    })
    expect(isClosedDay(data, monday)).toBe(true)
  })

  it('特定日の休業(closedDates)は休業', () => {
    const data = baseData({
      constraints: { ...baseData().constraints, closedDates: ['2026-08-05'] },
    })
    expect(isClosedDay(data, '2026-08-05')).toBe(true)
    expect(isClosedDay(data, '2026-08-06')).toBe(false)
  })

  it('特定日の営業(openDates)は定休曜日より優先されて営業', () => {
    const data = baseData({
      constraints: {
        ...baseData().constraints,
        closedWeekdays: [1], // 月曜定休
        openDates: ['2026-08-03'], // でも 8/3(月) は臨時営業
      },
    })
    expect(isClosedDay(data, '2026-08-03')).toBe(false)
    expect(isClosedDay(data, '2026-08-10')).toBe(true) // 同じ月曜だが臨時営業ではない
  })
})
