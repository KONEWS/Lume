// Statistics derive exclusively from persisted playback sessions, never sample data.
globalThis.lumeStats=(()=>{
  const day=globalThis.lumeListening.key;
  const amount=n=>Number.isFinite(n)?Math.max(0,n):0;
  const date=s=>new Date(s+'T00:00:00');
  const plus=(d,n)=>{const v=new Date(d);v.setDate(v.getDate()+n);return v;};
  const sum=(rows,fn)=>rows.reduce((n,r)=>n+fn(r),0);
  const duration=ms=>{const s=Math.floor(amount(ms)/1000);return s>=3600?Math.floor(s/3600)+':'+String(Math.floor(s/60)%60).padStart(2,'0')+':'+String(s%60).padStart(2,'0'):Math.floor(s/60)+':'+String(s%60).padStart(2,'0');};
  function normalize(records=[],songs=[]){
    const catalog=new Map(songs.map(s=>[s.id,s])),seen=new Set();
    return records.filter(r=>r&&r.session&&!seen.has(r.session)&&seen.add(r.session)&&Number.isFinite(r.startedAt)).map(r=>{
      const s=catalog.get(r.id)||{};return {...s,...r,playModeSource:r.playModeSource||(['local','room'].includes(r.source)?r.source:'unknown'),title:r.title||s.title||'未知曲目',artist:r.artist??s.artist??'',album:r.album??s.album??'',source:r.source||'local',sourceType:r.sourceType||'track',listenedMs:amount(r.listenedMs),duration:amount(r.duration||s.duration),completed:r.completed===true,trackKey:(r.source||'local')+'|'+r.id};
    }).sort((a,b)=>a.startedAt-b.startedAt);
  }
  function range(kind='all',now=Date.now(),selected='',from='',to=''){
    const today=new Date(now);today.setHours(0,0,0,0);let start=new Date(today),end=plus(today,1);
    if(kind==='all')return {kind,start:new Date(0),end,label:'全部时间'};
    if(kind==='today')return {kind,start,end,label:'今天 · '+day(start)};
    if(kind==='week'){start.setDate(start.getDate()-(start.getDay()+6)%7);end=plus(start,7);}
    if(kind==='month'){start.setDate(1);end=new Date(start);end.setMonth(end.getMonth()+1);}
    if(kind==='year'){start.setMonth(0,1);end=new Date(start);end.setFullYear(end.getFullYear()+1);}
    if(kind==='day'){start=date(selected||day(today));end=plus(start,1);}
    if(kind==='custom'){start=date(from||day(today));end=plus(date(to||from||day(today)),1);}
    const valid=Number.isFinite(+start)&&Number.isFinite(+end)&&start<end;
    return {kind,start,end,valid,label:valid?day(start)+' — '+day(plus(end,-1)):'请选择有效的起止日期'};
  }
  function scope(all,bounds,{query='',onlyComplete=false}={}){
    if(bounds.valid===false)return [];
    const q=query.trim().toLocaleLowerCase(),first=day(bounds.start),limit=day(bounds.end);
    return all.filter(r=>(!onlyComplete||r.completed)&&(!q||[r.title,r.artist,r.album,r.sourceName].some(s=>(s||'').toLocaleLowerCase().includes(q)))).map(r=>{
      const startsHere=r.startedAt>=+bounds.start&&r.startedAt<+bounds.end;
      const scopedDays=Object.fromEntries(Object.entries(r.days||{}).filter(([d])=>d>=first&&d<limit));
      const scopedHours=Object.fromEntries(Object.entries(r.hours||{}).filter(([d])=>d.slice(0,10)>=first&&d.slice(0,10)<limit));
      const ms=Object.keys(r.days||{}).length?sum(Object.values(scopedDays),amount):startsHere?r.listenedMs:0;
      return {...r,scopeMs:ms,scopeComplete:startsHere&&r.completed,startsHere,scopedDays,scopedHours};
    }).filter(r=>r.startsHere||r.scopeMs>0);
  }
  function summary(rows){return {ms:sum(rows,r=>r.scopeMs),count:rows.filter(r=>r.scopeComplete).length,records:rows.filter(r=>r.startsHere).length,tracks:new Set(rows.map(r=>r.trackKey)).size,artists:new Set(rows.map(r=>r.artist).filter(Boolean)).size};}
  function rank(rows,kind='tracks',sort='count'){
    const groups=new Map();for(const r of rows){const key=kind==='artists'?r.artist||'未知艺术家':kind==='albums'?(r.artist+'|'+r.album):r.trackKey;
      if(kind==='albums'&&!r.album)continue;
      const row=groups.get(key)||{key,id:r.id,title:kind==='artists'?r.artist||'未知艺术家':kind==='albums'?r.album:r.title,artist:kind==='artists'?'':r.artist,album:r.album,count:0,ms:0,last:0,records:0,trackKeys:new Set()};
      row.count+=Number(r.scopeComplete);row.ms+=r.scopeMs;row.records+=Number(r.startsHere);row.last=Math.max(row.last,r.startedAt);row.trackKeys.add(r.trackKey);groups.set(key,row);
    }
    return [...groups.values()].sort((a,b)=>sort==='title'?b.title.localeCompare(a.title):sort==='artist'?b.artist.localeCompare(a.artist):b[sort]-a[sort]||b.count-a.count||b.ms-a.ms||a.title.localeCompare(b.title));
  }
  function trend(rows,bounds,now=Date.now()){
    let start=bounds.kind==='all'?(rows.length?new Date(rows.reduce((first,r)=>Math.min(first,r.startedAt),Infinity)):plus(new Date(now),-6)):new Date(bounds.start);start.setHours(0,0,0,0);
    const end=new Date(Math.min(+bounds.end,now+1)),monthly=end-start>93*86400000;const map=new Map();
    if(monthly)start.setDate(1);
    // Monthly buckets keep multi-year history readable; the detail table retains each bucket.
    for(let cursor=new Date(start),n=0;cursor<end&&n<1200;n++){const key=monthly?day(cursor).slice(0,7):day(cursor);map.set(key,{key,label:monthly?key:day(cursor).slice(5),count:0,ms:0,records:0});if(monthly)cursor.setMonth(cursor.getMonth()+1);else cursor.setDate(cursor.getDate()+1);}
    const bucket=d=>monthly?d.slice(0,7):d;
    for(const r of rows){if(r.startsHere){const item=map.get(bucket(day(new Date(r.startedAt))));if(item){item.count+=Number(r.scopeComplete);item.records++;}}
      const entries=Object.entries(r.scopedDays);if(!entries.length&&r.scopeMs){const item=map.get(bucket(day(new Date(r.startedAt))));if(item)item.ms+=r.scopeMs;}
      for(const [d,ms] of entries){const item=map.get(bucket(d));if(item)item.ms+=amount(ms);}
    }
    return [...map.values()];
  }
  function sessions(rows){
    const groups=[];for(const r of rows.filter(r=>r.scopeMs>0).sort((a,b)=>a.startedAt-b.startedAt)){
      const end=r.lastHeardAt||r.completedAt||r.startedAt+r.listenedMs;let s=groups.at(-1);
      if(!s||r.startedAt-s.end>30*60000){s={start:r.startedAt,end,ms:0,records:0,count:0};groups.push(s);}s.end=Math.max(s.end,end);s.ms+=r.scopeMs;s.records++;s.count+=Number(r.scopeComplete);
    }return groups;
  }
  function activity(rows){
    const days=new Set();for(const r of rows)for(const [d,ms] of Object.entries(r.scopedDays))if(ms>0)days.add(d);
    for(const r of rows)if(r.scopeMs>0&&!Object.keys(r.scopedDays).length)days.add(day(new Date(r.startedAt)));
    let streak=0,longest=0,previous='';for(const d of [...days].sort()){streak=previous&&day(plus(date(previous),1))===d?streak+1:1;longest=Math.max(longest,streak);previous=d;}
    const groups=sessions(rows);return {days:days.size,longest,sessions:groups,averageDay:days.size?summary(rows).ms/days.size:0,averageSession:groups.length?sum(groups,s=>s.ms)/groups.length:0,longestSession:groups.reduce((longest,s)=>Math.max(longest,s.ms),0)};
  }
  function discovery(all,rows){
    const chosen=new Set(rows.filter(r=>r.startsHere).map(r=>r.session)),seen=new Map(),fresh=new Set(),returning=new Set(),rediscovered=new Set();
    for(const r of all){const previous=seen.get(r.trackKey);if(chosen.has(r.session)){if(!previous)fresh.add(r.trackKey);else{if(!fresh.has(r.trackKey))returning.add(r.trackKey);if(r.startedAt-previous>=30*86400000)rediscovered.add(r.trackKey);}}seen.set(r.trackKey,r.startedAt);}
    const counts=new Map();for(const r of rows.filter(r=>r.startsHere))counts.set(r.trackKey,(counts.get(r.trackKey)||0)+1);
    const repeat=sum([...counts.values()],n=>Math.max(0,n-1)),n=summary(rows).records;
    return {fresh:fresh.size,returning:returning.size,rediscovered:rediscovered.size,repeated:[...counts.values()].filter(n=>n>1).length,repeatRate:n?repeat/n:0};
  }
  function distribution(rows,field){const map=new Map();for(const r of rows){const k=r[field]||'unknown';map.set(k,(map.get(k)||0)+r.scopeMs);}return [...map].sort((a,b)=>b[1]-a[1]);}
  function hours(rows){const values=Array(24).fill(0);for(const r of rows)for(const [h,ms] of Object.entries(r.scopedHours))values[Number(h.slice(11,13))]+=amount(ms);return values;}
  function milestones(all,now,rows=scope(all,range('all',now))){
    const s=summary(rows),a=activity(rows),ranks=rank(rows),completed=rows.filter(r=>r.scopeComplete),h=hours(rows),earlier=new Map();let laterFinished=0;
    for(const r of rows){if(!r.startsHere)continue;if(r.completed&&earlier.get(r.trackKey)===false){laterFinished++;earlier.set(r.trackKey,true);}else if(!earlier.has(r.trackKey))earlier.set(r.trackKey,r.completed);}
    return [
      ['总聆听时间',s.ms,100*3600000,'time'],['完整播放次数',s.count,250,'次'],['听完的不同歌曲',new Set(completed.map(r=>r.trackKey)).size,100,'首'],['最长连续聆听',a.longest,7,'天'],
      ['深夜聆听时间',h.reduce((n,ms,hour)=>n+((hour>=22||hour<6)?ms:0),0),5*3600000,'time'],['最长一次聆听',a.longestSession,3600000,'time'],['重新发现的歌曲',discovery(all,rows).rediscovered,10,'首'],
      ['探索过的专辑',rank(rows,'albums').length,100,'张'],['听过的艺术家',s.artists,100,'位'],['单曲最高完整次数',Math.max(0,...ranks.map(r=>r.count)),25,'次'],['累计聆听天数',a.days,30,'天'],
      ['听完至少十次的歌曲',ranks.filter(r=>r.count>=10).length,10,'首'],['后来完整听完的歌曲',laterFinished,20,'首']
    ];
  }
  return {day,date,plus,duration,normalize,range,scope,summary,rank,trend,sessions,activity,discovery,distribution,hours,milestones};
})();
