const quietMotion = matchMedia('(prefers-reduced-motion: reduce)');
let playerMotion = null;
let lyricMotion = null;
let lastAlbumBox;

function playerSettleDuration(open, distance) {
  return open ? 130 + 220 * distance : 105 + 175 * distance;
}

// Transform the live album inside the moving page. Its screen-space center
// follows the finger even though its parent is also moving.
function createPlayerDrag(initial, finished) {
  const page = $('full'), album = $('album'), source = $('mini-art');
  if (album.hidden) return createPlayerMotion(initial, finished);
  const bounds = page.getBoundingClientRect(), art = album.getBoundingClientRect();
  const thumb = source.getBoundingClientRect(), bar = $('mini').getBoundingClientRect();
  if (!art.width || !thumb.width) return createPlayerMotion(initial, finished);

  const lift = Math.max(0, bar.top - bounds.top);
  const dx = thumb.left + thumb.width / 2 - art.left - art.width / 2;
  const dy = thumb.top + thumb.height / 2 - art.top - art.height / 2;
  const startScale = thumb.width / art.width;
  const controls = [page.querySelector('.full-head'), page.querySelector('.full-playback')];
  const travel = Math.max(96, dy);
  let progress = initial, frame = 0, release = null;

  const pagePose = p => 'translate3d(0,' + lift * (1-p) + 'px,0)';
  const albumPose = p => 'translate3d(' + dx * (1-p) + 'px,' +
    (dy-lift) * (1-p) + 'px,0) scale(' + (startScale+p*(1-startScale)) + ')';
  const controlsOpacity = p => Math.max(0, (p-.45)/.55);

  function paint() {
    frame = 0;
    page.style.transform = pagePose(progress);
    album.style.transform = albumPose(progress);
    for (const node of controls) node.style.opacity = String(controlsOpacity(progress));
  }
  function seek(value) {
    progress = Math.max(0, Math.min(1, value));
    if (!frame) frame = requestAnimationFrame(paint);
  }
  function complete() {
    page.style.removeProperty('transform');
    album.style.removeProperty('transform');
    source.style.removeProperty('visibility');
    for (const node of controls) node.style.removeProperty('opacity');
    delete page.dataset.dragging;
    finished();
  }
  function settle(open, velocity) {
    if (release?.target === Number(open)) return;
    cancelAnimationFrame(frame);
    if (release) {
      const {animations, from, target} = release;
      const fraction = animations[0].effect.getComputedTiming().progress ?? 0;
      progress = from + (target-from)*fraction;
      release = null;
      for (const animation of animations) animation.cancel();
    }
    const from = progress, target = Number(open), distance = Math.abs(target - from);
    if (distance < .001 || quietMotion.matches) { complete(); return; }
    const duration = playerSettleDuration(open, distance);
    const slope = Math.max(0, Math.min(2.8, (velocity ?? 0) * duration / (target - from)));
    const timing = {duration, fill:'both', easing:'cubic-bezier(.333333,' +
      Math.max(.25, slope/3) + ',.666667,1)'};
    const alpha = [{opacity:controlsOpacity(from)}];
    const crossing = (.45-from)/(target-from);
    if (crossing>0 && crossing<1) alpha.push({offset:crossing,opacity:0});
    alpha.push({opacity:controlsOpacity(target)});
    const animations = [
      page.animate([{transform:pagePose(from)},{transform:pagePose(target)}],timing),
      album.animate([{transform:albumPose(from)},{transform:albumPose(target)}],timing),
      ...controls.map(node=>node.animate(alpha,timing))
    ];
    // Let the compositor choose the first presentation frame after layout.
    release = {from,target,animations};
    animations[0].finished.then(()=>{
      if (release?.animations !== animations) return;
      release = null;
      for (const animation of animations) animation.cancel();
      complete();
    },()=>{});
  }
  page.dataset.dragging = '';
  source.style.visibility = 'hidden';
  paint();
  return {seek, settle, travel};
}

