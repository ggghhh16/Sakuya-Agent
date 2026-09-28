import { weekdays } from './i18n';
import { useLocale, tr, getLocale } from './i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FloatingRect } from './ui';
import type { FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Eye, Check, ChevronLeft, ChevronRight, Circle, ListTodo, PanelRight, Plus, Minus, RefreshCw, Search, Settings2, Trash2, X } from 'lucide-react';
import { api } from './api';
import { Presence } from './motion';
import { Field, Loading, Modal } from './ui';
import PlannerCalendar from './planner-calendar';
import CalendarFocus from './calendar-focus';
import type { TimeRange } from './calendar-focus';
import { usePlannerEditor } from './use-planner-editor';
import type { Connections, Entry, PlannerData, ProviderName, TodoList } from './planner-types';
import { addDays, blankEntry, clockTime, entryBody, localDay, localInput, midnight, weekStart } from './planner-types';
import './planner.css';
import TaskWorkspace from './task-workspace';
import PlannerListRow from './planner-list-row';
import PlanningSplit from './planning-split';
import {connectInBrowser} from './connect-browser';
import ContextMenu,{pointRect} from './context-menu';
import type {MenuPoint} from './context-menu';

const colors = ['#a899ed', '#7cacf8', '#71cbb4', '#efbc78', '#eb8a9f', '#aab4c0'];
type Props = { accountId: string; calendar: boolean; targetId?: string; navigate: (path: string) => void; toast: (message: string) => void };

