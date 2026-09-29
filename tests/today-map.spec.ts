import {test, expect, session} from './fixtures';
import {mockMapSDK} from './map-sdk-fixture';
import type {APIRequestContext} from '@playwright/test';

test.use({timezoneId: 'Asia/Shanghai', storageState: async ({}, use) => {
  await use({cookies: [{name: 'sakuya_session', value: session('user'), domain: '127.0.0.1', path: '/', expires: -1, httpOnly: true, secure: false, sameSite: 'Lax'}], origins: []});
}});
const headers = {'X-Sakuya-Client': 'workspace'};
const place = {name: '教学楼 A 栋', address: '广州测试校园', lng: 113.35, lat: 23.13, source: 'manual'};
async function add(request: APIRequestContext, title: string, extra: Record<string, unknown> = {}, withPlace = false) {
  const data = await (await request.get('/api/planner')).json();
  const list = data.lists[0];
  if (!list.map_enabled) await request.put(`/api/planner/lists/${list.id}`, {headers, data: {name:list.name, color:list.color, map_enabled:true}});
  const r = await request.post('/api/planner/entries', {headers, data: {title, list_id: data.lists[0].id, kind: 'event', location: '教学楼 A 栋', start: '2026-09-28T09:00:00+08:00', end: '2026-09-28T10:00:00+08:00', ...extra}});
  expect(r.ok()).toBeTruthy(); const entry = await r.json();
  if (withPlace) expect((await request.put(`/api/maps/entries/${entry.id}/place`, {headers, data: {revision: 1, place}})).ok()).toBeTruthy();
  return entry;
}
test.beforeEach(async ({page}) => {await page.clock.install({time: new Date('2026-09-28T12:00:00+08:00')});});

test('设备定位经高德坐标转换后优先展示附近，轮询不抢回任务范围', async ({page,context,request}) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({longitude:116.4,latitude:39.9,accuracy:50});
  await request.put('/api/maps/config',{headers,data:{js_key:'map-test-js',security_code:'map-test-code'}});
  await add(request,'异地任务',{},true); await mockMapSDK(page); await page.goto('/');
  await page.getByRole('button',{name:'今日地图',exact:true}).click();
  await expect(page.locator('.map-device-marker')).toHaveCount(1);
  expect(await page.evaluate(() => window._AMapSecurityConfig?.serviceHost)).toBe('http://127.0.0.1:5179/_AMapService');
  const state=()=>page.evaluate(()=>{const w=window as unknown as {__mapCenter:number[];__mapZoom:number;__mapFitCalls?:number;__conversionInput:unknown};return {center:w.__mapCenter,zoom:w.__mapZoom,fit:w.__mapFitCalls||0,conversion:w.__conversionInput};});
  await expect.poll(state).toEqual({center:[116.406,39.903],zoom:17,fit:0,conversion:{point:[116.4,39.9],type:'gps'}});
  await expect(page.locator('.map-location-status')).toContainText('50');
  await page.clock.runFor(5500); expect((await state()).fit).toBe(0);
  await page.getByRole('button',{name:'显示全部地点',exact:true}).click(); expect((await state()).fit).toBe(1);
  await context.setGeolocation({longitude:117,latitude:40,accuracy:2000});
  await page.getByRole('button',{name:'我的位置',exact:true}).click();
  await expect.poll(async()=> (await state()).center).toEqual([117.006,40.003]);
  expect((await state()).zoom).toBe(13);
});

test('定位被拒绝时回到任务地点，可重试；关闭后忽略迟到的位置', async ({page,request}) => {
  await page.addInitScript(()=>Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition:(_ok:unknown,fail:(error:{code:number})=>void)=>fail({code:1})}}));
  await request.put('/api/maps/config',{headers,data:{js_key:'map-test-js',security_code:'map-test-code'}});
  await add(request,'定位失败仍可查看',{},true); await mockMapSDK(page); await page.goto('/');
  await page.getByRole('button',{name:'今日地图',exact:true}).click();
  await expect(page.locator('.map-location-status')).toContainText('未获定位权限');
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {__mapFitCalls:number}).__mapFitCalls)).toBe(1);
  await page.evaluate(()=>Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition:(ok:unknown)=>{(window as unknown as {__locationCallback:unknown}).__locationCallback=ok}}}));
  await page.getByRole('button',{name:'我的位置',exact:true}).click();
  await page.keyboard.press('Escape');
  await page.evaluate(()=>(window as unknown as {__locationCallback:(p:unknown)=>void}).__locationCallback({coords:{longitude:116.4,latitude:39.9,accuracy:50}}));
  await expect(page.locator('.map-device-marker')).toHaveCount(0);
});

