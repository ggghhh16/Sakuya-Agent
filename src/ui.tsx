import { tr, useLocale, getLocale } from './i18n';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { X, LoaderCircle, ArrowUpRight, FileText, FlaskConical, Bug, Inbox } from 'lucide-react';
import type { RunStatus, Ticket, RunKind } from './types';

export const statusLabels: Record<RunStatus, string> = { get queued() { return tr("排队中"); }, get running() { return tr("进行中"); }, get waiting() { return tr("待确认"); }, get completed() { return tr("已完成"); }, get failed() { return tr("运行失败"); }, get cancelled() { return tr("已取消"); } };
export const ticketLabels: Record<Ticket['status'], string> = { get open() { return tr("待处理"); }, get in_progress() { return tr("处理中"); }, get waiting() { return tr("待补充"); }, get resolved() { return tr("已解决"); } };
export const kindLabels = { get research() { return tr("深度研究"); }, get diagnosis() { return tr("Issue 诊断"); } };
export const KindIcon = ({ kind, size = 18 }: { kind: RunKind; size?: number }) => kind === 'research' ? <FlaskConical size={size} /> : <Bug size={size} />;
export function Status({ value, ticket = false }: { value: string; ticket?: boolean }) {
  useLocale(); return <span className={`status status-${value}`}><i />{ticket ? ticketLabels[value as Ticket['status']] : statusLabels[value as RunStatus]}</span>; }
export function Demo({ seed = false }: { seed?: boolean }) {
  useLocale(); return <span className="demo-label">{seed ? tr("示例") : tr("演示")}</span>; }
export function date(value: string) { return new Date(value).toLocaleDateString(getLocale(), { month: 'short', day: 'numeric' }); }
export function time(value: string) { return new Date(value).toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' }); }
export function Empty({ title, description, action, icon }: { title: string; description: string; action?: ReactNode; icon?: ReactNode }) {
  useLocale(); return <div className="empty"><div className="empty-icon">{icon || <Inbox size={26} strokeWidth={1.3} />}</div><h3>{title}</h3><p>{description}</p>{action}</div>; }
export function Loading() {
  useLocale(); return <div className="loading"><LoaderCircle className="spin" size={22} /><span>{tr("正在打开工作区…")}</span></div>; }
export function PageHeader({ icon, eyebrow, title, description, actions }: { icon: ReactNode; eyebrow?: string; title: string; description: string; actions?: ReactNode }) {
  useLocale(); return <div className="page-header"><div className="page-icon">{icon}</div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<div className="page-title-row"><h1>{title}</h1>{actions && <div className="page-actions">{actions}</div>}</div><p>{description}</p></div>; }
export type FloatingRect = { left: number; right: number; top: number; bottom: number };
export function Modal({ title, children, close, wide = false, leave, anchor, nonModal = false, hidden = false, outside }: { title: string; children: ReactNode; close: () => void; wide?: boolean; leave?: () => void; anchor?: FloatingRect | null; nonModal?: boolean; hidden?: boolean; outside?: () => void }) {
  useLocale();
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{left: number; top: number}>();
  const outsideRef = useRef(outside);
  outsideRef.current = outside;
  useEffect(() => {
    if (!nonModal || hidden || !outside) return;
    let blockPress: {x: number; y: number} | null = null;
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Element;
      blockPress = null;
      if (ref.current?.contains(target)) return;
      // Wait for release on the active block: clicks dismiss, dragging keeps the editor.
      if (target.closest('[data-draft="true"]')) { blockPress = {x: event.clientX, y: event.clientY}; return; }
      outsideRef.current?.();
    };
    const release = (event: PointerEvent) => {
      if (blockPress && Math.abs(event.clientX - blockPress.x) + Math.abs(event.clientY - blockPress.y) <= 3) outsideRef.current?.();
      blockPress = null;
    };
    document.addEventListener('pointerdown', dismiss, true);
    document.addEventListener('pointerup', release, true);
    return () => { document.removeEventListener('pointerdown', dismiss, true); document.removeEventListener('pointerup', release, true); };
  }, [nonModal, hidden, !!outside]);
  useLayoutEffect(() => {
    if (hidden) return;
    if (!anchor || !ref.current) { setPosition(undefined); return; }
    const place = () => {
      const box = ref.current!.getBoundingClientRect();
      const gap = 12, minTop = window.sakuyaDesktop?.embedded ? 44 : 12;
      const left = anchor.right + gap + box.width <= window.innerWidth - gap ? anchor.right + gap : anchor.left - box.width - gap;
      setPosition({left: Math.max(gap, Math.min(left, window.innerWidth - box.width - gap)), top: Math.max(minTop, Math.min(anchor.top, window.innerHeight - box.height - gap))});
    };
    place();
    const observer = new ResizeObserver(place); observer.observe(ref.current);
    window.addEventListener('resize', place);
    return () => { observer.disconnect(); window.removeEventListener('resize', place); };
  }, [anchor, hidden]);
  useEffect(() => {
    if (hidden) return;
    const previous = document.activeElement as HTMLElement;
    const timer = setTimeout(() => { if (!ref.current?.contains(document.activeElement)) ref.current?.querySelector<HTMLElement>('input,textarea,select,button')?.focus(); }, 30);
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      if (e.key === 'Tab' && !nonModal) {
        const nodes = ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input,textarea,select,a[href]');
        if (!nodes?.length) return;
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', handler);
    return () => { clearTimeout(timer); document.removeEventListener('keydown', handler); if (ref.current?.contains(document.activeElement) || document.activeElement === document.body) previous?.focus(); };
  }, [close, hidden, nonModal]);
  return <div style={hidden ? {display: 'none'} : undefined} className={`modal-backdrop ${anchor ? 'anchored-backdrop' : ''} ${nonModal ? 'nonmodal-backdrop' : ''}`} onMouseDown={e => e.target === e.currentTarget && close()}><div ref={ref} style={anchor && position ? {position: 'fixed', ...position} : undefined} onMouseLeave={leave} className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal={nonModal ? undefined : true} aria-label={title}><div className="modal-heading"><h2>{title}</h2><button className="icon-button" aria-label={tr("关闭弹窗")} onClick={close}><X size={18} /></button></div>{children}</div></div>;
}
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  useLocale(); return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>; }
export function Fold({ open, children }: { open: boolean; children: ReactNode }) {
  useLocale(); return <div className={`fold ${open ? 'expanded' : ''}`} inert={!open} aria-hidden={!open}><div className="fold-inner">{children}</div></div>; }
export function Disclosure({ label, children }: { label: string; children: ReactNode }) {
  useLocale(); const [open, setOpen] = useState(false); return <div className="advanced"><button type="button" className="disclosure-trigger" aria-expanded={open} onClick={() => setOpen(!open)}><span className={open ? 'rotate' : ''}>›</span>{label}</button><Fold open={open}><div className="disclosure-content">{children}</div></Fold></div>; }
export function SectionTitle({ title, detail, action }: { title: string; detail?: string; action?: ReactNode }) {
  useLocale(); return <div className="section-title"><div><h2>{title}</h2>{detail && <span>{detail}</span>}</div>{action}</div>; }
export function External({ href, children }: { href: string; children: ReactNode }) {
  useLocale(); if (!/^https?:\/\//.test(href)) return <span>{children}</span>; return <a href={href} target="_blank" rel="noreferrer" className="external-link">{children}<ArrowUpRight size={13} /></a>; }
export function FileMark() {
  useLocale(); return <span className="file-mark"><FileText size={17} strokeWidth={1.5} /></span>; }
