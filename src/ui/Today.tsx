import { useState } from 'react'
import { daysBetween } from '../engine/dates'
import { debtMinutes, localToday, useStore } from '../store/useStore'
import type { Block, DaySchedule, Debt, Subject, Topic } from '../types'
import { fmtClock, fmtDuration, subjectColor, subjectName, TASK_LABEL } from './util'

const SKIP_REASONS = ['No time', 'Too tired', 'Too hard', 'Not needed']
const BACKUP_STALE_DAYS = 7

/** One-line "why today looks like this", built from the day's real signals. */
function dailyBrief(today: DaySchedule, subjects: Subject[], topics: Topic[], debts: Debt[]): string {
  if (today.mode === 'reset') return 'Reset week — targets cut while you clear the backlog. Small wins today.'
  if (today.mode === 'low_energy') return 'Low-energy day — 60% load, essentials kept. Just start.'
  if (today.mode === 'rest') return 'Rest day — only Spanish, to keep the chain alive. Sleep consolidates the rest.'
  if (today.mode === 'off') return 'Planned day off — no targets, no debt. Enjoy it.'

  const parts: string[] = []
  const paper = today.blocks.find((b) => b.taskType === 'PAST_PAPER' && b.subjectId)
  if (paper) parts.push(`${subjectName(subjects, paper.subjectId)} past-paper day`)
  const red = topics.filter((t) => t.confidence <= 2).length
  if (red > 0) parts.push(`${red} topic${red === 1 ? '' : 's'} sitting red`)
  const debt = debtMinutes(debts)
  if (debt >= 15) parts.push(`${fmtDuration(debt)} debt eased in`)
  const first = today.blocks.find((b) => b.kind === 'study')?.subjectId
  if (parts.length === 0 && first) parts.push(`Hardest first: ${subjectName(subjects, first)} while you're fresh`)
  return parts.slice(0, 2).join(' · ') + '.'
}

export default function Today() {
  const {
    today, user, subjects, topics, debts,
    regenerateToday, startVacation, endVacation, setView, setDayPlan, openCheckin,
  } = useStore()
  const [toast, setToast] = useState<string | null>(null)
  const [adjust, setAdjust] = useState(false)

  if (!today) return null

  const onVacation = today.mode === 'vacation'
  const dayOff = today.mode === 'off'
  const streak = user?.streak ?? 0
  const debt = debtMinutes(debts)
  const donePct = Math.round((today.completionRate ?? 0) * 100)
  const backupStale =
    user != null &&
    (user.lastBackupDate == null || daysBetween(user.lastBackupDate, localToday()) >= BACKUP_STALE_DAYS)

  const flash = (msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(null), 2200)
  }
  const regenerate = async (opts?: { lowEnergy?: boolean }) => {
    setAdjust(false)
    await regenerateToday(opts)
    flash(opts?.lowEnergy ? 'Rebuilt at 60% load 🪫' : 'Schedule regenerated ↻')
  }

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold leading-tight">
            {new Date().toLocaleDateString(undefined, { weekday: 'long' })}
          </h1>
          <p className="text-sm text-muted">
            {new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric' })} ·{' '}
            {fmtDuration(today.plannedMinutes)} planned
          </p>
        </div>
        <button
          onClick={() => setView('settings')}
          className="grid h-9 w-9 place-items-center rounded-full bg-surface text-lg text-ink2 active:opacity-80"
          aria-label="Settings"
        >
          ⚙
        </button>
      </header>

      {/* Glance */}
      <div className="grid grid-cols-3 gap-2">
        <Glance value={`🔥 ${streak}`} label="streak" />
        <Glance value={`${donePct}%`} label="done today" tone={donePct >= 70 ? 'good' : undefined} />
        <Glance value={fmtDuration(debt)} label="debt" tone={debt > 0 ? 'bad' : 'good'} />
      </div>

      {!onVacation && <p className="text-sm text-ink2">{dailyBrief(today, subjects, topics, debts)}</p>}

      {backupStale && (
        <button
          onClick={() => setView('settings')}
          className="flex w-full items-center gap-2 rounded-2xl bg-warn/10 px-3 py-2 text-left text-xs text-ink2 active:opacity-80"
        >
          <span>💾</span>
          <span className="flex-1">
            {user?.lastBackupDate
              ? `${daysBetween(user.lastBackupDate, localToday())} days since your last backup.`
              : 'Back up your data — one browser wipe loses everything.'}
          </span>
          <span className="shrink-0 font-medium text-accent">Back up →</span>
        </button>
      )}

      {onVacation ? (
        <EmptyDay
          emoji="🏖️"
          title={`Vacation until ${user?.vacationUntil}`}
          sub="Debt frozen, reviews paused."
          action="End vacation now"
          onAction={() => void endVacation()}
        />
      ) : dayOff && today.blocks.length === 0 ? (
        <EmptyDay
          emoji="🌤️"
          title="Planned day off"
          sub="No targets today, nothing rolls into debt."
          action="Actually, build me a day"
          onAction={() => void setDayPlan(localToday(), null).then(() => flash('Schedule built ↻'))}
        />
      ) : (
        <div className="space-y-2.5">
          {today.blocks.map((b) => (
            <BlockCard key={b.id} block={b} />
          ))}
          <button
            onClick={() => setAdjust(true)}
            className="w-full rounded-2xl border border-dashed border-line py-3 text-sm font-medium text-muted active:opacity-80"
          >
            Adjust today…
          </button>
        </div>
      )}

      {adjust && (
        <AdjustSheet
          onClose={() => setAdjust(false)}
          onLowEnergy={() => void regenerate({ lowEnergy: true })}
          onRegenerate={() => void regenerate()}
          onVacation={(d) => {
            setAdjust(false)
            void startVacation(d)
          }}
          onRedoCheckin={() => {
            setAdjust(false)
            openCheckin()
          }}
        />
      )}

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-24 z-40 flex justify-center">
          <span className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-bg shadow-lg">{toast}</span>
        </div>
      )}
    </div>
  )
}

