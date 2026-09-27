import asyncio
import json
import os
import re
import shutil
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse, quote
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware
from pydantic import BaseModel, Field, ConfigDict
from . import db, settings, auth
from .seed import seed


@asynccontextmanager
async def lifespan(app):
    db.init()
    auth.init()
    seed()
    yield


app = FastAPI(title='Sakuya Agent API', version='0.1.0', lifespan=lifespan)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=['127.0.0.1', 'localhost', 'testserver'])


@app.middleware('http')
async def local_workspace_guard(request: Request, call_next):
    origin = request.headers.get('origin')
    allowed_origins = {'http://127.0.0.1:5173', 'http://localhost:5173', 'http://127.0.0.1:4173', 'http://localhost:4173', 'http://127.0.0.1:8120', 'http://localhost:8120'}
    for port in (os.getenv('VITE_PORT', '5173'), os.getenv('SAKUYA_PORT', '8120')):
        allowed_origins.update({f'http://127.0.0.1:{port}', f'http://localhost:{port}'})
    if origin and origin not in allowed_origins:
        return JSONResponse({'detail': '仅允许本机工作区访问'}, status_code=403)
    if request.method in {'POST', 'PUT', 'PATCH', 'DELETE'}:
        if request.headers.get('x-sakuya-client') != 'workspace':
            return JSONResponse({'detail': '缺少工作区请求标识'}, status_code=403)
        if request.headers.get('sec-fetch-site') == 'cross-site':
            return JSONResponse({'detail': '拒绝跨站写入'}, status_code=403)
        try:
            if int(request.headers.get('content-length', '0')) > 1_000_000:
                return JSONResponse({'detail': '请求超过大小上限'}, status_code=413)
        except ValueError:
            return JSONResponse({'detail': '无效请求'}, status_code=400)
    path = request.url.path
    owner = None
    if path.startswith('/api/') and path != '/api/health' and not path.startswith('/api/auth/'):
        user = auth.current_user(request)
        if not user:
            return JSONResponse({'detail': '请先登录'}, status_code=401)
        request.state.user = user
        if user['role'] != 'admin' and not (path == '/api/tickets' or path.startswith('/api/tickets/')):
            owner = user['id']
    with db.workspace(owner):
        if owner:
            from starlette.concurrency import run_in_threadpool
            await run_in_threadpool(db.ensure_workspace)
        response = await call_next(request)
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Referrer-Policy'] = 'no-referrer'
    if request.url.path.startswith('/api') or response.headers.get('content-type', '').startswith('text/html'):
        response.headers['Cache-Control'] = 'no-store'
    return response


@app.exception_handler(ValueError)
async def value_error(request, exc):
    return JSONResponse({'detail': str(exc)}, status_code=422)


class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)


class ProjectIn(StrictModel):
    name: str = Field(min_length=1, max_length=100)
    description: str = Field(default='', max_length=12000)
    repository: str = Field(default='', max_length=400)


class RunIn(StrictModel):
    title: str = Field(min_length=1, max_length=160)
    prompt: str = Field(min_length=5, max_length=16000)
    kind: Literal['research', 'diagnosis']
    project_id: str = ''
    repository: str = Field(default='', max_length=400)
    model_id: str | None = Field(default=None, max_length=300)
    reasoning_effort: Literal['default', 'low', 'medium', 'high'] = 'default'
    mode: Literal['demo', 'live'] = 'demo'
    experiment: bool = False
    urls: list[str] = Field(default_factory=list, max_length=5)
    ticket_id: str | None = None


class ChatIn(StrictModel):
    prompt: str = Field(min_length=1, max_length=16000)
    conversation_id: str | None = None
    mode: Literal['demo', 'live'] = 'demo'
    planner_tools: bool = False
    time_zone: str = Field(default='UTC', max_length=100)
    model_id: str | None = Field(default=None, max_length=300)
    reasoning_effort: Literal['default', 'low', 'medium', 'high'] = 'default'


