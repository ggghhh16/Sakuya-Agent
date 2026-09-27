import { useLocale, tr } from './i18n';
import { useEffect, useRef, useState } from 'react';
import { ArrowUp, ChevronDown, Plus, MessageCircle, Globe, Bug, Ticket, Check, Square, ArrowUpRight, RotateCcw, Copy, LoaderCircle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useQueryClient } from '@tanstack/react-query';
import type { PageProps } from './pages';
import type { ChatTurn, Conversation, Run, Workspace } from './types';
import { api } from './api';
import { Popover, Presence } from './motion';
import { Empty } from './ui';


export default function Chat({ workspace, conversationId, navigate, refresh, toast, workMode = false }: PageProps & { conversationId?: string; workMode?: boolean }) {
  useLocale();
const assistants = [
  { id: 'chat', label: tr("聊天助手"), detail: tr("讨论、写作与日常问答"), icon: MessageCircle, placeholder: tr("有什么想聊的？") },
  { id: 'research', label: tr("深度研究"), detail: tr("检索资料，生成有来源的报告"), icon: Globe, placeholder: tr("你想研究什么？") },
  { id: 'diagnosis', label: tr("Issue 诊断"), detail: tr("调查代码问题与可能的原因"), icon: Bug, placeholder: tr("描述遇到的问题…") },
];

  const cache = useQueryClient();
  const [assistant, setAssistant] = useState('chat');
  const [draft, setDraft] = useState('');
  const [menu, setMenu] = useState<'agents' | 'options' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [demo, setDemo] = useState(!workspace.settings.model_configured);
  const [experiment, setExperiment] = useState(false);
  const [plannerTools, setPlannerTools] = useState(localStorage.getItem('sakuya-planner-tools' + ':' + workspace.user.id) !== 'false');
  const submitting = useRef(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const turns = (workspace.chats || []).filter(t => t.conversation_id === conversationId).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const active = turns.find(t => t.status === 'queued' || t.status === 'running');
  const chosen = assistants.find(a => a.id === assistant)!;
  const [modelId, setModelId] = useState(localStorage.getItem('sakuya-chat-model' + ':' + workspace.user.id) || workspace.settings.default_model_id);
  const [effort, setEffort] = useState(0);
  const efforts = ['default', 'low', 'medium', 'high'];
  const selectedModel = workspace.settings.models.find(m => m.id === modelId);
  useEffect(() => { if (!workspace.settings.models.some(m => m.id === modelId)) { setModelId(workspace.settings.default_model_id); setEffort(0); } }, [workspace.settings.models, workspace.settings.default_model_id, modelId]);
  const hasMessages = turns.length > 0;
  const lastStatus = turns.at(-1)?.status;
  useEffect(() => { setDemo(!workspace.settings.model_configured); }, [workspace.settings.model_configured]);
  useEffect(() => { setDraft(''); setError(''); setMenu(null); setAssistant('chat'); }, [conversationId]);
  useEffect(() => { const el = input.current; if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 180)}px`; } }, [draft]);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'end' }); }, [turns.length, lastStatus]);

  async function send() {
    const prompt = draft.trim();
    if (!prompt || active || submitting.current) return;
    if (assistant !== 'chat' && prompt.length < 5) { setError("请再补充一点问题背景，至少输入 5 个字符。"); return; }
    submitting.current = true; setBusy(true); setError(''); setMenu(null);
    try {
      if (assistant === 'chat') {
        const result = await api<{ conversation: Conversation; run: ChatTurn }>('/chat', 'POST', { prompt, conversation_id: conversationId || null, mode: demo ? 'demo' : 'live', planner_tools: plannerTools, time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone, model_id: modelId || null, reasoning_effort: selectedModel?.reasoning ? efforts[effort] : 'default' });
        cache.setQueryData<Workspace>(['workspace'], current => current ? { ...current, conversations: [result.conversation, ...current.conversations.filter(c => c.id !== result.conversation.id)].sort((a, b) => a.position - b.position), chats: [...current.chats, result.run] } : current);
        setDraft(''); refresh();
        if (conversationId !== result.conversation.id) navigate(`chat/${result.conversation.id}`);
      } else {
        const result = await api<Run>('/runs', 'POST', { title: prompt.slice(0, 100), prompt, kind: assistant, mode: demo ? 'demo' : 'live', experiment, model_id: modelId || null, reasoning_effort: selectedModel?.reasoning ? efforts[effort] : 'default' });
        setDraft(''); refresh(); navigate(`run/${result.id}`);
      }
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); submitting.current = false; input.current?.focus(); }
  }
  async function stop() { if (!active) return; try { await api(`/runs/${active.id}/cancel`, 'POST'); refresh(); } catch (e) { setError((e as Error).message); } }
  async function retry(turn: ChatTurn) { try { await api(`/runs/${turn.id}/retry`, 'POST'); refresh(); } catch (e) { setError((e as Error).message); } }
  if (conversationId && !workspace.conversations?.some(c => c.id === conversationId)) return <Empty title={tr("对话不存在或已删除")} description={tr("可以开始新对话。")} action={<button className="button" onClick={() => navigate('chat')}>{tr("新对话")}</button>} />;

  return <section className={`chat-page ${hasMessages ? 'with-messages' : 'empty-chat'}`}>
    <label className="planner-chat-toggle"><input type="checkbox" checked={plannerTools} onChange={e => { setPlannerTools(e.target.checked); localStorage.setItem('sakuya-planner-tools' + ':' + workspace.user.id, String(e.target.checked)); }} />{tr("任务与日历 MCP")}{demo ? tr(" · 演示模式不执行") : ''}<button type="button" onClick={() => navigate('calendar')}>{tr("打开日历")}</button></label>
    {!hasMessages && <div className="chat-greeting"><span className="greeting-mark" aria-hidden="true">✳</span><h1>{workMode ? tr("今天想做些什么？") : tr("今天有什么想聊的？")}</h1></div>}
    {hasMessages && <div className="conversation" aria-label={tr("对话内容")}>{turns.map(turn => <div className="chat-turn" key={turn.id}>
      <div className="user-message"><p>{turn.prompt}</p></div>
      <div className="assistant-message"><span className="assistant-mark" aria-hidden="true">✳</span><div className="assistant-content">
        {turn.tool_log?.length ? <div className="chat-tool-log">{turn.tool_log.map(t => <span key={t.id} className={t.error ? 'danger-text' : ''}>{t.error ? tr("失败") : tr("已执行")} · {t.name}</span>)}</div> : null}
        {turn.report ? <><div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{turn.report}</ReactMarkdown></div><div className="message-tools">{turn.mode === 'demo' && <span>{tr("演示回复")}</span>}<button className="icon-button" aria-label={tr("复制回复")} onClick={async () => { try { await navigator.clipboard.writeText(turn.report); toast("已复制回复"); } catch { toast("复制失败，请手动选择文字复制"); } }}><Copy size={14} /></button></div></> : turn.status === 'failed' ? <div className="chat-failure"><p role="alert">{turn.error || tr("回复失败，请重试。")}</p><button className="text-button" onClick={() => retry(turn)} disabled={!!active}><RotateCcw size={13} />{tr("重试")}</button></div> : turn.status === 'cancelled' ? <p className="chat-muted">{tr("已停止生成")}</p> : <div className="reply-pending" role="status"><span /><span /><span /><small>{turn.status === 'queued' ? tr("等待回复") : tr("正在回复")}</small></div>}
      </div></div>
    </div>)}<div ref={bottom} /></div>}
    <div className="composer-dock"><form className="chat-composer" onSubmit={e => { e.preventDefault(); void send(); }}>
      <textarea ref={input} aria-label={tr("聊天消息")} placeholder={chosen.placeholder} value={draft} maxLength={16000} rows={1} onChange={e => { setDraft(e.target.value); setError(''); }} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); void send(); } }} />
      <div className="composer-toolbar"><div className="composer-controls"><div className="popover-anchor"><button type="button" className={`composer-plus ${menu === 'options' ? 'expanded' : ''}`} aria-label={tr("对话选项")} aria-expanded={menu === 'options'} onClick={() => setMenu(menu === 'options' ? null : 'options')}><Plus size={21} /></button><Popover open={menu === 'options'} close={() => setMenu(null)} label={tr("对话选项")} className="options-popover"><div className="composer-options"><span className="popover-caption">{tr("运行选项")}</span><label className="option-toggle"><span>{tr("演示模式")}</span><input type="checkbox" checked={demo} disabled={!workspace.settings.model_configured} onChange={e => setDemo(e.target.checked)} /></label>{!workspace.settings.model_configured && <button className="connection-link" type="button" onClick={() => navigate('settings')}>{tr("连接模型，开始真实对话")}<ArrowUpRight size={13} /></button>}{assistant !== 'chat' && <><label className="option-toggle"><span>{tr("生成验证实验")}</span><input type="checkbox" checked={experiment} onChange={e => setExperiment(e.target.checked)} /></label></>}</div></Popover></div>
      <div className="popover-anchor"><button type="button" className="assistant-picker" aria-label={tr("选择助手，当前：{0}", [chosen.label])} aria-expanded={menu === 'agents'} onClick={() => setMenu(menu === 'agents' ? null : 'agents')}><chosen.icon size={15} /><span>{chosen.label}</span><ChevronDown size={13} className={menu === 'agents' ? 'rotate' : ''} /></button><Popover open={menu === 'agents'} close={() => setMenu(null)} label={tr("选择助手")} className="agent-popover"><span className="popover-caption">{tr("选择助手")}</span>{assistants.map(a => <button key={a.id} type="button" className={`agent-option ${assistant === a.id ? 'selected' : ''}`} aria-pressed={assistant === a.id} onClick={() => { setAssistant(a.id); setMenu(null); input.current?.focus(); }}><a.icon size={18} /><span>{a.label}<small>{a.detail}</small></span>{assistant === a.id && <Check size={15} />}</button>)}<div className="popover-divider" /><button type="button" className="agent-option" onClick={() => navigate('tickets')}><Ticket size={18} /><span>{tr("客服工单")}<small>{workspace.user.role === 'admin' ? tr("处理工单，发起关联诊断") : tr("提交问题，查看处理回复")}</small></span><ArrowUpRight size={15} /></button></Popover></div></div>
      <div className="composer-end"><span className="composer-mode">{demo ? tr("演示模式") : ''}</span>{active ? <button type="button" className="send-button stop-button" aria-label={tr("停止生成")} onClick={() => void stop()}><Square size={14} fill="currentColor" /></button> : <button type="submit" className="send-button" aria-label={tr("发送消息")} disabled={!draft.trim() || busy}>{busy ? <LoaderCircle size={18} className="spin" /> : <ArrowUp size={19} />}</button>}</div></div>
      <div className="model-controls"><label>{tr("模型")}<select aria-label={tr("聊天模型")} value={modelId} onChange={e => { setModelId(e.target.value); localStorage.setItem('sakuya-chat-model' + ':' + workspace.user.id, e.target.value); setEffort(0); }}>{!workspace.settings.models.length && <option value="">{tr("请在设置添加模型")}</option>}{workspace.settings.models.map(m => <option key={m.id} value={m.id}>{workspace.settings.providers.find(p => p.id === m.provider_id)?.name} · {m.name}</option>)}</select></label><label className="reasoning-control">{tr("思考强度")}<output>{selectedModel?.reasoning ? [tr("默认"), tr("低"), tr("中"), tr("高")][effort] : tr("默认")}</output><input type="range" aria-label={tr("思考强度")} min="0" max="3" step="1" value={selectedModel?.reasoning ? effort : 0} disabled={!selectedModel?.reasoning || demo} onChange={e => setEffort(Number(e.target.value))} title={!selectedModel?.reasoning ? tr("在设置中为支持的模型启用思考强度") : undefined} /></label></div>
    </form><Presence show={!!error} className="composer-error"><p role="alert">{tr(error)}</p></Presence>{hasMessages && <p className="composer-footnote">{demo ? tr("演示回复未调用模型") : tr("AI 的回答可能有误，请核实重要信息")}</p>}</div>
    {!hasMessages && <div className="chat-shortcuts"><button onClick={() => { setAssistant('research'); input.current?.focus(); }}><Globe size={15} />{tr("研究一个问题")}</button><button onClick={() => { setAssistant('diagnosis'); input.current?.focus(); }}><Bug size={15} />{tr("排查代码问题")}</button><button onClick={() => navigate('tickets')}><Ticket size={15} />{workspace.user.role === 'admin' ? tr("处理工单") : tr("我的工单")}</button></div>}
  </section>;
}
