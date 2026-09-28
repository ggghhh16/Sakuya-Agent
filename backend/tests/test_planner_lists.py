from app import db, planner, integrations
from test_planner import fake_google, SYNC, update_body


def test_list_order_persists_across_edits_and_rejects_stale_ids(client):
    first = client.get('/api/planner').json()['lists'][0]
    second = client.post('/api/planner/lists', json={'name': 'Second'}).json()
    order = [second['id'], first['id']]
    assert client.put('/api/planner/preferences', json={'list_order': order}).status_code == 200
    client.put('/api/planner/lists/' + second['id'], json={'name': 'Renamed'})
    client.put('/api/planner/preferences', json={'default_calendar_list': first['id']})
    assert [item['id'] for item in client.get('/api/planner').json()['lists']] == order
    for invalid in ([first['id'], first['id']], ['missing']):
        assert client.put('/api/planner/preferences', json={'list_order': invalid}).status_code == 409
    assert client.get('/api/planner').json()['preferences']['list_order'] == order


def test_delete_nonempty_list_is_local_and_cleans_preferences(client):
    listing = client.get('/api/planner').json()['lists'][0]
    other = client.post('/api/planner/lists', json={'name': 'Keep'}).json()
    task = client.post('/api/planner/entries', json={'list_id': listing['id'], 'title': 'Task'}).json()
    event = client.post('/api/planner/entries', json={'list_id': listing['id'], 'title': 'Event', 'kind': 'event',
        'start': '2026-09-28T09:00:00+08:00', 'end': '2026-09-28T10:00:00+08:00'}).json()
    child = client.post('/api/planner/entries', json={'list_id': other['id'], 'title': 'Keep child', 'parent_id': task['id']}).json()
    client.put('/api/planner/preferences', json={'default_calendar_list': listing['id'],
        'list_order': [listing['id'], other['id']], 'manual_order': [task['id'], event['id'], child['id']]})
    assert client.delete('/api/planner/lists/' + listing['id']).status_code == 200
    state = client.get('/api/planner').json()
    assert [item['id'] for item in state['lists']] == [other['id']]
    assert [item['id'] for item in state['entries']] == [child['id']]
    assert state['entries'][0]['parent_id'] == ''
    assert state['preferences']['default_calendar_list'] == ''
    assert state['preferences']['manual_order'] == [child['id']]
    assert state['preferences']['list_order'] == [other['id']]
    assert client.post('/api/planner/entries/' + task['id'] + '/restore').status_code == 409
    assert client.delete('/api/planner/lists/' + other['id']).status_code == 200
    state = client.get('/api/planner').json()
    assert len(state['lists']) == 1 and state['entries'] == []
    assert state['lists'][0]['id'] not in (listing['id'], other['id'])


def test_local_delete_preserves_remote_even_for_moved_entries(client, monkeypatch):
    remote, calls = fake_google(monkeypatch)
    source = client.get('/api/planner').json()['lists'][0]
    db.patch(source['id'], {'google_calendar_id': 'primary'})
    target = client.post('/api/planner/lists', json={'name': 'Local category'}).json()
    event = client.post('/api/planner/entries', json={'list_id': source['id'], 'title': 'Remote event', 'kind': 'event',
        'start': '2026-09-28T09:00:00+08:00', 'end': '2026-09-28T10:00:00+08:00'}).json()
    assert client.post('/api/integrations/sync', json=SYNC).json()['ok']
    event = db.get(event['id'])
    client.put('/api/planner/entries/' + event['id'], json=update_body(event, list_id=target['id']))
    assert client.delete('/api/planner/lists/' + target['id']).status_code == 200
    calls.clear()
    for _ in range(2):
        assert client.post('/api/integrations/sync', json=SYNC).json()['ok']
    assert len(remote) == 1
    assert all(call[1] == 'GET' for call in calls)
    assert client.get('/api/planner').json()['entries'] == []


def test_deleted_bound_lists_are_not_reimported(client, monkeypatch):
    listing = client.get('/api/planner').json()['lists'][0]
    db.patch(listing['id'], {'google_calendar_id': 'primary', 'ticktick_project_id': 'work'})
    assert client.delete('/api/planner/lists/' + listing['id']).status_code == 200
    monkeypatch.setattr(integrations, 'credentials', lambda name: {'access_token': 'test', 'auto_import': True})
    monkeypatch.setattr(integrations, 'collections', lambda name: [{'id': 'primary' if name == 'google' else 'work', 'name': 'Removed'}])
    def unexpected_sync(*args, **kwargs):
        raise AssertionError('Deleted collections must not contact the remote service')
    monkeypatch.setattr(integrations, 'sync_collection', unexpected_sync)
    for automatic in (True, False):
        result = integrations.import_collections(integrations.ImportIn(**SYNC, providers=['google', 'dida'], automatic=automatic))
        assert result['ok'] and result['imported_lists'] == 0
    assert all(item['id'] != listing['id'] for item in planner.snapshot()['lists'])
