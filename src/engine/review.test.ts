import { describe, expect, it } from 'vitest'
import type { Block, DaySchedule, ErrorLog, PaperLog, SessionLog, TaskType, Topic } from '../types'
import { buildWeeklyReview } from './review'

function session(p: Partial<SessionLog>): SessionLog {
  return { date: '2026-07-13', subjectId: 'math', taskType: 'PRACTICE_PROBLEMS', minutes: 50, topicId: null, ...p }
}
let blockSeq = 0
function studyBlock(taskType: TaskType, durationMin: number, status: Block['status'], actualMinutes = 0): Block {
  return {
    id: `b${blockSeq++}`, kind: 'study', subjectId: 'math', taskType, start: 8 * 60,
    durationMin, status, actualMinutes, label: `${taskType} block`, isDebtRepayment: false, topicId: null,
  }
}
function sched(date: string, blocks: Block[]): DaySchedule {
  const plannedMinutes = blocks.filter((b) => b.kind === 'study').reduce((s, b) => s + b.durationMin, 0)
  return { date, mode: 'normal', blocks, completionRate: 0, plannedMinutes }
}
function topic(p: Partial<Topic>): Topic {
  return {
    id: 1, subjectId: 'math', unit: 'U', name: 'T', confidence: 3, lastTouched: null,
    nextReview: null, reviewStage: 0, timesStudied: 0, createdDate: '2026-07-01', ...p,
  }
}

const base = {
  today: '2026-07-17', // Friday
  weekStart: '2026-07-13', // Monday
}

describe('buildWeeklyReview', () => {
  it('sums total minutes from the week’s sessions', () => {
    const r = buildWeeklyReview({
      ...base,
      sessions: [
        session({ taskType: 'PRACTICE_PROBLEMS', minutes: 60 }),
        session({ taskType: 'READ', minutes: 40 }),
      ],
      schedules: [], topics: [], openErrors: [], papers: [],
    })
    expect(r.totalMinutes).toBe(100)
  })

  it('measures hard-block follow-through from planned vs settled active blocks', () => {
    const scheds = [
      sched('2026-07-13', [
        studyBlock('PRACTICE_PROBLEMS', 50, 'done'),   // hard, done
        studyBlock('PAST_PAPER', 40, 'skipped'),        // hard, skipped
        studyBlock('READ', 30, 'done'),                 // passive — ignored
      ]),
      sched('2026-07-14', [
        studyBlock('RECALL', 20, 'partial', 10),        // hard, half done
      ]),
    ]
    const r = buildWeeklyReview({ ...base, sessions: [], schedules: scheds, topics: [], openErrors: [], papers: [] })
    expect(r.plannedHardMin).toBe(110) // 50 + 40 + 20 (READ excluded)
    expect(r.doneHardMin).toBe(60)     // 50 done + 10 partial
    expect(r.hardFollowThrough).toBeCloseTo(60 / 110)
    expect(r.skippedHard).toHaveLength(1)
    expect(r.skippedHard[0].taskType).toBe('PAST_PAPER')
  })

  it('reports null follow-through when no hard blocks were scheduled', () => {
    const r = buildWeeklyReview({
      ...base,
      sessions: [],
      schedules: [sched('2026-07-13', [studyBlock('READ', 30, 'done')])],
      topics: [], openErrors: [], papers: [],
    })
    expect(r.hardFollowThrough).toBeNull()
  })

  it('ignores sessions from before the week start', () => {
    const r = buildWeeklyReview({
      ...base,
      sessions: [session({ date: '2026-07-10', minutes: 999 }), session({ minutes: 30 })],
      schedules: [], topics: [], openErrors: [], papers: [],
    })
    expect(r.totalMinutes).toBe(30)
  })

  it('builds a next-week attack list of the weakest topics only', () => {
    const topics = [
      topic({ id: 1, name: 'Weak', confidence: 1 }),
      topic({ id: 2, name: 'Strong', confidence: 5 }),
      topic({ id: 3, name: 'Amber', confidence: 3 }),
    ]
    const r = buildWeeklyReview({ ...base, sessions: [], schedules: [], topics, openErrors: [], papers: [] })
    expect(r.rag).toEqual({ red: 1, amber: 1, green: 1 })
    expect(r.focusNextWeek.map((t) => t.id)).toEqual([1, 3]) // strong excluded
  })

  it('averages completion over non-vacation planned days', () => {
    const scheds: DaySchedule[] = [
      { date: '2026-07-13', mode: 'normal', blocks: [], completionRate: 0.8, plannedMinutes: 200 },
      { date: '2026-07-14', mode: 'normal', blocks: [], completionRate: 0.6, plannedMinutes: 200 },
      { date: '2026-07-15', mode: 'vacation', blocks: [], completionRate: 0, plannedMinutes: 0 },
    ]
    const r = buildWeeklyReview({ ...base, sessions: [], schedules: scheds, topics: [], openErrors: [], papers: [] })
    expect(r.avgCompletion).toBeCloseTo(0.7)
  })

  it('reports calibration gap and top error category', () => {
    const papers: PaperLog[] = [
      { date: '2026-07-14', subjectId: 'math', predicted: 80, actual: 60, maxScore: 100 }, // gap 20
    ]
    const errors: ErrorLog[] = [
      { date: '2026-07-14', subjectId: 'math', topicId: null, category: 'careless', note: '', resolved: false },
      { date: '2026-07-14', subjectId: 'math', topicId: null, category: 'careless', note: '', resolved: false },
      { date: '2026-07-14', subjectId: 'math', topicId: null, category: 'knowledge', note: '', resolved: false },
    ]
    const r = buildWeeklyReview({ ...base, sessions: [], schedules: [], topics: [], openErrors: errors, papers })
    expect(r.calibrationGap).toBe(20)
    expect(r.openErrorCount).toBe(3)
    expect(r.topErrorCategory).toBe('careless')
  })
})
