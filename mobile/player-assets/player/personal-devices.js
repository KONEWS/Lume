(() => {
  const pending=new Map();
  let sequence=0;
  window.lumePersonalReply=(token,value)=>{const reply=pending.get(token);if(reply)reply(value);};
  async function request(op,params={}){
    let reply;
    if(window.LumeNative){
      const token=++sequence;
      reply=await new Promise((resolve,reject)=>{
        const timer=op==='pickFile'||op==='offerFile'||op==='offer'?null:setTimeout(()=>{pending.delete(token);reject(Error('设备响应超时'));},8000);
        pending.set(token,value=>{clearTimeout(timer);pending.delete(token);resolve(value);});
        window.LumeNative.dispatch(JSON.stringify({type:'personal',op,token,...params}));
      });
    }else{
      const response=await fetch('/api/personal',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...params})});
      reply=await response.json();
    }
    if(reply.error)throw Error(reply.error);
    return reply;
  }
  const node=(tag,text)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;return el;};
  window.lumePersonalRequest=request;
  function progress(item,label){
    const row=node('div');row.className='personal-progress';
    const total=Number(item.bytes)||0,done=Math.min(total,Math.max(0,Number(item.received)||0));
    const percent=total?Math.floor(100*done/total):0;
    const meter=node('progress');meter.max=total||1;meter.value=done;meter.setAttribute('aria-label',label+' '+item.title);
    const metrics=node('small',percent+'% · '+[done,total].map(v=>(v/1048576).toFixed(2)+' MiB').join(' / '));
    metrics.title=[done,total].map(v=>v.toLocaleString()+' 字节').join(' / ');
    row.append(node('strong',item.title),node('span',label),meter,metrics);return row;
  }
  const fingerprint=id=>(id||'').slice(0,12).match(/.{1,4}/g)?.join(' ').toUpperCase()||'';
  function button(text,action){
    const b=node('button',text);b.type='button';b.onclick=action;return b;
  }
  class PersonalDevices extends HTMLElement{
    connectedCallback(){
      if(!this.heading)this.build();
      this.onState=e=>this.render(e.detail);window.addEventListener('lume-personal-state',this.onState);this.refresh();
    }
    disconnectedCallback(){window.removeEventListener('lume-personal-state',this.onState);}
    build(){
      this.heading=node('h3','我的设备');this.identity=node('p');this.list=node('div');this.incoming=node('div');
      this.feedback=node('p');this.feedback.setAttribute('role','status');
      this.manual=node('details');this.manual.append(node('summary','按局域网地址查找'));
      const addr=node('input');addr.placeholder='例如 192.168.1.20';addr.setAttribute('aria-label','设备 IPv4 地址');
      this.manual.append(addr,button('查找设备',()=>this.run('find',{address:addr.value.trim()})));
      this.form=node('div');this.form.className='personal-transfer';
      this.desktop=Boolean(window.lumeDesktop);
      this.systemPicker=this.desktop||Boolean(window.LumeNative);
      this.song=node(this.systemPicker?'output':'select');this.target=node('select');this.song.setAttribute('aria-label','选择本机歌曲');this.target.setAttribute('aria-label','选择目标设备');
      const sender=button('发送歌曲',async()=>{
        if(!this.systemPicker)return this.run('offer',{id:this.song.value,peer:this.target.value});
        sender.disabled=true;
        try{
          const result=this.desktop?await window.lumeDesktop.sendTransferFile(this.selection.token,this.target.value):
            await request('offerFile',{id:this.selection.selection,peer:this.target.value});
          this.selection=null;this.song.textContent='';this.form.hidden=true;this.render(result);
          this.feedback.textContent=result.message;
        }catch(e){this.feedback.textContent=e.message;}
        finally{sender.disabled=!this.hasSong()||!this.target.length;}
      });
      const chosen=node('label','已选歌曲'),targetLabel=node('label','目标设备');
      chosen.append(this.song);targetLabel.append(this.target);this.form.append(chosen,targetLabel,sender);
      const picker=node('div');picker.className='personal-picker';
      picker.append(button('选择歌曲传送',async()=>{try{
          if(this.systemPicker){
            const picked=this.desktop?await window.lumeDesktop.pickTransferFile():await request('pickFile');
            if(!picked?.name)return;
            this.selection=picked;this.song.textContent=picked.name;
          }else{
            const {songs}=await request('library');
            this.song.replaceChildren(...songs.filter(s=>!s.hidden).map(s=>new Option([s.title,s.artist].filter(Boolean).join(' · '),s.id)));
          }
          this.form.hidden=false;sender.disabled=!this.hasSong()||!this.target.length;
          if(sender.disabled)this.feedback.textContent=this.hasSong()?'请先在播放空间的「我的设备」中请求授权':'本机曲库暂无歌曲';
        }catch(e){this.feedback.textContent=e.message;}}),node('small','单首最多 500 MiB'));
      if(this.hasAttribute('transfer')){
        const sendGroup=node('section');sendGroup.className='personal-send-group';
        sendGroup.append(node('h2','发送歌曲'),picker,this.form);
        this.activity=node('section');this.activity.className='personal-activity';
        this.activity.append(node('h2','传输状态'),this.incoming);
        this.append(sendGroup,this.activity,this.feedback);
      }else{
        const devices=node('details');devices.className='personal-manage';
        this.self=button('本机',()=>window.dispatchEvent(new Event('lume-edit-device-name')));
        this.self.setAttribute('aria-label','编辑本机名称');
        this.self.className='self-name-row';
        devices.append(node('summary','我的设备'),this.self,this.identity,node('p','核对设备编号并发送授权请求。对方同意后，两台设备会在同一局域网自动合并播放记录。'),this.list,this.manual,this.feedback);
        this.append(devices);
      }
      this.sender=sender;this.form.hidden=true;
    }
    hasSong(){return this.systemPicker?Boolean(this.selection):Boolean(this.song.length);}
    async run(op,args){
      try{const data=await request(op,args);this.render(data);this.feedback.textContent=data.message||'已更新';}
      catch(e){this.feedback.textContent=e.message;}
    }
    async refresh(){
      if(this.loading)return;this.loading=true;
      try{this.render(await request('status'));}catch(e){this.feedback.textContent=e.message;}finally{this.loading=false;}
    }
    render(data){
      const peers=data.peers||[],offers=data.offers||[];
      const outgoing=data.outgoing||[],files=data.files||[],recent=data.recent||[];
      const model=JSON.stringify([data.id,data.name,peers,offers,files,outgoing,recent,data.message,data.addresses]);
      if(this.model===model)return;this.model=model;
      if(this.self){
        this.self.textContent='本机 · '+(data.name||'当前设备');
        this.self.setAttribute('aria-label',this.self.textContent+'，编辑名称');
      }
      this.identity.textContent='本机编号 '+fingerprint(data.id)+(data.addresses?.length?' · '+data.addresses.join(' / '):'');
      this.list.replaceChildren();
      if(!peers.length)this.list.append(node('p','正在查找附近的澄音设备…'));
      for(const p of peers){
        const row=node('div');row.className='personal-row';const name=node('span');
        name.append(node('strong',p.name),node('small',fingerprint(p.id)+' · '+(p.trusted?(p.synced?'已同步':p.online?'等待对方授权或同步':'已授权 · 离线'):'待授权')));
        const action=button(p.trusted?'取消授权':p.requestPending?'等待对方确认':'授权设备',()=>this.run(p.trusted?'forget':'trust',{peer:p.id}));action.disabled=Boolean(p.requestPending);row.append(name,action);this.list.append(row);
      }
      const target=this.target.value;
      const targets=peers.filter(p=>p.trusted&&p.synced);
      const optionsKey=JSON.stringify(targets.map(p=>[p.name,p.id]));
      if(this.optionsKey!==optionsKey){this.optionsKey=optionsKey;this.target.replaceChildren(...targets.map(p=>new Option(p.name,p.id)));}
      if([...this.target.options].some(o=>o.value===target))this.target.value=target;
      this.sender.disabled=!this.target.length||!this.hasSong();
      this.incoming.replaceChildren();
      if(this.activity)this.activity.hidden=!offers.length&&!outgoing.length&&!files.length&&!recent.length;
      for(const item of offers){
        const row=node('div');row.className='personal-row';
        const who=peers.find(p=>p.id===item.peer)?.name||'已授权设备';
        row.append(node('span',who+' 发来《'+item.title+'》 · '+(item.bytes/1048576).toFixed(1)+' MiB'));
        if(item.accepting){this.incoming.append(progress(item,'正在从'+who+'接收'));continue;}
        else row.append(button('接收并保存',()=>this.run('accept',{key:item.key})),button('拒绝',()=>this.run('decline',{key:item.key})));
        this.incoming.append(row);
      }
      for(const item of outgoing){const who=peers.find(p=>p.id===item.peer)?.name||'已授权设备';
        this.incoming.append(progress(item,item.active?'正在发送给'+who:'等待'+who+'接收'));}
      for(const item of files)this.incoming.append(progress(item,'正在保存到曲库'));
      for(const item of recent.slice().reverse())this.incoming.append(progress(item,item.status));
      this.feedback.textContent=data.message||'';
    }
  }
  function makeNameEditor(){
    const editor=node('dialog');editor.className='personal-pair-dialog device-name-editor';editor.setAttribute('aria-label','编辑本机名称');
    const form=node('form'),field=node('label','本机名称'),input=node('input');
    input.type='text';input.autocomplete='off';input.id='lume-device-name';field.htmlFor=input.id;
    const hint=node('p','最多 32 个字。留空可恢复默认设备名。'),status=node('p');
    status.setAttribute('role','status');status.id='lume-name-status';input.setAttribute('aria-describedby',status.id);
    const actions=node('div');actions.className='consent-actions';
    const save=node('button','保存');save.type='submit';
    actions.append(save,button('取消',()=>editor.close()));
    form.append(field,input,hint,status,actions);editor.append(node('h2','编辑本机名称'),form);
    let defaultName='',checking=0,saving=false;
    const normalized=()=>input.value.trim()===defaultName?'':input.value.trim();
    input.oninput=async()=>{
      const n=++checking;
      try{
        const {count}=await request('checkName',{displayName:normalized()});
        if(n!==checking||!editor.open)return;
        status.textContent=count>32?'设备名称最多 32 个字，当前 '+count+' 个字。':count+' / 32';
        save.disabled=saving||count>32;
      }catch(e){if(n===checking)status.textContent=e.message;}
    };
    form.onsubmit=async e=>{
      e.preventDefault();if(saving)return;saving=true;save.disabled=true;
      try{const data=await request('rename',{displayName:normalized()});window.dispatchEvent(new CustomEvent('lume-personal-state',{detail:data}));editor.close();}
      catch(e){status.textContent=e.message;}
      finally{saving=false;save.disabled=false;}
    };
    const open=async()=>{
      if(editor.open)return;
      editor.showModal();input.disabled=save.disabled=true;status.textContent='正在读取本机名称…';
      try{const data=await request('status');if(!editor.open)return;
        defaultName=data.defaultName||'';input.value=data.name||defaultName;input.disabled=save.disabled=false;status.textContent='';
        input.focus();input.select();void input.oninput();
      }catch(e){status.textContent=e.message;}
    };
    return {editor,open};
  }
  class PersonalAlerts extends HTMLElement{
    connectedCallback(){
      this.dialog=node('dialog');this.dialog.className='personal-pair-dialog';
      this.dialog.setAttribute('aria-label','设备授权请求');
      const title=node('h2','设备授权请求');this.who=node('p');
      this.error=node('p');this.error.setAttribute('role','status');
      const actions=node('div');actions.className='consent-actions';
      actions.append(button('同意授权',()=>this.decide('approvePair')),button('拒绝',()=>this.decide('rejectPair')));
      this.dialog.append(title,this.who,node('p','同意后，两台设备可在局域网内同步播放记录和传送歌曲。'),this.error,actions);
      this.dialog.oncancel=e=>e.preventDefault();
      this.notice=button('有歌曲等待接收 · 查看',()=>window.dispatchEvent(new Event('lume-open-transfer')));
      this.notice.className='personal-receive-notice';this.notice.hidden=true;
      const nameEditor=makeNameEditor();this.editName=nameEditor.open;
      window.addEventListener('lume-edit-device-name',this.editName);
      this.append(this.dialog,this.notice,nameEditor.editor);this.refresh();this.timer=setInterval(()=>this.refresh(),900);
    }
    disconnectedCallback(){clearInterval(this.timer);window.removeEventListener('lume-edit-device-name',this.editName);this.replaceChildren();}
    async decide(op){
      if(this.busy||!this.current)return;this.busy=true;
      const {peer,key}=this.current;
      try{await request(op,{peer,key});this.dialog.close();this.current=null;}
      catch(e){this.error.textContent=e.message;}
      finally{this.busy=false;void this.refresh();}
    }
    async refresh(){
      if(this.busy||this.loading||document.hidden)return;
      this.loading=true;try{
        const data=await request('status');if(!this.isConnected||this.busy)return;
        window.dispatchEvent(new CustomEvent('lume-personal-state',{detail:data}));
        const incoming=data.pairRequests||[];
        if(this.current&&!incoming.some(p=>p.key===this.current.key&&p.peer===this.current.peer)){this.dialog.close();this.current=null;}
        if(!this.current&&incoming.length&&!document.querySelector('dialog[open]')){
          const p=incoming[0];this.current=p;this.who.textContent=p.name+' 请求授权设备。设备编号 '+fingerprint(p.peer);
          this.error.textContent='';this.dialog.showModal();
        }
        const panels=[...document.querySelectorAll('lume-personal-devices[transfer]')];
        this.notice.hidden=!(data.offers||[]).some(o=>!o.accepting)||panels.some(el=>el.getClientRects().length);
      }catch{}finally{this.loading=false;}
    }
  }
  if(!customElements.get('lume-personal-alerts'))customElements.define('lume-personal-alerts',PersonalAlerts);
  if(!customElements.get('lume-personal-devices'))customElements.define('lume-personal-devices',PersonalDevices);
})();
