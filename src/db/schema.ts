import Dexie, { type Table } from 'dexie'
import type {
  DayPlan,
  DaySchedule,
  Debt,
  ErrorLog,
  PaperLog,
  SessionLog,
  Subject,
  Topic,
  UserState,
} from '../types'

export class StudyDB extends Dexie {
  subjects!: Table<Subject, string>
  schedules!: Table<DaySchedule, string>
  debts!: Table<Debt, number>
  topics!: Table<Topic, number>
  errorLogs!: Table<ErrorLog, number>
  paperLogs!: Table<PaperLog, number>
  sessions!: Table<SessionLog, number>
  userState!: Table<UserState, string>
  dayPlans!: Table<DayPlan, string>

  constructor() {
    super('adaptive-study-scheduler')
    this.version(1).stores({
      subjects: 'id',
      schedules: 'date',
      debts: '++id, subjectId, createdDate',
      srsItems: '++id, subjectId, due',
      srsLogs: '++id, date, itemId',
      sessions: '++id, date, subjectId',
      userState: 'id',
    })
    // v2: topic/unit tracking, error log, paper calibration; card-level SRS
    // moved out of the app (flashcards happen in Anki — the schedule just
    // reserves the block).
    this.version(2).stores({
      topics: '++id, subjectId, nextReview',
      errorLogs: '++id, subjectId, date',
      paperLogs: '++id, subjectId, date',
      srsItems: null,
      srsLogs: null,
    })
    // v3: planned busy days — pre-committed capacity per date so foreseeable
    // absences shape the schedule instead of becoming debt after the fact.
    this.version(3).stores({
      dayPlans: 'date',
    })
  }
}

export const db = new StudyDB()

export const DEFAULT_SUBJECTS: Subject[] = [
  { id: 'math',    name: 'Math',    priorityWeight: 0.30, difficultyMultiplier: 1.0, targetMinutesDay: 70, color: 'var(--c-math)',    lastTouched: null },
  { id: 'physics', name: 'Physics', priorityWeight: 0.25, difficultyMultiplier: 1.0, targetMinutesDay: 60, color: 'var(--c-physics)', lastTouched: null },
  { id: 'spanish', name: 'Spanish', priorityWeight: 0.25, difficultyMultiplier: 1.2, targetMinutesDay: 25, color: 'var(--c-spanish)', lastTouched: null },
  { id: 'english', name: 'English', priorityWeight: 0.20, difficultyMultiplier: 1.0, targetMinutesDay: 30, color: 'var(--c-english)', lastTouched: null },
]

export const DEFAULT_USER: UserState = {
  id: 'me',
  wakeMinutes: 8 * 60,
  sleepMinutes: 23 * 60,
  gymDays: [1, 2, 4, 6], // Mon Tue Thu Sat
  restDay: 0, // Sunday
  energyProfile: 'morning',
  currentBook: '',
  streak: 0,
  lastFinalizedDate: null,
  vacationUntil: null,
  blockLengthMin: 50,
  breakLengthMin: 10,
  onboarded: false,
  lastCheckinDate: null,
  lastBackupDate: null,
}
