import { Languages } from 'lucide-react';
import { setLocale, useLocale } from './i18n';

export default function LanguageSwitch() {
  const locale = useLocale();
  const label = locale === 'zh-CN' ? 'Switch to English' : '切换为中文';
  return <button type="button" className="icon-button language-switch" aria-label={label} title={label}
    onClick={() => setLocale(locale === 'zh-CN' ? 'en' : 'zh-CN')}>
    <Languages size={18} /><span lang={locale === 'zh-CN' ? 'en' : 'zh-CN'}>{locale === 'zh-CN' ? 'EN' : '中'}</span>
  </button>;
}
