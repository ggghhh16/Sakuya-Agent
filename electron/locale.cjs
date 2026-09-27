const { readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');
const validLocale = value => ['en', 'zh-CN', 'ja'].includes(value);
function readLocale(directory, systemLocale) {
  try { const value = JSON.parse(readFileSync(join(directory, 'language.json'), 'utf8')); if (validLocale(value)) return value; } catch {}
  return systemLocale.toLowerCase().startsWith('zh') ? 'zh-CN' : systemLocale.startsWith('ja') ? 'ja' : 'en';
}
function saveLocale(directory, locale) {
  if (!validLocale(locale)) return;
  try { mkdirSync(directory, { recursive: true }); writeFileSync(join(directory, 'language.json'), JSON.stringify(locale)); } catch { /* Read-only profiles retain this session's choice. */ }
}
const labels = {
  ja: { tooltip: 'Sakuya · ローカルアシスタント', desktop: 'デスクトップを開く', web: 'ブラウザーで開く', quit: 'Sakuya を終了（サービス停止）', error: 'Sakuya の起動に失敗しました' },
  en: { tooltip: 'Sakuya · Local assistant', desktop: 'Open desktop', web: 'Open in browser', quit: 'Quit Sakuya (stop local service)', error: 'Sakuya failed to start' },
  'zh-CN': { tooltip: 'Sakuya · 本地助手', desktop: '打开桌面端', web: '打开网页版', quit: '退出 Sakuya（停止本地服务）', error: 'Sakuya 启动失败' },
};
module.exports = { validLocale, readLocale, saveLocale, labels };
