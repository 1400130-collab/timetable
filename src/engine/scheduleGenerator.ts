import type {
  Block,
  DaySchedule,
  FixedEvent,
  GeneratorInput,
  Subject,
  TaskType,
  Topic,
} from '../types'
import { ACTIVE_TYPES } from '../types'
import { RESET_THRESHOLD_MIN, repaymentPlan, totalDebt } from './debt'
import { rankSubjects } from './priority'
import { dueReviews, focusTopics } from './topics'

// ---------------------------------------------------------------------------
// Fixed constraints (hardcoded per spec)
// ---------------------------------------------------------------------------
export const FIXED_EVENTS: FixedEvent[] = [
  { day: 6, start: 12 * 60, durationMin: 120, label: 'Physics academy', subjectId: 'physics' },
  { day: 3, start: 16 * 60, durationMin: 120, label: 'Math academy', subjectId: 'math' },
  { day: 5, start: 16 * 60, durationMin: 120, label: 'Math academy', subjectId: 'math' },
]

/**
 * Weekly timed past-paper day per subject. Timing, question selection and
 * stamina are trained only by rehearsal — one full timed session per week,
 * always followed by self-marking against the scheme.
 */
export const PAPER_DAYS: Record<string, number> = { math: 5, physics: 6 }

/** Feynman day per subject: explain the weakest topic aloud to a novice. */
export const EXPLAIN_DAYS: Record<string, number> = { math: 2, physics: 4 }

export const RETRIEVAL_RATIO = 0.6
const GYM_MINUTES = 60

interface TaskDraft {
  subjectId: string
  taskType: TaskType
  durationMin: number
  label: string
  isDebtRepayment?: boolean
  topicId?: number | null
  isSpacedReview?: boolean
}

/** Retrieval-first ordering within a subject: reviews and recall before new input. */
const TYPE_ORDER: TaskType[] = [
  'REVIEW', 'RECALL', 'PAST_PAPER', 'REPAIR', 'PRACTICE_PROBLEMS', 'EXPLAIN', 'NEW_MATERIAL', 'WRITE', 'READ',
]

const topicTag = (t?: Topic) => (t ? ` — ${t.name}` : '')

