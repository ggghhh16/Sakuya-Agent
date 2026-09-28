import { _electron as electron, expect } from '@playwright/test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const executable = process.argv[2];
if (!executable) throw new Error('Pass the Client executable.');
const profile = resolve(`.data/client-validation-${Date.now()}`);
mkdirSync(profile, { recursive: true });
const baseEnv = { ...process.env, SAKUYA_TEST: '1', NO_PROXY: '127.0.0.1,localhost', NODE_USE_ENV_PROXY: '0' };
for (const name of ['ELECTRON_RUN_AS_NODE', 'SAKUYA_DEV_URL', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY']) delete baseEnv[name];
let app, dev;
const root = 'http://127.0.0.1:8161';
const env = { ...baseEnv, SAKUYA_CLIENT_PORT: '8161', SAKUYA_CLIENT_DESKTOP_DATA: `${profile}/client`, SAKUYA_CLIENT_DATA_DIR: `${profile}/client/workspace`, SAKUYA_CLIENT_ENV_FILE: `${profile}/absent.env`, SAKUYA_EDITION: 'dev',
  SAKUYA_PORT: '8162', SAKUYA_DATA_DIR: `${profile}/must-not-use`, SAKUYA_DESKTOP_DATA: `${profile}/must-not-use`, SAKUYA_DEV_URL: 'http://127.0.0.1:5173' };
// The packaged edition must win over a conflicting inherited environment value.
const headers = { 'X-Sakuya-Client': 'workspace' };
async function launchClient() {
  app = await electron.launch({ executablePath: resolve(executable), args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'], env, timeout: 60000 });
  const page = await app.firstWindow();
  await page.waitForURL(root + '/**', { timeout: 60000 });
  await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().forEach(window => { window.webContents.setBackgroundThrottling(false); window.showInactive(); }));
  await page.evaluate(() => localStorage.setItem('sakuya-language', 'zh-CN'));
  await page.reload();
  await expect(page.locator('.wordmark')).toHaveText('Sakuya Client');
  await expect(page.locator('.auth-card')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '退出登录' })).toHaveCount(0);
  return page;
}
try {
  let page = await launchClient();
  const context = page.context();
  const request = context.request;
  assert.equal((await (await request.get(root + '/api/health')).json()).edition, 'client');
  assert.equal(existsSync(`${profile}/must-not-use`), false);
  assert.equal((await context.cookies()).some(c => c.name === 'sakuya_session'), false);
  assert.equal((await (await request.get(root + '/api/workspace')).json()).settings.model_configured, false);
  await page.goto(root + '/#settings');
  await expect(page.getByRole('heading', { name: 'API 供应商' })).toBeVisible();
  await expect(page.getByRole('button', { name: '工单', exact: true })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: '开启实验性功能' })).toHaveCount(0);
  for (const route of ['tickets', 'ticket/old', 'diagnosis']) {
    await page.goto(root + '/#' + route);
    await expect(page.locator('.work-feature')).toHaveCount(0);
  }
  await page.getByRole('button', { name: '对话选项', exact: true }).click();
  await expect(page.locator('.agent-option').filter({ hasText: 'Issue 诊断' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  const planner = await (await request.get(root + '/api/planner')).json();
  const task = await request.post(root + '/api/planner/entries', { headers, data: { title: 'Client 独立任务', list_id: planner.lists[0].id } });
  assert.equal(task.status(), 201);
  const created = await task.json();
  await page.goto(root + '/#todos');
  await expect(page.getByText('Client 独立任务', { exact: true })).toBeVisible();
  const chat = await request.post(root + '/api/chat', { headers, data: { prompt: 'Client demo smoke test', mode: 'demo' } });
  assert.equal(chat.status(), 201);
  const queued = await chat.json();
  await expect.poll(async () => (await (await request.get(root + '/api/workspace')).json()).chats.find(c => c.id === queued.run.id)?.status, { timeout: 45000 }).toBe('completed');
  const reply = (await (await request.get(root + '/api/workspace')).json()).chats.find(c => c.id === queued.run.id).report;
  assert(!/Issue 诊断|工单|登录|注册/.test(reply));
  await page.screenshot({ path: `${profile}/client-tasks.png` });
  await page.goto(root + '/#settings');
  await page.screenshot({ path: `${profile}/client-settings.png` });
  assert.equal((await request.post(root + '/api/auth/login', {headers, data: {}})).status(), 404);
  assert.equal((await request.post(root + '/api/tickets', {headers, data: {}})).status(), 404);
  assert.equal((await request.post(root + '/api/runs', {headers, data: {title:'No diagnosis', prompt:'Not available in Client',kind:'diagnosis'}})).status(), 404);
  assert.equal((await request.get(root + '/api/workspace', {headers:{Origin:'http://127.0.0.1:8120'}})).status(), 403);
  assert.equal(await page.evaluate(() => !!document.querySelector('script[data-turnstile]')), false);
  // Run the original edition at the same time, with its own temporary data.
  dev = await electron.launch({ executablePath: resolve('node_modules/electron/dist/electron.exe'), args: ['.'], env: { ...baseEnv, SAKUYA_PORT:'8162', SAKUYA_EDITION:'client', SAKUYA_DESKTOP_DATA:`${profile}/dev`, SAKUYA_DATA_DIR:`${profile}/dev/workspace`, SAKUYA_ENV_FILE:`${profile}/absent.env` }, timeout:60000 });
  const devPage = await dev.firstWindow();
  await devPage.waitForURL('http://127.0.0.1:8162/**', {timeout:60000});
  await expect(devPage.locator('.auth-card')).toBeVisible();
  assert.equal((await devPage.context().request.get('http://127.0.0.1:8162/api/workspace')).status(), 401);
  assert.equal((await (await devPage.context().request.get('http://127.0.0.1:8162/api/health')).json()).edition, 'dev');
  assert.notEqual(await app.evaluate(({app}) => app.getPath('userData')), await dev.evaluate(({app}) => app.getPath('userData')));
  await dev.close(); dev = null;
  assert.equal((await request.get(root + '/api/workspace')).status(), 200);
  await app.close(); app = null;
  page = await launchClient();
  const restored = await (await page.context().request.get(root + '/api/planner')).json();
  assert(restored.entries.some(t => t.id === created.id && t.title === created.title));
  writeFileSync(`${profile}/result.json`, JSON.stringify({verified:true, executable:resolve(executable), checks:['no-login','no-auth-network','removed-feature-UI-and-API','task-persistence','demo-chat-worker','dev-client-coexistence','independent-data','cross-origin-rejection','bundled-edition']}, null, 2));
  console.log(`PASS: Client packaged desktop and dev coexistence. Evidence: ${profile}`);
} finally {
  if (dev) await dev.close();
  if (app) await app.close();
}
