// Mobile dashboard: reuse the native catalog and keep dated activity on this device.
window.lumeHome=(()=>{
  let mode='added',albumOffset=0,last=null,saveAt=0,paintKey='';
  let activity={recent:{},days:{}};
  try{const value=JSON.parse(localStorage.getItem('lume-home-activity')||'null');if(value?.recent&&value?.days)activity=value;}catch{}
  const observedSince=Date.now();
  const seenCompletions=new Set(activity.completedEvents||[activity.completed].filter(Boolean));
  const dayKey=date=>[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
  const key=s=>JSON.stringify([state.joined?state.host:'local',s.id]);
  function observe(){
    const now=Date.now(),song=active(),id=song&&key(song),day=dayKey(new Date(now));
    if(song&&state.playing){
      const entry=activity.days[day]||(activity.days[day]={starts:0,ms:0});
      if(!last||last.id!==id||(!last.playing&&state.pos<1)){
        activity.recent[id]=now;
      }
      if(!Array.isArray(state.playRecords)&&last?.playing&&last.id===id){
        const elapsed=now-last.time,progress=(state.pos-last.pos)*1000;
        if(elapsed>0&&elapsed<5000&&progress>=0&&Math.abs(progress-elapsed)<2500){
          // Split a sample at local midnight, including month/year and DST boundaries.
          let cursor=last.time,end=last.time+Math.min(elapsed,Math.max(0,progress));
          while(cursor<end){const midnight=new Date(cursor);midnight.setHours(24,0,0,0);const next=Math.min(end,midnight.getTime());
            const bucket=activity.days[dayKey(new Date(cursor))]||(activity.days[dayKey(new Date(cursor))]={starts:0,ms:0});bucket.ms+=next-cursor;cursor=next;}
        }
      }
      if(now-saveAt>5000){save();saveAt=now;}
    }
    const completed=state.completion;
    if(completed?.eventId && !seenCompletions.has(completed.eventId)){
      // The event is emitted once by the playback owner, after a full pass.
      seenCompletions.add(completed.eventId);
      if(seenCompletions.size>256)seenCompletions.delete(seenCompletions.values().next().value);
      activity.completedEvents=[...seenCompletions];
      if(!Array.isArray(state.playRecords)&&Number.isFinite(completed.at)&&completed.at>=observedSince){
        const day=dayKey(new Date(completed.at));
        const entry=activity.days[day]||(activity.days[day]={starts:0,ms:0});entry.starts++;
      }
      save();
    }
    last={id,playing:state.playing,time:now,pos:state.pos};
    renderWeek();
  }
  function save(){try{localStorage.setItem('lume-home-activity',JSON.stringify(activity));}catch{}}
  document.addEventListener('visibilitychange',()=>{if(document.hidden)save();});
  let catalog=new Map(), drawSource='', drawDay='';
  let slides=[], slideIndex=0, picks=[];
  // The first k steps of Fisher–Yates give every visible track the same chance.
  function sampleIds(size){
    const pool=Array.from(catalog.keys()),take=Math.min(size,pool.length);
    for(let i=0;i<take;i++){
      const j=i+Math.floor(Math.random()*(pool.length-i));
      [pool[i],pool[j]]=[pool[j],pool[i]];
    }
    return pool.slice(0,take);
  }
  function drawSlides(){
    slides=sampleIds(6);slideIndex=0;
  }
  function updateDraws(songs,day,fresh){
    const previous=catalog;
    catalog=new Map(songs.map(song=>[song.id,song]));
    if(fresh||drawSource!==sourceKey()||drawDay!==day||catalog.size!==previous.size||
        [...catalog.keys()].some(id=>!previous.has(id))){
      drawSource=sourceKey();drawDay=day;
      picks=sampleIds(3);drawSlides();
    }
  }
  const feature=document.getElementById('home-feature');
  let slideTimer,featureVisible=false;
  function scheduleSlide(){
    clearTimeout(slideTimer);
    if(slides.length<2||!featureVisible||document.hidden||quietMotion.matches)return;
    slideTimer=setTimeout(()=>{
      if(!expanded&&!drawerOpen&&!document.querySelector('dialog[open],.listen-feature:focus-within,.listen-feature:active')){
        if(slideIndex===slides.length-1){drawSlides();selectSlide(0);}
        else selectSlide(slideIndex+1);
      }
      else scheduleSlide();
    },8000);
  }
  new IntersectionObserver(([entry])=>{
    featureVisible=entry.isIntersecting;scheduleSlide();
  },{root:document.getElementById('scroll'),threshold:.7}).observe(feature);
  document.addEventListener('visibilitychange',scheduleSlide);
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',scheduleSlide);
  function paintFeature(){
    const song=catalog.get(slides[slideIndex]),hero=$('home-feature');
    $('home-title').songName=song?.title||'导入音乐';
    $('home-artist').textContent=song?artist(song):'从本机曲库开始聆听';
    hero.setAttribute('aria-label',song?'播放，'+song.title:'导入音乐');
    const cover=hero.querySelector('.hero-cover');
    if(state.joined&&!state.hosting&&cover.detailKey!==detailKey(song))cover.style.backgroundImage=artwork(song?.id);
    bindArt(cover,song);
    hero.onclick=()=>{
      if(!song){command('import');return;}
      if(song.id!==state.id)command('select',{id:song.id});
      else if(!state.playing)command('toggle');
    };
    const pages=$('home-pages');
    const labels=JSON.stringify(slides.map(id=>[id,catalog.get(id).title]));
    if(pages.dataset.labels!==labels){
      pages.dataset.labels=labels;scheduleSlide();
      pages.replaceChildren(...slides.map((id,index)=>{
        const dot=button('',()=>selectSlide(index),'home-dot');
        dot.setAttribute('aria-label','预览 '+catalog.get(id).title);return dot;
      }));
    }
    for(const [i,dot] of [...pages.children].entries())dot.setAttribute('aria-pressed',String(i===slideIndex));
    pages.hidden=slides.length<2;
  }
  function selectSlide(index){
    if(!slides.length)return;
    slideIndex=(index+slides.length)%slides.length;paintFeature();scheduleSlide();
  }
  function shelf(id,songs,empty,albums=false){
    const root=$(id),signature=JSON.stringify([sourceKey(),songs.map(s=>[s.id,s.title,s.artist,s.album]),listCoverVersion]);
    if(root.dataset.items===signature)return;root.dataset.items=signature;root.replaceChildren();
    if(!songs.length){root.append(element('p',empty,'empty'));return;}
    for(const song of songs){
      const title=albums?groupName(song,'albums'):song.title;
      const b=button('',()=>albums?showAlbumSongs(title):command('select',{id:song.id}),'home-track');
      const art=element('lume-list-cover',undefined,'thumb');art.setAttribute('aria-hidden','true');art.style.backgroundImage=artwork(song.id);
      libraryCovers.bind(art,song,!state.joined||state.hosting);
      b.append(art,element('strong',title),element('small',artist(song)));root.append(b);
    }
  }
  function variedBatch(items,offset,size){
    const result=[],artists=new Set();
    for(let i=0;i<items.length&&result.length<size;i++){
      const item=items[(offset+i)%items.length],name=artist(item);
      if(!artists.has(name)){artists.add(name);result.push(item);}
    }
    for(let i=0;i<items.length&&result.length<size;i++){
      const item=items[(offset+i)%items.length];
      if(!result.includes(item))result.push(item);
    }
    return result;
  }
  function render(fresh=false){
    const songs=state.songs.filter(s=>!s.hidden),today=new Date();
    updateDraws(songs,dayKey(today),fresh);paintFeature();
    $('home-shuffle').disabled=!songs.length;
    $('home-shuffle').onclick=()=>{
      const pool=songs.filter(s=>s.id!==state.id);
      command('shuffle',{value:true});
      command('select',{id:(pool[Math.floor(Math.random()*pool.length)]||songs[0]).id});
    };
    $('home-history').onclick=()=>{
      mode='played';render();
      $('home-activity').scrollIntoView({block:'start',behavior:quietMotion.matches?'instant':'smooth'});
    };
    $('home-search').onclick=()=>{onlyLiked=false;library();navigate('library');$('query').focus();};
    $('home-categories').replaceChildren(...[['artists','艺术家'],['songs','曲目'],['folders','文件夹']].map(([page,label])=>{
      const count=page==='songs'?songs.length:new Set(songs.map(s=>groupName(s,page))).size;
      const b=button('',()=>page==='songs'?navigate('library'):openBrowse(page),'home-category');
      const icon=element('i');icon.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">'+menuIcons[page]+'</svg>';
      const info=element('span');info.append(element('strong',String(count)),element('small',label));b.append(icon,info);return b;
    }));
    $('home-played').onclick=()=>{mode='played';render();};$('home-added').onclick=()=>{mode='added';render();};
    $('home-played').setAttribute('aria-pressed',String(mode==='played'));$('home-added').setAttribute('aria-pressed',String(mode==='added'));
    const recent=mode==='added'?[...songs].reverse().sort((a,b)=>(b.addedAt||0)-(a.addedAt||0)):songs.filter(s=>activity.recent[key(s)]||s.lastPlayedAt).sort((a,b)=>(activity.recent[key(b)]||b.lastPlayedAt||0)-(activity.recent[key(a)]||a.lastPlayedAt||0));
    shelf('home-recent',recent.slice(0,4),mode==='played'?'播放一首歌后，会在这里留下记录。':'曲库中暂无歌曲。');
    const count=s=>state.joined?s.playCount||0:state.counts?.[s.id]||0;
    const day=Math.floor(Date.UTC(today.getFullYear(),today.getMonth(),today.getDate())/86400000);
    shelf('home-picks',picks.map(id=>catalog.get(id)),'导入音乐后，今日乐曲会出现在这里。');
    const albums=[...groups('albums').values()].map(items=>items[0]);
    shelf('home-albums',variedBatch(albums,day+albumOffset,6),'曲库中的专辑会出现在这里。',true);
    $('home-refresh').disabled=picks.length<2;
    $('home-refresh').onclick=()=>{picks=sampleIds(3);render();};
    $('home-refresh-albums').disabled=albums.length<2;
    $('home-refresh-albums').onclick=()=>{albumOffset+=Math.min(6,albums.length-1);render();};
    const ranking=new Map();for(const song of songs)if(count(song))ranking.set(artist(song),(ranking.get(artist(song))||0)+count(song));
    $('home-ranking').replaceChildren(...[...ranking].sort((a,b)=>b[1]-a[1]).slice(0,5).map(([name,n],i)=>{const row=element('li');row.append(element('b',String(i+1).padStart(2,'0')),element('strong',name),element('small',n+' 次'));return row;}));
    if(!ranking.size)$('home-ranking').append(element('li','听过的艺术家会按播放次数排列。','empty'));
    $('home-stats').onclick=()=>openBrowse('stats');renderWeek();
  }
  function renderWeek(){
    document.dispatchEvent(new Event('lume-activity-change'));
    const today=new Date(),summary=period('week',0,today),monday=summary.start;
    const {starts,ms}=summary,days=[];
    const totals=listening().days;
    for(let i=0;i<7;i++){const date=new Date(monday);date.setDate(date.getDate()+i);const key=dayKey(date),value=totals[key]||{starts:0,ms:0};days.push({key,value,future:date>today});}
    const signature=JSON.stringify([dayKey(today),starts,Math.floor(ms/60000),days.map(d=>[d.value.starts,Math.floor(d.value.ms/60000)])]);if(signature===paintKey)return;paintKey=signature;
    $('home-week-numbers').replaceChildren(element('span',starts+' 次播放'),element('span',Math.floor(ms/60000)+' 分钟'));
    $('home-week-days').replaceChildren(...days.map((d,i)=>{const cell=element('span',['一','二','三','四','五','六','日'][i]);cell.dataset.level=d.future?'future':Math.min(4,Math.ceil(Math.log2(1+d.value.starts)));cell.title=d.key+' · '+d.value.starts+' 次 · '+Math.floor(d.value.ms/60000)+' 分钟';return cell;}));
  }
  function period(kind,offset=0,now=new Date()){
    return window.lumeListening.period(listening().days,kind,offset,now);
  }
  function listening(){return {days:window.lumeListening.days(state.playRecords||[],state.joined&&Array.isArray(state.playRecords)?{}:activity.days),records:state.playRecords||[],playlists:typeof playlistKey==='function'?readPreference(playlistKey(),[]):[],now:Date.now()};}
  return {render,observe,period,listening};
})();
