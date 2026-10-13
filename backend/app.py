"""Nexora backend: logins and roles, measured-data upload, alerts (WhatsApp/SMS), action tracking and savings.

Run:  python -m uvicorn app:app --app-dir backend --port 8000
It also serves the built dashboard (dist/) so one address – http://localhost:8000 – runs everything.
"""
import asyncio
import hashlib
import hmac
import json
import os
import secrets
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import BackgroundTasks, Depends, FastAPI, File, Form, Header, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import data
import images
import notify
import roles
from db import DATA, one, q, run, setting


def load_env():
    path = Path(__file__).resolve().parent / '.env'
    if path.exists():
        for line in path.read_text(encoding='utf8').splitlines():
            if '=' in line and not line.strip().startswith('#'):
                k, v = line.split('=', 1)
                v = v.strip().strip('"').strip("'")
                if v:  # an empty setting means "not set": keep the built-in default
                    os.environ.setdefault(k.strip(), v)


load_env()
LEVELS = {'Watch': 1, 'High deviation': 2}
ROLE_RANK = {'viewer': 0, 'manager': 1, 'admin': 2}
now = lambda: datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')  # noqa: E731
EMAIL_RE = __import__('re').compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')
DEFAULT_HEAD_EMAIL = 'viveksahusahu999@gmail.com'


def head_email():
    """The head approves every staff/admin access. Change with HEAD_EMAIL in backend/.env."""
    return (os.environ.get('HEAD_EMAIL', '').strip() or DEFAULT_HEAD_EMAIL).lower()


# ------------------------------------------------------------------ auth

def hash_pw(password, salt=None):
    salt = salt or secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac('sha256', password.encode(), bytes.fromhex(salt), 240_000)
    return f'pbkdf2${salt}${dk.hex()}'


def check_pw(password, stored):
    try:
        _, salt, _ = stored.split('$')
    except ValueError:
        return False
    return hmac.compare_digest(hash_pw(password, salt), stored)


def public_user(u):
    return ({k: u.get(k) for k in ('id', 'username', 'name', 'role', 'areas', 'phone', 'email', 'active', 'staff_id', 'must_change', 'sign_in', 'last_login', 'is_head')}
            | {'area_list': allowed(u)} | roles.access_of(u))


def set_profile(uid, profile_id):
    """Assign a job profile; the permission level (role) always follows the profile."""
    prof = one('SELECT * FROM job_profiles WHERE id=?', (profile_id,))
    if not prof:
        raise HTTPException(400, 'Unknown job profile')
    run('UPDATE users SET job_profile_id=?, role=?, staff_id=COALESCE(NULLIF(staff_id, \'\'), ?) WHERE id=?', (prof['id'], prof['level'], roles.staff_code(uid), uid))
    return prof


def profile_for_role(role):
    return one('SELECT id FROM job_profiles WHERE name=?', (roles.ROLE_DEFAULT[role],))['id']


def need_page(page):
    """The user's job profile must include this page (menus are hidden in the dashboard and enforced here)."""
    def dep(user=Depends(current_user)):
        if page not in roles.access_of(user)['pages']:
            raise HTTPException(403, 'Your job profile does not include this page – ask an admin')
        return user
    return dep


def allowed_metrics(user):
    doms = set(roles.access_of(user)['domains'])
    return {k for k, m in data.metrics().items() if m['domain'] in doms}


def allowed(u):
    return data.area_ids() if u['areas'] == '*' else [a for a in u['areas'].split(',') if a in data.area_ids()]


def user_from_token(token):
    row = one('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>? AND u.active=1', (token, now()))
    return row


def current_user(authorization: str = Header(default=''), t: str = Query(default='')):
    token = authorization.removeprefix('Bearer ').strip() or t
    user = user_from_token(token) if token else None
    if not user:
        raise HTTPException(401, 'Please sign in')
    return user


def need(role):
    def dep(user=Depends(current_user)):
        if ROLE_RANK[user['role']] < ROLE_RANK[role]:
            raise HTTPException(403, f'This needs the {role} role')
        return user
    return dep


def need_head(user=Depends(current_user)):
    if not user.get('is_head'):
        raise HTTPException(403, f'Only the head ({head_email()}) can approve access')
    return user


def check_area(user, area):
    if area not in allowed(user):
        raise HTTPException(403, 'You do not have access to this site')


# ------------------------------------------------------------------ alerts

