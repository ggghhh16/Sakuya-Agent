import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const python = resolve(root, process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
if (!existsSync(python) || !existsSync(resolve(root, 'node_modules/vite'))) {
  console.error('请先运行 .\\scripts\\setup.ps1 安装项目依赖。'); process.exit(1);
}
const children = [];
const apiPort = process.env.SAKUYA_PORT || '8120';
const webPort = process.env.VITE_PORT || '5173';
let stopping = false;
function launch(command, args, cwd = root, extraEnv = {}) {
  const environment = { ...process.env, PYTHONUTF8: '1', ...extraEnv };
  if (extraEnv.SAKUYA_DEV_URL) delete environment.ELECTRON_RUN_AS_NODE;
  const child = spawn(command, args, { cwd, stdio: 'inherit', windowsHide: true, env: environment });
  children.push(child);
  child.on('error', e => { console.error(e.message); stop(1); });
  child.on('exit', code => { if (!stopping && code !== 0) stop(code || 1); });
  return child;
}
function stop(code = 0) {
  if (stopping) return; stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill();
  setTimeout(() => process.exit(code), 600).unref();
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop());
launch(python, ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', apiPort, '--no-proxy-headers', '--no-access-log'], resolve(root, 'backend'));
launch(python, ['-m', 'app.worker'], resolve(root, 'backend'));
launch(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1']);
if (process.argv.includes('--desktop')) {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://127.0.0.1:${webPort}`); if (r.ok) break; } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  launch(process.execPath, ['node_modules/electron/cli.js', '.'], root, { SAKUYA_DEV_URL: 'http://127.0.0.1:5173' });
}
console.log(`\nSakuya workspace: http://127.0.0.1:${webPort}\nAPI: http://127.0.0.1:${apiPort}/docs\n`);
