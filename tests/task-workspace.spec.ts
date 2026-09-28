import { test, expect, session } from './fixtures';
test.use({storageState:async({},use)=>{await use({cookies:[{name:'sakuya_session',value:session('user'),domain:'127.0.0.1',path:'/',expires:-1,httpOnly:true,secure:false,sameSite:'Lax'}],origins:[]});}});
const headers={'X-Sakuya-Client':'workspace'};
async function seed(request:any){const data=await(await request.get('/api/planner')).json();const list=data.lists[0];const other=await(await request.post('/api/planner/lists',{headers,data:{name:'工作清单'}})).json();const entries=[];for(const title of ['整理资料','回邮件','检查进度']){entries.push(await(await request.post('/api/planner/entries',{headers,data:{title,list_id:list.id,notes:'一二三四五六七八九十后面的备注',tags:['学习'],start:'2026-09-28T09:00:00+08:00',end:'2026-09-28T10:00:00+08:00'}})).json());}return{entries,list,other};}

test('行内命名、相邻编辑浮窗、标签保存、时间备注位置和勾选动画',async({page,request})=>{
  const {entries}=await seed(request);await page.goto('/#todos');const row=page.locator(`[data-task-id="${entries[0].id}"]`);
  await row.getByRole('button',{name:'重命名任务 整理资料'}).click();await page.getByLabel('任务名称',{exact:true}).fill('整理参考资料');await page.getByLabel('任务名称',{exact:true}).press('Enter');
  await expect(row).toContainText('整理参考资料');await expect(row.locator('.task-note-preview')).toHaveText('一二三四五六七八九十…');
  const title=(await row.locator('strong').boundingBox())!,time=(await row.locator('time').boundingBox())!,notes=(await row.locator('.task-note-preview').boundingBox())!;expect(title.y).toBeLessThan(time.y);expect(time.y).toBeLessThan(notes.y);
  await row.locator('.task-drag-zone').press('Enter');const dialog=page.getByRole('dialog',{name:'任务详情',exact:true});await expect(dialog).toBeVisible();
  const r=(await row.boundingBox())!,d=(await dialog.boundingBox())!;expect(Math.min(Math.abs(d.x+d.width-r.x),Math.abs(d.x-r.x-r.width))).toBeLessThan(20);
  await dialog.getByLabel('标签',{exact:true}).fill('学习,重要');await dialog.getByRole('button',{name:'保存',exact:true}).click();await expect(row.locator('.task-tags')).toContainText('#重要');
  await expect(page.locator('.planner-editor-presence')).toHaveCount(0);await page.screenshot({path:'test-results/tasks-interactions.png',animations:'disabled'});
  await row.getByRole('button',{name:'完成任务 整理参考资料'}).click();await expect(row).toHaveClass(/completing/);await expect(row.locator('strong')).toHaveCSS('text-decoration-line','line-through');
  await expect(row).not.toBeVisible();await page.locator('.task-group-completed .task-group-heading').click();await expect(row).toBeVisible();await expect(row).toHaveClass(/completed/);
  await page.reload();await page.locator('.task-group-completed .task-group-heading').click();await expect(row.locator('.task-tags')).toContainText('#重要');
});

test('拖动顺序持久化并优先排序，拖到清单可分类',async({page,request})=>{
  const {entries,other}=await seed(request);await page.goto('/#todos');
  await page.getByRole('button',{name:'排列顺序设置'}).click();const menu=page.getByRole('dialog',{name:'排列顺序',exact:true});await expect(menu).toBeVisible();await expect(menu.getByRole('button',{name:'无',exact:true})).toBeVisible();await menu.getByRole('button',{name:'标题',exact:true}).click();await expect(menu.getByRole('button',{name:'标题',exact:true})).toHaveAttribute('aria-pressed','true');await page.keyboard.press('Escape');
  const first=page.locator('.todo-row').first();const id=await first.getAttribute('data-task-id');const moved=entries.find((e:any)=>e.id!==id)!;const row=page.locator(`[data-task-id="${moved.id}"]`);
  await row.locator('.task-drag-zone').dragTo(first,{targetPosition:{x:70,y:2}});await expect(page.locator('.todo-row').first()).toHaveAttribute('data-task-id',moved.id);
  await page.getByRole('button',{name:'排列顺序设置'}).click();await menu.getByRole('button',{name:'优先级',exact:true}).click();await page.keyboard.press('Escape');await page.reload();await expect(page.locator('.todo-row').first()).toHaveAttribute('data-task-id',moved.id);
  await row.locator('.task-drag-zone').dragTo(page.locator('.planner-list-row').filter({has:page.getByRole('button',{name:other.name,exact:true})}));await expect(row.locator('.task-list-caption')).toHaveText(other.name);
  await page.getByRole('button',{name:'排列顺序设置'}).click();await menu.getByRole('button',{name:'清单',exact:true}).click();await page.keyboard.press('Escape');await expect(page.locator(`.task-group-${other.id}`)).toContainText(moved.title);
});

