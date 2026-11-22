import { common } from '@kit.AbilityKit';
import { fileIo as fs, fileUri, picker } from '@kit.CoreFileKit';
import { systemShare } from '@kit.ShareKit';
import { uniformTypeDescriptor } from '@kit.ArkData';
import { BusinessError } from '@kit.BasicServicesKit';
import { LocalLibrary, Song } from './LocalLibrary';

export class SongActions {
  private busy:boolean=false;
  private context:common.UIAbilityContext;
  private library:LocalLibrary;
  constructor(context:common.UIAbilityContext,library:LocalLibrary){this.context=context;this.library=library;}
  private async deleteOriginal(song:Song):Promise<void>{
    const uri=song.sourceUri;if(!uri)return;
    // Resolve only the URI recorded by the import, never a title-derived path.
    const source=await fs.open(uri,fs.OpenMode.READ_ONLY);
    const path=source.path;await fs.close(source);
    await fs.unlink(path);
  }
  async run(type:string,id:string):Promise<string>{
    if(this.busy)throw new Error('请先完成上一项操作');
    if(this.library.scanning)throw new Error('请等待导入完成后再操作');
    this.busy=true;
    try{
      if(type==='songRestore'){this.library.restoreSongs();return '已恢复隐藏歌曲';}
      const song=this.library.songs.find((s:Song)=>s.id===id&&!s.hidden);
      if(!song)throw new Error('歌曲已不存在，请重新打开菜单');
      if(type==='songNext'){this.library.queueNext(song);return '已设为下一首播放';}
      if(type==='songHide'){await this.library.hideSong(song);return '已隐藏，可在媒体库中恢复';}
      const path=this.context.filesDir+'/'+song.id;
      if(type==='songShare'){
        if(!fs.accessSync(path))throw new Error('音频文件已不可用');
        const data=new systemShare.SharedData({utd:uniformTypeDescriptor.UniformDataType.AUDIO,uri:fileUri.getUriFromPath(path),title:song.title});
        await new systemShare.ShareController(data).show(this.context,{});
        return '已打开系统分享面板';
      }
      if(type==='songDelete'){
        if(song.sourceUri){
          try{await this.deleteOriginal(song);}catch(e){
            const code=(e as BusinessError).code;
            if(code!==13900002){
              if(!song.sourceUri.startsWith('file://docs/'))throw new Error('原文件没有删除权限，歌曲已保留');
              const parent=new fileUri.FileUri(song.sourceUri).getFullDirectoryUri();
              const options=new picker.DocumentSelectOptions();options.selectMode=picker.DocumentSelectMode.FOLDER;options.maxSelectNumber=1;options.defaultFilePathUri=parent;
              const selected=await new picker.DocumentViewPicker(this.context).select(options);
              if(!selected.length)return '已取消删除，歌曲已保留';
              if(LocalLibrary.folderKey(selected[0])!==LocalLibrary.folderKey(parent))throw new Error('选择的不是原歌曲文件夹，歌曲已保留');
              try{await this.deleteOriginal(song);}catch(e){throw new Error('系统未授予原文件删除权限，歌曲已保留');}
            }
          }
        }
        if(this.library.songs[this.library.index]?.id===song.id)await this.library.stop();
        try{if(fs.accessSync(path))await fs.unlink(path);}catch(e){throw new Error('原文件已删除，但应用内副本未删除，请重试');}
        await this.library.removeSong(song);return '歌曲文件已永久删除';
      }
      throw new Error('不支持的歌曲操作');
    }finally{this.busy=false;}
  }
}
