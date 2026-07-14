import type {
  AppData,
  Assignment,
  DayCategory,
  ScheduleResult,
  ShiftType,
  Staff,
  Unfilled,
  Warning,
} from '../types'
import { dayCategoryOf, enumerateDates } from '../utils/date'
import {
  isMinorForbidden,
  paidMin,
  restBetweenMin,
  weekKeyOf,
} from '../utils/time'
import { validateSchedule } from './compliance'

/**
 * シフト最適化ソルバー（AI/LLM不使用の組合せ最適化）。
 *
 * 方針: 小規模（〜20人/月次）向けに、貪欲法 + 複数回ランダムリスタート
 * で「十分に良い」解を高速に求める（商用システムと同じ数理最適化・
 * ヒューリスティクスの系譜。詳細は docs/research.md）。
 *
 * ハード制約（違反する割り当ては行わない）:
 *  H1 役割適合 / H2 NGペア / H3 経験者最低数 / H4 出勤不可日・希望休
 *  H5 出勤上限・連勤上限 / H6 1人1日1シフト
 *  H7 年少者の深夜禁止（労基法61条）
 *  H8 週の労働時間上限（労基法32条: 40h/特例44h、年少者40h）
 *  H9 週の出勤日数上限（労基法35条: 週1休→最大6日）
 *  H10 勤務間インターバル（ハード設定時）
 *  H11 カスタム条件（曜日NG・時間帯NG/限定・週N日・N連勤・曜日固定）
 * 必要人数は可能な限り満たし、満たせない分は unfilled として報告する。
 *
 * ソフト制約（スコアで優先度を調整）:
 *  S1 出勤回数の公平化 / S2 希望シフト尊重 / S3 土日祝出勤の公平化
 *  S4 人件費の抑制 / S5 勤務間インターバル（ソフト設定時）
 *  S6 なるべく同じ日に入れるペア
 */

/** 決定的な擬似乱数（seed可能） */
function makeRng(seed: number) {
  let s = seed >>> 0
  return () => {
    // xorshift32
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return ((s >>> 0) % 100000) / 100000
  }
}

interface SlotDemand {
  date: string
  shiftId: string
  roleId: string
  category: DayCategory
  weekday: number
  weekKey: string
}

/** 生成中に更新するスタッフの状態 */
interface StaffState {
  assignedDates: Set<string>
  totalAssigned: number
  weekendAssigned: number
  // date -> shiftId（その日どのシフトに入ったか。1人1日1シフト前提）
  dayShift: Map<string, string>
  // 週キー -> 実働分
  weekMin: Map<string, number>
  // 週キー -> 出勤日数
  weekDays: Map<string, number>
}

/** カスタム条件から導出したスタッフ別ルール */
interface StaffRules {
  forbiddenWeekdays: Set<number>
  forbiddenShifts: Set<string>
  onlyShifts: Set<string> | null
  fixByWeekday: Map<number, string>
  maxDaysPerWeek: number | null
  maxConsecutive: number | null
}

interface Ctx {
  data: AppData
  dates: string[]
  dateIndex: Map<string, number>
  shiftById: Map<string, ShiftType>
  paidMinByShift: Map<string, number>
  incompatible: Set<string>
  together: Map<string, Set<string>>
  rulesByStaff: Map<string, StaffRules>
  restLimitMin: number
}

function isExperienced(s: Staff): boolean {
  return s.level >= 1
}

