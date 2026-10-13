"""Place search and reverse lookup for pinning complaints (Part 1C), via OpenStreetMap Nominatim.

Follows the Nominatim usage policy: an identifying User-Agent, at most one request per second, results cached,
and searches only when the user presses Enter (no search-as-you-type).
"""
import json
import threading
import time
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query

from app import current_user
from db import one, run

router = APIRouter(prefix='/api/geo')
NOMINATIM = 'https://nominatim.openstreetmap.org'
UA = 'Nexora-Dashboard/1.0 (facility monitoring dashboard; self-hosted)'
ODISHA_VIEWBOX = '81.3,22.7,87.6,17.7'  # prefer results in Odisha, but do not exclude the rest of India
CACHE_DAYS = 30
_lock = threading.Lock()
_last = [0.0]


def _client():
    return httpx.Client(timeout=15, headers={'User-Agent': UA, 'Accept-Language': 'en'})


def _get(path, params):
    key = 'geo:' + path + ':' + json.dumps(params, sort_keys=True)
    row = one('SELECT payload, fetched_at FROM live_cache WHERE key=?', (key,))
    fresh_after = (datetime.now(timezone.utc) - timedelta(days=CACHE_DAYS)).strftime('%Y-%m-%d %H:%M:%S')
    if row and row['fetched_at'] >= fresh_after:
        return json.loads(row['payload'])
    with _lock:  # one request per second, across all users
        wait = 1.05 - (time.monotonic() - _last[0])
        if wait > 0:
            time.sleep(wait)
        try:
            r = _client().get(f'{NOMINATIM}/{path}', params=params | {'format': 'jsonv2'})
            r.raise_for_status()
            payload = r.json()
        except (httpx.HTTPError, ValueError) as e:
            raise HTTPException(502, f'Place search is unavailable right now ({type(e).__name__}). Type the coordinates or click the map instead.')
        finally:
            _last[0] = time.monotonic()
    now = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')
    run('INSERT INTO live_cache(key, fetched_at, payload) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET fetched_at=excluded.fetched_at, payload=excluded.payload',
        (key, now, json.dumps(payload)))
    return payload


@router.get('/search')
def search(q: str = Query(min_length=3, max_length=200), _=Depends(current_user)):
    rows = _get('search', {'q': q.strip(), 'countrycodes': 'in', 'viewbox': ODISHA_VIEWBOX, 'limit': 6, 'addressdetails': 0})
    return [{'name': r.get('display_name', ''), 'lat': float(r['lat']), 'lon': float(r['lon']), 'type': r.get('type', '')} for r in rows if 'lat' in r]


@router.get('/reverse')
def reverse(lat: float = Query(ge=-90, le=90), lon: float = Query(ge=-180, le=180), _=Depends(current_user)):
    r = _get('reverse', {'lat': round(lat, 5), 'lon': round(lon, 5), 'zoom': 17})
    return {'name': r.get('display_name', '') if isinstance(r, dict) else ''}
