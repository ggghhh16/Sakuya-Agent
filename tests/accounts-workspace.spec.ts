import { createServer } from 'node:http';
import { test, expect, session } from './fixtures';

test('未登录显示注册表单，密码要求与缺失配置提示明确', async ({ page, context }) => {
  await context.clearCookies();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '登录 Sakuya' })).toBeVisible();
  await page.getByRole('button', { name: '注册', exact: true }).first().click();
  await page.getByLabel('邮箱', { exact: true }).fill('someone@example.com');
  await page.getByLabel('密码', { exact: true }).fill('lowercaseonly');
  await expect(page.getByRole('button', { name: '注册', exact: true }).last()).toBeDisabled();
  await page.getByLabel('密码', { exact: true }).fill('GoodPassword');
  await expect(page.getByText('✓ 密码强度符合要求')).toBeVisible();
  await page.screenshot({ path: 'test-results/auth-register.png', fullPage: true });
});

test('工作首页保留聊天，右侧菜单打开功能且保留草稿', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '今天想做些什么？' })).toBeVisible();
  await page.getByLabel('聊天消息').fill('这段草稿应该保留');
  await page.getByRole('button', { name: '打开工作功能' }).hover();
  await page.getByRole('navigation', { name: '工作功能' }).getByRole('button', { name: '深度研究', exact: true }).click();
  await expect(page.getByRole('region', { name: '工作功能区域' })).toBeVisible();
  await expect(page.getByLabel('聊天消息')).toHaveValue('这段草稿应该保留');
  const chat = (await page.locator('.chat-main').boundingBox())!;
  const feature = (await page.locator('.work-feature').boundingBox())!;
  expect(chat.x + chat.width).toBeLessThanOrEqual(feature.x);
  await page.screenshot({ path: 'test-results/work-split.png', fullPage: true });
  await page.getByRole('button', { name: '收起功能区域' }).click();
  await expect(page.getByLabel('聊天消息')).toHaveValue('这段草稿应该保留');
  await page.getByRole('button', { name: 'Sakuya', exact: false }).click();
  await expect(page.getByRole('heading', { name: '今天想做些什么？' })).toBeVisible();
});

test('普通账号进入聊天首页，可完成聊天、打开工作日历和个人设置', async ({ page, context }) => {
  await context.clearCookies();
  await context.addCookies([{ name: 'sakuya_session', value: session('user'), domain: '127.0.0.1', path: '/' }]);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '今天想做些什么？' })).toBeVisible();
  await page.screenshot({ path: 'test-results/regular-user-home.png', fullPage: true });
  await page.getByLabel('聊天消息').fill('普通账号的独立聊天');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.locator('.markdown')).toContainText('这是演示回复');
  await page.getByRole('button', { name: '打开工作功能' }).hover();
  await page.getByRole('navigation', { name: '工作功能' }).getByRole('button', { name: '日历', exact: true }).click();
  await expect(page.locator('.work-feature .planner-root')).toBeVisible();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByLabel('供应商名称')).toBeVisible();
  await page.getByLabel('供应商名称').fill('我的个人模型');
  await page.getByLabel('API 根地址').fill('http://127.0.0.1:1/v1');
  await page.getByLabel('API Key', { exact: true }).fill('test-only-private');
  await page.getByRole('button', { name: '添加并加载模型' }).click();
  await expect(page.locator('.provider-list')).toContainText('我的个人模型');
  await page.getByLabel('模型 ID', { exact: true }).fill('personal-model');
  await page.getByRole('button', { name: '添加到模型列表' }).click();
  await expect(page.locator('.model-list')).toContainText('personal-model');
});

