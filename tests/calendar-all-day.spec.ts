import {test,expect,session} from './fixtures';
test.use({reducedMotion:'reduce',storageState:async({},use)=>{await use({cookies:[{name:'sakuya_session',value:session('user'),domain:'127.0.0.1',path:'/',expires:-1,httpOnly:true,secure:false,sameSite:'Lax'}],origins:[]});}});
const headers={'X-Sakuya-Client':'workspace'};
test('全天栏单行汇总、箭头和数量展开，保留编辑与网格对齐',async({page,request})=>{
 await page.goto('/#calendar');await page.getByLabel('日历视图').selectOption('week');
 const dates=await page.locator('.calendar-day').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-date')!));
 const data=await(await request.get('/api/planner')).json();
 for(const [title,start,end] of [['领教材',dates[0],dates[1]],['安排明天听课内容',dates[0],dates[1]],['医务室开病假',dates[1],dates[2]]])expect((await request.post('/api/planner/entries',{headers,data:{title,start,end,all_day:true,kind:'event',list_id:data.lists[0].id}})).ok()).toBeTruthy();
 await page.reload();const row=page.locator('.all-day-row'),cells=row.locator('.all-day-cell');
 await expect(page.getByRole('button',{name:'展开全天日程',exact:true})).toHaveAttribute('aria-expanded','false');
 expect((await row.boundingBox())!.height).toBeLessThanOrEqual(30);
 await expect(cells.nth(0)).toHaveText('2 个活动');await expect(cells.nth(1).getByRole('button')).toHaveText('医务室开病假');await expect(cells.nth(2)).toBeEmpty();
 await page.screenshot({path:'test-results/all-day-collapsed.png'});
 await page.getByRole('button',{name:'展开全天日程',exact:true}).click();
 await expect(page.getByRole('button',{name:'收起全天日程',exact:true})).toHaveAttribute('aria-expanded','true');
 await expect(cells.nth(0).locator('.all-day-event')).toHaveCount(2);expect((await row.boundingBox())!.height).toBeGreaterThan(40);
 const boxes=await cells.evaluateAll(nodes=>nodes.map(node=>({x:node.getBoundingClientRect().x,width:node.getBoundingClientRect().width}))),grid=await page.locator('.calendar-day').evaluateAll(nodes=>nodes.map(node=>({x:node.getBoundingClientRect().x,width:node.getBoundingClientRect().width})));
 boxes.forEach((box,i)=>{expect(Math.abs(box.x-grid[i].x)).toBeLessThan(1);expect(Math.abs(box.width-grid[i].width)).toBeLessThan(1);});
 await cells.nth(0).getByRole('button',{name:'领教材',exact:true}).click();await expect(page.getByRole('dialog',{name:'日程详情'}).getByLabel('标题',{exact:true})).toHaveValue('领教材');await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'收起全天日程',exact:true}).click();await cells.nth(0).locator('.all-day-count').click();await expect(cells.nth(0).locator('.all-day-event')).toHaveCount(2);
 await cells.nth(1).getByRole('button').click({button:'right'});await expect(page.getByRole('menu',{name:'日历选项'})).toBeVisible();await page.keyboard.press('Escape');
 await page.screenshot({path:'test-results/all-day-expanded.png'});
});

test('大量全天日程展开后可滚动，箭头仍可收起',async({page,request})=>{
 await page.goto('/#calendar');await page.getByLabel('日历视图').selectOption('day');
 const day=await page.locator('.calendar-day').getAttribute('data-date');const date=new Date(day+'T12:00:00');date.setDate(date.getDate()+1);const end=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
 const data=await(await request.get('/api/planner')).json();
 for(let i=0;i<12;i++)await request.post('/api/planner/entries',{headers,data:{title:`全天活动 ${i}`,start:day,end,all_day:true,kind:'event',list_id:data.lists[0].id}});
 await page.reload();await expect(page.locator('.all-day-count')).toHaveText('12 个活动');await page.getByRole('button',{name:'展开全天日程',exact:true}).click();
 const row=page.locator('.all-day-row');expect((await row.boundingBox())!.height).toBeLessThanOrEqual(184);expect(await row.evaluate(node=>node.scrollHeight>node.clientHeight)).toBeTruthy();
 await row.locator('.all-day-event').last().scrollIntoViewIfNeeded();await expect(row.locator('.all-day-event').last()).toBeInViewport();await expect(page.getByRole('button',{name:'收起全天日程',exact:true})).toBeInViewport();
 await page.getByRole('button',{name:'收起全天日程',exact:true}).click();expect((await row.boundingBox())!.height).toBeLessThanOrEqual(30);await expect(page.locator('.all-day-count')).toBeInViewport();
});
