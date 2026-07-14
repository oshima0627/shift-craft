import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  AppData,
  Constraints,
  CostSettings,
  PeriodSettings,
  Requirement,
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

  const requirements: Requirement[] = [
    { roleId: 'role_hall', shiftId: 'shift_early', counts: { weekday: 1, saturday: 2, sunday: 2, holiday: 2 } },
    { roleId: 'role_hall', shiftId: 'shift_late', counts: { weekday: 1, saturday: 2, sunday: 2, holiday: 2 } },
    { roleId: 'role_kitchen', shiftId: 'shift_early', counts: { weekday: 1, saturday: 1, sunday: 1, holiday: 1 } },
    { roleId: 'role_kitchen', shiftId: 'shift_late', counts: { weekday: 1, saturday: 1, sunday: 1, holiday: 1 } },
  ]

  const period: PeriodSettings = firstOfNextMonthPeriod()

  return {
    roles: [r1, r2],
    shifts: [s1, s2],
    staff,
    requirements,
    constraints: defaultConstraints(),
    cost: defaultCost(),
    period,
  }
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
  return {
    roles: d.roles ?? base.roles,
    shifts: d.shifts ?? base.shifts,
    staff,
    requirements: d.requirements ?? base.requirements,
    constraints,
    cost,
    period: { ...base.period, ...(d.period ?? {}) },
  }
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
  // --- Requirement ---
  setRequirement: (roleId: string, shiftId: string, counts: Requirement['counts']) => void
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
