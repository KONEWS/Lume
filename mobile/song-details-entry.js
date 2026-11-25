import {coverMime, frontCover, embeddedLyrics, decodeLyrics, parseSongLyrics, lyricLines} from '../shared/song-details.mjs';

// Keep lyric parsing and the native bridge available immediately. The audio
// tag reader is only needed when a local song actually requires inspection.
const parserURL = new URL('audio-tags.js', document.currentScript.src).href;
let parserLoading;
function audioParser() {
  if (!parserLoading) parserLoading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = parserURL;
    script.onload = () => resolve(window.lumeAudioTags);
    script.onerror = () => { script.remove(); parserLoading = undefined; reject(Error('无法加载音频标签解析器')); };
    document.head.append(script);
  });
  return parserLoading;
}

const requests=new Map();
let serial=0;
window.lumeReadResult=(token,data)=>requests.get(token)?.(data);
function read(id,kind,offset,length,revision,visible) {
  return new Promise(resolve=>{
    const token=++serial;
    const finish=data=>{
      clearTimeout(timer);
      requests.delete(token);
      resolve(kind==='thumbnail'||kind==='artwork'||kind==='roomCover'?data:Uint8Array.from(atob(data),c=>c.charCodeAt(0)));
    };
    const timer=setTimeout(()=>finish(''),15000);
    requests.set(token,finish);
    window.LumeNative.dispatch(JSON.stringify({type:'detailRead',id,kind,offset,length,token,revision,visible}));
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
    if(scale===1 && blob.size<=1024*1024)return await new Promise((resolve,reject)=>{
      const reader=new FileReader();
      reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);
      reader.readAsDataURL(blob);
    });
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(img.width*scale));canvas.height=Math.max(1,Math.round(img.height*scale));
    const context=canvas.getContext('2d');
    context.imageSmoothingQuality='high';
    context.drawImage(img,0,0,canvas.width,canvas.height);
    const cover=canvas.toDataURL('image/webp',0.94);
    // Room hosts accept cover data URLs up to three million characters.
    return cover.length<=3000000 ? cover : canvas.toDataURL('image/jpeg',0.80);
  }finally{URL.revokeObjectURL(url);}
}
async function load(song,listOnly=false,maxSide=listOnly?128:1600){
  if(listOnly && maxSide<=128){
    const encoded=await read(song.id,'thumbnail',0,512*1024);
    if(encoded)return 'data:image/jpeg;base64,'+encoded;
  }
  let metadata;
  try{if(song.bytes>0)metadata=await (await audioParser()).parseBlob(audioBlob(song));}catch{}
  const picture=frontCover(metadata?.common.picture);
  const blob=picture?new Blob([picture.data],{type:coverMime(picture.data)}):song.coverFile||song.hasSideCover?await sideImage(song.id):null;
  let cover=blob?await thumbnail(blob,maxSide).catch(()=>''):'';
  // Some system decoders support tags the JS parser cannot read. Use the same
  // embedded artwork as the library, at player resolution, before giving up.
  if(!cover && (!listOnly || maxSide>128)){
    const encoded=await read(song.id,'artwork',0,512*1024);
    if(encoded)cover='data:image/jpeg;base64,'+encoded;
  }
  if(listOnly)return cover;
  const lyrics=song.lyricsFile||song.hasSideLyrics?decodeLyrics(await read(song.id,'lyrics',0,512*1024)):'';
  const embedded=embeddedLyrics(metadata);
  const lyricsChecked=!!metadata && (!(song.lyricsFile||song.hasSideLyrics) || !!lyrics.trim());
  const f=metadata?.format;
  const audioInfo={format:f?.container,codec:f?.codec,sampleRate:f?.sampleRate,bitrate:f?.bitrate};
  return {cover,lyrics:lyrics.trim()||embedded,lyricsChecked,audioInfo,lyricsSource:lyrics.trim()?'sidecar':embedded?'embedded':lyricsChecked?'none':'unknown'};
}
async function roomThumbnail(song,visible){
  const raw=await read(song.id,'roomCover',0,0,song.coverRevision,visible);
  const result=raw&&JSON.parse(raw);
  if(typeof result?.cover!=='string')throw Error('空间封面尚未就绪');
  if(result.cover && (result.cover.length>1500000 || !/^data:image\/(?:png|jpeg|webp|gif|bmp);base64,[a-z0-9+/=]+$/i.test(result.cover)))throw Error('空间封面格式无效');
  return result.cover;
}
window.lumeSongDetails={load,roomThumbnail,parseSongLyrics,lyricLines};
