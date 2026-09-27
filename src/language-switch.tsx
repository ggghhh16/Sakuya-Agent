import { Check, Languages } from 'lucide-react';
import { useState } from 'react';
import { languages, setLocale, tr, useLocale } from './i18n';
import { Popover } from './motion';

export default function LanguageSwitch() {
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  return <div className="popover-anchor language-menu">
    <button type="button" className="icon-button language-switch" aria-label={tr('切换语言')} title={tr('切换语言')} aria-expanded={open} onClick={() => setOpen(!open)}>
      <Languages size={18}/><span>{locale === 'zh-CN' ? '中' : locale === 'ja' ? '日' : 'EN'}</span>
    </button>
    <Popover open={open} close={() => setOpen(false)} label={tr('切换语言')} className="header-popover language-popover">
      {languages.map(item => <button type="button" className="language-option" key={item.id} lang={item.id} aria-pressed={locale === item.id} onClick={() => { setLocale(item.id); setOpen(false); }}><span>{item.name}</span>{locale === item.id && <Check size={16}/>}</button>)}
    </Popover>
  </div>;
}
