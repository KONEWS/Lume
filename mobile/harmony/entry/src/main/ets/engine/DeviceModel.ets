import { deviceInfo } from '@kit.BasicServicesKit';

export const systemPhoneModel = [deviceInfo.marketName.trim(),deviceInfo.productModel.trim()]
  .filter((s:string)=>s.length>0 && s.toLowerCase()!=='unknown')
  .filter((s:string,i:number,items:string[])=>items.indexOf(s)===i).join(' · ') || '鸿蒙手机';

export let phoneModel:string=systemPhoneModel;
export function setDeviceDisplayName(name:string):void{phoneModel=name||systemPhoneModel;}
