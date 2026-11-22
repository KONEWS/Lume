declare const core: {
  room(request:string):string;
  localMedia(path:string,channel:string,block:number,identity?:string):Promise<ArrayBuffer>;
  put(index:number, data:ArrayBuffer):void;
  sync(play:boolean,start:number,duration:number,gain:number):number;
  gaps():number;
  reset():void;
  close():void;
};
export default core;
