import { useMemo, useState } from 'react'
import { useStore } from '../store/useStore'
import { focusTopics, rag, TOPIC_INTERVALS } from '../engine/topics'
import { localToday } from '../store/useStore'
import type { Subject, Topic } from '../types'

const RAG_STYLE: Record<string, { bg: string; label: string }> = {
  red: { bg: 'var(--bad)', label: 'red' },
  amber: { bg: 'var(--warn)', label: 'amber' },
  green: { bg: 'var(--good)', label: 'green' },
}

/**
 * The syllabus command center: weights, units, topics and confidence.
 * Everything here feeds the scheduler — red topics get attacked first,
 * studied topics come back at expanding intervals.
 */
export default function Subjects() {
  const { subjects, saveSubjects } = useStore()
  const [subs, setSubs] = useState<Subject[]>(() => subjects.map((s) => ({ ...s })))
  const [saved, setSaved] = useState(false)
  const [openWeights, setOpenWeights] = useState(false)

  const setSub = (id: string, patch: Partial<Subject>) =>
    setSubs((ss) => ss.map((s) => (s.id === id ? { ...s, ...patch } : s)))

  const saveWeights = async () => {
    const totalW = subs.reduce((a, s) => a + s.priorityWeight, 0) || 1
    const normalized = subs.map((s) => ({
      ...s,
      priorityWeight: Math.round((s.priorityWeight / totalW) * 100) / 100,
    }))
    await saveSubjects(normalized)
    setSubs(normalized)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="space-y-4 pb-6">
      <div>
        <h1 className="text-2xl font-semibold">Subjects</h1>
        <p className="text-xs text-muted">
          Log your syllabus here and rate each topic honestly. The scheduler attacks red
          topics first and spaces reviews at 1d → 3d → 1w → 3w → 6w after each touch.
        </p>
      </div>

      <section className="rounded-xl border border-line bg-surface">
        <button onClick={() => setOpenWeights(!openWeights)}
          className="flex w-full items-center justify-between px-3 py-2.5 text-sm font-semibold">
          Time allocation
          <span className="text-xs text-muted">
            {subs.map((s) => `${s.name} ${(s.priorityWeight * 100).toFixed(0)}%`).join(' · ')} {openWeights ? '▴' : '▾'}
          </span>
        </button>
        {openWeights && (
          <div className="space-y-3 border-t border-line p-3">
            {subs.map((s) => (
              <div key={s.id} className="grid grid-cols-[1fr_2fr_5rem] items-center gap-3">
                <span className="text-sm font-medium" style={{ color: s.color }}>{s.name}</span>
                <input type="range" min={5} max={60} value={Math.round(s.priorityWeight * 100)}
                  onChange={(e) => setSub(s.id, { priorityWeight: Number(e.target.value) / 100 })} />
                <div className="flex items-center gap-1 text-xs text-muted">
                  <input type="number" min={10} max={180} step={5} value={s.targetMinutesDay}
                    onChange={(e) => setSub(s.id, { targetMinutesDay: Number(e.target.value) })}
                    className="tabular w-14 rounded border border-line bg-raised px-1 py-1 text-center" />
                  m/d
                </div>
              </div>
            ))}
            <div className="flex items-center gap-3">
              <button onClick={() => void saveWeights()}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white">
                Save weights
              </button>
              {saved && <span className="text-sm text-good">Saved ✓</span>}
            </div>
          </div>
        )}
      </section>

      {subjects.map((s) => (
        <SubjectPanel key={s.id} subject={s} />
      ))}
    </div>
  )
}

