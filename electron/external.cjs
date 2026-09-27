// Allow only the local verification page in addition to ordinary HTTPS links.
function safeExternal(value, target) {
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    return url.protocol === 'https:' || (url.origin === target && url.protocol === 'http:'
      && url.pathname === '/human-check' && !url.search && /^#id=[A-Za-z0-9_-]{32}$/.test(url.hash));
  } catch { return false; }
}
module.exports = { safeExternal };
