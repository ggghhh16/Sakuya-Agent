import pytest
from app import integrations, planner


@pytest.mark.parametrize('provider,remote', [
    ('google', {'start': {'dateTime': '2026-09-28T08:00:00+08:00'}, 'end': {'dateTime': '2026-09-28T00:00:00Z'}}),
    ('google', {'start': {'date': '2026-09-28'}, 'end': {'date': '2026-09-27'}}),
    ('dida', {'startDate': '2026-09-28T08:00:00+08:00', 'dueDate': '2026-09-28T08:00:00+08:00'}),
    ('dida', {'startDate': '2026-09-28T00:00:00+08:00', 'dueDate': '2026-09-26T00:00:00+08:00', 'isAllDay': True}),
    ('ticktick', {'dueDate': '2026-09-28T08:00:00+08:00'}),
])
def test_imported_zero_or_reversed_ranges_are_valid(provider, remote):
    value = integrations.fields(provider, remote)
    planner.EntryIn(list_id='test', kind='event' if provider == 'google' else 'task', **value)


def test_bad_remote_item_does_not_block_valid_items(client, monkeypatch):
    listing = planner.create_list(planner.ListIn(name='Test', ticktick_project_id='p'))
    bad = {'id': 'bad', 'title': 'broken', 'startDate': 'invalid', 'dueDate': 'invalid'}
    good = {'id': 'good', 'title': 'valid task'}
    monkeypatch.setattr(integrations, 'request', lambda *args, **kwargs: {'tasks': [bad, good]})
    errors = integrations.sync_collection('dida', listing, '2026-09-01T00:00:00Z', '2026-12-01T00:00:00Z', pull_only=True)
    assert len(errors) == 1 and errors[0]['id'] == 'bad'
    assert 'validation' not in errors[0]['message']
    assert [entry['title'] for entry in planner.snapshot()['entries']] == ['valid task']
