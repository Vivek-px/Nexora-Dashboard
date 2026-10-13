"""Head approval (Part 1C): 'Create access ID' sign-ups, admin-proposed staff and admin promotions need the head."""
import sys
import time
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from test_backend import client, login  # noqa: E402,F401  (fixture reuse)
from test_access import profile_id  # noqa: E402


def anon():
    from fastapi.testclient import TestClient
    import app
    return TestClient(app.app)


def make_admin(head):
    """A second (non-head) admin, created by the head."""
    r = head.post('/api/staff', json={'name': 'Second Admin', 'email': 'admin2@example.org', 'job_profile_id': profile_id(head, 'Administrator')}).json()
    a = login(head, 'admin2@example.org', r['temp_password'])
    a.post('/api/me/password', json={'old': r['temp_password'], 'new': 'admin2-pass-x'})
    return a, r['id']


def test_signup_needs_head_approval(client):
    a = anon()
    cfg = a.get('/api/auth/config').json()
    assert cfg['head_email'] == 'head@example.org' and all(p['level'] != 'admin' for p in cfg['profiles'])
    energy = profile_id(client, 'Energy officer')
    r = a.post('/api/auth/signup', json={'name': 'Priya S', 'email': 'Priya@Example.org', 'phone': '9876543210', 'job_title': 'Energy auditor',
                                         'access': 'staff', 'requested_profile_id': energy, 'password': 'priya-own-pass'})
    assert r.status_code == 200 and r.json()['status'] == 'pending' and 'head@example.org' in r.json()['message']
    early = a.post('/api/login', json={'username': 'priya@example.org', 'password': 'priya-own-pass'})
    assert early.status_code == 403 and 'waiting for the head' in early.json()['detail']   # not yet
    assert a.post('/api/auth/signup', json={'name': 'Xavier', 'email': 'head@example.org', 'access': 'admin', 'password': 'xxxxxxxx1'}).status_code == 400
    req = next(x for x in client.get('/api/access-requests').json() if x['email'] == 'priya@example.org')
    assert req['source'] == 'signup' and req['requested_profile'] == 'Energy officer' and req['job_title'] == 'Energy auditor' and 'pw_hash' not in req
    admin2, _ = make_admin(client)
    assert admin2.post(f"/api/access-requests/{req['id']}/approve", json={'job_profile_id': energy}).status_code == 403   # admins cannot approve
    assert admin2.post(f"/api/access-requests/{req['id']}/reject").status_code == 403
    ok = client.post(f"/api/access-requests/{req['id']}/approve", json={'job_profile_id': energy, 'areas': 'palasuni'}).json()
    assert ok['temp_password'] is None and ok['own_password'] is True and ok['staff_id'].startswith('EIQ-')
    p = login(client, 'priya@example.org', 'priya-own-pass')            # signs in with the password she chose
    me = p.get('/api/me').json()
    assert me['must_change'] == 0 and me['job_profile'] == 'Energy officer' and me['area_list'] == ['palasuni']
    assert a.post('/api/auth/signup', json={'name': 'Priya', 'email': 'priya@example.org', 'access': 'staff', 'password': 'another-pass'}).status_code == 409


def test_admin_requests_need_head(client):
    admin2, admin2_id = make_admin(client)
    field = profile_id(client, 'Field staff')
    r = admin2.post('/api/staff', json={'name': 'Gopal', 'email': 'gopal@example.org', 'job_profile_id': field, 'areas': 'khandagiri'}).json()
    assert r['status'] == 'pending'                                       # proposed, not created
    req = next(x for x in client.get('/api/access-requests').json() if x['email'] == 'gopal@example.org')
    assert req['source'] == 'admin' and req['proposed_by_name'] == 'Second Admin' and req['proposed_areas'] == 'khandagiri'
    ok = client.post(f"/api/access-requests/{req['id']}/approve", json={'job_profile_id': field, 'areas': req['proposed_areas']}).json()
    assert ok['temp_password'] and ok['area_list'] == ['khandagiri']
    gid = ok['id']
    admin_pid = profile_id(client, 'Administrator')
    body = {'name': 'Gopal', 'email': 'gopal@example.org', 'job_profile_id': admin_pid}
    assert admin2.patch(f'/api/staff/{gid}', json=body).status_code == 403          # promotion to admin needs the head
    assert client.patch(f'/api/staff/{gid}', json=body).json()['role'] == 'admin'
    head_id = client.get('/api/me').json()['id']
    assert admin2.patch(f'/api/staff/{head_id}', json={'name': 'X', 'email': 'head@example.org', 'job_profile_id': field}).status_code == 403
    assert client.patch(f'/api/staff/{head_id}', json={'name': 'Head', 'email': 'head@example.org', 'job_profile_id': field}).status_code == 400
    assert admin2.post(f'/api/staff/{gid}/reset-password').status_code == 403     # resetting another admin needs the head
    assert admin2.post('/api/job-profiles', json={'name': 'Super', 'level': 'admin', 'pages': ['today'], 'domains': ['Energy']}).status_code == 403
    assert admin2.post('/api/users', json={'username': 'sneaky', 'name': 'S', 'role': 'admin', 'password': 'xxxxxxxx1'}).status_code == 403
    assert admin2.post('/api/staff', json={'name': 'Fake head', 'email': 'head@example.org', 'job_profile_id': field}).status_code == 400
    assert client.get('/api/access-requests/count').json() == {'pending': 0, 'head_email': 'head@example.org'}


