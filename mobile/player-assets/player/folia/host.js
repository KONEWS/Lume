// Shared by the desktop player and the two native WebViews. Load Folia only while it is visible.
(() => {
  const base = new URL('.', document.currentScript.src);
  const mobile = document.currentScript.hasAttribute('data-mobile');
  // Older mobile builds saved the desktop's disabled cover/background defaults.
  // Repair that preference once; subsequent choices in the studio remain intact.
  if (mobile) try {
    if (localStorage.getItem('lume-mobile-cover-background-v1') !== 'done') {
      localStorage.setItem('use_cover_color_bg','true');
      localStorage.setItem('folia.desktop.backgroundEnabled.v1','true');
      if (!localStorage.getItem('visualizer_background_mode')) localStorage.setItem('visualizer_background_mode','common');
      localStorage.setItem('lume-mobile-cover-background-v1','done');
    }
    // These two layouts use 300/320px desktop line boxes. On a short phone
    // viewport, their built-in overlap fit keeps long wrapped lyrics visible.
    for (const key of ['classic_tuning','partita_tuning']) {
      let stored;
      try {stored=JSON.parse(localStorage.getItem(key));} catch {}
      if (!stored || typeof stored !== 'object' || Array.isArray(stored)) stored={};
      if (!Object.hasOwn(stored,'avoidOverlap'))
        localStorage.setItem(key,JSON.stringify({...stored,avoidOverlap:true}));
    }
  } catch {}
  const styles = {"classic":"流光","cadenza":"心象","partita":"云阶","fume":"浮名","monet":"莫奈","cappella":"群唱","tilt":"倾诉","claddagh":"回环","pendolo":"时计","diorama":"镜台","sonnet":"商籁","tempera":"凝彩","lumiere":"绘光","hanabi":"花火","machi":"町景","nebbia":"雾笺","metaphor":"隐喻","still":"静止"};
  if (mobile) delete styles.still;
  function normalize(mode) {return Object.hasOwn(styles,mode) ? mode : 'classic';}
  function populate(select) {
    for (const [mode, name] of Object.entries(styles)) select.add(new Option(mobile ? name : 'Folia · '+name,mode));
  }
  function preference() {
    try {const mode=localStorage.getItem('lume-lyric-style');const next=normalize(mode);if(mode!==null && mode!==next)save(next);return next;}
    catch {return 'classic';}
  }
  function save(mode) {
    try {localStorage.setItem('lume-lyric-style',normalize(mode));} catch {}
  }
  function mount(container, onError, setup) {
    const frame = document.createElement('iframe');
    // Tap and keyboard interaction belong to the player above this decorative canvas.
    frame.tabIndex = setup ? 0 : -1;
    frame.title = setup ? '歌词样式设置' : 'Folia 歌词';
    frame.style.cssText = 'border:0;width:100%;height:100%;display:block;pointer-events:none';
    if (setup) {frame.style.pointerEvents='auto';frame.style.position='absolute';frame.style.inset='0';}
    container.append(frame);
    const doc = frame.contentDocument;
    if (mobile) doc.documentElement.dataset.mobileLyrics = 'true';
    const platform = document.documentElement.dataset.platform;
    if (platform) doc.documentElement.dataset.platform = platform;
    // Native WebViews report system overlays to the parent. An about:blank iframe does not
    // inherit its CSS variables, so copy them before the renderer's first frame and on rotation.
    function syncInsets() {
      const rootStyle = getComputedStyle(document.documentElement);
      for (const edge of ['top','right','bottom','left']) {
        const name = '--lume-safe-' + edge;
        doc.documentElement.style.setProperty(name, rootStyle.getPropertyValue(name).trim() || '0px');
      }
    }
    syncInsets();
    window.addEventListener('lume-insets-change', syncInsets);
    const policy = doc.createElement('meta');
    policy.httpEquiv = 'Content-Security-Policy';
    policy.content = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src data: blob:; connect-src data: blob:; font-src blob: data:; worker-src blob:; object-src 'none'";
    doc.head.append(policy);
    const css = doc.createElement('link');
    css.rel = 'stylesheet';
    css.href = new URL('stage.css',base);
    doc.head.append(css);
    if (mobile) {
      const mobileSpacing = doc.createElement('link');
      mobileSpacing.rel = 'stylesheet';
      mobileSpacing.href = new URL('mobile-spacing.css',base);
      doc.head.append(mobileSpacing);
    }
    const stage = doc.createElement('div');
    stage.id = 'stage';
    doc.body.append(stage);
    const script = doc.createElement('script');
    let latest, latestAt=0, disposed = false;
    function sync() {
      if (!disposed && latest && frame.contentWindow?.foliaUpdate) {
        const [track,mode,position,playing]=latest;
        // Loading the renderer can take seconds on a phone joining mid-song.
        const current=Math.min(track.duration||Infinity,position+(playing?(performance.now()-latestAt)/1000:0));
        frame.contentWindow.foliaUpdate(track,mode,current,playing);
      }
    }
    frame.contentWindow.foliaFailed = () => {if(!disposed) onError();};
    script.onload = () => {
      if(disposed)return;
      if(!frame.contentWindow?.foliaUpdate){onError();return;}
      setup?.(frame.contentWindow); sync();
    };
    script.onerror = () => {if(!disposed) onError();};
    script.src = new URL('stage.js',base);
    doc.head.append(script);
    return {
      update(track,mode,position,playing) {latest=[track,mode,position,playing];latestAt=performance.now();sync();},
      close() {disposed=true;window.removeEventListener('lume-insets-change',syncInsets);frame.contentWindow?.foliaDispose?.();frame.remove();}
    };
  }
  let editor = null;
  function closeSettings(){if(!editor)return false;editor.dialog.close();return true;}
  function updateSettings(track,mode,pos,playing){editor?.view.update(track,mode,pos,playing);}
  function openSettings(mode,done,{mobileLayout=false}={}){
    if(editor)return;
    const dialog=document.createElement('dialog');
    dialog.setAttribute('aria-label','歌词样式设置');
    dialog.style.cssText='position:fixed;inset:0;width:100%;height:100%;max-width:none;max-height:none;margin:0;border:0;padding:0;border-radius:0;background:#19191d;overflow:hidden';
    document.body.append(dialog);dialog.showModal();
    let choice=normalize(mode);
    const view=mount(dialog,()=>{
      dialog.querySelector('iframe')?.remove();
      const back=document.createElement('button');back.textContent='样式设置未能打开，返回歌词';
      back.style.cssText='margin:calc(16px + var(--lume-safe-top,0px)) calc(16px + var(--lume-safe-right,0px)) calc(16px + var(--lume-safe-bottom,0px)) calc(16px + var(--lume-safe-left,0px))';
      back.onclick=()=>dialog.close();dialog.append(back);
    },win=>{
      win.document.documentElement.classList.add('settings-open');
      win.foliaStudio(styles[mode]?mode:'classic',translationVisible(),next=>{choice=normalize(next);},saveTranslation,()=>dialog.close(),mobileLayout);
      win.document.addEventListener('keydown',event=>{
        if(event.key==='Escape' && !event.defaultPrevented){event.preventDefault();dialog.close();}
      });
      win.focus();
    });
    editor={dialog,view};
    dialog.addEventListener('close',()=>{
      editor=null;view.close();dialog.remove();save(choice);done(choice);
      document.querySelector('.lyrics-screen')?.dispatchEvent(new Event('show-player-controls'));
    },{once:true});
  }
  function translationVisible() {
    try {return localStorage.getItem('lume-lyric-translation') === 'on';} catch {return false;}
  }
  function saveTranslation(show) {
    try {localStorage.setItem('lume-lyric-translation',show ? 'on' : 'off');} catch {}
  }
  function autoHide(page) {
    const events = new AbortController();
    const listen = {signal:events.signal,capture:true};
    let timer, held = false, pointerStart, dragged = false;
    const hidden = () => page.hasAttribute('data-controls-hidden');
    const isControl = target => target instanceof Element && target.closest('button,a,input,select,label,[role="slider"]');
    function hide() {
      clearTimeout(timer);
      page.setAttribute('data-controls-hidden','');
    }
    function arm() {
      clearTimeout(timer);
      if (!held && !hidden()) timer = setTimeout(() => {
        if (CSS.supports('selector(select:open)') && page.querySelector('select:open')) arm();
        else hide();
      },5000);
    }
    function reveal() {page.removeAttribute('data-controls-hidden');arm();}
    function release(e) {
      if (pointerStart && e.clientX !== undefined)
        dragged ||= Math.hypot(e.clientX-pointerStart.x,e.clientY-pointerStart.y)>10;
      pointerStart=null;
      if (held) {held=false;arm();}
    }
    page.addEventListener('pointerdown',e=>{
      if (!e.isPrimary) return;
      pointerStart={x:e.clientX,y:e.clientY}; dragged=false;
      if (isControl(e.target)) {held=true;reveal();}
    },listen);
    page.addEventListener('pointermove',e=>{
      if (pointerStart) dragged ||= Math.hypot(e.clientX-pointerStart.x,e.clientY-pointerStart.y)>10;
    },listen);
    window.addEventListener('pointerup',release,listen);
    window.addEventListener('pointercancel',e=>{dragged=true;release(e);},listen);
    window.addEventListener('blur',release,listen);
    page.addEventListener('click',e=>{
      if (isControl(e.target)) {reveal();return;}
      if (dragged || e.detail===0) return;
      if (!hidden()) {hide();return;}
      const rect=page.getBoundingClientRect();
      const inHeader=[...page.querySelectorAll('.full-head,.lyrics-heading,.lyrics-options')].some(bar=>{
        const bounds=bar.getBoundingClientRect();
        return e.clientX>=bounds.left && e.clientX<bounds.right && e.clientY>=bounds.top && e.clientY<bounds.bottom;
      });
      if (inHeader || e.clientY>=rect.top+rect.height/2) reveal();
    },listen);
    // A blank press can focus the dialog before its click arrives. Let that click decide visibility.
    page.addEventListener('focusin',()=>{if (!pointerStart) reveal();},listen);
    for (const type of ['input','change','keydown','show-player-controls']) page.addEventListener(type,reveal,listen);
    reveal();
    return () => {events.abort();clearTimeout(timer);page.removeAttribute('data-controls-hidden');};
  }
  window.LumeFolia = {styles,populate,preference,save,mount,openSettings,closeSettings,updateSettings,autoHide,translationVisible,saveTranslation};
})();
