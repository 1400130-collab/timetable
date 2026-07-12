import { describe, expect, it } from 'vitest'
import type { Debt, GeneratorInput, Subject, Topic, UserState } from '../types'
import { ACTIVE_TYPES } from '../types'
import { DEFAULT_SUBJECTS, DEFAULT_USER } from '../db/schema'
import { addDays } from './dates'
import { decayDebts, repaymentPlan, totalDebt } from './debt'
import { dueReviews, focusTopics, rag, TOPIC_INTERVALS, topicScore, touchTopic } from './topics'
import {
  computeCompletionRate,
  FIXED_EVENTS,
  generateDaySchedule,
  PAPER_DAYS,
} from './scheduleGenerator'

const user: UserState = { ...DEFAULT_USER, onboarded: true }
const subjects: Subject[] = DEFAULT_SUBJECTS

function topic(partial: Partial<Topic>): Topic {
  return {
    id: 1,
    subjectId: 'math',
    unit: 'General',
    name: 'Induction proofs',
    confidence: 3,
    lastTouched: null,
    nextReview: null,
    reviewStage: 0,
    timesStudied: 0,
    createdDate: '2026-07-01',
    ...partial,
  }
}

function input(overrides: Partial<GeneratorInput> = {}): GeneratorInput {
  return {
    date: '2026-07-13', // a Monday
    dayOfWeek: 1,
    user,
    subjects,
    debts: [],
    topics: [],
    unresolvedErrors: {},
    topErrorCategory: {},
    essaysThisWeek: 0,
    rewriteDoneThisWeek: false,
    papersDoneThisWeek: {},
    ...overrides,
  }
}

