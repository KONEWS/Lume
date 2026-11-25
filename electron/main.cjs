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
      const serverModule = import(pathToFileURL(path.join(root, 'server', 'index.mjs')).href);
      const isolated = app.commandLine.hasSwitch('lume-isolated') && app.commandLine.hasSwitch('user-data-dir');
      const options = {
        async confirmRoomInvite(name,hasListeners,signal){
          if(!mainWindow||mainWindow.isDestroyed())return false;
          const choice=await dialog.showMessageBox(mainWindow,{type:'question',title:'播放空间邀请',message:name+' 邀请这台电脑加入',
            detail:'同意后将结束本机主持的空间并切换到对方空间。'+(hasListeners?'当前空间的其他听众会断开连接。':''),
            buttons:['忽略','结束本空间并加入'],defaultId:0,cancelId:0,signal});
          return !signal.aborted&&choice.response===1;
        },
        onInviteError:()=>dialog.showErrorBox('未能加入受邀空间','邀请已失效或对方不可达，请让房主重新邀请。'),
        port: isolated ? 0 : 46321, host: isolated ? '127.0.0.1' : '0.0.0.0',
        dataDir: isolated || app.isPackaged ? path.join(app.getPath('userData'), 'library') : path.join(root, '.lume-data'),
        staticDir: path.join(root, 'dist'),
        resourcesDir: app.isPackaged ? path.join(process.resourcesPath, 'resources') : path.join(root, 'resources')
      };
      mainWindow = new BrowserWindow({
        width: 1440, height: 960, minWidth: 880, minHeight: 640,
        title: '澄音 LUME', frame: false, show: false,
        icon: app.isPackaged ? path.join(process.resourcesPath, 'resources', 'lume.png') : path.join(root, 'resources', 'lume.png'),
        backgroundColor: '#10121e', backgroundMaterial: 'acrylic',
        autoHideMenuBar: true,
        webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true }
      });
      const { startServer } = await serverModule;
      try { service = await startServer(options); }
      catch (e) {
        if (e.code !== 'EADDRINUSE') throw e;
        service = await startServer({ ...options, port: 0 });
      }
      localUrl = `http://127.0.0.1:${service.port}`;
      mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      mainWindow.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== localUrl) event.preventDefault(); });
      mainWindow.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
      // The local document already paints the window's launch colour. Allow
      // it to present as soon as the DOM is ready, including an empty library.
      mainWindow.webContents.once('dom-ready', () => mainWindow?.show());
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
      const fileImports=new Map();
      const checkScanSender=event=>{
        if(!fromApp(event)||event.senderFrame!==mainWindow.webContents.mainFrame||new URL(event.senderFrame.url).origin!==localUrl)throw Error('无效的扫描请求');
      };
      const scanSettingsPath=path.join(service.dataDir,'scan-settings.json');
      const fs=require('node:fs');
      const scanReportPath=path.join(service.dataDir,'scan-last-result.json');
      const validReport=report=>typeof report?.summary==='string' && Array.isArray(report.failures) &&
        report.failures.every(row=>row&&['name','stage','reason'].every(key=>typeof row[key]==='string'));
      ipcMain.on('lume:scan-report',event=>{
        let report=null;
        try{
          checkScanSender(event);
          const saved=JSON.parse(fs.readFileSync(scanReportPath,'utf8'));
          if(validReport(saved))report=saved;
        }catch{}
        event.returnValue=report;
      });
      ipcMain.handle('lume:save-scan-report',(event,report)=>{
        checkScanSender(event);
        if(!validReport(report))throw Error('扫描结果格式无效');
        fs.writeFileSync(scanReportPath+'.tmp',JSON.stringify(report));
        fs.renameSync(scanReportPath+'.tmp',scanReportPath);
      });
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
      require('./transfer-files.cjs')({ipcMain,dialog,mainWindow,checkWindowSender,service});
      const directoryIndex=path.join(service.dataDir,'scan-directories.json');
      let cachedScan={};
      try{cachedScan=JSON.parse(fs.readFileSync(directoryIndex,'utf8'));}catch{}
      ipcMain.handle('lume:pick-folder',async(event,blockOnly,changeRoot)=>{
        checkScanSender(event);
        let root=cachedScan.root;
        if(blockOnly||changeRoot||!root||!fs.existsSync(root)){
          const selected=await dialog.showOpenDialog(mainWindow,{properties:['openDirectory'],title:blockOnly?'选择要屏蔽的文件夹':'选择扫描目录'});
          if(selected.canceled||!selected.filePaths.length)return null;
          root=selected.filePaths[0];
        }
        const absolute=root.split(path.sep).join('/');
        if(blockOnly)return {root:absolute};
        const {DirectoryScan}=require('./directory-scan.cjs');
        folderScan?.controller.abort();
        folderScan=new DirectoryScan(root,root===cachedScan.root?cachedScan.directories:{},service.scanKnown);
        return {root:absolute,name:folderScan.name,token:folderScan.token};
      });
      const getScan=(event,token)=>{
        checkScanSender(event);
        if(!folderScan||folderScan.token!==token)throw Error('请重新选择扫描文件夹');
        return folderScan;
      };
      ipcMain.handle('lume:scan-entries',(event,token,dir,skipShort)=>getScan(event,token).entries(dir,skipShort));
      ipcMain.handle('lume:scan-batch',(event,token,files,sides,body)=>{
        const scan=getScan(event,token);
        return service.importLocal(scan.resolve(files),scan.resolve(sides),body,scan.controller.signal,scan.descriptors);
      });
      ipcMain.handle('lume:scan-complete',async(event,token)=>{
        const scan=getScan(event,token);
        const removed=await service.finishScan(scan);
        scan.controller.signal.throwIfAborted();
        cachedScan={root:scan.root,directories:Object.fromEntries(scan.cache)};
        fs.writeFileSync(directoryIndex+'.tmp',JSON.stringify(cachedScan));
        fs.renameSync(directoryIndex+'.tmp',directoryIndex);
        return removed;
      });
      ipcMain.handle('lume:scan-end',(event,token)=>{
        checkScanSender(event);
        if(folderScan?.token===token){folderScan.controller.abort();folderScan=undefined;}
        fileImports.get(token)?.abort();fileImports.delete(token);
      });
      ipcMain.handle('lume:import', async (event,paths,attachments,body,token) => {
        if(!fromApp(event)||event.senderFrame!==mainWindow.webContents.mainFrame||new URL(event.senderFrame.url).origin!==localUrl)throw Error('无效的导入请求');
        const controller=new AbortController();
        if(token)fileImports.set(token,controller);
        try{return await service.importLocal(paths,attachments,body,controller.signal);}
        finally{if(fileImports.get(token)===controller)fileImports.delete(token);}

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
