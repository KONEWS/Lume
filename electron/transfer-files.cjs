const path=require('node:path');
module.exports=function registerTransferFiles({ipcMain,dialog,mainWindow,checkWindowSender,service}){
  let transferFile;
  ipcMain.handle('lume:pick-transfer-file',async event=>{
    checkWindowSender(event);
    const selected=await dialog.showOpenDialog(mainWindow,{title:'选择要传送的歌曲',properties:['openFile'],
      filters:[{name:'音频文件',extensions:['mp3','wav','flac','m4a','aac','ogg','opus','webm','mp4']}]});
    if(selected.canceled||!selected.filePaths.length)return null;
    const file=selected.filePaths[0],token=require('node:crypto').randomUUID();
    transferFile={file,token};
    return {name:path.basename(file),token};
  });
  ipcMain.handle('lume:send-transfer-file',async(event,token,peer)=>{
    checkWindowSender(event);
    if(!transferFile||transferFile.token!==token)throw Error('请重新选择歌曲');
    if(typeof peer!=='string'||!/^[a-f0-9]{64}$/.test(peer))throw Error('请选择已授权设备');
    const selected=transferFile;
    const result=await service.offerFile(peer,selected.file);
    if(transferFile===selected)transferFile=undefined;
    return result;
  });
};
