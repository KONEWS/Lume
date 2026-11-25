const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const audio = /\.(mp3|wav|flac|m4a|aac|ogg|opus|webm|mp4)$/i;
const sidecar = /\.(lrc|jpg|jpeg|png|webp)$/i;
const stamp = stat => [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');

class DirectoryScan {
  constructor(root, cached={}, known=()=>false) {
    this.token=randomUUID();
    this.controller=new AbortController();
    this.root=root;
    this.name=path.basename(root)||path.parse(root).root.replace(/[/\\:]/g,'')||'音乐';
    this.directories=new Set(['']);
    this.paths=[];
    this.descriptors=new Map();
    this.cache=new Map(Object.entries(cached));
    this.known=known;
    this.listed=new Map();
  }
  async entries(relative,skipShort) {
    if(!this.directories.has(relative))throw Error('文件夹不在本次扫描范围内');
    const signal=this.controller.signal;
    const base=path.join(this.root,relative);
    const stat=await fs.stat(base,{bigint:true});
    const signature=stamp(stat);
    let listing=this.cache.get(relative);
    if(!listing || listing.stamp!==signature || !stat.ino || !stat.mtimeNs) {
      const entries=await fs.readdir(base,{withFileTypes:true});
      const dirs=[], names=[];
      for(const entry of entries){
        if(entry.isDirectory())dirs.push(entry.name);
        else if(entry.isFile()&&(audio.test(entry.name)||sidecar.test(entry.name)))names.push(entry.name);
      }
      listing={stamp:signature,dirs,names};
      if(stamp(await fs.stat(base,{bigint:true}))===signature)this.cache.set(relative,listing);
      else listing.stamp='';
    }
    signal.throwIfAborted();
    const directories=listing.dirs.map(name=>[relative,name].filter(Boolean).join('/'));
    for(const child of directories)this.directories.add(child);
    const files=[], stats=new Map();
    const failures=[];
    let unchanged=0;
    // A file write need not touch its parent directory. Re-stat every cached name.
    for(let offset=0;offset<listing.names.length;offset+=32){
      signal.throwIfAborted();
      await Promise.all(listing.names.slice(offset,offset+32).map(async name=>{
        try{
          const stat=await fs.lstat(path.join(base,name),{bigint:true});
          if(stat.isFile())stats.set(name.toLowerCase(),{name,stat});
          else failures.push({name,stage:'读取文件信息',reason:'文件类型已改变，已跳过所在目录。'});
        }catch(error){
          failures.push({name,stage:'读取文件信息',reason:error.message});
        }
      }));
    }
    if(!failures.length && listing.stamp && stamp(await fs.stat(base,{bigint:true}))===signature)
      this.listed.set(base.toLowerCase(),new Set([...listing.names,...listing.dirs].map(name=>name.toLowerCase())));
    else {
      // An unreadable or changing sibling can be the artwork/lyrics for another file.
      this.cache.delete(relative);
      if(!failures.length)failures.push({name:path.basename(base)||base,stage:'枚举目录',reason:'读取期间目录内容发生了变化，本轮跳过此目录。'});
      return {directories,files:[],failed:failures.length,failures,unchanged:0};
    }
    const companionStamp=name=>{const hit=stats.get(name);return hit?[hit.name,stamp(hit.stat)]:null;};
    for(const [key,{name,stat}] of stats){
      const source=path.join(base,name);
      if(audio.test(name)){
        const stem=key.replace(/\.[^.]+$/,'');
        const cover=[stem,'cover','folder','front'].flatMap(n=>['jpg','jpeg','png','webp'].map(ext=>n+'.'+ext)).find(n=>stats.has(n));
        const audioStamp=stamp(stat),lyricsStamp=JSON.stringify(companionStamp(stem+'.lrc')),coverStamp=JSON.stringify(companionStamp(cover));
        const folder=[this.name,relative].filter(Boolean).join('/');
        const origin={path:source,folder,identity:stat.ino?[stat.dev,stat.ino,stat.birthtimeNs].join(':'):'',
          audioStamp,lyricsStamp,coverStamp,stamp:JSON.stringify([audioStamp,lyricsStamp,coverStamp,folder])};
        if(this.known(origin,skipShort)){unchanged++;continue;}
        this.descriptors.set(source,origin);
      }
      files.push({name,size:Number(stat.size),webkitRelativePath:[this.name,relative.split(path.sep).join('/'),name].filter(Boolean).join('/'),scanIndex:this.paths.push(source)-1});
    }
    return {directories,files,failed:0,failures,unchanged};
  }
  missing(source){
    const rel=path.relative(this.root,source);
    if(!rel || rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))return false;
    let dir=this.root;
    for(const name of rel.split(path.sep)){
      const names=this.listed.get(dir.toLowerCase());
      if(names&&!names.has(name.toLowerCase()))return true;
      dir=path.join(dir,name);
    }
    return false;
  }
  resolve(indices){
    if(!Array.isArray(indices)||indices.some(i=>!Number.isSafeInteger(i)||!this.paths[i]))throw Error('文件不在本次扫描范围内');
    return indices.map(i=>this.paths[i]);
  }
}
module.exports={DirectoryScan};
