import json
import pytest
from fastapi.testclient import TestClient
from app import db, maps
from app.main import app
from test_planner import entry, update_body, fake_google, SYNC
from test_user_workspace import user_client
from app.map_resolver import extract_location, match_place, search_queries


def test_campus_classroom_resolves_building_and_keeps_street_number():
    query = '示例大学北校区 · 北教学大楼214室'
    assert search_queries(query) == ['示例大学北校区 教学大楼', '示例大学北校区 教学楼']
    query = '示例大学番禺校区 · 番禺教学大楼214室'
    assert search_queries(query) == ['示例大学番禺校区 教学大楼', '示例大学番禺校区 教学楼']
    place = {**PLACE, 'name': '示例大学番禺校区-教学楼'}
    assert match_place(query, [place]) == (place, 'resolved')
    assert match_place(query, [{**place, 'name': '示例大学番禺校区'}]) == (None, 'not_found')
    assert match_place(query, [{**place, 'name': '示例大学珠海校区-教学楼'}]) == (None, 'not_found')
    assert search_queries('黄埔大道西601号') == ['黄埔大道西601号']


def test_campus_lab_room_code_only_searches_building():
    query = '示例大学番禺校区 · N实DF-107'
    assert search_queries(query) == ['示例大学番禺校区 实验楼', '示例大学番禺校区 实验大楼']
    place = {**PLACE, 'name': '广东省广州市番禺区示例大学番禺校区实验楼'}
    assert match_place(query, [place]) == (place, 'resolved')
    unrelated = {**place, 'name': '示例大学番禺校区-实验动物管理中心'}
    assert match_place(query, [unrelated]) == (None, 'not_found')


def test_building_fallback_preserves_room_and_accepts_missing_poi_id(client, monkeypatch):
    client.put('/api/maps/config', json={'web_key': 'room-test', 'city': '广州'})
    location = '示例大学番禺校区 · 番禺教学大楼214室'
    e = entry(client, location=location, notes='原备注')
    queries = []
    def fetch(url, params):
        queries.append(params['keywords'])
        name = '示例大学番禺校区教学楼' if params['keywords'].endswith('教学楼') else '示例大学番禺校区'
        return json.dumps({'status': '1', 'pois': [{'id': None, 'name': name, 'location': '113.4,23.01'}]}).encode(), 'application/json'
    monkeypatch.setattr(maps, 'amap_get', fetch)
    result = resolve(client, e).json()
    assert result['map_resolution']['status'] == 'resolved'
    assert result['map_place']['name'] == '示例大学番禺校区教学楼'
    assert result['map_place']['poi_id'] == ''
    assert result['location'] == location and result['notes'] == e['notes']
    assert result['title'] == e['title'] and result['revision'] == e['revision']
    assert result['map_place']['location_text'] == location
    assert queries == ['示例大学番禺校区 教学大楼', '示例大学番禺校区 教学楼']


def test_old_negative_cache_is_invalidated_after_resolver_upgrade(client, monkeypatch):
    e = entry(client, location='教学大楼214室')
    db.patch(e['id'], {'map_resolution': {'input': [e['location'], e['title'], e['notes']], 'status': 'not_found', 'config_key': 'previous-version', 'expires': 9999999999}})
    result = resolve(client, e).json()
    assert result['map_resolution']['status'] == 'unconfigured'
    assert result['map_resolution']['config_key'] != 'previous-version'

PLACE = {'name': '教学楼 A 栋', 'address': '广州测试校园', 'lng': 113.35, 'lat': 23.13, 'source': 'manual'}


def resolve(client, e, force=False):
    return client.post(f"/api/maps/entries/{e['id']}/resolve", json={
        'revision': e['revision'], 'map_revision': e.get('map_revision', 0), 'force': force})


