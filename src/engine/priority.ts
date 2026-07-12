import type { Debt, Subject } from '../types'
import { totalDebt } from './debt'
import { daysBetween } from './dates'

/**
 * Nightly priority recalculation:
 * score = base_weight × difficulty × days_since_last_touch × (1 + debt_ratio)
 * (urgency(due_date) folds in for dated tasks; daily targets have none.)
 */
export function subjectScore(
  subject: Subject,
  debts: Debt[],
  today: string,
): number {
  const daysSince = subject.lastTouched
    ? Math.max(1, daysBetween(subject.lastTouched, today))
    : 3 // never touched → treat as moderately stale
  const subjectDebt = debts
    .filter((d) => d.subjectId === subject.id)
    .reduce((s, d) => s + d.minutesOwed, 0)
  const all = totalDebt(debts)
  const debtRatio = all > 0 ? subjectDebt / all : 0
  return (
    subject.priorityWeight *
    subject.difficultyMultiplier *
    daysSince *
    (1 + debtRatio)
  )
}

export function rankSubjects(subjects: Subject[], debts: Debt[], today: string): Subject[] {
  return [...subjects].sort(
    (a, b) => subjectScore(b, debts, today) - subjectScore(a, debts, today),
  )
}
