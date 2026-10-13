"""Part 1C: staff & access portal.

Head approval: every new staff or admin access – a "Create access ID" sign-up, a "Sign in with Google" request,
staff added by an admin, or a promotion to an admin-level job profile – is approved by the head
(HEAD_EMAIL, default viveksahusahu999@gmail.com). The head proves that email with Google sign-in (or creates the
first account on the server PC); a password sign-up using the head's email is refused.


- Only registered emails get in. Staff sign in with their email / staff ID and password, or with Google.
- A person whose Gmail is not registered can press "Sign in with Google": that files an access request
  (their Google-verified email and name) for an admin to approve with a job profile and sites.
- Admins create staff (a staff ID and a one-time password are generated), assign job profiles, reset passwords,
  and edit job profiles – which pages and which of the eight domains each job sees.
"""
import os
import secrets

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

import roles
from app import EMAIL_RE, clean_areas, hash_pw, head_email, need, need_head, now, public_user, set_profile, start_session
from db import one, q, run

router = APIRouter(prefix='/api')
GOOGLE_TOKENINFO = 'https://oauth2.googleapis.com/tokeninfo'


def _client():
    return httpx.Client(timeout=15)


def google_client_id():
    return os.environ.get('GOOGLE_CLIENT_ID', '').strip()


def temp_password():
    """Readable one-time password, e.g. Kite-7342-Moss (the user must change it at first sign-in)."""
    words = ['River', 'Cedar', 'Lotus', 'Mango', 'Pearl', 'Tiger', 'Coral', 'Amber', 'Delta', 'Orbit', 'Kite', 'Moss', 'Ridge', 'Lake', 'Spark', 'Banyan']
    return f'{secrets.choice(words)}-{secrets.randbelow(9000) + 1000}-{secrets.choice(words)}'


def clean_email(email):
    e = (email or '').strip().lower()
    if not EMAIL_RE.match(e):
        raise HTTPException(400, 'Enter a valid email address')
    return e


def email_taken(email, except_id=None):
    row = one('SELECT id FROM users WHERE lower(email)=? AND id!=?', (email, except_id or 0))
    return bool(row)


# ------------------------------------------------------------------ sign-in configuration and Google

@router.get('/auth/config')
def auth_config():
    return {'google_client_id': google_client_id(), 'needs_setup': one('SELECT COUNT(*) n FROM users')['n'] == 0, 'head_email': head_email(),
            'profiles': [{'id': p['id'], 'name': p['name'], 'level': p['level'], 'description': p['description']}
                         for p in q("SELECT * FROM job_profiles WHERE level!='admin' ORDER BY builtin DESC, name")]}


class SignUpIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    email: str = Field(max_length=120)
    phone: str = Field(default='', max_length=30)
    job_title: str = Field(default='', max_length=80)
    access: str = Field(pattern='^(staff|admin)$')
    requested_profile_id: int | None = None
    password: str = Field(min_length=8, max_length=200)
    note: str = Field(default='', max_length=500)


@router.post('/auth/signup')
def sign_up(b: SignUpIn):
    """'Create access ID': files a request that only the head can approve. The chosen password is kept (hashed) for later."""
    email = clean_email(b.email)
    if email == head_email():
        raise HTTPException(400, 'This is the head’s email. The head signs in with “Sign in with Google” using this Gmail – no request is needed.')
    if email_taken(email):
        raise HTTPException(409, 'This email already has an access ID – use Sign in. Forgot the password? Ask your admin to reset it.')
    prof = one('SELECT * FROM job_profiles WHERE id=?', (b.requested_profile_id,)) if b.requested_profile_id else None
    if b.access == 'staff' and prof and prof['level'] == 'admin':
        prof = None
    fields = (b.name.strip(), b.phone, b.job_title.strip(), b.access, prof['id'] if prof else None, hash_pw(b.password), b.note.strip())
    pending = one("SELECT id FROM access_requests WHERE lower(email)=? AND status='pending'", (email,))
    if pending:
        run("UPDATE access_requests SET name=?, phone=?, job_title=?, access=?, requested_profile_id=?, pw_hash=?, note=?, source='signup' WHERE id=?", fields + (pending['id'],))
    else:
        run("INSERT INTO access_requests(name, phone, job_title, access, requested_profile_id, pw_hash, note, email, source) VALUES (?,?,?,?,?,?,?,?,'signup')", fields + (email,))
    return {'status': 'pending', 'email': email,
            'message': f'Your request for {"admin" if b.access == "admin" else "staff"} access has been sent to the head ({head_email()}) for approval. '
                       'Once approved, sign in with this email and the password you chose.'}


