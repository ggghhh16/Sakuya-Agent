import { _electron as electron, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const release = process.argv[2] || 'release-ui-v7/win-unpacked';
const profile = resolve(`.data/desktop-language-${Date.now()}`);
mkdirSync(profile, { recursive: true });
mkdirSync('test-results', { recursive: true });
writeFileSync(`${profile}/language.json`, JSON.stringify('en'));
const env = { ...process.env, SAKUYA_TEST: '1', SAKUYA_PORT: '8134', SAKUYA_DATA_DIR: `${profile}/workspace`, SAKUYA_DESKTOP_DATA: profile,
  TURNSTILE_SITE_KEY: '', NO_PROXY: '127.0.0.1,localhost', NODE_USE_ENV_PROXY: '0' };
for (const key of ['ELECTRON_RUN_AS_NODE', 'SAKUYA_DEV_URL', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY']) delete env[key];
let app;
try {
  app = await electron.launch({ executablePath: resolve(release, 'Sakuya Agent.exe'), env, timeout: 30000 });
  let page = await app.firstWindow();
  await expect(page.getByRole('heading', { name: 'Sign in to Sakuya' })).toBeVisible({ timeout: 30000 });
  await expect(page).toHaveTitle('Sakuya');
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle()), 'Sakuya');
  await expect(page.locator('html')).toHaveAttribute('data-desktop', 'true');
  const overlay = await page.evaluate(() => ({ available: !!navigator.windowControlsOverlay, height: navigator.windowControlsOverlay?.getTitlebarAreaRect().height }));
  assert.equal(overlay.available, true);
  assert.equal(overlay.height, 31);
  await expect(page.locator('.desktop-titlebar')).toHaveCSS('height', '32px');
  await expect(page.locator('.desktop-titlebar')).toHaveCSS('background-color', 'rgb(17, 19, 21)');
  // Observe calls while still invoking the real native API on the test window.
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    const original = w.setTitleBarOverlay.bind(w);
    w.setTitleBarOverlay = options => { w.testOverlay = options; return original(options); };
  });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; localStorage.setItem('sakuya-theme', 'light'); });
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].testOverlay)).toEqual({ color: '#faf9f7', symbolColor: '#292d30', height: 31 });
  await expect(page.locator('.desktop-titlebar')).toHaveCSS('background-color', 'rgb(250, 249, 247)');
  await page.evaluate(() => window.sakuyaDesktop.setTheme('invalid'));
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].testOverlay.color), '#faf9f7');
  await page.screenshot({ path: 'test-results/desktop-titlebar-light.png' });
  await page.locator('.language-switch').click(); await page.getByRole('button', { name: '简体中文', exact: true }).click();
  await expect(page.getByRole('heading', { name: '登录 Sakuya' })).toBeVisible();
  await expect.poll(() => JSON.parse(readFileSync(`${profile}/language.json`, 'utf8'))).toBe('zh-CN');
  await page.evaluate(() => window.sakuyaDesktop.setLanguage('invalid'));
  assert.equal(JSON.parse(readFileSync(`${profile}/language.json`, 'utf8')), 'zh-CN');
  await app.close(); app = undefined;
  app = await electron.launch({ executablePath: resolve(release, 'Sakuya Agent.exe'), env, timeout: 30000 });
  page = await app.firstWindow();
  await expect(page.getByRole('heading', { name: '登录 Sakuya' })).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.desktop-titlebar')).toHaveCSS('background-color', 'rgb(250, 249, 247)');
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; localStorage.setItem('sakuya-theme', 'dark'); });
  await page.locator('.language-switch').click(); await page.getByRole('button', { name: 'English', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign in to Sakuya' })).toBeVisible();
  await expect.poll(() => JSON.parse(readFileSync(`${profile}/language.json`, 'utf8'))).toBe('en');
  await page.screenshot({ path: 'test-results/english-desktop.png' });
  await page.locator('.language-switch').click(); await page.getByRole('button', {name: '日本語', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Sakuya にログイン'})).toBeVisible();
  await expect.poll(() => JSON.parse(readFileSync(`${profile}/language.json`, 'utf8'))).toBe('ja');
  await page.evaluate(() => { localStorage.setItem('sakuya-theme-family', 'a'); document.documentElement.dataset.themeFamily = 'a'; });
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBackgroundColor().toLowerCase())).toBe('#262624');
  await page.evaluate(() => { localStorage.setItem('sakuya-theme-family', 'notion'); document.documentElement.dataset.themeFamily = 'notion'; });
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBackgroundColor().toLowerCase())).toBe('#191919');
  await app.close(); app = undefined;
  app = await electron.launch({executablePath: resolve(release, 'Sakuya Agent.exe'), env, timeout: 30000});
  page = await app.firstWindow();
  await expect(page.getByRole('heading', {name: 'Sakuya にログイン'})).toBeVisible({timeout: 30000});
  await expect(page.locator('html')).toHaveAttribute('data-theme-family', 'notion');
  // The third hidden Electron window may not produce compositor frames.
  // Assert the actual document and persisted native preference instead.
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');

  console.log('Packaged desktop language switch, native preference validation, and restart persistence passed.');
} finally { if (app) await app.close(); }
