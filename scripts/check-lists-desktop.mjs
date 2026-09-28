import {_electron as electron, expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';

const executable = process.argv[2];
if (!executable) throw new Error('Pass the packaged desktop executable to verify.');
const profile = resolve(`.data/desktop-lists-${Date.now()}`);
mkdirSync(profile, {recursive: true});
const env = {...process.env, SAKUYA_TEST: '1', SAKUYA_PORT: '8147', SAKUYA_DATA_DIR: `${profile}/workspace`, SAKUYA_DESKTOP_DATA: profile, SAKUYA_ENV_FILE: `${profile}/absent.env`, NO_PROXY: '127.0.0.1,localhost', NODE_USE_ENV_PROXY: '0'};
for (const name of ['ELECTRON_RUN_AS_NODE', 'SAKUYA_DEV_URL', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY']) delete env[name];
let app;
try {
  app = await electron.launch({executablePath: resolve(executable), env, timeout: 30000});
  const page = await app.firstWindow();
  await page.waitForURL('http://127.0.0.1:8147/**', {timeout: 30000});
  const token = execFileSync(resolve('.venv/Scripts/python.exe'), ['-c', `
from app import db,auth
from fastapi import Response
db.init();auth.init()
identifier=db.uid('lists_e2e')
with db.connect() as con:
 con.execute('INSERT INTO users VALUES (?,?,?,?,?)',(identifier,identifier+'@example.com',auth.password_hash('E2ePassword'),'user',db.now()))
print(auth.issue_session(identifier,Response()))
`], {env: {...env, PYTHONPATH: resolve('backend'), PYTHONUTF8: '1'}, windowsHide: true, encoding: 'utf8'}).trim();
  await page.context().addCookies([{name: 'sakuya_session', value: token, url: 'http://127.0.0.1:8147', httpOnly: true, sameSite: 'Lax'}]);
  await page.evaluate(() => localStorage.setItem('sakuya-language', 'zh-CN'));
  const request = page.context().request;
  const headers = {'X-Sakuya-Client': 'workspace'};
  const first = (await (await request.get('http://127.0.0.1:8147/api/planner')).json()).lists[0];
  const list = await (await request.post('http://127.0.0.1:8147/api/planner/lists', {headers, data: {name: '新版清单验证'}})).json();
  await request.post('http://127.0.0.1:8147/api/planner/entries', {headers, data: {list_id: list.id, title: '仅测试数据'}});
  await page.goto('http://127.0.0.1:8147/#calendar');
  await page.getByRole('button', {name: '我的规划', exact: true}).click();
  const listing = page.getByRole('button', {name: list.name, exact: true});
  const checkbox = page.getByRole('checkbox', {name: `显示清单 ${list.name}`});
  await expect(checkbox).toBeChecked();
  await listing.click(); await expect(checkbox).toBeChecked();
  await checkbox.click(); await expect(checkbox).not.toBeChecked();
  await listing.dragTo(page.locator(`[data-list-id="${first.id}"]`), {targetPosition: {x: 80, y: 2}});
  await expect.poll(async () => (await (await request.get('http://127.0.0.1:8147/api/planner')).json()).preferences.list_order).toEqual([list.id, first.id]);
  await listing.click({button: 'right'});
  const editor = page.getByRole('dialog', {name: '编辑清单'});
  await expect(editor).toBeVisible();
  await editor.getByRole('button', {name: '设为默认', exact: true}).click();
  await expect(editor.getByRole('button', {name: '设为默认', exact: true})).toHaveAttribute('aria-pressed', 'true');
  await editor.getByRole('button', {name: '删除', exact: true}).click();
  await expect(listing).toHaveCount(0);
  const state = await (await request.get('http://127.0.0.1:8147/api/planner')).json();
  assert.equal(state.entries.length, 0);
  assert.equal(state.preferences.default_calendar_list, '');
  console.log('PASS: packaged desktop and bundled backend support list checkbox, drag order, right-click editor, default and nonempty local deletion.');
} finally {
  if (app) await app.close();
}
