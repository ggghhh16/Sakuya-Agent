"""Small local workspace store. Each mutation is committed atomically."""
import json
import os
import sqlite3
import uuid
import re
import threading
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import datetime, timezone
from pathlib import Path
from .private_storage import protect

ROOT = Path(__file__).resolve().parents[2]
DATA = Path(os.getenv('SAKUYA_DATA_DIR', str(ROOT / '.data')))
DATA.mkdir(parents=True, exist_ok=True)
protect(DATA)
DB = DATA / 'workspace.sqlite'
_owner = ContextVar('workspace_owner', default=None)
_initialized = set()
_init_lock = threading.RLock()


def current_owner():
    return _owner.get()


@contextmanager
def workspace(owner=None):
    if owner is not None and not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', owner):
        raise ValueError('无效账号工作区')
    token = _owner.set(owner)
    try:
        yield
    finally:
        _owner.reset(token)


def data_dir():
    return DATA / 'users' / current_owner() if current_owner() else DATA


def workspace_owners():
    root = DATA / 'users'
    return [None] + (sorted(p.name for p in root.iterdir() if p.is_dir() and re.fullmatch(r'[A-Za-z0-9_-]{1,100}', p.name) and (p / 'workspace.sqlite').exists()) if root.exists() else [])


def ensure_workspace():
    path = data_dir() / 'workspace.sqlite'
    with _init_lock:
        if path not in _initialized or not path.exists():
            init()
            _initialized.add(path)


def now():
    return datetime.now(timezone.utc).isoformat()


def uid(prefix):
    return f'{prefix}_{uuid.uuid4().hex[:12]}'


def connect(shared=False):
    path = DB if shared or not current_owner() else data_dir() / 'workspace.sqlite'
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path, timeout=15)
    con.row_factory = sqlite3.Row
    con.execute('PRAGMA journal_mode=WAL')
    return con


def init():
    with connect() as con:
        con.executescript('''
        CREATE TABLE IF NOT EXISTS objects (
          id TEXT PRIMARY KEY, kind TEXT NOT NULL, body TEXT NOT NULL,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS objects_kind ON objects(kind);
        CREATE TABLE IF NOT EXISTS events (
          seq INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL,
          event TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS events_run ON events(run_id, seq);
        ''')
        con.execute('BEGIN IMMEDIATE')
        rows = con.execute("SELECT body FROM objects WHERE kind='conversation' ORDER BY updated_at DESC").fetchall()
        conversations = [json.loads(r['body']) for r in rows]
        next_position = max((c.get('position', -1) for c in conversations), default=-1) + 1
        for conversation in conversations:
            if 'position' not in conversation:
                conversation['position'] = next_position
                next_position += 1
                con.execute('UPDATE objects SET body=? WHERE id=?', (json.dumps(conversation, ensure_ascii=False), conversation['id']))


def put(kind, body):
    item = {'id': uid(kind), 'created_at': now(), **body, 'updated_at': now()}
    with connect() as con:
        con.execute('INSERT INTO objects VALUES (?,?,?,?,?)',
                    (item['id'], kind, json.dumps(item, ensure_ascii=False), item['created_at'], item['updated_at']))
    return item


def get(identifier, kind=None):
    with connect() as con:
        row = con.execute('SELECT * FROM objects WHERE id=?', (identifier,)).fetchone()
    if row and (kind is None or row['kind'] == kind):
        return json.loads(row['body'])
    return None


def all_items(kind):
    with connect() as con:
        rows = con.execute('SELECT body FROM objects WHERE kind=? ORDER BY updated_at DESC', (kind,)).fetchall()
    return [json.loads(r['body']) for r in rows]


def patch(identifier, changes):
    with connect() as con:
        con.execute('BEGIN IMMEDIATE')
        row = con.execute('SELECT body FROM objects WHERE id=?', (identifier,)).fetchone()
        if not row:
            return None
        item = {**json.loads(row['body']), **changes, 'updated_at': now()}
        con.execute('UPDATE objects SET body=?, updated_at=? WHERE id=?',
                    (json.dumps(item, ensure_ascii=False), item['updated_at'], identifier))
    return item


