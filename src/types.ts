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

/**
 * 忙しさの段階（可変）。並び順が忙しさの低→高を表す。
 * 各日にこの段階を割り当て、必要人数は段階ごとに設定する。
 */
export interface BusynessLevel {
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
  /** "HH:mm"。start より前なら翌日終了（深夜営業）とみなす */
  end: string
}

/**
 * 休みの種類（可変）。全休のほか、時間休（午前休・午後休など）を定義できる。
 * その時間帯に重なるシフトには割り当てられない。全休は 00:00〜24:00。
 */
export interface LeaveType {
  id: string
  name: string
  /** "HH:mm" 全休は '00:00' */
  start: string
  /** "HH:mm" 全休は '24:00' */
  end: string
}

/** スタッフの休み希望（日付＋休みの種類） */
export interface StaffLeave {
  date: string // "yyyy-MM-dd"
  typeId: string
}

/** スタッフ */
export interface Staff {
  id: string
  name: string
  /** 担当できる役割ID（複数可） */
  roleIds: string[]
  level: ExperienceLevel
  /** 時給（円）。人件費計算に使用 */
  hourlyWage: number
  /** 18歳未満（高校生等）。22時以降の深夜シフトに入れない（労基法61条） */
  isMinor: boolean
  /** 期間内の最大出勤日数。null=無制限 */
  maxShifts: number | null
  /** 連続出勤日数の上限。null=全体設定に従う */
  maxConsecutive: number | null
  /** 週の労働時間上限（時間）。null=法定・全体設定に従う */
  weeklyMaxHours: number | null
  /** 週の出勤日数上限。null=法定（週1休＝最大6日）に従う */
  weeklyMaxDays: number | null
  /** 休み希望（全休・時間休）。その時間に重なるシフトには入れない */
  leaves: StaffLeave[]
  /** 割り当て可能なシフト時間帯ID。空=すべて可 */
  allowedShiftIds: string[]
}

/**
 * 必要人数。役割 × シフト時間帯 の組み合わせごとに、
 * 忙しさ段階（BusynessLevel.id）別の必要人数を持つ。
 */
export interface Requirement {
  roleId: string
  shiftId: string
  /** 忙しさ段階ID -> 必要人数 */
  counts: Record<string, number>
}

/** NGペア（同じ日に出勤させない） */
export interface IncompatiblePair {
  a: string // staffId
  b: string // staffId
}

/**
 * 特定日の必要人数の上書き。
 * 「この日は◯人」を曜日区分より優先して適用する（イベント日・繁忙日など）。
 */
export interface RequirementOverride {
  date: string // "yyyy-MM-dd"
  roleId: string
  shiftId: string
  count: number
}

// ===== カスタム条件（自然文→構造化ルール） =====

export type ParsedRule =
  | { kind: 'pairAvoid'; a: string; b: string }
  | { kind: 'pairTogether'; a: string; b: string }
  | { kind: 'forbidWeekday'; staffId: string; weekday: number } // 0=日〜6=土
  | { kind: 'forbidShift'; staffId: string; shiftId: string }
  | { kind: 'onlyShift'; staffId: string; shiftId: string }
  | { kind: 'maxDaysPerWeek'; staffId: string; days: number }
  | { kind: 'maxConsecutive'; staffId: string; days: number }
  | { kind: 'fixWeekdayShift'; staffId: string; weekday: number; shiftId: string }

export interface CustomRule {
  id: string
  /** 入力された元の文 */
  text: string
  /** 解釈結果。null = 自動解釈できず（メモとして保持） */
  parsed: ParsedRule | null
}

/** 制約設定 */
export interface Constraints {
  /** 同じ日に一緒にできないペア */
  incompatiblePairs: IncompatiblePair[]
  /** NGペアを厳守するか（true=ハード制約 / false=警告のみ）。未設定は厳守扱い */
  incompatibleHard?: boolean
  /** 定休日（毎週の休業曜日 0=日〜6=土）。この曜日は誰も割り当てない */
  closedWeekdays?: number[]
  /** 各シフトに必要な経験者(level>=1)の最低人数 */
  minExperiencedPerShift: number
  /** 連勤上限の既定値（労基法35条の週1休 → 原則6連勤まで） */
  maxConsecutiveDefault: number
  /** 勤務間インターバル時間（終業→翌始業）。0=チェックしない。推奨9〜11h */
  restIntervalHours: number
  /** インターバルをハード制約として厳守するか（false=警告のみ） */
  restIntervalHard: boolean
  /** 週の法定労働時間上限。40h、または特例措置対象事業場（常時10人未満の商業・サービス業）は44h */
  weeklyHoursCap: number
  /**
   * 同じ日に複数のシフトを許可するか（早番→遅番などの分割勤務）。
   * true=時間帯が重ならなければ同日に複数入れられる。false=1人1日1シフト。
   */
  allowSplitShifts: boolean
  /**
   * 分割勤務を積極的に使うか。true=人手に余裕があっても、既に出勤している人に
   * 2コマ目を優先的に割り当てて少人数で回す。false=足りない時だけ分割を使う。
   */
  preferSplitShifts: boolean
  /** ソフト制約の重み */
  weights: {
    /** 出勤回数の公平化 */
    fairness: number
    /** 希望シフトの尊重 */
    preference: number
    /** 土日祝出勤の公平化 */
    weekendFairness: number
    /** 人件費の抑制（時給の低いスタッフをやや優先） */
    cost: number
  }
  /** 自然文で入力されたカスタム条件 */
  customRules: CustomRule[]
  /** 自動化しきれない条件のメモ（生成時に注意喚起として表示） */
  notes: string
}

/** 人件費・売上の設定 */
export interface CostSettings {
  /** 対象期間の売上目標（円）。null=未設定 */
  salesTarget: number | null
  /** 目標人件費率（%）。飲食の目安は25〜30% */
  targetLaborRate: number
  /** 法定福利費（時給×約15%）を人件費に含めて表示するか */
  includeWelfare: boolean
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
  /** 休みの種類（全休・時間休） */
  leaveTypes: LeaveType[]
  /** 忙しさ段階（可変・並び順=低→高） */
  busynessLevels: BusynessLevel[]
  /**
   * 日付 "yyyy-MM-dd" -> 忙しさ段階ID（個別指定。既定より優先）。
   * 未指定の日は自動判定: 土日祝=最も忙しい段階 / 平日=中間の段階。
   */
  dayBusyness: Record<string, string>
  requirements: Requirement[]
  /** 特定日の必要人数の上書き */
  overrides: RequirementOverride[]
  constraints: Constraints
  cost: CostSettings
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

/** 警告の分類 */
export type WarningKind =
  | 'coverage' // 人数不足
  | 'law' // 労働法関連（休憩・週上限・年少者・連勤・インターバル）
  | 'staffing' // 新人のみ・経験者不足など運用上の問題

/** 制約違反・警告 */
export interface Warning {
  date: string
  shiftId?: string
  staffId?: string
  kind: WarningKind
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