test('定位迟到不会覆盖用户选择的建筑或手动拖动的视图', async ({page,request}) => {
  await page.addInitScript(()=>Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition:(ok:unknown)=>{(window as unknown as {__locationCallback:unknown}).__locationCallback=ok}}}));
  await request.put('/api/maps/config',{headers,data:{js_key:'map-test-js',security_code:'map-test-code'}});
  await add(request,'先选择建筑',{},true); await mockMapSDK(page); await page.goto('/');
  await page.getByRole('button',{name:'今日地图',exact:true}).click();
  await page.locator('.map-entry').click();
  await page.evaluate(()=>(window as unknown as {__locationCallback:(p:unknown)=>void}).__locationCallback({coords:{longitude:116.4,latitude:39.9,accuracy:50}}));
  await expect(page.locator('.map-device-marker')).toHaveCount(1);
  expect(await page.evaluate(()=>(window as unknown as {__mapCenter:number[]}).__mapCenter)).toEqual([place.lng,place.lat]);
  await page.getByRole('button',{name:'我的位置',exact:true}).click();
  await page.locator('.map-canvas').dispatchEvent('pointerdown',{button:0});
  await page.evaluate(()=>(window as unknown as {__locationCallback:(p:unknown)=>void}).__locationCallback({coords:{longitude:117,latitude:40,accuracy:50}}));
  await expect(page.getByRole('button',{name:'我的位置',exact:true})).toBeEnabled();
  expect(await page.evaluate(()=>(window as unknown as {__mapCenter:number[]}).__mapCenter)).toEqual([place.lng,place.lat]);
});

test('定位超时或坐标转换失败时保持地图可用，不把原始 GPS 坐标当高德坐标', async ({page,request}) => {
  await page.addInitScript(()=>Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition:()=>{}}}));
  await request.put('/api/maps/config',{headers,data:{js_key:'map-test-js',security_code:'map-test-code'}});
  await add(request,'超时仍可查看',{},true); await mockMapSDK(page); await page.goto('/');
  await page.getByRole('button',{name:'今日地图',exact:true}).click();
  await expect(page.locator('.map-building-marker')).toHaveCount(1);
  await page.clock.runFor(14001);
  await expect(page.locator('.map-location-status')).toContainText('设备定位超时');
  await expect(page.locator('.map-canvas-message')).toHaveCount(0);
  await page.evaluate(()=>{
    Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition:(ok:(p:unknown)=>void)=>ok({coords:{longitude:116.4,latitude:39.9,accuracy:50}})}});
    window.AMap!.convertFrom=(_point,_type,callback)=>callback('error',{});
  });
  await page.getByRole('button',{name:'我的位置',exact:true}).click();
  await expect(page.locator('.map-location-status')).toContainText('定位坐标转换失败');
  await expect(page.locator('.map-device-marker')).toHaveCount(0);
  expect(await page.evaluate(()=>(window as unknown as {__mapCenter?:number[]}).__mapCenter)).toBeUndefined();
});

