import { useSyncExternalStore } from 'react';
import english from './locales/en.json';
import japanese from './locales/ja.json';

export const languages = [{id: 'zh-CN', name: '简体中文'}, {id: 'en', name: 'English'}, {id: 'ja', name: '日本語'}] as const;
export type Locale = typeof languages[number]['id'];
const validLocale = (value: unknown): value is Locale => languages.some(item => item.id === value);
const storageKey = 'sakuya-language';
const listeners = new Set<() => void>();
function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(storageKey);
    if (validLocale(saved)) return saved;
  } catch { /* Storage can be disabled in a browser profile. */ }
  const native = window.sakuyaDesktop?.language;
  return validLocale(native) ? native : navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : navigator.language.startsWith('ja') ? 'ja' : 'en';
}
let locale = initialLocale();
export const getLocale = () => locale;
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function useLocale() { return useSyncExternalStore(subscribe, getLocale); }
export function setLocale(next: Locale) {
  if (!validLocale(next)) return;
  locale = next;
  document.documentElement.lang = next;
  try { localStorage.setItem(storageKey, next); } catch { /* Keep the in-memory preference. */ }
  window.sakuyaDesktop?.setLanguage?.(next);
  listeners.forEach(listener => listener());
}
document.documentElement.lang = locale;
window.sakuyaDesktop?.setLanguage?.(locale);
window.addEventListener('storage', event => {
  if (event.key === storageKey && validLocale(event.newValue) && event.newValue !== locale) setLocale(event.newValue);
});

/** Only explicitly marked interface text is translated; user content is untouched. */
export function tr(source: string, values: readonly (string | number)[] = []): string {
  const catalog: Record<string, string> = locale === 'ja' ? japanese : english;
  const template = locale === 'zh-CN' ? source : catalog[source] ?? (english as Record<string, string>)[source] ?? source;
  return template.replace(/\{(\d+)\}/g, (match, index: string) => String(values[Number(index)] ?? match));
}

export function weekdays(width: 'short' | 'narrow' = 'short') {
  return Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(locale, { weekday: width, timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 1 + i))));
}
