import { PlaybackHome } from './PlaybackHome';
import { sections, MusicBrowser, type Section } from './MusicBrowser';
import { Contrast, Menu } from 'lucide-react';
import { SongLyrics, LyricsPage } from './SongLyrics';
import { DesktopLyricsHost } from './DesktopLyricsHost';
import { PlaybackProgress } from './PlaybackSeek';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowDownToLine, ArrowRight, AudioLines, Check, ChevronDown, ChevronRight, CircleHelp, Copy, Disc3, Heart, Home, Laptop, Library, Link2, ListMusic, Maximize2, Minus, Monitor, Music2, Pause, Play, Plus, Radio, Repeat, Repeat1, Search, Settings2, Shuffle, SkipBack, SkipForward, Smartphone, Volume2, VolumeX, Waves, Wifi, X } from 'lucide-react';
import { NearbyPhones } from './NearbyPhones';
import { RoomConnectionStatus } from './RoomConnectionStatus';
import { PhoneLibraries } from './PhoneLibraries';
import { DelayControl } from './Calibration';
import { RoomSkin, useSkin } from './appearance/RoomSkin';
import './appearance/skin.css';
import { useRoom } from './hooks/useRoom';
import type { Channel, Device, RoomAction, Track, ImportFile } from './types';

type Page = Section | 'home' | 'devices' | 'favorites';
const lightSkin={name:'晨雾',background:'#eae5e2',surface:'#faf6f2',ink:'#302624',accent:'#a64438'};
const navItems: { id: Page; label: string; icon: typeof Home }[] = [
  { id: 'home', label: '聆听', icon: Home }, { id: 'library', label: '我的音乐', icon: Library },
  { id: 'devices', label: '播放空间', icon: Radio }, { id: 'favorites', label: '我的收藏', icon: Heart },
];
const channelLabels: Record<Channel, string> = { stereo: '完整立体声', left: '左声道', right: '右声道', mono: '单声道' };
const formatTime = (seconds: number) => `${Math.floor(Math.max(0, seconds || 0) / 60)}:${Math.floor(Math.max(0, seconds || 0) % 60).toString().padStart(2, '0')}`;
const savedBoolean = (key: string) => { try { return localStorage.getItem(key) === 'true'; } catch { return false; } };

function Brand({ small = false }: { small?: boolean }) {
  return <div className={`brand ${small ? 'brand-small' : ''}`}><span className="brand-symbol" aria-hidden="true"><i /><i /><i /><i /></span><span className="brand-word">澄音<span>LUME</span></span></div>;
}

function IconButton({ label, children, onClick, active = false, className = '', disabled = false }: { label: string; children: ReactNode; onClick?: () => void; active?: boolean; className?: string; disabled?: boolean }) {
  return <button type="button" className={`icon-button ${active ? 'is-active' : ''} ${className}`} aria-label={label} title={label} onClick={onClick} disabled={disabled}>{children}</button>;
}

function Modal({ title, children, onClose, drawer = false }: { title: string; children: ReactNode; onClose: () => void; drawer?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const el = ref.current; el?.showModal(); return () => el?.close(); }, []);
  return <dialog ref={ref} className={`glass modal ${drawer ? 'drawer' : ''}`} onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="modal-inner"><div className="modal-heading"><h2>{title}</h2><IconButton label="关闭" onClick={onClose}><X size={20} /></IconButton></div>{children}</div>
  </dialog>;
}

function Empty({ title, text, children }: { title: string; text: string; children?: ReactNode }) {
  return <div className="empty-state"><span className="empty-symbol"><Music2 size={30} strokeWidth={1.3} /></span><h3>{title}</h3><p>{text}</p>{children}</div>;
}

function DeviceIcon({ device, size = 22 }: { device: Device; size?: number }) {
  return /android|ios|harmony|手机/i.test(device.platform) ? <Smartphone size={size} /> : /windows|desktop/i.test(device.platform) ? <Monitor size={size} /> : <Laptop size={size} />;
}

