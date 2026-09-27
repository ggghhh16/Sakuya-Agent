import os
import sys
import tempfile
import shutil
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
temp = tempfile.TemporaryDirectory(prefix='sakuya-tests-')
os.environ['SAKUYA_DATA_DIR'] = temp.name


@pytest.fixture(autouse=True)
def database():
    from app import db, auth, settings
    # All test workspaces live below this fixture's dedicated temporary root.
    users = db.DATA / 'users'
    assert users.resolve().is_relative_to(Path(temp.name).resolve())
    shutil.rmtree(users, ignore_errors=True)
    db.init()
    auth.init()
    if settings.CONFIG.exists():
        settings.CONFIG.unlink()
    with db.connect() as con:
        con.execute('DELETE FROM objects')
        con.execute('DELETE FROM events')
        for table in ('usernames', 'users', 'sessions', 'email_codes', 'auth_limits', 'browser_checks'):
            con.execute(f'DELETE FROM {table}')
    yield


@pytest.fixture
def client():
    from fastapi.testclient import TestClient
    from app.main import app
    with TestClient(app, headers={'X-Sakuya-Client': 'workspace'}) as client:
        from app import auth, db
        from fastapi import Response
        with db.connect() as con:
            con.execute('INSERT INTO users VALUES (?,?,?,?,?)', ('test-admin', 'admin@example.com', auth.password_hash('TestPassword'), 'admin', db.now()))
        client.cookies.set(auth.COOKIE, auth.issue_session('test-admin', Response()))
        yield client
