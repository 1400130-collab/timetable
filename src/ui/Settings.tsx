import { useRef, useState } from 'react'
import { backupFilename, exportBackup, parseBackup, type BackupFile } from '../db/backup'
import { localToday, useStore } from '../store/useStore'
import { DAY_NAMES } from './util'

function minutesToTime(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
}
function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

export default function Settings() {
  const { user, saveSettings, regenerateToday, resetAll, restoreBackup, markBackedUp, setView } = useStore()
  const [form, setForm] = useState(() => ({
    wake: minutesToTime(user!.wakeMinutes),
    sleep: minutesToTime(user!.sleepMinutes),
    gymDays: [...user!.gymDays],
    restDay: user!.restDay,
    energyProfile: user!.energyProfile,
    currentBook: user!.currentBook,
    blockLengthMin: user!.blockLengthMin,
    breakLengthMin: user!.breakLengthMin,
  }))
  const [saved, setSaved] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [exportJson, setExportJson] = useState<string | null>(null)
  const [staged, setStaged] = useState<{ json: string; backup: BackupFile } | null>(null)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [backupMsg, setBackupMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const toggleGym = (d: number) =>
    setForm((f) => ({
      ...f,
      gymDays: f.gymDays.includes(d) ? f.gymDays.filter((x) => x !== d) : [...f.gymDays, d].sort(),
    }))

  const save = async () => {
    await saveSettings({
      wakeMinutes: timeToMinutes(form.wake),
      sleepMinutes: timeToMinutes(form.sleep),
      gymDays: form.gymDays,
      restDay: form.restDay,
      energyProfile: form.energyProfile,
      currentBook: form.currentBook,
      blockLengthMin: form.blockLengthMin,
      breakLengthMin: form.breakLengthMin,
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const downloadBackup = async () => {
    setBackupMsg(null)
    const json = JSON.stringify(await exportBackup(), null, 2)
    try {
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
      const a = document.createElement('a')
      a.href = url
      a.download = backupFilename(localToday())
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 5000)
      await markBackedUp()
      setBackupMsg({ ok: true, text: 'Backup downloaded ✓ (if no file appeared, use Copy JSON)' })
    } catch {
      setExportJson(json)
      setBackupMsg({ ok: false, text: 'Download blocked here — copy the JSON below into a file instead.' })
    }
  }

  const copyBackup = async () => {
    setBackupMsg(null)
    const json = JSON.stringify(await exportBackup(), null, 2)
    try {
      await navigator.clipboard.writeText(json)
      await markBackedUp()
      setBackupMsg({ ok: true, text: 'Backup JSON copied — paste it into a file somewhere safe.' })
    } catch {
      setExportJson(json)
      setBackupMsg({ ok: false, text: 'Clipboard blocked — select and copy the JSON below.' })
    }
  }

  const stage = (json: string) => {
    setBackupMsg(null)
    try {
      setStaged({ json, backup: parseBackup(json) })
    } catch (e) {
      setStaged(null)
      setBackupMsg({ ok: false, text: e instanceof Error ? e.message : 'Could not read that backup.' })
    }
  }

  const onFile = (f: File | undefined) => {
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => stage(String(reader.result))
    reader.onerror = () => setBackupMsg({ ok: false, text: 'Could not read that file.' })
    reader.readAsText(f)
  }

  const doRestore = async () => {
    if (!staged) return
    try {
      await restoreBackup(staged.json)
      setStaged(null)
      setPasteOpen(false)
      setPasteText('')
      setBackupMsg({ ok: true, text: 'Backup restored ✓ — today’s schedule reloaded.' })
    } catch (e) {
      setBackupMsg({ ok: false, text: e instanceof Error ? e.message : 'Restore failed.' })
    }
  }

  const input = 'w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm'
  const label = 'mb-1 block text-xs font-medium text-muted'
  const smallBtn = 'rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink2'

  return (
    <div className="space-y-5 pb-6">
      <div className="flex items-center gap-3">
        <button
          onClick={() => setView('today')}
          className="grid h-9 w-9 place-items-center rounded-full bg-surface text-lg text-ink2 active:opacity-80"
          aria-label="Back"
        >
          ‹
        </button>
        <h1 className="text-2xl font-semibold">Settings</h1>
      </div>
      <p className="-mt-2 text-xs text-muted">
        Subject weights and topics live in the Subjects tab.
      </p>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Day shape</h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>Wake</label>
            <input type="time" className={input} value={form.wake}
              onChange={(e) => setForm({ ...form, wake: e.target.value })} />
          </div>
          <div>
            <label className={label}>Sleep</label>
            <input type="time" className={input} value={form.sleep}
              onChange={(e) => setForm({ ...form, sleep: e.target.value })} />
          </div>
          <div>
            <label className={label}>Deep work block (min)</label>
            <input type="number" min={25} max={90} className={input} value={form.blockLengthMin}
              onChange={(e) => setForm({ ...form, blockLengthMin: Number(e.target.value) })} />
          </div>
          <div>
            <label className={label}>Break (min)</label>
            <input type="number" min={5} max={30} className={input} value={form.breakLengthMin}
              onChange={(e) => setForm({ ...form, breakLengthMin: Number(e.target.value) })} />
          </div>
          <div>
            <label className={label}>Energy peak</label>
            <select className={input} value={form.energyProfile}
              onChange={(e) => setForm({ ...form, energyProfile: e.target.value as 'morning' | 'evening' })}>
              <option value="morning">Morning</option>
              <option value="evening">Evening</option>
            </select>
          </div>
          <div>
            <label className={label}>Rest day</label>
            <select className={input} value={form.restDay}
              onChange={(e) => setForm({ ...form, restDay: Number(e.target.value) })}>
              {DAY_NAMES.map((d, i) => <option key={d} value={i}>{d}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className={label}>Gym days ({form.gymDays.length}/week)</label>
          <div className="flex gap-1.5">
            {DAY_NAMES.map((d, i) => (
              <button key={d} onClick={() => toggleGym(i)}
                className={`flex-1 rounded-lg border px-1 py-2 text-xs font-medium ${
                  form.gymDays.includes(i)
                    ? 'border-accent bg-accent text-white'
                    : 'border-line bg-surface text-ink2'
                }`}>
                {d}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className={label}>Current book</label>
          <input className={input} value={form.currentBook} placeholder="What are you reading?"
            onChange={(e) => setForm({ ...form, currentBook: e.target.value })} />
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button onClick={() => void save().then(() => regenerateToday())}
          className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white">
          Save & regenerate today
        </button>
        {saved && <span className="text-sm text-good">Saved ✓</span>}
      </div>

      <section className="space-y-3 border-t border-line pt-4">
        <h2 className="text-sm font-semibold">Backup & restore</h2>
        <p className="text-xs text-muted">
          Everything lives in this browser — a cleared browser wipes it all. Download a backup
          every week or so and keep it somewhere safe (Drive, iCloud, email to yourself).
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => void downloadBackup()} className={smallBtn}>
            Download backup
          </button>
          <button onClick={() => void copyBackup()} className={smallBtn}>
            Copy JSON
          </button>
          <button onClick={() => fileRef.current?.click()} className={smallBtn}>
            Restore from file…
          </button>
          <button onClick={() => { setPasteOpen((o) => !o); setBackupMsg(null) }} className={smallBtn}>
            Paste JSON
          </button>
          <input ref={fileRef} type="file" accept=".json,application/json" className="hidden"
            onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = '' }} />
        </div>
        {backupMsg && (
          <p className={`text-sm ${backupMsg.ok ? 'text-good' : 'text-bad'}`}>{backupMsg.text}</p>
        )}
        {exportJson && (
          <textarea readOnly value={exportJson} onFocus={(e) => e.target.select()}
            className={`${input} h-32 font-mono text-xs`} />
        )}
        {pasteOpen && !staged && (
          <div className="space-y-2">
            <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)}
              placeholder="Paste backup JSON here" className={`${input} h-32 font-mono text-xs`} />
            <button onClick={() => stage(pasteText)} disabled={!pasteText.trim()}
              className={`${smallBtn} disabled:opacity-40`}>
              Check backup
            </button>
          </div>
        )}
        {staged && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface p-3">
            <span className="text-sm text-ink2">
              Backup from {staged.backup.exportedAt.slice(0, 10)} —{' '}
              {staged.backup.data.schedules.length} days, {staged.backup.data.topics.length} topics.
              Replace <strong>all</strong> current data?
            </span>
            <button onClick={() => void doRestore()}
              className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white">
              Restore
            </button>
            <button onClick={() => setStaged(null)} className="text-sm text-muted">
              Cancel
            </button>
          </div>
        )}
      </section>

      <section className="border-t border-line pt-4">
        {confirmReset ? (
          <div className="flex items-center gap-3">
            <span className="text-sm text-ink2">
              Delete all schedules, debt, topics, errors and history?
            </span>
            <button
              onClick={() => void resetAll()}
              className="rounded-lg bg-bad px-3 py-1.5 text-sm font-medium text-white">
              Delete everything
            </button>
            <button onClick={() => setConfirmReset(false)} className="text-sm text-muted">
              Cancel
            </button>
          </div>
        ) : (
          <button onClick={() => setConfirmReset(true)} className="text-sm text-bad">
            Reset all data
          </button>
        )}
      </section>
    </div>
  )
}
