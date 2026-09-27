function chromiumUserAgent(value) {
  // Keep the installed Chromium/OS versions, and use the same UA for every frame/request.
  return value.replace(/\sElectron\/[^\s]+/g, '').replace(/\s(?:sakuya-agent|SakuyaAgent)\/[^\s]+/gi, '');
}

function allowChallengeStorage(permission, requestingUrl, topUrl, workspaceOrigin) {
  if (permission !== 'storage-access' && permission !== 'top-level-storage-access') return false;
  try {
    return new URL(topUrl).origin === workspaceOrigin
      && new URL(requestingUrl).origin === 'https://challenges.cloudflare.com';
  } catch { return false; }
}
module.exports = { chromiumUserAgent, allowChallengeStorage };