function Glance({ value, label, tone }: { value: string; label: string; tone?: 'good' | 'bad' }) {
  const color = tone === 'good' ? 'text-good' : tone === 'bad' ? 'text-bad' : ''
  return (
    <div className="rounded-2xl bg-surface px-2 py-3 text-center">
      <div className={`tabular text-lg font-bold ${color}`}>{value}</div>
      <div className="text-[10px] text-muted">{label}</div>
    </div>
  )
}

function EmptyDay({
  emoji, title, sub, action, onAction,
}: { emoji: string; title: string; sub: string; action: string; onAction: () => void }) {
  return (
    <div className="rounded-2xl bg-surface p-8 text-center">
      <div className="text-4xl">{emoji}</div>
      <p className="mt-3 font-semibold">{title}</p>
      <p className="mt-1 text-sm text-muted">{sub}</p>
      <button onClick={onAction} className="mt-5 rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-white active:opacity-90">
        {action}
      </button>
    </div>
  )
}

function AdjustSheet({
  onClose, onLowEnergy, onRegenerate, onVacation, onRedoCheckin,
}: {
  onClose: () => void
  onLowEnergy: () => void
  onRegenerate: () => void
  onVacation: (days: number) => void
  onRedoCheckin: () => void
}) {
  const [vacDays, setVacDays] = useState(3)
  const row = 'flex w-full items-center gap-3 rounded-2xl bg-raised px-4 py-3.5 text-left text-sm font-medium active:opacity-80'
  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative rounded-t-3xl bg-surface px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+1rem)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line" />
        <h2 className="mb-3 px-1 text-sm font-semibold">Adjust today</h2>
        <div className="space-y-2">
          <button onClick={onRedoCheckin} className={row}>🌅 <span className="flex-1">Redo the morning check-in</span></button>
          <button onClick={onLowEnergy} className={row}>🪫 <span className="flex-1">Switch to a low-energy day</span></button>
          <button onClick={onRegenerate} className={row}>↻ <span className="flex-1">Regenerate from scratch</span></button>
          <div className="flex items-center gap-3 rounded-2xl bg-raised px-4 py-3">
            <span>🏖️</span>
            <span className="flex-1 text-sm font-medium">Start a vacation</span>
            <input
              type="number" min={1} max={30} value={vacDays}
              onChange={(e) => setVacDays(Number(e.target.value))}
              className="tabular w-12 rounded-lg bg-bg px-2 py-1 text-center text-sm"
            />
            <button onClick={() => onVacation(vacDays)} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white">
              Go
            </button>
          </div>
        </div>
        <button onClick={onClose} className="mt-3 w-full rounded-2xl py-3 text-sm font-medium text-muted">
          Cancel
        </button>
      </div>
    </div>
  )
}