test('清单地图模式控制安排和标记，清单编辑可启用和关闭', async ({page, request}) => {
  const enabled = await add(request, '显示的安排', {}, true);
  const list = await (await request.post('/api/planner/lists', {headers, data: {name:'普通清单'}})).json();
  await add(request, '隐藏的安排', {list_id:list.id}, true);
  await request.put('/api/maps/config', {headers, data:{js_key:'map-test-js',security_code:'map-test-code'}});
  await mockMapSDK(page); await page.goto('/');
  const open = () => page.getByRole('button',{name:'今日地图',exact:true}).click();
  await open(); await expect(page.locator('.map-entry')).toHaveCount(1);
  await expect(page.locator('.map-entry')).toContainText('显示的安排');
  await expect(page.locator('.map-building-marker')).toHaveAttribute('aria-label','教学楼 A 栋 · 1 项安排');
  await page.keyboard.press('Escape'); await page.goto('/#todos');
  await page.getByRole('button',{name:list.name,exact:true}).click({button:'right'});
  const editor = page.getByRole('dialog',{name:'编辑清单'});
  await editor.getByRole('checkbox',{name:'地图模式'}).check();
  await editor.getByRole('button',{name:'保存清单'}).click();
  await open(); await expect(page.locator('.map-entry')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:list.name,exact:true}).click({button:'right'});
  await editor.getByRole('checkbox',{name:'地图模式'}).uncheck();
  await editor.getByRole('button',{name:'保存清单'}).click();
  await open(); await expect(page.locator('.map-entry')).toHaveCount(1);
  const lists = (await (await request.get('/api/planner')).json()).lists;
  expect(lists.find((l: {id:string})=>l.id===enabled.list_id).map_enabled).toBe(true);
});

test('六种主题实时一致，顶栏移动和左右比例在重开后保留', async ({page, request}) => {
  await request.put('/api/maps/config', {headers, data:{js_key:'map-test-js',security_code:'map-test-code'}});
  await mockMapSDK(page); await page.emulateMedia({reducedMotion:'reduce'}); await page.goto('/');
  const open = () => page.getByRole('button',{name:'今日地图',exact:true}).click();
  await open(); await expect(page.locator('.map-canvas-message')).toHaveCount(0);
  for (const family of ['sakuya','a','notion']) for (const theme of ['light','dark']) {
    await page.evaluate(({family,theme})=>{document.documentElement.dataset.themeFamily=family;document.documentElement.dataset.theme=theme;},{family,theme});
    await expect.poll(()=>page.evaluate(()=>({
      panel:getComputedStyle(document.querySelector('.today-map-panel')!).backgroundColor,
      app:getComputedStyle(document.documentElement).backgroundColor,
      style:(window as unknown as {__mapStyle:string}).__mapStyle
    }))).toMatchObject({style:`amap://styles/${theme==='light'?'normal':'dark'}`});
    const colors = await page.evaluate(()=>[getComputedStyle(document.querySelector('.today-map-panel')!).backgroundColor,getComputedStyle(document.documentElement).backgroundColor]);
    expect(colors[0]).toBe(colors[1]);
  }
  const panel = page.locator('.today-map-panel'), header = page.locator('.map-heading');
  const before = (await panel.boundingBox())!, h = (await header.boundingBox())!;
  await page.mouse.move(h.x+250,h.y+25); await page.mouse.down(); await page.mouse.move(h.x+360,h.y+95,{steps:5}); await page.mouse.up();
  const moved = (await panel.boundingBox())!;
  expect(moved.x).toBeGreaterThan(before.x+50); expect(moved.y).toBeGreaterThan(before.y+30);
  const divider = page.getByRole('separator',{name:'调整安排与地图宽度'}), r=(await divider.boundingBox())!;
  const initialWidth=(await page.locator('.map-agenda').boundingBox())!.width;
  await page.mouse.move(r.x+3,r.y+150); await page.mouse.down(); await page.mouse.move(r.x+123,r.y+150,{steps:5}); await page.mouse.up();
  expect((await page.locator('.map-agenda').boundingBox())!.width).toBeGreaterThan(initialWidth+80);
  const share=await divider.getAttribute('aria-valuenow');
  await page.keyboard.press('Escape'); await open();
  expect((await panel.boundingBox())!.x).toBeCloseTo(moved.x,0);
  expect(await divider.getAttribute('aria-valuenow')).toBe(share);
  await divider.focus(); await page.keyboard.press('ArrowLeft');
  expect(Number(await divider.getAttribute('aria-valuenow'))).toBeLessThan(Number(share));
  await page.setViewportSize({width:620,height:850});
  const resized=(await panel.boundingBox())!; expect(resized.x+resized.width).toBeLessThanOrEqual(620);
  await page.screenshot({path:'test-results/map-theme-split.png'});
});

