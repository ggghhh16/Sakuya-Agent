"""Local planner. Remote identifiers never replace local identifiers."""
from datetime import datetime, date
from typing import Literal
from threading import RLock
from pydantic import BaseModel, ConfigDict, Field, model_validator, field_validator
from fastapi import APIRouter, HTTPException
from . import db

router = APIRouter(prefix='/api/planner')
lock = RLock()


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)


class ListIn(Strict):
    name: str = Field(min_length=1, max_length=100)
    map_enabled: bool = False
    color: str = Field(default='#a899ed', pattern=r'^#[0-9a-fA-F]{6}$')
    google_calendar_id: str = Field(default='', max_length=500)
    ticktick_project_id: str = Field(default='', max_length=200)
    ticktick_region: Literal['dida', 'ticktick'] = 'dida'


class EntryIn(Strict):
    title: str = Field(min_length=1, max_length=300)
    list_id: str
    notes: str = Field(default='', max_length=16000)
    start: str | None = None
    end: str | None = None
    all_day: bool = False
    completed: bool = False
    priority: Literal['none', 'low', 'medium', 'high'] = 'none'
    kind: Literal['task', 'event'] = 'task'
    location: str = Field(default='', max_length=1000)
    tags: list[str] = Field(default_factory=list, max_length=20)
    parent_id: str = Field(default='', max_length=100)
    pinned: bool = False
    cancelled: bool = False
    is_note: bool = False
    @field_validator('tags')
    @classmethod
    def normalize_tags(cls, tags):
        tags = list(dict.fromkeys(tag.strip() for tag in tags if tag.strip()))
        if any(len(tag) > 40 for tag in tags):
            raise ValueError('每个标签最多 40 个字')
        return tags

    @model_validator(mode='after')
    def dates(self):
        if bool(self.start) != bool(self.end):
            raise ValueError('开始与结束时间必须同时填写')
        if self.kind == 'event' and not self.start:
            raise ValueError('日程需要开始与结束时间')
        if self.start:
            if self.all_day:
                a, b = date.fromisoformat(self.start), date.fromisoformat(self.end)
            else:
                a, b = datetime.fromisoformat(self.start), datetime.fromisoformat(self.end)
                if a.tzinfo is None or b.tzinfo is None:
                    raise ValueError('时间必须包含时区')
            if b <= a:
                raise ValueError('结束时间必须晚于开始时间')
        return self


class EntryUpdate(EntryIn):
    revision: int = Field(ge=1)


def require(identifier, kind):
    item = db.get(identifier, kind)
    if not item or item.get('deleted'):
        raise HTTPException(404, '内容不存在或已删除')
    return item


def active(kind):
    return [i for i in db.all_items(kind) if not i.get('deleted')]


@router.get('')
def snapshot():
    with lock:
        if not active('todo_list'):
            inbox = ListIn(name='收集箱').model_dump()
            if not db.get('todo_inbox', 'todo_list'):
                inbox['id'] = 'todo_inbox'
            db.put('todo_list', inbox)
        saved = preferences()
        order = {identifier: index for index, identifier in enumerate(saved['list_order'])}
        lists = sorted(active('todo_list'), key=lambda item: (order.get(item['id'], len(order)), item.get('created_at', ''), item['id']))
        return {'lists': lists, 'entries': active('planner_entry'), 'preferences': saved}


class PlannerPreferences(Strict):
    sort: Literal['priority', 'time', 'title', 'list', 'none'] = 'time'
    manual_order: list[str] = Field(default_factory=list, max_length=10000)
    default_calendar_list: str = ''
    default_task_list: str = ''
    list_order: list[str] = Field(default_factory=list, max_length=10000)


def preferences():
    saved = db.get('planner_preferences', 'planner_preferences') or {}
    return {key: saved.get(key, default) for key, default in PlannerPreferences().model_dump().items()}


@router.put('/preferences')
def save_preferences(data: PlannerPreferences):
    with lock:
        for identifier in (data.default_calendar_list, data.default_task_list):
            if not identifier:
                continue
            listing = require(identifier, 'todo_list')
            if listing.get('read_only'):
                raise HTTPException(403, '此日历只读，不能设为默认创建清单')
        ids = {e['id'] for e in active('planner_entry')}
        if len(set(data.manual_order)) != len(data.manual_order) or any(i not in ids for i in data.manual_order):
            raise HTTPException(409, '任务列表已变更，请刷新后重新排序')
        changes = data.model_dump(exclude_unset=True)
        list_ids = {item['id'] for item in active('todo_list')}
        if len(set(data.list_order)) != len(data.list_order) or any(i not in list_ids for i in data.list_order):
            raise HTTPException(409, '清单已变更，请刷新后重新排序')
        if db.get('planner_preferences', 'planner_preferences'):
            db.patch('planner_preferences', changes)
        else:
            db.put('planner_preferences', {'id': 'planner_preferences', **PlannerPreferences().model_dump(), **changes})
        return preferences()


@router.post('/lists', status_code=201)
def create_list(data: ListIn):
    with lock:
        validate_bindings(data)
        return db.put('todo_list', data.model_dump())


def validate_bindings(data, identifier=None):
    for listing in active('todo_list'):
        if listing['id'] == identifier:
            continue
        if data.google_calendar_id and listing.get('google_calendar_id') == data.google_calendar_id:
            raise HTTPException(409, '此 Google 日历已绑定其他清单，请在原清单管理，避免重复同步')
        if data.ticktick_project_id and listing.get('ticktick_project_id') == data.ticktick_project_id and listing.get('ticktick_region', 'dida') == data.ticktick_region:
            raise HTTPException(409, '此滴答清单已绑定其他清单')