class ConversationRename(StrictModel):
    title: str = Field(min_length=1, max_length=100)


class ConversationOrder(StrictModel):
    ids: list[str] = Field(max_length=10000)


class TicketIn(StrictModel):
    title: str = Field(min_length=1, max_length=160)
    description: str = Field(default='', max_length=16000)
    project_id: str = ''
    customer: str = Field(default='工作区用户', max_length=100)
    priority: Literal['low', 'normal', 'high'] = 'normal'


class TicketPatch(StrictModel):
    title: str | None = Field(default=None, min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=16000)
    status: Literal['open', 'in_progress', 'waiting', 'resolved'] | None = None
    priority: Literal['low', 'normal', 'high'] | None = None
    assignee: str | None = Field(default=None, max_length=100)


class CommentIn(StrictModel):
    content: str = Field(min_length=1, max_length=16000)
    internal: bool = True


class DocumentIn(StrictModel):
    title: str = Field(min_length=1, max_length=160)
    content: str = Field(min_length=1, max_length=150000)
    project_id: str


class SettingsIn(StrictModel):
    model: str = Field(max_length=150)
    base_url: str = Field(max_length=500)
    api_key: str = Field(default='', max_length=2000)
    search_key: str = Field(default='', max_length=2000)


class ResumeIn(StrictModel):
    decision: Literal['approve', 'skip']


def require(identifier, kind):
    item = db.get(identifier, kind)
    if item is None:
        raise HTTPException(404, '内容不存在或已移除')
    return item


@app.get('/api/health')
def health():
    pulse = db.DATA / 'worker.pulse'
    return {'ok': True, 'service': 'sakuya-agent', 'protocol': 4, 'instance': os.getenv('SAKUYA_INSTANCE', ''), 'worker_online': pulse.exists() and time.time() - pulse.stat().st_mtime < 15, 'docker_available': bool(shutil.which('docker'))}


@app.get('/api/workspace')
def workspace(request: Request):
    user = request.state.user
    with db.workspace():
        tickets = [visible_ticket(t, user) for t in db.all_items('ticket') if user['role'] == 'admin' or t.get('owner_id') == user['id']]
    runs = db.all_items('run')
    conversations = db.conversations()
    visible_ids = {c['id'] for c in conversations}
    return {k: db.all_items(v) for k, v in [('projects', 'project'), ('documents', 'document')]} | {
        'tickets': tickets,
        'conversations': conversations,
        'runs': [r for r in runs if r['kind'] != 'chat'],
        'chats': [r for r in runs if r['kind'] == 'chat' and r.get('conversation_id') in visible_ids],
        'settings': settings.public_config(), 'user': user,
    }


@app.post('/api/chat', status_code=201)
def send_chat(data: ChatIn):
    if data.mode == 'live' and not settings.public_config()['model_configured']:
        raise ValueError('请先配置模型连接，或选择演示模式')
    if data.conversation_id:
        require(data.conversation_id, 'conversation')
    selection = settings.resolve_model(data.model_id, data.reasoning_effort) if data.mode == 'live' else {}
    return db.queue_chat(data.prompt, data.conversation_id, data.mode, data.planner_tools, data.time_zone, selection)


@app.put('/api/conversations/order')
def reorder_conversations(data: ConversationOrder):
    return db.reorder_conversations(data.ids)


@app.patch('/api/conversations/{identifier}')
def rename_conversation(identifier: str, data: ConversationRename):
    require(identifier, 'conversation')
    return db.change_conversation(identifier, 'rename', data.title)


@app.delete('/api/conversations/{identifier}')
def delete_conversation(identifier: str):
    require(identifier, 'conversation')
    return db.change_conversation(identifier, 'delete')


@app.post('/api/conversations/{identifier}/restore')
def restore_conversation(identifier: str):
    require(identifier, 'conversation')
    return db.change_conversation(identifier, 'restore')