def nice(v):
    return f'{v:,.0f}' if abs(v) >= 100 else f'{v:,.2f}'


def alert_text(f):
    v, e, z = f.get('Value'), f.get('Expected reference'), f.get('Robust deviation')
    unit = f.get('Unit', '')
    body = f"{f['Screening result']}: {f['Area']} · {f['Metric']} · {f['Measurement period']} = {nice(v)} {unit}"
    if e is not None:
        body += f" (expected {nice(e)}, {z:+.1f} scaled deviations)"
    return f'Nexora alert – {body}. Please review in the dashboard.'


def recipients_for(area, level, escalation=False):
    rows = q('SELECT * FROM recipients WHERE active=1' + (' AND escalation=1' if escalation else ''))
    return [r for r in rows if LEVELS.get(level, 0) >= LEVELS.get(r['min_level'], 1) and (r['areas'] == '*' or area in r['areas'].split(','))]


def deliver(alert_id, kind='initial'):
    a = one('SELECT * FROM alerts WHERE id=?', (alert_id,))
    if not a:
        return
    text = a['message'] if kind == 'initial' else f"ESCALATION (not acknowledged): {a['message']}"
    for r in recipients_for(a['area'], a['level'], escalation=(kind == 'escalation')):
        st, detail = notify.send(r['channel'], r['phone'], text)
        run('INSERT INTO alert_deliveries(alert_id, channel, recipient, kind, status, detail) VALUES (?,?,?,?,?,?)',
            (alert_id, r['channel'], f"{r['name']} {notify.normalise_phone(r['phone'])}", kind, st, detail))


def screen_and_alert(points):
    """Screen every uploaded month against the history before it (the MVP rule applied month by month);
    create alerts for Watch/High deviation on measured data."""
    created = []
    for area, metric, month in sorted(points):
        f = data.screen_latest(area, metric, upto=month)
        if f['Classification'] != data.MEASURED or f['Screening result'] not in LEVELS:
            continue
        exists = one('SELECT id FROM alerts WHERE area=? AND metric=? AND month=? AND level=?', (area, metric, f['Measurement period'], f['Screening result']))
        if exists:
            continue
        aid = run('INSERT INTO alerts(area, metric, month, level, message, detail) VALUES (?,?,?,?,?,?)',
                  (area, metric, f['Measurement period'], f['Screening result'], alert_text(f), json.dumps(f, default=str)))
        created.append(aid)
    return created


def run_escalations():
    """Re-send open, unacknowledged alerts to escalation contacts once the escalation time has passed."""
    hours = float(setting('escalation_hours', '24') or 24)
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=hours)).strftime('%Y-%m-%d %H:%M:%S')
    done = []
    for a in q("SELECT id FROM alerts WHERE status='open' AND escalated_at IS NULL AND created_at<=?", (cutoff,)):
        deliver(a['id'], 'escalation')
        run('UPDATE alerts SET escalated_at=? WHERE id=?', (now(), a['id']))
        done.append(a['id'])
    return done


async def escalation_loop():
    while True:
        try:
            await asyncio.to_thread(run_escalations)
        except Exception as e:  # keep the loop alive; the error is visible in the console
            print('[escalation]', e)
        await asyncio.sleep(float(os.environ.get('ESCALATION_CHECK_SECONDS', '300')))


@asynccontextmanager
async def lifespan(_app):
    task = asyncio.create_task(escalation_loop())
    yield
    task.cancel()


app = FastAPI(title='Nexora backend', lifespan=lifespan)


# ------------------------------------------------------------------ setup & login

class Creds(BaseModel):
    username: str = Field(min_length=3, max_length=120)  # username, staff ID or email when signing in
    password: str = Field(min_length=8, max_length=200)
    name: str = ''
    email: str = Field(default='', max_length=120)


@app.get('/api/health')
def health():
    return {'ok': True}


@app.get('/api/setup/status')
def setup_status():
    return {'needs_setup': one('SELECT COUNT(*) n FROM users')['n'] == 0}


@app.post('/api/setup')
def setup(c: Creds):
    if not setup_status()['needs_setup']:
        raise HTTPException(409, 'Setup is already complete')
    email = c.email.strip().lower()
    if email and not EMAIL_RE.match(email):
        raise HTTPException(400, 'Enter a valid email address')
    # First run happens on the server PC itself; if the head's email is used here, this account is the head.
    uid = run('INSERT INTO users(username, name, role, email, pw_hash, is_head) VALUES (?,?,?,?,?,?)',
              (c.username.lower(), c.name or c.username, 'admin', email, hash_pw(c.password), int(email == head_email())))
    set_profile(uid, profile_for_role('admin'))
    return login(c)


