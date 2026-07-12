import { useState } from 'react'
import { useStore } from '../store/useStore'
import { fmtDuration } from './util'

const HOURS_PRESETS: Array<{ label: string; sub: string; minutes: number | undefined }> = [
  { label: 'Full day', sub: 'the usual plan', minutes: undefined },
  { label: '~4 hours', sub: 'a solid chunk', minutes: 240 },
  { label: '~3 hours', sub: 'a normal afternoon', minutes: 180 },
  { label: '~2 hours', sub: 'tight but real', minutes: 120 },
  { label: 'Day off', sub: 'nothing today', minutes: 0 },
]

function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

/**
 * Full-screen "start your day" step — separate from the timetable. Answering it
 * rebuilds today to fit, then reveals exactly what changed, so the check-in
 * visibly drives the plan instead of feeling like a dead prompt.
 */
export default function CheckinFlow() {
  const { checkinOpen, today, submitCheckin, closeCheckin } = useStore()
  const [hoursIdx, setHoursIdx] = useState(0)
  const [lowEnergy, setLowEnergy] = useState(false)
  const [phase, setPhase] = useState<'ask' | 'built'>('ask')
  const [busy, setBusy] = useState(false)

  if (!checkinOpen) return null

  const build = async () => {
    setBusy(true)
    await submitCheckin({ availableMinutes: HOURS_PRESETS[hoursIdx].minutes, lowEnergy })
    setBusy(false)
    setPhase('built')
  }

  const close = () => {
    setPhase('ask')
    setHoursIdx(0)
    setLowEnergy(false)
    closeCheckin()
  }

  const wrap =
    'fixed inset-0 z-50 flex flex-col bg-bg px-6'
  const insetStyle = {
    paddingTop: 'calc(env(safe-area-inset-top) + 2rem)',
    paddingBottom: 'calc(env(safe-area-inset-bottom) + 1.5rem)',
  }

  if (phase === 'built') {
    const studyBlocks = today?.blocks.filter((b) => b.kind === 'study') ?? []
    const off = today?.mode === 'off' || studyBlocks.length === 0
    return (
      <div className={wrap} style={insetStyle}>
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <div className="text-5xl">{off ? '🌤️' : '✓'}</div>
          <h1 className="mt-4 text-xl font-semibold">
            {off ? 'Enjoy the day off' : 'Your day is ready'}
          </h1>
          <p className="mt-2 text-sm text-muted">
            {off
              ? 'No targets, nothing rolls into debt.'
              : `${studyBlocks.length} focus block${studyBlocks.length === 1 ? '' : 's'} · ${fmtDuration(
                  today?.plannedMinutes ?? 0,
                )} of study${lowEnergy ? ' · eased for low energy' : ''}.`}
          </p>
        </div>
        <button
          onClick={close}
          className="w-full rounded-2xl bg-accent py-3.5 text-base font-semibold text-white active:opacity-90"
        >
          {off ? 'Got it' : 'See my day'}
        </button>
      </div>
    )
  }

  return (
    <div className={wrap} style={insetStyle}>
      <div className="flex-1 overflow-y-auto">
        <h1 className="text-2xl font-semibold">{greeting()}.</h1>
        <p className="mt-1 text-sm text-muted">How much time do you really have today?</p>

        <div className="mt-6 space-y-2">
          {HOURS_PRESETS.map((h, i) => (
            <button
              key={h.label}
              onClick={() => setHoursIdx(i)}
              className={`flex w-full items-center gap-3 rounded-2xl border px-4 py-3.5 text-left transition-colors ${
                hoursIdx === i ? 'border-accent bg-accent/10' : 'border-line bg-surface'
              }`}
            >
              <span
                className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 ${
                  hoursIdx === i ? 'border-accent' : 'border-line'
                }`}
              >
                {hoursIdx === i && <span className="h-2.5 w-2.5 rounded-full bg-accent" />}
              </span>
              <span className="flex-1">
                <span className="block text-sm font-semibold">{h.label}</span>
                <span className="block text-xs text-muted">{h.sub}</span>
              </span>
            </button>
          ))}
        </div>

        <p className="mt-6 text-sm font-medium">Energy</p>
        <div className="mt-2 flex gap-2">
          <button
            onClick={() => setLowEnergy(false)}
            className={`flex-1 rounded-2xl border py-3 text-sm font-semibold ${
              !lowEnergy ? 'border-accent bg-accent/10 text-ink' : 'border-line bg-surface text-ink2'
            }`}
          >
            😊 Good
          </button>
          <button
            onClick={() => setLowEnergy(true)}
            className={`flex-1 rounded-2xl border py-3 text-sm font-semibold ${
              lowEnergy ? 'border-accent bg-accent/10 text-ink' : 'border-line bg-surface text-ink2'
            }`}
          >
            🪫 Low
          </button>
        </div>
      </div>

      <div className="pt-4">
        <button
          onClick={() => void build()}
          disabled={busy}
          className="w-full rounded-2xl bg-accent py-3.5 text-base font-semibold text-white active:opacity-90 disabled:opacity-60"
        >
          Build my day
        </button>
      </div>
    </div>
  )
}
