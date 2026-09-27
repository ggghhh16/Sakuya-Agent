import { _electron as electron, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const release = process.argv[2] || 'release-security/win-unpacked';
const profile = resolve(`.data/desktop-calendar-${Date.now()}`);
mkdirSync(profile, {recursive: true});
mkdirSync('test-results', {recursive: true});
const env = {...process.env, SAKUYA_TEST: '1', SAKUYA_PORT: '8136', SAKUYA_DATA_DIR: `${profile}/workspace`, SAKUYA_DESKTOP_DATA: profile,
  TURNSTILE_SITE_KEY: '', NO_PROXY: '127.0.0.1,localhost', NODE_USE_ENV_PROXY: '0'};
for (const key of ['ELECTRON_RUN_AS_NODE', 'SAKUYA_DEV_URL', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY']) delete env[key];
let app;
try {
  app = await electron.launch({executablePath: resolve(release, 'Sakuya Agent.exe'), env, timeout: 30000});
  const page = await app.firstWindow();
  await expect(page.getByRole('heading', {name: '登录 Sakuya'})).toBeVisible({timeout: 30000});
  // Create a test-only session in an isolated database, without changing production login.
  const session = execFileSync(resolve('.venv/Scripts/python.exe'), ['-c', `
from app import db, auth
from fastapi import Response
db.init(); auth.init()
identifier = db.uid('calendar_e2e')
with db.connect() as con:
    con.execute('INSERT INTO users VALUES (?,?,?,?,?)', (identifier, identifier+'@example.com', auth.password_hash('E2ePassword'), 'user', db.now()))
print(auth.issue_session(identifier, Response()))
`], {env: {...env, PYTHONPATH: resolve('backend'), PYTHONUTF8: '1'}, windowsHide: true, encoding: 'utf8'}).trim();
  const origin = new URL(page.url()).origin;
  await page.context().addCookies([{name: 'sakuya_session', value: session, url: origin, httpOnly: true, sameSite: 'Lax'}]);
  await page.emulateMedia({reducedMotion: 'reduce'});
  await page.goto(`${origin}/#calendar`);
  await expect(page.locator('html')).toHaveAttribute('data-desktop', 'true');
  await expect(page.locator('.header-left .language-switch')).toBeVisible();
  await expect(page.locator('.header-left').getByRole('button', {name: '主题设置', exact: true})).toBeVisible();
  const strip = await page.locator('.desktop-titlebar').boundingBox();
  const nativeArea = await page.evaluate(() => ({height: navigator.windowControlsOverlay.getTitlebarAreaRect().height, width: innerWidth}));
  assert.equal(strip.width, nativeArea.width);
  assert.equal(strip.height, 32); assert.equal(nativeArea.height, 31);
  await page.getByLabel('日历视图').selectOption('day');
  const column = page.locator('.calendar-day');
  const c = await column.boundingBox();
  const x = c.x + 40, y = c.y + 10 * 72;
  await page.mouse.click(x, y);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x, y + 30, {steps: 8}); await page.mouse.up();
  const dialog = page.getByRole('dialog');
  const draft = page.locator('[data-draft="true"]');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('标题', {exact: true}).fill('桌面拖动验证');
  await expect(dialog.getByRole('status')).toHaveText('标题已自动保存');
  const d = await draft.boundingBox();
  await page.mouse.move(d.x + 40, d.y + d.height / 2); await page.mouse.down();
  await page.mouse.move(d.x + 40, d.y + d.height / 2 + 72, {steps: 8});
  await expect(dialog).not.toBeVisible(); await page.mouse.up();
  await expect(dialog).toBeVisible(); await expect(draft).toHaveAttribute('aria-label', /11:00.*11:25/);
  await expect(dialog.getByLabel('标题', {exact: true})).toHaveValue('桌面拖动验证');
  const a = await draft.boundingBox(), b = await dialog.boundingBox();
  assert(Math.min(Math.abs(a.x - b.x - b.width), Math.abs(b.x - a.x - a.width)) <= 16);
  await dialog.getByRole('button', {name: '保存', exact: true}).click();
  await expect(dialog).not.toBeVisible();
  const block = page.locator('.calendar-event').filter({hasText: '桌面拖动验证'});
  await block.click();
  await expect(page.getByRole('dialog', {name: '日程详情'})).toBeVisible();
  await page.getByRole('dialog').getByLabel('标题', {exact: true}).fill('桌面自动保存验证');
  await expect(page.getByRole('dialog').getByRole('status')).toHaveText('标题已自动保存');
  await page.locator('.calendar-hint').click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  // Hidden Electron windows can stop producing compositor frames after reload.
  // Keep screenshots optional; behavior and persisted-data assertions remain mandatory.
  await page.screenshot({path: 'test-results/desktop-calendar-v7.png', timeout: 5000}).catch(() => console.log('Hidden-window screenshot unavailable; continuing mandatory interaction checks.'));
  await page.reload();
  await expect(page.locator('.calendar-event').filter({hasText: '桌面自动保存验证'})).toHaveCount(1);
  await page.getByRole('button', {name: '增加显示天数'}).click();
  await expect(page.locator('.calendar-day')).toHaveCount(2);
  await page.getByRole('button', {name: '我的规划', exact: true}).click();
  const sidebar = page.locator('.planner-sidebar');
  await sidebar.getByRole('button', {name: '任务清单', exact: true}).click(); await expect(sidebar).toBeVisible();
  await sidebar.getByRole('button', {name: '日历', exact: true}).click(); await expect(sidebar).toBeVisible();
  await page.getByRole('button', {name: '设置', exact: true}).click();
  await page.getByRole('button', {name: '工单', exact: true}).click();
  await expect(page).toHaveURL(/#tickets$/);
  console.log('Packaged desktop titlebar, header controls, tickets via settings, calendar movement, title autosave and outside dismissal passed.');
} finally { if (app) await app.close(); }
