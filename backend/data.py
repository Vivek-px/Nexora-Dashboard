"""Base data (exported from the MVP) merged with measured readings uploaded through the dashboard."""
import io
import json
import math
import re
from functools import lru_cache
from pathlib import Path

import pandas as pd

from db import q
from engine.screening import screen_metric

ROOT = Path(__file__).resolve().parent.parent
MEASURED = 'MEASURED_FACILITY'


@lru_cache(maxsize=1)
def base():
    return json.loads((ROOT / 'src' / 'nexora.json').read_text(encoding='utf8'))


def metrics():
    return base()['metrics']


def area_ids():
    return [a['id'] for a in base()['areas']]


def area_name(area):
    return next((a['name'] for a in base()['areas'] if a['id'] == area), area)


def readings_for(area, metric):
    return {r['month']: r for r in q('SELECT month, value FROM readings WHERE area=? AND metric=?', (area, metric))}


def merged(area, metric):
    """Monthly points [(month, value, classification)] – uploaded measured values replace or extend the base series."""
    pts = {p[0]: (p[1], p[2]) for p in base()['series'][area][metric]['points']}
    for month, r in readings_for(area, metric).items():
        pts[month] = (r['value'], MEASURED)
    return sorted((m, v, c) for m, (v, c) in pts.items())


def screen_latest(area, metric, upto=None):
    """Run the MVP's own screening rule on the latest month of the merged series
    (or on `upto`, using only the history available up to that month)."""
    pts = [p for p in merged(area, metric) if upto is None or p[0] <= upto]
    spec = metrics()[metric]
    s = pd.Series([v if v is not None else float('nan') for _, v, _ in pts],
                  index=pd.to_datetime([m + '-01' for m, _, _ in pts], format='%Y-%m-%d'), dtype=float)
    month, _, cls = pts[-1]
    ser = base()['series'][area][metric]
    provenance = {'area_id': area, 'metric': metric, 'date': month + '-01', 'classification': cls,
                  'source_url': '' if cls == MEASURED else ser['source'], 'source_ref': 'dashboard upload' if cls == MEASURED else '',
                  'source_page': '', 'station_code': '', 'geographic_scope': 'Facility measurement uploaded to the dashboard' if cls == MEASURED else ser['scope']}
    specs = {'domain': spec['domain'], 'unit': spec['unit'], 'lower_bound': spec['lower'] if spec['lower'] is not None else 0,
             'upper_bound': spec['upper']}
    row = screen_metric(s, provenance, specs, spec['name'], area_name(area))
    return {k: (None if isinstance(v, float) and not math.isfinite(v) else v) for k, v in row.items()}


# ------------------------------------------------------------------ upload parsing

def _key(text):
    return re.sub(r'[^a-z0-9]+', ' ', str(text).lower()).strip()


def metric_lookup():
    out = {}
    for k, m in metrics().items():
        out[_key(k)] = k
        out[_key(m['name'])] = k
        out[_key(m['name'].split(' · ')[0])] = out.get(_key(m['name'].split(' · ')[0]), k)
    return out


def area_lookup():
    out = {}
    for a in base()['areas']:
        out[_key(a['id'])] = a['id']
        out[_key(a['name'])] = a['id']
        out[_key(a['name'].split(' (')[0])] = a['id']
    out['irc village'] = 'irc_nayapalli'
    out['nayapalli'] = 'irc_nayapalli'
    return out


def parse_month(v):
    if v is None or (isinstance(v, float) and math.isnan(v)) or str(v).strip() == '':
        return None
    if hasattr(v, 'strftime'):
        return v.strftime('%Y-%m')
    text = str(v).strip()
    if re.fullmatch(r'\d{4}-\d{1,2}', text):
        y, m = text.split('-')
        return f'{int(y):04d}-{int(m):02d}' if 1 <= int(m) <= 12 else None
    if not re.search(r'\b(19|20)\d{2}\b', text):
        return None  # a month without a year is ambiguous – never guess the year
    try:
        return pd.to_datetime(text, dayfirst=True).strftime('%Y-%m')
    except (ValueError, TypeError):
        return None


def read_table(filename, content):
    name = filename.lower()
    if name.endswith('.csv'):
        # Excel on Windows saves CSV as UTF-8 with BOM or as Windows-1252; accept both.
        for enc in ('utf-8-sig', 'cp1252'):
            try:
                return pd.read_csv(io.BytesIO(content), dtype=str, keep_default_na=False, encoding=enc, sep=None, engine='python')
            except UnicodeDecodeError:
                continue
        raise ValueError('Could not read the CSV text encoding; save it as "CSV UTF-8" from Excel')
    if name.endswith(('.xlsx', '.xlsm')):
        return pd.read_excel(io.BytesIO(content), dtype=object, engine='openpyxl')
    raise ValueError('Upload a .csv or .xlsx file')


def parse_upload(filename, content, default_area=None, allowed=None):
    """Return (rows, errors). Accepts long format (area, metric, month, value[, note]) or wide format
    (month + one column per indicator, area from the 'area' column or the form)."""
    df = read_table(filename, content)
    df.columns = [_key(c) for c in df.columns]
    mlook, alook = metric_lookup(), area_lookup()
    month_col = next((c for c in df.columns if c in ('month', 'date', 'period', 'reporting month')), None)
    if not month_col:
        raise ValueError("A 'month' (or 'date') column is required, e.g. 2026-01")
    long = 'metric' in df.columns and 'value' in df.columns
    rows, errors = [], []
    for i, rec in enumerate(df.to_dict('records'), start=2):
        area_raw = rec.get('area') if 'area' in df.columns else default_area
        area = alook.get(_key(area_raw)) if area_raw not in (None, '') else None
        month = parse_month(rec.get(month_col))
        if not area:
            errors.append(f'Row {i}: unknown or missing area "{area_raw}"'); continue
        if allowed is not None and area not in allowed:
            errors.append(f'Row {i}: you do not have access to {area_name(area)}'); continue
        if not month:
            errors.append(f'Row {i}: month "{rec.get(month_col)}" not understood (use YYYY-MM)'); continue
        pairs = [(rec.get('metric'), rec.get('value'))] if long else [(c, rec[c]) for c in df.columns if c not in (month_col, 'area', 'note')]
        for metric_raw, value_raw in pairs:
            if value_raw is None or str(value_raw).strip() == '' or (isinstance(value_raw, float) and math.isnan(value_raw)):
                continue
            metric = mlook.get(_key(metric_raw))
            if not metric:
                errors.append(f'Row {i}: unknown indicator "{metric_raw}"'); continue
            try:
                value = float(str(value_raw).replace(',', ''))
            except ValueError:
                errors.append(f'Row {i}: {metric_raw} value "{value_raw}" is not a number'); continue
            spec = metrics()[metric]
            if not math.isfinite(value) or (spec['lower'] is not None and value < spec['lower']) or (spec['upper'] is not None and value > spec['upper']):
                errors.append(f"Row {i}: {spec['name']} = {value:g} is outside the allowed range"); continue
            rows.append({'area': area, 'metric': metric, 'month': month, 'value': value, 'note': str(rec.get('note') or '')[:300]})
    return rows, errors


def template_csv():
    lines = ['area,metric,month,value,note',
             'palasuni,electricity_kwh,2026-01,29850,Main meter reading',
             'palasuni,water_consumption_l,2026-01,4150000,Bulk flow meter',
             'khandagiri,waste_kg,2026-01,5320,Weighbridge total']
    return '\n'.join(lines) + '\n'