// Tapping the cover uses the artwork handoff from the dock to the album.
function createPlayerMotion(initial, finished) {
  const page = $('full'), dock = $('mini'), album = $('album');
  const bounds = page.getBoundingClientRect(), bar = dock.getBoundingClientRect();
  const thumb = $('mini-art').getBoundingClientRect();
  const animations = [];
  const timing = {duration: 1000, fill: 'both'};
  function animate(node, frames) {
    const animation = node.animate(frames, timing);
    animation.pause();
    animation.currentTime = initial * timing.duration;
    animations.push(animation);
    return animation;
  }
  const material = document.createElement('div');
  material.className = 'morph-material';
  page.prepend(material);
  animate(material,[{opacity:1},{opacity:1,offset:.83},{opacity:0}]);
  // Measure both endpoints in screen coordinates before moving the sheet.
  let slot=album;
  if(album.hidden){
    slot=document.createElement('div');slot.className='return-cover';
    if(lastAlbumBox)Object.assign(slot.style,lastAlbumBox);
    page.append(slot);
  }
  const art=slot.getBoundingClientRect(), source=$('mini-art');
  const cover=document.createElement('div');
  cover.className='travelling-cover';
  cover.setAttribute('aria-hidden','true');
  const style=getComputedStyle(source), endStyle=getComputedStyle(slot);
  const size=Math.min(art.width,art.height);
  if(size>0 && thumb.width>0){
    Object.assign(cover.style,{width:size+'px',height:size+'px',backgroundImage:style.backgroundImage,
      backgroundColor:style.backgroundColor});
    document.body.append(cover);
    window.lumeCover.transition(cover, animate);
    slot.style.visibility='hidden';source.style.visibility='hidden';
    const startSize=Math.min(thumb.width,thumb.height);
    function corner(radius,side){
      return radius.endsWith('%')?radius:Math.min(50,100*parseFloat(radius)/side)+'%';
    }
    function pose(box,scale){
      return 'translate3d('+(box.left+box.width/2-size/2)+'px,'+
        (box.top+box.height/2-size/2)+'px,0) scale('+scale+')';
    }
    animate(cover,[
      {transform:pose(thumb,startSize/size),borderRadius:corner(style.borderTopLeftRadius,startSize)},
      {transform:pose(art,1),borderRadius:corner(endStyle.borderTopLeftRadius,size),opacity:slot===album?1:0}
    ]);
  }
  const lift=Math.max(0,bar.top-bounds.top);
  const homeCover=document.querySelector('#home:not([hidden]) .hero-cover');
  if(homeCover)animate(homeCover,[{opacity:1},{offset:.28,opacity:0},{opacity:0}]);
  animate(page,[{transform:'translateY('+lift+'px)',opacity:0,borderRadius:'24px 24px 0 0'},
    {offset:.16,opacity:.95},{transform:'translateY(0px)',opacity:1,borderRadius:'0px'}]);
  const controls = page.querySelectorAll('.full-head,.full-playback > *,#lyrics-panel:not([hidden]),#folia-stage:not([hidden]),#folia-translation:not([hidden])');
  for (const node of controls) animate(node, [{opacity:0},{opacity:0,offset:.45},{opacity:1}]);
  // Fade a plain surface over the dock and list. Fading their parent would
  // promote the entire visible catalog to a new opacity layer halfway through the drag.
  const backdrop=document.createElement('div');
  backdrop.className='player-drag-backdrop';
  page.before(backdrop);
  animate(backdrop,[{opacity:0},{opacity:0,offset:.58},{opacity:1,offset:.83},{opacity:1}]);
  let frame = 0, seekFrame = 0, progress = initial;
  function paintProgress() {
    seekFrame=0;
    for(const animation of animations)animation.currentTime=progress*timing.duration;
  }
  function seek(value) {
    progress = Math.max(0, Math.min(1,value));
    if(!seekFrame)seekFrame=requestAnimationFrame(paintProgress);
  }
  function complete() {
    cancelAnimationFrame(seekFrame);seekFrame=0;
    for (const animation of animations) animation.cancel();
    material.remove();backdrop.remove();
    cover.remove();source.style.removeProperty('visibility');slot.style.removeProperty('visibility');
    if(slot!==album)slot.remove();
    finished();
  }
  function settle(open,velocity) {
    cancelAnimationFrame(frame);
    cancelAnimationFrame(seekFrame);seekFrame=0;
    const target=Number(open), from=progress, distance=Math.abs(target-from);
    if (!distance || quietMotion.matches || !bar.height) { complete(); return; }
    const start=performance.now(), duration=playerSettleDuration(open, distance);
    const slope=velocity===undefined?2.4:Math.max(0,Math.min(2.8,velocity*duration/(target-from)));
    function advance(now){
      const t=Math.min(1,(now-start)/duration);
      progress=from+(target-from)*(t*t*(3-2*t)+slope*t*(1-t)*(1-t));
      paintProgress();
      if(t<1)frame=requestAnimationFrame(advance);
      else complete();
    }
    frame=requestAnimationFrame(advance);
  }
  return {seek,settle,travel:Math.max(96,thumb.top+thumb.height/2-art.top-art.height/2)};
}

