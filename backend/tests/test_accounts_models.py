from stream_fakes import model_response
import hashlib
import time
from types import SimpleNamespace
import httpx
import pytest
from fastapi import Response, HTTPException
from fastapi.testclient import TestClient
from app import auth, db, settings, providers
from app.main import app
from app.worker import execute


def account(client, email='user@example.com', role='user'):
    identifier = db.uid('user')
    with db.connect() as con:
        con.execute('INSERT INTO users VALUES (?,?,?,?,?)', (identifier, email, auth.password_hash('GoodPassword'), role, db.now()))
    client.cookies.clear()
    client.cookies.set(auth.COOKIE, auth.issue_session(identifier, Response()))
    return identifier


def code(email='new@example.com', value='123456', expires=None):
    with db.connect() as con:
        con.execute('INSERT OR REPLACE INTO email_codes VALUES (?,?,?,?,0)', (email, hashlib.sha256(('salt' + value).encode()).hexdigest(), 'salt', expires or time.time() + 600))


def test_anonymous_cannot_read_or_modify_workspace(client):
    client.cookies.clear()
    for path in ('workspace', 'settings', 'planner', 'runs/private', 'tickets/private', 'mcp/planner'):
        assert client.get('/api/' + path).status_code == 401
    assert client.post('/api/chat', json={'prompt': 'hello'}).status_code == 401
    assert client.get('/api/auth/me').json() == {'user': None}
    assert client.get('/api/health').status_code == 200


@pytest.mark.parametrize('password', ['shortAa', 'lowercaseonly', 'UPPERCASEONLY', '12345678'])
def test_password_strength_enforced_server_side(client, password):
    code()
    assert client.post('/api/auth/register', json={'username': 'NewUser', 'email': 'new@example.com', 'password': password, 'code': '123456'}).status_code == 422


def test_register_requires_code_and_cannot_self_promote(client):
    body = {'username': 'NewUser', 'email': 'New@Example.com', 'password': 'GoodPassword', 'code': '123456'}
    assert client.post('/api/auth/register', json=body).status_code == 400
    code()
    assert client.post('/api/auth/register', json=body | {'role': 'admin'}).status_code == 422
    assert client.post('/api/auth/register', json=body).status_code == 201
    assert client.post('/api/auth/register', json=body).status_code == 409
    with db.connect() as con:
        user = con.execute("SELECT * FROM users WHERE email='new@example.com'").fetchone()
        assert user['role'] == 'user'
        assert user['password'] != 'GoodPassword'
        assert con.execute('SELECT count(*) FROM email_codes').fetchone()[0] == 0


def test_code_expiry_and_five_attempt_limit(client):
    body = {'username': 'NewUser', 'email': 'new@example.com', 'password': 'GoodPassword', 'code': '000000'}
    code()
    for _ in range(5):
        assert client.post('/api/auth/register', json=body).status_code == 400
    assert client.post('/api/auth/register', json=body | {'code': '123456'}).status_code == 400
    code(expires=time.time() - 1)
    assert client.post('/api/auth/register', json=body | {'code': '123456'}).status_code == 400


def test_human_verification_and_email_rate_limit(client, monkeypatch):
    sent = []
    monkeypatch.setattr(auth, 'verify_human', lambda token, action: None)
    monkeypatch.setattr(auth, 'send_email', lambda email, value: sent.append((email, value)))
    result = client.post('/api/auth/email-code', json={'email': 'new@example.com', 'human_token': 'test'})
    assert result.status_code == 200 and len(sent[0][1]) == 6
    assert sent[0][1] not in result.text
    assert client.post('/api/auth/email-code', json={'email': 'new@example.com', 'human_token': 'test'}).status_code == 429
    assert client.post('/api/auth/register', json={'username': 'NewUser', 'email': 'new@example.com', 'password': 'GoodPassword', 'code': sent[0][1]}).status_code == 201


def test_turnstile_checks_action_hostname_and_fails_closed(monkeypatch):
    monkeypatch.setenv('TURNSTILE_SECRET_KEY', 'unit-test-secret')
    monkeypatch.setenv('TURNSTILE_HOSTNAMES', 'localhost')
    result = {'success': True, 'action': 'register', 'hostname': 'localhost'}
    monkeypatch.setattr(auth.httpx, 'post', lambda *args, **kwargs: SimpleNamespace(raise_for_status=lambda: None, json=lambda: result))
    auth.verify_human('token', 'register')
    with pytest.raises(HTTPException): auth.verify_human('token', 'login')
    result['hostname'] = 'evil.example'
    with pytest.raises(HTTPException): auth.verify_human('token', 'register')
    result['hostname'], result['success'] = 'localhost', False
    with pytest.raises(HTTPException): auth.verify_human('token', 'register')
    monkeypatch.delenv('TURNSTILE_SECRET_KEY')
    with pytest.raises(HTTPException) as exc: auth.verify_human('token', 'register')
    assert exc.value.status_code == 503


