import hashlib
import time
from concurrent.futures import ThreadPoolExecutor

from fastapi import Response
from fastapi.testclient import TestClient
from app import auth, db, settings, providers, worker
from app.main import app


def user_client(email):
    identifier = db.uid('user')
    with db.connect(shared=True) as con:
        con.execute('INSERT INTO users VALUES (?,?,?,?,?)', (identifier, email, auth.password_hash('GoodPassword'), 'user', db.now()))
    client = TestClient(app, headers={'X-Sakuya-Client': 'workspace'})
    client.cookies.set(auth.COOKIE, auth.issue_session(identifier, Response()))
    return identifier, client


def provider(client, name):
    result = client.post('/api/settings/providers', json={'name': name, 'base_url': 'https://example.com/v1', 'api_key': 'private-' + name})
    assert result.status_code == 200
    pid = result.json()['id']
    result = client.post('/api/settings/models', json={'provider_id': pid, 'name': name})
    assert result.status_code == 200
    return pid, result.json()['models'][0]['id']


def test_regular_user_workspace_and_admin_data_are_isolated(client, monkeypatch):
    monkeypatch.setenv('MODEL_API_KEY', 'admin-env-secret')
    monkeypatch.setenv('MODEL_NAME', 'admin-env-model')
    admin_run = client.post('/api/chat', json={'prompt': 'admin-private', 'mode': 'demo'}).json()['run']
    admin_pid, _ = provider(client, 'admin-model')
    alice_id, alice = user_client('alice@example.com')
    bob_id, bob = user_client('bob@example.com')
    initial = alice.get('/api/workspace').json()
    assert initial['chats'] == [] and initial['settings']['providers'] == []
    assert not initial['settings']['model_configured']
    alice_pid, alice_model = provider(alice, 'alice-model')
    a = alice.post('/api/chat', json={'prompt': 'alice-private', 'mode': 'live', 'model_id': alice_model}).json()
    listing = alice.get('/api/planner').json()['lists'][0]
    entry = alice.post('/api/planner/entries', json={'title': 'alice-calendar', 'list_id': listing['id']}).json()
    assert 'id' in entry
    alice.put('/api/integrations/google/config', json={'client_id': 'alice-oauth', 'client_secret': 'alice-secret'})
    for other in (bob, client):
        snapshot = other.get('/api/workspace').json()
        assert 'alice-private' not in str(snapshot)
        assert 'alice-model' not in str(snapshot)
        assert 'alice-calendar' not in other.get('/api/planner').text
        assert 'alice-oauth' not in other.get('/api/integrations').text
        for suffix in ('', '/events', '/export'):
            assert other.get('/api/runs/' + a['run']['id'] + suffix).status_code == 404
        assert other.post('/api/runs/' + a['run']['id'] + '/cancel').status_code == 404
        assert other.patch('/api/conversations/' + a['conversation']['id'], json={'title': 'stolen'}).status_code == 404
        assert other.delete('/api/settings/providers/' + alice_pid).status_code == 404
    assert alice.get('/api/runs/' + admin_run['id']).status_code == 404
    assert alice.delete('/api/settings/providers/' + admin_pid).status_code == 404
    assert alice.get('/api/auth/me').json()['user']['id'] == alice_id
    assert bob.get('/api/auth/me').json()['user']['id'] == bob_id
    assert 'private-alice-model' not in alice.get('/api/workspace').text


def test_worker_uses_each_accounts_model_and_planner_context(client, monkeypatch):
    alice_id, alice = user_client('alice@example.com')
    bob_id, bob = user_client('bob@example.com')
    _, am = provider(alice, 'alice')
    _, bm = provider(bob, 'bob')
    # Actual LangGraph execution must propagate the workspace into its internal threads.
    seen = []
    def model(messages, structured=False, run=None, on_delta=None):
        from app import planner
        seen.append((db.current_owner(), settings.config_for_run(run)['api_key']))
        planner.create_list(planner.ListIn(name='worker-' + db.current_owner()))
        return 'reply-' + db.current_owner(), 3
    monkeypatch.setattr(providers, 'model', model)
    ar = alice.post('/api/chat', json={'prompt': 'hello', 'mode': 'live', 'model_id': am}).json()['run']
    br = bob.post('/api/chat', json={'prompt': 'hello', 'mode': 'live', 'model_id': bm}).json()['run']
    assert worker.work_once()
    assert sorted(seen) == sorted([(alice_id, 'private-alice'), (bob_id, 'private-bob')])
    for uid, c, run in ((alice_id, alice, ar), (bob_id, bob, br)):
        result = c.get('/api/runs/' + run['id']).json()
        assert result['status'] == 'completed', result
        assert result['report'] == 'reply-' + uid
        assert 'worker-' + uid in c.get('/api/planner').text
    assert 'worker-' + alice_id not in bob.get('/api/planner').text
    assert not client.get('/api/workspace').json()['chats']


def test_concurrent_account_requests_keep_separate_settings(client):
    _, alice = user_client('alice@example.com')
    _, bob = user_client('bob@example.com')
    def create_and_read(c, name):
        provider(c, name)
        return c.get('/api/settings').json()['models'][0]['name']
    with ThreadPoolExecutor(max_workers=2) as pool:
        a = pool.submit(create_and_read, alice, 'alice')
        b = pool.submit(create_and_read, bob, 'bob')
        assert a.result() == 'alice'
        assert b.result() == 'bob'
    assert settings.catalog()[0] == []


def test_remember_login_cookie_expiry_restore_and_logout(client, monkeypatch):
    monkeypatch.setattr(auth, 'verify_human', lambda *_: None)
    client.cookies.clear()
    body = {'email': 'admin@example.com', 'password': 'TestPassword', 'human_token': 'test'}
    for remember in (False, True):
        result = client.post('/api/auth/login', json=body | {'remember': remember})
        assert result.status_code == 200
        cookie = result.headers['set-cookie']
        assert 'HttpOnly' in cookie and 'SameSite=lax' in cookie
        assert ('Max-Age=2592000' in cookie) == remember
        if not remember:
            assert 'max-age' not in cookie.lower() and 'expires=' not in cookie.lower()
        token = client.cookies.get(auth.COOKIE)
        with db.connect(shared=True) as con:
            expiry = con.execute('SELECT expires FROM sessions WHERE token=?', (hashlib.sha256(token.encode()).hexdigest(),)).fetchone()[0]
        assert abs(expiry - time.time() - (30 if remember else 1) * 86400) < 5
        restored = TestClient(app, headers={'X-Sakuya-Client': 'workspace'})
        restored.cookies.set(auth.COOKIE, token)
        assert restored.get('/api/auth/me').json()['user']['email'] == body['email']
        client.post('/api/auth/logout')
        assert restored.get('/api/auth/me').json()['user'] is None
