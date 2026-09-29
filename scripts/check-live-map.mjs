// Uses only the configured AMap credentials in an isolated local test account.
// No real planner data is copied; diagnostic output never includes credentials.
import { _electron as electron, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const profile = resolve(`.data/live-map-check-${Date.now()}`);
const fromSource=process.argv.includes('--source');
const executable=process.argv.slice(2).find(arg=>!arg.startsWith('--')) || 'release-v020/win-unpacked/Sakuya Agent.exe';
mkdirSync(profile, {recursive: true});
const env = {...process.env, SAKUYA_TEST:'1', SAKUYA_PORT:'8184', SAKUYA_DATA_DIR:`${profile}/workspace`, SAKUYA_DESKTOP_DATA:profile, SAKUYA_ENV_FILE:`${profile}/absent.env`, PYTHONPATH:resolve('backend'), PYTHONUTF8:'1', NO_PROXY:'127.0.0.1,localhost', NODE_USE_ENV_PROXY:'0'};
for (const k of ['ELECTRON_RUN_AS_NODE','SAKUYA_DEV_URL','HTTP_PROXY','HTTPS_PROXY','ALL_PROXY']) delete env[k];
const session = execFileSync(resolve('.venv/Scripts/python.exe'), ['-c', `
from pathlib import Path
import sqlite3,json
from app import db,auth
from fastapi import Response
db.init();auth.init()
found=[]
for p in [Path('.data/workspace.sqlite'),*Path('.data/users').glob('*/workspace.sqlite')]:
 if not p.exists():continue
 with sqlite3.connect(p.resolve().as_uri()+'?mode=ro',uri=True) as c:
  for row in c.execute("select body from objects where kind='map_secret'"):
   d=json.loads(row[0])
   if d.get('js_key') and d.get('security_code'):found.append(d)
assert len(found)==1,'Need exactly one configured real map account'
db.put('map_secret',{k:v for k,v in found[0].items() if k in ('id','js_key','security_code','web_key','city')})
with db.connect() as c:c.execute('INSERT INTO users VALUES (?,?,?,?,?)',('map-live-test','map-live@example.com',auth.password_hash('TestOnlyPassword'),'admin',db.now()))
print(auth.issue_session('map-live-test',Response()))
`], {env, windowsHide:true, encoding:'utf8'}).trim();
const safe = text => text.replace(/[a-f0-9]{32}/gi,'[REDACTED]').replace(/([?&](?:key|jscode|token|securityJsCode|locations?|defaultLocation|lng|lat)=)[^&\s"']+/gi,'$1[REDACTED]');
const urlPath = url => {try {const u=new URL(url);return u.origin+u.pathname;}catch{return safe(url)}};
let app;
const report={errors:[], failures:[], responses:[], policy:[], dialogs:[]};
try {
  app=await electron.launch({executablePath:resolve(fromSource?'node_modules/electron/dist/electron.exe':executable),env,args:[...(fromSource?['.']:[]),'--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows'],timeout:60000});
  const page=await app.firstWindow();
  if (!process.argv.includes('--device-location')) await app.evaluate(({ipcMain}) => {
    ipcMain.removeHandler('sakuya:device-location');
    ipcMain.handle('sakuya:device-location', () => ({ok:false,reason:'denied'}));
  });
  page.on('dialog', async dialog => {report.dialogs.push(safe(dialog.message())); await dialog.dismiss();});
  if (process.argv.includes('--legacy')) await page.route('https://webapi.amap.com/maps?**', route => route.continue({url:route.request().url().replace('v=2.0&','v=1.4.15&')}));
  page.on('pageerror',e=>report.errors.push(safe(e.message).slice(0,800)));
  page.on('console',m=>{if(m.type()==='error')report.errors.push(safe(m.text()).slice(0,800))});
  page.on('requestfailed',r=>report.failures.push({url:urlPath(r.url()),error:r.failure()?.errorText}));
  page.on('response',r=>{if(/amap|autonavi/i.test(r.url())||r.status()>=400)report.responses.push({url:urlPath(r.url()),status:r.status(),type:r.headers()['content-type']})});
  await page.waitForURL('http://127.0.0.1:8184/**',{timeout:60000});
  await page.context().addCookies([{name:'sakuya_session',value:session,url:'http://127.0.0.1:8184',httpOnly:true,sameSite:'Lax'}]);
  await page.addInitScript(()=>{window.__policy=[];document.addEventListener('securitypolicyviolation',e=>window.__policy.push({directive:e.effectiveDirective,uri:e.blockedURI.split('?')[0]}));localStorage.setItem('sakuya-language','zh-CN')});
  await page.reload(); await page.emulateMedia({reducedMotion:'reduce'});
  const request=page.context().request, origin='http://127.0.0.1:8184', headers={'X-Sakuya-Client':'workspace'};
  const listing=(await (await request.get(origin+'/api/planner')).json()).lists[0];
  assert.equal((await request.put(origin+'/api/planner/lists/'+listing.id,{headers,data:{name:listing.name,map_enabled:true}})).status(),200);
  const dates=await page.evaluate(()=>{const d=new Date();const day=v=>`${v.getFullYear()}-${String(v.getMonth()+1).padStart(2,'0')}-${String(v.getDate()).padStart(2,'0')}`;return {start:day(d),end:day(new Date(d.getFullYear(),d.getMonth(),d.getDate()+1))}});
  const created=await request.post(origin+'/api/planner/entries',{headers,data:{title:'真实底图隔离验证',list_id:listing.id,kind:'event',all_day:true,...dates,location:'测试建筑'}});
  assert.equal(created.status(),201);const entry=await created.json();
  assert.equal((await request.put(`${origin}/api/maps/entries/${entry.id}/place`,{headers,data:{revision:entry.revision,place:{name:'测试建筑',address:'仅用于隔离验证',lng:113.3512,lat:23.1321,source:'manual'}}})).status(),200);
  await page.getByRole('button',{name:'今日地图',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.map-canvas-message[role="alert"]')||!!document.querySelector('.amap-layer')&&!document.querySelector('.map-canvas-message[role="status"]'),{},{timeout:40000}).catch(()=>{});
  report.state=await page.evaluate(()=>({message:document.querySelector('.map-canvas-message')?.textContent||'',sdk:!!window.AMap,layers:document.querySelectorAll('.amap-layer').length,canvas:document.querySelectorAll('.map-canvas canvas').length,policy:window.__policy}));
  report.serviceHost=await page.evaluate(()=>window._AMapSecurityConfig?.serviceHost);
  assert.equal(report.serviceHost, origin+'/_AMapService');
  assert.deepEqual(report.dialogs, [], 'Map loading must not raise any JavaScript dialog');
  report.verified = report.state.sdk && report.state.canvas > 0 && !report.state.message;
  if (report.verified) {
    if (process.argv.includes('--device-location')) {
      await expect(page.locator('.map-device-marker')).toHaveCount(1,{timeout:28000});
      await expect(page.locator('.map-location-status')).toContainText('定位精度');
      report.deviceLocation={nativeWindows:true,convertedToAMap:true,markerVisible:true};
    }
    await expect(page.locator('.map-building-marker')).toHaveCount(1);
    const capture=async name=>{
      // Hidden windows only produce a new compositor frame when captured.
      // Flush pending style/zoom paints before saving the final frame.
      for(let i=0;i<45;i++) {
        await app.evaluate(async ({BrowserWindow})=>{await BrowserWindow.getAllWindows()[0].capturePage(undefined,{stayHidden:true,stayAwake:true})});
        await page.waitForTimeout(80);
      }
      const data=await app.evaluate(async ({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG().toString('base64'));
      writeFileSync(`${profile}/${name}.png`,Buffer.from(data,'base64'));
    };
    if (report.deviceLocation) {
      await capture('map-device-initial');
      const dot=await page.locator('.map-device-marker').boundingBox(), canvas=await page.locator('.map-canvas').boundingBox();
      report.deviceLocation.centerOffset=dot&&canvas?[Math.round(dot.x+dot.width/2-canvas.x-canvas.width/2),Math.round(dot.y+dot.height/2-canvas.y-canvas.height/2)]:null;
      assert(dot&&canvas&&Math.abs(dot.x+dot.width/2-canvas.x-canvas.width/2)<35&&Math.abs(dot.y+dot.height/2-canvas.y-canvas.height/2)<35,'Initial viewport must center on the device location');
      report.deviceLocation.initialCentered=true;
    }
    await page.locator('.map-entry').click();
    await capture('map-dark');
    await page.locator('.map-building-marker').click({force:true});
    await expect(page.locator('.map-entry-detail')).toContainText('真实底图隔离验证');
    await page.evaluate(()=>{document.documentElement.dataset.theme='light'});
    await page.waitForTimeout(1500);
    await capture('map-light');
    await page.evaluate(()=>{document.documentElement.dataset.theme='dark'});
    await page.waitForTimeout(1500);
    await capture('map-dark');
    await page.getByRole('button',{name:'显示全部地点',exact:true}).click();
    await page.locator('.map-canvas').hover(); await page.mouse.wheel(0,-250);
    await page.waitForTimeout(1200);
    await expect(page.locator('.map-canvas-message')).toHaveCount(0);
    report.interactions={marker:true,lightTheme:true,darkTheme:true,fitAndZoom:true};
  }
  assert.deepEqual(report.dialogs, [], 'Map interaction must not raise any JavaScript dialog');
  writeFileSync(`${profile}/result.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify({...report,profile}));
  assert(report.verified, 'Live AMap did not finish rendering; see the credential-redacted diagnostic report');
} catch (error) {
  report.verified=false;
  report.failure=safe(error.message).slice(0,1000);
  if (app) report.locationStatus=await (await app.firstWindow()).locator('.map-location-status').textContent().catch(()=>null);
  writeFileSync(`${profile}/result.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify({...report,profile}));
  process.exitCode=1;
} finally {
  if(app)await app.close();
  execFileSync(resolve('.venv/Scripts/python.exe'),['-c',"from app import db;\nwith db.connect() as c:c.execute(\"DELETE FROM objects WHERE kind='map_secret'\")"],{env,windowsHide:true});
}
