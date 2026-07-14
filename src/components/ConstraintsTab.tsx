import { useState } from 'react'
import { useStore } from '../state/store'

export default function ConstraintsTab() {
  const staff = useStore((s) => s.data.staff)
  const constraints = useStore((s) => s.data.constraints)
  const updateConstraints = useStore((s) => s.updateConstraints)
  const [pairA, setPairA] = useState('')
  const [pairB, setPairB] = useState('')

  const nameOf = (id: string) => staff.find((s) => s.id === id)?.name ?? '(不明)'

  const addPair = () => {
    if (!pairA || !pairB || pairA === pairB) return
    const exists = constraints.incompatiblePairs.some(
      (p) =>
        (p.a === pairA && p.b === pairB) || (p.a === pairB && p.b === pairA),
    )
    if (exists) return
    updateConstraints({
      incompatiblePairs: [...constraints.incompatiblePairs, { a: pairA, b: pairB }],
    })
    setPairA('')
    setPairB('')
  }

  const removePair = (index: number) => {
    updateConstraints({
      incompatiblePairs: constraints.incompatiblePairs.filter((_, i) => i !== index),
    })
  }

  return (
    <div className="space-y-4">
      <h2 className="text-base font-bold text-slate-700">条件（制約）</h2>

      {/* NGペア */}
      <div className="card space-y-3">
        <div>
          <h3 className="text-sm font-bold text-slate-700">
            🚫 同じ日に出勤させない（NGペア）
          </h3>
          <p className="text-xs text-slate-500">
            指定した2人は同じ日に一緒のシフトに入りません（ハード制約）。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select className="input max-w-[10rem]" value={pairA} onChange={(e) => setPairA(e.target.value)}>
            <option value="">スタッフを選択</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <span className="text-slate-400">と</span>
          <select className="input max-w-[10rem]" value={pairB} onChange={(e) => setPairB(e.target.value)}>
            <option value="">スタッフを選択</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button className="btn-primary" onClick={addPair}>
            追加
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {constraints.incompatiblePairs.map((p, i) => (
            <span key={i} className="chip bg-slate-100 text-slate-700">
              {nameOf(p.a)} ✕ {nameOf(p.b)}
              <button className="ml-1 text-slate-400 hover:text-red-600" onClick={() => removePair(i)}>
                ×
              </button>
            </span>
          ))}
          {constraints.incompatiblePairs.length === 0 && (
            <span className="text-xs text-slate-400">NGペアはありません。</span>
          )}
        </div>
      </div>

      {/* 経験者最低数 */}
      <div className="card space-y-2">
        <h3 className="text-sm font-bold text-slate-700">🧑‍🏫 新人だけにしない</h3>
        <p className="text-xs text-slate-500">
          各シフトに経験者（新人以外）を最低何名配置するか。1以上で「新人だけ」を防ぎます。
        </p>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            className="input w-24"
            value={constraints.minExperiencedPerShift}
            onChange={(e) =>
              updateConstraints({ minExperiencedPerShift: Math.max(0, Number(e.target.value)) })
            }
          />
          <span className="text-sm text-slate-500">名以上</span>
        </div>
      </div>

      {/* ソフト制約の重み */}
      <div className="card space-y-3">
        <h3 className="text-sm font-bold text-slate-700">⚖️ 優先度（ソフト制約の重み）</h3>
        <div className="space-y-3">
          <WeightSlider
            label="出勤回数の公平化"
            hint="大きいほど、出勤日数の偏りを減らそうとします。"
            value={constraints.weights.fairness}
            onChange={(v) =>
              updateConstraints({ weights: { ...constraints.weights, fairness: v } })
            }
          />
          <WeightSlider
            label="希望シフトの尊重"
            hint="大きいほど、スタッフが選んだ時間帯を優先します。"
            value={constraints.weights.preference}
            onChange={(v) =>
              updateConstraints({ weights: { ...constraints.weights, preference: v } })
            }
          />
        </div>
      </div>

      {/* メモ */}
      <div className="card space-y-2">
        <h3 className="text-sm font-bold text-slate-700">📝 その他の条件メモ</h3>
        <p className="text-xs text-slate-500">
          自動化しきれない条件を書き留めておけます（生成結果と一緒に表示され、手動調整の参考になります）。
        </p>
        <textarea
          className="input min-h-[5rem]"
          placeholder="例: 月初はベテランを多めに。〇〇さんは金曜に固定希望。"
          value={constraints.notes}
          onChange={(e) => updateConstraints({ notes: e.target.value })}
        />
      </div>
    </div>
  )
}

function WeightSlider({
  label,
  hint,
  value,
  onChange,
}: {
  label: string
  hint: string
  value: number
  onChange: (v: number) => void
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-slate-600">{label}</label>
        <span className="text-xs text-slate-400">{value.toFixed(1)}</span>
      </div>
      <input
        type="range"
        min={0}
        max={3}
        step={0.5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-brand-500"
      />
      <p className="text-xs text-slate-400">{hint}</p>
    </div>
  )
}