@pytest.mark.parametrize('values,expected', [
    ({'location': '暨南大学图书馆', 'title': '在别处开会'}, '暨南大学图书馆'),
    ({'title': '去暨南大学图书馆自习'}, '暨南大学图书馆'),
    ({'title': '在广州国际金融中心开会'}, '广州国际金融中心'),
    ({'title': '暨南大学图书馆 自习'}, '暨南大学图书馆'),
    ({'title': '暨南大学图书馆还书'}, '暨南大学图书馆'),
    ({'title': '讨论方案', 'notes': '准备资料\n地点：广州国际金融中心\n联系人：小王'}, '广州国际金融中心'),
    ({'location': 'https://meeting.example.com/room', 'notes': '地点：广州图书馆'}, ''),
    ({'location': '线上', 'title': '去广州图书馆'}, ''),
    ({'location': '线上会议 ID: 123456', 'title': '去广州图书馆'}, ''),
    ({'location': 'https://meeting.example.com/room 密码：1234'}, ''),
    ({'title': '整理资料', 'notes': '机密备注，无地址'}, ''),
    ({'title': '去图书馆学习'}, ''),
])
def test_extract_only_place_words(values, expected):
    assert extract_location(values) == expected


def test_address_match_and_exact_name_take_precedence_without_guessing():
    place = {**PLACE, 'name': '暨南大学图书馆', 'address': '广东省广州市天河区黄埔大道西601号'}
    assert match_place('黄埔大道西601号', [place]) == (place, 'resolved')
    annex = {**place, 'name': '暨南大学图书馆北门', 'lng': 113.36}
    assert match_place(place['name'], [annex, place]) == (place, 'resolved')
    # The same campus address is not enough to choose between its buildings.
    assert match_place('黄埔大道西601号', [annex, place]) == (None, 'ambiguous')


def test_auto_place_saved_cached_and_title_change_invalidates(client, monkeypatch):
    client.put('/api/maps/config', json={'web_key': 'test-key', 'city': '广州'})
    calls = []
    def lookup(q, city):
        calls.append((q, city))
        return {'places': [{**PLACE, 'name': q, 'source': 'search'}]}
    monkeypatch.setattr(maps, 'search', lookup)
    e = entry(client, title='去暨南大学图书馆自习', notes='私人内容不发送')
    db.patch(e['id'], {'read_only': True, 'sync_state': 'synced'})
    result = resolve(client, e)
    assert result.status_code == 200
    e = result.json()
    assert e['map_place']['name'] == '暨南大学图书馆'
    assert e['map_resolution']['status'] == 'resolved'
    assert e['revision'] == 1 and e['sync_state'] == 'synced'
    assert calls == [('暨南大学图书馆', '广州')]
    assert resolve(client, e).json()['map_revision'] == e['map_revision']
    assert len(calls) == 1
    # db.patch covers local updates, remote imports and conflict resolution.
    e = db.patch(e['id'], {'title': '去广州国际金融中心开会'})
    assert e['map_place'] is None
    updated = resolve(client, e).json()
    assert updated['map_place']['name'] == '广州国际金融中心'
    assert len(calls) == 2


def test_auto_place_ambiguity_retry_and_manual_override(client, monkeypatch):
    client.put('/api/maps/config', json={'web_key': 'test-key'})
    calls = []
    def lookup(**kwargs):
        calls.append(kwargs)
        return {'places': [{**PLACE, 'name': '时代大厦'}, {**PLACE, 'name': '时代大厦', 'lng': 114}]}
    monkeypatch.setattr(maps, 'search', lookup)
    e = resolve(client, entry(client, location='时代大厦')).json()
    assert e['map_place'] is None and e['map_resolution']['status'] == 'ambiguous'
    assert resolve(client, e).status_code == 200 and len(calls) == 1
    e = resolve(client, e, force=True).json()
    assert len(calls) == 2
    e = bind(client, e).json()
    assert resolve(client, e, force=True).json()['map_place']['name'] == PLACE['name']
    assert len(calls) == 2


