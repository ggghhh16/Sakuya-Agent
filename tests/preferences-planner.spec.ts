import { test, expect, session } from './fixtures';

// Each test owns a regular user workspace; administrator fixtures share legacy data.
test.use({storageState: async ({}, use) => { await use({cookies: [{name: 'sakuya_session', value: session('user'), domain: '127.0.0.1', path: '/', expires: -1, httpOnly: true, secure: false, sameSite: 'Lax'}], origins: []}); }});

test('三语言菜单保留草稿并持久化；六种主题可切换', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('聊天消息', {exact: true}).fill('保留原始草稿');
  for (const [name, locale, greeting] of [['日本語', 'ja', '今日は何をしましょうか？'], ['English', 'en', 'What would you like to work on?'], ['简体中文', 'zh-CN', '今天想做些什么？']]) {
    await page.locator('.language-switch').click();
    await expect(page.locator('.language-option')).toHaveCount(3);
    await page.getByRole('button', {name, exact: true}).click();
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await expect(page.getByRole('heading', {name: greeting})).toBeVisible();
    await expect(page.locator('.chat-composer textarea')).toHaveValue('保留原始草稿');
  }
  await page.getByRole('button', {name: '主题设置', exact: true}).click();
  const colors = new Set<string>();
  for (const [label, family] of [['Sakuya', 'sakuya'], ['A/', 'a'], ['Notion', 'notion']]) {
    const group = page.locator('.theme-family').filter({has: page.getByText(label, {exact: true})});
    for (const [label, mode] of [['浅色', 'light'], ['深色', 'dark']]) {
      await group.getByRole('button', {name: label, exact: true}).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme-family', family);
      await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
      await expect(page.locator('html')).toHaveCSS('color-scheme', mode);
      colors.add(await page.locator('html').evaluate(el => getComputedStyle(el).getPropertyValue('--bg')));
      await page.screenshot({path: `test-results/theme-${family}-${mode}.png`, animations: 'disabled'});
    }
  }
  expect(colors.size).toBe(6);
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme-family', 'notion');
  await page.getByRole('button', {name: '切换主题', exact: true}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', {name: '打开聊天记录', exact: true}).click();
  await expect(page.locator('.history-body .theme-switch')).toHaveCount(0);
});

test('模型容量按元数据限制且切换模型清除旧容量', async ({page, request}) => {
  const headers = {'X-Sakuya-Client': 'workspace'};
  const response = await request.post('/api/settings/providers', {headers, data: {name: 'capacity-test', base_url: 'https://capacity.invalid/v1', api_key: 'test-only'}});
  const {id} = await response.json();
  await page.route(`**/api/settings/providers/${id}/models`, route => route.fulfill({json: {models: ['small-test', 'large-test', 'unknown-test'], context_windows: {'small-test': 32768, 'large-test': 200000}}}));
  await page.goto('/#settings');
  await page.getByLabel('选择供应商', {exact: true}).selectOption(id);
  await page.getByRole('button', {name: '重新加载模型'}).click();
  await page.getByLabel('模型 ID', {exact: true}).fill('small-test');
  const capacity = page.getByLabel('上下文容量（tokens）', {exact: true});
  await expect(capacity).toHaveValue('32768');
  await expect(capacity.locator('option[value="200000"]')).toHaveCount(0);
  await capacity.selectOption('16384');
  const saved = page.waitForResponse(r => r.url().endsWith('/api/settings/models') && r.request().method() === 'POST');
  await page.getByRole('button', {name: '添加到模型列表'}).click();
  await saved;
  await expect(page.getByLabel('模型 ID', {exact: true})).toHaveValue('');
  await expect(page.locator('.model-list')).toContainText('16,384');
  await page.getByLabel('模型 ID', {exact: true}).fill('large-test');
  await expect(capacity).toHaveValue('200000');
  await page.getByLabel('模型 ID', {exact: true}).fill('unknown-test');
  await expect(capacity).toHaveValue('');
  await capacity.selectOption('custom');
  await page.getByRole('spinbutton', {name: '自定义容量', exact: true}).fill('999');
  await expect(page.getByRole('button', {name: '添加到模型列表'})).toBeDisabled();
});