test('入口紧邻语言按钮，缺少 Key 时显示配置，Esc 恢复焦点', async ({page}) => {
  await page.goto('/');
  const trigger = page.getByRole('button', {name: '今日地图', exact: true});
  await expect(trigger).toBeVisible();
  expect(await trigger.evaluate(el => el.previousElementSibling?.classList.contains('language-menu'))).toBeTruthy();
  await trigger.click(); const dialog = page.getByRole('dialog', {name: '今日地图'});
  await expect(dialog.getByText('今天没有安排')).toBeVisible();
  await expect(dialog.getByRole('button', {name: '配置高德地图'})).toBeVisible();
  await expect(dialog).toBeInViewport();
  expect(await page.locator('.today-map-panel').evaluate(el => getComputedStyle(el).animationName)).toBe('map-unfold');
  await page.screenshot({path: 'test-results/today-map-unconfigured.png'});
  await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible(); await expect(trigger).toBeFocused();
  await trigger.click(); await page.mouse.click(1400, 950); await expect(dialog).not.toBeVisible();
});

test('只显示今天的安排，跨天和全天边界正确，同楼合并且标记可选择', async ({page, request}) => {
  await request.put('/api/maps/config', {headers, data: {js_key: 'map-test-js', security_code: 'map-test-code'}});
  await add(request, '上午上课', {}, true);
  await add(request, '下午开会', {start: '2026-09-28T14:00:00+08:00', end: '2026-09-28T15:00:00+08:00'}, true);
  await add(request, '跨午夜', {start: '2026-09-27T23:00:00+08:00', end: '2026-09-28T01:00:00+08:00'});
  await add(request, '全天活动', {all_day: true, start: '2026-09-28', end: '2026-09-29'});
  await add(request, '已完成任务', {kind: 'task', completed: true});
  await add(request, '明天', {all_day: true, start: '2026-09-29', end: '2026-09-30'});
  await add(request, '昨天结束', {all_day: true, start: '2026-09-27', end: '2026-09-28'});
  await add(request, '已取消', {cancelled: true});
  await add(request, '无时间', {kind: 'task', start: null, end: null});
  await add(request, '笔记', {kind: 'task', is_note: true});
  await mockMapSDK(page); await page.goto('/'); await page.getByRole('button', {name: '今日地图', exact: true}).click();
  const dialog = page.getByRole('dialog', {name: '今日地图'});
  await expect(dialog.locator('.map-entry')).toHaveCount(5);
  await expect(dialog.locator('.map-building-marker')).toHaveCount(1);
  await expect(dialog.locator('.map-building-marker')).toHaveAttribute('aria-label', '教学楼 A 栋 · 2 项安排');
  await dialog.locator('.map-building-marker').click();
  await expect(dialog.locator('.map-entry-detail')).toContainText('上午上课');
  await page.keyboard.press('Tab');
  expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBeTruthy();
  await page.screenshot({path: 'test-results/today-map-markers-mocked.png'});
  await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as {__mapDestroyed: number}).__mapDestroyed)).toBeGreaterThan(0);
});

test('手动确认建筑后持久保存，修改原地点会清除旧标记', async ({page, request}) => {
  await request.put('/api/maps/config', {headers, data: {js_key: 'map-test-js', security_code: 'map-test-code'}});
  const e = await add(request, '去新楼'); await mockMapSDK(page);
  await page.goto('/'); await page.getByRole('button', {name: '今日地图', exact: true}).click();
  const dialog = page.getByRole('dialog', {name: '今日地图'});
  await dialog.locator('.map-entry').click(); await dialog.getByRole('button', {name: '校正地点', exact: true}).click();
  await dialog.getByRole('button', {name: '在地图上选点', exact: true}).click();
  await dialog.locator('.map-canvas').click({position: {x: 200, y: 200}});
  await dialog.getByLabel('建筑名称', {exact: true}).fill('实验楼 B 栋'); await dialog.getByRole('button', {name: '保存地点', exact: true}).click();
  await expect(dialog.locator('.map-building-marker')).toContainText('实验楼 B 栋');
  await page.reload(); await page.getByRole('button', {name: '今日地图', exact: true}).click();
  await expect(dialog.locator('.map-building-marker')).toContainText('实验楼 B 栋');
  expect((await request.put(`/api/planner/entries/${e.id}`, {headers, data: {title: e.title, list_id: e.list_id, kind: e.kind, start: e.start, end: e.end, location: '另一栋楼', revision: 1}})).ok()).toBeTruthy();
  await page.reload(); await page.getByRole('button', {name: '今日地图', exact: true}).click();
  await expect(dialog.locator('.map-building-marker')).toHaveCount(0); await expect(dialog.locator('.map-entry')).toContainText('待定位');
});

