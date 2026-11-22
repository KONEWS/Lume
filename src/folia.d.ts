interface FoliaTrack {translated:boolean; id:string; title:string; artist:string; duration:number; rows:import('../shared/song-details.mjs').LyricRow[]}
interface FoliaStage {
  update(track:FoliaTrack,mode:string,position:number,playing:boolean):void;
  close():void;
}
interface Window {
  LumeFolia:{
    styles:Record<string,string>;
    autoHide(page:HTMLElement):()=>void;
    translationVisible():boolean;
    saveTranslation(show:boolean):void;
    openSettings(mode:string,done:(choice:string)=>void):void;
    closeSettings():boolean;
    updateSettings(track:FoliaTrack,mode:string,position:number,playing:boolean):void;
    preference():string;
    save(mode:string):void;
    mount(container:HTMLElement,onError:()=>void):FoliaStage;
  };
}
