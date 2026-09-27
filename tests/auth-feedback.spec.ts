import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user: null } }));
  await page.route('**/api/auth/config', route => route.fulfill({ json: { site_key: 'test', registration_ready: true } }));
  await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js*', route => route.fulfill({ contentType: 'application/javascript', body: `window.turnstile = { render(el, options) { setTimeout(() => options.callback('test-token'), 20); return 'test'; }, remove() {} };` }));
});

test('注册成功使用绿色提示框，随后登录失败切换为错误样式', async ({ page }) => {
  await page.route('**/api/auth/register', route => route.fulfill({ status: 201, json: { ok: true } }));
  await page.route('**/api/auth/login', route => route.fulfill({ status: 401, json: { detail: '邮箱或密码不正确' } }));
  await page.goto('/');
  await page.getByRole('button', { name: '注册', exact: true }).first().click();
  await page.getByLabel('邮箱', { exact: true }).fill('test@example.com');
  await page.getByLabel('密码', { exact: true }).fill('GoodPassword');
  await page.getByLabel('确认密码', { exact: true }).fill('GoodPassword');
  await page.locator('input[autocomplete=one-time-code]').fill('123456');
  await page.locator('button[type=submit]').click();
  const status = page.getByRole('status');
  await expect(status).toHaveText('注册成功，请登录。');
  await expect(status).toHaveClass('auth-success');
  await expect(status).toHaveCSS('background-color', 'rgb(21, 61, 44)');
  await page.screenshot({ path: 'test-results/register-success-green.png', fullPage: true });
  await page.getByLabel('密码', { exact: true }).fill('WrongPassword');
  await page.locator('button[type=submit]').click();
  await expect(status).toHaveClass('form-error');
  await expect(status).toHaveText('邮箱或密码不正确');
});

test('记住下次登录随登录提交且不把密码写入本地存储', async ({ page }) => {
  const requests: Record<string, unknown>[] = [];
  await page.route('**/api/auth/login', route => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ status: 401, json: { detail: '测试拒绝登录' } });
  });
  await page.goto('/');
  await page.getByLabel('邮箱', { exact: true }).fill('test@example.com');
  await page.getByLabel('密码', { exact: true }).fill('GoodPassword');
  await page.locator('button[type=submit]').click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0].remember).toBe(false);
  await page.getByRole('checkbox', { name: /记住下次登录/ }).check();
  await page.locator('button[type=submit]').click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].remember).toBe(true);
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(storage).not.toContain('GoodPassword');
});
