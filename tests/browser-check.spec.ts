import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const { safeExternal } = createRequire(import.meta.url)('../electron/external.cjs');
const id = 'a'.repeat(32);

test('只允许系统浏览器打开本站验证页面和 HTTPS 地址', () => {
  const origin = 'http://127.0.0.1:8120';
  expect(safeExternal(`${origin}/human-check#id=${id}`, origin)).toBe(true);
  expect(safeExternal('https://example.com/help', origin)).toBe(true);
  for (const url of [`${origin}/`, `${origin}/human-check#id=short`, `${origin}/human-check?next=evil#id=${id}`, `http://localhost:8120/human-check#id=${id}`, `http://127.0.0.1:9999/human-check#id=${id}`, `http://evil.example/human-check#id=${id}`, `file:///C:/Windows/notepad.exe`, `javascript:alert(1)`, `https://user:pass@example.com`]) {
    expect(safeExternal(url, origin), url).toBe(false);
  }
});

test('桌面在当前窗口验证，失败重试及切换用途均不打开浏览器', async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign(window, { sakuyaDesktop: { embedded: true }, openedExternal: false });
    window.open = () => { Object.assign(window, { openedExternal: true }); return null; };
  });
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user: null } }));
  await page.route('**/api/auth/config', route => route.fulfill({ json: { site_key: 'test', registration_ready: true } }));
  await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js*', route => route.fulfill({ contentType: 'application/javascript', body: `
    let attempt = 0; window.actions = [];
    window.turnstile = { render(el, options) { window.actions.push(options.action); const n = ++attempt; setTimeout(() => n === 1 ? options['error-callback']('600010') : options.callback('test-token'), 20); return String(n); }, remove() {} };
  ` }));
  await page.goto('/');
  await expect(page.locator('script[data-turnstile]')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '在浏览器中验证' })).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText('600010');
  await expect(page.getByRole('alert')).toContainText('桌面内置验证');
  await expect(page.locator('button[type=submit]')).toBeDisabled();
  await page.getByRole('button', { name: '重新验证', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('button[type=submit]')).toBeEnabled();
  await page.getByRole('button', { name: '注册', exact: true }).first().click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { actions: string[] }).actions)).toEqual(['login', 'login', 'register']);
  expect(await page.evaluate(() => (window as unknown as { openedExternal: boolean }).openedExternal)).toBe(false);
});

test('独立浏览器页面验证完成后提示返回桌面，无须浏览器登录', async ({ page }) => {
  await page.route('**/api/auth/config', route => route.fulfill({ json: { site_key: 'test' } }));
  await page.route(`**/api/auth/browser-check/${id}`, route => route.fulfill({ json: { action: 'register', verified: false } }));
  let completed = false;
  await page.route(`**/api/auth/browser-check/${id}/complete`, route => {
    expect(route.request().postDataJSON()).toEqual({ human_token: 'test-cloudflare-token' });
    completed = true;
    return route.fulfill({ json: { ok: true } });
  });
  await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js*', route => route.fulfill({ contentType: 'application/javascript', body: `window.turnstile = { render(el, options) { if (options.action !== 'register') throw Error('Wrong action'); setTimeout(() => options.callback('test-cloudflare-token'), 20); return 'test'; }, remove() {} };` }));
  await page.goto(`/human-check#id=${id}`);
  await expect(page.getByRole('status')).toContainText('验证成功，请返回 Sakuya 桌面继续');
  expect(completed).toBe(true);
  await expect(page.locator('input[type=password]')).toHaveCount(0);
});

test('已失效的浏览器验证地址不加载验证码', async ({ page }) => {
  await page.route('**/api/auth/config', route => route.fulfill({ json: { site_key: 'test' } }));
  await page.route(`**/api/auth/browser-check/${id}`, route => route.fulfill({ status: 410, json: { detail: '本次验证已过期或已使用，请返回桌面重新发起' } }));
  await page.goto(`/human-check#id=${id}`);
  await expect(page.getByRole('alert')).toContainText('本次验证已过期或已使用');
  await expect(page.locator('script[data-turnstile]')).toHaveCount(0);
});

test('内嵌浏览器标识保持真实版本，存储权限仅限验证码域名', () => {
  const { chromiumUserAgent, allowChallengeStorage } = createRequire(import.meta.url)('../electron/browser-policy.cjs');
  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) sakuya-agent/0.1.0 Chrome/152.0.1.2 Electron/44.4.5 Safari/537.36';
  expect(chromiumUserAgent(ua)).toBe('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.1.2 Safari/537.36');
  const top = 'http://127.0.0.1:8120';
  expect(allowChallengeStorage('storage-access', 'https://challenges.cloudflare.com/frame', top + '/?launch=1', top)).toBe(true);
  for (const [permission, requesting, parent] of [
    ['media', 'https://challenges.cloudflare.com', top],
    ['storage-access', 'https://evil.example', top],
    ['storage-access', 'https://challenges.cloudflare.com', 'https://evil.example'],
    ['storage-access', 'http://challenges.cloudflare.com', top],
  ]) expect(allowChallengeStorage(permission, requesting, parent, top)).toBe(false);
});
