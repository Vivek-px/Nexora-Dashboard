"""Job profiles (Part 1C): what each kind of staff member can see and do.

A profile sets a permission level (admin / manager / viewer – what they may change), the pages they see in the
Workspace and Operations menus, and which of the eight domains they see. Built-in presets are created on first run
and can be edited or copied by an admin in Staff & access.
"""
from db import one

WORKSPACE = ['today', 'command', 'geo', 'domain', 'forecast', 'scenario', 'recs', 'method']
OPERATIONS = ['upload', 'complaints', 'bills', 'benchmarks', 'reports', 'savings', 'admin', 'staff']
PAGES = WORKSPACE + OPERATIONS
ADMIN_ONLY = {'admin', 'staff'}
DOMAINS = ['Energy', 'Water', 'Air Quality', 'Mobility', 'Buildings & Assets', 'Waste', 'Carbon', 'Climate & Resilience']
ALL_BUT_ADMIN = [p for p in PAGES if p not in ADMIN_ONLY]

PRESETS = [
    ('Administrator', 'Everything, including staff, alerts and site settings.', 'admin', PAGES, '*'),
    ('Estate / facility manager', 'Runs the site: all dashboards and operations, uploads data, owns actions. No staff or settings.', 'manager', ALL_BUT_ADMIN, '*'),
    ('Energy officer', 'Electricity, demand and carbon: readings, forecasts, bills and savings.', 'manager',
     ['today', 'domain', 'forecast', 'scenario', 'recs', 'method', 'upload', 'complaints', 'bills', 'benchmarks', 'reports', 'savings'], 'Energy,Carbon'),
    ('Water & sanitation officer', 'Water use, leakage and drainage.', 'manager',
     ['today', 'domain', 'forecast', 'scenario', 'recs', 'method', 'upload', 'complaints', 'benchmarks', 'reports', 'savings'], 'Water,Climate & Resilience'),
    ('Environment officer', 'Air quality, climate and resilience; station evidence on the map.', 'manager',
     ['today', 'geo', 'domain', 'forecast', 'recs', 'method', 'complaints', 'reports'], 'Air Quality,Climate & Resilience,Carbon'),
    ('Waste supervisor', 'Waste generation and segregation.', 'manager',
     ['today', 'domain', 'recs', 'upload', 'complaints', 'benchmarks'], 'Waste'),
    ('Field staff', 'Reports problems with a photo and location; sees today’s priorities.', 'viewer', ['today', 'complaints'], '*'),
    ('Director / commissioner', 'Read-only overview, costs and reports.', 'viewer',
     ['today', 'command', 'geo', 'recs', 'bills', 'benchmarks', 'reports', 'savings'], '*'),
    ('Auditor (read-only)', 'Sees every dashboard and its evidence; cannot change anything.', 'viewer', [p for p in ALL_BUT_ADMIN if p != 'upload'], '*'),
]
ROLE_DEFAULT = {'admin': 'Administrator', 'manager': 'Estate / facility manager', 'viewer': 'Auditor (read-only)'}


def ensure_presets(con):
    """Create the built-in profiles and give older accounts the profile matching their role (runs at database open)."""
    for name, desc, level, pages, domains in PRESETS:
        con.execute('INSERT OR IGNORE INTO job_profiles(name, description, level, pages, domains, builtin) VALUES (?,?,?,?,?,1)',
                    (name, desc, level, ','.join(pages), domains))
    for uid, role in con.execute('SELECT id, role FROM users WHERE job_profile_id IS NULL').fetchall():
        pid = con.execute('SELECT id FROM job_profiles WHERE name=?', (ROLE_DEFAULT[role],)).fetchone()[0]
        con.execute('UPDATE users SET job_profile_id=? WHERE id=?', (pid, uid))
    for (uid,) in con.execute("SELECT id FROM users WHERE staff_id IS NULL OR staff_id=''").fetchall():
        con.execute('UPDATE users SET staff_id=? WHERE id=?', (staff_code(uid), uid))
    con.commit()


def staff_code(uid):
    return f'EIQ-{uid:04d}'


def clean_pages(pages, level):
    picked = [p for p in PAGES if p in set(pages)]
    if level != 'admin':
        picked = [p for p in picked if p not in ADMIN_ONLY]
    if not picked:
        raise ValueError('Pick at least one page')
    return picked


def clean_domains(domains):
    if domains in ('*', ['*']) or (isinstance(domains, list) and set(DOMAINS) <= set(domains)):
        return '*'
    picked = [d for d in DOMAINS if d in set(domains if isinstance(domains, list) else domains.split(','))]
    if not picked:
        raise ValueError('Pick at least one domain')
    return ','.join(picked)


def access_of(user):
    """Pages and domains this user may see (derived from the job profile; safe defaults for odd rows)."""
    prof = one('SELECT * FROM job_profiles WHERE id=?', (user.get('job_profile_id'),)) if user.get('job_profile_id') else None
    if not prof:
        prof = one('SELECT * FROM job_profiles WHERE name=?', (ROLE_DEFAULT[user['role']],))
    pages = prof['pages'].split(',') if prof else (PAGES if user['role'] == 'admin' else ALL_BUT_ADMIN)
    if user['role'] != 'admin':
        pages = [p for p in pages if p not in ADMIN_ONLY]
    domains = DOMAINS if not prof or prof['domains'] == '*' else [d for d in prof['domains'].split(',') if d in DOMAINS]
    return {'job_profile_id': prof['id'] if prof else None, 'job_profile': prof['name'] if prof else user['role'], 'pages': pages, 'domains': domains}
