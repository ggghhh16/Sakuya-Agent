import {test, expect, session} from './fixtures';
test.use({reducedMotion:'reduce',storageState:async({},use)=>{await use({cookies:[{name:'sakuya_session',value:session('user'),domain:'127.0.0.1',path:'/',expires:-1,httpOnly:true,secure:false,sameSite:'Lax'}],origins:[]});}});
const headers={'X-Sakuya-Client':'workspace'};

test('日程详情缩小且移除标签优先级，点外部保存全部字段',async({page,request})=>{
 const data=await(await request.get('/api/planner')).json();const start=new Date();start.setHours(9,0,0,0);
 const entry=await(await request.post('/api/planner/entries',{headers,data:{list_id:data.lists[0].id,title:'详情自动保存',kind:'event',start:start.toISOString(),end:new Date(+start+3600000).toISOString(),priority:'high',tags:['保留已有数据']}})).json();
 await page.goto('/#calendar');await page.getByLabel('日历视图').selectOption('day');await page.locator(`[data-entry-id="${entry.id}"]`).click();
 const dialog=page.getByRole('dialog',{name:'日程详情'});await expect(dialog).toBeVisible();
 await expect(dialog.getByLabel('优先级',{exact:true})).toHaveCount(0);await expect(dialog.getByLabel('标签',{exact:true})).toHaveCount(0);
 expect((await dialog.boundingBox())!.width).toBeLessThan(320);
 await dialog.getByLabel('地点',{exact:true}).fill('会议室42');await dialog.getByLabel('备注',{exact:true}).fill('点外部保存备注');
 const ending=new Date(+start+7200000);const text=`${ending.getFullYear()}-${String(ending.getMonth()+1).padStart(2,'0')}-${String(ending.getDate()).padStart(2,'0')}T11:00`;
 await dialog.getByLabel('结束',{exact:true}).fill(text);await page.locator('.planner-toolbar h1').click();await expect(dialog).toBeHidden();
 const saved=(await(await request.get('/api/planner')).json()).entries.find((e:any)=>e.id===entry.id);
 expect(saved.notes).toBe('点外部保存备注');expect(saved.location).toBe('会议室42');expect(saved.end).toBe(ending.toISOString());expect(saved.tags).toEqual(['保留已有数据']);expect(saved.priority).toBe('high');
 await page.locator(`[data-entry-id="${entry.id}"]`).click({button:'right'});expect((await page.getByRole('menu',{name:'日历选项'}).boundingBox())!.width).toBeCloseTo(252*.7,0);
 await page.screenshot({path:'test-results/calendar-compact-context.png'});
});

test('任务默认清单用于快速添加和新建，编辑清单缩小',async({page,request})=>{
 await request.get('/api/planner');const listing=await(await request.post('/api/planner/lists',{headers,data:{name:'默认任务目的地'}})).json();
 await page.goto('/#todos');await page.getByRole('button',{name:listing.name,exact:true}).click({button:'right'});
 const dialog=page.getByRole('dialog',{name:'编辑清单'});expect((await dialog.boundingBox())!.width).toBeLessThan(310);
 await dialog.getByRole('button',{name:'设为默认',exact:true}).click();await expect(dialog.getByRole('button',{name:'设为默认',exact:true})).toHaveAttribute('aria-pressed','true');await page.keyboard.press('Escape');
 await page.getByLabel('快速添加任务').fill('默认快速任务');await page.getByLabel('快速添加任务').press('Enter');await expect(page.locator('.todo-row')).toContainText('默认快速任务');
 expect((await(await request.get('/api/planner')).json()).entries[0].list_id).toBe(listing.id);
 await page.reload();await page.getByRole('button',{name:'新建任务',exact:true}).click();await expect(page.getByRole('dialog').getByLabel('所属清单')).toHaveValue(listing.id);
});

