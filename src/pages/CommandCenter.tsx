import { useState } from 'react'
import { ArrowRight, ExternalLink } from 'lucide-react'
import { AREAS, DOMAINS, DOMAIN_ACCENT, E, METRICS, actions, areaName, areasOf, comparison, findings, fmt, history, sampleLabel, type AreaId, type Selection } from '../eiq'
import { ClassBadge, ExecKpi, PriorityBadge, SectionTitle, StationMap } from '../eui'
import { PageHeader, Panel, Sparkline, hueStyle } from '../ui'
import type { Go } from '../App'
import LivePanel from '../LivePanel'

const OFFICIAL_AIR = ['pm10_station_ug_m3', 'aqi_official', 'so2_ug_m3', 'no2_ug_m3', 'nh3_ug_m3', 'o3_ug_m3', 'pm25_ug_m3']

export function AreaHover({ id, years }: { id: AreaId; years: number[] }) {
  const a = AREAS.find((x) => x.id === id)!
  const air = AREAS.find((x) => x.id === id)!.stations.find((s) => s.medium === 'Ambient air')
  return (
    <>
      <div className="text-[13px] font-semibold text-white">{a.name}</div>
      <div className="mt-0.5 text-[11px] text-mute">Reference: {a.reference.name} · {a.reference.coordinate_status.replace(/_/g, ' ').toLowerCase()}</div>
      {air && <div className="text-[11px] text-mute">Air station: {air.name}</div>}
      <div className="mt-2 space-y-1">
        {[['pm25_ug_m3', 'PM2.5'], ['pm10_station_ug_m3', 'PM10'], ['aqi_official', 'Official AQI']].map(([k, l]) => {
          const r = comparison(id, k, years)[0]
          return <div key={k} className="flex items-center justify-between gap-3"><span className="text-mute">{l} · {r.period}</span><span className="flex items-center gap-1.5 text-white">{fmt(r.value, k === 'aqi_official' ? '' : 'µg/m³')}<ClassBadge cls={r.cls} /></span></div>
        })}
      </div>
      {id === 'khandagiri' && <p className="mt-2 text-[10.5px] leading-snug text-med">Groundwater point 1649. Air station 686 coordinates are unverified; air readings were not measured at this marker.</p>}
    </>
  )
}

