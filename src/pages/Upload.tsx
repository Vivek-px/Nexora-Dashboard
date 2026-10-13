/** Feature 1: real data input – upload monthly meter/bill readings (CSV or Excel). */
import { useEffect, useMemo, useState } from 'react'
import { FileSpreadsheet, Undo2, UploadCloud } from 'lucide-react'
import { api, can, type Alert, type Upload as UploadRow } from '../api'
import { AREAS, METRICS, areaName, downloadCsv, fmt, type AreaId, type Reading } from '../eiq'
import { ScreenBadge, SectionTitle, Select } from '../eui'
import { PageHeader, Panel } from '../ui'
import { useSession } from '../Session'

interface Result { saved: number; rows: { area: AreaId; metric: string; month: string; value: number; note: string }[]; errors: string[]; alerts: Alert[] }

export default function UploadPage() {
  const { user, version, reload } = useSession()
  const editable = can(user, 'manager')
  const [file, setFile] = useState<File | null>(null)
  const [area, setArea] = useState<string>(AREAS[0]?.id ?? '')
  const [preview, setPreview] = useState<Result | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [uploads, setUploads] = useState<UploadRow[]>([])
  const [readings, setReadings] = useState<Reading[]>([])
  const [fArea, setFArea] = useState('all')
  const [fMetric, setFMetric] = useState('all')
  useEffect(() => { api<UploadRow[]>('/uploads').then(setUploads).catch(() => {}); api<Reading[]>('/readings').then(setReadings).catch(() => {}) }, [version])

  const send = async (dry: boolean) => {
    if (!file) return
    setBusy(true); setErr(''); if (!dry) setResult(null)
    const form = new FormData(); form.append('file', file); form.append('area', area); form.append('dry_run', String(dry))
    try {
      const r = await api<Result>('/upload', { form })
      if (dry) setPreview(r)
      else { setResult(r); setPreview(null); setFile(null); await reload() }
    } catch (e) { setErr(e instanceof Error ? e.message : 'Upload failed') } finally { setBusy(false) }
  }
  const undo = async (id: number) => {
    if (!confirm('Remove every reading saved by this upload?')) return
    await api(`/uploads/${id}`, { method: 'DELETE' }); await reload()
  }
  const shown = useMemo(() => readings.filter((r) => (fArea === 'all' || r.area === fArea) && (fMetric === 'all' || r.metric === fMetric)), [readings, fArea, fMetric])

  return (
    <>
      <PageHeader eyebrow="Operations" title="Data upload" desc="Add real monthly readings from meters, bills, weighbridges or counters. Uploaded values are labelled “Measured”, replace demonstration values for the same month, and are screened straight away – unusual readings raise alerts." accent="#42d9f5" />

      {editable ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          <Panel>
            <SectionTitle title="Upload a file" sub="CSV or Excel (.xlsx), up to 10 MB" />
            <div className="space-y-4 p-5">
              <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line px-4 py-8 text-center hover:border-lav/50">
                <UploadCloud className="text-lav" />
                <span className="text-sm text-white">{file ? file.name : 'Choose a file'}</span>
                <span className="text-[11.5px] text-mute">{file ? `${(file.size / 1024).toFixed(1)} KB` : 'Click to browse'}</span>
                <input type="file" accept=".csv,.xlsx,.xlsm" className="sr-only" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); setResult(null) }} />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <Select label="Site for files without an 'area' column" value={area} options={AREAS.map((a) => a.id)} onChange={setArea} format={(v) => areaName(v as AreaId)} />
                <div className="flex items-end gap-2">
                  <button className="eiq-btn flex-1" disabled={!file || busy} onClick={() => send(true)}>Check file</button>
                  <button className="eiq-btn eiq-btn-primary flex-1" disabled={!file || busy} onClick={() => send(false)}>{busy ? 'Working…' : 'Save readings'}</button>
                </div>
              </div>
              {err && <p className="rounded-lg border border-crit/40 bg-crit/10 px-3 py-2 text-xs text-crit">{err}</p>}
              {preview && <Outcome r={preview} dry />}
              {result && <Outcome r={result} />}
            </div>
          </Panel>
          <Panel>
            <SectionTitle title="File format" />
            <div className="space-y-3 p-5 text-[12.5px] leading-relaxed text-mute">
              <p><b className="text-white">Long format</b> – one reading per row:</p>
              <pre className="overflow-x-auto rounded-lg bg-ink/70 p-3 text-[11px] text-soft">area,metric,month,value,note{'\n'}palasuni,electricity_kwh,2026-01,29850,Main meter</pre>
              <p><b className="text-white">Wide format</b> – a month column plus one column per indicator (pick the site on the left, or add an <code>area</code> column):</p>
              <pre className="overflow-x-auto rounded-lg bg-ink/70 p-3 text-[11px] text-soft">month,Electricity,Waste generated{'\n'}2026-01,29850,5320</pre>
              <p>Indicators can be written as codes (<code>electricity_kwh</code>) or names (<code>Electricity</code>). Months as <code>2026-01</code>, <code>Jan 2026</code> or a date. Values outside an indicator’s physical range are rejected.</p>
              <a className="eiq-btn w-full" href="/api/upload/template" download><FileSpreadsheet size={13} />Download template CSV</a>
              <details className="text-[11.5px]"><summary className="cursor-pointer text-soft">All indicator codes</summary>
                <ul className="mt-2 max-h-56 space-y-0.5 overflow-y-auto">{Object.entries(METRICS).map(([k, m]) => <li key={k}><code className="text-soft">{k}</code> – {m.name} ({m.unit})</li>)}</ul>
              </details>
            </div>
          </Panel>
        </div>
      ) : <Panel className="p-5 text-sm text-mute">Your role is <b className="text-white">viewer</b>: you can see uploaded readings below, but only managers and admins can upload.</Panel>}

      <Panel className="mt-4 overflow-hidden">
        <SectionTitle title="Upload history" sub="Undo removes every value an upload saved; demonstration values come back automatically" />
        <div className="max-h-72 overflow-auto">
          <table className="eiq-table"><thead><tr><th>#</th><th>File</th><th>Values</th><th>By</th><th>When (UTC)</th><th>Summary</th><th /></tr></thead>
            <tbody>{uploads.map((u) => <tr key={u.id}><td className="num">{u.id}</td><td className="text-white">{u.filename}</td><td className="num">{u.rows}</td><td>{u.user_name}</td><td className="num">{u.created_at.slice(0, 16)}</td><td>{u.summary}</td>
              <td>{editable && !u.summary.includes('undone') && <button className="eiq-btn !px-2 !py-1" onClick={() => undo(u.id)}><Undo2 size={12} />Undo</button>}</td></tr>)}
              {!uploads.length && <tr><td colSpan={7} className="py-6 text-center text-mute">No uploads yet.</td></tr>}</tbody></table>
        </div>
      </Panel>

      <Panel className="mt-4 overflow-hidden">
        <SectionTitle title={`Measured readings (${shown.length})`} sub="Values currently overriding or extending the MVP export" right={
          <div className="flex items-end gap-2">
            <div className="w-44"><Select label="Site" value={fArea} options={['all', ...AREAS.map((a) => a.id)]} onChange={setFArea} format={(v) => (v === 'all' ? 'All sites' : areaName(v as AreaId))} /></div>
            <div className="w-56"><Select label="Indicator" value={fMetric} options={['all', ...new Set(readings.map((r) => r.metric))]} onChange={setFMetric} format={(v) => (v === 'all' ? 'All indicators' : METRICS[v]?.name ?? v)} /></div>
            <button className="eiq-btn" onClick={() => downloadCsv('measured_readings.csv', shown as unknown as Record<string, unknown>[])}>Export CSV</button>
          </div>} />
        <div className="max-h-96 overflow-auto">
          <table className="eiq-table"><thead><tr><th>Site</th><th>Indicator</th><th>Month</th><th>Value</th><th>Note</th><th>By</th><th>Saved (UTC)</th></tr></thead>
            <tbody>{shown.map((r) => <tr key={r.id}><td>{areaName(r.area)}</td><td className="text-white">{METRICS[r.metric]?.name ?? r.metric}</td><td className="num">{r.month}</td><td className="num">{fmt(r.value, METRICS[r.metric]?.unit)}</td><td className="text-[11px]">{r.note}</td><td>{r.user_name}</td><td className="num">{r.created_at.slice(0, 16)}</td></tr>)}
              {!shown.length && <tr><td colSpan={7} className="py-6 text-center text-mute">No measured readings yet – the dashboard is showing the MVP export only.</td></tr>}</tbody></table>
        </div>
      </Panel>
    </>
  )
}

