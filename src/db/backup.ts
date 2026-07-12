import { db } from './schema'
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

export const BACKUP_FORMAT = 'adaptive-study-scheduler-backup'
export const BACKUP_VERSION = 3

export interface BackupFile {
  format: typeof BACKUP_FORMAT
  version: number
  exportedAt: string
  data: {
    subjects: Subject[]
    schedules: DaySchedule[]
    debts: Debt[]
    topics: Topic[]
    errorLogs: ErrorLog[]
    paperLogs: PaperLog[]
    sessions: SessionLog[]
    userState: UserState[]
    dayPlans?: DayPlan[]
  }
}

const TABLE_NAMES = [
  'subjects',
  'schedules',
  'debts',
  'topics',
  'errorLogs',
  'paperLogs',
  'sessions',
  'userState',
  'dayPlans',
] as const

/** Tables that must be present for a file to count as a real backup. */
const REQUIRED_TABLES = ['subjects', 'userState'] as const

export async function exportBackup(): Promise<BackupFile> {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      subjects: await db.subjects.toArray(),
      schedules: await db.schedules.toArray(),
      debts: await db.debts.toArray(),
      topics: await db.topics.toArray(),
      errorLogs: await db.errorLogs.toArray(),
      paperLogs: await db.paperLogs.toArray(),
      sessions: await db.sessions.toArray(),
      userState: await db.userState.toArray(),
      dayPlans: await db.dayPlans.toArray(),
    },
  }
}

/** Parse and validate backup JSON. Throws an Error with a user-facing message. */
export function parseBackup(json: string): BackupFile {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new Error('That file is not valid JSON.')
  }
  const b = raw as Partial<BackupFile>
  if (b?.format !== BACKUP_FORMAT) {
    throw new Error('That file is not a study-scheduler backup.')
  }
  if (typeof b.version !== 'number' || b.version > BACKUP_VERSION) {
    throw new Error('This backup was made by a newer version of the app.')
  }
  if (!b.data || typeof b.data !== 'object') {
    throw new Error('Backup is missing its data section.')
  }
  const data = b.data as Record<string, unknown>
  // Required tables must be present and non-empty; newer optional tables
  // (added in later versions) may be absent in an older backup.
  for (const t of REQUIRED_TABLES) {
    if (!Array.isArray(data[t])) {
      throw new Error(`Backup is missing the "${t}" table.`)
    }
  }
  // Any table that IS present must be an array.
  for (const t of TABLE_NAMES) {
    if (data[t] !== undefined && !Array.isArray(data[t])) {
      throw new Error(`Backup's "${t}" table is corrupt.`)
    }
  }
  if (b.data.userState.length === 0 || b.data.subjects.length === 0) {
    throw new Error('Backup has no user profile — it looks empty.')
  }
  return b as BackupFile
}

/** Replace ALL current data with the backup's contents (single transaction). */
export async function importBackup(backup: BackupFile): Promise<void> {
  const { data } = backup
  await db.transaction(
    'rw',
    [db.subjects, db.schedules, db.debts, db.topics, db.errorLogs, db.paperLogs, db.sessions, db.userState, db.dayPlans],
    async () => {
      await Promise.all(TABLE_NAMES.map((t) => db.table(t).clear()))
      await db.subjects.bulkPut(data.subjects)
      await db.schedules.bulkPut(data.schedules)
      await db.debts.bulkPut(data.debts)
      await db.topics.bulkPut(data.topics)
      await db.errorLogs.bulkPut(data.errorLogs)
      await db.paperLogs.bulkPut(data.paperLogs)
      await db.sessions.bulkPut(data.sessions)
      await db.userState.bulkPut(data.userState)
      await db.dayPlans.bulkPut(data.dayPlans ?? [])
    },
  )
}

export function backupFilename(dateIso: string): string {
  return `study-scheduler-backup-${dateIso}.json`
}
