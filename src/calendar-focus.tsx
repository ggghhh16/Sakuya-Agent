import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent } from 'react';
import { tr } from './i18n';

export type TimeRange = [number, number];
export const rangeTime = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

export default function CalendarFocus({range, change}: {range: TimeRange; change: (range: TimeRange) => void}) {
  const bar = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{edge: 0 | 1 | 'range'; x: number; width: number; range: TimeRange} | null>(null);
  useEffect(() => {
    if (!drag) return;
    const move = (event: globalThis.PointerEvent) => {
      event.preventDefault();
      const delta = Math.round((event.clientX - drag.x) / drag.width * 1440 / 5) * 5;
      if (drag.edge === 'range') {
        const start = Math.max(0, Math.min(1440 - (drag.range[1] - drag.range[0]), drag.range[0] + delta));
        change([start, start + drag.range[1] - drag.range[0]]);
      } else {
        const next: TimeRange = [...drag.range];
        next[drag.edge] = drag.edge === 0 ? Math.max(0, Math.min(next[1] - 30, next[0] + delta)) : Math.min(1440, Math.max(next[0] + 30, next[1] + delta));
        change(next);
      }
    };
    const stop = () => setDrag(null);
    window.addEventListener('pointermove', move, {passive: false});
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    window.addEventListener('blur', stop);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); window.removeEventListener('pointercancel', stop); window.removeEventListener('blur', stop); };
  }, [drag, change]);
  const begin = (event: PointerEvent, edge: 0 | 1 | 'range') => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({edge, x: event.clientX, width: bar.current!.getBoundingClientRect().width, range});
  };
  return <section className="calendar-focus" aria-label={tr('聚焦时间范围')}>
    <div className="focus-caption"><strong>{tr('聚焦模式')}</strong><output>{rangeTime(range[0])} – {rangeTime(range[1])}</output><small>{tr('拖动两端调整范围，拖动中间平移')}</small></div>
    <div className="focus-track" ref={bar}>
      <div className="focus-selection" style={{left: `${range[0] / 14.4}%`, width: `${(range[1] - range[0]) / 14.4}%`}} onPointerDown={event => begin(event, 'range')} />
      {([0, 1] as const).map(edge => <button key={edge} type="button" className="focus-handle" role="slider" aria-label={tr(edge === 0 ? '聚焦开始时间' : '聚焦结束时间')} aria-valuemin={edge === 0 ? 0 : range[0] + 30} aria-valuemax={edge === 0 ? range[1] - 30 : 1440} aria-valuenow={range[edge]} aria-valuetext={rangeTime(range[edge])} style={{left: `${range[edge] / 14.4}%`} as CSSProperties} onPointerDown={event => begin(event, edge)} onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const min = edge === 0 ? 0 : range[0] + 30, max = edge === 0 ? range[1] - 30 : 1440;
        const next: TimeRange = [...range];
        next[edge] = event.key === 'Home' ? min : event.key === 'End' ? max : Math.max(min, Math.min(max, range[edge] + (event.key === 'ArrowLeft' ? -5 : 5)));
        change(next);
      }} />)}
    </div>
    <div className="focus-ticks">{[0, 4, 8, 12, 16, 20, 24].map(hour => <span key={hour}>{String(hour).padStart(2, '0')}:00</span>)}</div>
  </section>;
}
