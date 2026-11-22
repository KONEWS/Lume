import express from 'express';
import { coverMime, frontCover, embeddedLyrics, decodeLyrics } from '../shared/song-details.mjs';
import { audioFacts } from './audio-facts.mjs';
import { advertise, joinRequests, nearbyPhones } from './discovery.mjs';
import { phoneLibraries } from './phone-libraries.mjs';
import { mountReceivers } from './receivers.mjs';
import { JoinedRoom } from './joined-room.mjs';
import {MediaIdentities,findLocalTrack} from './local-media.mjs';
import multer from 'multer';
import { WebSocketServer, WebSocket } from 'ws';
import { parseFile } from 'music-metadata';
import { createServer } from 'node:http';
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createWriteStream, createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.opus', '.webm', '.mp4']);
const CHANNELS = new Set(['stereo', 'left', 'right', 'mono']);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const validNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const loopback = (address = '') => address === '::1' || address === '127.0.0.1' || address.startsWith('::ffff:127.') || address.startsWith('127.');
const publicTrack = ({ file, cover, scanHash, detailsVersion, ...track }) => ({
  ...track, artwork: track.source === 'import' && !detailsVersion ? '/artwork/' + track.id : track.artwork,
});
const failure = (message, status = 400) => Object.assign(new Error(message), { status });
const text = (value, max = 120) => typeof value === 'string' ? value.trim().slice(0, max) : '';

function addresses() {
  return [...new Set(Object.values(os.networkInterfaces()).flat().filter((entry) => entry && entry.family === 'IPv4' && !entry.internal).map((entry) => entry.address))];
}

