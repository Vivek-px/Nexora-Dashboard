"""Part 1C tests: job profiles, staff portal, email / staff-ID sign-in, Google sign-in and access requests."""
import sys
import time
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from test_backend import client, csv, login  # noqa: E402,F401  (fixture reuse)


def profile_id(c, name):
    return next(p['id'] for p in c.get('/api/job-profiles').json()['profiles'] if p['name'] == name)


def test_presets_and_admin_access(client):
    me = client.get('/api/me').json()
    assert me['job_profile'] == 'Administrator' and me['staff_id'] == 'EIQ-0001' and 'staff' in me['pages'] and len(me['domains']) == 8
    names = [p['name'] for p in client.get('/api/job-profiles').json()['profiles']]
    assert {'Energy officer', 'Field staff', 'Water & sanitation officer', 'Director / commissioner'} <= set(names)


def test_staff_created_with_id_and_one_time_password(client):
    r = client.post('/api/staff', json={'name': 'Asha Energy', 'email': 'Asha@Example.org', 'job_profile_id': profile_id(client, 'Energy officer'), 'areas': 'palasuni'}).json()
    pw, sid = r['temp_password'], r['staff_id']
    assert sid.startswith('EIQ-') and r['role'] == 'manager' and r['email'] == 'asha@example.org' and r['must_change'] == 1
    assert client.post('/api/staff', json={'name': 'Dup', 'email': 'asha@example.org', 'job_profile_id': 1}).status_code == 409
    assert client.post('/api/staff', json={'name': 'Bad', 'email': 'not-an-email', 'job_profile_id': 1}).status_code == 400
    from fastapi.testclient import TestClient
    import app
    for ident in ('asha@example.org', sid, sid.lower()):   # email or staff ID both work
        t = TestClient(app.app).post('/api/login', json={'username': ident, 'password': pw})
        assert t.status_code == 200, ident
    a = login(client, 'ASHA@example.org', pw)
    me = a.get('/api/me').json()
    assert me['must_change'] == 1 and me['domains'] == ['Energy', 'Carbon'] and 'bills' in me['pages'] and 'staff' not in me['pages']
    assert a.post('/api/me/password', json={'old': pw, 'new': pw}).status_code == 400
    assert a.post('/api/me/password', json={'old': pw, 'new': 'my-new-pass-1'}).status_code == 200
    assert a.get('/api/me').json()['must_change'] == 0
    reset = client.post(f"/api/staff/{r['id']}/reset-password").json()
    assert reset['temp_password'] != pw and a.get('/api/me').status_code == 401      # old sessions end


def test_job_profile_limits_pages_and_domains(client):
    client.post('/api/upload', files=csv('area,metric,month,value\npalasuni,electricity_kwh,2026-01,61000\npalasuni,water_consumption_l,2026-01,9000000\n'))
    r = client.post('/api/staff', json={'name': 'Wasim Waste', 'email': 'waste@example.org', 'job_profile_id': profile_id(client, 'Waste supervisor')}).json()
    w = login(client, 'waste@example.org', r['temp_password'])
    assert w.get('/api/readings').json() == []                               # no Energy/Water readings for a waste profile
    assert all(a['metric'] in ('waste_kg', 'organic_waste_kg', 'plastic_waste_kg', 'paper_waste_kg') for a in w.get('/api/alerts').json())
    assert w.get('/api/bills').status_code == 403 and w.get('/api/reports/brsr.xlsx', params={'fy': 2025}).status_code == 403
    up = w.post('/api/upload', files=csv('area,metric,month,value\npalasuni,waste_kg,2026-01,5200\npalasuni,electricity_kwh,2026-02,1\n')).json()
    assert up['saved'] == 1 and any('outside your job profile' in e for e in up['errors'])
    f = client.post('/api/staff', json={'name': 'Field', 'email': 'field@example.org', 'job_profile_id': profile_id(client, 'Field staff')}).json()
    fs = login(client, 'field@example.org', f['temp_password'])
    assert fs.get('/api/me').json()['pages'] == ['today', 'complaints']
    assert fs.post('/api/complaints', data={'area': 'palasuni', 'category': 'Other', 'title': 'Broken tap'}).status_code == 200
    assert fs.get('/api/benchmarks').status_code == 403 and fs.post('/api/upload', files=csv('a\n')).status_code == 403


