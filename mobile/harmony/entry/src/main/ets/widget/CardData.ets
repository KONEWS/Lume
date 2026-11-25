import { formBindingData, formProvider } from '@kit.FormKit';
import { fileIo as fs } from '@kit.CoreFileKit';

export interface CardState {
  title:string;
  artist:string;
  favoriteKey:string;
  liked:boolean;
  playing:boolean;
  imageName:string;
}
export const emptyCard:CardState={title:'澄音播放器',artist:'',favoriteKey:'',liked:false,playing:false,imageName:''};

export function readText(path:string):string{
  try{return fs.readTextSync(path);}catch{return '';}
}
export function writeFile(path:string,data:string|ArrayBuffer):void{
  const temp=path+'.tmp';
  const f=fs.openSync(temp,fs.OpenMode.WRITE_ONLY|fs.OpenMode.CREATE|fs.OpenMode.TRUNC);
  try{fs.writeSync(f.fd,data);}finally{fs.closeSync(f);}
  fs.renameSync(temp,path);
}
export function savedCard(dir:string):CardState{
  try{return JSON.parse(readText(dir+'/player-card.json')) as CardState;}catch{return emptyCard;}
}
export function formIds(dir:string):string[]{
  try{return JSON.parse(readText(dir+'/player-forms.json')) as string[];}catch{return [];}
}
export async function sendCard(dir:string,id:string,state:CardState):Promise<void>{
  let file:fs.File|undefined;
  const images:Record<string,number>={};
  try{
    if(state.imageName){
      try{file=fs.openSync(dir+'/'+state.imageName);images[state.imageName]=file.fd;}catch{}
    }
    const data=formBindingData.createFormBindingData({
      title:state.title,artist:state.artist??'',favoriteKey:state.favoriteKey??'',liked:state.liked??false,playing:state.playing,imageName:file?state.imageName:'',formImages:images
    });
    await formProvider.updateForm(id,data);
  }finally{if(file)fs.closeSync(file);}
}