test('打开地图自动标记任务和日程，无需选择建筑，轮询和重开不重复查询', async ({page, request}) => {
  await page.setViewportSize({width: 620, height: 850}); await page.emulateMedia({reducedMotion: 'reduce'});
  await request.put('/api/maps/config', {headers, data: {js_key: 'map-test-js', security_code: 'map-test-code', web_key: 'map-test-web'}});
  await add(request, '去暨南大学图书馆自习', {kind: 'task', location: ''});
  const event = await add(request, '讨论方案', {location: '暨南大学图书馆201室'});
  await mockMapSDK(page);
  let lookups = 0;
  await page.route('**/api/maps/entries/*/resolve', async route => {
    lookups++;
    const id = route.request().url().split('/').at(-2)!;
    const snapshot = await (await request.get('/api/planner')).json();
    const entry = snapshot.entries.find((item: {id: string}) => item.id === id);
    const result = await request.put(`/api/maps/entries/${id}/place`, {headers, data: {revision: entry.revision, map_revision: entry.map_revision || 0, place: {...place, name: entry.location === '广州国际金融中心' ? entry.location : '暨南大学图书馆', lng: entry.location === '广州国际金融中心' ? 113.32 : place.lng}}});
    await route.fulfill({json: await result.json()});
  });
  await page.goto('/'); await page.getByRole('button', {name: '今日地图', exact: true}).click();
  const dialog = page.getByRole('dialog', {name: '今日地图'});
  await expect(dialog.locator('.map-building-marker')).toHaveAttribute('aria-label', '暨南大学图书馆 · 2 项安排');
  await expect(dialog.locator('.map-entry').filter({hasText:'讨论方案'})).toContainText('暨南大学图书馆201室');
  await expect(dialog.getByRole('button', {name: '选择建筑', exact: true})).toHaveCount(0);
  await expect(dialog.locator('.map-entry-detail')).toHaveCount(0);
  await dialog.locator('.map-entry').filter({hasText:'讨论方案'}).click();
  await expect(dialog.locator('.map-original-location')).toHaveText('暨南大学图书馆201室');
  await dialog.getByRole('button', {name:'关闭地点详情'}).click();
  expect(lookups).toBe(2);
  await page.clock.runFor(5500); expect(lookups).toBe(2);
  await page.keyboard.press('Escape'); await page.getByRole('button', {name: '今日地图', exact: true}).click();
  await expect(dialog.locator('.map-building-marker')).toHaveCount(1); expect(lookups).toBe(2);
  await request.put(`/api/planner/entries/${event.id}`, {headers, data: {title: event.title, list_id: event.list_id, kind: event.kind, start: event.start, end: event.end, location: '广州国际金融中心', revision: event.revision}});
  await page.clock.runFor(5500);
  await expect(dialog.locator('.map-building-marker')).toHaveCount(2);
  await expect(dialog.locator('.map-building-marker').filter({hasText:'广州国际金融中心'})).toBeVisible();
  expect(lookups).toBe(3);
  expect(await page.locator('.today-map-panel').evaluate(el => getComputedStyle(el).animationName)).toBe('none');
  const box = (await dialog.boundingBox())!; expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(620);
  await page.screenshot({path: 'test-results/today-map-auto-narrow-mocked.png'});
});