// ---------------------------------------------------------------------------
// Daily task menu
// ---------------------------------------------------------------------------
function buildMenu(input: GeneratorInput): TaskDraft[] {
  const { date, dayOfWeek, subjects, topics, unresolvedErrors, topErrorCategory } = input
  const tasks: TaskDraft[] = []
  const target = (id: string) =>
    subjects.find((s) => s.id === id)?.targetMinutesDay ?? 0

  const due = dueReviews(topics, date)

  // --- Spaced topic reviews come first: blank-page recall of what's decaying.
  // Cap at 2 per subject so reviews never crowd out new work.
  const reviewsBySubject = new Map<string, Topic[]>()
  for (const t of due) {
    const list = reviewsBySubject.get(t.subjectId) ?? []
    if (list.length < 2) reviewsBySubject.set(t.subjectId, [...list, t])
  }
  for (const [subjectId, list] of reviewsBySubject) {
    if (subjectId === 'spanish') continue // Spanish reviews live in the daily flashcard slot
    for (const t of list) {
      tasks.push({
        subjectId,
        taskType: 'RECALL',
        durationMin: 15,
        label: `Spaced review — blank-page recall: ${t.name}`,
        topicId: t.id,
        isSpacedReview: true,
      })
    }
  }

  const focus = (subjectId: string) => focusTopics(topics, subjectId, date)[0]

  // --- Math: proof-based depth beyond academy.
  const mathTarget = target('math')
  if (mathTarget > 0) {
    const f = focus('math')
    const isPaperDay = PAPER_DAYS['math'] === dayOfWeek && !input.papersDoneThisWeek['math']
    const afterAcademy = dayOfWeek === 4 || dayOfWeek === 6 // morning after Wed/Fri academy
    if (isPaperDay) {
      tasks.push(
        { subjectId: 'math', taskType: 'PAST_PAPER', durationMin: Math.max(35, mathTarget - 20), label: `Timed past-paper section${topicTag(f)} — no notes, exam conditions`, topicId: f?.id ?? null },
        { subjectId: 'math', taskType: 'REPAIR', durationMin: 20, label: 'Mark against the scheme — log every dropped mark' },
      )
    } else {
      tasks.push(
        afterAcademy
          ? { subjectId: 'math', taskType: 'RECALL', durationMin: 20, label: 'Condense yesterday’s academy session to one page — from memory' }
          : { subjectId: 'math', taskType: 'RECALL', durationMin: 20, label: `Blank-page recall${topicTag(f)} — write everything, then check`, topicId: f?.id ?? null },
        { subjectId: 'math', taskType: 'PRACTICE_PROBLEMS', durationMin: mathTarget - 20, label: `Mixed problem set${topicTag(f)} — interleave methods`, topicId: f?.id ?? null },
      )
      if (EXPLAIN_DAYS['math'] === dayOfWeek && f) {
        tasks.push({ subjectId: 'math', taskType: 'EXPLAIN', durationMin: 10, label: `Feynman — explain ${f.name} aloud to a novice`, topicId: f.id })
      }
    }
  }

  // --- Physics: learned by solving, not reading.
  const phyTarget = target('physics')
  if (phyTarget > 0) {
    const f = focus('physics')
    const isPaperDay = PAPER_DAYS['physics'] === dayOfWeek && !input.papersDoneThisWeek['physics']
    const afterAcademy = dayOfWeek === 0 // Sunday is rest, so this rarely fires; Sat academy condenses Monday
    if (isPaperDay) {
      tasks.push(
        { subjectId: 'physics', taskType: 'PAST_PAPER', durationMin: Math.max(30, phyTarget - 20), label: `Timed past-paper section${topicTag(f)} — no notes, exam conditions`, topicId: f?.id ?? null },
        { subjectId: 'physics', taskType: 'REPAIR', durationMin: 20, label: 'Mark against the scheme — log every dropped mark' },
      )
    } else {
      tasks.push(
        { subjectId: 'physics', taskType: 'PRACTICE_PROBLEMS', durationMin: Math.max(25, phyTarget - 15), label: `Problem set${topicTag(f)} — mixed types, identify the method first`, topicId: f?.id ?? null },
        dayOfWeek === 1
          ? { subjectId: 'physics', taskType: 'RECALL', durationMin: 15, label: 'Condense Saturday’s academy session to one page — from memory' }
          : { subjectId: 'physics', taskType: 'RECALL', durationMin: 15, label: `Blank-page recall${topicTag(f)} — derive key results from memory`, topicId: f?.id ?? null },
      )
      if (EXPLAIN_DAYS['physics'] === dayOfWeek && f) {
        tasks.push({ subjectId: 'physics', taskType: 'EXPLAIN', durationMin: 10, label: `Feynman — explain ${f.name} aloud to a novice`, topicId: f.id })
      }
    }
    void afterAcademy
  }

  // --- Repair blocks: unresolved errors are the highest-yield material there is.
  for (const s of subjects) {
    const count = unresolvedErrors[s.id] ?? 0
    if (count >= 3 && PAPER_DAYS[s.id] !== dayOfWeek) {
      const cat = topErrorCategory[s.id]
      tasks.push({
        subjectId: s.id,
        taskType: 'REPAIR',
        durationMin: 15,
        label: `Error-log repair — ${count} open errors${cat ? `, mostly ${cat}` : ''}`,
      })
    }
  }

  // --- Spanish: daily, frequency-driven — 10 min flashcards + 15 min input.
  tasks.push(
    { subjectId: 'spanish', taskType: 'REVIEW', durationMin: 10, label: 'Vocab flashcards — Anki-style run, failures repeat tomorrow' },
    { subjectId: 'spanish', taskType: 'READ', durationMin: 15, label: 'Comprehensible input — reading or listening' },
  )

  // --- English: daily reading + 2×/week timed essay + weekly style drill.
  tasks.push({
    subjectId: 'english',
    taskType: 'READ',
    durationMin: target('english') || 30,
    label: input.user.currentBook
      ? `Read “${input.user.currentBook}” — log pages`
      : 'Daily reading — log pages',
  })
  const essayDay = dayOfWeek === 2 || dayOfWeek === 4
  if (essayDay && input.essaysThisWeek < 2) {
    tasks.push({ subjectId: 'english', taskType: 'WRITE', durationMin: 40, label: 'Timed essay — then self-mark against the rubric like an examiner' })
  }
  if (dayOfWeek === 6 && !input.rewriteDoneThisWeek) {
    tasks.push({ subjectId: 'english', taskType: 'WRITE', durationMin: 20, label: 'Style drill — rewrite one paragraph 3 different ways' })
  }

  return tasks
}

