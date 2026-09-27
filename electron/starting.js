const locale = window.sakuyaDesktop?.language === 'zh-CN' ? 'zh-CN' : 'en';
document.documentElement.lang = locale;
document.querySelector('p').textContent = locale === 'en' ? 'Starting your local assistant…' : '正在启动本地助手…';