class GoogleIn(BaseModel):
    credential: str = Field(min_length=20, max_length=5000)


def verify_google(credential):
    cid = google_client_id()
    if not cid:
        raise HTTPException(400, 'Google sign-in is not set up on this server (GOOGLE_CLIENT_ID in backend/.env).')
    try:
        r = _client().get(GOOGLE_TOKENINFO, params={'id_token': credential})
    except httpx.HTTPError:
        raise HTTPException(502, 'Could not reach Google to check the sign-in. Check the internet connection.')
    t = r.json() if r.status_code == 200 else {}
    if (r.status_code != 200 or t.get('aud') != cid or t.get('iss') not in ('accounts.google.com', 'https://accounts.google.com')
            or str(t.get('email_verified')).lower() != 'true' or not t.get('email')):
        raise HTTPException(401, 'Google sign-in could not be verified. Try again.')
    import time
    if int(t.get('exp', 0)) < time.time():
        raise HTTPException(401, 'The Google sign-in expired. Try again.')
    return t


@router.post('/auth/google')
def google_sign_in(body: GoogleIn):
    t = verify_google(body.credential)
    email, sub = t['email'].lower(), t['sub']
    u = one('SELECT * FROM users WHERE google_sub=?', (sub,)) or one('SELECT * FROM users WHERE lower(email)=?', (email,))
    if email == head_email():  # Google has verified the head's Gmail: this is the head
        if not u:
            uid = run("INSERT INTO users(username, name, role, email, pw_hash, sign_in, google_sub, is_head) VALUES (?,?,'admin',?,?,'google',?,1)",
                      (f'tmp-{secrets.token_hex(6)}', t.get('name') or 'Head', email, hash_pw(secrets.token_urlsafe(24)), sub))
            run('UPDATE users SET username=? WHERE id=?', (roles.staff_code(uid).lower(), uid))
        else:
            uid = u['id']
            run("UPDATE users SET is_head=1, active=1, google_sub=?, sign_in=CASE WHEN sign_in='password' THEN 'both' ELSE sign_in END WHERE id=?", (sub, uid))
        set_profile(uid, one("SELECT id FROM job_profiles WHERE name='Administrator'")['id'])
        run("UPDATE users SET areas='*' WHERE id=?", (uid,))
        return start_session(one('SELECT * FROM users WHERE id=?', (uid,)))
    if u:
        if not u['active']:
            raise HTTPException(403, 'This account is disabled. Ask an admin.')
        if u.get('sign_in') == 'password':
            raise HTTPException(403, 'This account signs in with email/staff ID and password, not Google. Ask an admin to allow Google sign-in.')
        if not u.get('google_sub'):
            run('UPDATE users SET google_sub=? WHERE id=?', (sub, u['id']))
        return start_session(u)
    # Not registered: file (or refresh) an access request for an admin to approve.
    pending = one("SELECT id FROM access_requests WHERE lower(email)=? AND status='pending'", (email,))
    if pending:
        run('UPDATE access_requests SET name=?, picture=?, google_sub=? WHERE id=?', (t.get('name', ''), t.get('picture', ''), sub, pending['id']))
    else:
        run("INSERT INTO access_requests(email, name, picture, google_sub, source) VALUES (?,?,?,?,'google')", (email, t.get('name', ''), t.get('picture', ''), sub))
    return {'status': 'pending', 'email': email, 'name': t.get('name', ''),
            'message': f'{email} is not registered yet. Your request has been sent to the head ({head_email()}) for approval – sign in with Google again once it is approved.'}


# ------------------------------------------------------------------ job profiles

