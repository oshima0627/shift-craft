import { useState } from 'react'
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

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'busyness', label: '忙しさ', icon: '📅' },
  { id: 'roles', label: '役割', icon: '🏷️' },
  { id: 'shifts', label: '時間帯', icon: '🕒' },
  { id: 'staff', label: 'スタッフ', icon: '👥' },
  { id: 'dayoff', label: '希望休', icon: '🗓️' },
  { id: 'requirements', label: '必要人数', icon: '🔢' },
  { id: 'constraints', label: '条件', icon: '⚙️' },
  { id: 'generate', label: 'シフト生成', icon: '✨' },
]

export default function App() {
  const [tab, setTab] = useState<TabId>('busyness')

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
