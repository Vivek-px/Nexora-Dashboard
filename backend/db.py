"""SQLite storage for everything the dashboard writes: users, measured readings, alerts, actions, savings."""
import sqlite3
import threading
from pathlib import Path

DATA = Path(__file__).resolve().parent / 'data'
DATA.mkdir(exist_ok=True)
(DATA / 'uploads').mkdir(exist_ok=True)
DB_PATH = DATA / 'nexora.db'

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','manager','viewer')),
  areas TEXT NOT NULL DEFAULT '*', phone TEXT DEFAULT '', email TEXT DEFAULT '', pw_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS job_profiles (
  id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, description TEXT DEFAULT '', level TEXT NOT NULL CHECK(level IN ('admin','manager','viewer')),
  pages TEXT NOT NULL, domains TEXT NOT NULL DEFAULT '*', builtin INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS access_requests (
  id INTEGER PRIMARY KEY, email TEXT NOT NULL, name TEXT DEFAULT '', picture TEXT DEFAULT '', google_sub TEXT, note TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT (datetime('now')), decided_by INTEGER, decided_at TEXT);
CREATE TABLE IF NOT EXISTS uploads (
  id INTEGER PRIMARY KEY, filename TEXT NOT NULL, rows INTEGER NOT NULL, user_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')), summary TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS readings (
  id INTEGER PRIMARY KEY, area TEXT NOT NULL, metric TEXT NOT NULL, month TEXT NOT NULL, value REAL NOT NULL, note TEXT DEFAULT '',
  upload_id INTEGER, user_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(area, metric, month));
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY, created_at TEXT NOT NULL DEFAULT (datetime('now')), area TEXT NOT NULL, metric TEXT NOT NULL, month TEXT NOT NULL,
  level TEXT NOT NULL, message TEXT NOT NULL, detail TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'open',
  ack_by INTEGER, ack_at TEXT, escalated_at TEXT, UNIQUE(area, metric, month, level));
CREATE TABLE IF NOT EXISTS alert_deliveries (
  id INTEGER PRIMARY KEY, alert_id INTEGER, channel TEXT NOT NULL, recipient TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL,
  detail TEXT DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS recipients (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, channel TEXT NOT NULL CHECK(channel IN ('whatsapp','sms')), phone TEXT NOT NULL,
  min_level TEXT NOT NULL DEFAULT 'Watch', areas TEXT NOT NULL DEFAULT '*', escalation INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS action_state (
  action_id TEXT PRIMARY KEY, area TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Open', owner_id INTEGER, due_date TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')), updated_by INTEGER);
CREATE TABLE IF NOT EXISTS action_events (
  id INTEGER PRIMARY KEY, action_id TEXT NOT NULL, user_id INTEGER, kind TEXT NOT NULL, text TEXT DEFAULT '', file TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS savings (
  id INTEGER PRIMARY KEY, action_id TEXT, action_title TEXT DEFAULT '', area TEXT NOT NULL, metric TEXT NOT NULL,
  baseline_from TEXT NOT NULL, baseline_to TEXT NOT NULL, after_from TEXT NOT NULL, after_to TEXT NOT NULL,
  baseline_avg REAL NOT NULL, after_avg REAL NOT NULL, months INTEGER NOT NULL, unit TEXT NOT NULL, tariff REAL NOT NULL DEFAULT 0,
  units_saved REAL NOT NULL, rupees_saved REAL NOT NULL, evidence TEXT NOT NULL, note TEXT DEFAULT '', user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS live_cache (key TEXT PRIMARY KEY, fetched_at TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS site_profiles (
  area TEXT PRIMARY KEY, population REAL, floor_area_m2 REAL, contract_demand_kw REAL, energy_rate REAL, demand_rate REAL,
  min_billing_pct REAL DEFAULT 80, excess_multiplier REAL DEFAULT 2, fixed_charge REAL DEFAULT 0, water_rate_per_kl REAL,
  epi_target REAL, lpcd_target REAL DEFAULT 135, waste_target REAL, updated_at TEXT);
CREATE TABLE IF NOT EXISTS complaints (
  id INTEGER PRIMARY KEY, area TEXT NOT NULL, category TEXT NOT NULL, title TEXT NOT NULL, description TEXT DEFAULT '',
  severity TEXT NOT NULL DEFAULT 'Medium', lat REAL, lon REAL, photo TEXT DEFAULT '', reporter_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
"""

_lock = threading.Lock()


def connect():
    con = sqlite3.connect(DB_PATH, check_same_thread=False, isolation_level=None)
    con.row_factory = sqlite3.Row
    con.execute('PRAGMA foreign_keys=ON')
    # Default rollback journal (not WAL): safer when the project sits in a OneDrive/Dropbox-synced folder on Windows.
    con.execute('PRAGMA busy_timeout=5000')
    return con


_con = None


def db():
    global _con
    if _con is None:
        _con = connect()
        _con.executescript(SCHEMA)
        _con.execute("INSERT OR IGNORE INTO settings(key, value) VALUES ('escalation_hours', '24')")
        migrate(_con)
        from roles import ensure_presets  # noqa: PLC0415 (roles imports db)
        ensure_presets(_con)
    return _con


MIGRATIONS = {
    'complaints': (('place', "TEXT DEFAULT ''"), ('loc_source', "TEXT DEFAULT ''"),
                   # dismissed complaints leave every list; admins can delete them for good
                   ('status', "TEXT NOT NULL DEFAULT 'open'"), ('dismissed_by', 'INTEGER'), ('dismissed_at', 'TEXT'), ('dismiss_reason', "TEXT DEFAULT ''")),
    # sign-up ("Create access ID") and admin-proposed staff wait for the head's approval
    'access_requests': (('phone', "TEXT DEFAULT ''"), ('job_title', "TEXT DEFAULT ''"), ('access', "TEXT NOT NULL DEFAULT 'staff'"),
                        ('requested_profile_id', 'INTEGER'), ('pw_hash', 'TEXT'), ('source', "TEXT NOT NULL DEFAULT 'google'"),
                        ('proposed_by', 'INTEGER'), ('proposed_areas', "TEXT DEFAULT '*'"), ('proposed_sign_in', "TEXT DEFAULT ''")),
    # Part 1C staff portal: staff ID, job profile, first-login password change, Google sign-in
    'users': (('staff_id', 'TEXT'), ('job_profile_id', 'INTEGER'), ('must_change', 'INTEGER NOT NULL DEFAULT 0'),
              ('sign_in', "TEXT NOT NULL DEFAULT 'both'"), ('google_sub', 'TEXT'), ('last_login', 'TEXT'), ('is_head', 'INTEGER NOT NULL DEFAULT 0')),
}


def migrate(con):
    """Add columns introduced by later versions to an existing database (data is kept)."""
    for table, adds in MIGRATIONS.items():
        cols = {r[1] for r in con.execute(f'PRAGMA table_info({table})')}
        for name, ddl in adds:
            if name not in cols:
                con.execute(f'ALTER TABLE {table} ADD COLUMN {name} {ddl}')
    con.commit()


def q(sql, args=()):
    with _lock:
        return [dict(r) for r in db().execute(sql, args).fetchall()]


def one(sql, args=()):
    rows = q(sql, args)
    return rows[0] if rows else None


def run(sql, args=()):
    with _lock:
        cur = db().execute(sql, args)
        return cur.lastrowid


def setting(key, default=''):
    row = one('SELECT value FROM settings WHERE key=?', (key,))
    return row['value'] if row else default


def reset_for_tests(path):
    """Point the module at a fresh database file (tests only)."""
    global _con, DB_PATH
    _con = None
    DB_PATH = Path(path)