function Outcome({ r, dry }: { r: Result; dry?: boolean }) {
  return (
    <div className="space-y-2 rounded-lg border border-line p-3 text-xs">
      <p className="text-soft">{dry ? <>Check only – <b className="text-white">{r.rows.length}</b> values are ready to save.</> : <>Saved <b className="text-white">{r.saved}</b> values.</>} {r.errors.length > 0 && <span className="text-med">{r.errors.length} row problems.</span>}</p>
      {dry && r.rows.length > 0 && (
        <div className="max-h-48 overflow-auto rounded border border-line/60"><table className="eiq-table"><thead><tr><th>Site</th><th>Indicator</th><th>Month</th><th>Value</th></tr></thead>
          <tbody>{r.rows.slice(0, 100).map((x, i) => <tr key={i}><td>{areaName(x.area)}</td><td>{METRICS[x.metric]?.name}</td><td className="num">{x.month}</td><td className="num">{fmt(x.value, METRICS[x.metric]?.unit)}</td></tr>)}</tbody></table></div>
      )}
      {r.errors.length > 0 && <ul className="max-h-40 list-disc space-y-0.5 overflow-y-auto pl-5 text-med">{r.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
      {!dry && (r.alerts.length ? (
        <div className="space-y-1"><p className="font-medium text-white">New alerts raised:</p>{r.alerts.map((a) => <p key={a.id} className="flex items-start gap-2"><ScreenBadge s={a.level} /><span className="text-soft">{a.message}</span></p>)}
          <p className="text-dim">WhatsApp/SMS messages are being sent to the matching recipients – see the bell icon for delivery status.</p></div>
      ) : <p className="text-dim">No unusual readings – nothing to alert.</p>)}
    </div>
  )
}
