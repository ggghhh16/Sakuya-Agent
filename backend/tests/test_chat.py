from concurrent.futures import ThreadPoolExecutor
from app import db, providers, settings
from app.worker import execute


def test_chat_persists_turns_and_excludes_them_from_work(client):
    first = client.post('/api/chat', json={'prompt': '你好'}).json()
    cid = first['conversation']['id']
    blocked = client.post('/api/chat', json={'prompt': '同时发送', 'conversation_id': cid})
    assert blocked.status_code == 422
    execute(db.claim())
    second = client.post('/api/chat', json={'prompt': '继续聊天', 'conversation_id': cid}).json()
    assert second['run']['history'][0] == {'role': 'user', 'content': '你好'}
    execute(db.claim())
    workspace = client.get('/api/workspace').json()
    assert len(workspace['conversations']) == 1
    assert len(workspace['chats']) == 2
    assert all(r['kind'] != 'chat' for r in workspace['runs'])
    assert '保留 1 轮' in db.get(second['run']['id'])['report']


def test_real_chat_sends_history_to_model_and_keeps_chats_isolated(client, monkeypatch):
    settings.save_config({'api_key': 'test-only-key', 'model': 'test-model', 'base_url': 'https://example.com/v1'})
    requests = []
    def model(messages, **kwargs):
        requests.append(messages)
        return '记住了，这是模型回复。', 12
    monkeypatch.setattr(providers, 'model', model)
    first = client.post('/api/chat', json={'prompt': '项目名是 Sakuya', 'mode': 'live'}).json()
    execute(db.claim())
    second = client.post('/api/chat', json={'prompt': '项目叫什么？', 'mode': 'live', 'conversation_id': first['conversation']['id']}).json()
    execute(db.claim())
    assert requests[1][1:3] == [
        {'role': 'user', 'content': '项目名是 Sakuya'},
        {'role': 'assistant', 'content': '记住了，这是模型回复。'},
    ]
    assert db.get(second['run']['id'])['tokens'] == 12
    client.post('/api/chat', json={'prompt': '独立对话', 'mode': 'live'})
    execute(db.claim())
    assert len(requests[2]) == 2


def test_chat_cancel_during_provider_call_does_not_publish_reply(client, monkeypatch):
    settings.save_config({'api_key': 'test-only-key', 'model': 'test-model', 'base_url': 'https://example.com/v1'})
    turn = client.post('/api/chat', json={'prompt': '测试取消', 'mode': 'live'}).json()['run']
    def model(messages, **kwargs):
        db.transition_run(turn['id'], {'running'}, {'status': 'cancelled'})
        return '这条回复不应保存', 12
    monkeypatch.setattr(providers, 'model', model)
    execute(db.claim())
    assert db.get(turn['id'])['status'] == 'cancelled'
    assert db.get(turn['id'])['report'] == ''


def test_chat_queue_is_atomic_and_stale_retry_rejected(client):
    first = db.queue_chat('第一轮', None, 'demo')
    execute(db.claim())
    cid = first['conversation']['id']
    def enqueue(_):
        try:
            return db.queue_chat('第二轮', cid, 'demo')
        except ValueError:
            return None
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(enqueue, range(4)))
    assert sum(r is not None for r in results) == 1
    run = next(r for r in results if r)['run']
    db.transition_run(run['id'], {'queued'}, {'status': 'failed'})
    db.queue_chat('第三轮', cid, 'demo')
    assert client.post(f'/api/runs/{run["id"]}/retry').status_code == 422


def test_chat_validation_and_missing_provider(client, monkeypatch):
    monkeypatch.setattr(settings, 'public_config', lambda: {'model_configured': False})
    assert client.post('/api/chat', json={'prompt': '真实请求', 'mode': 'live'}).status_code == 422
    assert client.post('/api/chat', json={'prompt': '  '}).status_code == 422
    assert client.post('/api/chat', json={'prompt': '你好', 'conversation_id': 'missing'}).status_code == 404


def test_conversation_rename_and_order_survive_new_messages_and_init(client):
    a = db.queue_chat('旧对话', None, 'demo')['conversation']
    b = db.queue_chat('新对话', None, 'demo')['conversation']
    assert [c['id'] for c in db.conversations()] == [b['id'], a['id']]
    response = client.put('/api/conversations/order', json={'ids': [a['id'], b['id']]})
    assert response.status_code == 200
    assert client.patch(f'/api/conversations/{b["id"]}', json={'title': '  自定义名称  '}).json()['title'] == '自定义名称'
    assert client.patch(f'/api/conversations/{b["id"]}', json={'title': '  '}).status_code == 422
    execute(db.claim())
    execute(db.claim())
    db.queue_chat('继续', b['id'], 'demo')
    db.init()
    assert [c['id'] for c in db.conversations()] == [a['id'], b['id']]
    assert db.get(b['id'])['title'] == '自定义名称'
    assert client.put('/api/conversations/order', json={'ids': [a['id'], a['id']]}).status_code == 422
    assert client.put('/api/conversations/order', json={'ids': ['missing']}).status_code == 422


def test_delete_cancels_running_chat_hides_messages_and_supports_undo(client, monkeypatch):
    settings.save_config({'api_key': 'test-only-key', 'model': 'test-model', 'base_url': 'https://example.com/v1'})
    created = client.post('/api/chat', json={'prompt': '删除测试', 'mode': 'live'}).json()
    cid, rid = created['conversation']['id'], created['run']['id']
    def model(messages, **kwargs):
        assert client.delete(f'/api/conversations/{cid}').status_code == 200
        return '删除之后不能发布的回复', 10
    monkeypatch.setattr(providers, 'model', model)
    execute(db.claim())
    assert db.get(rid)['status'] == 'cancelled'
    assert db.get(rid)['report'] == ''
    workspace = client.get('/api/workspace').json()
    assert workspace['conversations'] == [] and workspace['chats'] == []
    assert client.post('/api/chat', json={'prompt': '新消息', 'conversation_id': cid}).status_code == 422
    assert client.patch(f'/api/conversations/{cid}', json={'title': '改名'}).status_code == 422
    assert client.post(f'/api/conversations/{cid}/restore').status_code == 200
    assert len(client.get('/api/workspace').json()['chats']) == 1
    assert db.get(rid)['status'] == 'cancelled'


def test_order_preserves_concurrently_created_chats_and_migrates_legacy(client):
    legacy = db.put('conversation', {'title': '旧版本对话'})
    db.init()
    assert isinstance(db.get(legacy['id'])['position'], int)
    a = db.queue_chat('A', None, 'demo')['conversation']
    b = db.queue_chat('B', None, 'demo')['conversation']
    assert client.put('/api/conversations/order', json={'ids': [legacy['id'], a['id']]}).status_code == 200
    assert [c['id'] for c in db.conversations()] == [b['id'], legacy['id'], a['id']]
    client.delete(f'/api/conversations/{a["id"]}')
    assert client.put('/api/conversations/order', json={'ids': [a['id']]}).status_code == 422
