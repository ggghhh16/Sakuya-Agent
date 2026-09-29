import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, FormEvent, HTMLAttributes, PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, Check, ChevronLeft, Map, MapPin, Search, Settings2, X } from 'lucide-react';
import { api } from './api';
import { getLocale, tr, useLocale } from './i18n';
import { Presence } from './motion';
import type { Entry, PlannerData } from './planner-types';
import { clockTime, localDay } from './planner-types';
import { entryPlace, groupPlaces, locationInput, placeBody, todayEntries } from './map-types';
import type { MapConfig, MapPlace } from './map-types';
import MapCanvas from './map-canvas';
import {useAutoMap} from './use-auto-map';
import './today-map.css';

export default function TodayMap({navigate, accountId}: {navigate: (path: string) => void; accountId: string}) {
  useLocale();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false), [target, setTarget] = useState('');
  const [position, setPosition] = useState<CSSProperties>({});
  const positionKey = `sakuya-map-position:${accountId}`;
  const drag = useRef<{x: number; y: number; left: number; top: number} | null>(null);
  const onDragStart = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button,input,a')) return;
    const r = e.currentTarget.closest('.today-map-panel')!.getBoundingClientRect();
    drag.current = {x: e.clientX, y: e.clientY, left: r.left, top: r.top};
    e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onDragMove = (e: ReactPointerEvent<HTMLElement>) => {
    if (!drag.current || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const r = e.currentTarget.closest('.today-map-panel')!.getBoundingClientRect();
    const left = Math.max(12, Math.min(window.innerWidth - r.width - 12, drag.current.left + e.clientX - drag.current.x));
    const top = Math.max(12, Math.min(window.innerHeight - r.height - 12, drag.current.top + e.clientY - drag.current.y));
    setPosition(p => ({...p, left, top}));
    localStorage.setItem(positionKey, JSON.stringify({left, top}));
  };
  const onDragEnd = (e: ReactPointerEvent<HTMLElement>) => {
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const close = useCallback(() => { setOpen(false); trigger.current?.focus(); }, []);
  useEffect(() => {
    const show = (event: Event) => { setTarget((event as CustomEvent<string>).detail || ''); setOpen(true); };
    window.addEventListener('sakuya-open-map', show);
    return () => window.removeEventListener('sakuya-open-map', show);
  }, []);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = trigger.current!.getBoundingClientRect();
      const width = Math.min(1100, window.innerWidth - 24), height = Math.min(700, window.innerHeight - rect.bottom - 24);
      let saved: {left?: number; top?: number} = {};
      try { saved = JSON.parse(localStorage.getItem(positionKey) || '{}') || {}; } catch { /* Ignore corrupt preferences. */ }
      const left = Math.max(12, Math.min(Number.isFinite(saved.left) ? saved.left! : rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 12));
      const top = Math.max(12, Math.min(Number.isFinite(saved.top) ? saved.top! : rect.bottom + 12, window.innerHeight - height - 12));
      setPosition({left, top, width, height, '--map-origin': `${Math.max(14, Math.min(width - 14, rect.left + rect.width / 2 - left))}px`} as CSSProperties);
    };
    place(); window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open, positionKey]);
  return <>
    <button ref={trigger} type="button" className={`icon-button today-map-trigger ${open ? 'selected' : ''}`} title={tr('今日地图')} aria-label={tr('今日地图')} aria-expanded={open} aria-haspopup="dialog" aria-controls="today-map-panel" onClick={() => {setTarget(''); setOpen(v => !v);}}><Map size={19}/></button>
    {createPortal(<Presence show={open} className="today-map-presence"><div className="today-map-backdrop" onPointerDown={e => {if (e.target === e.currentTarget) close();}}><div style={position} className="today-map-panel" id="today-map-panel"><MapPanel accountId={accountId} close={close} target={target} navigate={navigate} dragHandlers={{onPointerDown: onDragStart, onPointerMove: onDragMove, onPointerUp: onDragEnd, onPointerCancel: onDragEnd, onLostPointerCapture: () => {drag.current = null;}}}/></div></div></Presence>, document.body)}
  </>;
}

