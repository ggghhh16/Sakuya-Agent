import { test, expect, session } from './fixtures';
import type { Locator, Page } from '@playwright/test';

// Geometry assertions use fixed coordinates; route entrance animations are covered separately.
test.use({reducedMotion: 'reduce'});
test.use({storageState: async ({}, use) => { await use({cookies: [{name: 'sakuya_session', value: session('user'), domain: '127.0.0.1', path: '/', expires: -1, httpOnly: true, secure: false, sameSite: 'Lax'}], origins: []}); }});
const headers = {'X-Sakuya-Client': 'workspace'};

async function beside(block: Locator, dialog: Locator) {
  const a = (await block.boundingBox())!, b = (await dialog.boundingBox())!;
  expect(Math.min(Math.abs(a.x - b.x - b.width), Math.abs(b.x - a.x - a.width))).toBeLessThan(16);
}
async function dragAt(page: Page, column: Locator, startMinutes: number, endMinutes: number) {
  const r = (await column.boundingBox())!;
  const x = r.x + Math.min(80, r.width / 2), y = r.y + endMinutes / 60 * 72;
  await page.mouse.move(x, r.y + startMinutes / 60 * 72);
  await page.mouse.down();
  await page.mouse.move(x, y, {steps: 8});
  return {x, y};
}