@app.post('/api/login')
def login(c: Creds):
    ident = c.username.strip().lower()
    u = one('SELECT * FROM users WHERE active=1 AND (username=? OR lower(email)=? OR lower(staff_id)=?)', (ident, ident, ident)) if ident else None
    if not u and ident and one("SELECT id FROM access_requests WHERE lower(email)=? AND status='pending'", (ident,)):
        raise HTTPException(403, f'Your access request is waiting for the head’s approval ({head_email()}). You can sign in once it is approved.')
    if not u and ident and one("SELECT id FROM access_requests WHERE lower(email)=? AND status='rejected'", (ident,)):
        raise HTTPException(403, 'Your access request was not approved. Contact the head or your admin.')
    if not u or not check_pw(c.password, u['pw_hash']):
        raise HTTPException(401, 'Wrong email/staff ID or password')
    if u.get('sign_in') == 'google':
        raise HTTPException(401, 'This account signs in with Google – use the “Sign in with Google” button')
    return start_session(u)


def start_session(u):
    token = secrets.token_urlsafe(32)
    run('UPDATE users SET last_login=? WHERE id=?', (now(), u['id']))
    run('INSERT INTO sessions(token, user_id, expires_at) VALUES (?,?,?)', (token, u['id'], (datetime.now(timezone.utc) + timedelta(days=7)).strftime('%Y-%m-%d %H:%M:%S')))
    return {'token': token, 'user': public_user(u)}


@app.post('/api/logout')
def logout(authorization: str = Header(default='')):
    run('DELETE FROM sessions WHERE token=?', (authorization.removeprefix('Bearer ').strip(),))
    return {'ok': True}


@app.get('/api/me')
def me(user=Depends(current_user)):
    return public_user(user)


class PasswordChange(BaseModel):
    old: str
    new: str = Field(min_length=8, max_length=200)


@app.post('/api/me/password')
def change_password(p: PasswordChange, user=Depends(current_user)):
    if not check_pw(p.old, user['pw_hash']):
        raise HTTPException(400, 'Current password is wrong')
    if p.new == p.old:
        raise HTTPException(400, 'Choose a new password that is different from the current one')
    run('UPDATE users SET pw_hash=?, must_change=0 WHERE id=?', (hash_pw(p.new), user['id']))
    return {'ok': True}


# ------------------------------------------------------------------ users (admin)

class UserIn(BaseModel):
    username: str = Field(min_length=3, max_length=40)
    name: str = Field(min_length=1, max_length=80)
    role: str = Field(pattern='^(admin|manager|viewer)$')
    areas: str = '*'
    phone: str = ''
    email: str = ''
    password: str | None = None
    active: bool = True


def clean_areas(areas):
    if areas.strip() in ('', '*'):
        return '*'
    picked = [a.strip() for a in areas.split(',') if a.strip() in data.area_ids()]
    if not picked:
        raise HTTPException(400, 'Pick at least one site')
    return ','.join(picked)


@app.get('/api/users')
def users(user=Depends(current_user)):
    rows = q('SELECT * FROM users ORDER BY name')
    if user['role'] != 'admin':  # everyone can see names to assign owners; only admins see details
        return [{'id': r['id'], 'name': r['name'], 'role': r['role']} for r in rows if r['active']]
    return [public_user(r) for r in rows]


@app.post('/api/users')
def create_user(u: UserIn, _=Depends(need_head)):
    if not u.password or len(u.password) < 8:
        raise HTTPException(400, 'Password must be at least 8 characters')
    if one('SELECT id FROM users WHERE username=?', (u.username.lower(),)):
        raise HTTPException(409, 'That username is taken')
    uid = run('INSERT INTO users(username, name, role, areas, phone, email, pw_hash, active) VALUES (?,?,?,?,?,?,?,?)',
              (u.username.lower(), u.name, u.role, clean_areas(u.areas), u.phone, u.email.strip().lower(), hash_pw(u.password), int(u.active)))
    set_profile(uid, profile_for_role(u.role))
    return public_user(one('SELECT * FROM users WHERE id=?', (uid,)))