def test_login_logout_expiry_and_rate_limit(client, monkeypatch):
    account(client)
    client.cookies.clear()
    monkeypatch.setattr(auth, 'verify_human', lambda token, action: None)
    body = {'email': 'USER@example.com', 'password': 'GoodPassword', 'human_token': 'test'}
    assert client.post('/api/auth/login', json=body | {'password': 'wrong'}).status_code == 401
    result = client.post('/api/auth/login', json=body)
    assert result.status_code == 200
    assert 'HttpOnly' in result.headers['set-cookie'] and 'SameSite=lax' in result.headers['set-cookie']
    assert client.get('/api/auth/me').json()['user']['email'] == 'user@example.com'
    token = client.cookies.get(auth.COOKIE)
    client.post('/api/auth/logout')
    client.cookies.set(auth.COOKIE, token)
    assert client.get('/api/workspace').status_code == 401
    client.post('/api/auth/login', json=body)
    with db.connect() as con: con.execute('UPDATE sessions SET expires=0')
    assert client.get('/api/workspace').status_code == 401
    for _ in range(10): client.post('/api/auth/login', json=body | {'password': 'wrong'})
    assert client.post('/api/auth/login', json=body).status_code == 429


def test_users_only_access_own_tickets_and_public_replies(client):
    admin_cookie = client.cookies.get(auth.COOKIE)
    account(client)
    ticket = client.post('/api/tickets', json={'title': 'Help', 'description': 'Details'}).json()
    identifier = ticket['id']
    assert client.patch('/api/tickets/' + identifier, json={'title': 'Edited', 'description': 'More details'}).status_code == 200
    for changes in ({'status': 'resolved'}, {'assignee': 'me'}, {'priority': 'high'}):
        assert client.patch('/api/tickets/' + identifier, json=changes).status_code == 403
    assert client.post(f'/api/tickets/{identifier}/comments', json={'content': 'fake admin', 'internal': False}).status_code == 403
    for path in ('settings', 'planner'):
        assert client.get('/api/' + path).status_code == 200
    assert client.get('/api/runs/any').status_code == 404
    assert client.get('/api/mcp/planner').status_code == 405
    owner_cookie = client.cookies.get(auth.COOKIE)
    account(client, 'other@example.com')
    assert client.get('/api/tickets/' + identifier).status_code == 404
    assert client.patch('/api/tickets/' + identifier, json={'title': 'stolen'}).status_code == 404
    assert client.get('/api/workspace').json()['tickets'] == []
    client.cookies.clear(); client.cookies.set(auth.COOKIE, admin_cookie)
    assert client.patch('/api/tickets/' + identifier, json={'status': 'in_progress', 'assignee': 'admin@example.com'}).status_code == 200
    client.post(f'/api/tickets/{identifier}/comments', json={'content': 'secret-note', 'internal': True})
    client.post(f'/api/tickets/{identifier}/comments', json={'content': 'public-reply', 'internal': False})
    client.cookies.clear(); client.cookies.set(auth.COOKIE, owner_cookie)
    result = client.get('/api/workspace')
    assert 'secret-note' not in result.text and 'public-reply' in result.text
    assert 'secret-note' not in client.patch('/api/tickets/' + identifier, json={'title': 'new'}).text
    assert not result.json()['chats'] and not result.json()['settings']['providers']


def add_provider(client, name, model, reasoning=False):
    response = client.post('/api/settings/providers', json={'name': name, 'base_url': f'https://{name}.example/v1', 'api_key': f'secret-{name}'})
    assert response.status_code == 200, response.text
    pid = response.json()['id']
    result = client.post('/api/settings/models', json={'provider_id': pid, 'name': model, 'reasoning': reasoning}).json()
    return pid, next(m['id'] for m in result['models'] if m['provider_id'] == pid)


