import copy
from urllib.parse import urlparse, parse_qs
from app import db, planner, integrations


def entry(client, **overrides):
    listing = client.get('/api/planner').json()['lists'][0]
    data = {'title': '学习项目', 'list_id': listing['id'], **overrides}
    response = client.post('/api/planner/entries', json=data)
    assert response.status_code == 201, response.text
    return response.json()


def update_body(e, **changes):
    return {k: v for k, v in {**e, **changes}.items() if k in planner.EntryUpdate.model_fields}


def test_planner_crud_conflict_delete_restore(client):
    e = entry(client)
    assert client.delete('/api/planner/lists/' + e['list_id']).status_code == 409
    changed = client.put('/api/planner/entries/' + e['id'], json=update_body(e, completed=True))
    assert changed.status_code == 200
    assert client.put('/api/planner/entries/' + e['id'], json=update_body(e)).status_code == 409
    assert client.delete(f"/api/planner/entries/{e['id']}?revision=1").status_code == 409
    assert client.delete(f"/api/planner/entries/{e['id']}?revision=2").status_code == 200
    assert client.get('/api/planner').json()['entries'] == []
    assert client.post(f"/api/planner/entries/{e['id']}/restore").status_code == 200
    assert client.get('/api/planner').json()['entries'][0]['completed'] is True


def test_dates_require_timezone_positive_duration_and_pairs(client):
    listing = client.get('/api/planner').json()['lists'][0]['id']
    for data in [dict(start='2026-09-27T09:00:00'), dict(start='2026-09-27T09:00:00', end='2026-09-27T10:00:00'), dict(start='2026-09-27T10:00:00+08:00', end='2026-09-27T09:00:00+08:00'), dict(kind='event')]:
        assert client.post('/api/planner/entries', json={'title': '无效日期', 'list_id': listing, **data}).status_code == 422
    e = entry(client, start='2026-09-27T09:05:00+08:00', end='2026-09-27T09:10:00+08:00')
    assert e['start'].endswith('+08:00')
    entry(client, start='2026-09-27', end='2026-09-28', all_day=True)


def test_binding_regions_isolated_and_duplicate_blocked(client):
    for region in ('dida', 'ticktick'):
        assert client.post('/api/planner/lists', json={'name': region, 'ticktick_region': region, 'ticktick_project_id': 'same-id'}).status_code == 201
    assert client.post('/api/planner/lists', json={'name': 'duplicate', 'ticktick_project_id': 'same-id', 'ticktick_region': 'dida'}).status_code == 409


def test_oauth_state_pkce_and_redacted_credentials(client, monkeypatch):
    for name in ('google', 'dida', 'ticktick'):
        r = client.put(f'/api/integrations/{name}/config', json={'client_id': 'test-client', 'client_secret': 'test-secret'})
        assert r.status_code == 200
        url = client.post(f'/api/integrations/{name}/connect').json()['url']
        params = parse_qs(urlparse(url).query)
        assert params['state'][0]
        assert client.get(f'/api/integrations/{name}/callback?state=wrong&code=x').status_code == 400
        if name == 'google':
            assert params['code_challenge_method'] == ['S256']
        calls = []
        monkeypatch.setattr(integrations, 'token_request', lambda n, data: calls.append((n, data)))
        callback = f"/api/integrations/{name}/callback?state={params['state'][0]}&code=test-code"
        assert client.get(callback).status_code == 200
        assert calls[0][0] == name
        assert client.get(callback).status_code == 400  # single use
    for path in ('/api/integrations', '/api/workspace', '/api/planner'):
        assert 'test-secret' not in client.get(path).text


