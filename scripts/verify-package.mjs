import { listPackage, extractFile } from '@electron/asar';
import assert from 'node:assert/strict';
import { normalize } from 'node:path';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
const release = process.argv[2] || `${JSON.parse(readFileSync('package.json', 'utf8')).build.directories.output}/win-unpacked`;
const archive = `${release}/resources/app.asar`;
const edition = process.argv[3];
if (edition) {
  assert.equal(JSON.parse(extractFile(archive, 'package.json')).sakuyaEdition, edition);
  assert.equal(JSON.parse(readFileSync(`${release}/resources/backend/edition.json`, 'utf8')).edition, edition);
}
const files = listPackage(archive).map(p => p.replaceAll('\\', '/'));
assert(files.includes('/dist/index.html'), 'Missing built frontend');
assert(files.includes('/electron/main.cjs'), 'Missing Electron entry');
const unexpected = files.filter(p => /^\/(?:\.env|\.data|backend|tests|test-results)(?:\/|$)/.test(p));
assert.equal(unexpected.length, 0, 'Private workspace files must not ship');
const candidates = files.filter(p => /^\/(?:dist\/assets\/.*\.(?:js|css)|electron\/.*\.cjs)$/.test(p));
const suspicious = [];
for (const path of candidates) {
  const content = extractFile(archive, normalize(path.slice(1))).toString('utf8');
  if (/sk-[A-Za-z0-9_-]{24,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|[A-Z]:[\\/]+Users[\\/]+[^\\/\s]+/i.test(content)) suspicious.push(path);
}
assert.deepEqual(suspicious, [], 'Suspicious credentials or private local paths');
assert(existsSync(`${release}/resources/backend/sakuya-service.exe`), 'Missing standalone backend');
assert(existsSync(`${release}/resources/web/index.html`), 'Missing service-hosted web UI');
const runtimeFiles = readdirSync(`${release}/resources/backend`, { recursive: true }).map(p => p.replaceAll('\\', '/'));
const privateFiles = runtimeFiles.filter(p => /(^|\/)(?:\.env(?:\..*)?|provider\.json|google-client\.json|client[_-]secret[^/]*\.json|workspace\.sqlite(?:-.*)?|checkpoints\.sqlite(?:-.*)?|service\.log)$/.test(p));
assert.deepEqual(privateFiles, [], 'Runtime must not include private workspace data');
console.log(JSON.stringify({ packagedFiles: files.length, bundledRuntimeFiles: runtimeFiles.length, frontendPresent: true, standaloneBackend: true, unexpectedWorkspaceFiles: unexpected, suspiciousFiles: suspicious, privateRuntimeFiles: privateFiles }));
