import type { Subject, TaskType } from '../types'

export function fmtClock(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24
  const m = minutes % 60
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

export function fmtDuration(min: number): string {
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

export const TASK_LABEL: Record<TaskType, string> = {
  RECALL: 'Recall',
  PRACTICE_PROBLEMS: 'Problems',
  PAST_PAPER: 'Past paper',
  REPAIR: 'Repair',
  EXPLAIN: 'Explain',
  NEW_MATERIAL: 'New',
  REVIEW: 'Flashcards',
  WRITE: 'Write',
  READ: 'Read',
}

export function subjectColor(subjects: Subject[], id: string | null): string {
  return subjects.find((s) => s.id === id)?.color ?? 'var(--muted)'
}

export function subjectName(subjects: Subject[], id: string | null): string {
  return subjects.find((s) => s.id === id)?.name ?? ''
}

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
