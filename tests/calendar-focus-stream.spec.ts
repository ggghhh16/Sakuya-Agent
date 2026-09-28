import {test, expect, session} from './fixtures';

test.use({reducedMotion: 'reduce'});
test.use({storageState: async ({}, use) => { await use({cookies: [{name: 'sakuya_session', value: session('user'), domain: '127.0.0.1', path: '/', expires: -1, httpOnly: true, secure: false, sameSite: 'Lax'}], origins: []}); }});

test('聚焦范围缩放网格，创建时间保持准确，中键平移不创建日程', async ({page, request}) => {
  await page.goto('/#calendar');
  await page.getByLabel('日历视图').selectOption('day');
  const scroller = page.locator('.calendar-scroll');
  const originalScroll = await scroller.evaluate(el => el.scrollTop);
  let box = (await scroller.boundingBox())!;
  await page.mouse.move(box.x + 100, box.y + 200);
  await page.mouse.down({button: 'middle'});
  await page.mouse.move(box.x + 100, box.y + 300, {steps: 8});
  await page.mouse.up({button: 'middle'});
  expect(await scroller.evaluate(el => el.scrollTop)).toBeCloseTo(originalScroll - 100, 0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', {name: '聚焦模式', exact: true}).click();
  await expect(page.getByRole('region', {name: '聚焦时间范围'})).toBeVisible();
  const start = page.getByRole('slider', {name: '聚焦开始时间'}), end = page.getByRole('slider', {name: '聚焦结束时间'});
  await start.focus(); await page.keyboard.press('Home');
  await end.focus(); await page.keyboard.press('End');
  const allHeight = (await page.locator('.hour-line').first().boundingBox())!.height;
  const track = (await page.locator('.focus-track').boundingBox())!;
  let handle = (await start.boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down();
  await page.mouse.move(track.x + track.width / 3, handle.y + handle.height / 2, {steps: 10}); await page.mouse.up();
  await expect(start).toHaveAttribute('aria-valuenow', '480');
  handle = (await end.boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down();
  await page.mouse.move(track.x + track.width / 2, handle.y + handle.height / 2, {steps: 10}); await page.mouse.up();
  await expect(end).toHaveAttribute('aria-valuenow', '720');
  expect((await page.locator('.hour-line').first().boundingBox())!.height / allHeight).toBeCloseTo(6, 1);
  const column = (await page.locator('.calendar-day').boundingBox())!;
  await page.mouse.move(column.x + 100, column.y + column.height / 4); await page.mouse.down();
  await page.mouse.move(column.x + 100, column.y + column.height * 3 / 8, {steps: 8}); await page.mouse.up();
  await expect(page.getByRole('dialog', {name: '新建日程', exact: true})).toBeVisible();
  await expect(page.locator('[data-entry-id="__preview"]')).toHaveAttribute('aria-label', /09:00.*09:30/);
  await page.keyboard.press('Escape');
  box = (await scroller.boundingBox())!;
  const originalDate = await page.locator('.calendar-day').getAttribute('data-date');
  await page.mouse.move(box.x + box.width - 30, box.y + 180); await page.mouse.down({button: 'middle'});
  await page.mouse.move(box.x + 30, box.y + 180 + box.height / 4, {steps: 12}); await page.mouse.up({button: 'middle'});
  await expect(start).toHaveAttribute('aria-valuenow', '420');
  expect(await page.locator('.calendar-day').getAttribute('data-date')).not.toBe(originalDate);
  expect((await (await request.get('/api/planner')).json()).entries).toHaveLength(0);
  await page.screenshot({path: 'test-results/calendar-focus.png'});
  await page.getByRole('button', {name: '聚焦模式', exact: true}).click();
  expect((await page.locator('.time-grid').boundingBox())!.height).toBe(72 * 24);
});

test('聊天在完成前逐步显示，刷新后保留完整回复', async ({page}) => {
  await page.goto('/');
  await page.getByRole('textbox', {name: '聊天消息'}).fill('请演示流式回复');
  await page.getByRole('button', {name: '发送消息', exact: true}).click();
  const partial = page.locator('.streaming-reply');
  await expect(partial).toContainText('这是演示回复');
  await expect(page.getByRole('button', {name: '停止生成'})).toBeVisible();
  const first = (await partial.textContent())!.length;
  await expect.poll(async () => (await page.locator('.assistant-content .markdown').textContent())!.length).toBeGreaterThan(first);
  await expect(page.getByRole('button', {name: '停止生成'})).toHaveCount(0);
  const complete = await page.locator('.assistant-content .markdown').textContent();
  await page.reload();
  await expect(page.locator('.assistant-content .markdown')).toHaveText(complete!);
});

test('相同自动导入错误只提醒一次', async ({page}) => {
  await page.clock.install();
  let imports = 0;
  await page.route('**/api/integrations', route => route.fulfill({json: {google: {connected: true, auto_import: true}}}));
  await page.route('**/api/integrations/import', route => { imports++; return route.fulfill({json: {ok: false, errors: [{message: '导入测试错误'}], imported_lists: 0}}); });
  await page.goto('/');
  await expect(page.locator('.toast')).toContainText('导入测试错误');
  await page.getByRole('button', {name: '关闭提示'}).click();
  await page.clock.runFor(500);
  await page.clock.fastForward(61000);
  await expect.poll(() => imports).toBe(2);
  await expect(page.locator('.toast')).toHaveCount(0);
});