def test_auto_place_missing_config_empty_unrelated_and_provider_error(client, monkeypatch):
    e = resolve(client, entry(client, location='暨南大学图书馆')).json()
    assert e['map_resolution']['status'] == 'unconfigured'
    client.put('/api/maps/config', json={'web_key': 'test-key'})
    monkeypatch.setattr(maps, 'search', lambda **kwargs: {'places': [PLACE]})
    e = resolve(client, e).json()
    assert e['map_resolution']['status'] == 'not_found'
    assert e['map_place'] is None
    no_place = resolve(client, entry(client, title='整理资料')).json()
    assert no_place['map_resolution']['status'] == 'no_location'
    def fail(**kwargs):
        raise maps.HTTPException(502, '地图服务暂时不可用，请稍后重试')
    monkeypatch.setattr(maps, 'search', fail)
    e = resolve(client, e, force=True).json()
    assert e['map_resolution']['status'] == 'error' and e['map_place'] is None


@pytest.mark.parametrize('change', ['address', 'manual', 'delete', 'config'])
def test_auto_place_rejects_late_result(client, monkeypatch, change):
    client.put('/api/maps/config', json={'web_key': 'test-key'})
    e = entry(client, location=PLACE['name'])
    def lookup(**kwargs):
        if change == 'address':
            db.patch(e['id'], {'location': '新的地址'})
        elif change == 'manual':
            bind(client, e)
        elif change == 'delete':
            db.patch(e['id'], {'deleted': True})
        else:
            client.put('/api/maps/config', json={'city': '珠海'})
        return {'places': [PLACE]}
    monkeypatch.setattr(maps, 'search', lookup)
    assert resolve(client, e).status_code == (404 if change == 'delete' else 409)


def test_auto_place_account_isolation_and_authentication(client):
    _, alice = user_client('resolve-alice@example.com')
    _, bob = user_client('resolve-bob@example.com')
    e = entry(alice, location=PLACE['name'])
    assert resolve(bob, e).status_code == 404
    with TestClient(app, headers={'X-Sakuya-Client': 'workspace'}) as anonymous:
        assert resolve(anonymous, e).status_code == 401


def bind(client, e, place=PLACE):
    return client.put(f"/api/maps/entries/{e['id']}/place", json={
        'revision': e['revision'], 'map_revision': e.get('map_revision', 0), 'place': place})


def test_place_is_local_and_survives_normal_edit_but_not_address_change(client):
    e = entry(client, location='A 栋')
    db.patch(e['id'], {'sync_state': 'synced', 'read_only': True})
    result = bind(client, e)
    assert result.status_code == 200
    e = result.json()
    assert e['revision'] == 1 and e['sync_state'] == 'synced'
    assert e['map_place']['location_text'] == 'A 栋'
    assert bind(client, {**e, 'map_revision': 0}).status_code == 409
    db.patch(e['id'], {'read_only': False})
    e = client.put(f"/api/planner/entries/{e['id']}", json=update_body(e, title='改标题')).json()
    assert e['map_place']['lng'] == PLACE['lng']
    changed = client.put(f"/api/planner/entries/{e['id']}", json=update_body(e, location='B 栋')).json()
    assert changed['map_place'] is None
    assert changed['map_revision'] == 2
    assert bind(client, e).status_code == 409
    assert client.get('/api/maps/places').json()[0]['name'] == PLACE['name']


def test_google_remote_address_change_invalidates_building(client, monkeypatch):
    remote, _ = fake_google(monkeypatch)
    e = entry(client, location='A 栋', kind='event', start='2026-09-28T09:00:00+08:00', end='2026-09-28T10:00:00+08:00')
    db.patch(e['list_id'], {'google_calendar_id': 'test-calendar'})
    assert client.post('/api/integrations/sync', json=SYNC).json()['ok']
    e = db.get(e['id']); assert bind(client, e).status_code == 200
    rid = e['remote']['google']['id']
    remote[rid].update(location='B 栋', etag='new-version')
    assert client.post('/api/integrations/sync', json=SYNC).json()['ok']
    assert db.get(e['id'])['map_place'] is None
    assert db.get(e['id'])['location'] == 'B 栋'


