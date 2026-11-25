import { FormExtensionAbility, formBindingData, formInfo } from '@kit.FormKit';
import { Want } from '@kit.AbilityKit';
import { formIds, savedCard, sendCard, writeFile } from './CardData';

export default class PlayerFormAbility extends FormExtensionAbility {
  onAddForm(want:Want):formBindingData.FormBindingData{
    const dir=this.context.filesDir;
    const id=String(want.parameters?.[formInfo.FormParam.IDENTITY_KEY]??'');
    const ids=formIds(dir);
    if(id && !ids.includes(id)){ids.push(id);writeFile(dir+'/player-forms.json',JSON.stringify(ids));}
    const state=savedCard(dir);
    if(id)setTimeout(()=>this.onUpdateForm(id),100);
    return formBindingData.createFormBindingData({title:state.title,artist:state.artist??'',
      favoriteKey:state.favoriteKey??'',liked:state.liked??false,playing:state.playing,imageName:''});
  }
  onUpdateForm(id:string):void{
    const dir=this.context.filesDir;
    sendCard(dir,id,savedCard(dir)).catch(()=>{});
  }
  onRemoveForm(id:string):void{
    const dir=this.context.filesDir;
    writeFile(dir+'/player-forms.json',JSON.stringify(formIds(dir).filter((item:string)=>item!==id)));
  }
}