function BlockCard({ block: b }: { block: Block }) {
  const { subjects, startBlock, skipBlock, partialBlock, finishBlock } = useStore()
  const [menu, setMenu] = useState<'skip' | 'partial' | null>(null)
  const [partialMin, setPartialMin] = useState(Math.floor(b.durationMin / 2))

  const color = subjectColor(subjects, b.subjectId)
  const settled = b.status === 'done' || b.status === 'skipped' || b.status === 'partial'

  if (b.kind === 'break') {
    return (
      <div className="flex items-center gap-2 px-2 py-0.5 text-xs text-muted">
        <span className="tabular">{fmtClock(b.start)}</span>
        <span className="h-px flex-1 bg-line" />
        <span>☕ {b.durationMin}m</span>
      </div>
    )
  }

  const chip =
    b.kind === 'locked' ? '🔒 Academy' : b.kind === 'gym' ? '🏋️ Gym' : b.taskType ? TASK_LABEL[b.taskType] : ''

  return (
    <div
      className={`rounded-2xl bg-surface p-3.5 ${settled ? 'opacity-55' : ''}`}
      style={{ borderLeft: `3px solid ${b.kind === 'gym' ? 'var(--muted)' : color}` }}
    >
      <div className="flex items-center gap-2">
        <span className="tabular w-14 shrink-0 text-xs text-muted">{fmtClock(b.start)}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {b.subjectId && <span className="text-sm font-semibold">{subjectName(subjects, b.subjectId)}</span>}
            <span className="rounded-full bg-raised px-2 py-0.5 text-[10px] font-medium text-ink2">{chip}</span>
            {b.isDebtRepayment && (
              <span className="rounded-full bg-raised px-2 py-0.5 text-[10px] font-medium text-warn">debt</span>
            )}
            <span className="tabular ml-auto shrink-0 text-xs text-muted">{fmtDuration(b.durationMin)}</span>
          </div>
          <p className="mt-0.5 line-clamp-2 text-sm text-ink2">{b.label}</p>
        </div>
      </div>

      {b.kind === 'study' && !settled && (
        <div className="mt-3 flex gap-2">
          <button onClick={() => startBlock(b.id)} className="flex-1 rounded-xl bg-accent py-2.5 text-sm font-semibold text-white active:opacity-90">
            ▶ Start
          </button>
          <button onClick={() => setMenu(menu === 'skip' ? null : 'skip')} className="rounded-xl bg-raised px-4 text-sm text-ink2 active:opacity-80">
            Skip
          </button>
          <button onClick={() => setMenu(menu === 'partial' ? null : 'partial')} className="rounded-xl bg-raised px-4 text-sm text-ink2 active:opacity-80">
            Partial
          </button>
        </div>
      )}

      {menu === 'skip' && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {SKIP_REASONS.map((r) => (
            <button
              key={r}
              onClick={() => { setMenu(null); void skipBlock(b.id, r) }}
              className="rounded-full bg-raised px-3 py-1.5 text-xs text-ink2 active:opacity-80"
            >
              {r}
            </button>
          ))}
        </div>
      )}
      {menu === 'partial' && (
        <div className="mt-2 flex items-center gap-2 text-sm">
          <input
            type="number" min={1} max={b.durationMin} value={partialMin}
            onChange={(e) => setPartialMin(Number(e.target.value))}
            className="w-16 rounded-lg bg-raised px-2 py-1.5 text-center tabular"
          />
          <span className="text-muted">of {b.durationMin}m done</span>
          <button
            onClick={() => { setMenu(null); void partialBlock(b.id, partialMin) }}
            className="ml-auto rounded-xl bg-accent px-4 py-1.5 text-sm font-medium text-white"
          >
            Log
          </button>
        </div>
      )}

      {(b.kind === 'gym' || b.kind === 'locked') && !settled && (
        <div className="mt-3">
          <button onClick={() => void finishBlock(b.id)} className="rounded-xl bg-raised px-4 py-2 text-sm text-ink2 active:opacity-80">
            ✓ Mark done
          </button>
        </div>
      )}
      {b.status === 'done' && <p className="mt-1.5 text-xs text-good">✓ Done</p>}
      {b.status === 'partial' && <p className="mt-1.5 text-xs text-warn">◐ {b.actualMinutes} of {b.durationMin}m</p>}
      {b.status === 'skipped' && <p className="mt-1.5 text-xs text-bad">✗ Skipped → debt</p>}
    </div>
  )
}
