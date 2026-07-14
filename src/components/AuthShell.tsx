import { useEffect, useRef, useState } from 'react'
import App from '../App'
import { useStore } from '../state/store'
import {
  getAuthStatus,
  login as apiLogin,
  logout as apiLogout,
  pullCloudIntoStore,
  pushCloudIfChanged,
  setupAccount,
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
    <div className="flex min-h-screen items-center justify-center bg-slate-100 text-lg text-slate-500">
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
  onSubmit: (username: string, password: string) => Promise<{ ok: boolean; error?: string }>
  confirm?: boolean
}) {
  const [id, setId] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => ref.current?.focus(), [])

  const submit = async () => {
    setError(null)
    if (id.trim().length < 1) {
      setError('IDを入力してください。')
      return
    }
    if (pw.length < 4) {
      setError('パスワードは4文字以上にしてください。')
      return
    }
    if (confirm && pw !== pw2) {
      setError('確認用パスワードが一致しません。')
      return
    }
    setBusy(true)
    const res = await onSubmit(id.trim(), pw)
    setBusy(false)
    if (!res.ok) {
      setError(
        res.error === 'invalid_credentials'
          ? 'IDまたはパスワードが違います。'
          : res.error === 'weak_password'
            ? 'パスワードは4文字以上にしてください。'
            : res.error === 'invalid_username'
              ? 'IDを入力してください。'
              : 'エラーが発生しました。通信状況を確認してください。',
      )
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 shadow-sm sm:p-8">
        <div className="mb-5 flex items-center gap-2.5">
          <span className="text-3xl">🗓️</span>
          <h1 className="text-2xl font-bold text-slate-900">ShiftCraft</h1>
        </div>
        <h2 className="text-lg font-bold text-slate-800">{title}</h2>
        <p className="mb-5 mt-1.5 text-base leading-relaxed text-slate-500">{desc}</p>
        <div className="space-y-3">
          <input
            ref={ref}
            type="text"
            autoComplete="username"
            className="input"
            placeholder="ID（ユーザー名）"
            value={id}
            onChange={(e) => setId(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
          <input
            type="password"
            autoComplete={confirm ? 'new-password' : 'current-password'}
            className="input"
            placeholder="パスワード"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !confirm && submit()}
          />
          {confirm && (
            <input
              type="password"
              autoComplete="new-password"
              className="input"
              placeholder="パスワード（確認）"
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
          )}
          {error && <p className="text-sm font-medium text-red-600">{error}</p>}
          <button className="btn-primary w-full text-lg" onClick={submit} disabled={busy}>
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
      title="初回アカウント作成"
      desc="このシフト表を守るためのID（ユーザー名）とパスワードを設定します。次回以降はこのID＋パスワードでログインします。"
      buttonLabel="作成してはじめる"
      confirm
      onSubmit={async (id, pw) => {
        const res = await setupAccount(id, pw)
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
      desc="IDとパスワードを入力してください。"
      buttonLabel="ログイン"
      onSubmit={async (id, pw) => {
        const res = await apiLogin(id, pw)
        if (res.ok) await onDone()
        return res
      }}
    />
  )
}
