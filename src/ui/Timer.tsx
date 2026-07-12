import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import type { ErrorCategory } from '../types'
import { subjectColor, subjectName, TASK_LABEL } from './util'

const ERROR_CATEGORIES: ErrorCategory[] = ['knowledge', 'misread', 'careless', 'structure', 'time']
const CONFIDENCE_WORDS = ['', 'Lost', 'Shaky', 'OK', 'Solid', 'Nailed it']

/** Two-note chime via WebAudio — best-effort (iOS may block outside a gesture). */
function playChime() {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new AC()
    for (const [i, f] of [880, 1320].entries()) {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = 'sine'
      o.frequency.value = f
      o.connect(g)
      g.connect(ctx.destination)
      const t0 = ctx.currentTime + i * 0.2
      g.gain.setValueAtTime(0.0001, t0)
      g.gain.exponentialRampToValueAtTime(0.3, t0 + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35)
      o.start(t0)
      o.stop(t0 + 0.4)
    }
    setTimeout(() => void ctx.close(), 1400)
  } catch {
    /* audio unavailable — the notification and vibration still fire */
  }
}

function notifyBlockDone(body: string) {
  try {
    navigator.vibrate?.([200, 80, 200])
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Block complete ✓', { body, tag: 'study-block' })
    }
  } catch {
    /* notifications unavailable */
  }
}

/**
 * Focused timer: countdown, break prompt, then a wrap-up panel that feeds the
 * scheduler — topic confidence, error logging, and paper calibration.
 */
