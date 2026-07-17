import { useState } from 'react'
import { newId, useStore } from '../state/store'
import { describeRule, parseRule } from '../utils/ruleParser'
import { AI_MODELS, aiParseRule, getSelectedModel, setSelectedModel } from '../utils/ai'

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']

export default function ConstraintsTab() {
  const staff = useStore((s) => s.data.staff)
  const shifts = useStore((s) => s.data.shifts)
  const constraints = useStore((s) => s.data.constraints)
  const updateConstraints = useStore((s) => s.updateConstraints)
  const [pairA, setPairA] = useState('')
  const [pairB, setPairB] = useState('')
  const [ruleText, setRuleText] = useState('')
  const [ruleFeedback, setRuleFeedback] = useState<string | null>(null)
  const [aiModel, setAiModel] = useState<string>(() => getSelectedModel())
  const [aiBusy, setAiBusy] = useState(false)

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

  const addCustomRule = () => {
    const text = ruleText.trim()
    if (!text) return
    const result = parseRule(text, staff, shifts)
    updateConstraints({
      customRules: [
        ...constraints.customRules,
        { id: newId('rule'), text, parsed: result.parsed },
      ],
    })
    setRuleFeedback(result.parsed ? `解釈: ${result.description}` : `未解釈: ${result.description}`)
    setRuleText('')
  }

  const changeModel = (model: string) => {
    setAiModel(model)
    setSelectedModel(model)
  }

  const addWithAi = async () => {
    const text = ruleText.trim()
    if (!text || aiBusy) return
    setAiBusy(true)
    setRuleFeedback('AIで解釈中…')
    const outcome = await aiParseRule(text, staff, shifts, aiModel)
    setAiBusy(false)
    if (!outcome.ok) {
      const msg =
        outcome.kind === 'not_configured'
          ? 'AI解釈は利用できません（サーバーにAPIキーが未設定です）。'
          : outcome.kind === 'unauthorized'
            ? 'AI解釈にはログインが必要です。'
            : 'AI解釈に失敗しました。通信状況を確認してください。'
      setRuleFeedback(`⚠ ${msg}`)
      return
    }
    const { parsed, description } = outcome.result
    updateConstraints({
      customRules: [...constraints.customRules, { id: newId('rule'), text, parsed }],
    })
    const modelLabel = AI_MODELS.find((m) => m.id === aiModel)?.label ?? aiModel
    setRuleFeedback(parsed ? `AI解釈（${modelLabel}）: ${description}` : `AI（未解釈）: ${description}`)
    setRuleText('')
  }

  const removeCustomRule = (id: string) => {
    updateConstraints({
      customRules: constraints.customRules.filter((r) => r.id !== id),
    })
  }

  return (
    <div className="space-y-4">
      <h2 className="page-title">条件（制約）</h2>

      {/* 労働法・働き方ルール */}
      <div className="card space-y-4">
        <div className="space-y-1">
          <h3 className="section-title">労働法・働き方ルール</h3>
          <p className="section-desc">
            労働基準法と厚労省の指針に基づく既定値を設定済みです。生成時に自動で守られ、
            手動編集後も違反があれば警告されます。
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">連勤上限（日）</label>
            <input
              type="number"
              min={1}
              max={12}
              className="input"
              value={constraints.maxConsecutiveDefault}
              onChange={(e) =>
                updateConstraints({
                  maxConsecutiveDefault: Math.max(1, Math.min(12, Number(e.target.value))),
                })
              }
            />
            <p className="mt-1.5 text-sm text-slate-400">
              毎週1日以上の休日が必要（労基法35条）→ 原則6連勤まで。
            </p>
          </div>
          <div>
            <label className="label">週の労働時間上限</label>
            <select
              className="input"
              value={constraints.weeklyHoursCap}
              onChange={(e) => updateConstraints({ weeklyHoursCap: Number(e.target.value) })}
            >
              <option value={40}>40時間（法定・原則）</option>
              <option value={44}>44時間（特例措置対象事業場）</option>
            </select>
            <p className="mt-1.5 text-sm text-slate-400">
              常時10人未満の飲食店は特例で週44hまで可。18歳未満は常に40h厳守。
            </p>
          </div>
          <div>
            <label className="label">勤務間インターバル（時間）</label>
            <input
              type="number"
              min={0}
              max={24}
              className="input"
              value={constraints.restIntervalHours}
              onChange={(e) =>
                updateConstraints({ restIntervalHours: Math.max(0, Number(e.target.value)) })
              }
            />
            <p className="mt-1.5 text-sm text-slate-400">
              終業→翌始業の休息。厚労省の目安は9〜11h。遅番→翌早番（クローピング）を防ぎます。0=チェックなし。
            </p>
          </div>
          <div className="flex items-center">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                className="h-5 w-5 accent-brand-500"
                checked={constraints.restIntervalHard}
                onChange={(e) => updateConstraints({ restIntervalHard: e.target.checked })}
              />
              インターバルを厳守する（オフ=警告のみ）
            </label>
          </div>
          <div className="flex items-start sm:col-span-2">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                className="h-5 w-5 accent-brand-500"
                checked={constraints.allowSplitShifts}
                onChange={(e) => updateConstraints({ allowSplitShifts: e.target.checked })}
              />
              同じ日に複数シフトを許可する（分割勤務）
              <span className="text-sm text-slate-400">
                — 早番の後に遅番など、時間帯が重ならなければ同じ人を1日に複数入れられます
              </span>
            </label>
          </div>
        </div>
      </div>

      {/* 定休日 */}
      <div className="card space-y-3">
        <div className="space-y-1">
          <h3 className="section-title">定休日（毎週の休業日）</h3>
          <p className="section-desc">
            チェックした曜日はお店が休みとして、誰も割り当てません（人数不足の警告も出ません）。
            特定日だけ営業したい場合は「必要人数」タブの「特定日の人数上書き」で個別に指定できます。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {WEEKDAY_LABELS.map((label, wd) => {
            const on = (constraints.closedWeekdays ?? []).includes(wd)
            return (
              <button
                key={wd}
                onClick={() => {
                  const cur = constraints.closedWeekdays ?? []
                  updateConstraints({
                    closedWeekdays: on ? cur.filter((d) => d !== wd) : [...cur, wd].sort(),
                  })
                }}
                className={`min-h-[2.75rem] min-w-[3rem] rounded-xl border px-3 text-base font-semibold transition-colors ${
                  on
                    ? 'border-brand-500 bg-brand-500 text-white shadow-sm'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-brand-300 hover:bg-brand-50'
                } ${wd === 0 ? 'text-red-500' : ''} ${on && wd === 0 ? '!text-white' : ''}`}
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>

      {/* NGペア */}
      <div className="card space-y-3">
        <div>
          <h3 className="section-title">
            同じ日に出勤させない（NGペア）
          </h3>
          <p className="section-desc">
            指定した2人を同じ日に一緒のシフトに入れないようにします。
          </p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            className="h-5 w-5 accent-brand-500"
            checked={constraints.incompatibleHard ?? true}
            onChange={(e) => updateConstraints({ incompatibleHard: e.target.checked })}
          />
          厳守する（オフ=なるべく避ける警告のみ／オン=絶対に同じ日にしない）
        </label>
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
            <span className="text-sm text-slate-400">NGペアはありません。</span>
          )}
        </div>
      </div>

      {/* 経験者最低数 */}
      <div className="card space-y-2">
        <h3 className="section-title">新人だけにしない</h3>
        <p className="section-desc">
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

      {/* カスタム条件（自然文） */}
      <div className="card space-y-3">
        <div className="space-y-1">
          <h3 className="section-title">その他の条件（文章で入力）</h3>
          <p className="section-desc">
            文章で書くと自動でルールに変換します。例:
            「田中と佐藤は同じ日に入れない」「高橋は火曜は休み」「伊藤は週3日まで」
            「鈴木は遅番に入れない」「田中は金曜は早番固定」「佐藤は4連勤まで」
          </p>
        </div>
        <div className="flex gap-2">
          <input
            className="input flex-1"
            placeholder="例: 高橋は火曜は休み"
            value={ruleText}
            onChange={(e) => setRuleText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addCustomRule()}
            disabled={aiBusy}
          />
          <button className="btn-primary" onClick={addCustomRule} disabled={aiBusy}>
            追加
          </button>
        </div>

        {/* AI解釈（複雑な文はこちら。モデルを切り替え可能） */}
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <span className="text-sm text-slate-600">
            うまく変換されないときは <b>AIで解釈</b>：
          </span>
          <select
            className="input max-w-[13rem]"
            value={aiModel}
            onChange={(e) => changeModel(e.target.value)}
            disabled={aiBusy}
            title="使用するAIモデルを切り替えます"
          >
            {AI_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}（{m.hint}）
              </option>
            ))}
          </select>
          <button className="btn-ghost btn-sm" onClick={addWithAi} disabled={aiBusy || !ruleText.trim()}>
            {aiBusy ? '解釈中…' : 'AIで解釈して追加'}
          </button>
        </div>

        {ruleFeedback && <p className="text-sm font-medium text-slate-600">{ruleFeedback}</p>}
        <div className="space-y-1.5">
          {constraints.customRules.map((r) => (
            <div
              key={r.id}
              className={`flex items-center justify-between rounded-md border px-3 py-1.5 text-sm ${
                r.parsed
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : 'border-amber-200 bg-amber-50 text-amber-800'
              }`}
            >
              <div>
                <p>{r.text}</p>
                <p className="text-sm opacity-70">
                  {r.parsed
                    ? `→ ${describeRule(r.parsed, staff, shifts)}`
                    : '→ 未解釈（メモとして生成結果に表示されます）'}
                </p>
              </div>
              <button
                className="ml-2 text-slate-400 hover:text-red-600"
                onClick={() => removeCustomRule(r.id)}
              >
                ×
              </button>
            </div>
          ))}
          {constraints.customRules.length === 0 && (
            <span className="text-sm text-slate-400">追加した条件はありません。</span>
          )}
        </div>

        {/* 自動変換できない条件のメモ（生成結果に一緒に表示） */}
        <div className="space-y-1.5 border-t border-slate-100 pt-3">
          <label className="label">自由メモ（ルールにできない条件の覚え書き）</label>
          <p className="section-desc">
            自動で変換できない条件を書き留めておけます。生成結果と一緒に表示され、手動調整の参考になります。
          </p>
          <textarea
            className="input min-h-[4.5rem]"
            placeholder="例: 月初はベテランを多めに。〇〇さんは金曜に固定希望。"
            value={constraints.notes}
            onChange={(e) => updateConstraints({ notes: e.target.value })}
          />
        </div>
      </div>

      {/* ソフト制約の重み */}
      <div className="card space-y-3">
        <h3 className="section-title">優先度（ソフト制約の重み）</h3>
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
            label="土日祝出勤の公平化"
            hint="大きいほど、土日祝の出勤が特定の人に偏らないようにします（不公平は離職の原因）。"
            value={constraints.weights.weekendFairness}
            onChange={(v) =>
              updateConstraints({ weights: { ...constraints.weights, weekendFairness: v } })
            }
          />
          <WeightSlider
            label="希望シフトの尊重"
            hint="大きいほど、スタッフが選んだ時間帯を優先します（希望反映は定着率に直結）。"
            value={constraints.weights.preference}
            onChange={(v) =>
              updateConstraints({ weights: { ...constraints.weights, preference: v } })
            }
          />
        </div>
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
        <span className="text-sm text-slate-400">{value.toFixed(1)}</span>
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
      <p className="text-sm text-slate-400">{hint}</p>
    </div>
  )
}
