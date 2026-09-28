import { test, expect } from './fixtures';

test.beforeEach(async ({request}) => {
  // Only clean fixtures owned by this suite, in the isolated E2E workspace.
  const data = await (await request.get('/api/planner')).json();
  for (const entry of data.entries) {
    if (/^(完成规划界面|拖动测试 |拖动新建日程)/.test(entry.title)) {
      await request.delete(`/api/planner/entries/${entry.id}?revision=${entry.revision}`, {headers:{'X-Sakuya-Client':'workspace'}});
    }
  }
});

test('自定义清单、任务持久化、完成恢复、详情关闭与删除撤销', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/#todos');
  await page.getByRole('button', {name: '新建清单', exact: true}).click();
  let dialog = page.getByRole('dialog', {name: '新建清单', exact: true});
  const name = `自定义 ${Date.now()}`;
  await dialog.getByLabel('清单名称').fill(name);
  await dialog.getByRole('button', {name: '颜色 #71cbb4'}).click();
  await dialog.getByRole('button', {name: '保存清单'}).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', {name, exact: true}).click();
  await page.getByLabel('快速添加任务').fill('完成规划界面');
  await page.getByLabel('快速添加任务').press('Enter');
  await expect(page.locator('.todo-row').filter({hasText: '完成规划界面'})).toBeVisible();
  await page.getByRole('button', {name, exact: true}).click({button:'right'});
  await page.getByRole('dialog').getByLabel('清单名称').fill(name + '修改');
  await page.getByRole('button', {name: '保存清单'}).click();
  await expect(page.getByRole('heading', {name: name + '修改'})).toBeVisible();
  await page.getByRole('button', {name: '编辑任务 完成规划界面'}).click({button:'right'});await page.getByRole('menuitem',{name:'编辑详情'}).click();
  const detail = page.getByRole('dialog', {name: '任务详情', exact: true});
  dialog = detail;
  await dialog.getByLabel('备注').fill('保留日期和清单');
  await dialog.getByRole('button', {name: '添加时间', exact: true}).click();
  await dialog.getByLabel('开始', {exact: true}).fill('2026-09-27T09:05');
  await dialog.getByLabel('结束', {exact: true}).fill('2026-09-27T10:00');
  await dialog.getByRole('button', {name: '保存', exact: true}).click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await expect(page.locator('.todo-row').filter({hasText:'保留日期和清单'})).toBeVisible();
  await page.getByRole('button', {name:'完成任务 完成规划界面', exact:true}).click();
  await page.locator('.task-group-completed .task-group-heading').click();
  await expect(page.locator('.todo-row.completed').filter({hasText:'完成规划界面'})).toBeVisible();
  await page.getByRole('button', {name:'编辑任务 完成规划界面'}).click({button:'right'});await page.getByRole('menuitem',{name:'编辑详情'}).click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', {name:'编辑任务 完成规划界面'}).click({button:'right'});await page.getByRole('menuitem',{name:'编辑详情'}).click();
  await dialog.getByRole('button', {name:'删除当前内容'}).click();
  await dialog.getByRole('button', {name:'确认删除'}).click();
  await page.getByRole('button', {name:'撤销', exact:true}).click();
  await expect(page.locator('.todo-row').filter({hasText:'完成规划界面'})).toBeVisible();
  expect(errors).toEqual([]);
});

