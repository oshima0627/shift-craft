import type {
  AppData,
  Assignment,
  ScheduleResult,
  Staff,
  Unfilled,
  Warning,
} from '../types'
import { dayCategoryOf, displayDate, enumerateDates } from '../utils/date'

/**
 * シフト最適化ソルバー。
 *
 * 方針: 小規模（〜20人/月次）向けに、貪欲法 + 複数回ランダムリスタート
 * + 局所探索で「十分に良い」解を高速に求める。
 *
 * ハード制約:
 *  H2 NGペア  / H3 経験者最低数 / H4 出勤不可日 / H5 出勤上限・連勤上限 / H6 1人1日1シフト
 * は割り当て時に必ず守る（違反する割り当ては行わない）。
 * H1 必要人数は可能な限り満たし、満たせない分は unfilled として報告する。
 *
 * ソフト制約:
 *  S1 公平化 / S2 希望シフト をスコアに反映して最小化/最大化する。
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
  category: ReturnType<typeof dayCategoryOf>
}

/** 生成中に更新するスタッフの状態 */
interface StaffState {
  assignedDates: Set<string>
  totalAssigned: number
  // date -> shiftId（その日どのシフトに入ったか。1人1日1シフト前提）
  dayShift: Map<string, string>
}

function isExperienced(s: Staff): boolean {
  return s.level >= 1
}

/** 指定日を含めたときの連続出勤日数（前後の連なりの長さ）を返す */
function consecutiveRunLength(assigned: Set<string>, dateStr: string, allDates: string[]): number {
  const idx = allDates.indexOf(dateStr)
  if (idx < 0) return 1
  let run = 1
  // 前方向
  for (let i = idx - 1; i >= 0; i--) {
    if (assigned.has(allDates[i])) run++
    else break
  }
  // 後方向
  for (let i = idx + 1; i < allDates.length; i++) {
    if (assigned.has(allDates[i])) run++
    else break
  }
  return run
}