class ProfileIn(BaseModel):
    name: str = Field(min_length=2, max_length=60)
    description: str = Field(default='', max_length=300)
    level: str = Field(pattern='^(admin|manager|viewer)$')
    pages: list[str] = Field(min_length=1)
    domains: list[str] = Field(min_length=1)


def profile_out(p):
    return p | {'pages': p['pages'].split(','), 'domains': roles.DOMAINS if p['domains'] == '*' else p['domains'].split(','),
                'staff': one('SELECT COUNT(*) n FROM users WHERE job_profile_id=?', (p['id'],))['n']}


def head_only(user, what):
    if not user.get('is_head'):
        raise HTTPException(403, f'{what} needs the head’s permission ({head_email()}).')


@router.get('/job-profiles')
def job_profiles(_=Depends(need('admin'))):
    return {'profiles': [profile_out(p) for p in q('SELECT * FROM job_profiles ORDER BY builtin DESC, name')],
            'workspace': roles.WORKSPACE, 'operations': roles.OPERATIONS, 'domains': roles.DOMAINS, 'admin_only': sorted(roles.ADMIN_ONLY)}


def _clean_profile(p: ProfileIn):
    try:
        return roles.clean_pages(p.pages, p.level), roles.clean_domains(p.domains)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post('/job-profiles')
def add_job_profile(p: ProfileIn, user=Depends(need('admin'))):
    if p.level == 'admin':
        head_only(user, 'Creating an admin-level job profile')
    if one('SELECT id FROM job_profiles WHERE lower(name)=?', (p.name.strip().lower(),)):
        raise HTTPException(409, 'A job profile with that name exists')
    pages, domains = _clean_profile(p)
    pid = run('INSERT INTO job_profiles(name, description, level, pages, domains) VALUES (?,?,?,?,?)', (p.name.strip(), p.description, p.level, ','.join(pages), domains))
    return profile_out(one('SELECT * FROM job_profiles WHERE id=?', (pid,)))


@router.patch('/job-profiles/{pid}')
def edit_job_profile(pid: int, p: ProfileIn, admin=Depends(need('admin'))):
    cur = one('SELECT * FROM job_profiles WHERE id=?', (pid,))
    if not cur:
        raise HTTPException(404, 'Job profile not found')
    if cur['level'] == 'admin' or p.level == 'admin':
        head_only(admin, 'Changing an admin-level job profile')
    if one('SELECT id FROM job_profiles WHERE lower(name)=? AND id!=?', (p.name.strip().lower(), pid)):
        raise HTTPException(409, 'A job profile with that name exists')
    if admin.get('job_profile_id') == pid and (p.level != 'admin' or 'staff' not in p.pages):
        raise HTTPException(400, 'You cannot remove your own admin access')
    pages, domains = _clean_profile(p)
    run('UPDATE job_profiles SET name=?, description=?, level=?, pages=?, domains=? WHERE id=?', (p.name.strip(), p.description, p.level, ','.join(pages), domains, pid))
    run('UPDATE users SET role=? WHERE job_profile_id=?', (p.level, pid))  # permission level follows the profile
    return profile_out(one('SELECT * FROM job_profiles WHERE id=?', (pid,)))


@router.delete('/job-profiles/{pid}')
def delete_job_profile(pid: int, user=Depends(need('admin'))):
    p = one('SELECT * FROM job_profiles WHERE id=?', (pid,))
    if not p:
        raise HTTPException(404, 'Job profile not found')
    if p['level'] == 'admin':
        head_only(user, 'Deleting an admin-level job profile')
    if p['builtin']:
        raise HTTPException(400, 'Built-in profiles cannot be deleted – edit them or make a copy')
    if one('SELECT COUNT(*) n FROM users WHERE job_profile_id=?', (pid,))['n']:
        raise HTTPException(400, 'Move the staff using this profile to another one first')
    run('DELETE FROM job_profiles WHERE id=?', (pid,))
    return {'ok': True}


# ------------------------------------------------------------------ staff directory

class StaffIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    email: str = Field(max_length=120)
    phone: str = Field(default='', max_length=30)
    job_profile_id: int
    areas: str = '*'
    sign_in: str = Field(default='both', pattern='^(both|google|password)$')
    active: bool = True


