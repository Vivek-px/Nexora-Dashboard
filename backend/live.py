"""Live feeds: official CPCB air quality (data.gov.in) with a clearly-labelled modelled fallback, and weather.

- Official AQI: data.gov.in "Real time Air Quality Index from various locations" (CPCB), needs a free API key
  in DATA_GOV_IN_API_KEY. Hourly station averages; the AQI here is an indicative CPCB sub-index calculation.
- Fallback air quality: Open-Meteo Air Quality (CAMS model), no key – shown as MODELLED, never as official.
- Weather: Open-Meteo forecast, no key.
Responses are cached in SQLite for 30 minutes so the dashboard stays fast and within free-use limits.
"""
import json
import math
import os
from datetime import datetime, timedelta, timezone

import httpx

from db import one, run

TTL_MIN = 30
DATA_GOV_URL = 'https://api.data.gov.in/resource/3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69'
WEATHER_URL = 'https://api.open-meteo.com/v1/forecast'
AIR_MODEL_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality'
STATION_KEYWORDS = {'palasuni': ['palasuni'], 'irc_nayapalli': ['irc', 'nayapalli'], 'khandagiri': ['khandagiri']}

# CPCB National AQI breakpoints: (conc_lo, conc_hi, index_lo, index_hi). Units µg/m³ (CO in mg/m³).
BREAKPOINTS = {
    'PM2.5': [(0, 30, 0, 50), (31, 60, 51, 100), (61, 90, 101, 200), (91, 120, 201, 300), (121, 250, 301, 400), (251, 380, 401, 500)],
    'PM10': [(0, 50, 0, 50), (51, 100, 51, 100), (101, 250, 101, 200), (251, 350, 201, 300), (351, 430, 301, 400), (431, 600, 401, 500)],
    'NO2': [(0, 40, 0, 50), (41, 80, 51, 100), (81, 180, 101, 200), (181, 280, 201, 300), (281, 400, 301, 400), (401, 600, 401, 500)],
    'SO2': [(0, 40, 0, 50), (41, 80, 51, 100), (81, 380, 101, 200), (381, 800, 201, 300), (801, 1600, 301, 400), (1601, 2400, 401, 500)],
    'OZONE': [(0, 50, 0, 50), (51, 100, 51, 100), (101, 168, 101, 200), (169, 208, 201, 300), (209, 748, 301, 400), (749, 1000, 401, 500)],
    'CO': [(0, 1.0, 0, 50), (1.1, 2.0, 51, 100), (2.1, 10, 101, 200), (10.1, 17, 201, 300), (17.1, 34, 301, 400), (34.1, 50, 401, 500)],
    'NH3': [(0, 200, 0, 50), (201, 400, 51, 100), (401, 800, 101, 200), (801, 1200, 201, 300), (1201, 1800, 301, 400), (1801, 2400, 401, 500)],
}
CATEGORIES = [(50, 'Good'), (100, 'Satisfactory'), (200, 'Moderate'), (300, 'Poor'), (400, 'Very Poor'), (500, 'Severe')]


def sub_index(pollutant, conc):
    bands = BREAKPOINTS.get(pollutant)
    if not bands or conc is None or not math.isfinite(conc) or conc < 0:
        return None
    for i, (clo, chi, ilo, ihi) in enumerate(bands):
        # Bands are written with integer gaps (30 → 31); treat each band as running up to the next band's start.
        upper = bands[i + 1][0] if i + 1 < len(bands) else chi
        if conc < upper or i == len(bands) - 1:
            return round(min(500, ilo + (ihi - ilo) * (min(conc, chi) - clo) / (chi - clo)))
    return None


def category(aqi):
    if aqi is None:
        return None
    return next(name for limit, name in CATEGORIES if aqi <= limit)


def compute_aqi(pollutants):
    """Indicative AQI = highest sub-index. CPCB requires PM2.5 or PM10 and at least three pollutants."""
    subs = {p: sub_index(p, v) for p, v in pollutants.items()}
    subs = {p: s for p, s in subs.items() if s is not None}
    valid = len(subs) >= 3 and ('PM2.5' in subs or 'PM10' in subs)
    if not subs:
        return None, None, subs, False
    aqi = max(subs.values())
    return aqi, max(subs, key=subs.get), subs, valid


def _client():
    return httpx.Client(timeout=20)


def cached(key, fetch, refresh=False):
    row = one('SELECT fetched_at, payload FROM live_cache WHERE key=?', (key,))
    fresh_after = (datetime.now(timezone.utc) - timedelta(minutes=TTL_MIN)).strftime('%Y-%m-%d %H:%M:%S')
    if row and not refresh and row['fetched_at'] >= fresh_after:
        return json.loads(row['payload']) | {'cached': True, 'fetched_at': row['fetched_at']}
    try:
        payload = fetch()
    except (httpx.HTTPError, ValueError, KeyError) as e:
        if row:  # serve the last good copy rather than nothing
            return json.loads(row['payload']) | {'cached': True, 'fetched_at': row['fetched_at'], 'stale': True, 'error': str(e)[:200]}
        return {'error': f'Could not reach the live service: {str(e)[:200]}'}
    now = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')
    run('INSERT INTO live_cache(key, fetched_at, payload) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET fetched_at=excluded.fetched_at, payload=excluded.payload',
        (key, now, json.dumps(payload)))
    return payload | {'cached': False, 'fetched_at': now}


