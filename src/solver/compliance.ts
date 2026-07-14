import type { AppData, Assignment, Unfilled, Warning } from '../types'
import { dayCategoryOf, displayDate, enumerateDates } from '../utils/date'
import { neededCount } from '../utils/requirements'
import {
  isMinorForbidden,
  minToLabel,
  paidMin,
  restBetweenMin,
  weekKeyOf,
} from '../utils/time'

/**
 * 労働法・運用ルールの検証エンジン。
 * 生成直後だけでなく、手動編集後のスケジュールにも同じ基準を適用する。
 *
 * チェック項目（調査に基づく）:
 *  - 人数不足（必要人数の未充足）
 *  - 新人のみ・経験者不足のシフト
 *  - 年少者（18歳未満）の深夜シフト（労基法61条: 22時〜翌5時不可）
 *  - 週の労働時間上限（労基法32条: 40h / 特例44h。年少者は40h厳守・労基法60条）
 *  - 週の出勤日数（労基法35条: 毎週1日以上の休日 → 週6日まで）
 *  - 連勤上限（既定6日。7連勤以上はエラー）
 *  - 勤務間インターバル（努力義務: 9〜11h推奨。クローピング=遅番→翌早番の検出）
 */
export function validateSchedule(
  data: AppData,
  assignments: Assignment[],
): { unfilled: Unfilled[]; warnings: Warning[] } {
  const warnings: Warning[] = []
  const unfilled: Unfilled[] = []
  const dates = enumerateDates(data.period)
  const staffById = new Map(data.staff.map((s) => [s.id, s]))
  const shiftById = new Map(data.shifts.map((s) => [s.id, s]))

  // ---- 1. 人数充足チェック ----
  const countByKey = new Map<string, number>()
  for (const a of assignments) {
    const key = `${a.date}|${a.shiftId}|${a.roleId}`
    countByKey.set(key, (countByKey.get(key) ?? 0) + 1)
  }
  for (const date of dates) {
    const category = dayCategoryOf(date, data.period.holidays)
    for (const role of data.roles) {
      for (const shift of data.shifts) {
        // 特定日の上書き ＞ 曜日区分 で必要人数を解決
        const needed = neededCount(data, date, category, role.id, shift.id)
        if (needed <= 0) continue
        const filled = countByKey.get(`${date}|${shift.id}|${role.id}`) ?? 0
        if (filled < needed) {
          unfilled.push({ date, shiftId: shift.id, roleId: role.id, needed, filled })
          warnings.push({
            date,
            shiftId: shift.id,
            kind: 'coverage',
            severity: 'error',
            message: `${displayDate(date)} ${shift.name} / ${role.name}: ${needed}名必要のうち${filled}名のみ（${needed - filled}名不足）`,
          })
        }
      }
    }
  }

  // ---- 2. 新人のみ・経験者不足 ----
  if (data.constraints.minExperiencedPerShift > 0) {
    const byShiftGroup = new Map<string, string[]>()
    for (const a of assignments) {
      const key = `${a.date}|${a.shiftId}`
      if (!byShiftGroup.has(key)) byShiftGroup.set(key, [])
      byShiftGroup.get(key)!.push(a.staffId)
    }
    for (const [key, ids] of byShiftGroup) {
      const [date, shiftId] = key.split('|')
      const expCount = ids.filter((id) => (staffById.get(id)?.level ?? 0) >= 1).length
      const required = Math.min(data.constraints.minExperiencedPerShift, ids.length)
      if (expCount < required) {
        warnings.push({
          date,
          shiftId,
          kind: 'staffing',
          severity: 'warning',
          message: `${displayDate(date)} ${shiftById.get(shiftId)?.name ?? ''}: 経験者が${expCount}名（最低${data.constraints.minExperiencedPerShift}名）。新人のみ／経験者不足の可能性。`,
        })
      }
    }
  }

  // ---- 3. 年少者の深夜シフト ----
  for (const a of assignments) {
    const st = staffById.get(a.staffId)
    const sh = shiftById.get(a.shiftId)
    if (!st || !sh) continue
    if (st.isMinor && isMinorForbidden(sh)) {
      warnings.push({
        date: a.date,
        shiftId: a.shiftId,
        staffId: a.staffId,
        kind: 'law',
        severity: 'error',
        message: `${displayDate(a.date)} ${st.name}: 18歳未満は22時〜翌5時の深夜帯に勤務不可（労基法61条）。「${sh.name}」(${sh.start}〜${sh.end})は割り当てできません。`,
      })
    }
  }

  // ---- 4〜7. スタッフ別の時系列チェック ----
  const byStaff = new Map<string, Assignment[]>()
  for (const a of assignments) {
    if (!byStaff.has(a.staffId)) byStaff.set(a.staffId, [])
    byStaff.get(a.staffId)!.push(a)
  }
  const dateIndex = new Map(dates.map((d, i) => [d, i]))
  const restLimitMin = data.constraints.restIntervalHours * 60

  for (const [staffId, list] of byStaff) {
    const st = staffById.get(staffId)
    if (!st) continue
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date))

    // 週の労働時間・日数
    const weekMin = new Map<string, number>()
    const weekDays = new Map<string, Set<string>>()
    for (const a of sorted) {
      const sh = shiftById.get(a.shiftId)
      if (!sh) continue
      const wk = weekKeyOf(a.date)
      weekMin.set(wk, (weekMin.get(wk) ?? 0) + paidMin(sh))
      if (!weekDays.has(wk)) weekDays.set(wk, new Set())
      weekDays.get(wk)!.add(a.date)
    }
    const capH = st.isMinor
      ? Math.min(40, data.constraints.weeklyHoursCap)
      : Math.min(st.weeklyMaxHours ?? Infinity, data.constraints.weeklyHoursCap)
    for (const [wk, min] of weekMin) {
      if (min > capH * 60) {
        warnings.push({
          date: wk,
          staffId,
          kind: 'law',
          severity: 'error',
          message: `${st.name}: ${displayDate(wk)}週の実働が${minToLabel(min)}で上限${capH}時間を超過${st.isMinor ? '（年少者は週40h厳守・労基法60条）' : '（法定労働時間・労基法32条）'}。`,
        })
      }
    }
    for (const [wk, days] of weekDays) {
      if (days.size > 6) {
        warnings.push({
          date: wk,
          staffId,
          kind: 'law',
          severity: 'error',
          message: `${st.name}: ${displayDate(wk)}週に7日出勤。毎週1日以上の休日が必要です（労基法35条）。`,
        })
      }
    }

    // 連勤
    const limit =
      st.maxConsecutive ?? data.constraints.maxConsecutiveDefault
    const assignedSet = new Set(sorted.map((a) => a.date))
    let run = 0
    let runStart = ''
    for (const d of dates) {
      if (assignedSet.has(d)) {
        if (run === 0) runStart = d
        run++
      } else {
        if (run > limit) pushConsecutiveWarning(warnings, st.name, staffId, runStart, run, limit)
        run = 0
      }
    }
    if (run > limit) pushConsecutiveWarning(warnings, st.name, staffId, runStart, run, limit)

    // 勤務間インターバル（クローピング）
    if (restLimitMin > 0) {
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1]
        const cur = sorted[i]
        const pi = dateIndex.get(prev.date)
        const ci = dateIndex.get(cur.date)
        if (pi == null || ci == null || ci - pi !== 1) continue // 隣接日のみ
        const prevShift = shiftById.get(prev.shiftId)
        const curShift = shiftById.get(cur.shiftId)
        if (!prevShift || !curShift) continue
        const rest = restBetweenMin(prevShift, curShift)
        if (rest < restLimitMin) {
          warnings.push({
            date: cur.date,
            staffId,
            kind: 'law',
            severity: data.constraints.restIntervalHard ? 'error' : 'warning',
            message: `${st.name}: ${displayDate(prev.date)}「${prevShift.name}」→ ${displayDate(cur.date)}「${curShift.name}」の休息が${minToLabel(rest)}（推奨${data.constraints.restIntervalHours}時間未満）。遅番→翌早番の連続（クローピング）は疲労蓄積の原因になります。`,
          })
        }
      }
    }
  }

  return { unfilled, warnings }
}

function pushConsecutiveWarning(
  warnings: Warning[],
  name: string,
  staffId: string,
  runStart: string,
  run: number,
  limit: number,
) {
  warnings.push({
    date: runStart,
    staffId,
    kind: 'law',
    severity: run > 6 ? 'error' : 'warning',
    message: `${name}: ${displayDate(runStart)}から${run}連勤（上限${limit}日）。${run > 6 ? '週1休の確保が必要です（労基法35条）。' : ''}`,
  })
}
