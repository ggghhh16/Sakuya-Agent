const { contextBridge, ipcRenderer } = require('electron');
const preference = process.argv.find(arg => arg.startsWith('--sakuya-language='))?.split('=')[1];
const language = ['en', 'zh-CN', 'ja'].includes(preference) ? preference : 'en';
// Only validated display preferences are exposed; no general IPC or filesystem access.
contextBridge.exposeInMainWorld('sakuyaDesktop', Object.freeze({ embedded: true, language,
  openAuthorization: url => ipcRenderer.invoke('sakuya:open-authorization', url),
  detachPanel: options => ipcRenderer.invoke('sakuya:detach-panel', {route: options?.route, x: options?.x, y: options?.y}),
  setTheme: (value, family = 'sakuya') => { if ((value === 'dark' || value === 'light') && ['sakuya', 'a', 'notion'].includes(family)) ipcRenderer.send('sakuya:set-theme', value, family); },
  setLanguage: value => { if (['en', 'zh-CN', 'ja'].includes(value)) ipcRenderer.send('sakuya:set-language', value); },
}));
