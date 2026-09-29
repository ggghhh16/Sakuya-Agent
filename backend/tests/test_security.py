import asyncio
import json

import httpx
import pytest
from app import db, integrations, providers, settings
from app.security import MAX_BODY, RequestSafetyMiddleware, safe_error


def test_legacy_destination_change_requires_new_secret(client, monkeypatch):
    monkeypatch.setenv('MODEL_API_KEY', 'synthetic-env-secret')
    monkeypatch.setenv('MODEL_BASE_URL', 'https://old.example/v1')
    body = {'base_url': 'https://other.example/v1', 'model': 'test'}
    assert client.put('/api/settings', json=body).status_code == 422
    settings.save_config({'api_key': 'synthetic-saved-secret', 'base_url': 'https://old.example/v1'})
    assert client.put('/api/settings', json=body).status_code == 422
    assert settings.config()['base_url'] == 'https://old.example/v1'
    assert client.put('/api/settings', json={**body, 'api_key': 'synthetic-new-secret'}).status_code == 200
    assert settings.config()['api_key'] == 'synthetic-new-secret'


def test_validation_does_not_echo_passwords_or_keys(client):
    secret = 'sensitive-input-must-not-appear'
    result = client.post('/api/auth/register', json={'email': 'x@example.com', 'password': secret, 'code': '123456'})
    assert result.status_code == 422 and secret not in result.text
    result = client.post('/api/settings/providers', json={'name': 'test', 'base_url': 'https://example.com', 'api_key': {'secret': secret}})
    assert result.status_code == 422 and secret not in result.text
    assert all('input' not in e and 'ctx' not in e for e in result.json()['detail'])


def test_errors_redact_full_secrets_before_truncating(client, monkeypatch):
    secret = 'synthetic-boundary-secret-value'
    settings.save_config({'api_key': secret})
    message = safe_error(ValueError('x' * 1490 + secret))
    assert secret[:10] not in message
    integrations.save('google', {'access_token': 'synthetic-oauth-token'})
    monkeypatch.setenv('SMTP_PASSWORD', 'synthetic-mail-password')
    assert 'synthetic-' not in safe_error(ValueError('synthetic-oauth-token synthetic-mail-password'))
    db.put('map_secret', {'id': 'amap_config', 'web_key': 'synthetic-map-key', 'security_code': 'synthetic-map-security'})
    assert 'synthetic-' not in safe_error(ValueError('synthetic-map-key synthetic-map-security'))


@pytest.mark.parametrize('length', [None, b'1', str(MAX_BODY + 1).encode()])
def test_actual_body_limit_precedes_parsing(length):
    async def exercise():
        called, responses = [], []
        async def endpoint(scope, receive, send):
            called.append(True)
        parts = iter([{'type': 'http.request', 'body': b'x' * 600000, 'more_body': True},
                      {'type': 'http.request', 'body': b'y' * 500000, 'more_body': False}])
        async def receive():
            return next(parts)
        async def send(message):
            responses.append(message)
        scope = {'type': 'http', 'method': 'POST', 'path': '/api/chat',
                 'headers': [(b'content-length', length)] if length else []}
        await RequestSafetyMiddleware(endpoint)(scope, receive, send)
        assert not called and responses[0]['status'] == 413
    asyncio.run(exercise())


def test_security_headers_cover_errors_and_pages(client):
    for result in (client.get('/'), client.get('/api/missing'), client.post('/api/chat', json={})):
        assert result.headers['x-frame-options'] == 'DENY'
        assert result.headers['permissions-policy'] == 'camera=(), microphone=(), geolocation=(self)'
        assert "frame-ancestors 'none'" in result.headers['content-security-policy']
        policy = result.headers['content-security-policy']
        scripts = next(d for d in policy.split(';') if d.strip().startswith('script-src')).split()
        assert scripts == ['script-src', "'self'", "'unsafe-eval'", 'https://challenges.cloudflare.com', 'https://webapi.amap.com', 'https://a.amap.com', 'https://restapi.amap.com', 'https://jsapi-service.amap.com']
        assert "'unsafe-inline'" not in scripts
        assert "worker-src 'self' blob:;" in policy
    assert client.get('/api/auth/me').headers['cache-control'] == 'no-store'


