import type { AppData, Assignment } from '../types'
import { boundMin, legalBreakMin, nightMin, paidMin } from '../utils/time'

/**
 * 人件費計算エンジン（調査に基づく実装）:
 *  - 基本給 = 時給 × 実働時間（拘束 − 法定休憩）
 *  - 深夜割増 = 22時〜翌5時の時間 × 時給 × 25%（労基法37条）
 *  - 残業割増 = 1日8時間超の実働 × 時給 × 25%（概算）
 *  - 法定福利費 = 人件費 × 約15%（会社負担分の目安。オプション）
 *  - 指標: 人件費率（目標25〜30%）/ 人時売上高（目標4,000円超）/ FL比率の説明
 */

export interface StaffCostRow {
  staffId: string
  name: string
  days: number
  /** 実働（分） */
  workMin: number
  /** 休憩（分） */
  breakMin: number
  /** 深夜帯（分） */
  nightMin: number
  /** 1日8時間超の概算残業（分） */
  overtimeMin: number
  hourlyWage: number
  baseCost: number
  nightPremium: number
  overtimePremium: number
  total: number
}

export interface CostReportData {
  perStaff: StaffCostRow[]
  totalWorkMin: number
  totalCost: number
  /** 法定福利費（目安15%）。includeWelfare=false なら 0 */
  welfareCost: number
  /** 総人件費（福利費込み） */
  grandTotal: number
  /** 人件費率(%)。売上目標未設定なら null */
  laborRate: number | null
  /** 人時売上高（円/時間）。売上目標未設定なら null */
  salesPerLaborHour: number | null
}

export function computeCostReport(data: AppData, assignments: Assignment[]): CostReportData {
  const shiftById = new Map(data.shifts.map((s) => [s.id, s]))
  const rows = new Map<string, StaffCostRow>()

  for (const staff of data.staff) {
    rows.set(staff.id, {
      staffId: staff.id,
      name: staff.name,
      days: 0,
      workMin: 0,
      breakMin: 0,
      nightMin: 0,
      overtimeMin: 0,
      hourlyWage: staff.hourlyWage,
      baseCost: 0,
      nightPremium: 0,
      overtimePremium: 0,
      total: 0,
    })
  }

  for (const a of assignments) {
    const row = rows.get(a.staffId)
    const shift = shiftById.get(a.shiftId)
    if (!row || !shift) continue
    const bound = boundMin(shift)
    const brk = legalBreakMin(bound)
    const work = paidMin(shift)
    row.days++
    row.workMin += work
    row.breakMin += brk
    row.nightMin += nightMin(shift)
    row.overtimeMin += Math.max(0, work - 480)
  }

  let totalWorkMin = 0
  let totalCost = 0
  const perStaff: StaffCostRow[] = []
  for (const row of rows.values()) {
    const hourly = row.hourlyWage
    row.baseCost = Math.round((row.workMin / 60) * hourly)
    row.nightPremium = Math.round((row.nightMin / 60) * hourly * 0.25)
    row.overtimePremium = Math.round((row.overtimeMin / 60) * hourly * 0.25)
    row.total = row.baseCost + row.nightPremium + row.overtimePremium
    totalWorkMin += row.workMin
    totalCost += row.total
    perStaff.push(row)
  }
  perStaff.sort((a, b) => b.total - a.total)

  const welfareCost = data.cost.includeWelfare ? Math.round(totalCost * 0.15) : 0
  const grandTotal = totalCost + welfareCost

  const sales = data.cost.salesTarget
  const laborRate = sales && sales > 0 ? (grandTotal / sales) * 100 : null
  const salesPerLaborHour =
    sales && sales > 0 && totalWorkMin > 0 ? sales / (totalWorkMin / 60) : null

  return { perStaff, totalWorkMin, totalCost, welfareCost, grandTotal, laborRate, salesPerLaborHour }
}
