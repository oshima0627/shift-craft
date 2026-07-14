import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  AppData,
  BusynessLevel,
  Constraints,
  CostSettings,
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
    minExperiencedPerShift: 1,
    // 労基法35条（週1休）→ 原則6連勤まで
    maxConsecutiveDefault: 6,
    // 勤務間インターバル: 努力義務。厚労省ガイドラインの目安 9〜11h
    restIntervalHours: 11,
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
  const s1: ShiftType = { id: 'shift_early', name: '早番', start: '09:00', end: '17:00' }
  const s2: ShiftType = { id: 'shift_late', name: '遅番', start: '13:00', end: '22:00' }

  const staff: Staff[] = [
    mkStaff('田中', ['role_hall'], 2, { hourlyWage: 1300 }),
    mkStaff('鈴木', ['role_hall', 'role_kitchen'], 1, { hourlyWage: 1150 }),
    mkStaff('佐藤', ['role_kitchen'], 2, { hourlyWage: 1350 }),
    mkStaff('高橋', ['role_hall'], 0, { hourlyWage: 1050, isMinor: true }),
    mkStaff('伊藤', ['role_kitchen'], 0, { hourlyWage: 1100 }),
  ]

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
    busynessLevels: levels,
    defaultBusynessLevelId: 'busy_mid', // 平日=普通
    weekendBusynessLevelId: 'busy_high', // 土日祝=忙しい
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

let staffSeq = 0
function mkStaff(
  name: string,
  roleIds: string[],
  level: 0 | 1 | 2,
  extra: Partial<Staff> = {},
): Staff {
  staffSeq++
  return {
    id: `staff_seed_${staffSeq}`,
    name,
    roleIds,
    level,
    hourlyWage: 1100,
    isMinor: false,
    maxShifts: null,
    maxConsecutive: 5,
    weeklyMaxHours: null,
    weeklyMaxDays: null,
    unavailableDates: [],
    allowedShiftIds: [],
    ...extra,
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
  const staff: Staff[] = (d.staff ?? base.staff).map((s) => ({
    ...s,
    hourlyWage: s.hourlyWage ?? 1100,
    isMinor: s.isMinor ?? false,
    weeklyMaxHours: s.weeklyMaxHours ?? null,
    weeklyMaxDays: s.weeklyMaxDays ?? null,
  }))

  // 忙しさ段階（無ければ既定3段階を補完）
  const busynessLevels: BusynessLevel[] =
    Array.isArray(d.busynessLevels) && d.busynessLevels.length > 0
      ? d.busynessLevels
      : base.busynessLevels
  const levelIds = new Set(busynessLevels.map((l) => l.id))
  const defaultBusynessLevelId =
    d.defaultBusynessLevelId && levelIds.has(d.defaultBusynessLevelId)
      ? d.defaultBusynessLevelId
      : (busynessLevels.find((l) => l.id === 'busy_mid')?.id ??
        busynessLevels[Math.floor(busynessLevels.length / 2)]?.id ??
        busynessLevels[0]?.id ??
        '')
  // 土日祝の既定（無ければ最も忙しい＝最後の段階、または busy_high）
  const weekendBusynessLevelId =
    d.weekendBusynessLevelId && levelIds.has(d.weekendBusynessLevelId)
      ? d.weekendBusynessLevelId
      : (busynessLevels.find((l) => l.id === 'busy_high')?.id ??
        busynessLevels[busynessLevels.length - 1]?.id ??
        defaultBusynessLevelId)

  // 必要人数: 旧スキーマ（曜日区分キー）を忙しさ段階キーへ移行
  const requirements: Requirement[] = (d.requirements ?? base.requirements).map((r) =>
    migrateRequirementCounts(r, busynessLevels),
  )

  return {
    roles: d.roles ?? base.roles,
    shifts: d.shifts ?? base.shifts,
    staff,
    busynessLevels,
    defaultBusynessLevelId,
    weekendBusynessLevelId,
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
  /** 希望休（出勤不可日）の1日分をトグルする */
  toggleUnavailable: (staffId: string, date: string) => void
  // --- 忙しさ段階 ---
  addBusynessLevel: () => void
  updateBusynessLevel: (id: string, patch: Partial<BusynessLevel>) => void
  removeBusynessLevel: (id: string) => void
  setDefaultBusynessLevel: (id: string) => void
  setWeekendBusynessLevel: (id: string) => void
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
                unavailableDates: [],
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

      toggleUnavailable: (staffId, date) =>
        set((s) => ({
          data: {
            ...s.data,
            staff: s.data.staff.map((st) => {
              if (st.id !== staffId) return st
              const has = st.unavailableDates.includes(date)
              return {
                ...st,
                unavailableDates: has
                  ? st.unavailableDates.filter((d) => d !== date)
                  : [...st.unavailableDates, date].sort(),
              }
            }),
          },
        })),

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
          const weekdayFallback =
            s.data.defaultBusynessLevelId === id ? levels[0].id : s.data.defaultBusynessLevelId
          const weekendFallback =
            s.data.weekendBusynessLevelId === id
              ? levels[levels.length - 1].id
              : s.data.weekendBusynessLevelId
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
            data: {
              ...s.data,
              busynessLevels: levels,
              defaultBusynessLevelId: weekdayFallback,
              weekendBusynessLevelId: weekendFallback,
              dayBusyness,
              requirements,
            },
          }
        }),
      setDefaultBusynessLevel: (id) =>
        set((s) => ({ data: { ...s.data, defaultBusynessLevelId: id } })),
      setWeekendBusynessLevel: (id) =>
        set((s) => ({ data: { ...s.data, weekendBusynessLevelId: id } })),
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
