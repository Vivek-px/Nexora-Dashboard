"""Part 1C: Indi, the dashboard assistant, answering through the Groq API.

The Groq key lives only in backend/.env (GROQ_API_KEY) and never reaches the browser. Every answer is grounded in
(a) what the user is looking at (page text sent by the dashboard) and (b) a compact snapshot of the user's own sites
built here from the same data the dashboard shows, with the evidence class of every figure.
"""
import json
import os
import time
from collections import defaultdict, deque

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

import data
import live
import ops
from app import allowed, allowed_metrics, current_user
import roles
from db import q

router = APIRouter(prefix='/api/indi')
GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
DEFAULT_MODEL = 'openai/gpt-oss-120b'  # Groq production model; Llama 3.x models were retired on Groq in Aug 2026
CLASS_WORD = {'MEASURED_FACILITY': 'measured', 'OBSERVED_OFFICIAL': 'official', 'VERIFIED_RESEARCH': 'research',
              'MODELLED_AREA_SCENARIO': 'modelled', 'SHARED_SYNTHETIC_BASELINE': 'demonstration', 'MISSING': 'missing'}
LIMIT, WINDOW = 20, 300  # questions per user per 5 minutes – protects the key and the free tier
_recent: dict[int, deque] = defaultdict(deque)


def _client():
    return httpx.Client(timeout=httpx.Timeout(60, connect=10))


def model():
    return os.environ.get('GROQ_MODEL', '').strip() or DEFAULT_MODEL


def enabled():
    return bool(os.environ.get('GROQ_API_KEY', '').strip())


# ------------------------------------------------------------------ grounding snapshot

def _num(v):
    if v is None:
        return '—'
    return f'{v:,.0f}' if abs(v) >= 100 else f'{v:,.2f}'.rstrip('0').rstrip('.')


def _peek(key):
    row = q('SELECT payload, fetched_at FROM live_cache WHERE key=?', (key,))
    return json.loads(row[0]['payload']) | {'fetched_at': row[0]['fetched_at']} if row else None


def _live_line(area, ref):
    """Air and weather from the 30-minute cache only – Indi never waits on an outside service."""
    out = []
    city = _peek('cpcb:bhubaneswar')
    st = live.pick_station(area, ref, city['stations'])[0] if city and 'stations' in city else None
    if st:
        aqi, lead, _, _ = live.compute_aqi(st['pollutants'])
        out.append(f"air now: AQI {aqi} ({live.category(aqi)}, led by {lead}) – official CPCB station {st['station']}, {st['last_update']}")
    else:
        m = _peek(f'airmodel:{area}')
        if m and m.get('pollutants'):
            aqi, lead, _, _ = live.compute_aqi(m['pollutants'])
            out.append(f"air now: AQI {aqi} ({live.category(aqi)}) – MODELLED estimate (Open-Meteo), not an official reading")
    w = _peek(f'weather:{area}')
    if w and w.get('daily'):
        days = '; '.join(f"{d['date']}: {round(d['tmax'])}/{round(d['tmin'])}°C, rain {d['rain_mm']:.0f} mm" for d in w['daily'][:3])
        out.append(f'weather forecast: {days}')
    return ' | '.join(out)