@app.patch('/api/users/{uid}')
def update_user(uid: int, u: UserIn, admin=Depends(need_head)):
    if not one('SELECT id FROM users WHERE id=?', (uid,)):
        raise HTTPException(404, 'User not found')
    if uid == admin['id'] and (u.role != 'admin' or not u.active):
        raise HTTPException(400, 'You cannot remove your own admin access')
    before = one('SELECT role FROM users WHERE id=?', (uid,))
    run('UPDATE users SET name=?, areas=?, phone=?, email=?, active=? WHERE id=?',
        (u.name, clean_areas(u.areas), u.phone, u.email.strip().lower(), int(u.active), uid))
    if u.role != before['role']:
        set_profile(uid, profile_for_role(u.role))
    if u.password:
        if len(u.password) < 8:
            raise HTTPException(400, 'Password must be at least 8 characters')
        run('UPDATE users SET pw_hash=? WHERE id=?', (hash_pw(u.password), uid))
    if not u.active:
        run('DELETE FROM sessions WHERE user_id=?', (uid,))
    return public_user(one('SELECT * FROM users WHERE id=?', (uid,)))


# ------------------------------------------------------------------ measured data

@app.get('/api/readings')
def readings(user=Depends(current_user)):
    areas, mets = allowed(user), allowed_metrics(user)
    return [r for r in q('SELECT r.*, u.name AS user_name FROM readings r LEFT JOIN users u ON u.id=r.user_id ORDER BY month, area, metric') if r['area'] in areas and r['metric'] in mets]


@app.get('/api/uploads')
def uploads(_=Depends(current_user)):
    return q('SELECT up.*, u.name AS user_name FROM uploads up LEFT JOIN users u ON u.id=up.user_id ORDER BY up.id DESC LIMIT 100')


@app.get('/api/upload/template', response_class=PlainTextResponse)
def upload_template():
    return PlainTextResponse(data.template_csv(), headers={'Content-Disposition': 'attachment; filename="nexora_upload_template.csv"'})


@app.post('/api/upload')
async def upload(bg: BackgroundTasks, file: UploadFile = File(...), area: str = Form(''), dry_run: bool = Form(False), user=Depends(need('manager')), _=Depends(need_page('upload'))):
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(413, 'File is larger than 10 MB')
    try:
        rows, errors = data.parse_upload(file.filename or 'upload.csv', content, area or None, allowed(user))
    except ValueError as e:
        raise HTTPException(400, str(e))
    mets = allowed_metrics(user)  # a job profile limited to some domains can only upload those indicators
    errors += [f"{data.metrics()[r['metric']]['name']} ({data.area_name(r['area'])} {r['month']}) is outside your job profile’s domains – skipped" for r in rows if r['metric'] not in mets]
    rows = [r for r in rows if r['metric'] in mets]
    if dry_run or not rows:
        return {'saved': 0, 'rows': rows[:500], 'errors': errors[:200], 'alerts': []}
    upload_id = run('INSERT INTO uploads(filename, rows, user_id, summary) VALUES (?,?,?,?)',
                    (file.filename, len(rows), user['id'], f'{len(rows)} values, {len(errors)} rows skipped'))
    for r in rows:
        run("""INSERT INTO readings(area, metric, month, value, note, upload_id, user_id) VALUES (?,?,?,?,?,?,?)
               ON CONFLICT(area, metric, month) DO UPDATE SET value=excluded.value, note=excluded.note, upload_id=excluded.upload_id,
               user_id=excluded.user_id, created_at=datetime('now')""",
            (r['area'], r['metric'], r['month'], r['value'], r['note'], upload_id, user['id']))
    created = screen_and_alert({(r['area'], r['metric'], r['month']) for r in rows})
    for aid in created:
        bg.add_task(deliver, aid)
    return {'saved': len(rows), 'upload_id': upload_id, 'errors': errors[:200],
            'alerts': [one('SELECT * FROM alerts WHERE id=?', (a,)) for a in created]}


@app.delete('/api/uploads/{upload_id}')
def undo_upload(upload_id: int, _=Depends(need('manager')), __=Depends(need_page('upload'))):
    n = one('SELECT COUNT(*) n FROM readings WHERE upload_id=?', (upload_id,))['n']
    run('DELETE FROM readings WHERE upload_id=?', (upload_id,))
    run("UPDATE uploads SET summary = summary || ' · undone' WHERE id=?", (upload_id,))
    return {'removed': n}


