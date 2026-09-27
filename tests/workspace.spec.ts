import { test, expect } from './fixtures';

test('研究任务经人工确认后生成报告，可保存、导出和刷新恢复', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '今天想做些什么？' })).toBeVisible();
  await page.getByRole('button', { name: '打开工作功能' }).hover();
  await page.getByRole('navigation', { name: '工作功能' }).getByRole('button', { name: '深度研究', exact: true }).click();
  await page.getByRole('button', { name: '新建深度研究', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建深度研究' });
  const title = `E2E 检索研究 ${Date.now()}`;
  await dialog.getByLabel('标题', { exact: true }).fill(title);
  await dialog.getByLabel('问题与约束').fill('比较关键词与向量检索，提供实验建议并说明限制。');
  await dialog.getByRole('button', { name: '资料链接与实验选项' }).click();
  await dialog.getByLabel('生成最小验证实验').check();
  await dialog.getByRole('button', { name: '开始任务' }).click();
  await expect(page.getByText('等待批准', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('等待批准', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '查看脚本', exact: true }).click();
  await expect(page.locator('.code-block')).toContainText('print');
  await page.getByRole('button', { name: '拒绝', exact: true }).click();
  await expect(page.locator('.detail-meta .status')).toHaveText('已完成');
  await page.getByRole('button', { name: '报告', exact: true }).click();
  await expect(page.locator('.markdown')).toContainText('演示模式');
  await expect(page.locator('.markdown')).toContainText('用户跳过实验');
  await expect(page.getByRole('button', { name: '存入知识库' })).toHaveCount(0);
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: '导出', exact: true }).click();
  expect((await download).suggestedFilename()).toContain(title);
  await page.reload();
  await expect(page.locator('.detail-meta .status')).toHaveText('已完成');
  expect(errors).toEqual([]);
});

test('工单可以分配、记录处理过程并发起关联诊断', async ({ page }) => {
  await page.goto('/#tickets');
  await page.getByRole('button', { name: '新建工单', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const title = `E2E 升级故障 ${Date.now()}`;
  await dialog.getByLabel('标题', { exact: true }).fill(title);
  await dialog.getByLabel('问题描述', { exact: true }).fill('切换嵌入模型后检索结果为空，需要检查索引和查询配置。');
  await dialog.getByRole('button', { name: '发送工单', exact: true }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await page.getByLabel('工单状态', { exact: true }).selectOption('in_progress');
  await page.getByRole('button', { name: '接受工单' }).click();
  await page.getByLabel('处理记录内容').fill('已记录版本，准备检查模型配置。');
  await page.getByRole('button', { name: '发送回复', exact: true }).click();
  await expect(page.locator('.comment-list')).toContainText('已记录版本');
  await expect(page.getByLabel('工单状态', { exact: true })).toHaveValue('in_progress');
});

test('项目和知识库入口已移除，主题可持久化', async ({ page }) => {
  await page.goto('/#work');
  await page.getByRole('button', { name: '打开工作功能' }).hover();
  await expect(page.getByRole('button', { name: '项目', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '知识库', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '打开聊天记录' }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '切换主题', exact: true }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: '打开聊天记录' }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '切换主题', exact: true }).click();
});

test('窄屏导航和工单看板正常工作', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '今天想做些什么？' })).toBeVisible();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '工单', exact: true }).click();
  await page.getByRole('button', { name: '看板视图' }).click();
  await expect(page.locator('.kanban')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
