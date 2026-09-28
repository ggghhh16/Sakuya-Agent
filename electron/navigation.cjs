function restrictNavigation(contents, target, openExternal, safeExternal) {
  const outside = url => {
    try { return new URL(url).origin !== target; } catch { return true; }
  };
  contents.on('will-navigate', (event, url) => {
    if (!outside(url)) return;
    event.preventDefault();
    if (safeExternal(url, target)) void openExternal(url);
  });
  contents.on('will-redirect', (event, url, _inPlace, isMainFrame) => {
    // A server redirect is not a user request to open another application.
    // Keep challenge subframes working while confining the app's main frame.
    if ((event.isMainFrame ?? isMainFrame) && outside(event.url ?? url)) event.preventDefault();
  });
}
module.exports = { restrictNavigation };