@app.get('/api/screen')
def screen(area: str, metric: str, user=Depends(current_user)):
    check_area(user, area)
    if metric not in data.metrics():
        raise HTTPException(404, 'Unknown indicator')
    return data.screen_latest(area, metric)


# ------------------------------------------------------------------ alerts & recipients

@app.get('/api/alerts')
def alerts(user=Depends(current_user)):
    areas, mets = allowed(user), allowed_metrics(user)
    rows = [a for a in q('SELECT a.*, u.name AS ack_name FROM alerts a LEFT JOIN users u ON u.id=a.ack_by ORDER BY a.id DESC LIMIT 300') if a['area'] in areas and a['metric'] in mets]
    for a in rows:
        a['deliveries'] = q('SELECT channel, recipient, kind, status, detail, created_at FROM alert_deliveries WHERE alert_id=? ORDER BY id', (a['id'],))
    return rows


class AlertUpdate(BaseModel):
    status: str = Field(pattern='^(acknowledged|resolved|open)$')


@app.patch('/api/alerts/{aid}')
def update_alert(aid: int, body: AlertUpdate, user=Depends(need('manager'))):
    a = one('SELECT * FROM alerts WHERE id=?', (aid,))
    if not a:
        raise HTTPException(404, 'Alert not found')
    check_area(user, a['area'])
    run('UPDATE alerts SET status=?, ack_by=?, ack_at=? WHERE id=?', (body.status, user['id'], now(), aid))
    return one('SELECT * FROM alerts WHERE id=?', (aid,))


class RecipientIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    channel: str = Field(pattern='^(whatsapp|sms)$')
    phone: str = Field(min_length=8, max_length=20)
    min_level: str = Field(default='Watch', pattern='^(Watch|High deviation)$')
    areas: str = '*'
    escalation: bool = False
    active: bool = True


@app.get('/api/recipients')
def recipients(_=Depends(need('admin'))):
    return q('SELECT * FROM recipients ORDER BY name')


@app.post('/api/recipients')
def add_recipient(r: RecipientIn, _=Depends(need('admin'))):
    rid = run('INSERT INTO recipients(name, channel, phone, min_level, areas, escalation, active) VALUES (?,?,?,?,?,?,?)',
              (r.name, r.channel, r.phone, r.min_level, clean_areas(r.areas), int(r.escalation), int(r.active)))
    return one('SELECT * FROM recipients WHERE id=?', (rid,))


@app.patch('/api/recipients/{rid}')
def edit_recipient(rid: int, r: RecipientIn, _=Depends(need('admin'))):
    run('UPDATE recipients SET name=?, channel=?, phone=?, min_level=?, areas=?, escalation=?, active=? WHERE id=?',
        (r.name, r.channel, r.phone, r.min_level, clean_areas(r.areas), int(r.escalation), int(r.active), rid))
    return one('SELECT * FROM recipients WHERE id=?', (rid,))


@app.delete('/api/recipients/{rid}')
def delete_recipient(rid: int, _=Depends(need('admin'))):
    run('DELETE FROM recipients WHERE id=?', (rid,))
    return {'ok': True}


@app.get('/api/notify/status')
def notify_status(_=Depends(current_user)):
    return notify.status() | {'escalation_hours': float(setting('escalation_hours', '24'))}


class Escalation(BaseModel):
    hours: float = Field(gt=0, le=720)


