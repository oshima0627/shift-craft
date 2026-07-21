import { useState } from 'react'
import { openBillingPortal, startCheckout } from '../utils/cloud'

interface Props {
  open: boolean
  onClose: () => void
  /** Stripeが有効化されているか（未設定なら申込ボタンは出さず案内のみ） */
  billingConfigured: boolean
  /** 既に購読中か（支払い管理ボタンを出す） */
  subscribed?: boolean
}

/**
 * プラン加入（Stripe Checkout）と支払い管理（顧客ポータル）のモーダル。
 * 月額¥1,480 / 年額¥14,800。押すと Stripe の決済ページへ遷移する。
 */
export default function BillingModal({ open, onClose, billingConfigured, subscribed }: Props) {
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={onClose}
    >
      <div className="card w-full max-w-md space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="section-title">プランのご案内</h3>
          <button className="text-slate-400 hover:text-slate-700" onClick={onClose} title="閉じる">
            ✕
          </button>
        </div>

        <p className="text-sm text-slate-600">
          有料プランで <b>AI解釈</b>・<b>CSV出力／印刷</b>・その他オプション機能が使えます。
        </p>

        {billingConfigured ? (
          <div className="space-y-2">
            <button
              className="btn-primary w-full justify-between"
              disabled={!!busy}
              onClick={() => go(() => startCheckout('monthly'), 'monthly')}
            >
              <span className="min-w-0 truncate">月額プラン</span>
              <span className="shrink-0 font-bold">¥1,480 / 月</span>
            </button>
            <button
              className="btn w-full justify-between"
              disabled={!!busy}
              onClick={() => go(() => startCheckout('yearly'), 'yearly')}
            >
              <span className="min-w-0 truncate">年額プラン（2ヶ月分お得）</span>
              <span className="shrink-0 font-bold">¥14,800 / 年</span>
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
            <p className="text-xs text-slate-400">
              決済は Stripe の安全なページで行われます。いつでも解約できます。
              お申し込みの前に
              <a href="/legal" target="_blank" rel="noopener" className="text-brand-600 hover:underline">
                特定商取引法に基づく表記
              </a>
              ・
              <a href="/terms" target="_blank" rel="noopener" className="text-brand-600 hover:underline">
                利用規約
              </a>
              ・
              <a href="/privacy" target="_blank" rel="noopener" className="text-brand-600 hover:underline">
                プライバシーポリシー
              </a>
              をご確認ください。
            </p>
          </div>
        ) : (
          <p className="text-sm text-amber-700">現在オンライン申し込みを準備中です。</p>
        )}

        {busy && <p className="text-sm text-slate-500">決済ページへ移動しています…</p>}
        {err && <p className="text-sm font-medium text-red-600">{err}</p>}
      </div>
    </div>
  )
}
