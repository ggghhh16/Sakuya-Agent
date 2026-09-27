import json
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.types import Command
from app import db
from app.graph import build
from app.worker import execute, recover_stale


def create_run(client, **overrides):
    data = {'title': '中文检索比较', 'prompt': '比较关键词与向量检索，给出可验证的建议。', 'kind': 'research', 'project_id': 'project_welcome', 'mode': 'demo', **overrides}
    response = client.post('/api/runs', json=data)
    assert response.status_code == 201, response.text
    return response.json()


def test_ticket_to_agent_to_saved_report(client):
    ticket = client.post('/api/tickets', json={'title': '升级后查询为空', 'description': '需要调查模型配置变化', 'project_id': 'project_welcome'}).json()
    run = create_run(client, ticket_id=ticket['id'], kind='diagnosis')
    execute(db.claim())
    finished = client.get('/api/runs/' + run['id']).json()
    assert finished['status'] == 'completed'
    assert '演示模式' in finished['report'] and finished['tokens'] == 0
    assert any(e['stage'] == 'completed' for e in finished['events'])
    saved = client.post('/api/runs/' + run['id'] + '/save').json()
    assert saved['is_demo'] is True
    assert client.post('/api/runs/' + run['id'] + '/save').json()['id'] == saved['id']
    assert db.get(ticket['id'])['status'] == 'open'
    response = client.get('/api/runs/' + run['id'] + '/export')
    assert response.status_code == 200 and 'attachment' in response.headers['content-disposition']


def test_interrupt_survives_new_graph_instance(client):
    run = create_run(client, experiment=True)
    execute(db.claim())
    waiting = db.get(run['id'])
    assert waiting['status'] == 'waiting'
    assert waiting['approval']['script']
    # Reopen persisted checkpoints in a new worker/graph context.
    assert client.post(f'/api/runs/{run["id"]}/resume', json={'decision': 'skip'}).status_code == 200
    execute(db.claim())
    finished = db.get(run['id'])
    assert finished['status'] == 'completed'
    assert '用户跳过实验' in finished['experiment_result']
    assert client.post(f'/api/runs/{run["id"]}/resume', json={'decision': 'approve'}).status_code == 422


def test_cancelled_work_is_not_claimed(client):
    run = create_run(client)
    assert client.post(f'/api/runs/{run["id"]}/cancel').status_code == 200
    assert db.claim() is None
    assert client.post(f'/api/runs/{run["id"]}/retry').status_code == 422


def test_queue_claim_is_atomic(client):
    run = create_run(client)
    with ThreadPoolExecutor(max_workers=4) as pool:
        claims = list(pool.map(lambda _: db.claim(), range(4)))
    assert sum(c is not None for c in claims) == 1
    assert next(c for c in claims if c)['id'] == run['id']


def test_recovery_requeues_only_stale_running_work(client):
    run = create_run(client)
    db.claim()
    recover_stale()
    assert db.get(run['id'])['status'] == 'running'
    db.patch(run['id'], {'heartbeat': '2020-01-01T00:00:00+00:00'})
    recover_stale()
    assert db.get(run['id'])['status'] == 'queued'


def test_real_workflow_uses_adaptive_search_with_mocked_provider(client, monkeypatch):
    from app import providers, settings
    settings.save_config({'api_key': 'test-only', 'base_url': 'https://example.com/v1', 'model': 'test', 'search_key': 'test-only'})
    queries = []
    answers = iter([
        ({'plan': ['检索', '比较', '检查'], 'queries': ['initial']}, 10),
        ({'enough': False, 'queries': ['follow-up'], 'gap': '需要补充'}, 12),
        ({'enough': True, 'queries': [], 'gap': '资料已整理'}, 13),
        ('## 结果\n\n可参考已保存资料 [1]。未运行性能测试。', 20),
    ])
    monkeypatch.setattr(providers, 'model', lambda *a, **k: next(answers))
    def search(q):
        queries.append(q)
        return [{'title': q, 'url': 'https://example.com/' + q, 'content': '测试原文', 'type': 'search_excerpt'}]
    monkeypatch.setattr(providers, 'search', search)
    monkeypatch.setattr(providers, 'fetch_source', lambda _: (_ for _ in ()).throw(ValueError('not allowed')))
    run = create_run(client, mode='live')
    execute(db.claim())
    result = db.get(run['id'])
    assert result['status'] == 'completed'
    assert queries == ['initial', 'follow-up']
    assert result['tokens'] == 55


def test_no_live_run_without_model(client, monkeypatch):
    from app import settings
    monkeypatch.setattr(settings, 'public_config', lambda: {'model_configured': False})
    response = client.post('/api/runs', json={'title': '真实任务', 'prompt': '这是一个需要真实模型的任务', 'kind': 'research', 'project_id': 'project_welcome', 'mode': 'live'})
    assert response.status_code == 422


def test_validation_and_cross_project_links(client):
    assert client.post('/api/projects', json={'name': '另一个项目'}).status_code in (404, 405)
    p = db.put('project', {'name': '历史项目'})
    t = client.post('/api/tickets', json={'title': '不同项目的工单', 'project_id': p['id']}).json()
    response = client.post('/api/runs', json={'title': '错误关联', 'prompt': '这条任务不应该创建成功', 'kind': 'diagnosis', 'project_id': 'project_welcome', 'ticket_id': t['id']})
    assert response.status_code == 422
    assert client.patch('/api/tickets/' + t['id'], json={'status': 'made_up'}).status_code == 422
    assert client.post('/api/documents', json={'title': '错误项目', 'content': 'test', 'project_id': 'missing'}).status_code == 404


def test_cross_site_writes_and_secret_response(client):
    assert client.post('/api/projects', json={'name': 'blocked'}, headers={'Origin': 'https://evil.example'}).status_code == 403
    assert client.post('/api/projects', json={'name': 'blocked'}, headers={'X-Sakuya-Client': ''}).status_code == 403
    config = client.get('/api/settings').json()
    assert not {'api_key', 'search_key', 'github_token'} & config.keys()


def test_source_url_restrictions(monkeypatch):
    from app.providers import validate_url
    import pytest
    for name in ('HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy'):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr('app.providers.getproxies', lambda: {})
    for url in ['http://docs.python.org', 'https://127.0.0.1/', 'https://docs.python.org:8120/', 'https://user:pass@docs.python.org/', 'file:///etc/passwd']:
        with pytest.raises(ValueError):
            validate_url(url)
    monkeypatch.setattr('socket.getaddrinfo', lambda *a, **k: [(2, 1, 6, '', ('127.0.0.1', 443))])
    with pytest.raises(ValueError):
        validate_url('https://docs.python.org')


def test_comments_are_preserved_during_concurrent_updates(client):
    ticket = client.post('/api/tickets', json={'title': '并发记录', 'project_id': 'project_welcome'}).json()
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(lambda i: db.append_comment(ticket['id'], f'记录 {i}'), range(8)))
    assert len(db.get(ticket['id'])['comments']) == 8


def test_chinese_retrieval_finds_relevant_later_section():
    from app.retrieval import retrieve
    doc = {'id': 'doc', 'title': '系统手册', 'content': '账户与界面介绍。' * 500 + '\n\n混合检索重排配置：使用重排模型处理向量检索的候选结果。'}
    hits = retrieve([doc], '如何配置混合检索重排？', limit=1)
    assert '混合检索重排配置' in hits[0]['content']
    assert hits[0]['offset'] > 1000
