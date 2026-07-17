import { useState } from 'react'
import { newId, useStore } from '../state/store'
import { describeRule, parseRule } from '../utils/ruleParser'
import { AI_MODELS, aiParseRule, getSelectedModel, setSelectedModel } from '../utils/ai'
import type { ParsedRule } from '../types'

type RuleKind = ParsedRule['kind']

const WEEKDAY_OPTS = ['日', '月', '火', '水', '木', '金', '土']

/** 項目から追加できる定型ルールの種類とUIに必要な入力欄 */
interface RuleTypeMeta {
  kind: RuleKind
  label: string
  needs: { a?: boolean; b?: boolean; weekday?: boolean; shift?: boolean; num?: 'week' | 'cons' }
}
const RULE_TYPE_META: RuleTypeMeta[] = [
  { kind: 'pairAvoid', label: '同じ日に入れない（NGペア）', needs: { a: true, b: true } },
  { kind: 'pairTogether', label: 'なるべく同じ日に入れる', needs: { a: true, b: true } },
  { kind: 'forbidWeekday', label: '特定の曜日は休み', needs: { a: true, weekday: true } },
  { kind: 'forbidShift', label: '特定のシフトに入れない', needs: { a: true, shift: true } },
  { kind: 'onlyShift', label: '特定のシフトだけに入れる', needs: { a: true, shift: true } },
  { kind: 'maxDaysPerWeek', label: '週N日まで', needs: { a: true, num: 'week' } },
  { kind: 'maxConsecutive', label: 'N連勤まで', needs: { a: true, num: 'cons' } },
  { kind: 'fixWeekdayShift', label: '特定の曜日はシフト固定', needs: { a: true, weekday: true, shift: true } },
]

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
  // 項目から追加（かんたん）フォームの状態
  const [rKind, setRKind] = useState<RuleKind>('pairAvoid')
  const [rStaffA, setRStaffA] = useState('')
  const [rStaffB, setRStaffB] = useState('')
  const [rWeekday, setRWeekday] = useState('') // '0'〜'6'
  const [rShift, setRShift] = useState('')
  const [rNum, setRNum] = useState('3')

  const nameOf = (id: string) => staff.find((s) => s.id === id)?.name ?? '(不明)'
  const shiftNameOf = (id: string) => shifts.find((s) => s.id === id)?.name ?? '(不明)'

  const ruleMeta = RULE_TYPE_META.find((m) => m.kind === rKind)!

  /** ルールを自然文に（一覧の主行に表示する元テキストとして保存） */
  const ruleSentence = (rule: ParsedRule): string => {
    switch (rule.kind) {
      case 'pairAvoid':
        return `${nameOf(rule.a)}と${nameOf(rule.b)}は同じ日に入れない`
      case 'pairTogether':
        return `${nameOf(rule.a)}と${nameOf(rule.b)}はなるべく同じ日に`
      case 'forbidWeekday':
        return `${nameOf(rule.staffId)}は${WEEKDAY_OPTS[rule.weekday]}曜は休み`
      case 'forbidShift':
        return `${nameOf(rule.staffId)}は「${shiftNameOf(rule.shiftId)}」に入れない`
      case 'onlyShift':
        return `${nameOf(rule.staffId)}は「${shiftNameOf(rule.shiftId)}」のみ`
      case 'maxDaysPerWeek':
        return `${nameOf(rule.staffId)}は週${rule.days}日まで`
      case 'maxConsecutive':
        return `${nameOf(rule.staffId)}は${rule.days}連勤まで`
      case 'fixWeekdayShift':
        return `${nameOf(rule.staffId)}は${WEEKDAY_OPTS[rule.weekday]}曜は「${shiftNameOf(rule.shiftId)}」固定`
    }
  }

  /** 項目フォームの選択内容から ParsedRule を直接生成して追加（パース不要＝確実） */
  const addStructuredRule = () => {
    const n = ruleMeta.needs
    if (n.a && !rStaffA) return setRuleFeedback('スタッフを選択してください。')
    if (n.b && (!rStaffB || rStaffB === rStaffA))
      return setRuleFeedback('異なる2人のスタッフを選択してください。')
    if (n.weekday && rWeekday === '') return setRuleFeedback('曜日を選択してください。')
    if (n.shift && !rShift) return setRuleFeedback('シフトを選択してください。')

    const num = Math.max(1, Number(rNum) || 1)
    const wd = Number(rWeekday)
    let parsed: ParsedRule
    switch (rKind) {
      case 'pairAvoid':
        parsed = { kind: 'pairAvoid', a: rStaffA, b: rStaffB }
        break
      case 'pairTogether':
        parsed = { kind: 'pairTogether', a: rStaffA, b: rStaffB }
        break
      case 'forbidWeekday':
        parsed = { kind: 'forbidWeekday', staffId: rStaffA, weekday: wd }
        break
      case 'forbidShift':
        parsed = { kind: 'forbidShift', staffId: rStaffA, shiftId: rShift }
        break
      case 'onlyShift':
        parsed = { kind: 'onlyShift', staffId: rStaffA, shiftId: rShift }
        break
      case 'maxDaysPerWeek':
        parsed = { kind: 'maxDaysPerWeek', staffId: rStaffA, days: num }
        break
      case 'maxConsecutive':
        parsed = { kind: 'maxConsecutive', staffId: rStaffA, days: num }
        break
      case 'fixWeekdayShift':
        parsed = { kind: 'fixWeekdayShift', staffId: rStaffA, weekday: wd, shiftId: rShift }
        break
      default:
        return setRuleFeedback('未対応の条件です。')
    }
    updateConstraints({
      customRules: [...constraints.customRules, { id: newId('rule'), text: ruleSentence(parsed), parsed }],
    })
    setRuleFeedback(`追加: ${describeRule(parsed, staff, shifts)}`)
    setRStaffB('')
  }

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

      {/* その他の条件（項目選択＋文章＋AI） */}
      <div className="card space-y-4">
        <div className="space-y-1">
          <h3 className="section-title">その他の条件</h3>
          <p className="section-desc">
            よくある条件は「項目から追加」で選ぶだけ。あてはまらないものは「文章で追加」でAIが読み取ります。
          </p>
        </div>

        {/* 項目から追加（かんたん・確実） */}
        <div className="space-y-3 rounded-xl border border-slate-200 p-3">
          <p className="text-sm font-semibold text-slate-700">項目から追加（かんたん）</p>
          {staff.length === 0 ? (
            <p className="text-sm text-slate-400">先に「スタッフ」を登録してください。</p>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-slate-500">条件の種類</span>
                <select
                  className="input max-w-[16rem]"
                  value={rKind}
                  onChange={(e) => setRKind(e.target.value as RuleKind)}
                >
                  {RULE_TYPE_META.map((m) => (
                    <option key={m.kind} value={m.kind}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>

              {ruleMeta.needs.a && (
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-slate-500">{ruleMeta.needs.b ? 'スタッフ1' : 'スタッフ'}</span>
                  <select
                    className="input max-w-[10rem]"
                    value={rStaffA}
                    onChange={(e) => setRStaffA(e.target.value)}
                  >
                    <option value="">選択</option>
                    {staff.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {ruleMeta.needs.b && (
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-slate-500">スタッフ2</span>
                  <select
                    className="input max-w-[10rem]"
                    value={rStaffB}
                    onChange={(e) => setRStaffB(e.target.value)}
                  >
                    <option value="">選択</option>
                    {staff
                      .filter((s) => s.id !== rStaffA)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              {ruleMeta.needs.weekday && (
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-slate-500">曜日</span>
                  <select
                    className="input max-w-[7rem]"
                    value={rWeekday}
                    onChange={(e) => setRWeekday(e.target.value)}
                  >
                    <option value="">選択</option>
                    {WEEKDAY_OPTS.map((w, i) => (
                      <option key={i} value={i}>
                        {w}曜
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {ruleMeta.needs.shift && (
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-slate-500">シフト</span>
                  <select
                    className="input max-w-[10rem]"
                    value={rShift}
                    onChange={(e) => setRShift(e.target.value)}
                  >
                    <option value="">選択</option>
                    {shifts.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {ruleMeta.needs.num && (
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-slate-500">
                    {ruleMeta.needs.num === 'week' ? '日数/週' : '連勤日数'}
                  </span>
                  <input
                    type="number"
                    min={1}
                    className="input w-24"
                    value={rNum}
                    onChange={(e) => setRNum(e.target.value)}
                  />
                </label>
              )}
              <button className="btn-primary" onClick={addStructuredRule}>
                追加
              </button>
            </div>
          )}
        </div>

        {/* 文章で追加（その他） */}
        <div className="space-y-2 rounded-xl border border-slate-200 p-3">
          <p className="text-sm font-semibold text-slate-700">文章で追加（その他）</p>
          <p className="section-desc">
            上の項目にあてはまらない条件を文章で。例:「月初はベテランを多めに」「〇〇は繁忙期だけ増やす」
          </p>
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
