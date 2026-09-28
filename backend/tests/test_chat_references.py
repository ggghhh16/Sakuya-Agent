from app import db, providers, settings, planner
from app.worker import execute
from test_user_workspace import user_client


def test_full_reference_reaches_model_and_history_as_immutable_snapshot(client, monkeypatch):
    listing = client.get('/api/planner').json()['lists'][0]
    entry = client.post('/api/planner/entries', json={'list_id': listing['id'], 'title': 'Reference', 'notes': 'Long note ' + 'x' * 5000, 'location': 'Room 42', 'tags': ['important']}).json()
    settings.save_config({'api_key': 'test', 'model': 'test', 'base_url': 'https://example.com/v1'})
    seen = []
    def model(messages, **kwargs):
        seen.append(messages)
        return 'Reply', 5
    monkeypatch.setattr(providers, 'model', model)
    response = client.post('/api/chat', json={'prompt': 'Analyze this', 'mode': 'live', 'reference_ids': [entry['id'], entry['id']]}).json()
    assert len(response['run']['references']) == 1
    assert response['run']['prompt'] == 'Analyze this'
    execute(db.claim())
    assert entry['notes'] in seen[0][-1]['content'] and 'Room 42' in seen[0][-1]['content']
    db.patch(entry['id'], {'notes': 'Changed later'})
    client.post('/api/chat', json={'prompt': 'Continue', 'mode': 'live', 'conversation_id': response['conversation']['id']})
    execute(db.claim())
    assert entry['notes'] in seen[1][1]['content']
    saved = next(turn for turn in client.get('/api/workspace').json()['chats'] if turn['id'] == response['run']['id'])
    assert saved['references'][0]['entry']['notes'] == entry['notes']


def test_reference_requires_ownership_and_live_entry(client):
    listing = client.get('/api/planner').json()['lists'][0]
    entry = client.post('/api/planner/entries', json={'list_id': listing['id'], 'title': 'Private'}).json()
    _, other = user_client('references@example.com')
    assert other.post('/api/chat', json={'prompt': 'read', 'reference_ids': [entry['id']]}).status_code == 404
    assert client.post('/api/chat', json={'prompt': 'read', 'reference_ids': ['missing']}).status_code == 404
    assert client.post('/api/chat', json={'prompt': 'read', 'reference_ids': ['x'] * 31}).status_code == 422
    client.delete(f"/api/planner/entries/{entry['id']}?revision=1")
    assert client.post('/api/chat', json={'prompt': 'read', 'reference_ids': [entry['id']]}).status_code == 404


def test_task_default_is_independent_and_cleared_on_deletion(client):
    a = planner.create_list(planner.ListIn(name='Tasks'))
    b = planner.create_list(planner.ListIn(name='Calendar'))
    response = client.put('/api/planner/preferences', json={'default_task_list': a['id'], 'default_calendar_list': b['id']})
    assert response.status_code == 200
    client.delete('/api/planner/lists/' + a['id'])
    preferences = client.get('/api/planner').json()['preferences']
    assert preferences['default_task_list'] == '' and preferences['default_calendar_list'] == b['id']