test('重名地点显示补充地址提示，可重试，未点击安排也会自动识别', async ({page, request}) => {
  await request.put('/api/maps/config', {headers, data: {js_key: 'map-test-js', security_code: 'map-test-code', web_key: 'map-test-web'}});
  const entry = await add(request, '时代大厦开会', {location: '时代大厦'});
  await mockMapSDK(page);
  let lookups = 0;
  await page.route('**/api/maps/entries/*/resolve', async route => {
    lookups++;
    await route.fulfill({json: {...entry, map_resolution: {input: [entry.location, entry.title, entry.notes], query: '时代大厦', status: 'ambiguous', message: ''}}});
  });
  await page.goto('/'); await page.getByRole('button', {name: '今日地图', exact: true}).click();
  await expect.poll(() => lookups).toBe(1);
  await expect(page.locator('.map-building-marker')).toHaveCount(0);
  await page.locator('.map-entry').click();
  await expect(page.locator('.map-entry-detail')).toContainText('存在同名地点，请在安排中补充城市或完整地址');
  await page.getByRole('button', {name: '重新识别地点'}).click();
  await expect.poll(() => lookups).toBe(2);
});

test('跨午夜自动更新今天，配置错误能重试且保留任务列表', async ({page, request}) => {
  await request.put('/api/maps/config', {headers, data: {js_key: 'map-test-js', security_code: 'map-test-code'}});
  await add(request, '今天活动', {all_day: true, start: '2026-09-28', end: '2026-09-29'});
  await add(request, '明天活动', {all_day: true, start: '2026-09-29', end: '2026-09-30'});
  await page.route('https://webapi.amap.com/maps?**', route => route.abort());
  await page.goto('/'); await page.getByRole('button', {name: '今日地图', exact: true}).click();
  const dialog = page.getByRole('dialog', {name: '今日地图'});
  await expect(dialog.getByRole('alert')).toContainText('地图加载失败'); await expect(dialog.locator('.map-entry')).toContainText('今天活动');
  await page.clock.setSystemTime(new Date('2026-09-29T00:01:00+08:00')); await page.clock.runFor(15001);
  await expect(dialog.locator('.map-entry')).toContainText('明天活动');
});

test('日程详情可以直接查看自动定位结果，非今日安排不会混入今日标记', async ({page, request}) => {
  const e = await add(request, '明天的实验', {all_day: true, start: '2026-09-29', end: '2026-09-30'});
  await page.goto(`/#calendar/${e.id}`);
  const editor = page.getByRole('dialog', {name: '日程详情'});
  await expect(editor).toBeVisible();
  await editor.getByRole('button', {name: '在地图中查看地点'}).click();
  const dialog = page.getByRole('dialog', {name: '今日地图'});
  await expect(dialog).toBeVisible(); await expect(dialog.locator('.map-entry')).toHaveCount(0);
  await expect(dialog.locator('.map-entry-detail')).toContainText('明天的实验');
  await expect(dialog).toContainText('此安排未列入今日地图，可查看它的定位结果');
});

test('选点期间日程改变时拒绝旧选择，不会把旧楼关联到新地址', async ({page, request}) => {
  await request.put('/api/maps/config', {headers, data: {js_key: 'map-test-js', security_code: 'map-test-code'}});
  const e = await add(request, '会面'); await mockMapSDK(page);
  await page.goto('/'); await page.getByRole('button', {name: '今日地图', exact: true}).click();
  const dialog = page.getByRole('dialog', {name: '今日地图'});
  await dialog.locator('.map-entry').click(); await dialog.getByRole('button', {name: '校正地点', exact: true}).click();
  await dialog.getByRole('button', {name: '在地图上选点', exact: true}).click();
  await dialog.locator('.map-canvas').click({position: {x: 200, y: 200}});
  await request.put(`/api/planner/entries/${e.id}`, {headers, data: {title: e.title, list_id: e.list_id, kind: e.kind, start: e.start, end: e.end, location: '新地址', revision: 1}});
  await page.clock.runFor(5001); await expect(dialog.locator('.map-entry')).toContainText('新地址');
  await dialog.getByRole('button', {name: '保存地点', exact: true}).click();
  await expect(dialog.getByRole('alert')).toContainText('安排或地点已变更');
  await expect(dialog.locator('.map-building-marker')).toHaveCount(0);
});
