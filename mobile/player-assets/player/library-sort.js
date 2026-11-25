function initLibrarySort() {
  const sheet = $('library-sort'), choices = $('sort-choices'), custom = $('custom-song-order');
  const prefs = Object.assign({mode:'custom', covers:true, filenames:false, next:true}, readPreference('library-display', {}));
  const modes = [
    ['custom','自定义'], ['title','标题'], ['fileName','文件名'],
    ['album','专辑（音轨）'], ['artist','艺术家（专辑）'], ['bytes','大小'], ['year','年份'],
    ['folder','文件夹（标题）'], ['count','播放次数'], ['duration','时长（短→长）'],
    ['durationDesc','时长（长→短）'], ['modifiedAt','修改时间'], ['addedAt','添加时间'],
    ['modifiedDesc','修改时间降序'], ['addedDesc','添加时间降序']
  ];
  const collator = new Intl.Collator('zh-CN', {numeric:true, sensitivity:'base'});
  const text = (a, b) => a && b ? collator.compare(a, b) : Number(!a) - Number(!b);
  function number(a, b, descending = false) {
    const x = parseFloat(a), y = parseFloat(b);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return Number(!Number.isFinite(x)) - Number(!Number.isFinite(y));
    return descending ? y - x : x - y;
  }
  function name(song) { return song.fileName || song.title; }
  function sort(songs) {
    const album = (a,b) => text(a.album,b.album) || number(a.discNumber || 1,b.discNumber || 1) || number(a.trackNumber,b.trackNumber);
    const count = s => (state.joined ? s.playCount : state.counts?.[s.id]) || 0;
    const mode = prefs.mode;
    if (mode === 'custom') {
      const order = readPreference('library-order:'+sourceKey(), []);
      if (Array.isArray(order) && order.length) {
        const index = new Map(order.map((id,i) => [id,i]));
        songs.sort((a,b) => (index.get(a.id) ?? order.length) - (index.get(b.id) ?? order.length));
      }
      return songs;
    }
    // Earlier libraries retained insertion order even before recording import timestamps.
    if (mode === 'addedAt' || mode === 'addedDesc') {
      const index = new Map(songs.map((s,i) => [s.id,i]));
      return songs.sort((a,b) => number(a.addedAt || 0,b.addedAt || 0,mode === 'addedDesc') ||
        (mode === 'addedDesc' ? index.get(b.id)-index.get(a.id) : index.get(a.id)-index.get(b.id)));
    }
    const compare = {
      title: (a,b) => compareInitialLetters(a.title,b.title),
      fileName: (a,b) => compareInitialLetters(name(a),name(b)),
      album, artist: (a,b) => text(a.artist,b.artist) || album(a,b),
      folder: (a,b) => text(a.folder,b.folder), count: (a,b) => count(b)-count(a),
      bytes: (a,b) => number(a.bytes,b.bytes), year: (a,b) => number(a.year,b.year),
      duration: (a,b) => number(a.duration,b.duration), durationDesc: (a,b) => number(a.duration,b.duration,true),
      modifiedAt: (a,b) => number(a.modifiedAt,b.modifiedAt), modifiedDesc: (a,b) => number(a.modifiedAt,b.modifiedAt,true)
    }[mode];
    return compare ? songs.sort((a,b) => compare(a,b) || text(a.title,b.title)) : songs;
  }
  function save() {
    savePreference('library-display', prefs);
    $('library-list').songItems = null;
    library();
  }
  function customView() {
    choices.hidden = true;
    $('sort-display').hidden = true;
    custom.hidden = false;
    $('library-sort-title').textContent = '自定义排序';
    const list = element('ol');
    const songs = sort(state.songs.filter(s => !s.hidden));
    for (const song of songs) {
      const row = element('li');
      row.append(element('span',song.title));
      for (const [label,delta] of [['上移',-1],['下移',1]]) {
        const move = button(delta < 0 ? '↑' : '↓', () => {
          const i = Array.prototype.indexOf.call(list.children,row), j = i + delta;
          if (j < 0 || j >= songs.length) return;
          [songs[i], songs[j]] = [songs[j], songs[i]];
          list.insertBefore(row, delta < 0 ? list.children[j] : list.children[j].nextSibling);
          savePreference('library-order:'+sourceKey(),songs.map(s=>s.id));
          library();
          move.focus({preventScroll:true});
        });
        move.setAttribute('aria-label',label+' '+song.title);
        row.append(move);
      }
      list.append(row);
    }
    custom.replaceChildren(list);
    sheet.querySelector('.settings-sheet-content').scrollTop = 0;
  }
  for (const [index,[mode,title]] of modes.entries()) {
    const item = button(title, () => {
      prefs.mode = mode;
      save();
      if (mode === 'custom') customView();
      else dismissSettingsSheet(sheet);
    });
    if (index === 0 || index >= 9) item.className = 'wide';
    item.dataset.mode = mode;
    choices.append(item);
  }
  for (const control of sheet.querySelectorAll('[data-pref]')) {
    control.checked = prefs[control.dataset.pref];
    control.onchange = () => { prefs[control.dataset.pref] = control.checked; save(); };
  }
  $('library-sort-button').onclick = () => {
    choices.hidden = false;
    $('sort-display').hidden = false;
    custom.hidden = true;
    custom.replaceChildren();
    $('library-sort-title').textContent = '排序';
    for (const item of choices.children) item.setAttribute('aria-pressed',String(item.dataset.mode === prefs.mode));
    sheet.showModal();
    syncBack();
  };
  sheet.addEventListener('close', syncBack);
  return {prefs, sort, name};
}
