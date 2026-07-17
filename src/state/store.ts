import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  AppData,
  BusynessLevel,
  Constraints,
  CostSettings,
  LeaveType,
  PeriodSettings,
  Requirement,
  RequirementOverride,
  Role,
  ShiftType,
  Staff,
} from '../types'

let idCounter = 0
/** 決定論を保つため Date/Math.random は使わずカウンタでID生成 */
export function newId(prefix: string): string {
  idCounter++
  return `${prefix}_${Date.now().toString(36)}_${idCounter}`
}

function defaultConstraints(): Constraints {
  return {
    incompatiblePairs: [],
    // NGペアは既定で厳守（オフにすると警告のみ）
    incompatibleHard: true,
    // 定休日（毎週の休業曜日）。既定は無し
    closedWeekdays: [],
    minExperiencedPerShift: 1,
    // 労基法35条（週1休）→ 原則6連勤まで
    maxConsecutiveDefault: 6,
    // 勤務間インターバル: 努力義務。厚労省ガイドラインの目安 9〜11h
    restIntervalHours: 9,
    restIntervalHard: false,
    // 法定労働時間 40h（常時10人未満の商業・サービス業は特例で44h）
    weeklyHoursCap: 40,
    // 早番→遅番など時間帯が重ならなければ同日に複数シフトを許可
    allowSplitShifts: true,
    // 既定は「足りない時だけ分割」。ONにすると余裕があっても積極的に分割で回す
    preferSplitShifts: false,
    weights: { fairness: 1, preference: 1, weekendFairness: 1, cost: 0 },
    customRules: [],
    notes: '',
  }
}

function defaultCost(): CostSettings {
  return {
    salesTarget: null,
    // 飲食店の人件費率の目安 25〜30%（FL比率60%以内）
    targetLaborRate: 30,
    includeWelfare: false,
  }
}

function defaultData(): AppData {
  const r1: Role = { id: 'role_hall', name: 'ホール', color: '#3b6fe0' }
  const r2: Role = { id: 'role_kitchen', name: 'キッチン', color: '#e0733b' }
  const s1: ShiftType = { id: 'shift_early', name: '早番', start: '10:00', end: '14:00' }
  const s2: ShiftType = { id: 'shift_late', name: '遅番', start: '17:00', end: '21:00' }

  // 既定ではスタッフ未登録（利用者が自分の店舗に合わせて追加する）
  const staff: Staff[] = []

  // 忙しさ段階（低→高）。既定は3段階
  const levels = defaultBusynessLevels()

  const requirements: Requirement[] = [
    { roleId: 'role_hall', shiftId: 'shift_early', counts: { busy_low: 1, busy_mid: 1, busy_high: 2 } },
    { roleId: 'role_hall', shiftId: 'shift_late', counts: { busy_low: 1, busy_mid: 1, busy_high: 2 } },
    { roleId: 'role_kitchen', shiftId: 'shift_early', counts: { busy_low: 1, busy_mid: 1, busy_high: 1 } },
    { roleId: 'role_kitchen', shiftId: 'shift_late', counts: { busy_low: 1, busy_mid: 1, busy_high: 1 } },
  ]

  const period: PeriodSettings = firstOfNextMonthPeriod()

  return {
    roles: [r1, r2],
    shifts: [s1, s2],
    staff,
    leaveTypes: defaultLeaveTypes(),
    busynessLevels: levels,
    dayBusyness: {},
    requirements,
    overrides: [],
    constraints: defaultConstraints(),
    cost: defaultCost(),
    period,
  }
}

function defaultBusynessLevels(): BusynessLevel[] {
  return [
    { id: 'busy_low', name: '暇', color: '#86c9a0' },
    { id: 'busy_mid', name: '普通', color: '#a7b3c2' },
    { id: 'busy_high', name: '忙しい', color: '#e08a8a' },
  ]
}

function defaultLeaveTypes(): LeaveType[] {
  return [
    { id: 'leave_full', name: '全休', start: '00:00', end: '24:00' },
    { id: 'leave_am', name: '午前休', start: '10:00', end: '14:00' },
    { id: 'leave_pm', name: '午後休', start: '17:00', end: '21:00' },
  ]
}

