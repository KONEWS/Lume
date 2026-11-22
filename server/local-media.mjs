import {createHash} from 'node:crypto';
import {createReadStream,statSync,promises as fs} from 'node:fs';
// Complete-file identity is deliberately conservative: ambiguous/different files stream from the host.
export class MediaIdentities {
  entries=new Map();
  async identify(file){
    try{
      const stat=await fs.stat(file);if(!stat.isFile()||stat.size<=0)return null;
      const stamp=[stat.dev,stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs].join(':');
      let entry=this.entries.get(file);
      if(entry?.stamp!==stamp){
        entry={stamp,value:null};this.entries.set(file,entry);
        entry.promise=(async()=>{
          const hash=createHash('sha256');for await(const bytes of createReadStream(file))hash.update(bytes);
          const after=await fs.stat(file);
          if(stamp!==[after.dev,after.ino,after.size,after.mtimeMs,after.ctimeMs].join(':'))return null;
          return entry.value={audioIdentity:'sha256:'+hash.digest('hex'),audioBytes:stat.size};
        })().catch(()=>null);
        if(this.entries.size>128)this.entries.delete(this.entries.keys().next().value);
      }
      return await entry.promise;
    }catch{return null;}
  }
  peek(file){
    void this.identify(file);
    try{const s=statSync(file),entry=this.entries.get(file);return entry?.stamp===[s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs].join(':')?entry.value||{}:{};}catch{return {};}
  }
}
export async function findLocalTrack(tracks,pathFor,identities,identity,bytes){
  if(!/^sha256:[a-f0-9]{64}$/.test(identity||'')||!Number.isSafeInteger(bytes)||bytes<=0)return null;
  for(const track of tracks){
    if(track.hidden||(track.bytes>0&&track.bytes!==bytes))continue;
    const actual=await identities.identify(pathFor(track));
    if(actual?.audioIdentity===identity&&actual.audioBytes===bytes)return track;
  }
  return null;
}
