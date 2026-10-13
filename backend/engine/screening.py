"""Interpretable latest-period review flags, never health/compliance conclusions."""
import numpy as np
import pandas as pd

from .forecasting import evaluate_forecast, METHOD_NAMES

WATCH_Z = 2.0
REVIEW_Z = 3.0
RELATIVE_SCALE_FLOOR = .02


def screen_metric(history, provenance, specs, name, area_name, calendar_model=None):
    p = dict(provenance)
    value = float(history.iloc[-1]) if len(history) and pd.notna(history.iloc[-1]) else None
    kind = ('Observed evidence review' if p['classification'] == 'OBSERVED_OFFICIAL'
            else 'Demonstration screening')
    row = {'area_id': p['area_id'], 'Area': area_name, 'Domain': specs['domain'],
           'Metric': name, 'metric_key': p['metric'], 'Measurement period': pd.Timestamp(p['date']).strftime('%Y-%m'),
           'Value': value, 'Unit': specs['unit'], 'Expected reference': None,
           'Deviation': None, 'Robust deviation': None, 'Screening result': 'Insufficient history',
           'Lower review threshold': None, 'Upper review threshold': None,
           'Evidence kind': kind, 'Classification': p['classification'],
           'Source': p['source_url'] or p['source_ref'], 'Source PDF page': p['source_page'],
           'Station code': p['station_code'], 'Reason': '', 'Limitation': p['geographic_scope'],
           'Reference method': '', 'Scale': None}
    if value is None or not np.isfinite(value):
        row.update({'Screening result': 'Missing latest observation', 'Evidence kind': 'Data coverage warning',
                    'Reason': 'Latest period is missing/censored; an older reading has not been substituted.'})
        return row
    prior = pd.to_numeric(history.iloc[:-1], errors='coerce').dropna()
    prior = prior[np.isfinite(prior)]
    if len(prior) < 6:
        row['Reason'] = 'At least six earlier numeric readings are needed for descriptive screening.'
        row['Evidence kind'] = 'Data coverage warning'
        return row
    evaluated = evaluate_forecast(history.iloc[:-1], horizon=1, lower=specs['lower_bound'],
                                  upper=specs['upper_bound'], calendar_model=calendar_model)
    if evaluated.available:
        expected = float(evaluated.points.iloc[0])
        residuals = evaluated.calibration.error.to_numpy()
        median = float(np.median(residuals))
        spread = float(1.4826 * np.median(np.abs(residuals - median)))
        row['Reference method'] = METHOD_NAMES[evaluated.method] + ' fitted without the latest period'
        qualification = 'Scale uses later chronological forecast residuals.'
    else:
        reference = prior.tail(18)
        expected = float(reference.median())
        spread = float(1.4826 * (reference - expected).abs().median())
        if spread <= 1e-8:
            spread = float(reference.std(ddof=0))
        row['Reference method'] = 'Median of up to 18 prior available readings'
        qualification = 'Sparse/gapped history: this fallback does not establish seasonal adjustment.'
    # Reuse the existing hourly engine's protective relative spread-floor idea.
    # This is a disclosed review policy, not a physically calibrated tolerance.
    scale = max(spread, abs(expected) * RELATIVE_SCALE_FLOOR, 1e-6)
    score = (value - expected) / scale
    level = 'High deviation' if abs(score) >= REVIEW_Z else 'Watch' if abs(score) >= WATCH_Z else 'Within typical variation'
    row.update({'Expected reference': expected, 'Deviation': value - expected,
                'Robust deviation': float(score), 'Screening result': level, 'Scale': scale,
                'Lower review threshold': max(specs['lower_bound'], expected - REVIEW_Z * scale),
                'Upper review threshold': min(specs['upper_bound'], expected + REVIEW_Z * scale)
                    if specs['upper_bound'] is not None else expected + REVIEW_Z * scale,
                'Reason': f'{value:g} versus expected {expected:g}; signed deviation {value-expected:+g}; '
                          f'{score:+.2f} scaled deviations. Review policy: |z| ≥2 watch, ≥3 high deviation. '
                          'Scale floor is 2% of |expected| or 0.000001 at zero.',
                'Limitation': row['Limitation'] + ' ' + qualification +
                    ' Severity describes statistical review priority only; no medical, hazard or compliance classification.'})
    return row