/** 15人ぶんのテストデータ（デモ・動作確認用） */
function sampleData(): AppData {
  const roles: Role[] = [
    { id: 'role_hall', name: 'ホール', color: '#3b6fe0' },
    { id: 'role_kitchen', name: 'キッチン', color: '#e0733b' },
    { id: 'role_register', name: 'レジ', color: '#8b5cf6' },
  ]
  // 早番と遅番は時間帯が重ならない（分割勤務が可能）
  const shifts: ShiftType[] = [
    { id: 'shift_early', name: '早番', start: '09:00', end: '16:00' },
    { id: 'shift_late', name: '遅番', start: '16:00', end: '23:00' },
  ]

  // 15人（氏名 / 担当役割 / 経験レベル / 時給 / 18歳未満）
  const defs: [string, string[], 0 | 1 | 2, number, boolean][] = [
    ['佐藤', ['role_hall', 'role_register'], 2, 1350, false],
    ['鈴木', ['role_kitchen'], 2, 1400, false],
    ['高橋', ['role_hall'], 1, 1200, false],
    ['田中', ['role_kitchen', 'role_hall'], 1, 1250, false],
    ['伊藤', ['role_register'], 1, 1150, false],
    ['渡辺', ['role_hall'], 0, 1050, true],
    ['山本', ['role_kitchen'], 2, 1380, false],
    ['中村', ['role_hall', 'role_register'], 1, 1200, false],
    ['小林', ['role_kitchen'], 0, 1050, false],
    ['加藤', ['role_hall'], 1, 1180, false],
    ['吉田', ['role_register', 'role_hall'], 2, 1300, false],
    ['山田', ['role_kitchen', 'role_hall'], 1, 1220, false],
    ['佐々木', ['role_hall'], 0, 1000, true],
    ['山口', ['role_register'], 1, 1150, false],
    ['松本', ['role_kitchen'], 1, 1230, false],
  ]

  const period = firstOfNextMonthPeriod()
  const ym = period.start.slice(0, 7) // "yyyy-MM"
  // 一部スタッフに希望休を付与（当月内の日付）
  const dayOff: Record<string, string[]> = {
    佐藤: [`${ym}-07`, `${ym}-21`],
    高橋: [`${ym}-05`, `${ym}-06`],
    伊藤: [`${ym}-14`],
    小林: [`${ym}-10`, `${ym}-24`],
    吉田: [`${ym}-18`],
    松本: [`${ym}-03`, `${ym}-17`],
  }

  let seq = 0
  const staff: Staff[] = defs.map(([name, roleIds, level, wage, minor]) => {
    seq++
    return {
      id: `staff_sample_${seq}`,
      name,
      roleIds,
      level,
      hourlyWage: wage,
      isMinor: minor,
      maxShifts: null,
      maxConsecutive: 5,
      weeklyMaxHours: null,
      weeklyMaxDays: null,
      // サンプルは一部を全休、一部を時間休にして分かりやすく
      leaves: (dayOff[name] ?? []).map((d, i) => ({
        date: d,
        typeId: i % 3 === 1 ? 'leave_am' : i % 3 === 2 ? 'leave_pm' : 'leave_full',
      })),
      allowedShiftIds: [],
    }
  })

  const levels = defaultBusynessLevels()
  // 必要人数（暇/普通/忙しい）。忙しいほど厚く
  const req = (roleId: string, shiftId: string, low: number, mid: number, high: number): Requirement => ({
    roleId,
    shiftId,
    counts: { busy_low: low, busy_mid: mid, busy_high: high },
  })
  const requirements: Requirement[] = [
    req('role_hall', 'shift_early', 1, 2, 3),
    req('role_hall', 'shift_late', 1, 2, 3),
    req('role_kitchen', 'shift_early', 1, 1, 2),
    req('role_kitchen', 'shift_late', 1, 2, 2),
    req('role_register', 'shift_early', 1, 1, 1),
    req('role_register', 'shift_late', 1, 1, 2),
  ]

  return {
    roles,
    shifts,
    staff,
    leaveTypes: defaultLeaveTypes(),
    busynessLevels: levels,
    dayBusyness: {},
    requirements,
    overrides: [],
    constraints: defaultConstraints(),
    cost: defaultCost(),
    period,
  }
}

function firstOfNextMonthPeriod(): PeriodSettings {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() // 0-based, 当月
  const start = new Date(year, month, 1)
  const end = new Date(year, month + 1, 0) // 当月末
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return { start: fmt(start), end: fmt(end), holidays: [] }
}

/**
 * 旧バージョン・外部インポートのデータを現行スキーマに正規化する。
 * 欠けているフィールドにデフォルトを補う。
 */
