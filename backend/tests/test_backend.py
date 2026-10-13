"""Backend tests. Run from the project folder:  python -m pytest backend/tests -q"""
import io
import json
import sys
from pathlib import Path

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import db  # noqa: E402


@pytest.fixture()
def client(tmp_path, monkeypatch):
    db.reset_for_tests(tmp_path / 'test.db')
    for k in ['WHATSAPP_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_TEMPLATE', 'SMS_PROVIDER', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM']:
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv('HEAD_EMAIL', 'head@example.org')   # the first account is the head (approves access)
    import app
    from fastapi.testclient import TestClient
    c = TestClient(app.app)
    r = c.post('/api/setup', json={'username': 'admin', 'password': 'admin-pass-1', 'name': 'Admin', 'email': 'head@example.org'})
    assert r.status_code == 200
    c.headers['Authorization'] = 'Bearer ' + r.json()['token']
    return c


def login(c, user, pw):
    from fastapi.testclient import TestClient
    import app
    other = TestClient(app.app)
    r = other.post('/api/login', json={'username': user, 'password': pw})
    assert r.status_code == 200, r.text
    other.headers['Authorization'] = 'Bearer ' + r.json()['token']
    return other


def real_image(fmt='PNG', size=(24, 16), mode='RGB'):
    """A genuine small image in the given format (uploads are checked by content)."""
    from PIL import Image
    buf = io.BytesIO()
    Image.new(mode, size, (200, 80, 40) if mode == 'RGB' else None).save(buf, fmt)
    return buf.getvalue()


def csv(text):
    return {'file': ('readings.csv', io.BytesIO(text.encode()), 'text/csv')}


def test_setup_only_once_and_login(client):
    assert client.get('/api/setup/status').json() == {'needs_setup': False}
    assert client.post('/api/setup', json={'username': 'x', 'password': 'whatever1'}).status_code in (409, 422)
    assert client.post('/api/login', json={'username': 'admin', 'password': 'wrong-pass'}).status_code == 401
    assert client.get('/api/me').json()['role'] == 'admin'


def test_roles_and_sites(client):
    client.post('/api/users', json={'username': 'mgr', 'name': 'Manager P', 'role': 'manager', 'areas': 'palasuni', 'password': 'manager-pass'})
    client.post('/api/users', json={'username': 'view', 'name': 'Viewer', 'role': 'viewer', 'password': 'viewer-pass'})
    viewer = login(client, 'view', 'viewer-pass')
    assert viewer.post('/api/upload', files=csv('area,metric,month,value\npalasuni,electricity_kwh,2026-01,30000\n')).status_code == 403
    mgr = login(client, 'mgr', 'manager-pass')
    assert mgr.get('/api/me').json()['area_list'] == ['palasuni']
    r = mgr.post('/api/upload', files=csv('area,metric,month,value\nkhandagiri,electricity_kwh,2026-01,30000\n')).json()
    assert r['saved'] == 0 and 'do not have access' in r['errors'][0]
    assert mgr.get('/api/users').json()[0].keys() == {'id', 'name', 'role'}  # no private details for non-admins


def test_upload_validation(client):
    body = ('area,metric,month,value\n'
            'palasuni,electricity_kwh,2026-01,30100\n'
            'palasuni,not_a_metric,2026-01,1\n'
            'palasuni,electricity_kwh,January,1\n'
            'palasuni,building_occupancy_pct,2026-01,140\n'
            'mars,electricity_kwh,2026-01,1\n')
    r = client.post('/api/upload', files=csv(body)).json()
    assert r['saved'] == 1 and len(r['errors']) == 4
    assert client.get('/api/readings').json()[0]['value'] == 30100


def test_windows_excel_csv_encodings(client):
    body = 'area;metric;month;value;note\r\npalasuni;electricity_kwh;2026-01;30100;Caf\u00e9 meter \u2013 main\r\n'
    for enc in ('utf-8-sig', 'cp1252'):
        r = client.post('/api/upload', files={'file': ('excel.csv', io.BytesIO(body.encode(enc)), 'text/csv')}).json()
        assert r['saved'] == 1, (enc, r)
    assert client.get('/api/readings').json()[0]['note'] == 'Caf\u00e9 meter \u2013 main'


def test_wide_excel_upload(client):
    from openpyxl import Workbook
    wb = Workbook(); ws = wb.active
    ws.append(['Month', 'Electricity', 'Waste generated'])
    ws.append(['2026-01', 29900, 5400])
    ws.append(['2026-02', 30200, 5500])
    buf = io.BytesIO(); wb.save(buf)
    r = client.post('/api/upload', data={'area': 'IRC Village'}, files={'file': ('m.xlsx', io.BytesIO(buf.getvalue()), 'application/octet-stream')}).json()
    assert r['saved'] == 4, r
    assert {(x['area'], x['metric']) for x in client.get('/api/readings').json()} == {('irc_nayapalli', 'electricity_kwh'), ('irc_nayapalli', 'waste_kg')}


def test_screening_matches_mvp_export():
    import data
    exported = {f['metric_key']: f for f in data.base()['findings']['palasuni']['2023,2024,2025']}
    for key in ['pm25_ug_m3', 'electricity_kwh', 'aqi_official']:
        mine = data.screen_latest('palasuni', key)
        assert mine['Screening result'] == exported[key]['Screening result']
        if exported[key]['Robust deviation'] is not None:
            assert mine['Robust deviation'] == pytest.approx(exported[key]['Robust deviation'], abs=1e-3)


def test_high_reading_creates_alert_and_whatsapp(client, monkeypatch):
    sent = []

    class Fake:
        def post(self, url, **kw):
            sent.append((url, kw))
            return httpx.Response(200, text='{"messages":[{"id":"wamid.x"}]}')
    import notify
    monkeypatch.setattr(notify, '_client', Fake)
    monkeypatch.setenv('WHATSAPP_TOKEN', 'test-token')
    monkeypatch.setenv('WHATSAPP_PHONE_NUMBER_ID', '12345')
    monkeypatch.setenv('WHATSAPP_TEMPLATE', 'nexora_alert')
    client.post('/api/recipients', json={'name': 'Estate officer', 'channel': 'whatsapp', 'phone': '98765 43210', 'min_level': 'Watch'})
    client.post('/api/recipients', json={'name': 'SMS only high', 'channel': 'sms', 'phone': '+919876500000', 'min_level': 'High deviation'})
    r = client.post('/api/upload', files=csv('area,metric,month,value\npalasuni,electricity_kwh,2026-01,60000\n')).json()
    assert r['alerts'] and r['alerts'][0]['level'] == 'High deviation'
    alerts = client.get('/api/alerts').json()
    d = {x['channel']: x for x in alerts[0]['deliveries']}
    assert d['whatsapp']['status'] == 'sent' and d['sms']['status'] == 'not_configured'
    url, kw = sent[0]
    assert url.endswith('/12345/messages') and kw['json']['to'] == '919876543210' and kw['json']['template']['name'] == 'nexora_alert'
    assert 'High deviation' in kw['json']['template']['components'][0]['parameters'][0]['text']
    # the same upload again does not create a duplicate alert
    assert client.post('/api/upload', files=csv('area,metric,month,value\npalasuni,electricity_kwh,2026-01,60000\n')).json()['alerts'] == []


def test_every_uploaded_month_is_screened(client):
    body = 'area,metric,month,value\n' + 'palasuni,electricity_kwh,2026-01,61000\npalasuni,electricity_kwh,2026-02,27500\npalasuni,electricity_kwh,2026-03,27200\n'
    r = client.post('/api/upload', files=csv(body)).json()
    assert [(a['month'], a['level']) for a in r['alerts']] == [('2026-01', 'High deviation')]


def test_twilio_sms_and_escalation(client, monkeypatch):
    sent = []
    class Fake:
        def post(self, url, **kw):
            sent.append((url, kw))
            return httpx.Response(201, text='{}')
    import notify
    monkeypatch.setattr(notify, '_client', Fake)
    monkeypatch.setenv('SMS_PROVIDER', 'twilio')
    monkeypatch.setenv('TWILIO_ACCOUNT_SID', 'AC123'); monkeypatch.setenv('TWILIO_AUTH_TOKEN', 'tok'); monkeypatch.setenv('TWILIO_FROM', '+15550001111')
    client.post('/api/recipients', json={'name': 'Director', 'channel': 'sms', 'phone': '9000000001', 'escalation': True})
    client.post('/api/upload', files=csv('area,metric,month,value\npalasuni,electricity_kwh,2026-01,60000\n'))
    assert sent and sent[0][1]['data']['To'] == '+919000000001'
    import app
    client.put('/api/settings/escalation', json={'hours': 0.0001})
    db.run("UPDATE alerts SET created_at = datetime('now', '-1 hour')")
    assert app.run_escalations()  # escalated once …
    assert not app.run_escalations()  # … and only once
    kinds = [d['kind'] for d in client.get('/api/alerts').json()[0]['deliveries']]
    assert kinds.count('escalation') == 1
    # acknowledged alerts are never escalated
    aid = client.get('/api/alerts').json()[0]['id']
    assert client.patch(f'/api/alerts/{aid}', json={'status': 'acknowledged'}).json()['status'] == 'acknowledged'


def test_action_tracker_and_proof(client):
    r = client.patch('/api/actions/abc123', json={'area': 'palasuni', 'title': 'Check PM10 report', 'status': 'In progress', 'owner_id': 1, 'due_date': '2026-11-01', 'comment': 'Started'}).json()
    assert r['status'] == 'In progress' and r['owner_name'] == 'Admin' and r['due_date'] == '2026-11-01'
    png = real_image('PNG')
    r = client.post('/api/actions/abc123/proof', data={'area': 'palasuni', 'text': 'Site photo'}, files={'file': ('p.png', io.BytesIO(png), 'image/png')}).json()
    assert [e['kind'] for e in r['events']] == ['status', 'owner', 'due', 'comment', 'proof']
    assert client.get('/api/files/' + r['events'][-1]['file']).content == png
    assert client.post('/api/actions/abc123/proof', data={'area': 'palasuni'}, files={'file': ('x.exe', io.BytesIO(b'MZ'), 'application/octet-stream')}).status_code == 400


def test_savings(client):
    client.post('/api/upload', files=csv('area,metric,month,value\n' + ''.join(f'palasuni,electricity_kwh,2026-0{m},27000\n' for m in (1, 2, 3))))
    import data
    pts = {m: v for m, v, _ in data.merged('palasuni', 'electricity_kwh')}
    base = sum(pts[f'2025-{m:02d}'] for m in (10, 11, 12)) / 3
    r = client.post('/api/savings', json={'area': 'palasuni', 'metric': 'electricity_kwh', 'baseline_from': '2025-10', 'baseline_to': '2025-12',
                                          'after_from': '2026-01', 'after_to': '2026-03', 'tariff': 8}).json()
    assert r['units_saved'] == pytest.approx((base - 27000) * 3) and r['rupees_saved'] == pytest.approx(r['units_saved'] * 8)
    assert r['evidence'].startswith('Estimate')  # baseline months are demonstration data
    r2 = client.post('/api/savings', json={'area': 'palasuni', 'metric': 'electricity_kwh', 'baseline_from': '2026-01', 'baseline_to': '2026-01',
                                           'after_from': '2026-02', 'after_to': '2026-03', 'tariff': 8, 'save': False}).json()
    assert r2['evidence'] == 'Measured (facility upload)' and r2['units_saved'] == 0
    assert len(client.get('/api/savings').json()) == 1


def test_critical_insights_endpoint_has_all_four_capabilities(client):
    response = client.get('/api/critical-insights')
    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body) == {'palasuni', 'irc_nayapalli', 'khandagiri'}
    for item in body.values():
        assert 0 <= item['scorecard']['coverage_pct'] <= 100
        assert item['scorecard']['components_total'] == 4
        assert 'risk_score' in item['waste_overflow']
        assert 'risk_score' in item['maintenance_risk']
        assert isinstance(item['cross_metric_events'], list)
