/** Turn staff complaints into tracked actions (Feature 11 → action tracker). */
import type { Complaint } from './api'
import { areaName, type Action } from './eiq'

export const CATEGORY_DOMAIN: Record<string, string> = {
  'Water leak': 'Water', 'No water / low pressure': 'Water', 'Power failure': 'Energy', 'Electrical hazard': 'Energy', 'Waste overflow': 'Waste',
  'Drainage / flooding': 'Climate & Resilience', 'Air quality / smoke': 'Air Quality', 'Building damage': 'Buildings & Assets', Other: 'Operations',
}
const OWNER: Record<string, string> = {
  Water: 'Facilities / water operations', Energy: 'Facilities / electrical operations', Waste: 'Waste operations', 'Climate & Resilience': 'Facilities / resilience planning',
  'Air Quality': 'Environmental monitoring liaison', 'Buildings & Assets': 'Facilities / asset management', Operations: 'Facility manager',
}
const PRIORITY = { High: 'P1 · urgent complaint', Medium: 'P2 · complaint', Low: 'P3 · complaint' } as const

export function complaintAction(c: Complaint): Action {
  const domain = CATEGORY_DOMAIN[c.category] ?? 'Operations'
  return {
    Priority: PRIORITY[c.severity], area_id: c.area, Area: areaName(c.area), Domain: domain, 'Action type': 'Staff complaint',
    'Triggering evidence': `Complaint #${c.id} · ${c.category} · reported by ${c.reporter ?? 'staff'} on ${c.created_at.slice(0, 10)}: ${c.title}${c.description ? '. ' + c.description : ''}`,
    'Recommended action': `Inspect and resolve: ${c.title}`, 'Responsible function': OWNER[domain] ?? 'Facility manager',
    'Expected direction': 'Fix the reported issue, attach proof and confirm with the reporter', Limitations: 'Staff report; verify on site before acting.',
    Source: `Complaint #${c.id}${c.lat != null ? ` · pin ${c.lat.toFixed(5)}, ${c.lon!.toFixed(5)}` : ''}${c.place ? ` · ${c.place}` : ''}`, Classification: 'STAFF_REPORT',
  }
}