export function normalizeData(raw: unknown): AppData {
  const base = defaultData()
  const d = (raw ?? {}) as Partial<AppData>
  const constraints: Constraints = {
    ...defaultConstraints(),
    ...(d.constraints ?? {}),
    weights: { ...defaultConstraints().weights, ...(d.constraints?.weights ?? {}) },
    customRules: d.constraints?.customRules ?? [],
  }
  const cost: CostSettings = { ...defaultCost(), ...(d.cost ?? {}) }
  // 休みの種類（無ければ既定）
  const leaveTypes: LeaveType[] =
    Array.isArray(d.leaveTypes) && d.leaveTypes.length > 0 ? d.leaveTypes : defaultLeaveTypes()
  const staff: Staff[] = (d.staff ?? base.staff).map((s) => {
    // 旧スキーマ unavailableDates（全休の配列）を leaves へ移行
    const legacy = (s as unknown as { unavailableDates?: string[] }).unavailableDates
    const leaves =
      s.leaves ??
      (Array.isArray(legacy) ? legacy.map((date) => ({ date, typeId: 'leave_full' })) : [])
    return {
      ...s,
      hourlyWage: s.hourlyWage ?? 1100,
      isMinor: s.isMinor ?? false,
      weeklyMaxHours: s.weeklyMaxHours ?? null,
      weeklyMaxDays: s.weeklyMaxDays ?? null,
      leaves,
    }
  })

  // 忙しさ段階（無ければ既定3段階を補完）
  const busynessLevels: BusynessLevel[] =
    Array.isArray(d.busynessLevels) && d.busynessLevels.length > 0
      ? d.busynessLevels
      : base.busynessLevels
  // 必要人数: 旧スキーマ（曜日区分キー）を忙しさ段階キーへ移行
  const requirements: Requirement[] = (d.requirements ?? base.requirements).map((r) =>
    migrateRequirementCounts(r, busynessLevels),
  )

  return {
    roles: d.roles ?? base.roles,
    shifts: d.shifts ?? base.shifts,
    staff,
    leaveTypes,
    busynessLevels,
    dayBusyness: d.dayBusyness ?? {},
    requirements,
    overrides: d.overrides ?? [],
    constraints,
    cost,
    period: { ...base.period, ...(d.period ?? {}) },
  }
}

/**
 * 旧 Requirement.counts（weekday/saturday/sunday/holiday）を
 * 忙しさ段階キーへ変換する。既に段階キーならそのまま。
 */
function migrateRequirementCounts(r: Requirement, levels: BusynessLevel[]): Requirement {
  const counts = (r.counts ?? {}) as Record<string, number>
  const looksOld =
    'weekday' in counts || 'saturday' in counts || 'sunday' in counts || 'holiday' in counts
  if (!looksOld) {
    // 段階キーのうち欠けているものは0で補完
    const filled: Record<string, number> = {}
    for (const l of levels) filled[l.id] = Math.max(0, counts[l.id] ?? 0)
    return { ...r, counts: filled }
  }
  const weekday = counts.weekday ?? 0
  const weekendMax = Math.max(counts.saturday ?? 0, counts.sunday ?? 0, counts.holiday ?? 0)
  const next: Record<string, number> = {}
  levels.forEach((l, i) => {
    // 低=平日の半分程度、中=平日、高=土日祝の最大 を目安に割り当て
    if (i === 0) next[l.id] = Math.max(0, Math.round(weekday / 2) || weekday)
    else if (i === levels.length - 1) next[l.id] = Math.max(weekday, weekendMax)
    else next[l.id] = weekday
  })
  return { ...r, counts: next }
}