def test_mcp_lifecycle_and_validated_write(client):
    def rpc(method, params=None):
        return client.post('/api/mcp/planner', json={'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params or {}}).json()
    assert rpc('initialize')['result']['capabilities']['tools'] == {'listChanged': False}
    assert len(rpc('tools/list')['result']['tools']) >= 7
    assert rpc('tools/call', {'name': 'planner_create_entry', 'arguments': {'title': 'bad'}})['result']['isError']
    listing = client.get('/api/planner').json()['lists'][0]
    result = rpc('tools/call', {'name': 'planner_create_entry', 'arguments': {'title': 'MCP task', 'list_id': listing['id']}})
    assert result['result']['isError'] is False
    assert client.get('/api/planner').json()['entries'][0]['title'] == 'MCP task'
    assert client.post('/api/mcp/planner', headers={'Origin': 'https://evil.example'}, json={'jsonrpc':'2.0','id':1,'method':'tools/list'}).status_code == 403


def fake_google(monkeypatch):
    remote, calls = {}, []
    def request(name, method, path, **kwargs):
        calls.append((name, method, path, kwargs))
        assert name == 'google'
        identifier = path.split('/')[-1]
        if method == 'GET' and path.endswith('/events'):
            return {'items': copy.deepcopy(list(remote.values()))}
        if method == 'GET':
            if identifier not in remote:
                raise integrations.RemoteError(404, 'not found')
            return copy.deepcopy(remote[identifier])
        if method == 'POST':
            item = {**kwargs['json'], 'etag': 'v1'}; remote[item['id']] = item
            return copy.deepcopy(item)
        if method == 'PATCH':
            assert kwargs['headers']['If-Match'] == remote[identifier]['etag']
            remote[identifier] = {**remote[identifier], **kwargs['json'], 'etag': remote[identifier]['etag'] + 'x'}
            return copy.deepcopy(remote[identifier])
        if method == 'DELETE':
            del remote[identifier]; return {}
        raise AssertionError((method,path))
    monkeypatch.setattr(integrations, 'request', request)
    return remote, calls


SYNC = {'start': '2026-09-01T00:00:00+08:00', 'end': '2026-11-01T00:00:00+08:00'}


def test_google_roundtrip_conflict_retry_delete_no_duplicates(client, monkeypatch):
    remote, calls = fake_google(monkeypatch)
    e = entry(client, kind='event', start='2026-09-27T09:00:00+08:00', end='2026-09-27T10:00:00+08:00')
    db.patch(e['list_id'], {'google_calendar_id': 'work@example.com'})
    assert client.post('/api/integrations/sync', json=SYNC).json()['ok']
    assert len(remote) == 1
    assert client.post('/api/integrations/sync', json=SYNC).json()['ok']
    assert sum(c[1] == 'POST' for c in calls) == 1
    e = db.get(e['id']); rid = e['remote']['google']['id']
    # Independent remote edit, import it.
    remote[rid].update(summary='远程修改', etag='v2')
    client.post('/api/integrations/sync', json=SYNC)
    e = db.get(e['id']); assert e['title'] == '远程修改'
    client.put('/api/planner/entries/' + e['id'], json=update_body(e, title='本地修改'))
    remote[rid].update(summary='同时远程修改', etag='v3')
    assert not client.post('/api/integrations/sync', json=SYNC).json()['ok']
    assert db.get(e['id'])['sync_state'] == 'conflict'
    assert remote[rid]['summary'] == '同时远程修改'
    assert client.post(f"/api/integrations/resolve/{e['id']}/google", json={'keep':'local'}).status_code == 200
    assert client.post('/api/integrations/sync', json=SYNC).json()['ok']
    assert remote[rid]['summary'] == '本地修改'
    e = db.get(e['id'])
    client.delete(f"/api/planner/entries/{e['id']}?revision={e['revision']}")
    assert client.post('/api/integrations/sync', json=SYNC).json()['ok']
    assert not remote
    assert client.post(f"/api/planner/entries/{e['id']}/restore").status_code == 409


def test_google_external_deletion_removes_clean_local_event(client, monkeypatch):
    remote, _ = fake_google(monkeypatch)
    e = entry(client, kind='event', start='2026-09-27T09:00:00+08:00', end='2026-09-27T10:00:00+08:00')
    db.patch(e['list_id'], {'google_calendar_id': 'primary'})
    client.post('/api/integrations/sync', json=SYNC)
    remote.clear()
    client.post('/api/integrations/sync', json=SYNC)
    assert db.get(e['id'])['deleted']


def test_google_deleted_conflict_keep_local_uses_new_remote_id(client, monkeypatch):
    remote, _ = fake_google(monkeypatch)
    e = entry(client, kind='event', start='2026-09-27T09:00:00+08:00', end='2026-09-27T10:00:00+08:00')
    db.patch(e['list_id'], {'google_calendar_id':'primary'})
    client.post('/api/integrations/sync', json=SYNC)
    e = db.get(e['id']); old_id = e['remote']['google']['id']
    client.put('/api/planner/entries/' + e['id'], json=update_body(e,title='保留这个修改'))
    remote.clear()
    assert not client.post('/api/integrations/sync', json=SYNC).json()['ok']
    assert client.post(f"/api/integrations/resolve/{e['id']}/google", json={'keep':'local'}).status_code == 200
    assert client.post('/api/integrations/sync', json=SYNC).json()['ok']
    assert len(remote) == 1 and old_id not in remote
    assert next(iter(remote.values()))['summary'] == '保留这个修改'


def test_pagination_and_all_day_exclusive_end(monkeypatch):
    calls = []
    def request(name, method, path, **kwargs):
        calls.append(dict(kwargs['params']))
        return {'items':[{'id':'a'}], 'nextPageToken':'second'} if len(calls) == 1 else {'items':[{'id':'b'}]}
    monkeypatch.setattr(integrations, 'request', request)
    assert len(integrations.paged('/users/me/calendarList')) == 2
    assert calls[1]['pageToken'] == 'second'
    e = integrations.fields('dida', {'title':'全天','startDate':'2026-09-27T00:00:00+0000','dueDate':'2026-09-27T00:00:00+0000','isAllDay':True})
    assert e['start'] == '2026-09-27' and e['end'] == '2026-09-28'


def test_ticktick_region_batch_idempotence_completion_and_failure(client, monkeypatch):
    tasks, calls = {}, []
    def request(name, method, path, **kwargs):
        calls.append((name, method, path))
        assert name == 'ticktick'
        if path.endswith('/data'):
            return {'tasks': copy.deepcopy([v for v in tasks.values() if v.get('status') != 2])}
        if path == '/task/batch':
            task = kwargs['json']['add'][0]
            if task['id'] in tasks:
                return {'id2error': {task['id']: 'EXISTED'}}
            tasks[task['id']] = {**task, 'status': 0}
            return {'id2etag': {task['id']: 'v1'}}
        if path.endswith('/complete'):
            tasks[path.split('/')[-2]]['status'] = 2
            return {}
        identifier = path.split('/')[-1]
        if method == 'GET':
            return copy.deepcopy(tasks[identifier])
        if method == 'POST':
            tasks[identifier].update(kwargs['json'])
            return copy.deepcopy(tasks[identifier])
        raise AssertionError((method,path))
    monkeypatch.setattr(integrations, 'request', request)
    e = entry(client, completed=True)
    db.patch(e['list_id'], {'ticktick_region': 'ticktick', 'ticktick_project_id': 'project'})
    assert client.post('/api/integrations/sync', json=SYNC).json()['ok']
    assert len(tasks) == 1 and next(iter(tasks.values()))['status'] == 2
    assert client.post('/api/integrations/sync', json=SYNC).json()['ok']
    assert sum(path == '/task/batch' for _,_,path in calls) == 1
    assert 'ticktick' in db.get(e['id'])['remote'] and 'dida' not in db.get(e['id'])['remote']
    assert db.get(e['id'])['sync_state'] == 'synced'
    # The documented API has no reopen operation. Never pretend it succeeded.
    e = db.get(e['id']); client.put('/api/planner/entries/' + e['id'], json=update_body(e, completed=False))
    assert not client.post('/api/integrations/sync', json=SYNC).json()['ok']
    assert next(iter(tasks.values()))['status'] == 2


def test_chat_calls_real_mcp_dispatch_and_resumes_without_duplicate_write(client, monkeypatch):
    import httpx
    from app import planner_mcp, settings
    planner.snapshot()
    run = db.queue_chat('创建一个任务', None, 'live', True, 'Asia/Singapore')['run']
    db.patch(run['id'], {'status':'running'})
    monkeypatch.setattr(settings, 'config', lambda: {'base_url':'https://model.example/v1','api_key':'private','model':'test'})
    attempts = []
    class Stub:
        def __init__(self, **kwargs):
            self.local = 'base_url' in kwargs
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def post(self, url, **kwargs):
            if self.local:
                return client.post(url, **kwargs)
            messages = kwargs['json']['messages']
            attempts.append(copy.deepcopy(messages))
            if len(attempts) == 1:
                message = {'role':'assistant','content':None,'reasoning_content':'tool reasoning', 'tool_calls':[{'id':'call_1','type':'function','function':{'name':'planner_create_entry','arguments':'{"title":"MCP created","list_id":"todo_inbox"}'}}]}
                return httpx.Response(200,json={'choices':[{'message':message}],'usage':{'total_tokens':5}})
            if len(attempts) == 2:
                return httpx.Response(503)
            assert any(m.get('reasoning_content') == 'tool reasoning' for m in messages)
            assert messages[-1]['role'] == 'tool'
            return httpx.Response(200,json={'choices':[{'message':{'role':'assistant','content':'任务已创建'}}],'usage':{'total_tokens':5}})
    monkeypatch.setattr(httpx, 'Client', Stub)
    import pytest
    with pytest.raises(ValueError, match='503'):
        planner_mcp.chat([{'role':'user','content':'创建任务'}], run['id'])
    assert len(planner.snapshot()['entries']) == 1
    text, tokens = planner_mcp.chat([{'role':'user','content':'创建任务'}], run['id'])
    assert text == '任务已创建' and tokens == 10
    assert len(planner.snapshot()['entries']) == 1
    assert db.get(run['id'])['tool_log'][0]['name'] == 'planner_create_entry'
