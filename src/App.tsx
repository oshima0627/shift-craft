import { useEffect, useState } from 'react'
import BusynessCalendar from './components/BusynessCalendar'
import RolesTab from './components/RolesTab'
import ShiftsTab from './components/ShiftsTab'
import StaffTab from './components/StaffTab'
import DayOffCalendar from './components/DayOffCalendar'
import RequirementsTab from './components/RequirementsTab'
import ConstraintsTab from './components/ConstraintsTab'
import GenerateTab from './components/GenerateTab'
import DataMenu from './components/DataMenu'

type TabId =
  | 'busyness'
  | 'roles'
  | 'shifts'
  | 'staff'
  | 'dayoff'
  | 'requirements'
  | 'constraints'
  | 'generate'

// 手順の順番は「お店の基本を決める → 期間と忙しさ → 必要人数 → 希望休 → 条件 → 生成」
// の自然な流れに並べる（役割・時間帯・スタッフが揃ってから忙しさ・必要人数に進む）。
const TABS: { id: TabId; label: string; path: string }[] = [
  { id: 'roles', label: '役割', path: '/roles' },
  { id: 'shifts', label: '時間帯', path: '/shifts' },
  { id: 'staff', label: 'スタッフ', path: '/staff' },
  { id: 'busyness', label: '忙しさ', path: '/busyness' },
  { id: 'requirements', label: '必要人数', path: '/requirements' },
  { id: 'dayoff', label: '休み', path: '/dayoff' },
  { id: 'constraints', label: '条件', path: '/constraints' },
  { id: 'generate', label: 'シフト生成', path: '/generate' },
]

/**
 * 画面ごとの最大幅（左右余白）。中身に合わせて決める。
 * 31日分の横長の表がある「希望休」「シフト生成」だけ広くし、
 * それ以外はフォーム・カードが読みやすい幅に絞る（無駄に横に広げない）。
 * ヘッダー・ナビ・本文に同じ幅を適用して左右端を揃える。
 */
// ヘッダー（ワードマーク・手順ナビ・手順バー）は画面遷移で幅が変わらないよう固定。
// スタッフ画面と同じ幅に合わせる。
const HEADER_WIDTH = 'max-w-[1040px]'

const CONTENT_WIDTH: Record<TabId, string> = {
  roles: 'max-w-[880px]',
  shifts: 'max-w-[880px]',
  staff: 'max-w-[1040px]',
  busyness: 'max-w-[1000px]',
  requirements: 'max-w-[1040px]',
  dayoff: 'max-w-[1760px]',
  constraints: 'max-w-[900px]',
  generate: 'max-w-[1760px]',
}

/** URLパス → タブID（不明・ルートは最初の手順） */
function tabFromPath(pathname: string): TabId {
  const hit = TABS.find((t) => t.path === pathname)
  return hit ? hit.id : TABS[0].id
}

export default function App({ onLogout }: { onLogout?: () => void } = {}) {
  // 画面ごとにURLを持つ（/busyness, /staff, /generate ...）
  const [tab, setTabState] = useState<TabId>(() => tabFromPath(window.location.pathname))

  // 戻る/進む操作に追従
  useEffect(() => {
    const onPop = () => setTabState(tabFromPath(window.location.pathname))
    window.addEventListener('popstate', onPop)
    // 初回、ルート等で未確定なら現タブのURLに正規化
    const current = TABS.find((t) => t.id === tab)
    if (current && window.location.pathname !== current.path) {
      window.history.replaceState(null, '', current.path)
    }
    return () => window.removeEventListener('popstate', onPop)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setTab = (id: TabId) => {
    const path = TABS.find((t) => t.id === id)?.path ?? '/busyness'
    if (window.location.pathname !== path) {
      window.history.pushState(null, '', path)
    }
    setTabState(id)
  }

  const activeIndex = TABS.findIndex((t) => t.id === tab)
  const containerW = CONTENT_WIDTH[tab]

  return (
    <div className="min-h-screen">
      <header className="no-print sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className={`mx-auto flex ${HEADER_WIDTH} items-center justify-between gap-3 px-3 py-4 sm:px-5`}>
          <div className="flex items-baseline gap-2.5">
            <h1 className="text-xl font-bold tracking-tight text-slate-900">ShiftCraft</h1>
            <span className="hidden text-sm text-slate-400 sm:inline">シフト表作成</span>
          </div>
          <div className="flex items-center gap-2">
            {onLogout && (
              <button className="btn-ghost btn-sm" onClick={onLogout}>
                ログアウト
              </button>
            )}
            <DataMenu authed={!!onLogout} />
          </div>
        </div>

        {/* 手順ナビ：①〜⑧の流れが一目でわかるよう、番号つきの大きなステップに */}
        <nav className={`mx-auto ${HEADER_WIDTH} px-3 pb-3 sm:px-5`}>
          <ol className="flex flex-wrap gap-2">
            {TABS.map((t, i) => {
              const active = tab === t.id
              return (
                <li key={t.id}>
                  <button
                    onClick={() => setTab(t.id)}
                    aria-current={active ? 'step' : undefined}
                    className={`flex min-h-[2.75rem] items-center gap-2 rounded-xl border px-3.5 py-2 text-base font-semibold transition-colors ${
                      active
                        ? 'border-brand-500 bg-brand-500 text-white shadow-sm'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-brand-300 hover:bg-brand-50'
                    }`}
                  >
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                        active ? 'bg-white/25 text-white' : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {i + 1}
                    </span>
                    <span>{t.label}</span>
                  </button>
                </li>
              )
            })}
          </ol>
        </nav>
      </header>

      {/* 現在の手順の見出し（今どこにいるか一目でわかるように） */}
      <div className="no-print border-b border-slate-200 bg-white">
        <div className={`mx-auto ${HEADER_WIDTH} px-3 py-3 text-sm font-semibold text-brand-600 sm:px-5`}>
          手順 {activeIndex + 1} / {TABS.length}
        </div>
      </div>

      <main className={`mx-auto ${containerW} px-3 py-6 sm:px-5`}>
        {tab === 'busyness' && <BusynessCalendar />}
        {tab === 'roles' && <RolesTab />}
        {tab === 'shifts' && <ShiftsTab />}
        {tab === 'staff' && <StaffTab />}
        {tab === 'dayoff' && <DayOffCalendar />}
        {tab === 'requirements' && <RequirementsTab />}
        {tab === 'constraints' && <ConstraintsTab />}
        {tab === 'generate' && <GenerateTab />}
      </main>
    </div>
  )
}
