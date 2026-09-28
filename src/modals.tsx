import { useLocale, tr } from './i18n';
import { useState } from 'react';
import { Search, ArrowRight, FileText, Ticket as TicketIcon, FlaskConical, Bug } from 'lucide-react';
import type { ModalState, Workspace, Navigate, Run, Ticket } from './types';
import { api } from './api';
import { Modal, Field, Disclosure, kindLabels } from './ui';

interface Props { modal: Exclude<ModalState, null>; workspace: Workspace; projectId: string; close: () => void; navigate: Navigate; refresh: () => void; toast: (message: string) => void }
export default function WorkspaceModal({ modal, workspace, close, navigate, refresh, toast }: Props) {
  useLocale();
  const [title, setTitle] = useState(modal.type === 'run' ? modal.ticket?.title || '' : '');
  const [content, setContent] = useState(modal.type === 'run' ? modal.ticket?.description || '' : '');
  const [repository, setRepository] = useState(''), [urls, setUrls] = useState(''), [search, setSearch] = useState('');
  const [demo, setDemo] = useState(!workspace.settings.model_configured), [experiment, setExperiment] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  if (modal.type === 'search') {
    const results = [...workspace.conversations.map(x => ({ title: x.title, type: tr("对话"), path: `chat/${x.id}`, icon: FileText })), ...workspace.runs.filter(x => x.kind !== 'diagnosis' || workspace.settings.experimental_features).map(x => ({ title: x.title, type: kindLabels[x.kind], path: `run/${x.id}`, icon: x.kind === 'research' ? FlaskConical : Bug })), ...workspace.tickets.map(x => ({ title: x.title, type: tr("工单"), path: `ticket/${x.id}`, icon: TicketIcon }))].filter(x => x.title.toLowerCase().includes(search.toLowerCase())).slice(0, 12);
    return <Modal title={tr("搜索工作区")} close={close}><div className="command-search"><Search size={20} /><input aria-label={tr("搜索任务或工单")} placeholder={tr("搜索任务或工单…")} value={search} onChange={e => setSearch(e.target.value)} /></div><div className="command-results">{results.map(r => <button key={r.path} onClick={() => { navigate(r.path); close(); }}><r.icon size={17} /><span>{r.title}</span><small>{r.type}</small><ArrowRight size={14} /></button>)}{!results.length && <p>{tr("没有找到相关内容。")}</p>}</div></Modal>;
  }
  if (modal.type !== 'run' && modal.type !== 'ticket') return null;
  const runModal = modal.type === 'run' ? modal : null;
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      if (runModal) {
        const run = await api<Run>('/runs', 'POST', { title, prompt: content, kind: runModal.kind, repository, project_id: runModal.ticket?.project_id || '', mode: demo ? 'demo' : 'live', experiment, urls: urls.split('\n').map(x => x.trim()).filter(Boolean), ticket_id: runModal.ticket?.id || null }); navigate(`run/${run.id}`); toast("任务已加入队列");
      } else {
        const ticket = await api<Ticket>('/tickets', 'POST', { title, description: content }); navigate(`ticket/${ticket.id}`); toast("工单已发送");
      }
      refresh(); close();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <Modal title={runModal ? tr("新建{0}", [kindLabels[runModal.kind]]) : tr("新建工单")} close={close}><form onSubmit={submit} className="editor-form"><Field label={tr("标题")}><input required maxLength={160} value={title} onChange={e => setTitle(e.target.value)} /></Field><Field label={runModal ? tr("问题与约束") : tr("问题描述")}><textarea required minLength={runModal ? 5 : 1} maxLength={16000} rows={5} value={content} onChange={e => setContent(e.target.value)} /></Field>
    {runModal?.kind === 'diagnosis' && <Field label={tr("GitHub 仓库地址（可选）")}><input type="url" placeholder="https://github.com/owner/repo" value={repository} onChange={e => setRepository(e.target.value)} /></Field>}
    {runModal && <><Disclosure label={tr("资料链接与实验选项")}><Field label={tr("资料链接，每行一个（最多 5 个）")}><textarea rows={2} value={urls} onChange={e => setUrls(e.target.value)} /></Field><label className="check-row"><input type="checkbox" checked={experiment} onChange={e => setExperiment(e.target.checked)} />{tr("生成最小验证实验（执行前须审核脚本）")}</label></Disclosure><label className="check-row"><input type="checkbox" checked={demo} onChange={e => setDemo(e.target.checked)} />{tr("演示模式")}</label></>}
    {error && <p role="alert" className="form-error">{tr(error)}</p>}<div className="modal-actions"><button type="button" className="button" onClick={close}>{tr("取消")}</button><button className="button primary" disabled={busy}>{busy ? tr("提交中…") : runModal ? tr("开始任务") : tr("发送工单")}</button></div></form></Modal>;
}