def test_fetch_pins_dns_and_keeps_tls_hostname(monkeypatch):
    monkeypatch.setattr(providers, 'getproxies', lambda: {})
    lookups = []
    def resolve(*args, **kwargs):
        lookups.append(args)
        return [(2, 1, 6, '', ('93.184.216.34' if len(lookups) == 1 else '127.0.0.1', 443))]
    monkeypatch.setattr(providers.socket, 'getaddrinfo', resolve)
    original = httpx.Client
    def handle(request):
        assert request.url.host == '93.184.216.34'
        assert request.headers['host'] == 'docs.python.org'
        assert request.extensions['sni_hostname'] == 'docs.python.org'
        return httpx.Response(200, text='public document', headers={'content-type': 'text/plain'})
    def client(**kwargs):
        assert kwargs['trust_env'] is False and kwargs['proxy'] is None
        return original(transport=httpx.MockTransport(handle))
    monkeypatch.setattr(providers.httpx, 'Client', client)
    assert providers.fetch_source('https://docs.python.org/test')['url'] == 'https://docs.python.org/test'
    assert len(lookups) == 1


def test_redirects_revalidate_destination(monkeypatch):
    monkeypatch.setattr(providers, 'getproxies', lambda: {})
    monkeypatch.setattr(providers.socket, 'getaddrinfo', lambda *a, **k: [(2, 1, 6, '', ('93.184.216.34', 443))])
    original = httpx.Client
    monkeypatch.setattr(providers.httpx, 'Client', lambda **kw: original(transport=httpx.MockTransport(
        lambda request: httpx.Response(302, headers={'location': 'https://127.0.0.1/private'}))))
    with pytest.raises(ValueError):
        providers.fetch_source('https://docs.python.org/test')


def test_proxy_validation_and_transport_use_same_proxy(monkeypatch):
    proxy = 'http://127.0.0.1:9999'
    monkeypatch.setattr(providers, 'getproxies', lambda: {'https': proxy})
    monkeypatch.setattr(providers, 'proxy_bypass', lambda host: False)
    assert providers.source_destination('https://docs.python.org/test') == ('https://docs.python.org/test', proxy, {})


def test_provider_migration_removes_obsolete_secret_copy(client):
    settings.save_config({'api_key': 'synthetic-legacy-secret', 'model': 'old', 'base_url': 'https://example.com/v1'})
    providers_list, models, default = settings.catalog()
    settings.save_config({'providers': providers_list, 'models': models, 'default_model_id': default})
    assert 'api_key' not in settings.read_saved()
    assert settings.catalog()[0][0]['api_key'] == 'synthetic-legacy-secret'
    client.delete('/api/settings/providers/legacy')
    assert 'synthetic-legacy-secret' not in settings.config_path().read_text('utf-8')


def test_private_storage_permissions(tmp_path):
    import os
    import subprocess
    from app.private_storage import protect
    folder = tmp_path / 'private'
    folder.mkdir()
    protect(folder)
    child = folder / 'secret.txt'
    child.write_text('synthetic-test-data')
    if os.name == 'nt':
        command = "$ErrorActionPreference='Stop'; $a=[System.IO.File]::GetAccessControl($env:SAKUYA_ACL_TEST); $a.Access | ForEach-Object { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value }"
        result = subprocess.check_output(['powershell.exe', '-NoProfile', '-Command', command],
                                         env={**os.environ, 'SAKUYA_ACL_TEST': str(child)}, text=True)
        for broad in ('S-1-5-11', 'S-1-5-32-545', 'S-1-1-0'):
            assert broad not in result.splitlines()
        assert len(result.splitlines()) == 3
    else:
        assert folder.stat().st_mode & 0o777 == 0o700


def test_event_stream_rechecks_session_after_start(client, monkeypatch):
    from app import auth
    run = client.post('/api/chat', json={'prompt': 'private-stream', 'mode': 'demo'}).json()['run']
    db.event(run['id'], 'test', 'private event body')
    original = auth.current_user
    calls = []
    def revoked_on_stream(request):
        calls.append(True)
        return original(request) if len(calls) == 1 else None
    monkeypatch.setattr(auth, 'current_user', revoked_on_stream)
    result = client.get('/api/runs/' + run['id'] + '/events')
    assert result.status_code == 200 and result.text == ''
    assert len(calls) == 2
