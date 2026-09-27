import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
process.env.NO_PROXY = '127.0.0.1,localhost';
// Tests only contact loopback addresses.
delete process.env.HTTP_PROXY;
delete process.env.HTTPS_PROXY;
delete process.env.ALL_PROXY;
process.env.NODE_USE_ENV_PROXY = '0';
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
export default defineConfig({
  testDir: './tests',
  timeout: 45000,
  expect: { timeout: 12000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { locale: 'zh-CN', baseURL: 'http://127.0.0.1:5179', viewport: { width: 1440, height: 1000 }, screenshot: 'only-on-failure', trace: 'retain-on-failure', launchOptions: existsSync(chrome) ? { executablePath: chrome } : {} },
  webServer: process.env.SAKUYA_EXTERNAL_TEST_SERVER ? undefined : { command: 'node scripts/dev.mjs', url: 'http://127.0.0.1:5179/api/health', reuseExistingServer: false, timeout: 45000, env: { SAKUYA_PORT: '8127', VITE_PORT: '5179', SAKUYA_DATA_DIR: `${process.cwd()}/.data/e2e-accounts`, SAKUYA_ENV_FILE: `${process.cwd()}/.data/e2e-accounts/absent.env` } },
});
