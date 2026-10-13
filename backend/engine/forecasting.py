"""Chronological candidate selection and held-out empirical error envelopes.

No fit sees its target or later values. Error envelopes are descriptive, not a
claimed coverage probability. Monthly gaps and censored values remain gaps.
"""
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

METHOD_NAMES = {
    'last_value': 'Last-value naïve',
    'recent_mean': 'Recent three-month mean',
    'seasonal_naive': 'Seasonal naïve (12 months)',
    'weighted_trend': 'Bounded weighted trend / seasonal correction',
    'calendar_demand': 'Approved calendar-based hypothetical water demand',
}


@dataclass
class ForecastResult:
    points: pd.Series = field(default_factory=lambda: pd.Series(dtype=float))
    lower: pd.Series = field(default_factory=lambda: pd.Series(dtype=float))
    upper: pd.Series = field(default_factory=lambda: pd.Series(dtype=float))
    scores: pd.DataFrame = field(default_factory=pd.DataFrame)
    validation: pd.DataFrame = field(default_factory=pd.DataFrame)
    calibration: pd.DataFrame = field(default_factory=pd.DataFrame)
    method: str = ''
    reason: str = ''
    limitations: str = ''
    selection_end: str = ''

    @property
    def available(self):
        return not self.points.empty


def monthly_history(history):
    if not isinstance(history.index, pd.DatetimeIndex) or history.index.tz is not None:
        return None, 'A timezone-free monthly date index is required.'
    s = pd.to_numeric(history, errors='coerce').sort_index()
    if s.index.has_duplicates or s.isna().any() or not np.isfinite(s.to_numpy()).all():
        return None, 'Missing, censored, duplicate or non-finite readings; no interpolation is performed.'
    if s.empty or not s.index.equals(pd.date_range(s.index.min(), s.index.max(), freq='MS')):
        return None, 'History must be contiguous calendar-month starts; dated water samples are not monthly series.'
    return s.astype(float), ''


def weighted_trend(history, horizon=6, lower=0, upper=None):
    """Reuse the Phase 2 transparent weighted-trend candidate and its bounds."""
    s, reason = monthly_history(history)
    if reason or len(s) < 3:
        return pd.Series(dtype=float)
    vals = s.to_numpy()
    n = min(len(vals), 18)
    slope = float(np.polyfit(np.arange(len(vals))[-n:], vals[-n:], 1, w=np.linspace(.6, 1.4, n))[0])
    avg = max(abs(float(np.mean(vals[-12:]))), 1e-9)
    slope = float(np.clip(slope, -.12 * avg, .12 * avg))
    future = pd.date_range(s.index[-1] + pd.offsets.MonthBegin(1), periods=horizon, freq='MS')
    values = float(np.mean(vals[-3:])) + slope * np.arange(1, horizon + 1)
    if len(s) >= 24:
        seasonal = s.groupby(s.index.month).mean()
        values += .35 * np.array([seasonal.get(d.month, s.mean()) - s.mean() for d in future])
    return pd.Series(np.clip(values, lower, upper), index=future)


def candidate(history, method, horizon, lower=0, upper=None, calendar_model=None):
    future = pd.date_range(history.index[-1] + pd.offsets.MonthBegin(1), periods=horizon, freq='MS')
    if method == 'weighted_trend':
        return weighted_trend(history, horizon, lower, upper)
    if method == 'last_value':
        values = np.full(horizon, float(history.iloc[-1]))
    elif method == 'recent_mean':
        values = np.full(horizon, float(history.iloc[-3:].mean()))
    elif method == 'seasonal_naive':
        values = np.resize(history.iloc[-12:].to_numpy(), horizon)
    elif method == 'calendar_demand':
        values = calendar_model['population'] * calendar_model['lpcd'] * future.days_in_month.to_numpy() + calendar_model['additional_l']
    else:
        raise ValueError('Unknown monthly method')
    return pd.Series(np.clip(values, lower, upper), index=future)