def test_model_routing_snapshot_and_reasoning_reach_provider(client, monkeypatch):
    first, first_model = add_provider(client, 'first', 'same-name')
    second, second_model = add_provider(client, 'second', 'same-name', True)
    assert len(client.get('/api/settings').json()['models']) == 2
    response = client.post('/api/chat', json={'prompt': 'Test', 'mode': 'live', 'model_id': second_model, 'reasoning_effort': 'high'})
    assert response.status_code == 201, response.text
    run = response.json()['run']
    assert 'secret-' not in response.text and run['provider_id'] == second
    client.put('/api/settings/default-model', json={'model_id': first_model})
    captured = []
    def handle(request):
        captured.append(request)
        return model_response({'content': 'real adapter reply'}, 3)
    original = httpx.Client
    monkeypatch.setattr(providers.httpx, 'Client', lambda **kwargs: original(transport=httpx.MockTransport(handle)))
    execute(db.claim())
    import json
    assert captured[0].url.host == 'second.example'
    assert captured[0].headers['Authorization'] == 'Bearer secret-second'
    assert json.loads(captured[0].content)['reasoning_effort'] == 'high'
    assert db.get(run['id'])['status'] == 'completed'
    assert client.post('/api/chat', json={'prompt': 'Test', 'mode': 'live', 'model_id': first_model, 'reasoning_effort': 'high'}).status_code == 422
    assert client.post('/api/chat', json={'prompt': 'Test', 'mode': 'live', 'model_id': 'missing'}).status_code == 422


def test_provider_secret_retention_discovery_and_deletion(client, monkeypatch):
    pid, mid = add_provider(client, 'first', 'one')
    assert 'secret-first' not in client.get('/api/workspace').text
    assert client.post('/api/settings/providers', json={'id': pid, 'name': 'renamed', 'base_url': 'https://first.example/v1'}).status_code == 200
    assert settings.catalog()[0][0]['api_key'] == 'secret-first'
    assert client.post('/api/settings/providers', json={'id': pid, 'name': 'renamed', 'base_url': 'https://other.example/v1'}).status_code == 422
    from app import model_settings
    original = httpx.Client
    monkeypatch.setattr(model_settings.httpx, 'Client', lambda **kwargs: original(transport=httpx.MockTransport(lambda request: httpx.Response(200, json={'data': [{'id': 'two'}, {'id': 'one'}, {'id': 'two'}]}))))
    assert client.get(f'/api/settings/providers/{pid}/models').json()['models'] == ['one', 'two']
    assert client.delete(f'/api/settings/providers/{pid}').status_code == 200
    assert settings.public_config()['models'] == [] and not settings.public_config()['model_configured']


def test_legacy_provider_migration_preserves_key(client):
    settings.save_config({'api_key': 'legacy-secret', 'model': 'old-model', 'base_url': 'https://old.example/v1'})
    assert settings.public_config()['default_model_id'] == 'legacy-model'
    add_provider(client, 'new', 'new-model')
    assert len(settings.catalog()[0]) == 2
    assert settings.config_for_run(settings.resolve_model('legacy-model'))['api_key'] == 'legacy-secret'


def test_planner_tool_chat_uses_selected_model_and_reasoning(client, monkeypatch):
    import json
    pid, mid = add_provider(client, 'planner', 'tool-reasoner', True)
    requests = []
    def handle(request):
        body = json.loads(request.content)
        requests.append(body)
        assert request.url.host == 'planner.example'
        assert request.headers['Authorization'] == 'Bearer secret-planner'
        assert body['model'] == 'tool-reasoner' and body['reasoning_effort'] == 'medium'
        message = {'role': 'assistant', 'content': '已读取本机任务'} if len(requests) > 1 else {
            'role': 'assistant', 'content': None, 'reasoning_content': '读取任务再回答',
            'tool_calls': [{'id': 'read-1', 'type': 'function', 'function': {'name': 'planner_read', 'arguments': '{}'}}]}
        return model_response(message, 5)
    original = httpx.Client
    monkeypatch.setattr(providers.httpx, 'Client', lambda **kwargs: original(transport=httpx.MockTransport(handle)))
    result = client.post('/api/chat', json={'prompt': '查看任务', 'mode': 'live', 'planner_tools': True, 'model_id': mid, 'reasoning_effort': 'medium'})
    assert result.status_code == 201
    execute(db.claim())
    run = db.get(result.json()['run']['id'])
    assert run['status'] == 'completed' and run['tokens'] == 10
    assert run['tool_log'][0]['name'] == 'planner_read'
    assert requests[1]['messages'][-2]['reasoning_content'] == '读取任务再回答'
    assert requests[1]['messages'][-1]['role'] == 'tool'