def test_custom_profile_and_safety(client):
    new = client.post('/api/job-profiles', json={'name': 'Night guard', 'level': 'viewer', 'pages': ['today', 'complaints', 'staff'], 'domains': ['Buildings & Assets']}).json()
    assert new['pages'] == ['today', 'complaints'] and new['domains'] == ['Buildings & Assets']   # admin-only pages dropped for viewers
    assert client.post('/api/job-profiles', json={'name': 'night GUARD', 'level': 'viewer', 'pages': ['today'], 'domains': ['Waste']}).status_code == 409
    admin_pid = profile_id(client, 'Administrator')
    assert client.patch(f'/api/job-profiles/{admin_pid}', json={'name': 'Administrator', 'level': 'manager', 'pages': ['today'], 'domains': ['Energy']}).status_code == 400
    assert client.delete(f'/api/job-profiles/{admin_pid}').status_code == 400
    assert client.delete(f"/api/job-profiles/{new['id']}").status_code == 200
    me = client.get('/api/me').json()
    assert client.patch(f"/api/staff/{me['id']}", json={'name': 'A', 'email': 'admin@example.org', 'job_profile_id': profile_id(client, 'Field staff')}).status_code == 400


def fake_google(seen, aud='client-123.apps.googleusercontent.com', email='new.person@gmail.com', sub='g-777', verified='true'):
    def handler(request):
        seen.append(request.url.params.get('id_token'))
        if request.url.params.get('id_token') == 'bad-token-xxxxxxxxxxxxx':
            return httpx.Response(400, json={'error': 'invalid_token'})
        return httpx.Response(200, json={'aud': aud, 'iss': 'https://accounts.google.com', 'email': email, 'email_verified': verified,
                                         'sub': sub, 'name': 'New Person', 'picture': '', 'exp': str(int(time.time()) + 600)})
    return lambda: httpx.Client(transport=httpx.MockTransport(handler))


def test_google_sign_in_and_access_requests(client, monkeypatch):
    import access
    from fastapi.testclient import TestClient
    import app
    anon = TestClient(app.app)
    monkeypatch.delenv('GOOGLE_CLIENT_ID', raising=False)
    assert anon.get('/api/auth/config').json()['google_client_id'] == ''
    assert anon.post('/api/auth/google', json={'credential': 'x' * 30}).status_code == 400
    monkeypatch.setenv('GOOGLE_CLIENT_ID', 'client-123.apps.googleusercontent.com')
    seen = []
    monkeypatch.setattr(access, '_client', fake_google(seen))
    r = anon.post('/api/auth/google', json={'credential': 'tok-' + 'a' * 30}).json()
    assert r['status'] == 'pending' and 'not registered' in r['message']
    anon.post('/api/auth/google', json={'credential': 'tok-' + 'a' * 30})       # asking twice keeps one request
    reqs = client.get('/api/access-requests').json()
    assert [x['email'] for x in reqs if x['status'] == 'pending'] == ['new.person@gmail.com']
    approved = client.post(f"/api/access-requests/{reqs[0]['id']}/approve", json={'job_profile_id': profile_id(client, 'Field staff'), 'areas': 'khandagiri'}).json()
    assert approved['temp_password'] is None and approved['sign_in'] == 'google' and approved['area_list'] == ['khandagiri']
    ok = anon.post('/api/auth/google', json={'credential': 'tok-' + 'a' * 30}).json()
    assert ok['user']['email'] == 'new.person@gmail.com' and ok['user']['job_profile'] == 'Field staff'
    # Google-only accounts cannot use a password; password-only accounts cannot use Google
    assert anon.post('/api/login', json={'username': 'new.person@gmail.com', 'password': 'whatever-123'}).status_code == 401
    pw_only = client.post('/api/staff', json={'name': 'P', 'email': 'pw@example.org', 'job_profile_id': 1, 'sign_in': 'password'}).json()
    monkeypatch.setattr(access, '_client', fake_google(seen, email='pw@example.org', sub='g-888'))
    assert anon.post('/api/auth/google', json={'credential': 'tok-' + 'b' * 30}).status_code == 403
    assert pw_only['temp_password']
    # forged or wrong-audience tokens are refused
    monkeypatch.setattr(access, '_client', fake_google(seen, aud='someone-else'))
    assert anon.post('/api/auth/google', json={'credential': 'tok-' + 'c' * 30}).status_code == 401
    monkeypatch.setattr(access, '_client', fake_google(seen, verified='false', email='x@gmail.com', sub='g-9'))
    assert anon.post('/api/auth/google', json={'credential': 'tok-' + 'd' * 30}).status_code == 401
    # a rejected request
    monkeypatch.setattr(access, '_client', fake_google(seen, email='spam@gmail.com', sub='g-10'))
    anon.post('/api/auth/google', json={'credential': 'tok-' + 'e' * 30})
    rid = next(x['id'] for x in client.get('/api/access-requests').json() if x['email'] == 'spam@gmail.com')
    assert client.post(f'/api/access-requests/{rid}/reject').status_code == 200
    assert client.post(f'/api/access-requests/{rid}/approve', json={'job_profile_id': 1}).status_code == 404


