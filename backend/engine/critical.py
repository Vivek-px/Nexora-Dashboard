"""Explainable MVP intelligence: sustainability scoring, waste/maintenance risk and cross-metric events.

These are transparent, rules-based screening estimates, not validated safety or predictive models.
"""
from __future__ import annotations

from math import isfinite
from statistics import median


def _number(value):
    try:
        value = float(value)
        return value if isfinite(value) else None
    except (TypeError, ValueError):
        return None


def _latest_valid(points, count=12):
    vals = []
    for point in points or []:
        if len(point) >= 2:
            value = _number(point[1])
            if value is not None and value >= 0:
                vals.append((str(point[0]), value, point[2] if len(point) > 2 else 'UNKNOWN'))
    return vals[-count:]


def _target_score(value, target):
    value, target = _number(value), _number(target)
    if value is None or target is None or target <= 0:
        return None
    return round(max(0.0, min(100.0, 100.0 * target / max(value, target))), 1)


def _trend_score(value, baseline):
    value, baseline = _number(value), _number(baseline)
    if value is None or baseline is None or baseline <= 0:
        return None
    # 100 at or below baseline; linearly reduces by 2 points for each 1% above baseline.
    return round(max(0.0, min(100.0, 100.0 - max(0.0, value / baseline - 1.0) * 200.0)), 1)


def sustainability_scorecard(monthly_rows, profile):
    """Return a composite 0–100 score from available lower-is-better resource indicators.

    Components are equally weighted. Targets are used when configured; otherwise the
    recent historical median is a clearly labelled comparison baseline. Missing
    components are excluded from the average and reduce coverage, never scored as 100.
    """
    rows = monthly_rows or []
    last = rows[-1] if rows else {}
    components = []

    def add(key, label, current, target, values, unit, source):
        score = _target_score(current, target) if target is not None else _trend_score(current, median(values[:-1]) if len(values) >= 4 else None)
        if score is None:
            components.append({'key': key, 'label': label, 'score': None, 'current': _number(current), 'target': _number(target), 'unit': unit,
                               'status': 'Insufficient data', 'basis': 'No usable target or at least four historical values', 'source': source})
            return
        basis = f'Configured target: {target:g} {unit}' if target is not None else f'Historical median baseline: {median(values[:-1]):g} {unit}'
        components.append({'key': key, 'label': label, 'score': score, 'current': _number(current), 'target': _number(target), 'unit': unit,
                           'status': 'On target / better' if score >= 99.9 else 'Needs improvement' if score < 80 else 'Near target',
                           'basis': basis, 'source': source})

    energy_field = 'epi_kwh_m2_year' if profile.get('epi_target') is not None else 'kwh_per_m2'
    energy_values = [r.get(energy_field) for r in rows if _number(r.get(energy_field)) is not None]
    water_values = [r['lpcd'] for r in rows if _number(r.get('lpcd')) is not None]
    waste_values = [r['waste_kg_pp_day'] for r in rows if _number(r.get('waste_kg_pp_day')) is not None]
    carbon_values = [r['co2e_kg_per_person'] for r in rows if _number(r.get('co2e_kg_per_person')) is not None]
    energy_value = last.get(energy_field)
    energy_unit = 'kWh/m²/year' if profile.get('epi_target') is not None else 'kWh/m²/month'
    add('energy', 'Energy intensity', energy_value, profile.get('epi_target'), energy_values, energy_unit, 'Facility electricity and floor area')
    add('water', 'Water intensity', last.get('lpcd'), profile.get('lpcd_target'), water_values, 'L/person/day', 'Water consumption and configured population')
    add('waste', 'Waste intensity', last.get('waste_kg_pp_day'), profile.get('waste_target'), waste_values, 'kg/person/day', 'Waste mass and configured population')
    add('carbon', 'Carbon intensity', last.get('co2e_kg_per_person'), None, carbon_values, 'kg CO₂e/person/month', 'Recorded/modelled CO₂e per person; compared with historical median')
    available = [c['score'] for c in components if c['score'] is not None]
    score = round(sum(available) / len(available), 1) if available else None
    coverage = round(100 * len(available) / len(components))
    return {'score': score, 'coverage_pct': coverage, 'components_available': len(available), 'components_total': len(components),
            'band': ('Insufficient data' if score is None else 'Strong' if score >= 80 else 'Needs attention' if score >= 60 else 'Priority improvement'),
            'method': 'Equal-weight average of available 0–100 lower-is-better component scores. Configured targets use min(100, target/current × 100); components without a target compare latest value with the median of at least three earlier available months, scoring 100 at/below baseline and subtracting 2 points per 1% above it. Missing components are excluded, and coverage is shown.',
            'components': components, 'period': last.get('month')}


