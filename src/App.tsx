import LanguageSwitch from './language-switch';
import { useLocale, tr } from './i18n';
import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, FlaskConical, Bug, Ticket, Settings, SquarePen, PanelLeft, Moon, Sun, Check, X, WifiOff, ListTodo, CalendarDays, LogOut } from 'lucide-react';
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
  const [path, setPath] = useState(location.hash.slice(1) || 'chat');
  const projectId = 'all';
  const workChatKey = `sakuya-work-chat:${user.id}`;
  const [work, setWork] = useState(!['chat', 'overview', 'settings'].includes(location.hash.slice(1).split('/')[0] || 'chat'));
  const [workConversation, setWorkConversation] = useState<string | undefined>(sessionStorage.getItem(workChatKey) || undefined);
  const [edgeOpen, setEdgeOpen] = useState(false);
  const [modal, setModal] = useState<ModalState>(null);
  const [history, setHistory] = useState(false);
  const [chatVersion, setChatVersion] = useState(0);
  const [toastText, setToastText] = useState('');
  const [deletedId, setDeletedId] = useState<string | null>(null);
  const [theme, setTheme] = useState(localStorage.getItem('sakuya-theme') || 'dark');
  const query = useQuery({ queryKey: ['workspace'], queryFn: () => api<Workspace>('/workspace'), refetchInterval: q => q.state.data?.chats?.some(r => ['queued', 'running'].includes(r.status)) ? 800 : 5000 });
  const w = query.data;
  const navigate = useCallback((value: string) => { if (value.startsWith('chat')) { setWorkConversation(value.split('/')[1]); sessionStorage.setItem(workChatKey, value.split('/')[1] || ''); if (work) value = 'work'; } else if (['work', 'todos', 'calendar', 'research', 'diagnosis', 'run'].includes(value.split('/')[0])) setWork(true); location.hash = value; setPath(value); setHistory(false); setEdgeOpen(false); }, [work, workChatKey]);
  const newChat = useCallback(() => { setChatVersion(value => value + 1); navigate('chat'); }, [navigate]);
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
  useEffect(() => { const handler = () => { setPath(location.hash.slice(1) || 'chat'); setHistory(false); }; window.addEventListener('hashchange', handler); return () => window.removeEventListener('hashchange', handler); }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('sakuya-theme', theme); }, [theme]);
  useEffect(() => { if (toastText) { const timer = setTimeout(() => setToastText(''), 4000); return () => clearTimeout(timer); } }, [toastText]);
  useEffect(() => { const handler = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); setHistory(false); setModal({ type: 'search' }); } }; window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler); }, []);
  const [view, id] = path.split('/');
  const admin = user.role === 'admin';
  const isChat = view === 'chat' || view === 'overview';
  const isWork = work && view !== 'settings' && !isChat;
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
  const hasPanel = isWork && !['work', 'projects', 'knowledge', 'document'].includes(view);

  return <div className="app-shell minimal-shell">
    <header className="quiet-header" inert={history || !!modal}>
      <div className="header-left">{<button className="icon-button" aria-label={tr("打开聊天记录")} title={tr("聊天记录")} onClick={() => setHistory(true)}><PanelLeft size={19} /></button>}<button className="wordmark" onClick={() => navigate('chat')}>Sakuya<span>✳</span></button></div>
      {<nav className="mode-switch" aria-label={tr("主视图")}><span className={`mode-indicator ${work ? 'at-work' : ''}`} /><button aria-current={!work ? 'page' : undefined} onClick={() => { setWork(false); const target = workConversation ? `chat/${workConversation}` : 'chat'; location.hash = target; setPath(target); }}>{tr("聊天")}</button><button aria-current={work ? 'page' : undefined} onClick={() => { if (isChat) { setWorkConversation(id); sessionStorage.setItem(workChatKey, id || ''); } setWork(true); navigate('work'); }}>{tr("工作")}</button></nav>}
      <div className="header-right"><span className="account-label" title={user.email}>{admin ? tr("管理员") : user.email}</span>{<><button className="icon-button" aria-label={tr("新对话")} title={tr("新对话")} onClick={newChat}><SquarePen size={19} /></button><button className="icon-button" aria-label={tr("设置")} title={tr("设置")} onClick={() => navigate('settings')}><Settings size={19} /></button><LanguageSwitch /></>}<button className="icon-button" aria-label={tr("工单")} title={tr("工单")} onClick={() => navigate('tickets')}><Ticket size={19} /></button><button className="icon-button" aria-label={tr("退出登录")} title={tr("退出登录")} onClick={() => void logout()}><LogOut size={18} /></button></div>
    </header>
    {(isChat || isWork) && props ? <div className={`work-layout ${hasPanel ? 'has-panel' : ''}`} inert={history || !!modal}>
      <div className="main-scroll chat-scroll"><main className="chat-main"><Chat key={chatVersion} conversationId={isChat ? id : workConversation} workMode={isWork} {...props} /></main></div>
      {isWork && <aside className={`work-edge ${edgeOpen ? 'is-open' : ''}`} onMouseEnter={() => setEdgeOpen(true)} onMouseLeave={() => setEdgeOpen(false)} onKeyDown={e => { if (e.key === 'Escape') setEdgeOpen(false); }}><button className="work-edge-trigger" aria-label={tr("打开工作功能")} aria-expanded={edgeOpen} onFocus={() => setEdgeOpen(true)} onClick={() => setEdgeOpen(v => !v)}><span /></button><nav className="work-edge-menu" aria-label={tr("工作功能")}>{navigation.map(n => <button key={n.id} className={active === n.id ? 'selected' : ''} onClick={() => navigate(n.id)}><n.icon size={18} /><span>{n.label}</span></button>)}</nav></aside>}
      {hasPanel && <section className={`work-feature view-${view}`} aria-label={tr("工作功能区域")}><div className="feature-toolbar"><span>{navigation.find(n => n.id === active)?.label || tr("工作区")}</span><button className="icon-button" aria-label={tr("收起功能区域")} onClick={() => navigate('work')}><X size={18} /></button></div><div className="page-content">{content}</div></section>}
    </div> : <div className="main-scroll" inert={history || !!modal}><main className={`page-content view-${view}`}>{content}</main></div>}
    <Presence show={history} className="history-presence"><Modal title={tr("聊天记录")} close={closeHistory}><div className="history-body"><button className="history-new" onClick={newChat}><SquarePen size={17} />{tr("新对话")}</button><button className="history-search" onClick={() => { setHistory(false); setModal({ type: 'search' }); }}><Search size={16} />{tr("搜索工作区")}<kbd>Ctrl K</kbd></button><HistoryList conversations={w?.conversations || []} selectedId={isChat ? id : undefined} navigate={navigate} deleted={deletedConversation} toast={toast} /><button className="theme-switch" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}{tr(theme === 'dark' ? "切换浅色主题" : "切换深色主题")}</button></div></Modal></Presence>
    <Presence show={!!modal && !!w} className="dialog-presence">{modal && w && <WorkspaceModal key={modal.type + (modal.type === 'run' ? modal.kind : '')} modal={modal} workspace={w} projectId={projectId} close={close} navigate={navigate} refresh={refresh} toast={toast} />}</Presence>
    <Presence show={!!toastText} className="toast-presence"><div role="status" className="toast"><Check size={16} /><span>{tr(toastText)}</span>{deletedId && <button className="text-button" onClick={() => void undoDelete()}>{tr("撤销")}</button>}<button className="icon-button" aria-label={tr("关闭提示")} onClick={() => setToastText('')}><X size={14} /></button></div></Presence>
  </div>;
}