/**
 * Cap the day's flexible study load to a committed budget (planned busy day or
 * low-availability check-in). Flashcards and spaced reviews are kept whole —
 * frequency-driven work is the last thing to drop.
 */
function capToAvailable(tasks: TaskDraft[], availableMinutes: number): TaskDraft[] {
  const keep = (t: TaskDraft) => t.taskType === 'REVIEW' || t.isSpacedReview
  const keepMin = tasks.filter(keep).reduce((s, t) => s + t.durationMin, 0)
  const flexMin = tasks.filter((t) => !keep(t)).reduce((s, t) => s + t.durationMin, 0)
  const budget = Math.max(0, availableMinutes - keepMin)
  if (flexMin === 0 || flexMin <= budget) return tasks
  const factor = budget / flexMin
  return tasks
    .map((t) => (keep(t) ? t : { ...t, durationMin: Math.round((t.durationMin * factor) / 5) * 5 }))
    .filter((t) => keep(t) || t.durationMin >= 10)
}

/** Enforce ≥60% of study minutes in active-reconstruction task types. */
function enforceRetrievalRatio(tasks: TaskDraft[]): TaskDraft[] {
  const total = tasks.reduce((s, t) => s + t.durationMin, 0)
  const retrieval = () =>
    tasks
      .filter((t) => ACTIVE_TYPES.includes(t.taskType))
      .reduce((s, t) => s + t.durationMin, 0)
  let shortfall = Math.ceil(total * RETRIEVAL_RATIO) - retrieval()
  if (shortfall <= 0) return tasks
  const out = tasks.map((t) => ({ ...t }))
  for (const t of out) {
    if (shortfall <= 0) break
    if (t.taskType !== 'NEW_MATERIAL') continue
    const shift = Math.min(t.durationMin, shortfall)
    const practice = out.find(
      (p) => p.subjectId === t.subjectId && p.taskType === 'PRACTICE_PROBLEMS',
    )
    if (practice) {
      // Move minutes into the paired practice block; total load is conserved.
      t.durationMin -= shift
      practice.durationMin += shift
    } else {
      t.taskType = 'PRACTICE_PROBLEMS'
      t.label = 'Mixed problem set'
    }
    shortfall -= shift
  }
  if (shortfall > 0) {
    // Nothing left to convert (essay/reading minima are fixed) — top up the
    // biggest practice block. Solving (r + x)/(T + x) ≥ 0.6 gives x = shortfall/0.4.
    const practice = out
      .filter((t) => t.taskType === 'PRACTICE_PROBLEMS')
      .sort((a, b) => b.durationMin - a.durationMin)[0]
    if (practice) {
      practice.durationMin += Math.ceil(shortfall / (1 - RETRIEVAL_RATIO) / 5) * 5
    }
  }
  return out.filter((t) => t.durationMin >= 10)
}

// ---------------------------------------------------------------------------
// Sequencing: priority order, interleaving, deep-work chunking
// ---------------------------------------------------------------------------
function chunkTasks(tasks: TaskDraft[], blockLen: number): TaskDraft[] {
  const out: TaskDraft[] = []
  for (const t of tasks) {
    let left = t.durationMin
    while (left > 0) {
      const size = left > blockLen ? blockLen : left
      // Avoid a dangling <15 min fragment: merge it into the previous chunk.
      if (left - size > 0 && left - size < 15) {
        out.push({ ...t, durationMin: left })
        left = 0
      } else {
        out.push({ ...t, durationMin: size })
        left -= size
      }
    }
  }
  return out
}

/**
 * Greedy interleaved sequence: highest-priority subject first (hardest when
 * energy is highest), never more than 2 consecutive chunks of one subject.
 */