def staff_out(u):
    return public_user(u) | {'created_at': u.get('created_at'), 'google_linked': bool(u.get('google_sub'))}


def create_account(name, email, phone, areas, sign_in, profile_id, pw_hash=None, google_sub=None):
    """Make the account (head-approved). Returns (user row, one-time password or None)."""
    pw = None
    if pw_hash is None and sign_in != 'google':
        pw = temp_password()
    uid = run('INSERT INTO users(username, name, role, areas, phone, email, pw_hash, sign_in, google_sub, must_change) VALUES (?,?,?,?,?,?,?,?,?,?)',
              (f'tmp-{secrets.token_hex(6)}', name, 'viewer', clean_areas(areas), phone, email,
               pw_hash or hash_pw(pw or secrets.token_urlsafe(24)), sign_in, google_sub, 1 if pw else 0))
    run('UPDATE users SET username=? WHERE id=?', (roles.staff_code(uid).lower(), uid))
    set_profile(uid, profile_id)
    return one('SELECT * FROM users WHERE id=?', (uid,)), pw


@router.get('/staff')
def staff(_=Depends(need('admin'))):
    return [staff_out(u) for u in q('SELECT * FROM users ORDER BY is_head DESC, active DESC, name')]


@router.post('/staff')
def add_staff(s: StaffIn, user=Depends(need('admin'))):
    email = clean_email(s.email)
    if email == head_email():
        raise HTTPException(400, 'That is the head’s email – the head signs in with Google.')
    if email_taken(email):
        raise HTTPException(409, 'That email is already registered')
    if not one('SELECT id FROM job_profiles WHERE id=?', (s.job_profile_id,)):
        raise HTTPException(400, 'Unknown job profile')
    if not user.get('is_head'):  # an admin proposes; the head approves
        clean_areas(s.areas)
        prof = one('SELECT level FROM job_profiles WHERE id=?', (s.job_profile_id,))
        pending = one("SELECT id FROM access_requests WHERE lower(email)=? AND status='pending'", (email,))
        vals = (s.name.strip(), s.phone, 'admin' if prof['level'] == 'admin' else 'staff', s.job_profile_id, user['id'], s.areas, s.sign_in)
        if pending:
            run("UPDATE access_requests SET name=?, phone=?, access=?, requested_profile_id=?, proposed_by=?, proposed_areas=?, proposed_sign_in=?, source='admin' WHERE id=?", vals + (pending['id'],))
        else:
            run("INSERT INTO access_requests(name, phone, access, requested_profile_id, proposed_by, proposed_areas, proposed_sign_in, email, source) VALUES (?,?,?,?,?,?,?,?,'admin')", vals + (email,))
        return {'status': 'pending', 'email': email, 'message': f'Sent to the head ({head_email()}) for approval. The staff ID is created when the head approves.'}
    u, pw = create_account(s.name.strip(), email, s.phone, s.areas, s.sign_in, s.job_profile_id)
    run("UPDATE access_requests SET status='approved', decided_by=?, decided_at=? WHERE lower(email)=? AND status='pending'", (user['id'], now(), email))
    return staff_out(u) | {'temp_password': pw}


@router.patch('/staff/{uid}')
def edit_staff(uid: int, s: StaffIn, admin=Depends(need('admin'))):
    u = one('SELECT * FROM users WHERE id=?', (uid,))
    if not u:
        raise HTTPException(404, 'Staff member not found')
    email = clean_email(s.email)
    if email_taken(email, uid):
        raise HTTPException(409, 'That email is already registered to someone else')
    prof = one('SELECT * FROM job_profiles WHERE id=?', (s.job_profile_id,))
    if not prof:
        raise HTTPException(400, 'Unknown job profile')
    if u.get('is_head'):
        head_only(admin, 'Changing the head’s account')
        if prof['level'] != 'admin' or not s.active or email != (u['email'] or '').lower():
            raise HTTPException(400, 'The head always keeps admin access and the head email (change HEAD_EMAIL in backend/.env to hand over).')
    if email == head_email() and not u.get('is_head'):
        raise HTTPException(400, 'That is the head’s email.')
    if (prof['level'] == 'admin') != (u['role'] == 'admin'):
        head_only(admin, 'Giving or removing admin access')
    if uid == admin['id'] and (prof['level'] != 'admin' or not s.active):
        raise HTTPException(400, 'You cannot remove your own admin access')
    run('UPDATE users SET name=?, email=?, phone=?, areas=?, sign_in=?, active=? WHERE id=?',
        (s.name.strip(), email, s.phone, clean_areas(s.areas), s.sign_in, int(s.active), uid))
    if email != (u.get('email') or '').lower():
        run('UPDATE users SET google_sub=NULL WHERE id=?', (uid,))  # a new email must be re-linked to Google
    set_profile(uid, s.job_profile_id)
    if not s.active:
        run('DELETE FROM sessions WHERE user_id=?', (uid,))
    return staff_out(one('SELECT * FROM users WHERE id=?', (uid,)))


