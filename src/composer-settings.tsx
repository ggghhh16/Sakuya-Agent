import { Check, ChevronDown, ChevronRight, RotateCcw, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import type { Settings } from './types';
import { Popover } from './motion';
import ContextMeter from './context-meter';
import { tr } from './i18n';

export type ApprovalMode = 'ask' | 'assist' | 'auto';
export default function ComposerSettings({ settings, modelId, effort, approval, onModel, onEffort, onApproval, contextTokens }: {
  contextTokens: number; settings: Settings; modelId: string; effort: number; approval: ApprovalMode;
  onModel: (id: string) => void; onEffort: (value: number) => void; onApproval: (mode: ApprovalMode) => void;
}) {
  const [menu, setMenu] = useState<'model' | 'approval' | null>(null);
  const [models, setModels] = useState(false);
  const selected = settings.models.find(m => m.id === modelId);
  const levels = [tr('默认'), tr('低'), tr('中'), tr('高')];
  const modes: { id: ApprovalMode; name: string; detail: string }[] = [
    { id: 'ask', name: tr('每次询问'), detail: tr('每轮资料检索和每次工具操作前确认') },
    { id: 'assist', name: tr('帮我批准'), detail: tr('读取自动执行，修改和同步需确认') },
    { id: 'auto', name: tr('自动批准'), detail: tr('本次对话或任务的工具与实验自动执行') },
  ];
  return <div className="composer-settings">
    <div className="popover-anchor"><button type="button" className="approval-trigger" aria-label={tr('权限批准模式')} aria-expanded={menu === 'approval'} onClick={() => setMenu(menu === 'approval' ? null : 'approval')}><ShieldCheck size={17} /><span>{modes.find(m => m.id === approval)?.name}</span></button>
      <Popover open={menu === 'approval'} close={() => setMenu(null)} label={tr('权限批准模式')} className="approval-popover"><span className="popover-caption">{tr('权限批准模式')}</span>{modes.map(m => <button type="button" className="approval-option" key={m.id} aria-pressed={approval === m.id} onClick={() => { onApproval(m.id); setMenu(null); }}><span>{m.name}<small>{m.detail}</small></span>{approval === m.id && <Check size={16} />}</button>)}</Popover>
    </div>
    <div className="composer-model-group"><ContextMeter tokens={contextTokens} capacity={selected?.context_window} /><div className="popover-anchor model-anchor"><button type="button" className="model-trigger" aria-label={tr('模型与思考强度')} aria-expanded={menu === 'model'} onClick={() => { setModels(false); setMenu(menu === 'model' ? null : 'model'); }}><span>{selected?.name || tr('选择模型')}</span><small>{levels[selected?.reasoning ? effort : 0]}</small><ChevronDown size={13} /></button>
      <Popover open={menu === 'model'} close={() => setMenu(null)} label={tr('模型设置')} className="model-popover">
        {models ? <><button className="popover-caption model-back" type="button" onClick={() => setModels(false)}>{tr('选择模型')}</button><div className="model-options">{settings.models.map(m => <button type="button" className="model-option" key={m.id} aria-pressed={m.id === modelId} onClick={() => { onModel(m.id); setModels(false); }}><span>{m.name}<small>{settings.providers.find(p => p.id === m.provider_id)?.name}</small></span>{m.id === modelId && <Check size={17} />}</button>)}</div>{!settings.models.length && <p className="muted">{tr('请在设置添加模型')}</p>}</> : <>
          <div className="reasoning-heading"><div><strong>{levels[selected?.reasoning ? effort : 0]}</strong><button type="button" onClick={() => setModels(true)}>{selected?.name || tr('选择模型')}<ChevronRight size={14} /></button></div><button type="button" className="icon-button" aria-label={tr('重置思考强度')} onClick={() => onEffort(0)}><RotateCcw size={17} /></button></div>
          <input className="reasoning-slider" type="range" aria-label={tr('思考强度')} aria-valuetext={levels[selected?.reasoning ? effort : 0]} min="0" max="3" step="1" value={selected?.reasoning ? effort : 0} disabled={!selected?.reasoning} onChange={e => onEffort(Number(e.target.value))} style={{ background: `linear-gradient(to right, #2475ef ${effort / 3 * 100}%, var(--line) ${effort / 3 * 100}%)` }} />
          <div className="reasoning-ticks">{levels.map(l => <span key={l}>{l}</span>)}</div>{!selected?.reasoning && <small className="reasoning-hint">{tr('此模型使用默认思考强度')}</small>}
        </>}
      </Popover>
    </div></div>
  </div>;
}
