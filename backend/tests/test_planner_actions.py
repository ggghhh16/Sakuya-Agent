from urllib.parse import urlparse, parse_qs
from fastapi import Response
from app import db, auth, planner, integrations


def test_default_list_preserved_when_sorting_and_local_task_states(client):
    listing = client.get('/api/planner').json()['lists'][0]['id']
    assert client.put('/api/planner/preferences', json={'default_calendar_list': listing}).status_code == 200
    response = client.put('/api/planner/preferences', json={'sort': 'title', 'manual_order': []})
    assert response.json()['default_calendar_list'] == listing
    parent = client.post('/api/planner/entries', json={'title': 'parent', 'list_id': listing, 'pinned': True}).json()
    child = client.post('/api/planner/entries', json={'title': 'child', 'list_id': listing, 'parent_id': parent['id']}).json()
    body = {key: value for key, value in parent.items() if key in planner.EntryUpdate.model_fields}
    assert client.put('/api/planner/entries/' + parent['id'], json={**body, 'parent_id': child['id']}).status_code == 422
    legacy = {key: value for key, value in body.items() if key not in ('pinned', 'parent_id', 'cancelled', 'is_note')}
    result = client.put('/api/planner/entries/' + parent['id'], json=legacy).json()
    assert result['pinned'] is True
    body = {key: value for key, value in result.items() if key in planner.EntryUpdate.model_fields}
    result = client.put('/api/planner/entries/' + parent['id'], json={**body, 'is_note': True}).json()
    assert result['is_note'] is True
    assert client.put('/api/planner/preferences', json={'default_calendar_list': 'missing'}).status_code == 404


def test_external_browser_callback_uses_state_owner_without_session(client, monkeypatch):
    with db.connect(shared=True) as con:
        con.execute('INSERT INTO users VALUES (?,?,?,?,?)', ('browser-user', 'browser@example.com', auth.password_hash('TestPassword'), 'user', db.now()))
    token = auth.issue_session('browser-user', Response())
    client.cookies.set(auth.COOKIE, token)
    client.put('/api/integrations/google/config', json={'client_id': 'test-client'})
    url = client.post('/api/integrations/google/connect').json()['url']
    state = parse_qs(urlparse(url).query)['state'][0]
    imported = []
    monkeypatch.setattr(integrations, 'token_request', lambda *args: integrations.save('google', {'access_token': 'test-access'}))
    monkeypatch.setattr(integrations, 'import_collections', lambda data: imported.append((db.current_owner(), data.providers)) or {'ok': True, 'errors': []})
    client.cookies.clear()
    assert client.get('/api/planner').status_code == 401
    result = client.get('/api/integrations/google/callback', params={'state': state, 'code': 'test-code'})
    assert result.status_code == 200
    assert imported == [('browser-user', ['google'])]
    assert client.get('/api/integrations/google/callback', params={'state': state, 'code': 'replay'}).status_code == 400
    assert not integrations.credentials('google').get('access_token')
    with db.workspace('browser-user'):
        assert integrations.credentials('google')['auto_import'] is True
        assert integrations.credentials('google')['import_status'] == 'done'


def test_oauth_config_auto_detected_without_exposing_secret(client, monkeypatch):
    monkeypatch.setenv('SAKUYA_DIDA_CLIENT_ID', 'detected-client')
    monkeypatch.setenv('SAKUYA_DIDA_CLIENT_SECRET', 'detected-secret')
    result = client.get('/api/integrations')
    assert result.json()['dida']['configured'] is True
    assert 'detected-secret' not in result.text
    assert client.post('/api/integrations/dida/connect').status_code == 200


def test_google_application_identity_is_shared_but_user_tokens_are_not(client, monkeypatch, tmp_path):
    import json
    config = tmp_path / 'google-client.json'
    config.write_text(json.dumps({'installed': {'client_id': 'sakuya-test.apps.googleusercontent.com', 'client_secret': 'application-test-secret'}}))
    monkeypatch.setenv('SAKUYA_GOOGLE_CLIENT_FILE', str(config))
    result = client.get('/api/integrations')
    assert result.json()['google']['configured'] is True
    assert 'application-test-secret' not in result.text
    assert client.post('/api/integrations/google/connect').status_code == 200
    integrations.save('google', {'access_token': 'admin-test-token'})
    with db.workspace('separate-user'):
        db.ensure_workspace()
        assert integrations.credentials('google')['client_id'] == 'sakuya-test.apps.googleusercontent.com'
        assert not integrations.credentials('google').get('access_token')


def test_missing_google_application_is_not_a_user_credentials_error(client, monkeypatch, tmp_path):
    monkeypatch.setenv('SAKUYA_GOOGLE_CLIENT_FILE', str(tmp_path / 'missing.json'))
    monkeypatch.delenv('SAKUYA_GOOGLE_CLIENT_ID', raising=False)
    result = client.post('/api/integrations/google/connect')
    assert result.status_code == 503
    assert '应用注册' in result.json()['detail']
