import { get } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

// Native packaged Electron smoke test via Chromium CDP. External authentication
// is not mocked in production; a session is inserted into this isolated test DB.
await mkdir('test-results', { recursive: true });
const environment = { ...process.env, SAKUYA_TEST: '1', SAKUYA_PORT: '8130',
  SAKUYA_DATA_DIR: resolve('.data/desktop-accounts'), SAKUYA_DESKTOP_DATA: resolve(`.data/desktop-profile-accounts-${Date.now()}`),
  TURNSTILE_SITE_KEY: 'test-site-key', NO_PROXY: '127.0.0.1,localhost', NODE_USE_ENV_PROXY: '0' };
for (const key of ['ELECTRON_RUN_AS_NODE', 'SAKUYA_DEV_URL', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY']) delete environment[key];
const launchProcess = () => spawn(resolve('release-user-workspace/win-unpacked/Sakuya Agent.exe'), ['--remote-debugging-port=9237', '--remote-debugging-address=127.0.0.1'], { env: environment, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
let processHandle = launchProcess();

let ws, seq = 0;
const pending = new Map();
function localGet(url) { return new Promise((resolve, reject) => { const request = get(url, response => { let text = ''; response.on('data', chunk => text += chunk); response.on('end', () => { try { resolve({ status: response.statusCode, data: JSON.parse(text) }); } catch (e) { reject(e); } }); }); request.on('error', reject); request.setTimeout(2500, () => { request.destroy(); reject(new Error('Local HTTP timeout')); }); }); }
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, timeout = 25000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const result = await fn(); if (result) return result; await pause(150); }
  throw new Error('Native desktop check timed out');
}
function rpc(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 15000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) { return (await rpc('Runtime.evaluate', { expression, returnByValue: true })).result.value; }
async function attach() {
  const target = await until(async () => { try { return (await localGet('http://127.0.0.1:9237/json/list')).data.find(t => t.type === 'page'); } catch { return null; } });
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  ws.addEventListener('message', event => { const message = JSON.parse(event.data); const p = pending.get(message.id); if (p) { pending.delete(message.id); if (message.error) p.reject(new Error(message.error.message)); else p.resolve(message.result); } });
  await rpc('Runtime.enable');
}
async function closeDesktop() {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ id: ++seq, method: 'Browser.close' }));
  await until(() => processHandle.exitCode !== null || processHandle.signalCode !== null, 12000);
  ws?.close();
}
try {
  await attach();
  await until(() => evaluate("document.body.innerText.includes('登录 Sakuya')"));
  const health = (await localGet('http://127.0.0.1:8130/api/health')).data;
  assert.equal(health.protocol, 4);
  await until(() => evaluate("!!document.querySelector('script[data-turnstile]')"));
  assert.equal(await evaluate("document.body.innerText.includes('在浏览器中验证')"), false);
  assert.equal(await evaluate("window.sakuyaDesktop?.embedded"), true);
  assert.equal(await evaluate("/Electron\\//.test(navigator.userAgent)"), false);
  assert.equal(await evaluate("new URL(location.href).searchParams.has('sakuya_launch')"), true);
  assert.equal((await localGet('http://127.0.0.1:8130/api/auth/me')).data.user, null);
  const htmlPolicy = (await rpc('Runtime.evaluate', { expression: "fetch('/').then(response => response.headers.get('cache-control'))", awaitPromise: true, returnByValue: true })).result.value;
  assert.equal(htmlPolicy, 'no-store');
  assert.equal((await localGet('http://127.0.0.1:8130/api/workspace')).status, 401);
  const makeToken = (remember) => execFileSync(resolve('.venv/Scripts/python.exe'), ['-c', `
from app import db, auth
from fastapi import Response
db.init(); auth.init()
identifier = db.uid('desktop_test')
with db.connect() as con:
    con.execute('INSERT INTO users VALUES (?,?,?,?,?)', (identifier, identifier + '@example.com', auth.password_hash('DesktopTestPassword'), 'user', db.now()))
print(auth.issue_session(identifier, Response(), remember=${remember ? 'True' : 'False'}))
`], { env: { ...environment, PYTHONPATH: resolve('backend'), PYTHONUTF8: '1' }, encoding: 'utf8', windowsHide: true }).trim();
  const token = makeToken(true);
  await rpc('Network.setCookie', { name: 'sakuya_session', value: token, url: 'http://127.0.0.1:8130', httpOnly: true, sameSite: 'Lax', expires: Date.now() / 1000 + 30 * 86400 });
  await rpc('Page.reload');
  await until(() => evaluate("document.body.innerText.includes('今天有什么想聊的？')"));
  await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent === '工作').click()");
  await until(() => evaluate("document.body.innerText.includes('今天想做些什么？')"));
  await evaluate("document.querySelector('[aria-label=打开工作功能]').click()");
  await evaluate("[...document.querySelectorAll('.work-edge-menu button')].find(b => b.textContent === '日历').click()");
  await until(() => evaluate("!!document.querySelector('.work-feature .planner-root')"));
  await evaluate("document.activeElement.blur()");
  await pause(250);
  assert.equal(await evaluate("typeof window.require"), 'undefined');
  assert.equal(await evaluate("typeof window.process"), 'undefined');
  await closeDesktop();
  processHandle = launchProcess();
  await attach();
  await until(() => evaluate("document.body.innerText.includes('今天有什么想聊的？')"));
  // Sign-out must revoke the remembered session, not just hide the UI.
  await rpc('Runtime.evaluate', { expression: "fetch('/api/auth/logout', { method: 'POST', headers: { 'X-Sakuya-Client': 'workspace' } }).then(r => r.json())", awaitPromise: true, returnByValue: true });
  await rpc('Page.reload');
  await until(() => evaluate("document.body.innerText.includes('登录 Sakuya')"));
  // A non-remembered cookie must disappear after a full application restart.
  await rpc('Network.setCookie', { name: 'sakuya_session', value: makeToken(false), url: 'http://127.0.0.1:8130', httpOnly: true, sameSite: 'Lax' });
  await rpc('Page.reload');
  await until(() => evaluate("document.body.innerText.includes('今天有什么想聊的？')"));
  await closeDesktop();
  processHandle = launchProcess();
  await attach();
  await until(() => evaluate("document.body.innerText.includes('登录 Sakuya')"));
  console.log(JSON.stringify({ packagedDesktop: 'passed', protocol: health.protocol, anonymousWorkspace: 401, rendererNodeAccess: false, regularUserHome: true, rememberedAfterRestart: true, temporarySessionClearedAfterRestart: true, externalVerificationButton: false, embeddedTurnstile: true, htmlCache: htmlPolicy, externalAuth: 'not exercised; isolated test DB session used' }));
} finally {
  if (ws?.readyState === WebSocket.OPEN) {
    try { await closeDesktop(); } catch {}
  }
  await pause(1000);
  if (processHandle.exitCode === null) processHandle.kill();
}
