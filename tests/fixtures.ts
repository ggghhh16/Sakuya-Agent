import { test as base, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

// Test-only DB sessions. No test login or CAPTCHA bypass exists in production.
export function session(role: 'user' | 'admin' = 'admin') {
  return execFileSync(resolve('.venv/Scripts/python.exe'), ['-c', `
from app import db, auth
from fastapi import Response
db.init(); auth.init()
identifier = db.uid('e2e')
with db.connect() as con:
    con.execute('INSERT INTO users VALUES (?,?,?,?,?)', (identifier, identifier + '@example.com', auth.password_hash('E2ePassword'), '${role}', db.now()))
print(auth.issue_session(identifier, Response()))
`], { cwd: process.cwd(), env: { ...process.env, PYTHONPATH: resolve('backend'), PYTHONUTF8: '1', SAKUYA_DATA_DIR: resolve('.data/e2e-accounts') }, windowsHide: true, encoding: 'utf8' }).trim();
}

export const test = base.extend({
  storageState: async ({}, use) => { await use({ cookies: [{ name: 'sakuya_session', value: session(), domain: '127.0.0.1', path: '/', expires: -1, httpOnly: true, secure: false, sameSite: 'Lax' }], origins: [] }); },
});
export { expect };