@app.put('/api/settings/escalation')
def set_escalation(e: Escalation, _=Depends(need('admin'))):
    run("INSERT INTO settings(key, value) VALUES ('escalation_hours', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (str(e.hours),))
    return {'escalation_hours': e.hours}


class TestSend(BaseModel):
    recipient_id: int


@app.post('/api/notify/test')
def test_send(t: TestSend, _=Depends(need('admin'))):
    r = one('SELECT * FROM recipients WHERE id=?', (t.recipient_id,))
    if not r:
        raise HTTPException(404, 'Recipient not found')
    st, detail = notify.send(r['channel'], r['phone'], 'Nexora test message: alerts are set up correctly.')
    run('INSERT INTO alert_deliveries(alert_id, channel, recipient, kind, status, detail) VALUES (NULL,?,?,?,?,?)',
        (r['channel'], f"{r['name']} {notify.normalise_phone(r['phone'])}", 'test', st, detail))
    return {'status': st, 'detail': detail}


# ------------------------------------------------------------------ action tracker

class ActionUpdate(BaseModel):
    area: str
    title: str = Field(max_length=300)
    status: str | None = Field(default=None, pattern='^(Open|In progress|Done|Dismissed)$')
    owner_id: int | None = None
    due_date: str | None = None
    comment: str | None = Field(default=None, max_length=2000)
    clear_owner: bool = False
    complaint_id: int | None = None  # set when the action is a staff complaint: dismissing it dismisses the complaint everywhere


@app.get('/api/actions')
def action_states(user=Depends(current_user)):
    areas = allowed(user)
    states = [s for s in q('SELECT s.*, u.name AS owner_name FROM action_state s LEFT JOIN users u ON u.id=s.owner_id') if s['area'] in areas]
    events = q('SELECT e.*, u.name AS user_name FROM action_events e LEFT JOIN users u ON u.id=e.user_id ORDER BY e.id')
    by = {}
    for e in events:
        by.setdefault(e['action_id'], []).append(e)
    return {s['action_id']: s | {'events': by.get(s['action_id'], [])} for s in states}


@app.patch('/api/actions/{action_id}')
def update_action(action_id: str, a: ActionUpdate, user=Depends(need('manager'))):
    check_area(user, a.area)
    cur = one('SELECT * FROM action_state WHERE action_id=?', (action_id,))
    if not cur:
        run('INSERT INTO action_state(action_id, area, title, updated_by) VALUES (?,?,?,?)', (action_id, a.area, a.title, user['id']))
        cur = one('SELECT * FROM action_state WHERE action_id=?', (action_id,))
    log = lambda kind, text: run('INSERT INTO action_events(action_id, user_id, kind, text) VALUES (?,?,?,?)', (action_id, user['id'], kind, text))  # noqa: E731
    if a.status and a.status != cur['status']:
        run('UPDATE action_state SET status=? WHERE action_id=?', (a.status, action_id)); log('status', f"{cur['status']} → {a.status}")
        c = one('SELECT id, status FROM complaints WHERE id=? AND area=?', (a.complaint_id, a.area)) if a.complaint_id else None
        if c and a.status == 'Dismissed' and c['status'] != 'dismissed':
            run("UPDATE complaints SET status='dismissed', dismissed_by=?, dismissed_at=?, dismiss_reason=? WHERE id=?", (user['id'], now(), a.comment or 'Dismissed in the action tracker', c['id']))
        elif c and a.status in ('Open', 'In progress') and c['status'] == 'dismissed':
            run("UPDATE complaints SET status='open', dismissed_by=NULL, dismissed_at=NULL, dismiss_reason='' WHERE id=?", (c['id'],))
    if a.clear_owner or (a.owner_id is not None and a.owner_id != cur['owner_id']):
        owner = one('SELECT name FROM users WHERE id=?', (a.owner_id,)) if a.owner_id else None
        run('UPDATE action_state SET owner_id=? WHERE action_id=?', (None if a.clear_owner else a.owner_id, action_id))
        log('owner', f"Assigned to {owner['name']}" if owner and not a.clear_owner else 'Owner removed')
    if a.due_date is not None and a.due_date != (cur['due_date'] or ''):
        run('UPDATE action_state SET due_date=? WHERE action_id=?', (a.due_date or None, action_id)); log('due', f"Due date {a.due_date or 'removed'}")
    if a.comment:
        log('comment', a.comment)
    run('UPDATE action_state SET updated_at=?, updated_by=? WHERE action_id=?', (now(), user['id'], action_id))
    return action_states(user).get(action_id)




@app.post('/api/actions/{action_id}/proof')
async def add_proof(action_id: str, area: str = Form(...), title: str = Form(''), text: str = Form(''), file: UploadFile = File(...), user=Depends(need('manager'))):
    check_area(user, area)
    try:
        name = images.store(await file.read(), file.filename or '', allow_pdf=True)
    except images.BadFile as e:
        raise HTTPException(e.status, str(e))
    if not one('SELECT 1 FROM action_state WHERE action_id=?', (action_id,)):
        run('INSERT INTO action_state(action_id, area, title, updated_by) VALUES (?,?,?,?)', (action_id, area, title, user['id']))
    run('INSERT INTO action_events(action_id, user_id, kind, text, file) VALUES (?,?,?,?,?)', (action_id, user['id'], 'proof', text or (file.filename or ''), name))
    return action_states(user).get(action_id)


@app.get('/api/files/{name}')
def get_file(name: str, _=Depends(current_user)):
    path = (DATA / 'uploads' / Path(name).name)
    if not path.exists():
        raise HTTPException(404, 'File not found')
    return FileResponse(path)


# ------------------------------------------------------------------ savings

class SavingIn(BaseModel):
    area: str
    metric: str
    baseline_from: str = Field(pattern=r'^\d{4}-\d{2}$')
    baseline_to: str = Field(pattern=r'^\d{4}-\d{2}$')
    after_from: str = Field(pattern=r'^\d{4}-\d{2}$')
    after_to: str = Field(pattern=r'^\d{4}-\d{2}$')
    tariff: float = Field(default=0, ge=0, le=1_000_000)
    action_id: str | None = None
    action_title: str = ''
    note: str = Field(default='', max_length=1000)
    save: bool = True


def compute_saving(s: SavingIn):
    if s.metric not in data.metrics():
        raise HTTPException(404, 'Unknown indicator')
    if not (s.baseline_from <= s.baseline_to and s.after_from <= s.after_to):
        raise HTTPException(400, 'Each period must start before it ends')
    pts = data.merged(s.area, s.metric)
    pick = lambda a, b: [(m, v, c) for m, v, c in pts if a <= m <= b and v is not None]  # noqa: E731
    base, after = pick(s.baseline_from, s.baseline_to), pick(s.after_from, s.after_to)
    if not base or not after:
        raise HTTPException(400, 'Both periods need at least one month with a value')
    b_avg = sum(v for _, v, _ in base) / len(base)
    a_avg = sum(v for _, v, _ in after) / len(after)
    units = (b_avg - a_avg) * len(after)
    classes = {c for _, _, c in base + after}
    evidence = ('Measured (facility upload)' if classes == {data.MEASURED}
                else 'Official observation' if classes == {'OBSERVED_OFFICIAL'}
                else 'Estimate – includes demonstration or modelled data' if classes & {'SHARED_SYNTHETIC_BASELINE', 'MODELLED_AREA_SCENARIO'}
                else 'Mixed evidence')
    m = data.metrics()[s.metric]
    return {'area': s.area, 'metric': s.metric, 'unit': m['unit'], 'baseline_avg': b_avg, 'after_avg': a_avg, 'months': len(after),
            'baseline_months': len(base), 'units_saved': units, 'rupees_saved': units * s.tariff, 'evidence': evidence}


@app.post('/api/savings')
def add_saving(s: SavingIn, user=Depends(need('manager')), _=Depends(need_page('savings'))):
    check_area(user, s.area)
    r = compute_saving(s)
    if not s.save:
        return r
    sid = run("""INSERT INTO savings(action_id, action_title, area, metric, baseline_from, baseline_to, after_from, after_to, baseline_avg, after_avg,
                 months, unit, tariff, units_saved, rupees_saved, evidence, note, user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
              (s.action_id, s.action_title, s.area, s.metric, s.baseline_from, s.baseline_to, s.after_from, s.after_to, r['baseline_avg'], r['after_avg'],
               r['months'], r['unit'], s.tariff, r['units_saved'], r['rupees_saved'], r['evidence'], s.note, user['id']))
    return one('SELECT * FROM savings WHERE id=?', (sid,))


@app.get('/api/savings')
def savings(user=Depends(need_page('savings'))):
    areas = allowed(user)
    return [s for s in q('SELECT s.*, u.name AS user_name FROM savings s LEFT JOIN users u ON u.id=s.user_id ORDER BY s.id DESC') if s['area'] in areas]


@app.delete('/api/savings/{sid}')
def delete_saving(sid: int, _=Depends(need('manager')), __=Depends(need_page('savings'))):
    run('DELETE FROM savings WHERE id=?', (sid,))
    return {'ok': True}


# ------------------------------------------------------------------ Part 1B routes (live feeds, benchmarks, bills, complaints, reports)

import ops  # noqa: E402  (imported here because it reuses the auth helpers defined above)

app.include_router(ops.router)

import indi  # noqa: E402  (Part 1C: Indi assistant via Groq)

app.include_router(indi.router)

import geo  # noqa: E402  (Part 1C: place search for complaint pins)

app.include_router(geo.router)

import access  # noqa: E402  (Part 1C: staff portal, job profiles, Google sign-in)

app.include_router(access.router)

# ------------------------------------------------------------------ the dashboard itself

DIST = data.ROOT / 'dist'
if DIST.exists():
    app.mount('/', StaticFiles(directory=DIST, html=True), name='dashboard')