@pytest.mark.parametrize('changes', [{'lng': 181}, {'lat': -91}, {'coord_system': 'WGS-84'}, {'name': ''}, {'provider': 'other'}])
def test_bad_coordinates_rejected(client, changes):
    assert bind(client, entry(client), {**PLACE, **changes}).status_code == 422


def test_removed_place_and_deleted_entry(client):
    e = bind(client, entry(client)).json()
    assert bind(client, e, None).json()['map_place'] is None
    client.delete(f"/api/planner/entries/{e['id']}?revision={e['revision']}")
    assert bind(client, e).status_code == 404


def test_config_and_locations_are_account_local_and_secrets_not_returned(client, monkeypatch):
    monkeypatch.setenv('AMAP_WEB_KEY', 'admin-environment-secret')
    _, alice = user_client('map-alice@example.com')
    _, bob = user_client('map-bob@example.com')
    assert not alice.get('/api/maps/config').json()['search_configured']
    result = alice.put('/api/maps/config', json={'js_key': 'public-js-test', 'web_key': 'private-web-test', 'security_code': 'private-code-test', 'city': '广州'})
    assert result.json()['configured']
    assert 'private-web-test' not in result.text and 'private-code-test' not in result.text
    assert alice.put('/api/maps/config', json={'city': '珠海'}).json()['search_configured']
    e = bind(alice, entry(alice)).json()
    assert not bob.get('/api/maps/config').json()['configured']
    assert bob.get('/api/maps/places').json() == []
    assert bind(bob, e).status_code == 404
    assert 'private-web-test' not in alice.get('/api/workspace').text
    with TestClient(app) as anon:
        assert anon.get('/api/maps/config').status_code == 401
        assert anon.get('/api/maps/search?q=school').status_code == 401
        assert anon.get('/api/maps/_AMapService/v4/map/styles').status_code == 401


def test_search_uses_only_location_query_and_handles_provider_errors(client, monkeypatch):
    client.put('/api/maps/config', json={'web_key': 'search-test-key', 'city': '广州'})
    calls = []
    def fetch(url, params):
        calls.append((url, params))
        return json.dumps({'status': '1', 'pois': [
            {'name': 'A 栋', 'id': 'test-poi', 'location': '113.35,23.13', 'address': '校园东侧'},
            {'name': 'bad', 'location': 'NaN,20'}, {'name': 'null', 'location': None}, {'name': 'missing'}]}).encode(), 'application/json'
    monkeypatch.setattr(maps, 'amap_get', fetch)
    response = client.get('/api/maps/search', params={'q': '教学楼'})
    assert response.status_code == 200 and len(response.json()['places']) == 1
    assert calls[0][1]['region'] == '广州' and calls[0][1]['city_limit'] == 'true'
    assert calls[0][1]['keywords'] == '教学楼'
    assert response.json()['places'][0]['coord_system'] == 'GCJ-02'
    monkeypatch.setattr(maps, 'amap_get', lambda *a: (b'{"status":"0","info":"search-test-key"}', 'application/json'))
    result = client.get('/api/maps/search?q=school')
    assert result.status_code == 502 and 'search-test-key' not in result.text


@pytest.mark.parametrize('prefix', ['/api/maps/_AMapService', '/_AMapService'])
def test_sdk_proxy_is_restricted_and_overrides_client_credentials(client, monkeypatch, prefix):
    client.put('/api/maps/config', json={'js_key': 'public-js-test', 'security_code': 'private-code-test'})
    calls = []
    monkeypatch.setattr(maps, 'amap_get', lambda u, p: (calls.append((u, p)) or b'{}', 'application/json'))
    response = client.get(prefix + '/v4/map/styles?key=attacker&jscode=attacker')
    assert response.status_code == 200 and response.headers['cache-control'] == 'no-store'
    assert calls[0][1]['jscode'] == 'private-code-test' and calls[0][1]['key'] == 'public-js-test'
    result = client.get(prefix + '/v3/log/init?callback=jsonp_test')
    assert result.status_code == 200
    assert result.headers['content-type'].startswith('application/javascript')
    assert calls[1][0] == 'https://restapi.amap.com/v3/log/init'
    assert calls[1][1]['callback'] == 'jsonp_test'
    assert calls[1][1]['jscode'] == 'private-code-test'
    assert client.get(prefix + '/v3/log/init', params={'callback': 'alert(1)//'}).status_code == 400
    assert client.get(prefix + '/v3/place/text').status_code == 404
    assert client.get(prefix + '/https://example.com').status_code == 404


