import { useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { generateSchedule } from '../solver/scheduler'
import type { Assignment, ScheduleResult } from '../types'
import { enumerateDates } from '../utils/date'
import { exportCsv } from '../utils/csv'
import ScheduleGrid from './ScheduleGrid'

export default function GenerateTab() {
  const data = useStore((s) => s.data)
  const [result, setResult] = useState<ScheduleResult | null>(null)
  const [generating, setGenerating] = useState(false)

  const dates = useMemo(() => enumerateDates(data.period), [data.period])

  const handleGenerate = () => {
    setGenerating(true)
    // UIをブロックしないよう次フレームで実行
    setTimeout(() => {
      const r = generateSchedule(data)
      setResult(r)
      setGenerating(false)
    }, 10)
  }

  const setAssignments = (assignments: Assignment[]) => {
    if (!result) return
    // 手動編集後、負荷を再計算
    const staffLoad: Record<string, number> = {}
    for (const s of data.staff) staffLoad[s.id] = 0
    for (const a of assignments) staffLoad[a.staffId] = (staffLoad[a.staffId] ?? 0) + 1
    setResult({ ...result, assignments, staffLoad })
  }

  const errors = result?.warnings.filter((w) => w.severity === 'error') ?? []
  const softWarnings = result?.warnings.filter((w) => w.severity === 'warning') ?? []

  const preflightIssues = preflight(data, dates.length)

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-bold text-slate-700">シフト生成</h2>
        <div className="flex gap-2">
          {result && (
            <>
              <button className="btn-ghost" onClick={() => window.print()}>
                🖨️ 印刷
              </button>
              <button className="btn-ghost" onClick={() => exportCsv(data, result)}>
                ⬇️ CSV
              </button>
            </>
          )}
          <button className="btn-primary" onClick={handleGenerate} disabled={generating}>
            {generating ? '生成中…' : '✨ シフトを生成'}
          </button>
        </div>
      </div>

      <div className="no-print text-sm text-slate-500">
        対象期間: {data.period.start} 〜 {data.period.end}（{dates.length}日）/ スタッフ{' '}
        {data.staff.length}名
      </div>

      {preflightIssues.length > 0 && (
        <div className="no-print rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <p className="font-medium">⚠️ 生成前の確認</p>
          <ul className="ml-4 list-disc">
            {preflightIssues.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
      )}

      {!result && (
        <div className="card text-center text-slate-400">
          「シフトを生成」を押すと、条件を満たす最適なシフト表を作成します。
        </div>
      )}

      {result && (
        <>
          {/* サマリー */}
          <div className="no-print grid grid-cols-2 gap-3 sm:grid-cols-4">
            <SummaryCard label="割り当て" value={`${result.assignments.length}件`} tone="brand" />
            <SummaryCard
              label="人数不足"
              value={`${errors.length}件`}
              tone={errors.length ? 'red' : 'green'}
            />
            <SummaryCard
              label="警告"
              value={`${softWarnings.length}件`}
              tone={softWarnings.length ? 'amber' : 'green'}
            />
            <SummaryCard
              label="出勤数の差"
              value={loadRange(result)}
              tone="slate"
            />
          </div>

          {/* カレンダー/グリッド */}
          <ScheduleGrid data={data} result={result} onChange={setAssignments} />

          {/* 未充足・警告 */}
          {(errors.length > 0 || softWarnings.length > 0) && (
            <div className="no-print space-y-2">
              {errors.length > 0 && (
                <div className="rounded-md border border-red-200 bg-red-50 p-3">
                  <p className="mb-1 text-sm font-bold text-red-700">
                    人数不足（{errors.length}件）
                  </p>
                  <ul className="space-y-0.5 text-sm text-red-600">
                    {errors.map((w, i) => (
                      <li key={i}>{w.message}</li>
                    ))}
                  </ul>
                </div>
              )}
              {softWarnings.length > 0 && (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
                  <p className="mb-1 text-sm font-bold text-amber-700">
                    警告（{softWarnings.length}件）
                  </p>
                  <ul className="space-y-0.5 text-sm text-amber-700">
                    {softWarnings.map((w, i) => (
                      <li key={i}>{w.message}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* メモ */}
          {data.constraints.notes.trim() && (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
              <p className="mb-1 font-bold">📝 条件メモ</p>
              <p className="whitespace-pre-wrap">{data.constraints.notes}</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function preflight(data: ReturnType<typeof useStore.getState>['data'], dayCount: number): string[] {
  const issues: string[] = []
  if (dayCount <= 0) issues.push('期間が不正です（開始日 ≤ 終了日 にしてください）。')
  if (data.staff.length === 0) issues.push('スタッフが登録されていません。')
  if (data.staff.some((s) => s.roleIds.length === 0))
    issues.push('役割が未設定のスタッフがいます（そのスタッフは割り当てられません）。')
  const totalNeed = data.requirements.reduce(
    (acc, r) => acc + Math.max(...Object.values(r.counts)),
    0,
  )
  if (totalNeed === 0) issues.push('必要人数がすべて0です。「必要人数」で設定してください。')
  return issues
}

function loadRange(result: ScheduleResult): string {
  const loads = Object.values(result.staffLoad)
  if (loads.length === 0) return '-'
  return `${Math.min(...loads)}〜${Math.max(...loads)}日`
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: 'brand' | 'red' | 'green' | 'amber' | 'slate'
}) {
  const tones: Record<string, string> = {
    brand: 'text-brand-600',
    red: 'text-red-600',
    green: 'text-emerald-600',
    amber: 'text-amber-600',
    slate: 'text-slate-600',
  }
  return (
    <div className="card">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`text-xl font-bold ${tones[tone]}`}>{value}</p>
    </div>
  )
}
