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
import { neededCount } from '../utils/requirements'
import {
  isMinorForbidden,
  paidMin,
  restBetweenMin,
  shiftSpan,
  shiftsOverlap,
  weekKeyOf,
} from '../utils/time'
import { validateSchedule } from './compliance'

/**
 * シフト最適化ソルバー（AI/LLM不使用の組合せ最適化）。
 *
 * 方針: 小規模（〜20人/月次）向けに、貪欲法 + 修復パス + 複数回ランダムリスタート
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
 *
 * 必要人数は「特定日の上書き（overrides）＞ 曜日区分」で解決する。
 * 貪欲構築のあと、埋まらなかったスロットに対して同日内の役割・時間帯の
 * 入れ替え（深さ1のチェーン移動）を試す修復パスを実行する。
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
  // 割り当てシフト数（分割勤務では1日で複数になりうる。公平化は仕事量=シフト数で見る）
  totalAssigned: number
  // 土日祝に出勤した「日数」（分割勤務でも1日は1）
  weekendAssigned: number
  // date -> その日に入ったシフトIDの配列（分割勤務対応）
  dayShiftIds: Map<string, string[]>
  // 週キー -> 実働分（全シフト合算）
  weekMin: Map<string, number>
  // 週キー -> 出勤「日数」（分割勤務でも1日は1）
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
  categoryByDate: Map<string, DayCategory>
  weekdayByDate: Map<string, number>
  weekKeyByDate: Map<string, string>
  staffById: Map<string, Staff>
  shiftById: Map<string, ShiftType>
  paidMinByShift: Map<string, number>
  incompatible: Set<string>
  together: Map<string, Set<string>>
  rulesByStaff: Map<string, StaffRules>
  restLimitMin: number
  allowSplitShifts: boolean
  preferSplitShifts: boolean
}

/** シフトID配列のうち最も遅く終わるシフト（前日→当日の休息計算用） */
function latestEndingShift(ctx: Ctx, shiftIds: string[]): ShiftType | null {
  let best: ShiftType | null = null
  let bestEnd = -Infinity
  for (const id of shiftIds) {
    const sh = ctx.shiftById.get(id)
    if (!sh) continue
    const end = shiftSpan(sh).endMin
    if (end > bestEnd) {
      bestEnd = end
      best = sh
    }
  }
  return best
}

