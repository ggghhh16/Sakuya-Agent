import json
import httpx
import pytest
from app import db, providers, settings
from app.worker import execute
from stream_fakes import model_response


def test_stream_is_persisted_before_completion_and_replayed_by_sse(client, monkeypatch):
    settings.save_config({'api_key': 'test', 'model': 'model', 'base_url': 'https://example.com/v1'})
    run = client.post('/api/chat', json={'prompt': '流式测试', 'mode': 'live'}).json()['run']
    seen = []
    class Stream(httpx.SyncByteStream):
        def __iter__(self):
            yield b'data: {"choices":[{"delta":{"content":"first"}}]}\n\n'
            partial = db.get(run['id'])
            seen.append((partial['status'], partial['partial_report'], partial['report']))
            yield b'data: {"choices":[{"delta":{"content":" second"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
    original = httpx.Client
    def handle(request):
        assert json.loads(request.content)['stream'] is True
        return httpx.Response(200, stream=Stream())
    monkeypatch.setattr(providers.httpx, 'Client', lambda **kwargs: original(transport=httpx.MockTransport(handle)))
    execute(db.claim())
    assert seen == [('running', 'first', '')]
    assert db.get(run['id'])['report'] == 'first second'
    response = client.get(f"/api/runs/{run['id']}/events")
    assert 'event: reply' in response.text and 'first second' in response.text


def test_stream_parser_assembles_tools_and_hides_reasoning():
    message = {'content': '你好', 'reasoning_content': 'private reasoning', 'tool_calls': [{'id': 'call-1', 'function': {'name': 'planner_read', 'arguments': '{"day":"今天"}'}}]}
    deltas = []
    with httpx.Client(transport=httpx.MockTransport(lambda req: model_response(message, 7))) as client:
        result, tokens = providers.stream_completion(client, 'https://example.com', {}, {}, deltas.append)
    assert ''.join(deltas) == '你好'
    assert result['reasoning_content'] == 'private reasoning'
    assert result['tool_calls'][0]['function'] == message['tool_calls'][0]['function']
    assert tokens == 7


def test_stream_disconnect_is_not_success():
    with httpx.Client(transport=httpx.MockTransport(lambda req: httpx.Response(200, content='data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'))) as client:
        with pytest.raises(ValueError, match='中断'):
            providers.stream_completion(client, 'https://example.com', {}, {}, lambda text: None)


def test_stream_cancel_stops_before_more_tokens(client, monkeypatch):
    from app.chat_stream import ReplyStream
    run = db.queue_chat('cancel', None, 'demo')['run']
    db.claim()
    stream = ReplyStream(run['id'])
    stream('first')
    db.transition_run(run['id'], {'running'}, {'status': 'cancelled'})
    with pytest.raises(InterruptedError):
        stream('second')
    assert db.get(run['id'])['partial_report'] == 'first'
    assert db.get(run['id'])['report'] == ''
