import { useState } from 'react'
import { DEFAULT_SUBJECTS } from '../db/schema'
import { useStore } from '../store/useStore'
import { DAY_NAMES } from './util'

const RATING_WORDS = ['—', 'Weak', 'Shaky', 'OK', 'Solid', 'Strong']

export default function Onboarding() {
  const completeOnboarding = useStore((s) => s.completeOnboarding)
  const [step, setStep] = useState(0)
  const [wake, setWake] = useState('08:00')
  const [sleep, setSleep] = useState('23:00')
  const [gymDays, setGymDays] = useState<number[]>([1, 2, 4, 6])
  const [book, setBook] = useState('')
  const [ratings, setRatings] = useState<Record<string, number>>({
    math: 3, physics: 3, spanish: 2, english: 3,
  })

  const toMin = (t: string) => {
    const [h, m] = t.split(':').map(Number)
    return h * 60 + m
  }
  const toggleGym = (d: number) =>
    setGymDays((g) => (g.includes(d) ? g.filter((x) => x !== d) : [...g, d].sort()))

  const finish = () =>
    void completeOnboarding(
      { wakeMinutes: toMin(wake), sleepMinutes: toMin(sleep), gymDays, currentBook: book },
      ratings,
    )

  const input = 'w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm'

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center p-6">
      <h1 className="text-2xl font-bold">Study Scheduler</h1>
      <p className="mt-1 text-sm text-muted">
        A daily plan that adapts when life happens. {step + 1} of 3
      </p>

      <div className="mt-8 space-y-5">
        {step === 0 && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="min-w-0">
                <label className="mb-1 block text-xs font-medium text-muted">I wake at</label>
                <input type="time" className={input} value={wake} onChange={(e) => setWake(e.target.value)} />
              </div>
              <div className="min-w-0">
                <label className="mb-1 block text-xs font-medium text-muted">I sleep at</label>
                <input type="time" className={input} value={sleep} onChange={(e) => setSleep(e.target.value)} />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">
                Gym days — pick 4 (protected blocks, scheduled after your hardest work)
              </label>
              <div className="flex gap-1.5">
                {DAY_NAMES.map((d, i) => (
                  <button key={d} onClick={() => toggleGym(i)}
                    className={`flex-1 rounded-lg border px-1 py-2.5 text-xs font-medium ${
                      gymDays.includes(i)
                        ? 'border-accent bg-accent text-white'
                        : 'border-line bg-surface text-ink2'
                    }`}>
                    {d}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {step === 1 && (
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">
              Current book (daily 30-min reading, pages logged)
            </label>
            <input className={input} value={book} placeholder="e.g. East of Eden"
              onChange={(e) => setBook(e.target.value)} autoFocus />
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <p className="text-sm text-ink2">
              Rate yourself honestly — weaker subjects get harder scheduling priority.
            </p>
            {DEFAULT_SUBJECTS.map((s) => (
              <div key={s.id}>
                <div className="mb-1 flex justify-between text-sm">
                  <span className="font-medium">{s.name}</span>
                  <span className="text-muted">{RATING_WORDS[ratings[s.id]]}</span>
                </div>
                <input type="range" min={1} max={5} value={ratings[s.id]}
                  onChange={(e) => setRatings({ ...ratings, [s.id]: Number(e.target.value) })}
                  className="w-full" />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-8 flex gap-3">
        {step > 0 && (
          <button onClick={() => setStep(step - 1)}
            className="rounded-lg border border-line px-4 py-2.5 text-sm text-ink2">
            Back
          </button>
        )}
        <button
          onClick={() => (step < 2 ? setStep(step + 1) : finish())}
          className="flex-1 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white">
          {step < 2 ? 'Next' : 'Generate my first day →'}
        </button>
      </div>
    </div>
  )
}
