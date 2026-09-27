import {test, expect, session} from './fixtures';

test.use({reducedMotion: 'reduce', storageState: async ({}, use) => { await use({cookies: [{name: 'sakuya_session', value: session('user'), domain: '127.0.0.1', path: '/', expires: -1, httpOnly: true, secure: false, sameSite: 'Lax'}], origins: []}); }});
const headers = {'X-Sakuya-Client': 'workspace'};
async function event(request: any) {
  const data = await (await request.get('/api/planner')).json();
  const d = new Date(); d.setHours(10,0,0,0);
  return (await (await request.post('/api/planner/entries', {headers, data: {title: '原始标题', notes: '原始备注', kind: 'event', list_id: data.lists[0].id, start: d.toISOString(), end: new Date(+d+1800000).toISOString()}})).json());
}

test('主题设置及语言在标题右侧，工单只从设置进入，分离的主题控件同步', async ({page}) => {
  await page.goto('/');
  const left = page.locator('.header-left'), right = page.locator('.header-right');
  const brand = (await left.getByRole('button', {name: 'Sakuya', exact: true}).boundingBox())!;
  const theme = (await left.getByRole('button', {name: '主题设置', exact: true}).boundingBox())!;
  const language = (await left.getByRole('button', {name: '切换语言'}).boundingBox())!;
  expect(theme.x).toBeGreaterThan(brand.x + brand.width);
  expect(language.x).toBeGreaterThan(theme.x);
  await expect(page.locator('header').getByRole('button', {name: '工单', exact: true})).toHaveCount(0);
  await left.getByRole('button', {name: '主题设置', exact: true}).click();
  const family = page.locator('.theme-family').filter({hasText: 'Notion'});
  await family.getByRole('button', {name: '浅色', exact: true}).click();
  await page.keyboard.press('Escape');
  await right.getByRole('button', {name: '切换主题', exact: true}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme-family', 'notion');
  await left.getByRole('button', {name: '主题设置', exact: true}).click();
  await expect(family.getByRole('button', {name: '深色', exact: true})).toHaveAttribute('aria-pressed', 'true');
  const menu = (await page.getByRole('dialog', {name: '主题设置'}).boundingBox())!;
  expect(menu.x).toBeGreaterThanOrEqual(0);
  await page.keyboard.press('Escape');
  await right.getByRole('button', {name: '设置', exact: true}).click();
  await page.getByRole('button', {name: '工单', exact: true}).click();
  await expect(page).toHaveURL(/#tickets$/);
});

test('已有日程标题自动保存且不提交其他未保存字段，点击外部关闭后刷新保留', async ({page, request}) => {
  const entry = await event(request);
  await page.goto('/#calendar'); await page.getByLabel('日历视图').selectOption('day');
  const block = page.locator(`[data-entry-id="${entry.id}"]`);
  await block.click(); const dialog = page.getByRole('dialog', {name: '日程详情'});
  await dialog.getByLabel('备注', {exact: true}).fill('尚未提交的备注');
  await dialog.getByLabel('标题', {exact: true}).fill('自动保存的标题');
  await expect(dialog.getByRole('status')).toHaveText('标题已自动保存');
  let entries = (await (await request.get('/api/planner')).json()).entries;
  expect(entries[0].title).toBe('自动保存的标题'); expect(entries[0].notes).toBe('原始备注');
  await page.locator('.calendar-hint').click(); await expect(dialog).not.toBeVisible();
  await expect(block).toContainText('自动保存的标题');
  await page.reload(); await expect(block).toContainText('自动保存的标题');
  await block.click(); await page.getByRole('dialog').getByLabel('标题', {exact: true}).fill('立即点击外部保存');
  await page.locator('.calendar-hint').click(); await expect(page.getByRole('dialog')).not.toBeVisible();
  entries = (await (await request.get('/api/planner')).json()).entries;
  expect(entries[0].title).toBe('立即点击外部保存'); expect(entries).toHaveLength(1);
  await block.click(); await expect(page.getByRole('dialog')).toBeVisible();
  await block.click(); await expect(page.getByRole('dialog')).not.toBeVisible();
});

test('新时间块填写标题后自动创建，后续输入与显式保存不会重复创建', async ({page, request}) => {
  await page.goto('/#calendar'); await page.getByLabel('日历视图').selectOption('day');
  await page.getByRole('button', {name: '新建日程', exact: true}).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('标题', {exact: true}).fill('自动创建的日程');
  await expect(dialog.getByRole('status')).toHaveText('标题已自动保存');
  await expect(dialog).toHaveAttribute('aria-label', '日程详情');
  await expect(page.locator('[data-entry-id="__preview"]')).toHaveCount(0);
  await dialog.getByLabel('标题', {exact: true}).fill('继续修改标题');
  await dialog.getByLabel('备注', {exact: true}).fill('完整保存备注');
  await dialog.getByRole('button', {name: '保存', exact: true}).click();
  await expect(dialog).not.toBeVisible();
  const entries = (await (await request.get('/api/planner')).json()).entries;
  expect(entries).toHaveLength(1); expect(entries[0].title).toBe('继续修改标题'); expect(entries[0].notes).toBe('完整保存备注');
});

test('失败保留浮窗和标题供重试，点击空白处关闭未命名草稿且不创建', async ({page, request}) => {
  await page.goto('/#calendar'); await page.getByLabel('日历视图').selectOption('day');
  await page.getByRole('button', {name: '新建日程', exact: true}).click();
  await page.locator('.calendar-hint').click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await (await request.get('/api/planner')).json()).entries).toHaveLength(0);
  await page.getByRole('button', {name: '新建日程', exact: true}).click();
  await page.route('**/api/planner/entries', route => route.fulfill({status: 503, json: {detail: '模拟自动保存失败'}}));
  await page.getByRole('dialog').getByLabel('标题', {exact: true}).fill('保留失败内容');
  await page.locator('.calendar-hint').click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('模拟自动保存失败');
  await expect(page.getByRole('dialog').getByLabel('标题', {exact: true})).toHaveValue('保留失败内容');
  await page.unroute('**/api/planner/entries');
  await page.locator('.calendar-hint').click(); await expect(page.getByRole('dialog')).not.toBeVisible();
  expect((await (await request.get('/api/planner')).json()).entries).toHaveLength(1);
});

test('自动创建请求尚未返回时继续输入并点击外部，串行保存最后标题', async ({page, request}) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let started = false, creates = 0;
  await page.route('**/api/planner/entries', async route => {
    if (route.request().method() === 'POST') { creates++; started = true; await gate; }
    await route.continue();
  });
  await page.goto('/#calendar'); await page.getByLabel('日历视图').selectOption('day'); await page.getByRole('button', {name: '新建日程', exact: true}).click();
  await page.getByRole('dialog').getByLabel('标题', {exact: true}).fill('第一版');
  await expect.poll(() => started).toBe(true);
  await page.getByRole('dialog').getByLabel('标题', {exact: true}).fill('请求期间继续输入的最终标题');
  await page.locator('.calendar-hint').click();
  release();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  const entries = (await (await request.get('/api/planner')).json()).entries;
  expect(creates).toBe(1); expect(entries).toHaveLength(1); expect(entries[0].title).toBe('请求期间继续输入的最终标题');
});
