import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, DEFAULT_SUBJECTS, DEFAULT_USER } from './schema'
import { BACKUP_FORMAT, BACKUP_VERSION, exportBackup, importBackup, parseBackup } from './backup'
import { localToday, useStore } from '../store/useStore'

async function seed() {
  await db.delete()
  await db.open()
  await db.userState.put({ ...DEFAULT_USER, onboarded: true, streak: 4, currentBook: 'Spivak' })
  await db.subjects.bulkPut(DEFAULT_SUBJECTS)
  await db.topics.add({
    subjectId: 'math', unit: 'Analysis', name: 'Epsilon-delta limits',
    confidence: 2, lastTouched: null, nextReview: null, reviewStage: 0,
    timesStudied: 0, createdDate: localToday(),
  })
  await db.debts.add({
    subjectId: 'spanish', minutesOwed: 25, createdDate: localToday(),
    reason: 'skipped', decayed: false,
  })
  await db.errorLogs.add({
    date: localToday(), subjectId: 'math', topicId: null,
    category: 'careless', note: 'sign error', resolved: false,
  })
  await db.paperLogs.add({
    date: localToday(), subjectId: 'physics', predicted: 70, actual: 62, maxScore: 100,
  })
  await db.sessions.add({
    date: localToday(), subjectId: 'math', taskType: 'PRACTICE_PROBLEMS', minutes: 50, topicId: 1,
  })
}

describe('backup export/import (fake IndexedDB)', () => {
  beforeEach(seed, 20000)

  it('round-trips every table through export → wipe → import', async () => {
    const backup = await exportBackup()
    expect(backup.format).toBe(BACKUP_FORMAT)
    expect(backup.version).toBe(BACKUP_VERSION)

    // Survive JSON serialization like a real file would.
    const parsed = parseBackup(JSON.stringify(backup))

    await Promise.all(db.tables.map((t) => t.clear()))
    expect(await db.topics.count()).toBe(0)

    await importBackup(parsed)
    expect(await db.userState.get('me')).toMatchObject({ streak: 4, currentBook: 'Spivak' })
    expect(await db.subjects.count()).toBe(4)
    expect((await db.topics.toArray())[0]).toMatchObject({ id: 1, name: 'Epsilon-delta limits' })
    expect((await db.debts.toArray())[0]).toMatchObject({ subjectId: 'spanish', minutesOwed: 25 })
    expect(await db.errorLogs.count()).toBe(1)
    expect(await db.paperLogs.count()).toBe(1)
    expect((await db.sessions.toArray())[0]).toMatchObject({ taskType: 'PRACTICE_PROBLEMS', topicId: 1 })
  })

  it('import replaces existing data instead of merging', async () => {
    const backup = await exportBackup()
    await db.topics.add({
      subjectId: 'physics', unit: 'Mechanics', name: 'Momentum',
      confidence: 3, lastTouched: null, nextReview: null, reviewStage: 0,
      timesStudied: 0, createdDate: localToday(),
    })
    expect(await db.topics.count()).toBe(2)
    await importBackup(backup)
    expect(await db.topics.count()).toBe(1)
  })

  it('store.restoreBackup restores data and reloads app state', async () => {
    const json = JSON.stringify(await exportBackup())
    await Promise.all(db.tables.map((t) => t.clear()))
    useStore.setState({
      ready: false, user: null, subjects: [], today: null, debts: [], topics: [], errors: [],
      activeBlockId: null, view: 'settings',
    })
    await useStore.getState().restoreBackup(json)
    const s = useStore.getState()
    expect(s.ready).toBe(true)
    expect(s.user?.streak).toBe(4)
    expect(s.topics).toHaveLength(1)
    expect(s.debts[0]?.minutesOwed).toBe(25)
    // init() regenerates today's schedule from the restored data
    expect(s.today?.date).toBe(localToday())
  })

  it('parseBackup rejects garbage with friendly messages', () => {
    expect(() => parseBackup('not json')).toThrow('not valid JSON')
    expect(() => parseBackup('{"format":"other"}')).toThrow('not a study-scheduler backup')
    expect(() =>
      parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION + 1, data: {} })),
    ).toThrow('newer version')
    expect(() =>
      parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 2, data: { subjects: [] } })),
    ).toThrow('missing')
  })
})
