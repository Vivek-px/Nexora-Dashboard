/** Feature 7: the plain-language "Today" page – what needs attention, in sentences a non-technical manager can act on. */
import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowRight, CheckCircle2, CloudRain, IndianRupee, ListChecks, MessageSquareWarning, Wind } from 'lucide-react'
import { api, type ActionState, type Alert, type Bills, type Complaint } from '../api'
import { actionId, actions, areaName, areasOf, findings, METRICS, savedScenarioActions, type Selection, domainVisible } from '../eiq'
import { complaintAction } from '../complaints'
import { isOverdue } from '../ActionTracker'
import { useLive, rainWord } from '../LivePanel'
import { PageHeader, Panel } from '../ui'
import { useSession } from '../Session'
import type { Go, Page } from '../App'

interface Item { tone: 'bad' | 'warn' | 'ok'; icon: typeof AlertTriangle; text: string; action?: { label: string; go: () => void } }

export default function Today({ sel, years, go }: { sel: Selection; years: number[]; go: Go }) {
  const { user, version } = useSession()
  const { live } = useLive()
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [states, setStates] = useState<Record<string, ActionState>>({})
  const [complaints, setComplaints] = useState<Complaint[]>([])
  const [bills, setBills] = useState<Record<string, Bills>>({})
  useEffect(() => {
    api<Alert[]>('/alerts').then(setAlerts).catch(() => {})
    api<Record<string, ActionState>>('/actions').then(setStates).catch(() => {})
    api<Complaint[]>('/complaints').then(setComplaints).catch(() => {})
    if (user.pages.includes('bills')) api<Record<string, Bills>>('/bills').then(setBills).catch(() => {})
  }, [version])
  const areas = areasOf(sel)

  const items = useMemo(() => {
    const out: Item[] = []
    // Only offer buttons to pages this person's job profile includes, and only talk about their domains.
    const can = (p: string) => user.pages.includes(p)
    const dom = (d: string) => user.domains.includes(d)
    const act = (p: Page, label: string, f: () => void) => (can(p) ? { label, go: f } : undefined)
    const openAlerts = alerts.filter((a) => a.status === 'open' && areas.includes(a.area))
    if (openAlerts.length) out.push({ tone: 'bad', icon: AlertTriangle, text: `${openAlerts.length} unusual reading${openAlerts.length > 1 ? 's are' : ' is'} waiting for someone to look at ${openAlerts.length > 1 ? 'them' : 'it'} – for example ${METRICS[openAlerts[0].metric]?.name.toLowerCase() ?? openAlerts[0].metric} at ${areaName(openAlerts[0].area)} (${openAlerts[0].month}).`, action: { label: 'Open alerts', go: () => document.querySelector<HTMLButtonElement>('[aria-label^="Alerts,"]')?.click() } })
    const myComplaints = complaints.filter((c) => areas.includes(c.area) && c.status !== 'dismissed')
    const all = [...actions(sel, years), ...savedScenarioActions(sel), ...myComplaints.map(complaintAction)].filter((a) => domainVisible(a.Domain))
    const overdue = all.filter((a) => isOverdue(states[actionId(a)]))
    if (overdue.length) out.push({ tone: 'bad', icon: ListChecks, text: `${overdue.length} action${overdue.length > 1 ? 's are' : ' is'} past ${overdue.length > 1 ? 'their' : 'its'} due date.`, action: act('recs', 'See actions', () => go('recs')) })
    const urgent = myComplaints.filter((c) => c.severity === 'High' && !['Done', 'Dismissed'].includes(states[actionId(complaintAction(c))]?.status ?? 'Open'))
    if (urgent.length) out.push({ tone: 'bad', icon: MessageSquareWarning, text: `${urgent.length} urgent staff complaint${urgent.length > 1 ? 's are' : ' is'} still open – latest: “${urgent[0].title}” at ${areaName(urgent[0].area)}.`, action: act('complaints', 'Complaints', () => go('complaints')) })
    const mine = all.filter((a) => states[actionId(a)]?.owner_id === user.id && !['Done', 'Dismissed'].includes(states[actionId(a)]!.status))
    if (mine.length) out.push({ tone: 'warn', icon: ListChecks, text: `You have ${mine.length} open action${mine.length > 1 ? 's' : ''} assigned to you.`, action: act('recs', 'My actions', () => go('recs')) })
    for (const a of areas) {
      const air = dom('Air Quality') ? live?.[a]?.air : undefined
      if (air?.aqi != null && ['Poor', 'Very Poor', 'Severe'].includes(air.category ?? '')) out.push({ tone: 'bad', icon: Wind, text: `Air at ${areaName(a)} is ${air.category?.toLowerCase()} right now (AQI ${air.aqi}${air.kind === 'modelled' ? ', modelled estimate' : ', CPCB station'}). Limit outdoor work and keep windows closed in sensitive rooms.` })
      else if (air?.aqi != null) out.push({ tone: 'ok', icon: Wind, text: `Air at ${areaName(a)} is ${air.category?.toLowerCase()} (AQI ${air.aqi}${air.kind === 'modelled' ? ', modelled' : ''}).` })
      const rainy = dom('Climate & Resilience') || dom('Water') ? live?.[a]?.weather?.daily?.find((d) => d.rain_mm >= 64.5) : undefined
      if (rainy && a === areas[0]) out.push({ tone: 'warn', icon: CloudRain, text: `${rainWord(rainy.rain_mm)[0].toUpperCase() + rainWord(rainy.rain_mm).slice(1)} (${rainy.rain_mm.toFixed(0)} mm) is forecast on ${new Date(rainy.date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })}. Check drains and pumps before then.` })
      const hot = dom('Climate & Resilience') || dom('Energy') ? live?.[a]?.weather?.daily?.find((d) => d.tmax >= 40) : undefined
      if (hot && a === areas[0]) out.push({ tone: 'warn', icon: AlertTriangle, text: `Very hot day ahead: ${Math.round(hot.tmax)}°C on ${hot.date}. Expect higher cooling load and plan for heat safety.` })
      const b = bills[a]
      if (b?.warnings.length && can('bills')) out.push({ tone: 'warn', icon: IndianRupee, text: `${areaName(a)}: ${b.warnings[0]}`, action: act('bills', 'Bills', () => go('bills')) })
    }
    const flagged = findings(sel, years).filter((f) => f['Screening result'] === 'High deviation')
    if (flagged.length) out.push({ tone: 'warn', icon: AlertTriangle, text: `The latest monthly screening flags ${flagged.length} indicator${flagged.length > 1 ? 's' : ''} as a high deviation (${[...new Set(flagged.map((f) => f.Metric))].slice(0, 3).join(', ')}).`, action: act('forecast', 'Review', () => go('forecast')) })
    return out
  }, [alerts, states, complaints, bills, live, sel, years, areas, user, go])

  const bad = items.filter((i) => i.tone !== 'ok').length
  const now = new Date()
  return (
    <>
      <PageHeader eyebrow="Today" title={`Good ${now.getHours() < 12 ? 'morning' : now.getHours() < 17 ? 'afternoon' : 'evening'}, ${user.name.split(' ')[0]}`} desc={`${now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · ${areas.length > 1 ? 'all your sites' : areaName(sel)}`} accent="#e6c477" />
      <Panel className="mb-4 p-6">
        <div className={`text-2xl font-semibold ${bad ? 'text-white' : 'text-ok'}`}>{bad ? `${bad} thing${bad > 1 ? 's' : ''} need${bad > 1 ? '' : 's'} attention today` : 'All clear – nothing needs attention right now'}</div>
        <ul className="mt-5 space-y-3">
          {items.map((i, k) => {
            const I = i.icon
            return (
              <li key={k} className={`flex items-start gap-3 rounded-xl border p-3.5 ${i.tone === 'bad' ? 'border-crit/40 bg-crit/5' : i.tone === 'warn' ? 'border-med/40 bg-med/5' : 'border-ok/30 bg-ok/5'}`}>
                <I size={18} className={`mt-0.5 shrink-0 ${i.tone === 'bad' ? 'text-crit' : i.tone === 'warn' ? 'text-med' : 'text-ok'}`} />
                <span className="flex-1 text-[14px] leading-relaxed text-soft">{i.text}</span>
                {i.action && <button className="eiq-btn shrink-0" onClick={i.action.go}>{i.action.label}<ArrowRight size={12} /></button>}
              </li>
            )
          })}
          {!items.length && <li className="flex items-center gap-2 text-sm text-mute"><CheckCircle2 size={16} className="text-ok" />No alerts, overdue actions or warnings.</li>}
        </ul>
      </Panel>
      <p className="text-[11.5px] text-dim">This page summarises alerts, the action tracker, staff complaints, live air quality and weather, bill warnings and the latest screening. Open the Command Center for the full picture.</p>
    </>
  )
}