export default function Planner({accountId, calendar, targetId, navigate, toast}: Props) {
  useLocale();
  const cache = useQueryClient();
  const query = useQuery({queryKey: ['planner'], queryFn: () => api<PlannerData>('/planner'), refetchInterval: 5000});
  const [selected, setSelected] = useState(localStorage.getItem('sakuya-selected-list' + ':' + accountId) || 'all');
  const [planningOpen, setPlanningOpen] = useState(false);
  const [hidden, setHidden] = useState<string[]>([]);
  const [date, setDate] = useState(new Date());
  const [rangeStart, setRangeStart] = useState(() => weekStart(new Date()));
  const [dayCount, setDayCount] = useState(() => { const n = Number(localStorage.getItem('sakuya-calendar-days:' + accountId) || 7); return Number.isInteger(n) ? Math.max(1, Math.min(14, n)) : 7; });
  const [editorDragging, setEditorDragging] = useState(false);
  const [editorBusy, setEditorBusy] = useState(false);
  const [mode, setMode] = useState<'day' | 'week' | 'month'>(() => { const value = localStorage.getItem('sakuya-calendar-view' + ':' + accountId); return value === 'day' || value === 'month' ? value : 'week'; });
  const [focused, setFocused] = useState(false);
  const [focusRange, setFocusRange] = useState<TimeRange>([8 * 60, 20 * 60]);
  const [search, setSearch] = useState('');
  const [calendarContext,setCalendarContext]=useState<{point:MenuPoint;entry?:Entry;start:string;end:string;allDay:boolean}|null>(null);
  const [renaming,setRenaming]=useState<{entry:Entry;point:MenuPoint}|null>(null),[renameTitle,setRenameTitle]=useState('');
  const [editing, setEditing] = useState<Entry | null>(null);
  const [entryAnchor, setEntryAnchor] = useState<FloatingRect | null>(null);
  const [preview, setPreview] = useState<Entry | null>(null);
  const [listEdit, setListEdit] = useState<TodoList | null>(null);
  const [listAnchor, setListAnchor] = useState<FloatingRect | null>(null);
  const listOrderBusy = useRef(false);
  const [connections, setConnections] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [undo, setUndo] = useState<Entry | null>(null);
  const [miniMonth, setMiniMonth] = useState(new Date());
  const [autosync, setAutosync] = useState(localStorage.getItem('sakuya-autosync' + ':' + accountId) === 'true');
  const changing = useRef(new Set<string>());
  const taskLeave = useRef<(() => Promise<boolean>) | null>(null);
  const taskSwitchBusy = useRef(false);
  const switchTask = async (action: () => void) => {
    if (taskSwitchBusy.current) return;
    taskSwitchBusy.current = true;
    try { if (!taskLeave.current || await taskLeave.current()) action(); }
    finally { taskSwitchBusy.current = false; }
  };
  const refresh = useCallback(() => { void cache.invalidateQueries({queryKey: ['planner']}); }, [cache]);
  const closeEntry = useCallback(() => { setEditing(null); setPreview(null); setEntryAnchor(null); setEditorDragging(false); }, []);
  const closeList = useCallback(() => setListEdit(null), []);
  const closeConnections = useCallback(() => setConnections(false), []);
  const data = query.data;
  const openedReference = useRef('');
  useEffect(() => {
    if (!targetId || !data || openedReference.current === targetId) return;
    openedReference.current = targetId;
    const entry = data.entries.find(item => item.id === targetId.split('/')[0]);
    if (!entry) { toast(tr('引用的任务或日程已删除')); return; }
    void switchTask(() => {
      setSelected(entry.list_id); setSearch(''); setHidden(items => items.filter(id => id !== entry.list_id));
      if (calendar && entry.start) { const date = new Date(entry.all_day ? entry.start + 'T12:00:00' : entry.start); setDate(date); setRangeStart(midnight(date)); setMode('day'); setFocused(false); }
      setEditing(entry); setPreview(entry); setEntryAnchor(null);
      requestAnimationFrame(() => requestAnimationFrame(() => document.querySelector(`[data-entry-id="${CSS.escape(entry.id)}"], [data-task-id="${CSS.escape(entry.id)}"]`)?.scrollIntoView({block: 'center'})));
    });
  }, [targetId, data, calendar]);
  useEffect(() => { localStorage.setItem('sakuya-calendar-view' + ':' + accountId, mode); }, [mode, accountId]);
  useEffect(() => { localStorage.setItem('sakuya-selected-list' + ':' + accountId, selected); }, [selected, accountId]);
  useEffect(() => { localStorage.setItem('sakuya-calendar-days:' + accountId, String(dayCount)); }, [dayCount, accountId]);
  const busyDialog = !!editing || !!listEdit || connections;
  const openEntry = (entry: Entry, anchor?: FloatingRect) => { setEntryAnchor(anchor || null); setPreview(entry); setEditing(entry); };
  const moveDraft = (entry: Entry, anchor?: FloatingRect) => { const next = {...entry, id: entry.id === '__preview' ? '' : entry.id}; setPreview(next); setEditing(next); setEntryAnchor(anchor || null); };
  const chooseDate = (d: Date) => { setDate(d); setRangeStart(midnight(d)); };
  const today = () => { const d = new Date(); chooseDate(d); setMiniMonth(d); };
  const changeDayCount = (delta: number) => { if (mode !== 'week') { setMode('week'); setRangeStart(midnight(date)); } setDayCount(n => Math.max(1, Math.min(14, (mode === 'day' ? 1 : n) + delta))); };
  const newEntry = useCallback((kind: Entry['kind'] = calendar ? 'event' : 'task', start?: string, end?: string, allDay = false, anchor?: FloatingRect) => {
    const listing = data?.lists.find(l=>l.id===(kind==='event'?data.preferences?.default_calendar_list:data.preferences?.default_task_list)&&!l.read_only) || data?.lists.find(l => l.id === selected&&!l.read_only) || data?.lists.find(l=>!l.read_only); if (!listing) return;
    if (kind === 'event' && !start) { const d = new Date(date); d.setHours(9, 0, 0, 0); start = d.toISOString(); end = new Date(+d + 3600000).toISOString(); }
    const draft = {...blankEntry(listing.id, kind, start || null, end || null), all_day: allDay};
    setEntryAnchor(anchor || null); setPreview(draft); setEditing(draft);
  }, [data, selected, calendar, date]);
  const shiftDate = (amount: number) => { const d = mode === 'month' ? new Date(date.getFullYear(), date.getMonth() + amount, 1) : addDays(mode === 'week' ? rangeStart : date, amount * (mode === 'week' ? dayCount : 1)); chooseDate(d); setMiniMonth(d); };
  async function change(entry: Entry) {
    if (changing.current.has(entry.id)) return;
    changing.current.add(entry.id); setError('');
    await cache.cancelQueries({queryKey: ['planner']});
    cache.setQueryData<PlannerData>(['planner'], old => old ? {...old, entries: old.entries.map(e => e.id === entry.id ? entry : e)} : old);
    try { const updated = await api<Entry>(`/planner/entries/${entry.id}`, 'PUT', entryBody(entry)); cache.setQueryData<PlannerData>(['planner'], old => old ? {...old, entries: old.entries.map(e => e.id === updated.id ? updated : e)} : old); }
    catch (e) { setError((e as Error).message); }
    finally { changing.current.delete(entry.id); refresh(); }
  }
  const sync = useCallback(async (quiet = false) => {
    if (syncing) return;
    setSyncing(true); if (!quiet) setError('');
    try { const result = await api<{ok: boolean; errors: {message: string}[]; bound_lists: number}>('/integrations/sync', 'POST', {start: addDays(midnight(date), -60).toISOString(), end: addDays(midnight(date), 120).toISOString()}); if (!result.ok) setError([...new Set(result.errors.map(e => e.message))].join('；')); else if (!quiet) toast(result.bound_lists ? tr("已同步绑定的清单与日历") : tr("请先编辑清单，绑定 Google 日历或滴答清单")); refresh(); }
    catch (e) { setError((e as Error).message); }
    finally { setSyncing(false); }
  }, [syncing, date, toast, refresh]);
  useEffect(() => { if (!autosync) return; const timer = setInterval(() => { if (!busyDialog && document.visibilityState === 'visible') void sync(true); }, 60000); return () => clearInterval(timer); }, [autosync, busyDialog, sync]);
  useEffect(() => { if (!undo) return; const timer = setTimeout(() => setUndo(null), 10000); return () => clearTimeout(timer); }, [undo]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (busyDialog || e.ctrlKey || e.metaKey || e.altKey || (e.target as HTMLElement).closest('input,textarea,select,[contenteditable]')) return; if (e.key.toLowerCase() === 't') today(); if (e.key.toLowerCase() === 'c') newEntry(); if (calendar) { if (e.key === '1' || e.key.toLowerCase() === 'd') setMode('day'); if (e.key === '2' || e.key.toLowerCase() === 'w') setMode('week'); if (e.key === '3' || e.key.toLowerCase() === 'm') setMode('month'); if (e.key === 'ArrowLeft') shiftDate(-1); if (e.key === 'ArrowRight') shiftDate(1); } };
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler);
  });
  if (query.isLoading) return <Loading />;
  if (!data) return <div className="notice">{tr("无法读取规划数据。")}<button onClick={() => query.refetch()}>{tr("重试")}</button></div>;
  const list = data.lists.find(l => l.id === selected);
  const visible = data.entries.filter(e => !e.is_note && !e.cancelled && !hidden.includes(e.list_id) && (!calendar || (e.title + e.notes).toLowerCase().includes(search.toLowerCase())));
  const miniStart = weekStart(new Date(miniMonth.getFullYear(), miniMonth.getMonth(), 1));
  const addList = () => { setListAnchor(null); setListEdit({id: '', name: '', color: colors[data.lists.length % colors.length], google_calendar_id: '', ticktick_project_id: '', ticktick_region: (localStorage.getItem('sakuya-ticktick-region' + ':' + accountId) || 'dida') as 'dida' | 'ticktick'}); };
  const editList = (listing: TodoList, point: MenuPoint) => {
    setListAnchor(pointRect(point)); setListEdit(listing);
  };
  const reorderLists = async (source: string, target: string, after: boolean) => {
    if (source === target || listOrderBusy.current) return;
    const current = data.lists;
    const moving = current.find(item => item.id === source);
    if (!moving || !current.some(item => item.id === target)) return;
    const next = current.filter(item => item.id !== source);
    next.splice(next.findIndex(item => item.id === target) + Number(after), 0, moving);
    if (next.every((item, index) => item.id === current[index].id)) return;
    listOrderBusy.current = true; setError('');
    await cache.cancelQueries({queryKey: ['planner']});
    cache.setQueryData<PlannerData>(['planner'], old => old ? {...old, lists: next} : old);
    try { await api('/planner/preferences', 'PUT', {list_order: next.map(item => item.id)}); }
    catch (error) {
      cache.setQueryData<PlannerData>(['planner'], old => old ? {...old, lists: current} : old);
      setError((error as Error).message);
    } finally { listOrderBusy.current = false; refresh(); }
  };
  const calendarSidebar = <aside className="planner-sidebar" id="planning-sidebar">
        <div className="planner-brand"><button className="icon-button" aria-label={tr("连接设置")} onClick={() => setConnections(true)}><Settings2 size={16}/></button></div>
        <div className="planner-switch"><button className={!calendar ? 'selected' : ''} onClick={() => navigate('todos')}><ListTodo size={16}/>{tr("任务清单")}</button><button className={calendar ? 'selected' : ''} onClick={() => navigate('calendar')}><CalendarDays size={16}/>{tr("日历")}</button></div>
        {calendar && <div className="mini-calendar"><div className="mini-heading"><strong>{miniMonth.toLocaleDateString(getLocale(), {year: 'numeric', month: 'long'})}</strong><button aria-label={tr("迷你日历上个月")} onClick={() => setMiniMonth(new Date(miniMonth.getFullYear(), miniMonth.getMonth() - 1, 1))}><ChevronLeft size={14}/></button><button aria-label={tr("迷你日历下个月")} onClick={() => setMiniMonth(new Date(miniMonth.getFullYear(), miniMonth.getMonth() + 1, 1))}><ChevronRight size={14}/></button></div><div className="mini-grid">{weekdays().map((s, i) => <small key={i}>{s}</small>)}{Array.from({length: 42}, (_, i) => addDays(miniStart, i)).map(d => <button key={localDay(d)} className={`${d.getMonth() !== miniMonth.getMonth() ? 'outside' : ''} ${localDay(d) === localDay(date) ? 'chosen' : ''}`} onClick={() => chooseDate(d)}>{d.getDate()}</button>)}</div></div>}
        <div className="planner-section-label"><span>{tr("清单与日历")}</span><button className="icon-button" aria-label={tr("新建清单")} onClick={addList}><Plus size={15}/></button></div>
        {!calendar && <button className={`planner-list ${selected === 'all' ? 'selected' : ''}`} onClick={() => setSelected('all')}><ListTodo size={16}/><span>{tr("所有任务")}</span><small>{data.entries.filter(e => e.kind === 'task' && !e.completed).length}</small></button>}
        {data.lists.map(l => <PlannerListRow key={l.id} listing={l} count={data.entries.filter(e => e.list_id === l.id && e.kind === 'task' && !e.completed).length} visible={!hidden.includes(l.id)} toggle={() => setHidden(old => old.includes(l.id) ? old.filter(id => id !== l.id) : [...old, l.id])} edit={editList} reorder={(source, target, after) => void reorderLists(source, target, after)}/>)}
        <button className="add-list" onClick={addList}><Plus size={14}/>{tr("添加清单")}</button>
        {calendar && <div className="unscheduled"><div className="planner-section-label">{tr("待安排任务")}</div>{data.entries.filter(e => e.kind === 'task' && !e.completed && !e.start && !hidden.includes(e.list_id)).map(e => <button key={e.id} draggable onDragStart={ev => ev.dataTransfer.setData('text/sakuya-task', e.id)} onClick={ev => openEntry(e, ev.currentTarget.getBoundingClientRect())} onContextMenu={ev => {ev.preventDefault(); openEntry(e, ev.currentTarget.getBoundingClientRect());}}><Circle size={12}/>{e.title}</button>)}<small>{tr("拖到日历上安排 30 分钟，或点击编辑")}</small></div>}
        <div className="planner-sidebar-footer"><span>{tr("时区 ·")}{Intl.DateTimeFormat().resolvedOptions().timeZone}</span><label><input type="checkbox" checked={autosync} onChange={e => { setAutosync(e.target.checked); localStorage.setItem('sakuya-autosync' + ':' + accountId, String(e.target.checked)); }}/>{tr("每分钟自动同步")}</label><button onClick={() => setConnections(true)}>{tr("管理 Google / 滴答连接")}</button></div>
      </aside>;
  const calendarMain = <section className="planner-main">
        <header className="planner-toolbar"><div><span className="planner-eyebrow">{calendar ? tr('日历') : tr('任务清单')}</span><h1>{calendar ? date.toLocaleDateString(getLocale(), {year: 'numeric', month: 'long'}) : list?.name || tr("所有任务")}</h1></div><div className="planner-actions"><button className="icon-button" aria-label={tr("同步日历与任务")} title={tr("同步日历与任务")} disabled={syncing} onClick={() => void sync()}><RefreshCw size={16} className={syncing ? 'spin' : ''}/></button>{calendar && <><label className="calendar-search"><Search size={14}/><input aria-label={tr("搜索日程")} placeholder={tr("搜索日程")} value={search} onChange={e => setSearch(e.target.value)}/></label><button className="button" onClick={today}>{tr("今天")}</button><button className="icon-button focus-toggle" aria-label={tr("聚焦模式")} title={tr("聚焦模式")} aria-pressed={focused} onClick={() => { setFocused(!focused); if (mode === 'month') setMode('week'); }}><Eye size={18}/></button><button className="icon-button" aria-label={tr("上一页日历")} onClick={() => shiftDate(-1)}><ChevronLeft size={18}/></button><button className="icon-button" aria-label={tr("下一页日历")} onClick={() => shiftDate(1)}><ChevronRight size={18}/></button><select aria-label={tr("日历视图")} value={mode} onChange={e => setMode(e.target.value as typeof mode)}><option value="day">{tr("日")}</option><option value="week">{tr("周")}</option><option value="month">{tr("月")}</option></select></>}<button className="icon-button planning-toggle" aria-label={tr("我的规划")} title={tr("我的规划")} aria-expanded={planningOpen} aria-controls="planning-sidebar" onClick={() => setPlanningOpen(open => !open)}><PanelRight size={18}/></button><button className="icon-button planner-new" aria-label={calendar ? tr("新建日程") : tr("新建任务")} title={calendar ? tr("新建日程") : tr("新建任务")} onClick={() => newEntry()}><Plus size={19}/></button>{calendar && <div className="calendar-day-controls" role="group" aria-label={tr("显示天数")}><button className="icon-button" aria-label={tr("减少显示天数")} title={tr("减少显示天数")} disabled={mode === 'month' || (mode === 'day' ? 1 : dayCount) <= 1} onClick={() => changeDayCount(-1)}><Minus size={16}/></button><span aria-live="polite">{mode === 'month' ? tr("月") : tr("{0} 天", [mode === 'day' ? 1 : dayCount])}</span><button className="icon-button" aria-label={tr("增加显示天数")} title={tr("增加显示天数")} disabled={mode === 'month' || (mode === 'week' && dayCount >= 14)} onClick={() => changeDayCount(1)}><Plus size={16}/></button></div>}</div></header>
        {calendar && focused && mode !== 'month' && <CalendarFocus range={focusRange} change={setFocusRange}/>}
        {error && <div className="planner-error" role="alert"><span>{tr(error)}</span><button aria-label={tr("关闭错误")} onClick={() => setError('')}><X size={14}/></button></div>}
        {calendar ? <PlannerCalendar focusRange={focused ? focusRange : null} changeFocusRange={setFocusRange} panDate={d => { setRangeStart(d); setDate(d); }} context={(point,start,end,allDay,entry)=>{if(!busyDialog)setCalendarContext({point,start,end,allDay,entry});}} date={mode === 'week' ? rangeStart : date} mode={mode} dayCount={dayCount} entries={visible} lists={data.lists} open={openEntry} draft={preview} editorOpen={!!editing} editorBusy={editorBusy} moveDraft={moveDraft} dragState={setEditorDragging} anchorChanged={setEntryAnchor} create={(a,b,all,anchor) => newEntry('event', a,b,all,anchor)} change={change} selectDate={d => { chooseDate(d); setMode('day'); }} /> : null}
      </section>;
  return <div className="planner-root">
    {calendar ? <PlanningSplit accountId={accountId} kind="calendar" open={planningOpen} main={calendarMain} sidebar={calendarSidebar}/> : <TaskWorkspace navigate={navigate} accountId={accountId} refresh={refresh} data={data} selected={selected} select={setSelected} editing={editing} prepare={action=>void switchTask(()=>{closeEntry();action();})} removed={entry=>{setUndo(entry);refresh();}} child={(entry,point)=>void switchTask(()=>openEntry({...blankEntry(entry.list_id),parent_id:entry.id},pointRect(point)))}
      open={(entry, rect) => { if (entry.id !== editing?.id) void switchTask(() => openEntry(entry, rect)); else setEntryAnchor(rect); }} create={() => void switchTask(() => newEntry())}
      change={change} addList={addList} editList={editList} reorderLists={(source, target, after) => void reorderLists(source, target, after)} connections={() => setConnections(true)}
      sync={() => void sync()} syncing={syncing} autosync={autosync}
      setAutosync={value => { setAutosync(value); localStorage.setItem('sakuya-autosync:' + accountId, String(value)); }}
      error={error} clearError={() => setError('')} blocked={connections || (!!listEdit && !listAnchor)}
      quickAdd={data.lists.length ? <QuickAdd listId={data.lists.find(l=>l.id===data.preferences?.default_task_list&&!l.read_only)?.id || list?.id || data.lists.find(l=>!l.read_only)?.id || ''} refresh={refresh} error={setError}/> : <button className="button" onClick={addList}><Plus size={16}/>{tr('新建清单')}</button>}

    />}
    {calendarContext&&<ContextMenu compact point={calendarContext.point} close={()=>setCalendarContext(null)} label={tr('日历选项')}>{calendarContext.entry?<><button role="menuitem" disabled={calendarContext.entry.read_only} onClick={()=>{setRenaming({entry:calendarContext.entry!,point:calendarContext.point});setRenameTitle(calendarContext.entry!.title);setCalendarContext(null);}}>{tr('重命名')}</button><button role="menuitem" className="danger-text" disabled={calendarContext.entry.read_only} onClick={async()=>{const entry=calendarContext.entry!;setCalendarContext(null);try{await api(`/planner/entries/${entry.id}?revision=${entry.revision}`,'DELETE');setUndo(entry);refresh();}catch(e){setError((e as Error).message);}}}>{tr('删除')}</button></>:<button role="menuitem" onClick={()=>{newEntry('event',calendarContext.start,calendarContext.end,calendarContext.allDay,pointRect(calendarContext.point));setCalendarContext(null);}}>{tr('创建')}</button>}</ContextMenu>}
    {renaming&&<Modal compact title={tr('重命名')} anchor={pointRect(renaming.point)} nonModal close={()=>setRenaming(null)}><form className="planner-form" onSubmit={async e=>{e.preventDefault();try{await api(`/planner/entries/${renaming.entry.id}`,'PUT',entryBody({...renaming.entry,title:renameTitle.trim()}));setRenaming(null);refresh();}catch(e){setError((e as Error).message);}}}><Field label={tr('标题')}><input required autoFocus maxLength={300} value={renameTitle} onChange={e=>setRenameTitle(e.target.value)}/></Field><button className="button primary">{tr('保存')}</button></form></Modal>}
    <Presence show={!!editing} className="planner-editor-presence">{editing && <EntryEditor key={editing.id || 'new'} entry={editing} taskMode={!calendar} taskLeave={taskLeave} floating={true} hidden={editorDragging} busyChanged={setEditorBusy} anchor={entryAnchor} preview={setPreview} lists={data.lists} close={closeEntry} saved={refresh} deleted={e => { setUndo(e); refresh(); }} toast={toast}/>}</Presence>
    <Presence show={!!listEdit} className="dialog-presence list-editor-presence">{listEdit && <ListEditor key={listEdit.id || 'new'} listing={listEdit} anchor={listAnchor} defaultKey={calendar ? 'default_calendar_list' : 'default_task_list'} isDefault={(calendar ? data.preferences?.default_calendar_list : data.preferences?.default_task_list) === listEdit.id} close={closeList} saved={refresh} deleted={() => { if (selected === listEdit.id) setSelected('all'); setUndo(null); closeEntry(); refresh(); }}/>}</Presence>
    <Presence show={connections} className="dialog-presence"><ConnectionSettings accountId={accountId} close={closeConnections}/></Presence>
    <Presence show={!!undo} className="toast-presence">{undo && <div className="toast" role="status"><span>{tr("已删除「{0}」", [undo.title])}</span><button className="text-button" onClick={async () => { try { await api(`/planner/entries/${undo.id}/restore`, 'POST'); refresh(); setUndo(null); } catch(e) { setError((e as Error).message); } }}>{tr("撤销")}</button></div>}</Presence>
  </div>;
}