@router.put('/lists/{identifier}')
def update_list(identifier: str, data: ListIn):
    with lock:
        old = require(identifier, 'todo_list')
        validate_bindings(data, identifier)
        for field in ('google_calendar_id', 'ticktick_project_id', 'ticktick_region'):
            remote_name = 'google' if field == 'google_calendar_id' else old.get('ticktick_region', 'dida')
            if old.get(field) != getattr(data, field) and any(e['list_id'] == identifier and e.get('remote', {}).get(remote_name) for e in active('planner_entry')):
                raise HTTPException(409, '该清单已有同步记录，请新建清单绑定其他目标，避免移动或复制远程内容')
        changes = data.model_dump()
        if 'map_enabled' not in data.model_fields_set:
            changes.pop('map_enabled')
        result = db.patch(identifier, changes)
        if old.get('google_calendar_id') != data.google_calendar_id or old.get('ticktick_project_id') != data.ticktick_project_id:
            for entry in active('planner_entry'):
                if entry['list_id'] == identifier and entry.get('sync_state') != 'conflict':
                    db.patch(entry['id'], {'sync_state': 'pending'})
        return result


@router.delete('/lists/{identifier}')
def delete_list(identifier: str):
    with lock:
        require(identifier, 'todo_list')
        # Removing a list is local only. Keep remote IDs as tombstones so a
        # later sync cannot recreate these rows or delete the remote content.
        entries = active('planner_entry')
        removed = {entry['id'] for entry in entries if entry['list_id'] == identifier}
        for entry in entries:
            if entry['id'] in removed:
                db.patch(entry['id'], {'deleted': True, 'local_only_deleted': True,
                         'revision': entry['revision'] + 1, 'sync_state': 'synced', 'sync_error': ''})
            elif entry.get('parent_id') in removed:
                db.patch(entry['id'], {'parent_id': '', 'revision': entry['revision'] + 1})
        saved = preferences()
        if db.get('planner_preferences', 'planner_preferences'):
            db.patch('planner_preferences', {
                'list_order': [i for i in saved['list_order'] if i != identifier],
                'manual_order': [i for i in saved['manual_order'] if i not in removed],
                'default_calendar_list': '' if saved['default_calendar_list'] == identifier else saved['default_calendar_list'],
                'default_task_list': '' if saved['default_task_list'] == identifier else saved['default_task_list'],
            })
        return db.patch(identifier, {'deleted': True, 'local_only_deleted': True})


@router.post('/entries', status_code=201)
def create_entry(data: EntryIn):
    with lock:
        require_writable_list(data.list_id)
        validate_parent(data.parent_id)
        return db.put('planner_entry', {**data.model_dump(), 'revision': 1, 'sync_state': 'pending', 'remote': {}})


def require_writable_list(identifier):
    listing = require(identifier, 'todo_list')
    if listing.get('read_only'):
        raise HTTPException(403, '此清单只读')
    return listing


def require_writable_entry(entry):
    if entry.get('read_only'):
        raise HTTPException(403, '此日历只读')
    for identifier in {entry['list_id'], entry.get('sync_list_id', entry['list_id'])}:
        require_writable_list(identifier)


def validate_parent(parent_id, identifier=None):
    visited = {identifier}
    while parent_id:
        if parent_id in visited:
            raise HTTPException(422, '子任务不能循环关联')
        visited.add(parent_id)
        parent = require(parent_id, 'planner_entry')
        if parent.get('kind') != 'task':
            raise HTTPException(422, '只能在任务下添加子任务')
        parent_id = parent.get('parent_id', '')


@router.put('/entries/{identifier}')
def update_entry(identifier: str, data: EntryUpdate):
    with lock:
        old = require(identifier, 'planner_entry')
        require_writable_list(data.list_id)
        if old['revision'] != data.revision:
            raise HTTPException(409, '内容已被其他操作修改，请重新打开后编辑')
        require_writable_entry(old)
        if old.get('remote') and old['kind'] != data.kind:
            raise HTTPException(409, '已同步内容不能更改类型')
        changes = data.model_dump()
        validate_parent(data.parent_id, identifier)
        for field in ('parent_id', 'pinned', 'cancelled', 'is_note'):
            if field not in data.model_fields_set:
                changes[field] = old.get(field, '' if field == 'parent_id' else False)
        if 'tags' not in data.model_fields_set:
            if 'tags' in old:
                changes['tags'] = old['tags']
            else:
                changes.pop('tags', None)
        # Categorization is local; existing remote links keep their original source binding.
        # This avoids deleting/recreating remote tasks when a local row is moved.
        if old.get('remote') and old['list_id'] != data.list_id:
            changes['sync_list_id'] = old.get('sync_list_id', old['list_id'])
        return db.patch(identifier, {**changes, 'revision': old['revision'] + 1, 'sync_state': 'pending', 'sync_error': ''})


@router.delete('/entries/{identifier}')
def delete_entry(identifier: str, revision: int):
    with lock:
        old = require(identifier, 'planner_entry')
        if old['revision'] != revision:
            raise HTTPException(409, '内容已变更，请刷新后重试')
        require_writable_entry(old)
        return db.patch(identifier, {'deleted': True, 'revision': revision + 1, 'sync_state': 'pending'})


@router.post('/entries/{identifier}/restore')
def restore_entry(identifier: str):
    with lock:
        old = db.get(identifier, 'planner_entry')
        if not old or not old.get('deleted'):
            raise HTTPException(404, '没有可恢复的内容')
        if old.get('local_only_deleted'):
            raise HTTPException(409, '所属清单已删除，无法恢复此内容')
        if old.get('delete_synced'):
            raise HTTPException(409, '远程删除已同步，无法撤销')
        require_writable_entry(old)
        return db.patch(identifier, {'deleted': False, 'revision': old['revision'] + 1, 'sync_state': 'pending'})
