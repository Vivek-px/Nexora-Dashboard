import { useEffect, useState, useSyncExternalStore } from 'react'
import { DOMAINS, actionId, actions, areaName, areasOf, downloadCsv, findings, fmt, savedScenarioActions, scenarioStore, domainVisible } from '../eiq'
import { complaintAction } from '../complaints'
import { api, type ActionState, type Complaint, type UserBrief } from '../api'
import { ActionTracker, STATUSES, isOverdue } from '../ActionTracker'
import { useSession } from '../Session'
import { ClassBadge, PriorityBadge, ScreenBadge, SectionTitle, Select } from '../eui'
import { PageHeader, Panel } from '../ui'
import type { PageProps } from '../App'

const ORDER = (p: string) => (p.startsWith('P1') ? 0 : p.startsWith('P2') ? 1 : 2)

export default function Recommendations({ sel, years }: PageProps) {
  useSyncExternalStore(scenarioStore.subscribe, scenarioStore.all)
  const [complaints, setComplaints] = useState<Complaint[]>([])
  const all = [...actions(sel, years), ...savedScenarioActions(sel), ...complaints.filter((c) => areasOf(sel).includes(c.area) && c.status !== 'dismissed').map(complaintAction)].filter((a) => domainVisible(a.Domain))
    .sort((a, b) => ORDER(a.Priority) - ORDER(b.Priority) || a.Priority.localeCompare(b.Priority) || a.area_id.localeCompare(b.area_id) || a.Domain.localeCompare(b.Domain))
  const [pr, setPr] = useState('All')
  const [dom, setDom] = useState('All')
  const [type, setType] = useState('All action types')
  const [showFindings, setShowFindings] = useState(false)
  const { user, version } = useSession()
  const [states, setStates] = useState<Record<string, ActionState>>({})
  const [people, setPeople] = useState<UserBrief[]>([])
  const [st, setSt] = useState('All statuses')
  const [mine, setMine] = useState(false)
  useEffect(() => {
    api<Record<string, ActionState>>('/actions').then(setStates).catch(() => {})
    api<UserBrief[]>('/users').then(setPeople).catch(() => {})
    api<Complaint[]>('/complaints').then(setComplaints).catch(() => {})
  }, [version])
  const stateOf = (a: (typeof all)[number]) => states[actionId(a)]
  const statusOf = (a: (typeof all)[number]) => (isOverdue(stateOf(a)) ? 'Overdue' : stateOf(a)?.status ?? 'Open')
  const rows = all.filter((a) => (pr === 'All' || a.Priority === pr) && (dom === 'All' || a.Domain === dom) && (type === 'All action types' || a['Action type'] === type)
    && (st === 'All statuses' || statusOf(a) === st) && (!mine || stateOf(a)?.owner_id === user.id))
  const count = (s: string) => all.filter((a) => statusOf(a) === s).length
  const frame = findings(sel, years)
  const execKeys = DOMAINS.map((d) => d.default)
  const exec = frame.filter((f) => execKeys.includes(f.metric_key))
  return (
    <>
      <PageHeader eyebrow="Action queue" title="Recommendations" desc={'Historical screening & action queue. Offline, exploratory decision support: historical evidence, demonstration screening, coverage work and hypothetical outcomes are kept separate. Review tiers are statistical policies, not hazard or compliance assessments.'} accent={'#b65cb9'} />
      <p className="-mt-6 mb-5 text-[11.5px] text-dim">Historical actions follow the selected reporting years. Saved hypothetical scenarios use complete baseline history and remain separately classified.</p>

      <div className="mb-4 grid gap-3 sm:grid-cols-5">
        <Stat k="Open actions" v={count('Open')} tone="text-white" />
        <Stat k="In progress" v={count('In progress')} tone="text-sapphire-soft" />
        <Stat k="Done" v={count('Done')} tone="text-ok" />
        <Stat k="Overdue" v={count('Overdue')} tone="text-crit" />
        <Stat k="Assigned to me" v={all.filter((a) => stateOf(a)?.owner_id === user.id && !['Done', 'Dismissed'].includes(stateOf(a)!.status)).length} tone="text-lav" />
      </div>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat k="High deviations" v={exec.filter((f) => f['Screening result'] === 'High deviation').length} tone="text-crit" />
        <Stat k="Watch indicators" v={exec.filter((f) => f['Screening result'] === 'Watch').length} tone="text-med" />
        <Stat k="Indicators screened" v={exec.length} tone="text-white" />
      </div>
      <p className="mb-4 text-[11.5px] text-dim">Executive counts cover eight domain indicators per area. Detailed screening covers {frame.length} available fields; missing/censored latest results are explicitly unscreened.</p>

      <Panel className="mb-4 overflow-hidden">
        <button className="flex w-full items-center justify-between px-5 py-3.5 text-left" onClick={() => setShowFindings(!showFindings)} aria-expanded={showFindings}>
          <span><span className="block text-[15px] font-semibold text-white">Historical screening ({frame.length} fields)</span><span className="text-[11.5px] text-mute">Every screened indicator with its value, expected reference and reason</span></span>
          <span className="text-lg text-mute">{showFindings ? '−' : '+'}</span>
        </button>
        {showFindings && (
          frame.length ? (
            <div className="max-h-[480px] overflow-auto border-t border-line/60">
              <table className="eiq-table">
                <thead><tr><th>Area</th><th>Domain</th><th>Metric</th><th>Period</th><th>Value</th><th>Expected</th><th>Result</th><th>Evidence</th><th>Reason</th></tr></thead>
                <tbody>{frame.map((x, i) => <tr key={i}><td>{x.Area}</td><td>{x.Domain}</td><td className="text-white">{x.Metric}</td><td className="num">{x['Measurement period']}</td><td className="num">{fmt(x.Value, x.Unit)}</td><td className="num">{fmt(x['Expected reference'])}</td><td><ScreenBadge s={x['Screening result']} /></td><td><ClassBadge cls={x.Classification} /></td><td className="min-w-72 text-[11px] leading-snug text-dim">{x.Reason}</td></tr>)}</tbody>
              </table>
            </div>
          ) : <p className="border-t border-line/60 p-5 text-sm text-mute">No selected monthly period to screen. Coverage work and saved hypothetical scenarios remain separately available.</p>
        )}
      </Panel>

      <Panel className="ai-surface relative">
        <SectionTitle
          title={`Administrator actions · ${rows.length} of ${all.length} · ${areaName(sel)}`}
          sub="Ordered by priority, then area and domain"
          right={
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-44"><Select label="Priority" value={pr} options={['All', ...new Set(all.map((a) => a.Priority))]} onChange={setPr} /></div>
              <div className="w-44"><Select label="Domain" value={dom} options={['All', ...new Set(all.map((a) => a.Domain))]} onChange={setDom} /></div>
              <div className="w-52"><Select label="Action category" value={type} options={['All action types', ...[...new Set(all.map((a) => a['Action type']))].sort()]} onChange={setType} /></div>
              <div className="w-40"><Select label="Status" value={st} options={['All statuses', ...STATUSES, 'Overdue']} onChange={setSt} /></div>
              <label className="flex h-9 items-center gap-1.5 text-[11.5px] text-mute"><input type="checkbox" className="eiq-toggle" checked={mine} onChange={(e) => setMine(e.target.checked)} />Mine</label>
              <button className="eiq-btn" onClick={() => downloadCsv(`${sel}_administrator_actions.csv`, all.map((a) => ({ ...a, Status: statusOf(a), Owner: stateOf(a)?.owner_name ?? '', 'Due date': stateOf(a)?.due_date ?? '' })) as unknown as Record<string, unknown>[])}>Download action queue</button>
            </div>
          }
        />
        <div className="grid gap-3 p-5 lg:grid-cols-2">
          {rows.map((a) => (
            <article key={actionId(a)} className="summary-card" data-indi="rec" data-indi-label={a['Triggering evidence'].split(':')[0]} data-indi-value={a['Triggering evidence']} data-indi-desc={a['Recommended action']}>
              <div className="flex flex-wrap items-center gap-2"><PriorityBadge p={a.Priority} /><span className="text-[11px] text-mute">{a.Area} · {a.Domain} · {a['Action type']}</span><span className="ml-auto"><ClassBadge cls={a.Classification} /></span></div>
              <p className="mt-2 text-[13px] font-medium text-white">{a['Recommended action']}</p>
              <dl className="mt-2 space-y-1 text-[11.5px]">
                <div><dt className="inline text-dim">Trigger: </dt><dd className="inline text-soft">{a['Triggering evidence']}</dd></div>
                <div><dt className="inline text-dim">Owner: </dt><dd className="inline text-soft">{a['Responsible function']}</dd></div>
                <div><dt className="inline text-dim">Expected direction: </dt><dd className="inline text-soft">{a['Expected direction']}</dd></div>
                <div><dt className="inline text-dim">Limitations: </dt><dd className="inline text-mute">{a.Limitations}</dd></div>
                <div><dt className="inline text-dim">Source: </dt><dd className="inline break-all text-mute">{a.Source?.startsWith('http') ? <a className="text-lav hover:text-white" href={a.Source} target="_blank" rel="noreferrer">{a.Source}</a> : a.Source}</dd></div>
              </dl>
              <ActionTracker id={actionId(a)} action={a} state={stateOf(a)} users={people} onChange={(s) => { setStates((m) => ({ ...m, [s.action_id]: s })); if (a['Action type'] === 'Staff complaint') api<Complaint[]>('/complaints').then(setComplaints).catch(() => {}) }} />
            </article>
          ))}
          {!rows.length && <p className="py-10 text-center text-sm text-mute lg:col-span-2">No actions in this category for the selected area.</p>}
        </div>
        <p className="px-5 pb-4 text-[11px] text-dim">Forecast references exclude the latest screened period. |z| ≥ 2: watch; |z| ≥ 3: high statistical deviation. A 2% relative scale floor prevents tiny reference spread from implying calibrated severity. Shared values remain demonstration findings.</p>
      </Panel>
    </>
  )
}

const Stat = ({ k, v, tone }: { k: string; v: number; tone: string }) => (
  <div className="summary-card"><div className="text-[11px] text-mute">{k}</div><div className={`num mt-1 text-2xl font-semibold ${tone}`}>{v}</div></div>
)
