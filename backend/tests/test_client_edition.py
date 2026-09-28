"""Run Client in a fresh interpreter so dev's imported modules stay unchanged."""
import os
import subprocess
import sys
from pathlib import Path


def test_client_distribution(tmp_path):
    code = r'''
from fastapi.testclient import TestClient
from app.main import app
from app import db, settings
from app.edition import IS_CLIENT
assert IS_CLIENT
with TestClient(app, headers={'X-Sakuya-Client': 'workspace'}) as c:
    assert c.get('/api/health').json()['edition'] == 'client'
    user = c.get('/api/auth/me').json()['user']
    assert user['id'] == 'local-client'
    w = c.get('/api/workspace')
    assert w.status_code == 200
    assert w.json()['tickets'] == [] and w.json()['runs'] == []
    assert not w.json()['settings']['experimental_features']
    assert not w.json()['settings']['model_configured']
    assert not c.cookies
    with db.connect() as con:
        assert con.execute('SELECT count(*) FROM users').fetchone()[0] == 0
    for path in ['/api/auth/login', '/api/auth/register', '/api/auth/email-code', '/api/auth/logout', '/api/tickets']:
        assert c.post(path, json={}).status_code == 404, path
    for path in ['/api/auth/config', '/api/tickets/unknown', '/human-check']:
        assert c.get(path).status_code == 404, path
    assert c.put('/api/settings/experimental', json={'enabled': True}).status_code == 404
    settings.save_config({'experimental_features': True})
    assert not settings.experimental_enabled()
    run = {'title': 'Client research', 'prompt': 'Research a local example', 'kind': 'diagnosis', 'mode': 'demo'}
    assert c.post('/api/runs', json=run).status_code == 404
    run['kind'] = 'research'
    assert c.post('/api/runs', json=run).status_code == 201
    run['ticket_id'] = 'unknown'
    assert c.post('/api/runs', json=run).status_code == 404
    diagnosis = db.put('run', {'kind': 'diagnosis', 'title': 'Unavailable'})
    assert c.get('/api/runs/' + diagnosis['id']).status_code == 404
    assert all(r['kind'] != 'diagnosis' for r in c.get('/api/workspace').json()['runs'])
    assert c.post('/api/chat', json={'prompt': 'Hello', 'mode': 'demo'}).status_code == 201
    assert c.get('/api/workspace', headers={'Origin': 'https://evil.example'}).status_code == 403
    assert c.get('/api/workspace', headers={'Origin': 'http://127.0.0.1:8120'}).status_code == 403
    assert c.get('/api/workspace', headers={'Origin': 'http://127.0.0.1:8121'}).status_code == 200
    schema = c.get('/openapi.json').json()['paths']
    assert not any(p.startswith('/api/tickets') or p.startswith('/api/auth/') for p in schema)
with TestClient(app) as c:
    assert c.post('/api/chat', json={'prompt': 'bad'}).status_code == 403
print('Client no-login, API exclusion, clean data, persistence and request safety: PASS')
'''
    env = {**os.environ, 'SAKUYA_EDITION': 'client', 'SAKUYA_PORT': '8121',
           'SAKUYA_DATA_DIR': str(tmp_path), 'SAKUYA_ENV_FILE': str(tmp_path / 'absent.env'),
           'PYTHONPATH': str(Path(__file__).resolve().parents[1]), 'PYTHONUTF8': '1',
           'MODEL_NAME': 'must-not-inherit', 'MODEL_API_KEY': 'must-not-inherit'}
    result = subprocess.run([sys.executable, '-c', code], env=env, capture_output=True, text=True, timeout=60)
    assert result.returncode == 0, result.stdout + result.stderr
