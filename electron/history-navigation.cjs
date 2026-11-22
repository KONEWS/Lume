module.exports = function bindHistoryNavigation(window) {
  window.on('app-command', (event, command) => {
    const history = window.webContents.navigationHistory;
    if (command === 'browser-backward') {
      event.preventDefault();
      if (history.canGoBack()) history.goBack();
    } else if (command === 'browser-forward') {
      event.preventDefault();
      if (history.canGoForward()) history.goForward();
    }
  });
};
