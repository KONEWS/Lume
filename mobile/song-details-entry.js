import {parseBlob} from 'music-metadata';
import {coverMime, frontCover, embeddedLyrics, decodeLyrics, parseSongLyrics, lyricLines} from '../shared/song-details.mjs';

const requests=new Map();
let serial=0;
window.lumeReadResult=(token,data)=>requests.get(token)?.(data);
function read(id,kind,offset,length) {
  return new Promise(resolve=>{
    const token=++serial;
    const finish=data=>{
      clearTimeout(timer);
      requests.delete(token);
      resolve(kind==='thumbnail'||kind==='artwork'?data:Uint8Array.from(atob(data),c=>c.charCodeAt(0)));
    };
    const timer=setTimeout(()=>finish(''),15000);
    requests.set(token,finish);
    window.LumeNative.dispatch(JSON.stringify({type:'detailRead',id,kind,offset,length,token}));
  });
}

// The metadata parser seeks past audio frames. Keep adjacent tag reads on one native read.
function audioBlob(song) {
  let start=-1, page=new Uint8Array(0);
  return {size:song.bytes,type:'',slice:(from,to)=>({arrayBuffer:async()=>{
    if(to-from>32*1024*1024)throw Error('标签过大');
    const result=new Uint8Array(to-from);
    for(let pos=from;pos<to;){
      if(start<0||pos<start||pos>=start+page.length){
        start=pos;
        page=await read(song.id,'audio',pos,Math.min(song.bytes-pos,Math.max(65536,Math.min(to-pos,512*1024))));
        if(!page.length)throw Error('文件读取失败');
      }
      const count=Math.min(to-pos,start+page.length-pos);
      result.set(page.subarray(pos-start,pos-start+count),pos-from);
      pos+=count;
    }
    return result.buffer;
  }})};
}
async function sideImage(id) {
  const chunks=[];
  const block=512*1024;
  for(let offset=0;offset<=16*1024*1024;offset+=block){
    const data=await read(id,'cover',offset,block);
    if(!offset&&!coverMime(data))return;
    if(data.length)chunks.push(data);
    if(data.length<block)return new Blob(chunks,{type:coverMime(chunks[0])});
  }
}
async function thumbnail(blob,maxSide) {
  const url=URL.createObjectURL(blob);
  try {
    const img=new Image();img.src=url;await img.decode();
    const scale=Math.min(1,maxSide/Math.max(img.width,img.height));
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(img.width*scale));canvas.height=Math.max(1,Math.round(img.height*scale));
    canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
    return canvas.toDataURL('image/webp',0.85);
  }finally{URL.revokeObjectURL(url);}
}
async function load(song,listOnly=false){
  if(listOnly){
    const encoded=await read(song.id,'thumbnail',0,512*1024);
    if(encoded)return 'data:image/jpeg;base64,'+encoded;
  }
  let metadata;
  try{if(song.bytes>0)metadata=await parseBlob(audioBlob(song));}catch{}
  const picture=frontCover(metadata?.common.picture);
  const blob=picture?new Blob([picture.data],{type:coverMime(picture.data)}):song.coverFile||song.hasSideCover?await sideImage(song.id):null;
  if(listOnly)return blob?await thumbnail(blob,128):'';
  let cover=blob?await thumbnail(blob,640).catch(()=>''):'';
  // Some system decoders support tags the JS parser cannot read. Use the same
  // embedded artwork as the library, at player resolution, before giving up.
  if(!cover){
    const encoded=await read(song.id,'artwork',0,512*1024);
    if(encoded)cover='data:image/jpeg;base64,'+encoded;
  }
  const lyrics=song.lyricsFile||song.hasSideLyrics?decodeLyrics(await read(song.id,'lyrics',0,512*1024)):'';
  const embedded=embeddedLyrics(metadata);
  return {cover,lyrics:lyrics.trim()||embedded,lyricsSource:lyrics.trim()?'sidecar':embedded?'embedded':'none'};
}
window.lumeSongDetails={load,parseSongLyrics,lyricLines};
