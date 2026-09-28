import LanguageSwitch from './language-switch';
import { isClient } from './edition';
import { tr, useLocale } from './i18n';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { User } from './types';
import { Field, Loading } from './ui';

type Turnstile = { render: (element: HTMLElement, options: Record<string, unknown>) => string; remove: (id: string) => void };
declare global { interface Window { turnstile?: Turnstile; sakuyaDesktop?: { embedded: boolean; openAuthorization?: (url:string)=>Promise<boolean>; detachPanel?: (options: {route: string; x?: number; y?: number}) => Promise<{ok: boolean; error?: string}>; language?: 'en' | 'zh-CN' | 'ja'; setLanguage?: (locale: 'en' | 'zh-CN' | 'ja') => void; setTheme?: (theme: 'dark' | 'light', family?: 'sakuya' | 'a' | 'notion') => void } } }

export function humanError(code: string, desktop: boolean) {
  const host = location.hostname;
  const messages: Record<string, string> = {
    '110100': tr("Site key 无效，请检查 Cloudflare 控制台与本机配置是否一致。"),
    '110110': tr("找不到此 Site key，请检查是否复制完整或已被删除。"),
    '110200': tr("当前主机 {0} 未获授权，请在 Cloudflare Turnstile 的 Hostname Management 中添加它（不含协议和端口）。", [host]),
    '110500': tr("当前浏览器环境不受支持，请更新桌面程序或浏览器后重试。"),
    '110600': tr("验证超时，请检查系统时间并重新验证。"),
    '110620': tr("验证交互超时，请重新验证。"),
    '200100': tr("系统时间或缓存异常，请同步 Windows 时间后刷新页面。"),
    '200500': tr("验证码框架加载失败，请检查 challenges.cloudflare.com 是否被网络或扩展拦截。"),
    '400020': tr("Site key 无效，请检查 Cloudflare 控制台与本机配置是否一致。"),
    '400021': tr("Site key 与验证服务域名不匹配，请检查 Cloudflare 配置。"),
    '400070': tr("此 Site key 已停用，请在 Cloudflare 控制台检查。"),
  };
  const generic = desktop
    ? tr("Cloudflare 未通过桌面内置验证，请点击重新验证；若持续失败，请保留此错误码以便排查兼容性。")
    : tr("Cloudflare 验证未通过。请尝试更新浏览器、暂时关闭干扰验证的扩展，或更换网络后重试。");
  return tr("人机验证失败（{0}）：{1}", [code || tr("未知错误"), messages[code] || generic]);
}

function HumanCheck({ siteKey, action, onToken, version }: { siteKey: string; action: string; onToken: (token: string) => void; version: number }) {
  const locale = useLocale();
  const root = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const desktop = !!window.sakuyaDesktop?.embedded || /Electron\//.test(navigator.userAgent);
  useEffect(() => {
    let cancelled = false, id: string | undefined;
    setError(''); onToken('');
    const render = () => {
      if (cancelled || !root.current || !window.turnstile || id) return;
      id = window.turnstile.render(root.current, { sitekey: siteKey, action, theme: 'dark', language: locale === 'zh-CN' ? 'zh-cn' : locale,
        callback: (token: string) => { setError(''); onToken(token); },
        'expired-callback': () => { onToken(''); setError("人机验证已过期，请重新验证。"); },
        'error-callback': (code: string) => { onToken(''); setError(humanError(String(code), desktop)); return true; } });
    };
    let script = document.querySelector<HTMLScriptElement>('script[data-turnstile]');
    if (script?.dataset.failed === 'true') { script.remove(); script = null; }
    if (!script) { script = document.createElement('script'); script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; script.async = true; script.dataset.turnstile = 'true'; document.head.appendChild(script); }
    const fail = () => { if (script) script.dataset.failed = 'true'; onToken(''); setError("无法加载人机验证脚本，请检查网络后点击重新验证。"); };
    script.addEventListener('load', render); script.addEventListener('error', fail); render();
    return () => { cancelled = true; script?.removeEventListener('load', render); script?.removeEventListener('error', fail); if (id) window.turnstile?.remove(id); };
  }, [siteKey, action, onToken, version, desktop, locale]);
  return <><div ref={root} className="human-check" />{error && <p role="alert">{tr(error)}</p>}</>;
}

export function AuthGate({ children }: { children: (user: User) => React.ReactNode }) {
  useLocale();
  if (!isClient && location.pathname === '/human-check') return <BrowserHumanCheckPage />;
  return <SessionGate>{children}</SessionGate>;
}