def waste_overflow_risk(waste_points, complaint_count=0):
    """Rules-based next-period waste pressure estimate; not bin-level prediction."""
    vals = _latest_valid(waste_points, 7)
    if not vals:
        return {'risk_score': None, 'level': 'Insufficient data', 'signals': [], 'basis': 'No valid waste history',
                'limitations': 'No bin fill-level or collection-interval data available.'}
    latest = vals[-1][1]
    baseline_vals = [v for _, v, _ in vals[:-1]]
    baseline = median(baseline_vals) if len(baseline_vals) >= 3 else None
    recent = vals[-3:]
    slope = (recent[-1][1] - recent[0][1]) / (len(recent) - 1) if len(recent) >= 2 else 0.0
    projected = max(0.0, latest + slope)
    pct = ((projected / baseline) - 1) * 100 if baseline and baseline > 0 else None
    score = 20.0
    signals = [f'Next-period waste estimate: {projected:.1f} kg, based on the recent monthly trend']
    if pct is not None:
        if pct >= 30: score += 45; signals.append(f'Projected waste is {pct:.0f}% above the recent historical median')
        elif pct >= 15: score += 25; signals.append(f'Projected waste is {pct:.0f}% above the recent historical median')
        elif pct >= 5: score += 10; signals.append(f'Projected waste is {pct:.0f}% above the recent historical median')
        else: signals.append(f'Projected waste is {pct:+.0f}% versus its recent historical median')
    else:
        signals.append('Limited history; risk starts from a conservative screening prior')
    if int(complaint_count or 0) > 0:
        score += min(25, int(complaint_count) * 8)
        signals.append(f'{int(complaint_count)} open waste-related complaint(s)')
    score = int(min(100, round(score)))
    level = 'High' if score >= 70 else 'Moderate' if score >= 40 else 'Low'
    return {'risk_score': score, 'level': level, 'latest_value': latest, 'latest_period': vals[-1][0],
            'risk_horizon': 'Next monthly reporting period', 'projected_next_period_kg': round(projected, 2),
            'baseline_median': baseline, 'change_pct': round(pct, 1) if pct is not None else None, 'signals': signals,
            'basis': 'Rules-based next-period waste-pressure estimate from the recent monthly trend and open waste complaints; not a trained prediction model.',
            'limitations': 'Monthly totals cannot determine whether an individual bin is full. Add bin fill level, time since collection, pickup schedule and waste-generation rate for operational overflow prediction.'}


def maintenance_risk(series_by_metric, maintenance_complaints=0):
    """Explainable proxy prioritization from available energy/HVAC/leakage and complaints."""
    signals = []
    score = 15.0
    used = 0
    for key, label, points, threshold in [
        ('peak_demand_kw', 'Peak electrical demand', series_by_metric.get('peak_demand_kw', []), 1.20),
        ('hvac_kwh', 'HVAC energy', series_by_metric.get('hvac_kwh', []), 1.25),
        ('leakage_probability_pct', 'Leakage indicator', series_by_metric.get('leakage_probability_pct', []), 1.0),
    ]:
        vals = _latest_valid(points, 7)
        if not vals: continue
        used += 1
        latest = vals[-1][1]
        history = [v for _, v, _ in vals[:-1]]
        base = median(history) if len(history) >= 3 else None
        if key == 'leakage_probability_pct' and latest >= 30:
            score += 25; signals.append(f'{label} is elevated at {latest:g}%')
        elif base and base > 0 and latest >= base * threshold:
            increase = (latest / base - 1) * 100
            score += 20 if increase >= 50 else 12
            signals.append(f'{label} is {increase:.0f}% above its recent median')
    if int(maintenance_complaints or 0) > 0:
        score += min(35, int(maintenance_complaints) * 12)
        signals.append(f'{int(maintenance_complaints)} open maintenance/equipment complaint(s)')
    if not used and not maintenance_complaints:
        return {'risk_score': None, 'level': 'Insufficient data', 'signals': [], 'basis': 'No usable asset signals or maintenance complaints',
                'limitations': 'Asset-level condition, runtime, service history and failure labels are not available.'}
    score = int(min(100, round(score)))
    level = 'High' if score >= 70 else 'Moderate' if score >= 40 else 'Low'
    if not signals: signals.append('No strong movement in the available proxy indicators; this is not proof of equipment health')
    return {'risk_score': score, 'level': level, 'signals': signals,
            'basis': 'Rules-based maintenance priority proxy using monthly peak demand, HVAC energy, leakage indicator and open maintenance complaints.',
            'limitations': 'Not a trained remaining-useful-life or failure probability model. Improve with asset IDs, runtime, fault codes, work-order history, service dates and confirmed failure labels.'}


def cross_metric_events(screenings):
    """Group same-area/same-period metric review flags into compound events."""
    grouped = {}
    for item in screenings or []:
        if item.get('Screening result') not in ('Watch', 'High deviation'):
            continue
        key = (item.get('area_id'), item.get('Measurement period'))
        grouped.setdefault(key, []).append(item)
    events = []
    for (area, period), metrics in grouped.items():
        if len(metrics) < 2:
            continue
        high = sum(1 for m in metrics if m.get('Screening result') == 'High deviation')
        events.append({'area': area, 'period': period, 'level': 'High' if high >= 2 or len(metrics) >= 3 else 'Watch',
                       'metric_count': len(metrics), 'metrics': [{'metric': m.get('Metric'), 'value': m.get('Value'), 'unit': m.get('Unit'),
                          'status': m.get('Screening result'), 'expected': m.get('Expected reference'), 'deviation': m.get('Robust deviation'),
                          'classification': m.get('Classification')} for m in metrics],
                       'explanation': f'{len(metrics)} indicators were flagged in the same area and month. This is a temporal co-occurrence, not proof of a causal relationship.'})
    return sorted(events, key=lambda e: (e['level'] != 'High', e['area'], e['period']))
