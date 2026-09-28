import {useEffect, useRef, useState} from 'react';
import type {PointerEvent as ReactPointerEvent} from 'react';

export function useTaskSelection(scope: string) {
  const root = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [rectangle, setRectangle] = useState<{left: number; top: number; width: number; height: number} | null>(null);
  const selecting = useRef(false), suppressClick = useRef(false);
  const pending = useRef<{x: number; y: number; originScroll: number; pointer: number; additive: string[]; lastX: number; lastY: number} | null>(null);
  useEffect(() => { setSelected([]); }, [scope]);
  useEffect(() => {
    function update(x: number, y: number) {
      const state = pending.current, el = root.current;
      if (!state || !el || !selecting.current) return;
      state.lastX = x; state.lastY = y;
      const originY = state.y - (el.scrollTop - state.originScroll);
      const left = Math.min(state.x, x), right = Math.max(state.x, x), top = Math.min(originY, y), bottom = Math.max(originY, y);
      const ids = [...el.querySelectorAll<HTMLElement>('[data-task-id]')].filter(row => { const box = row.getBoundingClientRect(); return box.width && box.bottom >= top && box.top <= bottom && box.right >= left && box.left <= right; }).map(row => row.dataset.taskId!);
      setSelected([...new Set([...state.additive, ...ids])]);
      setRectangle({left, top, width: right - left, height: bottom - top});
    }
    function stop() {
      const state = pending.current;
      if (state && root.current?.hasPointerCapture(state.pointer)) root.current.releasePointerCapture(state.pointer);
      if (selecting.current) { suppressClick.current = true; window.setTimeout(() => { suppressClick.current = false; }, 0); }
      pending.current = null; selecting.current = false; setRectangle(null);
    }
    const move = (event: PointerEvent) => {
      const state = pending.current;
      if (!state) return;
      if (!selecting.current) {
        if (Math.abs(event.clientX-state.x)+Math.abs(event.clientY-state.y)<4) return;
        selecting.current = true; window.getSelection()?.removeAllRanges();
      }
      event.preventDefault(); update(event.clientX, event.clientY);
    };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { stop(); setSelected([]); } };
    let frame = 0;
    const scroll = () => {
      const state = pending.current, el = root.current;
      if (selecting.current && state && el) { const box = el.getBoundingClientRect(); const delta = state.lastY < box.top + 25 ? -8 : state.lastY > box.bottom - 25 ? 8 : 0; if (delta) { el.scrollTop += delta; update(state.lastX, state.lastY); } }
      frame = requestAnimationFrame(scroll);
    };
    frame = requestAnimationFrame(scroll);
    window.addEventListener('pointermove', move, {passive: false}); window.addEventListener('pointerup', stop); window.addEventListener('pointercancel', stop); window.addEventListener('blur', stop); window.addEventListener('keydown', key);
    return () => { stop(); cancelAnimationFrame(frame); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); window.removeEventListener('pointercancel', stop); window.removeEventListener('blur', stop); window.removeEventListener('keydown', key); };
  }, []);
  const pointerDown = (event: ReactPointerEvent) => {
    if (event.button !== 0 || (event.target as Element).closest('[data-task-id],button,input,textarea,select,a,[role="button"]')) return;
    event.preventDefault();
    root.current?.setPointerCapture(event.pointerId);
    pending.current = {x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, originScroll: root.current!.scrollTop, pointer: event.pointerId, additive: event.ctrlKey || event.metaKey ? selected : []};
  };
  return {root, selected, setSelected, rectangle, selecting, suppressClick, pointerDown};
}
