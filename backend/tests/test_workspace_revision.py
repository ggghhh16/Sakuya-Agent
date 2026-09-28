from stream_fakes import model_response
import json
import time
import httpx
import pytest
from app import auth, db, providers
from app.worker import execute
from test_accounts_models import code, add_provider


def test_username_migration_login_uniqueness_and_ticket_names(client, monkeypatch):
    monkeypatch.setattr(auth, 'verify_human', lambda *_: None)
    auth.init()
    first = client.get('/api/auth/me').json()['user']
    auth.init()
    assert client.get('/api/auth/me').json()['user']['username'] == first['username']
    code()
    body = {'username': '测试User', 'email': 'new@example.com', 'password': 'GoodPassword', 'code': '123456'}
    assert client.post('/api/auth/register', json=body).status_code == 201
    code('other@example.com')
    assert client.post('/api/auth/register', json=body | {'username': '测试user', 'email': 'other@example.com'}).status_code == 409
    client.cookies.clear()
    result = client.post('/api/auth/login', json={'identifier': '测试USER', 'password': 'GoodPassword', 'human_token': 'mock'})
    assert result.status_code == 200, result.text
    assert result.json()['user']['username'] == '测试User'
    ticket = client.post('/api/tickets', json={'title': '用户名工单'}).json()
    assert ticket['customer'] == '测试User'
    # Historical records containing email addresses are presented as usernames.
    with db.workspace():
        db.patch(ticket['id'], {'customer': 'new@example.com', 'assignee': 'admin@example.com', 'comments': [{'id': 'old', 'author': 'admin@example.com', 'content': '回复', 'internal': False}]})
    result = client.get('/api/tickets/' + ticket['id'])
    assert '@example.com' not in result.text
    assert result.json()['assignee'] == first['username']
    client.post('/api/auth/logout')
    assert client.post('/api/auth/login', json={'identifier': body['email'], 'password': body['password'], 'human_token': 'mock'}).status_code == 200


def test_email_cooldown_is_ninety_seconds(client, monkeypatch):
    monkeypatch.setattr(auth, 'verify_human', lambda *_: None)
    monkeypatch.setattr(auth, 'send_email', lambda *_: None)
    body = {'email': 'new@example.com', 'human_token': 'mock'}
    before = time.time()
    assert client.post('/api/auth/email-code', json=body).json()['retry_after'] == 90
    with db.connect(shared=True) as con:
        expiry = con.execute("SELECT expires FROM auth_limits WHERE key='send-email:new@example.com'").fetchone()[0]
        assert 89 <= expiry - before <= 92
        con.execute("UPDATE auth_limits SET expires=? WHERE key='send-email:new@example.com'", (time.time() + 25,))
    assert client.post('/api/auth/email-code', json=body).status_code == 429
    with db.connect(shared=True) as con:
        con.execute("UPDATE auth_limits SET expires=0 WHERE key='send-email:new@example.com'")
    assert client.post('/api/auth/email-code', json=body).status_code == 200


@pytest.mark.parametrize('mode,expected_waits', [('assist', 2), ('ask', 3), ('auto', 0)])
def test_tool_approval_replay_reject_and_no_duplicate_writes(client, monkeypatch, mode, expected_waits):
    _, mid = add_provider(client, 'approvals', 'tool-model')
    count = 0
    def handle(request):
        nonlocal count
        count += 1
        if count == 1:
            calls = [('read', 'planner_read', {}), ('write1', 'planner_create_list', {'name': 'Approved list'}), ('write2', 'planner_create_list', {'name': 'Denied list'})]
            message = {'role': 'assistant', 'content': None, 'tool_calls': [{'id': key, 'type': 'function', 'function': {'name': name, 'arguments': json.dumps(args)}} for key, name, args in calls]}
        else:
            message = {'role': 'assistant', 'content': 'Done'}
        return model_response(message)
    original = httpx.Client
    monkeypatch.setattr(providers.httpx, 'Client', lambda **kw: original(transport=httpx.MockTransport(handle)))
    queued = client.post('/api/chat', json={'prompt': 'Read, create two lists', 'mode': 'live', 'planner_tools': True, 'model_id': mid, 'approval_mode': mode}).json()
    identifier = queued['run']['id']
    execute(db.claim())
    waits = 0
    while db.get(identifier)['status'] == 'waiting':
        waits += 1
        assert waits <= 3
        run = db.get(identifier)
        assert client.post('/api/chat', json={'prompt': 'overlap', 'conversation_id': queued['conversation']['id']}).status_code == 422
        args = run['approval']['arguments']
        is_denied = args.get('name') == 'Denied list'
        assert 'Denied list' not in client.get('/api/planner').text
        client.post(f'/api/runs/{identifier}/resume', json={'decision': 'skip' if is_denied else 'approve'})
        execute(db.claim())
    assert db.get(identifier)['status'] == 'completed', db.get(identifier)
    assert waits == expected_waits
    names = [x['name'] for x in client.get('/api/planner').json()['lists']]
    assert names.count('Approved list') == 1
    assert names.count('Denied list') == (1 if mode == 'auto' else 0)
    assert count == 2  # Resumption does not repeat the model request.
