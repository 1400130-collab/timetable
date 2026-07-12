import { create } from 'zustand'
import { importBackup, parseBackup } from '../db/backup'
import { db, DEFAULT_SUBJECTS, DEFAULT_USER } from '../db/schema'
import { addDays } from '../engine/dates'
import { applyRepayment, decayDebts, totalDebt } from '../engine/debt'
import { computeCompletionRate, generateDaySchedule } from '../engine/scheduleGenerator'
import { touchTopic } from '../engine/topics'
import type {
  Block,
  DayPlan,
  DaySchedule,
  Debt,
  ErrorCategory,
  ErrorLog,
  GeneratorInput,
  Subject,
  Topic,
  UserState,
} from '../types'

export function localToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function dayOfWeek(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).getDay()
}

/** Monday-based start of week. */
function weekStart(iso: string): string {
  const dow = dayOfWeek(iso)
  return addDays(iso, dow === 0 ? -6 : 1 - dow)
}

export interface WrapUp {
  blockId: string
  /** Confidence chosen in the wrap-up panel, applied to the block's topic. */
  confidence?: number
  paper?: { predicted: number; actual: number; maxScore: number }
}

interface StoreState {
  ready: boolean
  user: UserState | null
  subjects: Subject[]
  today: DaySchedule | null
  debts: Debt[]
  topics: Topic[]
  errors: ErrorLog[]
  dayPlans: DayPlan[]
  activeBlockId: string | null
  checkinOpen: boolean
  view: 'today' | 'week' | 'subjects' | 'insights' | 'settings'

  init: () => Promise<void>
  openCheckin: () => void
  closeCheckin: () => void
  completeOnboarding: (u: Partial<UserState>, ratings: Record<string, number>) => Promise<void>
  regenerateToday: (opts?: { lowEnergy?: boolean; availableMinutes?: number }) => Promise<void>
  submitCheckin: (opts: { lowEnergy?: boolean; availableMinutes?: number }) => Promise<void>
  setDayPlan: (date: string, availableMinutes: number | null) => Promise<void>
  markBackedUp: () => Promise<void>
  setView: (v: StoreState['view']) => void
  startBlock: (id: string) => void
  stopTimer: () => void
  finishBlock: (id: string, wrapUp?: Omit<WrapUp, 'blockId'>, actualMinutes?: number) => Promise<void>
  skipBlock: (id: string, reason: string) => Promise<void>
  partialBlock: (id: string, minutes: number) => Promise<void>
  moveBlock: (id: string, dir: -1 | 1) => Promise<void>
  startVacation: (days: number) => Promise<void>
  endVacation: () => Promise<void>
  addTopic: (subjectId: string, unit: string, name: string, confidence: number) => Promise<void>
  addTopics: (subjectId: string, unit: string, names: string[], confidence: number) => Promise<number>
  setTopicConfidence: (topicId: number, confidence: number) => Promise<void>
  deleteTopic: (topicId: number) => Promise<void>
  logError: (subjectId: string, category: ErrorCategory, note: string, topicId?: number | null) => Promise<void>
  resolveError: (errorId: number) => Promise<void>
  saveSettings: (u: Partial<UserState>, subjects?: Subject[]) => Promise<void>
  saveSubjects: (subjects: Subject[]) => Promise<void>
  restoreBackup: (json: string) => Promise<void>
  resetAll: () => Promise<void>
}

