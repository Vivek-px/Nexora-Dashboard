"""Deterministic hourly demo simulator, 24-hour forecast and evidence-led recommendations.

All generated readings are synthetic and explicitly labelled. Forecast is a transparent
seasonal-naive baseline, not a trained model or calibrated confidence interval.
"""
from __future__ import annotations
from datetime import datetime, timedelta, timezone
from math import sin, pi
from statistics import mean

METRICS = ('energy_kwh', 'water_l', 'waste_kg')
BASE = {'energy_kwh': 42.0, 'water_l': 180.0, 'waste_kg': 7.5}
UNITS = {'energy_kwh': 'kWh', 'water_l': 'L', 'waste_kg': 'kg'}


def generate_readings(hours: int = 48, scenario: str = 'normal', now: datetime | None = None):
    """Create repeatable synthetic hourly readings; supported scenarios: normal, leak, energy_spike, compound."""
    if hours < 1 or hours > 168:
        raise ValueError('hours must be between 1 and 168')
    if scenario not in {'normal', 'leak', 'energy_spike', 'compound'}:
        raise ValueError('scenario must be normal, leak, energy_spike, or compound')
    end = now or datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    rows = []
    for i in range(hours):
        stamp = end - timedelta(hours=hours - 1 - i)
        hour = stamp.hour
        day_wave = 1 + 0.18 * sin((hour - 7) / 24 * 2 * pi)
        values = {
            'energy_kwh': round(BASE['energy_kwh'] * day_wave + 2.5 * sin(i * 0.7), 2),
            'water_l': round(BASE['water_l'] * (1 + 0.12 * sin((hour - 5) / 24 * 2 * pi)) + 9 * sin(i * 0.4), 2),
            'waste_kg': round(max(0.1, BASE['waste_kg'] * (0.9 + 0.2 * ((hour % 8) / 7)) + 0.4 * sin(i * 0.3)), 2),
        }
        active = i >= max(0, hours - 3)
        if active and scenario in ('leak', 'compound'):
            values['water_l'] = round(values['water_l'] * 2.25, 2)
        if active and scenario in ('energy_spike', 'compound'):
            values['energy_kwh'] = round(values['energy_kwh'] * 1.9, 2)
        rows.append({'timestamp': stamp.isoformat(), 'source': 'SIMULATED', 'scenario': scenario, **values})
    return rows


def detect_hourly_events(rows):
    """Flag >50% deviations from metric baseline; combine co-timed metric flags."""
    if not rows:
        return []
    baselines = {}
    for metric in METRICS:
        vals = [float(r[metric]) for r in rows[:-3] if r.get(metric) is not None]
        baselines[metric] = mean(vals) if vals else None
    by_time = {}
    for row in rows:
        flagged = []
        for metric in METRICS:
            base, val = baselines[metric], row.get(metric)
            if base and val is not None and float(val) >= base * 1.5:
                flagged.append({'metric': metric, 'value': val, 'unit': UNITS[metric], 'baseline': round(base, 2), 'threshold': round(base * 1.5, 2), 'increase_pct': round((float(val) / base - 1) * 100, 1)})
        if flagged:
            by_time[row['timestamp']] = flagged
    events = []
    for stamp, metrics in by_time.items():
        if len(metrics) >= 2:
            events.append({'timestamp': stamp, 'severity': 'HIGH', 'kind': 'compound', 'metrics': metrics, 'explanation': 'Multiple metrics exceeded their individual thresholds in the same hour. Co-occurrence does not prove a causal relationship.'})
        else:
            events.append({'timestamp': stamp, 'severity': 'WATCH', 'kind': 'single_metric', 'metrics': metrics, 'explanation': 'A metric exceeded its baseline threshold; investigate the source reading and operating context.'})
    return events


