import { useEffect } from 'react'
import { useStore } from './store/useStore'
import Onboarding from './ui/Onboarding'
import Today from './ui/Today'
import Week from './ui/Week'
import Subjects from './ui/Subjects'
import Insights from './ui/Insights'
import Settings from './ui/Settings'
import Timer from './ui/Timer'
import CheckinFlow from './ui/CheckinFlow'

const TABS = [
  { id: 'today', label: 'Today', icon: '◧' },
  { id: 'week', label: 'Week', icon: '▦' },
  { id: 'subjects', label: 'Subjects', icon: '◉' },
  { id: 'insights', label: 'Insights', icon: '◫' },
] as const

export default function App() {
  const { ready, user, view, setView, activeBlockId, init } = useStore()

  useEffect(() => {
    void init()
  }, [init])

  if (!ready) {
    return (
      <div className="flex h-dvh items-center justify-center text-muted">Loading…</div>
    )
  }
  if (!user?.onboarded) return <Onboarding />

  const settingsOpen = view === 'settings'

  return (
    <div className="relative mx-auto flex h-dvh max-w-md flex-col bg-bg">
      <main className="flex-1 overflow-y-auto px-4 pb-28 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
        {view === 'today' && <Today />}
        {view === 'week' && <Week />}
        {view === 'subjects' && <Subjects />}
        {view === 'insights' && <Insights />}
        {settingsOpen && <Settings />}
      </main>

      {!settingsOpen && (
        <nav className="absolute inset-x-0 bottom-0 border-t border-line bg-surface/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
          <div className="flex">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setView(t.id)}
                className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium transition-colors ${
                  view === t.id ? 'text-accent' : 'text-muted active:text-ink2'
                }`}
              >
                <span className="text-lg leading-none">{t.icon}</span>
                {t.label}
              </button>
            ))}
          </div>
        </nav>
      )}

      {activeBlockId && <Timer />}
      <CheckinFlow />
    </div>
  )
}
