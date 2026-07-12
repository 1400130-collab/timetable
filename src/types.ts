// Shared domain types for the Adaptive Study Scheduler.

export type TaskType =
  | 'RECALL'            // blank-page retrieval — write everything from memory
  | 'PRACTICE_PROBLEMS' // mixed, interleaved problem sets
  | 'PAST_PAPER'        // timed exam questions, no notes
  | 'REPAIR'            // mark against scheme, attack the error log
  | 'EXPLAIN'           // Feynman: explain aloud to an imaginary novice
  | 'NEW_MATERIAL'
  | 'REVIEW'            // flashcard run (Anki-style, done outside the app)
  | 'WRITE'
  | 'READ'

/** Active reconstruction counts toward the retrieval ratio; passive input does not. */
export const ACTIVE_TYPES: TaskType[] = [
  'RECALL', 'PRACTICE_PROBLEMS', 'PAST_PAPER', 'REPAIR', 'EXPLAIN', 'REVIEW',
]

export type BlockKind = 'study' | 'locked' | 'gym' | 'break'
export type BlockStatus = 'pending' | 'active' | 'done' | 'partial' | 'skipped'
export type DayMode = 'normal' | 'low_energy' | 'vacation' | 'reset' | 'rest' | 'off'

export interface Subject {
  id: string
  name: string
  /** Share of study time, 0..1. All subjects sum to 1. */
  priorityWeight: number
  /** 1.0 = average. Raised by low self-rating during onboarding. */
  difficultyMultiplier: number
  targetMinutesDay: number
  color: string
  lastTouched: string | null // ISO date of last completed block
}

/**
 * A syllabus point the user is tracking. Confidence is a RAG-style
 * self-rating (1–2 red, 3 amber, 4–5 green); the scheduler attacks red first
 * and spaces reviews at expanding intervals after each touch.
 */
export interface Topic {
  id?: number
  subjectId: string
  unit: string
  name: string
  confidence: number // 1..5
  lastTouched: string | null
  /** Next spaced review date; null until first studied. */
  nextReview: string | null
  /** Index into TOPIC_INTERVALS (1d → 3d → 7d → 21d → 42d). */
  reviewStage: number
  timesStudied: number
  createdDate: string
}

export type ErrorCategory = 'knowledge' | 'misread' | 'careless' | 'structure' | 'time'

/** One mistake from marking work against a scheme. Patterns emerge fast. */
export interface ErrorLog {
  id?: number
  date: string
  subjectId: string
  topicId: number | null
  category: ErrorCategory
  note: string
  resolved: boolean
}

/** Calibration record: predicted vs actual on a marked past paper. */
export interface PaperLog {
  id?: number
  date: string
  subjectId: string
  predicted: number
  actual: number
  maxScore: number
}

export interface Block {
  id: string
  kind: BlockKind
  subjectId: string | null
  taskType: TaskType | null
  /** Minutes from midnight. */
  start: number
  durationMin: number
  status: BlockStatus
  actualMinutes: number
  label: string
  /** True when this block exists to repay debt rather than meet the daily target. */
  isDebtRepayment: boolean
  /** Syllabus topic this block targets, when the picker found one. */
  topicId: number | null
  /** True when this block is a spaced review of a previously studied topic. */
  isSpacedReview?: boolean
}

export interface DaySchedule {
  date: string // yyyy-mm-dd
  mode: DayMode
  blocks: Block[]
  completionRate: number
  /** Planned study minutes (excludes locked/gym/breaks). */
  plannedMinutes: number
}

export interface Debt {
  id?: number
  subjectId: string
  minutesOwed: number
  createdDate: string
  reason: string
  /** 50% decay applied once when the debt passes 7 days old. */
  decayed: boolean
}

export interface SessionLog {
  id?: number
  date: string
  subjectId: string
  taskType: TaskType
  minutes: number
  topicId: number | null
}

export interface UserState {
  id: 'me'
  wakeMinutes: number // minutes from midnight
  sleepMinutes: number
  gymDays: number[] // 0=Sun..6=Sat
  restDay: number
  energyProfile: 'morning' | 'evening'
  currentBook: string
  streak: number
  lastFinalizedDate: string | null
  vacationUntil: string | null // yyyy-mm-dd inclusive
  blockLengthMin: number
  breakLengthMin: number
  onboarded: boolean
  /** Date the daily check-in was last answered, so it prompts once per day. */
  lastCheckinDate: string | null
  /** Date of the last data backup, for the >7-day nag. */
  lastBackupDate: string | null
}

/**
 * A pre-committed capacity for a specific date — "out Thursday afternoon".
 * The generator plans around it instead of the day rolling into debt.
 * availableMinutes 0 = fully out.
 */
export interface DayPlan {
  date: string // yyyy-mm-dd
  availableMinutes: number
  note?: string
}

export interface FixedEvent {
  day: number // 0=Sun..6=Sat
  start: number
  durationMin: number
  label: string
  subjectId: string | null
}

/** Everything the pure schedule generator needs. */
export interface GeneratorInput {
  date: string
  dayOfWeek: number // 0=Sun..6=Sat
  user: UserState
  subjects: Subject[]
  debts: Debt[]
  topics: Topic[]
  /** Unresolved error counts per subject id. */
  unresolvedErrors: Record<string, number>
  /** Top unresolved error category per subject id, for repair-block labels. */
  topErrorCategory: Record<string, ErrorCategory | undefined>
  /** Essays written in the current week (Mon-based), for the 2×/week rule. */
  essaysThisWeek: number
  rewriteDoneThisWeek: boolean
  /** Subjects that already did their timed past paper this week. */
  papersDoneThisWeek: Record<string, boolean>
  lowEnergy?: boolean
  /** Cap on study minutes for the day. undefined = no cap; 0 = day off. */
  availableMinutes?: number
}
