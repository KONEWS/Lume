// List artwork has its own small renditions. The player keeps its larger cover and lyrics.
const libraryCovers=(()=>{
  const memory=new Map(), near=new Set(), visible=new Set(), painted=new Set(), activeReads=new Set(), diskReads=new Map();
  const observers=new Map();
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
  function key(song){
    return JSON.stringify([epoch,song.thumbSource||song.sourceUri||song.id,song.title,song.bytes,song.coverFile||song.hasSideCover||'']);
  }
  function remember(id,cover){
    memory.delete(id);memory.set(id,cover);
    if(memory.size>256)memory.delete(memory.keys().next().value);
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
    if(!cover)return;
    node.style.backgroundImage='url("'+cover.src+'"),'+node.fallback;
    painted.delete(node);painted.add(node);
    if(painted.size>384){
      for(const old of painted)if(!near.has(old)){
        painted.delete(old);old.coverReady=false;old.style.backgroundImage=old.fallback;break;
      }
    }
  }
  function schedule(delay=0){
    if(timer!==undefined && delay)return;
    clearTimeout(timer);timer=setTimeout(pump,delay);
  }
  function nextSong(){
    for(const group of [visible,near])for(const node of group)
      if(!node.coverReady && !node.checking && !activeReads.has(node.coverKey))return node.song;
    // One background extraction at a time leaves a slot for a sudden scroll.
    if(activeReads.size || document.hidden)return;
    while(cursor<catalog.length && cursor<diskLimit){
      const song=catalog[cursor++];
      if(!memory.has(key(song)))return song;
    }
  }
  function pump(){
    timer=undefined;
    while(activeReads.size<2){
      const song=nextSong();
      if(!song)break;
      const id=key(song), version=generation;
      activeReads.add(id);
      (async()=>{
        let cover=memory.get(id);
        if(cover===undefined){
          let data=await cached(id);
          if(version!==generation)return;
          if(data===undefined){
            data=await window.lumeSongDetails.load(song,true);
            if(version!==generation)return;
            if(data)void persist(id,data).catch(()=>{});
          }
          cover=data?await prepare(data):null;
          if(version!==generation)return;
        }
        remember(id,cover);
        for(const node of near)if(node.coverKey===id)paint(node,cover);
      })().catch(()=>{
        for(const node of near)if(node.coverKey===id)node.coverReady=true;
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
          node.checking=true;
          cached(id).then(async data=>{
            if(!data || !node.isConnected || node.coverKey!==id)return;
            const cover=await prepare(data);
            if(node.isConnected && node.coverKey===id){remember(id,cover);paint(node,cover);}
          }).catch(()=>{}).finally(()=>{node.checking=false;schedule();});
        }else near.delete(node);
      }
      schedule();
    },{root,rootMargin:'200% 0px'});
    const pair={observe(node){viewport.observe(node);ahead.observe(node);},unobserve(node){viewport.unobserve(node);ahead.unobserve(node);}};
    observers.set(root,pair);return pair;
  }
  customElements.define('lume-list-cover',class extends HTMLElement {
    connectedCallback(){
      if(!this.song)return;
      this.coverKey=key(this.song);this.coverReady=false;
      const hit=memory.get(this.coverKey);
      if(hit!==undefined)paint(this,hit);
      this.watch=observer(this.closest('#queue-tracks')||document.getElementById('scroll'));
      this.watch.observe(this);
    }
    disconnectedCallback(){this.watch?.unobserve(this);near.delete(this);visible.delete(this);painted.delete(this);}
  });
  document.addEventListener('visibilitychange',()=>schedule());
  return {
    bind(node,song,readable){
      node.fallback=artwork(song.id);node.style.backgroundImage=node.fallback;
      if(readable)node.song=song;
    },
    update(songs,rescanned){
      generation++;
      if(rescanned){epoch++;localStorage.setItem('lume-cover-scan',String(epoch));memory.clear();}
      catalog=songs;cursor=0;schedule(60);
    }
  };
})();