def snapshot(user, focus_area=None):
    base = data.base()
    mets = allowed_metrics(user)  # only the domains in the user's job profile
    pages = roles.access_of(user)['pages']
    metrics = {k: v for k, v in base['metrics'].items() if k in mets}
    areas = [a for a in base['areas'] if a['id'] in allowed(user) and (not focus_area or a['id'] == focus_area)]
    lines = []
    for a in areas:
        aid = a['id']
        lines.append(f"\n## {a['name']} ({aid})")
        vals = []
        for key, spec in metrics.items():
            pts = [p for p in data.merged(aid, key) if p[1] is not None]
            if not pts:
                continue
            m, v, c = pts[-1]
            prev = pts[-2][1] if len(pts) > 1 else None
            chg = f', {((v - prev) / abs(prev) * 100):+.0f}% vs previous month' if prev not in (None, 0) else ''
            vals.append(f"- {spec['name']}: {_num(v)} {spec['unit']} in {m} [{CLASS_WORD.get(c, c)}]{chg}")
        lines.append('Latest values (evidence class in brackets):')
        lines += vals
        years = sorted(base['findings'].get(aid, {}), reverse=True)
        flags = [f for f in base['findings'][aid][years[0]] if f.get('Screening result') not in (None, 'Within typical variation') and f.get('metric_key') in mets] if years else []
        if flags:
            lines.append(f'Screening flags in {years[0]} (statistical review flags, not hazard findings):')
            lines += [f"- {f['Metric']} {f['Measurement period']}: {f['Screening result']} (value {_num(f['Value'])} vs expected {_num(f['Expected reference'])} {f['Unit']})" for f in flags[:8]]
        live_txt = _live_line(aid, a['reference'])
        if live_txt:
            lines.append(live_txt)
        p = ops.profile(aid)
        if 'bills' not in pages:
            pass
        elif p['energy_rate'] is not None:
            b = ops.bills(aid)
            h = b['history'][-1] if b['history'] else None
            if h and h['bill']:
                lines.append(f"Electricity bill estimate {h['month']}: Rs {_num(h['bill']['electricity_total'])} (tariff entered by admin); "
                             f"3-month average Rs {_num(b['avg_last3'])}" + (f"; forecast {b['forecast'][-1]['month']}: Rs {_num(b['forecast'][-1]['bill']['electricity_total'])}" if b['forecast'] and b['forecast'][-1]['bill'] else ''))
            lines += [f'- bill warning: {w}' for w in b['warnings'][:3]]
        else:
            lines.append('Bills: no tariff entered yet (Admin → Site profiles).')
        bm = ops.benchmarks(aid) if 'benchmarks' in pages else {'epi_kwh_m2_year': None}
        if bm['epi_kwh_m2_year'] is not None:
            lines.append(f"Energy Performance Index: {_num(bm['epi_kwh_m2_year'])} kWh/m²/year ({bm['epi_period']})")
        lines.append(f"People served used for per-person figures: {_num(p['population'])} ({p['population_source']})")
    ids = [a['id'] for a in areas]
    mark = ','.join('?' * len(ids)) or "''"
    alerts = q(f"SELECT area, metric, month, level, status FROM alerts WHERE status!='resolved' AND area IN ({mark}) ORDER BY id DESC LIMIT 10", ids)
    alerts = [x for x in alerts if x['metric'] in mets]
    if alerts:
        lines.append('\n## Open alerts')
        lines += [f"- {data.area_name(x['area'])}: {metrics.get(x['metric'], {}).get('name', x['metric'])} {x['month']} – {x['level']} ({x['status']})" for x in alerts]
    acts = q(f"SELECT title, area, status, due_date FROM action_state WHERE area IN ({mark}) ORDER BY updated_at DESC", ids)
    if acts:
        today = time.strftime('%Y-%m-%d')
        counts = defaultdict(int)
        for x in acts:
            counts[x['status']] += 1
        lines.append('\n## Action tracker: ' + ', '.join(f'{k} {v}' for k, v in counts.items()))
        lines += [f"- OVERDUE: {x['title']} ({data.area_name(x['area'])}, due {x['due_date']})" for x in acts
                  if x['due_date'] and x['due_date'] < today and x['status'] not in ('Done', 'Dismissed')][:6]
    cps = q(f"SELECT area, category, title, severity, created_at FROM complaints WHERE area IN ({mark}) AND status!='dismissed' ORDER BY id DESC LIMIT 8", ids)
    if cps:
        lines.append('\n## Open staff complaints (dismissed ones excluded)')
        lines += [f"- {c['created_at'][:10]} {data.area_name(c['area'])}: {c['title']} ({c['category']}, {c['severity']})" for c in cps]
    return '\n'.join(lines)


SYSTEM = """You are Indi, the assistant inside the Nexora Bhubaneswar facility dashboard (energy, water, air, waste, buildings, \
mobility, carbon and climate resilience for three areas: Palasuni, IRC Village (Nayapalli) and Khandagiri).

Rules:
- Answer ONLY from the DATA SNAPSHOT and SCREEN text below. If the answer is not there, say so plainly and say which page or upload would provide it. Never invent numbers, dates, causes or sources.
- Always say what kind of evidence a number is: measured (uploaded by the facility), official, research, modelled, or demonstration data. Demonstration data is illustrative, not a real reading – say so when it matters.
- Screening flags are statistical review prompts, not proof of a fault or hazard.
- Be brief and practical: lead with the answer, then at most 3–5 short bullet points or steps. Use plain words a facility manager understands. Use ₹ for rupees.
- Format: short paragraphs and '-' bullet lines only. You may use **bold**. No tables, no headings, no code blocks.
- When useful, point to the dashboard page that helps (Today, Command Center, Domain Intelligence, Forecasts & Anomalies, Scenario Lab, Recommendations, Bills & tariff, Benchmarking, Reports, Staff complaints, Data upload, Savings tracker, Admin & alerts).
- Reply in the user's language (English, Hindi, Hinglish or Odia).
- Only discuss the domains and pages in the user's JOB PROFILE; if asked about others, say their job profile does not include it and an admin can change that.
- No medical, legal or financial advice beyond reading the dashboard figures; for safety emergencies tell them to contact the responsible authority."""