export default function CommandCenter({ sel, years, setSel, go }: { sel: Selection; years: number[]; setSel: (s: Selection) => void; go: Go }) {
  const [tiles, setTiles] = useState(true)
  const all = sel === 'all'
  const areas = areasOf(sel)

  const aqi = comparison(sel, 'aqi_official', years)
  const exact = aqi.map((r) => r.value).filter((v): v is number => v != null)
  const aqiValue = exact.length === 1 ? fmt(exact[0], '', false) : exact.length ? `${Math.min(...exact)}–${Math.max(...exact)}` : '—'
  const period = aqi[0].period
  const numerator = OFFICIAL_AIR.reduce((n, k) => n + comparison(sel, k, years).filter((r) => r.value != null).length, 0)
  const denominator = 7 * areas.length
  const flagged = findings(sel, years).filter((r) => r['Screening result'] === 'Watch' || r['Screening result'] === 'High deviation')
  const observed = flagged.filter((r) => r.Classification === 'OBSERVED_OFFICIAL').length
  const water = comparison(sel, 'water_consumption_l', years).find((r) => r.value != null)
  const queue = actions(sel, years)

  return (
    <>
      <PageHeader eyebrow="Main dashboard" title="Command Center" desc={"Bhubaneswar monitoring evidence, review priorities and operational context in one workspace."} accent={'#e6c477'} />
      <LivePanel sel={sel} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <ExecKpi label={all ? 'Official AQI · area range' : 'Official AQI'} value={aqiValue} unit="index" detail={`${period} · monthly station summary`} badge="Official observation" accent="#43d6a0" />
        <ExecKpi label="Numeric air indicator coverage" value={`${numerator}/${denominator}`} unit="fields" detail={`${period} · gaps and censored values excluded`} badge="Station-specific evidence" accent="#7fb0c5" />
        <ExecKpi label="Historical review flags" value={String(flagged.length)} unit="flags" detail={`${period} · ${observed} official; ${flagged.length - observed} demonstration`} badge="Statistical screening" accent="#f5b84b" />
        <ExecKpi label="Hypothetical water demand" value={water ? fmt(water.value) : '—'} unit="L" detail={`${period} · 1,000 users × 135 LPCD × days`} badge="Modelled scenario" accent="#a99bff" />
      </div>
      {all && <p className="mt-3 text-[11.5px] text-mute">AQI is a range across named stations. Water demand is one shared hypothetical baseline, not the sum of three independent operations. Review flags count fields, not incidents.</p>}

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <Panel className="board min-w-0">
          <SectionTitle
            title="Monitoring locations"
            sub="Bhubaneswar · three reference points · hover a marker for dated station evidence"
            right={
              <label className="flex items-center gap-2 text-[11.5px] text-mute">
                <input type="checkbox" checked={tiles} onChange={(e) => setTiles(e.target.checked)} className="eiq-toggle" />Street-map background
              </label>
            }
          />
          <div className="p-4">
            <StationMap selection={sel} onSelect={(a) => setSel(a)} tiles={tiles} height={360} hover={(a) => <AreaHover id={a} years={years} />} />
            <div className="mt-3 flex flex-wrap gap-2">
              {(['all', ...AREAS.map((a) => a.id)] as Selection[]).map((a) => (
                <button key={a} onClick={() => setSel(a)} aria-pressed={a === sel} className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors duration-200 ${a === sel ? 'border-sapphire bg-sapphire text-white' : 'border-line text-mute hover:border-lav/40 hover:text-white'}`}>{a === 'irc_nayapalli' ? 'IRC Village' : areaName(a)}</button>
              ))}
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-dim">Khandagiri marker: verified groundwater point 1649. Air station 686 coordinates are unverified; its air readings were not measured at this marker. Palasuni and IRC are historical air-site references, not surveyed neighbourhood boundaries.</p>
          </div>
        </Panel>

        <Panel className="ai-surface relative flex max-h-[560px] flex-col">
          <SectionTitle title="Area intelligence" sub={`${areaName(sel)} · station evidence and operational demonstration context`} />
          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
            <section>
              <h3 className="eiq-eyebrow">Selected-period air observations</h3>
              {areas.map((a) => (
                <div key={a} className="mt-2">
                  {all && <div className="mb-1 text-xs font-semibold text-white">{areaName(a)}</div>}
                  {[['pm25_ug_m3', 'PM2.5'], ['pm10_station_ug_m3', 'PM10'], ['aqi_official', 'AQI']].map(([k, l]) => {
                    const r = comparison(a, k, years)[0]
                    return (
                      <div key={k} className="flex items-center justify-between gap-3 border-b border-line/50 py-1.5 text-[13px]">
                        <span className="text-mute">{l} · {r.period}</span>
                        <strong className="num text-white">{r.value != null ? fmt(r.value, METRICS[k].unit === 'index' ? 'index' : METRICS[k].unit) : 'Unavailable'}</strong>
                      </div>
                    )
                  })}
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-mute"><ClassBadge cls={comparison(a, 'pm25_ug_m3', years)[0].cls} long />{comparison(a, 'pm25_ug_m3', years)[0].scope}</div>
                  {comparison(a, 'aqi_official', years)[0].source.startsWith('http') && (
                    <a href={comparison(a, 'aqi_official', years)[0].source} target="_blank" rel="noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-[11.5px] font-medium text-lav hover:text-white">Air evidence · {areaName(a)} <ExternalLink size={11} /></a>
                  )}
                </div>
              ))}
            </section>

            <section>
              <h3 className="eiq-eyebrow">Priority evidence review</h3>
              {queue[0] ? (
                <div className="summary-card mt-2" data-indi="rec" data-indi-open="true" data-indi-label={queue[0]['Triggering evidence'].split(':')[0]} data-indi-value={queue[0]['Triggering evidence']} data-indi-desc={queue[0]['Recommended action']}>
                  <div className="flex items-center gap-2"><PriorityBadge p={queue[0].Priority} /><span className="text-[11px] text-mute">{queue[0].Area} · {queue[0].Domain}</span></div>
                  <div className="mt-1.5 text-[13px] font-medium text-white">{queue[0]['Triggering evidence'].split(':')[0]}</div>
                  <p className="mt-1 text-xs leading-relaxed text-soft">{queue[0]['Recommended action']}</p>
                </div>
              ) : <p className="mt-2 text-xs text-mute">No actions for the selected period.</p>}
              <button onClick={() => go('recs')} className="eiq-btn mt-2 w-full">Open action queue <ArrowRight size={13} /></button>
            </section>

            <section>
              <h3 className="eiq-eyebrow">Dated water sampling</h3>
              {areas.map((a) => {
                const samples = E.water_samples[a]
                if (!samples.length) return <p key={a} className="mt-2 text-xs text-mute">{areaName(a)}: no verified samples.</p>
                const media = [...new Set(samples.map((s) => s.type))]
                return media.map((m) => {
                  const rows = samples.filter((s) => s.type === m)
                  const pref = rows.filter((s) => s.parameter === 'pH' || s.parameter === 'Free Residual Chlorine')
                  const r = (pref.length ? pref : rows).at(-1)!
                  return (
                    <div key={a + m} className="mt-2 text-xs leading-relaxed text-mute">
                      <strong className="text-white">{areaName(a)} · {m}</strong><br />
                      {r.parameter}: <span className="text-soft">{r.value} {r.unit}</span><br />{sampleLabel(r)} · {r.site}
                    </div>
                  )
                })
              })}
              <p className="mt-2 text-[11px] leading-relaxed text-dim">Sample dates are independent of monthly reporting years. Numeric WQI is unavailable; a chlorine test does not establish complete potability.</p>
              <button onClick={() => go('domain', { domain: 'Water' })} className="eiq-btn mt-2 w-full">Inspect water evidence</button>
            </section>

            <section>
              <h3 className="eiq-eyebrow">Monitoring limitations</h3>
              <p className="mt-2 text-[11.5px] leading-relaxed text-mute">Official observation ≠ locality average. Demonstration data ≠ measured operations. Modelled scenario ≠ verified consumption. Historical flags support exploratory review, not hazard or compliance conclusions.</p>
              {areas.includes('khandagiri') && <p className="mt-1.5 text-[11.5px] text-mute">Khandagiri groundwater marker is verified; air-station coordinates remain unverified.</p>}
            </section>
          </div>
        </Panel>
      </div>

      <div className="mt-8 mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-white">Eight-domain operational context</h2>
          <p className="text-[12px] text-mute">Selected-period values, trends and evidence labels · choose a domain to investigate</p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {DOMAINS.map((d) => {
          const key = d.default
          const m = METRICS[key]
          const comp = comparison(sel, key, years)
          const accent = DOMAIN_ACCENT[d.name]
          return (
            <Panel key={d.name} fx="light" attrs={{ 'data-indi': 'kpi', 'data-indi-label': `${d.name} · ${m.name}`, 'data-indi-value': all ? comp.map((r) => `${r.name} ${fmt(r.value, m.unit)}`).join(', ') : fmt(comp[0].value, m.unit), 'data-indi-desc': `${comp[0].period} · ${comp.map((r) => r.cls).filter((v, i, a) => a.indexOf(v) === i).map((c) => c.replace(/_/g, ' ').toLowerCase()).join(', ')}` }} className="hue-card relative flex flex-col overflow-hidden p-4" style={hueStyle(d.name)}>
              <span className="absolute inset-x-0 top-0 h-[2px]" style={{ background: `linear-gradient(90deg, ${accent}, transparent 75%)` }} aria-hidden />
              <div className="flex items-center justify-between gap-2"><span className="text-[13px] font-medium text-soft">{d.name}</span><span className="text-[11px] text-dim">{m.name.split(' · ')[0]}</span></div>
              {all ? (
                <dl className="mt-3 space-y-1.5 text-xs">
                  {comp.map((r) => <div key={r.area} className="flex justify-between gap-2"><dt className="text-mute">{r.name}</dt><dd className="num text-white">{fmt(r.value, m.unit)}</dd></div>)}
                </dl>
              ) : (() => {
                const h = history(sel as AreaId, key, years)
                const vals = h.map((p) => p[1])
                const [prev, cur] = vals.slice(-2)
                const change = vals.length >= 2 && prev != null && cur != null && prev !== 0 ? `${((cur / prev - 1) * 100).toFixed(1).replace(/^(?!-)/, '+')}% vs previous selected month` : 'No comparison'
                return (
                  <>
                    <div className="mt-2 flex items-baseline gap-1.5"><span className="num font-display text-[26px] leading-none font-semibold text-white">{fmt(comp[0].value)}</span><span className="text-[11px] text-mute">{m.unit}</span></div>
                    <div className="mt-2 text-[11px] text-mute">{change}</div>
                    <div className="mt-2"><Sparkline data={vals.slice(-12).filter((v): v is number => v != null)} color={accent} /></div>
                  </>
                )
              })()}
              <div className="mt-3 flex flex-wrap items-center gap-1.5">{[...new Set(comp.map((r) => r.cls))].map((c) => <ClassBadge key={c} cls={c} />)}<span className="ml-auto text-[10.5px] text-dim">{comp[0].period}</span></div>
              <button onClick={() => go('domain', { domain: d.name })} className="mt-3 flex items-center gap-1 text-[11.5px] font-medium text-lav hover:text-white">Explore {d.name} <ArrowRight size={12} /></button>
            </Panel>
          )
        })}
      </div>
    </>
  )
}
