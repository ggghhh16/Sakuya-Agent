import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { request } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { _electron as electron, expect } from '@playwright/test';

const server = createServer();
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
await new Promise(r => server.close(r));
const folder = mkdtempSync(resolve('.data/security-desktop-'));
const profile = join(folder, 'profile');
mkdirSync(profile);
writeFileSync(join(profile, 'language.json'), JSON.stringify('zh-CN'));
const env = { ...process.env, SAKUYA_TEST: '1', SAKUYA_PORT: String(port),
  SAKUYA_DATA_DIR: join(folder, 'workspace'), SAKUYA_DESKTOP_DATA: profile,
  SAKUYA_ENV_FILE: join(folder, 'absent.env'), TURNSTILE_SITE_KEY: '', TURNSTILE_SECRET_KEY: '',
  NO_PROXY: '127.0.0.1,localhost', NODE_USE_ENV_PROXY: '0' };
for (const key of ['ELECTRON_RUN_AS_NODE', 'SAKUYA_DEV_URL', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY']) delete env[key];
const output = JSON.parse(readFileSync('package.json', 'utf8')).build.directories.output;
const app = await electron.launch({ executablePath: resolve(process.argv[2] || `${output}/win-unpacked/Sakuya Agent.exe`), env, timeout: 30000 });
try {
  const page = await app.firstWindow();
  await expect(page.getByRole('heading', { name: '登录 Sakuya' })).toBeVisible({ timeout: 30000 });
  const policy = await page.evaluate(async () => {
    const r = await fetch('/');
    return { csp: r.headers.get('content-security-policy'), frame: r.headers.get('x-frame-options') };
  });
  assert(policy.csp.includes("script-src 'self' https://challenges.cloudflare.com;"));
  assert.equal(policy.frame, 'DENY');
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  assert.equal(await page.evaluate(() => {
    window.__auditInlineExecuted = false;
    const s = document.createElement('script');
    s.textContent = 'window.__auditInlineExecuted = true';
    document.head.append(s);
    return window.__auditInlineExecuted;
  }), false);
  const base = `http://127.0.0.1:${port}`;
  assert.equal((await page.request.get(base + '/api/workspace')).status(), 401);
  for (let i = 0; i < 31; i++) {
    const r = await page.request.post(base + '/api/auth/browser-check', {
      headers: { 'X-Sakuya-Client': 'workspace', 'X-Forwarded-For': `192.0.2.${i + 1}` }, data: { action: 'login' },
    });
    assert.equal(r.status(), i === 30 ? 429 : 200);
  }
  const status = await new Promise((resolveStatus, reject) => {
    const req = request(base + '/api/auth/login', { method: 'POST', headers: {
      'X-Sakuya-Client': 'workspace', 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked',
    } }, res => { res.resume(); res.on('end', () => resolveStatus(res.statusCode)); });
    req.on('error', reject);
    req.write('x'.repeat(600000)); req.end('y'.repeat(500000));
  });
  assert.equal(status, 413);
  const cookie = execFileSync(resolve('.venv/Scripts/python.exe'), ['-c', `
from app import db, auth
from fastapi import Response
db.init(); auth.init()
with db.connect(shared=True) as con:
    con.execute('INSERT INTO users VALUES (?,?,?,?,?)', ('audit-user', 'audit@example.com', auth.password_hash('SyntheticTestPassword'), 'user', db.now()))
print(auth.issue_session('audit-user', Response()))
`], { env: { ...env, PYTHONPATH: resolve('backend') }, encoding: 'utf8', windowsHide: true }).trim();
  await page.context().addCookies([{ name: 'sakuya_session', value: cookie, url: base, httpOnly: true, sameSite: 'Lax' }]);
  await page.reload();
  await expect(page.getByRole('heading', { name: '今天想做些什么？' })).toBeVisible();
  const response = await page.request.post(base + '/api/chat', { headers: { 'X-Sakuya-Client': 'workspace' }, data: { prompt: '打包安全验证', mode: 'demo' } });
  assert.equal(response.status(), 201);
  const created = await response.json();
  await expect.poll(async () => (await (await page.request.get(base + '/api/runs/' + created.run.id)).json()).status).toBe('completed');
  console.log(JSON.stringify({ packagedDesktop: 'passed', cspBlocksInlineScripts: true, nodeAccess: false,
    unauthenticatedAccess: 401, forgedForwardedHeaders: 429, chunkedUpload: 413,
    regularUserDemoChat: 'completed', externalAuth: 'not exercised; isolated DB session' }));
} finally { await app.close(); }
