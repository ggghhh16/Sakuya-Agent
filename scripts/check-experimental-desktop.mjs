import {_electron as electron, expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';

const executable = process.argv[2];
if (!executable) throw new Error('Pass the packaged desktop executable.');
const profile = resolve(`.data/desktop-experimental-${Date.now()}`);
mkdirSync(profile, {recursive: true});
const env = {...process.env, SAKUYA_TEST: '1', SAKUYA_PORT: '8157', SAKUYA_DATA_DIR: `${profile}/workspace`, SAKUYA_DESKTOP_DATA: profile, SAKUYA_ENV_FILE: `${profile}/absent.env`, NO_PROXY: '127.0.0.1,localhost', NODE_USE_ENV_PROXY: '0'};
for (const name of ['ELECTRON_RUN_AS_NODE', 'SAKUYA_DEV_URL', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY']) delete env[name];
let app;
try {
  app = await electron.launch({executablePath: resolve(executable), args:['--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows'], env, timeout: 30000});
  const page = await app.firstWindow();
  // A hidden native window acknowledges pointer input only once per second,
  // which turns a normal drag into a long press. Show the isolated test window.
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(window=>{window.webContents.setBackgroundThrottling(false);window.showInactive();}));
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
  const request=page.context().request,headers={'X-Sakuya-Client':'workspace'};
  const root='http://127.0.0.1:8157';

  await page.goto(root+'/#diagnosis');
  await expect(page.getByRole('heading',{name:'实验性功能未开启'})).toBeVisible();
  await expect(page.getByRole('navigation',{name:'工作功能'}).getByRole('button',{name:'Issue 诊断',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'前往设置'}).click();
  const toggle=page.getByRole('checkbox',{name:'开启实验性功能'});
  await expect(toggle).not.toBeChecked();await toggle.click();await expect(toggle).toBeChecked();
  await page.reload();await expect(toggle).toBeChecked();
  await page.getByRole('button',{name:'打开工作功能'}).hover();await page.getByRole('navigation',{name:'工作功能'}).getByRole('button',{name:'Issue 诊断',exact:true}).click();
  await expect(page.getByRole('button',{name:'新建Issue 诊断'})).toBeVisible();
  await page.getByRole('button',{name:'对话选项',exact:true}).click();await page.locator('.agent-option').filter({hasText:'Issue 诊断'}).click();
  await page.goto(root+'/#settings');await toggle.click();await expect(toggle).not.toBeChecked();
  await expect(page.getByRole('button',{name:'排查代码问题'})).toHaveCount(0);
  await page.getByRole('button',{name:'对话选项',exact:true}).click();await expect(page.locator('.agent-option').filter({hasText:'Issue 诊断'})).toHaveCount(0);await page.keyboard.press('Escape');
  const response=await request.post(root+'/api/runs',{headers,data:{title:'诊断访问限制',prompt:'测试默认关闭时的访问限制',kind:'diagnosis',mode:'demo'}});assert.equal(response.status(),403);
  await toggle.scrollIntoViewIfNeeded();await page.screenshot({path:`${profile}/experimental-setting.png`});
  console.log('PASS: packaged desktop experimental setting, default hidden, enable and persistence, diagnosis access, disable and API rejection.');
  console.log(`Screenshot: ${profile}/experimental-setting.png`);
} finally { if(app) await app.close(); }
