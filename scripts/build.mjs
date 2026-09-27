import { spawnSync } from 'node:child_process';
for (const [file, args] of [['node_modules/typescript/bin/tsc', ['-b']], ['node_modules/vite/bin/vite.js', ['build']]]) {
  const result = spawnSync(process.execPath, [file, ...args], { stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) process.exit(result.status || 1);
}
