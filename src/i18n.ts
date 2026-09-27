import { useSyncExternalStore } from 'react';
import english from './locales/en.json';

export type Locale = 'zh-CN' | 'en';
const storageKey = 'sakuya-language';
const listeners = new Set<() => void>();
function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved === 'en' || saved === 'zh-CN') return saved;
  } catch { /* Storage can be disabled in a browser profile. */ }
  return window.sakuyaDesktop?.language ?? (navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en');
}
let locale = initialLocale();
export const getLocale = () => locale;
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function useLocale() { return useSyncExternalStore(subscribe, getLocale); }
export function setLocale(next: Locale) {
  locale = next;
  document.documentElement.lang = next;
  try { localStorage.setItem(storageKey, next); } catch { /* Keep the in-memory preference. */ }
  window.sakuyaDesktop?.setLanguage?.(next);
  listeners.forEach(listener => listener());
}
document.documentElement.lang = locale;
window.sakuyaDesktop?.setLanguage?.(locale);
window.addEventListener('storage', event => {
  if (event.key === storageKey && (event.newValue === 'en' || event.newValue === 'zh-CN')) setLocale(event.newValue);
});

/** Only explicitly marked interface text is translated; user content is untouched. */
export function tr(source: string, values: readonly (string | number)[] = []): string {
  const template = locale === 'en' ? (english as Record<string, string>)[source] ?? source : source;
  return template.replace(/\{(\d+)\}/g, (match, index: string) => String(values[Number(index)] ?? match));
}

export function weekdays(width: 'short' | 'narrow' = 'short') {
  return Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(locale, { weekday: width, timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 1 + i))));
}