async function generatorInput(
  date: string,
  user: UserState,
  subjects: Subject[],
  debts: Debt[],
  opts: { lowEnergy?: boolean; availableMinutes?: number } = {},
): Promise<GeneratorInput> {
  // A stored day plan supplies availability unless the caller overrode it
  // (e.g. this morning's check-in). `??` preserves an explicit 0 = day off.
  const plan = await db.dayPlans.get(date)
  const availableMinutes = opts.availableMinutes ?? plan?.availableMinutes
  const topics = await db.topics.toArray()
  const openErrors = (await db.errorLogs.toArray()).filter((e) => !e.resolved)
  const unresolvedErrors: Record<string, number> = {}
  const catCount: Record<string, Record<string, number>> = {}
  for (const e of openErrors) {
    unresolvedErrors[e.subjectId] = (unresolvedErrors[e.subjectId] ?? 0) + 1
    catCount[e.subjectId] = catCount[e.subjectId] ?? {}
    catCount[e.subjectId][e.category] = (catCount[e.subjectId][e.category] ?? 0) + 1
  }
  const topErrorCategory: GeneratorInput['topErrorCategory'] = {}
  for (const [sid, cats] of Object.entries(catCount)) {
    topErrorCategory[sid] = (Object.entries(cats).sort((a, b) => b[1] - a[1])[0]?.[0] ??
      undefined) as ErrorCategory | undefined
  }

  const ws = weekStart(date)
  const weekSessions = await db.sessions.where('date').aboveOrEqual(ws).toArray()
  const writes = weekSessions.filter((s) => s.taskType === 'WRITE' && s.subjectId === 'english')
  const papersDoneThisWeek: Record<string, boolean> = {}
  for (const s of weekSessions) {
    if (s.taskType === 'PAST_PAPER') papersDoneThisWeek[s.subjectId] = true
  }
  return {
    date,
    dayOfWeek: dayOfWeek(date),
    user,
    subjects,
    debts,
    topics,
    unresolvedErrors,
    topErrorCategory,
    essaysThisWeek: writes.filter((w) => w.minutes >= 30).length,
    rewriteDoneThisWeek: writes.some((w) => w.minutes < 30),
    papersDoneThisWeek,
    lowEnergy: opts.lowEnergy ?? false,
    availableMinutes,
  }
}

/** Roll past unfinished days into debt, update streak, decay old debt. */
async function nightlyRollover(user: UserState): Promise<UserState> {
  const today = localToday()
  const pastSchedules = await db.schedules.where('date').below(today).toArray()
  const plannedDates = new Set((await db.dayPlans.toArray()).map((p) => p.date))
  let streak = user.streak
  const unfinalized = pastSchedules
    .filter((s) => !user.lastFinalizedDate || s.date > user.lastFinalizedDate)
    .sort((a, b) => a.date.localeCompare(b.date))
  for (const sched of unfinalized) {
    if (sched.mode === 'vacation') continue // debt frozen
    // Planned busy days were pre-committed — they never become debt, and they
    // don't break the streak either (neutral).
    if (plannedDates.has(sched.date) || sched.mode === 'off') continue
    for (const b of sched.blocks) {
      if (b.kind !== 'study' || b.isDebtRepayment) continue
      if (b.status === 'pending' || b.status === 'active') {
        await db.debts.add({
          subjectId: b.subjectId!,
          minutesOwed: b.durationMin,
          createdDate: sched.date,
          reason: 'unfinished day',
          decayed: false,
        })
      }
    }
    const rate = computeCompletionRate(sched.blocks)
    await db.schedules.update(sched.date, { completionRate: rate })
    if (sched.mode !== 'rest') {
      streak = rate >= 0.7 ? streak + 1 : 0
    }
  }
  // Decay: rewrite the debts table through the pure decay function.
  const debts = await db.debts.toArray()
  const decayed = decayDebts(debts, today)
  await db.debts.clear()
  if (decayed.length) await db.debts.bulkAdd(decayed.map(({ id, ...rest }) => rest as Debt))

  const updated: UserState = {
    ...user,
    streak,
    lastFinalizedDate: addDays(today, -1),
    vacationUntil: user.vacationUntil && user.vacationUntil < today ? null : user.vacationUntil,
  }
  await db.userState.put(updated)
  return updated
}

async function loadSideState() {
  return {
    topics: await db.topics.toArray(),
    errors: (await db.errorLogs.toArray()).filter((e) => !e.resolved),
    debts: await db.debts.toArray(),
    dayPlans: await db.dayPlans.toArray(),
  }
}

