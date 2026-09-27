"""Local planner. Remote identifiers never replace local identifiers."""
from datetime import datetime, date
from typing import Literal
from threading import RLock
from pydantic import BaseModel, ConfigDict, Field, model_validator
from fastapi import APIRouter, HTTPException
from . import db

router = APIRouter(prefix='/api/planner')
lock = RLock()


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)


class ListIn(Strict):
    name: str = Field(min_length=1, max_length=100)
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
            db.put('todo_list', {'id': 'todo_inbox', **ListIn(name='收集箱').model_dump()})
        return {'lists': list(reversed(active('todo_list'))), 'entries': active('planner_entry')}


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
        result = db.patch(identifier, data.model_dump())
        if old.get('google_calendar_id') != data.google_calendar_id or old.get('ticktick_project_id') != data.ticktick_project_id:
            for entry in active('planner_entry'):
                if entry['list_id'] == identifier and entry.get('sync_state') != 'conflict':
                    db.patch(entry['id'], {'sync_state': 'pending'})
        return result


@router.delete('/lists/{identifier}')
def delete_list(identifier: str):
    with lock:
        require(identifier, 'todo_list')
        if any(e['list_id'] == identifier for e in active('planner_entry')):
            raise HTTPException(409, '请先移出或删除清单中的任务和日程')
        if len(active('todo_list')) == 1:
            raise HTTPException(409, '至少保留一个清单')
        return db.patch(identifier, {'deleted': True})


@router.post('/entries', status_code=201)
def create_entry(data: EntryIn):
    with lock:
        require(data.list_id, 'todo_list')
        return db.put('planner_entry', {**data.model_dump(), 'revision': 1, 'sync_state': 'pending', 'remote': {}})


@router.put('/entries/{identifier}')
def update_entry(identifier: str, data: EntryUpdate):
    with lock:
        old = require(identifier, 'planner_entry')
        require(data.list_id, 'todo_list')
        if old['revision'] != data.revision:
            raise HTTPException(409, '内容已被其他操作修改，请重新打开后编辑')
        if old.get('read_only'):
            raise HTTPException(403, '此日历只读')
        if old.get('remote') and (old['list_id'] != data.list_id or old['kind'] != data.kind):
            raise HTTPException(409, '已同步内容不能移动清单或更改类型')
        return db.patch(identifier, {**data.model_dump(), 'revision': old['revision'] + 1, 'sync_state': 'pending', 'sync_error': ''})


@router.delete('/entries/{identifier}')
def delete_entry(identifier: str, revision: int):
    with lock:
        old = require(identifier, 'planner_entry')
        if old['revision'] != revision:
            raise HTTPException(409, '内容已变更，请刷新后重试')
        if old.get('read_only'):
            raise HTTPException(403, '此日历只读')
        return db.patch(identifier, {'deleted': True, 'revision': revision + 1, 'sync_state': 'pending'})


@router.post('/entries/{identifier}/restore')
def restore_entry(identifier: str):
    with lock:
        old = db.get(identifier, 'planner_entry')
        if not old or not old.get('deleted'):
            raise HTTPException(404, '没有可恢复的内容')
        if old.get('delete_synced'):
            raise HTTPException(409, '远程删除已同步，无法撤销')
        return db.patch(identifier, {'deleted': False, 'revision': old['revision'] + 1, 'sync_state': 'pending'})
