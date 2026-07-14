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

const TABS: { id: TabId; label: string; icon: string; path: string }[] = [
  { id: 'busyness', label: '忙しさ', icon: '📅', path: '/busyness' },
  { id: 'roles', label: '役割', icon: '🏷️', path: '/roles' },
  { id: 'shifts', label: '時間帯', icon: '🕒', path: '/shifts' },
  { id: 'staff', label: 'スタッフ', icon: '👥', path: '/staff' },
  { id: 'dayoff', label: '希望休', icon: '🗓️', path: '/dayoff' },
  { id: 'requirements', label: '必要人数', icon: '🔢', path: '/requirements' },
  { id: 'constraints', label: '条件', icon: '⚙️', path: '/constraints' },
  { id: 'generate', label: 'シフト生成', icon: '✨', path: '/generate' },
]

/** URLパス → タブID（不明・ルートは busyness） */
function tabFromPath(pathname: string): TabId {
  const hit = TABS.find((t) => t.path === pathname)
  return hit ? hit.id : 'busyness'
}

export default function App() {
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

  return (
    <div className="min-h-screen">
      <header className="no-print sticky top-0 z-10 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">🗓️</span>
            <h1 className="text-lg font-bold text-slate-800">ShiftCraft</h1>
            <span className="text-xs text-slate-400">シフト作成AI</span>
          </div>
          <DataMenu />
        </div>
        <nav className="mx-auto flex max-w-[1400px] gap-1 overflow-x-auto px-2 pb-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                tab === t.id
                  ? 'bg-brand-500 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <span className="mr-1">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-[1400px] px-4 py-6">
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
