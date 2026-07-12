import { useEffect, useState } from 'react'
import { db } from '../db/schema'
import { addDays } from '../engine/dates'
import { generateDaySchedule } from '../engine/scheduleGenerator'
import { dayOfWeek, localToday, useStore } from '../store/useStore'
import type { DaySchedule } from '../types'
import { DAY_NAMES, fmtClock, subjectColor } from './util'

/** A "light" planned day — enough for the essentials, not a full load. */
const LIGHT_MINUTES = 150

export default function Week() {
  const { user, subjects, debts, topics, errors, today, dayPlans, moveBlock, setDayPlan } = useStore()
  const [days, setDays] = useState<DaySchedule[]>([])

  useEffect(() => {
    if (!user) return
    void (async () => {
      const t = localToday()
      // Rolling window from today so the days you can still plan for are always
      // in view (a fixed Mon–Sun week shows only past days late in the week).
      const out: DaySchedule[] = []
      const unresolvedErrors: Record<string, number> = {}
      for (const e of errors) {
        unresolvedErrors[e.subjectId] = (unresolvedErrors[e.subjectId] ?? 0) + 1
      }
      for (let i = 0; i < 7; i++) {
        const date = addDays(t, i)
        const stored = date === t ? today : await db.schedules.get(date)
        if (stored && date <= t) {
          out.push(stored)
        } else {
          // Future (or missing) days are previews from the pure generator,
          // honouring any planned-busy-day cap the user has set.
          const plan = dayPlans.find((p) => p.date === date)
          out.push(
            generateDaySchedule({
              date,
              dayOfWeek: dayOfWeek(date),
              user,
              subjects,
              debts: date === t ? debts : [],
              topics,
              unresolvedErrors,
              topErrorCategory: {},
              essaysThisWeek: 0,
              rewriteDoneThisWeek: false,
              papersDoneThisWeek: {},
              availableMinutes: plan?.availableMinutes,
            }),
          )
        }
      }
      setDays(out)
    })()
  }, [user, subjects, debts, topics, errors, today, dayPlans])

  const t = localToday()
  const togglePlan = (date: string, minutes: number) => {
    const cur = dayPlans.find((p) => p.date === date)
    void setDayPlan(date, cur?.availableMinutes === minutes ? null : minutes)
  }

  return (
    <div>
      <h1 className="mb-2 text-2xl font-semibold">Next 7 days</h1>
      <p className="mb-3 text-xs text-muted">
        Future days are previews — they regenerate each morning from your actual debt,
        topic confidence and spaced-review queue. Use ↑↓ on today's blocks to reorder, and
        flag a busy day ahead so it plans around you instead of becoming debt.
      </p>
      <div className="flex gap-2 overflow-x-auto pb-3">
        {days.map((d) => {
          const isToday = d.date === t
          const isFuture = d.date > t
          const plan = dayPlans.find((p) => p.date === d.date)
          return (
            <div
              key={d.date}
              className={`w-40 shrink-0 rounded-xl border bg-surface p-2 ${
                isToday ? 'border-accent' : 'border-line'
              }`}
            >
              <div className="mb-1.5 flex items-baseline justify-between px-1">
                <span className={`text-sm font-semibold ${isToday ? 'text-accent' : ''}`}>
                  {DAY_NAMES[dayOfWeek(d.date)]}
                </span>
                <span className="text-[11px] text-muted">{d.date.slice(5)}</span>
              </div>
              {d.mode === 'vacation' && <p className="px-1 text-xs text-muted">🏖️ Vacation</p>}
              <div className="space-y-1">
                {d.blocks
                  .filter((b) => b.kind !== 'break')
                  .map((b) => (
                    <div
                      key={b.id}
                      className={`rounded-md px-1.5 py-1 text-[11px] leading-tight ${
                        b.status === 'done' ? 'opacity-50' : ''
                      }`}
                      style={{
                        background: 'var(--raised)',
                        borderLeft: `3px solid ${
                          b.kind === 'gym' || b.kind === 'locked'
                            ? 'var(--muted)'
                            : subjectColor(subjects, b.subjectId)
                        }`,
                      }}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="tabular text-muted">{fmtClock(b.start)}</span>
                        <span className="tabular text-muted">{b.durationMin}m</span>
                      </div>
                      <div className="flex items-center justify-between gap-1">
                        <span className="truncate font-medium text-ink2">
                          {b.kind === 'locked' ? `🔒 ${b.label}` : b.kind === 'gym' ? '🏋️ Gym' : b.label}
                        </span>
                        {isToday && b.kind === 'study' && b.status === 'pending' && (
                          <span className="flex shrink-0 gap-0.5">
                            <button onClick={() => void moveBlock(b.id, -1)} className="text-muted">↑</button>
                            <button onClick={() => void moveBlock(b.id, 1)} className="text-muted">↓</button>
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
              </div>
              {isFuture && (
                <div className="mt-1.5 flex gap-1 border-t border-line pt-1.5">
                  <button
                    onClick={() => togglePlan(d.date, LIGHT_MINUTES)}
                    className={`flex-1 rounded-md px-1 py-1 text-[10px] font-medium ${
                      plan && plan.availableMinutes > 0
                        ? 'bg-warn text-white'
                        : 'bg-raised text-muted'
                    }`}
                  >
                    Light
                  </button>
                  <button
                    onClick={() => togglePlan(d.date, 0)}
                    className={`flex-1 rounded-md px-1 py-1 text-[10px] font-medium ${
                      plan?.availableMinutes === 0 ? 'bg-bad text-white' : 'bg-raised text-muted'
                    }`}
                  >
                    Off
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
