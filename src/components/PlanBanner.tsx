import { useState } from 'react'
import { useEntitlement, trialDaysLeft } from '../utils/useEntitlement'
import BillingModal from './BillingModal'

/**
 * 画面上部のプラン案内バナー。
 * - トライアル中: 残り日数＋契約導線
 * - 未加入（ロック）: 有料機能ロックの案内＋契約導線
 * - 加入中／ローカル: 何も表示しない
 */
export default function PlanBanner() {
  const ent = useEntitlement()
  const [open, setOpen] = useState(false)

  if (ent.loading || !ent.backend) return null
  if (ent.tier === 'active') return null // 加入中/招待は表示不要

  const trialing = ent.tier === 'trialing'
  const days = trialDaysLeft(ent.trialEndsAt)

  return (
    <>
      <div
        className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border px-4 py-2.5 text-sm ${
          trialing
            ? 'border-brand-200 bg-brand-50 text-brand-800'
            : 'border-amber-200 bg-amber-50 text-amber-800'
        }`}
      >
        <span>
          {trialing ? (
            <>
              無料トライアル中（残り <b>{days}</b> 日）。期間終了後も使い続けるにはプランのご加入が必要です。
            </>
          ) : (
            <>
              無料期間が終了しました。<b>AI解釈・CSV出力／印刷</b>などの機能はプラン加入でご利用いただけます。
            </>
          )}
        </span>
        <button className="btn-primary btn-sm shrink-0" onClick={() => setOpen(true)}>
          プランを見る
        </button>
      </div>

      <BillingModal
        open={open}
        onClose={() => setOpen(false)}
        billingConfigured={ent.billingConfigured}
      />
    </>
  )
}