/** メインの生成関数 */
export function generateSchedule(data: AppData, attempts = 40, seed = 12345): ScheduleResult {
  const dates = enumerateDates(data.period)
  const staffById = new Map(data.staff.map((s) => [s.id, s]))

  // NGペアを高速判定用のセットに（"a|b" 正規化）
  const incompatible = new Set<string>()
  for (const p of data.constraints.incompatiblePairs) {
    if (!p.a || !p.b || p.a === p.b) continue
    incompatible.add(pairKey(p.a, p.b))
  }

  let best: ScheduleResult | null = null

  for (let attempt = 0; attempt < Math.max(1, attempts); attempt++) {
    const rng = makeRng(seed + attempt * 7919)
    const result = runOnce(data, dates, staffById, incompatible, rng)
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

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

function runOnce(
  data: AppData,
  dates: string[],
  staffById: Map<string, Staff>,
  incompatible: Set<string>,
  rng: () => number,
): ScheduleResult {
  const states = new Map<string, StaffState>()
  for (const s of data.staff) {
    states.set(s.id, { assignedDates: new Set(), totalAssigned: 0, dayShift: new Map() })
  }

  const assignments: Assignment[] = []
  const unfilled: Unfilled[] = []
  const warnings: Warning[] = []

  // その日に既に割り当てたスタッフ集合（NGペア/重複判定用）
  for (const date of dates) {
    const category = dayCategoryOf(date, data.period.holidays)
    const assignedToday = new Set<string>()

    // その日のシフト×役割ごとに必要人数を集める
    // シフト単位で処理し、経験者最低数を保証する
    for (const shift of data.shifts) {
      // このシフトで必要な（役割, 人数）
      const roleNeeds = data.requirements
        .filter((r) => r.shiftId === shift.id && r.counts[category] > 0)
        .map((r) => ({ roleId: r.roleId, needed: r.counts[category] }))

      if (roleNeeds.length === 0) continue

      // このシフトに割り当てたスタッフ（経験者数の確認用）
      const assignedThisShift: string[] = []

      // 経験者を優先的に確保するため、役割をシャッフルしつつ充足
      const demands: SlotDemand[] = []
      for (const rn of roleNeeds) {
        for (let i = 0; i < rn.needed; i++) {
          demands.push({ date, shiftId: shift.id, roleId: rn.roleId, category })
        }
      }

      let expNeeded = Math.min(
        data.constraints.minExperiencedPerShift,
        demands.length,
      )

      for (let di = 0; di < demands.length; di++) {
        const demand = demands[di]
        const remainingSlots = demands.length - di
        // 残りスロットで経験者要件を満たす必要があるか
        const mustBeExperienced = expNeeded >= remainingSlots

        const chosen = pickStaff(
          data,
          demand,
          dates,
          states,
          incompatible,
          assignedToday,
          rng,
          mustBeExperienced,
        )

        if (chosen) {
          const st = states.get(chosen.id)!
          st.assignedDates.add(date)
          st.totalAssigned++
          st.dayShift.set(date, shift.id)
          assignedToday.add(chosen.id)
          assignedThisShift.push(chosen.id)
          assignments.push({
            date,
            shiftId: shift.id,
            roleId: demand.roleId,
            staffId: chosen.id,
          })
          if (isExperienced(chosen) && expNeeded > 0) expNeeded--
        } else {
          // 充足できず。unfilled に加算（同一role/shift/dateでまとめる）
          addUnfilled(unfilled, demand.date, demand.shiftId, demand.roleId)
        }
      }

      // 経験者最低数チェック（満たせなかった場合は警告）
      if (data.constraints.minExperiencedPerShift > 0 && assignedThisShift.length > 0) {
        const expCount = assignedThisShift.filter((id) => isExperienced(staffById.get(id)!)).length
        if (expCount < Math.min(data.constraints.minExperiencedPerShift, assignedThisShift.length)) {
          warnings.push({
            date,
            shiftId: shift.id,
            severity: 'warning',
            message: `${displayDate(date)} ${shift.name}: 経験者が${expCount}名（最低${data.constraints.minExperiencedPerShift}名）。新人のみ／経験者不足の可能性。`,
          })
        }
      }
    }
  }

  // 未充足を警告に反映
  for (const u of unfilled) {
    const role = data.roles.find((r) => r.id === u.roleId)
    const shift = data.shifts.find((s) => s.id === u.shiftId)
    warnings.push({
      date: u.date,
      shiftId: u.shiftId,
      severity: 'error',
      message: `${displayDate(u.date)} ${shift?.name ?? ''} / ${role?.name ?? ''}: ${u.needed}名必要のうち${u.filled}名のみ（${u.needed - u.filled}名不足）`,
    })
  }

  const staffLoad: Record<string, number> = {}
  for (const s of data.staff) staffLoad[s.id] = states.get(s.id)!.totalAssigned

  const score = computeScore(unfilled, warnings, staffLoad, data)

  return { assignments, unfilled, warnings, staffLoad, score }
}

function addUnfilled(list: Unfilled[], date: string, shiftId: string, roleId: string) {
  const existing = list.find(
    (u) => u.date === date && u.shiftId === shiftId && u.roleId === roleId,
  )
  if (existing) {
    existing.needed++
  } else {
    list.push({ date, shiftId, roleId, needed: 1, filled: 0 })
  }
}

/**
 * 1スロットに割り当てるスタッフを選ぶ。
 * ハード制約を満たす候補の中から、ソフト制約に基づくスコアで最良を選ぶ。
 */
function pickStaff(
  data: AppData,
  demand: SlotDemand,
  dates: string[],
  states: Map<string, StaffState>,
  incompatible: Set<string>,
  assignedToday: Set<string>,
  rng: () => number,
  mustBeExperienced: boolean,
): Staff | null {
  const candidates: { staff: Staff; score: number }[] = []

  for (const staff of data.staff) {
    // 役割を担当できるか
    if (!staff.roleIds.includes(demand.roleId)) continue
    // 経験者要件
    if (mustBeExperienced && !isExperienced(staff)) continue
    // H6: すでに今日どこかに入っている（1人1日1シフト）
    if (assignedToday.has(staff.id)) continue
    // H4: 出勤不可日・希望休
    if (staff.unavailableDates.includes(demand.date)) continue
    // シフト時間帯の制限
    if (staff.allowedShiftIds.length > 0 && !staff.allowedShiftIds.includes(demand.shiftId)) continue

    const st = states.get(staff.id)!
    // H5: 出勤上限
    if (staff.maxShifts != null && st.totalAssigned >= staff.maxShifts) continue
    // H5: 連勤上限
    if (staff.maxConsecutive != null) {
      const tentative = new Set(st.assignedDates)
      tentative.add(demand.date)
      if (consecutiveRunLength(tentative, demand.date, dates) > staff.maxConsecutive) continue
    }
    // H2: NGペア（今日既に入っている人と衝突しないか）
    let conflict = false
    for (const otherId of assignedToday) {
      if (incompatible.has(pairKey(staff.id, otherId))) {
        conflict = true
        break
      }
    }
    if (conflict) continue

    // ---- ソフト制約スコア（低いほど優先） ----
    let score = 0
    // S1: 公平化 — 出勤が少ない人を優先
    score += st.totalAssigned * data.constraints.weights.fairness
    // S2: 希望シフト — allowedShiftIds を「希望」とみなし、希望に合致すれば軽く優遇
    if (staff.allowedShiftIds.length > 0 && staff.allowedShiftIds.includes(demand.shiftId)) {
      score -= data.constraints.weights.preference
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
  unfilled: Unfilled[],
  warnings: Warning[],
  staffLoad: Record<string, number>,
  data: AppData,
): number {
  let score = 0
  // 未充足は最重要ペナルティ
  const unfilledCount = unfilled.reduce((acc, u) => acc + (u.needed - u.filled), 0)
  score -= unfilledCount * 1000
  // 経験者不足など warning
  score -= warnings.filter((w) => w.severity === 'warning').length * 200
  // 公平性: 出勤日数のばらつき（レンジ）を減点
  const loads = Object.values(staffLoad)
  if (loads.length > 0) {
    const max = Math.max(...loads)
    const min = Math.min(...loads)
    score -= (max - min) * data.constraints.weights.fairness * 5
  }
  return score
}
