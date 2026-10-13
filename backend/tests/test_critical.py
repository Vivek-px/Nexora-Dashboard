from engine.critical import (
    cross_metric_events,
    maintenance_risk,
    sustainability_scorecard,
    waste_overflow_risk,
)


def test_scorecard_is_bounded_and_explains_missing_coverage():
    rows = [
        {'month': '2025-01', 'kwh_per_m2': 4.0, 'lpcd': 120, 'waste_kg_pp_day': 0.4, 'co2e_kg_per_person': 8},
        {'month': '2025-02', 'kwh_per_m2': 4.1, 'lpcd': 125, 'waste_kg_pp_day': 0.42, 'co2e_kg_per_person': 8.1},
        {'month': '2025-03', 'kwh_per_m2': 3.9, 'lpcd': 118, 'waste_kg_pp_day': 0.39, 'co2e_kg_per_person': 7.8},
        {'month': '2025-04', 'kwh_per_m2': 4.0, 'lpcd': 130, 'waste_kg_pp_day': 0.43, 'co2e_kg_per_person': 8.2},
    ]
    result = sustainability_scorecard(rows, {'epi_target': None, 'lpcd_target': 135, 'waste_target': None})
    assert 0 <= result['score'] <= 100
    assert result['coverage_pct'] == 100
    assert len(result['components']) == 4
    assert 'Equal-weight average' in result['method']


def test_scorecard_does_not_treat_missing_as_perfect():
    result = sustainability_scorecard([{'month': '2025-01'}], {'epi_target': 100, 'lpcd_target': None, 'waste_target': None})
    assert result['score'] is None
    assert result['coverage_pct'] == 0


def test_waste_risk_increases_with_spike_and_complaints():
    points = [('2025-01', 100, 'SYNTHETIC'), ('2025-02', 105, 'SYNTHETIC'), ('2025-03', 98, 'SYNTHETIC'),
              ('2025-04', 102, 'SYNTHETIC'), ('2025-05', 160, 'SYNTHETIC')]
    low = waste_overflow_risk(points, 0)
    high = waste_overflow_risk(points, 2)
    assert high['risk_score'] > low['risk_score']
    assert high['level'] in ('Moderate', 'High')
    assert high['projected_next_period_kg'] is not None
    assert 'individual bin' in high['limitations']


def test_maintenance_risk_explains_proxy_signals():
    series = {
        'peak_demand_kw': [('2025-01', 40, 'SYNTHETIC'), ('2025-02', 41, 'SYNTHETIC'), ('2025-03', 42, 'SYNTHETIC'), ('2025-04', 70, 'SYNTHETIC')],
        'hvac_kwh': [],
        'leakage_probability_pct': [('2025-01', 4, 'SYNTHETIC'), ('2025-02', 5, 'SYNTHETIC'), ('2025-03', 4, 'SYNTHETIC'), ('2025-04', 35, 'SYNTHETIC')],
    }
    result = maintenance_risk(series, 1)
    assert result['risk_score'] is not None
    assert result['signals']
    assert 'trained' in result['limitations'].lower()


def test_cross_metric_events_group_same_area_and_period_only():
    rows = [
        {'area_id': 'a', 'Measurement period': '2025-01', 'Screening result': 'Watch', 'Metric': 'Energy'},
        {'area_id': 'a', 'Measurement period': '2025-01', 'Screening result': 'High deviation', 'Metric': 'Water'},
        {'area_id': 'a', 'Measurement period': '2025-02', 'Screening result': 'Watch', 'Metric': 'Waste'},
        {'area_id': 'b', 'Measurement period': '2025-01', 'Screening result': 'Within typical variation', 'Metric': 'Energy'},
    ]
    events = cross_metric_events(rows)
    assert len(events) == 1
    assert events[0]['area'] == 'a'
    assert events[0]['period'] == '2025-01'
    assert events[0]['metric_count'] == 2