test('空白单击不创建，拖动末端不多加五分钟，草稿可移动且保留表单', async ({page, request}) => {
  await page.goto('/#calendar');
  await page.getByLabel('日历视图').selectOption('day');
  const column = page.locator('.calendar-day');
  const r = (await column.boundingBox())!;
  await page.mouse.click(r.x + 80, r.y + 10 * 72);
  await expect(page.locator('[data-entry-id="__preview"]')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const pointer = await dragAt(page, column, 600, 625);
  const draft = page.locator('[data-entry-id="__preview"]');
  await expect(draft).toBeVisible();
  let block = (await draft.boundingBox())!;
  expect(Math.abs(block.y + block.height - pointer.y)).toBeLessThanOrEqual(1);
  await page.mouse.up();
  const dialog = page.getByRole('dialog', {name: '新建日程', exact: true});
  await expect(dialog).toBeVisible();
  await expect(draft).toHaveAttribute('aria-label', /10:00.*10:25/);
  await beside(draft, dialog);
  await dialog.getByLabel('标题', {exact: true}).fill('保留标题');
  await dialog.getByLabel('备注', {exact: true}).fill('拖动后保留备注');
  block = (await draft.boundingBox())!;
  await page.mouse.move(block.x + 80, block.y + block.height / 2);
  await page.mouse.down();
  await page.mouse.move(block.x + 80, block.y + block.height / 2 + 72, {steps: 8});
  await expect(dialog).not.toBeVisible();
  await expect(draft).toBeVisible();
  await page.mouse.up();
  await expect(dialog).toBeVisible();
  await expect(draft).toHaveAttribute('aria-label', /11:00.*11:25/);
  await expect(dialog.getByLabel('标题', {exact: true})).toHaveValue('保留标题');
  await expect(dialog.getByLabel('备注', {exact: true})).toHaveValue('拖动后保留备注');
  await expect(dialog.getByLabel('开始', {exact: true})).toHaveValue(/T11:00$/);
  await beside(draft, dialog);
  expect((await (await request.get('/api/planner')).json()).entries).toHaveLength(0);
  await page.screenshot({path: 'test-results/calendar-draft-moved.png', animations: 'disabled'});
  // Esc during a drag rolls back the gesture without cancelling the editor.
  block = (await draft.boundingBox())!;
  await page.mouse.move(block.x + 80, block.y + block.height / 2);
  await page.mouse.down();
  await page.mouse.move(block.x + 80, block.y + block.height / 2 + 36, {steps: 5});
  await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(dialog).toBeVisible();
  await expect(draft).toHaveAttribute('aria-label', /11:00.*11:25/);
  await dialog.getByRole('button', {name: '保存', exact: true}).click();
  await expect(dialog).not.toBeVisible();
  const saved = page.locator('.calendar-event').filter({hasText: '保留标题'});
  await expect(saved).toHaveCount(1);
  expect((await (await request.get('/api/planner')).json()).entries).toHaveLength(1);
  await page.reload();
  await expect(saved).toHaveAttribute('aria-label', /11:00.*11:25/);
});

test('已保存时间块点击与键盘编辑相邻，25分钟及以下时间在标题右边', async ({page, request}) => {
  const data = await (await request.get('/api/planner')).json();
  const ids: string[] = [];
  for (const [hour, minutes] of [[9, 25], [10, 30], [11, 5]]) {
    const start = new Date(); start.setHours(hour, 0, 0, 0);
    const response = await request.post('/api/planner/entries', {headers, data: {title: `时长${minutes}`, list_id: data.lists[0].id, kind: 'event', start: start.toISOString(), end: new Date(+start + minutes * 60000).toISOString()}});
    ids.push((await response.json()).id);
  }
  await page.goto('/#calendar'); await page.getByLabel('日历视图').selectOption('day');
  for (const [index, minutes] of [25, 30, 5].entries()) {
    const block = page.locator(`[data-entry-id="${ids[index]}"]`);
    const title = (await block.locator('strong').boundingBox())!, time = (await block.locator('small').boundingBox())!;
    if (minutes <= 25) { expect(time.x).toBeGreaterThan(title.x); expect(Math.abs(title.y + title.height / 2 - time.y - time.height / 2)).toBeLessThan(2); }
    else expect(time.y).toBeGreaterThan(title.y);
  }
  const block = page.locator(`[data-entry-id="${ids[0]}"]`);
  await block.click();
  const dialog = page.getByRole('dialog', {name: '日程详情'});
  await expect(dialog).toBeVisible(); await beside(block, dialog);
  await dialog.getByLabel('标题', {exact: true}).fill('编辑预览');
  await expect(block).toContainText('编辑预览');
  await page.keyboard.press('Escape');
  await expect(block).toContainText('时长25');
  await block.focus(); await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible(); await beside(block, dialog);
  await page.screenshot({path: 'test-results/calendar-existing-editor.png', animations: 'disabled'});
});

test('显示天数边界及记忆，今天位于最左侧，规划栏切换不收起且按钮只有图标', async ({page}) => {
  await page.goto('/#calendar');
  const planning = page.getByRole('button', {name: '我的规划', exact: true});
  await expect(planning).toHaveText('');
  await expect(page.getByRole('button', {name: '新建日程', exact: true})).toHaveText('');
  await planning.click();
  const sidebar = page.locator('.planner-sidebar');
  await sidebar.getByRole('button', {name: '任务清单', exact: true}).click();
  await expect(sidebar).toBeVisible();
  await expect(page.getByRole('button',{name:'显示清单区域'})).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('button', {name: '新建任务', exact: true})).toHaveText('');
  await sidebar.getByRole('button', {name: '日历', exact: true}).click();
  await expect(sidebar).toBeVisible(); await planning.click();
  await page.getByRole('button', {name: '今天', exact: true}).click();
  const localToday = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; });
  await expect(page.locator('.calendar-day').first()).toHaveAttribute('data-date', localToday);
  await expect(page.locator('.calendar-day')).toHaveCount(7);
  const toolbar = (await page.locator('.planner-toolbar').boundingBox())!, controls = (await page.getByRole('group', {name: '显示天数'}).boundingBox())!;
  expect(toolbar.x + toolbar.width - controls.x - controls.width).toBeLessThanOrEqual(32);
  const more = page.getByRole('button', {name: '增加显示天数'}), less = page.getByRole('button', {name: '减少显示天数'});
  await more.click(); await expect(page.locator('.calendar-day')).toHaveCount(8);
  await page.reload(); await expect(page.locator('.calendar-day')).toHaveCount(8);
  for (let count = 8; count < 14; count++) await more.click();
  await expect(page.locator('.calendar-day')).toHaveCount(14); await expect(more).toBeDisabled();
  for (let count = 14; count > 1; count--) await less.click();
  await expect(page.locator('.calendar-day')).toHaveCount(1); await expect(less).toBeDisabled();
  await page.getByLabel('日历视图').selectOption('month');
  await expect(more).toBeDisabled(); await expect(less).toBeDisabled();
  await page.getByLabel('日历视图').selectOption('day'); await more.click();
  await expect(page.locator('.calendar-day')).toHaveCount(2);
  await expect(page.locator('.calendar-day').first()).toHaveAttribute('data-date', localToday);
  await page.screenshot({path: 'test-results/calendar-two-days-icons.png', animations: 'disabled'});
});

