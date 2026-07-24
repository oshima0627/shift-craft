import { useEffect, useRef, useState } from 'react'
import App from '../App'
import { PrivacyPage, TermsPage, TokushohoPage } from './LegalPages'
import { useStore } from '../state/store'
import {
  forgotPassword,
  getAuthStatus,
  login as apiLogin,
  logout as apiLogout,
  pullCloudIntoStore,
  pushCloudIfChanged,
  resendVerification,
  resetPassword,
  signup,
  setupAccount,
} from '../utils/cloud'

type Phase = 'loading' | 'setup' | 'login' | 'ready' | 'local' | 'guest'

// ゲストモード（ログインなしのお試し利用）の選択を記憶するキー。
// 選ぶと次回以降もログイン画面を挟まずアプリを開く（ログイン成功時に解除）。
const GUEST_KEY = 'shiftcraft-guest-mode'

function isGuestMode(): boolean {
  try {
    return localStorage.getItem(GUEST_KEY) === '1'
  } catch {
    return false
  }
}

function setGuestMode(on: boolean): void {
  try {
    if (on) localStorage.setItem(GUEST_KEY, '1')
    else localStorage.removeItem(GUEST_KEY)
  } catch {
    // localStorage 不可の環境では記憶しない（毎回ログイン画面から選び直すだけ）
  }
}

/**
 * 認証の入口。バックエンド（Cloudflare Worker + D1）があればログインを要求し、
 * ログイン後は設定をD1と自動同期する。バックエンドが無い（ローカル開発）場合は
 * そのままアプリを表示する（ローカルモード）。
 * ログインせずに基本機能を使う「お試し（ゲスト）モード」も選べる。
 * その場合データはこの端末の localStorage にのみ保存され、
 * クラウド同期・AI解釈・印刷/CSVなどの有料機能はロックされる。
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
      // 以前「ログインせずに使う」を選んでいたら、ログイン画面を挟まず再開する
      setPhase(isGuestMode() ? 'guest' : 'login')
      return
    }
    await enterAuthed()
  }

  async function enterAuthed() {
    // ログインに成功したらお試しモードは解除
    setGuestMode(false)
    // ログイン済み → クラウドの設定を取り込んでからアプリ表示
    await pullCloudIntoStore(getData, (d) => useStore.getState().importData(d))
    setPhase('ready')
  }

  /** ログインせずに使いはじめる（お試し／ゲストモード） */
  function startGuest() {
    setGuestMode(true)
    if (phase === 'guest') {
      // 既にゲストで /login を開いている場合はトップへ戻す
      window.location.href = '/'
      return
    }
    setPhase('guest')
  }

  // 法令ページ（公開URL）。認証状態に関わらず、直リンク・ログイン前でも開ける。
  const path = typeof window !== 'undefined' ? window.location.pathname : '/'
  if (path === '/legal') return <TokushohoPage />
  if (path === '/terms') return <TermsPage />
  if (path === '/privacy') return <PrivacyPage />

  if (phase === 'loading') {
    return <Centered>読み込み中…</Centered>
  }
  // 新規登録ページ（公開URL /register）。ログイン前でも開ける。
  if (path === '/register') {
    return <RegisterScreen />
  }
  // パスワード再設定（公開URL）。メール入力→リンク送信 / リンク先で新パスワード設定。
  if (path === '/forgot') {
    return <ForgotScreen />
  }
  if (path === '/reset') {
    return <ResetScreen />
  }
  if (phase === 'setup') {
    return <SetupScreen onDone={enterAuthed} />
  }
  // ゲスト利用中でも /login でログイン画面を開ける（ヘッダーの「ログイン」から）
  if (phase === 'login' || (phase === 'guest' && path === '/login')) {
    return <LoginScreen onDone={enterAuthed} onGuest={startGuest} />
  }
  // お試し（ゲスト）モード: ログインなしで基本機能を使う。データはこの端末にのみ保存
  if (phase === 'guest') {
    return <App guest />
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

/** 認証系フォームの共通カード枠（タイトル＋説明＋本文） */
function CardShell({
  title,
  desc,
  children,
}: {
  title: string
  desc: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 shadow-sm sm:p-8">
        <div className="mb-5">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">ShiftCraft</h1>
        </div>
        <h2 className="text-lg font-bold text-slate-800">{title}</h2>
        <p className="mb-5 mt-1.5 text-base leading-relaxed text-slate-500">{desc}</p>
        {children}
      </div>
    </div>
  )
}

function AuthCard({
  title,
  desc,
  buttonLabel,
  onSubmit,
  confirm,
  footer,
  idType = 'text',
  idPlaceholder = 'ID（ユーザー名）',
  idNoun = 'ID',
  emailAsId,
  doneMessage,
  onResend,
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
  /** カード下部に表示する補助リンク等 */
  footer?: React.ReactNode
  /** 1つ目の入力欄の type（メールアドレスをIDにする場合は 'email'） */
  idType?: 'text' | 'email'
  /** 1つ目の入力欄のプレースホルダ */
  idPlaceholder?: string
  /** メッセージ内でIDを指す語（例: 'メールアドレス'） */
  idNoun?: string
  /** メールアドレスをそのままIDとして使う（email=id で送信し、形式も検証する） */
  emailAsId?: boolean
  /** 成功時にフォームの代わりに表示する完了メッセージ（入力IDを受け取る） */
  doneMessage?: (email: string) => React.ReactNode
  /** 確認メールの再送。指定するとメール未確認時に再送ボタンを出す */
  onResend?: (email: string) => Promise<{ ok: boolean; error?: string }>
}) {
  const [id, setId] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  /** メール未確認エラー（ログイン時）。再送ボタンの出し分けに使う */
  const [unverified, setUnverified] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => ref.current?.focus(), [])

  const submit = async () => {
    setError(null)
    setUnverified(false)
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
    // メールをIDとして運用するため、email 引数には id と同じ値を渡す
    const res = await onSubmit(id.trim(), pw, id.trim())
    setBusy(false)
    if (res.ok) {
      if (doneMessage) setDone(true)
      return
    }
    if (res.error === 'email_unverified') setUnverified(true)
    setError(
      res.error === 'invalid_credentials'
        ? `${idNoun}またはパスワードが違います。`
        : res.error === 'email_unverified'
          ? 'メールアドレスの確認が完了していません。登録時にお送りした確認メールのリンクを開いてください。'
          : res.error === 'username_taken'
            ? `その${idNoun}は既に使われています。別の${idNoun}にしてください。`
            : res.error === 'weak_password'
              ? 'パスワードは4文字以上にしてください。'
              : res.error === 'invalid_username' || res.error === 'invalid_email'
                ? '正しいメールアドレスを入力してください。'
                : res.error === 'not_configured'
                  ? 'まだ利用の準備が整っていないため登録できません。しばらくしてからお試しください。'
                  : 'エラーが発生しました。通信状況を確認してください。',
    )
  }

  if (done && doneMessage) {
    return (
      <CardShell title={title} desc={desc}>
        <div className="space-y-4">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-base leading-relaxed text-emerald-800">
            {doneMessage(id.trim())}
          </div>
          {onResend && <ResendMailButton email={id.trim()} onResend={onResend} />}
          {footer}
        </div>
      </CardShell>
    )
  }

  return (
    <CardShell title={title} desc={desc}>
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
        {error && <p className="text-sm font-medium text-red-600">{error}</p>}
        {unverified && onResend && <ResendMailButton email={id.trim()} onResend={onResend} />}
        <button className="btn-primary w-full text-lg" onClick={submit} disabled={busy}>
          {busy ? '処理中…' : buttonLabel}
        </button>
        {footer}
      </div>
    </CardShell>
  )
}