function BrowserHumanCheckPage() {
  useLocale();
  const id = new URLSearchParams(location.hash.slice(1)).get('id') || '';
  const valid = /^[A-Za-z0-9_-]{32}$/.test(id);
  const info = useQuery({ queryKey: ['browser-check', id], queryFn: () => api<{ action: string; verified: boolean }>(`/auth/browser-check/${id}`), enabled: valid, retry: false });
  const config = useQuery({ queryKey: ['auth-config'], queryFn: () => api<{ site_key: string }>('/auth/config') });
  const [token, setToken] = useState(''), [version, setVersion] = useState(0), [done, setDone] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    if (!token) return;
    let stopped = false;
    void api(`/auth/browser-check/${id}/complete`, 'POST', { human_token: token })
      .then(() => { if (!stopped) { setDone(true); setError(''); } })
      .catch((e: Error) => { if (!stopped) setError(e.message); });
    return () => { stopped = true; };
  }, [id, token]);
  const problem = !valid ? tr("验证地址无效，请从桌面重新打开。") : info.error?.message || config.error?.message;
  return <main className="auth-shell"><div className="auth-window-brand"><img src="/sakuya.svg" alt="" />Sakuya</div><section className="auth-card"><div className="auth-language"><LanguageSwitch /></div><h1>{tr("Sakuya 桌面人机验证")}</h1>
    {problem ? <p role="alert">{tr(problem)}</p> : done || info.data?.verified ? <p role="status">{tr("✓ 验证成功，请返回 Sakuya 桌面继续。可以关闭此页面。")}</p>
      : info.data && config.data?.site_key ? <><p>{tr("用于桌面端")}{info.data.action === 'login' ? tr("登录") : tr("发送注册邮箱验证码")}{tr("。完成后验证结果会自动返回桌面。")}</p>
        <HumanCheck siteKey={config.data.site_key} action={info.data.action} onToken={setToken} version={version} />
        {token && !error && <p role="status">{tr("正在确认验证结果…")}</p>}{error && <p role="alert">{tr(error)}</p>}
        <button className="text-button" type="button" onClick={() => { setToken(''); setError(''); setVersion(v => v + 1); }}>{tr("重新验证")}</button></>
      : info.isLoading || config.isLoading ? <Loading /> : <p role="alert">{tr("尚未配置人机验证，请联系管理员。")}</p>}
  </section></main>;
}

function SessionGate({ children }: { children: (user: User) => React.ReactNode }) {
  useLocale();
  const cache = useQueryClient();
  const session = useQuery({ queryKey: ['session'], queryFn: () => api<{ user: User | null }>('/auth/me'), retry: false });
  useEffect(() => { const expired = () => { cache.setQueryData(['session'], { user: null }); cache.removeQueries({ queryKey: ['workspace'] }); }; window.addEventListener('sakuya-session-expired', expired); return () => window.removeEventListener('sakuya-session-expired', expired); }, [cache]);
  if (session.isLoading) return <Loading />;
  if (session.error) return <div className="auth-shell"><p role="alert">{tr("无法连接本机服务：")}{tr(session.error.message)}</p><button className="button" onClick={() => session.refetch()}>{tr("重新连接")}</button></div>;
  if (session.data?.user) return children(session.data.user);
  if (isClient) return <div className="auth-shell"><p role="alert">{tr("无法连接本机服务：")}Client</p><button className="button" onClick={() => session.refetch()}>{tr("重新连接")}</button></div>;
  return <AuthForm signedIn={() => { cache.clear(); void session.refetch(); }} />;
}

