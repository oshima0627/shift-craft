import { useEffect, useState } from 'react'
import { openBillingPortal, startCheckout } from '../utils/cloud'

interface Props {
  open: boolean
  onClose: () => void
  /** Stripeが有効化されているか（未設定なら申込ボタンは出さず案内のみ） */
  billingConfigured: boolean
  /** 既に購読中か（支払い管理ボタンを出す） */
  subscribed?: boolean
}

type Plan = 'monthly' | 'yearly'

/** 有料プランで解放される機能（チェックリスト表示） */
const FEATURES = [
  'AIによる条件文の自動解釈',
  'CSV出力・印刷',
  '作成したシフトのフル活用',
  '今後のオプション機能',
]

/** チェックアイコン（塗り丸＋白チェック） */
function CheckIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="mt-0.5 h-5 w-5 shrink-0 text-brand-500"
      fill="currentColor"
      aria-hidden
    >
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.7-9.3a1 1 0 00-1.4-1.4L9 10.6 7.7 9.3a1 1 0 00-1.4 1.4l2 2a1 1 0 001.4 0l4-4z"
        clipRule="evenodd"
      />
    </svg>
  )
}

/**
 * プラン加入（Stripe Checkout）と支払い管理（顧客ポータル）のモーダル。
 * 月額¥1,480 / 年額¥14,800。プランを選んで申し込むと Stripe の決済ページへ遷移する。
 */
export default function BillingModal({ open, onClose, billingConfigured, subscribed }: Props) {
  const [plan, setPlan] = useState<Plan>('yearly')
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  // Escキーで閉じる／開くたびに状態をリセット
  useEffect(() => {
    if (!open) return
    setErr(null)
    setBusy(null)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const go = async (fn: () => Promise<{ ok: boolean; error?: string }>, key: string) => {
    setBusy(key)
    setErr(null)
    const r = await fn()
    if (!r.ok) {
      setBusy(null)
      setErr(
        r.error === 'not_configured'
          ? '現在お申し込みを準備中です。しばらくお待ちください。'
          : '処理に失敗しました。通信状況を確認して再度お試しください。',
      )
    }
    // 成功時は決済ページへ遷移するのでそのまま
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="プランのご案内"
    >
      <div
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white shadow-2xl ring-1 ring-slate-900/5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ヘッダー（ブランドカラーのグラデーション） */}
        <div className="relative overflow-hidden rounded-t-3xl bg-gradient-to-br from-brand-500 to-brand-700 px-6 pb-7 pt-6 text-white sm:px-8">
          <button
            className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/20 hover:text-white"
            onClick={onClose}
            title="閉じる"
            aria-label="閉じる"
          >
            <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" d="M5 5l10 10M15 5L5 15" />
            </svg>
          </button>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-xs font-semibold">
            ✨ ShiftCraft 有料プラン
          </span>
          <h3 className="mt-3 text-2xl font-bold tracking-tight">すべての機能を、フルに。</h3>
          <p className="mt-1 text-sm text-white/85">
            まずは<b className="font-bold text-white">14日間の無料トライアル</b>。いつでも解約できます。
          </p>
        </div>

        <div className="space-y-5 px-6 py-6 sm:px-8">
          {billingConfigured ? (
            <>
              {/* 機能チェックリスト */}
              <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {FEATURES.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-slate-700">
                    <CheckIcon />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              {/* プラン選択カード */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <PlanCard
                  selected={plan === 'monthly'}
                  onSelect={() => setPlan('monthly')}
                  name="月額プラン"
                  price="¥1,480"
                  unit="/ 月"
                />
                <PlanCard
                  selected={plan === 'yearly'}
                  onSelect={() => setPlan('yearly')}
                  name="年額プラン"
                  price="¥14,800"
                  unit="/ 年"
                  badge="2ヶ月分お得"
                  sub="実質 ¥1,233 / 月"
                />
              </div>

              {/* 申し込み CTA */}
              <button
                className="btn-primary w-full text-lg"
                disabled={!!busy}
                onClick={() => go(() => startCheckout(plan), 'checkout')}
              >
                {busy === 'checkout' ? '決済ページへ移動中…' : 'このプランで申し込む'}
                {busy !== 'checkout' && (
                  <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 10h11M11 5l5 5-5 5" />
                  </svg>
                )}
              </button>

              {subscribed && (
                <button
                  className="btn-ghost btn-sm w-full"
                  disabled={!!busy}
                  onClick={() => go(() => openBillingPortal(), 'portal')}
                >
                  支払い方法の変更・解約はこちら
                </button>
              )}

              {err && (
                <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-600">{err}</p>
              )}

              {/* 安心・法令リンク */}
              <div className="space-y-2 border-t border-slate-100 pt-4">
                <p className="flex items-center gap-1.5 text-xs text-slate-500">
                  <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-slate-400" fill="currentColor" aria-hidden>
                    <path
                      fillRule="evenodd"
                      d="M10 1a4.5 4.5 0 00-4.5 4.5V8H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm2.5 7V5.5a2.5 2.5 0 10-5 0V8h5z"
                      clipRule="evenodd"
                    />
                  </svg>
                  決済は Stripe の安全なページで行われます。カード情報は当方に保存されません。
                </p>
                <p className="text-xs text-slate-400">
                  お申し込みの前に
                  <LegalLink href="/legal">特定商取引法に基づく表記</LegalLink>・
                  <LegalLink href="/terms">利用規約</LegalLink>・
                  <LegalLink href="/privacy">プライバシーポリシー</LegalLink>
                  をご確認ください。
                </p>
              </div>
            </>
          ) : (
            <div className="space-y-4">
              <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {FEATURES.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-slate-700">
                    <CheckIcon />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                現在オンライン申し込みを準備中です。もうしばらくお待ちください。
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** 選択式のプランカード（ラジオ相当） */
function PlanCard({
  selected,
  onSelect,
  name,
  price,
  unit,
  badge,
  sub,
}: {
  selected: boolean
  onSelect: () => void
  name: string
  price: string
  unit: string
  badge?: string
  sub?: string
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`relative flex flex-col items-start gap-1 rounded-2xl border-2 p-4 text-left transition-all ${
        selected
          ? 'border-brand-500 bg-brand-50 shadow-sm ring-2 ring-brand-200'
          : 'border-slate-200 bg-white hover:border-brand-300 hover:bg-slate-50'
      }`}
    >
      {badge && (
        <span className="absolute -top-2.5 right-3 rounded-full bg-brand-500 px-2.5 py-0.5 text-[11px] font-bold text-white shadow-sm">
          {badge}
        </span>
      )}
      <div className="flex w-full items-center justify-between">
        <span className="text-sm font-semibold text-slate-700">{name}</span>
        <span
          className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${
            selected ? 'border-brand-500 bg-brand-500' : 'border-slate-300 bg-white'
          }`}
        >
          {selected && <span className="h-2 w-2 rounded-full bg-white" />}
        </span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-bold tracking-tight text-slate-900">{price}</span>
        <span className="text-sm font-medium text-slate-500">{unit}</span>
      </div>
      {sub && <span className="text-xs font-medium text-brand-600">{sub}</span>}
    </button>
  )
}

/** モーダル内から法令ページを別タブで開くリンク */
function LegalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener" className="text-brand-600 hover:underline">
      {children}
    </a>
  )
}