function SubjectPanel({ subject }: { subject: Subject }) {
  const { topics, errors, addTopic, addTopics, setTopicConfidence, deleteTopic, resolveError } = useStore()
  const [form, setForm] = useState({ unit: '', name: '', confidence: 3 })
  const [adding, setAdding] = useState(false)
  const [bulk, setBulk] = useState(false)
  const [bulkForm, setBulkForm] = useState({ unit: '', names: '', confidence: 3 })
  const today = localToday()

  const mine = topics.filter((t) => t.subjectId === subject.id)
  const myErrors = errors.filter((e) => e.subjectId === subject.id)
  const units = useMemo(() => {
    const map = new Map<string, Topic[]>()
    for (const t of mine) {
      const u = t.unit || 'General'
      map.set(u, [...(map.get(u) ?? []), t])
    }
    return [...map.entries()]
  }, [mine])

  const nextUp = focusTopics(topics, subject.id, today).slice(0, 2)
  const counts = { red: 0, amber: 0, green: 0 }
  for (const t of mine) counts[rag(t.confidence)]++

  const submit = async () => {
    if (!form.name.trim()) return
    await addTopic(subject.id, form.unit || 'General', form.name, form.confidence)
    setForm((f) => ({ ...f, name: '' }))
  }

  const submitBulk = async () => {
    const names = bulkForm.names.split('\n')
    const n = await addTopics(subject.id, bulkForm.unit || 'General', names, bulkForm.confidence)
    if (n > 0) {
      setBulk(false)
      setBulkForm({ unit: '', names: '', confidence: 3 })
    }
  }

  return (
    <section className="rounded-xl border border-line bg-surface p-3"
      style={{ borderLeft: `4px solid ${subject.color}` }}>
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">{subject.name}</h2>
        <span className="text-xs text-muted">{mine.length} topics</span>
        <div className="ml-auto flex items-center gap-2 text-[11px]">
          {(['red', 'amber', 'green'] as const).map((r) => (
            <span key={r} className="flex items-center gap-1 text-muted">
              <span className="h-2 w-2 rounded-full" style={{ background: RAG_STYLE[r].bg }} />
              {counts[r]}
            </span>
          ))}
        </div>
      </div>

      {nextUp.length > 0 && (
        <p className="mt-1 text-xs text-muted">
          Next up: {nextUp.map((t) => t.name).join(' · ')}
        </p>
      )}

      {units.map(([unit, list]) => (
        <div key={unit} className="mt-3">
          <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted">{unit}</h3>
          <div className="mt-1 space-y-1">
            {list.map((t) => (
              <TopicRow key={t.id} topic={t} today={today}
                onConfidence={(c) => void setTopicConfidence(t.id!, c)}
                onDelete={() => void deleteTopic(t.id!)} />
            ))}
          </div>
        </div>
      ))}

      {adding ? (
        <div className="mt-3 space-y-2">
          <div className="flex gap-2">
            <input list={`units-${subject.id}`} value={form.unit} placeholder="Unit (e.g. Mechanics)"
              onChange={(e) => setForm({ ...form, unit: e.target.value })}
              className="w-2/5 rounded-lg border border-line bg-raised px-2.5 py-2 text-sm" />
            <datalist id={`units-${subject.id}`}>
              {units.map(([u]) => <option key={u} value={u} />)}
            </datalist>
            <input value={form.name} placeholder="Topic (e.g. Projectile motion)"
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && void submit()}
              className="flex-1 rounded-lg border border-line bg-raised px-2.5 py-2 text-sm" autoFocus />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted">Confidence</span>
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} onClick={() => setForm({ ...form, confidence: n })}
                className={`h-7 w-7 rounded-full text-xs font-semibold ${
                  form.confidence === n ? 'text-white' : 'bg-raised text-muted'
                }`}
                style={form.confidence === n ? { background: RAG_STYLE[rag(n)].bg } : undefined}>
                {n}
              </button>
            ))}
            <button onClick={() => void submit()}
              className="ml-auto rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white">
              Add
            </button>
            <button onClick={() => setAdding(false)} className="text-sm text-muted">✕</button>
          </div>
        </div>
      ) : bulk ? (
        <div className="mt-3 space-y-2">
          <input list={`units-${subject.id}`} value={bulkForm.unit} placeholder="Unit for all (e.g. Mechanics)"
            onChange={(e) => setBulkForm({ ...bulkForm, unit: e.target.value })}
            className="w-full rounded-lg border border-line bg-raised px-2.5 py-2 text-sm" />
          <datalist id={`units-${subject.id}`}>
            {units.map(([u]) => <option key={u} value={u} />)}
          </datalist>
          <textarea value={bulkForm.names} placeholder="One topic per line — paste your syllabus"
            onChange={(e) => setBulkForm({ ...bulkForm, names: e.target.value })}
            className="h-28 w-full rounded-lg border border-line bg-raised px-2.5 py-2 text-sm" autoFocus />
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted">Confidence for all</span>
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} onClick={() => setBulkForm({ ...bulkForm, confidence: n })}
                className={`h-7 w-7 rounded-full text-xs font-semibold ${
                  bulkForm.confidence === n ? 'text-white' : 'bg-raised text-muted'
                }`}
                style={bulkForm.confidence === n ? { background: RAG_STYLE[rag(n)].bg } : undefined}>
                {n}
              </button>
            ))}
            <button onClick={() => void submitBulk()}
              className="ml-auto rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white">
              Add {bulkForm.names.split('\n').filter((s) => s.trim()).length || ''} topics
            </button>
            <button onClick={() => setBulk(false)} className="text-sm text-muted">✕</button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex items-center gap-3">
          <button onClick={() => setAdding(true)} className="text-sm font-medium text-accent">
            + Add topic
          </button>
          <button onClick={() => setBulk(true)} className="text-sm font-medium text-muted">
            ⣿ Paste a list
          </button>
        </div>
      )}

      {myErrors.length > 0 && (
        <div className="mt-3 border-t border-line pt-2">
          <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted">
            Error log — {myErrors.length} open
          </h3>
          <div className="mt-1 space-y-1">
            {myErrors.map((e) => (
              <div key={e.id} className="flex items-center gap-2 text-xs">
                <span className="rounded-full bg-raised px-2 py-0.5 font-medium text-warn">{e.category}</span>
                <span className="min-w-0 flex-1 truncate text-ink2">{e.note || '—'}</span>
                <span className="text-muted">{e.date.slice(5)}</span>
                <button onClick={() => void resolveError(e.id!)} className="font-medium text-good">
                  fixed ✓
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

function TopicRow({
  topic: t,
  today,
  onConfidence,
  onDelete,
}: {
  topic: Topic
  today: string
  onConfidence: (c: number) => void
  onDelete: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const r = rag(t.confidence)
  const dueNow = t.nextReview != null && t.nextReview <= today

  return (
    <div className="rounded-lg bg-raised px-2.5 py-1.5">
      <div className="flex items-center gap-2">
        <button onClick={() => setExpanded(!expanded)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: RAG_STYLE[r].bg }} />
          <span className="truncate text-sm">{t.name}</span>
        </button>
        {dueNow && (
          <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-[10px] font-medium text-accent">
            review due
          </span>
        )}
        <span className="tabular shrink-0 text-[11px] text-muted">
          {t.lastTouched ? `${t.timesStudied}×` : 'new'}
        </span>
      </div>
      {expanded && (
        <div className="mt-2 flex items-center gap-1.5 pb-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} onClick={() => onConfidence(n)}
              className={`h-7 w-7 rounded-full text-xs font-semibold ${
                t.confidence === n ? 'text-white' : 'bg-surface text-muted'
              }`}
              style={t.confidence === n ? { background: RAG_STYLE[rag(n)].bg } : undefined}>
              {n}
            </button>
          ))}
          <span className="ml-1 text-[11px] text-muted">
            {t.nextReview
              ? `next review ${t.nextReview}`
              : `unstudied — reviews start after first touch (${TOPIC_INTERVALS[0]}d)`}
          </span>
          <button onClick={onDelete} className="ml-auto text-xs text-bad">delete</button>
        </div>
      )}
    </div>
  )
}
