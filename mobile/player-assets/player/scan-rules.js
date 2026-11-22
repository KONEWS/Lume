(() => {
  const storageKey = 'lume-scan-rules-v1';
  let saved;
  try { saved = window.lumeDesktop?.readScanSettings?.() ?? JSON.parse(localStorage.getItem(storageKey)); } catch {}
  const paths = values => Array.isArray(values) ? values.filter(v => typeof v === 'string' && v.length) : [];
  const history = new Set(paths(saved?.history)), blocked = new Set(paths(saved?.blocked));
  // Match the explicit extension lists in both native folder scanners. Android
  // can additionally discover audio by MIME type; custom extensions cover those.
  const formats = ['mp3','m4a','aac','flac','ogg','opus','wav','aif','aiff','wma','alac'];
  const normalizeFormat = value => typeof value === 'string' ? value.trim().replace(/^\./,'').toLowerCase() : '';
  const validFormat = value => /^[a-z0-9]{1,16}$/.test(value);
  const blockedFormats = new Set(paths(saved?.blockedFormats).map(normalizeFormat).filter(validFormat));
  let skipShort = saved?.skipShort !== false;
  const key = path => /^(?:[a-z]:|\/\/)/i.test(path) ? path.toLowerCase() : path;
  function covers(parent, folder) {
    parent=key(parent); folder=key(folder);
    return folder===parent || folder.startsWith(parent.replace(/\/$/,'')+'/');
  }
  const snapshot = () => ({history:[...history], blocked:[...blocked], skipShort, blockedFormats:[...blockedFormats]});
  let revision=0;
  function save() {
    revision++;
    window.lumeDesktop?.saveScanSettings?.(snapshot());
    try { localStorage.setItem(storageKey,JSON.stringify(snapshot())); } catch {}
    document.dispatchEvent(new Event('lume-scan-change'));
  }
  function remember(folders) {
    const before=history.size;
    for (const folder of paths(folders)) history.add(folder);
    if (history.size!==before) save();
  }
  function block(folder, value) {
    if (!folder) return;
    if (value) blocked.add(folder); else blocked.delete(folder);
    save();
  }
  function migrate(relative, absolute) {
    if (relative===absolute) return;
    const hadHistory=history.delete(relative), wasBlocked=blocked.delete(relative);
    if(hadHistory)history.add(absolute);
    if(wasBlocked)blocked.add(absolute);
    if(hadHistory||wasBlocked)save();
  }
  function label(path) {
    if(path.startsWith('file://')){try{return decodeURIComponent(path.replace(/^file:\/\/[^/]+/,''));}catch{}}
    return path.replace('content://com.android.externalstorage.documents/','');
  }
  window.lumeScanRules={snapshot,remember,block,covers,migrate};
  class ScanRules extends HTMLElement {
    connectedCallback() {
      document.addEventListener('lume-scan-change',this.refresh);
      this.refresh();
    }
    disconnectedCallback(){document.removeEventListener('lume-scan-change',this.refresh);}
    static get observedAttributes(){return ['disabled'];}
    attributeChangedCallback(){if(this.isConnected)this.refresh();}
    refresh=()=>{
      const view=revision+':'+this.hasAttribute('disabled');
      if(this.lastView===view)return;
      this.lastView=view;
      const el=(tag,text)=>{const node=document.createElement(tag);if(text)node.textContent=text;return node;};
      const disabled=this.hasAttribute('disabled');
      const checkbox=el('input');checkbox.type='checkbox';checkbox.checked=skipShort;checkbox.disabled=disabled;
      checkbox.onchange=()=>{skipShort=checkbox.checked;save();};
      const option=el('label');option.append(checkbox,document.createTextNode('跳过短于 60 秒且无专辑标签的音频'));
      const pick=el('button','选择要屏蔽的文件夹');pick.type='button';pick.disabled=disabled;
      pick.onclick=()=>this.dispatchEvent(new Event('pick-block',{bubbles:true}));
      const fragment=document.createDocumentFragment();
      fragment.append(option,el('p','带有真实专辑标签的短曲会保留；60 秒整和无法识别时长的音频也会保留。文件夹名不作为专辑标签，格式和文件夹屏蔽始终优先。'));
      const formatSection=el('details');formatSection.className='scan-format-section';
      formatSection.open=this.querySelector('.scan-format-section')?.open??false;
      formatSection.append(el('summary','屏蔽音频格式'+(blockedFormats.size?'（已选 '+blockedFormats.size+' 项）':'')),el('p','点击格式可选中或取消，高亮的格式将在下次扫描时跳过。自动保存，不会移除已导入的歌曲。'));
      const formatList=el('div');formatList.className='scan-format-list';
      for(const format of new Set([...formats,...blockedFormats])){
        const input=el('input');input.type='checkbox';input.checked=blockedFormats.has(format);input.disabled=disabled;
        input.dataset.format=format;
        input.onchange=()=>{if(input.checked)blockedFormats.add(format);else blockedFormats.delete(format);save();};
        const item=el('label');item.append(input,document.createTextNode(format.toUpperCase()));formatList.append(item);
      }
      const extra=el('input');extra.type='text';extra.maxLength=17;extra.placeholder='如 .amr';extra.disabled=disabled;
      extra.autocomplete='off';extra.spellcheck=false;extra.setAttribute('aria-label','其他要屏蔽的扩展名');
      const add=el('button','添加屏蔽');add.type='button';add.disabled=disabled;
      const error=el('p');error.setAttribute('role','status');
      const addFormat=()=>{
        const format=normalizeFormat(extra.value);
        if(!validFormat(format)){error.textContent='请输入 1–16 位字母或数字组成的扩展名，可带开头的点。';extra.focus();return;}
        blockedFormats.add(format);save();
      };
      add.onclick=addFormat;extra.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();addFormat();}};
      const custom=el('div');custom.className='scan-format-custom';custom.append(extra,add);
      formatSection.append(formatList,el('p','也可添加其他扩展名。忽略大小写，仅对当前设备扫描器能识别的音频生效。'),custom,error);
      fragment.append(formatSection,el('h2','已扫描的文件夹'));
      function row(folder,excluded) {
        const line=el('div'), name=el('span',label(folder));
        const inherited=!excluded && [...blocked].some(parent=>covers(parent,folder));
        const button=el('button',excluded?'解除屏蔽':inherited?'父文件夹已屏蔽':'屏蔽');
        button.type='button';button.disabled=disabled||inherited;
        button.setAttribute('aria-label',button.textContent+' '+label(folder));
        button.onclick=()=>block(folder,!excluded);line.append(name,button);return line;
      }
      const sorted=items=>[...items].sort((a,b)=>a.localeCompare(b,'zh-CN'));
      const included=sorted(history).filter(path=>!blocked.has(path));
      if(!included.length)fragment.append(el('p',history.size?'已扫描的文件夹均已屏蔽':'暂无扫描记录'));
      for(const dir of included)fragment.append(row(dir,false));
      fragment.append(el('h2','已屏蔽的文件夹'),pick);
      for(const dir of sorted(blocked))fragment.append(row(dir,true));
      // Rebuilding after a touch must not turn the new checkbox into a keyboard focus target.
      const focusedFormat=this.contains(document.activeElement)&&document.activeElement.matches(':focus-visible')?document.activeElement.dataset.format:undefined;
      this.replaceChildren(fragment);
      if(focusedFormat)this.querySelector('input[data-format="'+focusedFormat+'"]')?.focus({preventScroll:true});
    };
  }
  customElements.define('lume-scan-rules',ScanRules);
})();
