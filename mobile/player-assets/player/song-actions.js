/* Song actions are bound to the row, never to the currently playing track. */
function songFileLocation(song){
  const name=String(song.fileName||'').trim();
  const folder=String(song.folder||'').trim();
  if(state.joined)return name?'播放空间 · '+name:'播放空间，原文件位置未知';
  if(folder==='局域网接收'||/^received-/.test(song.id))return '局域网接收'+(name?' / '+name:'');
  try{
    const uri=new URL(song.originalUri||song.sourceUri||'');
    const path=decodeURIComponent(uri.pathname);
    if(uri.protocol==='content:' && uri.hostname==='com.android.externalstorage.documents'){
      const doc=decodeURIComponent(uri.pathname.split('/document/').pop());
      const parts=/^(primary|[0-9a-f]{4}-[0-9a-f]{4}):\/?(.+)$/i.exec(doc);
      if(parts)return (parts[1].toLowerCase()==='primary'?'内部存储':'存储卷 '+parts[1])+' / '+parts[2];
    }
    if(uri.protocol==='file:' && uri.hostname==='docs' && path.startsWith('/storage/Users/'))
      return path;
    if(uri.protocol==='file:' && !uri.hostname && /^\/(?:storage|sdcard)\//.test(path))return path;
    if(uri.hostname==='com.android.providers.downloads.documents' && path.startsWith('/document/raw:/storage/'))
      return path.slice('/document/raw:'.length);
  }catch{}
  const knownFolder=folder && !/^[a-z][\w+.-]*:|^\/(?:proc|data)\/|^%[0-9a-f]{2}/i.test(folder);
  if(knownFolder && name)return folder+' / '+name;
  if(knownFolder)return '已知文件夹 · '+folder;
  return name?name+'（原文件夹未知）':'原文件位置未知';
}

let songActions;
function initSongActions(){songActions=(()=>{
  const sheet=document.createElement('dialog');sheet.id='song-actions';sheet.className='song-action-sheet';
  sheet.setAttribute('aria-label','歌曲设置');document.body.append(sheet);
  const more='<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>';
  const paths={add:icons.plus,remove:'<path d="M4 6h16M4 11h10M4 16h6m4 0h7"/>',next:'<path d="M3 5h13M3 10h10M3 15h6m8-4v10m-5-5h10"/>',share:'<circle cx="6" cy="12" r="3"/><circle cx="18" cy="5" r="3"/><circle cx="18" cy="19" r="3"/><path d="m9 10 6-4M9 14l6 4"/>',artist:menuIcons.artists,album:icons.disc,info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>',hide:'<path d="m3 3 18 18M10 5c5-1 9 3 11 7l-3 4M6 6c-2 2-4 4-5 6 4 7 10 9 16 6M10 10a3 3 0 0 0 4 4"/>',delete:'<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>'};
  paths.send='<path d="m3 10 18-7-7 18-3-8-8-3Zm8 3L21 3"/>';
  let selected,origin,serial=0,request=null;
  let changingPanel=false;
  async function changePanel(render){
    if(changingPanel || sheet.hasAttribute('data-closing'))return;
    if(quietMotion.matches){render();return;}
    changingPanel=true;
    const oldHeight=sheet.offsetHeight,oldHeading=sheet.querySelector('header');
    const contents=()=>Array.from(sheet.children).filter(node=>!node.classList.contains('song-sheet-grip'));
    try{
      await Promise.all(contents().map(node=>node.animate([
        {opacity:1,transform:'none'},{opacity:0,transform:'translateX(-12px)'}
      ],{duration:100,fill:'forwards',easing:'ease-in'}).finished));
      if(!sheet.open || sheet.hasAttribute('data-closing') || !oldHeading.isConnected)return;
      render();sheet.scrollTop=0;
      const timing={duration:215,easing:'cubic-bezier(.2,.75,.25,1)'};
      sheet.animate([{height:oldHeight+'px'},{height:sheet.offsetHeight+'px'}],timing);
      for(const node of contents())node.animate([{opacity:0,transform:'translateX(16px)'},{opacity:1,transform:'none'}],timing);
      sheet.querySelector('h2')?.focus({preventScroll:true});
    }finally{changingPanel=false;}
  }
  function notice(text){$('notice').textContent=text;$('notice').hidden=false;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>$('notice').hidden=true,4500);}
  function fresh(){return selected&&origin===sourceKey()&&state.songs.some(s=>s.id===selected.id&&!s.hidden);}
  function heading(title){sheet.replaceChildren();const grip=element('div',undefined,'song-sheet-grip');grip.setAttribute('aria-hidden','true');const head=element('header');const label=element('h2',title);label.tabIndex=-1;head.append(label);sheet.append(grip,head);}
  function card(song){const box=element('div',undefined,'song-sheet-card'),cover=element('lume-list-cover','', 'thumb'),meta=element('div');libraryCovers.bind(cover,song,!state.joined||state.hosting);meta.append(element('strong',song.title),element('small',[artist(song),song.album].filter(Boolean).join(' · ')));box.append(cover,meta);return box;}
  function native(type){if(!fresh())return notice('歌曲已变化，请重新打开菜单');if(request)return notice('正在处理上一项操作');const token=++serial;request={token,type,id:selected.id,key:playlistKey(),favorite:favKey(selected.id)};command(type,{id:selected.id,token});dismissSettingsSheet(sheet);}
  window.lumeSongActionResult=(token,ok,message)=>{if(request?.token!==token)return;const pending=request;request=null;if(ok&&pending.type==='songDelete'){
    const lists=readPreference(pending.key,[]);savePreference(pending.key,lists.map(p=>({...p,songs:p.songs.filter(id=>id!==pending.id)})));
    setSongFavorite(pending.favorite,false);
  }notice(message);};
  function lists(){heading('添加到歌单');sheet.append(card(selected));const area=element('div',undefined,'song-sheet-list');
    const all=readPreference(playlistKey(),[]);for(const list of all)area.append(button(list.name+(list.songs.includes(selected.id)?' · 已添加':''),()=>{if(!fresh())return notice('歌曲已变化，请重新打开菜单');if(!list.songs.includes(selected.id))list.songs.push(selected.id);savePreference(playlistKey(),all);dismissSettingsSheet(sheet);notice('已添加到「'+list.name+'」');if(tab==='browse')renderBrowse();},'song-sheet-option'));
    const form=element('form'),input=element('input');input.placeholder='新歌单名称';input.maxLength=60;input.required=true;input.setAttribute('aria-label','新歌单名称');const save=element('button','新建并添加');save.type='submit';form.append(input,save);form.onsubmit=e=>{e.preventDefault();if(!input.value.trim()||!fresh())return;all.push({id:Date.now().toString(36),name:input.value.trim(),songs:[selected.id]});savePreference(playlistKey(),all);dismissSettingsSheet(sheet);notice('已新建歌单并添加歌曲');if(tab==='browse')renderBrowse();};area.append(form);sheet.append(area);}
  function showAudioFields(song,details={}){
    const positive=n=>Number.isFinite(n)&&n>0;
    const suffix=/\.([a-z0-9]{2,5})$/i.exec(song.fileName||'')?.[1]?.toUpperCase();
    const format=details.format||song.format||suffix;
    const codec=details.codec||song.codec;
    const rate=details.sampleRate||song.sampleRate;
    const bitrate=details.bitrate||song.bitrate;
    const estimated=positive(song.bytes)&&positive(song.duration)?8*song.bytes/song.duration:0;
    const kbps=positive(bitrate)?Math.round(bitrate/1000)+' kbps（平均）':positive(estimated)?Math.round(estimated/1000)+' kbps（平均估算）':'未知';
    sheet.querySelector('[data-audio="格式"]').textContent=[...new Set([format,codec].filter(Boolean))].join(' · ')||'未知';
    sheet.querySelector('[data-audio="比特率"]').textContent=kbps;
    sheet.querySelector('[data-audio="采样率"]').textContent=positive(rate)?Number((rate/1000).toFixed(3))+' kHz':'未知';
  }
  async function refreshLyrics(){
    const cell=sheet.querySelector('[data-info-lyrics]');
    if(!sheet.open || !cell)return;
    const song=origin===sourceKey() && state.songs.find(s=>s.id===selected.id && !s.hidden);
    const requestId=Symbol();
    cell.requestId=requestId;
    if(!song){cell.textContent='未知';return;}
    const remote=state.joined && state.roomDetails?.id===song.id?state.roomDetails:null;
    const found=song.hasLyrics===true || !!(song.lyricsFile||song.hasSideLyrics||remote?.lyrics?.trim()||detailsCache.get(detailKey(song))?.lyrics?.trim());
    showAudioFields(song,remote?.audioInfo);
    const readable=!state.joined || state.hosting?song:state.localTrackId===song.id?state.localSong:null;
    if(!readable){
      cell.textContent=found?'有歌词':remote?.lyricsSource==='none'?'无歌词':'未知';return;
    }
    cell.textContent=found?'有歌词':'正在检查…';
    const key=detailKey(readable);
    let details=detailsCache.get(key);
    if(!details?.audioInfo || (!details?.lyrics && !details?.lyricsChecked)){
      try{details=await libraryCovers.details(key,()=>window.lumeSongDetails.load(readable),true);}
      catch{details=null;}
    }
    if(cell.requestId!==requestId || !cell.isConnected || !sheet.open || !fresh())return;
    cell.textContent=found||details?.lyrics?.trim()?'有歌词':details?.lyricsChecked?'无歌词':'未知';
    showAudioFields(song,{...remote?.audioInfo,...details?.audioInfo});
  }
  function info(){
    heading('歌曲信息');sheet.append(card(selected));
    const dl=element('dl',undefined,'song-sheet-info');
    const fields=[['艺术家',groupName(selected,'artists')],['专辑',groupName(selected,'albums')],
      ['文件夹',selected.folder||'未提供'],['音质',songQualityDescription(selected)],
      ['格式','未知'],['比特率','未知'],['采样率','未知'],
      ['大小',Number.isFinite(selected.bytes)?(selected.bytes/1048576).toFixed(2)+' MB':'未提供'],
      ['歌词','未知'],['播放次数',state.counts?.[selected.id]??selected.playCount??0],['文件位置',songFileLocation(selected)]];
    for(const [label,value] of fields){
      const cell=element('dd',String(value));
      if(label==='歌词')cell.dataset.infoLyrics='';
      if(['格式','比特率','采样率'].includes(label))cell.dataset.audio=label;
      dl.append(element('dt',label),cell);
    }
    sheet.append(dl);void refreshLyrics();
  }
  function confirmDelete(){heading('永久删除');sheet.append(card(selected),element('p','将永久删除这首歌曲的音频文件，并从曲库和歌单移除。此操作无法撤销；如系统要求授权，还需在系统窗口中确认。','song-delete-note'));const buttons=element('div',undefined,'song-delete-buttons');buttons.append(button('取消',()=>dismissSettingsSheet(sheet)),button('永久删除',()=>native('songDelete'),'song-danger'));sheet.append(buttons);buttons.firstChild.focus();}
  function removeFromPlaylist(id,song){
    const key=playlistKey(),lists=readPreference(key,[]),playlist=lists.find(p=>p.id===id);
    dismissSettingsSheet(sheet);
    if(!playlist || !playlist.songs.includes(song.id))return;
    playlist.songs=playlist.songs.filter(track=>track!==song.id);
    savePreference(key,lists);notice('已从「'+playlist.name+'」移出');
    if(tab==='browse'){renderBrowse();animatePlaylistContent();}
  }
  function open(song,trigger){if(request)return notice('正在处理上一项操作');selected=song;origin=sourceKey();heading('歌曲设置');sheet.append(card(song));const list=element('div',undefined,'song-sheet-list');
    const actions=[['add','添加到歌单',lists],['next','下一首播放',()=>native('songNext')],['share','分享',()=>native('songShare')],['artist','艺术家',()=>{dismissSettingsSheet(sheet);openBrowse('artists',groupName(song,'artists'));}],['album','专辑',()=>{dismissSettingsSheet(sheet);showAlbumSongs(groupName(song,'albums'));}],['info','歌曲信息',info],['hide','隐藏歌曲',()=>native('songHide')],['delete','永久删除',confirmDelete]];
    if(!state.joined||state.hosting)actions.splice(2,0,['send','发送到设备',()=>changePanel(()=>sendTargets(song))]);
    if(browsePage==='playlists' && browseDetail && browseDetail!=='favorites' && trigger.closest('#browse-content')){
      const playlistId=browseDetail;
      actions.splice(1,0,['remove','移出歌单',()=>removeFromPlaylist(playlistId,song)]);
    }
    for(const [key,label,run] of actions){const b=button('',()=>{if(!fresh()){dismissSettingsSheet(sheet);notice('歌曲已变化，请重新打开菜单');return;}if(state.joined&&['next','share','hide','delete'].includes(key)){notice('请先离开播放空间，再管理本机歌曲');return;}if(['add','info','delete'].includes(key))changePanel(run);else run();},'song-sheet-option'+(key==='delete'?' song-danger':''));const icon=element('i');icon.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'+paths[key]+'</svg>';b.append(icon,element('span',label));if(key==='artist'||key==='album')b.append(element('small',groupName(song,key==='artist'?'artists':'albums')));list.append(b);}sheet.append(list);sheet.returnFocus=trigger;sheet.showModal();syncBack();}
  sheet.addEventListener('cancel',event=>{event.preventDefault();dismissSettingsSheet(sheet);});
  async function sendTargets(song){
    heading('发送到设备');sheet.append(card(song));
    const area=element('div',undefined,'song-sheet-list');area.textContent='正在查找已授权的设备…';sheet.append(area);
    try{
      const data=await window.lumePersonalRequest('status');
      if(!area.isConnected||selected!==song)return;
      const peers=(data.peers||[]).filter(p=>p.trusted&&p.synced);
      area.replaceChildren();
      if(!peers.length)area.textContent='暂无在线的已授权设备。请在播放空间的「我的设备」中请求授权。';
      for(const p of peers)area.append(button(p.name,async()=>{
        if(!fresh()||selected!==song)return notice('歌曲已变化，请重新打开菜单');
        for(const b of area.querySelectorAll('button'))b.disabled=true;
        try{await window.lumePersonalRequest('offer',{id:song.id,peer:p.id});dismissSettingsSheet(sheet);notice('已发送请求，可在「歌曲传送」查看进度');}
        catch(e){notice(e.message);for(const b of area.querySelectorAll('button'))b.disabled=false;}
      },'song-sheet-option'));
    }catch(e){area.textContent=e.message;}
  }
  bindDetailDismiss(sheet,()=>sheet.open,()=>sheet.scrollTop,()=>dismissSettingsSheet(sheet));
  let headerDrag=null;
  sheet.addEventListener('pointerdown',event=>{
    if(!event.isPrimary || event.button!==0 || !event.target.closest('.song-sheet-grip,header'))return;
    headerDrag={id:event.pointerId,x:event.clientX,y:event.clientY};
    sheet.setPointerCapture(event.pointerId);
  });
  sheet.addEventListener('pointermove',event=>{
    if(headerDrag?.id!==event.pointerId)return;
    const dx=event.clientX-headerDrag.x,dy=event.clientY-headerDrag.y;
    if(dy>=64 && dy>Math.abs(dx)*1.2){headerDrag=null;dismissSettingsSheet(sheet);}
  });
  for(const name of ['pointerup','pointercancel','lostpointercapture'])sheet.addEventListener(name,()=>{headerDrag=null;});
  sheet.addEventListener('close',()=>{delete sheet.dataset.closing;syncBack();if(sheet.returnFocus?.isConnected)sheet.returnFocus.focus({preventScroll:true});});
  sheet.addEventListener('click',e=>{if(e.target===sheet){const r=sheet.getBoundingClientRect();if(e.clientY<r.top||e.clientX<r.left||e.clientX>r.right)dismissSettingsSheet(sheet);}});
  function bind(row,song){let timer=0,start,suppress=false;const cancel=()=>{clearTimeout(timer);timer=0;};const end=row.querySelector('.end');end.innerHTML=more;end.setAttribute('role','button');end.tabIndex=0;end.setAttribute('aria-label','更多操作：'+song.title);end.setAttribute('aria-haspopup','dialog');
    end.addEventListener('click',e=>{e.stopPropagation();cancel();open(song,end);});end.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();open(song,end);}});
    row.addEventListener('pointerdown',e=>{if(e.button!==0||e.target.closest('.end,.song-next'))return;suppress=false;start={x:e.clientX,y:e.clientY};timer=setTimeout(()=>{suppress=true;open(song,end);},500);});row.addEventListener('pointermove',e=>{if(start&&Math.hypot(e.clientX-start.x,e.clientY-start.y)>10)cancel();});for(const name of ['pointerup','pointercancel','pointerleave'])row.addEventListener(name,cancel);
    row.addEventListener('click',e=>{if(e.target.closest('.end,.song-next')){suppress=false;return;}if(suppress){e.preventDefault();e.stopImmediatePropagation();suppress=false;}},true);row.addEventListener('contextmenu',e=>{e.preventDefault();cancel();if(!sheet.open)open(song,end);suppress=true;});
  }
  function queueNext(song){
    if(request)return notice('正在处理上一项操作');
    if(state.joined)return;
    selected=song;origin=sourceKey();native('songNext');
  }
  return {bind,more,queueNext,refreshLyrics,close:()=>{if(!sheet.open)return false;dismissSettingsSheet(sheet);return true;},restore:()=>{if(request)return;const token=++serial;request={token,type:'songRestore'};command('songRestore',{token});}};
})();}
