import type { Topic } from '../types'
import { addDays, daysBetween } from './dates'

/** Expanding review intervals for topics: 1d → 3d → 1w → 3w → 6w. */
export const TOPIC_INTERVALS = [1, 3, 7, 21, 42]
export const MAX_TOPIC_STAGE = TOPIC_INTERVALS.length - 1

export type Rag = 'red' | 'amber' | 'green'

/** RAG rating from the 1–5 confidence self-rating. */
export function rag(confidence: number): Rag {
  if (confidence <= 2) return 'red'
  if (confidence === 3) return 'amber'
  return 'green'
}

/**
 * Priority for choosing what a study block should target.
 * Weak (red) topics dominate — (6 − confidence)² makes a 1-confidence topic
 * ~16× a 4-confidence one — scaled up by staleness so nothing rots,
 * and by unresolved errors, because errors are where marks live.
 */
export function topicScore(t: Topic, today: string, errorCount = 0): number {
  const staleDays = t.lastTouched ? Math.max(0, daysBetween(t.lastTouched, today)) : 10
  return (6 - t.confidence) ** 2 * (1 + staleDays / 7) * (1 + errorCount * 0.5)
}

/** Topics whose spaced review has come due (never-studied topics are not "due"). */
export function dueReviews(topics: Topic[], today: string): Topic[] {
  return topics
    .filter((t) => t.nextReview != null && t.nextReview <= today)
    .sort((a, b) => (a.nextReview! < b.nextReview! ? -1 : 1))
}

/** Highest-priority topics to attack for a subject (excludes ones already due for review). */
export function focusTopics(
  topics: Topic[],
  subjectId: string,
  today: string,
  errorsByTopic: Record<number, number> = {},
): Topic[] {
  return topics
    .filter((t) => t.subjectId === subjectId && !(t.nextReview != null && t.nextReview <= today))
    .sort(
      (a, b) =>
        topicScore(b, today, errorsByTopic[b.id ?? -1] ?? 0) -
        topicScore(a, today, errorsByTopic[a.id ?? -1] ?? 0),
    )
}

/**
 * Record a study touch: advance the spacing stage and schedule the next review.
 * A weak confidence (≤2) holds the stage down so shaky topics come back sooner.
 */
export function touchTopic(t: Topic, today: string, newConfidence?: number): Topic {
  const confidence = newConfidence ?? t.confidence
  const stage = confidence <= 2 ? 0 : Math.min(t.reviewStage + 1, MAX_TOPIC_STAGE)
  return {
    ...t,
    confidence,
    lastTouched: today,
    timesStudied: t.timesStudied + 1,
    reviewStage: stage,
    nextReview: addDays(today, TOPIC_INTERVALS[stage]),
  }
}
