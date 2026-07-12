import { useEffect, useState, type ReactNode } from 'react'
import { db } from '../db/schema'
import { addDays } from '../engine/dates'
import { buildWeeklyReview, type SkippedHardBlock, type WeeklyReview } from '../engine/review'
import { rag } from '../engine/topics'
import { dayOfWeek, localToday, useStore } from '../store/useStore'
import type { TaskType } from '../types'
import { fmtDuration, subjectColor, subjectName, TASK_LABEL } from './util'

interface HeatCell { date: string; minutes: number }

const HEAT_OPACITY = [0, 0.28, 0.52, 0.76, 1]
function heatStyle(min: number): { background: string; opacity?: number } {
  const lvl = min <= 0 ? 0 : min <= 30 ? 1 : min <= 60 ? 2 : min <= 120 ? 3 : 4
  return lvl === 0 ? { background: 'var(--raised)' } : { background: 'var(--accent)', opacity: HEAT_OPACITY[lvl] }
}

function summarizeSkipped(items: SkippedHardBlock[]) {
  const map = new Map<string, { subjectId: string; taskType: TaskType; count: number; minutes: number }>()
  for (const it of items) {
    const key = `${it.subjectId}|${it.taskType}`
    const cur = map.get(key) ?? { subjectId: it.subjectId, taskType: it.taskType, count: 0, minutes: 0 }
    cur.count++
    cur.minutes += it.durationMin
    map.set(key, cur)
  }
  return [...map.values()].sort((a, b) => b.minutes - a.minutes)
}

function weekStartOf(iso: string): string {
  const dow = dayOfWeek(iso)
  return addDays(iso, dow === 0 ? -6 : 1 - dow)
}