test('任务标题处长按后仍可拖动，不触发框选或重命名',async({page,request})=>{
  const {entries,other}=await seed(request);await page.goto('/#todos');
  const row=page.locator(`[data-task-id="${entries[1].id}"]`),first=page.locator(".todo-row").first();
  const source=(await row.locator('.task-rename-zone').boundingBox())!,target=(await first.boundingBox())!;
  await page.mouse.move(source.x+10,source.y+10);await page.mouse.down();await page.waitForTimeout(650);
  await expect(page.locator('.task-selection-rectangle')).toHaveCount(0);
  await page.mouse.move(target.x+80,target.y+2,{steps:12});await page.mouse.up();
  await expect(page.locator('.todo-row').first()).toHaveAttribute('data-task-id',entries[1].id);
  await expect(page.getByLabel('任务名称',{exact:true})).toHaveCount(0);
  await expect(page.locator('.todo-row.multi-selected')).toHaveCount(0);
  // The row padding is a drag source too, rather than only its invisible right-hand zone.
  const from=(await row.boundingBox())!,to=(await page.locator(`[data-list-id="${other.id}"]`).boundingBox())!;
  await page.mouse.move(from.x+3,from.y+3);await page.mouse.down();await page.mouse.move(to.x+to.width/2,to.y+to.height/2,{steps:12});await page.mouse.up();
  await expect(row.locator('.task-list-caption')).toHaveText(other.name);
  await page.reload();await expect(page.locator('.todo-row').first()).toHaveAttribute('data-task-id',entries[1].id);
});

test('功能顶栏左右拖动、清单宽度、主页与独立窗口',async({page,context})=>{
  await page.goto('/#todos');const header=page.getByLabel('拖动功能区域',{exact:true});const box=(await header.boundingBox())!;
  await page.mouse.move(box.x+80,box.y+box.height/2);await page.mouse.down();await page.mouse.move(150,box.y+box.height/2,{steps:10});await page.mouse.up();await expect(page.locator('.work-layout')).toHaveClass(/feature-left/);
  await page.reload();await expect(page.locator('.work-layout')).toHaveClass(/feature-left/);
  const divider=page.getByRole('separator',{name:'调整清单区域宽度'});await divider.focus();await page.keyboard.press('ArrowLeft');await expect(divider).toHaveAttribute('aria-valuenow','220');await page.reload();await expect(divider).toHaveAttribute('aria-valuenow','220');
  const popupPromise=context.waitForEvent('page');await page.getByRole('button',{name:'在独立窗口打开'}).click();const popup=await popupPromise;await popup.waitForLoadState();await expect(popup.locator('.detached-window')).toBeVisible();await expect(popup.locator('.task-workspace')).toBeVisible();await expect(popup.locator('.chat-scroll')).not.toBeVisible();await popup.close();
  await page.getByRole('button',{name:'打开工作功能'}).hover();await page.getByRole('navigation',{name:'工作功能'}).getByRole('button',{name:'主页',exact:true}).click();await expect(page.getByRole('heading',{name:'今天想做些什么？'})).toBeVisible();
});

test('全天、表头与时间网格在调整宽度和天数后始终对齐',async({page})=>{
  await page.goto('/#calendar');await page.getByLabel('日历视图').selectOption('week');
  async function aligned(){const cells=await page.locator('.all-day-row>div').evaluateAll(els=>els.map(e=>({x:e.getBoundingClientRect().x,width:e.getBoundingClientRect().width})));const grid=await page.locator('.calendar-day').evaluateAll(els=>els.map(e=>({x:e.getBoundingClientRect().x,width:e.getBoundingClientRect().width})));expect(cells.length).toBe(grid.length);cells.forEach((c,i)=>{expect(Math.abs(c.x-grid[i].x)).toBeLessThan(1);expect(Math.abs(c.width-grid[i].width)).toBeLessThan(1);});}
  await aligned();await page.getByRole('button',{name:'我的规划',exact:true}).click();const divider=page.getByRole('separator',{name:'调整清单区域宽度'});const before=await page.locator('.calendar-day').first().getAttribute('data-date');await divider.focus();await page.keyboard.press('ArrowLeft');await expect(page.locator('.calendar-day').first()).toHaveAttribute('data-date',before!);await aligned();await page.getByRole('button',{name:'减少显示天数'}).click();await aligned();await page.screenshot({path:'test-results/calendar-aligned.png'});
});

test('总设置包含连接与自动导入，启用后立即只导入指定来源',async({page})=>{
  const status={google:{connected:true,configured:true,auto_import:false},dida:{connected:false},ticktick:{connected:false}};let imported=false;
  await page.route('**/api/integrations',route=>route.fulfill({json:status}));
  await page.route('**/api/integrations/google/auto-import',route=>{status.google.auto_import=route.request().postDataJSON().enabled;return route.fulfill({json:status.google});});
  await page.route('**/api/integrations/import',route=>{const data=route.request().postDataJSON();expect(data.providers).toEqual(['google']);imported=true;return route.fulfill({json:{ok:true,errors:[],imported_lists:2}});});
  await page.goto('/#settings');const row=page.locator('.integration-setting-row').filter({has:page.getByText('Google 日历',{exact:true})});await row.getByLabel('自动导入').check();await expect(page.getByRole('status')).toContainText('新增 2 个清单');expect(imported).toBe(true);
});