/** 指定日を含めたときの連続出勤日数（前後の連なりの長さ）を返す */
function consecutiveRunLength(assigned: Set<string>, dateStr: string, allDates: string[]): number {
  const idx = allDates.indexOf(dateStr)
  if (idx < 0) return 1
  let run = 1
  for (let i = idx - 1; i >= 0; i--) {
    if (assigned.has(allDates[i])) run++
    else break
  }
  for (let i = idx + 1; i < allDates.length; i++) {
    if (assigned.has(allDates[i])) run++
    else break
  }
  return run
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

function emptyRules(): StaffRules {
  return {
    forbiddenWeekdays: new Set(),
    forbiddenShifts: new Set(),
    onlyShifts: null,
    fixByWeekday: new Map(),
    maxDaysPerWeek: null,
    maxConsecutive: null,
  }
}

function buildCtx(data: AppData, dates: string[]): Ctx {
  const incompatible = new Set<string>()
  for (const p of data.constraints.incompatiblePairs) {
    if (!p.a || !p.b || p.a === p.b) continue
    incompatible.add(pairKey(p.a, p.b))
  }

  const together = new Map<string, Set<string>>()
  const rulesByStaff = new Map<string, StaffRules>()
  const ensureRules = (id: string) => {
    if (!rulesByStaff.has(id)) rulesByStaff.set(id, emptyRules())
    return rulesByStaff.get(id)!
  }
  const addTogether = (a: string, b: string) => {
    if (!together.has(a)) together.set(a, new Set())
    together.get(a)!.add(b)
  }

  for (const cr of data.constraints.customRules) {
    const r = cr.parsed
    if (!r) continue
    switch (r.kind) {
      case 'pairAvoid':
        if (r.a !== r.b) incompatible.add(pairKey(r.a, r.b))
        break
      case 'pairTogether':
        addTogether(r.a, r.b)
        addTogether(r.b, r.a)
        break
      case 'forbidWeekday':
        ensureRules(r.staffId).forbiddenWeekdays.add(r.weekday)
        break
      case 'forbidShift':
        ensureRules(r.staffId).forbiddenShifts.add(r.shiftId)
        break
      case 'onlyShift': {
        const rules = ensureRules(r.staffId)
        if (!rules.onlyShifts) rules.onlyShifts = new Set()
        rules.onlyShifts.add(r.shiftId)
        break
      }
      case 'maxDaysPerWeek': {
        const rules = ensureRules(r.staffId)
        rules.maxDaysPerWeek = Math.min(rules.maxDaysPerWeek ?? Infinity, r.days)
        break
      }
      case 'maxConsecutive': {
        const rules = ensureRules(r.staffId)
        rules.maxConsecutive = Math.min(rules.maxConsecutive ?? Infinity, r.days)
        break
      }
      case 'fixWeekdayShift':
        ensureRules(r.staffId).fixByWeekday.set(r.weekday, r.shiftId)
        break
    }
  }

  return {
    data,
    dates,
    dateIndex: new Map(dates.map((d, i) => [d, i])),
    shiftById: new Map(data.shifts.map((s) => [s.id, s])),
    paidMinByShift: new Map(data.shifts.map((s) => [s.id, paidMin(s)])),
    incompatible,
    together,
    rulesByStaff,
    restLimitMin: data.constraints.restIntervalHours * 60,
  }
}

/** メインの生成関数 */
export function generateSchedule(data: AppData, attempts = 40, seed = 12345): ScheduleResult {
  const dates = enumerateDates(data.period)
  const ctx = buildCtx(data, dates)

  let best: ScheduleResult | null = null

  for (let attempt = 0; attempt < Math.max(1, attempts); attempt++) {
    const rng = makeRng(seed + attempt * 7919)
    const result = runOnce(ctx, rng)
    if (best === null || result.score > best.score) {
      best = result
    }
    // 完全解（未充足・エラーなし）が出たら早期終了
    if (best.unfilled.length === 0 && !best.warnings.some((w) => w.severity === 'error')) {
      break
    }
  }

  return best!
}

function runOnce(ctx: Ctx, rng: () => number): ScheduleResult {
  const { data, dates } = ctx
  const states = new Map<string, StaffState>()
  for (const s of data.staff) {
    states.set(s.id, {
      assignedDates: new Set(),
      totalAssigned: 0,
      weekendAssigned: 0,
      dayShift: new Map(),
      weekMin: new Map(),
      weekDays: new Map(),
    })
  }

  const assignments: Assignment[] = []

  for (const date of dates) {
    const category = dayCategoryOf(date, data.period.holidays)
    const weekday = new Date(date + 'T00:00:00').getDay()
    const weekKey = weekKeyOf(date)
    const assignedToday = new Set<string>()

    for (const shift of data.shifts) {
      const roleNeeds = data.requirements
        .filter((r) => r.shiftId === shift.id && r.counts[category] > 0)
        .map((r) => ({ roleId: r.roleId, needed: r.counts[category] }))

      if (roleNeeds.length === 0) continue

      const demands: SlotDemand[] = []
      for (const rn of roleNeeds) {
        for (let i = 0; i < rn.needed; i++) {
          demands.push({ date, shiftId: shift.id, roleId: rn.roleId, category, weekday, weekKey })
        }
      }

      let expNeeded = Math.min(data.constraints.minExperiencedPerShift, demands.length)
      const assignedThisShift: string[] = []

      for (let di = 0; di < demands.length; di++) {
        const demand = demands[di]
        const remainingSlots = demands.length - di
        const mustBeExperienced = expNeeded >= remainingSlots

        const chosen = pickStaff(ctx, demand, states, assignedToday, rng, mustBeExperienced)

        if (chosen) {
          const st = states.get(chosen.id)!
          st.assignedDates.add(date)
          st.totalAssigned++
          if (category !== 'weekday') st.weekendAssigned++
          st.dayShift.set(date, shift.id)
          st.weekMin.set(
            demand.weekKey,
            (st.weekMin.get(demand.weekKey) ?? 0) + (ctx.paidMinByShift.get(shift.id) ?? 0),
          )
          st.weekDays.set(demand.weekKey, (st.weekDays.get(demand.weekKey) ?? 0) + 1)
          assignedToday.add(chosen.id)
          assignedThisShift.push(chosen.id)
          assignments.push({ date, shiftId: shift.id, roleId: demand.roleId, staffId: chosen.id })
          if (isExperienced(chosen) && expNeeded > 0) expNeeded--
        }
        // 充足できなかった分は最後に validateSchedule が unfilled として報告する
      }
    }
  }

  // 検証（人数不足・法令・運用の警告を一括生成。手動編集後と同じ基準）
  const { unfilled, warnings } = validateSchedule(data, assignments)

  const staffLoad: Record<string, number> = {}
  for (const s of data.staff) staffLoad[s.id] = states.get(s.id)!.totalAssigned

  const score = computeScore(ctx, unfilled, warnings, states, assignments)

  return { assignments, unfilled, warnings, staffLoad, score }
}

/**
 * 1スロットに割り当てるスタッフを選ぶ。
 * ハード制約を満たす候補の中から、ソフト制約に基づくスコアで最良を選ぶ。
 */
function pickStaff(
  ctx: Ctx,
  demand: SlotDemand,
  states: Map<string, StaffState>,
  assignedToday: Set<string>,
  rng: () => number,
  mustBeExperienced: boolean,
): Staff | null {
  const { data } = ctx
  const shift = ctx.shiftById.get(demand.shiftId)!
  const shiftPaid = ctx.paidMinByShift.get(demand.shiftId) ?? 0
  const weights = data.constraints.weights
  const candidates: { staff: Staff; score: number }[] = []

  for (const staff of data.staff) {
    // H1: 役割を担当できるか
    if (!staff.roleIds.includes(demand.roleId)) continue
    // H3: 経験者要件
    if (mustBeExperienced && !isExperienced(staff)) continue
    // H6: すでに今日どこかに入っている（1人1日1シフト）
    if (assignedToday.has(staff.id)) continue
    // H4: 出勤不可日・希望休
    if (staff.unavailableDates.includes(demand.date)) continue
    // シフト時間帯の制限（本人設定）
    if (staff.allowedShiftIds.length > 0 && !staff.allowedShiftIds.includes(demand.shiftId)) continue
    // H7: 年少者の深夜禁止（労基法61条）
    if (staff.isMinor && isMinorForbidden(shift)) continue

    // H11: カスタム条件
    const rules = ctx.rulesByStaff.get(staff.id)
    if (rules) {
      if (rules.forbiddenWeekdays.has(demand.weekday)) continue
      if (rules.forbiddenShifts.has(demand.shiftId)) continue
      if (rules.onlyShifts && !rules.onlyShifts.has(demand.shiftId)) continue
      const fixed = rules.fixByWeekday.get(demand.weekday)
      if (fixed && fixed !== demand.shiftId) continue
    }

    const st = states.get(staff.id)!
    // H5: 出勤上限
    if (staff.maxShifts != null && st.totalAssigned >= staff.maxShifts) continue
    // H5: 連勤上限（本人設定 > カスタム条件 > 全体既定）
    const consLimit =
      staff.maxConsecutive ?? rules?.maxConsecutive ?? data.constraints.maxConsecutiveDefault
    {
      const tentative = new Set(st.assignedDates)
      tentative.add(demand.date)
      if (consecutiveRunLength(tentative, demand.date, ctx.dates) > consLimit) continue
    }
    // H8: 週の労働時間上限（年少者は40h厳守）
    const capH = staff.isMinor
      ? Math.min(40, data.constraints.weeklyHoursCap)
      : Math.min(staff.weeklyMaxHours ?? Infinity, data.constraints.weeklyHoursCap)
    if ((st.weekMin.get(demand.weekKey) ?? 0) + shiftPaid > capH * 60) continue
    // H9: 週の出勤日数上限（法定週1休→最大6日、本人設定・カスタム条件があれば優先）
    const capDays = Math.min(staff.weeklyMaxDays ?? Infinity, rules?.maxDaysPerWeek ?? Infinity, 6)
    if ((st.weekDays.get(demand.weekKey) ?? 0) + 1 > capDays) continue

    // H2: NGペア（今日既に入っている人と衝突しないか）
    let conflict = false
    for (const otherId of assignedToday) {
      if (ctx.incompatible.has(pairKey(staff.id, otherId))) {
        conflict = true
        break
      }
    }
    if (conflict) continue

    // 勤務間インターバル（前日・翌日の割り当てとの休息時間）
    let restViolations = 0
    if (ctx.restLimitMin > 0) {
      const idx = ctx.dateIndex.get(demand.date)!
      const prevDate = ctx.dates[idx - 1]
      const nextDate = ctx.dates[idx + 1]
      const prevShiftId = prevDate ? st.dayShift.get(prevDate) : undefined
      const nextShiftId = nextDate ? st.dayShift.get(nextDate) : undefined
      if (prevShiftId) {
        const prevShift = ctx.shiftById.get(prevShiftId)!
        if (restBetweenMin(prevShift, shift) < ctx.restLimitMin) restViolations++
      }
      if (nextShiftId) {
        const nextShift = ctx.shiftById.get(nextShiftId)!
        if (restBetweenMin(shift, nextShift) < ctx.restLimitMin) restViolations++
      }
      // H10: ハード設定ならインターバル違反となる割り当ては行わない
      if (data.constraints.restIntervalHard && restViolations > 0) continue
    }

    // ---- ソフト制約スコア（低いほど優先） ----
    let score = 0
    // S1: 公平化 — 出勤が少ない人を優先
    score += st.totalAssigned * weights.fairness
    // S2: 希望シフト — allowedShiftIds を「希望」とみなし、希望に合致すれば軽く優遇
    if (staff.allowedShiftIds.length > 0 && staff.allowedShiftIds.includes(demand.shiftId)) {
      score -= weights.preference
    }
    // S3: 土日祝の公平化 — 土日祝は、土日祝出勤が少ない人を優先
    if (demand.category !== 'weekday') {
      score += st.weekendAssigned * weights.weekendFairness
    }
    // S4: 人件費 — 時給の低い人をやや優先
    score += (staff.hourlyWage / 1000) * weights.cost * 0.5
    // S5: インターバル（ソフト時）— クローピングになる割り当てを避ける
    score += restViolations * 3
    // S6: なるべく同じ日に入れるペア
    const partners = ctx.together.get(staff.id)
    if (partners) {
      for (const otherId of assignedToday) {
        if (partners.has(otherId)) {
          score -= Math.max(1, weights.preference)
          break
        }
      }
    }
    // 曜日固定に合致する割り当ては強く優遇
    if (rules?.fixByWeekday.get(demand.weekday) === demand.shiftId) score -= 3
    // 経験者は経験者が本当に必要な時のために温存（軽いペナルティ）
    if (!mustBeExperienced && isExperienced(staff)) score += 0.3
    // タイブレーク用の微小ランダム
    score += rng() * 0.5

    candidates.push({ staff, score })
  }

  if (candidates.length === 0) return null
  candidates.sort((a, b) => a.score - b.score)
  return candidates[0].staff
}

/** 総合スコア（高いほど良い） */
function computeScore(
  ctx: Ctx,
  unfilled: Unfilled[],
  warnings: Warning[],
  states: Map<string, StaffState>,
  assignments: Assignment[],
): number {
  const { data } = ctx
  const weights = data.constraints.weights
  let score = 0

  // 未充足は最重要ペナルティ
  const unfilledCount = unfilled.reduce((acc, u) => acc + (u.needed - u.filled), 0)
  score -= unfilledCount * 1000

  // 法令エラー（人数不足以外）・警告
  score -= warnings.filter((w) => w.kind !== 'coverage' && w.severity === 'error').length * 400
  score -= warnings.filter((w) => w.severity === 'warning').length * 100

  // 公平性: 出勤日数のばらつき（レンジ）を減点
  const loads = [...states.values()].map((s) => s.totalAssigned)
  if (loads.length > 0) {
    score -= (Math.max(...loads) - Math.min(...loads)) * weights.fairness * 5
  }
  // 土日祝出勤のばらつき
  const weekendLoads = [...states.values()].map((s) => s.weekendAssigned)
  if (weekendLoads.length > 0) {
    score -=
      (Math.max(...weekendLoads) - Math.min(...weekendLoads)) * weights.weekendFairness * 5
  }
  // 人件費（重み付き）
  if (weights.cost > 0) {
    const staffById = new Map(data.staff.map((s) => [s.id, s]))
    let cost = 0
    for (const a of assignments) {
      const st = staffById.get(a.staffId)
      const paid = ctx.paidMinByShift.get(a.shiftId) ?? 0
      if (st) cost += (paid / 60) * st.hourlyWage
    }
    score -= (cost / 10000) * weights.cost
  }
  return score
}
