import { weekdays, useLocale, tr, getLocale } from './i18n';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, DragEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { FloatingRect } from './ui';
import type { Entry, TodoList } from './planner-types';
import { addDays, clockTime, localDay, midnight, weekStart } from './planner-types';

type Props = {
  date: Date; mode: 'day' | 'week' | 'month'; dayCount: number; entries: Entry[]; lists: TodoList[];
  open: (entry: Entry, anchor?: FloatingRect) => void;
  create: (start: string, end: string, allDay?: boolean, anchor?: FloatingRect) => void;
  draft?: Entry | null; editorOpen: boolean; editorBusy: boolean;
  moveDraft: (entry: Entry, anchor?: FloatingRect) => void;
  dragState: (dragging: boolean) => void; anchorChanged: (anchor: FloatingRect) => void;
  change: (entry: Entry) => Promise<void>; selectDate: (date: Date) => void;
};
type Gesture = {
  type: 'create' | 'move' | 'start' | 'end'; entry?: Entry;
  originX: number; originY: number; originScroll: number; gridTop: number;
  dayWidth: number; date: Date; minute: number; moved: boolean;
  start: string; end: string; x: number; y: number;
};
const HEIGHT = 72; // 6 pixels per 5 minutes
const minuteOf = (d: Date) => d.getHours() * 60 + d.getMinutes();
function at(d: Date, minute: number) { const n = midnight(d); n.setMinutes(minute); return n.toISOString(); }

