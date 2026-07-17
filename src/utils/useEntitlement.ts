import { useCallback, useEffect, useState } from 'react'
import { getAuthStatus, type AiUsage, type Tier } from './cloud'

export interface EntitlementState {
  loading: boolean
  /** バックエンドに接続しているか（ローカル開発では false） */
  backend: boolean
  /** 有料機能（AI・書き出し等）がロックされているか。ローカル/未接続時は false（全機能可） */
  locked: boolean
  tier?: Tier
  trialEndsAt?: string | null
  /** Stripeが有効化されているか（契約導線を出すか） */
  billingConfigured: boolean
  aiUsage?: AiUsage
}

const INITIAL: EntitlementState = {
  loading: true,
  backend: false,
  locked: false,
  billingConfigured: false,
}

/**
 * ログインユーザーのアクセス権限（有料/トライアル/ロック）を取得するフック。
 * バックエンド未接続（ローカル開発）では locked=false（全機能利用可）として扱う。
 */
export function useEntitlement(): EntitlementState & { refresh: () => void } {
  const [state, setState] = useState<EntitlementState>(INITIAL)

  const refresh = useCallback(() => {
    void getAuthStatus().then((s) => {
      if (!s.backend) {
        setState({ loading: false, backend: false, locked: false, billingConfigured: false })
        return
      }
      setState({
        loading: false,
        backend: true,
        // バックエンドがあり、かつ権利なし → ロック
        locked: s.entitled === false,
        tier: s.tier,
        trialEndsAt: s.trialEndsAt ?? null,
        billingConfigured: !!s.billingConfigured,
        aiUsage: s.aiUsage,
      })
    })
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { ...state, refresh }
}

/** トライアル終了までの残り日数（切り上げ）。期限切れ/未設定は0 */
export function trialDaysLeft(trialEndsAt?: string | null): number {
  if (!trialEndsAt) return 0
  const end = Date.parse(trialEndsAt)
  if (Number.isNaN(end)) return 0
  return Math.max(0, Math.ceil((end - Date.now()) / (24 * 60 * 60 * 1000)))
}
