import { productName } from './edition';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import './styles.css';
import './minimal.css';
import './workspace.css';
import './refinements.css';
import './preferences.css';
import { applyTheme } from './theme-switch';
import { AuthGate } from './auth';

document.documentElement.dataset.desktop = window.sakuyaDesktop?.embedded ? 'true' : 'false';
applyTheme();
document.title = productName;
function DesktopTitlebar() {
  React.useEffect(() => {
    const sync = () => window.sakuyaDesktop?.setTheme?.(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark', document.documentElement.dataset.themeFamily as 'sakuya' | 'a' | 'notion');
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-theme-family'] });
    return () => observer.disconnect();
  }, []);
  return window.sakuyaDesktop?.embedded ? <div className="desktop-titlebar"><img src="/sakuya.svg" alt=""/><span>{productName}</span></div> : null;
}
const client = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } } });
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><DesktopTitlebar/><QueryClientProvider client={client}><AuthGate>{user => <App key={user.id} user={user} />}</AuthGate></QueryClientProvider></React.StrictMode>);
