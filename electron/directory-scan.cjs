const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');

class DirectoryScan {
  constructor(root){
    this.token=randomUUID();
    this.root=root;
    this.name=path.basename(root)||path.parse(root).root.replace(/[/\\:]/g,'')||'音乐';
    this.directories=new Set(['']);
    this.paths=[];
  }
  async entries(relative){
    if(!this.directories.has(relative))throw Error('文件夹不在本次扫描范围内');
    const base=path.join(this.root,relative);
    const entries=await fs.readdir(base,{withFileTypes:true});
    const directories=[],files=[];let failed=0;
    for(let i=0;i<entries.length;i+=32){
      const results=await Promise.all(entries.slice(i,i+32).map(async entry=>{
        const child=relative?relative+'/'+entry.name:entry.name;
        if(entry.isDirectory()){this.directories.add(child);directories.push(child);return;}
        if(!entry.isFile()||!/\.(mp3|wav|flac|m4a|aac|ogg|opus|webm|mp4|lrc|jpg|jpeg|png|webp)$/i.test(entry.name))return;
        const absolute=path.join(base,entry.name);
        try{
          const {size}=await fs.stat(absolute);
          return {name:entry.name,size,webkitRelativePath:this.name+'/'+child,scanIndex:this.paths.push(absolute)-1};
        }catch{failed++;}
      }));
      files.push(...results.filter(Boolean));
    }
    return {directories,files,failed};
  }
  resolve(indices){
    if(!Array.isArray(indices)||indices.some(i=>!Number.isSafeInteger(i)||!this.paths[i]))throw Error('文件不在本次扫描范围内');
    return indices.map(i=>this.paths[i]);
  }
}
module.exports={DirectoryScan};
