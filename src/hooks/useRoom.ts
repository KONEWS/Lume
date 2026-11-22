import { useCallback, useEffect, useRef, useState } from 'react';
import type { Channel, Device, ImportFile, ImportResult, RoomAction, RoomState, ServerInfo } from '../types';

const getDeviceId = () => {
  // Each tab is an independent output; duplicated tabs must not evict each other.
  return crypto.randomUUID?.() ?? `web-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};
export function useRoom() {
  const [deviceId] = useState(getDeviceId);
  const [state, setState] = useState<RoomState | null>(null);
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [connected, setConnected] = useState(false);
  const [needsPairing, setNeedsPairing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [clock] = useState(() => {
    let position=0;
    const listeners=new Set<()=>void>();
    return {
      getSnapshot:()=>position,
      subscribe:(listener:()=>void)=>{listeners.add(listener);return ()=>{listeners.delete(listener);};},
      update:(value:number)=>{if(position!==value){position=value;listeners.forEach(listener=>listener());}},
    };
  });
  const [session, setSession] = useState(0);
  const stateRef = useRef(state);
  const socket = useRef<WebSocket | null>(null);
  const offset = useRef(0);
  const audio = useRef<HTMLAudioElement | null>(null);
  const context = useRef<AudioContext | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const source = useRef<MediaElementAudioSourceNode | null>(null);
  const graph = useRef<AudioNode[]>([]);
  const channel = useRef<Channel | null>(null);
  const enabledRef = useRef(false);
  const connectedRef = useRef(false);
  const ownDeviceRef = useRef<Device | null>(null);
  const trackRef = useRef<string | null>(null);

  const accept = useCallback((next: RoomState) => {
    if (stateRef.current && next.serverTime < stateRef.current.serverTime) return;
    const own = next.devices.find(device => device.id === deviceId);
    if (own) ownDeviceRef.current = own;
    stateRef.current = next; setState(next);
  }, [deviceId]);
  const request = useCallback(async (path: string, init?: RequestInit) => {
    const res = await fetch(path, { credentials: 'same-origin', ...init });
    const data = await res.json().catch(() => ({ error: '服务返回了无法读取的响应' }));
    if (!res.ok) {
      if (res.status === 401) setNeedsPairing(true);
      throw new Error(data.error || '操作未完成，请重试');
    }
    return data;
  }, []);
  const refresh = useCallback(async () => {
    try {
      const nextInfo: ServerInfo = await request('/api/info');
      setInfo(nextInfo); setNeedsPairing(!nextInfo.paired);
      if (nextInfo.paired) { accept(await request('/api/state')); setSession(n => n + 1); }
      setError(null);
    } catch (e) { setError((e as Error).message); }
  }, [request, accept]);
  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!session || needsPairing) return;
    let stopped = false;
    let reconnect: ReturnType<typeof setTimeout>;
    const calibrate = async () => {
      try {
        const samples = [];
        for (let i = 0; i < 3; i++) {
          const before = Date.now();
          const { serverTime } = await request('/api/time');
          const after = Date.now();
          samples.push({ latency: after - before, offset: serverTime - (before + after) / 2 });
        }
        if (!stopped) offset.current = samples.sort((a, b) => a.latency - b.latency)[0].offset;
      } catch { /* Connection state is surfaced by the socket. */ }
    };
    void calibrate();
    const calibrationTimer = setInterval(calibrate, 30_000);
    const connect = () => {
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
      socket.current = ws;
      ws.onopen = () => {
        if (stopped) { ws.close(); return; }
        connectedRef.current = true; setConnected(true); setError(null);
        const desktop = !!window.lumeDesktop;
        const platform = desktop ? 'Windows' : /Android/.test(navigator.userAgent) ? 'Android Web' : /iPhone|iPad/.test(navigator.userAgent) ? 'iOS Web' : 'Web';
        ws.send(JSON.stringify({ type: 'register', device: { id: deviceId, name: desktop ? 'Windows 桌面' : '网页播放器', platform, channel: 'stereo', enabled: enabledRef.current, ...(ownDeviceRef.current ? { delayMs:ownDeviceRef.current.delayMs, name: ownDeviceRef.current.name, channel: ownDeviceRef.current.channel, volume: ownDeviceRef.current.volume, muted: ownDeviceRef.current.muted, enabled: ownDeviceRef.current.enabled } : {}) } }));
      };
      ws.onmessage = event => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'state') accept(data.state);
          else if (data.type === 'error') setError(data.error || data.message || '设备更新失败');
        } catch { setError('设备消息读取失败'); }
      };
      ws.onclose = event => {
        if (!stopped) {
          connectedRef.current = false; setConnected(false); audio.current?.pause();
          if (event.code === 4001) { setError('此输出会话已被替换，请刷新页面重新加入。'); return; }
          reconnect = setTimeout(async () => {
            try {
              const nextInfo: ServerInfo = await request('/api/info');
              if (stopped) return;
              setInfo(nextInfo);
              if (!nextInfo.paired) { setNeedsPairing(true); return; }
            } catch { /* Keep retrying when the local service is temporarily unavailable. */ }
            if (!stopped) connect();
          }, 2000);
        }
      };
      ws.onerror = () => ws.close();
    };
    connect();
    return () => { stopped = true; connectedRef.current = false; clearTimeout(reconnect); clearInterval(calibrationTimer); socket.current?.close(); audio.current?.pause(); };
  }, [session, needsPairing, deviceId, accept, request]);

  const wireChannel = useCallback((next: Channel) => {
    const ctx = context.current, src = source.current;
    if (!ctx || !src || channel.current === next) return;
    src.disconnect(); graph.current.forEach(node => node.disconnect()); graph.current = [];
    if (analyser.current) src.connect(analyser.current);
    if (next === 'stereo') src.connect(ctx.destination);
    else {
      const splitter = ctx.createChannelSplitter(2), merger = ctx.createChannelMerger(2);
      src.connect(splitter);
      if (next === 'mono') {
        const left = ctx.createGain(), right = ctx.createGain(); left.gain.value = right.gain.value = 0.5;
        splitter.connect(left, 0); splitter.connect(right, 1);
        left.connect(merger, 0, 0); left.connect(merger, 0, 1); right.connect(merger, 0, 0); right.connect(merger, 0, 1);
        graph.current.push(left, right);
      } else {
        const selected = next === 'left' ? 0 : 1;
        splitter.connect(merger, selected, 0); splitter.connect(merger, selected, 1);
      }
      merger.connect(ctx.destination); graph.current.push(splitter, merger);
    }
    channel.current = next;
  }, []);

  const synchronize = useCallback(() => {
    const latest = stateRef.current;
    if (!latest) return;
    const p = latest.playback;
    const track = latest.tracks.find(t => t.id === p.trackId);
    const target = Math.max(0, Math.min(track?.duration || Infinity, p.position + (p.playing ? Math.max(0, Date.now() + offset.current - p.updatedAt) / 1000 : 0)));
    clock.update(Number.isFinite(target) ? target : 0);
    const el = audio.current;
    if (!el || !enabledRef.current) return;
    if (!connectedRef.current) { el.pause(); return; }
    const ownDevice = latest.devices.find(d => d.id === deviceId);
    el.volume = Math.min(1, Math.max(0, p.volume * (ownDevice?.volume ?? 1)));
    el.muted = p.muted || (ownDevice?.muted ?? false) || ownDevice?.enabled === false;
    wireChannel(ownDevice?.channel ?? 'stereo');
    if (!p.trackId) { el.pause(); return; }
    const mediaIdentity=(latest.guestRoom?.url||'local')+'/'+p.trackId+'/'+(track?.localAudioKey||'');
    if (trackRef.current !== mediaIdentity) {
      trackRef.current = mediaIdentity;
      // Different hosts may reuse a track id; keep cached local audio out of a phone session.
      el.src = `/media/${encodeURIComponent(p.trackId)}?room=${encodeURIComponent(latest.guestRoom?.url||'local')}`;
      el.load(); setPlaybackError(null);
    }
    if (el.readyState >= 1) {
      const outputTarget=Math.max(0,target-(ownDevice?.delayMs??0)/1000);
      const drift = outputTarget - el.currentTime;
      if (Math.abs(drift) > 0.22 || !p.playing) {
        if (Math.abs(drift) > 0.04) el.currentTime = Math.min(outputTarget, Math.max(0, (el.duration || Infinity) - 0.02));
        el.playbackRate = 1;
      } else el.playbackRate = Math.abs(drift) > 0.035 ? (drift > 0 ? 1.008 : 0.992) : 1;
    }
    const shouldPlay=p.playing&&Date.now()+offset.current>=p.updatedAt;
    if (shouldPlay && ownDevice?.enabled !== false && el.paused && !el.ended) {
      void el.play().catch(e => { if (e.name !== 'AbortError') setPlaybackError('此设备尚未开始发声，请点击「启用声音」或重新播放。'); });
    } else if (!shouldPlay || ownDevice?.enabled === false) el.pause();
  }, [clock, deviceId, wireChannel]);
  useEffect(() => { synchronize(); }, [state, synchronize]);
  useEffect(() => {
    const timer = setInterval(synchronize, 250);
    return () => clearInterval(timer);
  }, [synchronize]);
  useEffect(() => () => {
    audio.current?.pause(); audio.current?.removeAttribute('src');
    void context.current?.close(); audio.current = null; context.current = null; source.current = null;
    graph.current = []; analyser.current = null; channel.current = null; trackRef.current = null; enabledRef.current = false;
  }, []);

  const updateDevice = useCallback((id: string, patch: Partial<Device>) => {
    if (socket.current?.readyState !== WebSocket.OPEN) { setError('连接已断开，正在重新连接'); return; }
    socket.current.send(JSON.stringify({ type: 'device', id, patch }));
  }, []);
  const enableAudio = useCallback(async () => {
    try {
      if (!audio.current) {
        const el = new Audio(); el.preload = 'auto'; el.crossOrigin = 'anonymous';
        el.addEventListener('canplay', synchronize);
        el.addEventListener('error', () => {
          if(stateRef.current?.guestRoom&&el.src&&!new URL(el.src).searchParams.has('remote')){
            const url=new URL(el.src);url.searchParams.set('remote','1');el.src=url.href;el.load();return;
          }
          setPlaybackError('这首音乐无法在当前设备解码，请尝试 MP3、FLAC 或 WAV 文件。');
        });
        audio.current = el;
      }
      if (!context.current) {
        const ctx = new AudioContext({ latencyHint: 'playback' }); context.current = ctx;
        analyser.current = ctx.createAnalyser(); analyser.current.fftSize = 256;
        source.current = ctx.createMediaElementSource(audio.current); channel.current = null; wireChannel('stereo');
      }
      await context.current.resume();
      enabledRef.current = true; setAudioEnabled(true); setPlaybackError(null);
      updateDevice(deviceId, { enabled: true });
      synchronize();
    } catch { setPlaybackError('浏览器未能启用声音，请再次点击或检查设备音频输出。'); }
  }, [deviceId, synchronize, updateDevice, wireChannel]);

  const action = useCallback(async (input: RoomAction) => {
    try {
      const data = await request('/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
      accept(data.state ?? data); setError(null);
    } catch (e) { setError((e as Error).message); throw e; }
  }, [request, accept]);
  const leaveRoom=useCallback(async()=>{
    try {accept(await request('/api/room/leave',{method:'POST'}));setError(null);}
    catch(e){setError((e as Error).message);throw e;}
  },[request,accept]);
  const pair = useCallback(async (code: string) => {
    try { await request('/api/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) }); await refresh(); }
    catch (e) { setError((e as Error).message); }
  }, [request, refresh]);
  const upload = useCallback(async (files: ImportFile[], scan: boolean, sidecars: {lyrics?:ImportFile; cover?:ImportFile}[], skipShort=false, token?:string) => {
    if (!files.length) return;
    setUploading(true); setUploadProgress(0); setError(null);
    try {
      const attachments: ImportFile[] = [];
      const index = (file?:ImportFile) => {
        if (!file) return undefined;
        let i = attachments.indexOf(file);
        if (i < 0) { i = attachments.length; attachments.push(file); }
        return i;
      };
      const body={skipShort:scan&&skipShort?'1':'0',links:JSON.stringify(sidecars.map(s=>({lyrics:index(s.lyrics),cover:index(s.cover)}))),
        folders:scan?JSON.stringify(files.map(file=>file.webkitRelativePath.split('/').slice(0,-1).join('/'))):undefined};
      const scannedIds=(items:ImportFile[])=>items.map(f=>{if(!('scanIndex' in f))throw Error('扫描文件无效');return f.scanIndex;});
      const native=token?window.lumeDesktop!.scanBatch(token,scannedIds(files),scannedIds(attachments),body):
        window.lumeDesktop?.importFiles(files as File[],attachments as File[],body);
      const response = await (native ?? new Promise<ImportResult>((resolve, reject) => {
        const form=new FormData();
        (files as File[]).forEach(file=>form.append('files',file));
        form.append('links',body.links);form.append('skipShort',body.skipShort);
        if(body.folders)form.append('folders',body.folders);
        (attachments as File[]).forEach(file=>form.append('attachments',file));
        const xhr = new XMLHttpRequest(); xhr.open('POST', '/api/upload');
        xhr.upload.onprogress = e => { if (e.lengthComputable) setUploadProgress(Math.round(e.loaded / e.total * 100)); };
        xhr.onerror = () => reject(new Error('上传中断，请检查连接后重试'));
        xhr.onload = () => {
          try { const data = JSON.parse(xhr.responseText); if (xhr.status >= 200 && xhr.status < 300) resolve(data); else { if (xhr.status === 401) setNeedsPairing(true); reject(new Error(data.error || '导入失败')); } }
          catch { reject(new Error('导入结果读取失败')); }
        };
        xhr.send(form);
      }));
      accept(response.state); setUploadProgress(100);
      if (response.rejected?.length) setError(response.rejected.map(r => `${r.name}：${r.reason}`).join('；'));
      return response;
    } catch (e) { setError((e as Error).message); throw e; }
    finally { setUploading(false); }
  }, [accept]);
  return { analyser, state, info, connected, needsPairing, error, uploading, uploadProgress, deviceId, audioEnabled, playbackError, clock, leaveRoom,
    currentTrack: state?.tracks.find(t => t.id === state.playback.trackId) ?? null,
    action, updateDevice, upload, pair, enableAudio, clearError: () => { setError(null); setPlaybackError(null); }, refresh };
}