# ------------------------------------------------------------------ API

class Msg(BaseModel):
    role: str = Field(pattern='^(user|assistant)$')
    content: str = Field(max_length=4000)


class ChatIn(BaseModel):
    messages: list[Msg] = Field(min_length=1, max_length=20)
    page: str = Field(default='', max_length=60)
    area: str = Field(default='all', max_length=40)
    years: list[int] = Field(default_factory=list, max_length=10)
    focus: str = Field(default='', max_length=300)
    screen: str = Field(default='', max_length=8000)


@router.get('/status')
def status(_=Depends(current_user)):
    return {'enabled': enabled(), 'model': model(), 'provider': 'Groq'}


def _rate_limit(uid):
    now = time.time()
    dq = _recent[uid]
    while dq and now - dq[0] > WINDOW:
        dq.popleft()
    if len(dq) >= LIMIT:
        raise HTTPException(429, f'Indi is answering a lot right now – please wait {int(WINDOW - (now - dq[0])) + 1} seconds.')
    dq.append(now)


def build_messages(body: ChatIn, user):
    area = body.area if body.area in allowed(user) else None
    acc = roles.access_of(user)
    ctx = (f"PAGE: {body.page or 'unknown'} | JOB PROFILE: {acc['job_profile']} (sees domains: {', '.join(acc['domains'])}) | AREA FILTER: {data.area_name(area) if area else 'all of the user’s sites'} | "
           f"REPORTING YEARS: {', '.join(map(str, body.years)) or 'none selected'} | USER: {user['name']} ({user['role']})"
           + (f"\nUSER IS POINTING AT: {body.focus}" if body.focus else '')
           + f"\n\nDATA SNAPSHOT (built by the server from the dashboard database):{snapshot(user, area)}"
           + (f"\n\nSCREEN (text currently visible on the page, may be truncated):\n{body.screen}" if body.screen else ''))
    history = [m.model_dump() for m in body.messages[-12:]]
    return [{'role': 'system', 'content': SYSTEM}, {'role': 'system', 'content': ctx}] + history


@router.post('/chat')
def chat(body: ChatIn, user=Depends(current_user)):
    if not enabled():
        raise HTTPException(503, 'Indi’s AI answers are off. Add GROQ_API_KEY to backend/.env (Nexora.bat → 5) and restart.')
    if body.messages[-1].role != 'user' or not body.messages[-1].content.strip():
        raise HTTPException(400, 'Ask a question first.')
    _rate_limit(user['id'])
    payload = {'model': model(), 'messages': build_messages(body, user), 'stream': True, 'temperature': 0.3, 'max_completion_tokens': 1200}
    if model().startswith('openai/gpt-oss'):
        payload |= {'reasoning_effort': 'low', 'include_reasoning': False}
    client = _client()
    try:
        req = client.build_request('POST', GROQ_URL, json=payload, headers={'Authorization': f"Bearer {os.environ['GROQ_API_KEY'].strip()}"})
        resp = client.send(req, stream=True)
    except httpx.HTTPError as e:
        client.close()
        raise HTTPException(502, f'Could not reach Groq ({type(e).__name__}). Check the internet connection.')
    if resp.status_code != 200:
        detail = resp.read().decode('utf-8', 'replace')[:300]
        resp.close(); client.close()
        msg = {401: 'Groq rejected the API key – check GROQ_API_KEY in backend/.env.',
               429: 'Groq’s rate limit was reached – wait a minute and ask again.',
               404: f'The model “{model()}” is not available on Groq – set GROQ_MODEL in backend/.env (e.g. openai/gpt-oss-120b).'}
        raise HTTPException(502, msg.get(resp.status_code, f'Groq error {resp.status_code}: {detail}'))

    def stream():
        try:
            for line in resp.iter_lines():
                if not line.startswith('data:'):
                    continue
                chunk = line[5:].strip()
                if chunk == '[DONE]':
                    break
                try:
                    delta = json.loads(chunk)['choices'][0].get('delta', {}).get('content')
                except (ValueError, KeyError, IndexError):
                    continue
                if delta:
                    yield delta
        except httpx.HTTPError:
            yield '\n\n_(The connection to Groq dropped – please ask again.)_'
        finally:
            resp.close()
            client.close()

    return StreamingResponse(stream(), media_type='text/plain; charset=utf-8', headers={'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no'})