describe('generateDaySchedule', () => {
  it('schedules roughly the summer baseline on a normal weekday', () => {
    const day = generateDaySchedule(input())
    expect(day.mode).toBe('normal')
    const bySubject = (id: string) =>
      day.blocks.filter((b) => b.kind === 'study' && b.subjectId === id)
        .reduce((s, b) => s + b.durationMin, 0)
    expect(bySubject('math')).toBe(70)
    expect(bySubject('physics')).toBe(60)
    expect(bySubject('spanish')).toBe(25)
    expect(bySubject('english')).toBeGreaterThanOrEqual(30)
  })

  it('never schedules more than 2 consecutive study blocks of one subject', () => {
    for (const dow of [1, 2, 3, 4, 5, 6]) {
      const day = generateDaySchedule(input({ dayOfWeek: dow, date: addDays('2026-07-12', dow) }))
      const study = day.blocks.filter((b) => b.kind === 'study')
      for (let i = 2; i < study.length; i++) {
        const same =
          study[i].subjectId === study[i - 1].subjectId &&
          study[i].subjectId === study[i - 2].subjectId
        expect(same).toBe(false)
      }
    }
  })

  it('keeps ≥60% of study minutes in active-reconstruction types', () => {
    for (const dow of [1, 2, 3, 4, 5, 6]) {
      const day = generateDaySchedule(input({ dayOfWeek: dow, date: addDays('2026-07-12', dow) }))
      const study = day.blocks.filter((b) => b.kind === 'study')
      const total = study.reduce((s, b) => s + b.durationMin, 0)
      const active = study
        .filter((b) => b.taskType && ACTIVE_TYPES.includes(b.taskType))
        .reduce((s, b) => s + b.durationMin, 0)
      expect(active / total).toBeGreaterThanOrEqual(0.6)
    }
  })

  it('never overlaps locked academy events', () => {
    for (const e of FIXED_EVENTS) {
      const day = generateDaySchedule(input({ dayOfWeek: e.day, date: addDays('2026-07-12', e.day) }))
      const others = day.blocks.filter((b) => b.kind !== 'locked')
      for (const b of others) {
        const overlaps = b.start < e.start + e.durationMin && b.start + b.durationMin > e.start
        expect(overlaps).toBe(false)
      }
      expect(day.blocks.some((b) => b.kind === 'locked' && b.label === e.label)).toBe(true)
    }
  })

  it('places a protected gym block on gym days only', () => {
    const gymDay = generateDaySchedule(input({ dayOfWeek: 1 }))
    expect(gymDay.blocks.filter((b) => b.kind === 'gym')).toHaveLength(1)
    const offDay = generateDaySchedule(input({ dayOfWeek: 3, date: '2026-07-15' }))
    expect(offDay.blocks.filter((b) => b.kind === 'gym')).toHaveLength(0)
  })

  it('targets the weakest, stalest topic in block labels', () => {
    const topics = [
      topic({ id: 1, name: 'Induction proofs', confidence: 5, lastTouched: '2026-07-12' }),
      topic({ id: 2, name: 'Epsilon-delta limits', confidence: 1 }),
    ]
    const day = generateDaySchedule(input({ topics }))
    const practice = day.blocks.find(
      (b) => b.subjectId === 'math' && b.taskType === 'PRACTICE_PROBLEMS' && !b.isDebtRepayment,
    )
    expect(practice?.label).toContain('Epsilon-delta limits')
    expect(practice?.topicId).toBe(2)
  })

  it('injects spaced-review recall blocks for topics whose review is due', () => {
    const topics = [
      topic({ id: 7, name: 'Projectile motion', subjectId: 'physics', nextReview: '2026-07-13', lastTouched: '2026-07-10', confidence: 4 }),
    ]
    const day = generateDaySchedule(input({ topics }))
    const review = day.blocks.find((b) => b.isSpacedReview)
    expect(review).toBeDefined()
    expect(review!.label).toContain('Projectile motion')
    expect(review!.taskType).toBe('RECALL')
  })

  it('schedules a timed past paper + marking block on each subject’s paper day', () => {
    const mathPaperDay = generateDaySchedule(
      input({ dayOfWeek: PAPER_DAYS['math'], date: addDays('2026-07-12', PAPER_DAYS['math']) }),
    )
    const paper = mathPaperDay.blocks.find((b) => b.taskType === 'PAST_PAPER' && b.subjectId === 'math')
    const mark = mathPaperDay.blocks.find((b) => b.taskType === 'REPAIR' && b.subjectId === 'math')
    expect(paper).toBeDefined()
    expect(mark).toBeDefined()
    // Skips it once the week's paper is done.
    const done = generateDaySchedule(
      input({
        dayOfWeek: PAPER_DAYS['math'],
        date: addDays('2026-07-12', PAPER_DAYS['math']),
        papersDoneThisWeek: { math: true },
      }),
    )
    expect(done.blocks.some((b) => b.taskType === 'PAST_PAPER' && b.subjectId === 'math')).toBe(false)
  })

  it('injects an error-repair block when a subject has 3+ open errors', () => {
    const day = generateDaySchedule(
      input({ unresolvedErrors: { physics: 4 }, topErrorCategory: { physics: 'careless' } }),
    )
    const repair = day.blocks.find((b) => b.taskType === 'REPAIR' && b.subjectId === 'physics')
    expect(repair).toBeDefined()
    expect(repair!.label).toContain('careless')
    const clean = generateDaySchedule(input({ unresolvedErrors: { physics: 2 } }))
    expect(clean.blocks.some((b) => b.taskType === 'REPAIR' && b.subjectId === 'physics')).toBe(false)
  })

  it('schedules essays twice a week and skips once quota is met', () => {
    const tue = generateDaySchedule(input({ dayOfWeek: 2, date: '2026-07-14' }))
    expect(tue.blocks.some((b) => b.taskType === 'WRITE')).toBe(true)
    const tueDone = generateDaySchedule(input({ dayOfWeek: 2, date: '2026-07-14', essaysThisWeek: 2 }))
    expect(tueDone.blocks.some((b) => b.taskType === 'WRITE')).toBe(false)
  })

  it('rest day keeps only Spanish (frequency beats duration)', () => {
    const day = generateDaySchedule(input({ dayOfWeek: 0, date: '2026-07-12' }))
    expect(day.mode).toBe('rest')
    const study = day.blocks.filter((b) => b.kind === 'study')
    expect(study.every((b) => b.subjectId === 'spanish')).toBe(true)
    expect(study.reduce((s, b) => s + b.durationMin, 0)).toBe(25)
  })

  it('low energy mode runs ~60% load but keeps flashcards and spaced reviews whole', () => {
    const topics = [
      topic({ id: 3, subjectId: 'physics', name: 'Circuits', nextReview: '2026-07-13', lastTouched: '2026-07-10' }),
    ]
    const normal = generateDaySchedule(input())
    const low = generateDaySchedule(input({ lowEnergy: true, topics }))
    expect(low.mode).toBe('low_energy')
    expect(low.plannedMinutes).toBeLessThan(normal.plannedMinutes * 0.8)
    expect(low.blocks.some((b) => b.taskType === 'REVIEW' && b.subjectId === 'spanish' && b.durationMin === 10)).toBe(true)
    const review = low.blocks.find((b) => b.isSpacedReview)
    expect(review?.durationMin).toBe(15) // not scaled down
  })

  it('vacation mode schedules nothing', () => {
    const day = generateDaySchedule(
      input({ user: { ...user, vacationUntil: '2026-07-20' } }),
    )
    expect(day.mode).toBe('vacation')
    expect(day.blocks).toHaveLength(0)
  })

  it('caps debt repayment at 30% extra load', () => {
    const debts: Debt[] = [
      { subjectId: 'math', minutesOwed: 120, createdDate: '2026-07-12', reason: 'skip', decayed: false },
    ]
    const normal = generateDaySchedule(input())
    const day = generateDaySchedule(input({ debts }))
    const extra = day.blocks
      .filter((b) => b.isDebtRepayment)
      .reduce((s, b) => s + b.durationMin, 0)
    expect(extra).toBeGreaterThan(0)
    expect(extra).toBeLessThanOrEqual(Math.floor(normal.plannedMinutes * 0.3))
  })

  it('triggers a reset week with reduced targets when debt exceeds 4 hours', () => {
    const debts: Debt[] = [
      { subjectId: 'math', minutesOwed: 150, createdDate: '2026-07-12', reason: 'skip', decayed: false },
      { subjectId: 'physics', minutesOwed: 150, createdDate: '2026-07-12', reason: 'skip', decayed: false },
    ]
    const day = generateDaySchedule(input({ debts }))
    expect(day.mode).toBe('reset')
    const normal = generateDaySchedule(input())
    expect(day.plannedMinutes).toBeLessThan(normal.plannedMinutes)
  })
})