function sequenceChunks(chunks: TaskDraft[], ranked: Subject[]): TaskDraft[] {
  const rank = new Map(ranked.map((s, i) => [s.id, i]))
  const queues = new Map<string, TaskDraft[]>()
  for (const c of chunks) {
    if (!queues.has(c.subjectId)) queues.set(c.subjectId, [])
    queues.get(c.subjectId)!.push(c)
  }
  for (const q of queues.values()) {
    q.sort((a, b) => TYPE_ORDER.indexOf(a.taskType) - TYPE_ORDER.indexOf(b.taskType))
  }
  const out: TaskDraft[] = []
  while ([...queues.values()].some((q) => q.length > 0)) {
    const last1 = out[out.length - 1]?.subjectId
    const last2 = out[out.length - 2]?.subjectId
    const blocked = last1 && last1 === last2 ? last1 : null
    const candidates = [...queues.entries()]
      .filter(([id, q]) => q.length > 0 && id !== blocked)
      .sort((a, b) => (rank.get(a[0]) ?? 99) - (rank.get(b[0]) ?? 99))
    const pick = candidates[0] ?? [...queues.entries()].find(([, q]) => q.length > 0)!
    out.push(pick[1].shift()!)
  }
  return out
}

// ---------------------------------------------------------------------------
// Timeline placement around locked events
// ---------------------------------------------------------------------------
function placeBlocks(
  input: GeneratorInput,
  chunks: TaskDraft[],
  gymAfterSubject: string | null,
): Block[] {
  const { user, date, dayOfWeek } = input
  const locked = FIXED_EVENTS.filter((e) => e.day === dayOfWeek).sort((a, b) => a.start - b.start)
  const isGymDay = user.gymDays.includes(dayOfWeek)
  const blocks: Block[] = []
  let cursor = user.wakeMinutes + 30 // morning routine buffer
  let idx = 0
  const mkId = () => `${date}-${idx++}`

  const advancePastLocked = (start: number, dur: number): number => {
    for (const e of locked) {
      if (start < e.start + e.durationMin && start + dur > e.start) {
        return e.start + e.durationMin + 10
      }
    }
    return start
  }

  const push = (partial: Omit<Block, 'id' | 'start' | 'status' | 'actualMinutes'>) => {
    let start = advancePastLocked(cursor, partial.durationMin)
    // A shift may land us inside the next locked window; settle iteratively.
    for (let guard = 0; guard < 4; guard++) {
      const again = advancePastLocked(start, partial.durationMin)
      if (again === start) break
      start = again
    }
    blocks.push({ ...partial, id: mkId(), start, status: 'pending', actualMinutes: 0 })
    cursor = start + partial.durationMin
  }

  let gymPlaced = !isGymDay
  let lastSubject: string | null = null
  for (const c of chunks) {
    // Gym goes right after the hardest subject's run — a reward cue.
    if (!gymPlaced && lastSubject === gymAfterSubject && c.subjectId !== gymAfterSubject) {
      push({ kind: 'gym', subjectId: null, taskType: null, durationMin: GYM_MINUTES, label: 'Gym (protected)', isDebtRepayment: false, topicId: null })
      gymPlaced = true
    }
    push({
      kind: 'study',
      subjectId: c.subjectId,
      taskType: c.taskType,
      durationMin: c.durationMin,
      label: c.label,
      isDebtRepayment: c.isDebtRepayment ?? false,
      topicId: c.topicId ?? null,
      isSpacedReview: c.isSpacedReview,
    })
    lastSubject = c.subjectId
    if (c.durationMin >= 25) {
      push({ kind: 'break', subjectId: null, taskType: null, durationMin: user.breakLengthMin, label: 'Break', isDebtRepayment: false, topicId: null })
    }
  }
  if (!gymPlaced) {
    push({ kind: 'gym', subjectId: null, taskType: null, durationMin: GYM_MINUTES, label: 'Gym (protected)', isDebtRepayment: false, topicId: null })
  }

  // Drop a trailing break.
  while (blocks.length && blocks[blocks.length - 1].kind === 'break') blocks.pop()

  // Locked events render as blocks too.
  for (const e of locked) {
    blocks.push({
      id: mkId(),
      kind: 'locked',
      subjectId: e.subjectId,
      taskType: null,
      start: e.start,
      durationMin: e.durationMin,
      status: 'pending',
      actualMinutes: 0,
      label: e.label,
      isDebtRepayment: false,
      topicId: null,
    })
  }
  return blocks.sort((a, b) => a.start - b.start)
}

