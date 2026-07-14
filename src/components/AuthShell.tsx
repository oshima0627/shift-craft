import { useEffect, useRef, useState } from 'react'
import App from '../App'
import { useStore } from '../state/store'
import {
  getAuthStatus,
  login as apiLogin,
  logout as apiLogout,
  pullCloudIntoStore,
  pushCloudIfChanged,
  setupPassword,
} from '../utils/cloud'

type Phase = 'loading' | 'setup' | 'login' | 'ready' | 'local'

/**
 * 認証の入口。バックエンド（Cloudflare Worker + D1）があればログインを要求し、
 * ログイン後は設定をD1と自動同期する。バックエンドが無い（ローカル開発）場合は
 * そのままアプリを表示する（ローカルモード）。
 */
export default function AuthShell() {
  const [phase, setPhase] = useState<Phase>('loading')
  const inited = useRef(false)

  const getData = () => useStore.getState().data

  useEffect(() => {
    if (inited.current) return // StrictMode の二重実行を防ぐ
    inited.current = true
    void init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function init() {
    const st = await getAuthStatus()
    if (!st.backend) {
      setPhase('local')
      return
    }
    if (!st.configured) {
      setPhase('setup')
      return
    }
    if (!st.authenticated) {
      setPhase('login')
      return
    }
    await enterAuthed()
  }

  async function enterAuthed() {
    // ログイン済み → クラウドの設定を取り込んでからアプリ表示
    await pullCloudIntoStore(getData, (d) => useStore.getState().importData(d))
    setPhase('ready')
  }

  if (phase === 'loading') {
    return <Centered>読み込み中…</Centered>
  }
  if (phase === 'setup') {
    return <SetupScreen onDone={enterAuthed} />
  }
  if (phase === 'login') {
    return <LoginScreen onDone={enterAuthed} />
  }

  // ready（バックエンドあり＝自動同期）/ local（バックエンドなし）
  const authed = phase === 'ready'
  return (
    <>
      {authed && <AutoSync />}
      <App
        onLogout={
          authed
            ? async () => {
                await apiLogout()
                setPhase('login')
              }
            : undefined
        }
      />
    </>
  )
}

/** 設定変更を監視し、少し待ってからクラウドへ自動保存する */
function AutoSync() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const unsub = useStore.subscribe(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        void pushCloudIfChanged(
          () => useStore.getState().data,
          (d) => useStore.getState().importData(d),
        )
      }, 1500)
    })
    return () => {
      unsub()
      if (timer) clearTimeout(timer)
    }
  }, [])
  return null
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-500">
      {children}
    </div>
  )
}

function AuthCard({
  title,
  desc,
  buttonLabel,
  onSubmit,
  confirm,
}: {
  title: string
  desc: string
  buttonLabel: string
  onSubmit: (password: string) => Promise<{ ok: boolean; error?: string }>
  confirm?: boolean
}) {
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => ref.current?.focus(), [])

  const submit = async () => {
    setError(null)
    if (pw.length < 4) {
      setError('パスワードは4文字以上にしてください。')
      return
    }
    if (confirm && pw !== pw2) {
      setError('確認用パスワードが一致しません。')
      return
    }
    setBusy(true)
    const res = await onSubmit(pw)
    setBusy(false)
    if (!res.ok) {
      setError(
        res.error === 'invalid_credentials'
          ? 'パスワードが違います。'
          : res.error === 'weak_password'
            ? 'パスワードは4文字以上にしてください。'
            : 'エラーが発生しました。通信状況を確認してください。',
      )
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <span className="text-xl">🗓️</span>
          <h1 className="text-lg font-bold text-slate-800">ShiftCraft</h1>
        </div>
        <h2 className="text-base font-bold text-slate-700">{title}</h2>
        <p className="mb-4 mt-1 text-sm text-slate-500">{desc}</p>
        <div className="space-y-3">
          <input
            ref={ref}
            type="password"
            className="input"
            placeholder="パスワード"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !confirm && submit()}
          />
          {confirm && (
            <input
              type="password"
              className="input"
              placeholder="パスワード（確認）"
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button className="btn-primary w-full" onClick={submit} disabled={busy}>
            {busy ? '処理中…' : buttonLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

function SetupScreen({ onDone }: { onDone: () => void }) {
  return (
    <AuthCard
      title="初回パスワード設定"
      desc="このシフト表を守るためのパスワードを設定します。次回以降はこのパスワードでログインします。"
      buttonLabel="設定してはじめる"
      confirm
      onSubmit={async (pw) => {
        const res = await setupPassword(pw)
        if (res.ok) await onDone()
        return res
      }}
    />
  )
}

function LoginScreen({ onDone }: { onDone: () => void }) {
  return (
    <AuthCard
      title="ログイン"
      desc="パスワードを入力してください。"
      buttonLabel="ログイン"
      onSubmit={async (pw) => {
        const res = await apiLogin(pw)
        if (res.ok) await onDone()
        return res
      }}
    />
  )
}
