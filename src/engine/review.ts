import type { DaySchedule, ErrorCategory, ErrorLog, PaperLog, SessionLog, TaskType, Topic } from '../types'
import { ACTIVE_TYPES } from '../types'
import { daysBetween } from './dates'
import { rag, topicScore } from './topics'

export interface SkippedHardBlock {
  subjectId: string
  taskType: TaskType
  label: string
  durationMin: number
}

export interface WeeklyReview {
  totalMinutes: number
  /** Minutes of active-recall work the plan assigned this week (recall, problems,
   * past papers, repair, Feynman, flashcards). */
  plannedHardMin: number
  /** How many of those you actually completed (partials count pro-rata). */
  doneHardMin: number
  /** doneHardMin / plannedHardMin, 0..1 — null when nothing hard was scheduled. */
  hardFollowThrough: number | null
  /** The active blocks you skipped — the actionable "don't dodge these" list. */
  skippedHard: SkippedHardBlock[]
  minutesBySubject: Record<string, number>
  avgCompletion: number // 0..1
  daysStudied: number
  rag: { red: number; amber: number; green: number }
  focusNextWeek: Topic[] // weakest topics to attack
  reviewsDueNextWeek: number
  openErrorCount: number
  topErrorCategory: ErrorCategory | null
  calibrationGap: number | null // avg |predicted - actual| in percentage points
  papersThisWeek: number
}

export interface ReviewInput {
  today: string
  weekStart: string
  sessions: SessionLog[]
  schedules: DaySchedule[]
  topics: Topic[]
  openErrors: ErrorLog[]
  papers: PaperLog[]
}

/** Pure roll-up of the trailing week — the data for the Sunday reflection loop. */
export function buildWeeklyReview(input: ReviewInput): WeeklyReview {
  const { today, weekStart, sessions, schedules, topics, openErrors, papers } = input

  const weekSessions = sessions.filter((s) => s.date >= weekStart)
  let totalMinutes = 0
  const minutesBySubject: Record<string, number> = {}
  for (const s of weekSessions) {
    totalMinutes += s.minutes
    minutesBySubject[s.subjectId] = (minutesBySubject[s.subjectId] ?? 0) + s.minutes
  }

  const weekScheds = schedules.filter(
    (d) => d.date >= weekStart && d.mode !== 'vacation' && d.plannedMinutes > 0,
  )
  const avgCompletion =
    weekScheds.length > 0
      ? weekScheds.reduce((s, d) => s + d.completionRate, 0) / weekScheds.length
      : 0
  const daysStudied = new Set(weekSessions.map((s) => s.date)).size

  // Follow-through on the hard blocks: of the active-recall work the plan
  // assigned, how much did you actually do? This is the lever the user controls
  // — the scheduler picks the task types, but you choose which blocks to finish.
  // Today's not-yet-reached blocks are excluded so an unfinished day doesn't
  // tank the number; past days count in full (a pending past block became debt).
  let plannedHardMin = 0
  let doneHardMin = 0
  const skippedHard: SkippedHardBlock[] = []
  for (const d of weekScheds) {
    const isPast = d.date < today
    for (const b of d.blocks) {
      if (b.kind !== 'study' || !b.taskType || !ACTIVE_TYPES.includes(b.taskType)) continue
      const reached = b.status === 'done' || b.status === 'partial' || b.status === 'skipped'
      if (!reached && !isPast) continue // today's work you haven't gotten to yet
      plannedHardMin += b.durationMin
      if (b.status === 'done') doneHardMin += b.durationMin
      else if (b.status === 'partial') doneHardMin += Math.min(b.actualMinutes, b.durationMin)
      else {
        // Skipped, or a past day left undone (rolled into debt) — a missed mark-mover.
        skippedHard.push({
          subjectId: b.subjectId ?? '',
          taskType: b.taskType,
          label: b.label,
          durationMin: b.durationMin,
        })
      }
    }
  }
  const hardFollowThrough = plannedHardMin > 0 ? doneHardMin / plannedHardMin : null

  const rag = { red: 0, amber: 0, green: 0 }
  for (const t of topics) rag[rag_(t.confidence)]++

  const focusNextWeek = [...topics]
    .filter((t) => t.confidence <= 3)
    .sort((a, b) => topicScore(b, today) - topicScore(a, today))
    .slice(0, 5)

  const reviewsDueNextWeek = topics.filter(
    (t) => t.nextReview != null && daysBetween(today, t.nextReview) >= 0 && daysBetween(today, t.nextReview) <= 7,
  ).length

  const catCount: Partial<Record<ErrorCategory, number>> = {}
  for (const e of openErrors) catCount[e.category] = (catCount[e.category] ?? 0) + 1
  const topErrorCategory =
    (Object.entries(catCount).sort((a, b) => b[1]! - a[1]!)[0]?.[0] as ErrorCategory | undefined) ??
    null

  const weekPapers = papers.filter((p) => p.date >= weekStart)
  const calibrationGap =
    weekPapers.length > 0
      ? Math.round(
          weekPapers.reduce(
            (s, p) => s + Math.abs((p.predicted / p.maxScore - p.actual / p.maxScore) * 100),
            0,
          ) / weekPapers.length,
        )
      : null

  return {
    totalMinutes,
    plannedHardMin,
    doneHardMin,
    hardFollowThrough,
    skippedHard,
    minutesBySubject,
    avgCompletion,
    daysStudied,
    rag,
    focusNextWeek,
    reviewsDueNextWeek,
    openErrorCount: openErrors.length,
    topErrorCategory,
    calibrationGap,
    papersThisWeek: weekPapers.length,
  }
}

// Local alias to avoid shadowing the `rag` result object above.
function rag_(confidence: number) {
  return rag(confidence)
}
