import ThemeSwitch from './theme-switch';
import LanguageSwitch from './language-switch';
import { useLocale, tr } from './i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, FlaskConical, Bug, Settings, SquarePen, PanelLeft, Check, X, WifiOff, ListTodo, CalendarDays, LogOut } from 'lucide-react';
import type { ModalState, Workspace, User } from './types';
import { api } from './api';
import { Loading, Empty, Modal } from './ui';
import { Presence } from './motion';
import Chat from './chat';
import HistoryList from './history';
import WorkspaceModal from './modals';
import { RunList, RunDetail, Tickets, TicketDetail } from './pages';
import type { PageProps } from './pages';
import Planner from './planner';
import ModelSettings from './model-settings';


export default function App({ user }: { user: User }) {
  useLocale();
const navigation = [
  { id: 'todos', label: tr("任务清单"), icon: ListTodo },
  { id: 'calendar', label: tr("日历"), icon: CalendarDays, LogOut },
  { id: 'research', label: tr("深度研究"), icon: FlaskConical },
  { id: 'diagnosis', label: tr("Issue 诊断"), icon: Bug },
];

  const client = useQueryClient();
  const [path, setPath] = useState(location.hash.slice(1) || 'work');
  const projectId = 'all';
  const workChatKey = `sakuya-work-chat:${user.id}`;
  const [workConversation, setWorkConversation] = useState<string | undefined>(location.hash.startsWith('#chat/') ? location.hash.slice(6) : sessionStorage.getItem(workChatKey) || undefined);
  const splitKey = `sakuya-split:${user.id}`;
  const layout = useRef<HTMLDivElement>(null);
  const historyTrigger = useRef<HTMLButtonElement>(null);
  const historyHover = useRef(false);
  useEffect(() => {
    const moved = (e: PointerEvent) => {
      const r = historyTrigger.current?.getBoundingClientRect();
      if (!r || e.clientX < 0 || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) historyHover.current = false;
    };
    window.addEventListener('pointermove', moved);
    return () => window.removeEventListener('pointermove', moved);
  }, []);
  const [split, setSplit] = useState(() => { const n = Number(localStorage.getItem(splitKey) || 46); return Number.isFinite(n) ? Math.max(30, Math.min(70, n)) : 46; });
  const [dragging, setDragging] = useState(false);
  const resize = (value: number) => { const next = Math.max(30, Math.min(70, value)); setSplit(next); localStorage.setItem(splitKey, String(next)); };
  const [edgeOpen, setEdgeOpen] = useState(false);
  const [modal, setModal] = useState<ModalState>(null);
  const [history, setHistory] = useState(false);
  const [hoverHistory, setHoverHistory] = useState(false);
  const [chatVersion, setChatVersion] = useState(0);
  const [toastText, setToastText] = useState('');
  const [deletedId, setDeletedId] = useState<string | null>(null);
  const query = useQuery({ queryKey: ['workspace'], queryFn: () => api<Workspace>('/workspace'), refetchInterval: q => q.state.data?.chats?.some(r => ['queued', 'running'].includes(r.status)) ? 800 : 5000 });
  const w = query.data;
  const navigate = useCallback((value: string) => { if (value.split('/')[0] === 'chat') { setWorkConversation(value.split('/')[1]); sessionStorage.setItem(workChatKey, value.split('/')[1] || ''); value = 'work'; } location.hash = value; setPath(value); setHistory(false); setEdgeOpen(false); }, [workChatKey]);
  const newChat = useCallback(() => { sessionStorage.removeItem(`sakuya-approval:${user.id}:new`); setChatVersion(value => value + 1); navigate('chat'); }, [navigate, user.id]);
  const close = useCallback(() => setModal(null), []);
  const closeHistory = useCallback(() => setHistory(false), []);
  const refresh = useCallback(() => { void client.invalidateQueries({ queryKey: ['workspace'] }); }, [client]);
  const toast = useCallback((text: string) => { setDeletedId(null); setToastText(text); }, []);
  function deletedConversation(identifier: string) {
    client.setQueryData<Workspace>(['workspace'], current => current ? { ...current, conversations: current.conversations.filter(c => c.id !== identifier), chats: current.chats.filter(t => t.conversation_id !== identifier) } : current);
    if (path === `chat/${identifier}` || workConversation === identifier) newChat();
    setDeletedId(identifier); setToastText("对话已删除"); refresh();
  }
  async function undoDelete() {
    if (!deletedId) return;
    try { await api(`/conversations/${deletedId}/restore`, 'POST'); refresh(); toast("对话已恢复"); } catch (e) { toast((e as Error).message); }
  }
  function selectProject() {}
  async function logout() { try { await api('/auth/logout', 'POST'); client.clear(); location.hash = 'chat'; location.reload(); } catch (e) { toast((e as Error).message); } }
  useEffect(() => { const handler = () => { const next = location.hash.slice(1) || 'work'; setPath(next); if (next.startsWith('chat/')) { setWorkConversation(next.split('/')[1]); sessionStorage.setItem(workChatKey, next.split('/')[1]); } setHistory(false); }; window.addEventListener('hashchange', handler); return () => window.removeEventListener('hashchange', handler); }, []);
  useEffect(() => { if (toastText) { const timer = setTimeout(() => setToastText(''), 4000); return () => clearTimeout(timer); } }, [toastText]);
  useEffect(() => { const handler = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); setHistory(false); setModal({ type: 'search' }); } }; window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler); }, []);
  const [view, id] = path.split('/');
  const admin = user.role === 'admin';
  const isChat = view === 'chat' || view === 'overview';
  const isWork = !['settings', 'tickets', 'ticket'].includes(view);
  const active = view === 'run' ? w?.runs.find(r => r.id === id)?.kind : view;
  const props: PageProps | null = w ? { workspace: w, projectId, navigate, open: setModal, refresh, toast, selectProject } : null;
  let content;
  if (query.isLoading) content = <Loading />;
  else if (!props) content = <Empty title={tr("暂时无法连接")} description={tr("请确认本机服务已启动。")} icon={<WifiOff size={26} />} action={<button className="button" onClick={() => query.refetch()}>{tr("重新连接")}</button>} />;
  else if (view === 'ticket') content = <TicketDetail key={id} id={id} {...props} />;
  else if (view === 'tickets') content = <Tickets {...props} />;
  else if (view === 'todos' || view === 'calendar') content = <Planner accountId={user.id} calendar={view === 'calendar'} navigate={navigate} toast={toast} />;
  else if (view === 'research' || view === 'diagnosis') content = <RunList key={view} kind={view} {...props} />;
  else if (view === 'run') content = <RunDetail key={id} id={id} {...props} />;
  else if (view === 'settings') content = <ModelSettings {...props} />;
  const hasPanel = isWork && !['chat', 'overview', 'work', 'projects', 'knowledge', 'document'].includes(view);

  return <div className="app-shell minimal-shell">
    <header className="quiet-header" inert={history || !!modal}>
      <div className="header-left">{<button className="icon-button" aria-label={tr("打开聊天记录")} title={tr("聊天记录")} onClick={() => { setHoverHistory(false); setHistory(true); }}><PanelLeft size={19} /></button>}<button className="wordmark" onClick={() => navigate('chat')}><img src="/sakuya.svg" alt="" />Sakuya</button><ThemeSwitch /><LanguageSwitch /></div>
      <div className="header-right"><span className="account-label" title={user.username}>{user.username}{admin ? ` · ${tr("管理员")}` : ''}</span>{<><button className="icon-button" aria-label={tr("新对话")} title={tr("新对话")} onClick={newChat}><SquarePen size={19} /></button><button className="icon-button" aria-label={tr("设置")} title={tr("设置")} onClick={() => navigate('settings')}><Settings size={19} /></button><ThemeSwitch control="toggle" /></>}<button className="icon-button" aria-label={tr("退出登录")} title={tr("退出登录")} onClick={() => void logout()}><LogOut size={18} /></button></div>
    </header>
    {(isChat || isWork) && props ? <div ref={layout} style={{ '--chat-share': `${split}%` } as React.CSSProperties} className={`work-layout ${hasPanel ? 'has-panel' : ''} ${dragging ? 'is-resizing' : ''}`} inert={history || !!modal}>
      <aside className="work-edge history-edge"><button ref={historyTrigger} className="work-edge-trigger" aria-label={tr("展开聊天记录")} onMouseEnter={() => { if (!dragging && !historyHover.current) { historyHover.current = true; setHoverHistory(true); setHistory(true); } }} onClick={() => { setHoverHistory(true); setHistory(true); }}><span /></button></aside>
      <div className="main-scroll chat-scroll"><main className="chat-main"><Chat key={chatVersion} conversationId={isChat ? id : workConversation} workMode {...props} /></main></div>

      {hasPanel && <div className="pane-divider" role="separator" tabIndex={0} aria-label={tr('调整左右区域比例')} aria-orientation="vertical" aria-valuenow={Math.round(split)} aria-valuemin={30} aria-valuemax={70}
        onPointerDown={e => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); setDragging(true); }}
        onPointerMove={e => { if (!e.currentTarget.hasPointerCapture(e.pointerId)) return; const rect = layout.current!.getBoundingClientRect(); resize((e.clientX - rect.left - 44) / (rect.width - 88) * 100); }}
        onPointerUp={e => { e.currentTarget.releasePointerCapture(e.pointerId); setDragging(false); }} onLostPointerCapture={() => setDragging(false)}
        onKeyDown={e => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) { e.preventDefault(); resize(e.key === 'Home' ? 30 : e.key === 'End' ? 70 : split + (e.key === 'ArrowRight' ? 2 : -2)); } }}><span /></div>}
      {hasPanel && <section className={`work-feature view-${view}`} aria-label={tr("工作功能区域")}><div className="feature-toolbar"><span>{navigation.find(n => n.id === active)?.label || tr("工作区")}</span><button className="icon-button" aria-label={tr("收起功能区域")} onClick={() => navigate('work')}><X size={18} /></button></div><div className="page-content">{content}</div></section>}
      {isWork && <aside className={`work-edge ${edgeOpen ? 'is-open' : ''}`} onMouseEnter={() => setEdgeOpen(true)} onMouseLeave={() => setEdgeOpen(false)} onKeyDown={e => { if (e.key === 'Escape') setEdgeOpen(false); }}><button className="work-edge-trigger" aria-label={tr("打开工作功能")} aria-expanded={edgeOpen} onFocus={() => setEdgeOpen(true)} onClick={() => setEdgeOpen(v => !v)}><span /></button><nav className="work-edge-menu" aria-label={tr("工作功能")}>{navigation.map(n => <button key={n.id} className={active === n.id ? 'selected' : ''} onClick={() => navigate(n.id)}><n.icon size={18} /><span>{n.label}</span></button>)}</nav></aside>}
    </div> : <div className="main-scroll" inert={history || !!modal}><main className={`page-content view-${view}`}>{content}</main></div>}
    <Presence show={history} className="history-presence"><Modal title={tr("聊天记录")} close={closeHistory} leave={hoverHistory ? closeHistory : undefined}><div className="history-body"><button className="history-new" onClick={newChat}><SquarePen size={17} />{tr("新对话")}</button><button className="history-search" onClick={() => { setHistory(false); setModal({ type: 'search' }); }}><Search size={16} />{tr("搜索工作区")}<kbd>Ctrl K</kbd></button><HistoryList conversations={w?.conversations || []} selectedId={isChat ? id : workConversation} navigate={navigate} deleted={deletedConversation} toast={toast} /></div></Modal></Presence>
    <Presence show={!!modal && !!w} className="dialog-presence">{modal && w && <WorkspaceModal key={modal.type + (modal.type === 'run' ? modal.kind : '')} modal={modal} workspace={w} projectId={projectId} close={close} navigate={navigate} refresh={refresh} toast={toast} />}</Presence>
    <Presence show={!!toastText} className="toast-presence"><div role="status" className="toast"><Check size={16} /><span>{tr(toastText)}</span>{deletedId && <button className="text-button" onClick={() => void undoDelete()}>{tr("撤销")}</button>}<button className="icon-button" aria-label={tr("关闭提示")} onClick={() => setToastText('')}><X size={14} /></button></div></Presence>
  </div>;
}