export default function PlannerCalendar({date, mode, dayCount, entries, lists, open, create, change, selectDate, draft, editorOpen, editorBusy, moveDraft, dragState, anchorChanged}: Props) {
  useLocale();
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const drag = useRef<Gesture | null>(null);
  const [now, setNow] = useState(new Date());
  const [utc, setUtc] = useState(false);
  const days = Array.from({length: mode === 'day' ? 1 : dayCount}, (_, i) => addDays(midnight(date), i));
  const isDraft = (entry?: Entry) => !!entry && editorOpen && (entry.id === '__preview' || entry.id === draft?.id);
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(timer); }, []);
  useEffect(() => { if (mode !== 'month' && scroller.current) scroller.current.scrollTop = HEIGHT * 7; }, [mode]);
  // Follow the actual rendered block after resizing, scrolling, or editing its times.
  useLayoutEffect(() => {
    if (!editorOpen || gesture) return;
    const place = () => {
      const element = root.current?.querySelector<HTMLElement>('[data-draft=true]');
      if (element) anchorChanged(element.getBoundingClientRect());
    };
    place();
    const observer = new ResizeObserver(place);
    if (root.current) observer.observe(root.current);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { observer.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [editorOpen, !!gesture, draft?.start, draft?.end, draft?.all_day, date.getTime(), mode, dayCount, anchorChanged]);
  useEffect(() => {
    if (!gesture) return;
    function update(x: number, y: number) {
      const g = drag.current; if (!g || g.entry?.read_only) return;
      const scrollDelta = (scroller.current?.scrollTop || 0) - g.originScroll;
      const dy = y - g.originY + scrollDelta;
      const dayIndex = days.findIndex(d => localDay(d) === localDay(g.date));
      const dx = Math.max(-dayIndex, Math.min(days.length - 1 - dayIndex, Math.round((x - g.originX) / g.dayWidth)));
      const delta = Math.round(dy / HEIGHT * 60 / 5) * 5;
      let a: string, b: string;
      if (g.type === 'create') {
        // Compute the endpoint directly from the pointer, without adding an extra slot.
        const target = Math.max(0, Math.min(1440, Math.round((y - g.gridTop + scrollDelta) / HEIGHT * 60 / 5) * 5));
        a = at(g.date, Math.min(g.minute, target));
        b = at(g.date, Math.max(g.minute, target));
      } else {
        const e = g.entry!;
        const shift = (value: string) => { const d = addDays(new Date(value), dx); d.setMinutes(d.getMinutes() + delta); return d.toISOString(); };
        a = g.type === 'end' ? e.start! : shift(e.start!);
        b = g.type === 'start' ? e.end! : g.type === 'move' ? new Date(+new Date(a) + (+new Date(e.end!) - +new Date(e.start!))).toISOString() : shift(e.end!);
        if (+new Date(b) - +new Date(a) < 300000) { if (g.type === 'start') a = new Date(+new Date(b) - 300000).toISOString(); else b = new Date(+new Date(a) + 300000).toISOString(); }
      }
      const moved = g.moved || (Math.abs(x - g.originX) + Math.abs(y - g.originY) > 3 && (g.type !== 'create' || +new Date(b) > +new Date(a)));
      if (moved && !g.moved && isDraft(g.entry)) dragState(true);
      drag.current = {...g, start: a, end: b, x, y, moved};
      setGesture({...drag.current});
    }
    const move = (e: PointerEvent) => { e.preventDefault(); update(e.clientX, e.clientY); };
    const cancel = () => { drag.current = null; setGesture(null); dragState(false); };
    const up = () => {
      const g = drag.current;
      const element = root.current?.querySelector<HTMLElement>(g?.type === 'create' ? '[data-entry-id="__preview"]' : `[data-entry-id="${CSS.escape(g?.entry?.id || '')}"]`);
      const rect = element?.getBoundingClientRect();
      cancel(); if (!g) return;
      if (g.type === 'create') { if (g.moved && +new Date(g.end) > +new Date(g.start)) create(g.start, g.end, false, rect); }
      else if (isDraft(g.entry)) { if (g.moved) moveDraft({...g.entry!, start: g.start, end: g.end}, rect); }
      else if (g.moved) void change({...g.entry!, start: g.start, end: g.end});
      else open(g.entry!, rect);
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); } };
    let frame = 0;
    const scroll = () => {
      const g = drag.current, el = scroller.current;
      if (g?.moved && el) { const rect = el.getBoundingClientRect(); const delta = g.y < rect.top + 35 ? -9 : g.y > rect.bottom - 30 ? 9 : 0; if (delta) { el.scrollTop += delta; update(g.x, g.y); } }
      frame = requestAnimationFrame(scroll);
    };
    frame = requestAnimationFrame(scroll);
    window.addEventListener('pointermove', move, {passive: false}); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancel); window.addEventListener('keydown', key, true); window.addEventListener('blur', cancel);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel); window.removeEventListener('keydown', key, true); window.removeEventListener('blur', cancel); };
    // Freeze callbacks and origin geometry during a pointer gesture.
  }, [!!gesture]);
  function begin(e: ReactPointerEvent, day: Date, type: Gesture['type'], entry?: Entry) {
    if (e.button !== 0 || editorBusy || (entry?.read_only && type !== 'move') || (editorOpen && !isDraft(entry))) return;
    e.preventDefault(); e.stopPropagation();
    if (type === 'move' && !entry?.read_only) {
      const box = e.currentTarget.getBoundingClientRect(), edge = Math.min(5, box.height / 3);
      if (e.clientY - box.top < edge) type = 'start';
      else if (box.bottom - e.clientY <= edge) type = 'end';
    }
    const column = e.currentTarget.closest('.calendar-day') as HTMLElement;
    const rect = column.getBoundingClientRect();
    const minute = Math.max(0, Math.min(1435, Math.round((e.clientY - rect.top) / HEIGHT * 60 / 5) * 5));
    const g: Gesture = {type, entry, originX: e.clientX, originY: e.clientY, gridTop: rect.top, originScroll: scroller.current!.scrollTop, dayWidth: rect.width, date: day, minute, moved: false, start: entry?.start || at(day, minute), end: entry?.end || at(day, minute), x: e.clientX, y: e.clientY};
    drag.current = g; setGesture(g);
  }
  const color = (e: Entry) => lists.find(l => l.id === e.list_id)?.color || '#a899ed';
  function dropDate(ev: DragEvent, day: Date, allDay = false) {
    ev.preventDefault();
    const item = entries.find(e => e.id === ev.dataTransfer.getData('text/sakuya-task'));
    if (!item || item.read_only || editorOpen) return;
    if (allDay || item.all_day) {
      const duration = item.all_day && item.start ? Math.max(1, Math.round((Date.parse(item.end!) - Date.parse(item.start)) / 86400000)) : 1;
      void change({...item, all_day: true, start: localDay(day), end: localDay(addDays(day, duration))});
    } else {
      const original = item.start ? new Date(item.start) : new Date(day);
      const next = new Date(day); next.setHours(item.start ? original.getHours() : 9, item.start ? original.getMinutes() : 0, 0, 0);
      const duration = item.start ? +new Date(item.end!) - +original : 1800000;
      void change({...item, start: next.toISOString(), end: new Date(+next + duration).toISOString()});
    }
  }
  const intersects = (e: Entry, d: Date) => !!e.start && +new Date(e.start) < +addDays(d, 1) && +new Date(e.end!) > +d;
  const displayed = entries.filter(e => !editorOpen || e.id !== draft?.id);
  if (editorOpen && draft?.start && draft.end && +new Date(draft.end) > +new Date(draft.start)) displayed.push({...draft, id: draft.id || '__preview', title: draft.title || tr('新日程')});
  const timed = displayed.filter(e => e.start && !e.all_day).map(e => gesture?.entry?.id === e.id ? {...e, start: gesture.start, end: gesture.end} : e);
  if (gesture?.type === 'create' && gesture.moved && gesture.start !== gesture.end) timed.push({id: '__preview', title: tr('新日程'), start: gesture.start, end: gesture.end} as Entry);
  if (mode === 'month') {
    const first = weekStart(new Date(date.getFullYear(), date.getMonth(), 1));
    return <div className="month-calendar" ref={root}><div className="month-weekdays">{weekdays().map((v, i) => <span key={i}>{v}</span>)}</div><div className="month-grid">{Array.from({length: 42}, (_, i) => addDays(first, i)).map(d => <div className={`month-cell ${d.getMonth() !== date.getMonth() ? 'outside' : ''}`} key={localDay(d)} onDragOver={e => e.preventDefault()} onDrop={e => dropDate(e,d)}><button className={`month-date ${localDay(d) === localDay(now) ? 'today' : ''}`} onClick={() => selectDate(d)}>{d.getDate()}</button>{displayed.filter(e => e.start && (e.all_day ? e.start <= localDay(d) && e.end! > localDay(d) : intersects(e, d))).map(e => <button key={e.id} data-draft={isDraft(e)} draggable={!e.read_only && !editorOpen} onDragStart={ev => ev.dataTransfer.setData('text/sakuya-task', e.id)} className="month-event" style={{'--event-color': color(e)} as CSSProperties} onClick={ev => { if (!isDraft(e)) open(e, ev.currentTarget.getBoundingClientRect()); }}>{!e.all_day && clockTime(e.start!)} {e.title}</button>)}</div>)}</div></div>;
  }
  return <div ref={root} className={`calendar-board ${gesture?.moved ? 'is-dragging' : ''}`}>
    <div className="calendar-day-head"><button className="zone-label" title={tr('切换 UTC 辅助时间')} onClick={() => setUtc(!utc)}>{utc ? 'UTC' : `GMT${-now.getTimezoneOffset() / 60 >= 0 ? '+' : ''}${-now.getTimezoneOffset() / 60}`}</button>{days.map(d => <button key={localDay(d)} className={localDay(d) === localDay(now) ? 'today' : ''} onClick={() => selectDate(d)}><small>{d.toLocaleDateString(getLocale(), {weekday: 'short'})}</small><strong>{d.getDate()}</strong></button>)}</div>
    <div className="all-day-row"><span>{tr('全天')}</span>{days.map(d => <div key={localDay(d)} onDragOver={e => e.preventDefault()} onDrop={e => dropDate(e,d,true)}>{displayed.filter(e => e.all_day && e.start! <= localDay(d) && e.end! > localDay(d)).map(e => <button key={e.id} data-draft={isDraft(e)} draggable={!e.read_only && !editorOpen} onDragStart={ev => ev.dataTransfer.setData('text/sakuya-task', e.id)} style={{'--event-color': color(e)} as CSSProperties} className="month-event" onClick={ev => { if (!isDraft(e)) open(e, ev.currentTarget.getBoundingClientRect()); }}>{e.title}</button>)}</div>)}</div>
    <div className="calendar-scroll" ref={scroller}>
      <div className="time-grid" style={{height: HEIGHT * 24, gridTemplateColumns: `58px repeat(${days.length}, minmax(0,1fr))`}}>
        <div className="time-ruler">{Array.from({length: 24}, (_, h) => <span key={h} style={{top: h * HEIGHT}}>{String(utc ? (h + Math.floor(now.getTimezoneOffset() / 60) + 24) % 24 : h).padStart(2, '0')}:00</span>)}</div>
        {days.map(d => {
          const events = timed.filter(e => intersects(e, d)).sort((a, b) => +new Date(a.start!) - +new Date(b.start!) || +new Date(b.end!) - +new Date(a.end!));
          const layout = new Map<string, {col: number; cols: number}>();
          let group: Entry[] = [], end = 0;
          const arrange = () => { const ends: number[] = []; for (const e of group) { let col = ends.findIndex(t => t <= +new Date(e.start!)); if (col < 0) col = ends.length; ends[col] = +new Date(e.end!); layout.set(e.id, {col, cols: 1}); } for (const e of group) layout.get(e.id)!.cols = ends.length; };
          for (const e of events) { if (+new Date(e.start!) >= end && group.length) { arrange(); group = []; } group.push(e); end = Math.max(group.length === 1 ? 0 : end, +new Date(e.end!)); } arrange();
          return <div key={localDay(d)} className="calendar-day" data-date={localDay(d)} onPointerDown={e => begin(e, d, 'create')} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const id = e.dataTransfer.getData('text/sakuya-task'); const task = entries.find(t => t.id === id); if (task && !task.read_only && !editorOpen) { const rect = e.currentTarget.getBoundingClientRect(); const min = Math.max(0, Math.min(1410, Math.round((e.clientY - rect.top) / HEIGHT * 12) * 5)); void change({...task, start: at(d, min), end: at(d, min + 30), all_day: false}); } }}>
            {Array.from({length: 24}, (_, h) => <div key={h} className="hour-line" style={{top: h * HEIGHT, height: HEIGHT}} />)}
            {localDay(d) === localDay(now) && <div className="now-line" style={{top: minuteOf(now) / 60 * HEIGHT}}><i /></div>}
            {events.map(e => {
              const a = new Date(e.start!), b = new Date(e.end!);
              const from = a < d ? 0 : minuteOf(a), to = b >= addDays(d, 1) ? 1440 : minuteOf(b);
              const l = layout.get(e.id)!;
              return <div key={e.id} className={`calendar-event ${to - from <= 25 ? 'compact-event' : ''} ${gesture?.entry?.id === e.id || isDraft(e) || e.id === '__preview' ? 'drag-preview' : ''} ${e.completed ? 'completed' : ''}`} data-entry-id={e.id} data-draft={isDraft(e)} style={{top: from / 60 * HEIGHT, height: Math.max(6, (to - from) / 60 * HEIGHT), left: `calc(${l.col / l.cols * 100}% + 2px)`, width: `calc(${100 / l.cols}% - 5px)`, '--event-color': color(e)} as CSSProperties} role="button" tabIndex={0} aria-label={`${e.title} ${clockTime(e.start!)}–${clockTime(e.end!)}`} onPointerDown={ev => begin(ev, d, 'move', e)} onKeyDown={ev => {
                if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); if (!isDraft(e)) open(e, ev.currentTarget.getBoundingClientRect()); }
                if (ev.altKey && ['ArrowUp', 'ArrowDown'].includes(ev.key) && !e.read_only && !editorBusy) { ev.preventDefault(); const delta = ev.key === 'ArrowUp' ? -300000 : 300000; const next = {...e, start: new Date(+a + delta).toISOString(), end: new Date(+b + delta).toISOString()}; if (isDraft(e)) moveDraft(next, ev.currentTarget.getBoundingClientRect()); else void change(next); }
              }}>
                {!e.read_only && <div className="resize-handle top" aria-label={tr('调整开始时间')} onPointerDown={ev => begin(ev, d, 'start', e)} />}<strong>{e.title}</strong><small>{clockTime(e.start!)} – {clockTime(e.end!)}</small>{!e.read_only && <div className="resize-handle bottom" aria-label={tr('调整结束时间')} onPointerDown={ev => begin(ev, d, 'end', e)} />}
              </div>;
            })}
          </div>;
        })}
      </div>
    </div>
    <div className="calendar-hint">{gesture?.moved ? tr('{0} – {1} · 松开保存，Esc 取消', [clockTime(gesture.start), clockTime(gesture.end)]) : tr('拖动创建 · 拖动时间块移动 · 上下边缘调整时长 · 5 分钟一格 · Alt + ↑ / ↓ 微调')}</div>
  </div>;
}
