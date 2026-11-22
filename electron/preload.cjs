const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('lumeDesktop', {
  platform: 'Windows',
  readScanSettings: ()=>ipcRenderer.sendSync('lume:scan-settings'),
  saveScanSettings: settings=>ipcRenderer.send('lume:save-scan-settings',settings),
  pickScanFolder: blockOnly=>ipcRenderer.invoke('lume:pick-folder',blockOnly),
  scanEntries: (token,dir)=>ipcRenderer.invoke('lume:scan-entries',token,dir),
  scanBatch: (token,files,sides,body)=>ipcRenderer.invoke('lume:scan-batch',token,files,sides,body),
  endScan: token=>ipcRenderer.invoke('lume:scan-end',token),
  readLyrics: id => ipcRenderer.invoke('lume:lyrics', id),
  importFiles: (files, attachments, body) => {
    if(!Array.isArray(files)||!Array.isArray(attachments))throw Error('无效的文件选择');
    const paths=Array.from(files,file=>webUtils.getPathForFile(file));
    const sides=Array.from(attachments,file=>webUtils.getPathForFile(file));
    if([...paths,...sides].some(path=>!path))return null;
    return ipcRenderer.invoke('lume:import',paths,sides,body);
  },
  joinRoom: id=>ipcRenderer.invoke('lume:join-room',id),
  minimize: () => ipcRenderer.send('lume:minimize'),
  maximize: () => ipcRenderer.send('lume:maximize'),
  getWindowState: () => ipcRenderer.invoke('lume:window-state'),
  getSystemFonts: () => ipcRenderer.invoke('lume:system-fonts'),
  onWindowStateChange: listener => {
    const changed = (_event,value) => listener(value);
    ipcRenderer.on('lume:window-state-changed',changed);
    return () => ipcRenderer.removeListener('lume:window-state-changed',changed);
  },
  getFullscreen: () => ipcRenderer.invoke('lume:fullscreen-state'),
  setFullscreen: value => ipcRenderer.invoke('lume:set-fullscreen',value),
  onFullscreenChange: listener => {
    const changed = (_event,value) => listener(value);
    ipcRenderer.on('lume:fullscreen-changed',changed);
    return () => ipcRenderer.removeListener('lume:fullscreen-changed',changed);
  },
  getAlwaysOnTop: () => ipcRenderer.invoke('lume:always-on-top-state'),
  setAlwaysOnTop: value => ipcRenderer.invoke('lume:set-always-on-top',value),
  onAlwaysOnTopChange: listener => {
    const changed = (_event,value) => listener(value);
    ipcRenderer.on('lume:always-on-top-changed',changed);
    return () => ipcRenderer.removeListener('lume:always-on-top-changed',changed);
  },
  close: () => ipcRenderer.send('lume:close'),
  openWeb: () => ipcRenderer.send('lume:open-web')
});
