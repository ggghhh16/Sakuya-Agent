import {_electron as electron, expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';

const executable = process.argv[2];
if (!executable) throw new Error('Pass the packaged desktop executable.');
const profile = resolve(`.data/desktop-focus-${Date.now()}`);
mkdirSync(profile, {recursive: true});
const env = {...process.env, SAKUYA_TEST: '1', SAKUYA_PORT: '8157', SAKUYA_DATA_DIR: `${profile}/workspace`, SAKUYA_DESKTOP_DATA: profile, SAKUYA_ENV_FILE: `${profile}/absent.env`, NO_PROXY: '127.0.0.1,localhost', NODE_USE_ENV_PROXY: '0'};
for (const name of ['ELECTRON_RUN_AS_NODE', 'SAKUYA_DEV_URL', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY']) delete env[name];
let app;
try {
  app = await electron.launch({executablePath: resolve(executable), env, timeout: 30000});
  const page = await app.firstWindow();
  await page.waitForURL('http://127.0.0.1:8157/**', {timeout: 30000});
  const token = execFileSync(resolve('.venv/Scripts/python.exe'), ['-c', `
from app import db,auth
from fastapi import Response
db.init();auth.init()
identifier=db.uid('focus_e2e')
with db.connect() as con:
 con.execute('INSERT INTO users VALUES (?,?,?,?,?)',(identifier,identifier+'@example.com',auth.password_hash('E2ePassword'),'user',db.now()))
print(auth.issue_session(identifier,Response()))
`], {env: {...env, PYTHONPATH: resolve('backend'), PYTHONUTF8: '1'}, windowsHide: true, encoding: 'utf8'}).trim();
  await page.context().addCookies([{name: 'sakuya_session', value: token, url: 'http://127.0.0.1:8157', httpOnly: true, sameSite: 'Lax'}]);
  await page.evaluate(() => localStorage.setItem('sakuya-language', 'zh-CN'));
  await page.emulateMedia({reducedMotion: 'reduce'});
  await page.goto('http://127.0.0.1:8157/#calendar');
  await page.getByLabel('日历视图').selectOption('day');
  const scroll = page.locator('.calendar-scroll');
  const initial = await scroll.evaluate(el => el.scrollTop), rect = await scroll.boundingBox();
  await page.mouse.move(rect.x + 100, rect.y + 100); await page.mouse.down({button: 'middle'});
  await page.mouse.move(rect.x + 100, rect.y + 180, {steps: 8}); await page.mouse.up({button: 'middle'});
  assert.equal(await scroll.evaluate(el => el.scrollTop), initial - 80);
  await page.getByRole('button', {name: '聚焦模式', exact: true}).click();
  await expect(page.getByRole('region', {name: '聚焦时间范围'})).toBeVisible();
  const slider = page.getByRole('slider', {name: '聚焦开始时间'});
  await slider.focus(); await page.keyboard.press('ArrowRight');
  await expect(slider).toHaveAttribute('aria-valuenow', '485');
  await page.screenshot({path: `${profile}/calendar.png`});
  await expect.poll(async () => {
    const grid = await page.locator('.time-grid').boundingBox(), viewport = await scroll.boundingBox();
    return Math.abs(grid.height - viewport.height);
  }).toBeLessThan(2);
  await page.getByRole('textbox', {name: '聊天消息'}).fill('检查流式回复');
  await page.getByRole('button', {name: '发送消息', exact: true}).click();
  await expect(page.locator('.streaming-reply')).toContainText('这是演示回复');
  await expect(page.getByRole('button', {name: '停止生成'})).toBeVisible();
  await expect(page.getByRole('button', {name: '停止生成'})).toHaveCount(0);
  await expect(page.locator('.assistant-content .markdown')).toContainText('尚未调用模型');
  console.log('PASS: packaged desktop focus range, proportional grid, middle-button pan and bundled backend SSE.');
  console.log(`Screenshot: ${profile}/calendar.png`);
} finally {
  if (app) await app.close();
}
