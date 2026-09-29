// Packaged Electron + packaged API smoke check. AMap itself remains a test double.
import { _electron as electron, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { mockMapSDK } from '../tests/map-sdk-fixture.ts';

const edition = process.argv[2];
assert(['dev', 'client'].includes(edition));
const client = edition === 'client', port = client ? 8181 : 8182;
const release = resolve(process.argv[3] || `release-${edition}`);
const executable = resolve(release, `win-unpacked/Sakuya ${client ? 'Client' : 'Agent'}.exe`);
const profile = resolve(`.data/map-packaged-${edition}-${Date.now()}`);
mkdirSync(profile, {recursive: true});
const env = {...process.env, SAKUYA_TEST: '1', NO_PROXY: '127.0.0.1,localhost', NODE_USE_ENV_PROXY: '0'};
for (const name of ['ELECTRON_RUN_AS_NODE', 'SAKUYA_DEV_URL', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY']) delete env[name];
const prefix = client ? 'SAKUYA_CLIENT_' : 'SAKUYA_';
Object.assign(env, {[prefix + 'PORT']: String(port), [prefix + 'DESKTOP_DATA']: profile,
  [prefix + 'DATA_DIR']: `${profile}/workspace`, [prefix + 'ENV_FILE']: `${profile}/absent.env`});
let app;
try {
  app = await electron.launch({executablePath: executable, env, args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'], timeout: 60000});
  const page = await app.firstWindow();
  const origin = `http://127.0.0.1:${port}`;
  await page.waitForURL(origin + '/**', {timeout: 60000});
  if (!client) {
    const session = execFileSync(resolve('.venv/Scripts/python.exe'), ['-c', `
from app import db, auth
from fastapi import Response
db.init(); auth.init()
identifier = db.uid('map_package')
with db.connect() as con:
    con.execute('INSERT INTO users VALUES (?,?,?,?,?)', (identifier, identifier+'@example.com', auth.password_hash('TestOnlyPassword'), 'user', db.now()))
print(auth.issue_session(identifier, Response()))
`], {env: {...env, PYTHONPATH: resolve('backend'), PYTHONUTF8: '1'}, windowsHide: true, encoding: 'utf8'}).trim();
    await page.context().addCookies([{name: 'sakuya_session', value: session, url: origin, httpOnly: true, sameSite: 'Lax'}]);
  }
  await page.evaluate(() => localStorage.setItem('sakuya-language', 'zh-CN'));
  await page.reload(); await page.emulateMedia({reducedMotion: 'reduce'});
  const request = page.context().request, headers = {'X-Sakuya-Client': 'workspace'};
  assert.equal((await (await request.get(origin + '/api/health')).json()).edition, edition);
  const button = page.getByRole('button', {name: '今日地图', exact: true});
  await expect(button).toBeVisible();
  assert(await button.evaluate(el => el.previousElementSibling.classList.contains('language-menu')));
  await button.click(); const dialog = page.getByRole('dialog', {name: '今日地图'});
  await expect(dialog.getByRole('button', {name: '配置高德地图'})).toBeVisible();
  await page.keyboard.press('Escape'); await expect(button).toBeFocused();
  const listing = (await (await request.get(origin + '/api/planner')).json()).lists[0];
  assert.equal((await request.put(origin + '/api/planner/lists/' + listing.id, {headers, data:{name:listing.name,color:listing.color,map_enabled:true}})).status(),200);
  const dates = await page.evaluate(() => {
    const format = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const now = new Date(), next = new Date(now.getFullYear(), now.getMonth(), now.getDate()+1);
    return {start: format(now), end: format(next)};
  });
  const created = await request.post(origin + '/api/planner/entries', {headers, data: {title: '打包地图验证', list_id: listing.id, kind: 'event', all_day: true, ...dates, location: '测试楼'}});
  assert.equal(created.status(), 201); const entry = await created.json();
  const result = await request.put(`${origin}/api/maps/entries/${entry.id}/place`, {headers, data: {revision: 1, place: {name: '测试楼', address: '测试校园', lng: 113.35, lat: 23.13, source: 'manual'}}});
  assert.equal(result.status(), 200);
  assert.equal((await request.put(origin + '/api/maps/config', {headers, data: {js_key: 'map-test-js', security_code: 'map-test-code'}})).status(), 200);
  await mockMapSDK(page); await page.reload(); await button.click();
  await expect(dialog.locator('.map-entry')).toContainText('打包地图验证');
  await expect(dialog.locator('.map-building-marker')).toContainText('测试楼');
  await dialog.locator('.map-building-marker').click();
  await expect(dialog.locator('.map-entry-detail')).toContainText('打包地图验证');
  await page.keyboard.press('Escape'); await page.reload(); await button.click();
  await expect(dialog.locator('.map-building-marker')).toContainText('测试楼');
  for (const family of ['sakuya','a','notion']) for (const theme of ['light','dark']) {
    await page.evaluate(({family,theme}) => {document.documentElement.dataset.themeFamily=family; document.documentElement.dataset.theme=theme;}, {family,theme});
    await expect.poll(() => page.evaluate(() => window.__mapStyle)).toBe(`amap://styles/${theme==='light'?'normal':'dark'}`);
    const colors = await page.evaluate(() => [getComputedStyle(document.querySelector('.today-map-panel')).backgroundColor, getComputedStyle(document.documentElement).backgroundColor]);
    assert.equal(colors[0], colors[1]);
  }
  const divider = dialog.getByRole('separator', {name:'调整安排与地图宽度'});
  const before = Number(await divider.getAttribute('aria-valuenow'));
  await divider.focus(); await page.keyboard.press('ArrowRight');
  assert(Number(await divider.getAttribute('aria-valuenow'))>before);
  const after = await divider.getAttribute('aria-valuenow');
  const panel = page.locator('.today-map-panel'), header = dialog.locator('.map-heading');
  const initial = await panel.boundingBox(), heading = await header.boundingBox();
  await page.mouse.move(heading.x+200,heading.y+25); await page.mouse.down();
  await page.mouse.move(heading.x+200,heading.y+5,{steps:4}); await page.mouse.up();
  assert((await panel.boundingBox()).y < initial.y);
  await page.keyboard.press('Escape'); await button.click();
  assert.equal(await divider.getAttribute('aria-valuenow'),after);
  await request.put(origin + '/api/planner/lists/' + listing.id, {headers, data:{name:listing.name,color:listing.color,map_enabled:false}});
  await page.reload(); await button.click();
  await expect(dialog.locator('.map-entry')).toHaveCount(0);
  await expect(dialog.locator('.map-building-marker')).toHaveCount(0);
  // Exercise automatic extraction in the real packaged backend without a key
  // or external calls. Browser tests cover successful lookup with a provider double.
  await request.put(origin + '/api/planner/lists/' + listing.id, {headers, data:{name:listing.name,color:listing.color,map_enabled:true}});
  const autoEntry = await (await request.post(origin + '/api/planner/entries', {headers, data:{title:'去暨南大学图书馆自习',list_id:listing.id,kind:'task',all_day:true,...dates}})).json();
  await page.reload(); await button.click();
  await expect.poll(async () => {
    const snapshot = await (await request.get(origin + '/api/planner')).json();
    const item = snapshot.entries.find(e => e.id === autoEntry.id);
    return {query:item?.map_resolution?.query, status:item?.map_resolution?.status};
  }).toEqual({query:'暨南大学图书馆',status:'unconfigured'});
  await expect(dialog.getByRole('button', {name:'选择建筑',exact:true})).toHaveCount(0);
  await dialog.locator('.map-entry').filter({hasText:'去暨南大学图书馆自习'}).click();
  await expect(dialog.locator('.map-entry-detail')).toContainText('自动定位需要配置高德 Web 服务 Key');
  const report = {verified: true, edition, executable, packagedUI: true, packagedAPI: true, locationPersisted: true, listMapMode: true, sixThemes: true, headerDrag: true, splitPersistence: true, automaticExtraction: true, missingSearchKeyState: true, liveAMap: false};
  writeFileSync(resolve(release, 'map-desktop-validation.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} finally { if (app) await app.close(); }