export default function Insights() {
  const { subjects, topics, setView } = useStore()
  const [review, setReview] = useState<WeeklyReview | null>(null)
  const [heat, setHeat] = useState<HeatCell[]>([])

  useEffect(() => {
    void (async () => {
      const today = localToday()
      const ws = weekStartOf(today)
      const [sessions, schedules, errorLogs, papers] = await Promise.all([
        db.sessions.where('date').aboveOrEqual(addDays(today, -97)).toArray(),
        db.schedules.where('date').aboveOrEqual(ws).toArray(),
        db.errorLogs.toArray(),
        db.paperLogs.toArray(),
      ])
      setReview(
        buildWeeklyReview({
          today, weekStart: ws,
          sessions: sessions.filter((s) => s.date >= ws),
          schedules, topics: await db.topics.toArray(),
          openErrors: errorLogs.filter((e) => !e.resolved), papers,
        }),
      )
      // Heatmap: ~13 weeks aligned to Sunday columns.
      const alignedStart = addDays(addDays(today, -90), -dayOfWeek(addDays(today, -90)))
      const perDay = new Map<string, number>()
      for (const s of sessions) if (s.date >= alignedStart) perDay.set(s.date, (perDay.get(s.date) ?? 0) + s.minutes)
      const cells: HeatCell[] = []
      for (let d = alignedStart; d <= today; d = addDays(d, 1)) cells.push({ date: d, minutes: perDay.get(d) ?? 0 })
      setHeat(cells)
    })()
  }, [topics])

  if (!review) return null

  const followPct = review.hardFollowThrough != null ? Math.round(review.hardFollowThrough * 100) : null
  const heatWeeks: HeatCell[][] = []
  for (let i = 0; i < heat.length; i += 7) heatWeeks.push(heat.slice(i, i + 7))
  const heatTotal = heat.reduce((s, c) => s + c.minutes, 0)
  const heatDays = heat.filter((c) => c.minutes > 0).length

  const ragCounts = { red: 0, amber: 0, green: 0 }
  for (const t of topics) ragCounts[rag(t.confidence)]++

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Insights</h1>

      {/* This week */}
      <p className="-mb-1 px-1 text-xs font-medium uppercase tracking-wide text-muted">This week</p>
      <div className="grid grid-cols-2 gap-2">
        <Tile value={fmtDuration(review.totalMinutes)} label="studied" />
        <Tile value={`${review.daysStudied}/6`} label="active days" />
        <Tile value={followPct != null ? `${followPct}%` : '—'} label="hard blocks done"
          tone={followPct == null ? undefined : followPct >= 80 ? 'good' : followPct >= 50 ? 'warn' : 'bad'} />
        <Tile value={review.calibrationGap != null ? `±${review.calibrationGap}%` : '—'} label="calibration gap" />
      </div>

      {/* Follow-through — the honest weekly lever */}
      <Card>
        <h2 className="text-sm font-semibold">Did you do the hard blocks?</h2>
        <p className="mt-0.5 text-xs text-muted">
          Recall, problems, past papers, repair — the mark-movers the plan set this week. The scheduler
          picks the work; finishing it is the part that's yours.
        </p>
        {review.hardFollowThrough == null ? (
          <p className="mt-2 text-xs text-muted">No hard blocks have come due yet this week.</p>
        ) : (
          <>
            <div className="mt-2.5 flex h-6 overflow-hidden rounded-full bg-raised">
              <div
                className="flex items-center justify-center text-[11px] font-semibold text-white"
                style={{
                  width: `${Math.max(followPct!, 10)}%`,
                  background: followPct! >= 80 ? 'var(--good)' : followPct! >= 50 ? 'var(--warn)' : 'var(--bad)',
                }}
              >
                {followPct}%
              </div>
            </div>
            <p className="mt-1.5 text-[11px] text-muted">
              {fmtDuration(review.doneHardMin)} of {fmtDuration(review.plannedHardMin)} done this week
            </p>
            {review.skippedHard.length === 0 ? (
              <p className="mt-2 text-xs text-good">Every hard block done — that's the whole game. 💪</p>
            ) : (
              <div className="mt-2.5 space-y-1.5">
                <p className="text-xs text-warn">Missed mark-movers — the ones not to dodge:</p>
                {summarizeSkipped(review.skippedHard).map((row) => (
                  <div key={`${row.subjectId}-${row.taskType}`} className="flex items-center gap-2 rounded-xl bg-raised px-3 py-2 text-sm">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: subjectColor(subjects, row.subjectId) }} />
                    <span className="font-medium">{subjectName(subjects, row.subjectId)}</span>
                    <span className="text-muted">{TASK_LABEL[row.taskType]}{row.count > 1 ? ` ×${row.count}` : ''}</span>
                    <span className="ml-auto shrink-0 text-[11px] text-muted">{fmtDuration(row.minutes)}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </Card>

      {/* Where the hours went */}
      {review.totalMinutes > 0 && (
        <Card>
          <h2 className="mb-2.5 text-sm font-semibold">Where the hours went</h2>
          <div className="space-y-2">
            {subjects.map((s) => {
              const m = review.minutesBySubject[s.id] ?? 0
              const pct = Math.round((m / review.totalMinutes) * 100)
              return (
                <div key={s.id} className="flex items-center gap-2">
                  <span className="w-14 shrink-0 text-xs font-medium">{s.name}</span>
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-raised">
                    <div style={{ width: `${pct}%`, background: s.color }} className="h-full" />
                  </div>
                  <span className="tabular w-12 shrink-0 text-right text-[11px] text-muted">{fmtDuration(m)}</span>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {/* Consistency heatmap */}
      <p className="-mb-1 px-1 pt-1 text-xs font-medium uppercase tracking-wide text-muted">Consistency</p>
      <Card>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Last 13 weeks</h2>
          <span className="text-xs text-muted">{fmtDuration(heatTotal)} · {heatDays} day{heatDays === 1 ? '' : 's'}</span>
        </div>
        <div className="flex gap-1 overflow-x-auto pb-1">
          {heatWeeks.map((wk, i) => (
            <div key={i} className="flex flex-col gap-1">
              {wk.map((c) => (
                <div key={c.date} title={`${c.date} · ${c.minutes} min`} className="h-3 w-3 shrink-0 rounded-[3px]" style={heatStyle(c.minutes)} />
              ))}
            </div>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-1 text-[10px] text-muted">
          Less
          {[0, 20, 45, 90, 150].map((m) => <span key={m} className="h-3 w-3 rounded-[3px]" style={heatStyle(m)} />)}
          More
        </div>
      </Card>

      {/* Attack list */}
      <p className="-mb-1 px-1 pt-1 text-xs font-medium uppercase tracking-wide text-muted">Aim next</p>
      <Card>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Attack list</h2>
          <button onClick={() => setView('subjects')} className="text-xs font-medium text-accent">Edit topics →</button>
        </div>
        <p className="mt-0.5 text-xs text-muted">Your weakest, stalest topics. Front-load these when you're fresh.</p>
        {review.focusNextWeek.length === 0 ? (
          <p className="mt-2 text-xs text-muted">No red/amber topics logged. Add your syllabus in Subjects.</p>
        ) : (
          <div className="mt-2 space-y-1.5">
            {review.focusNextWeek.map((t) => (
              <div key={t.id} className="flex items-center gap-2 rounded-xl bg-raised px-3 py-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: t.confidence <= 2 ? 'var(--bad)' : 'var(--warn)' }} />
                <span className="truncate text-sm">{t.name}</span>
                <span className="ml-auto shrink-0 text-[11px]" style={{ color: subjectColor(subjects, t.subjectId) }}>
                  {subjectName(subjects, t.subjectId)}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Calibration + errors */}
      <div className="grid grid-cols-2 gap-2">
        <Card>
          <h2 className="text-sm font-semibold">Calibration</h2>
          {review.calibrationGap == null ? (
            <p className="mt-1 text-xs text-muted">Predict a score, mark it, close the gap.</p>
          ) : (
            <>
              <p className="mt-1 text-2xl font-bold tabular" style={{ color: review.calibrationGap <= 10 ? 'var(--good)' : 'var(--warn)' }}>
                ±{review.calibrationGap}%
              </p>
              <p className="text-[11px] text-muted">over {review.papersThisWeek} paper{review.papersThisWeek === 1 ? '' : 's'}</p>
            </>
          )}
        </Card>
        <Card>
          <h2 className="text-sm font-semibold">Open errors</h2>
          {review.openErrorCount === 0 ? (
            <p className="mt-1 text-xs text-muted">Mark your work, log what you drop.</p>
          ) : (
            <>
              <p className="mt-1 text-2xl font-bold tabular">{review.openErrorCount}</p>
              <p className="text-[11px] text-muted">mostly <span className="font-medium text-warn">{review.topErrorCategory}</span></p>
            </>
          )}
        </Card>
      </div>

      {/* Syllabus confidence */}
      {topics.length > 0 && (
        <Card>
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">Syllabus confidence</h2>
            <span className="text-[11px] text-muted">{ragCounts.red}R · {ragCounts.amber}A · {ragCounts.green}G</span>
          </div>
          <div className="space-y-2">
            {subjects.map((s) => {
              const mine = topics.filter((t) => t.subjectId === s.id)
              if (mine.length === 0) return null
              const c = { red: 0, amber: 0, green: 0 }
              for (const t of mine) c[rag(t.confidence)]++
              return (
                <div key={s.id} className="flex items-center gap-2">
                  <span className="w-14 shrink-0 text-xs font-medium">{s.name}</span>
                  <div className="flex h-3 flex-1 overflow-hidden rounded-full bg-raised">
                    {c.red > 0 && <div style={{ width: `${(c.red / mine.length) * 100}%`, background: 'var(--bad)' }} />}
                    {c.amber > 0 && <div style={{ width: `${(c.amber / mine.length) * 100}%`, background: 'var(--warn)' }} />}
                    {c.green > 0 && <div style={{ width: `${(c.green / mine.length) * 100}%`, background: 'var(--good)' }} />}
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      )}
    </div>
  )
}

function Card({ children }: { children: ReactNode }) {
  return <section className="rounded-2xl bg-surface p-4">{children}</section>
}

function Tile({ value, label, tone }: { value: string; label: string; tone?: 'good' | 'warn' | 'bad' }) {
  const color = tone === 'good' ? 'text-good' : tone === 'bad' ? 'text-bad' : tone === 'warn' ? 'text-warn' : ''
  return (
    <div className="rounded-2xl bg-surface p-3 text-center">
      <div className={`tabular text-xl font-bold ${color}`}>{value}</div>
      <div className="text-[10px] text-muted">{label}</div>
    </div>
  )
}
