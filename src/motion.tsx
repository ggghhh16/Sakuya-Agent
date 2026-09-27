import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

/** Retain the content until the closing animation finishes. */
export function Presence({ show, children, className = '' }: { show: boolean; children: ReactNode; className?: string }) {
  const [mounted, setMounted] = useState(show);
  const last = useRef(children);
  useEffect(() => { if (show) last.current = children; }, [show, children]);
  useEffect(() => {
    if (show) { setMounted(true); return; }
    const timer = setTimeout(() => setMounted(false), matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180);
    return () => clearTimeout(timer);
  }, [show]);
  if (!show && !mounted) return null;
  return <div className={`presence ${className}`} data-state={show ? 'open' : 'closed'} inert={!show}>{show ? children : last.current}</div>;
}

export function Popover({ open, close, children, label, className = '' }: { open: boolean; close: () => void; children: ReactNode; label: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const onClose = useRef(close);
  onClose.current = close;
  useEffect(() => {
    if (!open) return;
    const trigger = document.activeElement as HTMLElement;
    const timer = setTimeout(() => ref.current?.querySelector<HTMLElement>('button,input,select')?.focus(), 20);
    function keyboard(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose.current(); trigger?.focus(); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const options = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') || []);
        const index = options.indexOf(document.activeElement as HTMLElement);
        if (index >= 0) { e.preventDefault(); options[(index + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length]?.focus(); }
      }
    }
    function outside(e: PointerEvent) { if (!ref.current?.contains(e.target as Node) && !trigger?.contains(e.target as Node)) onClose.current(); }
    function focusOutside(e: FocusEvent) { if (!ref.current?.contains(e.target as Node) && e.target !== trigger) onClose.current(); }
    document.addEventListener('keydown', keyboard);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', focusOutside);
    return () => { clearTimeout(timer); document.removeEventListener('keydown', keyboard); document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', focusOutside); };
  }, [open]);
  return <Presence show={open} className={`popover-presence ${className}`}><div ref={ref} role="dialog" aria-label={label} className="quiet-popover">{children}</div></Presence>;
}
