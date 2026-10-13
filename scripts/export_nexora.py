"""Export Nexora engine outputs for the Figma Make UI prototype. Read-only; uses the repo's own functions."""
import json, math, sys
from pathlib import Path
ROOT = Path(sys.argv[1]); OUT = Path(sys.argv[2])
sys.path.insert(0, str(ROOT))
import pandas as pd
from dashboard.three_area_data import DashboardData, CLASS_LABELS
from dashboard.catalog import DOMAINS, ALL_METRICS, DEFAULT_KEYS
from dashboard.workspace import selected_findings, actions_for_selection
from dashboard.intelligence import calendar_inputs
from facility.area_registry import AREA_IDS
from facility.intelligence.forecasting import evaluate_forecast, METHOD_NAMES

data = DashboardData(ROOT / 'data_three_area')
num = lambda v: None if v is None or (isinstance(v, float) and not math.isfinite(v)) or pd.isna(v) else round(float(v), 4)
mon = lambda d: pd.Timestamp(d).strftime('%Y-%m')
years = sorted(data.monthly.date.dt.year.unique().tolist())
from itertools import combinations
combos = [c for n in range(1, len(years) + 1) for c in combinations(years, n)]

out = {'generated_from': 'Vivek-px/Nexora-Bhubaneswar-MVP', 'class_labels': CLASS_LABELS, 'years': years,
       'domains': [{'name': d, 'default': DEFAULT_KEYS[i], 'metrics': [m.key for m in ms]} for i, (d, ms) in enumerate(DOMAINS.items())],
       'metrics': {k: {'name': m.name, 'unit': m.unit, 'mode': m.mode, 'lower': data.metrics[k]['lower_bound'], 'upper': data.metrics[k]['upper_bound'], 'domain': next(d for d, ms in DOMAINS.items() if m in ms)} for k, m in ALL_METRICS.items()},
       'coverage_report': data.coverage, 'missing': data.missing, 'water_population': {}, 'areas': [], 'series': {}, 'forecasts': {}, 'findings': {}, 'actions': {}, 'water_samples': {}}

for area in AREA_IDS:
    reg = data.registry[area]; ref = reg['map_reference']
    out['areas'].append({'id': area, 'name': data.name(area),
        'reference': {k: ref.get(k) for k in ['name', 'station_id', 'medium', 'latitude', 'longitude', 'coordinate_status', 'coordinate_source', 'scope']},
        'stations': [{k: s.get(k) for k in ['station_id', 'name', 'medium', 'latitude', 'longitude', 'coordinate_status']} for s in reg['monitoring_stations']]})
    history = data.history(area)
    out['series'][area] = {}; out['forecasts'][area] = {}
    for key in ALL_METRICS:
        led = data.provenance(area, key)
        last = led.iloc[-1]
        out['series'][area][key] = {
            'points': [[mon(r.date), num(r.value), r.classification] for r in led.itertuples()],
            'source': str(last.source_url or last.source_ref or ''), 'scope': str(last.geographic_scope), 'status': str(last.measurement_status),
            # Per-month source ledger (MVP 'Indicator source ledger' / provenance download):
            # [month, raw value, measurement status, source url, source ref, geographic scope]
            'ledger': [[mon(r.date), str(r.raw_value or ''), str(r.measurement_status or ''), str(r.source_url or ''), str(r.source_ref or ''), str(r.geographic_scope or '')] for r in led.itertuples()]}
        spec = data.metrics[key]
        out['forecasts'][area][key] = {}
        for h in range(3, 13):
            res = evaluate_forecast(history.set_index('date')[key], h, spec['lower_bound'], spec['upper_bound'], calendar_inputs(history, key))
            if res.available:
                sel = res.scores[res.scores.Selected].iloc[0]
                out['forecasts'][area][key][h] = {'available': True, 'method': METHOD_NAMES[res.method], 'mae': num(sel['Chronological MAE']),
                    'selection_end': res.selection_end, 'limitations': res.limitations,
                    'scores': [{'Model': r['Model'], 'Chronological MAE': num(r['Chronological MAE']), 'Validation predictions': int(r['Validation predictions']), 'Evaluated leads': int(r['Evaluated leads']), 'Selected': bool(r['Selected'])} for r in res.scores.to_dict('records')],
                    **({'validation': [[str(r.method), mon(r.train_end), mon(r.target_date), int(r.lead), num(r.actual), num(r.prediction), num(r.error)] for r in res.validation.itertuples()]} if h == 12 else {}),
                    'points': [[mon(d), num(v), num(res.lower.get(d)), num(res.upper.get(d))] for d, v in res.points.items()]}
            else:
                out['forecasts'][area][key][h] = {'available': False, 'reason': res.reason}
    out['findings'][area] = {}; out['actions'][area] = {}
    for combo in combos:
        tag = ','.join(map(str, combo))
        out['findings'][area][tag] = [{k: (num(v) if isinstance(v, float) else v) for k, v in r.items()} for r in selected_findings(data, area, list(combo))]
        out['actions'][area][tag] = actions_for_selection(data, area, list(combo))
    out['water_population'][area] = num(history.water_population_equivalent.iloc[-1])
    q = data.quality(area)
    txt = lambda v: '' if v is None or (isinstance(v, float) and math.isnan(v)) else str(v)
    out['water_samples'][area] = [{'id': r.observation_id, 'site': r.site, 'site_reported': txt(r.site_reported), 'type': r.water_type, 'parameter': r.parameter,
        'value': txt(r.raw_value), 'unit': txt(r.unit), 'exact': num(r.exact_value), 'comparator': txt(r.comparator), 'measurement_status': txt(r.measurement_status),
        'period': mon(r.period_start), 'start': str(pd.Timestamp(r.period_start).date()), 'end': str(pd.Timestamp(r.period_end).date()),
        'sample_date': txt(r.sample_date), 'sample_period': txt(r.sample_period), 'date_precision': txt(r.date_precision),
        'status': txt(r.reported_status), 'limit': txt(r.reported_limit), 'verification': txt(r.verification_status), 'source': txt(r.source_url),
        'source_page': txt(r.source_page), 'lat': num(r.latitude), 'lon': num(r.longitude), 'notes': txt(r.notes),
        'classification': txt(r.classification), 'scope': txt(r.geographic_scope), 'station_code': txt(r.station_code)}
        for r in q.sort_values(['period_start', 'site']).itertuples()]

import hashlib, shutil
# Large or download-only material goes to public/data/ and is fetched on demand, keeping the app bundle small.
PUB = OUT.parent.parent / 'public' / 'data'; PUB.mkdir(parents=True, exist_ok=True)
backtests = {a: {m: f[12].pop('validation', []) if isinstance(f.get(12), dict) else [] for m, f in out['forecasts'][a].items()} for a in out['forecasts']}
(PUB / 'backtests.json').write_text(json.dumps(backtests, separators=(',', ':')), encoding='utf8')
shutil.copyfile(ROOT / 'data_three_area/water_quality_evidence.csv', PUB / 'water_quality_evidence.csv')
out['canonical_sha256'] = hashlib.sha256((ROOT / 'data_three_area/monthly.csv').read_bytes()).hexdigest()
out['water_evidence_records'] = sum(1 for _ in open(ROOT / 'data_three_area/water_quality_evidence.csv', encoding='utf8')) - 1
OUT.write_text(json.dumps(out, default=str, separators=(',', ':')), encoding='utf8')
print('wrote', OUT, OUT.stat().st_size // 1024, 'KB')