describe('topic engine', () => {
  it('scores red, stale, error-prone topics highest', () => {
    const today = '2026-07-13'
    const weak = topic({ confidence: 1, lastTouched: '2026-07-01' })
    const strong = topic({ confidence: 5, lastTouched: '2026-07-12' })
    expect(topicScore(weak, today)).toBeGreaterThan(topicScore(strong, today) * 10)
    expect(topicScore(weak, today, 3)).toBeGreaterThan(topicScore(weak, today))
  })

  it('focusTopics excludes due-review topics (they get their own blocks)', () => {
    const today = '2026-07-13'
    const due = topic({ id: 1, confidence: 1, nextReview: '2026-07-12' })
    const fresh = topic({ id: 2, confidence: 4 })
    const focus = focusTopics([due, fresh], 'math', today)
    expect(focus.map((t) => t.id)).toEqual([2])
    expect(dueReviews([due, fresh], today).map((t) => t.id)).toEqual([1])
  })

  it('touchTopic walks the expanding interval ladder and resets on low confidence', () => {
    const today = '2026-07-13'
    let t = topic({})
    t = touchTopic(t, today, 4)
    expect(t.reviewStage).toBe(1)
    expect(t.nextReview).toBe(addDays(today, TOPIC_INTERVALS[1]))
    t = touchTopic(t, today, 4)
    expect(t.reviewStage).toBe(2)
    // Confidence collapse → back to the 1-day interval.
    t = touchTopic(t, today, 2)
    expect(t.reviewStage).toBe(0)
    expect(t.nextReview).toBe(addDays(today, 1))
    expect(t.timesStudied).toBe(3)
  })

  it('maps confidence to RAG bands', () => {
    expect(rag(1)).toBe('red')
    expect(rag(2)).toBe('red')
    expect(rag(3)).toBe('amber')
    expect(rag(4)).toBe('green')
    expect(rag(5)).toBe('green')
  })
})