export default function App() {
  const room = useRoom();
  const [lightChoice,setLight]=useState<boolean|null>(()=>{try { const value=localStorage.getItem('lume-light'); return value===null?null:value==='true'; } catch { return null; }});
  const light=lightChoice ?? (window.innerWidth>800 && !room.state?.room.skin);
  useSkin(light ? lightSkin : room.state?.room.skin);
  const [narrow,setNarrow]=useState(()=>window.innerWidth<=800);
  const [sideOpen,setSideOpen]=useState(()=>window.innerWidth>800);
  const drawerModal=narrow&&sideOpen;
  const railRef=useRef<HTMLElement>(null);
  useEffect(()=>{if(drawerModal)railRef.current?.querySelector('button')?.focus();},[drawerModal]);
  const folderRef=useRef<HTMLInputElement>(null);
  const blockRef=useRef<HTMLInputElement>(null);
  const menuRef=useRef<HTMLButtonElement>(null);
  const [scanMeter,setScanMeter]=useState({done:0,total:0});
  const [scanStatus,setScanStatus]=useState('');
  const [scanning,setScanning]=useState(false);
  const scanLock=useRef(false);
  const resumeImport=useRef<(() => void) | null>(null);
  const [paused,setPaused]=useState(false);
  const [lyricsPhase,setLyricsPhase]=useState<'closed'|'open'|'closing'>('closed');
  const applyLyricsOpen=useCallback((open:boolean)=>{
    setLyricsPhase(phase=>open?'open':phase==='closed'?'closed':'closing');
  },[]);
  const lyricsExited=useCallback(()=>setLyricsPhase(phase=>phase==='closing'?'closed':phase),[]);
  const toggleImport=()=>{
    if(resumeImport.current){resumeImport.current();resumeImport.current=null;setPaused(false);}
    else {const wait=new Promise<void>(resolve=>{resumeImport.current=resolve;});pauseGate.current=wait;setPaused(true);}
  };
  const pauseGate=useRef(Promise.resolve());

  useEffect(()=>{
    const size=matchMedia('(max-width:800px)');
    const resized=()=>{setNarrow(size.matches);setSideOpen(!size.matches);};
    size.addEventListener('change',resized);return ()=>size.removeEventListener('change',resized);
  },[]);
  const { state, info, connected, needsPairing, error, uploading, deviceId, audioEnabled, playbackError, clock, currentTrack, action, updateDevice, upload, pair, enableAudio, clearError, refresh } = room;
  const [page, applyPage] = useState<Page>('home');
  const setPage=(next:Page)=>{
    if(next!==page){history.pushState({lumePage:next,lyrics:false},'');applyPage(next);}
  };
  const setLyricsOpen=(open:boolean)=>{
    if(open===(lyricsPhase==='open'))return;
    if(open){history.pushState({lumePage:page,lyrics:true},'');applyLyricsOpen(true);}
    else if(history.state?.lyrics){history.back();}
    else applyLyricsOpen(false);
  };
  useEffect(()=>{
    history.replaceState({lumePage:'home',lyrics:false},'');
    const restore=(event:PopStateEvent)=>{
      applyPage(event.state?.lumePage||'home');applyLyricsOpen(!!event.state?.lyrics);
      if(!event.state?.lyrics)void window.lumeDesktop?.getFullscreen?.().then(full=>{if(full)return window.lumeDesktop?.setFullscreen(false);});
    };
    window.addEventListener('popstate',restore);
    return ()=>window.removeEventListener('popstate',restore);
  },[]);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('recent');
  const [queueOpen, setQueueOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [discoveryRevision,setDiscoveryRevision]=useState(0);
  const [pairCode, setPairCode] = useState('');
  const [pairBusy, setPairBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [reducedGlass, setReducedGlass] = useState(() => savedBoolean('lume-reduced-glass'));
  const [roomName, setRoomName] = useState('');
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const dragCount = useRef(0);
  const desktop = !!window.lumeDesktop;
  const tracks = state?.tracks ?? [];
  const devices = state?.devices ?? [];
  const playback = state?.playback;
  const queueTracks = useMemo(() => {
    const byId = new Map(state?.tracks.map(track => [track.id, track]));
    return (state?.queue ?? []).map(id => byId.get(id)).filter((t): t is Track => !!t);
  }, [state?.tracks, state?.queue]);
  const favoriteTracks = tracks.filter(t => t.favorite);
  const localDevice = devices.find(d => d.id === deviceId);
  const activeDevices = devices.filter(d => d.enabled);
  const guestRoom=state?.guestRoom;
  const joinedPhone=guestRoom?.status==='joined'||guestRoom?.status==='disconnected';
  const masterVolume=joinedPhone?(localDevice?.volume??1):(playback?.volume??.8);
  const masterMuted=joinedPhone?!!localDevice?.muted:!!playback?.muted;
  const pageTitles:Record<string,string>={...Object.fromEntries(sections.map(s=>[s.id,s.label])),home:'聆听',devices:'播放空间',favorites:'我的收藏'};
  const closeSide=()=>{setSideOpen(false);requestAnimationFrame(()=>menuRef.current?.focus());};
  const visit=(next:Page)=>{setPage(next);setQuery('');if(window.innerWidth<=800)closeSide();};
  const showConnections=()=>{setConnectOpen(false);setPage('devices');setDiscoveryRevision(n=>n+1);requestAnimationFrame(()=>document.getElementById('room-discovery')?.scrollIntoView({block:'start',behavior:'smooth'}));};
  const joinedInMain=()=>{setConnectOpen(false);setPage('home');};
  const toggleLight=()=>{const next=!light;setLight(next);try{localStorage.setItem('lume-light',String(next));}catch{}};
  useEffect(()=>{
    if(!state||localStorage.getItem('lume-scan-history-seeded'))return;
    window.lumeScanRules.remember(state.tracks.flatMap(t=>t.source==='import'&&t.folder?[t.folder]:[]));
    localStorage.setItem('lume-scan-history-seeded','1');
  },[state]);
  const pickBlock=async()=>{
    if(!window.lumeDesktop){blockRef.current?.click();return;}
    try{const picked=await window.lumeDesktop.pickScanFolder(true);if(picked)window.lumeScanRules.block(picked.root,true);}
    catch{setToast('无法选择文件夹');}
  };
  const importSelection=async(files:ImportFile[],folderMode:boolean,chooseNative=false)=>{
    if(scanLock.current)return;
    scanLock.current=true;
    const rules=window.lumeScanRules, policy=rules.snapshot();
    const blocked=(dir:string)=>policy.blocked.some(parent=>rules.covers(parent,dir));
    const visited=new Set<string>(),excluded=new Set<string>();
    let token:string|undefined,failed=0,added=0,skipped=0;
    try{
      if(chooseNative){
        const native=window.lumeDesktop!;
        const selection=await native.pickScanFolder(false);
        if(!selection)return;
        token=selection.token;
        setScanning(true);setScanStatus('正在查找音频…');setScanMeter({done:0,total:0});
        const pending=[''];
        while(pending.length){
          while(resumeImport.current)await pauseGate.current;
          const relative=pending.pop()!;
          const absolute=relative?selection.root.replace(/\/$/,'')+'/'+relative:selection.root;
          const display=relative?selection.name+'/'+relative:selection.name;
          const wasBlocked=blocked(absolute)||blocked(display);
          rules.migrate(display,absolute);
          if(wasBlocked){excluded.add(absolute);continue;}
          try{
            const page=await native.scanEntries(token,relative);
            visited.add(absolute);for(const file of page.files)files.push(file);failed+=page.failed;
            for(const child of page.directories)pending.push(child);
          }catch{failed++;}
        }
      }else if(folderMode){
        files=files.filter(file=>{
          const parts=file.webkitRelativePath.split('/');parts.pop();
          let dir='';
          for(const part of parts){
            dir=dir?dir+'/'+part:part;
            if(blocked(dir)){excluded.add(dir);return false;}
            visited.add(dir);
          }
          return true;
        });
      }
      rules.remember([...visited]);
      const key=(file:ImportFile)=>(file.webkitRelativePath||file.name).toLowerCase();
      const sides=new Map(files.filter(f=>/\.(lrc|jpg|jpeg|png|webp)$/i.test(f.name)).map(f=>[key(f),f]));
      const audio=files.filter(f=>/\.(mp3|wav|flac|m4a|aac|ogg|opus|webm|mp4)$/i.test(f.name));
      const eligible=audio.filter(f=>f.size<=200*1024*1024);
      let done=audio.length-eligible.length;
      failed+=done;setScanMeter({done,total:audio.length});
      const folderSummary=excluded.size?' 已跳过 '+excluded.size+' 个屏蔽目录。':'';
      if(!audio.length){
        const msg=(failed?'有 '+failed+' 项无法读取。':'没有找到可导入的音频。')+folderSummary;
        setScanStatus(msg);setToast(msg);return;
      }
      setScanning(true);
      for(let i=0;i<eligible.length;){
        while(resumeImport.current)await pauseGate.current;
        const batch:ImportFile[]=[];let bytes=0;
        do{const f=eligible[i++];batch.push(f);bytes+=f.size;}
        while(i<eligible.length&&batch.length<8&&bytes+eligible[i].size<=64*1024*1024);
        setScanStatus('正在导入 · '+batch[0].name);
        const sidesForBatch=batch.map(file=>{
          const stem=key(file).replace(/\.[^/.]+$/,''), dir=stem.slice(0,stem.lastIndexOf('/')+1);
          const cover=[stem,dir+'cover',dir+'folder',dir+'front'].flatMap(base=>['jpg','jpeg','png','webp'].map(ext=>sides.get(base+'.'+ext))).find(f=>f&&f.size<=16*1024*1024);
          const lyrics=sides.get(stem+'.lrc');
          return {cover,lyrics:lyrics&&lyrics.size<=512*1024?lyrics:undefined};
        });
        const result=await upload(batch,folderMode,sidesForBatch,policy.skipShort,token);
        if(result){added+=result.imported;skipped+=result.skipped;failed+=result.rejected.length;}
        done+=batch.length;setScanMeter({done,total:audio.length});
      }
      const summary='完成，新增 '+added+' 首，跳过 '+skipped+' 首，失败 '+failed+' 项。'+folderSummary;
      setScanStatus(summary);setToast(summary);
    }catch{setScanStatus('导入中断，已新增 '+added+' 首。');}
    finally{if(token)void window.lumeDesktop?.endScan(token).catch(()=>{});resumeImport.current?.();resumeImport.current=null;setPaused(false);scanLock.current=false;setScanning(false);}
  };

  useEffect(() => { document.documentElement.dataset.glass = reducedGlass ? 'reduced' : 'full'; try { localStorage.setItem('lume-reduced-glass', String(reducedGlass)); } catch { /* Optional local preference. */ } }, [reducedGlass]);
  useEffect(() => { if (state?.room.name) setRoomName(state.room.name); }, [state?.room.name]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 3000); return () => clearTimeout(timer); }, [toast]);
  const run = (command: RoomAction) => { void action(command).catch(() => {}); };
  const playTrack = async (track: Track) => { if (!audioEnabled && !activeDevices.some(d=>d.id!==deviceId)) await enableAudio(); await action({ type: 'play', trackId: track.id }); };
  const safePlay = (track: Track) => { void playTrack(track).catch(() => {}); };
  const togglePlay = () => {
    if (playback?.playing) run({ type: 'pause' });
    else { void (audioEnabled || activeDevices.some(d=>d.id!==deviceId) ? Promise.resolve() : enableAudio()).then(() => action(currentTrack ? { type: 'play' } : { type: 'play', trackId: tracks[0]?.id })).catch(() => {}); }
  };
  const importFiles = (files: FileList | File[]) => { void importSelection(Array.from(files),false); };
  const playCollection = (collection: Track[]) => {
    if (!collection.length) return;
    void (audioEnabled || activeDevices.some(d=>d.id!==deviceId) ? Promise.resolve() : enableAudio()).then(() => action({ type: 'queue-set', trackIds: collection.map(t => t.id),value:true })).catch(() => {});
  };
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setToast('已复制'); }
    catch { setToast('浏览器未允许复制，请选中文本后复制'); }
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if(event.key==='Escape'&&sideOpen&&!document.querySelector('dialog[open]')){closeSide();return;}
      const target = event.target as HTMLElement;
      if ((event.ctrlKey || event.metaKey) && event.key === 'k') { event.preventDefault(); searchRef.current?.focus(); return; }
      if (target.closest('input, textarea, select, button, dialog, [contenteditable="true"]')) return;
      if (event.code === 'Space' && tracks.length && !needsPairing) { event.preventDefault(); togglePlay(); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  });

  const filteredTracks = (page === 'favorites' ? favoriteTracks : tracks).filter(track => `${track.title} ${track.artist} ${track.album}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title, 'zh-CN') : sort === 'artist' ? a.artist.localeCompare(b.artist, 'zh-CN') : 0);
  const isPlaying = !!playback?.playing;
  const featured = currentTrack ?? tracks[0];
  const cover = currentTrack?.artwork || '/covers/1.svg';

  const trackList = (list: Track[], compact = false) => <div className={`track-table ${compact ? 'compact' : ''}`}>
    <div className="track-table-heading"><span>#</span><span>曲目</span><span className="track-album">专辑</span><span className="track-format">格式</span><span className="track-duration">时长</span><span /></div>
    {list.map((track, index) => <div className={`track-row ${track.id === currentTrack?.id ? 'current' : ''}`} key={track.id}>
      <button className="track-number" aria-label={`播放 ${track.title}`} onClick={() => safePlay(track)}>{track.id === currentTrack?.id && isPlaying ? <span className="equalizer"><i /><i /><i /></span> : <><span>{String(index + 1).padStart(2, '0')}</span><Play size={13} fill="currentColor" /></>}</button>
      <button className="track-main" onClick={() => safePlay(track)}><img src={track.artwork || '/covers/1.svg'} alt="" loading="lazy" /><span><strong>{track.title}</strong><small>{track.artist}{track.source === 'demo' && <span className="sample-label">示例</span>}</small></span></button>
      <span className="track-album">{track.album || '未知专辑'}</span><span className="track-format"><b>{track.format.toUpperCase()}</b></span><span className="track-duration">{formatTime(track.duration)}</span>
      <span className="track-actions"><IconButton label={track.favorite ? `取消收藏 ${track.title}` : `收藏 ${track.title}`} active={track.favorite} onClick={() => run({ type: 'favorite', trackId: track.id })}><Heart size={16} fill={track.favorite ? 'currentColor' : 'none'} /></IconButton><IconButton label={`将 ${track.title} 加入队列`} onClick={() => { run({ type: 'queue-add', trackId: track.id }); }}><Plus size={17} /></IconButton></span>
    </div>)}
  </div>;

  if (needsPairing) return <div className="pairing-screen"><div className="ambient ambient-one" /><div className="ambient ambient-two" /><div data-glass="panel" className="pairing-card glass"><Brand /><span className="pairing-icon"><Link2 size={27} /></span><h1>让音乐，连接彼此。</h1><p>输入 Windows 端「连接设备」中的配对码，<br />加入你的本地音乐空间。</p><form onSubmit={event => { event.preventDefault(); setPairBusy(true); void pair(pairCode).catch(() => {}).finally(() => setPairBusy(false)); }}><label htmlFor="pair-code">六位配对码</label><input id="pair-code" className="pair-code-input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={pairCode} onChange={e => setPairCode(e.target.value.replace(/\D/g, ''))} placeholder="000000" autoFocus /><button className="button button-primary" disabled={pairCode.length !== 6 || pairBusy}>{pairBusy ? '正在连接…' : '加入播放空间'}<ArrowRight size={17} /></button></form>{error && <p className="error-text" role="alert">{error}</p>}<span className="pairing-note"><Wifi size={13} />请连接同一个局域网</span></div></div>;

  const searchField = <div data-glass="small" className="search-field glass"><Search size={17} /><input ref={searchRef} value={query} placeholder="搜索你的音乐" aria-label="搜索音乐" onChange={e => { setQuery(e.target.value); if (e.target.value) setPage('library'); }} />{query ? <button aria-label="清空搜索" onClick={() => setQuery('')}><X size={14} /></button> : <kbd>Ctrl K</kbd>}</div>;
  const joinRequests = (state?.pending?.filter(p=>p.until>Date.now()).map(p=><div className="join-request glass" key={p.id}><strong>{p.name || p.platform} 请求加入播放空间</strong><button onClick={()=>run({type:"join-allow",value:p.id})}>允许加入</button><button onClick={()=>run({type:"join-deny",value:p.id})}>忽略</button></div>));
  return <div className={`app-shell ${!narrow?'wide-player':''} ${sideOpen?'side-open':'side-closed'} ${light?'daylight':''} ${desktop ? 'desktop-shell' : ''}`} onDragEnter={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); dragCount.current++; setDragging(true); } }} onDragOver={e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }} onDragLeave={e => { if (e.dataTransfer.types.includes('Files')) { dragCount.current--; if (dragCount.current <= 0) setDragging(false); } }} onDrop={e => { e.preventDefault(); dragCount.current = 0; setDragging(false); if (e.dataTransfer.files.length) importFiles(e.dataTransfer.files); }}>
    <div className="ambient ambient-one" /><div className="ambient ambient-two" /><div className="ambient ambient-three" /><div className="grain" />
    <input ref={inputRef} type="file" accept="audio/*,.flac,.mp3,.wav,.m4a,.ogg,.aac,.opus,.lrc,.jpg,.jpeg,.png,.webp" multiple className="visually-hidden" onChange={e => { if (e.target.files?.length) importFiles(e.target.files); e.target.value = ''; }} />
    {desktop && <div className="window-titlebar"><span>澄音 LUME</span><div className="window-controls"><button aria-label="最小化" onClick={() => window.lumeDesktop?.minimize()}><Minus size={14} /></button><button aria-label="最大化或还原" onClick={() => window.lumeDesktop?.maximize()}><Maximize2 size={12} /></button><button aria-label="关闭窗口" onClick={() => window.lumeDesktop?.close()}><X size={15} /></button></div></div>}
    <input hidden type="file" multiple ref={el=>{blockRef.current=el;el?.setAttribute('webkitdirectory','');}} onChange={e=>{const folder=e.target.files?.[0]?.webkitRelativePath.split('/')[0];e.target.value='';if(folder)window.lumeScanRules.block(folder,true);}}/>
    <input hidden type="file" multiple ref={el=>{folderRef.current=el;el?.setAttribute('webkitdirectory','');}} onChange={e=>{const files=Array.from(e.target.files||[]);e.target.value='';if(files.length)void importSelection(files,true);}}/>
    <aside ref={railRef} role={drawerModal?"dialog":undefined} aria-modal={drawerModal||undefined} id="music-sidebar" aria-label="音乐导航" className="sidebar music-side" inert={!sideOpen}>
      <div className="side-mast"><Brand small/><IconButton label="收起侧边栏" onClick={closeSide}><X size={19}/></IconButton></div>
      {!narrow && <>{sideOpen&&searchField}<nav className="rail-home manage-links" aria-label="首页"><button aria-current={page==='home'?'page':undefined} onClick={()=>visit('home')}><Home size={18}/>首页</button></nav></>}
      {[sections.slice(0,5),sections.slice(5)].map((group,index)=><section className="rail-section" key={index}><h2>{index?'曲库管理':'我的音乐'}</h2><nav aria-label={index?'音乐管理':'曲库分类'} className={index?'manage-links':'browse-links'}>{group.map(({id,label,icon:Icon})=><button key={id} aria-current={page===id?'page':undefined} onClick={()=>visit(id)}><Icon size={18}/><span>{label}</span>{id==='library'&&<small>{tracks.length} 首</small>}</button>)}</nav></section>)}
      {!narrow&&<section className="rail-section"><h2>播放</h2><nav className="manage-links" aria-label="播放"><button onClick={()=>setQueueOpen(true)}><ListMusic size={18}/>播放队列</button><button aria-current={page==='favorites'?'page':undefined} onClick={()=>visit('favorites')}><Heart size={18}/>我的收藏</button></nav></section>}
      <div className="rail-utilities">
        <button aria-label="切换浅色与深色" onClick={toggleLight}><Contrast size={16}/>外观</button>
        <button onClick={()=>visit('devices')}><AudioLines size={16}/>播放空间</button>
        {narrow&&<button onClick={()=>visit('home')}><Home size={16}/>聆听</button>}
      </div>
      <div className="local-status"><span className={'status-dot '+(connected?'':'offline')}/><span>{connected?'本地音乐服务已连接':'正在连接本地服务'}</span></div>
    </aside>
    <button className="side-scrim" aria-label="关闭导航" inert={!drawerModal} onClick={closeSide}/>
    <main className="main-content" inert={drawerModal}>
      {state?.sourceStatus && <div className="join-request glass" role="status">{state.sourceStatus}</div>}
      {!connectOpen && joinRequests}
      <RoomConnectionStatus connection={guestRoom} leave={()=>void room.leaveRoom().catch(()=>{})}/>
      <header className="topbar"><button className="menu-trigger icon-button" ref={menuRef} aria-label="打开音乐导航" aria-expanded={sideOpen} aria-controls="music-sidebar" onClick={()=>setSideOpen(!sideOpen)}><Menu size={22}/></button><nav className="studio-tabs" aria-label="主要页面">{navItems.map(({id,label})=><button key={id} aria-current={page===id?'page':undefined} onClick={()=>visit(id)}>{label}</button>)}</nav><strong className="compact-caption">{pageTitles[page]}</strong><div className="topbar-actions">{(narrow||!sideOpen)&&searchField}<button data-glass="small" data-elastic="press" className="button button-import" onClick={() => scanning ? toggleImport() : inputRef.current?.click()}>{scanning ? paused ? <Play size={16}/> : <Pause size={16}/> : <Plus size={16}/>}<span>{scanning ? (paused?'继续导入':'暂停导入')+' '+scanMeter.done+'/'+scanMeter.total : '导入音乐'}</span></button><button className="profile-orb" aria-label="打开偏好设置" onClick={() => setPage('settings')}><Settings2 size={18} /></button></div></header>
      {!state && <div className="loading-state"><span className="loading-orb" /><p>{error ? '暂时无法连接音乐服务' : '正在连接你的音乐空间…'}</p>{error && <button className="button button-secondary" onClick={() => void refresh()}>重新连接</button>}</div>}
      {state && <>
        {page==='home'&&!narrow&&<PlaybackHome state={state} currentTrack={currentTrack} clock={clock} analyser={room.analyser} audioEnabled={audioEnabled}
          play={safePlay} toggle={togglePlay} queue={()=>setQueueOpen(true)} lyrics={()=>setLyricsOpen(true)}
          importMusic={()=>inputRef.current?.click()} visit={visit} playCollection={playCollection}/>}
        {page === 'home' && narrow && <div className="home-page page-enter">
          <section className="listen-stage" aria-labelledby="listen-title">
            {featured && <img className="listen-haze" src={featured.artwork || '/covers/1.svg'} alt="" />}
            <div className="listen-content">
              {featured ? <img className="stage-cover" src={featured.artwork || '/covers/1.svg'} alt="" /> : <Music2 className="stage-placeholder" aria-hidden="true" />}
              <div className="stage-caption"><AudioLines size={15} />{currentTrack ? (isPlaying ? '正在播放' : '当前曲目') : featured ? '从曲库开始' : '本地曲库'}</div>
              <h1 id="listen-title">{featured?.title || '导入第一首歌'}</h1>
              <p>{featured ? [featured.artist, featured.album].filter(Boolean).join(' · ') : '选择音频文件，或将文件拖入窗口。'}</p>
              <div className="stage-actions">
                <button className="button button-primary" onClick={() => currentTrack ? togglePlay() : featured ? safePlay(featured) : inputRef.current?.click()}>
                  {featured ? isPlaying ? <Pause size={16} /> : <Play size={16} /> : <Plus size={16} />}
                  {featured ? isPlaying ? '暂停' : '播放' : '导入音乐'}
                </button>
                {currentTrack && <button className="button button-secondary" onClick={()=>setLyricsOpen(true)}>查看歌词<ChevronRight size={14} /></button>}
              </div>
            </div>
          </section>
          <section className="home-tracks">
            <div className="section-heading"><h2>最近加入</h2><button className="text-button" onClick={()=>visit('library')}>全部曲目<ChevronRight size={15}/></button></div>
            {tracks.length ? trackList(tracks.slice(0,5),true) : <p className="collection-note">已导入的曲目会显示在这里。</p>}
          </section>
        </div>}
        {(page === 'library' || page === 'favorites') && <div className="library-page page-enter"><div className="collection-heading"><div className={`collection-icon ${page === 'favorites' ? 'favorite-icon' : ''}`}>{page === 'favorites' ? <Heart size={35} strokeWidth={1.3} fill="currentColor" /> : <Library size={35} strokeWidth={1.3} />}</div><div><h1>{pageTitles[page]}</h1><p><span>{page === 'favorites' ? favoriteTracks.length : tracks.length} 首歌曲</span></p></div></div>{page==="library"&&<PhoneLibraries libraries={state.phoneLibraries??[]} query={query} choose={(deviceId,trackId)=>run({type:"source-play",deviceId,trackId})}/>}<div className="library-toolbar"><button className="button button-primary" disabled={!filteredTracks.length} onClick={() => playCollection(filteredTracks)}><Play size={16} fill="currentColor" />播放全部</button><span>{query && `“${query}” 的搜索结果`}</span><label className="sort-control"><select value={sort} onChange={e => setSort(e.target.value)} aria-label="排序方式"><option value="recent">默认顺序</option><option value="title">按歌曲名称</option><option value="artist">按艺术家</option></select><ChevronDown size={14} /></label></div><div data-glass="panel" className="library-surface glass">{filteredTracks.length ? trackList(filteredTracks) : <Empty title={query ? '没有找到这首音乐' : page === 'favorites' ? '喜欢的歌，值得留下' : '这里，等待你的第一首歌'} text={query ? '试试歌曲名、艺术家或专辑名称。' : page === 'favorites' ? '点击歌曲旁的爱心，就能在这里再次遇见。' : '点击导入音乐，或直接拖入本地音频文件。'}>{page === 'library' && !query && <button className="button button-primary" onClick={() => inputRef.current?.click()}><Plus size={16} />导入音乐</button>}</Empty>}</div><div className="library-footer"><span><Disc3 size={14} />{tracks.filter(t => t.source === 'import').length} 首本地导入 · {tracks.filter(t => t.source === 'demo').length} 首原创示例</span></div></div>}
        {page!=='home' && page!=='library' && page!=='favorites' && page!=='devices' && page!=='settings' && <MusicBrowser key={page} page={page} tracks={tracks} playlists={state.playlists||[]} listening={{days:state.listeningDays||{},records:state.playRecords||[],playlists:state.playlists||[],now:state.serverTime}} listTracks={trackList} play={playCollection} run={run} busy={uploading||scanning} status={scanStatus} meter={scanMeter} scan={()=>window.lumeDesktop?void importSelection([],true,true):folderRef.current?.click()} pickBlock={pickBlock} version={info?.version} openSongs={()=>visit('library')} openFavorites={()=>visit('favorites')} sources={state.phoneLibraries?.length?<PhoneLibraries libraries={state.phoneLibraries} query="" choose={(deviceId,trackId)=>run({type:'source-play',deviceId,trackId})}/>:<p className="collection-note">在播放空间连接手机后，可浏览手机曲库。</p>}/>}
        {page === 'devices' && <div className="devices-page page-enter"><div className="page-intro"><div><h1>播放空间</h1></div><button className="button button-primary" onClick={showConnections}><Plus size={17} />刷新附近设备</button></div><div data-glass="panel" className="room-overview glass"><div className="room-art"><Radio size={40} strokeWidth={1} /></div><div><span className="eyebrow">{joinedPhone?'已加入手机空间 · 手机为房主':'本机空间已创建 · 当前房主'}</span><h2>{state.room.name}</h2><p><span className="status-dot" />{devices.length} 台在线 · {activeDevices.length} 台参与播放</p></div><span className="room-type">局域网连接<Wifi size={16} /></span></div><section id="room-discovery" className="room-discovery"><NearbyPhones connected={devices.filter(d=>d.platform==='Android'||d.platform==='HarmonyOS')} refreshKey={discoveryRevision} onJoined={joinedInMain} guestRoom={guestRoom}/>{!joinedPhone&&info?.pairCode&&<details className="manual-connect"><summary>本机空间已创建 · 地址与配对码</summary><p>{info.urls.join(' · ')}</p><p>配对码：{info.pairCode}</p></details>}</section><div className="section-heading"><h2>输出设备</h2></div><div className="calibrate glass"><div><h3>左右声道校准</h3><p>坐在听音位置，给先响的手机增加延迟，直到两声合成一拍。也可以直接播放音乐调节。</p></div><button className="button button-secondary" disabled={joinedPhone} title={joinedPhone?'请在手机房主上进行同步校准':undefined} onClick={()=>run({type:"calibration",value:!state.calibrating})}>{state.calibrating?"结束节拍 · 返回音乐":"试听同步节拍"}</button></div><div className="device-grid">{devices.map(device => <article className={`device-card glass ${device.id === deviceId ? 'this-device' : ''}`} key={device.id}><div className="device-card-top"><span className="device-avatar"><DeviceIcon device={device} size={25} /></span><div><h3>{device.name}</h3><p>{device.platform}{device.id === deviceId && <span>当前设备</span>}</p></div><label className="toggle" title="参与播放"><input aria-label={`${device.name} 参与播放`} type="checkbox" checked={device.enabled} onChange={e => { updateDevice(device.id, { enabled: e.target.checked }); if (e.target.checked && device.id === deviceId) void enableAudio().catch(() => {}); }} /><span /></label></div><div className="device-channel"><span>声道分配</span><label><select aria-label={`${device.name} 声道分配`} value={device.channel} onChange={e => updateDevice(device.id, { channel: e.target.value as Channel })}>{Object.entries(channelLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><ChevronDown size={14} /></label></div><div className="device-volume"><IconButton label={`${device.muted ? '取消静音' : '静音'} ${device.name}`} active={device.muted} onClick={() => updateDevice(device.id, { muted: !device.muted })}>{device.muted ? <VolumeX size={18} /> : <Volume2 size={18} />}</IconButton><input type="range" aria-label={`${device.name} 音量`} min={0} max={1} step={.01} value={device.volume} style={{ '--progress': `${device.volume * 100}%` } as React.CSSProperties} onChange={e => updateDevice(device.id, { volume: +e.target.value })} /><span>{Math.round(device.volume * 100)}%</span></div>{<DelayControl device={device} change={delayMs=>updateDevice(device.id,{delayMs})}/>}{device.id === deviceId && !audioEnabled && <button className="device-enable" onClick={() => void enableAudio().catch(() => {})}>在此设备启用声音<ArrowRight size={14} /></button>}</article>)}<button className="device-add" onClick={showConnections}><span><Plus size={25} strokeWidth={1.2} /></span><strong>刷新可添加设备</strong><small>在本页搜索并邀请附近的手机</small></button></div><div className="soft-note"><CircleHelp size={17} /><p>当前支持立体声、左右声道和单声道分配。跨设备同步处于实验阶段，实际延迟取决于网络与音频设备；5.1 / 7.1 将在后续加入。</p></div></div>}
        {page === 'settings' && <div className="settings-page page-enter"><div className="page-intro"><div><h1>偏好设置</h1></div></div><section data-glass="panel" className="settings-section glass"><h2><Waves size={19} />外观与体验</h2><RoomSkin skin={state.room.skin} change={value=>run({type:"room-skin",value})}/><div className="setting-row"><div><h3>减少透明效果</h3><p>增强面板对比度，减少背景模糊。</p></div><label className="toggle"><input type="checkbox" aria-label="减少透明效果" checked={reducedGlass} onChange={e => setReducedGlass(e.target.checked)} /><span /></label></div></section><section data-glass="panel" className="settings-section glass"><h2><Radio size={19} />播放空间</h2><form className="setting-row" onSubmit={e => { e.preventDefault(); run({ type: 'room-name', value: roomName.trim() || '我的音乐空间' });  }}><div><h3>空间名称</h3><p>同一局域网的设备会看到这个名字。</p></div><div className="setting-input-group"><input aria-label="空间名称" maxLength={40} value={roomName} onChange={e => setRoomName(e.target.value)} /><button className="button button-secondary" type="submit">保存</button></div></form><div className="setting-row"><div><h3>本机声音</h3><p>{audioEnabled ? `已启用 · ${localDevice ? channelLabels[localDevice.channel] : '完整立体声'}` : '启用后，此设备将参与音乐播放。'}</p></div><button className="button button-secondary" onClick={() => void enableAudio().catch(() => {})}>{audioEnabled ? '声音已启用' : '启用声音'}<Volume2 size={16} /></button></div><div className="setting-row"><div><h3>连接其他设备</h3><p>在同一局域网中，通过地址和配对码加入。</p></div><button className="button button-secondary" onClick={() => setConnectOpen(true)}>连接指引<ArrowRight size={15} /></button></div>{desktop && <div className="setting-row"><div><h3>在浏览器中打开</h3><p>同一份曲库，同一种体验。</p></div><button className="button button-secondary" onClick={() => window.lumeDesktop?.openWeb()}>打开 Web 端<ArrowRight size={15} /></button></div>}</section><section className="about-lume"><Brand small /><p>让音乐，自由流动。</p><span>本地优先 · Windows & Web · v{info?.version || '0.1.0'}</span><small>当前版本使用共享播放时间轴进行实验同步，尚不承诺精密多声道同步。</small></section></div>}
      </>}
    </main>
    {state && !audioEnabled && !playbackError && <div inert={drawerModal} className="audio-gate glass"><Volume2 size={16} /><span>此设备尚未启用声音</span><button onClick={() => void enableAudio().catch(() => {})}>启用声音<ArrowRight size={13} /></button></div>}
    {state && <footer inert={drawerModal} data-glass="dock" className="player-bar glass" aria-label="播放器"><canvas className="dock-material" aria-hidden="true" /><div className="player-track"><button className="open-track-lyrics" aria-label="打开当前曲目歌词" disabled={!currentTrack} onClick={()=>setLyricsOpen(true)} /><img src={cover} alt="" /><div><strong>{currentTrack?.title || '选一首，开始聆听'}</strong><span>{currentTrack?.artist || '你的音乐，随时在这里'}</span></div><IconButton label={currentTrack?.favorite ? '取消收藏当前歌曲' : '收藏当前歌曲'} active={currentTrack?.favorite} disabled={!currentTrack} onClick={() => currentTrack && run({ type: 'favorite', trackId: currentTrack.id })}><Heart size={18} fill={currentTrack?.favorite ? 'currentColor' : 'none'} /></IconButton></div><div className="player-center"><div className="transport-controls"><IconButton label={playback?.shuffle ? '随机播放 · 切换顺序播放' : '顺序播放 · 切换随机播放'} active={playback?.shuffle} className="secondary-transport" onClick={() => {void action({type:'repeat',value:'off'}).then(()=>action({type:'shuffle',value:!playback?.shuffle})).catch(()=>{});}}><Shuffle size={17} /></IconButton><IconButton label="上一首" disabled={!tracks.length} onClick={() => run({ type: 'previous' })}><SkipBack size={20} fill="currentColor" /></IconButton><button data-glass="free" data-elastic="tether" className={`play-button ${isPlaying ? 'playing' : ''}`} aria-label={isPlaying ? '暂停' : '播放'} disabled={!tracks.length} onClick={togglePlay}>{isPlaying ? <Pause size={21} fill="currentColor" /> : <Play size={21} fill="currentColor" />}</button><IconButton label="下一首" disabled={!tracks.length} onClick={() => run({ type: 'next' })}><SkipForward size={20} fill="currentColor" /></IconButton><IconButton label={playback?.repeat === 'off' ? '开启列表循环' : playback?.repeat === 'all' ? '切换单曲循环' : '关闭循环'} active={playback?.repeat !== 'off'} disabled={joinedPhone} className="secondary-transport" onClick={() => run({ type: 'repeat', value: playback?.repeat === 'off' ? 'all' : playback?.repeat === 'all' ? 'one' : 'off' })}>{playback?.repeat === 'one' ? <Repeat1 size={17} /> : <Repeat size={17} />}</IconButton></div><PlaybackProgress clock={clock} duration={currentTrack?.duration??0} format={formatTime} seek={next=>run({type:'seek',position:next})}/></div><div className="player-extras"><IconButton label="歌词" disabled={!currentTrack} onClick={()=>setLyricsOpen(true)}>词</IconButton><div className="master-volume"><IconButton label={masterMuted?'取消静音':joinedPhone?'本机静音':'全组静音'} active={masterMuted} onClick={() => run({type:'muted',value:!masterMuted})}>{masterMuted || !masterVolume ? <VolumeX size={19} /> : <Volume2 size={19} />}</IconButton><input type="range" aria-label={joinedPhone?"本机音量":"全组音量"} min={0} max={1} step={.01} value={masterVolume} style={{ '--progress': `${masterVolume * 100}%` } as React.CSSProperties} onChange={e => run({ type: 'volume', value: +e.target.value })} /></div><span className="player-divider" /><IconButton label="播放设备" active={page === 'devices'} onClick={() => setPage('devices')}><Radio size={20} /></IconButton><IconButton label="播放队列" active={queueOpen} onClick={() => setQueueOpen(true)}><ListMusic size={21} /></IconButton></div></footer>}
    <nav inert={drawerModal} data-glass="dock" className="mobile-nav glass" data-lens-group="" aria-label="移动导航"><i data-lens-marker="" data-glass="selected" aria-hidden="true" />{navItems.map(({ id, label, icon: Icon }) => <button key={id} data-elastic="press" className={page === id ? 'selected' : ''} onClick={() => { setPage(id); setQuery(''); }} aria-current={page === id ? 'page' : undefined}><Icon size={20} /><span>{label}</span></button>)}</nav>
    {(error || playbackError) && <div className="error-banner glass" role="alert"><CircleHelp size={18} /><span>{error || playbackError}</span>{playbackError && <button className="text-button" onClick={() => void enableAudio().catch(() => {})}>重试声音</button>}<IconButton label="关闭提示" onClick={clearError}><X size={17} /></IconButton></div>}
    {toast && <div className="toast glass" role="status"><Check size={17} />{toast}</div>}
    {dragging && <div className="drop-overlay"><div className="glass"><ArrowDownToLine size={48} strokeWidth={1.2} /><h2>把喜欢的声音，放进来。</h2><p>松开鼠标，将音乐加入本地曲库。</p></div></div>}
    {connectOpen && <Modal title="连接你的声音伙伴" onClose={() => setConnectOpen(false)}><div className="connect-illustration"><Monitor size={31} strokeWidth={1.3} /><span /><Wifi size={23} strokeWidth={1.4} /><span /><Smartphone size={29} strokeWidth={1.3} /></div>{info?.pairCode && <NearbyPhones connected={devices.filter(d=>d.platform==='Android'||d.platform==='HarmonyOS')} onJoined={joinedInMain} guestRoom={guestRoom} />}
      {joinRequests}
      <details className="manual-connect" open={info?.pairCode ? undefined : true}><summary>手动连接 · 地址与配对码</summary>
      <p className="modal-description">在同一 Wi-Fi 下，用另一台设备打开下方地址并输入配对码。</p><label className="field-label">局域网访问地址</label><div className="connection-urls">{info?.urls.length ? info.urls.map(url => <div className="copy-field" key={url}><code>{url}</code><IconButton label={`复制 ${url}`} onClick={() => void copy(url)}><Copy size={16} /></IconButton></div>) : <p className="soft-note">暂未发现局域网地址，请检查网络连接。</p>}</div>{info?.pairCode ? <><label className="field-label">配对码 · 仅在主机显示</label><div className="pair-code-display"><span>{info.pairCode}</span><IconButton label="复制配对码" onClick={() => void copy(info.pairCode!)}><Copy size={17} /></IconButton></div></> : <p className="soft-note">请在 Windows 主机上查看六位配对码。</p>}</details><div className="modal-footer-note"><Link2 size={14} />配对后可共同控制曲库与播放。此功能仅供可信局域网使用。</div></Modal>}
    {lyricsPhase!=='closed' && (desktop && playback ? <DesktopLyricsHost open={lyricsPhase==='open'} onExited={lyricsExited} track={currentTrack} clock={clock} playback={{...playback,volume:masterVolume,muted:masterMuted}} sourceKey={joinedPhone?guestRoom!.url:'local'} analyser={room.analyser} audioEnabled={audioEnabled}
      onAction={async command=>{if(command.type==='play'&&!audioEnabled&&!activeDevices.some(d=>d.id!==deviceId))await enableAudio();return action(command);}}
      onQueue={()=>setQueueOpen(true)} onClose={()=>setLyricsOpen(false)}/> : <LyricsPage open={lyricsPhase==='open'} onExited={lyricsExited} onQueue={()=>setQueueOpen(true)} title={currentTrack?.title || '歌词'} onClose={()=>setLyricsOpen(false)}><SongLyrics key={currentTrack?.id} track={currentTrack} clock={clock} playing={isPlaying}/><div className="lyric-transport lyric-control"><IconButton label="上一首" onClick={()=>run({type:'previous'})}><SkipBack size={18}/></IconButton><IconButton label={isPlaying?'暂停':'播放'} onClick={togglePlay}>{isPlaying?<Pause size={19}/>:<Play size={19}/>}</IconButton><IconButton label="下一首" onClick={()=>run({type:'next'})}><SkipForward size={18}/></IconButton><PlaybackProgress clock={clock} duration={currentTrack?.duration??0} format={formatTime} seek={position=>run({type:'seek',position})}/></div></LyricsPage>)}
    {queueOpen && <Modal title="接下来播放" onClose={() => setQueueOpen(false)} drawer><div className="queue-summary"><span>{queueTracks.length} 首歌曲</span><span>{playback?.shuffle ? '随机播放' : '顺序播放'}</span></div>{queueTracks.length ? <div className="queue-list">{queueTracks.map((track, index) => <div key={`${track.id}-${index}`} className={`queue-item ${track.id === currentTrack?.id ? 'current' : ''}`}><button onClick={() => safePlay(track)}><img src={track.artwork || '/covers/1.svg'} alt="" /><span><strong>{track.title}</strong><small>{track.artist}</small></span>{track.id === currentTrack?.id && <AudioLines size={17} />}</button><IconButton label={`从队列移除 ${track.title}`} onClick={() => run({ type: 'queue-remove', trackId: track.id })}><X size={16} /></IconButton></div>)}</div> : <Empty title="给下一首留个位置" text="在曲目右侧点击加号，把音乐加入播放队列。" />}</Modal>}
  </div>;
}