test('日程助手通过聊天请求持久化；任务按钮顺序已交换', async ({page, request}) => {
  await page.goto('/');
  await page.getByRole('button', {name: '对话选项', exact: true}).click();
  await page.getByRole('button', {name: /日程-任务管理助手 管理清单/}).click();
  await page.getByLabel('聊天消息').fill('检查我的任务和日程');
  const response = page.waitForResponse(r => r.url().endsWith('/api/chat') && r.request().method() === 'POST');
  await page.getByRole('button', {name: '发送消息', exact: true}).click();
  const payload = await (await response).json();
  expect(payload.run.assistant).toBe('planner');
  expect(payload.run.planner_tools).toBe(true);
  await page.reload();
  await expect(page.locator('.active-assistant')).toContainText('日程-任务管理助手');
  await expect(page.getByRole('button', {name: '发送消息', exact: true})).toBeVisible();
  await page.getByRole('button', {name: '对话选项', exact: true}).click();
  await page.getByRole('button', {name: /聊天助手 讨论/}).click();
  await page.getByLabel('聊天消息').fill('继续普通聊天');
  const normal = page.waitForResponse(r => r.url().endsWith('/api/chat') && r.request().method() === 'POST');
  await page.getByRole('button', {name: '发送消息', exact: true}).click();
  expect((await (await normal).json()).run.assistant).toBe('chat');
  await page.reload();
  await expect(page.locator('.active-assistant')).toHaveCount(0);
  await page.goto('/#todos');
  const sync = (await page.getByRole('button', {name: '同步日历与任务', exact: true}).boundingBox())!;
  const planning = (await page.getByRole('button', {name: '显示清单区域', exact: true}).boundingBox())!;
  expect(sync.x).toBeLessThan(planning.x);
  expect((await (await request.get('/api/workspace')).json()).chats.some((t: {id: string; assistant: string}) => t.id === payload.run.id && t.assistant === 'planner')).toBe(true);
});

test('拖动草稿持续显示，浮窗相邻，失败保留、取消清理、保存不重复', async ({page}) => {
  await page.goto('/#calendar');
  await page.getByLabel('日历视图').selectOption('week');
  const column = page.locator('.calendar-day').nth(3);
  async function dragCreate() {
    const box = (await column.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 10 * 72);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + 10 * 72 + 36, {steps: 8});
    await expect(page.locator('[data-entry-id="__preview"]')).toBeVisible();
    await page.mouse.up();
  }
  await dragCreate();
  const dialog = page.getByRole('dialog', {name: '新建日程', exact: true});
  const preview = page.locator('[data-entry-id="__preview"]');
  await expect(dialog).toBeVisible();
  await expect(preview).toBeVisible();
  await dialog.getByLabel('标题', {exact: true}).fill('相邻浮窗测试');
  await expect(preview).toContainText('相邻浮窗测试');
  const p = (await preview.boundingBox())!, d = (await dialog.boundingBox())!;
  expect(Math.min(Math.abs(p.x - d.x - d.width), Math.abs(d.x - p.x - p.width))).toBeLessThan(16);
  expect(d.y).toBeGreaterThanOrEqual(12);
  expect(d.y + d.height).toBeLessThanOrEqual(1000);
  await page.screenshot({path: 'test-results/calendar-adjacent-draft.png', animations: 'disabled'});
  await page.route('**/api/planner/entries', route => route.fulfill({status: 400, json: {detail: '模拟保存失败'}}));
  await dialog.getByRole('button', {name: '保存', exact: true}).click();
  await expect(dialog.getByRole('alert')).toContainText('模拟保存失败');
  await expect(preview).toBeVisible();
  await page.unroute('**/api/planner/entries');
  await page.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);
  await expect(dialog).not.toBeVisible();
  await dragCreate();
  await dialog.getByLabel('标题', {exact: true}).fill('保存草稿测试');
  await dialog.getByRole('button', {name: '保存', exact: true}).click();
  await expect(dialog).not.toBeVisible();
  await expect(preview).toHaveCount(0);
  await expect(page.locator('.calendar-event').filter({hasText: '保存草稿测试'})).toHaveCount(1);
  await page.reload();
  await expect(page.locator('.calendar-event').filter({hasText: '保存草稿测试'})).toHaveCount(1);
});
