import { useEffect, useState } from 'react';
import { Check, Moon, Palette, Sun } from 'lucide-react';
import { Popover } from './motion';
import { tr } from './i18n';

export const themeFamilies = ['sakuya', 'a', 'notion'] as const;
type Family = typeof themeFamilies[number];
export function applyTheme() {
  const family = localStorage.getItem('sakuya-theme-family');
  document.documentElement.dataset.theme = localStorage.getItem('sakuya-theme') === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.themeFamily = themeFamilies.includes(family as Family) ? family! : 'sakuya';
}
export default function ThemeSwitch({control = 'settings'}: {control?: 'toggle' | 'settings'}) {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState(document.documentElement.dataset.theme || 'dark');
  const [family, setFamily] = useState(document.documentElement.dataset.themeFamily || 'sakuya');
  useEffect(() => {
    const sync = () => { applyTheme(); setTheme(document.documentElement.dataset.theme!); setFamily(document.documentElement.dataset.themeFamily!); };
    window.addEventListener('storage', sync);
    window.addEventListener('sakuya-theme-change', sync);
    return () => { window.removeEventListener('storage', sync); window.removeEventListener('sakuya-theme-change', sync); };
  }, []);
  function choose(nextFamily: string, nextTheme: string) {
    localStorage.setItem('sakuya-theme-family', nextFamily); localStorage.setItem('sakuya-theme', nextTheme);
    setFamily(nextFamily); setTheme(nextTheme); applyTheme();
    window.dispatchEvent(new Event('sakuya-theme-change'));
  }
  if (control === 'toggle') return <button className="icon-button" aria-label={tr('切换主题')} title={tr('切换主题')} onClick={() => choose(family, theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={18}/> : <Moon size={18}/>}</button>;
  return <div className="header-preference popover-anchor">
    <button className="icon-button" aria-label={tr('主题设置')} title={tr('主题设置')} aria-expanded={open} onClick={() => setOpen(!open)}><Palette size={18}/></button>
    <Popover open={open} close={() => setOpen(false)} label={tr('主题设置')} className="header-popover theme-popover">
      <span className="popover-caption">{tr('主题设置')}</span>
      {themeFamilies.map(id => <div className="theme-family" key={id}><strong>{id === 'a' ? 'A/' : id === 'notion' ? 'Notion' : 'Sakuya'}</strong><div>{(['light', 'dark'] as const).map(mode => <button type="button" key={mode} aria-pressed={family === id && theme === mode} onClick={() => choose(id, mode)}><span className={`theme-swatch swatch-${id}-${mode}`}/>{tr(mode === 'light' ? '浅色' : '深色')}{family === id && theme === mode && <Check size={14}/>}</button>)}</div></div>)}
    </Popover>
  </div>;
}