def append_comment(ticket_id, text, internal=True, author='工作区管理员'):
    with connect() as con:
        con.execute('BEGIN IMMEDIATE')
        row = con.execute('SELECT body FROM objects WHERE id=? AND kind=?', (ticket_id, 'ticket')).fetchone()
        if not row:
            return None
        item = json.loads(row['body'])
        comment = {'id': uid('comment'), 'content': text, 'internal': internal, 'author': author, 'created_at': now()}
        item['comments'] = [*item.get('comments', []), comment]
        item['updated_at'] = now()
        con.execute('UPDATE objects SET body=?, updated_at=? WHERE id=?', (json.dumps(item, ensure_ascii=False), item['updated_at'], ticket_id))
    return item


def event(run_id, stage, message, **extra):
    item = {'stage': stage, 'message': message, **extra}
    with connect() as con:
        con.execute('INSERT INTO events (run_id,event,created_at) VALUES (?,?,?)',
                    (run_id, json.dumps(item, ensure_ascii=False), now()))


def events(run_id, after=0):
    with connect() as con:
        rows = con.execute('SELECT * FROM events WHERE run_id=? AND seq>? ORDER BY seq LIMIT 300', (run_id, after)).fetchall()
    return [{'seq': r['seq'], 'created_at': r['created_at'], **json.loads(r['event'])} for r in rows]


def claim():
    with connect() as con:
        con.execute('BEGIN IMMEDIATE')
        rows = con.execute("SELECT body FROM objects WHERE kind='run' ORDER BY created_at").fetchall()
        for row in rows:
            item = json.loads(row['body'])
            if item['status'] != 'queued':
                continue
            item.update(status='running', updated_at=now(), heartbeat=now())
            con.execute('UPDATE objects SET body=?,updated_at=? WHERE id=?',
                        (json.dumps(item, ensure_ascii=False), item['updated_at'], item['id']))
            return item
    return None


def transition_run(identifier, allowed, changes):
    with connect() as con:
        con.execute('BEGIN IMMEDIATE')
        row = con.execute("SELECT body FROM objects WHERE id=? AND kind='run'", (identifier,)).fetchone()
        if not row:
            return None
        item = json.loads(row['body'])
        if item['status'] not in allowed:
            raise ValueError('当前任务状态不支持此操作')
        if item.get('kind') == 'chat' and changes.get('status') == 'queued':
            changes = {**changes, 'partial_report': ''}
            conversation = con.execute("SELECT body FROM objects WHERE kind='conversation' AND id=?", (item['conversation_id'],)).fetchone()
            if not conversation or json.loads(conversation['body']).get('deleted_at'):
                raise ValueError('对话已删除')
            siblings = con.execute("SELECT body FROM objects WHERE kind='run' AND id!=?", (identifier,)).fetchall()
            for sibling in siblings:
                turn = json.loads(sibling['body'])
                if turn.get('conversation_id') == item['conversation_id'] and (turn['created_at'] > item['created_at'] or turn['status'] in {'queued', 'running', 'waiting'}):
                    raise ValueError('该回复之后已有新消息，请在对话末尾重新提问')
        item.update(**changes, updated_at=now())
        con.execute('UPDATE objects SET body=?,updated_at=? WHERE id=?',
                    (json.dumps(item, ensure_ascii=False), item['updated_at'], identifier))
        return item