export const useStore = create<StoreState>((set, get) => ({
  ready: false,
  user: null,
  subjects: [],
  today: null,
  debts: [],
  topics: [],
  errors: [],
  dayPlans: [],
  activeBlockId: null,
  checkinOpen: false,
  view: 'today',

  openCheckin: () => set({ checkinOpen: true }),
  closeCheckin: () => set({ checkinOpen: false }),

  init: async () => {
    let user = await db.userState.get('me')
    if (!user) {
      user = DEFAULT_USER
      await db.userState.put(user)
      await db.subjects.bulkPut(DEFAULT_SUBJECTS)
    }
    if (user.onboarded) {
      user = await nightlyRollover(user)
    }
    const subjects = await db.subjects.toArray()
    const side = await loadSideState()
    const today = localToday()
    let sched = (await db.schedules.get(today)) ?? null
    if (!sched && user.onboarded) {
      sched = generateDaySchedule(await generatorInput(today, user, subjects, side.debts))
      await db.schedules.put(sched)
    }
    // Surface the morning check-in once per day (never on a frozen vacation day).
    const checkinOpen =
      user.onboarded && sched != null && sched.mode !== 'vacation' && user.lastCheckinDate !== today
    set({ ready: true, user, subjects, today: sched, checkinOpen, ...side })
  },

  completeOnboarding: async (partial, ratings) => {
    const user: UserState = { ...DEFAULT_USER, ...partial, onboarded: true }
    await db.userState.put(user)
    // Self-rating 1 (weak) → ×1.45 difficulty, 5 (strong) → ×0.85.
    const subjects = DEFAULT_SUBJECTS.map((s) => ({
      ...s,
      difficultyMultiplier: ratings[s.id]
        ? Math.round((1.6 - ratings[s.id] * 0.15) * 100) / 100
        : s.difficultyMultiplier,
    }))
    await db.subjects.bulkPut(subjects)
    set({ user, subjects, ...(await loadSideState()) })
    await get().regenerateToday()
    set({ ready: true })
  },

  regenerateToday: async (opts) => {
    const { user, subjects } = get()
    if (!user) return
    const debts = await db.debts.toArray()
    const today = localToday()
    const existing = await db.schedules.get(today)
    const input = await generatorInput(today, user, subjects, debts, {
      lowEnergy: opts?.lowEnergy,
      availableMinutes: opts?.availableMinutes,
    })
    const fresh = generateDaySchedule(input)
    if (existing) {
      // Preserve completed/skipped work; only replace what's still pending.
      const settled = existing.blocks.filter(
        (b) => b.kind === 'study' && b.status !== 'pending' && b.status !== 'active',
      )
      const settledMin = new Map<string, number>()
      for (const b of settled) {
        settledMin.set(b.subjectId!, (settledMin.get(b.subjectId!) ?? 0) + b.durationMin)
      }
      // Drop regenerated study minutes already settled today (per subject, FIFO).
      fresh.blocks = fresh.blocks.filter((b) => {
        if (b.kind !== 'study') return true
        const left = settledMin.get(b.subjectId!) ?? 0
        if (left >= b.durationMin) {
          settledMin.set(b.subjectId!, left - b.durationMin)
          return false
        }
        return true
      })
      // Settled blocks keep their original ids; re-id fresh ones to avoid collisions.
      fresh.blocks = fresh.blocks.map((b, i) => ({ ...b, id: `${fresh.date}-r${i}` }))
      // Re-flow remaining blocks to start after the settled work, avoiding locked windows.
      const lockedWindows = fresh.blocks
        .filter((b) => b.kind === 'locked')
        .map((b) => ({ start: b.start, end: b.start + b.durationMin }))
      let cursor = Math.max(
        user.wakeMinutes + 30,
        ...settled.map((b) => b.start + b.durationMin),
      )
      for (const b of fresh.blocks) {
        if (b.kind === 'locked') continue
        for (let guard = 0; guard < 4; guard++) {
          const hit = lockedWindows.find((w) => cursor < w.end && cursor + b.durationMin > w.start)
          if (!hit) break
          cursor = hit.end + 10
        }
        b.start = cursor
        cursor += b.durationMin
      }
      fresh.blocks = [...settled, ...fresh.blocks].sort((a, b) => a.start - b.start)
      // Re-id the whole merged list so a settled block from a prior regenerate
      // (already `${date}-rN`) can never collide with a freshly re-id'd one.
      fresh.blocks = fresh.blocks.map((b, i) => ({ ...b, id: `${fresh.date}-m${i}` }))
      fresh.completionRate = computeCompletionRate(fresh.blocks)
      fresh.plannedMinutes = fresh.blocks
        .filter((b) => b.kind === 'study')
        .reduce((s, b) => s + b.durationMin, 0)
    }
    await db.schedules.put(fresh)
    set({ today: fresh, debts })
  },

  setView: (view) => set({ view }),
  startBlock: (id) => set({ activeBlockId: id }),
  stopTimer: () => set({ activeBlockId: null }),

  finishBlock: async (id, wrapUp, actualMinutes) => {
    const { today, subjects } = get()
    if (!today) return
    const block = today.blocks.find((b) => b.id === id)
    if (!block) return
    await settleBlock(block, 'done', actualMinutes ?? block.durationMin)
    const date = localToday()
    if (block.subjectId) {
      const s = subjects.find((x) => x.id === block.subjectId)
      if (s) await db.subjects.update(s.id, { lastTouched: date })
    }
    // Topic spacing: a completed block advances its topic's review schedule.
    if (block.topicId != null) {
      const topic = await db.topics.get(block.topicId)
      if (topic) await db.topics.put(touchTopic(topic, date, wrapUp?.confidence))
    }
    if (wrapUp?.paper && block.subjectId) {
      await db.paperLogs.add({
        date,
        subjectId: block.subjectId,
        predicted: wrapUp.paper.predicted,
        actual: wrapUp.paper.actual,
        maxScore: wrapUp.paper.maxScore,
      })
    }
    await refreshToday(set, get)
    set({ activeBlockId: null })
  },

  skipBlock: async (id, reason) => {
    const { today } = get()
    const block = today?.blocks.find((b) => b.id === id)
    if (!block || !today) return
    block.status = 'skipped'
    if (block.kind === 'study' && !block.isDebtRepayment && today.mode !== 'vacation') {
      await db.debts.add({
        subjectId: block.subjectId!,
        minutesOwed: block.durationMin,
        createdDate: localToday(),
        reason,
        decayed: false,
      })
    }
    await db.schedules.put({ ...today, completionRate: computeCompletionRate(today.blocks) })
    await refreshToday(set, get)
  },

  partialBlock: async (id, minutes) => {
    const { today } = get()
    const block = today?.blocks.find((b) => b.id === id)
    if (!block || !today) return
    const done = Math.max(0, Math.min(minutes, block.durationMin))
    await settleBlock(block, 'partial', done)
    const remainder = block.durationMin - done
    if (remainder >= 5 && block.kind === 'study' && !block.isDebtRepayment) {
      await db.debts.add({
        subjectId: block.subjectId!,
        minutesOwed: remainder,
        createdDate: localToday(),
        reason: 'partial',
        decayed: false,
      })
    }
    await refreshToday(set, get)
    set({ activeBlockId: null })
  },

  moveBlock: async (id, dir) => {
    const { today } = get()
    if (!today) return
    const study = today.blocks.filter((b) => b.kind !== 'locked')
    const idx = study.findIndex((b) => b.id === id)
    const target = idx + dir
    if (idx < 0 || target < 0 || target >= study.length) return
    ;[study[idx], study[target]] = [study[target], study[idx]]
    // Re-flow start times over the non-locked sequence, skipping locked windows.
    const locked = today.blocks.filter((b) => b.kind === 'locked')
    let cursor = Math.min(...today.blocks.map((b) => b.start))
    for (const b of study) {
      for (const e of locked) {
        if (cursor < e.start + e.durationMin && cursor + b.durationMin > e.start) {
          cursor = e.start + e.durationMin + 10
        }
      }
      b.start = cursor
      cursor += b.durationMin
    }
    const blocks = [...study, ...locked].sort((a, b) => a.start - b.start)
    const updated = { ...today, blocks }
    await db.schedules.put(updated)
    set({ today: updated })
  },

  startVacation: async (days) => {
    const { user } = get()
    if (!user) return
    const until = addDays(localToday(), days - 1)
    const updated = { ...user, vacationUntil: until }
    await db.userState.put(updated)
    set({ user: updated })
    await get().regenerateToday()
  },

  endVacation: async () => {
    const { user } = get()
    if (!user) return
    const updated = { ...user, vacationUntil: null }
    await db.userState.put(updated)
    set({ user: updated })
    await get().regenerateToday()
  },

  addTopic: async (subjectId, unit, name, confidence) => {
    await db.topics.add({
      subjectId,
      unit: unit.trim(),
      name: name.trim(),
      confidence,
      lastTouched: null,
      nextReview: null,
      reviewStage: 0,
      timesStudied: 0,
      createdDate: localToday(),
    })
    set({ topics: await db.topics.toArray() })
  },

  addTopics: async (subjectId, unit, names, confidence) => {
    const today = localToday()
    const clean = names.map((n) => n.trim()).filter(Boolean)
    if (clean.length === 0) return 0
    await db.topics.bulkAdd(
      clean.map((name) => ({
        subjectId,
        unit: unit.trim() || 'General',
        name,
        confidence,
        lastTouched: null,
        nextReview: null,
        reviewStage: 0,
        timesStudied: 0,
        createdDate: today,
      })),
    )
    set({ topics: await db.topics.toArray() })
    return clean.length
  },

  setTopicConfidence: async (topicId, confidence) => {
    await db.topics.update(topicId, { confidence })
    set({ topics: await db.topics.toArray() })
  },

  deleteTopic: async (topicId) => {
    await db.topics.delete(topicId)
    set({ topics: await db.topics.toArray() })
  },

  logError: async (subjectId, category, note, topicId = null) => {
    await db.errorLogs.add({
      date: localToday(),
      subjectId,
      topicId,
      category,
      note: note.trim(),
      resolved: false,
    })
    set({ errors: (await db.errorLogs.toArray()).filter((e) => !e.resolved) })
  },

  resolveError: async (errorId) => {
    await db.errorLogs.update(errorId, { resolved: true })
    set({ errors: (await db.errorLogs.toArray()).filter((e) => !e.resolved) })
  },

  saveSettings: async (partial, subjects) => {
    const { user } = get()
    if (!user) return
    const updated = { ...user, ...partial }
    await db.userState.put(updated)
    if (subjects) {
      await db.subjects.bulkPut(subjects)
      set({ subjects })
    }
    set({ user: updated })
  },

  saveSubjects: async (subjects) => {
    await db.subjects.bulkPut(subjects)
    set({ subjects })
  },

  submitCheckin: async ({ lowEnergy, availableMinutes }) => {
    const { user } = get()
    if (!user) return
    const updated = { ...user, lastCheckinDate: localToday() }
    await db.userState.put(updated)
    set({ user: updated })
    await get().regenerateToday({ lowEnergy, availableMinutes })
  },

  setDayPlan: async (date, availableMinutes) => {
    if (availableMinutes == null) {
      await db.dayPlans.delete(date)
    } else {
      await db.dayPlans.put({ date, availableMinutes })
    }
    set({ dayPlans: await db.dayPlans.toArray() })
    // If the plan is for today, rebuild today's schedule to match.
    if (date === localToday()) await get().regenerateToday()
  },

  markBackedUp: async () => {
    const { user } = get()
    if (!user) return
    const updated = { ...user, lastBackupDate: localToday() }
    await db.userState.put(updated)
    set({ user: updated })
  },

  restoreBackup: async (json) => {
    // parseBackup throws user-facing messages; let the caller surface them.
    await importBackup(parseBackup(json))
    // Re-run startup on the restored data: rollover of any days since the
    // backup was taken, then load or generate today's schedule.
    await get().init()
  },

  resetAll: async () => {
    // Clear every table and re-seed defaults, then drop the store back to the
    // onboarding state. Avoids window.location.reload(), which throws in the
    // sandboxed artifact iframe.
    await Promise.all([
      db.subjects.clear(),
      db.schedules.clear(),
      db.debts.clear(),
      db.topics.clear(),
      db.errorLogs.clear(),
      db.paperLogs.clear(),
      db.sessions.clear(),
      db.userState.clear(),
      db.dayPlans.clear(),
    ])
    await db.userState.put(DEFAULT_USER)
    await db.subjects.bulkPut(DEFAULT_SUBJECTS)
    set({
      ready: true,
      user: DEFAULT_USER, // onboarded: false → App shows onboarding
      subjects: DEFAULT_SUBJECTS,
      today: null,
      debts: [],
      topics: [],
      errors: [],
      dayPlans: [],
      activeBlockId: null,
      view: 'today',
    })
  },
}))

async function settleBlock(block: Block, status: Block['status'], minutes: number) {
  block.status = status
  block.actualMinutes = minutes
  if (block.kind === 'study' && minutes > 0) {
    await db.sessions.add({
      date: localToday(),
      subjectId: block.subjectId!,
      taskType: block.taskType!,
      minutes,
      topicId: block.topicId,
    })
    if (block.isDebtRepayment) {
      const debts = await db.debts.toArray()
      const remaining = applyRepayment(debts, block.subjectId!, minutes)
      await db.debts.clear()
      if (remaining.length) {
        await db.debts.bulkAdd(remaining.map(({ id, ...rest }) => rest as Debt))
      }
    }
  }
}

async function refreshToday(
  set: (s: Partial<StoreState>) => void,
  get: () => StoreState,
) {
  const { today } = get()
  if (today) {
    today.completionRate = computeCompletionRate(today.blocks)
    await db.schedules.put(today)
  }
  set({
    today: today ? { ...today, blocks: [...today.blocks] } : null,
    ...(await loadSideState()),
  })
}

export function debtMinutes(debts: Debt[]): number {
  return totalDebt(debts)
}
