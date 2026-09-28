import threading
from concurrent.futures import ThreadPoolExecutor
import httpx
import pytest
from fastapi import BackgroundTasks, HTTPException
from app import db, integrations, planner, providers
from test_planner import entry, update_body, fake_google, SYNC


def test_read_only_list_blocks_api_and_mcp_writes(client):
    task = entry(client)
    readonly = client.post('/api/planner/lists', json={'name': 'Read only'}).json()
    db.patch(readonly['id'], {'read_only': True})
    assert client.post('/api/planner/entries', json={'title': 'Blocked', 'list_id': readonly['id']}).status_code == 403
    assert client.put('/api/planner/entries/' + task['id'], json=update_body(task, list_id=readonly['id'])).status_code == 403
    result = client.post('/api/mcp/planner', json={'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call', 'params': {
        'name': 'planner_create_entry', 'arguments': {'title': 'Blocked', 'list_id': readonly['id']}}}).json()
    assert result['result']['isError']
    # Permissions may change after import, including after local categorization.
    db.patch(task['id'], {'sync_list_id': readonly['id'], 'remote': {'google': {'id': 'remote'}}})
    assert client.put('/api/planner/entries/' + task['id'], json=update_body(task)).status_code == 403
    assert client.delete(f"/api/planner/entries/{task['id']}?revision=1").status_code == 403
    assert client.post(f"/api/integrations/resolve/{task['id']}/google", json={'keep': 'local'}).status_code == 403
    db.patch(task['id'], {'deleted': True})
    assert client.post(f"/api/planner/entries/{task['id']}/restore").status_code == 403


def test_read_only_sync_pulls_without_pushing_pending_edits(client, monkeypatch):
    remote, calls = fake_google(monkeypatch)
    task = entry(client, start='2026-09-27T09:00:00+08:00', end='2026-09-27T10:00:00+08:00')
    listing = db.patch(task['list_id'], {'google_calendar_id': 'readonly', 'read_only': True})
    remote['remote'] = {'id': 'remote', 'summary': 'Remote', 'etag': 'v1', 'start': {'date': '2026-09-28'}, 'end': {'date': '2026-09-29'}}
    assert integrations.sync_collection('google', listing, **SYNC) == []
    assert calls and all(call[1] == 'GET' for call in calls)
    imported = next(e for e in db.all_items('planner_entry') if e['title'] == 'Remote')
    assert imported['read_only'] is True


def test_oauth_pending_credentials_cleared_on_cancel_reconfigure_disconnect(client):
    for action in ('cancel', 'configure', 'disconnect'):
        integrations.save('google', {'client_id': 'synthetic-client', 'client_secret': 'synthetic-secret'})
        integrations.authorize('google')
        state = integrations.credentials('google')['oauth_state']
        if action == 'cancel':
            integrations.callback('google', BackgroundTasks(), state=state, error='access_denied')
        elif action == 'configure':
            integrations.configure('google', integrations.ConfigIn(client_id='replacement'))
        else:
            integrations.disconnect('google')
        value = integrations.credentials('google')
        assert not value['oauth_state'] and not value['verifier'] and not value['state_expires']
        with pytest.raises(HTTPException):
            integrations.callback('google', BackgroundTasks(), state=state, code='old-code')


def test_disconnect_cannot_be_undone_by_inflight_token_refresh(client, monkeypatch):
    integrations.save('google', {'client_id': 'synthetic-client', 'refresh_token': 'old-token'})
    started, release, disconnect_started = threading.Event(), threading.Event(), threading.Event()
    original = httpx.Client
    def exchange(request):
        started.set()
        assert release.wait(5)
        return httpx.Response(200, json={'access_token': 'new-token', 'refresh_token': 'new-refresh'})
    monkeypatch.setattr(integrations.httpx, 'Client', lambda **kwargs: original(transport=httpx.MockTransport(exchange)))
    def disconnect():
        disconnect_started.set()
        return integrations.disconnect('google')
    with ThreadPoolExecutor(max_workers=2) as pool:
        refresh = pool.submit(integrations.token_request, 'google', {'grant_type': 'refresh_token', 'refresh_token': 'old-token'})
        assert started.wait(5)
        revoke = pool.submit(disconnect)
        assert disconnect_started.wait(5)
        release.set()
        refresh.result(timeout=5)
        revoke.result(timeout=5)
    value = integrations.credentials('google')
    assert value['access_token'] == value['refresh_token'] == ''
    assert value['auto_import'] is False


class Chunks(httpx.SyncByteStream):
    def __init__(self, chunks):
        self.chunks = chunks
    def __iter__(self):
        yield from self.chunks


@pytest.mark.parametrize('chunks', [[b'x' * 65], [b':' + b'a' * 30 + b'\n'] * 4])
def test_stream_limits_unterminated_lines_and_total_bytes(monkeypatch, chunks):
    monkeypatch.setattr(providers, 'MAX_STREAM_LINE_BYTES', 64)
    monkeypatch.setattr(providers, 'MAX_STREAM_BYTES', 100)
    response = httpx.Response(200, stream=Chunks(chunks))
    with pytest.raises(ValueError, match='上限'):
        list(providers.bounded_stream_lines(response))


def test_stream_preserves_utf8_across_chunks_and_checks_deadline(monkeypatch):
    encoded = 'data: 你好\n'.encode()
    assert list(providers.bounded_stream_lines(httpx.Response(200, stream=Chunks([encoded[:7], encoded[7:]])))) == ['data: 你好']
    times = iter([0, 301])
    monkeypatch.setattr(providers.time, 'monotonic', lambda: next(times))
    with pytest.raises(ValueError, match='上限'):
        list(providers.bounded_stream_lines(httpx.Response(200, stream=Chunks([b':ping\n']))))


def test_stream_rejects_unbounded_tool_indices():
    response = httpx.Response(200, content=b'data: {"choices":[{"delta":{"tool_calls":[{"index":999999}]}}]}\n')
    with httpx.Client(transport=httpx.MockTransport(lambda request: response)) as client:
        with pytest.raises(ValueError, match='工具调用'):
            providers.stream_completion(client, 'https://example.com', {}, {}, lambda text: None)
