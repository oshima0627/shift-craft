import { useEffect, useRef, useState } from 'react'
import App from '../App'
import { useStore } from '../state/store'
import {
  getAuthStatus,
  login as apiLogin,
  logout as apiLogout,
  pullCloudIntoStore,
  pushCloudIfChanged,
  requestAccess,
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
  // 新規登録の申請ページ（公開URL /register）。ログイン前でも開ける。
  if (typeof window !== 'undefined' && window.location.pathname === '/register') {
    return <RegisterScreen />
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
  withEmail,
  doneMessage,
  footer,
  idType = 'text',
  idPlaceholder = 'ID（ユーザー名）',
  idNoun = 'ID',
  emailAsId,
}: {
  title: string
  desc: string
  buttonLabel: string
  onSubmit: (
    username: string,
    password: string,
    email: string,
  ) => Promise<{ ok: boolean; error?: string }>
  confirm?: boolean
  /** 連絡先メール入力欄を出すか（申請フォーム用） */
  withEmail?: boolean
  /** 成功時にフォームの代わりに表示する完了メッセージ（申請フォーム用） */
  doneMessage?: string
  /** カード下部に表示する補助リンク等 */
  footer?: React.ReactNode
  /** 1つ目の入力欄の type（メールアドレスをIDにする場合は 'email'） */
  idType?: 'text' | 'email'
  /** 1つ目の入力欄のプレースホルダ */
  idPlaceholder?: string
  /** メッセージ内でIDを指す語（例: 'メールアドレス'） */
  idNoun?: string
  /** メールアドレスをそのままIDとして使う（連絡先メール欄を出さず、email=id で送信） */
  emailAsId?: boolean
}) {
  const [id, setId] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => ref.current?.focus(), [])

  const submit = async () => {
    setError(null)
    if (id.trim().length < 1) {
      setError(`${idNoun}を入力してください。`)
      return
    }
    if (emailAsId && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(id.trim())) {
      setError('正しいメールアドレスを入力してください。')
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
    // メールをIDにする場合は email も id と同じ値で送る
    const res = await onSubmit(id.trim(), pw, emailAsId ? id.trim() : email.trim())
    setBusy(false)
    if (res.ok) {
      if (doneMessage) setDone(true)
      return
    }
    setError(
      res.error === 'invalid_credentials'
        ? `${idNoun}またはパスワードが違います。`
        : res.error === 'pending_approval'
          ? 'このアカウントはまだ承認されていません。管理者の承認後にログインできます。'
          : res.error === 'username_taken'
            ? `その${idNoun}は既に使われています。別の${idNoun}にしてください。`
            : res.error === 'weak_password'
              ? 'パスワードは4文字以上にしてください。'
              : res.error === 'invalid_username'
                ? `${idNoun}を入力してください。`
                : res.error === 'not_configured'
                  ? 'まだ管理者アカウントが作成されていないため申請できません。'
                  : 'エラーが発生しました。通信状況を確認してください。',
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 shadow-sm sm:p-8">
        <div className="mb-5">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">ShiftCraft</h1>
        </div>
        <h2 className="text-lg font-bold text-slate-800">{title}</h2>
        <p className="mb-5 mt-1.5 text-base leading-relaxed text-slate-500">{desc}</p>

        {done && doneMessage ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-base leading-relaxed text-emerald-800">
              {doneMessage}
            </div>
            {footer}
          </div>
        ) : (
          <div className="space-y-3">
            <input
              ref={ref}
              type={idType}
              autoComplete={emailAsId ? 'email' : 'username'}
              className="input"
              placeholder={idPlaceholder}
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
            {withEmail && (
              <input
                type="email"
                autoComplete="email"
                className="input"
                placeholder="連絡先メール（任意・承認者への案内用）"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
              />
            )}
            {error && <p className="text-sm font-medium text-red-600">{error}</p>}
            <button className="btn-primary w-full text-lg" onClick={submit} disabled={busy}>
              {busy ? '処理中…' : buttonLabel}
            </button>
            {footer}
          </div>
        )}
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
  const registerUrl =
    (typeof window !== 'undefined' ? window.location.origin : '') + '/register'
  return (
    <AuthCard
      title="ログイン"
      desc="登録したメールアドレス（ID）とパスワードを入力してください。"
      buttonLabel="ログイン"
      idPlaceholder="メールアドレス（ID）"
      idNoun="メールアドレス"
      onSubmit={async (id, pw) => {
        const res = await apiLogin(id, pw)
        if (res.ok) await onDone()
        return res
      }}
      footer={
        <div className="border-t border-slate-100 pt-4 text-sm leading-relaxed text-slate-500">
          <p>
            アカウントをお持ちでない方は、下記の新規登録ページから申請してください。
            管理者の承認後にログインできます。
          </p>
          <p className="mt-2">
            <a href="/register" className="font-semibold text-brand-600 hover:underline">
              新規登録はこちら
            </a>
          </p>
          <p className="mt-1 break-all text-slate-400">{registerUrl}</p>
        </div>
      }
    />
  )
}

function RegisterScreen() {
  return (
    <AuthCard
      title="新規登録の申請"
      desc="メールアドレス（これがログインIDになります）とパスワードを入力して申請してください。管理者(oshima6.27@gmail.com)に確認メールが届き、承認されると、このメールアドレス＋パスワードでログインできるようになります。"
      buttonLabel="この内容で申請する"
      confirm
      emailAsId
      idType="email"
      idPlaceholder="メールアドレス"
      idNoun="メールアドレス"
      doneMessage="申請を受け付けました。管理者が承認すると、入力したメールアドレス＋パスワードでログインできます。承認までしばらくお待ちください。"
      onSubmit={async (id, pw, email) => requestAccess(id, pw, email)}
      footer={
        <p className="text-sm text-slate-500">
          <a href="/" className="font-semibold text-brand-600 hover:underline">
            ← ログイン画面へ戻る
          </a>
        </p>
      }
    />
  )
}
