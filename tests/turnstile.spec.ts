import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user: null } }));
  await page.route('**/api/auth/config', route => route.fulfill({ json: { site_key: 'test-site-key', registration_ready: true } }));
});

test('验证码显示域名错误码，重新验证成功后清除错误', async ({ page }) => {
  await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js*', route => route.fulfill({ contentType: 'application/javascript', body: `
    let attempts = 0;
    window.turnstile = {
      render(element, options) {
        const count = ++attempts;
        setTimeout(() => count === 1 ? options['error-callback']('110200') : options.callback('test-only-token'), 20);
        return String(count);
      },
      remove() {}
    };
  ` }));
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('110200');
  await expect(page.getByRole('alert')).toContainText('127.0.0.1 未获授权');
  await page.getByRole('button', { name: '重新验证' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('button[type=submit]')).toBeEnabled();
});

test('首次脚本加载失败后可以重新下载脚本', async ({ page }) => {
  let requests = 0;
  await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js*', route => {
    if (++requests === 1) return route.abort('connectionfailed');
    return route.fulfill({ contentType: 'application/javascript', body: `window.turnstile = { render(element, options) { setTimeout(() => options.callback('test-only-token'), 10); return 'retry'; }, remove() {} };` });
  });
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('无法加载人机验证脚本');
  await page.getByRole('button', { name: '重新验证' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('button[type=submit]')).toBeEnabled();
  expect(requests).toBe(2);
});