def test_head_proves_email_with_google(client, monkeypatch):
    import access
    monkeypatch.setenv('GOOGLE_CLIENT_ID', 'cid.apps.googleusercontent.com')
    monkeypatch.setenv('HEAD_EMAIL', 'viveksahusahu999@gmail.com')

    def handler(request):
        return httpx.Response(200, json={'aud': 'cid.apps.googleusercontent.com', 'iss': 'accounts.google.com', 'email': 'viveksahusahu999@gmail.com',
                                         'email_verified': True, 'sub': 'g-head', 'name': 'Vivek', 'exp': str(int(time.time()) + 600)})
    monkeypatch.setattr(access, '_client', lambda: httpx.Client(transport=httpx.MockTransport(handler)))
    r = anon().post('/api/auth/google', json={'credential': 'h' * 40}).json()
    assert r['user']['is_head'] == 1 and r['user']['job_profile'] == 'Administrator' and r['user']['email'] == 'viveksahusahu999@gmail.com'
    # a password sign-up cannot claim the head's email
    assert anon().post('/api/auth/signup', json={'name': 'Fake', 'email': 'viveksahusahu999@gmail.com', 'access': 'admin', 'password': 'xxxxxxxx1'}).status_code == 400


def test_complaint_dismiss_restore_and_permanent_delete(client):
    import io
    from test_backend import real_image
    from db import DATA
    r = client.post('/api/complaints', data={'area': 'palasuni', 'category': 'Water leak', 'title': 'Leak by gate 3'},
                    files={'photo': ('p.png', io.BytesIO(real_image('PNG')), 'image/png')}).json()
    cid, photo = r['id'], r['photo']
    aid = 'abc123complaint'
    client.patch(f'/api/actions/{aid}', json={'area': 'palasuni', 'title': 'Inspect', 'status': 'In progress', 'complaint_id': cid})
    client.post(f'/api/actions/{aid}/proof', data={'area': 'palasuni'}, files={'file': ('fix.png', io.BytesIO(real_image('PNG')), 'image/png')})
    proof = client.get('/api/actions').json()[aid]['events'][-1]['file']
    # dismiss from the complaints page → complaint and its action are dismissed
    d = client.post(f'/api/complaints/{cid}/dismiss', json={'reason': 'Duplicate of #2', 'action_id': aid}).json()
    assert d['status'] == 'dismissed' and d['dismiss_reason'] == 'Duplicate of #2'
    assert client.get('/api/actions').json()[aid]['status'] == 'Dismissed'
    # restore, then dismiss from the action tracker instead → complaint follows
    assert client.post(f'/api/complaints/{cid}/restore', json={'action_id': aid}).json()['status'] == 'open'
    assert client.get('/api/actions').json()[aid]['status'] == 'Open'
    client.patch(f'/api/actions/{aid}', json={'area': 'palasuni', 'title': 'Inspect', 'status': 'Dismissed', 'complaint_id': cid})
    assert next(c for c in client.get('/api/complaints').json() if c['id'] == cid)['status'] == 'dismissed'
    # viewers cannot dismiss; managers cannot delete; admins delete everything
    v = client.post('/api/staff', json={'name': 'Viewer', 'email': 'v@example.org', 'job_profile_id': profile_id(client, 'Auditor (read-only)')}).json()
    vc = login(client, 'v@example.org', v['temp_password'])
    assert vc.post(f'/api/complaints/{cid}/restore', json={}).status_code == 403
    m = client.post('/api/staff', json={'name': 'Mgr', 'email': 'm@example.org', 'job_profile_id': profile_id(client, 'Estate / facility manager')}).json()
    mc = login(client, 'm@example.org', m['temp_password'])
    assert mc.delete(f'/api/complaints/{cid}', params={'action_id': aid}).status_code == 403
    assert (DATA / 'uploads' / photo).exists() and (DATA / 'uploads' / proof).exists()
    gone = client.delete(f'/api/complaints/{cid}', params={'action_id': aid}).json()
    assert gone == {'ok': True, 'deleted': cid, 'files_removed': 2}
    assert not (DATA / 'uploads' / photo).exists() and not (DATA / 'uploads' / proof).exists()
    assert all(c['id'] != cid for c in client.get('/api/complaints').json()) and aid not in client.get('/api/actions').json()
    assert client.delete(f'/api/complaints/{cid}').status_code == 404
