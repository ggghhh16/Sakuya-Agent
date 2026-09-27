from test_accounts_models import add_provider
import httpx
from app import model_settings


def test_context_capacity_is_optional_editable_and_validated(client):
    provider, model = add_provider(client, 'capacity', 'capacity-model', True)
    body = {'provider_id': provider, 'name': 'capacity-model', 'reasoning': True, 'context_window': 200000}
    result = client.post('/api/settings/models', json=body)
    assert result.status_code == 200
    selected = next(m for m in result.json()['models'] if m['id'] == model)
    assert selected['context_window'] == 200000
    assert result.json()['default_model_id'] == model
    for invalid in (0, -1, 1023, 10000001):
        assert client.post('/api/settings/models', json=body | {'context_window': invalid}).status_code == 422
    assert client.get('/api/settings').json()['models'][0]['context_window'] == 200000
    assert client.post('/api/settings/models', json=body | {'context_window': None}).json()['models'][0]['context_window'] is None


def test_discovery_returns_only_valid_context_metadata(client, monkeypatch):
    provider, _ = add_provider(client, 'metadata', 'test', False)
    original = httpx.Client
    items = [{'id': 'small', 'context_length': 32768}, {'id': 'large', 'context_window': 200000},
             {'id': 'output-only', 'max_output_tokens': 8192}, {'id': 'invalid', 'context_length': True},
             {'id': 'invalid2', 'context_length': -1}, {'id': 'unknown'}, None]
    monkeypatch.setattr(model_settings.httpx, 'Client', lambda **kwargs: original(transport=httpx.MockTransport(
        lambda request: httpx.Response(200, json={'data': items}))))
    response = client.get(f'/api/settings/providers/{provider}/models')
    assert response.status_code == 200
    assert response.json()['context_windows'] == {'small': 32768, 'large': 200000}
    assert response.json()['models'] == ['invalid', 'invalid2', 'large', 'output-only', 'small', 'unknown']


def test_planner_assistant_is_validated_and_persisted(client):
    response = client.post('/api/chat', json={'prompt': '安排任务', 'assistant': 'planner', 'approval_mode': 'ask'})
    assert response.status_code == 201
    run = response.json()['run']
    assert run['assistant'] == 'planner' and run['planner_tools'] is True
    assert run['approval_mode'] == 'ask'
    assert client.post('/api/chat', json={'prompt': 'bad', 'assistant': 'arbitrary'}).status_code == 422