def fetch_weather(lat, lon):
    r = _client().get(WEATHER_URL, params={
        'latitude': lat, 'longitude': lon, 'timezone': 'Asia/Kolkata', 'forecast_days': 3,
        'current': 'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,wind_speed_10m,weather_code',
        'daily': 'temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max'})
    r.raise_for_status()
    j = r.json()
    days = j.get('daily', {})
    return {'source': 'Open-Meteo forecast', 'current': j.get('current', {}),
            'daily': [{'date': d, 'tmax': days['temperature_2m_max'][i], 'tmin': days['temperature_2m_min'][i],
                       'rain_mm': days['precipitation_sum'][i], 'rain_prob': (days.get('precipitation_probability_max') or [None] * 9)[i]}
                      for i, d in enumerate(days.get('time', []))]}


def _num(v):
    try:
        f = float(v)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


def fetch_cpcb_city(city='Bhubaneswar'):
    key = os.environ.get('DATA_GOV_IN_API_KEY', '').strip()
    if not key:
        raise ValueError('DATA_GOV_IN_API_KEY not set')
    r = _client().get(DATA_GOV_URL, params={'api-key': key, 'format': 'json', 'limit': 1000, 'filters[city]': city})
    r.raise_for_status()
    stations = {}
    for rec in r.json().get('records', []):
        name = rec.get('station', '')
        st = stations.setdefault(name, {'station': name, 'last_update': rec.get('last_update', ''), 'pollutants': {},
                                         'lat': _num(rec.get('latitude')), 'lon': _num(rec.get('longitude'))})
        avg = _num(rec.get('avg_value', rec.get('pollutant_avg')))
        pid = (rec.get('pollutant_id') or '').upper().replace('O3', 'OZONE')
        if avg is not None and pid:
            st['pollutants'][pid] = avg
    if not stations:
        raise ValueError(f'No CPCB stations returned for {city}')
    return {'stations': list(stations.values())}


def fetch_air_model(lat, lon):
    r = _client().get(AIR_MODEL_URL, params={'latitude': lat, 'longitude': lon, 'timezone': 'Asia/Kolkata',
                                              'current': 'pm2_5,pm10,nitrogen_dioxide,sulphur_dioxide,ozone,carbon_monoxide'})
    r.raise_for_status()
    c = r.json().get('current', {})
    co = _num(c.get('carbon_monoxide'))
    return {'time': c.get('time', ''), 'pollutants': {k: v for k, v in {
        'PM2.5': _num(c.get('pm2_5')), 'PM10': _num(c.get('pm10')), 'NO2': _num(c.get('nitrogen_dioxide')),
        'SO2': _num(c.get('sulphur_dioxide')), 'OZONE': _num(c.get('ozone')), 'CO': co / 1000 if co is not None else None}.items() if v is not None}}


def pick_station(area, ref, stations):
    words = STATION_KEYWORDS.get(area, [])
    named = [s for s in stations if any(w in s['station'].lower() for w in words)]
    if named:
        return named[0], 'Named CPCB station for this area'
    located = [s for s in stations if s['lat'] is not None and s['lon'] is not None]
    if located and ref.get('latitude') is not None:
        best = min(located, key=lambda s: (s['lat'] - ref['latitude']) ** 2 + (s['lon'] - ref['longitude']) ** 2)
        return best, 'Nearest CPCB station (not located in this area)'
    return None, ''


def air_for(area, ref, refresh=False):
    """Official station reading when available; otherwise the modelled estimate, labelled as such."""
    city = cached('cpcb:bhubaneswar', fetch_cpcb_city, refresh) if os.environ.get('DATA_GOV_IN_API_KEY') else {'error': 'DATA_GOV_IN_API_KEY not set'}
    if 'stations' in city:
        st, how = pick_station(area, ref, city['stations'])
        if st:
            aqi, lead, subs, valid = compute_aqi(st['pollutants'])
            return {'kind': 'official', 'source': 'CPCB real-time (data.gov.in)', 'station': st['station'], 'match': how,
                    'time': st['last_update'], 'pollutants': st['pollutants'], 'sub_indices': subs, 'aqi': aqi, 'lead': lead,
                    'category': category(aqi), 'valid': valid, 'fetched_at': city.get('fetched_at'), 'stale': city.get('stale', False)}
    model = cached(f"airmodel:{area}", lambda: fetch_air_model(ref['latitude'], ref['longitude']), refresh)
    if not model.get('pollutants'):
        return {'kind': 'unavailable', 'error': model.get('error') or city.get('error'), 'official_error': city.get('error')}
    aqi, lead, subs, valid = compute_aqi(model['pollutants'])
    return {'kind': 'modelled', 'source': 'Open-Meteo air quality (CAMS model) – not an official measurement', 'station': None,
            'match': 'Modelled for the area reference point', 'time': model['time'], 'pollutants': model['pollutants'], 'sub_indices': subs,
            'aqi': aqi, 'lead': lead, 'category': category(aqi), 'valid': valid, 'fetched_at': model.get('fetched_at'),
            'stale': model.get('stale', False), 'official_error': city.get('error')}
