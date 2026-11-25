// Each connected device owns its controls; updates preserve the field being edited.
function createOutputControls(root,send,editName){
  const cards=new Map();
  return (outputs,selfId)=>{
    const members=outputs||[];root.hidden=!members.length;
    for(const [id,card] of cards)if(!members.some(d=>d.id===id)){card.remove();cards.delete(id);}
    for(const device of members){
      let card=cards.get(device.id);
      if(!card){
        card=document.createElement('section');card.className='space-device output-device';
        card.innerHTML=`
          <div class="output-heading">
            <h3></h3>
            <select data-key="channel" aria-label="声道">
              <option value="left">左声道</option><option value="right">右声道</option>
              <option value="stereo">立体声</option><option value="mono">单声道</option>
            </select>
          </div>
          <div class="output-level">
            <label>音量<input data-key="volume" aria-label="独立音量" type="range" min="0" max="100" step="1"><output></output></label>
            <label class="output-mute"><input data-key="muted" type="checkbox">静音</label>
          </div>
          <details><summary>输出设置</summary><p></p>
            <label>输出延迟（毫秒）<input data-key="delayMs" aria-label="输出延迟（毫秒）" type="number" min="-1000" max="1000" step="1"></label>
            <label>参与播放<input data-key="enabled" type="checkbox"></label>
          </details>`;
        for(const input of card.querySelectorAll('[data-key]')){
          let timer,lastTrim;
          const submitTrim=()=>{
            clearTimeout(timer);
            if(!card.isConnected||!input.value||!input.checkValidity())return;
            const delayMs=input.valueAsNumber;
            if(delayMs!==lastTrim){lastTrim=delayMs;send(device.id,{delayMs});}
          };
          input.onfocus=()=>{lastTrim=Number(input.value);};
          input.oninput=()=>{
            card.editing=input;
            if(input.dataset.key==='volume')card.querySelector('output').textContent=input.value+'%';
            if(input.dataset.key==='delayMs'){clearTimeout(timer);timer=setTimeout(submitTrim,80);}
          };
          input.onchange=()=>{
            card.editing=null;if(!input.checkValidity()||input.value==='')return;
            if(input.dataset.key==='delayMs'){submitTrim();return;}
            const key=input.dataset.key,value=input.type==='checkbox'?input.checked:key==='channel'?input.value:key==='volume'?Number(input.value)/100:Number(input.value);
            send(device.id,{[key]:value});
          };
          input.onblur=()=>{card.editing=null;};
        }
        cards.set(device.id,card);root.append(card);
      }
      const name=device.name||device.model||device.platform||'播放设备';
      const heading=card.querySelector('h3');
      if(device.id===selfId&&editName){
        let edit=heading.querySelector('button');
        if(!edit){edit=document.createElement('button');edit.type='button';edit.className='self-name-row';edit.onclick=editName;heading.replaceChildren(edit);}
        edit.textContent='本机 · '+name;
        edit.setAttribute('aria-label','本机 · '+name+'，编辑名称');
      }else heading.textContent=(device.id===selfId?'本机 · ':'')+name;
      card.querySelector('p').textContent=[device.platform,device.model&&device.model!==name?device.model:''].filter(Boolean).join(' · ');
      card.setAttribute('aria-label',name+' 输出设置');
      card.querySelector('summary').textContent=device.enabled===false?'输出设置 · 未参与播放':'输出设置';
      for(const input of card.querySelectorAll('[data-key]')){
        if(input===card.editing||input===document.activeElement)continue;
        const key=input.dataset.key;if(input.type==='checkbox')input.checked=!!device[key];else input.value=key==='volume'?Math.round((device.volume??1)*100):device[key]??0;
      }
      card.querySelector('output').textContent=card.querySelector('[data-key=volume]').value+'%';
    }
  };
}
