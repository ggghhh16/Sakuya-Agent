import { test, expect } from './fixtures';

test('language button is beside the Sakuya title; switching preserves chat drafts and persists', async ({ page }) => {
  await page.goto('/');
  const toggle = page.locator('.language-switch');
  await expect(toggle).toBeVisible();
  await expect(page.locator('.header-left .wordmark ~ .language-menu .language-switch')).toHaveCount(1);
  await page.getByLabel('聊天消息', { exact: true }).fill('我的草稿 stays unchanged');
  await toggle.click(); await page.getByRole('button', {name: 'English', exact: true}).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { name: 'What would you like to work on?' })).toBeVisible();
  await expect(page.getByLabel('Chat message', { exact: true })).toHaveValue('我的草稿 stays unchanged');
  await page.getByRole('button', { name: 'Chat options', exact: true }).click();
  await expect(page.getByRole('button', { name: /Deep Research Find sources/ })).toBeVisible();
  await page.getByRole('button', { name: /Deep Research Find sources/ }).click();
  await expect(page.getByLabel('Chat message', { exact: true })).toHaveAttribute('placeholder', 'What would you like to research?');
  await page.locator('.language-switch').click(); await page.getByRole('button', { name: '简体中文', exact: true }).click();
  await expect(page.getByLabel('聊天消息', { exact: true })).toHaveValue('我的草稿 stays unchanged');
  await page.locator('.language-switch').click(); await page.getByRole('button', { name: 'English', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.screenshot({ path: 'test-results/english-home.png', fullPage: true });
});

test('settings, work navigation, calendar weekdays, and ticket forms switch live', async ({ page }) => {
  await page.goto('/');
  await page.locator('.language-switch').click(); await page.getByRole('button', { name: 'English', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Provider name', { exact: true }).fill('私有供应商');
  await page.locator('.language-switch').click(); await page.getByRole('button', { name: '简体中文', exact: true }).click();
  await expect(page.getByLabel('供应商名称')).toHaveValue('私有供应商');
  await page.locator('.language-switch').click(); await page.getByRole('button', { name: 'English', exact: true }).click();
  await expect(page.getByLabel('Provider name')).toHaveValue('私有供应商');
  await page.screenshot({ path: 'test-results/english-settings.png', fullPage: true });
  await page.getByRole('button', { name: 'Sakuya', exact: false }).click();
  await page.getByRole('button', { name: 'Open work tools', exact: true }).hover();
  await page.getByRole('navigation', { name: 'Work tools', exact: true }).getByRole('button', { name: 'Calendar', exact: true }).click();
  await page.locator('.planning-toggle').click();
  await expect(page.locator('.mini-grid small').first()).toHaveText('Mon');
  await page.getByLabel('Calendar view', { exact: true }).selectOption('month');
  await expect(page.locator('.month-weekdays')).toHaveText('MonTueWedThuFriSatSun');
  await page.locator('.language-switch').click(); await page.getByRole('button', { name: '简体中文', exact: true }).click();
  await expect(page.locator('.month-weekdays')).toContainText('周一');
  await page.locator('.language-switch').click(); await page.getByRole('button', { name: 'English', exact: true }).click();
  await page.screenshot({ path: 'test-results/english-calendar.png', fullPage: true });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Tickets', exact: true }).click();
  await page.getByRole('button', { name: 'New ticket', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'New ticket', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog').getByLabel('Issue description')).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.locator('.language-switch').click(); await page.getByRole('button', { name: '简体中文', exact: true }).click();
  await expect(page.getByRole('heading', { name: '技术支持工单', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^待处理/ })).toBeVisible();
});

test('English login and registration preserve entered fields when switching', async ({ page, context }) => {
  await context.clearCookies();
  await page.goto('/');
  await page.locator('.language-switch').click(); await page.getByRole('button', { name: 'English', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign in to Sakuya' })).toBeVisible();
  await page.getByRole('button', { name: 'Register', exact: true }).first().click();
  await page.getByLabel('Email', { exact: true }).fill('locale@example.com');
  await page.getByLabel('Password', { exact: true }).fill('ExamplePassword');
  await page.locator('.language-switch').click(); await page.getByRole('button', { name: '简体中文', exact: true }).click();
  await expect(page.getByLabel('邮箱', { exact: true })).toHaveValue('locale@example.com');
  await expect(page.getByLabel('密码', { exact: true })).toHaveValue('ExamplePassword');
  await page.locator('.language-switch').click(); await page.getByRole('button', { name: 'English', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Create an account' })).toBeVisible();
  await page.screenshot({ path: 'test-results/english-register.png', fullPage: true });
});

test('language stays synchronized across browser tabs and fits a narrow header', async ({ page, context }) => {
  await page.goto('/');
  const other = await context.newPage();
  await other.goto('/');
  await page.locator('.language-switch').click(); await page.getByRole('button', { name: 'English', exact: true }).click();
  await expect(other.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const settings = await page.getByRole('button', { name: 'Settings', exact: true }).boundingBox();
  const language = await page.locator('.language-switch').boundingBox();
  expect(settings).not.toBeNull(); expect(language).not.toBeNull();
  expect(language!.x + language!.width).toBeLessThan(settings!.x);
  expect(language!.x + language!.width).toBeLessThanOrEqual(390);
  expect(await page.locator('.quiet-header').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/english-mobile.png', fullPage: true });
  await other.close();
});

test.describe('English browser defaults', () => {
  test.use({ locale: 'en-US' });
  test('first visit and invalid saved preferences default to English', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('sakuya-language', 'unsupported'));
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
  });

  test('known backend errors are translated without hiding diagnostics', async ({ page, context }) => {
    await context.clearCookies();
    await page.route('**/api/auth/me', route => route.fulfill({ status: 503, json: { detail: '人机验证服务暂时不可用' } }));
    await page.goto('/');
    await expect(page.getByRole('alert')).toContainText('Human verification is temporarily unavailable');
  });
});