def test_root_sdk_proxy_requires_login_and_keeps_account_credentials_separate(client, monkeypatch):
    _, alice = user_client('root-map-alice@example.com')
    _, bob = user_client('root-map-bob@example.com')
    alice.put('/api/maps/config', json={'js_key': 'alice-js', 'security_code': 'alice-secret'})
    bob.put('/api/maps/config', json={'js_key': 'bob-js', 'security_code': 'bob-secret'})
    calls = []
    monkeypatch.setattr(maps, 'amap_get', lambda u, p: (calls.append(p) or b'{}', 'application/json'))
    with TestClient(app) as anonymous:
        response = anonymous.get('/_AMapService/v3/log/init')
        assert response.status_code == 401 and response.headers['cache-control'] == 'no-store'
    assert not calls
    assert alice.get('/_AMapService/v3/log/init').status_code == 200
    assert bob.get('/_AMapService/v3/log/init').status_code == 200
    assert [p['jscode'] for p in calls] == ['alice-secret', 'bob-secret']


@pytest.mark.parametrize('path', ['/_AMapService/v3/log/init?callback=external', '/api/maps/_AMapService/v4/map/styles', '/api/maps/search?q=building', '/api/maps/config'])
def test_maps_reject_cross_site_subresource_requests_without_origin(client, path):
    assert client.get(path, headers={'sec-fetch-site': 'cross-site'}).status_code == 403


def test_list_map_mode_is_opt_in_and_preserved_by_legacy_updates(client):
    listing = client.post('/api/planner/lists', json={'name': 'Map list'}).json()
    assert listing['map_enabled'] is False
    result = client.put(f"/api/planner/lists/{listing['id']}", json={'name': listing['name'], 'map_enabled': True})
    assert result.json()['map_enabled'] is True
    result = client.put(f"/api/planner/lists/{listing['id']}", json={'name': 'Renamed'})
    assert result.json()['map_enabled'] is True
    result = client.put(f"/api/planner/lists/{listing['id']}", json={'name': 'Renamed', 'map_enabled': False})
    assert result.json()['map_enabled'] is False


def test_device_coordinate_proxy_is_fixed_and_validated(client, monkeypatch):
    client.put('/api/maps/config', json={'js_key':'public-js-test','security_code':'private-code-test'})
    calls=[]
    monkeypatch.setattr(maps,'amap_get',lambda url,params:(calls.append((url,params)) or b'jsonp_test({"status":"1","locations":"116.406,39.903"})','application/octet-stream'))
    query={'locations':'116.4,39.9','coordsys':'gps','callback':'jsonp_test','key':'untrusted'}
    result=client.get('/api/maps/_AMapService/v3/assistant/coordinate/convert',params=query)
    assert result.status_code == 200
    assert result.headers['content-type'].startswith('application/javascript')
    assert calls[0][0] == 'https://restapi.amap.com/v3/assistant/coordinate/convert'
    assert calls[0][1]['key'] == 'public-js-test' and calls[0][1]['jscode'] == 'private-code-test'
    for value in ('NaN,20','181,20','116,91','116,39;117,40','not-coordinates'):
        assert client.get('/api/maps/_AMapService/v3/assistant/coordinate/convert',params={**query,'locations':value}).status_code == 400
    assert len(calls) == 1