@app.post('/api/runs', status_code=201)
def create_run(data: RunIn):
    if data.repository and not re.fullmatch(r'https://github\.com/[\w.-]+/[\w.-]+/?', data.repository):
        raise ValueError('请填写 GitHub 仓库主页地址')
    if data.ticket_id:
        ticket = require(data.ticket_id, 'ticket')
        if ticket['project_id'] != data.project_id:
            raise ValueError('工单与任务必须属于同一项目')
    if data.mode == 'live' and not settings.public_config()['model_configured']:
        raise ValueError('请先配置模型连接，或选择演示模式')
    for url in data.urls:
        if len(url) > 2000 or urlparse(url).scheme != 'https':
            raise ValueError('资料链接必须是 HTTPS 地址，长度不超过 2000')
    selection = settings.resolve_model(data.model_id, data.reasoning_effort) if data.mode == 'live' else {}
    return db.put('run', data.model_dump() | selection | {'status': 'queued', 'report': '', 'sources': [], 'plan': [], 'tokens': 0, 'error': None})


@app.get('/api/runs/{identifier}')
def read_run(identifier: str):
    return require(identifier, 'run') | {'events': db.events(identifier)}


@app.post('/api/runs/{identifier}/cancel')
def cancel_run(identifier: str):
    require(identifier, 'run')
    result = db.transition_run(identifier, {'queued', 'running', 'waiting'}, {'status': 'cancelled', 'approval': None})
    db.event(identifier, 'cancelled', '用户取消了任务')
    return result


@app.post('/api/runs/{identifier}/retry')
def retry_run(identifier: str):
    require(identifier, 'run')
    return db.transition_run(identifier, {'failed'}, {'status': 'queued', 'error': None})


@app.post('/api/runs/{identifier}/resume')
def resume_run(identifier: str, data: ResumeIn):
    require(identifier, 'run')
    return db.transition_run(identifier, {'waiting'}, {'status': 'queued', 'resume_decision': data.decision, 'approval': None})


@app.get('/api/runs/{identifier}/events')
async def stream_events(identifier: str, request: Request, after: int = 0):
    require(identifier, 'run')
    async def generate():
        cursor = after
        while not await request.is_disconnected():
            for event in db.events(identifier, cursor):
                cursor = event['seq']
                yield f'id: {cursor}\nevent: progress\ndata: {json.dumps(event, ensure_ascii=False)}\n\n'
            run = db.get(identifier)
            yield f'event: status\ndata: {json.dumps({"status": run["status"]})}\n\n'
            if run['status'] in {'completed', 'failed', 'cancelled', 'waiting'}:
                break
            await asyncio.sleep(1)
    return StreamingResponse(generate(), media_type='text/event-stream', headers={'X-Accel-Buffering': 'no', 'Cache-Control': 'no-cache'})


@app.get('/api/runs/{identifier}/export')
def export_run(identifier: str):
    run = require(identifier, 'run')
    if not run.get('report'):
        raise HTTPException(409, '报告尚未生成')
    content = run['report'] + '\n\n## 来源\n\n' + '\n'.join(f'[{i+1}] {s["title"]} {s.get("url", "（项目资料）")}' for i, s in enumerate(run.get('sources', [])))
    return Response(content, media_type='text/markdown; charset=utf-8', headers={'Content-Disposition': f"attachment; filename=report.md; filename*=UTF-8''{quote(run['title'] + '.md')}"})


@app.post('/api/runs/{identifier}/save')
def save_report(identifier: str):
    run = require(identifier, 'run')
    if not run.get('report'):
        raise HTTPException(409, '报告尚未生成')
    existing = db.get('saved_' + identifier, 'document')
    if existing:
        return existing
    return db.put('document', {'id': 'saved_' + identifier, 'project_id': run['project_id'], 'title': run['title'], 'content': run['report'], 'source': '研究报告', 'run_id': identifier, 'is_demo': run['mode'] == 'demo'})


