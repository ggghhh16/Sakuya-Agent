import {_electron as electron,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const profile=resolve(`.data/desktop-panels-${Date.now()}`);mkdirSync(profile,{recursive:true});
const env={...process.env,SAKUYA_TEST:'1',SAKUYA_PORT:'8146',SAKUYA_DATA_DIR:`${profile}/workspace`,SAKUYA_DESKTOP_DATA:profile,SAKUYA_ENV_FILE:`${profile}/absent.env`,NO_PROXY:'127.0.0.1,localhost',NODE_USE_ENV_PROXY:'0'};
for(const name of ['ELECTRON_RUN_AS_NODE','SAKUYA_DEV_URL','HTTP_PROXY','HTTPS_PROXY','ALL_PROXY'])delete env[name];
let app;
try{
  const packagedExecutable=process.argv[2];
  app=await electron.launch({executablePath:resolve(packagedExecutable||'node_modules/electron/dist/electron.exe'),args:packagedExecutable?[]:[resolve('electron/main.cjs')],env,timeout:30000});
  const page=await app.firstWindow();await page.waitForURL('http://127.0.0.1:8146/**',{timeout:30000});
  const token=execFileSync(resolve('.venv/Scripts/python.exe'),['-c',`
from app import db,auth
from fastapi import Response
db.init();auth.init()
identifier=db.uid('panel_e2e')
with db.connect() as con:
 con.execute('INSERT INTO users VALUES (?,?,?,?,?)',(identifier,identifier+'@example.com',auth.password_hash('E2ePassword'),'user',db.now()))
print(auth.issue_session(identifier,Response()))
`],{env:{...env,PYTHONPATH:resolve('backend'),PYTHONUTF8:'1'},windowsHide:true,encoding:'utf8'}).trim();
  await page.context().addCookies([{name:'sakuya_session',value:token,url:'http://127.0.0.1:8146',httpOnly:true,sameSite:'Lax'}]);
  await page.evaluate(()=>localStorage.setItem('sakuya-language','zh-CN'));await page.goto('http://127.0.0.1:8146/#todos');
  await expect(page.locator('.task-workspace')).toBeVisible();
  const invalid=await page.evaluate(()=>window.sakuyaDesktop.detachPanel({route:'https://example.com'}));assert.equal(invalid.ok,false);
  await app.evaluate(({shell})=>{globalThis.authorizationUrls=[];shell.openExternal=async url=>{globalThis.authorizationUrls.push(url);};});
  assert.equal(await page.evaluate(()=>window.sakuyaDesktop.openAuthorization('https://example.com/')),false);
  assert.equal(await page.evaluate(()=>window.sakuyaDesktop.openAuthorization('https://accounts.google.com/o/oauth2/v2/auth?client_id=test-client')),true);
  assert.equal(await app.evaluate(()=>globalThis.authorizationUrls.length),1);
  await page.getByLabel('快速添加任务').fill('拖出前的草稿');await page.getByLabel('快速添加任务').press('Enter');const draftRow=page.locator('.todo-row').filter({hasText:'拖出前的草稿'});await draftRow.click({button:'right'});await page.getByRole('menuitem',{name:'编辑详情'}).click();await page.getByRole('dialog',{name:'任务详情'}).getByLabel('备注',{exact:true}).fill('拖出前自动保存的内容');
  const next=app.waitForEvent('window');await page.getByRole('button',{name:'在独立窗口打开'}).click();const child=await next;await child.waitForLoadState();await expect(child.locator('.task-workspace')).toBeVisible();await expect(child.locator('.todo-row').filter({hasText:'拖出前的草稿'})).toContainText('拖出前自动保存的内容');await expect(child.locator('.chat-scroll')).not.toBeVisible();
  await child.getByLabel('快速添加任务').fill('独立窗口共享任务');await child.getByLabel('快速添加任务').press('Enter');await expect(child.locator('.todo-row').filter({hasText:'独立窗口共享任务'})).toBeVisible();
  await page.goto('http://127.0.0.1:8146/#todos');await expect(page.locator('.todo-row').filter({hasText:'独立窗口共享任务'})).toBeVisible();
  await page.getByRole('button',{name:'移到左侧'}).click();await expect(page.locator('.work-layout')).toHaveClass(/feature-left/);
  await page.goto('http://127.0.0.1:8146/#calendar');const bar=page.getByLabel('拖动功能区域',{exact:true}),rect=await bar.boundingBox();const width=await page.evaluate(()=>innerWidth);
  const detached=app.waitForEvent('window');await page.mouse.move(rect.x+60,rect.y+rect.height/2);await page.mouse.down();await page.mouse.move(width/2,16,{steps:12});await page.mouse.up();const calendar=await detached;await expect(calendar.locator('.calendar-board')).toBeVisible();
  assert.equal(app.windows().length,3);
  await child.screenshot({path:'test-results/native-task-window.png',timeout:5000}).catch(()=>{});
  console.log('PASS: native detached task/calendar windows, drag to native titlebar, left docking, shared account/task data and invalid-route rejection.');
}finally{if(app)await app.close();}