describe('debt engine', () => {
  it('decays debt older than 7 days by 50%, once', () => {
    const debts: Debt[] = [
      { subjectId: 'math', minutesOwed: 60, createdDate: '2026-07-01', reason: 'skip', decayed: false },
      { subjectId: 'math', minutesOwed: 60, createdDate: '2026-07-10', reason: 'skip', decayed: false },
    ]
    const out = decayDebts(debts, '2026-07-13')
    expect(out[0].minutesOwed).toBe(30)
    expect(out[0].decayed).toBe(true)
    expect(out[1].minutesOwed).toBe(60)
    expect(decayDebts(out, '2026-07-14')[0].minutesOwed).toBe(30)
  })

  it('spreads repayment instead of dumping a full missed day into tomorrow', () => {
    const debts: Debt[] = [
      { subjectId: 'math', minutesOwed: 240, createdDate: '2026-07-12', reason: 'skip', decayed: false },
    ]
    const plan = repaymentPlan(debts, 200)
    const today = Object.values(plan).reduce((a, b) => a + b, 0)
    expect(today).toBeLessThanOrEqual(60) // 30% of 200
    expect(today).toBeLessThan(totalDebt(debts))
  })
})

describe('availability cap (planned busy days / low-hours check-in)', () => {
  const studyMin = (day: ReturnType<typeof generateDaySchedule>) =>
    day.blocks.filter((b) => b.kind === 'study').reduce((s, b) => s + b.durationMin, 0)

  it('availableMinutes 0 gives a debt-free day off', () => {
    const day = generateDaySchedule(input({ availableMinutes: 0 }))
    expect(day.mode).toBe('off')
    expect(day.blocks).toHaveLength(0)
    expect(day.plannedMinutes).toBe(0)
  })

  it('a partial cap shrinks the day toward the budget', () => {
    const full = studyMin(generateDaySchedule(input()))
    const capped = studyMin(generateDaySchedule(input({ availableMinutes: 120 })))
    expect(capped).toBeLessThan(full)
    // Flashcards/spaced reviews are kept whole, so it may slightly exceed the
    // raw budget, but never balloons past it.
    expect(capped).toBeLessThanOrEqual(160)
  })

  it('an ample cap leaves a normal day untouched', () => {
    const full = studyMin(generateDaySchedule(input()))
    const capped = studyMin(generateDaySchedule(input({ availableMinutes: 600 })))
    expect(capped).toBe(full)
  })

  it('keeps the Spanish flashcard block even under a tight cap', () => {
    const day = generateDaySchedule(input({ availableMinutes: 60 }))
    const flash = day.blocks.find((b) => b.subjectId === 'spanish' && b.taskType === 'REVIEW')
    expect(flash).toBeDefined()
  })
})

describe('completion rate', () => {
  it('counts partials by actual minutes', () => {
    const day = generateDaySchedule(input())
    const study = day.blocks.filter((b) => b.kind === 'study')
    study[0].status = 'done'
    study[1].status = 'partial'
    study[1].actualMinutes = Math.floor(study[1].durationMin / 2)
    const rate = computeCompletionRate(day.blocks)
    expect(rate).toBeGreaterThan(0)
    expect(rate).toBeLessThan(1)
  })
})
