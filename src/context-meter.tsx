import type { ChatTurn } from './types';
import { tr } from './i18n';

// Approximation, not provider-reported usage: match the server's last 12 completed
// same-mode turns and 4,000-character truncation, with allowance for tool schemas.
export function estimateContext(turns: ChatTurn[], draft: string, demo: boolean, references: unknown[] = []) {
  const active = turns.find(t => ['queued', 'running', 'waiting'].includes(t.status));
  const pending = (active?.prompt || '') + JSON.stringify(active?.references || []);
  const text = turns.filter(t => t.status === 'completed' && t.mode === (demo ? 'demo' : 'live')).slice(-12)
    .map(t => t.prompt.slice(0, 4000) + JSON.stringify(t.references || []) + t.report.slice(0, 4000)).join('\n') + pending + draft + JSON.stringify(references);
  const wide = (text.match(/[^\u0000-\u007f]/g) || []).length;
  return Math.ceil((text.length - wide) / 4 + wide * 1.5) + (demo ? 128 : 2400);
}
export default function ContextMeter({ tokens, capacity }: { tokens: number; capacity?: number | null }) {
  const limit = capacity || 32768;
  const percent = Math.min(100, Math.round(tokens / limit * 100));
  const label = tr('上下文约 {0}% · {1} / {2} tokens', [percent, tokens.toLocaleString(), limit.toLocaleString()]);
  const detail = capacity ? tr('估算值，实际用量以供应商为准') : tr('未配置模型容量，暂按 32K 估算；可在设置中修改');
  return <div className="context-meter" tabIndex={0} role="progressbar" aria-label={tr('上下文占比（估算）')} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-valuetext={label}>
    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" /><circle className="context-fill" cx="12" cy="12" r="8" pathLength="100" strokeDasharray={`${percent} 100`} /></svg>
    <span role="tooltip"><strong>{label}</strong><small>{detail}</small></span>
  </div>;
}