interface StoreState {
  data: AppData
  // --- Role ---
  addRole: (name: string, color: string) => void
  updateRole: (id: string, patch: Partial<Role>) => void
  removeRole: (id: string) => void
  // --- Shift ---
  addShift: (shift: Omit<ShiftType, 'id'>) => void
  updateShift: (id: string, patch: Partial<ShiftType>) => void
  removeShift: (id: string) => void
  // --- Staff ---
  addStaff: (name: string) => void
  updateStaff: (id: string, patch: Partial<Staff>) => void
  removeStaff: (id: string) => void
  /** スタッフの休み希望を設定する（typeId=null で解除） */
  setStaffLeave: (staffId: string, date: string, typeId: string | null) => void
  // --- 休みの種類（全休・時間休） ---
  addLeaveType: () => void
  updateLeaveType: (id: string, patch: Partial<LeaveType>) => void
  removeLeaveType: (id: string) => void
  // --- 忙しさ段階 ---
  addBusynessLevel: () => void
  updateBusynessLevel: (id: string, patch: Partial<BusynessLevel>) => void
  removeBusynessLevel: (id: string) => void
  setDayBusyness: (date: string, levelId: string) => void
  // --- Requirement ---
  setRequirement: (roleId: string, shiftId: string, counts: Requirement['counts']) => void
  // --- 特定日の上書き ---
  setOverride: (override: RequirementOverride) => void
  removeOverride: (override: Pick<RequirementOverride, 'date' | 'roleId' | 'shiftId'>) => void
  // --- Constraints ---
  updateConstraints: (patch: Partial<Constraints>) => void
  // --- Cost ---
  updateCost: (patch: Partial<CostSettings>) => void
  // --- Period ---
  updatePeriod: (patch: Partial<PeriodSettings>) => void
  // --- 全体 ---
  importData: (data: AppData) => void
  resetData: () => void
  loadSampleData: () => void
}