@router.post('/staff/{uid}/reset-password')
def reset_password(uid: int, user=Depends(need('admin'))):
    u = one('SELECT * FROM users WHERE id=?', (uid,))
    if not u:
        raise HTTPException(404, 'Staff member not found')
    if u['role'] == 'admin' and uid != user['id']:
        head_only(user, 'Resetting an admin’s password')
    pw = temp_password()
    run("UPDATE users SET pw_hash=?, must_change=1, sign_in=CASE WHEN sign_in='google' THEN 'both' ELSE sign_in END WHERE id=?", (hash_pw(pw), uid))
    run('DELETE FROM sessions WHERE user_id=?', (uid,))
    return {'temp_password': pw, 'staff_id': u.get('staff_id')}


# ------------------------------------------------------------------ access requests – approved by the head only

@router.get('/access-requests')
def access_requests(_=Depends(need('admin'))):
    rows = q("""SELECT r.*, p.name AS requested_profile, u.name AS proposed_by_name FROM access_requests r
                LEFT JOIN job_profiles p ON p.id=r.requested_profile_id LEFT JOIN users u ON u.id=r.proposed_by
                ORDER BY r.status='pending' DESC, r.id DESC LIMIT 200""")
    for r in rows:
        r.pop('pw_hash', None)
        r.pop('google_sub', None)
    return rows


@router.get('/access-requests/count')
def pending_count(_=Depends(need('admin'))):
    return {'pending': one("SELECT COUNT(*) n FROM access_requests WHERE status='pending'")['n'], 'head_email': head_email()}


class ApproveIn(BaseModel):
    job_profile_id: int
    areas: str = '*'
    sign_in: str | None = Field(default=None, pattern='^(both|google|password)$')


@router.post('/access-requests/{rid}/approve')
def approve(rid: int, a: ApproveIn, head=Depends(need_head)):
    r = one('SELECT * FROM access_requests WHERE id=?', (rid,))
    if not r or r['status'] != 'pending':
        raise HTTPException(404, 'No pending request with that id')
    email = r['email'].lower()
    if email_taken(email):
        raise HTTPException(409, 'That email is already registered')
    if not one('SELECT id FROM job_profiles WHERE id=?', (a.job_profile_id,)):
        raise HTTPException(400, 'Unknown job profile')
    default_sign_in = {'google': 'google', 'signup': 'both'}.get(r['source']) or r.get('proposed_sign_in') or 'both'
    u, pw = create_account(r['name'] or email.split('@')[0], email, r.get('phone') or '', a.areas, a.sign_in or default_sign_in,
                           a.job_profile_id, pw_hash=r.get('pw_hash'), google_sub=r.get('google_sub'))
    run("UPDATE access_requests SET status='approved', decided_by=?, decided_at=? WHERE id=?", (head['id'], now(), rid))
    return staff_out(u) | {'temp_password': pw, 'own_password': bool(r.get('pw_hash'))}


@router.post('/access-requests/{rid}/reject')
def reject(rid: int, head=Depends(need_head)):
    if not one("SELECT id FROM access_requests WHERE id=? AND status='pending'", (rid,)):
        raise HTTPException(404, 'No pending request with that id')
    run("UPDATE access_requests SET status='rejected', decided_by=?, decided_at=? WHERE id=?", (head['id'], now(), rid))
    return {'ok': True}
