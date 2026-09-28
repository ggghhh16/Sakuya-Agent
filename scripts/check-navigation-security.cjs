const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { restrictNavigation } = require('../electron/navigation.cjs');
const contents = new EventEmitter(), opened = [];
const target = 'http://127.0.0.1:8120';
restrictNavigation(contents, target, url => opened.push(url), url => url.startsWith('https:'));
function attempt(type, url, isMainFrame = true) {
  let prevented = false;
  contents.emit(type, { url, isMainFrame, preventDefault() { prevented = true; } }, url, false, isMainFrame);
  return prevented;
}
assert.equal(attempt('will-redirect', 'https://example.com'), true);
assert.equal(attempt('will-redirect', 'file:///private'), true);
assert.equal(attempt('will-redirect', target + '/auth'), false);
assert.equal(attempt('will-redirect', 'https://challenges.cloudflare.com', false), false);
assert.equal(opened.length, 0);
assert.equal(attempt('will-navigate', 'https://example.com'), true);
assert.deepEqual(opened, ['https://example.com']);
console.log('Navigation and redirect security checks passed.');
