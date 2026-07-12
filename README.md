# Adaptive Study Scheduler

Local-first web app that generates a daily study schedule each morning, tracks
completion, and rolls incomplete work forward with decay-aware rescheduling.
All data lives in the browser (IndexedDB via Dexie) — no backend, works offline.

**Live:** https://claude.ai/code/artifact/74a52c91-4ed7-4232-b32f-ce1b983e2b8f

## Stack

React 19 + Vite + Tailwind v4 · Zustand · Dexie (IndexedDB) · Recharts · Vitest

## Layout

| Path | What it is |
|---|---|
| `src/types.ts` | Domain model: Subject, Block, DaySchedule, Debt, SrsItem, UserState |
| `src/db/schema.ts` | Dexie schema, default subjects/weights, starter Spanish cards |
| `src/engine/scheduleGenerator.ts` | Pure `(input) => DaySchedule`: menu building, retrieval-ratio enforcement, interleaving, placement around locked events |
| `src/engine/srs.ts` | SM-2 variant, intervals 1d→3d→7d→16d→35d, fail resets to stage 0 |
| `src/engine/debt.ts` | Debt decay (50% after 7 days), 30%-per-day repayment cap, reset-week trigger |
| `src/engine/priority.ts` | Nightly score: weight × difficulty × staleness × (1 + debt ratio) |
| `src/store/useStore.ts` | Zustand + Dexie wiring, nightly rollover, streak, block actions |
| `src/ui/` | Today timeline, timer + SRS flashcards, week grid, stats, settings, onboarding |

## Scheduling rules (hardcoded per spec)

- Locked: Physics academy Sat 12–2 PM, Math academy Wed & Fri 4–6 PM
- Gym 4×/week (protected), placed right after the hardest subject's run
- ≥60 % of study minutes must be RECALL or PRACTICE_PROBLEMS
- Never >2 consecutive blocks of one subject; 50/10 deep-work rhythm
- Spanish 25 min daily (10 vocab SRS + 15 input), survives even rest days
- English: 30 min reading daily, 2×/week timed essay, weekly style drill
- Skips/partials create debt; repayment capped at +30 % load/day, spread 3–5 days;
  debt >7 days old decays 50 %; debt >4 h triggers a reset week at 60 % targets

## Commands

```sh
npm run dev      # dev server
npm test         # 23 unit/integration tests (engine + store on fake-indexeddb)
npm run build    # typecheck + single-file bundle in dist/index.html
```

`deploy/study-scheduler.html` is the artifact fragment (dist bundle minus the
document shell) used for publishing.
