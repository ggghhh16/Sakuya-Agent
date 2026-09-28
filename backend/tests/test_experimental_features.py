from fastapi import Response
from app import auth, db, settings


def test_diagnosis_requires_experimental_setting_and_preserves_history(client):
    payload = {'title': '实验诊断', 'prompt': '调查这个演示问题', 'kind': 'diagnosis', 'mode': 'demo'}
    assert client.get('/api/settings').json()['experimental_features'] is False
    assert client.post('/api/runs', json=payload).status_code == 403
    assert client.put('/api/settings/experimental', json={'enabled': 'false'}).status_code == 422
    assert client.put('/api/settings/experimental', json={'enabled': True}).json()['experimental_features'] is True
    created = client.post('/api/runs', json=payload)
    assert created.status_code == 201
    identifier = created.json()['id']
    assert client.get('/api/runs/' + identifier).status_code == 200
    assert client.put('/api/settings/experimental', json={'enabled': False}).json()['experimental_features'] is False
    assert settings.read_saved()['experimental_features'] is False
    assert identifier not in {r['id'] for r in client.get('/api/workspace').json()['runs']}
    for suffix in ['', '/events', '/export']:
        assert client.get('/api/runs/' + identifier + suffix).status_code == 403
    for suffix in ['/retry', '/resume', '/save']:
        assert client.post('/api/runs/' + identifier + suffix, json={'decision': 'approve'}).status_code == 403
    assert client.post('/api/runs', json=payload | {'kind': 'research'}).status_code == 201
    client.put('/api/settings/experimental', json={'enabled': True})
    assert client.get('/api/runs/' + identifier).json()['title'] == payload['title']


def test_experimental_setting_is_workspace_scoped(client):
    client.put('/api/settings/experimental', json={'enabled': True})
    with db.connect() as con:
        con.execute('INSERT INTO users VALUES (?,?,?,?,?)', ('experiment-user', 'experiment@example.com', auth.password_hash('TestPassword'), 'user', db.now()))
    client.cookies.clear()
    client.cookies.set(auth.COOKIE, auth.issue_session('experiment-user', Response()))
    assert client.get('/api/settings').json()['experimental_features'] is False
    client.put('/api/settings/experimental', json={'enabled': True})
    client.put('/api/settings/experimental', json={'enabled': False})
    assert settings.read_saved()['experimental_features'] is True