export const useStore = create<StoreState>()(
  persist(
    (set) => ({
      data: defaultData(),

      addRole: (name, color) =>
        set((s) => ({
          data: { ...s.data, roles: [...s.data.roles, { id: newId('role'), name, color }] },
        })),
      updateRole: (id, patch) =>
        set((s) => ({
          data: {
            ...s.data,
            roles: s.data.roles.map((r) => (r.id === id ? { ...r, ...patch } : r)),
          },
        })),
      removeRole: (id) =>
        set((s) => ({
          data: {
            ...s.data,
            roles: s.data.roles.filter((r) => r.id !== id),
            requirements: s.data.requirements.filter((r) => r.roleId !== id),
            staff: s.data.staff.map((st) => ({
              ...st,
              roleIds: st.roleIds.filter((rid) => rid !== id),
            })),
          },
        })),

      addShift: (shift) =>
        set((s) => ({
          data: { ...s.data, shifts: [...s.data.shifts, { ...shift, id: newId('shift') }] },
        })),
      updateShift: (id, patch) =>
        set((s) => ({
          data: {
            ...s.data,
            shifts: s.data.shifts.map((sh) => (sh.id === id ? { ...sh, ...patch } : sh)),
          },
        })),
      removeShift: (id) =>
        set((s) => ({
          data: {
            ...s.data,
            shifts: s.data.shifts.filter((sh) => sh.id !== id),
            requirements: s.data.requirements.filter((r) => r.shiftId !== id),
            staff: s.data.staff.map((st) => ({
              ...st,
              allowedShiftIds: st.allowedShiftIds.filter((sid) => sid !== id),
            })),
          },
        })),

      addStaff: (name) =>
        set((s) => ({
          data: {
            ...s.data,
            staff: [
              ...s.data.staff,
              {
                id: newId('staff'),
                name,
                roleIds: [],
                level: 1 as const,
                hourlyWage: 1100,
                isMinor: false,
                maxShifts: null,
                maxConsecutive: 5,
                weeklyMaxHours: null,
                weeklyMaxDays: null,
                leaves: [],
                allowedShiftIds: [],
              },
            ],
          },
        })),
      updateStaff: (id, patch) =>
        set((s) => ({
          data: {
            ...s.data,
            staff: s.data.staff.map((st) => (st.id === id ? { ...st, ...patch } : st)),
          },
        })),
      removeStaff: (id) =>
        set((s) => ({
          data: {
            ...s.data,
            staff: s.data.staff.filter((st) => st.id !== id),
            constraints: {
              ...s.data.constraints,
              incompatiblePairs: s.data.constraints.incompatiblePairs.filter(
                (p) => p.a !== id && p.b !== id,
              ),
            },
          },
        })),

      setStaffLeave: (staffId, date, typeId) =>
        set((s) => ({
          data: {
            ...s.data,
            staff: s.data.staff.map((st) => {
              if (st.id !== staffId) return st
              const others = st.leaves.filter((l) => l.date !== date)
              const leaves = typeId
                ? [...others, { date, typeId }].sort((a, b) => a.date.localeCompare(b.date))
                : others
              return { ...st, leaves }
            }),
          },
        })),

      addLeaveType: () =>
        set((s) => ({
          data: {
            ...s.data,
            leaveTypes: [
              ...s.data.leaveTypes,
              { id: newId('leave'), name: `休み${s.data.leaveTypes.length + 1}`, start: '09:00', end: '13:00' },
            ],
          },
        })),
      updateLeaveType: (id, patch) =>
        set((s) => ({
          data: {
            ...s.data,
            leaveTypes: s.data.leaveTypes.map((t) => (t.id === id ? { ...t, ...patch } : t)),
          },
        })),
      removeLeaveType: (id) =>
        set((s) => {
          if (s.data.leaveTypes.length <= 1) return s
          return {
            data: {
              ...s.data,
              leaveTypes: s.data.leaveTypes.filter((t) => t.id !== id),
              // その種類を指す休みを除去
              staff: s.data.staff.map((st) => ({
                ...st,
                leaves: st.leaves.filter((l) => l.typeId !== id),
              })),
            },
          }
        }),

      addBusynessLevel: () =>
        set((s) => {
          const palette = ['#86c9a0', '#a7b3c2', '#e0b062', '#e08a8a', '#8a9ce0', '#b98ae0']
          const color = palette[s.data.busynessLevels.length % palette.length]
          const level: BusynessLevel = {
            id: newId('busy'),
            name: `段階${s.data.busynessLevels.length + 1}`,
            color,
          }
          return { data: { ...s.data, busynessLevels: [...s.data.busynessLevels, level] } }
        }),
      updateBusynessLevel: (id, patch) =>
        set((s) => ({
          data: {
            ...s.data,
            busynessLevels: s.data.busynessLevels.map((l) => (l.id === id ? { ...l, ...patch } : l)),
          },
        })),
      removeBusynessLevel: (id) =>
        set((s) => {
          if (s.data.busynessLevels.length <= 1) return s // 最低1段階は残す
          const levels = s.data.busynessLevels.filter((l) => l.id !== id)
          // 削除段階を指す日付・必要人数の該当キーを掃除
          const dayBusyness: Record<string, string> = {}
          for (const [date, lid] of Object.entries(s.data.dayBusyness)) {
            if (lid !== id) dayBusyness[date] = lid
          }
          const requirements = s.data.requirements.map((r) => {
            const counts = { ...r.counts }
            delete counts[id]
            return { ...r, counts }
          })
          return {
            data: { ...s.data, busynessLevels: levels, dayBusyness, requirements },
          }
        }),
      setDayBusyness: (date, levelId) =>
        set((s) => ({
          data: { ...s.data, dayBusyness: { ...s.data.dayBusyness, [date]: levelId } },
        })),

      setRequirement: (roleId, shiftId, counts) =>
        set((s) => {
          const existing = s.data.requirements.find(
            (r) => r.roleId === roleId && r.shiftId === shiftId,
          )
          const requirements = existing
            ? s.data.requirements.map((r) =>
                r.roleId === roleId && r.shiftId === shiftId ? { ...r, counts } : r,
              )
            : [...s.data.requirements, { roleId, shiftId, counts }]
          return { data: { ...s.data, requirements } }
        }),

      setOverride: (override) =>
        set((s) => {
          const others = s.data.overrides.filter(
            (o) =>
              !(o.date === override.date && o.roleId === override.roleId && o.shiftId === override.shiftId),
          )
          return { data: { ...s.data, overrides: [...others, override].sort((a, b) => a.date.localeCompare(b.date)) } }
        }),
      removeOverride: (target) =>
        set((s) => ({
          data: {
            ...s.data,
            overrides: s.data.overrides.filter(
              (o) =>
                !(o.date === target.date && o.roleId === target.roleId && o.shiftId === target.shiftId),
            ),
          },
        })),

      updateConstraints: (patch) =>
        set((s) => ({ data: { ...s.data, constraints: { ...s.data.constraints, ...patch } } })),

      updateCost: (patch) =>
        set((s) => ({ data: { ...s.data, cost: { ...s.data.cost, ...patch } } })),

      updatePeriod: (patch) =>
        set((s) => ({ data: { ...s.data, period: { ...s.data.period, ...patch } } })),

      importData: (data) => set(() => ({ data: normalizeData(data) })),
      resetData: () => set(() => ({ data: defaultData() })),
      loadSampleData: () => set(() => ({ data: sampleData() })),
    }),
    {
      name: 'shiftcraft-data-v1',
      version: 2,
      migrate: (persisted) => {
        const state = persisted as { data?: unknown }
        return { data: normalizeData(state?.data) }
      },
    },
  ),
)