function MapPanel({close, target, navigate, accountId, dragHandlers}: {close: () => void; target: string; navigate: (path: string) => void; accountId: string; dragHandlers: HTMLAttributes<HTMLElement>}) {
  useLocale();
  const panel = useRef<HTMLDivElement>(null), cache = useQueryClient();
  const query = useQuery({queryKey: ['planner'], queryFn: () => api<PlannerData>('/planner'), refetchInterval: 5000});
  const config = useQuery({queryKey: ['map-config'], queryFn: () => api<MapConfig>('/maps/config')});
  const savedPlaces = useQuery({queryKey: ['map-places'], queryFn: () => api<MapPlace[]>('/maps/places')});
  const [now, setNow] = useState(() => new Date()), [selectedId, setSelectedId] = useState(target);
  const [settings, setSettings] = useState(false), [editing, setEditing] = useState(false), [picking, setPicking] = useState(false);
  const [draft, setDraft] = useState<MapPlace | null>(null), [search, setSearch] = useState(''), [city, setCity] = useState('');
  const [results, setResults] = useState<MapPlace[]>([]), [searched, setSearched] = useState(false), [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const searchVersion = useRef(0);
  const body = useRef<HTMLDivElement>(null);
  const splitKey = `sakuya-map-split:${accountId}`;
  const [split, setSplit] = useState(() => Math.max(20, Math.min(65, Number(localStorage.getItem(splitKey)) || 30)));
  const resize = (value: number) => {
    const width = body.current?.clientWidth || 1000;
    const next = Math.max(Math.max(20, 180 / width * 100), Math.min(Math.min(65, (width - 225) / width * 100), value));
    setSplit(next); localStorage.setItem(splitKey, String(next));
  };
  const editingRevision = useRef<{id: string; revision: number; map_revision: number} | null>(null);
  const mapLists = new Set(query.data?.lists.filter(list => list.map_enabled).map(list => list.id));
  const entries = todayEntries(query.data?.entries || [], now).filter(entry => mapLists.has(entry.list_id)), groups = groupPlaces(entries);
  const selected = query.data?.entries.find(e => e.id === selectedId);
  const currentPlace = selected ? entryPlace(selected) : null;
  const auto = useAutoMap(selected && !entries.some(e => e.id === selected.id) ? [...entries, selected] : entries, config.dataUpdatedAt);
  function locationStatus(entry: Entry) {
    if (entryPlace(entry)) return tr('已自动定位');
    if (auto.pending === entry.id) return tr('正在自动识别地点…');
    if (auto.errors[entry.id]) return auto.errors[entry.id];
    const result = entry.map_resolution;
    if (!result || JSON.stringify(result.input) !== JSON.stringify(locationInput(entry))) return tr('等待自动识别地点');
    switch (result.status) {
      case 'no_location': return tr('未识别到线下地点，可在安排中补充地址');
      case 'ambiguous': return tr('存在同名地点，请在安排中补充城市或完整地址');
      case 'not_found': return tr('未找到匹配建筑，请在安排中补充完整地址');
      case 'unconfigured': return tr('自动定位需要配置高德 Web 服务 Key');
      case 'error': return tr(result.message || '自动定位失败，请重试');
      default: return tr('等待自动识别地点');
    }
  }
  const bound = entries.filter(e => entryPlace(e)).length;
  useEffect(() => { setCity(config.data?.city || ''); }, [config.data?.city]);
  useEffect(() => {
    if (editing && selected && !editingRevision.current) {
      editingRevision.current = {id: selected.id, revision: selected.revision, map_revision: selected.map_revision || 0};
      setSearch(selected.location || entryPlace(selected)?.name || '');
    }
  }, [editing, selected]);
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 15000);
    const wake = () => setNow(new Date()); window.addEventListener('focus', wake);
    return () => { clearInterval(timer); window.removeEventListener('focus', wake); searchVersion.current++; };
  }, []);
  useEffect(() => {
    panel.current?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); }
      if (e.key === 'Tab') {
        const nodes = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),a[href],select:not(:disabled),[tabindex="0"]') || []).filter(n => n.getClientRects().length > 0);
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (!panel.current?.contains(document.activeElement)) { e.preventDefault(); (e.shiftKey ? last : first)?.focus(); }
        else if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [close]);
  useEffect(() => {
    if (selectedId && query.data && !selected) {setSelectedId(''); setEditing(false); setDraft(null); setPicking(false);}
  }, [selectedId, selected, query.data]);
  function select(id: string) {
    if (busy) return;
    editingRevision.current = null;
    searchVersion.current++; setSearching(false); setSelectedId(id); setDraft(null); setPicking(false); setEditing(false); setResults([]); setSearched(false); setError('');
  }
  function edit() { editingRevision.current = selected ? {id: selected.id, revision: selected.revision, map_revision: selected.map_revision || 0} : null; setEditing(true); setDraft(currentPlace); setSearch(selected?.location || currentPlace?.name || ''); setError(''); }
  async function find(e: FormEvent) {
    e.preventDefault(); const version = ++searchVersion.current;
    setSearching(true); setError(''); setSearched(false);
    try {
      const response = await api<{places: MapPlace[]}>(`/maps/search?q=${encodeURIComponent(search.trim())}&city=${encodeURIComponent(city.trim())}`);
      if (version === searchVersion.current) {setResults(response.places); setSearched(true);}
    } catch (e) { if (version === searchVersion.current) setError((e as Error).message); }
    finally { if (version === searchVersion.current) setSearching(false); }
  }
  async function save(place: MapPlace | null) {
    if (!selected || busy) return;
    setBusy(true); setError('');
    try {
      const base = editing ? editingRevision.current : {revision: selected.revision, map_revision: selected.map_revision || 0};
      if (!base) return;
      const updated = await api<Entry>(`/maps/entries/${selected.id}/place`, 'PUT', {revision: base.revision, map_revision: base.map_revision, place: place ? placeBody(place) : null});
      cache.setQueryData<PlannerData>(['planner'], data => data ? {...data, entries: data.entries.map(e => e.id === updated.id ? updated : e)} : data);
      void cache.invalidateQueries({queryKey: ['map-places']}); editingRevision.current = null; setDraft(null); setEditing(false); setPicking(false);
    } catch (e) {setError((e as Error).message); editingRevision.current = null; setEditing(false); setDraft(null); setPicking(false); void query.refetch();}
    finally {setBusy(false);}
  }
  const today = entries.some(e => e.id === selectedId);
  return <section ref={panel} className="today-map-content" role="dialog" aria-modal="true" aria-label={tr('今日地图')} tabIndex={-1}>
    <header className="map-heading" title={tr("拖动顶栏移动地图窗口")} {...dragHandlers}><div className="map-heading-title"><Map size={19}/><div><h2>{tr('今日地图')}</h2><span>{now.toLocaleDateString(getLocale(), {month: 'long', day: 'numeric', weekday: 'short'})} · {tr('{0} 项安排 · {1} 个地点', [entries.length, groups.length])}</span></div></div><div className="map-heading-actions"><button className="icon-button" aria-label={tr('地图设置')} aria-pressed={settings} onClick={() => setSettings(v => !v)}><Settings2 size={17}/></button><button className="icon-button" aria-label={tr('关闭地图')} onClick={close}><X size={19}/></button></div></header>
    {settings ? <MapSettings config={config.data} saved={() => {void config.refetch(); setSettings(false);}}/> : <div ref={body} className="map-body" style={{'--map-agenda-share': `${split}%`} as CSSProperties}>
      <aside className="map-agenda">
        <div className="map-agenda-caption"><span>{tr('今天的安排')}</span><small>{tr('{0} 项待定位', [entries.length - bound])}</small></div>
        {config.data && !config.data.search_configured && entries.length > bound && <p className="map-muted" role="status">{tr('自动定位需要配置高德 Web 服务 Key')} <button className="text-button" onClick={() => setSettings(true)}>{tr('配置地点搜索')}</button></p>}
        {query.isPending && <p className="map-muted" role="status">{tr('正在读取安排…')}</p>}
        {query.isError && <div role="alert" className="map-error">{query.error.message}<button className="text-button" onClick={() => void query.refetch()}>{tr('重试')}</button></div>}
        {!query.isPending && !query.isError && !entries.length && <div className="map-empty"><MapPin size={26}/><strong>{tr('今天没有安排')}</strong><p>{tr('在清单设置中启用地图模式，即可显示该清单的今日安排')}</p></div>}
        <div className="map-entry-list">{entries.map(e => { const p = entryPlace(e), groupIndex = groups.findIndex(g => g.entries.some(item => item.id === e.id)); return <button key={e.id} className={`map-entry ${selectedId === e.id ? 'selected' : ''} ${e.completed ? 'completed' : ''}`} aria-pressed={selectedId === e.id} onClick={() => select(e.id)}><span className={`map-entry-number ${p ? '' : 'unresolved'}`}>{p ? groupIndex + 1 : <MapPin size={14}/>}</span><span className="map-entry-copy"><small>{e.all_day ? tr('全天') : clockTime(e.start!)} · {tr(e.kind === 'event' ? '日程' : '任务')}{e.completed ? ` · ${tr('已完成')}` : ''}</small><strong>{e.title}</strong><span>{e.location || p?.name || tr('未填写地点')}</span></span>{!p && <i>{tr(auto.pending === e.id ? '识别中' : '待定位')}</i>}</button>; })}</div>
        {selected && <div className="map-entry-detail">
          <div className="map-detail-heading"><strong>{selected.title}</strong><button className="icon-button" aria-label={tr('关闭地点详情')} onClick={() => select('')}><X size={15}/></button></div>
          {!today && <p className="map-muted">{tr('此安排未列入今日地图，可查看它的定位结果')}</p>}
          {!editing ? <><p>{currentPlace?.address || locationStatus(selected)}</p>{currentPlace && selected.location && <p className="map-original-location">{selected.location}</p>}{currentPlace && <small>{tr(currentPlace.auto_input ? '已自动定位' : '已保存地点')}</small>}<div className="map-detail-actions">{!currentPlace && <button className="text-button" disabled={auto.pending === selected.id} onClick={() => auto.retry(selected.id)}>{tr('重新识别地点')}</button>}<button className="text-button" onClick={edit}><MapPin size={14}/>{tr('校正地点')}</button><button className="text-button" onClick={() => {close(); navigate(`${selected.kind === 'event' ? 'calendar' : 'todos'}/${selected.id}`);}}>{tr('打开详情')}<ArrowUpRight size={13}/></button></div>{currentPlace && <button className="text-button map-clear" disabled={busy} onClick={() => void save(null)}>{tr('解除地点关联')}</button>}</> : <>
            <button className="text-button" onClick={() => {setEditing(false); setDraft(null); setPicking(false);}}><ChevronLeft size={13}/>{tr('返回')}</button>
            <form className="map-search" onSubmit={find}><input aria-label={tr('搜索城市')} placeholder={tr('城市，如广州')} value={city} onChange={e => setCity(e.target.value)} maxLength={100}/><div><input aria-label={tr('搜索建筑')} placeholder={tr('学校、园区或具体楼名')} value={search} onChange={e => setSearch(e.target.value)} maxLength={200}/><button type="submit" className="icon-button" aria-label={tr('搜索地点')} disabled={searching || !search.trim() || !config.data?.search_configured}><Search size={16}/></button></div></form>
            {!config.data?.search_configured && <button className="text-button" onClick={() => setSettings(true)}>{tr('配置地点搜索')}</button>}
            {searching && <p role="status" className="map-muted">{tr('正在搜索…')}</p>}
            {searched && !results.length && <p className="map-muted">{tr('没有找到建筑，可换关键词或在地图上选点')}</p>}
            <div className="map-search-results">{results.map((p, i) => <button key={`${p.poi_id}-${i}`} onClick={() => {setDraft(p); setPicking(false);}}><strong>{p.name}</strong><small>{p.address}</small></button>)}</div>
            {!results.length && !!savedPlaces.data?.length && <details className="map-saved"><summary>{tr('已保存的地点')}</summary>{savedPlaces.data.map((p, i) => <button key={i} onClick={() => {setDraft(placeBody(p)); setPicking(false);}}>{p.name}</button>)}</details>}
            <button className={`button map-pick-button ${picking ? 'primary' : ''}`} aria-pressed={picking} disabled={!config.data?.configured} onClick={() => setPicking(v => !v)}><MapPin size={14}/>{tr(picking ? '取消选点' : '在地图上选点')}</button>
            {draft && <div className="map-place-draft"><label>{tr('建筑名称')}<input aria-label={tr('建筑名称')} value={draft.name} maxLength={300} onChange={e => setDraft({...draft, name: e.target.value})}/></label><p>{draft.address}</p><small>{tr(draft.source === 'manual' ? '手动选点，请确认建筑位置' : '请在地图上确认是目标建筑')}</small><button className="button primary" disabled={busy || !draft.name.trim()} onClick={() => void save(draft)}><Check size={14}/>{tr(busy ? '保存中…' : '保存地点')}</button></div>}
          </>}
          {error && <p className="map-error" role="alert">{tr(error)}</p>}
        </div>}
        {!selected && entries.length > 0 && <p className="map-agenda-help">{tr('地点会自动识别并标记，点击安排可查看地址')}</p>}
      </aside>
      <div className="map-divider" role="separator" aria-label={tr('调整安排与地图宽度')} aria-orientation="vertical" aria-valuenow={Math.round(split)} aria-valuemin={20} aria-valuemax={65} tabIndex={0}
        onPointerDown={e => {if (e.button === 0) {e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId);}}}
        onPointerMove={e => {if (e.currentTarget.hasPointerCapture(e.pointerId) && body.current) {const r = body.current.getBoundingClientRect(); resize((e.clientX - r.left) / r.width * 100);}}}
        onPointerUp={e => {if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);}}
        onKeyDown={e => {if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {e.preventDefault(); resize(e.key === 'Home' ? 20 : e.key === 'End' ? 65 : split + (e.key === 'ArrowLeft' ? -2 : 2));}}}/>
      <div className="map-stage">
        {config.isPending ? <div className="map-empty" role="status">{tr('正在加载地图…')}</div> : config.isError ? <div className="map-empty" role="alert"><p>{config.error.message}</p><button className="button" onClick={() => void config.refetch()}>{tr('重试')}</button></div> : config.data?.configured ? <MapCanvas jsKey={config.data.js_key} entries={entries} selectedId={selectedId} draft={draft} picking={picking && !!selected} onSelect={select} onPick={(lng, lat) => setDraft({name: draft?.name || selected?.location || tr('自定义建筑'), address: '', lng, lat, poi_id: '', provider: 'amap', coord_system: 'GCJ-02', source: 'manual'})}/> : <div className="map-empty map-setup-empty"><Map size={42} strokeWidth={1}/><h3>{tr('把今天的安排放到地图上')}</h3><p>{tr('连接高德地图后，自动识别任务和日程中的地点并标记建筑')}</p><button className="button primary" onClick={() => setSettings(true)}>{tr('配置高德地图')}</button><small>{tr('地图尚未连接；任务和日程可以正常使用')}</small></div>}
        {config.data?.configured && !selected && <div className="map-stage-caption">{tr('点击地点标记查看关联安排')}</div>}
      </div>
    </div>}
    <footer className="map-footer"><span>{tr('建筑地点保存在本机，不会修改外部日历')}</span><time dateTime={localDay(now)}>{tr('今日')}</time></footer>
  </section>;
}

