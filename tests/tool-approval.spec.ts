import { test, expect } from './fixtures';

for (const [label, decision] of [['批准执行', 'approve'], ['拒绝', 'skip']]) {
  test(`聊天工具确认按钮提交 ${decision}，参数可见`, async ({ page, request }) => {
    const workspace = await (await request.get('/api/workspace')).json();
    const timestamp = new Date().toISOString();
    const c = { id: 'test-review-conversation', title: '审批界面', position: -1, created_at: timestamp, updated_at: timestamp };
    const run = { id: 'test-review-run', kind: 'chat', conversation_id: c.id, prompt: '创建任务', status: 'waiting', mode: 'live', created_at: timestamp, report: '', approval: { kind: 'tool', name: 'planner_create_entry', arguments: { title: '待批准任务', list_id: 'todo_inbox' }, message: '请确认是否执行此工具操作' } };
    await page.route('**/api/workspace', route => route.fulfill({ json: { ...workspace, conversations: [c], chats: [run] } }));
    let received = '';
    await page.route('**/api/runs/test-review-run/resume', route => {
      received = route.request().postDataJSON().decision;
      return route.fulfill({ json: { ...run, status: 'queued', approval: null } });
    });
    await page.goto('/#chat/' + c.id);
    await expect(page.locator('.tool-approval')).toContainText('待批准任务');
    await expect(page.getByRole('button', { name: '发送消息', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: label, exact: true }).click();
    await expect.poll(() => received).toBe(decision);
  });
}