def test_indi_respects_job_profile(client, monkeypatch):
    import indi
    import json as _j
    seen = []

    def handler(request):
        seen.append(_j.loads(request.content))
        return httpx.Response(200, content=b'data: [DONE]\n\n')
    monkeypatch.setenv('GROQ_API_KEY', 'gsk_test')
    monkeypatch.setattr(indi, '_client', lambda: httpx.Client(transport=httpx.MockTransport(handler)))
    r = client.post('/api/staff', json={'name': 'Wasim', 'email': 'w2@example.org', 'job_profile_id': profile_id(client, 'Waste supervisor')}).json()
    w = login(client, 'w2@example.org', r['temp_password'])
    w.post('/api/indi/chat', json={'messages': [{'role': 'user', 'content': 'How is electricity?'}], 'area': 'palasuni'})
    ctx = seen[-1]['messages'][1]['content']
    assert 'Waste generated' in ctx and 'Electricity:' not in ctx and 'Electricity bill' not in ctx and 'JOB PROFILE: Waste supervisor' in ctx


def test_existing_part1b_database_upgrades(tmp_path):
    """A database from Part 1A/1B (no job profiles, no staff IDs) keeps its users, who get matching profiles."""
    import sqlite3
    import db
    path = tmp_path / 'old.db'
    con = sqlite3.connect(path)
    con.executescript('''CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL,
        areas TEXT NOT NULL DEFAULT '*', phone TEXT DEFAULT '', email TEXT DEFAULT '', pw_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')));
        INSERT INTO users(username, name, role, pw_hash) VALUES ('admin', 'Old Admin', 'admin', 'x'), ('pm', 'Old Manager', 'manager', 'x'), ('v', 'Old Viewer', 'viewer', 'x');''')
    con.commit(); con.close()
    db.reset_for_tests(path)
    import roles
    rows = {u['username']: u for u in db.q('SELECT * FROM users')}
    assert [rows[k]['staff_id'] for k in ('admin', 'pm', 'v')] == ['EIQ-0001', 'EIQ-0002', 'EIQ-0003']
    assert roles.access_of(rows['admin'])['job_profile'] == 'Administrator' and 'staff' in roles.access_of(rows['admin'])['pages']
    assert roles.access_of(rows['pm'])['job_profile'] == 'Estate / facility manager'
    assert roles.access_of(rows['v'])['job_profile'] == 'Auditor (read-only)' and 'upload' not in roles.access_of(rows['v'])['pages']