test('用户提交编辑工单，管理员接受并回复，内部备注不泄露', async ({ page, context, playwright }) => {
  const userSession = session('user');
  await context.clearCookies();
  await context.addCookies([{ name: 'sakuya_session', value: userSession, domain: '127.0.0.1', path: '/' }]);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '今天想做些什么？' })).toBeVisible();
  await expect(page.getByRole('button', { name: '设置', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '工单', exact: true }).click();
  await page.getByRole('button', { name: '新建工单', exact: true }).click();
  await page.getByRole('dialog').getByLabel('标题', { exact: true }).fill('账号工单测试');
  await page.getByRole('dialog').getByLabel('问题描述').fill('请求处理登录问题');
  await page.getByRole('button', { name: '发送工单', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('heading', { name: '账号工单测试', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '接受工单' })).toHaveCount(0);
  await page.getByRole('button', { name: '编辑工单', exact: true }).click();
  await page.getByLabel('问题描述').fill('补充信息：邮件延迟');
  await page.getByRole('button', { name: '保存工单', exact: true }).click();
  await expect(page.locator('.ticket-description')).toContainText('邮件延迟');
  const identifier = page.url().split('/').at(-1)!;
  const admin = await playwright.request.newContext({ baseURL: 'http://127.0.0.1:5179', extraHTTPHeaders: { Cookie: `sakuya_session=${session()}`, 'X-Sakuya-Client': 'workspace' } });
  expect((await admin.patch(`/api/tickets/${identifier}`, { data: { status: 'in_progress', assignee: '管理员' } })).ok()).toBeTruthy();
  await admin.post(`/api/tickets/${identifier}/comments`, { data: { content: '内部排查细节', internal: true } });
  await admin.post(`/api/tickets/${identifier}/comments`, { data: { content: '已收到反馈，正在处理', internal: false } });
  await page.reload();
  await expect(page.locator('.comment-list')).toContainText('已收到反馈，正在处理');
  await expect(page.locator('.comment-list')).not.toContainText('内部排查细节');
  await admin.dispose();
});

test('多供应商列表与模型切换、思考滑条保存到真实队列', async ({ page, request }) => {
  const headers = { 'X-Sakuya-Client': 'workspace' };
  const calls: Record<string, unknown>[] = [];
  const server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/v1/models') { res.end(JSON.stringify({ data: [{ id: 'reasoner-one' }, { id: 'chat-two' }] })); return; }
    let body = ''; for await (const chunk of req) body += chunk;
    calls.push(JSON.parse(body));
    res.setHeader('Content-Type', 'text/event-stream');
    res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: '本机测试模型回复' }, finish_reason: 'stop' }], usage: { total_tokens: 10 } })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  let providerId = '';
  try {
  await page.goto('/#settings');
  await page.getByLabel('供应商名称').fill('E2E 模型供应商');
  await page.getByLabel('API 根地址').fill(`http://127.0.0.1:${address.port}/v1`);
  await page.getByLabel('API Key', { exact: true }).fill('test-only-not-a-real-key');
  await page.getByRole('button', { name: '添加并加载模型' }).click();
  await expect(page.locator('.settings-message')).toContainText('已加载 2 个模型');
  await page.getByLabel('模型 ID', { exact: true }).fill('reasoner-one');
  await page.getByRole('checkbox', { name: /此模型支持/ }).check();
  await page.getByRole('button', { name: '添加到模型列表' }).click();
  await expect(page.locator('.model-list')).toContainText('reasoner-one');
  await page.screenshot({ path: 'test-results/model-settings.png', fullPage: true });
  const settings = await (await request.get('/api/settings')).json();
  const model = settings.models.find((m: { name: string }) => m.name === 'reasoner-one');
  providerId = model.provider_id;
  await page.getByRole('button', { name: 'Sakuya', exact: false }).click();
  await page.getByRole('button', { name: '模型与思考强度' }).click();
  await page.getByRole('button', { name: 'reasoner-one', exact: true }).click();
  await page.screenshot({ path: 'test-results/model-list-popover.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: /reasoner-one.*E2E/ }).click();
  await page.getByRole('slider', { name: '思考强度' }).fill('3');
  await expect(page.locator('.reasoning-heading strong')).toHaveText('高');
  await page.screenshot({ path: 'test-results/model-reasoning-popover.png', fullPage: true, animations: 'disabled' });
  await page.keyboard.press('Escape');
  const response = page.waitForResponse(r => r.url().endsWith('/api/chat') && r.request().method() === 'POST');
  await page.getByLabel('聊天消息').fill('检查模型路由');
  await page.getByRole('button', { name: '发送消息' }).click();
  const queued = await (await response).json();
  expect(queued.run.model_id).toBe(model.id);
  expect(queued.run.reasoning_effort).toBe('high');
  await expect(page.locator('.assistant-content .markdown')).toContainText('本机测试模型回复');
  expect(calls[0].model).toBe('reasoner-one');
  expect(calls[0].stream).toBe(true);
  expect(calls[0].reasoning_effort).toBe('high');
  } finally {
    if (providerId) await request.delete(`/api/settings/providers/${providerId}`, { headers });
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