test('五分钟时间块副本可移动，保存不会覆盖原日程', async ({page, request}) => {
  const data = await (await request.get('/api/planner')).json();
  const start = new Date(); start.setHours(9, 0, 0, 0);
  const response = await request.post('/api/planner/entries', {headers, data: {title: '原日程', list_id: data.lists[0].id, kind: 'event', start: start.toISOString(), end: new Date(+start + 300000).toISOString()}});
  const original = (await response.json()).id;
  await page.goto('/#calendar'); await page.getByLabel('日历视图').selectOption('day');
  await page.locator(`[data-entry-id="${original}"]`).click();
  await page.getByRole('dialog').getByRole('button', {name: '复制', exact: true}).click();
  const draft = page.locator('[data-entry-id="__preview"]');
  const b = (await draft.boundingBox())!;
  await page.mouse.move(b.x + 15, b.y + b.height / 2); await page.mouse.down();
  await page.mouse.move(b.x + 15, b.y + b.height / 2 + 72, {steps: 8}); await page.mouse.up();
  await expect(draft).toHaveAttribute('aria-label', /10:00.*10:05/);
  await page.getByRole('dialog', {name: '新建日程', exact: true}).getByRole('button', {name: '保存', exact: true}).click();
  await expect(draft).toHaveCount(0);
  const entries = (await (await request.get('/api/planner')).json()).entries;
  expect(entries).toHaveLength(2);
  expect(entries.find((e: {id: string}) => e.id === original).title).toBe('原日程');
  expect(entries.find((e: {id: string}) => e.id === original).start).toBe(start.toISOString());
});

test('跨日移动新草稿及调整底边，不写入后端', async ({page, request}) => {
  await page.goto('/#calendar');
  await page.getByRole('button', {name: '今天', exact: true}).click();
  const column = page.locator('.calendar-day').nth(2);
  await dragAt(page, column, 540, 570); await page.mouse.up();
  const draft = page.locator('[data-entry-id="__preview"]');
  const dialog = page.getByRole('dialog', {name: '新建日程', exact: true});
  await expect(dialog).toBeVisible();
  const originalDay = await draft.locator('..').getAttribute('data-date');
  let b = (await draft.boundingBox())!;
  const width = (await column.boundingBox())!.width;
  await page.mouse.move(b.x + b.width / 2, b.y + 16); await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + width, b.y + 16, {steps: 8});
  await expect(dialog).not.toBeVisible(); await page.mouse.up();
  await expect(dialog).toBeVisible();
  expect(await draft.locator('..').getAttribute('data-date')).not.toBe(originalDay);
  await beside(draft, dialog);
  b = (await draft.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height - 1); await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height + 11, {steps: 5});
  await expect(dialog).not.toBeVisible(); await page.mouse.up();
  await expect(dialog).toBeVisible();
  await expect(draft).toHaveAttribute('aria-label', /09:00.*09:40/);
  expect((await (await request.get('/api/planner')).json()).entries).toHaveLength(0);
  await page.keyboard.press('Escape'); await expect(draft).toHaveCount(0);
});