// Move the entire player for the dedicated Folia page, including its transport.
function changeMoreLyrics(enter, update) {
  lyricMotion?.skipTransition();
  if(quietMotion.matches || playerMotion){update();return;}
  const page=$('full');
  function slideLivePage(){
    return page.animate([{transform:'translateX('+(enter ? 100 : -100)+'%)'}, {transform:'none'}],
      {duration:360,easing:'cubic-bezier(.2,.7,.25,1)'}).finished.catch(()=>{});
  }
  if(!document.startViewTransition){
    update();slideLivePage();return;
  }
  const root=document.documentElement;
  root.dataset.moreSlide=enter?'enter':'return';
  const transition=document.startViewTransition(update);
  lyricMotion=transition;
  // Keep the native window unchanged throughout the horizontal page transition.
  transition.ready.then(()=>transition.finished,()=>slideLivePage()).finally(()=>{
    if(lyricMotion!==transition)return;
    delete root.dataset.moreSlide;lyricMotion=null;
    syncPlayerOrientation();
  });
}

function changeLyricPage(toLyrics, update) {
  if (lyricMotion) lyricMotion.skipTransition();
  const page = $('full');
  if (toLyrics && !$('album').hidden) {
    const art = $('album').getBoundingClientRect(), bounds = page.getBoundingClientRect();
    lastAlbumBox = {left:(art.left-bounds.left)/bounds.width*100+'%',
      top:(art.top-bounds.top)/bounds.height*100+'%',width:art.width/bounds.width*100+'%',
      borderRadius:getComputedStyle($('album')).borderRadius};
  }
  if (quietMotion.matches || playerMotion) { update(); return; }
  if (landscape.matches) {
    update();
    const incoming = toLyrics ? page.querySelector('#lyrics-panel:not([hidden]),#folia-stage:not([hidden])') : page.querySelector('.seek');
    const controls = toLyrics ? page.querySelector('.translation-tools') : page.querySelector('.transport');
    for (const node of [incoming, controls]) node?.animate([
      {opacity:0, transform:'translateX(' + (toLyrics ? 10 : -10) + 'px)'},
      {opacity:1, transform:'none'}
    ], {duration:180, easing:'ease-out'});
    return;
  }
  if (!document.startViewTransition) {
    update();
    const incoming = page.querySelector('#album:not([hidden]),#lyrics-panel:not([hidden]),#folia-stage:not([hidden])');
    incoming?.animate([{transform:'translateX(' + (toLyrics ? 24 : -24) + '%)',opacity:0},
      {transform:'none',opacity:1}], {duration:240,easing:'ease-out'});
    return;
  }
  page.dataset.lyricDirection = toLyrics ? 'forward' : 'back';
  document.documentElement.dataset.lyricDirection = page.dataset.lyricDirection;
  const transition = document.startViewTransition(update);
  lyricMotion = transition;
  transition.finished.finally(() => {
    if (lyricMotion !== transition) return;
    delete page.dataset.lyricDirection;
    delete document.documentElement.dataset.lyricDirection;
    lyricMotion = null;
  });
}

