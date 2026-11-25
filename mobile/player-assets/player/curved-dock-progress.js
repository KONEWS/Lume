// Trace the floating dock's lower outer outline, beyond the cover and controls.
window.lumeDockProgress=(()=>{
  const mini=document.getElementById('mini'),dock=document.getElementById('phone-dock');
  if(!mini||!dock)return {set(){}};
  const ns='http://www.w3.org/2000/svg';
  const svg=document.createElementNS(ns,'svg');
  svg.id='dock-progress';svg.setAttribute('role','slider');svg.setAttribute('tabindex','0');
  svg.setAttribute('aria-label','播放进度');svg.setAttribute('aria-valuemin','0');svg.setAttribute('aria-valuemax','100');
  svg.innerHTML='<defs><linearGradient id="dock-progress-gradient" gradientUnits="userSpaceOnUse"><stop class="curve-start" offset="0"/><stop class="curve-end" offset="1"/></linearGradient></defs><path class="curve-fill"/><path class="curve-hit"/>';
  mini.after(svg);
  const gradient=svg.querySelector('linearGradient');
  const fill=svg.querySelector('.curve-fill'),hit=svg.querySelector('.curve-hit');
  let fraction=0,total=0,dragging=false,committed=0;
  const clamp=value=>Math.max(0,Math.min(1,Number(value)||0));
  function paint(value){
    fraction=clamp(value);
    fill.style.strokeDasharray=`${total*fraction} ${total}`;
    fill.style.visibility=fraction>0?'visible':'hidden';
    svg.setAttribute('aria-valuenow',String(Math.round(fraction*100)));
  }
  function layout(){
    const m=mini.getBoundingClientRect(),d=dock.getBoundingClientRect();
    if(!m.width||!m.height)return;
    // CSS scales corner radii when adjacent corners exceed the box height.
    // Use that same effective radius so the stroke sits on the painted edge.
    const style=getComputedStyle(mini);
    const radius=(value,axis)=>{
      const part=value.split(/\s+/)[axis]||value.split(/\s+/)[0];
      return part.endsWith('%') ? parseFloat(part)*(axis?m.height:m.width)/100 : parseFloat(part)||0;
    };
    const corners=[style.borderTopLeftRadius,style.borderTopRightRadius,style.borderBottomRightRadius,style.borderBottomLeftRadius]
      .map(value=>[radius(value,0),radius(value,1)]);
    const scale=Math.min(1,
      m.width/(corners[0][0]+corners[1][0]),
      m.width/(corners[3][0]+corners[2][0]),
      m.height/(corners[0][1]+corners[3][1]),
      m.height/(corners[1][1]+corners[2][1]));
    const [leftX,leftY]=corners[3].map(value=>value*scale);
    const [rightX,rightY]=corners[2].map(value=>value*scale);
    const pad=1,width=m.width+pad*2,height=m.height+pad*2;
    svg.style.left=`${m.left-d.left-pad}px`;svg.style.top=`${m.top-d.top-pad}px`;
    svg.style.width=`${width}px`;svg.style.height=`${height}px`;
    const x0=pad,y0=pad+m.height/2,baseline=pad+m.height,endX=pad+m.width;
    const startAngle=Math.PI/3; // Eight o'clock, measured from the bottom toward the left.
    const startX=x0+leftX*(1-Math.sin(startAngle));
    const startY=baseline-leftY*(1-Math.cos(startAngle));
    const curve=`M ${startX} ${startY} `+
      `A ${leftX} ${leftY} 0 0 0 ${x0+leftX} ${baseline} `+
      `L ${endX-rightX} ${baseline} `+
      `A ${rightX} ${rightY} 0 0 0 ${endX} ${baseline-rightY} `+
      `L ${endX} ${y0}`;
    svg.setAttribute('viewBox',`0 0 ${width} ${height}`);
    for(const path of [fill,hit])path.setAttribute('d',curve);
    gradient.setAttribute('x1',String(startX));gradient.setAttribute('x2',String(endX));
    gradient.setAttribute('y1',String(y0));gradient.setAttribute('y2',String(y0));
    total=fill.getTotalLength();paint(dragging?fraction:committed);
  }
  function nearest(event){
    const box=svg.getBoundingClientRect(),x=(event.clientX-box.left)*svg.viewBox.baseVal.width/box.width;
    const y=(event.clientY-box.top)*svg.viewBox.baseVal.height/box.height;
    if(!total)return 0;
    let best=0,distance=Infinity;
    for(let i=0;i<=120;i++){
      const point=hit.getPointAtLength(total*i/120);
      const next=(point.x-x)**2+(point.y-y)**2;
      if(next<distance){distance=next;best=i/120;}
    }
    return best;
  }
  function canSeek(){return !document.getElementById('seek')?.disabled;}
  hit.addEventListener('pointerdown',event=>{
    if(!canSeek())return;
    event.preventDefault();event.stopPropagation();
    dragging=true;hit.setPointerCapture(event.pointerId);paint(nearest(event));
  });
  hit.addEventListener('pointermove',event=>{
    if(!dragging)return;
    event.preventDefault();event.stopPropagation();paint(nearest(event));
  });
  hit.addEventListener('pointerup',event=>{
    if(!dragging)return;
    event.preventDefault();event.stopPropagation();
    dragging=false;paint(nearest(event));
    window.lumeDockSeek?.(fraction);
  });
  hit.addEventListener('pointercancel',()=>{dragging=false;paint(committed);});
  svg.addEventListener('keydown',event=>{
    if(!canSeek())return;
    const step=(event.key==='ArrowLeft'||event.key==='ArrowDown') ? -0.01 :
      (event.key==='ArrowRight'||event.key==='ArrowUp') ? 0.01 : null;
    const target=event.key==='Home'?0:event.key==='End'?1:step===null?null:clamp(fraction+step);
    if(target===null)return;
    event.preventDefault();paint(target);window.lumeDockSeek?.(target);
  });
  if(typeof ResizeObserver==='function'){
    const observer=new ResizeObserver(()=>requestAnimationFrame(layout));
    observer.observe(mini);observer.observe(dock);
  }else window.addEventListener('resize',()=>requestAnimationFrame(layout));
  requestAnimationFrame(layout);
  return {set(value){committed=clamp(value);if(!dragging)paint(committed);}};
})();