export async function startServer({
  port = 46321, host = '0.0.0.0', dataDir = path.join(projectDir, '.lume-data'),
  staticDir = path.join(projectDir, 'dist'), resourcesDir = path.join(projectDir, 'resources'),
  localAutoAuth = true,
} = {}) {
  dataDir = path.resolve(dataDir);
  const mediaDir = path.join(dataDir, 'media');
  const tempDir = path.join(dataDir, 'uploads');
  const coverDir = path.join(dataDir, 'covers');
  await Promise.all([mediaDir, tempDir, coverDir].map((directory) => fs.mkdir(directory, { recursive: true })));
  const libraryFile = path.join(dataDir, 'library.json');
  let persisted = {};
  try { persisted = JSON.parse(await fs.readFile(libraryFile, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') console.warn('无法读取已保存曲库，将保留原文件并使用新会话。', error.message); }

  let tracks = [];
  const savedTracks = Array.isArray(persisted.tracks) ? persisted.tracks : [];
  for (const track of savedTracks) {
    if (track.source !== 'import' || !track.id || !track.file) continue;
    // Persisted filenames are leaf names, never arbitrary local paths.
    if (path.basename(track.file) !== track.file) continue;
    try { await fs.access(path.join(mediaDir, track.file)); tracks.push(track); } catch { /* Missing imported files are omitted. */ }
  }
  try {
    const demoDir = path.join(resourcesDir, 'demo');
    const manifest = JSON.parse(await fs.readFile(path.join(demoDir, 'manifest.json'), 'utf8'));
    for (const item of manifest) {
      if (!item.id || !item.file || path.basename(item.file) !== item.file) continue;
      await fs.access(path.join(demoDir, item.file));
      const saved = savedTracks.find((track) => track.id === item.id);
      tracks.push({ id: item.id, title: item.title, artist: item.artist, album: item.album,
        duration: item.duration, format: item.format || 'WAV', artwork: item.artwork || '/covers/1.svg',
        source: 'demo', playCount:saved?.playCount, lastPlayedAt:saved?.lastPlayedAt, favorite: Boolean(saved?.favorite), file: item.file });
    }
  } catch (error) { if (error.code !== 'ENOENT') console.warn('示例音乐加载失败：', error.message); }
  for (const track of tracks) {
    track.playCount = Number.isSafeInteger(track.playCount) ? track.playCount : 0;
    if (track.bytes != null && track.quality && track.hasLyrics != null && track.sampleRate != null) continue;
    const file = path.join(track.source === 'demo' ? path.join(resourcesDir, 'demo') : mediaDir, track.file);
    try {
      track.bytes = (await fs.stat(file)).size;
      Object.assign(track, audioFacts(await parseFile(file, { skipCovers: true }), track.bytes, track.hasLyrics === true));
    } catch { /* Keep unavailable facts unknown for older files. */ }
  }
  const scanIndex = new Map();
  const scanSizes = new Set();
  const indexScan = track => {
    if (!track.scanHash) return;
    scanIndex.set(track.folder + '\0' + track.scanHash,track);
    scanSizes.add(track.folder + '\0' + track.bytes);
  };
  tracks.forEach(indexScan);
  let libraryVersion=tracks.length;
  let countedCurrent=false,eligibleCurrent=false,activeRecord=null;
  const playRecords=Array.isArray(persisted.playRecords)?persisted.playRecords:[];
  const listeningDays = persisted.listeningDays ?? {};
  let accountedUntil = Date.now();
  function dayTotals(time) {
    const d = new Date(time);
    const key = [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-');
    return listeningDays[key] ??= { starts:0, ms:0 };
  }
  // Settle elapsed playback before timeline changes so seeks and pauses add no listening time.
  function settleListening() {
    const now = Date.now();
    if (playback.playing) {
      const remaining = Math.max(0, (currentTrack()?.duration ?? 0) - playback.position);
      const end = Math.min(now, playback.updatedAt + remaining * 1000);
      let cursor = accountedUntil;
      while (cursor < end) {
        const midnight = new Date(cursor);
        midnight.setHours(midnight.getHours()+1,0,0,0);
        const next = Math.min(end, midnight.getTime());
        dayTotals(cursor).ms += next - cursor;
        if(activeRecord){activeRecord.listenedMs+=next-cursor;activeRecord.lastHeardAt=next;const d=new Date(cursor),key=[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');activeRecord.days[key]=(activeRecord.days[key]||0)+next-cursor;const hour=key+'T'+String(d.getHours()).padStart(2,'0');activeRecord.hours[hour]=(activeRecord.hours[hour]||0)+next-cursor;}
        cursor = next;
      }
    }
    accountedUntil = now;
  }
  function startRecord(){
    const track=currentTrack();if(!track||activeRecord)return;
    activeRecord={session:randomBytes(16).toString('hex'),id:track.id,title:track.title,artist:track.artist,album:track.album,format:track.format,quality:track.quality,sampleRate:track.sampleRate,bitDepth:track.bitDepth,duration:track.duration,source:track.source==='phone'?'room':'local',sourceType:'track',startedAt:Date.now(),completed:false,listenedMs:0,days:{},hours:{}};
    playRecords.push(activeRecord);eligibleCurrent=playback.position===0;
  }
  function countComplete() {
    const track=currentTrack();if(!track || countedCurrent)return;
    if(!activeRecord||!eligibleCurrent||activeRecord.listenedMs<(track.duration-Math.min(.25,track.duration*.01))*1000)return;
    activeRecord.completed=true;activeRecord.completedAt=Date.now();
    track.lastPlayedAt=activeRecord.startedAt;dayTotals(activeRecord.startedAt).starts++;
    track.playCount=(track.playCount||0)+1;countedCurrent=true;libraryVersion++;
  }
  const ids = new Set(tracks.map((track) => track.id));
  let queue = Array.isArray(persisted.queue) ? [...new Set(persisted.queue)].filter((id) => ids.has(id)) : tracks.map((track) => track.id);
  const playlists = (Array.isArray(persisted.playlists) ? persisted.playlists : [])
    .filter(p => p && typeof p.id === 'string' && typeof p.name === 'string' && Array.isArray(p.trackIds))
    .map(p => ({ ...p, trackIds: p.trackIds.filter(id => ids.has(id)) }));
  const prior = persisted.playback || {};
  let playback = {
    trackId: ids.has(prior.trackId) ? prior.trackId : queue[0] || null,
    playing: false, position: validNumber(prior.position) ? Math.max(0, prior.position) : 0,
    updatedAt: Date.now(), volume: validNumber(prior.volume) ? clamp(prior.volume, 0, 1) : 0.75,
    muted: Boolean(prior.muted), repeat: ['off', 'all', 'one'].includes(prior.repeat) ? prior.repeat : 'all',
    shuffle: Boolean(prior.shuffle),
  };
  let room = { name: text(persisted.room?.name, 40) || '我的聆听空间', ...(persisted.room?.skin ? {skin:persisted.room.skin}: {}) };
  const sessions = new Map();
  const pairAttempts = new Map();
  const devices = new Map();
  const trims = new Map(Object.entries(persisted.trims ?? {}).filter(([,v])=>Number.isInteger(v) && Math.abs(v)<=1000));
  let calibration=null;
  const beat={id:'lume-calibration',title:'同步校准节拍',duration:120,source:'demo',file:'calibration.wav'};
  const pairCode = String(randomInt(100000, 1000000));
  let actualPort = port;
  let closed = false;
  let closingPromise;
  let writeQueue = Promise.resolve();
  let endTimer;
  let uploadQueue = Promise.resolve();

  const currentTrack = () => tracks.find((track) => track.id === playback.trackId);
  const positionNow = () => {
    const duration = currentTrack()?.duration || Number.MAX_SAFE_INTEGER;
    return clamp(playback.position + (playback.playing ? Math.max(0, Date.now() - playback.updatedAt) / 1000 : 0), 0, duration);
  };
  const localIdentities=new MediaIdentities();
  const joinedRoom = new JoinedRoom({changed:()=>{if(!closed)broadcast();},
    resolveLocal:(identity,bytes)=>findLocalTrack(tracks,track=>path.join(trackRoot(track),track.file),localIdentities,identity,bytes)});
  const state = () => joinedRoom.snapshot([...devices.values()]) ?? ({ ...sources.snapshot(), listeningDays, playRecords, playlists, tracks: tracks.map(publicTrack), queue: [...queue], playback: { ...playback }, devices: [...devices.values()].map(({ socket, ...device }) => device), room: { ...room }, guestRoom:joinedRoom.info(), calibrating:!!calibration, pending:joins.pending(), serverTime: Date.now() });
  function persist() {
    settleListening();
    const snapshot = JSON.stringify({ listeningDays, playRecords, playlists, tracks:tracks.filter(t=>t.source!=='phone'), queue:queue.filter(id=>!id.startsWith('phone-')), playback: { ...playback, position: positionNow(), playing: false, updatedAt: Date.now() }, room, trims:Object.fromEntries(trims) }, null, 2);
    writeQueue = writeQueue.catch(() => {}).then(async () => {
      const temporary = `${libraryFile}.tmp`;
      await fs.writeFile(temporary, snapshot, 'utf8');
      await fs.rename(temporary, libraryFile);
    });
    return writeQueue;
  }
  function broadcast() {
    const message = JSON.stringify({ type: 'state', state: state() });
    for (const socket of wss.clients) if (socket.readyState === WebSocket.OPEN) socket.send(message);
  }
  function stopAtCurrentPosition() { playback.position = positionNow(); playback.updatedAt = Date.now(); }
  function selectTrack(id, playing = true) {
    if (!ids.has(id)) throw failure('找不到这首音乐。', 404);
    settleListening();
    if (!queue.includes(id)) queue.push(id);
    playback = { ...playback, trackId: id, playing, position: 0, updatedAt: Date.now() };
    countedCurrent=false;activeRecord=null;eligibleCurrent=false;if(playing)startRecord();
  }
  function advance(direction = 1, natural = false) {
    settleListening();
    if(natural)countComplete();
    if (!queue.length) { playback.playing = false; playback.trackId = null; playback.position = 0; playback.updatedAt = Date.now(); return; }
    if (natural && playback.repeat === 'one' && playback.trackId) { selectTrack(playback.trackId); return; }
    const index = queue.indexOf(playback.trackId);
    let next = index + direction;
    if (playback.shuffle && queue.length > 1) {
      const choices = queue.filter((id) => id !== playback.trackId);
      selectTrack(choices[randomInt(choices.length)]); return;
    }
    if (natural && next >= queue.length && playback.repeat === 'off') {
      playback.position = currentTrack()?.duration || positionNow(); playback.playing = false; playback.updatedAt = Date.now(); return;
    }
    next = (next + queue.length) % queue.length;
    selectTrack(queue[next]);
  }
  function scheduleEnd() {
    clearTimeout(endTimer);
    const duration = currentTrack()?.duration;
    if (!playback.playing || !duration || closed) return;
    endTimer = setTimeout(() => {
      advance(1, true); broadcast(); persist().catch(console.error); scheduleEnd();
    }, Math.max(20, (duration - positionNow()) * 1000));
    endTimer.unref?.();
  }
  function setOutput(id, patch) {
    const device = devices.get(id);
    if (!device) throw failure('设备已离线。',404);
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw failure('无效的设备设置。');
    const update = {};
    for (const [key, value] of Object.entries(patch)) {
      if (key === 'name' && text(value,48)) update.name = text(value,48);
      else if (key === 'channel' && CHANNELS.has(value)) update.channel = value;
      else if (key === 'delayMs' && Number.isInteger(value) && Math.abs(value)<=1000) update.delayMs = value;
      else if (key === 'volume' && validNumber(value)) update.volume = clamp(value,0,1);
      else if ((key === 'enabled' || key === 'muted') && typeof value==='boolean') update[key] = value;
      else throw failure('无效的设备设置。');
    }
    Object.assign(device,update);
    if (device.profile && 'delayMs' in update) {
      trims.set(device.profile,update.delayMs);
      persist().catch(console.error);
    }
    broadcast();
  }
  function action(input) {
    if (!input || typeof input !== 'object') throw failure('无效的播放操作。');
    settleListening();
    const { type, value, trackId } = input;
    if(type==='output'){setOutput(input.id,input.patch);return;}
    if(type==='source-play'){sources.choose(input.deviceId,trackId);broadcast();return;}
    if(['play','pause','seek','previous','next','calibration','queue-set','queue-remove'].includes(type))sources.cancel();
    if(type==='calibration'){
      if(value===true && !calibration){
        calibration={since:Date.now(),resume:playback.playing};
        stopAtCurrentPosition();playback.playing=false;
      }else if(value===false && calibration){
        playback.playing=calibration.resume;playback.updatedAt=Date.now();calibration=null;
      }
      scheduleEnd();broadcast();return;
    }
    if(type==='join-allow'||type==='join-deny'){joins.decide(value,type==='join-allow'?'allow':'deny');broadcast();return;}
    if(['play','pause','seek','next','previous','queue-set','queue-remove'].includes(type))calibration=null;
    switch (type) {
      case 'play':
        if (trackId) selectTrack(trackId);
        else {
          if (!playback.trackId && queue.length) selectTrack(queue[0]);
          if (!playback.trackId) throw failure('请先导入音乐。');
          stopAtCurrentPosition();
          if (playback.position >= (currentTrack()?.duration || Infinity)) {playback.position = 0;countedCurrent=false;activeRecord=null;}
          startRecord();
          playback.playing = true;
        }
        break;
      case 'pause': stopAtCurrentPosition(); playback.playing = false; break;
      case 'seek':
        if (!validNumber(input.position) || !playback.trackId) throw failure('无效的播放进度。');
        eligibleCurrent=input.position===0;
        playback.position = clamp(input.position, 0, currentTrack()?.duration || 0); playback.updatedAt = Date.now(); break;
      case 'next': advance(); break;
      case 'previous':
        if (positionNow() > 3) { playback.position = 0; playback.updatedAt = Date.now();activeRecord=null;countedCurrent=false;if(playback.playing)startRecord(); }
        else advance(-1);
        break;
      case 'volume': if (!validNumber(value)) throw failure('无效的音量。'); playback.volume = clamp(value, 0, 1); break;
      case 'muted': if (typeof value !== 'boolean') throw failure('无效的静音状态。'); playback.muted = value; break;
      case 'repeat': if (!['off', 'all', 'one'].includes(value)) throw failure('无效的循环模式。'); playback.repeat = value; break;
      case 'shuffle': if (typeof value !== 'boolean') throw failure('无效的随机播放状态。'); playback.shuffle = value; break;
      case 'favorite': {
        const track = tracks.find((item) => item.id === trackId);
        if (!track) throw failure('找不到这首音乐。', 404);
        track.favorite = typeof value === 'boolean' ? value : !track.favorite; break;
      }
      case 'playlist-save': {
        const name = text(value, 60);
        if (!name || !Array.isArray(input.trackIds) || input.trackIds.length > 10000 || input.trackIds.some(id => !ids.has(id))) throw failure('歌单名称或曲目无效。');
        const list = input.playlistId ? playlists.find(p => p.id === input.playlistId) : { id: randomBytes(12).toString('hex') };
        if (!list) throw failure('找不到歌单。', 404);
        list.name = name; list.trackIds = [...new Set(input.trackIds)];
        if (!input.playlistId) playlists.push(list);
        break;
      }
      case 'queue-add': if (!ids.has(trackId)) throw failure('找不到这首音乐。', 404); if (!queue.includes(trackId)) queue.push(trackId); break;
      case 'queue-remove':
        queue = queue.filter((id) => id !== trackId);
        if (playback.trackId === trackId) {
          const wasPlaying = playback.playing;
          if (queue.length) selectTrack(queue[0], wasPlaying);
          else playback = { ...playback, trackId: null, playing: false, position: 0, updatedAt: Date.now() };
        }
        break;
      case 'queue-set':
        if (!Array.isArray(input.trackIds) || input.trackIds.length > 10000 || input.trackIds.some((id) => !ids.has(id))) throw failure('无效的播放队列。');
        queue = [...new Set(input.trackIds)];
        if(value===true && queue.length) { selectTrack(queue[0]); break; }
        if (!queue.includes(playback.trackId)) {
          const wasPlaying = playback.playing;
          if (queue.length) selectTrack(queue[0], wasPlaying);
          else playback = { ...playback, trackId: null, playing: false, position: 0, updatedAt: Date.now() };
        }
        break;
      case 'room-skin': {
        if (!value) {delete room.skin;break;}
        let skin;try {skin=JSON.parse(value);}catch{throw failure('无效皮肤');}
        if (!text(skin?.name,32)||!['background','surface','ink','accent'].every(k=>typeof skin[k]==='string' && /^#[0-9a-f]{6}$/i.test(skin[k]))) throw failure('无效皮肤');
        room.skin={name:text(skin.name,32),background:skin.background,surface:skin.surface,ink:skin.ink,accent:skin.accent};break;
      }
      case 'room-name': if (!text(value, 40)) throw failure('请填写空间名称。'); room.name = text(value, 40); break;
      default: throw failure('暂不支持这项操作。');
    }
    scheduleEnd(); broadcast();
  }

  const app = express();
  const server = createServer(app);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  app.disable('x-powered-by');
  const allowedHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]', os.hostname().toLowerCase(), ...addresses()]);
  function allowedRequest(req) {
    let hostName;
    try { hostName = new URL(`http://${req.headers.host}`).hostname.toLowerCase(); } catch { return false; }
    if (!allowedHosts.has(hostName)) return false;
    const origin = req.headers.origin;
    if (!origin) return true;
    try {
      const url = new URL(origin);
      // Match the browser-facing Host, including the development proxy's port.
      return ['http:', 'https:'].includes(url.protocol) && url.host.toLowerCase() === req.headers.host.toLowerCase();
    } catch { return false; }
  }
  function authorized(req) {
    if (localAutoAuth && loopback(req.socket.remoteAddress)) return true;
    const token = (req.headers.cookie || '').split(';').map((cookie) => cookie.trim()).find((cookie) => cookie.startsWith('lume_session='))?.slice(13);
    if (!token) return false;
    const expiry = sessions.get(token);
    if (!expiry || expiry < Date.now()) { sessions.delete(token); return false; }
    return true;
  }
  app.use((req, res, next) => {
    if (closed) return res.status(503).json({ error: '播放器正在关闭，请稍后重新连接。' });
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    const lyricsPage=req.path.startsWith('/pc-lyrics/');
    res.setHeader('X-Frame-Options', lyricsPage ? 'SAMEORIGIN' : 'DENY');
    res.setHeader('Content-Security-Policy', lyricsPage
      ? "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' data: blob:; font-src 'self' data: blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'"
      : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self' ws: wss: data: blob:; font-src 'self' data: blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
    if (!allowedRequest(req)) return res.status(403).json({ error: '连接来源不受信任，请从播放器提供的地址打开。' });
    next();
  });
  app.use('/api/receiver',express.json({limit:'4mb'}));
  app.use(express.json({ limit: '64kb' }));
  app.get('/api/info', (req, res) => res.json({ name: '澄音 LUME', version: '0.5.5', service:'lume-room/1', roomName:room.name, urls: addresses().map((ip) => `http://${ip}:${actualPort}`),
    ...(loopback(req.socket.remoteAddress) ? { pairCode } : {}), paired: authorized(req) }));
  app.get('/api/time', (_req, res) => res.json({ serverTime: Date.now() }));
  function issueSession(res){
    const token = randomBytes(32).toString('hex');
    sessions.set(token, Date.now() + 7 * 24 * 60 * 60 * 1000);
    res.cookie('lume_session', token, { httpOnly:true, sameSite:'strict', maxAge:7*24*60*60*1000, path:'/' });
  }
  const joins=joinRequests(app,broadcast,issueSession);
  app.post('/api/pair', (req, res) => {
    const address = req.socket.remoteAddress;
    const attempts = pairAttempts.get(address) || { count: 0, until: Date.now() + 60000 };
    if (attempts.until < Date.now()) { attempts.count = 0; attempts.until = Date.now() + 60000; }
    if (attempts.count >= 10) return res.status(429).json({ error: '尝试次数过多，请一分钟后重试。' });
    attempts.count += 1; pairAttempts.set(address, attempts);
    const code = String(req.body?.code || '');
    if (!/^\d{6}$/.test(code) || !timingSafeEqual(Buffer.from(code), Buffer.from(pairCode))) return res.status(401).json({ error: '配对码不正确，请查看 Windows 端的连接信息。' });
    pairAttempts.delete(address);issueSession(res);
    res.json({ paired: true });
  });
  app.use(['/api', '/media', '/artwork'], (req, res, next) => authorized(req) ? next() : res.status(401).json({ error: '请先输入 Windows 端显示的配对码。' }));
  let nearby;
  app.use('/api/nearby', (req, res, next) => {
    if (!loopback(req.socket.remoteAddress)) return res.sendStatus(403);
    if (!nearby) return res.status(503).json({error:'请在局域网主机上搜索手机'});
    res.set('Cache-Control','no-store');
    next();
  });
  app.get('/api/nearby', async (_req, res) => {
    try { res.json(await nearby.search()); }
    catch { res.status(503).json({error:'搜索失败，请检查电脑的局域网连接'}); }
  });
  app.post('/api/nearby/invite', async (req, res) => {
    try {
      if (!await nearby.invite(req.body?.id)) return res.status(404).json({error:'手机已离线，请重新搜索'});
      res.json({sent:true});
    } catch { res.status(503).json({error:'发送失败，请重新邀请'}); }
  });
  app.get('/api/room/cover/:key',(req,res)=>{
    const details=joinedRoom.details;
    if(!joinedRoom.active() || details?.key!==req.params.key || !details.image)return res.sendStatus(404);
    res.set('Cache-Control','no-store').type(details.mime).send(details.image);
  });
  app.get('/api/state', (_req, res) => res.json(state()));
  app.post('/api/room/leave',async(req,res)=>{
    if(!loopback(req.socket.remoteAddress))return res.sendStatus(403);
    await joinedRoom.leave();broadcast();res.json(state());
  });
  const sources=await phoneLibraries(app,{
    devices,broadcast,
    play(track){
      if(!ids.has(track.id)){track.addedAt=Date.now();tracks.push(track);ids.add(track.id);libraryVersion++;}
      calibration=null;selectTrack(track.id);scheduleEnd();broadcast();
    },
    discard(track){tracks=tracks.filter(t=>t.id!==track.id);ids.delete(track.id);queue=queue.filter(id=>id!==track.id);libraryVersion++;}
  });
  const trackRoot=track=>track.source==='phone'?sources.directory:track.source==='demo'?path.join(resourcesDir,'demo'):mediaDir;
  const closeReceivers = await mountReceivers(app, { devices, broadcast, trims, sources, pending:()=>joins.pending(),
    current: () => ({ track: calibration?beat:currentTrack(), playback:calibration?{...playback,playing:true}:playback,
      position:calibration?((Date.now()-calibration.since)/1000)%beat.duration:positionNow(), skin:room.skin??null,
      catalog:tracks, libraryVersion, playRecords, listeningDays }),
    sourcePath: track => path.join(trackRoot(track),track.file) });
  app.post('/api/action', async (req, res) => {
    if(joinedRoom.active())await joinedRoom.action(req.body);
    else {action(req.body);await persist();}
    res.json(state());
  });
  const upload = multer({ dest: tempDir, limits: { files: 60, fileSize: 200 * 1024 * 1024, fields: 4, fieldSize: 128 * 1024 },
    fileFilter(_req, file, callback) {
      if (file.fieldname === 'attachments' && /\.(lrc|jpg|jpeg|png|webp)$/i.test(file.originalname)) return callback(null, true);
      if (file.fieldname !== 'files' || !AUDIO_EXTENSIONS.has(path.extname(file.originalname).toLowerCase())) callback(failure('支持 MP3、WAV、FLAC、M4A、AAC、OGG、OPUS 和 WebM 音频。'));
      else callback(null, true);
    },
  });
  app.post('/api/upload', upload.fields([{ name: 'files', maxCount: 20 }, { name: 'attachments', maxCount: 40 }]), async (req, res) => {
    const importedFiles = req.files?.files || [];
    const attachments = req.files?.attachments || [];
    try {
      res.json(await importBatch(importedFiles, attachments, req.body));
    } finally {
      await Promise.all([...attachments, ...importedFiles].map(file => fs.unlink(file.path).catch(() => {})));
    }
  });
  async function importLocal(paths, companions, body) {
    if (!Array.isArray(paths) || paths.length>20 || !Array.isArray(companions) || companions.length>40) throw failure('选择的文件过多。');
    const files=paths.map(source=>{
      if(!path.isAbsolute(source)||!AUDIO_EXTENSIONS.has(path.extname(source).toLowerCase()))throw failure('不支持的音频文件。');
      return {source,originalname:path.basename(source),path:path.join(tempDir,randomBytes(16).toString('hex'))};
    });
    const attachments=await Promise.all(companions.map(async source=>{
      if(!path.isAbsolute(source)||!(/\.(lrc|jpg|jpeg|png|webp)$/i.test(source)))throw failure('不支持的附件。');
      const stat=await fs.stat(source).catch(()=>null);
      return {path:source,size:stat?.isFile()?stat.size:Infinity};
    }));
    return importBatch(files,attachments,body);
  }
  function importBatch(importedFiles, attachments, body) {
    if (!importedFiles.length) throw failure('请选择要导入的音乐。');
    const run = async () => {
      let imported = 0, skipped = 0;
      let folders = [];
      if (body.folders) {
        try { folders = JSON.parse(body.folders); } catch { folders = null; }
        if (!Array.isArray(folders) || folders.length !== importedFiles.length ||
            folders.some(f => typeof f !== 'string' || !f || f.length > 4096 || f.split('/').some(part => !part || part === '..' || part === '.'))) {
          throw failure('无效的文件夹信息。');
        }
      }
      const lyricsMask = typeof body.lyrics === 'string' ? body.lyrics : '';
      let links = [];
      if (body.links) {
        try { links = JSON.parse(body.links); } catch { throw failure('附件信息无效。'); }
        if (!Array.isArray(links) || links.length !== importedFiles.length) throw failure('附件数量不匹配。');
      }
      const attachment = async (index, limit) => {
        const file = Number.isInteger(index) && attachments[index];
        return file && file.size <= limit ? fs.readFile(file.path) : null;
      };
      const rejected = [];
      const directories = new Map();
      async function hashFile(source, copyTo) {
        const hash = createHash('sha256');
        const input = createReadStream(source,{highWaterMark:1024*1024});
        if (copyTo) {
          input.on('data',chunk=>hash.update(chunk));
          await pipeline(input,createWriteStream(copyTo));
        } else {
          for await(const chunk of input)hash.update(chunk);
        }
        return hash.digest('hex');
      }
      for (const [index, file] of importedFiles.entries()) {
        const id = randomBytes(12).toString('hex');
        const filename = `${id}${path.extname(file.originalname).toLowerCase()}`;
        try {
          const folder = folders[index];
          let scanHash;
          if(file.source){
            const stat=await fs.stat(file.source);
            if(!stat.isFile()||stat.size>200*1024*1024)throw failure('文件不可读或超过 200 MB。');
            if(folder&&scanSizes.has(folder+'\0'+stat.size))scanHash=await hashFile(file.source);
            if(!scanHash||!scanIndex.has(folder+'\0'+scanHash)){
              if(folder)scanHash=await hashFile(file.source,file.path);
              else await fs.copyFile(file.source,file.path);
              file.size=(await fs.stat(file.path)).size;
              if(file.size>200*1024*1024)throw failure('文件超过 200 MB。');
            }
          }
          const linked = links[index] || {};
          const companion = async (kind, limit) => {
            if(linked[kind] != null)return attachment(linked[kind], limit);
            if(!file.source || folder)return null;
            const {dir,name}=path.parse(file.source);
            const names=kind==='lyrics'?[name+'.lrc']:[name,'cover','folder','front'].flatMap(stem=>['jpg','jpeg','png','webp'].map(ext=>stem+'.'+ext));
            if(!directories.has(dir)){
              const entries=await fs.readdir(dir,{withFileTypes:true}).catch(()=>[]);
              directories.set(dir,new Map(entries.filter(e=>e.isFile()).map(e=>[e.name.toLowerCase(),e.name])));
            }
            const entries=directories.get(dir);
            for(const leaf of names){
              const actual=entries.get(leaf.toLowerCase());
              if(!actual)continue;
              const candidate=path.join(dir,actual);
              const stat=await fs.lstat(candidate).catch(()=>null);
              if(stat?.isFile()&&stat.size<=limit)return fs.readFile(candidate).catch(()=>null);
            }
            return null;
          };
          const sideLyrics = decodeLyrics(await companion('lyrics',512*1024)).trim();
          const sideCover = () => companion('cover',16*1024*1024);
          if (folder) {
            scanHash ??= await hashFile(file.path);
            const existing = scanIndex.get(folder+'\0'+scanHash);
            if (existing) {
              if (sideLyrics) {
                await fs.writeFile(path.join(mediaDir, existing.id + '.lrc'), sideLyrics);
                existing.hasLyrics = true; libraryVersion++;
              }
              if (!existing.cover && links[index]?.cover != null) {
                const bytes = await sideCover();
                if (coverMime(bytes)) {
                  existing.cover = await saveCover(existing.id, bytes);
                  existing.artwork = '/artwork/' + existing.id; libraryVersion++;
                }
              }
              if (lyricsMask[index] === '1' && !existing.hasLyrics) { existing.hasLyrics = true; libraryVersion++; }
              await fs.unlink(file.path).catch(()=>{});
              skipped++; continue;
            }
          }
          let metadata = await parseFile(file.path);
          if (!(metadata.format.duration > 0)) metadata = await parseFile(file.path, { duration: true });
          if (!validNumber(metadata.format.duration) || metadata.format.duration <= 0 || !metadata.format.sampleRate) throw failure('无法读取有效的音频内容。');
          if (folder && body.skipShort === '1' && metadata.format.duration < 60) {
            await fs.unlink(file.path); skipped++; continue;
          }
          let cover;
          let artwork = `/covers/${(tracks.length % 3) + 1}.svg`;
          const picture = frontCover(metadata.common.picture)?.data ?? await sideCover();
          if (coverMime(picture)) {
            cover = await saveCover(id, picture);
            artwork = '/artwork/' + id;
          }
          const lyrics = sideLyrics || embeddedLyrics(metadata);
          if (lyrics) await fs.writeFile(path.join(mediaDir, id + '.lrc'), lyrics);
          await fs.rename(file.path, path.join(mediaDir, filename));
          const displayName = file.source ? file.originalname : Buffer.from(file.originalname, 'latin1').toString('utf8');
          const originalName = displayName.includes('\ufffd') ? file.originalname : displayName;
          const track = { id, title: text(metadata.common.title) || path.parse(originalName).name,
            artist: text(metadata.common.artist) || '未知艺术家', album: text(metadata.common.album) || '本地音乐',
            duration: metadata.format.duration, format: path.extname(filename).slice(1).toUpperCase(), artwork,
            addedAt: Date.now(), detailsVersion: 1, ...audioFacts(metadata, file.size, !!lyrics || lyricsMask[index] === '1'), playCount:0,
            source: 'import', favorite: false, file: filename, ...(folder ? { folder, scanHash } : {}), ...(cover ? { cover } : {}) };
          indexScan(track); tracks.push(track); ids.add(id); queue.push(id); imported += 1;libraryVersion++;
        } catch (error) {
          rejected.push({ name: file.originalname, reason: error.message || '无法导入此文件。' });
          await fs.unlink(file.path).catch(() => {});
          await fs.unlink(path.join(mediaDir, filename)).catch(() => {});
          await fs.unlink(path.join(mediaDir, id + '.lrc')).catch(() => {});
          await fs.unlink(path.join(coverDir, id + '.img')).catch(() => {});
        }
      }
      if (!playback.trackId && queue.length) selectTrack(queue[0], false);
      await persist(); broadcast();
      return { imported, skipped, rejected, state: state() };
    };
    uploadQueue=uploadQueue.catch(()=>{}).then(run);
    return uploadQueue;
  }
  app.get('/media/:id', async (req, res, next) => {
    if(joinedRoom.active()){
      const local=joinedRoom.packet?.trackId===req.params.id?joinedRoom.localTrack:null;
      if(local&&req.query.remote!=='1'){
        try{
          const file=path.join(trackRoot(local),local.file),identity=await localIdentities.identify(file);
          if(joinedRoom.packet?.trackId===req.params.id&&identity?.audioIdentity===joinedRoom.packet?.audioIdentity){
            res.setHeader('Cache-Control','no-store');
            res.sendFile(file,{acceptRanges:true},error=>{if(error&&!res.headersSent)res.redirect(307,req.path+'?remote=1');});return;
          }
        }catch{/* Missing or revoked local media keeps using the host. */}
      }
      try {
        const upstream=await joinedRoom.media(req.params.id,req.headers.range);
        res.status(upstream.status);
        for(const key of ['content-type','content-length','content-range','accept-ranges'])if(upstream.headers.has(key))res.setHeader(key,upstream.headers.get(key));
        res.setHeader('Cache-Control','no-store');
        await pipeline(Readable.fromWeb(upstream.body),res);
      } catch(error){if(!res.headersSent)next(error);}
      return;
    }
    const track = tracks.find((item) => item.id === req.params.id);
    if (!track) return next(failure('音乐不存在。', 404));
    const base = trackRoot(track);
    res.sendFile(track.file, { root: base, acceptRanges: true, cacheControl: true, maxAge: '1h' }, (error) => { if (error && !res.headersSent) next(error); });
  });
  async function saveCover(id, bytes) {
    const cover = {file: id + '.img', mime: coverMime(bytes)};
    await fs.writeFile(path.join(coverDir, cover.file), bytes);
    return cover;
  }
  const legacyReads = new Map();
  async function restoreDetails(track) {
    if(track.source!=='import'||track.detailsVersion)return;
    if(legacyReads.has(track.id))return legacyReads.get(track.id);
    const read=async()=>{
      const metadata=await parseFile(path.join(mediaDir,track.file));
      const picture=frontCover(metadata.common.picture);
      if(picture&&!track.cover){
        track.cover=await saveCover(track.id,picture.data);
        track.artwork='/artwork/'+track.id;
      }
      const lyrics=embeddedLyrics(metadata);
      if(lyrics){
        await fs.writeFile(path.join(mediaDir,track.id+'.lrc'),lyrics,{flag:'wx'}).catch(error=>{if(error.code!=='EEXIST')throw error;});
        track.hasLyrics=true;
      }
      track.detailsVersion=1;
    };
    legacyReads.set(track.id,read().finally(()=>legacyReads.delete(track.id)));
    return legacyReads.get(track.id);
  }
  async function readLyrics(id) {
    if(joinedRoom.active()){
      if(joinedRoom.packet?.trackId!==id)return '';
      if(joinedRoom.localTrack){try{
        const track=joinedRoom.localTrack,identity=await localIdentities.identify(path.join(trackRoot(track),track.file));
        if(identity?.audioIdentity===joinedRoom.packet?.audioIdentity){const local=await readLocalLyrics(track.id);if(local.trim())return local;}
      }catch{}}
      return joinedRoom.details?.trackId===id?joinedRoom.details.lyrics:'';
    }
    return readLocalLyrics(id);
  }
  async function readLocalLyrics(id) {
    const track = tracks.find(t => t.id === id);
    if (!track) throw failure('音乐不存在。', 404);
    let lyrics = '';
    if (track.source === 'import') {
      await restoreDetails(track);
      try { lyrics = await fs.readFile(path.join(mediaDir, track.id + '.lrc'), 'utf8'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return lyrics;
  }
  app.get('/api/lyrics/:id', async (req, res) => {
    res.json({lyrics:await readLyrics(req.params.id)});
  });
  app.get('/artwork/:id', async (req, res, next) => {
    const track = tracks.find((item) => item.id === req.params.id);
    if (!track) return next(failure('封面不存在。', 404));
    if(!track.cover)await restoreDetails(track).catch(()=>{});
    if (!track.cover) return res.redirect(track.artwork || '/covers/1.svg');
    res.type(track.cover.mime).sendFile(track.cover.file, { root: coverDir, maxAge: '1d' }, (error) => { if (error && !res.headersSent) next(error); });
  });
  app.use(['/api', '/media', '/artwork'], (_req, _res, next) => next(failure('找不到这个接口。', 404)));
  app.use(express.static(staticDir, { index: 'index.html' }));
  app.get('/{*page}', (req, res, next) => {
    if (path.extname(req.path)) return next(failure('文件不存在。', 404));
    res.sendFile('index.html', { root: staticDir }, (error) => { if (error && !res.headersSent) next(failure('界面尚未构建，请先运行 npm run build。', 503)); });
  });
  app.use((error, _req, res, _next) => {
    if (res.headersSent) return;
    const status = error instanceof multer.MulterError ? 400 : error.status || (error.type === 'entity.parse.failed' ? 400 : 500);
    const message = error instanceof multer.MulterError ? '导入失败：一次最多 20 首，每首不超过 200 MB。' : status >= 500 ? '操作未完成，请稍后重试。' : error.message;
    if (status >= 500) console.error(error);
    res.status(status).json({ error: message });
  });

  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/ws' || !allowedRequest(req) || !authorized(req)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); socket.destroy(); return;
    }
    wss.handleUpgrade(req, socket, head, (client) => wss.emit('connection', client, req));
  });
  wss.on('connection', (socket) => {
    socket.isAlive = true;
    socket.on('pong', () => { socket.isAlive = true; if (socket.deviceId && devices.get(socket.deviceId)?.socket === socket) devices.get(socket.deviceId).lastSeen = Date.now(); });
    socket.send(JSON.stringify({ type: 'state', state: state() }));
    socket.on('message', (raw) => {
      try {
        const message = JSON.parse(raw.toString());
        if (message.type === 'register') {
          const input = message.device;
          if (!input || !/^[a-zA-Z0-9_-]{1,100}$/.test(input.id || '')) throw failure('无效的设备标识。');
          if ('volume' in input && !validNumber(input.volume)) throw failure('无效的设备音量。');
          if ('muted' in input && typeof input.muted !== 'boolean') throw failure('无效的设备静音状态。');
          if ('enabled' in input && typeof input.enabled !== 'boolean') throw failure('无效的设备输出状态。');
          if (socket.deviceId && socket.deviceId !== input.id && devices.get(socket.deviceId)?.socket === socket) devices.delete(socket.deviceId);
          const old = devices.get(input.id);
          if (old?.socket && old.socket !== socket) old.socket.close(4001, '设备已重新连接');
          socket.deviceId = input.id;
          devices.set(input.id, { id: input.id, name: text(input.name, 48) || '网页播放器', platform: text(input.platform, 24) || 'Web',
            channel: CHANNELS.has(input.channel) ? input.channel : 'stereo',
            volume: validNumber(input.volume) ? clamp(input.volume, 0, 1) : old?.volume ?? 1,
            delayMs: Number.isInteger(input.delayMs) && Math.abs(input.delayMs)<=1000 ? input.delayMs : old?.delayMs ?? 0,
            muted: typeof input.muted === 'boolean' ? input.muted : old?.muted ?? false,
            enabled: typeof input.enabled === 'boolean' ? input.enabled : false, lastSeen: Date.now(), socket });
          broadcast();
        } else if (message.type === 'device') {
          if(joinedRoom.active()){
            if(devices.has(message.id))setOutput(message.id,message.patch);
            const id=joinedRoom.localOutputId(message.id,[...devices.values()]);
            void joinedRoom.action({type:'output',id,patch:message.patch}).catch(error=>{
              if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:'error',error:error.message}));
            });
          } else setOutput(message.id, message.patch);
        } else if (message.type === 'ping') socket.send(JSON.stringify({ type: 'pong', serverTime: Date.now(), sentAt: message.sentAt }));
        else throw failure('未知的设备消息。');
      } catch (error) { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'error', error: error.message || '无法处理设备消息。' })); }
    });
    socket.on('close', () => {
      if (socket.deviceId && devices.get(socket.deviceId)?.socket === socket) { devices.delete(socket.deviceId); broadcast(); }
    });
    socket.on('error', () => {});
  });
  const heartbeat = setInterval(() => {
    if (playback.playing) { settleListening(); broadcast(); }
    for (const socket of wss.clients) {
      if (socket.isAlive === false) { socket.terminate(); continue; }
      socket.isAlive = false; socket.ping();
    }
    for (const [token, expiry] of sessions) if (expiry < Date.now()) sessions.delete(token);
    for (const [ip, item] of pairAttempts) if (item.until < Date.now()) pairAttempts.delete(ip);
  }, 30000);
  heartbeat.unref();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => { server.removeListener('error', reject); actualPort = server.address().port; resolve(); });
  }).catch((error) => { clearInterval(heartbeat); throw error; });
  if (host==='0.0.0.0') nearby=nearbyPhones(actualPort,()=>room.name);
  const stopDiscovery=host==='0.0.0.0'?advertise(actualPort,()=>room.name):()=>{};
  return {
    importLocal, readLyrics, port: actualPort, url: `http://127.0.0.1:${actualPort}`, pairCode, dataDir, app, roomUrl:id=>nearby?.roomUrl(id),
    async joinRoom(url) {
      const joined=await joinedRoom.join(url);
      settleListening();stopAtCurrentPosition();playback.playing=false;clearTimeout(endTimer);
      await persist();broadcast();return joined;
    },
    close() {
      if (closingPromise) return closingPromise;
      nearby?.close();stopDiscovery();closed = true; clearTimeout(endTimer); clearInterval(heartbeat);
      const leftRoom=joinedRoom.leave();
      settleListening(); stopAtCurrentPosition(); playback.playing = false;
      for (const socket of wss.clients) socket.terminate();
      // Stop new connections first and let accepted HTTP work finish before saving.
      // Bound shutdown time for stalled uploads without skipping completed imports.
      const httpClosed = new Promise((resolve) => server.close(resolve));
      const websocketClosed = new Promise((resolve) => wss.close(resolve));
      const forceClose = setTimeout(() => server.closeAllConnections(), 5000);
      forceClose.unref();
      closingPromise = (async () => {
        await leftRoom;
        try {
          await Promise.all([httpClosed, websocketClosed]);
          await uploadQueue.catch(() => {});
          await persist();
        } finally {
          await closeReceivers();await sources.close();
          clearTimeout(forceClose); server.closeAllConnections();
        }
      })();
      return closingPromise;
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const instance = await startServer({ port: Number(process.env.LUME_PORT) || 46321, ...(process.env.LUME_DATA_DIR ? { dataDir: process.env.LUME_DATA_DIR } : {}) });
  console.log(`澄音 LUME 已启动：${instance.url}`);
  for (const address of addresses()) console.log(`局域网：http://${address}:${instance.port}`);
  console.log(`配对码：${instance.pairCode}`);
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    try { await instance.close(); process.exit(0); }
    catch (error) { console.error('播放器已关闭，但最后的播放状态未能保存：', error.message); process.exit(1); }
  };
  process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
}
