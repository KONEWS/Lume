const collectionCollator = new Intl.Collator('zh-CN-u-co-pinyin', {numeric:true,sensitivity:'base'});
const albumDisplay = {sort:'title', columns:2};
const pinyinStarts = Array.from('阿八擦搭蛾发噶哈击喀垃妈拿哦趴期然撒塌挖昔压匝');
const pinyinLetters = 'ABCDEFGHJKLMNOPQRSTWXYZ';

function updateCollectionHeader() {
  $('stats-source-slot').hidden=!(tab==='browse' && browsePage==='stats');
  const catalog = tab==='browse' && ['albums','artists'].includes(browsePage);
  document.body.classList.toggle('collection-page',catalog);
  $('album-options').hidden=!(catalog && browsePage==='albums' && browseDetail===null);
  syncLetterIndexVisibility();
}

function initialLetter(name) {
  const first = Array.from(String(name || '').trim().normalize('NFKD'))[0] || '';
  if (/^[a-z]$/i.test(first)) return first.toUpperCase();
  if (/^\d$/.test(first)) return '0';
  if (/\p{Script=Han}/u.test(first)) {
    for (let i=pinyinStarts.length-1; i>=0; i--)
      if (collectionCollator.compare(first,pinyinStarts[i])>=0) return pinyinLetters[i];
    return 'A';
  }
  return '#';
}

function compareInitialLetters(a,b) {
  const left=initialLetter(a),right=initialLetter(b);
  if(left!==right) {
    if(left==='#' || right==='#')return left==='#'?1:-1;
    return collectionCollator.compare(left,right);
  }
  return collectionCollator.compare(a || '',b || '');
}

function syncLetterIndexVisibility() {
  for(const rail of $('library-frame').querySelectorAll(':scope > .collection-index')) {
    rail.hidden=rail.dataset.page==='library' ? tab!=='library' :
      tab!=='browse' || browseDetail!==null || browsePage!==rail.dataset.page;
  }
}

function collectionIndex(anchors,page) {
  const rail = element('div',undefined,'collection-index');
  rail.setAttribute('role','navigation');
  rail.setAttribute('aria-label','首字母索引');
  rail.dataset.page=page;
  for (const [letter,target] of anchors) {
    const jump = button(letter,()=>target.scrollIntoView({block:'start'}),'index-letter');
    jump.setAttribute('aria-label','跳到 '+letter);
    rail.append(jump);
  }
  function drag(event) {
    const bounds=rail.getBoundingClientRect();
    const buttons=rail.children;
    const index=Math.min(buttons.length-1,Math.max(0,Math.floor((event.clientY-bounds.top)/bounds.height*buttons.length)));
    anchors.get(buttons[index].textContent)?.scrollIntoView({block:'start'});
  }
  rail.onpointerdown = event=>{rail.setPointerCapture(event.pointerId);drag(event);};
  rail.onpointermove = event=>{if (rail.hasPointerCapture(event.pointerId)) drag(event);};
  return rail;
}

function setLetterIndex(anchors,page) {
  $('library-frame').querySelector(`:scope > .collection-index[data-page="${page}"]`)?.remove();
  if(anchors.size>1)$('library-frame').append(collectionIndex(anchors,page));
  syncLetterIndexVisibility();
}

function updateLibraryIndex() {
  const mode=librarySort.prefs.mode;
  const anchors=new Map();
  if(mode==='title' || mode==='fileName') {
    const list=$('library-list');
    for(const [index,song] of (list.songItems || []).entries()) {
      const letter=initialLetter(mode==='fileName'?librarySort.name(song):song.title);
      if(!anchors.has(letter))anchors.set(letter,list.children[index]);
    }
  }
  setLetterIndex(anchors,'library');
}

function renderCollection(body,page,map) {
  if (!map.size) {
    body.append(element('p','导入音乐后即可浏览此分类。','empty'));
    setLetterIndex(new Map(),page);
    return;
  }
  const albums = page==='albums';
  const byYear = albums && albumDisplay.sort==='year';
  const list = element('div',undefined,byYear?'album-year-list':albums?'album-grid':'artist-list');
  list.style.setProperty('--album-columns',albumDisplay.columns);
  const entries = Array.from(map,([name,songs])=>{
    const cover = songs.find(s=>s.coverFile || s.hasSideCover || s.hasCover) || songs[0];
    const year = albums && songs.find(s=>parseInt(s.year)>0)?.year;
    return {name,songs,cover,year:parseInt(year)||0,letter:initialLetter(name)};
  });
  const alphabetic = !albums || albumDisplay.sort==='title';
  entries.sort((a,b)=>{
    if (alphabetic) return compareInitialLetters(a.name,b.name);
    if (!alphabetic) {
      const diff = albumDisplay.sort==='year'? b.year-a.year : b.songs.length-a.songs.length;
      if (diff) return diff;
    }
    return collectionCollator.compare(a.name,b.name);
  });
  const anchors = new Map();
  let lastYear;
  for (const {name,songs,cover,year,letter} of entries) {
    if (byYear && year!==lastYear) {
      list.append(element('h2',year?String(year):'未知年份'));
      lastYear=year;
    }
    const row = button('',()=>openBrowse(page,name),byYear?'album-year-row':albums?'album-card':'artist-row');
    const art = element('lume-list-cover',undefined,'collection-art');
    art.setAttribute('aria-hidden','true');
    libraryCovers.bind(art,cover,!state.joined || state.hosting,albums && !byYear?1024:320);
    const caption = element('span',undefined,'collection-caption');
    const credit = albums && (cover.albumArtist || artist(cover));
    const meta = [songs.length+' 首',!byYear && year,credit].filter(Boolean).join(byYear?'  ':' · ');
    caption.append(element('strong',name),element('small',meta));
    row.append(art,caption);
    list.append(row);
    if (!anchors.has(letter)) anchors.set(letter,row);
  }
  body.append(list);
  setLetterIndex(alphabetic?anchors:new Map(),page);
}

function initAlbumSettings() {
  const saved = readPreference('lume-album-display',{}) || {};
  if (['title','year','count'].includes(saved.sort)) albumDisplay.sort=saved.sort;
  if ([2,3,4].includes(saved.columns)) albumDisplay.columns=saved.columns;
  const sheet = $('album-settings'), content = sheet.querySelector('.settings-sheet-content');
  function choices(key,title,options) {
    const field = element('fieldset');
    field.append(element('legend',title));
    for (const [value,label] of options) {
      const row = element('label'), input = element('input');
      input.type='radio';input.name='album-'+key;input.checked=albumDisplay[key]===value;
      input.onchange=()=>{
        albumDisplay[key]=value;
        content.querySelector('[data-pref="columns"]').hidden=albumDisplay.sort==='year';
        savePreference('lume-album-display',albumDisplay);
        renderBrowse();
        $('scroll').scrollTop=0;
      };
      row.append(input,element('span',label));field.append(row);
    }
    field.dataset.pref=key;
    field.hidden=key==='columns' && albumDisplay.sort==='year';
    content.append(field);
  }
  choices('sort','排序',[['title','标题'],['year','年份'],['count','数量']]);
  choices('columns','最小列数',[[2,'2'],[3,'3'],[4,'4']]);
  $('album-options').onclick=()=>{sheet.showModal();syncBack();};
  sheet.querySelector('.song-sheet-close').onclick=()=>dismissSettingsSheet(sheet);
  sheet.onclose=syncBack;
}
