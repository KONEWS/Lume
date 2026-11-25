// List artwork has its own small renditions. The player keeps its larger cover and lyrics.
const libraryCovers=(()=>{
  const memory=new Map(), near=new Set(), visible=new Set(), painted=new Set(), activeReads=new Set(), diskReads=new Map();
  const observers=new Map();
  let hostSongs=new Map(),roomSession=0;
  const hostLoads=new Set();
  const remoteLoads=new Map();
  const localLoads=new Map();
  const hosted=song=>(state.hosting && hostSongs.get(song?.id))||song;
  const remote=song=>state.joined&&!state.hosting&&song?.coverRevision;
  const diskLimit=2048;
  let catalog=[], cursor=0, epoch=Number(localStorage.getItem('lume-cover-scan'))||0;
  let generation=0, timer, writes=0;
  const database=new Promise(resolve=>{
    try{
      const opening=indexedDB.open('lume-library-covers',1);
      opening.onupgradeneeded=()=>opening.result.createObjectStore('covers',{keyPath:'key'}).createIndex('saved','saved');
      opening.onsuccess=()=>resolve(opening.result);
      opening.onerror=opening.onblocked=()=>resolve(null);
    }catch{resolve(null);}
  });
  function key(song,size){
    if(remote(song))return JSON.stringify(['room-cover',state.host,song.coverRevision,song.id]);
    return JSON.stringify([epoch,song.thumbSource||song.sourceUri||song.id,song.title,song.bytes,song.coverFile||song.hasSideCover||'',song.scanStamp,song.coverStamp,song.modifiedAt,...(size>128?[size]:[])]);
  }
  let cachedPixels=0;
  const pixels=image=>image?image.naturalWidth*image.naturalHeight:0;
  function remember(id,cover){
    cachedPixels+=pixels(cover)-pixels(memory.get(id));
    memory.delete(id);memory.set(id,cover);
    while(memory.size>256 || cachedPixels>16*1024*1024){
      const oldest=memory.keys().next().value;
      cachedPixels-=pixels(memory.get(oldest));memory.delete(oldest);
    }
  }
  async function readDisk(id){
    const db=await database;
    if(!db)return;
    return new Promise(resolve=>{
      const get=db.transaction('covers').objectStore('covers').get(id);
      get.onsuccess=()=>resolve(get.result?.cover);get.onerror=()=>resolve();
    });
  }
  function cached(id){
    if(!diskReads.has(id))diskReads.set(id,readDisk(id).finally(()=>diskReads.delete(id)));
    return diskReads.get(id);
  }
  async function prepare(cover){
    const img=new Image();img.src=cover;await img.decode();return img;
  }
  async function localThumb(song,size){
    const id=key(song,size);
    const hit=memory.get(id);
    if(hit)return hit.src;
    if(!localLoads.has(id))localLoads.set(id,(async()=>{
      let data=await cached(id);
      if(data===undefined){
        data=await window.lumeSongDetails.load(song,true,size);
        if(data)void persist(id,data).catch(()=>{});
      }
      return data;
    })().finally(()=>localLoads.delete(id)));
    return localLoads.get(id);
  }
  function roomThumb(song){
    const id=key(song,128),hit=memory.get(id);
    if(hit!==undefined)return Promise.resolve(hit?.src||'');
    const session=roomSession,request=session+'/'+id;
    if(!remoteLoads.has(request)){
      const load=(async()=>{
        const stored=await cached(id).catch(()=>undefined);
        if(session!==roomSession)throw Error('空间已切换');
        if(stored!==undefined)return stored;
        const ids=new Set();
        for(const node of visible){
          if(node.song?.coverRevision===song.coverRevision && !node.coverReady)ids.add(node.song.id);
          if(ids.size===12)break;
        }
        const cover=await window.lumeSongDetails.roomThumbnail(song,[...ids].join(','));
        if(session!==roomSession)throw Error('空间已切换');
        if(cover)void persist(id,cover).catch(()=>{});
        return cover;
      })().finally(()=>remoteLoads.delete(request));
      remoteLoads.set(request,load);
    }
    return remoteLoads.get(request);
  }
  async function showMatchedCover(node){
    const local=state.localSong,id=node.coverKey,song=node.song;
    if(!local || !remote(song) || song.id!==state.localTrackId || node.coverReady || node.matchedKey===local.id)return;
    node.matchedKey=local.id;
    const data=await localThumb(local,128);
    if(data && node.isConnected && !node.coverReady && node.coverKey===id && state.localTrackId===song.id && state.localSong?.id===local.id)
      node.style.backgroundImage='url("'+data+'"),'+node.fallback;
  }
  async function shareRequested(revision){
    // Serialize extraction. Multiple guests requesting the same row share one result.
    if(hostLoads.has(revision))return;
    hostLoads.add(revision);
    try{
      const processed=new Set();
      while(state.hosting && state.coverRevision===revision){
        const id=state.coverRequests?.find(value=>!processed.has(value));
        if(!id)break;
        processed.add(id);
        const song=hostSongs.get(id);
        if(!state.hosting||state.coverRevision!==revision)return;
        if(!song)continue;
        const cover=await localThumb(song,128);
        if(state.hosting&&state.coverRevision===revision)command('catalogThumbnail',{id,coverRevision:revision,cover:cover||''});
      }
    }finally{
      hostLoads.delete(revision);
      setTimeout(()=>{if(state.hosting&&state.coverRevision===revision&&state.coverRequests?.length)void shareRequested(revision).catch(()=>{});},600);
    }
  }
  async function persist(id,cover){
    const db=await database;
    if(!db)return;
    const store=db.transaction('covers','readwrite').objectStore('covers');
    store.put({key:id,cover,saved:Date.now()});
    if(writes++%32!==0)return;
    const count=store.count();
    count.onsuccess=()=>{
      let excess=count.result-diskLimit;
      if(excess<=0)return;
      const oldest=store.index('saved').openCursor();
      oldest.onsuccess=()=>{
        const row=oldest.result;
        if(row && excess-->0){row.delete();row.continue();}
      };
    };
  }
  function paint(node,cover){
    node.coverReady=true;
    if(!cover){node.style.backgroundImage=node.fallback;return;}
    node.style.backgroundImage='url("'+cover.src+'"),'+node.fallback;
    painted.delete(node);painted.add(node);
    if(painted.size>384){
      for(const old of painted)if(!old.retainCover && !near.has(old)){
        painted.delete(old);old.coverReady=false;old.style.backgroundImage=old.fallback;break;
      }
    }
  }
  function schedule(delay=0){
    if(timer!==undefined && delay)return;
    clearTimeout(timer);timer=setTimeout(pump,delay);
  }
  function nextSong(){
    for(const group of (state.joined&&!state.hosting?[visible]:[visible,near]))for(const node of group)
      if(!node.coverReady && !node.checking && !(node.retryAt>Date.now()) && !activeReads.has(node.coverKey))return node;
    // One background extraction at a time leaves a slot for a sudden scroll.
    if(activeReads.size || document.hidden || state.hosting || state.joined)return;
    while(cursor<catalog.length && cursor<diskLimit){
      const song=catalog[cursor++];
      const coverKey=key(song,128);
      if(!memory.has(coverKey))return {song,coverKey,size:128};
    }
  }
  function pump(){
    timer=undefined;
    while(activeReads.size<2){
      const next=nextSong();
      if(!next)break;
      const {song,coverKey:id,size}=next, version=generation;
      activeReads.add(id);
      (async()=>{
        let cover=memory.get(id);
        if(cover===undefined){
          const data=remote(song)?await roomThumb(song):await localThumb(song,size);
          if(version!==generation)return;
          cover=data?await prepare(data):null;
          if(version!==generation)return;
        }
        remember(id,cover);
        for(const node of near)if(node.coverKey===id)paint(node,cover);
      })().catch(()=>{
        if(version!==generation)return;
        for(const node of near)if(node.coverKey===id){
          if(remote(song)){
            node.retryAt=Date.now()+650;
            setTimeout(()=>{if(node.isConnected&&near.has(node))schedule();},660);
          }else node.coverReady=true;
        }
      }).finally(()=>{activeReads.delete(id);schedule(12);});
    }
  }
  function observer(root){
    if(observers.has(root))return observers.get(root);
    const viewport=new IntersectionObserver(entries=>{
      for(const {target,isIntersecting} of entries)
        if(isIntersecting && target.isConnected)visible.add(target);else visible.delete(target);
      schedule();
    },{root});
    const ahead=new IntersectionObserver(entries=>{
      for(const {target:node,isIntersecting} of entries){
        if(!node.isConnected)continue;
        if(isIntersecting){
          near.add(node);
          if(node.coverReady || node.checking)continue;
          const id=node.coverKey, hit=memory.get(id);
          if(hit!==undefined){remember(id,hit);paint(node,hit);continue;}
          if(remote(node.song)){void showMatchedCover(node).catch(()=>{});continue;}
          node.checking=true;
          cached(id).then(async data=>{
            if(!data || !node.isConnected || node.coverKey!==id)return;
            const cover=await prepare(data);
            if(node.isConnected && node.coverKey===id){remember(id,cover);paint(node,cover);}
          }).catch(()=>{}).finally(()=>{node.checking=false;schedule();});
        }else{
          near.delete(node);
          if(node.size>128 && !node.retainCover && painted.delete(node)){
            node.coverReady=false;
            node.style.backgroundImage=node.fallback;
          }
        }
      }
      schedule();
    },{root,rootMargin:'200% 0px'});
    const pair={observe(node){viewport.observe(node);ahead.observe(node);},unobserve(node){viewport.unobserve(node);ahead.unobserve(node);}};
    observers.set(root,pair);return pair;
  }
  customElements.define('lume-list-cover',class extends HTMLElement {
    connectedCallback(){
      if(!this.song)return;
      this.coverKey=key(this.song,this.size);this.coverReady=false;
      const hit=memory.get(this.coverKey);
      if(hit!==undefined)paint(this,hit);
      this.watch=observer(this.closest('#queue-tracks')||document.getElementById('scroll'));
      this.watch.observe(this);
    }
    disconnectedCallback(){this.watch?.unobserve(this);near.delete(this);visible.delete(this);painted.delete(this);}
  });
  document.addEventListener('visibilitychange',()=>schedule());
  return {
    hosted,
    session:()=>roomSession,
    roomThumb,
    roomChanged(){roomSession++;},
    matchChanged(){for(const node of near)void showMatchedCover(node).catch(()=>{});},
    setHostSongs(songs){hostSongs=new Map((songs||[]).map(song=>[song.hostId||song.id,song]));},
    shareRequested,
    async details(key,load,verifyLyrics=false){
      // Bound the number of full-resolution entries independently of thumbnails.
      let bucket=0;
      for(let i=0;i<key.length;i++)bucket=(bucket*31+key.charCodeAt(i))>>>0;
      const slot='player-details/'+(bucket%12);
      const saved=await cached(slot).catch(()=>undefined);
      if(saved?.key===key && (!verifyLyrics || (saved.details.audioInfo && (saved.details.lyrics || saved.details.lyricsChecked))))return saved.details;
      const details=await load();
      if(details.cover||details.lyrics)await persist(slot,{key,details}).catch(()=>{});
      return details;
    },
    bind(node,song,readable,size=128,retainCover=false){
      node.size=size;node.retainCover=retainCover;
      node.fallback=artwork(song.id);node.style.backgroundImage=node.fallback;
      if(readable)node.song=hosted(song);
      else if(remote(song))node.song=song;
      else if(state.localTrackId===song.id && state.localSong)node.song=state.localSong;
      else if(state.roomDetails?.id===song.id && /^data:image\/(?:png|jpeg|webp|gif|bmp);base64,[a-z0-9+/=]+$/i.test(state.roomDetails.cover))node.style.backgroundImage='url("'+state.roomDetails.cover+'"),'+node.fallback;
    },
    update(songs,rescanned){
      generation++;
      if(rescanned){epoch++;localStorage.setItem('lume-cover-scan',String(epoch));memory.clear();cachedPixels=0;}
      catalog=songs.map(hosted);cursor=0;schedule(60);
    }
  };
})();
