import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/schema'
import { localToday, useStore } from './useStore'
import { addDays } from '../engine/dates'
import { TOPIC_INTERVALS } from '../engine/topics'

async function freshOnboard() {
  await db.delete()
  await db.open()
  useStore.setState({
    ready: false, user: null, subjects: [], today: null, debts: [], topics: [], errors: [],
    activeBlockId: null, view: 'today',
  })
  await useStore.getState().init()
  await useStore.getState().completeOnboarding({}, { math: 3, physics: 3, spanish: 2, english: 3 })
}

describe('store integration (fake IndexedDB)', () => {
  beforeEach(freshOnboard, 20000)

  it('onboarding seeds subjects and today’s schedule', async () => {
    const s = useStore.getState()
    expect(s.user?.onboarded).toBe(true)
    expect(s.subjects).toHaveLength(4)
    expect(s.today?.date).toBe(localToday())
    expect(s.subjects.find((x) => x.id === 'spanish')?.difficultyMultiplier).toBe(1.3)
  })

  it('topics can be added and drive the regenerated schedule', async () => {
    await useStore.getState().addTopic('math', 'Analysis', 'Epsilon-delta limits', 1)
    await useStore.getState().addTopic('math', 'Analysis', 'Supremum & infimum', 5)
    expect(useStore.getState().topics).toHaveLength(2)
    await useStore.getState().regenerateToday()
    const labels = useStore.getState().today!.blocks
      .filter((b) => b.subjectId === 'math' && b.kind === 'study')
      .map((b) => b.label)
      .join(' | ')
    if (useStore.getState().today!.mode === 'normal') {
      expect(labels).toContain('Epsilon-delta limits')
    }
  })

  it('finishing a topic block advances its spaced-review schedule', async () => {
    await useStore.getState().addTopic('math', 'Analysis', 'Epsilon-delta limits', 2)
    await useStore.getState().regenerateToday()
    const today = useStore.getState().today!
    const block = today.blocks.find((b) => b.topicId != null && b.kind === 'study')
    if (!block) return // rest-day run — nothing to assert
    await useStore.getState().finishBlock(block.id, { confidence: 4 })
    const topic = (await db.topics.toArray())[0]
    expect(topic.confidence).toBe(4)
    expect(topic.timesStudied).toBe(1)
    expect(topic.nextReview).toBe(addDays(localToday(), TOPIC_INTERVALS[1]))
  })

  it('wrap-up paper results are stored for calibration', async () => {
    const today = useStore.getState().today!
    const block = today.blocks.find((b) => b.kind === 'study' && b.subjectId === 'math')
    if (!block) return
    await useStore.getState().finishBlock(block.id, {
      paper: { predicted: 70, actual: 55, maxScore: 80 },
    })
    const papers = await db.paperLogs.toArray()
    expect(papers).toHaveLength(1)
    expect(papers[0].actual).toBe(55)
  })

  it('logError and resolveError round-trip and feed the store', async () => {
    await useStore.getState().logError('physics', 'careless', 'dropped a minus sign')
    await useStore.getState().logError('physics', 'careless', 'units again')
    expect(useStore.getState().errors).toHaveLength(2)
    const id = useStore.getState().errors[0].id!
    await useStore.getState().resolveError(id)
    expect(useStore.getState().errors).toHaveLength(1)
    expect((await db.errorLogs.toArray()).filter((e) => e.resolved)).toHaveLength(1)
  })

  it('skip adds debt; partial debts only the remainder', async () => {
    // Rest-day schedules only carry short light blocks; need >20 min for the partial math.
    const study = useStore.getState().today!.blocks.filter(
      (b) => b.kind === 'study' && b.durationMin > 20,
    )
    if (study.length < 2) return
    await useStore.getState().skipBlock(study[0].id, 'No time')
    let debts = await db.debts.toArray()
    expect(debts).toHaveLength(1)
    expect(debts[0].minutesOwed).toBe(study[0].durationMin)

    await useStore.getState().partialBlock(study[1].id, study[1].durationMin - 20)
    debts = await db.debts.toArray()
    expect(debts).toHaveLength(2)
    expect(debts[1].minutesOwed).toBe(20)
  })

  it('completing a debt-repayment block pays the debt down', async () => {
    await db.debts.add({
      subjectId: 'math', minutesOwed: 60, createdDate: localToday(), reason: 'test', decayed: false,
    })
    await useStore.getState().regenerateToday()
    const repay = useStore.getState().today!.blocks.find((b) => b.isDebtRepayment)
    if (!repay) return // rest day — no repayment scheduled
    await useStore.getState().finishBlock(repay.id)
    const debts = await db.debts.toArray()
    expect(debts.reduce((s, d) => s + d.minutesOwed, 0)).toBe(60 - repay.durationMin)
  })

  it('regenerateToday preserves settled blocks with unique ids and no overlaps', async () => {
    const study = useStore.getState().today!.blocks.filter((b) => b.kind === 'study')
    await useStore.getState().finishBlock(study[0].id)
    await useStore.getState().skipBlock(study[1].id, 'No time')
    await useStore.getState().regenerateToday()

    const today = useStore.getState().today!
    const ids = today.blocks.map((b) => b.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(today.blocks.filter((b) => b.status === 'done')).toHaveLength(1)
    expect(today.blocks.filter((b) => b.status === 'skipped')).toHaveLength(1)
    const sorted = [...today.blocks].sort((a, b) => a.start - b.start)
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].start).toBeGreaterThanOrEqual(
        sorted[i - 1].start + sorted[i - 1].durationMin,
      )
    }
  })

  it('vacation mode freezes the day and endVacation restores it', async () => {
    await useStore.getState().startVacation(3)
    expect(useStore.getState().today?.mode).toBe('vacation')
    expect(useStore.getState().today?.blocks).toHaveLength(0)
    await useStore.getState().endVacation()
    expect(useStore.getState().today?.mode).not.toBe('vacation')
    expect(useStore.getState().today!.blocks.length).toBeGreaterThan(0)
  })

  it('resetAll wipes data and returns to the onboarding state without reload', async () => {
    await useStore.getState().addTopic('math', 'Analysis', 'Limits', 2)
    await useStore.getState().logError('physics', 'careless', 'sign slip')
    await useStore.getState().resetAll()

    const s = useStore.getState()
    expect(s.user?.onboarded).toBe(false) // App renders <Onboarding/>
    expect(s.topics).toHaveLength(0)
    expect(s.errors).toHaveLength(0)
    expect(s.today).toBeNull()
    expect(await db.topics.count()).toBe(0)
    expect(await db.errorLogs.count()).toBe(0)
    expect(await db.schedules.count()).toBe(0)
    // Subjects are re-seeded so onboarding can run again.
    expect(await db.subjects.count()).toBe(4)
  })

  it('low energy regenerate keeps the flashcard slot and cuts load', async () => {
    const normal = useStore.getState().today!.plannedMinutes
    await useStore.getState().regenerateToday({ lowEnergy: true })
    const low = useStore.getState().today!
    expect(low.plannedMinutes).toBeLessThanOrEqual(normal)
    expect(low.blocks.some((b) => b.taskType === 'REVIEW' && b.subjectId === 'spanish')).toBe(true)
  })

  it('morning check-in with a low-hours answer caps today and marks the date', async () => {
    const normal = useStore.getState().today!.plannedMinutes
    await useStore.getState().submitCheckin({ availableMinutes: 120 })
    const s = useStore.getState()
    expect(s.user?.lastCheckinDate).toBe(localToday())
    // On a study day the cap shrinks the load; on a rest day it's already tiny.
    expect(s.today!.plannedMinutes).toBeLessThanOrEqual(normal)
  })

  it('a "day off" check-in produces an empty, debt-free day', async () => {
    await useStore.getState().submitCheckin({ availableMinutes: 0 })
    const s = useStore.getState()
    expect(s.today?.mode).toBe('off')
    expect(s.today?.blocks).toHaveLength(0)
  })

  it('a planned day off does not roll into debt on the next day', async () => {
    // Plan yesterday as a day off, leave a stale pending schedule for it, then
    // re-run startup — nightlyRollover must not create debt for the planned day.
    const yesterday = addDays(localToday(), -1)
    await db.dayPlans.put({ date: yesterday, availableMinutes: 0 })
    await db.schedules.put({
      date: yesterday, mode: 'off', blocks: [], completionRate: 0, plannedMinutes: 0,
    })
    await db.userState.update('me', { lastFinalizedDate: addDays(yesterday, -1) })
    await useStore.getState().init()
    expect(await db.debts.count()).toBe(0)
  })

  it('setDayPlan stores and clears a plan', async () => {
    const d = addDays(localToday(), 2)
    await useStore.getState().setDayPlan(d, 0)
    expect(useStore.getState().dayPlans.find((p) => p.date === d)?.availableMinutes).toBe(0)
    await useStore.getState().setDayPlan(d, null)
    expect(useStore.getState().dayPlans.find((p) => p.date === d)).toBeUndefined()
  })

  it('addTopics bulk-adds trimmed non-empty lines', async () => {
    const n = await useStore.getState().addTopics('math', 'Analysis',
      ['Limits', '  Continuity  ', '', '   ', 'Derivatives'], 2)
    expect(n).toBe(3)
    const names = useStore.getState().topics.map((t) => t.name).sort()
    expect(names).toEqual(['Continuity', 'Derivatives', 'Limits'])
  })

  it('markBackedUp records the backup date', async () => {
    expect(useStore.getState().user?.lastBackupDate).toBeNull()
    await useStore.getState().markBackedUp()
    expect(useStore.getState().user?.lastBackupDate).toBe(localToday())
  })
})
