import { useLocale, tr } from './i18n';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { MessageCircle, MoreHorizontal, Pencil, Trash2, Check, X } from 'lucide-react';
import type { Conversation, Navigate, Workspace } from './types';
import { api } from './api';
import { Presence } from './motion';

interface Props { conversations: Conversation[]; selectedId?: string; navigate: Navigate; deleted: (id: string) => void; toast: (text: string) => void }
export default function HistoryList({ conversations, selectedId, navigate, deleted, toast }: Props) {
  useLocale();
  const cache = useQueryClient();
  const root = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const editor = useRef<HTMLInputElement>(null);
  const positions = useRef(new Map<string, number>());
  const dragged = useRef<string | null>(null);
  const suppressClick = useRef(false);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [order, setOrder] = useState<string[] | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null);
  const items = order ? [...conversations].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)) : conversations;

  function focusRow(id: string) { root.current?.querySelector<HTMLButtonElement>(`[data-conversation="${id}"] .history-open`)?.focus(); }
  function closeMenu() { if (menu) focusRow(menu.id); setMenu(null); }
  function showMenu(id: string, x: number, y: number) {
    if (busy || editing) return;
    const rect = root.current!.getBoundingClientRect();
    focusRow(id);
    setMenu({ id, x: Math.max(4, Math.min(x - rect.left, rect.width - 184)), y: Math.max(0, Math.min(y - rect.top, rect.height - 100)) });
  }
  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const outside = (e: PointerEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(null); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [menu]);
  useEffect(() => { if (editing) { editor.current?.focus(); editor.current?.select(); } }, [editing]);
  useLayoutEffect(() => {
    const next = new Map<string, number>();
    root.current?.querySelectorAll<HTMLElement>('[data-conversation]').forEach(row => {
      const id = row.dataset.conversation!;
      const top = row.offsetTop;
      const previous = positions.current.get(id);
      if (previous !== undefined && previous !== top && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        row.animate([{ transform: `translateY(${previous - top}px)` }, { transform: 'translateY(0)' }], { duration: 190, easing: 'ease-out' });
      }
      next.set(id, top);
    });
    positions.current = next;
  }, [items]);

  async function rename() {
    if (!editing || busy) return;
    if (!title.trim()) { setError("请输入对话名称"); editor.current?.focus(); return; }
    const id = editing;
    setBusy(true); setError('');
    try {
      const updated = await api<Conversation>(`/conversations/${id}`, 'PATCH', { title: title.trim() });
      cache.setQueryData<Workspace>(['workspace'], w => w ? { ...w, conversations: w.conversations.map(c => c.id === id ? updated : c) } : w);
      setEditing(null); toast("对话已重命名");
      requestAnimationFrame(() => focusRow(id));
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function remove(id: string) {
    setMenu(null); setBusy(true);
    try { await api(`/conversations/${id}`, 'DELETE'); deleted(id); }
    catch (e) { toast((e as Error).message); }
    finally { setBusy(false); }
  }
  async function reorder(ids: string[]) {
    if (busy) return;
    setOrder(ids); setBusy(true);
    try {
      await cache.cancelQueries({ queryKey: ['workspace'] });
      const sorted = await api<Conversation[]>('/conversations/order', 'PUT', { ids });
      cache.setQueryData<Workspace>(['workspace'], w => w ? { ...w, conversations: sorted } : w);
    } catch (e) { toast((e as Error).message); void cache.invalidateQueries({ queryKey: ['workspace'] }); }
    finally { setOrder(null); setBusy(false); }
  }
  function finishDrag() { dragged.current = null; setDragging(null); setDrop(null); setTimeout(() => { suppressClick.current = false; }, 100); }

  return <div className="history-records" ref={root} onKeyDown={e => {
    if (e.key === 'Escape' && (menu || editing || dragging)) {
      e.preventDefault(); e.stopPropagation();
      if (menu) closeMenu();
      if (editing && !busy) { const id = editing; setEditing(null); setError(''); requestAnimationFrame(() => focusRow(id)); }
      if (dragging) finishDrag();
    }
  }}>
    <div className="history-list" aria-label={tr("对话列表")} onScroll={() => setMenu(null)} onDragOver={e => {
      if (!dragged.current) return;
      e.preventDefault();
      const rect = e.currentTarget.getBoundingClientRect();
      if (e.clientY < rect.top + 30) e.currentTarget.scrollTop -= 12;
      if (e.clientY > rect.bottom - 30) e.currentTarget.scrollTop += 12;
    }}>
      {items.map(c => <div key={c.id} data-conversation={c.id} className={`history-row ${c.id === selectedId ? 'selected' : ''} ${dragging === c.id ? 'dragging' : ''} ${drop?.id === c.id ? drop.after ? 'drop-after' : 'drop-before' : ''}`}
        onContextMenu={e => { e.preventDefault(); showMenu(c.id, e.clientX, e.clientY); }}
        onDragOver={e => { if (!dragged.current || dragged.current === c.id) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; const rect = e.currentTarget.getBoundingClientRect(); setDrop({ id: c.id, after: e.clientY > rect.top + rect.height / 2 }); }}
        onDrop={e => {
          e.preventDefault();
          const source = dragged.current;
          if (!source || source === c.id) { finishDrag(); return; }
          const rect = e.currentTarget.getBoundingClientRect();
          const ids = items.map(item => item.id).filter(id => id !== source);
          ids.splice(ids.indexOf(c.id) + (e.clientY > rect.top + rect.height / 2 ? 1 : 0), 0, source);
          finishDrag(); void reorder(ids);
        }}>
        {editing === c.id ? <form className="history-rename" onSubmit={e => { e.preventDefault(); void rename(); }}><input ref={editor} aria-label={tr("对话名称")} value={title} maxLength={100} disabled={busy} onChange={e => setTitle(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && e.nativeEvent.isComposing) e.preventDefault(); }} /><button className="icon-button" type="submit" aria-label={tr("保存名称")} disabled={busy}><Check size={14} /></button><button className="icon-button" type="button" aria-label={tr("取消重命名")} disabled={busy} onClick={() => { setEditing(null); setError(''); requestAnimationFrame(() => focusRow(c.id)); }}><X size={14} /></button></form> : <><button className="history-open" draggable={!busy} title={c.title} aria-current={c.id === selectedId ? 'page' : undefined}
          onDragStart={e => { if (busy) { e.preventDefault(); return; } dragged.current = c.id; suppressClick.current = true; setDragging(c.id); setMenu(null); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', c.id); }} onDragEnd={finishDrag}
          onKeyDown={e => {
            if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); const rect = e.currentTarget.getBoundingClientRect(); showMenu(c.id, rect.left + 25, rect.bottom); }
            if (e.altKey && ['ArrowUp', 'ArrowDown'].includes(e.key)) { e.preventDefault(); const ids = items.map(item => item.id); const from = ids.indexOf(c.id); const to = from + (e.key === 'ArrowUp' ? -1 : 1); if (to >= 0 && to < ids.length) { [ids[from], ids[to]] = [ids[to], ids[from]]; void reorder(ids); } }
          }}
          onClick={() => { if (!suppressClick.current) navigate(`chat/${c.id}`); }}><MessageCircle size={15} /><span>{c.title}</span></button><button className="icon-button history-more" aria-label={tr("对话选项：{0}", [c.title])} disabled={busy} onClick={e => { const rect = e.currentTarget.getBoundingClientRect(); showMenu(c.id, rect.left, rect.bottom); }}><MoreHorizontal size={15} /></button></>}
      </div>)}
      {!items.length && <p>{tr("开始对话后，会保存在这里。")}</p>}
    </div>
    {error && <p className="history-error" role="alert">{tr(error)}</p>}
    <Presence show={!!menu} className="history-context-presence"><div ref={menuRef} role="menu" aria-label={tr("对话操作")} className="history-context quiet-popover" style={{ left: menu?.x, top: menu?.y }} onKeyDown={e => {
      if (e.key === 'Tab') { e.preventDefault(); closeMenu(); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const buttons = Array.from(e.currentTarget.querySelectorAll('button')); const at = buttons.indexOf(document.activeElement as HTMLButtonElement); buttons[(at + 1) % buttons.length]?.focus(); }
    }}><button role="menuitem" onClick={() => { const c = conversations.find(c => c.id === menu?.id); if (c) { setTitle(c.title); setEditing(c.id); setError(''); } setMenu(null); }}><Pencil size={14} />{tr("重命名")}</button><button role="menuitem" className="danger-text" onClick={() => menu && void remove(menu.id)}><Trash2 size={14} />{tr("删除")}</button></div></Presence>
  </div>;
}
