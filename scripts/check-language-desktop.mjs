import { _electron as electron, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const release = process.argv[2] || 'release-user-workspace/win-unpacked';
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
  await page.getByRole('button', { name: '切换为中文', exact: true }).click();
  await expect(page.getByRole('heading', { name: '登录 Sakuya' })).toBeVisible();
  await expect.poll(() => JSON.parse(readFileSync(`${profile}/language.json`, 'utf8'))).toBe('zh-CN');
  await page.evaluate(() => window.sakuyaDesktop.setLanguage('invalid'));
  assert.equal(JSON.parse(readFileSync(`${profile}/language.json`, 'utf8')), 'zh-CN');
  await app.close(); app = undefined;
  app = await electron.launch({ executablePath: resolve(release, 'Sakuya Agent.exe'), env, timeout: 30000 });
  page = await app.firstWindow();
  await expect(page.getByRole('heading', { name: '登录 Sakuya' })).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Switch to English', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign in to Sakuya' })).toBeVisible();
  await expect.poll(() => JSON.parse(readFileSync(`${profile}/language.json`, 'utf8'))).toBe('en');
  await page.screenshot({ path: 'test-results/english-desktop.png' });
  console.log('Packaged desktop language switch, native preference validation, and restart persistence passed.');
} finally { if (app) await app.close(); }
