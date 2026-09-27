const locale = ['zh-CN', 'ja'].includes(window.sakuyaDesktop?.language) ? window.sakuyaDesktop.language : 'en';
document.documentElement.lang = locale;
document.querySelector('p').textContent = locale === 'en' ? 'Starting your local assistant…' : locale === 'ja' ? 'ローカルアシスタントを起動中…' : '正在启动本地助手…';
