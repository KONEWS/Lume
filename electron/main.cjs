const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFile } = require('node:child_process');
let mainWindow, service, localUrl;
let quitting = false;
let systemFontsPromise;
function readSystemFonts() {
  if(!systemFontsPromise)systemFontsPromise=new Promise((resolve,reject)=>{
    if(process.platform!=='win32'){reject(Error('当前系统暂不支持读取字体列表'));return;}
    const command="[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false); Add-Type -AssemblyName System.Drawing; @([System.Drawing.FontFamily]::Families | ForEach-Object { $_.Name } | Sort-Object -Unique) | ConvertTo-Json -Compress";
    execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,timeout:10000,maxBuffer:1024*1024,encoding:'utf8'},(error,stdout)=>{
      if(error){reject(Error('无法读取系统字体列表'));return;}
      try {
        const parsed=JSON.parse(stdout.replace(/^\uFEFF/,''));
        const fonts=[...new Set((Array.isArray(parsed)?parsed:[parsed]).filter(name=>typeof name==='string' && name.trim()).map(name=>name.trim()))];
        if(!fonts.length)throw Error();
        resolve(fonts);
      } catch {reject(Error('系统未返回可用的字体列表'));}
    });
  });
  return systemFontsPromise;
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });
  app.whenReady().then(async () => {
    app.setAppUserModelId('local.lume.player');
    const root = app.getAppPath();
    try {
      const { startServer } = await import(pathToFileURL(path.join(root, 'server', 'index.mjs')).href);
      const options = {
        port: 46321, host: '0.0.0.0',
        dataDir: app.isPackaged ? path.join(app.getPath('userData'), 'library') : path.join(root, '.lume-data'),
        staticDir: path.join(root, 'dist'),
        resourcesDir: app.isPackaged ? path.join(process.resourcesPath, 'resources') : path.join(root, 'resources')
      };
      try { service = await startServer(options); }
      catch (e) {
        if (e.code !== 'EADDRINUSE') throw e;
        service = await startServer({ ...options, port: 0 });
      }
      localUrl = `http://127.0.0.1:${service.port}`;
      mainWindow = new BrowserWindow({
        width: 1440, height: 960, minWidth: 880, minHeight: 640,
        title: '澄音 LUME', frame: false, show: false,
        icon: app.isPackaged ? path.join(process.resourcesPath, 'resources', 'lume.png') : path.join(root, 'resources', 'lume.png'),
        backgroundColor: '#10121e', backgroundMaterial: 'acrylic',
        autoHideMenuBar: true,
        webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true }
      });
      mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      mainWindow.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== localUrl) event.preventDefault(); });
      mainWindow.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
      mainWindow.once('ready-to-show', () => mainWindow.show());
      mainWindow.on('closed', () => { mainWindow = null; });
      const fromApp = event => mainWindow && event.sender === mainWindow.webContents;
      const checkWindowSender = event => {
        if(!fromApp(event) || event.senderFrame!==mainWindow.webContents.mainFrame || new URL(event.senderFrame.url).origin!==localUrl) throw Error('无效的窗口请求');
      };
      const windowState = () => ({fullscreen:mainWindow.isFullScreen(),maximized:mainWindow.isMaximized(),alwaysOnTop:mainWindow.isAlwaysOnTop()});
      const windowStateChanged = () => {
        if(mainWindow && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send('lume:window-state-changed',windowState());
      };
      const fullscreenChanged = () => {
        if(mainWindow && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send('lume:fullscreen-changed',mainWindow.isFullScreen());
        windowStateChanged();
      };
      mainWindow.on('enter-full-screen',fullscreenChanged);
      mainWindow.on('leave-full-screen',fullscreenChanged);
      require('./history-navigation.cjs')(mainWindow);
      mainWindow.on('maximize',windowStateChanged);
      mainWindow.on('unmaximize',windowStateChanged);
      mainWindow.webContents.on('before-input-event',(event,input) => {
        if(input.key==='F11' && input.type==='keyDown' && !input.isAutoRepeat && !input.control && !input.alt && !input.meta) {
          event.preventDefault();
          mainWindow.setFullScreen(!mainWindow.isFullScreen());
        }
      });
      ipcMain.handle('lume:fullscreen-state',event => {checkWindowSender(event);return mainWindow.isFullScreen();});
      ipcMain.handle('lume:window-state',event => {checkWindowSender(event);return windowState();});
      ipcMain.handle('lume:system-fonts',event => {checkWindowSender(event);return readSystemFonts();});
      ipcMain.handle('lume:set-fullscreen',(event,value) => {
        checkWindowSender(event);
        if(typeof value!=='boolean') throw Error('无效的全屏状态');
        mainWindow.setFullScreen(value);
      });
      mainWindow.on('always-on-top-changed',(_event,value) => {
        if(mainWindow && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send('lume:always-on-top-changed',value);
        windowStateChanged();
      });
      ipcMain.handle('lume:always-on-top-state',event => {checkWindowSender(event);return mainWindow.isAlwaysOnTop();});
      ipcMain.handle('lume:set-always-on-top',(event,value) => {
        checkWindowSender(event);
        if(typeof value!=='boolean') throw Error('无效的置顶状态');
        mainWindow.setAlwaysOnTop(value);
      });
      ipcMain.on('lume:minimize', e => { if (fromApp(e)) mainWindow.minimize(); });
      ipcMain.on('lume:maximize', e => { if (fromApp(e)) mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize(); });
      ipcMain.on('lume:close', e => { if (fromApp(e)) mainWindow.close(); });
      ipcMain.on('lume:open-web', e => { if (fromApp(e)) void shell.openExternal(localUrl); });
      ipcMain.handle('lume:lyrics', (event,id) => {
        if(!fromApp(event) || event.senderFrame!==mainWindow.webContents.mainFrame || new URL(event.senderFrame.url).origin!==localUrl) throw Error('无效的歌词请求');
        return service.readLyrics(id);
      });
      let folderScan;
      const checkScanSender=event=>{
        if(!fromApp(event)||event.senderFrame!==mainWindow.webContents.mainFrame||new URL(event.senderFrame.url).origin!==localUrl)throw Error('无效的扫描请求');
      };
      const scanSettingsPath=path.join(service.dataDir,'scan-settings.json');
      const fs=require('node:fs');
      ipcMain.on('lume:scan-settings',(event)=>{
        let settings=null;
        try{checkScanSender(event);settings=JSON.parse(fs.readFileSync(scanSettingsPath,'utf8'));}catch{}
        event.returnValue=settings;
      });
      ipcMain.on('lume:save-scan-settings',(event,settings)=>{
        try{
          checkScanSender(event);
          if(typeof settings?.skipShort!=='boolean'||![settings.history,settings.blocked].every(list=>Array.isArray(list)&&list.every(item=>typeof item==='string')))return;
          fs.writeFileSync(scanSettingsPath+'.tmp',JSON.stringify(settings));
          fs.renameSync(scanSettingsPath+'.tmp',scanSettingsPath);
        }catch(error){console.warn('扫描设置保存失败',error.message);}
      });
      ipcMain.handle('lume:pick-folder',async(event,blockOnly)=>{
        checkScanSender(event);
        const selected=await dialog.showOpenDialog(mainWindow,{properties:['openDirectory'],title:blockOnly?'选择要屏蔽的文件夹':'扫描音乐'});
        if(selected.canceled||!selected.filePaths.length)return null;
        const root=selected.filePaths[0], absolute=root.split(path.sep).join('/');
        if(blockOnly)return {root:absolute};
        const {DirectoryScan}=require('./directory-scan.cjs');
        folderScan=new DirectoryScan(root);
        return {root:absolute,name:folderScan.name,token:folderScan.token};
      });
      const getScan=(event,token)=>{
        checkScanSender(event);
        if(!folderScan||folderScan.token!==token)throw Error('请重新选择扫描文件夹');
        return folderScan;
      };
      ipcMain.handle('lume:scan-entries',(event,token,dir)=>getScan(event,token).entries(dir));
      ipcMain.handle('lume:scan-batch',(event,token,files,sides,body)=>{
        const scan=getScan(event,token);
        return service.importLocal(scan.resolve(files),scan.resolve(sides),body);
      });
      ipcMain.handle('lume:scan-end',(event,token)=>{getScan(event,token);folderScan=undefined;});
      ipcMain.handle('lume:import', (event,paths,attachments,body) => {
        if(!fromApp(event)||event.senderFrame!==mainWindow.webContents.mainFrame||new URL(event.senderFrame.url).origin!==localUrl)throw Error('无效的导入请求');
        return service.importLocal(paths,attachments,body);
      });
      ipcMain.handle('lume:join-room', async (event,id) => {
        checkWindowSender(event);
        const url=service.roomUrl(id);
        if(!url)throw Error('空间已离线，请重新搜索');
        await service.joinRoom(url);
      });
      await mainWindow.loadURL(localUrl);
    } catch (error) {
      dialog.showErrorBox('澄音暂时无法启动', `${error.message}\n请确认程序文件完整，或尝试重新启动。`);
      app.quit();
    }
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', event => {
    if (service && !quitting) {
      event.preventDefault(); quitting = true;
      const closing = service; service = null;
      closing.close().catch(console.error).finally(() => app.quit());
    }
  });
}
