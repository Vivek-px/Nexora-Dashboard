/** Feature 10: monthly PDF report and the BRSR (Principle 6) data pack. */
import { useState } from 'react'
import { FileDown, FileSpreadsheet } from 'lucide-react'
import { getToken } from '../api'
import { AREAS, areaName, areasOf, series, type AreaId, type Selection } from '../eiq'
import { SectionTitle, Select } from '../eui'
import { PageHeader, Panel } from '../ui'

export default function Reports({ sel }: { sel: Selection }) {
  const [area, setArea] = useState<AreaId>(areasOf(sel)[0])
  const months = series(area, 'electricity_kwh').points.map((p) => p[0]).reverse()
  const [month, setMonth] = useState(months[0])
  // A financial year (Apr y – Mar y+1) is offered when any of its months has data; newest first.
  const fys = [...new Set(months.map((m) => { const [y, mo] = m.split('-').map(Number); return mo >= 4 ? y : y - 1 }))].sort((a, b) => b - a)
  const complete = fys.find((y) => months.includes(`${y + 1}-03`))
  const [fy, setFy] = useState(String(complete ?? fys[0]))
  const t = encodeURIComponent(getToken())
  return (
    <>
      <PageHeader eyebrow="Operations" title="Reports" desc="Ready-to-send documents: a monthly PDF report for the Director or Commissioner, and an ESG data pack for BRSR Principle 6 (energy, water, waste)." accent="#7fb0c5" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <SectionTitle title="Monthly report (PDF)" sub="Key indicators vs last month and last year, alerts, actions, complaints, savings, benchmarks and bill estimate" />
          <div className="space-y-3 p-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <Select label="Site" value={area} options={areasOf(sel).length > 1 ? AREAS.map((a) => a.id) : areasOf(sel)} onChange={(v) => { setArea(v as AreaId); setMonth(series(v as AreaId, 'electricity_kwh').points.at(-1)![0]) }} format={(v) => areaName(v as AreaId)} />
              <Select label="Month" value={month} options={months} onChange={setMonth} />
            </div>
            <a className="eiq-btn eiq-btn-primary w-full" href={`/api/reports/monthly.pdf?area=${area}&month=${month}&t=${t}`} download><FileDown size={14} />Download {areaName(area)} · {month} (PDF)</a>
            <p className="text-[11.5px] text-dim">Each figure carries its evidence class. Demonstration data is labelled, never presented as measured.</p>
          </div>
        </Panel>
        <Panel>
          <SectionTitle title="BRSR Principle 6 data pack (Excel)" sub="Financial year April–March: electricity (GJ), water (kL), waste by type (tonnes), prototype CO₂e" />
          <div className="space-y-3 p-5">
            <Select label="Financial year" value={fy} options={fys.map(String)} onChange={setFy} format={(y) => `FY ${y}-${String(Number(y) + 1).slice(2)} (Apr ${y} – Mar ${Number(y) + 1})`} />
            <a className="eiq-btn eiq-btn-primary w-full" href={`/api/reports/brsr.xlsx?fy=${fy}&t=${t}`} download><FileSpreadsheet size={14} />Download BRSR data pack (Excel)</a>
            <p className="text-[11.5px] text-dim">Includes a summary sheet and the monthly detail behind each figure. Only figures marked Measured or Official are suitable for a filed report; demonstration values must be replaced with metered data first.</p>
          </div>
        </Panel>
      </div>
    </>
  )
}