/** 確認メールを再送するボタン（送信後は「送信しました」を表示） */
function ResendMailButton({
  email,
  onResend,
}: {
  email: string
  onResend: (email: string) => Promise<{ ok: boolean; error?: string }>
}) {
  const [state, setState] = useState<'idle' | 'busy' | 'sent'>('idle')
  if (state === 'sent') {
    return (
      <p className="text-sm text-emerald-700">
        確認メールを再送しました。メールをご確認ください。
      </p>
    )
  }
  return (
    <button
      type="button"
      className="text-sm font-semibold text-brand-600 hover:underline disabled:opacity-60"
      disabled={state === 'busy' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)}
      onClick={async () => {
        setState('busy')
        const res = await onResend(email)
        setState(res.ok ? 'sent' : 'idle')
      }}
    >
      {state === 'busy' ? '送信中…' : '確認メールを再送する'}
    </button>
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

function LoginScreen({ onDone, onGuest }: { onDone: () => void; onGuest?: () => void }) {
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
      onResend={async (email) => resendVerification(email)}
      footer={
        <div className="space-y-3 border-t border-slate-100 pt-4 text-sm leading-relaxed text-slate-500">
          {onGuest && (
            <button
              type="button"
              className="btn-ghost w-full"
              onClick={onGuest}
            >
              ログインせずに使ってみる
            </button>
          )}
          <p>
            アカウントをお持ちでない方は{' '}
            <a href="/register" className="font-semibold text-brand-600 hover:underline">
              新規登録
            </a>
            （メールアドレスとパスワードで登録し、確認メールのリンクを開くとご利用いただけます）
          </p>
          <p>
            パスワードをお忘れの方は{' '}
            <a href="/forgot" className="font-semibold text-brand-600 hover:underline">
              こちらから再設定
            </a>
          </p>
          <LegalLinks />
        </div>
      }
    />
  )
}

