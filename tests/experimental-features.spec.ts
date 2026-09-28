import {test,expect,session} from './fixtures';
test.use({storageState:async({},use)=>{await use({cookies:[{name:'sakuya_session',value:session('user'),domain:'127.0.0.1',path:'/',expires:-1,httpOnly:true,secure:false,sameSite:'Lax'}],origins:[]});}});
const headers={'X-Sakuya-Client':'workspace'};

test('实验性功能默认关闭，设置开启后才显示诊断入口并允许访问',async({page,request})=>{
 await page.goto('/#work');
 await expect(page.getByRole('navigation',{name:'工作功能'}).getByRole('button',{name:'Issue 诊断',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'排查代码问题'})).toHaveCount(0);
 await page.getByRole('button',{name:'对话选项',exact:true}).click();
 await expect(page.locator('.agent-option').filter({hasText:'Issue 诊断'})).toHaveCount(0);await page.keyboard.press('Escape');
 await page.goto('/#diagnosis');await expect(page.getByRole('heading',{name:'实验性功能未开启'})).toBeVisible();
 await page.getByRole('button',{name:'前往设置'}).click();
 const toggle=page.getByRole('checkbox',{name:'开启实验性功能'});await expect(toggle).not.toBeChecked();await toggle.click();await expect(toggle).toBeChecked();
 await page.reload();await expect(toggle).toBeChecked();
 await page.getByRole('button',{name:'打开工作功能'}).hover();await page.getByRole('navigation',{name:'工作功能'}).getByRole('button',{name:'Issue 诊断',exact:true}).click();
 await expect(page.getByRole('button',{name:'新建Issue 诊断'})).toBeVisible();
 const run=await(await request.post('/api/runs',{headers,data:{title:'需要隐藏的诊断历史',prompt:'调查这个演示问题',kind:'diagnosis',mode:'demo'}})).json();
 await page.goto('/#settings');await page.getByRole('button',{name:'对话选项',exact:true}).click();await page.locator('.agent-option').filter({hasText:'Issue 诊断'}).click();
 await toggle.click();await expect(toggle).not.toBeChecked();
 await expect(page.locator('.composer-toolbar')).not.toContainText('Issue 诊断');
 await page.reload();await expect(toggle).not.toBeChecked();
 await page.goto('/#run/'+run.id);await expect(page.getByText('请先在设置中开启实验性功能',{exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:run.title})).toHaveCount(0);
 await page.keyboard.press('Control+k');await page.getByLabel('搜索任务或工单',{exact:true}).fill(run.title);await expect(page.locator('.command-results')).not.toContainText(run.title);await page.keyboard.press('Escape');
 await page.goto('/#settings');await toggle.click();await expect(toggle).toBeChecked();await page.goto('/#run/'+run.id);await expect(page.getByRole('heading',{name:run.title,exact:true}).first()).toBeVisible();
});
