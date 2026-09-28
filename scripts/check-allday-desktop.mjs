import {_electron as electron, expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';

const executable = process.argv[2];
if (!executable) throw new Error('Pass the packaged desktop executable.');
const profile = resolve(`.data/desktop-allday-${Date.now()}`);
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


  await page.goto(root+'/#calendar');await page.getByLabel('日历视图').selectOption('week');
  const dates=await page.locator('.calendar-day').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-date')));
  const data=await(await request.get(root+'/api/planner')).json();
  for(const [title,start,end] of [['领教材',dates[0],dates[1]],['安排明天听课内容',dates[0],dates[1]],['医务室开病假',dates[1],dates[2]],['国庆节',dates[3],dates[4]]])assert.ok((await request.post(root+'/api/planner/entries',{headers,data:{title,start,end,all_day:true,kind:'event',list_id:data.lists[0].id}})).ok());
  await page.reload();const row=page.locator('.all-day-row');
  await expect(row.locator('.all-day-count')).toHaveText('2 个活动');assert.ok((await row.boundingBox()).height<=30);
  await page.screenshot({path:`${profile}/collapsed.png`});
  await page.getByRole('button',{name:'展开全天日程',exact:true}).click();await expect(row.locator('.all-day-event')).toHaveCount(4);assert.ok((await row.boundingBox()).height>40);
  await row.getByRole('button',{name:'领教材',exact:true}).click();await expect(page.getByRole('dialog',{name:'日程详情'})).toBeVisible();await page.keyboard.press('Escape');
  await page.screenshot({path:`${profile}/expanded.png`});
  await page.getByRole('button',{name:'收起全天日程',exact:true}).click();await row.locator('.all-day-count').click();await expect(row.locator('.all-day-event')).toHaveCount(4);
  console.log('PASS: packaged desktop compact all-day summary, arrow/count expansion, event details and collapse.');console.log(`Screenshots: ${profile}`);
} finally {if(app) await app.close();}
