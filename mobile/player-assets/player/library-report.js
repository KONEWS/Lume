(() => {
  const palette=['#72b9b5','#7398d0','#c7a36b','#87939e'];
  function node(tag,text,cls){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el;}
  function chart(title, labels, values, colors) {
    const panel=node('section',undefined,'library-chart');
    panel.append(node('h3',title));
    const total=values.reduce((a,b)=>a+b,0), disc=node('div',undefined,'library-pie'), legend=node('ul');
    disc.setAttribute('aria-hidden','true');
    let end=0;
    const stops=[];
    labels.forEach((label,i)=>{
      const start=end, count=values[i];end+=total?100*count/total:0;
      if(count)stops.push(colors[i]+' '+start+'% '+end+'%');
      const li=node('li'),dot=node('i');dot.style.backgroundColor=colors[i];
      li.append(dot,node('span',label),node('small',count+' 首 · '+(total?(100*count/total).toFixed(count&&count!==total?1:0):0)+'%'));legend.append(li);
    });
    if(stops.length)disc.style.background='conic-gradient('+stops.join(',')+')';
    const row=node('div',undefined,'chart-body');row.append(disc,legend);panel.append(row);return panel;
  }
  class LibraryReport extends HTMLElement {
    set songs(songs){
      const quality={hires:0,lossless:0,lossy:0,unknown:0}, lyrics=[0,0,0];
      let bytes=0,missing=0;
      for(const s of songs){
        quality[Object.hasOwn(quality,s.quality)?s.quality:'unknown']++;
        lyrics[s.hasLyrics===true?0:s.hasLyrics===false?1:2]++;
        if(Number.isFinite(s.bytes)&&s.bytes>=0)bytes+=s.bytes;else missing++;
      }
      const unit=bytes>=1073741824?'GiB':bytes>=1048576?'MiB':bytes>=1024?'KiB':'B';
      const divisor={GiB:1073741824,MiB:1048576,KiB:1024,B:1}[unit];
      const head=node('div',undefined,'library-storage');
      head.append(node('span','音频文件总大小'),node('strong',missing===songs.length&&missing?'未知':(bytes/divisor).toLocaleString(undefined,{maximumFractionDigits:2})+' '+unit),node('small',songs.length+' 首歌曲'+(missing?' · '+missing+' 首大小未知':'')));
      this.replaceChildren(head,chart('歌词覆盖率',['有歌词','无歌词','未知'],lyrics,[palette[0],palette[2],palette[3]]),chart('音质分布',Object.values(globalThis.lumeQualityLabels),Object.values(quality),palette));
    }
  }
  customElements.define('lume-library-report',LibraryReport);
})();