function QuickAdd({listId, refresh, error}: {listId: string; refresh: () => void; error: (s: string) => void}) {
  useLocale();
  const [value, setValue] = useState(''), [busy, setBusy] = useState(false);
  return <form className="quick-add" onSubmit={async e => { e.preventDefault(); if (!value.trim() || busy) return; setBusy(true); const body = entryBody(blankEntry(listId)); const {revision: _, ...rest} = body; try { await api('/planner/entries', 'POST', {...rest, title: value.trim()}); setValue(''); refresh(); } catch (err) { error((err as Error).message); } finally { setBusy(false); } }}><Plus size={19}/><input aria-label={tr("快速添加任务")} placeholder={tr("添加任务，按 Enter 保存…")} value={value} onChange={e => setValue(e.target.value)} maxLength={300}/><button className="button" disabled={busy || !value.trim()}>{tr("添加")}</button></form>;
}

function EntryEditor({entry, lists, close, saved, deleted, toast, anchor, preview, floating, hidden, busyChanged, inline = false, taskLeave, taskMode = false}: {taskMode?: boolean; inline?: boolean; taskLeave?: {current: (() => Promise<boolean>) | null}; floating: boolean; hidden: boolean; busyChanged: (busy: boolean) => void; anchor?: FloatingRect | null; preview: (entry: Entry | null) => void; entry: Entry; lists: TodoList[]; close: () => void; saved: () => void; deleted: (e: Entry) => void; toast: (s: string) => void}) {
  useLocale();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const {draft, setDraft, busy, setBusy, error, setError, autoSaved, persist, acceptSaved, hasChanges} = usePlannerEditor(entry, floating && !taskMode, hidden || confirmDelete, saved);
  useEffect(() => { preview(draft); }, [draft, preview]);
  useEffect(() => { busyChanged(busy); return () => busyChanged(false); }, [busy, busyChanged]);
  useEffect(() => {
    if (!taskLeave) return;
    taskLeave.current = async () => {
      if (busy) return false;
      if (!hasChanges()) return true;
      if (!formRef.current?.reportValidity()) return false;
      return persist();
    };
    return () => { taskLeave.current = null; };
  }, [inline, taskMode, taskLeave, draft, entry, busy, persist, hasChanges]);
  useEffect(() => {
    if (!inline) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !(event.target as HTMLElement).closest('.modal-backdrop')) {
        void taskLeave?.current?.().then(ok => { if (ok) close(); });
      }
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [inline, taskLeave, close]);
  useEffect(() => {
    const beforeDetach = (event: Event) => {
      const check = async () => {
        if (busy) return persist();
        if (!hasChanges()) return true;
        return formRef.current?.reportValidity() ? persist() : false;
      };
      (event as CustomEvent<{checks: Promise<boolean>[]}>).detail.checks.push(check());
    };
    window.addEventListener('sakuya-before-detach', beforeDetach);
    return () => window.removeEventListener('sakuya-before-detach', beforeDetach);
  }, [busy, hasChanges, persist]);
  const patch = (value: Partial<Entry>) => setDraft(d => ({...d,...value}));
  async function submit(e: FormEvent) { e.preventDefault(); if (await persist()) { close(); toast("已保存；绑定外部账号后可同步"); } }
  const dismissOutside = () => {
    if (hidden || confirmDelete) return;
    // An untouched, untitled draft has nothing to save. Keep edited invalid
    // drafts visible so outside clicks cannot silently discard user content.
    if (!busy && ((!draft.id && !draft.title.trim() && !hasChanges()) || draft.read_only)) { close(); return; }
    if (!formRef.current?.reportValidity()) return;
    void persist().then(ok => { if (ok) close(); });
  };
  const schedule = () => { const d = new Date(); d.setSeconds(0,0); d.setMinutes(Math.ceil(d.getMinutes()/5)*5); patch({start: d.toISOString(), end: new Date(+d + 1800000).toISOString(), all_day: false}); };
  const content = <form ref={formRef} className="planner-form" onSubmit={submit}>{floating && !taskMode && <div className="title-save-status" role="status">{busy ? tr("保存中…") : autoSaved ? tr("标题已自动保存") : tr("点击其他地方自动保存全部更改")}</div>}<Field label={tr("标题")}><input autoFocus required maxLength={300} placeholder={tr("要做什么？")} value={draft.title} onChange={e => patch({title:e.target.value})} disabled={draft.read_only}/></Field><div className={taskMode ? "planner-form-row" : "planner-form-single"}><Field label={tr("所属清单")}><select value={draft.list_id} onChange={e => patch({list_id:e.target.value})} disabled={draft.read_only}>{lists.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>{taskMode && <Field label={tr("优先级")}><select value={draft.priority} onChange={e => patch({priority:e.target.value as Entry['priority']})}><option value="none">{tr("无")}</option><option value="low">{tr("低")}</option><option value="medium">{tr("中")}</option><option value="high">{tr("高")}</option></select></Field>}</div><div className="schedule-heading"><span>{tr("安排时间")}</span>{!draft.start ? <button type="button" className="text-button" onClick={schedule}>{tr("添加时间")}</button> : draft.kind === 'task' && <button type="button" className="text-button" onClick={() => patch({start:null,end:null})}>{tr("移除时间")}</button>}</div>{draft.start && <><label className="planner-checkbox"><input type="checkbox" checked={draft.all_day} onChange={e => { const all = e.target.checked; patch({all_day:all,start:all ? localDay(new Date(draft.start!)) : new Date(draft.start! + 'T09:00:00').toISOString(),end:all ? localDay(addDays(new Date(draft.start!),1)) : new Date(draft.start! + 'T10:00:00').toISOString()}); }}/>{tr("全天")}</label><div className="planner-form-row"><Field label={tr("开始")}><input required type={draft.all_day ? 'date' : 'datetime-local'} step={draft.all_day ? undefined : 60} value={draft.all_day ? draft.start : localInput(draft.start)} onChange={e => { if (e.target.value) patch({start:draft.all_day ? e.target.value : new Date(e.target.value).toISOString()}); }}/></Field><Field label={draft.all_day ? tr("结束（不含当天）") : tr("结束")}><input required type={draft.all_day ? 'date' : 'datetime-local'} step={draft.all_day ? undefined : 60} value={draft.all_day ? draft.end! : localInput(draft.end!)} onChange={e => { if (e.target.value) patch({end:draft.all_day ? e.target.value : new Date(e.target.value).toISOString()}); }}/></Field></div><small className="planner-muted">{Intl.DateTimeFormat().resolvedOptions().timeZone}{tr("· 可精确到 5 分钟")}</small></>}<Field label={tr("地点")}><input value={draft.location} placeholder={tr("地点或会议链接")} onChange={e => patch({location:e.target.value})}/></Field>{taskMode && <Field label={tr("标签")} hint={tr("用逗号分隔，最多 20 个标签")}><input aria-label={tr("标签")} value={(draft.tags || []).join(",")} onChange={e => patch({tags:e.target.value.split(/[,，]/).slice(0,20)})} disabled={draft.read_only}/></Field>}{draft.sync_list_id && <small className="planner-muted">{tr("清单分类在本地调整，远程来源保持不变。")}</small>}<Field label={tr("备注")}><textarea aria-label={tr("备注")} rows={5} value={draft.notes} placeholder={tr("补充说明…")} onChange={e => patch({notes:e.target.value})}/></Field>{draft.kind === 'task' && <label className="planner-checkbox"><input type="checkbox" checked={draft.completed} onChange={e => patch({completed:e.target.checked})}/>{tr("标记已完成")}</label>}{draft.read_only && <p className="notice">{tr("来自只读日历，不能修改。")}</p>}{draft.sync_error && <div className="planner-error">{tr(draft.sync_error)}</div>}{draft.sync_state === 'conflict' && Object.keys(draft.remote || {}).map(name => <div className="resolve-conflict" key={name}><span>{name}</span>{(['local','remote'] as const).map(keep => <button type="button" className="button" key={keep} disabled={busy} onClick={async () => { setBusy(true); try { const updated = await api<Entry>(`/integrations/resolve/${draft.id}/${name}`, 'POST', {keep}); if ('deleted' in updated && updated.deleted) close(); else acceptSaved(updated); saved(); } catch(e) { setError((e as Error).message); } finally {setBusy(false);} }}>{keep === 'local' ? tr("保留本地") : tr("保留远程")}</button>)}</div>)}{error && <p className="planner-error" role="alert">{tr(error)}</p>}<div className="planner-form-footer">{draft.id && !draft.read_only && <button type="button" className="icon-button danger-text" aria-label={tr("删除当前内容")} onClick={() => setConfirmDelete(true)}><Trash2 size={17}/></button>}<button type="button" className="button" disabled={busy} onClick={() => { const copy = {...draft,id:'',remote:{},revision:1,title:draft.title+tr("（副本）"),read_only:false}; setDraft(copy); }}>{tr("复制")}</button><span/><button type="button" className="button" onClick={close} disabled={busy}>{tr("取消")}</button><button className="button primary" disabled={busy || draft.read_only}>{busy ? tr("保存中…") : tr("保存")}</button></div><Presence show={confirmDelete}><div className="delete-confirm"><p>{tr("删除「{0}」？下次同步会删除关联的远程内容。", [draft.title])}</p><button type="button" className="button" onClick={() => setConfirmDelete(false)}>{tr("保留")}</button><button type="button" className="button danger-text" disabled={busy} onClick={async () => { setBusy(true); try { await api(`/planner/entries/${draft.id}?revision=${draft.revision}`, 'DELETE'); deleted(draft); close(); } catch(e) { setError((e as Error).message); } finally {setBusy(false);} }}>{tr("确认删除")}</button></div></Presence></form>;
  const title = draft.id ? (draft.kind === 'task' ? tr('任务详情') : tr('日程详情')) : (draft.kind === 'task' ? tr('新建任务') : tr('新建日程'));
  if (inline) return <section className="task-detail-editor" role="region" aria-label={title}><header className="task-detail-header"><CalendarDays size={16}/><span>{draft.start ? new Date(draft.all_day ? draft.start + 'T12:00:00' : draft.start).toLocaleDateString(getLocale(), {month:'short',day:'numeric'}) + (draft.all_day ? ' · ' + tr('全天') : ' · ' + clockTime(draft.start) + (draft.end ? ' – ' + clockTime(draft.end) : '')) : tr('未安排时间')}</span><button className="icon-button" aria-label={tr('关闭任务详情')} disabled={busy} onClick={() => {void taskLeave?.current?.().then(ok => {if (ok) close();});}}><X size={17}/></button></header>{content}</section>;
  return <Modal compact={!taskMode} anchor={anchor} nonModal={floating} hidden={hidden} outside={dismissOutside} title={title} close={busy ? () => {} : taskMode ? dismissOutside : close}>{content}</Modal>;
}

function ListEditor({listing, anchor, isDefault, defaultKey, close, saved, deleted}: {defaultKey: "default_calendar_list" | "default_task_list"; listing: TodoList; anchor: FloatingRect | null; isDefault: boolean; close: () => void; saved: () => void; deleted: () => void}) {
  useLocale();
  const [draft, setDraft] = useState(listing), [error, setError] = useState(''), [busy,setBusy] = useState(false);
  const conn = useQuery({queryKey: ['integrations'], queryFn: () => api<Connections>('/integrations')});
  const google = useQuery({queryKey:['collections','google'],queryFn: () => api<{id:string;name:string;read_only:boolean}[]>('/integrations/google/collections'),enabled:!!conn.data?.google.connected});
  const tick = useQuery({queryKey:['collections',draft.ticktick_region],queryFn: () => api<{id:string;name:string}[]>(`/integrations/${draft.ticktick_region}/collections`),enabled:!!conn.data?.[draft.ticktick_region].connected});
  return <Modal compact title={draft.id ? tr("编辑清单") : tr("新建清单")} anchor={anchor} nonModal={!!anchor} outside={busy ? undefined : close} close={busy ? () => {} : close}><form className="planner-form" onSubmit={async e => {e.preventDefault();setBusy(true);setError('');try {const id=draft.id; const body={name:draft.name,color:draft.color,google_calendar_id:draft.google_calendar_id,ticktick_project_id:draft.ticktick_project_id,ticktick_region:draft.ticktick_region};await api('/planner/lists'+(id?'/'+id:''),id?'PUT':'POST',body);saved();close();}catch(err){setError((err as Error).message);}finally{setBusy(false);}}}><Field label={tr("清单名称")}><input required maxLength={100} value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></Field><Field label={tr("清单颜色")}><div className="color-choices">{colors.map(c=><button key={c} type="button" aria-label={tr("颜色 {0}", [c])} aria-pressed={draft.color===c} style={{background:c}} onClick={()=>setDraft({...draft,color:c})}>{draft.color===c&&<Check size={16}/>}</button>)}<input type="color" aria-label={tr("自定义颜色")} value={draft.color} onChange={e=>setDraft({...draft,color:e.target.value})}/></div></Field><Field label={tr("Google 日历")} hint={tr("有安排时间的任务和日程会同步到此日历。")}><select value={draft.google_calendar_id} onChange={e=>setDraft({...draft,google_calendar_id:e.target.value})}><option value="">{tr("仅本地，不绑定")}</option>{draft.google_calendar_id&&!google.data?.some(c=>c.id===draft.google_calendar_id)&&<option value={draft.google_calendar_id}>{draft.google_calendar_id}</option>}{google.data?.map(c=><option key={c.id} value={c.id} disabled={c.read_only}>{c.name}{c.read_only?tr("（只读）"):''}</option>)}</select></Field><Field label={tr("滴答账号版本")}><select value={draft.ticktick_region} onChange={e=>setDraft({...draft,ticktick_region:e.target.value as TodoList['ticktick_region'],ticktick_project_id:''})}><option value="dida">{tr("国内版 · 滴答清单")}</option><option value="ticktick">{tr("国际版 · TickTick")}</option></select></Field><Field label={tr("滴答对应清单")} hint={tr("任务双向同步；独立日程仅同步到 Google。")}><select value={draft.ticktick_project_id} onChange={e=>setDraft({...draft,ticktick_project_id:e.target.value})}><option value="">{tr("仅本地，不绑定")}</option>{draft.ticktick_project_id&&!tick.data?.some(c=>c.id===draft.ticktick_project_id)&&<option value={draft.ticktick_project_id}>{draft.ticktick_project_id}</option>}{tick.data?.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>{(google.error||tick.error)&&<p className="planner-error">{(google.error||tick.error)?.message}</p>}<p className="planner-muted">{tr("没有可选项时，请先在「连接设置」中授权账号。绑定后点击同步，导入已有内容。")}</p>{error&&<p role="alert" className="planner-error">{tr(error)}</p>}{draft.id&&<button type="button" className="button" aria-pressed={isDefault} disabled={busy||draft.read_only||isDefault} onClick={async()=>{setBusy(true);setError('');try{await api('/planner/preferences','PUT',{[defaultKey]:draft.id});saved();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>{tr("设为默认")}{isDefault&&<Check size={14}/>}</button>}<div className="planner-form-footer">{draft.id&&<button type="button" className="button danger-text" disabled={busy} onClick={async()=>{setBusy(true);try{await api('/planner/lists/'+draft.id,'DELETE');deleted();close();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>{tr("删除")}</button>}<span/><button type="button" className="button" onClick={close}>{tr("取消")}</button><button className="button primary" disabled={busy}>{tr("保存清单")}</button></div></form></Modal>;
}

function PersonalToken({name, refresh}: {name: ProviderName; refresh:()=>void}) {
  useLocale();
  const [token,setToken]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{setToken('');setError('');},[name]);
  if(name==='google') return null;
  return <div className="mcp-note"><strong>{tr("个人使用：API Token 快速连接")}</strong><p>{tr("在滴答网页端「设置 → 账号 → API Token」创建令牌，粘贴后验证即可；也可使用下方 OAuth。")}</p><input aria-label={tr("个人 API Token")} type="password" autoComplete="new-password" value={token} onChange={e=>setToken(e.target.value)} placeholder={tr("粘贴 Token")}/><button type="button" className="button" disabled={busy||!token.trim()} onClick={async()=>{setBusy(true);setError('');try{await api(`/integrations/${name}/personal-token`,'PUT',{token});setToken('');refresh();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>{busy?tr("验证中…"):tr("验证并连接 Token")}</button>{error&&<p className="planner-error" role="alert">{tr(error)}</p>}</div>;
}

export function ConnectionSettings({close, accountId, initialProvider = 'google'}: {close:()=>void; accountId:string; initialProvider?: ProviderName}) {
  useLocale();
  const [region,setRegion]=useState<ProviderName>(initialProvider !== 'google' ? initialProvider : (localStorage.getItem('sakuya-ticktick-region' + ':' + accountId) || 'dida') as ProviderName);
  const [name,setName]=useState<ProviderName>(initialProvider);
  const [id,setId]=useState(''),[secret,setSecret]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[url,setUrl]=useState('');
  const cache=useQueryClient();
  const query=useQuery({queryKey:['integrations'],queryFn:()=>api<Connections>('/integrations'),refetchInterval:3000});
  const current=query.data?.[name];
  useEffect(()=>{setId(current?.client_id||'');setSecret('');setUrl('');setError('');},[name,current?.client_id]);
  const refresh=()=>{void cache.invalidateQueries({queryKey:['integrations']});void cache.invalidateQueries({queryKey:['collections']});void cache.invalidateQueries({queryKey:['planner']});};
  useEffect(()=>{if(current?.connected){void cache.invalidateQueries({queryKey:['planner']});setUrl('');}},[current?.connected,current?.import_status,cache]);
  if(name==='google')return <Modal title={tr('连接 Google 日历')} close={close}><div className="planner-form"><div className="connection-status"><i className={current?.connected?'connected':''}/>{tr(current?.connected?'已连接 Google 日历':'使用 Google 账号连接')}</div><p className="planner-muted">{tr('点击连接后，在系统浏览器选择 Google 账号并授权。连接成功后自动导入日历，无需填写应用凭据。')}</p>{current&&!current.configured&&!current.connected&&<p role="status" className="notice">{tr('此版本尚未配置 Google 应用登录，需要开发者先完成应用注册。你无需填写 Client ID 或 Client Secret。')}</p>}{current?.import_status&&<p role="status">{tr(current.import_status==='running'?'正在自动识别并导入…':current.import_status==='done'?'自动导入完成':'导入未完成，请重试')}{current.import_message&&' · '+current.import_message}</p>}{error&&<p role="alert" className="planner-error">{tr(error)}</p>}{url&&<a className="text-button" target="_blank" rel="noreferrer" href={url}>{tr('在浏览器完成授权 ↗')}</a>}<div className="planner-form-footer">{current?.connected&&<button className="button" disabled={busy} onClick={async()=>{setBusy(true);try{await api('/integrations/google/connection','DELETE');refresh();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>{tr('断开连接')}</button>}<span/><button className="button primary" disabled={busy||!current?.configured} onClick={async()=>{setBusy(true);setError('');try{setUrl(await connectInBrowser('google'));refresh();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>{tr(busy?'准备中…':current?.connected?'重新授权':'使用 Google 账号登录')}</button></div><button className="text-button" onClick={()=>setName(region)}>{tr('滴答清单')}</button></div></Modal>;
  return <Modal title={tr('日历与任务连接')} close={close}><div className="planner-form"><div className="connection-tabs"><button onClick={()=>setName('google')}>{tr('Google 日历')}</button><button className="selected">{tr('滴答清单')}</button></div><Field label={tr('账号版本')}><select value={region} onChange={e=>{const v=e.target.value as ProviderName;setRegion(v);setName(v);localStorage.setItem('sakuya-ticktick-region:'+accountId,v);}}><option value="dida">{tr('国内版 · dida365.com')}</option><option value="ticktick">{tr('国际版 · ticktick.com')}</option></select></Field><div className="connection-status"><i className={current?.connected?'connected':''}/>{tr(current?.connected?'已连接':'尚未连接')}</div><PersonalToken name={name} refresh={refresh}/><Field label="Client ID"><input autoComplete="off" value={id} onChange={e=>setId(e.target.value)}/></Field><Field label={`Client Secret${current?.secret_set?tr('（已保存，留空保留）'):''}`}><input type="password" autoComplete="new-password" value={secret} onChange={e=>setSecret(e.target.value)}/></Field><Field label={tr('OAuth 回调地址')}><input readOnly value={current?.redirect_uri||''} onFocus={e=>e.target.select()}/></Field><a className="text-button" target="_blank" rel="noreferrer" href={name==='dida'?'https://developer.dida365.com/':'https://developer.ticktick.com/'}>{tr('打开开发者控制台 ↗')}</a>{error&&<p role="alert" className="planner-error">{tr(error)}</p>}{url&&<a className="button" target="_blank" rel="noreferrer" href={url}>{tr('在浏览器完成授权 ↗')}</a>}<div className="planner-form-footer">{current?.connected&&<button className="button" disabled={busy} onClick={async()=>{setBusy(true);try{await api(`/integrations/${name}/connection`,'DELETE');refresh();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>{tr('断开连接')}</button>}<span/><button className="button primary" disabled={busy||!id.trim()} onClick={async()=>{setBusy(true);setError('');try{setUrl(await connectInBrowser(name,{client_id:id,client_secret:secret}));setSecret('');refresh();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>{tr(busy?'准备中…':'在浏览器授权并导入')}</button></div></div></Modal>;
}
