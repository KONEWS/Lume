const $=id=>document.getElementById(id);
const audio=new Audio();
let appliedTrim=null;
let joined=false, generation=0, latest, version=-1, sound=false, media='', requests='';
async function post(path,body){
  const r=await fetch('/api/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(5000)});
  if(!r.ok)throw Error(r.status===401?'配对码错误或会话已过期':'空间操作失败（'+r.status+'）');
  return r.json();
}
function note(text){$('note').textContent=text;}
function action(body){return post('action',body).catch(e=>note(e.message));}
const controls=createOutputControls($('outputs'),(id,patch)=>action({type:'output',id,patch}));
function sync(){
  const s=latest;
  if(!joined||!s||!sound||!s.playing||!s.media){audio.pause();return;}
  const path=s.media.replace('/api/receiver-media/','/api/listen/');
  if(path!==media){appliedTrim=null;media=path;audio.src=path;}
  audio.volume=Math.max(0,Math.min(1,s.volume));
  const target=s.position+(performance.now()-s.sampledAt-s.delayMs)/1000;
  if(target<0){audio.pause();return;}
  if(audio.readyState){
    if(appliedTrim!==s.delayMs||Math.abs(audio.currentTime-target)>0.16)audio.currentTime=Math.min(target,s.duration);
    appliedTrim=s.delayMs;
  }
  if(audio.paused && !audio.ended)audio.play().catch(e=>{if(e.name!=='AbortError'){sound=false;$('sound').hidden=false;note('请点击启用此设备声音');}});
}
audio.onloadedmetadata=sync;
function draw(s){
  controls(s.outputs,s.selfId);
  const next=JSON.stringify(s.pending);
  if(next!==requests){
    requests=next;$('requests').replaceChildren(...s.pending.map(p=>{
      const card=document.createElement('section');card.textContent=(p.name||p.platform)+' 请求加入 ';
      for(const [label,type] of [['允许加入','join-allow'],['忽略','join-deny']]){
        const b=document.createElement('button');b.textContent=label;b.onclick=()=>action({type,value:p.id});card.append(b);
      }
      return card;
    }));
  }
  if(s.catalog){$('songs').replaceChildren(...s.catalog.map(t=>new Option(t.title,t.id)));version=s.libraryVersion;}
  $('songs').value=s.trackId;$('toggle').textContent=s.roomPlaying?'暂停':'播放';
  $('seek').max=s.duration;if(document.activeElement!==$('seek'))$('seek').value=Math.max(0,s.position);
  sync();
}
async function poll(run){
  try{
    const start=performance.now();
    const s=await post('receiver',{platform:'Windows',model:'Windows 桌面',savedChannel:'stereo',libraryVersion:version});
    if(run!==generation)return;
    s.sampledAt=(start+performance.now())/2;latest=s;draw(s);note('已加入播放空间');
  }catch(e){if(run!==generation)return;latest=null;audio.pause();note(e.message+'，可离开后重新加入');}
  if(run===generation)setTimeout(()=>poll(run),300);
}
async function join(pin){
  const run=++generation;
  $('request').disabled=true;$('code').querySelector('button').disabled=true;
  try{
    if(pin)await post('pair',{code:pin});
    else{
      const ticket=await post('join/request',{platform:'Windows',model:'Windows 桌面'});
      note('等待已加入空间的设备批准');
      let verdict='pending';
      for(let i=0;i<55 && verdict==='pending';i++){
        await new Promise(r=>setTimeout(r,900));verdict=(await post('join/status',ticket)).decision;
      }
      if(verdict!=='allow')throw Error(verdict==='deny'?'申请已被忽略':'申请超时');
    }
    joined=true;version=-1;$('pair').hidden=true;document.querySelector('main').hidden=false;await poll(run);
  }catch(e){note(e.message);}
  finally{$('request').disabled=false;$('code').querySelector('button').disabled=false;}
}
$('request').onclick=()=>join('');
$('code').onsubmit=e=>{e.preventDefault();join($('code').querySelector('input').value);};
$('toggle').onclick=()=>action({type:latest?.roomPlaying?'pause':'play',trackId:latest?.trackId?undefined:$('songs').options[0]?.value});
for(const type of ['previous','next'])$(type).onclick=()=>action({type});
$('songs').onchange=e=>action({type:'play',trackId:e.target.value});
$('seek').onchange=e=>action({type:'seek',position:Number(e.target.value)});
$('sound').onclick=()=>{sound=true;$('sound').hidden=true;sync();};
$('leave').onclick=async()=>{
  ++generation;joined=false;audio.pause();sound=false;latest=null;media='';audio.removeAttribute('src');audio.load();
  await post('receiver',{leave:true}).catch(()=>{});
  $('sound').hidden=false;document.querySelector('main').hidden=true;$('pair').hidden=false;note('已离开空间');
};
fetch('/api/info').then(r=>r.json()).then(info=>$('room').textContent=info.roomName).catch(()=>note('无法连接空间'));
