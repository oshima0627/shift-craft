import type { AppData, Assignment } from '../types'
import { computeCostReport } from '../solver/cost'
import { minToLabel } from '../utils/time'
import { useStore } from '../state/store'

const yen = (n: number) => `¥${Math.round(n).toLocaleString()}`

/**
 * 人件費・生産性ダッシュボード。
 * 調査に基づく指標: 人件費率（目安25〜30%）/ 人時売上高（目標4,000円超）/ FL比率60%以内。
 */
export default function CostReport({
  data,
  assignments,
}: {
  data: AppData
  assignments: Assignment[]
}) {
  const updateCost = useStore((s) => s.updateCost)
  const report = computeCostReport(data, assignments)
  const { cost } = data

  const rateTone =
    report.laborRate == null
      ? 'text-slate-600'
      : report.laborRate <= cost.targetLaborRate
        ? 'text-emerald-600'
        : report.laborRate <= cost.targetLaborRate + 5
          ? 'text-amber-600'
          : 'text-red-600'

  const sphTone =
    report.salesPerLaborHour == null
      ? 'text-slate-600'
      : report.salesPerLaborHour >= 4000
        ? 'text-emerald-600'
        : 'text-amber-600'

  return (
    <div className="card space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-slate-700">💰 人件費・生産性</h3>
        <div className="no-print flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <label className="flex items-center gap-1">
            期間の売上目標
            <input
              type="number"
              min={0}
              step={10000}
              className="input w-32 py-1 text-xs"
              value={cost.salesTarget ?? ''}
              placeholder="例: 3000000"
              onChange={(e) =>
                updateCost({ salesTarget: e.target.value === '' ? null : Number(e.target.value) })
              }
            />
            円
          </label>
          <label className="flex items-center gap-1">
            目標人件費率
            <input
              type="number"
              min={1}
              max={80}
              className="input w-16 py-1 text-xs"
              value={cost.targetLaborRate}
              onChange={(e) => updateCost({ targetLaborRate: Number(e.target.value) })}
            />
            %
          </label>
          <label className="flex cursor-pointer items-center gap-1">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-brand-500"
              checked={cost.includeWelfare}
              onChange={(e) => updateCost({ includeWelfare: e.target.checked })}
            />
            法定福利費15%込み
          </label>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <p className="text-xs text-slate-500">総実働時間</p>
          <p className="text-lg font-bold text-slate-700">{minToLabel(report.totalWorkMin)}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">
            総人件費{cost.includeWelfare ? '（福利費込）' : ''}
          </p>
          <p className="text-lg font-bold text-slate-700">{yen(report.grandTotal)}</p>
          {report.welfareCost > 0 && (
            <p className="text-xs text-slate-400">うち福利費 {yen(report.welfareCost)}</p>
          )}
        </div>
        <div>
          <p className="text-xs text-slate-500">人件費率（目安25〜30%）</p>
          <p className={`text-lg font-bold ${rateTone}`}>
            {report.laborRate == null ? '売上目標未設定' : `${report.laborRate.toFixed(1)}%`}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500">人時売上高（目標4,000円超）</p>
          <p className={`text-lg font-bold ${sphTone}`}>
            {report.salesPerLaborHour == null
              ? '売上目標未設定'
              : yen(report.salesPerLaborHour) + '/h'}
          </p>
        </div>
      </div>

      {report.laborRate != null && report.laborRate > cost.targetLaborRate && (
        <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-700">
          目標人件費率{cost.targetLaborRate}%を超えています。必要人数の見直し
          （アイドルタイムの配置過剰がないか）や売上目標の再確認を検討してください。
          ※ FL比率（食材費＋人件費）は売上の60%以内が業界目安です。
        </p>
      )}

      <details className="text-sm">
        <summary className="cursor-pointer text-xs font-medium text-slate-500">
          スタッフ別内訳を表示
        </summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-1 pr-2">スタッフ</th>
                <th className="py-1 pr-2 text-right">出勤</th>
                <th className="py-1 pr-2 text-right">実働</th>
                <th className="py-1 pr-2 text-right">休憩</th>
                <th className="py-1 pr-2 text-right">深夜</th>
                <th className="py-1 pr-2 text-right">時給</th>
                <th className="py-1 pr-2 text-right">基本</th>
                <th className="py-1 pr-2 text-right">深夜割増</th>
                <th className="py-1 text-right">合計</th>
              </tr>
            </thead>
            <tbody>
              {report.perStaff
                .filter((r) => r.days > 0)
                .map((r) => (
                  <tr key={r.staffId} className="border-b border-slate-100">
                    <td className="py-1 pr-2 font-medium text-slate-700">{r.name}</td>
                    <td className="py-1 pr-2 text-right">{r.days}日</td>
                    <td className="py-1 pr-2 text-right">{minToLabel(r.workMin)}</td>
                    <td className="py-1 pr-2 text-right">{minToLabel(r.breakMin)}</td>
                    <td className="py-1 pr-2 text-right">
                      {r.nightMin > 0 ? minToLabel(r.nightMin) : '-'}
                    </td>
                    <td className="py-1 pr-2 text-right">{yen(r.hourlyWage)}</td>
                    <td className="py-1 pr-2 text-right">{yen(r.baseCost)}</td>
                    <td className="py-1 pr-2 text-right">
                      {r.nightPremium > 0 ? yen(r.nightPremium) : '-'}
                    </td>
                    <td className="py-1 text-right font-medium">{yen(r.total)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          <p className="mt-1 text-xs text-slate-400">
            ※ 基本 = 時給×実働（拘束−法定休憩）。深夜割増 = 22時〜翌5時×25%。
            1日8時間超は自動で25%割増を加算。
          </p>
        </div>
      </details>
    </div>
  )
}