// ---------------------------------------------------------------------------
// Main entry — pure function: (input) => DaySchedule
// ---------------------------------------------------------------------------
export function generateDaySchedule(input: GeneratorInput): DaySchedule {
  const { date, dayOfWeek, user, subjects, debts } = input

  const onVacation = user.vacationUntil != null && date <= user.vacationUntil
  if (onVacation) {
    return { date, mode: 'vacation', blocks: [], completionRate: 0, plannedMinutes: 0 }
  }

  // Planned day off (or "0 hours today" check-in): no study, no debt.
  if (input.availableMinutes === 0) {
    return { date, mode: 'off', blocks: [], completionRate: 0, plannedMinutes: 0 }
  }

  const debtTotal = totalDebt(debts)
  const resetWeek = debtTotal > RESET_THRESHOLD_MIN
  const restDay = dayOfWeek === user.restDay

  let mode: DaySchedule['mode'] = 'normal'
  if (restDay) mode = 'rest'
  else if (input.lowEnergy) mode = 'low_energy'
  else if (resetWeek) mode = 'reset'

  // Reset week: reduced targets while debt drains.
  const effectiveSubjects = resetWeek && !restDay
    ? subjects.map((s) => ({ ...s, targetMinutesDay: Math.round((s.targetMinutesDay * 0.6) / 5) * 5 }))
    : subjects

  let tasks: TaskDraft[]
  if (restDay) {
    // Rest day: Spanish only — frequency beats duration for language.
    tasks = [
      { subjectId: 'spanish', taskType: 'REVIEW', durationMin: 10, label: 'Vocab flashcards — keep the chain alive' },
      { subjectId: 'spanish', taskType: 'READ', durationMin: 15, label: 'Comprehensible input — something fun' },
    ]
  } else {
    tasks = enforceRetrievalRatio(buildMenu({ ...input, subjects: effectiveSubjects }))

    if (input.lowEnergy) {
      // 60% load; flashcards and spaced reviews are kept whole — they're the
      // last thing to drop, ever.
      tasks = tasks
        .map((t) =>
          t.taskType === 'REVIEW' || t.isSpacedReview
            ? t
            : { ...t, durationMin: Math.round((t.durationMin * 0.6) / 5) * 5 },
        )
        .filter((t) => t.taskType === 'REVIEW' || t.isSpacedReview || t.durationMin >= 10)
    } else {
      // Debt repayment: capped at 30% extra load, spread over coming days.
      const baseLoad = tasks.reduce((s, t) => s + t.durationMin, 0)
      const plan = repaymentPlan(debts, baseLoad)
      for (const [subjectId, minutes] of Object.entries(plan)) {
        const name = subjects.find((s) => s.id === subjectId)?.name ?? subjectId
        tasks.push({
          subjectId,
          taskType: 'PRACTICE_PROBLEMS',
          durationMin: minutes,
          label: `Debt repayment — ${name} catch-up`,
          isDebtRepayment: true,
        })
      }
    }

    // A reduced-availability day (planned busy day, or a low-hours check-in)
    // caps the whole load, debt repayment included.
    if (input.availableMinutes != null && input.availableMinutes > 0) {
      tasks = capToAvailable(tasks, input.availableMinutes)
    }
  }

  const ranked = rankSubjects(effectiveSubjects, debts, date)
  const chunks = chunkTasks(tasks, user.blockLengthMin)
  const ordered = restDay ? chunks : sequenceChunks(chunks, ranked)
  const gymAfter = ranked[0]?.id ?? null
  const blocks = placeBlocks(input, ordered, restDay ? null : gymAfter)

  const plannedMinutes = blocks
    .filter((b) => b.kind === 'study')
    .reduce((s, b) => s + b.durationMin, 0)

  return { date, mode, blocks, completionRate: 0, plannedMinutes }
}

/** Completion rate over study blocks, counting partials by actual minutes. */
export function computeCompletionRate(blocks: Block[]): number {
  const study = blocks.filter((b) => b.kind === 'study')
  const planned = study.reduce((s, b) => s + b.durationMin, 0)
  if (planned === 0) return 0
  const done = study.reduce((s, b) => {
    if (b.status === 'done') return s + b.durationMin
    if (b.status === 'partial') return s + Math.min(b.actualMinutes, b.durationMin)
    return s
  }, 0)
  return Math.round((done / planned) * 100) / 100
}
