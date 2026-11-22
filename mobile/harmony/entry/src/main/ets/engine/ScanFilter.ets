/** Folder-scan rules; explicit file imports keep their existing behavior. */
export class ScanFilter {
  private blockedFormats:Set<string>=new Set<string>();

  constructor(formats:string[]) {
    for(const value of formats){
      if(typeof value!=='string')continue;
      const format=value.trim().replace(/^\./,'').toLowerCase();
      if(/^[a-z0-9]{1,16}$/.test(format))this.blockedFormats.add(format);
    }
  }

  blocksName(name:string):boolean {
    const dot=name.lastIndexOf('.');
    return dot>=0&&this.blockedFormats.has(name.substring(dot+1).toLowerCase());
  }

  static isShort(milliseconds:number):boolean {
    // Unknown/zero duration is retained. Exactly 60 seconds is retained.
    return milliseconds>0&&milliseconds<60000;
  }

  static skipsAudio(skipShort:boolean,milliseconds:number,albumTag:string=''):boolean {
    const album=albumTag.replace(/\u0000/g,'').trim();
    return skipShort&&ScanFilter.isShort(milliseconds)&&(!album||album.toLowerCase()==='<unknown>');
  }
}
