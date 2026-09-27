import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';

// Inspect the staged snapshot rather than just the working tree. Never print secret values.
const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', windowsHide: true }).split('\0').filter(Boolean);
assert(files.length > 0, 'Stage the source files before scanning');
const violations = [];
const blocked = /(^|\/)(?:\.data|\.venv|\.tools|\.build|node_modules|dist|release[^/]*|test-results|playwright-report|__pycache__)(\/|$)|(?:^|\/)\.env(?:$|\.(?!example$))|\.(?:sqlite(?:-\w+)?|db|lnk|pfx|p12|key)$/i;
const patterns = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['API token', /(?:sk-[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/],
  ['personal home path', /[A-Z]:[\\/]+Users[\\/]+(?!Public\b|Default\b)[^\\/\s"']+/i],
];
const envSecrets = existsSync('.env') ? readFileSync('.env', 'utf8').split(/\r?\n/).flatMap(line => {
  const match = line.match(/^\s*([A-Z_]*(?:KEY|TOKEN|SECRET|PASSWORD))\s*=\s*(.*?)\s*$/);
  const value = match?.[2].replace(/^['"]|['"]$/g, '');
  return value && value.length >= 8 ? [value] : [];
}) : [];
for (const file of files) {
  if (blocked.test(file)) violations.push({ file, reason: 'private or generated path' });
  if (statSync(file).size > 10 * 1024 * 1024) violations.push({ file, reason: 'unexpected large file' });
  const content = execFileSync('git', ['show', `:${file}`], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, windowsHide: true });
  for (const [reason, pattern] of patterns) if (pattern.test(content)) violations.push({ file, reason });
  if (envSecrets.some(secret => content.includes(secret))) violations.push({ file, reason: 'matches a local environment credential' });
}
console.log(JSON.stringify({ files: files.length, violations }, null, 2));
assert.equal(violations.length, 0, 'Repository scan failed');