def visible_ticket(ticket, user):
    if user['role'] == 'admin':
        return ticket
    return ticket | {'comments': [c for c in ticket.get('comments', []) if not c.get('internal')]}


def require_ticket(identifier, request):
    ticket = require(identifier, 'ticket')
    if request.state.user['role'] != 'admin' and ticket.get('owner_id') != request.state.user['id']:
        raise HTTPException(404, '工单不存在')
    return ticket


@app.post('/api/tickets', status_code=201)
def create_ticket(data: TicketIn, request: Request):
    user = request.state.user
    return db.put('ticket', data.model_dump() | {'owner_id': user['id'], 'customer': user['email'], 'status': 'open', 'assignee': '未分配', 'comments': [], 'is_demo': False})


@app.get('/api/tickets/{identifier}')
def read_ticket(identifier: str, request: Request):
    return visible_ticket(require_ticket(identifier, request), request.state.user)


@app.patch('/api/tickets/{identifier}')
def update_ticket(identifier: str, data: TicketPatch, request: Request):
    require_ticket(identifier, request)
    changes = data.model_dump(exclude_none=True)
    if request.state.user['role'] != 'admin' and set(changes) - {'title', 'description'}:
        raise HTTPException(403, '普通用户只能编辑工单标题和描述')
    return visible_ticket(db.patch(identifier, changes), request.state.user)


@app.post('/api/tickets/{identifier}/comments')
def comment(identifier: str, data: CommentIn, request: Request):
    require_ticket(identifier, request)
    if request.state.user['role'] != 'admin':
        raise HTTPException(403, '只有管理员可以处理和回复工单')
    return db.append_comment(identifier, data.content, data.internal, request.state.user['email'])


@app.post('/api/documents', status_code=201)
def create_document(data: DocumentIn):
    require(data.project_id, 'project')
    return db.put('document', data.model_dump() | {'source': '项目资料', 'is_demo': False})


@app.put('/api/documents/{identifier}')
def update_document(identifier: str, data: DocumentIn):
    old = require(identifier, 'document')
    if old['project_id'] != data.project_id:
        raise ValueError('不能通过编辑移动资料所属项目')
    return db.patch(identifier, data.model_dump())


@app.get('/api/settings')
def get_settings():
    return settings.public_config()


@app.put('/api/settings')
def update_settings(data: SettingsIn):
    parsed = urlparse(data.base_url)
    if not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError('请输入有效的模型 API 根地址')
    if parsed.scheme != 'https' and not (parsed.scheme == 'http' and parsed.hostname in {'127.0.0.1', 'localhost'}):
        raise ValueError('远程模型地址必须使用 HTTPS；本机模型可使用 HTTP')
    return settings.save_config(data.model_dump())


@app.post('/api/settings/test')
def test_connection():
    from .providers import model
    from .graph import safe_error
    try:
        _, tokens = model([{'role': 'user', 'content': 'Reply with OK.'}])
        return {'ok': True, 'tokens': tokens}
    except Exception as exc:
        raise HTTPException(422, safe_error(exc))


from .planner import router as planner_router
from .integrations import router as integrations_router
from .planner_mcp import router as planner_mcp_router
app.include_router(planner_router)
app.include_router(integrations_router)
app.include_router(planner_mcp_router)
app.include_router(auth.router)
from .model_settings import router as model_settings_router
app.include_router(model_settings_router)

dist = Path(os.getenv('SAKUYA_WEB_DIR', str(Path(__file__).resolve().parents[2] / 'dist')))


@app.get('/human-check', include_in_schema=False)
def browser_verification_page():
    if not (dist / 'index.html').exists():
        raise HTTPException(503, '网页资源尚未构建')
    return FileResponse(dist / 'index.html', headers={'Cache-Control': 'no-store'})


if dist.exists():
    app.mount('/', StaticFiles(directory=dist, html=True), name='web')
