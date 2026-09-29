// Capture real UI interactions against an isolated local backend. No API mocks.
import { chromium, expect } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, createWriteStream } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const capture = resolve(root, '.build/readme-capture', new Date().toISOString().replace(/[:.]/g, '-'));
mkdirSync(capture, { recursive: true });
const python = resolve(root, '.venv/Scripts/python.exe');
const env = { ...process.env, PYTHONUTF8: '1', PYTHONPATH: resolve(root, 'backend'),
  SAKUYA_DATA_DIR: resolve(capture, 'data'), SAKUYA_ENV_FILE: resolve(capture, 'absent.env'),
  SAKUYA_PORT: '8136', VITE_PORT: '5186', NO_PROXY: '127.0.0.1,localhost' };
for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'MODEL_API_KEY', 'OPENAI_API_KEY', 'MODEL_NAME', 'MODEL_BASE_URL', 'TAVILY_API_KEY', 'GITHUB_TOKEN', 'SAKUYA_EDITION']) delete env[key];
const children = [];
function start(command, args, cwd) {
  const log = createWriteStream(resolve(capture, `service-${children.length}.log`));
  const child = spawn(command, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(log); child.stderr.pipe(log); children.push(child);
}
const pause = ms => new Promise(r => setTimeout(r, ms));
let browser;
const manifest = { source: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), clips: [] };
try {
  start(python, ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8136', '--no-proxy-headers', '--no-access-log'], resolve(root, 'backend'));
  start(python, ['-m', 'app.worker'], resolve(root, 'backend'));
  start(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1'], root);
  for (let n = 0; ; n++) {
    try { if ((await fetch('http://127.0.0.1:5186/api/health')).ok) break; } catch {}
    if (n > 90) throw new Error('Demo services did not start');
    await pause(500);
  }
  // Same session setup as tests/fixtures.ts; confined to this capture's fresh database.
  const token = execFileSync(python, ['-c', `
from app import db, auth
from fastapi import Response
db.init(); auth.init()
identifier = db.uid('demo')
with db.connect() as con:
    con.execute('INSERT INTO users VALUES (?,?,?,?,?)', (identifier, 'demo@example.com', auth.password_hash('ReadmeDemoOnly-2026'), 'user', db.now()))
print(auth.issue_session(identifier, Response()))
`], { cwd: root, env, windowsHide: true, encoding: 'utf8' }).trim();
  browser = await chromium.launch({ executablePath: process.env.DEMO_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', colorScheme: 'dark' });
  await context.addCookies([{ name: 'sakuya_session', value: token, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' }]);
  await context.addInitScript(() => {
    localStorage.setItem('sakuya-language', 'zh-CN');
    // Only a recording pointer; application content and styles are unchanged.
    addEventListener('DOMContentLoaded', () => {
      const pointer = document.createElement('div');
      pointer.style.cssText = 'position:fixed;left:-50px;top:-50px;width:16px;height:16px;border:2px solid #afe8d5;border-radius:50%;background:#afe8d533;box-shadow:0 0 0 3px #1118;pointer-events:none;z-index:2147483647;transform:translate(-50%,-50%)';
      document.body.append(pointer);
      addEventListener('mousemove', e => { pointer.style.left = e.clientX + 'px'; pointer.style.top = e.clientY + 'px'; });
      addEventListener('mousedown', () => { pointer.style.background = '#afe8d5aa'; });
      addEventListener('mouseup', () => { pointer.style.background = '#afe8d533'; });
    });
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const url = 'http://127.0.0.1:5186';
  const headers = { 'X-Sakuya-Client': 'workspace' };
  async function post(path, data) {
    const response = await context.request.post(url + path, { headers, data });
    if (!response.ok()) throw new Error(`${path}: ${response.status()} ${await response.text()}`);
    return response.json();
  }
  async function click(locator, options) { await locator.hover(); await pause(250); await locator.click(options); await pause(350); }
  async function type(locator, text) { await click(locator); await locator.pressSequentially(text, { delay: 70 }); await pause(350); }
  async function clip(id, title, subtitle, action) {
    const dir = resolve(capture, id); mkdirSync(dir, { recursive: true });
    let running = true, index = 0; const frames = []; const began = Date.now();
    const loop = (async () => {
      while (running) {
        const time = Date.now();
        const file = `${String(index++).padStart(5, '0')}.png`;
        const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
        writeFileSync(resolve(dir, file), Buffer.from(shot.data, 'base64'));
        frames.push({ file, time: time - began });
        await pause(Math.max(0, 100 - (Date.now() - time)));
      }
    })();
    try { await pause(900); await action(); await pause(1800); }
    finally { running = false; await loop; writeFileSync(resolve(dir, 'frames.json'), JSON.stringify({ frames, end: Date.now() - began })); }
    manifest.clips.push({ id, title, subtitle, dir, frames: frames.length });
    writeFileSync(resolve(capture, 'manifest.json'), JSON.stringify(manifest, null, 2));
    console.log(`Captured ${id}: ${frames.length} frames`);
  }

  await page.goto(url); await expect(page.getByLabel('聊天消息', { exact: true })).toBeVisible();
  await clip('01-chat', '01  聊天与历史恢复', 'CHAT & HISTORY  /  内置演示回复 · 未调用真实模型', async () => {
    await type(page.getByLabel('聊天消息', { exact: true }), '帮我梳理 Sakuya 的演示要点');
    await click(page.getByRole('button', { name: '发送消息', exact: true }));
    await expect(page.locator('.assistant-content .markdown')).toContainText('这是演示回复');
    await pause(1600);
    await click(page.getByRole('button', { name: '新对话', exact: true }));
    await click(page.getByRole('button', { name: '打开聊天记录', exact: true }));
    await pause(700);
    await click(page.getByRole('dialog', { name: '聊天记录' }).getByRole('button', { name: '帮我梳理 Sakuya 的演示要点', exact: true }));
    await expect(page.locator('.user-message')).toHaveCount(1);
    await page.reload(); await expect(page.locator('.assistant-content .markdown')).toContainText('这是演示回复');
  });

  await page.goto(url + '/#todos'); await expect(page.getByLabel('快速添加任务')).toBeVisible();
  await clip('02-tasks', '02  整理任务清单', 'TASK LISTS  /  创建清单 → 添加任务 → 设置优先级 → 完成', async () => {
    await click(page.getByRole('button', { name: '新建清单', exact: true }));
    const dialog = page.getByRole('dialog', { name: '新建清单', exact: true });
    await type(dialog.getByLabel('清单名称'), 'Sakuya 演示准备');
    await click(dialog.getByRole('button', { name: '颜色 #71cbb4' }));
    await click(dialog.getByRole('button', { name: '保存清单' }));
    await click(page.getByRole('button', { name: 'Sakuya 演示准备', exact: true }));
    for (const title of ['整理演示脚本', '录制核心交互', '更新项目 README']) {
      await type(page.getByLabel('快速添加任务'), title); await page.getByLabel('快速添加任务').press('Enter'); await pause(400);
    }
    await click(page.getByRole('button', { name: '编辑任务 录制核心交互' }), { button: 'right' });
    await click(page.getByRole('menuitem', { name: '高优先级', exact: true }));
    await expect(page.locator('.todo-row').filter({ hasText: '录制核心交互' }).locator('.task-check')).toHaveClass(/priority-high/);
    await click(page.getByRole('button', { name: '完成任务 整理演示脚本', exact: true }));
    await click(page.locator('.task-group-completed .task-group-heading'));
    await expect(page.locator('.todo-row.completed').filter({ hasText: '整理演示脚本' })).toBeVisible();
  });

  const planner = await (await context.request.get(url + '/api/planner')).json();
  const list = planner.lists.find(item => item.name === 'Sakuya 演示准备');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const entry = await post('/api/planner/entries', { title: '录制产品演示', kind: 'event', list_id: list.id, start: today + 'T10:00:00+08:00', end: today + 'T11:00:00+08:00' });
  await post('/api/planner/entries', { title: '检查 README 与发布素材', kind: 'event', list_id: list.id, start: today + 'T14:00:00+08:00', end: today + 'T15:00:00+08:00' });
  await page.goto(url + '/?panel=1#calendar'); await page.getByLabel('日历视图').selectOption('day');
  await page.locator('.calendar-scroll').evaluate(el => { el.scrollTop = 9 * 72; });
  const event = page.locator(`[data-entry-id="${entry.id}"]`); await expect(event).toBeVisible();
  await clip('03-calendar', '03  拖动安排日历', 'CALENDAR  /  移动时间块 → 调整时长 → 查看周视图', async () => {
    let box = await event.boundingBox();
    await page.mouse.move(box.x + 35, box.y + 20); await pause(500); await page.mouse.down();
    await page.mouse.move(box.x + 35, box.y + 92, { steps: 24 }); await pause(450); await page.mouse.up();
    await expect(event).toHaveAttribute('aria-label', /11:00.*12:00/); await pause(900);
    box = await event.locator('.resize-handle.bottom').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await pause(500); await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 36, { steps: 20 }); await pause(450); await page.mouse.up();
    await expect(event).toHaveAttribute('aria-label', /11:00.*12:30/); await pause(900);
    await click(event);
    await expect(page.getByRole('dialog', { name: '日程详情' })).toBeVisible(); await pause(1100);
    await page.keyboard.press('Escape');
    await page.getByLabel('日历视图').selectOption('week'); await expect(page.locator('.calendar-day')).toHaveCount(7);
    await page.locator('.calendar-scroll').evaluate(el => { el.scrollTop = 9 * 72; });
    await pause(1300);
  });
  const saved = (await (await context.request.get(url + '/api/planner')).json()).entries.find(item => item.id === entry.id);
  if (new Date(saved.end) - new Date(saved.start) !== 90 * 60 * 1000) throw new Error('Calendar duration was not persisted');
  if (errors.length) throw new Error(`Browser errors: ${errors.join('; ')}`);
  console.log(`CAPTURE_DIR=${capture}`);
} finally {
  await browser?.close();
  for (const child of children.reverse()) child.kill();
}
