const browseNames = {
  songs:'歌曲', albums:'专辑', artists:'艺术家', folders:'文件夹', playlists:'歌单',
  transfer:'歌曲传送', scan:'扫描音乐', sources:'音乐库', stats:'统计', settings:'设置', about:'关于', queue:'播放列表'
};
const menuIcons = {
  transfer:'<path d="M3 8h16m-4-4 4 4-4 4M21 16H5l4-4m-4 4 4 4"/>',
  songs:'<path d="M3 5h10M3 9h8M3 13h5m7 4V6l6-2v4l-6 2"/><ellipse cx="12.5" cy="18" rx="2.5" ry="2"/>',
  albums:'<rect x="5" y="4" width="15" height="15" rx="2"/><path d="M2 8v13h14"/><circle cx="12.5" cy="11.5" r="3"/>',
  artists:'<circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-7 14-7 14 0M3 6v4m18-4v4"/>',
  folders:'<path d="M3 8V5h7l2 3h8v3M2 11h20l-3 9H4z"/>',
  playlists:'<path d="M3 6h13M3 11h10M3 16h6m6-4 6 4-6 4z"/>',
  scan:'<path d="M3 9V4h5m8 0h5v5M3 15v5h5m8 0h5v-5M5 12h14"/>',
  sources:'<path d="m3 7 9-4 9 4-9 4zm0 5 9 4 9-4M3 17l9 4 9-4"/>',
  stats:'<path d="M3 4v16h18M7 16v-4m5 4V7m5 9v-6"/>',
  space:'<path d="M5 7v10m5-14v18m5-15v12m4-9v6"/>',
  settings:'<path d="M3 7h7m5 0h6M3 17h2m5 0h11"/><circle cx="12.5" cy="7" r="2.5"/><circle cx="7.5" cy="17" r="2.5"/>',
  about:'<circle cx="12" cy="12" r="8.5"/><path d="M12 11v6m0-10v.5"/>',
};
function element(tag, text, className) {
  const node=document.createElement(tag);
  if(text!==undefined)node.textContent=text;
  if(className)node.className=className;
  return node;
}
function button(label, action, css='browse-action') {
  const b=element('button',label,css); b.onclick=action; return b;
}
function readPreference(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key))??fallback; } catch { return fallback; }
}
function savePreference(key,value) { localStorage.setItem(key,JSON.stringify(value)); }
let drawerOpen=false, browsePage='artists', browseDetail=null, browseSource='local';
const sourceKey=()=>state.joined?'room:'+state.host:'local';
function resetBrowse(){browseSource=sourceKey();browseDetail=null;if(listEditor.open)listEditor.close();}
function syncBack(){
  const dialog=Boolean(document.querySelector('dialog[open]'));
  command('backState',{enabled:drawerOpen||expanded||!!playerMotion||tab!=='home'||dialog});
}
function setDrawer(open){
  clearDrawerDrag();
  if(open===drawerOpen)return;
  drawerOpen=open;
  document.body.classList.toggle('drawer-open',open);
  $('sidebar').inert=!open;$('close-menu').inert=!open;
  $('open-menu').setAttribute('aria-expanded',String(open));
  for(const node of [document.querySelector('header'),$('scroll')])node.inert=open;
  (open ? $('sidebar').querySelector('.side-link') : $('open-menu')).focus({preventScroll:true});
  syncBack();
}
let drawerTouch=null;
const drawerRangeKey='lume-phone-drawer-range';
const savedDrawerRange=readPreference(drawerRangeKey,33);
let drawerRange=Number.isFinite(savedDrawerRange)?Math.max(0,Math.min(100,savedDrawerRange)):33;
function drawerRangeSetting(){
  const row=element('div',undefined,'drawer-range-setting');
  const value=element('output'),slider=element('input');
  const preview=element('div',undefined,'drawer-range-preview');
  const hint=element('small','拖动红线调整范围。从红线左侧右滑打开侧边栏，从右侧左右滑动切换页面。');
  hint.id='drawer-range-hint';slider.setAttribute('aria-describedby',hint.id);
  slider.setAttribute('aria-labelledby','browse-title');
  slider.type='range';slider.id='drawer-range';slider.min='0';slider.max='100';slider.value=String(drawerRange);
  value.setAttribute('aria-label','可右滑区域');value.setAttribute('for',slider.id);
  function showValue(){
    preview.style.setProperty('--boundary',drawerRange+'%');
    value.textContent=drawerRange===0?'已关闭':drawerRange+'%';
    slider.setAttribute('aria-valuetext',drawerRange===0?'已关闭':'屏幕左侧 '+drawerRange+'%');
  }
  slider.oninput=()=>{drawerRange=slider.valueAsNumber;showValue();savePreference(drawerRangeKey,drawerRange);};
  showValue();
  preview.append(slider);
  row.append(preview,value,hint);
  return row;
}
function clearDrawerDrag(){
  drawerTouch=null;
  if(!document.body.classList.contains('drawer-dragging'))return;
  document.body.classList.remove('drawer-dragging');
  $('library-frame').style.removeProperty('--drawer-shift');
}
function bindDrawerGestures(){
  const rail=$('sidebar'), shade=$('close-menu');
  document.addEventListener('touchstart',event=>{
    if(event.touches.length!==1){clearDrawerDrag();return;}
    if(expanded||playerMotion||isCollectionDetail()||document.querySelector('dialog[open]')||
      (tab==='browse'&&browsePage==='settings'&&browseDetail==='drawer-range'))return;
    const finger=event.touches[0];
    if(drawerOpen){
      if(!rail.contains(event.target)&&event.target!==shade)return;
    }else{
      if(!$('library-frame').contains(event.target)||
          event.target.closest('input,textarea,select,.dock-selected,[data-lens-group],.collection-index,.seek-rail,.stats-chart,.stats-table-wrap,#home-feature.swipeable'))return;
      if(drawerRange===0||finger.clientX>innerWidth*drawerRange/100){
        drawerTouch={page:true,id:finger.identifier,x:finger.clientX,y:finger.clientY,active:false};
        return;
      }
    }
    const bounds=rail.getBoundingClientRect();
    drawerTouch={id:finger.identifier,x:finger.clientX,y:finger.clientY,width:bounds.width,
      start:bounds.right,visible:bounds.right,active:false,samples:[[event.timeStamp,finger.clientX]]};
  },{passive:true});
  document.addEventListener('touchmove',event=>{
    const drag=drawerTouch,finger=event.touches[0];
    if(!drag)return;
    if(event.touches.length!==1||finger.identifier!==drag.id){clearDrawerDrag();return;}
    const dx=finger.clientX-drag.x, dy=finger.clientY-drag.y;
    if(!drag.active){
      if(Math.max(Math.abs(dx),Math.abs(dy))<6)return;
      if(Math.abs(dx)<Math.abs(dy)*1.2){clearDrawerDrag();return;}
      drag.blocked=!drag.page&&(drawerOpen?dx>=0:dx<=0);
      drag.active=true;
      if(!drag.page&&!drag.blocked)document.body.classList.add('drawer-dragging');
    }
    if(!event.cancelable){clearDrawerDrag();return;}
    event.preventDefault();
    if(drag.page||drag.blocked)return;
    drag.visible=Math.max(0,Math.min(drag.width,drag.start+dx));
    $('library-frame').style.setProperty('--drawer-shift',drag.visible+'px');
    drag.samples.push([event.timeStamp,finger.clientX]);
    while(drag.samples.length>1&&drag.samples[0][0]<event.timeStamp-100)drag.samples.shift();
  },{passive:false});
  document.addEventListener('touchend',event=>{
    const drag=drawerTouch;
    if(!drag?.active){clearDrawerDrag();return;}
    const finger=Array.from(event.changedTouches).find(t=>t.identifier===drag.id);
    if(!finger)return;
    if(event.cancelable)event.preventDefault();
    if(drag.blocked){clearDrawerDrag();return;}
    if(drag.page){
      clearDrawerDrag();
      const dx=finger.clientX-drag.x,dy=finger.clientY-drag.y;
      if(Math.abs(dx)>=48&&Math.abs(dx)>Math.abs(dy)*1.2)stepMainPage(dx<0?1:-1);
      return;
    }
    const [time,x]=drag.samples[0], elapsed=event.timeStamp-time;
    const speed=elapsed>0&&elapsed<=140?(finger.clientX-x)/elapsed:0;
    const open=Math.abs(speed)>=0.5?speed>0:drag.visible>=drag.width/2;
    setDrawer(open);
  },{passive:false});
  document.addEventListener('touchcancel',clearDrawerDrag,{passive:true});
  window.addEventListener('blur',clearDrawerDrag);
  window.addEventListener('resize',clearDrawerDrag);
}
function updateSideSelection(){
  $('side-count').textContent=state.songs.length+' 首';
  const current=tab==='library'?'songs':tab==='browse'?browsePage:tab;
  for(const b of document.querySelectorAll('[data-section]')){
    if(b.dataset.section===current)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');
  }
}
function menuButton(key,label,action){
  const b=button('',action,'side-link');
  const i=element('i');i.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">'+menuIcons[key]+'</svg>';
  b.append(i);
  b.append(element('span',label));
  b.dataset.section=key;
  if(key==='songs'){const count=element('small');count.id='side-count';b.append(count);}
  return b;
}
const listEditor=element('dialog');listEditor.className='list-editor';
listEditor.id='playlist-editor';
function closePlaylistEditor(){dismissSettingsSheet(listEditor);}
function showPlaylistEditor(focus){
  listEditor.setAttribute('aria-labelledby','playlist-dialog-title');
  listEditor.querySelector('h2').id='playlist-dialog-title';
  listEditor.showModal();focus.focus({preventScroll:true});syncBack();
}
function animatePlaylistContent(direction=0){
  if(quietMotion.matches)return;
  const content=$('browse-content');
  content.getAnimations().forEach(motion=>motion.cancel());
  content.animate([{opacity:.35,transform:'translate('+direction*18+'px,'+(direction?0:8)+'px)'},{opacity:1,transform:'none'}],
    {duration:240,easing:'cubic-bezier(.2,.75,.25,1)'});
}
function initSidebar(){
  $('manage-links').append(menuButton('space','播放空间',()=>navigate('space')));
  bindDetailDismiss($('library-frame'),isCollectionDetail,()=>$('scroll').scrollTop,()=>openBrowse(browsePage));
  bindDrawerGestures();
  document.body.append(listEditor);
  listEditor.onclose=()=>{delete listEditor.dataset.closing;syncBack();};
  listEditor.oncancel=event=>{event.preventDefault();closePlaylistEditor();};
  $('playlist-add').onclick=()=>pickPlaylistSongs(browseDetail);
  window.addEventListener('lume-open-transfer',()=>openBrowse('transfer'));
  $('open-menu').onclick=()=>setDrawer(true);$('close-menu').onclick=()=>setDrawer(false);
  for(const key of Object.keys(browseNames).filter(k=>k!=='queue')){
    const group=['songs','albums','artists','folders','playlists'].includes(key)?'browse-links':'manage-links';
    $(group).append(menuButton(key,browseNames[key],()=>{if(key==='songs'){onlyLiked=false;$('query').value='';library();navigate('library');}else openBrowse(key);}));
  }
  $('browse-back').onclick=()=>openBrowse(browsePage);
  applyPreferences();
}
function applyPreferences(){
  const root=document.documentElement;
  root.dataset.phoneTheme=readPreference('lume-listen-theme','light');
  root.dataset.glass='full';
  applySkin();
}
function toggleTheme(){
  savePreference('lume-listen-theme',document.documentElement.dataset.phoneTheme==='light'?'dark':'light');
  applyPreferences();if(tab==='browse')renderBrowse();
}
let collectionListTop=0;
function openBrowse(page,detail=null,direction=0){
  const movingInPlaylists=tab==='browse' && page==='playlists' && browsePage===page && detail!==browseDetail;
  const withinCollection=tab==='browse' && page===browsePage && ['albums','artists'].includes(page);
  const returning=withinCollection && browseDetail!==null && detail===null;
  if(withinCollection && browseDetail===null && detail!==null)collectionListTop=$('scroll').scrollTop;
  else if(!returning)collectionListTop=0;
  browsePage=page;browseDetail=detail;browseSource=sourceKey();navigate('browse',direction);
  renderBrowse();$('browse-title').focus({preventScroll:true});$('scroll').scrollTop=returning?collectionListTop:0;
  if(movingInPlaylists)animatePlaylistContent(detail===null?-1:1);
}
function groupName(song,page){
  if(page==='artists')return song.artist||'未知艺术家';
  if(page==='albums')return song.album||'未知专辑';
  return song.folder||(state.joined?'空间曲库':'未提供文件夹');
}
function groups(page){
  const result=new Map();
  for(const song of state.songs.filter(s=>!s.hidden)){const name=groupName(song,page);if(!result.has(name))result.set(name,[]);result.get(name).push(song);}
  return result;
}
function linkRow(label,detail,action){
  const b=button('',action,'collection-row');
  b.append(element('strong',label),element('small',detail),element('span','›'));return b;
}
function queuedSongs(){
  if(state.joined || !state.order?.length)return state.songs.filter(s=>!s.hidden);
  const byId=new Map(state.songs.map(song=>[song.id,song]));
  return state.order.map(id=>byId.get(id)).filter(s=>s&&!s.hidden);
}
function addTracks(container,songs,empty='暂无歌曲'){
  songs=songs.filter(s=>!s.hidden);
  const order=songs.map(s=>s.id);
  if(songs.length&&!state.joined)container.append(button('播放全部',()=>command('select',{id:order[0],order})));
  container.append(...songs.map(s=>songRow(s,order)));if(!songs.length)container.append(element('p',empty,'empty'));
}
const playlistKey=()=>'lume-playlists:'+sourceKey();
function editList(existing){
  const key=playlistKey();
  const form=element('form'), name=element('input');
  const label=element('label','歌单名称');name.required=true;name.maxLength=60;name.value=existing?.name||'';label.append(name);
  form.append(element('h2',existing?'编辑歌单':'新建歌单'),label);
  const cancel=button('取消',closePlaylistEditor);cancel.type='button';
  const actions=element('div',undefined,'playlist-actions'),save=element('button','保存','pill');
  actions.append(cancel,save);form.append(actions);
  form.onsubmit=e=>{
    e.preventDefault();if(listEditor.hasAttribute('data-closing'))return;
    if(!name.value.trim()){name.focus();return;}
    if(playlistKey()!==key){listEditor.close();return;}
    const lists=readPreference(key,[]),id=existing?.id||Date.now().toString(36);
    if(existing && !lists.some(list=>list.id===id)){listEditor.close();openBrowse('playlists');return;}
    const title=name.value.trim();
    savePreference(key,existing?lists.map(p=>p.id===id?{...p,name:title}:p):[...lists,{id,name:title,songs:[]}]);
    closePlaylistEditor();openBrowse('playlists',id);
    if(existing)animatePlaylistContent();
  };
  listEditor.replaceChildren(form);showPlaylistEditor(name);
}
function confirmPlaylistDeletion(list){
  const key=playlistKey(),cancel=button('取消',closePlaylistEditor);
  const actions=element('div',undefined,'playlist-actions');
  actions.append(cancel,button('删除歌单',()=>{
    if(listEditor.hasAttribute('data-closing'))return;
    closePlaylistEditor();
    if(playlistKey()!==key)return;
    savePreference(key,readPreference(key,[]).filter(p=>p.id!==list.id));
    openBrowse('playlists');
  },'playlist-delete'));
  listEditor.replaceChildren(element('h2','删除「'+list.name+'」？'),element('p','歌曲仍会保留在曲库和其他歌单中。'),actions);
  showPlaylistEditor(cancel);
}
function pickPlaylistSongs(id){
  const key=playlistKey(),list=readPreference(key,[]).find(p=>p.id===id);
  if(!list || listEditor.open)return;
  const existing=new Set(list.songs),selected=new Set();
  const panel=element('div',undefined,'playlist-picker'),title=element('h2','添加音乐');
  title.tabIndex=-1;
  const search=element('input');search.type='search';search.placeholder='搜索歌曲、歌手或专辑';search.setAttribute('aria-label',search.placeholder);
  const rows=element('div',undefined,'playlist-options'),actions=element('div',undefined,'playlist-actions');
  const save=button('添加',()=>{
    if(listEditor.hasAttribute('data-closing'))return;
    closePlaylistEditor();
    if(playlistKey()!==key)return;
    const lists=readPreference(key,[]),target=lists.find(p=>p.id===id);
    if(!target)return;
    const visible=new Set(state.songs.filter(s=>!s.hidden).map(s=>s.id));
    target.songs=[...new Set([...target.songs,...[...selected].filter(track=>visible.has(track))])];
    savePreference(key,lists);renderBrowse();animatePlaylistContent();
  },'pill');
  save.disabled=true;
  function renderOptions(){
    const query=search.value.trim().toLocaleLowerCase(),fragment=document.createDocumentFragment();
    for(const song of state.songs){
      if(song.hidden || !matchesLibraryQuery(song,query))continue;
      const row=element('label'),check=element('input'),meta=element('span');
      check.type='checkbox';check.disabled=existing.has(song.id);check.checked=check.disabled||selected.has(song.id);
      check.onchange=()=>{
        if(check.checked)selected.add(song.id);else selected.delete(song.id);
        save.disabled=!selected.size;save.textContent=selected.size?'添加（'+selected.size+'）':'添加';
      };
      meta.append(element('strong',song.title),element('small',artist(song)));
      row.append(check,meta);fragment.append(row);
    }
    if(!fragment.childElementCount)fragment.append(element('p',query?'没有匹配的歌曲':'曲库中暂无歌曲','empty'));
    rows.replaceChildren(fragment);rows.scrollTop=0;
  }
  search.oninput=renderOptions;renderOptions();
  actions.append(button('取消',closePlaylistEditor),save);
  panel.append(title,search,rows,actions);listEditor.replaceChildren(panel);showPlaylistEditor(title);
}
function updateScanMeter(meter){
  if(!meter)return;
  meter.dataset.total=state.scanTotalKnown?String(state.scanTotal||0):'-1';
  meter.dataset.done=String(state.scanDone||0);
  meter.dataset.found=String(state.scanFound||0);
}
const scanRulesControl=document.createElement('lume-scan-rules');
scanRulesControl.addEventListener('pick-block',()=>command('pickScanBlock'));
function renderBrowse(){
  const body=$('browse-content');
  $('browse').removeAttribute('data-playlist');
  updateCollectionHeader();
  if(browseDetail===null && ['albums','artists'].includes(browsePage) && body.collectionData &&
      body.collectionData.songs===state.songs && body.collectionData.page===browsePage &&
      body.collectionData.source===listCoverVersion && body.collectionData.sort===albumDisplay.sort &&
      body.collectionData.columns===albumDisplay.columns)return;
  body.collectionData=null;
  if(browsePage==='transfer'&&body.querySelector('lume-personal-devices[transfer]'))return;
  if(browsePage==='stats'&&body.querySelector('lume-play-stats')){body.querySelector('lume-play-stats').songs=state.joined?state.songs:state.songs.map(s=>({...s,playCount:state.counts?.[s.id]||0}));return;}
  if(browsePage==='settings'&&browseDetail==='drawer-range'&&$('drawer-range'))return;
  if(browsePage==='settings'&&browseDetail==='dock'&&$('dock-editor')){
    $('page-heading').textContent='底部控制栏';return;
  }
  body.replaceChildren();
  let title=browseNames[browsePage];
  $('browse-back').hidden=browseDetail===null;
  $('browse-back').classList.toggle('detail-exit',isCollectionDetail());
  const likedSongs=state.songs.filter(s=>liked.has(favKey(s.id)));
  const lists=readPreference(playlistKey(),[]);
  if(['artists','albums'].includes(browsePage)){
    const map=groups(browsePage);
    if(browseDetail===null){
      renderCollection(body,browsePage,map);
      body.collectionData={songs:state.songs,page:browsePage,source:listCoverVersion,sort:albumDisplay.sort,columns:albumDisplay.columns};
    }
    else{title=browseDetail;addTracks(body,map.get(title)||[]);}
  }else if(browsePage==='folders'){
    const map=groups(browsePage);
    if(browseDetail!==null){title=browseDetail;addTracks(body,map.get(title)||[]);}
    else{for(const [name,songs] of [...map].sort((a,b)=>a[0].localeCompare(b[0])))body.append(linkRow(name,songs.length+' 首',()=>openBrowse(browsePage,name)));
      if(!map.size)body.append(element('p','导入音乐后即可在这里浏览。','empty'));}
  }else if(browsePage==='playlists'){
    if(browseDetail===null){
      body.append(button('＋ 新建歌单',()=>editList()),linkRow('我的收藏',likedSongs.length+' 首',()=>openBrowse('playlists','favorites')));
      for(const list of lists)body.append(linkRow(list.name,list.songs.filter(id=>state.songs.some(s=>s.id===id)).length+' 首',()=>openBrowse('playlists',list.id)));
    }else if(browseDetail==='favorites'){title='我的收藏';addTracks(body,likedSongs,'在播放页点爱心即可收藏歌曲。');}
    else {const list=lists.find(p=>p.id===browseDetail);if(list){
      title=list.name;
      $('browse').dataset.playlist=list.id;
      body.append(button('编辑歌单',()=>editList(list)),button('删除歌单',()=>confirmPlaylistDeletion(list)));
      addTracks(body,list.songs.map(id=>state.songs.find(s=>s.id===id)).filter(Boolean),'暂无歌曲');
    }}
  }else if(browsePage==='queue'){
    title=state.joined?'空间可点播曲目':'播放列表';
    addTracks(body,queuedSongs());
  }else if(browsePage==='scan'){
    const remote=state.joined&&!state.hosting;
    body.append(element('p',remote?'离开当前空间后，可扫描本机音乐。':'首次选择音乐文件夹并记住授权。以后点击“开始扫描”，查找已选目录及子目录中的新增音乐。','browse-note'));
    const rules=scanRulesControl;
    rules.toggleAttribute('disabled',!!(remote||state.scanning));
    const rescan=button('开始扫描',()=>{
      const {skipShort,blocked,blockedFormats}=window.lumeScanRules.snapshot();
      command('rescan',{skipShort,blocked,blockedFormats});
    },'pill');rescan.disabled=remote||state.scanning;
    const scan=button('选择文件夹',()=>{
      const {skipShort,blocked,blockedFormats}=window.lumeScanRules.snapshot();
      command('scan',{skipShort,blocked,blockedFormats});
    },'pill');scan.disabled=remote||state.scanning;
    const actions=element('div',undefined,'scan-actions');actions.append(rescan,scan);body.append(actions);
    if(state.scanning){
      actions.append(button('终止扫描',()=>command('stopScan'),'pill'));
      const meter=document.createElement('lume-scan-meter');updateScanMeter(meter);body.append(meter);
    }
    const msg=element('p',state.scanning?'':state.scanStatus||'','scan-result');
    msg.setAttribute('role','status');body.append(msg,rules);
  }else if(browsePage==='sources'){
    const hidden=state.songs.filter(s=>s.hidden).length;
    const report=element('lume-library-report');report.songs=state.songs;body.append(report);
    body.append(linkRow(state.joined?(state.host||'空间曲库'):'本机音乐',state.songs.length+' 首',()=>navigate('library')),linkRow('播放空间',state.joined?'已连接':'连接设备',()=>navigate('space')));
    if(!state.joined||state.hosting)body.append(button('导入音乐',()=>command('import')));
    if(hidden&&!state.joined)body.append(button('恢复隐藏歌曲（'+hidden+' 首）',()=>songActions.restore(),'library-restore'));
  }else if(browsePage==='transfer'){
    const panel=document.createElement('lume-personal-devices');panel.setAttribute('transfer','');body.append(panel);
  }else if(browsePage==='stats'){
    const stats=element('lume-play-stats');stats.sourceSlot=$('stats-source-slot');
    stats.songs=state.joined?state.songs:state.songs.map(s=>({...s,playCount:state.counts?.[s.id]||0}));body.append(stats);
  }else if(browsePage==='settings'){
    if(browseDetail==='drawer-range'){
      title='侧边栏拖动范围';
      body.append(drawerRangeSetting());
    }else if(browseDetail==='dock'){
      title='底部控制栏';
      renderDockSettings(body);
    }else{
      body.append(linkRow('本机外观',document.documentElement.dataset.phoneTheme==='light'?'浅色':'深色',toggleTheme),
        switchSetting('主题色随歌曲封面变化',window.lumeCoverTheme.enabled(),enabled=>{
          window.lumeCoverTheme.setEnabled(enabled);
        }),
        window.lumeCover.setting(),
        awakeSetting(),
        linkRow('底部控制栏',dockPages.length+' 项',()=>openBrowse('settings','dock')),
        linkRow('侧边栏拖动范围',drawerRange+'%',()=>openBrowse('settings','drawer-range')));
    }
  }else if(browsePage==='about'){
    body.append(element('h2','澄音 LUME'),element('p','局域网音乐播放器。可以在本机听歌，也可以让同一 Wi-Fi 下的设备一起播放。','browse-note'),element('p',state.model||'','browse-note'));
  }
  $('browse-title').textContent=title;
  $('page-heading').textContent=title;
}

function awakeSetting(){
  return switchSetting('横屏播放时保持屏幕常亮',!!state.landscapeAwake,enabled=>{
    state.landscapeAwake=enabled;command('landscapeAwake',{enabled});
  });
}
