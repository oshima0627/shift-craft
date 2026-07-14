import { describe, expect, it } from 'vitest'
import type { AppData, Constraints } from '../types'
import { generateSchedule } from './scheduler'

function baseConstraints(overrides: Partial<Constraints> = {}): Constraints {
  return {
    incompatiblePairs: [],
    minExperiencedPerShift: 0,
    maxConsecutiveDefault: 6,
    restIntervalHours: 0,
    restIntervalHard: false,
    weeklyHoursCap: 40,
    allowSplitShifts: true,
    weights: { fairness: 1, preference: 1, weekendFairness: 1, cost: 0 },
    customRules: [],
    notes: '',
    ...overrides,
  }
}

function baseData(overrides: Partial<AppData> = {}): AppData {
  const data: AppData = {
    roles: [{ id: 'r1', name: 'ホール', color: '#3b6fe0' }],
    shifts: [{ id: 's1', name: '早番', start: '09:00', end: '17:00' }],
    staff: [],
    requirements: [
      { roleId: 'r1', shiftId: 's1', counts: { weekday: 1, saturday: 1, sunday: 1, holiday: 1 } },
    ],
    overrides: [],
    constraints: baseConstraints(),
    cost: { salesTarget: null, targetLaborRate: 30, includeWelfare: false },
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
  hourlyWage: 1100,
  isMinor: false,
  maxShifts: null,
  maxConsecutive: null,
  weeklyMaxHours: null,
  weeklyMaxDays: null,
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
      constraints: baseConstraints({ incompatiblePairs: [{ a: 'a', b: 'b' }] }),
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
      constraints: baseConstraints({ minExperiencedPerShift: 1 }),
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

  // ===== 労働法制約（調査に基づく追加分） =====

  it('H7: 18歳未満は22時を超えるシフトに入らない（労基法61条）', () => {
    const data = baseData({
      shifts: [
        { id: 's1', name: '早番', start: '09:00', end: '17:00' },
        { id: 's2', name: '遅番', start: '15:00', end: '23:00' },
      ],
      requirements: [
        { roleId: 'r1', shiftId: 's1', counts: { weekday: 1, saturday: 1, sunday: 1, holiday: 1 } },
        { roleId: 'r1', shiftId: 's2', counts: { weekday: 1, saturday: 1, sunday: 1, holiday: 1 } },
      ],
      staff: [staff('minor', { isMinor: true }), staff('adult')],
    })
    const res = generateSchedule(data)
    const minorLate = res.assignments.filter((a) => a.staffId === 'minor' && a.shiftId === 's2')
    expect(minorLate).toHaveLength(0)
    // 大人は遅番に入れる
    expect(res.assignments.some((a) => a.staffId === 'adult' && a.shiftId === 's2')).toBe(true)
  })

  it('H8: 週の実働時間が法定上限(40h)を超えない（労基法32条）', () => {
    // 早番: 拘束8h - 休憩45分 = 実働7h15m。6日で43.5h > 40h → 週内は5日まで
    const data = baseData({
      period: { start: '2026-08-02', end: '2026-08-08', holidays: [] }, // 日〜土の1週間
      staff: [staff('a')],
    })
    const res = generateSchedule(data)
    const aDays = res.assignments.filter((x) => x.staffId === 'a').length
    // 7h15m × 5日 = 36.25h（OK）/ 6日 = 43.5h（NG）
    expect(aDays).toBeLessThanOrEqual(5)
    expect(res.warnings.filter((w) => w.kind === 'law' && w.severity === 'error')).toHaveLength(0)
  })

  it('H9: 週の出勤は最大6日（週1休・労基法35条）', () => {
    // 実働の短いシフトなら時間上限に当たらないが、日数上限6日が効く
    const data = baseData({
      shifts: [{ id: 's1', name: '短時間', start: '10:00', end: '14:00' }],
      period: { start: '2026-08-02', end: '2026-08-08', holidays: [] },
      constraints: baseConstraints({ maxConsecutiveDefault: 12 }), // 連勤制約を緩めて日数制約を検証
      staff: [staff('a')],
    })
    const res = generateSchedule(data)
    expect(res.assignments.filter((x) => x.staffId === 'a').length).toBeLessThanOrEqual(6)
  })

  it('H10: 勤務間インターバル(ハード)でクローピングを防ぐ', () => {
    const data = baseData({
      shifts: [
        { id: 'early', name: '早番', start: '09:00', end: '14:00' },
        { id: 'late', name: '遅番', start: '17:00', end: '23:30' },
      ],
      requirements: [
        { roleId: 'r1', shiftId: 'early', counts: { weekday: 1, saturday: 1, sunday: 1, holiday: 1 } },
        { roleId: 'r1', shiftId: 'late', counts: { weekday: 1, saturday: 1, sunday: 1, holiday: 1 } },
      ],
      constraints: baseConstraints({ restIntervalHours: 11, restIntervalHard: true }),
      staff: [staff('a'), staff('b'), staff('c')],
    })
    const res = generateSchedule(data)
    // 遅番(〜23:30)→翌早番(9:00〜)は休息9.5h < 11h なので存在しないはず
    const byStaffDate = new Map<string, string>()
    for (const a of res.assignments) byStaffDate.set(`${a.staffId}|${a.date}`, a.shiftId)
    for (const a of res.assignments) {
      if (a.shiftId !== 'late') continue
      const next = new Date(a.date)
      next.setDate(next.getDate() + 1)
      const nextStr = next.toISOString().slice(0, 10)
      expect(byStaffDate.get(`${a.staffId}|${nextStr}`)).not.toBe('early')
    }
    expect(res.warnings.filter((w) => w.message.includes('クローピング'))).toHaveLength(0)
  })

  it('H11: カスタム条件（曜日NG・週N日まで）を守る', () => {
    const data = baseData({
      staff: [staff('a'), staff('b')],
      constraints: baseConstraints({
        customRules: [
          { id: 'c1', text: 'aは月曜は休み', parsed: { kind: 'forbidWeekday', staffId: 'a', weekday: 1 } },
          { id: 'c2', text: 'bは週2日まで', parsed: { kind: 'maxDaysPerWeek', staffId: 'b', days: 2 } },
        ],
      }),
    })
    const res = generateSchedule(data)
    // 2026-08-03 は月曜
    expect(res.assignments.some((x) => x.staffId === 'a' && x.date === '2026-08-03')).toBe(false)
    // b は週2日まで（期間は 8/1(土) と 8/2〜8 の2週にまたがる）
    const bDates = res.assignments.filter((x) => x.staffId === 'b').map((x) => x.date)
    const week1 = bDates.filter((d) => d === '2026-08-01').length
    const week2 = bDates.filter((d) => d >= '2026-08-02').length
    expect(week1).toBeLessThanOrEqual(2)
    expect(week2).toBeLessThanOrEqual(2)
  })

  it('特定日の上書き: 「この日は◯人」が曜日区分より優先される', () => {
    const data = baseData({
      staff: [staff('a'), staff('b'), staff('c')],
      overrides: [
        { date: '2026-08-05', roleId: 'r1', shiftId: 's1', count: 3 }, // 平日1名→3名に増員
        { date: '2026-08-06', roleId: 'r1', shiftId: 's1', count: 0 }, // この日は枠なし
      ],
    })
    const res = generateSchedule(data)
    expect(res.assignments.filter((x) => x.date === '2026-08-05')).toHaveLength(3)
    expect(res.assignments.filter((x) => x.date === '2026-08-06')).toHaveLength(0)
    expect(res.unfilled).toHaveLength(0)
  })

  it('修復パス: 貪欲法が詰まる配置を同日入れ替えで充足する', () => {
    // A は r1/r2 両対応、B は r1 のみ。希望シフト優遇で A が先に r1 を取ると
    // r2 が埋まらない → 修復パスで A を r2 へ移し、B を r1 に入れる
    const data = baseData({
      roles: [
        { id: 'r1', name: 'ホール', color: '#000' },
        { id: 'r2', name: 'キッチン', color: '#111' },
      ],
      requirements: [
        { roleId: 'r1', shiftId: 's1', counts: { weekday: 1, saturday: 1, sunday: 1, holiday: 1 } },
        { roleId: 'r2', shiftId: 's1', counts: { weekday: 1, saturday: 1, sunday: 1, holiday: 1 } },
      ],
      period: { start: '2026-08-03', end: '2026-08-03', holidays: [] },
      staff: [
        staff('a', { roleIds: ['r1', 'r2'], allowedShiftIds: ['s1'] }), // 希望一致で優先されがち
        staff('b', { roleIds: ['r1'] }),
      ],
    })
    // attempts=1 でリスタートに頼らず修復パスだけで解けることを確認
    const res = generateSchedule(data, 1)
    expect(res.unfilled).toHaveLength(0)
    expect(res.assignments).toHaveLength(2)
    const byRole = new Map(res.assignments.map((x) => [x.roleId, x.staffId]))
    expect(byRole.get('r2')).toBe('a') // r2 は A しかできない
    expect(byRole.get('r1')).toBe('b')
  })

  it('分割勤務ON: 時間帯が重ならなければ同じ人を早番+遅番に入れられる', () => {
    // 1人しかいないが、早番(09-13)と遅番(14-18)は重ならない → 両方に入れる
    const data = baseData({
      shifts: [
        { id: 'early', name: '早番', start: '09:00', end: '13:00' },
        { id: 'late', name: '遅番', start: '14:00', end: '18:00' },
      ],
      requirements: [
        { roleId: 'r1', shiftId: 'early', counts: { weekday: 1, saturday: 1, sunday: 1, holiday: 1 } },
        { roleId: 'r1', shiftId: 'late', counts: { weekday: 1, saturday: 1, sunday: 1, holiday: 1 } },
      ],
      period: { start: '2026-08-03', end: '2026-08-03', holidays: [] },
      staff: [staff('a')],
      constraints: baseConstraints({ allowSplitShifts: true }),
    })
    const res = generateSchedule(data)
    expect(res.unfilled).toHaveLength(0)
    const aShifts = res.assignments.filter((x) => x.staffId === 'a' && x.date === '2026-08-03')
    expect(aShifts).toHaveLength(2)
    expect(res.warnings.filter((w) => w.severity === 'error')).toHaveLength(0)
  })

  it('分割勤務OFF: 同じ人を同じ日に2シフト入れない（1つは未充足になる）', () => {
    const data = baseData({
      shifts: [
        { id: 'early', name: '早番', start: '09:00', end: '13:00' },
        { id: 'late', name: '遅番', start: '14:00', end: '18:00' },
      ],
      requirements: [
        { roleId: 'r1', shiftId: 'early', counts: { weekday: 1, saturday: 1, sunday: 1, holiday: 1 } },
        { roleId: 'r1', shiftId: 'late', counts: { weekday: 1, saturday: 1, sunday: 1, holiday: 1 } },
      ],
      period: { start: '2026-08-03', end: '2026-08-03', holidays: [] },
      staff: [staff('a')],
      constraints: baseConstraints({ allowSplitShifts: false }),
    })
    const res = generateSchedule(data)
    const aShifts = res.assignments.filter((x) => x.staffId === 'a' && x.date === '2026-08-03')
    expect(aShifts).toHaveLength(1)
    expect(res.unfilled.reduce((n, u) => n + (u.needed - u.filled), 0)).toBe(1)
  })

  it('分割勤務ON: 時間帯が重なるシフトには同じ人を入れない', () => {
    // 早番(09-15)と遅番(13-19)は重なる → 1人では両方入れられず1つ未充足
    const data = baseData({
      shifts: [
        { id: 'early', name: '早番', start: '09:00', end: '15:00' },
        { id: 'late', name: '遅番', start: '13:00', end: '19:00' },
      ],
      requirements: [
        { roleId: 'r1', shiftId: 'early', counts: { weekday: 1, saturday: 1, sunday: 1, holiday: 1 } },
        { roleId: 'r1', shiftId: 'late', counts: { weekday: 1, saturday: 1, sunday: 1, holiday: 1 } },
      ],
      period: { start: '2026-08-03', end: '2026-08-03', holidays: [] },
      staff: [staff('a')],
      constraints: baseConstraints({ allowSplitShifts: true }),
    })
    const res = generateSchedule(data)
    const aShifts = res.assignments.filter((x) => x.staffId === 'a')
    expect(aShifts).toHaveLength(1) // 重なるので片方だけ
    expect(res.unfilled.reduce((n, u) => n + (u.needed - u.filled), 0)).toBe(1)
  })

  it('分割勤務でも週の実働時間・連勤などの法令チェックは維持される', () => {
    // 早番(09-13,実働4h)+遅番(14-18,実働4h)=1日8h。7日で56h→週40h上限で日数制限
    const data = baseData({
      shifts: [
        { id: 'early', name: '早番', start: '09:00', end: '13:00' },
        { id: 'late', name: '遅番', start: '14:00', end: '18:00' },
      ],
      requirements: [
        { roleId: 'r1', shiftId: 'early', counts: { weekday: 1, saturday: 1, sunday: 1, holiday: 1 } },
        { roleId: 'r1', shiftId: 'late', counts: { weekday: 1, saturday: 1, sunday: 1, holiday: 1 } },
      ],
      period: { start: '2026-08-02', end: '2026-08-08', holidays: [] },
      staff: [staff('a')],
      constraints: baseConstraints({ allowSplitShifts: true }),
    })
    const res = generateSchedule(data)
    // 週40h以内・週6日以内・法令エラーなしが守られること
    expect(res.warnings.filter((w) => w.kind === 'law' && w.severity === 'error')).toHaveLength(0)
  })

  it('S3: 土日祝の出勤が概ね公平になる', () => {
    const data = baseData({
      period: { start: '2026-08-01', end: '2026-08-31', holidays: [] },
      staff: [staff('a'), staff('b'), staff('c'), staff('d')],
      constraints: baseConstraints({ weights: { fairness: 1, preference: 1, weekendFairness: 3, cost: 0 } }),
    })
    const res = generateSchedule(data)
    const weekendCount: Record<string, number> = { a: 0, b: 0, c: 0, d: 0 }
    for (const x of res.assignments) {
      const dow = new Date(x.date + 'T00:00:00').getDay()
      if (dow === 0 || dow === 6) weekendCount[x.staffId]++
    }
    const counts = Object.values(weekendCount)
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(3)
  })
})