def queue_chat(prompt, conversation_id, mode, planner_tools=False, time_zone='UTC', selection=None):
    """Store a turn and its context together; never overlap turns in one chat."""
    with connect() as con:
        con.execute('BEGIN IMMEDIATE')
        stamp = now()
        if conversation_id:
            row = con.execute("SELECT body FROM objects WHERE id=? AND kind='conversation'", (conversation_id,)).fetchone()
            if not row or json.loads(row['body']).get('deleted_at'):
                raise ValueError('对话不存在')
            conversation = json.loads(row['body'])
        else:
            existing = con.execute("SELECT body FROM objects WHERE kind='conversation'").fetchall()
            position = min((json.loads(r['body']).get('position', 0) for r in existing), default=0) - 1
            conversation = {'id': uid('conversation'), 'title': prompt[:60], 'position': position, 'created_at': stamp, 'updated_at': stamp}
        rows = con.execute("SELECT body FROM objects WHERE kind='run' ORDER BY created_at").fetchall()
        turns = [json.loads(r['body']) for r in rows]
        turns = [r for r in turns if r.get('conversation_id') == conversation['id']]
        if any(r['status'] in {'queued', 'running', 'waiting'} for r in turns):
            raise ValueError('请等待当前回复完成，或先停止生成')
        history = []
        # Keep demo responses out of real model context when switching modes.
        for turn in [r for r in turns if r['status'] == 'completed' and r['mode'] == mode][-12:]:
            from .chat_references import model_prompt
            history.extend([{'role': 'user', 'content': model_prompt(turn['prompt'][:4000], turn.get('references', []))}, {'role': 'assistant', 'content': turn['report'][:4000]}])
        run = {'id': uid('run'), 'kind': 'chat', 'conversation_id': conversation['id'], 'title': prompt[:100],
               'prompt': prompt, 'mode': mode, 'planner_tools': planner_tools, 'time_zone': time_zone, 'project_id': '', 'history': history, 'status': 'queued',
               'report': '', 'sources': [], 'plan': [], 'tokens': 0, 'error': None, 'experiment': False,
               'created_at': stamp, 'updated_at': stamp}
        conversation['updated_at'] = stamp
        run.update(selection or {})
        con.execute('INSERT INTO objects VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,updated_at=excluded.updated_at',
                    (conversation['id'], 'conversation', json.dumps(conversation, ensure_ascii=False), conversation['created_at'], stamp))
        con.execute('INSERT INTO objects VALUES (?,?,?,?,?)', (run['id'], 'run', json.dumps(run, ensure_ascii=False), stamp, stamp))
    return {'conversation': conversation, 'run': run}


def conversations():
    return sorted((c for c in all_items('conversation') if not c.get('deleted_at')), key=lambda c: (c.get('position', 0), c['id']))


def change_conversation(identifier, action, title=None):
    with connect() as con:
        con.execute('BEGIN IMMEDIATE')
        row = con.execute("SELECT body FROM objects WHERE kind='conversation' AND id=?", (identifier,)).fetchone()
        if not row:
            raise ValueError('对话不存在')
        item = json.loads(row['body'])
        if action != 'restore' and item.get('deleted_at'):
            raise ValueError('对话已删除')
        if action == 'rename':
            item['title'] = title
        elif action == 'delete':
            item['deleted_at'] = now()
            # Keep cancelled records so an in-flight worker can safely finish.
            for row in con.execute("SELECT body FROM objects WHERE kind='run'").fetchall():
                run = json.loads(row['body'])
                if run.get('conversation_id') == identifier and run['status'] in {'queued', 'running', 'waiting'}:
                    run.update(status='cancelled', updated_at=now())
                    con.execute('UPDATE objects SET body=?,updated_at=? WHERE id=?', (json.dumps(run, ensure_ascii=False), run['updated_at'], run['id']))
        elif action == 'restore':
            item.pop('deleted_at', None)
        item['updated_at'] = now()
        con.execute('UPDATE objects SET body=?,updated_at=? WHERE id=?', (json.dumps(item, ensure_ascii=False), item['updated_at'], identifier))
    return item


def reorder_conversations(identifiers):
    with connect() as con:
        con.execute('BEGIN IMMEDIATE')
        items = [json.loads(row['body']) for row in con.execute("SELECT body FROM objects WHERE kind='conversation'").fetchall()]
        active = {c['id']: c for c in items if not c.get('deleted_at')}
        if len(set(identifiers)) != len(identifiers) or any(i not in active for i in identifiers):
            raise ValueError('对话列表已变化，请刷新后重试')
        # New chats created in another window stay at the top, never disappear.
        missing = sorted((c for c in active.values() if c['id'] not in identifiers), key=lambda c: c.get('position', 0))
        ordered = missing + [active[i] for i in identifiers]
        for position, item in enumerate(ordered):
            item['position'] = position
            con.execute('UPDATE objects SET body=? WHERE id=?', (json.dumps(item, ensure_ascii=False), item['id']))
    return ordered
