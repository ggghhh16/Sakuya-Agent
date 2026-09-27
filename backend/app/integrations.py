"""OAuth and documented Calendar / Dida / TickTick Open API adapters.

Credentials remain backend-only. Synchronization is explicit, serialized and
uses remote versions to refuse overwriting independently edited content.
"""
import base64
import hashlib
import json
import os
import secrets
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import quote, urlencode
import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import Field
from . import db, planner
from .security import safe_error

router = APIRouter(prefix='/api/integrations')
PROVIDERS = {
    'google': {'auth': 'https://accounts.google.com/o/oauth2/v2/auth', 'token': 'https://oauth2.googleapis.com/token', 'api': 'https://www.googleapis.com/calendar/v3', 'scope': 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly'},
    'dida': {'auth': 'https://dida365.com/oauth/authorize', 'token': 'https://dida365.com/oauth/token', 'api': 'https://api.dida365.com/open/v1', 'scope': 'tasks:read tasks:write'},
    'ticktick': {'auth': 'https://ticktick.com/oauth/authorize', 'token': 'https://ticktick.com/oauth/token', 'api': 'https://api.ticktick.com/open/v1', 'scope': 'tasks:read tasks:write'},
}


def provider(name):
    if name not in PROVIDERS:
        raise HTTPException(404, '未知连接')
    return PROVIDERS[name]


def credentials(name):
    provider(name)
    return db.get('integration_' + name, 'integration_secret') or {}


def save(name, changes):
    old = credentials(name)
    if old:
        return db.patch(old['id'], changes)
    return db.put('integration_secret', {'id': 'integration_' + name, **changes})


def redirect(name):
    return f"http://127.0.0.1:{os.getenv('SAKUYA_PORT', '8120')}/api/integrations/{name}/callback"


@router.get('')
def status():
    return {name: {'configured': bool(credentials(name).get('client_id')), 'connected': bool(credentials(name).get('access_token')), 'redirect_uri': redirect(name), 'client_id': credentials(name).get('client_id', ''), 'secret_set': bool(credentials(name).get('client_secret'))} for name in PROVIDERS}


class ConfigIn(planner.Strict):
    client_id: str = Field(min_length=1, max_length=1000)
    client_secret: str = Field(default='', max_length=2000)


class PersonalTokenIn(planner.Strict):
    token: str = Field(min_length=8, max_length=4000)


@router.put('/{name}/personal-token')
def personal_token(name: str, data: PersonalTokenIn):
    if name not in ('dida', 'ticktick'):
        raise ValueError('Google 日历请使用 OAuth 授权')
    try:
        with httpx.Client(timeout=25) as client:
            response = client.get(provider(name)['api'] + '/project', headers={'Authorization': 'Bearer ' + data.token})
        if response.status_code != 200:
            raise ValueError(f'Token 验证失败（HTTP {response.status_code}），请检查账号版本和权限')
    except httpx.HTTPError:
        raise ValueError('连接失败，Token 尚未保存') from None
    save(name, {'access_token': data.token, 'refresh_token': '', 'expires_at': 0, 'auth_type': 'personal'})
    return status()[name]


@router.put('/{name}/config')
def configure(name: str, data: ConfigIn):
    old = credentials(name)
    if old.get('access_token') and old.get('client_id') != data.client_id:
        raise HTTPException(409, '请先断开连接再更换 OAuth 应用')
    changes = {'client_id': data.client_id}
    if data.client_secret:
        changes['client_secret'] = data.client_secret
    save(name, changes)
    return status()[name]


@router.post('/{name}/connect')
def authorize(name: str):
    p, c = provider(name), credentials(name)
    if not c.get('client_id') or (name != 'google' and not c.get('client_secret')):
        raise HTTPException(422, '请先填写 OAuth Client ID 和 Client Secret')
    state, verifier = secrets.token_urlsafe(32), secrets.token_urlsafe(64)
    save(name, {'oauth_state': state, 'verifier': verifier, 'state_expires': time.time() + 600})
    query = {'client_id': c['client_id'], 'redirect_uri': redirect(name), 'response_type': 'code', 'scope': p['scope'], 'state': state}
    if name == 'google':
        query.update(access_type='offline', prompt='consent', code_challenge=base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('='), code_challenge_method='S256')
    return {'url': p['auth'] + '?' + urlencode(query)}


def token_request(name, data):
    c = credentials(name)
    kwargs = {'data': data}
    if name != 'google':
        kwargs['auth'] = (c['client_id'], c['client_secret'])
    else:
        data.update(client_id=c['client_id'], client_secret=c.get('client_secret', ''))
    try:
        with httpx.Client(timeout=25) as client:
            r = client.post(provider(name)['token'], **kwargs)
        if r.status_code >= 400:
            raise ValueError(f'授权服务返回 HTTP {r.status_code}，请检查凭据、回调地址或重新连接')
        value = r.json()
        if not value.get('access_token'):
            raise ValueError('授权服务没有返回访问令牌')
        save(name, {'access_token': value['access_token'], 'refresh_token': value.get('refresh_token', c.get('refresh_token', '')), 'expires_at': time.time() + value.get('expires_in', 3600)})
    except httpx.HTTPError:
        raise ValueError('授权服务连接失败，请检查网络后重试') from None


@router.get('/{name}/callback', response_class=HTMLResponse)
def callback(name: str, state: str = '', code: str = '', error: str = ''):
    with planner.lock:
        c = credentials(name)
        if not state or not secrets.compare_digest(state, c.get('oauth_state', '')) or time.time() > c.get('state_expires', 0):
            raise HTTPException(400, '授权请求已失效，请从应用重新发起连接')
        save(name, {'oauth_state': '', 'state_expires': 0})
        if error or not code:
            return '<meta charset="utf-8"><p>授权已取消，请返回 Sakuya。</p>'
        payload = {'code': code, 'grant_type': 'authorization_code', 'redirect_uri': redirect(name)}
        if name == 'google':
            payload['code_verifier'] = c['verifier']
        else:
            payload['scope'] = provider(name)['scope']
        token_request(name, payload)
    return '<meta charset="utf-8"><style>body{background:#111315;color:#e2e4e7;font:18px system-ui;padding:60px}</style><h1>连接成功</h1><p>请返回 Sakuya，关闭此页面即可。</p>'


@router.delete('/{name}/connection')
def disconnect(name: str):
    save(name, {'access_token': '', 'refresh_token': '', 'oauth_state': '', 'expires_at': 0})
    return {'ok': True}


def request(name, method, path, **kwargs):
    c = credentials(name)
    if not c.get('access_token'):
        raise ValueError(f'{name} 尚未连接，请在规划视图的连接设置中授权')
    if c.get('expires_at', 0) < time.time() + 60 and c.get('refresh_token'):
        token_request(name, {'grant_type': 'refresh_token', 'refresh_token': c['refresh_token']})
        c = credentials(name)
    headers = {'Authorization': 'Bearer ' + c['access_token'], **kwargs.pop('headers', {})}
    try:
        with httpx.Client(timeout=25) as client:
            r = client.request(method, provider(name)['api'] + path, headers=headers, **kwargs)
    except httpx.HTTPError:
        raise ValueError(f'{name} 网络请求失败，操作结果未确认；请重试同步进行核对') from None
    if r.status_code == 401:
        raise ValueError(f'{name} 授权已失效，请重新连接')
    if r.status_code == 412:
        raise ValueError('远程内容已修改，请先处理同步冲突')
    if r.status_code >= 400:
        raise RemoteError(r.status_code, f'{name} 返回 HTTP {r.status_code}，请检查权限或连接设置')
    return r.json() if r.content else {}


class RemoteError(ValueError):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def paged(path, params=None):
    result, params = [], dict(params or {})
    for _ in range(100):
        value = request('google', 'GET', path, params=params)
        result.extend(value.get('items', []))
        if not value.get('nextPageToken'):
            return result
        params['pageToken'] = value['nextPageToken']
    raise ValueError('日历数据超过本次同步上限，请缩小时间范围')


@router.get('/{name}/collections')
def collections(name: str):
    if name == 'google':
        return [{'id': c['id'], 'name': c.get('summary', '未命名日历'), 'read_only': c.get('accessRole') not in ('owner', 'writer')} for c in paged('/users/me/calendarList')]
    return [{'id': p['id'], 'name': p['name'], 'read_only': p.get('permission') == 'read'} for p in request(name, 'GET', '/project')]


def gpath(calendar, event=''):
    return '/calendars/' + quote(calendar, safe='') + '/events' + ('/' + quote(event, safe='') if event else '')


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def task_version(t):
    return digest({k: t.get(k) for k in ('title', 'content', 'startDate', 'dueDate', 'isAllDay', 'status', 'priority')})


def fields(name, remote):
    if name == 'google':
        return {'title': remote.get('summary') or '未命名日程', 'notes': remote.get('description', ''), 'start': remote['start'].get('dateTime', remote['start'].get('date')), 'end': remote['end'].get('dateTime', remote['end'].get('date')), 'all_day': 'date' in remote['start'], 'location': remote.get('location', '')}
    start, end = remote.get('startDate'), remote.get('dueDate')
    if start and not end:
        end = (datetime.fromisoformat(start) + timedelta(minutes=30)).isoformat()
    if end and not start:
        start = (datetime.fromisoformat(end) - timedelta(minutes=30)).isoformat()
    if start and remote.get('isAllDay'):
        start = start[:10]
        end = (date_from(end[:10]) + timedelta(days=1)).isoformat()
    elif start and datetime.fromisoformat(end) <= datetime.fromisoformat(start):
        # Deadline-only tasks still need a visible, editable block on the grid.
        end = (datetime.fromisoformat(start) + timedelta(minutes=5)).isoformat()
    return {'title': remote.get('title') or '未命名任务', 'notes': remote.get('content', ''), 'start': start, 'end': end, 'all_day': bool(remote.get('isAllDay', False)), 'completed': remote.get('status') == 2, 'priority': {0: 'none', 1: 'low', 3: 'medium', 5: 'high'}.get(remote.get('priority'), 'none')}


def date_from(value):
    from datetime import date
    return date.fromisoformat(value)


def payload(name, entry, target):
    if name == 'google':
        key = 'date' if entry['all_day'] else 'dateTime'
        return {'summary': entry['title'], 'description': entry['notes'], 'location': entry.get('location', ''), 'start': {key: entry['start']}, 'end': {key: entry['end']}}
    start, end = entry['start'], entry['end']
    if start and entry['all_day']:
        start += 'T00:00:00+0000'
        end = (date_from(end) - timedelta(days=1)).isoformat() + 'T00:00:00+0000'
    def fmt(v):
        return datetime.fromisoformat(v).strftime('%Y-%m-%dT%H:%M:%S%z') if v else None
    return {'title': entry['title'], 'content': entry['notes'], 'projectId': target, 'startDate': fmt(start), 'dueDate': fmt(end), 'isAllDay': entry['all_day'], 'priority': {'none': 0, 'low': 1, 'medium': 3, 'high': 5}[entry['priority']]}


def sync_collection(name, listing, start, end):
    target = listing['google_calendar_id'] if name == 'google' else listing['ticktick_project_id']
    entries = [e for e in db.all_items('planner_entry') if e['list_id'] == listing['id']]
    if name == 'google':
        remote_items = paged(gpath(target), {'timeMin': start, 'timeMax': end, 'singleEvents': 'true', 'showDeleted': 'true', 'maxResults': 2500})
    else:
        remote_items = request(name, 'GET', '/project/' + quote(target, safe='') + '/data').get('tasks', [])
    remote_by_id = {r['id']: r for r in remote_items}
    errors = []
    # TickTick project/data omits completed tasks; inspect known tasks separately.
    # Google events may have moved outside the displayed range.
    for entry in entries:
        link = entry.get('remote', {}).get(name)
        if link and link['id'] not in remote_by_id and not entry.get('deleted'):
            try:
                path = gpath(target, link['id']) if name == 'google' else '/project/' + quote(target, safe='') + '/task/' + quote(link['id'], safe='')
                remote_by_id[link['id']] = request(name, 'GET', path)
            except RemoteError as exc:
                if name == 'google' and exc.status in (404, 410):
                    remote_by_id[link['id']] = {'id': link['id'], 'status': 'cancelled'}
                else:
                    errors.append({'id': entry['id'], 'message': safe_error(exc)})
                    db.patch(entry['id'], {'sync_state': 'error', 'sync_error': safe_error(exc)})
            except ValueError as exc:
                errors.append({'id': entry['id'], 'message': safe_error(exc)})
    for entry in entries:
        if name != 'google' and entry['kind'] != 'task':
            continue
        link = entry.get('remote', {}).get(name)
        if name == 'google' and not entry['start'] and not link:
            continue
        if entry.get('sync_state') not in ('pending', 'error'):
            continue
        if link and link.get('local_revision') == entry['revision']:
            continue
        if any(error['id'] == entry['id'] for error in errors):
            continue
        try:
            if link:
                if name == 'google':
                    current = remote_by_id.get(link['id']) or request(name, 'GET', gpath(target, link['id']))
                    if current.get('status') == 'cancelled':
                        if entry.get('deleted'):
                            links = dict(entry.get('remote', {})); links.pop(name, None)
                            db.patch(entry['id'], {'remote': links, 'delete_synced': True})
                            continue
                        raise ValueError('同步冲突：远程日程已删除；请保留远程删除或重新创建本地内容')
                    version = current.get('etag')
                else:
                    current = request(name, 'GET', '/project/' + quote(target, safe='') + '/task/' + quote(link['id'], safe=''))
                    version = task_version(current)
                if version != link.get('version'):
                    raise ValueError('同步冲突：远程内容也已修改；请保留远程或保留本地后重试')
            if entry.get('deleted') or (name == 'google' and not entry['start']):
                if link:
                    path = gpath(target, link['id']) if name == 'google' else '/project/' + quote(target, safe='') + '/task/' + quote(link['id'], safe='')
                    request(name, 'DELETE', path, headers={'If-Match': link['version']} if name == 'google' else {})
                    remote_by_id.pop(link['id'], None)
                links = dict(entry.get('remote', {})); links.pop(name, None)
                epochs = dict(entry.get('remote_epoch', {}))
                if link and name == 'google' and not entry.get('deleted'):
                    epochs[name] = epochs.get(name, 0) + 1
                db.patch(entry['id'], {'remote': links, 'remote_epoch': epochs, 'delete_synced': bool(entry.get('deleted'))})
                continue
            body = payload(name, entry, target)
            if link:
                if name == 'google':
                    result = request(name, 'PATCH', gpath(target, link['id']), json=body, headers={'If-Match': link['version']})
                else:
                    body['id'] = link['id']
                    canonical = fields(name, current)
                    if all(canonical[k] == entry[k] for k in ('start', 'end', 'all_day')):
                        for k in ('startDate', 'dueDate', 'isAllDay'):
                            body.pop(k, None)
                    # Preserve fields which this UI does not edit.
                    body = {**{k: current[k] for k in ('desc', 'items', 'tags', 'repeatFlag', 'reminders', 'timeZone', 'sortOrder') if k in current}, **body}
                    if entry['completed'] and current.get('status') != 2:
                        # Save edited fields before completing; Open API has a dedicated complete route.
                        request(name, 'POST', '/task/' + quote(link['id'], safe=''), json=body)
                        request(name, 'POST', '/project/' + quote(target, safe='') + '/task/' + quote(link['id'], safe='') + '/complete')
                        result = request(name, 'GET', '/project/' + quote(target, safe='') + '/task/' + quote(link['id'], safe=''))
                    else:
                        if not entry['completed'] and current.get('status') == 2:
                            raise ValueError('滴答公开 API 不保证恢复已完成任务，请在滴答恢复后重新同步')
                        result = request(name, 'POST', '/task/' + quote(link['id'], safe=''), json=body)
            else:
                # Stable IDs allow reconciliation after ambiguous timeouts.
                epoch = entry.get('remote_epoch', {}).get(name, 0)
                body['id'] = hashlib.sha256((entry['id'] + target + (':' + str(epoch) if epoch else '')).encode()).hexdigest()[:24]
                result = remote_by_id.get(body['id'])
                if result is None:
                    if name == 'google':
                        try:
                            result = request(name, 'POST', gpath(target), json=body)
                        except RemoteError as exc:
                            if exc.status != 409:
                                raise
                            result = request(name, 'GET', gpath(target, body['id']))
                    else:
                        batch = request(name, 'POST', '/task/batch', json={'add': [body]})
                        error = batch.get('id2error', {}).get(body['id'])
                        if error and error != 'EXISTED':
                            raise ValueError(f'创建滴答任务失败：{error}')
                        if body['id'] not in batch.get('id2etag', {}) and error != 'EXISTED':
                            raise ValueError('滴答没有确认创建 ID，请检查远程任务后重试')
                        result = request(name, 'GET', '/project/' + quote(target, safe='') + '/task/' + body['id'])
            if not result or not result.get('id'):
                raise ValueError('远程服务未返回任务 ID，结果未确认')
            links = dict((db.get(entry['id']) or entry).get('remote', {}))
            confirmed = name == 'google' or (result.get('status') == 2) == entry['completed']
            links[name] = {'id': result['id'], 'version': result.get('etag') if name == 'google' else task_version(result), 'local_revision': entry['revision'] if confirmed else 0}
            db.patch(entry['id'], {'remote': links})
            if name != 'google' and entry['completed'] and result.get('status') != 2:
                request(name, 'POST', '/project/' + quote(target, safe='') + '/task/' + quote(result['id'], safe='') + '/complete')
                result = request(name, 'GET', '/project/' + quote(target, safe='') + '/task/' + quote(result['id'], safe=''))
                links[name]['version'] = task_version(result)
                if result.get('status') != 2:
                    links[name]['local_revision'] = 0
                    db.patch(entry['id'], {'remote': links})
                    raise ValueError('远程未确认完成状态，请重试同步')
                links[name]['local_revision'] = entry['revision']
                db.patch(entry['id'], {'remote': links})
            remote_by_id[result['id']] = result
        except ValueError as exc:
            db.patch(entry['id'], {'sync_state': 'conflict' if '冲突' in str(exc) or '远程内容已修改' in str(exc) else 'error', 'sync_error': safe_error(exc)})
            errors.append({'id': entry['id'], 'message': safe_error(exc)})
    linked = {e.get('remote', {}).get(name, {}).get('id'): e for e in db.all_items('planner_entry') if e['list_id'] == listing['id']}
    for remote in remote_by_id.values():
        entry = linked.get(remote['id'])
        if name == 'google' and remote.get('status') == 'cancelled':
            if entry and not entry.get('deleted') and entry.get('sync_state') not in ('error', 'conflict'):
                links = dict(entry.get('remote', {})); links.pop(name, None)
                db.patch(entry['id'], {'deleted': True, 'remote': links, 'revision': entry['revision'] + 1, 'sync_state': 'pending' if links else 'synced', 'delete_synced': True})
            continue
        if entry and (entry.get('deleted') or entry.get('sync_state') in ('error', 'conflict')):
            continue
        version = remote.get('etag') if name == 'google' else task_version(remote)
        if entry:
            if version == entry['remote'][name].get('version'):
                continue
            if entry.get('sync_state') == 'pending' and entry['remote'][name].get('local_revision', 0) != entry['revision']:
                db.patch(entry['id'], {'sync_state': 'conflict', 'sync_error': '同步冲突：本地与远程均有修改'})
                errors.append({'id': entry['id'], 'message': '同步冲突：本地与远程均有修改'})
                continue
            links = dict(entry['remote']); links[name] = {'id': remote['id'], 'version': version, 'local_revision': entry['revision'] + 1}
            db.patch(entry['id'], {**fields(name, remote), 'remote': links, 'revision': entry['revision'] + 1, 'sync_state': 'pending' if len(links) > 1 else 'synced'})
        else:
            data = planner.EntryIn(list_id=listing['id'], kind='event' if name == 'google' else 'task', **fields(name, remote)).model_dump()
            db.put('planner_entry', {**data, 'revision': 1, 'sync_state': 'pending' if name != 'google' and listing.get('google_calendar_id') else 'synced', 'remote': {name: {'id': remote['id'], 'version': version, 'local_revision': 1}}, 'read_only': listing.get('read_only', False)})
    return errors


class SyncIn(planner.Strict):
    start: str
    end: str


@router.post('/sync')
def synchronize(data: SyncIn):
    a, b = datetime.fromisoformat(data.start), datetime.fromisoformat(data.end)
    if not a.tzinfo or not b.tzinfo or not timedelta(0) < b - a <= timedelta(days=400):
        raise ValueError('同步范围必须带时区且不超过 400 天')
    errors = []
    bound_lists = 0
    with planner.lock:
        for listing in planner.active('todo_list'):
            selected = []
            if listing.get('ticktick_project_id'):
                selected.append(listing.get('ticktick_region', 'dida'))
            if listing.get('google_calendar_id'):
                selected.append('google')
            if not selected:
                continue
            bound_lists += 1
            for name in selected:
                try:
                    errors.extend(sync_collection(name, listing, data.start, data.end))
                except ValueError as exc:
                    errors.append({'id': listing['id'], 'message': safe_error(exc)})
            if not any(e['id'] == listing['id'] for e in errors):
                for e in db.all_items('planner_entry'):
                    if e['list_id'] == listing['id'] and not any(error['id'] == e['id'] for error in errors) and e.get('sync_state') != 'conflict':
                        links = e.get('remote', {})
                        expected = [n for n in selected if (n == 'google' and e.get('start')) or (n != 'google' and e['kind'] == 'task')]
                        outstanding = any(n not in links or links[n].get('local_revision', 0) != e['revision'] for n in expected) if not e.get('deleted') else bool(links)
                        db.patch(e['id'], {'sync_state': 'pending' if outstanding else 'synced', 'sync_error': ''})
        return {'ok': not errors, 'errors': errors, 'bound_lists': bound_lists, 'synced_at': db.now()}


class ResolveIn(planner.Strict):
    keep: str = Field(pattern='^(local|remote)$')


@router.post('/resolve/{identifier}/{name}')
def resolve(identifier: str, name: str, data: ResolveIn):
    with planner.lock:
        entry = planner.require(identifier, 'planner_entry')
        listing = planner.require(entry['list_id'], 'todo_list')
        link = entry.get('remote', {}).get(name)
        if not link:
            raise ValueError('没有对应远程记录')
        target = listing['google_calendar_id'] if name == 'google' else listing['ticktick_project_id']
        try:
            remote = request(name, 'GET', gpath(target, link['id']) if name == 'google' else '/project/' + quote(target, safe='') + '/task/' + quote(link['id'], safe=''))
        except RemoteError as exc:
            if name != 'google' or exc.status not in (404, 410):
                raise
            remote = {'id': link['id'], 'status': 'cancelled'}
        if name == 'google' and remote.get('status') == 'cancelled':
            links = dict(entry['remote']); links.pop(name, None)
            epochs = dict(entry.get('remote_epoch', {})); epochs[name] = epochs.get(name, 0) + 1
            return db.patch(identifier, {'remote': links, 'remote_epoch': epochs, 'deleted': data.keep == 'remote', 'delete_synced': data.keep == 'remote', 'revision': entry['revision'] + 1, 'sync_state': 'pending', 'sync_error': ''})
        links = dict(entry['remote']); links[name] = {'id': remote['id'], 'version': remote.get('etag') if name == 'google' else task_version(remote), 'local_revision': entry['revision'] + 1 if data.keep == 'remote' else 0}
        return db.patch(identifier, {**(fields(name, remote) if data.keep == 'remote' else {}), 'remote': links, 'revision': entry['revision'] + 1, 'sync_state': 'pending', 'sync_error': ''})
