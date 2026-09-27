import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { createServer as httpServer } from 'node:http';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { _electron as electron } from '@playwright/test';
const require = createRequire(import.meta.url);
const { LocalService, probe } = require('../electron/service.cjs');
delete process.env.HTTP_PROXY; delete process.env.HTTPS_PROXY; delete process.env.ALL_PROXY;
process.env.NO_PROXY = '127.0.0.1,localhost'; process.env.NODE_USE_ENV_PROXY = '0';
await mkdir('.data/startup-tests', { recursive: true });
const folder = await mkdtemp(resolve('.data/startup-tests/run-'));
async function freePort() { const server = createServer(); await new Promise(r => server.listen(0, '127.0.0.1', r)); const port = server.address().port; await new Promise(r => server.close(r)); return port; }
async function until(fn, label) { for (let i = 0; i < 100; i++) { if (await fn()) return; await new Promise(r => setTimeout(r, 150)); } throw new Error(label); }
const port = await freePort();
const options = { port, command: resolve('.build/backend/sakuya-service/sakuya-service.exe'), dataDir: join(folder, 'service'), webDir: resolve('dist') };
const previousPath = process.env.PATH;
process.env.PATH = `${process.env.SystemRoot || 'C:/Windows'}/System32`;
const service = new LocalService(options);
try {
  assert.equal(await probe(port), null);
  await service.start();
  const url = `http://127.0.0.1:${port}`;
  assert((await probe(port)).worker_online);
  assert((await fetch(url).then(r => r.text())).includes('<div id="root">'));
  const created = await fetch(url + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sakuya-Client': 'workspace' }, body: JSON.stringify({ prompt: '独立启动验证', mode: 'demo' }) }).then(r => r.json());
  await until(async () => (await fetch(url + '/api/runs/' + created.run.id).then(r => r.json())).status === 'completed', 'Frozen LangGraph chat failed');
  const reused = new LocalService(options);
  await reused.start(); assert.equal(reused.child, null);
  await reused.stop(); assert((await probe(port)).ok);
  await service.stop(); await until(async () => !await probe(port), 'Owned service did not stop');
  await service.start();
  assert((await fetch(url + '/api/workspace').then(r => r.json())).conversations.some(c => c.id === created.conversation.id));
  console.log('PASS: frozen backend cold start, chat execution, existing service reuse, stop and persistent restart; PATH has no Node/Python');
} finally { await service.stop(); process.env.PATH = previousPath; }

const conflict = httpServer((_req, res) => res.end(JSON.stringify({ ok: true, service: 'another-app' })));
await new Promise(r => conflict.listen(port, '127.0.0.1', r));
try { await assert.rejects(new LocalService(options).start(), /占用/); assert.equal((await probe(port)).service, 'another-app'); }
finally { await new Promise(r => conflict.close(r)); }
console.log('PASS: port conflict does not stop unrelated services');

if (process.argv.includes('--backend-only')) process.exit(0);
const appPort = await freePort();
const environment = { ...process.env, SAKUYA_PORT: String(appPort), SAKUYA_DATA_DIR: join(folder, 'desktop'), SAKUYA_DESKTOP_DATA: join(folder, 'electron'), SAKUYA_TEST: '1', PATH: `${process.env.SystemRoot || 'C:/Windows'}/System32` };
delete environment.ELECTRON_RUN_AS_NODE; delete environment.SAKUYA_DEV_URL;
const desktop = await electron.launch({ executablePath: resolve('release/win-unpacked/Sakuya Agent.exe'), args: [], env: environment, timeout: 30000 });
try {
  let window = await desktop.firstWindow();
  await window.getByRole('heading', { name: '今天有什么想聊的？' }).waitFor({ timeout: 45000 });
  assert((await probe(appPort)).worker_online);
  await desktop.evaluate(({ app, shell }) => {
    global.__webOpened = '';
    shell.openExternal = async url => { global.__webOpened = url; };
    app.emit('second-instance', {}, ['Sakuya Agent.exe', '--web']);
  });
  await until(async () => await desktop.evaluate(() => global.__webOpened) === `http://127.0.0.1:${appPort}`, 'Web launcher did not open local URL');
  await window.close();
  assert((await probe(appPort)).ok, 'Web service must survive desktop window closing');
  await desktop.evaluate(({ app }) => app.emit('second-instance', {}, ['Sakuya Agent.exe']));
  await until(async () => (await desktop.windows()).length === 1, 'Desktop did not reopen');
  window = (await desktop.windows())[0];
  await window.getByRole('heading', { name: '今天有什么想聊的？' }).waitFor();
  console.log('PASS: packaged desktop cold start, web launch routing, background lifetime and reopen; no development server, Node or Python on PATH');
} finally { await desktop.close(); }
await until(async () => !await probe(appPort), 'Desktop exit left an orphan backend');
console.log('PASS: desktop exit stops its owned backend');