test('日历拖动、5分钟精度、缩放时长、取消拖动和刷新恢复', async ({ page, request }) => {
  const headers = {'X-Sakuya-Client': 'workspace'};
  const data = await (await request.get('/api/planner')).json();
  const day = new Date(); day.setHours(9,0,0,0);
  const r = await request.post('/api/planner/entries', {headers,data:{title:`拖动测试 ${Date.now()}`,list_id:data.lists[0].id,kind:'event',start:day.toISOString(),end:new Date(+day+3600000).toISOString()}});
  const e = await r.json();
  await page.goto('/#calendar');
  await page.getByLabel('日历视图').selectOption('day');
  const event = page.locator(`[data-entry-id="${e.id}"]`);
  await expect(event).toBeVisible();
  let box = (await event.boundingBox())!;
  await page.mouse.move(box.x+20,box.y+20); await page.mouse.down(); await page.mouse.move(box.x+20,box.y+26,{steps:4}); await page.mouse.up();
  await expect(event).toHaveAttribute('aria-label', /09:05.*10:05/);
  box = (await event.boundingBox())!;
  await page.mouse.move(box.x+20,box.y+box.height-2);await page.mouse.down();await page.mouse.move(box.x+20,box.y+box.height+4,{steps:4});await page.mouse.up();
  await expect(event).toHaveAttribute('aria-label',/09:05.*10:10/);
  box = (await event.boundingBox())!;
  await page.mouse.move(box.x+20,box.y+20);await page.mouse.down();await page.mouse.move(box.x+20,box.y+50,{steps:4});await page.keyboard.press('Escape');await page.mouse.up();
  await expect(event).toHaveAttribute('aria-label',/09:05.*10:10/);
  await page.reload();await page.getByLabel('日历视图').selectOption('day');
  await expect(event).toHaveAttribute('aria-label',/09:05.*10:10/);
  await event.focus();await page.keyboard.press('Alt+ArrowDown');
  await expect(event).toHaveAttribute('aria-label',/09:10.*10:15/);
  await page.screenshot({path:'test-results/planner-calendar.png',fullPage:true});
});

test('拖动创建、日周月切换、账号版本与窄屏布局', async ({page}) => {
  await page.goto('/#calendar');
  await page.getByLabel('日历视图').selectOption('day');
  const column = page.locator('.calendar-day').first();
  const box = (await column.boundingBox())!;
  // The grid is scrolled to 07:00. Create a block at 11:00.
  await page.mouse.move(box.x+100,box.y+11*72);await page.mouse.down();await page.mouse.move(box.x+100,box.y+11*72+36,{steps:6});await page.mouse.up();
  const dialog = page.getByRole('dialog',{name:'新建日程',exact:true});
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('标题').fill('拖动新建日程');
  await dialog.getByRole('button',{name:'保存',exact:true}).click();
  await expect(dialog).not.toBeVisible();
  await page.keyboard.press('m');await expect(page.locator('.month-cell')).toHaveCount(42);
  await page.keyboard.press('w');await expect(page.locator('.calendar-day')).toHaveCount(7);
  await page.getByRole('button',{name:'我的规划',exact:true}).click();
  await page.getByRole('button',{name:'连接设置',exact:true}).click();
  await page.getByRole('dialog',{name:'连接 Google 日历'}).getByRole('button',{name:'滴答清单',exact:true}).click();
  const settings=page.getByRole('dialog',{name:'日历与任务连接'});
  await settings.getByLabel('账号版本').selectOption('ticktick');
  await expect(settings.getByLabel('OAuth 回调地址')).toHaveValue(/ticktick\/callback/);
  await settings.getByLabel('账号版本').selectOption('dida');
  await expect(settings.getByLabel('OAuth 回调地址')).toHaveValue(/dida\/callback/);
  await page.keyboard.press('Escape');
  await page.setViewportSize({width:390,height:844});
  await page.goto('/#todos');
  await page.getByRole('button',{name:'新建任务',exact:true}).click();
  const mobile=page.getByRole('dialog',{name:'新建任务',exact:true});
  await expect(mobile).toBeVisible();
  await expect.poll(async()=>Math.round((await mobile.boundingBox())!.x)).toBeGreaterThanOrEqual(0);
  const mb=(await mobile.boundingBox())!;expect(mb.x).toBeGreaterThanOrEqual(-1);expect(mb.x+mb.width).toBeLessThanOrEqual(391);
  await page.emulateMedia({reducedMotion:'reduce'});
  expect(await mobile.evaluate(el=>getComputedStyle(el).animationName)).toBe('none');
});