/** シフトID配列のうち最も早く始まるシフト（当日→翌日の休息計算用） */
function earliestStartingShift(ctx: Ctx, shiftIds: string[]): ShiftType | null {
  let best: ShiftType | null = null
  let bestStart = Infinity
  for (const id of shiftIds) {
    const sh = ctx.shiftById.get(id)
    if (!sh) continue
    const start = shiftSpan(sh).startMin
    if (start < bestStart) {
      bestStart = start
      best = sh
    }
  }
  return best
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

  const categoryByDate = new Map<string, DayCategory>()
  const weekdayByDate = new Map<string, number>()
  const weekKeyByDate = new Map<string, string>()
  for (const date of dates) {
    categoryByDate.set(date, dayCategoryOf(date, data.period.holidays))
    weekdayByDate.set(date, new Date(date + 'T00:00:00').getDay())
    weekKeyByDate.set(date, weekKeyOf(date))
  }

  return {
    data,
    dates,
    dateIndex: new Map(dates.map((d, i) => [d, i])),
    categoryByDate,
    weekdayByDate,
    weekKeyByDate,
    staffById: new Map(data.staff.map((s) => [s.id, s])),
    shiftById: new Map(data.shifts.map((s) => [s.id, s])),
    paidMinByShift: new Map(data.shifts.map((s) => [s.id, paidMin(s)])),
    incompatible,
    together,
    rulesByStaff,
    restLimitMin: data.constraints.restIntervalHours * 60,
    allowSplitShifts: data.constraints.allowSplitShifts,
    preferSplitShifts: data.constraints.preferSplitShifts,
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

/** 割り当てをスタッフ状態に反映（分割勤務対応：同日2件目以降は「日数」を増やさない） */
function applyAssign(ctx: Ctx, st: StaffState, a: Assignment) {
  const list = st.dayShiftIds.get(a.date)
  const isNewDay = !list || list.length === 0
  if (list) list.push(a.shiftId)
  else st.dayShiftIds.set(a.date, [a.shiftId])

  st.totalAssigned++ // シフト数（仕事量）
  const wk = ctx.weekKeyByDate.get(a.date)!
  st.weekMin.set(wk, (st.weekMin.get(wk) ?? 0) + (ctx.paidMinByShift.get(a.shiftId) ?? 0))

  if (isNewDay) {
    st.assignedDates.add(a.date)
    st.weekDays.set(wk, (st.weekDays.get(wk) ?? 0) + 1)
    if (ctx.categoryByDate.get(a.date) !== 'weekday') st.weekendAssigned++
  }
}

/** 割り当てをスタッフ状態から除去（applyAssign の逆操作） */
function removeAssign(ctx: Ctx, st: StaffState, a: Assignment) {
  const list = st.dayShiftIds.get(a.date)
  if (list) {
    const i = list.indexOf(a.shiftId)
    if (i >= 0) list.splice(i, 1)
  }
  const stillWorks = (st.dayShiftIds.get(a.date)?.length ?? 0) > 0

  st.totalAssigned--
  const wk = ctx.weekKeyByDate.get(a.date)!
  st.weekMin.set(wk, (st.weekMin.get(wk) ?? 0) - (ctx.paidMinByShift.get(a.shiftId) ?? 0))

  if (!stillWorks) {
    st.assignedDates.delete(a.date)
    st.weekDays.set(wk, (st.weekDays.get(wk) ?? 0) - 1)
    if (ctx.categoryByDate.get(a.date) !== 'weekday') st.weekendAssigned--
  }
}

interface HardCheck {
  ok: boolean
  /** ソフト運用時のインターバル抵触数（前日・翌日それぞれ最大1） */
  restViolations: number
}

const NG: HardCheck = { ok: false, restViolations: 0 }

/**
 * ハード制約 H1〜H11 を判定する（H3 経験者最低数はグループ制約のため呼び出し側で扱う）。
 */
function hardCheck(
  ctx: Ctx,
  demand: SlotDemand,
  staff: Staff,
  st: StaffState,
  assignedToday: Iterable<string>,
): HardCheck {
  const { data } = ctx
  const shift = ctx.shiftById.get(demand.shiftId)!

  // H1: 役割を担当できるか
  if (!staff.roleIds.includes(demand.roleId)) return NG
  // H6: 同日の既存シフトとの関係。分割勤務OFFなら1日1シフト、
  //     ONなら時間帯が重ならなければ複数可（早番→遅番など）
  const sameDay = st.dayShiftIds.get(demand.date)
  if (sameDay && sameDay.length > 0) {
    if (!ctx.allowSplitShifts) return NG
    for (const sid of sameDay) {
      const other = ctx.shiftById.get(sid)
      if (other && shiftsOverlap(other, shift)) return NG
    }
  }
  // H4: 出勤不可日・希望休
  if (staff.unavailableDates.includes(demand.date)) return NG
  // シフト時間帯の制限（本人設定）
  if (staff.allowedShiftIds.length > 0 && !staff.allowedShiftIds.includes(demand.shiftId)) return NG
  // H7: 年少者の深夜禁止（労基法61条）
  if (staff.isMinor && isMinorForbidden(shift)) return NG

  // H11: カスタム条件
  const rules = ctx.rulesByStaff.get(staff.id)
  if (rules) {
    if (rules.forbiddenWeekdays.has(demand.weekday)) return NG
    if (rules.forbiddenShifts.has(demand.shiftId)) return NG
    if (rules.onlyShifts && !rules.onlyShifts.has(demand.shiftId)) return NG
    const fixed = rules.fixByWeekday.get(demand.weekday)
    if (fixed && fixed !== demand.shiftId) return NG
  }

  // H5: 出勤上限
  if (staff.maxShifts != null && st.totalAssigned >= staff.maxShifts) return NG
  // H5: 連勤上限（本人設定 > カスタム条件 > 全体既定）
  const consLimit =
    staff.maxConsecutive ?? rules?.maxConsecutive ?? data.constraints.maxConsecutiveDefault
  {
    const tentative = new Set(st.assignedDates)
    tentative.add(demand.date)
    if (consecutiveRunLength(tentative, demand.date, ctx.dates) > consLimit) return NG
  }
  // H8: 週の労働時間上限（年少者は40h厳守）
  const shiftPaid = ctx.paidMinByShift.get(demand.shiftId) ?? 0
  const capH = staff.isMinor
    ? Math.min(40, data.constraints.weeklyHoursCap)
    : Math.min(staff.weeklyMaxHours ?? Infinity, data.constraints.weeklyHoursCap)
  if ((st.weekMin.get(demand.weekKey) ?? 0) + shiftPaid > capH * 60) return NG
  // H9: 週の出勤日数上限（法定週1休→最大6日、本人設定・カスタム条件があれば優先）
  const capDays = Math.min(staff.weeklyMaxDays ?? Infinity, rules?.maxDaysPerWeek ?? Infinity, 6)
  if ((st.weekDays.get(demand.weekKey) ?? 0) + 1 > capDays) return NG

  // H2: NGペア（今日既に入っている人と衝突しないか）
  for (const otherId of assignedToday) {
    if (otherId === staff.id) continue
    if (ctx.incompatible.has(pairKey(staff.id, otherId))) return NG
  }

  // 勤務間インターバル（前日の最遅シフト → 当日、当日 → 翌日の最早シフト）
  // 同日内の分割勤務は「日をまたぐ休息」ではないので対象外
  let restViolations = 0
  if (ctx.restLimitMin > 0) {
    const idx = ctx.dateIndex.get(demand.date)!
    const prevDate = ctx.dates[idx - 1]
    const nextDate = ctx.dates[idx + 1]
    const prevShifts = prevDate ? st.dayShiftIds.get(prevDate) : undefined
    const nextShifts = nextDate ? st.dayShiftIds.get(nextDate) : undefined
    if (prevShifts && prevShifts.length > 0) {
      const prevShift = latestEndingShift(ctx, prevShifts)
      if (prevShift && restBetweenMin(prevShift, shift) < ctx.restLimitMin) restViolations++
    }
    if (nextShifts && nextShifts.length > 0) {
      const nextShift = earliestStartingShift(ctx, nextShifts)
      if (nextShift && restBetweenMin(shift, nextShift) < ctx.restLimitMin) restViolations++
    }
    // H10: ハード設定ならインターバル違反となる割り当ては行わない
    if (data.constraints.restIntervalHard && restViolations > 0) return NG
  }

  return { ok: true, restViolations }
}

/** その日に出勤している（いずれかのシフトに入っている）スタッフIDの集合 */
function dayStaffIds(dayList: Assignment[]): Set<string> {
  const s = new Set<string>()
  for (const a of dayList) s.add(a.staffId)
  return s
}

/**
 * (date, shiftId) グループの経験者最低数チェック。
 * addStaff を加え removeStaffId を除いた構成で判定する。
 */
function expOkAfter(
  ctx: Ctx,
  dayList: Assignment[],
  shiftId: string,
  addStaff: Staff | null,
  removeStaffId: string | null,
): boolean {
  const minExp = ctx.data.constraints.minExperiencedPerShift
  if (minExp <= 0) return true
  let size = 0
  let exp = 0
  for (const a of dayList) {
    if (a.shiftId !== shiftId || a.staffId === removeStaffId) continue
    size++
    if (isExperienced(ctx.staffById.get(a.staffId)!)) exp++
  }
  if (addStaff) {
    size++
    if (isExperienced(addStaff)) exp++
  }
  if (size === 0) return true
  return exp >= Math.min(minExp, size)
}

function runOnce(ctx: Ctx, rng: () => number): ScheduleResult {
  const { data, dates } = ctx
  const states = new Map<string, StaffState>()
  for (const s of data.staff) {
    states.set(s.id, {
      assignedDates: new Set(),
      totalAssigned: 0,
      weekendAssigned: 0,
      dayShiftIds: new Map(),
      weekMin: new Map(),
      weekDays: new Map(),
    })
  }

  const assignments: Assignment[] = []
  const assignedByDate = new Map<string, Assignment[]>()
  const missed: SlotDemand[] = []

  for (const date of dates) {
    const category = ctx.categoryByDate.get(date)!
    const weekday = ctx.weekdayByDate.get(date)!
    const weekKey = ctx.weekKeyByDate.get(date)!
    const dayList: Assignment[] = []
    assignedByDate.set(date, dayList)

    for (const shift of data.shifts) {
      const roleNeeds: { roleId: string; needed: number }[] = []
      for (const role of data.roles) {
        const needed = neededCount(data, date, category, role.id, shift.id)
        if (needed > 0) roleNeeds.push({ roleId: role.id, needed })
      }
      if (roleNeeds.length === 0) continue

      const demands: SlotDemand[] = []
      for (const rn of roleNeeds) {
        for (let i = 0; i < rn.needed; i++) {
          demands.push({ date, shiftId: shift.id, roleId: rn.roleId, category, weekday, weekKey })
        }
      }

      let expNeeded = Math.min(data.constraints.minExperiencedPerShift, demands.length)

      for (let di = 0; di < demands.length; di++) {
        const demand = demands[di]
        const remainingSlots = demands.length - di
        const mustBeExperienced = expNeeded >= remainingSlots

        const chosen = pickStaff(ctx, demand, states, dayList, rng, mustBeExperienced)

        if (chosen) {
          const a: Assignment = {
            date,
            shiftId: shift.id,
            roleId: demand.roleId,
            staffId: chosen.id,
          }
          applyAssign(ctx, states.get(chosen.id)!, a)
          dayList.push(a)
          assignments.push(a)
          if (isExperienced(chosen) && expNeeded > 0) expNeeded--
        } else {
          missed.push(demand)
        }
      }
    }
  }

  // 修復パス: 埋まらなかったスロットを同日内の入れ替えで充足を試みる
  if (missed.length > 0) {
    repair(ctx, states, assignments, assignedByDate, missed)
  }

  // 検証（人数不足・法令・運用の警告を一括生成。手動編集後と同じ基準）
  const { unfilled, warnings } = validateSchedule(data, assignments)

  const staffLoad: Record<string, number> = {}
  for (const s of data.staff) staffLoad[s.id] = states.get(s.id)!.totalAssigned

  const score = computeScore(ctx, unfilled, warnings, states, assignments)

  return { assignments, unfilled, warnings, staffLoad, score }
}

/**
 * 修復パス。未充足スロットごとに:
 *  (a) 直接割り当て（構築後の状態で再試行）
 *  (b) 深さ1のチェーン移動: 同日の別スロットにいる A を未充足スロットへ移し、
 *      空いた元スロットに未出勤の B を入れる
 * を試す。改善がなくなるまで最大4パス繰り返す。
 */
function repair(
  ctx: Ctx,
  states: Map<string, StaffState>,
  assignments: Assignment[],
  assignedByDate: Map<string, Assignment[]>,
  missed: SlotDemand[],
) {
  const { data } = ctx

  const removeFromList = (list: Assignment[], a: Assignment) => {
    const i = list.indexOf(a)
    if (i >= 0) list.splice(i, 1)
  }

  const tryFill = (demand: SlotDemand): boolean => {
    const dayList = assignedByDate.get(demand.date)!

    // (a) 直接割り当て（分割勤務可なら既に出勤中の人も候補。hardCheck が時間重複を判定）
    for (const staff of data.staff) {
      const st = states.get(staff.id)!
      if (!hardCheck(ctx, demand, staff, st, dayStaffIds(dayList)).ok) continue
      if (!expOkAfter(ctx, dayList, demand.shiftId, staff, null)) continue
      const a: Assignment = {
        date: demand.date,
        shiftId: demand.shiftId,
        roleId: demand.roleId,
        staffId: staff.id,
      }
      applyAssign(ctx, st, a)
      dayList.push(a)
      assignments.push(a)
      return true
    }

    // (b) チェーン移動（A を未充足スロットへ、B を A の元スロットへ）
    for (const A of data.staff) {
      // A の当日割り当てのうち、対象スロットとは別のものを1つ選ぶ
      const curA = dayList.find(
        (x) =>
          x.staffId === A.id && !(x.shiftId === demand.shiftId && x.roleId === demand.roleId),
      )
      if (!curA) continue
      const stA = states.get(A.id)!
      const origShift = curA.shiftId
      const origRole = curA.roleId

      // A をいったん外して、未充足スロットに入れるか確認
      removeAssign(ctx, stA, curA)
      removeFromList(dayList, curA)

      const moveOk =
        hardCheck(ctx, demand, A, stA, dayStaffIds(dayList)).ok &&
        expOkAfter(ctx, dayList, demand.shiftId, A, null)

      if (!moveOk) {
        // 戻す
        applyAssign(ctx, stA, curA)
        dayList.push(curA)
        continue
      }

      // A を未充足スロットへ移動（同じオブジェクトを書き換え）
      curA.shiftId = demand.shiftId
      curA.roleId = demand.roleId
      applyAssign(ctx, stA, curA)
      dayList.push(curA)

      // 元スロットに入れる B を探す
      const origDemand: SlotDemand = { ...demand, shiftId: origShift, roleId: origRole }
      let filled = false
      for (const B of data.staff) {
        if (B.id === A.id) continue
        const stB = states.get(B.id)!
        if (!hardCheck(ctx, origDemand, B, stB, dayStaffIds(dayList)).ok) continue
        if (!expOkAfter(ctx, dayList, origShift, B, null)) continue
        if (!expOkAfter(ctx, dayList, demand.shiftId, null, null)) continue
        const b: Assignment = {
          date: demand.date,
          shiftId: origShift,
          roleId: origRole,
          staffId: B.id,
        }
        applyAssign(ctx, stB, b)
        dayList.push(b)
        assignments.push(b)
        filled = true
        break
      }
      if (filled) return true

      // B が見つからない → A を元に戻す
      removeAssign(ctx, stA, curA)
      removeFromList(dayList, curA)
      curA.shiftId = origShift
      curA.roleId = origRole
      applyAssign(ctx, stA, curA)
      dayList.push(curA)
    }

    return false
  }

  for (let pass = 0; pass < 4; pass++) {
    let progress = false
    for (let i = missed.length - 1; i >= 0; i--) {
      if (tryFill(missed[i])) {
        missed.splice(i, 1)
        progress = true
      }
    }
    if (!progress || missed.length === 0) break
  }
}

/**
 * 1スロットに割り当てるスタッフを選ぶ。
 * ハード制約を満たす候補の中から、ソフト制約に基づくスコアで最良を選ぶ。
 */
function pickStaff(
  ctx: Ctx,
  demand: SlotDemand,
  states: Map<string, StaffState>,
  dayList: Assignment[],
  rng: () => number,
  mustBeExperienced: boolean,
): Staff | null {
  const { data } = ctx
  const weights = data.constraints.weights
  const candidates: { staff: Staff; score: number }[] = []
  const todayIds = dayStaffIds(dayList)

  for (const staff of data.staff) {
    // H3: 経験者要件
    if (mustBeExperienced && !isExperienced(staff)) continue

    const st = states.get(staff.id)!
    const hc = hardCheck(ctx, demand, staff, st, todayIds)
    if (!hc.ok) continue

    // ---- ソフト制約スコア（低いほど優先） ----
    let score = 0
    // S0: 分割勤務の積極活用 — 既にその日出勤している人に2コマ目を強く優先
    //     （少人数で回したい場合。公平化より優先させるため大きめのボーナス）
    if (ctx.preferSplitShifts && (st.dayShiftIds.get(demand.date)?.length ?? 0) > 0) {
      score -= 20
    }
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
    score += hc.restViolations * 3
    // S6: なるべく同じ日に入れるペア
    const partners = ctx.together.get(staff.id)
    if (partners) {
      for (const otherId of todayIds) {
        if (partners.has(otherId)) {
          score -= Math.max(1, weights.preference)
          break
        }
      }
    }
    // 曜日固定に合致する割り当ては強く優遇
    if (ctx.rulesByStaff.get(staff.id)?.fixByWeekday.get(demand.weekday) === demand.shiftId) {
      score -= 3
    }
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
    let cost = 0
    for (const a of assignments) {
      const st = ctx.staffById.get(a.staffId)
      const paid = ctx.paidMinByShift.get(a.shiftId) ?? 0
      if (st) cost += (paid / 60) * st.hourlyWage
    }
    score -= (cost / 10000) * weights.cost
  }
  return score
}