def forecast_next_24(rows):
    """Forecast next 24 hourly values using average values by hour-of-day when possible."""
    if len(rows) < 24:
        return {'status': 'insufficient_data', 'required_hours': 24, 'available_hours': len(rows), 'message': 'At least 24 hourly readings are required.'}
    parsed = [(datetime.fromisoformat(r['timestamp']), r) for r in rows]
    parsed.sort(key=lambda x: x[0])
    latest = parsed[-1][0]
    forecast = []
    for step in range(1, 25):
        target = latest + timedelta(hours=step)
        item = {'timestamp': target.isoformat(), 'source': 'FORECAST_BASELINE'}
        for metric in METRICS:
            same_hour = [float(r[metric]) for ts, r in parsed[-168:] if ts.hour == target.hour and r.get(metric) is not None]
            vals = same_hour or [float(r[metric]) for _, r in parsed[-24:] if r.get(metric) is not None]
            item[metric] = round(mean(vals), 2) if vals else None
        forecast.append(item)
    errors = {}
    # Backtest simple hour-of-day baseline against last 24 observed values using earlier values only.
    train = parsed[:-24]
    test = parsed[-24:]
    for metric in METRICS:
        abs_errors = []
        for ts, actual in test:
            vals = [float(r[metric]) for old_ts, r in train if old_ts.hour == ts.hour and r.get(metric) is not None]
            if not vals:
                vals = [float(r[metric]) for _, r in train[-24:] if r.get(metric) is not None]
            if vals and actual.get(metric) is not None:
                abs_errors.append(abs(float(actual[metric]) - mean(vals)))
        errors[metric] = {'mae': round(mean(abs_errors), 2) if abs_errors else None, 'samples': len(abs_errors), 'unit': UNITS[metric]}
    return {'status': 'ok', 'method': 'hour-of-day historical mean; transparent baseline', 'horizon_hours': 24, 'forecast': forecast, 'backtest': errors, 'limitations': 'Synthetic/demo data or short history may not represent real operations. MAE is a retrospective baseline error, not a guarantee of future accuracy.'}


def recommendations(events, forecast_result=None):
    """Produce structured rule-based actions with evidence, assumptions and verification."""
    out = []
    for event in events or []:
        names = [m['metric'] for m in event['metrics']]
        if 'water_l' in names:
            out.append({'title': 'Inspect water system for abnormal flow', 'priority': 'HIGH' if len(names) > 1 else 'MEDIUM', 'evidence': event['metrics'], 'action': 'Check meter validity, pumps, valves, irrigation schedules and visible leaks; isolate the affected zone if safe.', 'assumptions': ['The timestamp and water meter are correct.', 'A sudden rise is not explained by occupancy or scheduled activity.'], 'expected_benefit': 'May reduce avoidable water loss; savings are not quantified without verified follow-up readings.', 'confidence': 'Rule-based screening; not a causal diagnosis.', 'verification': 'Compare the next 2–3 hourly readings with the pre-event baseline and record inspection outcome.'})
        if 'energy_kwh' in names:
            out.append({'title': 'Investigate abnormal electricity demand', 'priority': 'HIGH' if len(names) > 1 else 'MEDIUM', 'evidence': event['metrics'], 'action': 'Validate the meter and inspect HVAC schedules, pumps, lighting and recently started equipment.', 'assumptions': ['The reading covers the same interval and units as baseline.', 'No planned load test or unusual occupancy explains the increase.'], 'expected_benefit': 'May identify avoidable load; no savings claim until verified.', 'confidence': 'Rule-based screening; not a causal diagnosis.', 'verification': 'Record the equipment or schedule change and compare equivalent-hour kWh before and after.'})
        if 'waste_kg' in names:
            out.append({'title': 'Check waste accumulation and collection status', 'priority': 'MEDIUM', 'evidence': event['metrics'], 'action': 'Verify the weighing record, inspect collection points, and confirm the next pickup.', 'assumptions': ['The waste weight is correctly recorded.', 'No one-off event or bulk disposal explains the change.'], 'expected_benefit': 'May reduce overflow risk through earlier inspection; bin fullness is not measured by this demo.', 'confidence': 'Rule-based screening; not a bin-level prediction.', 'verification': 'Record a physical inspection and compare the next collection weight.'})
    if not out:
        out.append({'title': 'Continue routine monitoring', 'priority': 'LOW', 'evidence': [], 'action': 'Review hourly readings and investigate only when a documented threshold is exceeded.', 'assumptions': ['The simulator or source feed is active and timestamped.', 'Thresholds are suitable for this demo facility.'], 'expected_benefit': 'Maintains a review trail without asserting an incident.', 'confidence': 'No current threshold event detected; this is not proof that the facility is risk-free.', 'verification': 'Check feed freshness and review the next monitoring interval.'})
    return out
