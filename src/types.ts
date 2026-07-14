// ===== ドメインモデル =====

/** 経験レベル。0=新人, 1=一般, 2=ベテラン。「経験者」= level >= 1 */
export type ExperienceLevel = 0 | 1 | 2

export const EXPERIENCE_LABELS: Record<ExperienceLevel, string> = {
  0: '新人',
  1: '一般',
  2: 'ベテラン',
}

/** 曜日区分。必要人数はこの区分ごとに設定する。 */
export type DayCategory = 'weekday' | 'saturday' | 'sunday' | 'holiday'

export const DAY_CATEGORY_LABELS: Record<DayCategory, string> = {
  weekday: '平日',
  saturday: '土',
  sunday: '日',
  holiday: '祝',
}

export const DAY_CATEGORY_ORDER: DayCategory[] = ['weekday', 'saturday', 'sunday', 'holiday']

/** 役割（ロール） */
export interface Role {
  id: string
  name: string
  color: string
}

/** シフト時間帯 */
export interface ShiftType {
  id: string
  name: string
  /** "HH:mm" */
  start: string
  /** "HH:mm" */
  end: string
}

/** スタッフ */
export interface Staff {
  id: string
  name: string
  /** 担当できる役割ID（複数可） */
  roleIds: string[]
  level: ExperienceLevel
  /** 期間内の最大出勤日数。null=無制限 */
  maxShifts: number | null
  /** 連続出勤日数の上限。null=無制限 */
  maxConsecutive: number | null
  /** 出勤不可日・希望休 "yyyy-MM-dd" */
  unavailableDates: string[]
  /** 割り当て可能なシフト時間帯ID。空=すべて可 */
  allowedShiftIds: string[]
}

/**
 * 必要人数。役割 × シフト時間帯 の組み合わせごとに、
 * 曜日区分別の必要人数を持つ。
 */
export interface Requirement {
  roleId: string
  shiftId: string
  counts: Record<DayCategory, number>
}

/** NGペア（同じ日に出勤させない） */
export interface IncompatiblePair {
  a: string // staffId
  b: string // staffId
}

/** 制約設定 */
export interface Constraints {
  /** 同じ日に一緒にできないペア */
  incompatiblePairs: IncompatiblePair[]
  /** 各シフトに必要な経験者(level>=1)の最低人数 */
  minExperiencedPerShift: number
  /** ソフト制約の重み */
  weights: {
    /** 出勤回数の公平化 */
    fairness: number
    /** 希望シフトの尊重 */
    preference: number
  }
  /** 自動化しきれない条件のメモ（生成時に注意喚起として表示） */
  notes: string
}

/** 期間設定 */
export interface PeriodSettings {
  /** "yyyy-MM-dd" */
  start: string
  /** "yyyy-MM-dd" */
  end: string
  /** 祝日 "yyyy-MM-dd" */
  holidays: string[]
}

/** アプリ全体の設定＋マスタ */
export interface AppData {
  roles: Role[]
  shifts: ShiftType[]
  staff: Staff[]
  requirements: Requirement[]
  constraints: Constraints
  period: PeriodSettings
}

// ===== 生成結果 =====

/** 1件の割り当て */
export interface Assignment {
  date: string // "yyyy-MM-dd"
  shiftId: string
  roleId: string
  staffId: string
}

/** 未充足スロット */
export interface Unfilled {
  date: string
  shiftId: string
  roleId: string
  needed: number
  filled: number
}

/** 制約違反・警告 */
export interface Warning {
  date: string
  shiftId?: string
  message: string
  severity: 'error' | 'warning'
}

/** 生成結果 */
export interface ScheduleResult {
  assignments: Assignment[]
  unfilled: Unfilled[]
  warnings: Warning[]
  /** スタッフID -> 出勤日数 */
  staffLoad: Record<string, number>
  /** 総合スコア（高いほど良い） */
  score: number
}