function bindPlayerSwipes() {
  let drag = null;
  function cancel() {
    const previous = drag; drag = null;
    if (previous?.motion && playerMotion === previous.motion) player(previous.open);
  }
  document.addEventListener('touchstart', event => {
    if (event.touches.length !== 1) { cancel(); return; }
    const target=event.target;
    const homeSwipe=tab==='home'&&!expanded&&!drawerOpen&&target.closest('#home,#phone-dock');
    if (playerMotion || target.closest('input,select,textarea,.seek-rail,dialog') ||
        (!homeSwipe&&!target.closest(expanded ? '#full' : '#mini'))) return;
    const finger=event.touches[0];
    const scroller=target.closest('#lyrics-panel,#full');
    drag={id:finger.identifier,x:finger.clientX,y:finger.clientY,open:expanded,
      homeSwipe,fromDock:Boolean(target.closest('#phone-dock')),
      miniTitle:!expanded && Boolean(target.closest('#mini')),
      volumeZone:moreLyrics && finger.clientX>=innerWidth*.65 && !target.closest('button,select,input,label,.seek,.full-head,.full-playback'),
      scrollTop:scroller?.scrollTop || 0,axis:'',samples:[[event.timeStamp,finger.clientY]]};
  }, {passive:true});
  function sample(y,time) {
    const samples=drag.samples;
    samples.push([time,y]);
    while(samples.length>1 && samples[0][0]<time-110)samples.shift();
  }
  document.addEventListener('touchmove', event => {
    if (!drag) return;
    const touch=event.touches[0];
    if (event.touches.length!==1 || touch.identifier!==drag.id) { cancel(); return; }
    const dx=touch.clientX-drag.x, dy=touch.clientY-drag.y;
    if (!drag.axis) {
      if (Math.max(Math.abs(dx),Math.abs(dy))<7) return;
      if (Math.abs(dx)>Math.abs(dy)*1.25) drag.axis='horizontal';
      else if (Math.abs(dy)>Math.abs(dx)*1.25) {
        if (drag.homeSwipe && !(drag.fromDock && dy<0)) drag.axis='home-dock';
        else if (drag.volumeZone) {drag.axis='volume';command('mediaVolumeStart');}
        else if (moreLyrics) {drag=null;return;}
        else if ((drag.open && (dy<0 || drag.scrollTop>1)) || (!drag.open && dy>0)) { drag=null; return; }
        else drag.axis='vertical';
      } else return;
    }
    if(drag.axis==='home-dock'){
      if(Math.abs(dy)>=28 && tab==='home' && !drawerOpen && !expanded){
        const side=dy>0?'mini':'nav';
        if($('phone-dock').dataset.open!==side)showDockSide(side,false);
        drag=null;
      }
      return;
    }
    if(drag.homeSwipe&&drag.axis==='horizontal'&&!drag.miniTitle){drag=null;return;}
    if (!event.cancelable) { cancel(); return; }
    event.preventDefault();
    if (drag.axis==='volume') command('mediaVolumeDrag',{delta:-dy/(innerHeight*.7)});
    else if (drag.axis==='vertical') {
      drag.motion ||= preparePlayerMotion(createPlayerDrag);
      drag.motion.seek(Number(drag.open)-dy/drag.motion.travel);
      sample(touch.clientY,event.timeStamp);
    }
  }, {passive:false});
  document.addEventListener('touchend', event => {
    if (!drag) return;
    const end=Array.from(event.changedTouches).find(t=>t.identifier===drag.id);
    if (!end) return;
    if (drag.axis && drag.axis!=='home-dock' && event.cancelable) event.preventDefault();
    const dx=end.clientX-drag.x;
    if (drag.motion && drag.motion===playerMotion) {
      const dy=end.clientY-drag.y, [time,y]=drag.samples[0];
      const elapsed=event.timeStamp-time;
      const speed=elapsed>0 && elapsed<=150 ? (end.clientY-y)/elapsed : 0;
      const progress=Number(drag.open)-dy/drag.motion.travel;
      const flick=Math.abs(dy)>=18 && Math.abs(speed)>=.55;
      player(flick ? speed<0 : progress>=.5,-speed/drag.motion.travel);
    } else if (drag.axis==='horizontal' && Math.abs(dx)>48) {
      if(drag.open)swipeLyricPage(dx);
      else if(drag.miniTitle)command(dx<0?'next':'previous');
    }
    drag=null;
  }, {passive:false});
  document.addEventListener('touchcancel',cancel);
  window.addEventListener('blur',cancel);
  window.addEventListener('resize',cancel);
  return () => { drag=null; };
}

function pulsePlayButton(button) {
  const halo = button.querySelector('.play-halo');
  for (const previous of halo.getAnimations()) previous.cancel();
  const frames = quietMotion.matches ? [{opacity:.35},{opacity:0}] :
    [{opacity:.58,transform:'scale(.7)'},{opacity:.35,offset:.35},{opacity:0,transform:'scale(1.25)'}];
  halo.animate(frames,{duration:260,easing:'ease-out'});
}
