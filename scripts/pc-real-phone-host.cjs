// Dedicated invisible test host. Never import electron/main.cjs: that entry shows a window.
const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');

const argument=process.argv.find(value=>value.startsWith('--lume-real-phone-config='));
if(!argument)throw Error('Missing isolated real-phone test configuration');
const config=JSON.parse(fs.readFileSync(argument.slice('--lume-real-phone-config='.length),'utf8'));
const root=path.resolve(__dirname,'..');
const expected=new URL(config.phoneOrigin);
if(expected.protocol!=='http:'||expected.pathname!=='/'||expected.search||expected.hash||expected.username||expected.password)throw Error('Invalid phone origin');
app.setPath('userData',config.userData);
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

const originalFetch=globalThis.fetch;
let phoneCookie='',window,service,closing=false;
const violations=[],calls=[];
globalThis.fetch=async(...args)=>{
  const response=await originalFetch(...args);
  const target=new URL(typeof args[0]==='string'?args[0]:args[0].url);
  if(target.origin===expected.origin){
    const cookies=response.headers.getSetCookie?.()||[];
    if(cookies.length)phoneCookie=cookies.map(value=>value.split(';',1)[0]).join('; ');
  }
  return response;
};
async function stop(){
  if(closing)return;
  closing=true;
  await service?.close();
  if(window&&!window.isDestroyed())window.destroy();
  globalThis.fetch=originalFetch;
}
app.on('before-quit',event=>{if(!closing){event.preventDefault();void stop().finally(()=>app.quit());}});
app.on('window-all-closed',()=>{if(!closing)void stop().finally(()=>app.quit());});
app.whenReady().then(async()=>{
  const {startServer}=await import(pathToFileURL(path.join(root,'server/index.mjs')).href);
  service=await startServer({port:0,host:'0.0.0.0',dataDir:config.dataDir,staticDir:path.join(root,'dist'),resourcesDir:path.join(root,'resources')});
  window=new BrowserWindow({width:1440,height:960,frame:false,show:false,focusable:false,skipTaskbar:true,
    title:'澄音 PC 隐藏真机联调',backgroundColor:'#10121e',autoHideMenuBar:true,
    webPreferences:{preload:path.join(root,'electron/preload.cjs'),offscreen:true,backgroundThrottling:false,
      nodeIntegration:false,contextIsolation:true,sandbox:true}
  });
  require('../electron/history-navigation.cjs')(window);
  window.webContents.setAudioMuted(true);
  window.webContents.setFrameRate(30);
  window.on('show',()=>{violations.push('show');window.hide();});
  window.on('focus',()=>violations.push('focus'));
  window.on('enter-full-screen',()=>violations.push('fullscreen'));
  window.webContents.on('before-input-event',(event,input)=>{if(input.key==='F11')event.preventDefault();});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  window.webContents.on('will-navigate',(event,url)=>{if(new URL(url).origin!==service.url)event.preventDefault();});
  function guard(event){
    if(event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame||new URL(event.senderFrame.url).origin!==service.url)throw Error('Invalid test-host IPC sender');
  }
  const state=()=>({fullscreen:false,maximized:false,alwaysOnTop:false});
  ipcMain.handle('lume:join-room',async(event,id)=>{
    guard(event);
    const origin=service.roomUrl(id);
    if(!origin)throw Error('真实局域网发现结果已过期，请刷新');
    if(origin!==expected.origin)throw Error('这不是本次授权的一加手机空间');
    calls.push({type:'join-room',id,origin,at:new Date().toISOString()});
    return service.joinRoom(origin);
  });
  ipcMain.handle('lume:lyrics',(event,id)=>{guard(event);return service.readLyrics(id);});
  ipcMain.handle('lume:window-state',event=>{guard(event);return state();});
  ipcMain.handle('lume:fullscreen-state',event=>{guard(event);return false;});
  ipcMain.handle('lume:always-on-top-state',event=>{guard(event);return false;});
  ipcMain.handle('lume:system-fonts',event=>{guard(event);return [];});
  for(const name of ['lume:set-fullscreen','lume:set-always-on-top'])ipcMain.handle(name,event=>{
    guard(event);throw Error('离屏验证禁止改变窗口显示状态');
  });
  for(const name of ['lume:minimize','lume:maximize','lume:close','lume:open-web'])ipcMain.on(name,event=>{
    guard(event);calls.push({type:'blocked-window-command',name});
  });
  let scanSettings=null;
  ipcMain.on('lume:scan-settings',event=>{guard(event);event.returnValue=scanSettings;});
  ipcMain.on('lume:save-scan-settings',(event,value)=>{guard(event);scanSettings=value;});
  globalThis.__lumeRealPhoneHost={
    url:service.url,
    navigate:command=>window.emit('app-command',{preventDefault(){}},command),
    inspect:()=>({visible:window.isVisible(),focused:window.isFocused(),focusable:window.isFocusable(),
      fullscreen:window.isFullScreen(),offscreen:window.webContents.isOffscreen(),windows:BrowserWindow.getAllWindows().length,
      violations:[...violations],calls:[...calls]}),
    phoneState:async()=>{
      if(!phoneCookie)throw Error('手机尚未授权');
      const response=await originalFetch(expected.origin+'/api/outputs',{headers:{Cookie:phoneCookie},signal:AbortSignal.timeout(5000)});
      if(!response.ok)throw Error('真实手机状态读取失败：'+response.status);
      return response.json();
    }
  };
  await window.loadURL(service.url);
}).catch(cause=>{console.error(cause);void stop().finally(()=>app.exit(1));});
