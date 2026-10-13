from datetime import datetime, timezone
import pytest
from engine.hourly_demo import generate_readings, detect_hourly_events, forecast_next_24, recommendations

FIXED = datetime(2026, 10, 13, 12, tzinfo=timezone.utc)

def test_simulator_is_repeatable_and_labelled():
    a = generate_readings(48, 'normal', FIXED)
    b = generate_readings(48, 'normal', FIXED)
    assert a == b
    assert all(r['source'] == 'SIMULATED' for r in a)

def test_compound_injection_flags_multiple_metrics():
    rows = generate_readings(72, 'compound', FIXED)
    events = detect_hourly_events(rows)
    assert any(e['kind'] == 'compound' and {'water_l', 'energy_kwh'} <= {m['metric'] for m in e['metrics']} for e in events)

def test_forecast_returns_24_steps_and_errors():
    rows = generate_readings(72, 'normal', FIXED)
    result = forecast_next_24(rows)
    assert result['status'] == 'ok'
    assert len(result['forecast']) == 24
    assert result['backtest']['energy_kwh']['samples'] > 0

def test_forecast_requires_minimum_history():
    assert forecast_next_24(generate_readings(12, 'normal', FIXED))['status'] == 'insufficient_data'

def test_recommendations_include_assumptions_and_verification():
    rows = generate_readings(72, 'leak', FIXED)
    actions = recommendations(detect_hourly_events(rows))
    assert actions and all(a['assumptions'] and a['verification'] for a in actions)

def test_invalid_scenario_rejected():
    with pytest.raises(ValueError):
        generate_readings(24, 'fire', FIXED)
