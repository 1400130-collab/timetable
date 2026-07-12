import type { Debt } from '../types'
import { daysBetween } from './dates'

/** Debt older than 7 days decays 50%, once. Debts under 5 min are written off. */
export function decayDebts(debts: Debt[], today: string): Debt[] {
  return debts
    .map((d) => {
      if (!d.decayed && daysBetween(d.createdDate, today) > 7) {
        return { ...d, minutesOwed: Math.round(d.minutesOwed * 0.5), decayed: true }
      }
      return d
    })
    .filter((d) => d.minutesOwed >= 5)
}

export function totalDebt(debts: Debt[]): number {
  return debts.reduce((s, d) => s + d.minutesOwed, 0)
}

/** Reset week trigger: more than 4 hours of accumulated debt. */
export const RESET_THRESHOLD_MIN = 4 * 60

/**
 * How many extra minutes today may carry, per subject.
 * Capped at 30% of the base planned load, spread so one missed day
 * lands across 3–5 future days instead of all on tomorrow.
 */
export function repaymentPlan(
  debts: Debt[],
  baseLoadMin: number,
): Record<string, number> {
  const cap = Math.floor(baseLoadMin * 0.3)
  if (cap <= 0) return {}
  const bySubject = new Map<string, number>()
  for (const d of debts) {
    bySubject.set(d.subjectId, (bySubject.get(d.subjectId) ?? 0) + d.minutesOwed)
  }
  const total = totalDebt(debts)
  if (total === 0) return {}
  // Spread across ~4 days, but never exceed the 30% daily cap.
  const todayShare = Math.min(cap, Math.max(15, Math.ceil(total / 4)))
  const plan: Record<string, number> = {}
  let remaining = todayShare
  // Largest debts first.
  const entries = [...bySubject.entries()].sort((a, b) => b[1] - a[1])
  for (const [subjectId, owed] of entries) {
    if (remaining < 10) break
    const chunk = Math.min(owed, remaining, 50)
    if (chunk >= 10) {
      plan[subjectId] = chunk
      remaining -= chunk
    }
  }
  return plan
}

/** Reduce debts FIFO for a subject after repayment minutes are completed. */
export function applyRepayment(debts: Debt[], subjectId: string, minutes: number): Debt[] {
  let left = minutes
  return debts
    .map((d) => {
      if (d.subjectId !== subjectId || left <= 0) return d
      const paid = Math.min(d.minutesOwed, left)
      left -= paid
      return { ...d, minutesOwed: d.minutesOwed - paid }
    })
    .filter((d) => d.minutesOwed >= 5)
}
