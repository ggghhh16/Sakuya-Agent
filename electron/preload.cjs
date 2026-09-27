const { contextBridge, ipcRenderer } = require('electron');
const language = process.argv.includes('--sakuya-language=zh-CN') ? 'zh-CN' : 'en';
// Only a validated locale preference is exposed; no general IPC or filesystem access.
contextBridge.exposeInMainWorld('sakuyaDesktop', Object.freeze({ embedded: true, language,
  setLanguage: value => { if (value === 'en' || value === 'zh-CN') ipcRenderer.send('sakuya:set-language', value); },
}));
