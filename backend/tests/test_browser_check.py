import time
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from app import auth, db


def create(client, action='login'):
    client.cookies.clear()
    result = client.post('/api/auth/browser-check', json={'action': action})
    assert result.status_code == 200
    return result.json()


@pytest.fixture
def cloudflare(monkeypatch):
    monkeypatch.setenv('TURNSTILE_SECRET_KEY', 'unit-test-secret')
    monkeypatch.setenv('TURNSTILE_HOSTNAMES', 'localhost')
    result = {'success': True, 'action': 'login', 'hostname': 'localhost'}
    calls = []
    def post(*args, **kwargs):
        calls.append(kwargs['data']['response'])
        return SimpleNamespace(raise_for_status=lambda: None, json=lambda: result)
    monkeypatch.setattr(auth.httpx, 'post', post)
    return result, calls


def test_browser_verification_login_is_private_action_bound_and_one_use(client, cloudflare):
    check = create(client)
    path = '/api/auth/browser-check/' + check['id']
    info = client.get(path)
    assert info.json() == {'action': 'login', 'verified': False}
    assert check['secret'] not in info.text
    assert client.post(path + '/poll', json={'secret': 'x' * 43}).status_code == 403
    proof = 'desktop:' + check['secret']
    with pytest.raises(HTTPException): auth.verify_human(proof, 'login')
    assert client.post(path + '/complete', json={'human_token': 'cloudflare-token'}).status_code == 200
    assert cloudflare[1] == ['cloudflare-token']
    assert client.post(path + '/poll', json={'secret': check['secret']}).json()['verified']
    with pytest.raises(HTTPException): auth.verify_human(proof, 'register')
    result = client.post('/api/auth/login', json={'email': 'admin@example.com', 'password': 'TestPassword', 'human_token': proof})
    assert result.status_code == 200
    assert result.json()['user']['role'] == 'admin'
    assert 'HttpOnly' in result.headers['set-cookie']
    assert client.get('/api/auth/me').json()['user']['email'] == 'admin@example.com'
    with pytest.raises(HTTPException): auth.verify_human(proof, 'login')
    assert client.get(path).status_code == 410


def test_browser_check_rejects_failed_wrong_action_or_host_and_expiry(client, cloudflare):
    result, calls = cloudflare
    check = create(client)
    path = '/api/auth/browser-check/' + check['id']
    for change in ({'success': False}, {'action': 'register'}, {'hostname': 'evil.example'}):
        result.update(success=True, action='login', hostname='localhost')
        result.update(change)
        assert client.post(path + '/complete', json={'human_token': 'invalid'}).status_code == 400
        assert not client.post(path + '/poll', json={'secret': check['secret']}).json()['verified']
    with db.connect() as con:
        con.execute('UPDATE browser_checks SET expires=?', (time.time() - 1,))
    assert client.post(path + '/complete', json={'human_token': 'late'}).status_code == 410
    assert client.post(path + '/poll', json={'secret': check['secret']}).status_code == 410
    assert len(calls) == 3
    with pytest.raises(HTTPException): auth.verify_human('desktop:' + check['secret'], 'login')


def test_browser_register_proof_still_requires_smtp_and_email_code(client, cloudflare, monkeypatch):
    cloudflare[0]['action'] = 'register'
    sent = []
    monkeypatch.setattr(auth, 'send_email', lambda email, code: sent.append((email, code)))
    check = create(client, 'register')
    path = '/api/auth/browser-check/' + check['id']
    assert client.post(path + '/complete', json={'human_token': 'register-token'}).status_code == 200
    body = {'email': 'browser@example.com', 'human_token': 'desktop:' + check['secret']}
    assert client.post('/api/auth/email-code', json=body).status_code == 200
    assert sent[0][0] == body['email']
    assert client.post('/api/auth/email-code', json=body).status_code == 400
    assert client.post('/api/auth/register', json={'username': 'BrowserUser', 'email': body['email'], 'password': 'GoodPassword', 'code': sent[0][1]}).status_code == 201


def test_existing_desktop_proof_cannot_mint_another_proof(client, cloudflare):
    first, second = create(client), create(client)
    assert client.post('/api/auth/browser-check/' + first['id'] + '/complete', json={'human_token': 'valid'}).status_code == 200
    cloudflare[0]['success'] = False
    response = client.post('/api/auth/browser-check/' + second['id'] + '/complete', json={'human_token': 'desktop:' + first['secret']})
    assert response.status_code == 400
    assert cloudflare[1][-1] == 'desktop:' + first['secret']
    auth.verify_human('desktop:' + first['secret'], 'login')


def test_browser_check_cross_origin_and_rate_limit(client):
    assert client.post('/api/auth/browser-check', json={'action': 'login'}, headers={'Origin': 'https://evil.example'}).status_code == 403
    assert client.post('/api/auth/browser-check', json={'action': 'admin'}).status_code == 422
    for _ in range(30): create(client)
    assert client.post('/api/auth/browser-check', json={'action': 'login'}).status_code == 429


def test_login_and_browser_check_html_are_not_cached(client):
    for path in ('/', '/index.html', '/?sakuya_launch=upgrade', '/human-check'):
        response = client.get(path)
        assert response.status_code == 200
        assert response.headers['content-type'].startswith('text/html')
        assert response.headers['cache-control'] == 'no-store'