function RegisterScreen() {
  return (
    <AuthCard
      title="新規登録"
      desc="メールアドレス（これがログインIDになります）とパスワードを入力してください。入力したメールアドレス宛に確認メールをお送りします。メール内のリンクを開くと登録が完了し、ログインできるようになります。"
      buttonLabel="確認メールを送る"
      confirm
      emailAsId
      idType="email"
      idPlaceholder="メールアドレス"
      idNoun="メールアドレス"
      onSubmit={async (id, pw, email) => signup(id, pw, email)}
      doneMessage={(email) => (
        <>
          確認メールを <span className="font-semibold">{email}</span> に送信しました。
          メール内のリンクを開くと登録が完了し、ログインできるようになります
          （リンクの有効期限は24時間です）。
          <br />
          メールが届かない場合は、迷惑メールフォルダをご確認のうえ、下のボタンから再送してください。
        </>
      )}
      onResend={async (email) => resendVerification(email)}
      footer={
        <div className="space-y-3 border-t border-slate-100 pt-4">
          <p className="text-sm text-slate-500">
            <a href="/" className="font-semibold text-brand-600 hover:underline">
              ← ログイン画面へ戻る
            </a>
          </p>
          <LegalLinks />
        </div>
      }
    />
  )
}

/** パスワード再設定: メールアドレスを入力して再設定リンクの送信を依頼する */
function ForgotScreen() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => ref.current?.focus(), [])

  const submit = async () => {
    setError(null)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('正しいメールアドレスを入力してください。')
      return
    }
    setBusy(true)
    const res = await forgotPassword(email.trim())
    setBusy(false)
    // 存在有無に関わらず常に完了扱い（アカウントの有無を漏らさない）
    if (res.ok) setDone(true)
    else setError('エラーが発生しました。通信状況を確認してください。')
  }

  return (
    <CardShell
      title="パスワードの再設定"
      desc="登録したメールアドレスを入力してください。パスワード再設定用のリンクをメールでお送りします。"
    >
      {done ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-base leading-relaxed text-emerald-800">
            入力されたメールアドレスが登録されている場合、再設定用のリンクをお送りしました。
            メールをご確認ください（届かない場合は迷惑メールフォルダもご確認ください）。
            リンクの有効期限は1時間です。
          </div>
          <p className="text-sm text-slate-500">
            <a href="/" className="font-semibold text-brand-600 hover:underline">
              ← ログイン画面へ戻る
            </a>
          </p>
          <LegalLinks />
        </div>
      ) : (
        <div className="space-y-3">
          <input
            ref={ref}
            type="email"
            autoComplete="email"
            className="input"
            placeholder="メールアドレス"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
          {error && <p className="text-sm font-medium text-red-600">{error}</p>}
          <button className="btn-primary w-full text-lg" onClick={submit} disabled={busy}>
            {busy ? '送信中…' : '再設定リンクを送る'}
          </button>
          <div className="space-y-3">
            <p className="text-sm text-slate-500">
              <a href="/" className="font-semibold text-brand-600 hover:underline">
                ← ログイン画面へ戻る
              </a>
            </p>
            <LegalLinks />
          </div>
        </div>
      )}
    </CardShell>
  )
}

/** パスワード再設定: メール内リンク（?token=...）から新しいパスワードを設定する */
function ResetScreen() {
  const token =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('token') ?? ''
      : ''
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
    if (pw !== pw2) {
      setError('確認用パスワードが一致しません。')
      return
    }
    setBusy(true)
    const res = await resetPassword(token, pw)
    setBusy(false)
    if (res.ok && typeof window !== 'undefined') {
      // 再設定と同時にログイン状態になる → トップへ遷移
      window.location.href = '/'
      return
    }
    setError(
      res.error === 'invalid_token'
        ? 'リンクの有効期限が切れているか、正しくありません。お手数ですが再度お試しください。'
        : res.error === 'weak_password'
          ? 'パスワードは4文字以上にしてください。'
          : 'エラーが発生しました。通信状況を確認してください。',
    )
  }

  return (
    <CardShell title="新しいパスワードの設定" desc="新しいパスワードを入力してください。">
      {!token ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-base leading-relaxed text-red-700">
            リンクが正しくありません。パスワード再設定メールのリンクからもう一度お開きください。
          </div>
          <p className="text-sm text-slate-500">
            <a href="/forgot" className="font-semibold text-brand-600 hover:underline">
              再設定リンクを取得し直す
            </a>
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <input
            ref={ref}
            type="password"
            autoComplete="new-password"
            className="input"
            placeholder="新しいパスワード"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
          />
          <input
            type="password"
            autoComplete="new-password"
            className="input"
            placeholder="新しいパスワード（確認）"
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
          {error && <p className="text-sm font-medium text-red-600">{error}</p>}
          <button className="btn-primary w-full text-lg" onClick={submit} disabled={busy}>
            {busy ? '設定中…' : 'この内容で設定する'}
          </button>
          <p className="text-sm text-slate-500">
            <a href="/" className="font-semibold text-brand-600 hover:underline">
              ← ログイン画面へ戻る
            </a>
          </p>
        </div>
      )}
    </CardShell>
  )
}

/** 法令ページへの共通リンク（ログイン・申請画面のフッター用） */
function LegalLinks() {
  return (
    <nav className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-100 pt-3 text-xs text-slate-400">
      <a href="/legal" className="hover:text-brand-600 hover:underline">
        特定商取引法に基づく表記
      </a>
      <a href="/terms" className="hover:text-brand-600 hover:underline">
        利用規約
      </a>
      <a href="/privacy" className="hover:text-brand-600 hover:underline">
        プライバシーポリシー
      </a>
    </nav>
  )
}
