import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { LocalService } = require('../electron/service.cjs');
const server = createServer((_req, res) => res.end(JSON.stringify({ service: 'sakuya-agent', protocol: 8, worker_online: true })));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  const service = new LocalService({ port: server.address().port });
  await assert.rejects(service.start(), /占用/);
  assert.equal(service.child, null);
  console.log('PASS: a forged health response cannot make Electron reuse an unowned backend');
} finally { await new Promise(resolve => server.close(resolve)); }