test('空白区域直接拖动框选完整任务，批量菜单与单项相同并执行到每项',async({page,request})=>{
 const data=await(await request.get('/api/planner')).json();const ids=[];
 for(const title of ['框选任务一','框选任务二','不选中的任务'])ids.push((await(await request.post('/api/planner/entries',{headers,data:{title,list_id:data.lists[0].id}})).json()).id);
 await page.goto('/#todos');const first=page.locator(`[data-task-id="${ids[0]}"]`),second=page.locator(`[data-task-id="${ids[1]}"]`);
 await first.click({button:'right'});const labels=await page.getByRole('menu',{name:'任务选项'}).getByRole('menuitem').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('aria-label')||node.textContent));await page.keyboard.press('Escape');
 const a=(await first.boundingBox())!,b=(await second.boundingBox())!;
 await page.mouse.move(a.x-5,a.y+3);await page.mouse.down();await page.mouse.move(b.x+b.width-3,b.y+b.height-3,{steps:10});
 await expect(page.locator('.task-selection-rectangle')).toBeVisible();await page.mouse.up();
 await expect(page.locator('.todo-row.multi-selected')).toHaveCount(2);await expect(first).toHaveAttribute('aria-selected','true');
 await first.click({button:'right'});expect(await page.getByRole('menu',{name:'任务选项'}).getByRole('menuitem').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('aria-label')||node.textContent))).toEqual(labels);
 await page.getByRole('menuitem',{name:'高优先级',exact:true}).click();await expect(first.locator('.task-check')).toHaveClass(/priority-high/);await expect(second.locator('.task-check')).toHaveClass(/priority-high/);
 await first.click({button:'right'});await page.getByRole('menuitem',{name:'编辑详情'}).click();await page.getByRole('dialog',{name:'批量编辑任务'}).getByLabel('备注').fill('共同备注');await page.getByRole('dialog').getByRole('button',{name:'保存',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'批量编辑任务'})).toHaveCount(0);
 const entries=(await(await request.get('/api/planner')).json()).entries;expect(entries.filter((e:any)=>ids.slice(0,2).includes(e.id)).every((e:any)=>e.notes==='共同备注')).toBe(true);expect(entries.find((e:any)=>e.id===ids[2]).notes).toBe('');
 await page.screenshot({path:'test-results/tasks-marquee-selected.png'});
});

test('任务拖到聊天成为引用，点击跳转，发送后持久化完整信息',async({page,request})=>{
 const data=await(await request.get('/api/planner')).json();const entry=await(await request.post('/api/planner/entries',{headers,data:{title:'引用任务',notes:'模型需要的完整备注',location:'三楼',list_id:data.lists[0].id}})).json();
 await page.goto('/#todos');await page.locator(`[data-task-id="${entry.id}"] .task-drag-zone`).dragTo(page.locator('.chat-composer'));
 const chip=page.locator('.chat-composer .chat-reference').getByRole('button',{name:entry.title,exact:true});await expect(chip).toBeVisible();await chip.click();await expect(page.getByRole('dialog',{name:'任务详情'}).getByLabel('备注')).toHaveValue(entry.notes);
 await page.keyboard.press('Escape');await page.getByLabel('聊天消息').fill('看看这个任务');await page.getByRole('button',{name:'发送消息',exact:true}).click();
 await expect(page.locator('.user-message .chat-reference')).toHaveText(entry.title);await expect(page.getByRole('button',{name:'停止生成'})).toHaveCount(0);
 const turn=(await(await request.get('/api/workspace')).json()).chats[0];expect(turn.references[0].entry.notes).toBe(entry.notes);expect(turn.model_prompt).toContain(entry.notes);
 await page.reload();await expect(page.locator('.user-message .chat-reference')).toHaveText(entry.title);await page.locator('.user-message .chat-reference').click();await expect(page.getByRole('dialog',{name:'任务详情'})).toBeVisible();
});

test('时间块拖到聊天仅添加引用，原日程时间不变',async({page,request})=>{
 const data=await(await request.get('/api/planner')).json();const start=new Date();start.setHours(10,0,0,0);
 const entry=await(await request.post('/api/planner/entries',{headers,data:{title:'引用时间块',kind:'event',list_id:data.lists[0].id,start:start.toISOString(),end:new Date(+start+3600000).toISOString()}})).json();
 await page.goto('/#calendar');await page.getByLabel('日历视图').selectOption('day');const block=(await page.locator(`[data-entry-id="${entry.id}"]`).boundingBox())!,composer=(await page.locator('.chat-composer').boundingBox())!;
 await page.mouse.move(block.x+block.width/2,block.y+block.height/2);await page.mouse.down();await page.mouse.move(composer.x+composer.width/2,composer.y+composer.height/2,{steps:15});await page.mouse.up();
 await expect(page.locator('.chat-composer .chat-reference')).toContainText(entry.title);const saved=(await(await request.get('/api/planner')).json()).entries.find((e:any)=>e.id===entry.id);expect(saved.start).toBe(entry.start);expect(saved.end).toBe(entry.end);
 await page.locator('.chat-reference').getByRole('button',{name:entry.title,exact:true}).click();await expect(page.getByRole('dialog',{name:'日程详情'})).toBeVisible();
});
