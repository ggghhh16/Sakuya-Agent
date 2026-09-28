import { test, expect } from './fixtures';

test('外侧边缘触发，悬停历史离开收起，点击入口保持展开', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '今天想做些什么？' })).toBeVisible();
  await page.mouse.move(2, 500);
  const history = page.getByRole('dialog', { name: '聊天记录' });
  await expect(history).toBeVisible();
  await history.hover({position: {x: 100, y: 200}});
  await page.mouse.move(600, 500, { steps: 8 });
  await expect(history).not.toBeVisible();
  await page.mouse.move(1438, 500);
  const work = page.getByRole('navigation', { name: '工作功能' });
  await expect(work).toBeVisible();
  await page.mouse.move(800, 350);
  await expect(work).not.toBeVisible();
  await page.getByRole('button', { name: '打开聊天记录', exact: true }).click();
  await page.mouse.move(600, 500);
  await expect(history).toBeVisible();
  await page.keyboard.press('Escape');
});

test('单行工具栏、上下文进度、白色模型标题与英文衬线字体', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Sakuya');
  await expect(page.locator('.assistant-picker')).toHaveCount(0);
  const send = (await page.getByRole('button', { name: '发送消息', exact: true }).boundingBox())!;
  for (const css of ['.approval-trigger', '.model-trigger', '.context-meter', '.composer-plus']) {
    const r = (await page.locator(css).boundingBox())!;
    expect(Math.abs(r.y + r.height / 2 - send.y - send.height / 2)).toBeLessThan(3);
  }
  const meter = page.getByRole('progressbar', { name: '上下文占比（估算）' });
  const before = Number(await meter.getAttribute('aria-valuenow'));
  await page.getByLabel('聊天消息').fill('这是需要保留的上下文。'.repeat(400));
  expect(Number(await meter.getAttribute('aria-valuenow'))).toBeGreaterThan(before);
  await meter.hover(); await expect(page.getByRole('tooltip')).toContainText('32K');
  await page.getByRole('button', { name: '模型与思考强度' }).click();
  await expect(page.locator('.model-trigger .lucide-zap,.reasoning-heading .lucide-zap')).toHaveCount(0);
  expect(await page.locator('.reasoning-heading strong').evaluate(el => getComputedStyle(el).color)).toBe(await page.locator('.model-trigger').evaluate(el => getComputedStyle(el).color));
  await page.keyboard.press('Escape');
  await page.locator('.language-switch').click(); await page.getByRole('button', { name: 'English', exact: true }).click();
  await expect(page.locator('.chat-greeting h1')).toHaveCSS('font-family', /Sakuya Serif/);
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check('20px "Sakuya Serif"'))).toBe(true);
  await page.getByLabel('Chat message').fill('What would you like to create today?');
  await page.screenshot({ path: 'test-results/refined-composer.png', animations: 'disabled' });
});

test('我的规划在右侧，日历创建使用带轻微透明和模糊的浮窗', async ({ page }) => {
  await page.goto('/#calendar');
  await expect(page.locator('.planner-sidebar')).toHaveCount(0);
  await page.getByRole('button', { name: '我的规划', exact: true }).click();
  await expect(page.locator('.planner-sidebar')).toBeVisible();
  const aside = (await page.locator('.planner-sidebar').boundingBox())!;
  const main = (await page.locator('.planner-main,.task-main').boundingBox())!;
  expect(aside.x).toBeGreaterThanOrEqual(main.x + main.width - 1);
  await page.getByRole('button', { name: '新建日程', exact: true }).click();
  const dialog = page.locator('.planner-editor-presence .modal');
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
  await expect(dialog).toHaveCSS('backdrop-filter', 'blur(12px)');
  const r = (await dialog.boundingBox())!;
  expect(r.x).toBeGreaterThan(0); expect(r.y).toBeGreaterThan(0);
  expect(r.y + r.height).toBeLessThan(1000);
  await page.screenshot({ path: 'test-results/calendar-floating-editor.png', animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
});

for (const route of ['todos', 'calendar']) {
  test(`${route} 清单区域展开收起并释放空间`, async ({ page }) => {
    await page.goto('/#' + route);
    const toggle = page.getByRole('button', { name: route === 'todos' ? '显示清单区域' : '我的规划', exact: true });
    if(route === 'todos') await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('.planner-sidebar')).toHaveCount(0);
    const closedWidth = (await page.locator('.planner-main,.task-main').boundingBox())!.width;
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const aside = (await page.locator('.planner-sidebar').boundingBox())!;
    const main = (await page.locator('.planner-main,.task-main').boundingBox())!;
    expect(aside.x).toBeGreaterThanOrEqual(main.x + main.width - 1);
    expect(closedWidth - main.width).toBeGreaterThan(180);
    if (route === 'todos') expect((await page.locator('.task-smart-views button').first().boundingBox())!.height).toBeLessThan(60);
    await page.screenshot({ path: `test-results/${route}-planning-open.png`, animations: 'disabled' });
    await toggle.click();
    await expect(page.locator('.planner-sidebar')).toHaveCount(0);
    expect((await page.locator('.planner-main,.task-main').boundingBox())!.width).toBe(closedWidth);
    await page.screenshot({ path: `test-results/${route}-planning-closed.png`, animations: 'disabled' });
    await toggle.click(); await page.reload();
    await expect(toggle).toHaveAttribute('aria-expanded', route === 'todos' ? 'true' : 'false');
  });
}