function AuthForm({ signedIn }: { signedIn: () => void }) {
  useLocale();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [remember, setRemember] = useState(false);
  const [messageKind, setMessageKind] = useState<'success' | 'error'>('error');
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [confirmation, setConfirmation] = useState(''), [code, setCode] = useState('');
  const [token, setToken] = useState(''), [version, setVersion] = useState(0), [busy, setBusy] = useState(false), [sending, setSending] = useState(false), [cooldown, setCooldown] = useState(0), [message, setMessage] = useState('');
  const config = useQuery({ queryKey: ['auth-config'], queryFn: () => api<{ site_key: string; registration_ready: boolean }>('/auth/config') });
  const strong = password.length >= 8 && password.length <= 128 && /[a-z]/.test(password) && /[A-Z]/.test(password);
  useEffect(() => { if (!cooldown) return; const timer = setTimeout(() => setCooldown(c => c - 1), 1000); return () => clearTimeout(timer); }, [cooldown]);
  function resetHuman() { setToken(''); setVersion(v => v + 1); }
  async function sendCode() {
    setSending(true); setMessage('');
    try { const result = await api<{retry_after: number}>('/auth/email-code', 'POST', { email, human_token: token }); setCooldown(result.retry_after || 90); setMessageKind('success'); setMessage("验证码已发送，10 分钟内有效。"); }
    catch (e) { setMessageKind('error'); setMessage((e as Error).message); } finally { resetHuman(); setSending(false); }
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMessage('');
    try {
      if (mode === 'register') {
        if (!strong || password !== confirmation) throw new Error(tr("请满足密码强度要求，并确认两次密码一致"));
        await api('/auth/register', 'POST', { email, username, password, code }); setMode('login'); setPassword(''); setConfirmation(''); setCode(''); setMessageKind('success'); setMessage("注册成功，请登录。");
      } else { await api('/auth/login', 'POST', { identifier: email, password, human_token: token, remember }); signedIn(); }
    } catch (e) { setMessageKind('error'); setMessage((e as Error).message); } finally { resetHuman(); setBusy(false); }
  }
  return <main className="auth-shell"><div className="auth-window-brand"><img src="/sakuya.svg" alt="" />Sakuya</div><section className="auth-card"><div className="auth-language"><LanguageSwitch /></div><span className="greeting-mark">✳</span><h1>{mode === 'login' ? tr("登录 Sakuya") : tr("创建账号")}</h1><p className="muted">{mode === 'login' ? tr("登录后继续你的工作") : tr("使用邮箱注册，开始聊天与工作")}</p>
    <div className="segmented auth-tabs"><button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); resetHuman(); setMessage(''); }}>{tr("登录")}</button><button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); resetHuman(); setMessage(''); }}>{tr("注册")}</button></div>
    <form onSubmit={submit}><>{mode === 'register' && <Field label={tr("用户名")} hint={tr("3–32 位字母、数字、下划线或短横线")}><input aria-label={tr("用户名")} autoComplete="username" required minLength={3} maxLength={32} value={username} onChange={e => setUsername(e.target.value)} /></Field>}</><Field label={tr(mode === 'login' ? "用户名或邮箱" : "邮箱")}><input type={mode === 'login' ? "text" : "email"} autoComplete={mode === 'login' ? "username" : "email"} required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} /></Field><Field label={tr("密码")} hint={mode === 'register' ? tr("至少 8 位，且包含大写字母和小写字母") : undefined}><input aria-label={tr("密码")} type="password" required autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'register' ? 8 : 1} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} /></Field>
    {mode === 'register' && <>{strong && <p className="password-valid">{tr("✓ 密码强度符合要求")}</p>}<Field label={tr("确认密码")}><input type="password" autoComplete="new-password" required value={confirmation} onChange={e => setConfirmation(e.target.value)} /></Field></>}
    {mode === 'login' && <label className="auth-remember"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} /><span>{tr("记住下次登录")}<small>{tr("在此设备保留登录状态 30 天")}</small></span></label>}
    {config.data?.site_key ? <><HumanCheck siteKey={config.data.site_key} action={mode} onToken={setToken} version={version} /><button className="text-button" type="button" onClick={resetHuman}>{tr("重新验证")}</button></> : <p className="notice">{tr("管理员尚未配置 Turnstile 人机验证。")}</p>}
    {mode === 'register' && <><Field label={tr("邮箱验证码")}><div className="code-row"><input inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9]{6}" maxLength={6} value={code} onChange={e => setCode(e.target.value)} /><button type="button" className="button" disabled={!token || !email || sending || cooldown > 0 || !config.data?.registration_ready} onClick={() => void sendCode()}>{cooldown ? tr("{0} 秒后重发", [cooldown]) : sending ? tr("发送中…") : tr("发送验证码")}</button></div></Field>{!config.data?.registration_ready && <p className="notice">{tr("邮箱注册服务尚未配置完成，请联系管理员。")}</p>}</>}
    {message && <p role="status" className={messageKind === 'success' ? 'auth-success' : 'form-error'}>{tr(message)}</p>}<button type="submit" className="button primary auth-submit" disabled={busy || sending || (mode === 'login' ? !token : !strong || password !== confirmation || !code)}>{busy ? tr("正在提交…") : mode === 'login' ? tr("登录") : tr("注册")}</button></form>
  </section></main>;
}