def evaluate_forecast(history, horizon=6, lower=0, upper=None, calendar_model=None):
    if not isinstance(horizon, int) or isinstance(horizon, bool) or not 1 <= horizon <= 12:
        raise ValueError('Forecast horizon must be 1–12 months')
    s, reason = monthly_history(history)
    if reason:
        return ForecastResult(reason=reason)
    if len(s) < 12:
        return ForecastResult(reason='At least 12 contiguous months are required for chronological model evaluation.')
    if lower is None or not np.isfinite(lower) or (upper is not None and upper < lower):
        raise ValueError('Invalid metric bounds')
    methods = ['last_value', 'recent_mean', 'weighted_trend']
    minimum_train = 6
    if len(s) >= 24:
        methods.append('seasonal_naive')
        minimum_train = 12
    if calendar_model is not None:
        inputs = [calendar_model.get(k) for k in ['population', 'lpcd', 'additional_l']]
        if any(v is None or not np.isfinite(v) or v < 0 for v in inputs):
            raise ValueError('Approved calendar model requires finite nonnegative disclosed inputs')
        methods.append('calendar_demand')
    # Reserve the last third (at most 12 months) for independent calibration.
    boundary = len(s) - min(12, max(4, len(s) // 3))
    if boundary - minimum_train < 2:
        return ForecastResult(reason='Insufficient chronological validation origins for model comparison.')
    validation = []
    for origin in range(minimum_train, boundary):
        steps = min(horizon, boundary - origin)
        train = s.iloc[:origin]
        for method in methods:
            predicted = candidate(train, method, steps, lower, upper, calendar_model)
            for lead, (target, prediction) in enumerate(predicted.items(), 1):
                validation.append({'method': method, 'train_end': train.index[-1], 'target_date': target,
                                   'lead': lead, 'actual': float(s.loc[target]), 'prediction': float(prediction),
                                   'error': float(s.loc[target] - prediction)})
    validation = pd.DataFrame(validation)
    scores = []
    for method in methods:
        errors = validation[validation.method == method]
        # Equal weight per evaluated lead, using identical origins for candidates.
        mae = float(errors.assign(absolute=errors.error.abs()).groupby('lead').absolute.mean().mean())
        scores.append({'method': method, 'Model': METHOD_NAMES[method], 'Chronological MAE': mae,
                       'Validation predictions': len(errors), 'Evaluated leads': int(errors.lead.max())})
    scores = pd.DataFrame(scores)
    best = float(scores['Chronological MAE'].min())
    tolerance = 1e-10 * max(1., float(s.iloc[:boundary].abs().mean()))
    selected = scores.loc[scores['Chronological MAE'] <= best + tolerance, 'method'].iloc[0]
    scores['Selected'] = scores.method.eq(selected)
    calibration = []
    for origin in range(boundary, len(s)):
        train = s.iloc[:origin]
        predictions = candidate(train, selected, min(horizon, len(s) - origin), lower, upper, calendar_model)
        for lead, (target, prediction) in enumerate(predictions.items(), 1):
            calibration.append({'method': selected, 'train_end': train.index[-1], 'target_date': target,
                                'lead': lead, 'actual': float(s.loc[target]), 'prediction': float(prediction),
                                'error': float(s.loc[target] - prediction)})
    calibration = pd.DataFrame(calibration)
    points = candidate(s, selected, horizon, lower, upper, calendar_model)
    lo, hi = pd.Series(np.nan, index=points.index), pd.Series(np.nan, index=points.index)
    for lead in range(1, horizon + 1):
        errors = calibration.loc[calibration.lead == lead, 'error']
        if len(errors) >= 8:
            qlo, qhi = np.quantile(errors.to_numpy(), [.1, .9])
            lo.iloc[lead - 1] = np.clip(points.iloc[lead - 1] + min(0., qlo), lower, upper)
            hi.iloc[lead - 1] = np.clip(points.iloc[lead - 1] + max(0., qhi), lower, upper)
    limitations = ('Model selected by chronological MAE on earlier origins; calibration uses later origins with the chosen method fixed. '
        '10th–90th percentile signed-error envelopes require ≥8 later errors at each lead; '
        'these are descriptive empirical ranges, not calibrated 80% or 95% prediction intervals. '
        'Longer horizons with sparse calibration have no uncertainty band. No trained machine learning or regulatory conclusion.')
    if calendar_model is not None:
        limitations += ' Water-demand projections depend on unchanged hypothetical population/LPCD/additional-use assumptions; zero model residuals do not establish certainty about real consumption.'
    return ForecastResult(points, lo, hi, scores, validation, calibration, selected, '', limitations,
                          s.index[boundary - 1].strftime('%Y-%m'))
