// Keep artwork rotation separate from the square layout/transition bounds.
window.lumeCover = (() => {
  const key = 'lume-phone-round-cover';
  let enabled = readPreference(key, false) === true;
  const album = document.getElementById('album');
  const mini = document.getElementById('mini-art');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let runningSince = null, elapsed = 0, trackId = '', travelling = null;
  function paintRotation() {
    const ms = elapsed + (runningSince === null ? 0 : performance.now() - runningSince);
    const angle = (reducedMotion.matches ? 0 : (ms % 24000) * 360 / 24000) + 'deg';
    mini.style.setProperty('--cover-angle', angle);
    if (enabled) album.style.setProperty('--cover-angle', angle);
    if (travelling?.isConnected) travelling.style.setProperty('--cover-angle', angle);
    else travelling = null;
  }
  function playback(id, playing) {
    const now = performance.now();
    if (trackId !== id) elapsed = 0;
    else if (runningSince !== null) elapsed += now - runningSince;
    trackId = id;
    runningSince = playing ? now : null;
    paintRotation();
  }
  const crops = new Map();
  let imageKey = '', generation = 0;

  // Only remove an unambiguous, uniform frame on all four sides. Artwork with
  // detail at an edge, gradients, or no substantial frame keeps its original crop.
  function measureFrame(image) {
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 192 / Math.max(image.naturalWidth, image.naturalHeight));
    const w = canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    const h = canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d', {willReadFrequently:true});
    context.drawImage(image, 0, 0, w, h);
    const pixels = context.getImageData(0, 0, w, h).data;
    const transparent = pixels[3] < 8;
    const empty = (x, y) => {
      const i = (y*w+x)*4;
      if (transparent) return pixels[i+3] < 8;
      return pixels[i+3] > 247 && Math.abs(pixels[i]-pixels[0]) <= 6 &&
        Math.abs(pixels[i+1]-pixels[1]) <= 6 && Math.abs(pixels[i+2]-pixels[2]) <= 6;
    };
    const row = y => { for(let x=0;x<w;x++) if(!empty(x,y)) return false; return true; };
    const column = x => { for(let y=0;y<h;y++) if(!empty(x,y)) return false; return true; };
    let l=0, r=w, t=0, b=h;
    while(t<h && row(t)) t++;
    while(b>t && row(b-1)) b--;
    while(l<w && column(l)) l++;
    while(r>l && column(r-1)) r--;
    if(Math.min(l,w-r,t,h-b)<2 || r-l<w*.5 || b-t<h*.5) return null;
    // One sample inward removes the antialiased fringe without changing the asset.
    l++; r--; t++; b--;
    const iw=image.naturalWidth, ih=image.naturalHeight;
    const cw=(r-l)*iw/w, ch=(b-t)*ih/h, side=Math.min(cw,ch);
    const sw=iw/side, sh=ih/side;
    const cx=(l+r)*iw/w/2/side, cy=(t+b)*ih/h/2/side;
    const position=(size,center)=>Math.abs(size-1)<.00001?50:100*(.5-center)/(1-size);
    const base=Math.min(iw,ih);
    return {size:`${sw*100}% ${sh*100}%`,
      position:`${position(sw,cx)}% ${position(sh,cy)}%`,
      originalSize:`${iw/base*100}% ${ih/base*100}%`};
  }
  function refreshArtwork() {
    const background = album.style.backgroundImage;
    if(!enabled || background===imageKey) return;
    imageKey=background;
    const request=++generation;
    album.style.removeProperty('--round-cover-size');
    album.style.removeProperty('--round-cover-position');
    mini.style.removeProperty('--round-cover-size');
    mini.style.removeProperty('--round-cover-position');
    const paint=crop=>{
      if(request!==generation || album.style.backgroundImage!==background) return;
      if(crop){
        album.style.setProperty('--round-cover-size',crop.size);
        album.style.setProperty('--round-cover-position',crop.position);
        mini.style.setProperty('--round-cover-size',crop.size);
        mini.style.setProperty('--round-cover-position',crop.position);
      }
    };
    if(crops.has(background)){paint(crops.get(background));return;}
    const match=/^url\(["']?(.*?)["']?\)$/.exec(background);
    if(!match) return;
    const image=new Image();
    image.onload=()=>{
      let crop=null;
      try { crop=measureFrame(image); } catch { /* Unreadable images still use center/cover. */ }
      crops.set(background,crop);
      if(crops.size>24) crops.delete(crops.keys().next().value);
      paint(crop);
    };
    image.src=match[1];
  }
  new MutationObserver(refreshArtwork).observe(album,{attributes:true,attributeFilter:['style']});
  function apply() {
    document.documentElement.toggleAttribute('data-round-cover', enabled);
    paintRotation();
    refreshArtwork();
  }
  function setting() {
    const row = element('label', undefined, 'collection-row cover-setting');
    const input = element('input');
    input.type = 'checkbox'; input.setAttribute('role', 'switch'); input.checked = enabled;
    input.id = 'round-playback-cover';
    input.onchange = () => {
      enabled = input.checked;
      savePreference(key, enabled);
      apply();
    };
    const track = element('span', undefined, 'cover-switch-track');
    track.setAttribute('aria-hidden', 'true');
    row.append(element('strong', '圆形播放封面'), input, track);
    return row;
  }
  function transition(cover, animate) {
    const art = element('span', undefined, 'travelling-cover-image');
    cover.append(art);
    travelling = art;
    paintRotation();
    if (!enabled) {
      // Fade the rotating thumbnail into the upright square artwork.
      art.style.borderRadius = '50%';
      animate(art, [{opacity:1},{opacity:0}]);
      return;
    }
    cover.classList.add('round-cover-motion');
    // Match the animated outer radius, so the mini-player endpoint stays square.
    const startRadius=getComputedStyle(document.getElementById('mini-art')).borderTopLeftRadius;
    const startSide=document.getElementById('mini-art').getBoundingClientRect().width;
    const radius=startRadius.endsWith('%')?startRadius:`${100*parseFloat(startRadius)/startSide}%`;
    animate(cover,[{clipPath:`inset(0 round ${radius})`},{clipPath:'inset(0 round 50%)'}]);
    const crop=crops.get(album.style.backgroundImage);
    const sameImage=cover.style.backgroundImage===album.style.backgroundImage;
    if(crop && sameImage) Object.assign(art.style,{backgroundSize:crop.size,backgroundPosition:crop.position});
  }
  apply();
  return {setting, transition, playback, paintRotation};
})();
