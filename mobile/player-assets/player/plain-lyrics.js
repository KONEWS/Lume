window.lumePlain=(()=>{
  const get=id=>document.getElementById(id);
  let changed=()=>{},settings={};
  const progressStates=new WeakMap();
  const scrollStates=new WeakMap(),rowAnimations=new WeakMap();
  const fields={fontSize:'plain-font-scale',weight:'plain-font-weight',center:'plain-center',blur:'plain-blur',stagger:'plain-stagger',romaji:'plain-romaji',karaoke:'plain-karaoke',hideControls:'plain-hide-controls'};
  function preference(){return {...settings};}
  function apply(){
    const panel=get('lyrics-panel'),full=get('full');
    panel.style.setProperty('--plain-font-size',settings.fontSize+'px');
    panel.style.setProperty('--plain-weight',settings.weight);
    panel.style.setProperty('--plain-align',settings.center?'center':'start');
    panel.classList.toggle('plain-no-blur',!settings.blur);
    full.classList.toggle('plain-hide-controls',settings.hideControls);
    get('plain-scale-value').value=settings.fontSize;get('plain-weight-value').value=settings.weight;
    for(const id of ['plain-font-scale','plain-font-weight']){
      const input=get(id);input.style.setProperty('--range-fill',100*(Number(input.value)-Number(input.min))/(Number(input.max)-Number(input.min))+'%');
    }
  }
  function init(saved,onChange){
    changed=onChange;
    settings={fontSize:23,weight:300,center:false,blur:true,stagger:true,romaji:'auto',karaoke:'always',hideControls:true,...saved};
    settings.fontSize=Math.max(14,Math.min(42,Number(settings.fontSize)||23));
    settings.weight=Math.max(100,Math.min(900,Number(settings.weight)||300));
    for(const [key,id] of Object.entries(fields)){
      const input=get(id),check=input.type==='checkbox';
      if(check)input.checked=settings[key];else input.value=settings[key];
      input.addEventListener(input.type==='range'?'input':'change',()=>{
        settings[key]=check?input.checked:input.type==='range'?input.valueAsNumber:input.value;
        apply();changed();
      });
    }
    apply();
  }
  function parse(text,parseLyrics){
    const result=parseLyrics(text);
    for(const row of result.rows){
      const translations=[];let romanization='';
      for(const line of (row.translation||'').split('\n')){
        const explicit=/^(?:\[(?:romaji|romanization|罗马音)\]|(?:romaji|romanization|罗马音)\s*[:：])\s*/i;
        if(explicit.test(line))romanization=line.replace(explicit,'');
        else if(/[\u3040-\u30ff]/.test(row.text)&&/^[a-z\s\d\p{P}āīūēōâîûêô]+$/iu.test(line)&&/[a-z]/i.test(line))romanization=line;
        else if(line)translations.push(line);
      }
      row.translation=translations.join('\n');
      if(romanization&&settings.romaji!=='never'&&(settings.romaji==='always'||/[\u3040-\u30ff]/.test(row.text)))row.romanization=romanization;
    }
    return result;
  }
  function row(line){
    const p=document.createElement('p');
    if(line.words?.length&&settings.karaoke!=='never')for(const word of line.words){const span=document.createElement('span');span.className='plain-word';span.textContent=word.text;p.append(span);}
    else p.textContent=line.text;
    if(line.romanization){const sub=document.createElement('small');sub.className='lyric-romaji';sub.textContent=line.romanization;p.append(sub);}
    return p;
  }
  function progress(panel,rows,position,duration,playing){
    if(settings.karaoke==='never')return;
    let clock=progressStates.get(panel);
    if(!clock||clock.rows!==rows||clock.first!==panel.firstElementChild||clock.duration!==duration||clock.mode!==settings.karaoke){
      const words=[];
      rows.forEach((row,i)=>{
        const spans=panel.children[i]?.querySelectorAll('.plain-word');
        row.words?.forEach((word,j)=>{
          const span=spans?.[j];if(!span)return;
          const end=word.endTime??row.words[j+1]?.startTime??rows[i+1]?.time??duration;
          const smooth=settings.karaoke==='always'||(end>word.startTime&&end-word.startTime<15);
          words.push({span,start:word.startTime,end,smooth,fill:-1});
        });
      });
      words.sort((a,b)=>a.start-b.start);
      clock={rows,first:panel.firstElementChild,duration,mode:settings.karaoke,words,active:new Set(),next:0,position:Infinity};
      progressStates.set(panel,clock);
    }
    function paint(word,fill){
      if(word.fill===fill)return;
      word.fill=fill;word.span.style.setProperty('--word-progress',fill*100+'%');
    }
    const fillAt=word=>word.smooth?Math.max(0,Math.min(1,(position-word.start)/Math.max(.01,word.end-word.start))):Number(position>=word.start);
    // A backwards seek resets once. Normal frames only visit words currently
    // being sung, including overlapping lines, instead of the entire lyric DOM.
    if(position<clock.position){
      clock.active.clear();clock.next=0;
      // Native samples can make a tiny backwards correction. Do not clear and
      // refill every completed word (or flash the line) on that correction.
      for(const word of clock.words){
        const fill=fillAt(word);paint(word,fill);
        if(word.start<=position){clock.next++;if(fill<1)clock.active.add(word);}
      }
    }
    while(clock.next<clock.words.length&&clock.words[clock.next].start<=position)clock.active.add(clock.words[clock.next++]);
    for(const word of clock.active){
      const fill=fillAt(word);
      paint(word,fill);
      if(fill===1)clock.active.delete(word);
    }
    clock.position=position;
  }
  function stagger(rows,index,animate){
    if(!settings.stagger||!animate)return;
    const changes=[];
    for(let i=Math.max(0,index-2);i<Math.min(rows.length,index+5);i++){
      const previous=rowAnimations.get(rows[i]);
      const from=previous?getComputedStyle(rows[i]).transform:'none';
      changes.push({row:rows[i],previous,from,distance:Math.abs(i-index)});
    }
    for(const {row,previous,from,distance} of changes){
      // Retarget our own motion from its current visual position. Cancelling
      // all getAnimations() also cancelled the active-line opacity/blur fade.
      previous?.cancel();
      const animation=row.animate([{transform:from},{transform:'translateY('+Math.min(8,distance*2)+'px)',offset:.3},{transform:'none'}],
        {duration:300+distance*25,easing:'ease-out'});
      rowAnimations.set(row,animation);
      animation.onfinish=()=>{if(rowAnimations.get(row)===animation)rowAnimations.delete(row);};
    }
  }
  function follow(panel,index,animate){
    const row=panel.children[index];if(!row)return;
    // offsetTop ignores decorative transforms. Read before changing active-row
    // styles or word fills so a line boundary does not force write/read layout.
    const target=Math.max(0,Math.min(panel.scrollHeight-panel.clientHeight,row.offsetTop+(row.offsetHeight-panel.clientHeight)/2));
    let motion=scrollStates.get(panel);
    if(!motion){motion={target,position:panel.scrollTop,velocity:0,stamp:0,frame:0};scrollStates.set(panel,motion);}
    motion.target=target;
    if(!animate){
      cancelAnimationFrame(motion.frame);motion.frame=0;motion.velocity=0;
      motion.position=target;panel.scrollTop=target;
      for(const child of panel.children){rowAnimations.get(child)?.cancel();rowAnimations.delete(child);}
      return;
    }
    stagger(panel.children,index,true);
    if(motion.frame)return; // Adjacent lines retarget without restarting or stopping.
    motion.position=panel.scrollTop;motion.stamp=performance.now();
    function tick(now){
      if(!panel.isConnected||panel.hidden||document.hidden){motion.frame=0;motion.velocity=0;return;}
      const dt=Math.min(.05,Math.max(0,(now-motion.stamp)/1000));motion.stamp=now;
      const displacement=motion.position-motion.target,rate=18;
      const momentum=motion.velocity+rate*displacement,decay=Math.exp(-rate*dt);
      motion.position=motion.target+(displacement+momentum*dt)*decay;
      motion.velocity=(motion.velocity-rate*momentum*dt)*decay;
      panel.scrollTop=motion.position;
      if(Math.abs(motion.position-motion.target)<.25&&Math.abs(motion.velocity)<1){panel.scrollTop=motion.target;motion.frame=0;motion.velocity=0;return;}
      motion.frame=requestAnimationFrame(tick);
    }
    motion.frame=requestAnimationFrame(tick);
  }
  function source(value,remote){
    const label={embedded:'EMBEDDED · 内嵌歌词',sidecar:'SIDECAR · 外置歌词',none:'暂无歌词',unknown:'来源未提供'}[value]||'来源未提供';
    get('plain-lyrics-source').textContent=(remote&&value!=='none'?'播放空间 · ':'')+label;
  }
  return {init,preference,parse,row,progress,stagger,follow,source};
})();
