import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  AppData,
  Constraints,
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

function defaultData(): AppData {
  const r1: Role = { id: 'role_hall', name: 'ホール', color: '#3b6fe0' }
  const r2: Role = { id: 'role_kitchen', name: 'キッチン', color: '#e0733b' }
  const s1: ShiftType = { id: 'shift_early', name: '早番', start: '09:00', end: '17:00' }
  const s2: ShiftType = { id: 'shift_late', name: '遅番', start: '13:00', end: '22:00' }

  const staff: Staff[] = [
    mkStaff('田中', ['role_hall'], 2),
    mkStaff('鈴木', ['role_hall', 'role_kitchen'], 1),
    mkStaff('佐藤', ['role_kitchen'], 2),
    mkStaff('高橋', ['role_hall'], 0),
    mkStaff('伊藤', ['role_kitchen'], 0),
  ]

  const requirements: Requirement[] = [
    { roleId: 'role_hall', shiftId: 'shift_early', counts: { weekday: 1, saturday: 2, sunday: 2, holiday: 2 } },
    { roleId: 'role_hall', shiftId: 'shift_late', counts: { weekday: 1, saturday: 2, sunday: 2, holiday: 2 } },
    { roleId: 'role_kitchen', shiftId: 'shift_early', counts: { weekday: 1, saturday: 1, sunday: 1, holiday: 1 } },
    { roleId: 'role_kitchen', shiftId: 'shift_late', counts: { weekday: 1, saturday: 1, sunday: 1, holiday: 1 } },
  ]

  const constraints: Constraints = {
    incompatiblePairs: [],
    minExperiencedPerShift: 1,
    weights: { fairness: 1, preference: 1 },
    notes: '',
  }

  const period: PeriodSettings = firstOfNextMonthPeriod()

  return { roles: [r1, r2], shifts: [s1, s2], staff, requirements, constraints, period }
}

let staffSeq = 0
function mkStaff(name: string, roleIds: string[], level: 0 | 1 | 2): Staff {
  staffSeq++
  return {
    id: `staff_seed_${staffSeq}`,
    name,
    roleIds,
    level,
    maxShifts: null,
    maxConsecutive: 5,
    unavailableDates: [],
    allowedShiftIds: [],
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
                level: 1,
                maxShifts: null,
                maxConsecutive: 5,
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

      updatePeriod: (patch) =>
        set((s) => ({ data: { ...s.data, period: { ...s.data.period, ...patch } } })),

      importData: (data) => set(() => ({ data })),
      resetData: () => set(() => ({ data: defaultData() })),
    }),
    { name: 'shiftcraft-data-v1' },
  ),
)
