import express from 'express';
import { MAX_AUDIO_BYTES } from '../shared/audio-size.mjs';
import {startPersonalDevices} from './personal-devices.mjs';
import { coverMime, frontCover, embeddedLyrics, decodeLyrics } from '../shared/song-details.mjs';
import { audioFacts, losslessQuality } from './audio-facts.mjs';
import { advertise, joinRequests, nearbyPhones } from './discovery.mjs';
import {receiveRoomInvites} from './desktop-invitations.mjs';
import { phoneLibraries } from './phone-libraries.mjs';
import { mountReceivers } from './receivers.mjs';
import { JoinedRoom } from './joined-room.mjs';
import {MediaIdentities,findLocalTrack} from './local-media.mjs';
import multer from 'multer';
import { WebSocketServer, WebSocket } from 'ws';
import { parseFile } from './audio-facts.mjs';
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
const publicTrack = ({ file, cover, scanHash, scanOrigin, lyricsFile, detailsVersion, ...track }) => ({
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
  localAutoAuth = true, personalAddress = host==='0.0.0.0'?host:null,confirmRoomInvite,onInviteError=()=>{},
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
  // Bound filesystem concurrency and preserve the persisted library order.
  for (let offset = 0; offset < savedTracks.length; offset += 32) {
    const batch = await Promise.all(savedTracks.slice(offset, offset + 32).map(async track => {
      if (track?.source !== 'import' || typeof track.id !== 'string' || typeof track.file !== 'string' ||
          !track.file || path.basename(track.file) !== track.file) return null;
      try { await fs.access(path.join(mediaDir, track.file)); return track; }
      catch { return null; }
    }));
    tracks.push(...batch.filter(Boolean));
  }
  for (const track of tracks) {
    if(typeof track.format!=='string'||!track.format)track.format=path.extname(track.file).slice(1).toUpperCase()||'音频';
    if(typeof track.title!=='string'||!track.title)track.title=path.parse(track.file).name;
    track.artist=typeof track.artist==='string'?track.artist:'';
    track.album=typeof track.album==='string'?track.album:'';
    track.playCount = Number.isSafeInteger(track.playCount) ? track.playCount : 0;
    if (track.quality === 'lossless' && track.bitDepth != null && track.sampleRate != null) {
      track.quality = losslessQuality(track.bitDepth, track.sampleRate);
    }
    if (track.bytes != null && track.quality && track.hasLyrics != null && track.sampleRate != null) continue;
    const file = path.join(mediaDir, track.file);
    try {
      track.bytes = (await fs.stat(file)).size;
      Object.assign(track, audioFacts(await parseFile(file, { skipCovers: true }), track.bytes, track.hasLyrics === true));
    } catch { /* Keep unavailable facts unknown for older files. */ }
  }
  const scanByPath=new Map(), scanByIdentity=new Map();
  const scanSkipped=new Map(Array.isArray(persisted.scanSkipped)?persisted.scanSkipped:[]);
  const originKey=source=>process.platform==='win32'?source.toLowerCase():source;
  function scanKnown(origin,skipShort){
    const key=originKey(origin.path);
    return scanByPath.get(key)?.scanOrigin.stamp===origin.stamp || (skipShort && scanSkipped.get(key)===origin.stamp);
  }
  function forgetScan(track){
    const origin=track.scanOrigin;
    if(origin){
      scanByPath.delete(originKey(origin.path));
      if(scanByIdentity.get(origin.identity)===track)scanByIdentity.delete(origin.identity);
    }
    if(track.scanHash&&scanIndex.get(track.folder+'\0'+track.scanHash)===track)scanIndex.delete(track.folder+'\0'+track.scanHash);
  }
  const scanIndex = new Map();
  const scanSizes = new Set();
  const indexScan = track => {
    if(track.scanOrigin?.path){
      scanByPath.set(originKey(track.scanOrigin.path),track);
      if(track.scanOrigin.identity)scanByIdentity.set(track.scanOrigin.identity,track);
    }
    if (!track.scanHash) return;
    scanIndex.set(track.folder + '\0' + track.scanHash,track);
    scanSizes.add(track.folder + '\0' + track.bytes);
  };
  tracks.forEach(indexScan);
  let libraryVersion=tracks.length;
  let countedCurrent=false,eligibleCurrent=false,activeRecord=null;
  const playRecords=Array.isArray(persisted.playRecords)?persisted.playRecords:[];
  // Older Windows builds only recorded the file source. A host-local file could
  // have played alone or with guests, so preserve that uncertainty.
  for(const row of playRecords)if(!row.playModeSource)row.playModeSource=row.source==='room'?'room':'unknown';
  const listeningDays = persisted.listeningDays ?? {};
  let accountedUntil = Date.now();
  function dayTotals(time) {
    const d = new Date(time);
    const key = [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-');
    return listeningDays[key] ??= { starts:0, ms:0 };
  }
  // Settle elapsed playback before timeline changes so seeks and pauses add no listening time.
  function settleListening() {
    if(playback.playing&&activeRecord&&sharedPlayback())activeRecord.playModeSource='room';
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
  function sharedPlayback(){return [...devices.values()].some(device=>device.id.startsWith('native-')||device.socket?.personalLocal===false);}
  function startRecord(){
    const track=currentTrack();if(!track||activeRecord)return;
    activeRecord={...localOrigin,session:randomBytes(16).toString('hex'),id:track.id,title:track.title,artist:track.artist,album:track.album,format:track.format,quality:track.quality,sampleRate:track.sampleRate,bitDepth:track.bitDepth,duration:track.duration,source:track.source==='phone'?'room':'local',sourceType:'track',playModeSource:sharedPlayback()?'room':'local',startedAt:Date.now(),completed:false,listenedMs:0,days:{},hours:{}};
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
  let nextUp=Array.isArray(persisted.nextUp)?[...new Set(persisted.nextUp)].filter(id=>queue.includes(id)):[];
  const playlists = (Array.isArray(persisted.playlists) ? persisted.playlists : [])
    .filter(p => p && typeof p.id === 'string' && typeof p.name === 'string' && Array.isArray(p.trackIds))
    .map(p => ({ ...p, trackIds: p.trackIds.filter(id => ids.has(id)) }));
  const prior = persisted.playback || {};
  let playback = {
    trackId: ids.has(prior.trackId) ? prior.trackId : queue[0] || null,
    playing: false, position: ids.has(prior.trackId) && validNumber(prior.position) ? Math.max(0, prior.position) : 0,
    updatedAt: Date.now(), volume: validNumber(prior.volume) ? clamp(prior.volume, 0, 1) : 0.75,
    muted: Boolean(prior.muted), repeat: ['off', 'all', 'one'].includes(prior.repeat) ? prior.repeat : 'all',
    shuffle: Boolean(prior.shuffle),
  };
  const savedRoom=persisted.room||{};
  const savedRoomId=typeof savedRoom.id==='string'&&/^[a-f0-9]{32}$/.test(savedRoom.id)?savedRoom.id:'';
  const roomIdentity=key=>createHash('sha256').update('lume-room/1\0'+key).digest('hex').slice(0,32);
  let roomId=savedRoomId||roomIdentity(os.hostname()+'\0'+dataDir);
  const customRoomName=savedRoom.customName===true||(savedRoom.customName==null&&savedRoom.name&&savedRoom.name!=='我的聆听空间');
  let room = { id:roomId, customName:!!customRoomName, name:customRoomName?text(savedRoom.name,40):os.hostname().slice(0,28)+' · '+roomId.slice(0,8).toUpperCase(), ...(persisted.room?.skin ? {skin:persisted.room.skin}: {}) };
  const sessions = new Map();
  const pairAttempts = new Map();
  const devices = new Map();
  const trims = new Map(Object.entries(persisted.trims ?? {}).filter(([,v])=>Number.isInteger(v) && Math.abs(v)<=1000));
  let calibration=null;
  const beat={id:'lume-calibration',title:'同步校准节拍',duration:120,source:'calibration',file:'calibration.wav'};
  let pairCode = String(randomInt(100000, 1000000)),switchedRoom=false,preparingSwitch=false;
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
  let localOrigin={};
  let personal=null,personalError="个人设备服务尚未启动";
  const joinedRoom = new JoinedRoom({deviceName:()=>localOrigin.originDeviceName||os.hostname(),changed:()=>{if(!closed&&!preparingSwitch){personal?.observe(joinedRoom.packet);broadcast();}},
    resolveLocal:(identity,bytes)=>findLocalTrack(tracks,track=>path.join(trackRoot(track),track.file),localIdentities,identity,bytes)});
  const hostAddress = () => {
    for(const device of devices.values()){
      const ip=device.hostAddress || device.socket?.roomInterface;
      if(ip && !loopback(ip))return ip;
    }
    const candidates=Object.entries(os.networkInterfaces()).filter(([name])=>/^(wi-?fi|wlan|ethernet|以太网|无线局域网)(?:$|[ 0-9])/i.test(name))
      .flatMap(([,list])=>(list||[]).filter(n=>n.family==='IPv4'&&!n.internal&&!n.address.startsWith('169.254.')).map(n=>n.address));
    return candidates.length===1?candidates[0]:'';
  };
  const state = () => joinedRoom.snapshot([...devices.values()]) ?? ({ ...sources.snapshot(), listeningDays, playRecords, playlists, tracks: tracks.map(publicTrack), queue: [...queue], playback: { ...playback }, devices: [...devices.values()].map(({ socket, ...device }) => device), room: { ...room }, guestRoom:joinedRoom.info(), calibrating:!!calibration, calibrationSince:calibration?.since, pending:joins.pending(), hostAddress:hostAddress(), serverTime: Date.now() });
  function localState(){const current=state();if(personal)current.playRecords=personal.records();return current;}
  function persist() {
    settleListening();
    const snapshot = JSON.stringify({ scanSkipped:[...scanSkipped], listeningDays, playRecords, playlists, nextUp, tracks:tracks.filter(t=>t.source!=='phone'), queue:queue.filter(id=>!id.startsWith('phone-')), playback: { ...playback, position: positionNow(), playing: false, updatedAt: Date.now() }, room, trims:Object.fromEntries(trims) }, null, 2);
    writeQueue = writeQueue.catch(() => {}).then(async () => {
      const temporary = `${libraryFile}.tmp`;
      await fs.writeFile(temporary, snapshot, 'utf8');
      await fs.rename(temporary, libraryFile);
    });
    return writeQueue;
  }
  function broadcast() {
    const message = JSON.stringify({ type: 'state', state: state() });
    let personalMessage;
    for (const socket of wss.clients) if (socket.readyState === WebSocket.OPEN){
      if(personal&&socket.personalLocal){personalMessage??=JSON.stringify({type:'state',state:localState()});socket.send(personalMessage);}
      else socket.send(message);
    }
  }
  function stopAtCurrentPosition() { playback.position = positionNow(); playback.updatedAt = Date.now(); }
  function selectTrack(id, playing = true) {
    if (!ids.has(id)) throw failure('找不到这首音乐。', 404);
    settleListening();
    nextUp=nextUp.filter(other=>other!==id);
    if (!queue.includes(id)) queue.push(id);
    playback = { ...playback, trackId: id, playing, position: 0, updatedAt: Date.now() };
    countedCurrent=false;activeRecord=null;eligibleCurrent=false;if(playing)startRecord();
  }
  function advance(direction = 1, natural = false) {
    settleListening();
    if(natural)countComplete();
    if (!queue.length) { playback.playing = false; playback.trackId = null; playback.position = 0; playback.updatedAt = Date.now(); return; }
    nextUp=nextUp.filter(id=>ids.has(id));
    if(direction>0&&nextUp.length){selectTrack(nextUp[0]);return;}
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
    const trimKey=device.profile || (device.socket&&!joinedRoom.active()?'client-'+device.id:null);
    if (trimKey && 'delayMs' in update) {
      trims.set(trimKey,update.delayMs);
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
      case 'playlist-add': {
        const list=playlists.find(p=>p.id===input.playlistId);
        if(!list||!ids.has(trackId))throw failure('歌曲或歌单不存在',404);
        if(!list.trackIds.includes(trackId))list.trackIds.push(trackId);
        break;
      }
      case 'queue-next': {
        if(!ids.has(trackId))throw failure('找不到这首音乐',404);
        nextUp=[trackId,...nextUp.filter(id=>id!==trackId)];
        if(trackId!==playback.trackId){
          queue=queue.filter(id=>id!==trackId);
          queue.splice(queue.indexOf(playback.trackId)+1,0,trackId);
        }
        break;
      }
      case 'queue-add': if (!ids.has(trackId)) throw failure('找不到这首音乐。', 404); if (!queue.includes(trackId)) queue.push(trackId); break;
      case 'library-remove': {
        const track=tracks.find(t=>t.id===trackId);
        if(!track||track.source==='phone')throw failure('请选择本机曲库中的歌曲');
        forgetScan(track);
        tracks=tracks.filter(t=>t.id!==trackId);ids.delete(trackId);
        for(const list of playlists)list.trackIds=list.trackIds.filter(id=>id!==trackId);
        libraryVersion++;
        // Removing from the library also removes this item from the queue.
      }
      case 'queue-remove':
        nextUp=nextUp.filter(id=>id!==trackId);
        queue = queue.filter((id) => id !== trackId);
        if (playback.trackId === trackId) {
          const wasPlaying = playback.playing;
          if (queue.length) selectTrack(queue[0], wasPlaying);
          else playback = { ...playback, trackId: null, playing: false, position: 0, updatedAt: Date.now() };
        }
        break;
      case 'queue-set':
        if (!Array.isArray(input.trackIds) || input.trackIds.length > 10000 || input.trackIds.some((id) => !ids.has(id))) throw failure('无效的播放队列。');
        nextUp=[];queue = [...new Set(input.trackIds)];
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
      case 'room-name': if (!text(value, 40)) throw failure('请填写空间名称。'); room.name = text(value, 40); room.customName=true; break;
      default: throw failure('暂不支持这项操作。');
    }
    scheduleEnd(); broadcast();
  }

  const app = express();
  // Multipart imports can take longer than Node's five-minute default on Wi-Fi.
  const server = createServer({requestTimeout:30*60*1000},app);
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
    if(switchedRoom&&joinedRoom.active()&&!loopback(req.socket.remoteAddress))return res.sendStatus(410);
    if(req.method==='GET' && (req.path==='/' || req.path==='/index.html')){
      const initial=authorized(req)?['/api/info','/api/state']:['/api/info'];
      res.setHeader('Link',initial.map(url=>`<${url}>; rel=preload; as=fetch; crossorigin=anonymous`).join(', '));
    }
    next();
  });
  app.use('/api/receiver',express.json({limit:'4mb'}));
  app.use(express.json({ limit: '64kb' }));
  app.get('/api/info', (req, res) => res.json({ name: '澄音 LUME', version: '0.5.5', service:'lume-room/1', roomId, roomName:room.name, urls: addresses().map((ip) => `http://${ip}:${actualPort}`),
    ...(loopback(req.socket.remoteAddress) ? { pairCode } : {}), paired: authorized(req) }));
  app.get('/api/time', (_req, res) => res.json({ serverTime: Date.now() }));
  function issueSession(res){
    const token = randomBytes(32).toString('hex');
    sessions.set(token, Date.now() + 7 * 24 * 60 * 60 * 1000);
    res.cookie('lume_session', token, { httpOnly:true, sameSite:'strict', maxAge:7*24*60*60*1000, path:'/' });
  }
  const joins=joinRequests(app,broadcast,issueSession);
  app.post('/api/join/invite',(req,res)=>{
    if(!nearby||joinedRoom.active()||!nearby.redeem(req.body?.inviteToken,req.body?.deviceId,req.socket.remoteAddress.replace(/^::ffff:/,'')))return res.sendStatus(403);
    issueSession(res);res.json({paired:true});
  });
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
    if(joinedRoom.active())return res.status(409).json({error:'请由当前房主邀请'});
    try {
      if (!await nearby.invite(req.body?.id)) return res.status(404).json({error:'手机已离线，请重新搜索'});
      res.json({sent:true});
    } catch { res.status(503).json({error:'发送失败，请重新邀请'}); }
  });
  app.get('/api/room/thumbnail/:generation/:revision/:id',async(req,res)=>{
    const picture=await joinedRoom.thumbnail(Number(req.params.generation),req.params.revision,req.params.id);
    if(!picture)return res.redirect('/covers/1.svg');
    res.set('Cache-Control','private, max-age=300').type(picture.mime).send(picture.image);
  });
  app.get('/api/room/cover/:key',(req,res)=>{
    const details=joinedRoom.details;
    if(!joinedRoom.active() || details?.key!==req.params.key || !details.image)return res.sendStatus(404);
    res.set('Cache-Control','no-store').type(details.mime).send(details.image);
  });
  app.get('/api/state', (req, res) => res.json(loopback(req.socket.remoteAddress)?localState():state()));
  app.post('/api/personal',async(req,res)=>{
    if(!loopback(req.socket.remoteAddress))return res.sendStatus(403);
    if(!personal)return res.status(503).json({error:personalError});
    try{
      const result=await personal.action(req.body);
      if(req.body.op==='rename'){
        localOrigin={originDeviceId:result.id,originDeviceName:result.name};
        if(!room.customName)room.name=(result.customName||os.hostname())+' · '+result.id.slice(0,8).toUpperCase();
        for(const device of devices.values())if(device.socket?.personalLocal)device.name=result.name;
        broadcast();
      }
      res.json(result);
    }catch(e){res.status(400).json({error:e.message});}
  });
  app.post('/api/room/leave',async(req,res)=>{
    if(!loopback(req.socket.remoteAddress))return res.sendStatus(403);
    await joinedRoom.leave();broadcast();res.json(localState());
  });
  const sources=await phoneLibraries(app,{
    devices,broadcast,
    play(track){
      if(!ids.has(track.id)){track.addedAt=Date.now();tracks.push(track);ids.add(track.id);libraryVersion++;}
      calibration=null;selectTrack(track.id);scheduleEnd();broadcast();
    },
    discard(track){tracks=tracks.filter(t=>t.id!==track.id);ids.delete(track.id);queue=queue.filter(id=>id!==track.id);libraryVersion++;}
  });
  const trackRoot=track=>track.source==='phone'?sources.directory:track.source==='calibration'?path.join(resourcesDir,'demo'):mediaDir;
  const closeReceivers = await mountReceivers(app, { devices, broadcast, trims, sources, pending:()=>joins.pending(),
    coverRevision:track=>createHash('sha256').update(JSON.stringify([track.id,track.detailKey])).digest('hex').slice(0,32),
    coverPath:async track=>{await restoreDetails(track);return track.cover?path.join(coverDir,track.cover.file):null;},
    current: () => {settleListening();return { track: calibration?beat:currentTrack(), playback:calibration?{...playback,playing:true}:playback,
      position:calibration?((Date.now()-calibration.since)/1000)%beat.duration:positionNow(), skin:room.skin??null,
      catalog:tracks, libraryVersion, currentSession:activeRecord?.session, playRecords, listeningDays };},
    sourcePath: track => path.join(trackRoot(track),track.file) });
  app.post('/api/action', async (req, res) => {
    if(req.body?.type==='library-remove'&&!loopback(req.socket.remoteAddress))return res.sendStatus(403);
    if(joinedRoom.active())await joinedRoom.action(req.body);
    else {action(req.body);await persist();}
    res.json(loopback(req.socket.remoteAddress)?localState():state());
  });
  const upload = multer({ dest: tempDir, limits: { files: 60, fileSize: MAX_AUDIO_BYTES, fields: 4, fieldSize: 128 * 1024 },
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
      const controller=new AbortController();
      res.once('close',()=>controller.abort());
      if(res.destroyed)controller.abort();
      const result=await importBatch(importedFiles, attachments, req.body,controller.signal);
      if(loopback(req.socket.remoteAddress))result.state=localState();res.json(result);
    } finally {
      await Promise.all([...attachments, ...importedFiles].map(file => fs.unlink(file.path).catch(() => {})));
    }
  });
  async function finishScan(scan){
    const signal=scan.controller.signal;
    signal.throwIfAborted();
    const candidates=tracks.filter(track=>track.scanOrigin && scan.missing(track.scanOrigin.path));
    const removed=new Set();
    for(let start=0;start<candidates.length;start+=32){
      signal.throwIfAborted();
      await Promise.all(candidates.slice(start,start+32).map(async track=>{
        const origin=track.scanOrigin;
        try{await fs.lstat(origin.path);}
        catch(error){
          if((error.code==='ENOENT'||error.code==='ENOTDIR')&&track.scanOrigin===origin)removed.add(track);
        }
      }));
    }
    signal.throwIfAborted();
    const dead=new Set([...removed].map(track=>track.id));
    for(const track of removed){forgetScan(track);ids.delete(track.id);}
    for(const source of scanSkipped.keys())if(scan.missing(source))scanSkipped.delete(source);
    if(removed.size){
      settleListening();
      tracks=tracks.filter(track=>!removed.has(track));
      for(const list of playlists)list.trackIds=list.trackIds.filter(id=>!dead.has(id));
      queue=queue.filter(id=>!dead.has(id));nextUp=nextUp.filter(id=>!dead.has(id));
      if(dead.has(playback.trackId)){
        if(queue.length)selectTrack(queue[0],playback.playing);
        else playback={...playback,trackId:null,playing:false,position:0,updatedAt:Date.now()};
      }
      libraryVersion++;scheduleEnd();broadcast();
    }
    await persist();
    return removed.size;
  }
  async function importLocal(paths, companions, body,signal,descriptors) {
    if (!Array.isArray(paths) || paths.length>20 || !Array.isArray(companions) || companions.length>40) throw failure('选择的文件过多。');
    const files=paths.map(source=>{
      if(!path.isAbsolute(source)||!AUDIO_EXTENSIONS.has(path.extname(source).toLowerCase()))throw failure('不支持的音频文件。');
      return {source,origin:descriptors?.get(source),originalname:path.basename(source),path:path.join(tempDir,randomBytes(16).toString('hex'))};
    });
    const attachments=await Promise.all(companions.map(async source=>{
      if(!path.isAbsolute(source)||!(/\.(lrc|jpg|jpeg|png|webp)$/i.test(source)))throw failure('不支持的附件。');
      const stat=await fs.stat(source).catch(()=>null);
      return {path:source,size:stat?.isFile()?stat.size:Infinity};
    }));
    const result=await importBatch(files,attachments,body,signal);result.state=localState();return result;
  }
  function importBatch(importedFiles, attachments, body,signal) {
    if (!importedFiles.length) throw failure('请选择要导入的音乐。');
    const run = async () => {
      let imported = 0, skipped = 0, updated = 0;
      const retired=[];
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
        const input = createReadStream(source,{highWaterMark:1024*1024,signal});
        if (copyTo) {
          input.on('data',chunk=>hash.update(chunk));
          await pipeline(input,createWriteStream(copyTo));
        } else {
          for await(const chunk of input)hash.update(chunk);
        }
        return hash.digest('hex');
      }
      for (const [index, file] of importedFiles.entries()) {
        if(signal?.aborted)break;
        const id = randomBytes(12).toString('hex');
        const filename = `${id}${path.extname(file.originalname).toLowerCase()}`;
        try {
          const folder = folders[index];
          let scanHash, prior;
          const indexed=file.origin&&scanByPath.get(originKey(file.origin.path));
          const sameAudio=indexed && indexed.scanOrigin.audioStamp===file.origin.audioStamp &&
            indexed.scanOrigin.identity===file.origin.identity && typeof indexed.scanOrigin.embeddedCover==='boolean';
          if(file.source){
            const stat=await fs.stat(file.source);
            if(!stat.isFile())throw failure('所选路径不是音频文件。');
            if(file.origin && scanKnown(file.origin,body.skipShort==='1')){skipped++;continue;}
            if(!file.origin&&folder&&scanSizes.has(folder+'\0'+stat.size))scanHash=await hashFile(file.source);
            if(!sameAudio&&(!scanHash||!scanIndex.has(folder+'\0'+scanHash))){
              if(folder)scanHash=await hashFile(file.source,file.path);
              else await pipeline(createReadStream(file.source,{signal}),createWriteStream(file.path));
              file.size=(await fs.stat(file.path)).size;
            }
          }
          signal?.throwIfAborted();
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
          const sideCover = () => companion('cover',16*1024*1024);
          if(sameAudio){
            const previous=indexed.scanOrigin;
            const patch={folder,scanOrigin:{...file.origin,embeddedCover:previous.embeddedCover,embeddedText:previous.embeddedText}};
            const replaced=[];
            if(!previous.embeddedCover && previous.coverStamp!==file.origin.coverStamp){
              const bytes=await sideCover();
              patch.cover=coverMime(bytes)?await saveCover(id,bytes):undefined;
              patch.artwork=patch.cover?'/artwork/'+indexed.id+'?v='+id:'/covers/1.svg';
              if(indexed.cover)replaced.push(path.join(coverDir,indexed.cover.file));
            }
            if(previous.lyricsStamp!==file.origin.lyricsStamp){
              const lyrics=decodeLyrics(await companion('lyrics',512*1024)).trim() || previous.embeddedText;
              patch.lyricsFile=id+'.lrc';
              if(lyrics)await fs.writeFile(path.join(mediaDir,patch.lyricsFile),lyrics);
              patch.hasLyrics=!!lyrics;
              replaced.push(path.join(mediaDir,indexed.lyricsFile||indexed.id+'.lrc'));
            }
            signal?.throwIfAborted();
            forgetScan(indexed);Object.assign(indexed,patch,{detailKey:id});indexScan(indexed);
            retired.push(...replaced);updated++;libraryVersion++;
            continue;
          }
          const sideLyrics = decodeLyrics(await companion('lyrics',512*1024)).trim();
          if (folder) {
            scanHash ??= await hashFile(file.path);
            const existing = scanIndex.get(folder+'\0'+scanHash);
            if(file.origin){
              const origin=file.origin;
              prior=scanByPath.get(originKey(origin.path));
              const moved=scanByIdentity.get(origin.identity);
              if(!prior && moved){
                const missing=await fs.lstat(moved.scanOrigin.path).then(()=>false,error=>error.code==='ENOENT'||error.code==='ENOTDIR');
                if(missing)prior=moved;
              }
              if(!prior && existing && !existing.scanOrigin)prior=existing;
            }else if (existing) {
              signal?.throwIfAborted();
              if (sideLyrics) {
                await fs.writeFile(path.join(mediaDir, existing.lyricsFile || existing.id + '.lrc'), sideLyrics);
                existing.hasLyrics = true; libraryVersion++;
              }
              if (!existing.cover && links[index]?.cover != null) {
                const bytes = await sideCover();
                if (coverMime(bytes)) {
                  existing.cover = await saveCover(existing.id, bytes);
                  existing.detailKey=id;
                  existing.artwork = '/artwork/' + existing.id; libraryVersion++;
                }
              }
              if (lyricsMask[index] === '1' && !existing.hasLyrics) { existing.hasLyrics = true; libraryVersion++; }
              await fs.unlink(file.path).catch(()=>{});
              skipped++; continue;
            }
          }
          signal?.throwIfAborted();
          let metadata = await parseFile(file.path);
          if (!(metadata.format.duration > 0)) metadata = await parseFile(file.path, { duration: true });
          if (!validNumber(metadata.format.duration) || metadata.format.duration <= 0 || !metadata.format.sampleRate) throw failure('无法读取有效的音频内容。');
          if (!prior && folder && body.skipShort === '1' && metadata.format.duration < 60) {
            await fs.unlink(file.path);signal?.throwIfAborted();
            if(file.origin)scanSkipped.set(originKey(file.origin.path),file.origin.stamp);
            skipped++;continue;
          }
          let cover;
          let artwork = `/covers/${(tracks.length % 3) + 1}.svg`;
          const embeddedPicture=frontCover(metadata.common.picture)?.data;
          const picture = embeddedPicture ?? await sideCover();
          if (coverMime(picture)) {
            cover = await saveCover(id, picture);
            artwork = '/artwork/' + id;
          }
          const embeddedText=embeddedLyrics(metadata);
          const lyrics = sideLyrics || embeddedText;
          if (lyrics) await fs.writeFile(path.join(mediaDir, id + '.lrc'), lyrics);
          await fs.rename(file.path, path.join(mediaDir, filename));
          const displayName = file.source ? file.originalname : Buffer.from(file.originalname, 'latin1').toString('utf8');
          const originalName = displayName.includes('\ufffd') ? file.originalname : displayName;
          const track = { id, title: text(metadata.common.title) || path.parse(originalName).name,
            artist: text(metadata.common.artist) || '未知艺术家', album: text(metadata.common.album) || '本地音乐',
            duration: metadata.format.duration, format: path.extname(filename).slice(1).toUpperCase(), artwork,
            addedAt: Date.now(), detailsVersion: 1, ...audioFacts(metadata, file.size, !!lyrics || lyricsMask[index] === '1'), playCount:0,
            source: 'import', favorite: false, file: filename, ...(folder ? { folder, scanHash } : {}), ...(cover ? { cover } : {}) };
          signal?.throwIfAborted();
          if(file.origin){
            track.scanOrigin={...file.origin,embeddedText,embeddedCover:!!embeddedPicture};
            track.localAudioKey=id;scanSkipped.delete(originKey(file.origin.path));
          }
          if(prior){
            forgetScan(prior);
            retired.push(path.join(mediaDir,prior.file),path.join(mediaDir,prior.lyricsFile||prior.id+'.lrc'));
            if(prior.cover)retired.push(path.join(coverDir,prior.cover.file));
            track.id=prior.id;track.lyricsFile=id+'.lrc';track.detailKey=id;
            if(cover)track.artwork='/artwork/'+prior.id+'?v='+id;
            delete prior.cover;
            Object.assign(prior,track,{favorite:prior.favorite,addedAt:prior.addedAt,playCount:prior.playCount});
            indexScan(prior);updated++;
          }else{
            indexScan(track);tracks.push(track);ids.add(id);queue.push(id);imported++;
          }
          libraryVersion++;
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
      await Promise.all(retired.map(file=>fs.unlink(file).catch(()=>{})));
      return { imported, updated, skipped, rejected, state: state() };
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
    const track = req.params.id===beat.id?beat:tracks.find((item) => item.id === req.params.id);
    if (!track) return next(failure('音乐不存在。', 404));
    const base = trackRoot(track);
    res.sendFile(track.file, { root: base, acceptRanges: true, cacheControl: true, maxAge: track.scanOrigin?0:'1h' }, (error) => { if (error && !res.headersSent) next(error); });
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
      try { lyrics = await fs.readFile(path.join(mediaDir, track.lyricsFile || track.id + '.lrc'), 'utf8'); }
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
    const status = error instanceof multer.MulterError ? (error.code==='LIMIT_FILE_SIZE'?413:400) : error.status || (error.type === 'entity.parse.failed' ? 400 : 500);
    const message = error instanceof multer.MulterError ? '导入失败：一次最多 20 首，每首不超过 500 MiB。' : status >= 500 ? '操作未完成，请稍后重试。' : error.message;
    if (status >= 500) console.error(error);
    res.status(status).json({ error: message });
  });

  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/ws' || !allowedRequest(req) || !authorized(req)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); socket.destroy(); return;
    }
    wss.handleUpgrade(req, socket, head, (client) => wss.emit('connection', client, req));
  });
  wss.on('connection', (socket,req) => {
    socket.personalLocal=loopback(req.socket.remoteAddress);
    socket.roomInterface=req.socket.localAddress?.replace(/^::ffff:/,"");
    socket.isAlive = true;
    socket.on('pong', () => { socket.isAlive = true; if (socket.deviceId && devices.get(socket.deviceId)?.socket === socket) devices.get(socket.deviceId).lastSeen = Date.now(); });
    socket.send(JSON.stringify({ type: 'state', state: socket.personalLocal?localState():state() }));
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
          devices.set(input.id, { id: input.id, name: (socket.personalLocal&&localOrigin.originDeviceName)||text(input.name, 48)||'网页播放器', platform: text(input.platform, 24) || 'Web',
            channel: CHANNELS.has(input.channel) ? input.channel : 'stereo',
            volume: validNumber(input.volume) ? clamp(input.volume, 0, 1) : old?.volume ?? 1,
            delayMs: Number.isInteger(input.delayMs) && Math.abs(input.delayMs)<=1000 ? input.delayMs : old?.delayMs ?? trims.get('client-'+input.id) ?? 0,
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
  if(personalAddress&&process.platform==='win32'){
    try{personal=startPersonalDevices({bindAddress:personalAddress,resourcesDir,dataDir,getTracks:()=>tracks,
      trackPath:t=>path.join(trackRoot(t),t.file),playRecords,importBatch,tempDir,changed:()=>{if(!closed)broadcast();}});localOrigin=await personal.identity;
      if(!savedRoomId&&localOrigin.originDeviceId)room.id=roomId=roomIdentity(localOrigin.originDeviceId);
      if(!customRoomName&&localOrigin.originDeviceId)room.name=(localOrigin.originDeviceName===os.hostname()+' · Windows'?os.hostname():localOrigin.originDeviceName)+' · '+localOrigin.originDeviceId.slice(0,8).toUpperCase();}
    catch{personalError='无法加载个人设备组件，请检查应用文件';}
  }
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => { server.removeListener('error', reject); actualPort = server.address().port; resolve(); });
  }).catch((error) => { clearInterval(heartbeat); throw error; });
  const pcId=randomBytes(16).toString('hex');
  const role=()=>joinedRoom.active()?'joined':['joining','waiting'].includes(joinedRoom.info()?.status)?'connecting':'hosting';
  async function joinSpace(url,grant=null){
    if(preparingSwitch||grant&&role()!=='hosting')throw Error('设备已加入空间或正在连接');
    preparingSwitch=!!grant;
    let joined;
    try{joined=await joinedRoom.join(url,'播放空间',grant);}
    finally{preparingSwitch=false;}
    if(grant){
      switchedRoom=true;sessions.clear();joins.clear();nearby?.resetGrants();
      pairCode=String(randomInt(100000,1000000));
      for(const client of wss.clients)if(!client.personalLocal)client.terminate();
      for(const [id,d] of devices)if(!d.socket?.personalLocal)devices.delete(id);
    }
    settleListening();stopAtCurrentPosition();playback.playing=false;clearTimeout(endTimer);
    await persist();broadcast();return joined;
  }
  if (host==='0.0.0.0') nearby=nearbyPhones(actualPort,()=>localOrigin.originDeviceName||os.hostname(),pcId);
  const stopInvites=nearby&&confirmRoomInvite?receiveRoomInvites({id:pcId,role,name:()=>localOrigin.originDeviceName||os.hostname(),
    confirm:(name,signal)=>confirmRoomInvite(name,sharedPlayback(),signal),join:joinSpace,onError:onInviteError}):()=>{};
  const stopDiscovery=nearby?advertise(actualPort,()=>room.name,roomId,()=>!joinedRoom.active()):()=>{};
  return {
    offerFile(peer,file){if(!personal)throw Error('个人设备服务尚未启动');return personal.offerFile(peer,file);},
    importLocal, scanKnown, finishScan, readLyrics, port: actualPort, url: `http://127.0.0.1:${actualPort}`, pairCode, dataDir, app, roomUrl:id=>nearby?.roomUrl(id),
    joinRoom:url=>joinSpace(url),
    close() {
      if (closingPromise) return closingPromise;
      stopInvites();nearby?.close();stopDiscovery();closed = true; clearTimeout(endTimer); clearInterval(heartbeat);
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
          await personal?.close();await closeReceivers();await sources.close();
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
