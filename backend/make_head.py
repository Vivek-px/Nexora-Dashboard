"""Create or repair the head account from the server PC itself (Nexora.bat → 10).

Use this when "Sign in with Google" is not set up yet. Only someone sitting at the server PC can run it – the same
trust as the first-run setup. The head approves every staff and admin access.
"""
import getpass
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app  # noqa: E402  (loads backend/.env and the database)
import roles  # noqa: E402
from db import one, run  # noqa: E402


def main():
    email = app.head_email()
    print(f'Head email (HEAD_EMAIL): {email}')
    u = one('SELECT * FROM users WHERE lower(email)=?', (email,))
    name = (u or {}).get('name') or input('Head’s full name: ').strip() or 'Head'
    while True:
        pw = getpass.getpass('Choose the head’s password (min 8 characters, not shown): ')
        if len(pw) >= 8 and pw == getpass.getpass('Type it again: '):
            break
        print('Passwords must match and be at least 8 characters. Try again.')
    if u:
        run("UPDATE users SET is_head=1, active=1, areas='*', pw_hash=?, must_change=0, sign_in=CASE WHEN sign_in='google' THEN 'both' ELSE sign_in END WHERE id=?",
            (app.hash_pw(pw), u['id']))
        uid = u['id']
    else:
        uid = run("INSERT INTO users(username, name, role, email, pw_hash, is_head) VALUES (?,?,'admin',?,?,1)", ('tmp-head', name, email, app.hash_pw(pw)))
        run('UPDATE users SET username=? WHERE id=?', (roles.staff_code(uid).lower(), uid))
    app.set_profile(uid, one("SELECT id FROM job_profiles WHERE name='Administrator'")['id'])
    run("UPDATE access_requests SET status='rejected' WHERE lower(email)=? AND status='pending'", (email,))
    staff_id = one('SELECT staff_id FROM users WHERE id=?', (uid,))['staff_id']
    print(f'\nDone. The head can sign in with {email} (or staff ID {staff_id}) and this password.')


if __name__ == '__main__':
    main()