function MapSettings({config, saved}: {config?: MapConfig; saved: () => void}) {
  const [jsKey, setJsKey] = useState(''), [security, setSecurity] = useState(''), [webKey, setWebKey] = useState(''), [city, setCity] = useState(config?.city || '');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try { await api('/maps/config', 'PUT', {js_key: jsKey.trim(), security_code: security.trim(), web_key: webKey.trim(), city: city.trim()}); setJsKey(''); setSecurity(''); setWebKey(''); saved(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <form className="map-settings" onSubmit={submit}><h3>{tr('连接高德地图')}</h3><p>{tr('在高德开放平台创建 Web 端（JS API）Key 和安全密钥；地点搜索使用单独的 Web 服务 Key。')}</p><a href="https://console.amap.com/dev/key/app" target="_blank" rel="noreferrer">{tr('打开高德控制台')}<ArrowUpRight size={14}/></a><label>Web JS API Key<input aria-label="Web JS API Key" autoComplete="off" type="password" value={jsKey} required={!config?.js_key} placeholder={config?.js_key ? tr('已配置，留空保留') : ''} maxLength={200} onChange={e => setJsKey(e.target.value)}/></label><label>{tr('安全密钥')}<input aria-label={tr('安全密钥')} autoComplete="new-password" type="password" value={security} required={!config?.security_code_set} placeholder={config?.security_code_set ? tr('已配置，留空保留') : ''} maxLength={200} onChange={e => setSecurity(e.target.value)}/></label><label>Web Service Key<input aria-label="Web Service Key" autoComplete="new-password" type="password" value={webKey} placeholder={config?.web_key_set ? tr('已配置，留空保留') : tr('用于搜索建筑')} maxLength={200} onChange={e => setWebKey(e.target.value)}/></label><label>{tr('默认城市')}<input aria-label={tr('默认城市')} value={city} placeholder={tr('城市，如广州')} maxLength={100} onChange={e => setCity(e.target.value)}/></label><small>{tr('密钥保存在当前账号的本机配置中。自动识别时只发送提取的地点关键词和城市。')}</small>{error && <p className="map-error" role="alert">{tr(error)}</p>}<button className="button primary" disabled={busy}>{tr(busy ? '保存中…' : '保存并打开地图')}</button></form>;
}
