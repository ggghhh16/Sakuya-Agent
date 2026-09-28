import {_electron as electron, expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';

const executable = process.argv[2];
if (!executable) throw new Error('Pass the packaged desktop executable.');
const profile = resolve(`.data/desktop-references-${Date.now()}`);
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
  const data=await(await request.get(root+'/api/planner')).json();
  const ids=[];
  for(const title of ['桌面任务一','桌面任务二'])ids.push((await(await request.post(root+'/api/planner/entries',{headers,data:{title,list_id:data.lists[0].id,notes:'完整引用信息'}})).json()).id);
  await page.goto(root+'/#todos');
  const first=page.locator(`[data-task-id="${ids[0]}"]`),second=page.locator(`[data-task-id="${ids[1]}"]`);
  const list=await(await request.post(root+'/api/planner/lists',{headers,data:{name:'拖动目标清单'}})).json();await page.reload();
  const dragSource=await first.locator('.task-rename-zone').boundingBox(),dragTarget=await second.boundingBox();
  await page.mouse.move(dragSource.x+10,dragSource.y+10);await page.mouse.down();await page.waitForTimeout(650);
  await expect(page.locator('.task-selection-rectangle')).toHaveCount(0);
  await page.mouse.move(dragTarget.x+80,dragTarget.y+2,{steps:12});await page.mouse.up();
  await expect(page.locator('.todo-row').first()).toHaveAttribute('data-task-id',ids[0]);
  await expect(page.getByLabel('任务名称',{exact:true})).toHaveCount(0);
  const moveSource=await second.boundingBox(),moveTarget=await page.locator(`[data-list-id="${list.id}"]`).boundingBox();
  await page.mouse.move(moveSource.x+3,moveSource.y+3);await page.mouse.down();await page.mouse.move(moveTarget.x+moveTarget.width/2,moveTarget.y+moveTarget.height/2,{steps:12});await page.mouse.up();
  await expect(second.locator('.task-list-caption')).toHaveText(list.name);
  const a=await first.boundingBox(),b=await second.boundingBox();
  await page.mouse.move(a.x-5,a.y+3);await page.mouse.down();await page.mouse.move(b.x+b.width-3,b.y+b.height-3,{steps:10});await page.mouse.up();
  await expect(page.locator('.todo-row.multi-selected')).toHaveCount(2);
  await first.click({button:'right'});await page.getByRole('menuitem',{name:'高优先级',exact:true}).click();
  await expect(first.locator('.task-check')).toHaveClass(/priority-high/);await expect(second.locator('.task-check')).toHaveClass(/priority-high/);
  const source=await first.locator('.task-rename-zone').boundingBox(),destination=await page.locator('.chat-composer').boundingBox();
  await page.mouse.move(source.x+source.width/2,source.y+source.height/2);await page.mouse.down();await page.waitForTimeout(600);await expect(page.locator('.task-selection-rectangle')).toHaveCount(0);
  await page.mouse.move(source.x+source.width/2+12,source.y+source.height/2);
  await page.mouse.move(destination.x+destination.width/2,destination.y+destination.height/2,{steps:12});await page.mouse.up();
  await expect(page.locator('.chat-composer .chat-reference')).toHaveCount(2);
  await page.getByLabel('聊天消息').fill('查看这两个任务');await page.getByRole('button',{name:'发送消息',exact:true}).click();
  await expect(page.locator('.user-message .chat-reference')).toHaveCount(2);
  const turn=(await(await request.get(root+'/api/workspace')).json()).chats[0];assert.equal(turn.references.length,2);assert.ok(turn.model_prompt.includes('完整引用信息'));
  await page.locator('.user-message .chat-reference').first().click();await expect(page.getByRole('dialog',{name:'任务详情'})).toBeVisible();await page.keyboard.press('Escape');
  const start=new Date();start.setHours(10,0,0,0);
  const entry=await(await request.post(root+'/api/planner/entries',{headers,data:{list_id:data.lists[0].id,title:'桌面日程',kind:'event',start:start.toISOString(),end:new Date(+start+3600000).toISOString()}})).json();
  await page.goto(root+'/#calendar');await page.getByLabel('日历视图').selectOption('day');await page.locator(`[data-entry-id="${entry.id}"]`).click();
  const dialog=page.getByRole('dialog',{name:'日程详情'});await expect(dialog).toBeVisible();assert.ok((await dialog.boundingBox()).width<320);await expect(dialog.getByLabel('优先级')).toHaveCount(0);await expect(dialog.getByLabel('标签',{exact:true})).toHaveCount(0);
  await dialog.getByLabel('备注',{exact:true}).fill('桌面外部点击自动保存');await page.screenshot({path:`${profile}/compact-editor.png`});await page.locator('.planner-toolbar h1').click();await expect(dialog).toBeHidden();
  const saved=(await(await request.get(root+'/api/planner')).json()).entries.find(item=>item.id===entry.id);assert.equal(saved.notes,'桌面外部点击自动保存');
  console.log('PASS: packaged desktop blank-area marquee, held title drag/reorder, row-padding drag to list, batch actions, multiple chat references, jump, compact calendar editor and outside autosave.');
  console.log(`Screenshot: ${profile}/compact-editor.png`);
} finally {
  if (app) await app.close();
}