export default function Timer() {
  const { today, activeBlockId, subjects, topics, stopTimer, finishBlock, partialBlock, logError } =
    useStore()
  const block = today?.blocks.find((b) => b.id === activeBlockId)
  const [paused, setPaused] = useState(false)
  const [phase, setPhase] = useState<'work' | 'wrapup'>('work')
  // Elapsed is derived from wall-clock timestamps, not tick counting, so it
  // stays accurate when the phone locks or Safari backgrounds the tab.
  const startedAtRef = useRef(Date.now())
  const pausedMsRef = useRef(0)
  const pauseStartedRef = useRef<number | null>(null)
  const firedRef = useRef(false)
  const [, forceTick] = useState(0)

  // Wrap-up state
  const [confidence, setConfidence] = useState<number | null>(null)
  const [errCat, setErrCat] = useState<ErrorCategory | null>(null)
  const [errNote, setErrNote] = useState('')
  const [loggedErrors, setLoggedErrors] = useState(0)
  const [paper, setPaper] = useState({ predicted: '', actual: '', max: '' })

  // Reset the clock whenever a new block opens (component instance is reused).
  useEffect(() => {
    startedAtRef.current = Date.now()
    pausedMsRef.current = 0
    pauseStartedRef.current = null
    firedRef.current = false
    setPaused(false)
    setPhase('work')
    setConfidence(null)
    setErrCat(null)
    setErrNote('')
    setLoggedErrors(0)
    setPaper({ predicted: '', actual: '', max: '' })
    // Ask once so the time-up alert can reach the user with the app backgrounded.
    try {
      if ('Notification' in window && Notification.permission === 'default') {
        void Notification.requestPermission()
      }
    } catch {
      /* ignore */
    }
  }, [activeBlockId])

  // Re-render twice a second while running so the countdown stays live.
  useEffect(() => {
    if (phase !== 'work') return
    const t = setInterval(() => forceTick((n) => n + 1), 500)
    return () => clearInterval(t)
  }, [phase])

  // Hold a screen wake lock while actively timing; drop it when paused/done.
  useEffect(() => {
    if (phase !== 'work' || paused) return
    let released = false
    let lock: { release: () => Promise<void> } | null = null
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<typeof lock> } }
    nav.wakeLock?.request('screen').then(
      (l) => { if (released) void l?.release(); else lock = l },
      () => {},
    )
    return () => { released = true; void lock?.release?.().catch(() => {}) }
  }, [phase, paused, activeBlockId])

  // Fire the time-up alert exactly once, computed from timestamps so it still
  // triggers after a lock/background stretch. Runs each tick; firedRef guards.
  useEffect(() => {
    if (!block || firedRef.current || phase !== 'work') return
    const held = pauseStartedRef.current ? Date.now() - pauseStartedRef.current : 0
    const el = Math.floor((Date.now() - startedAtRef.current - pausedMsRef.current - held) / 1000)
    if (el >= block.durationMin * 60) {
      firedRef.current = true
      playChime()
      notifyBlockDone(`${subjectName(subjects, block.subjectId)} — ${block.durationMin} min done`)
    }
  })

  if (!block) return null

  const now = Date.now()
  const pausedMs = pausedMsRef.current + (pauseStartedRef.current ? now - pauseStartedRef.current : 0)
  const elapsed = Math.max(0, Math.floor((now - startedAtRef.current - pausedMs) / 1000))
  const total = block.durationMin * 60
  const remaining = Math.max(0, total - elapsed)
  const mm = String(Math.floor(remaining / 60)).padStart(2, '0')
  const ss = String(remaining % 60).padStart(2, '0')
  const overtime = remaining === 0
  const elapsedMin = Math.max(1, Math.round(elapsed / 60))
  const color = subjectColor(subjects, block.subjectId)
  const topic = block.topicId != null ? topics.find((t) => t.id === block.topicId) : undefined
  const isPaper = block.taskType === 'PAST_PAPER'

  const submitError = async () => {
    if (!errCat || !block.subjectId) return
    await logError(block.subjectId, errCat, errNote, block.topicId)
    setLoggedErrors((n) => n + 1)
    setErrCat(null)
    setErrNote('')
  }

  const finish = async () => {
    const paperResult =
      isPaper && paper.actual !== '' && paper.max !== ''
        ? {
            predicted: Number(paper.predicted || 0),
            actual: Number(paper.actual),
            maxScore: Number(paper.max),
          }
        : undefined
    await finishBlock(block.id, {
      confidence: confidence ?? undefined,
      paper: paperResult,
    })
  }

  const togglePause = () => {
    if (pauseStartedRef.current == null) {
      pauseStartedRef.current = Date.now()
      setPaused(true)
    } else {
      pausedMsRef.current += Date.now() - pauseStartedRef.current
      pauseStartedRef.current = null
      setPaused(false)
    }
  }

  const chip = 'rounded-full border border-line px-3 py-1.5 text-xs font-medium'

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-bg"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col p-5">
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full" style={{ background: color }} />
          <span className="font-semibold">{subjectName(subjects, block.subjectId)}</span>
          {block.taskType && (
            <span className="rounded-full bg-raised px-2 py-0.5 text-[11px] font-medium text-ink2">
              {TASK_LABEL[block.taskType]}
            </span>
          )}
          <button onClick={stopTimer} className="ml-auto text-sm text-muted">
            ✕ close
          </button>
        </div>
        <p className="mt-1 text-sm text-ink2">{block.label}</p>

        {phase === 'work' ? (
          <>
            <div className="flex flex-1 flex-col items-center justify-center">
              {overtime ? (
                <div className="text-center">
                  <div className="text-5xl">☕</div>
                  <p className="mt-3 text-lg font-semibold">Time! Take a 10-min break.</p>
                  <p className="mt-1 text-sm text-muted">Stand up, water, phone stays in the other room.</p>
                </div>
              ) : (
                <div className={`tabular text-7xl font-bold ${paused ? 'opacity-40' : ''}`}>
                  {mm}:{ss}
                </div>
              )}
              {isPaper && !overtime && (
                <p className="mt-6 max-w-xs text-center text-sm text-muted">
                  Exam conditions: no notes. Before you start, predict your score — you'll enter
                  it after marking.
                </p>
              )}
            </div>
            <div className="flex justify-center gap-3 pb-6">
              <button onClick={togglePause} className="rounded-lg border border-line px-4 py-2.5 text-sm text-ink2">
                {paused ? '▶ Resume' : '⏸ Pause'}
              </button>
              <button onClick={() => void partialBlock(block.id, elapsedMin)} className="rounded-lg border border-line px-4 py-2.5 text-sm text-ink2">
                Stop early
              </button>
              <button onClick={() => setPhase('wrapup')} className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white">
                ✓ Done
              </button>
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col justify-center gap-5 overflow-y-auto py-4">
            {topic && (
              <section>
                <h3 className="text-sm font-semibold">How solid is “{topic.name}” now?</h3>
                <p className="mt-0.5 text-xs text-muted">
                  Be honest — feeling fluent isn't knowing. This sets when it comes back.
                </p>
                <div className="mt-2 flex gap-1.5">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      onClick={() => setConfidence(n)}
                      className={`flex-1 rounded-lg border px-1 py-2 text-xs font-medium ${
                        confidence === n
                          ? 'border-accent bg-accent text-white'
                          : 'border-line bg-surface text-ink2'
                      }`}
                    >
                      {n}
                      <div className="text-[10px] opacity-80">{CONFIDENCE_WORDS[n]}</div>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {isPaper && (
              <section>
                <h3 className="text-sm font-semibold">Calibration — predicted vs marked</h3>
                <p className="mt-0.5 text-xs text-muted">
                  Mark it against the official scheme first. The gap is the skill.
                </p>
                <div className="mt-2 flex items-center gap-2 text-sm">
                  <input type="number" placeholder="Predicted" value={paper.predicted}
                    onChange={(e) => setPaper({ ...paper, predicted: e.target.value })}
                    className="w-24 rounded-lg border border-line bg-surface px-2 py-2" />
                  <input type="number" placeholder="Actual" value={paper.actual}
                    onChange={(e) => setPaper({ ...paper, actual: e.target.value })}
                    className="w-24 rounded-lg border border-line bg-surface px-2 py-2" />
                  <span className="text-muted">/</span>
                  <input type="number" placeholder="Max" value={paper.max}
                    onChange={(e) => setPaper({ ...paper, max: e.target.value })}
                    className="w-20 rounded-lg border border-line bg-surface px-2 py-2" />
                </div>
              </section>
            )}

            <section>
              <h3 className="text-sm font-semibold">
                Log errors {loggedErrors > 0 && <span className="text-good">· {loggedErrors} logged</span>}
              </h3>
              <p className="mt-0.5 text-xs text-muted">
                Every dropped mark gets a category. Patterns emerge fast — errors are where marks live.
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {ERROR_CATEGORIES.map((c) => (
                  <button key={c} onClick={() => setErrCat(errCat === c ? null : c)}
                    className={`${chip} ${errCat === c ? 'border-accent bg-accent text-white' : 'bg-surface text-ink2'}`}>
                    {c}
                  </button>
                ))}
              </div>
              {errCat && (
                <div className="mt-2 flex gap-2">
                  <input value={errNote} placeholder="What went wrong, specifically?"
                    onChange={(e) => setErrNote(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void submitError()}
                    className="flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm" autoFocus />
                  <button onClick={() => void submitError()}
                    className="rounded-lg bg-accent px-4 text-sm font-medium text-white">
                    Add
                  </button>
                </div>
              )}
            </section>

            <div className="flex justify-center gap-3 pt-2">
              <button onClick={() => setPhase('work')} className="rounded-lg border border-line px-4 py-2.5 text-sm text-ink2">
                ← Back to timer
              </button>
              <button onClick={() => void finish()} className="rounded-lg bg-accent px-6 py-2.5 text-sm font-medium text-white">
                Finish block ✓
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
