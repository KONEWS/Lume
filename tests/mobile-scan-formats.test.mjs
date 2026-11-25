import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const javaRoot='mobile/android/app/src/main/java/local/lume/receiver/';
const etsRoot='mobile/harmony/entry/src/main/ets/engine/';
const read=p=>readFile(p,'utf8');
function loadEts(source,globals={}){
  const js=ts.transpileModule(source.replace(/^import .*;\r?\n/gm,''),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
  const context={exports:{},...globals};vm.runInNewContext(js,context);return context.exports;
}
const filterSource=await read(etsRoot+'ScanFilter.ets');
const {ScanFilter}=loadEts(filterSource);

test('HarmonyOS format normalization, exact suffix matching and true album exception',()=>{
  const filter=new ScanFilter([' .MP3 ','FLAC','AmR','../wav','',null]);
  for(const name of ['song.Mp3','song.FLAC','音频.AMR','mix.wav.mp3'])assert.equal(filter.blocksName(name),true,name);
  for(const name of ['song.mp3.wav','songmp3','song.','song.wav'])assert.equal(filter.blocksName(name),false,name);
  for(const [ms,expected] of [[-1,false],[0,false],[1,true],[59999,true],[60000,false],[60001,false],[NaN,false]])assert.equal(ScanFilter.isShort(ms),expected,String(ms));
  for(const album of ['', '  ', '<unknown>', '\u0000'])assert.equal(ScanFilter.skipsAudio(true,13000,album),true);
  for(const album of ['真实专辑', ' Album '])assert.equal(ScanFilter.skipsAudio(true,13000,album),false);
  assert.equal(ScanFilter.skipsAudio(false,13000,''),false);
  assert.equal(ScanFilter.skipsAudio(true,60000,''),false);
});

test('Android runs the same format and album/duration cases on the JVM',async()=>{
  const temp=await mkdtemp(path.join(os.tmpdir(),'lume-scan-java-'));
  const harness=`package local.lume.receiver;
import java.util.*;
public class ScanFilterTest {
  static void check(boolean value) {if(!value)throw new AssertionError();}
  public static void main(String[] args) {
    Locale.setDefault(new Locale("tr","TR"));
    ScanFilter f=new ScanFilter(Arrays.asList(" .MP3 ","FLAC","AmR","AIF","../wav","",null));
    for(String n:Arrays.asList("song.Mp3","song.FLAC","音频.AMR","mix.wav.mp3","song.AIF"))check(f.blocksName(n));
    for(String n:Arrays.asList("song.mp3.wav","songmp3","song.","song.wav"))check(!f.blocksName(n));
    for(long ms:new long[]{-1,0,60000,60001})check(!ScanFilter.isShort(ms));
    for(long ms:new long[]{1,59999})check(ScanFilter.isShort(ms));
    for(String album:new String[]{"","  ","<unknown>",null})check(ScanFilter.skipsAudio(true,13000,album));
    for(String album:new String[]{"真实专辑"," Album "})check(!ScanFilter.skipsAudio(true,13000,album));
    check(!ScanFilter.skipsAudio(false,13000,""));check(!ScanFilter.skipsAudio(true,60000,""));
  }
}`;
  const file=path.join(temp,'ScanFilterTest.java');await writeFile(file,harness);
  execFileSync('javac',['-encoding','UTF-8','-d',temp,javaRoot+'ScanFilter.java',file],{windowsHide:true});
  execFileSync('java',['-cp',temp,'local.lume.receiver.ScanFilterTest'],{windowsHide:true});
});

async function libraryFixture(){
  const root='file://docs/Music',blocked=root+'/blocked';
  const entries=new Map([[root,['blocked','blockedSibling','Album','Recordings','filtered.MP3','short.WaV','exact.FLAC','long.ogg','unknown.aac','mix.mp3.flac','custom.AMR','unsupported.APE']],
    [blocked,['hidden.flac']],[root+'/blockedSibling',['visible.flac']],
    [root+'/Album',['intro.flac','commonIntro.flac','untagged.flac','excluded.MP3']], [root+'/Recordings',['memo.wav']]]);
  const metadata=new Map([[root+'/short.WaV',{duration:59999}],[root+'/exact.FLAC',{duration:60000}],[root+'/long.ogg',{duration:60001}],[root+'/unknown.aac',{duration:0}],
    [root+'/Album/intro.flac',{duration:13000,album:'真实专辑'}],[root+'/Album/commonIntro.flac',{duration:13000,album:'<unknown>'}],
    [root+'/Album/untagged.flac',{duration:13000}],[root+'/Album/excluded.MP3',{duration:13000,album:'真实专辑'}],[root+'/Recordings/memo.wav',{duration:13000}]]);
  const opened=[],copied=[],listed=[],activated=[],persisted=new Set(),storage=new Map(),copySources=new Map();let serial=0,pickerCount=0;
  const versions=new Map(),statFailures=new Set(),readPositions=new Map(),buffers=new WeakMap();
  const stats=p=>({isDirectory:()=>entries.has(p),isFile:()=>!entries.has(p),size:100,mtime:100,...versions.get(p)});
  const fs={OpenMode:{READ_ONLY:0,CREATE:1,WRITE_ONLY:2,TRUNC:4},accessSync:p=>storage.has(p),readTextSync:p=>{if(!storage.has(p))throw Error('missing');return storage.get(p);},
    openSync:p=>{opened.push(p);return{fd:p,path:p};},open:async p=>{opened.push(p);readPositions.set(p,0);return{fd:p,path:p};},
    closeSync:()=>{},close:async()=>{},listFile:async p=>{listed.push(p);return entries.get(p)||[];},
    lstat:async p=>{if(statFailures.has(p))throw Error('stat denied');return stats(p);},stat:async p=>stats(p),statSync:stats,
    read:async(fd,buffer)=>{
      if(readPositions.get(fd))return 0;
      buffers.set(buffer,fd);readPositions.set(fd,100);return 100;
    },
    write:async(fd,buffer,{length})=>{
      const from=buffers.get(buffer);assert(from);
      copied.push(from);copySources.set(fd,from);storage.set(fd,'copy:'+from+':'+(versions.get(from)?.mtime??100));
      return length;
    },
    copyFile:async(from,to)=>{copied.push(from);copySources.set(to,from);storage.set(to,'copy:'+from+':'+(versions.get(from)?.mtime??100));},
    unlinkSync:p=>storage.delete(p),writeSync:(fd,text)=>storage.set(fd,text),renameSync:(from,to)=>{storage.set(to,storage.get(from));storage.delete(from);if(copySources.has(from)){copySources.set(to,copySources.get(from));copySources.delete(from);}}};
  class FileUri {constructor(uri){this.uri=uri;}get name(){return decodeURIComponent(this.uri.split('/').pop());}getFullDirectoryUri(){return this.uri.substring(0,this.uri.lastIndexOf('/'));}}
  const picker={DocumentSelectOptions:class{},DocumentSelectMode:{FOLDER:1},DocumentViewPicker:class{async select(){pickerCount++;return[root];}},
    AudioSelectOptions:class{},AudioViewPicker:class{async select(){return[root+'/filtered.MP3',root+'/short.WaV'];}}};
  const fileShare={OperationMode:{READ_MODE:1},persistPermission:async policies=>policies.forEach(p=>persisted.add(p.uri)),checkPersistentPermission:async policies=>policies.map(p=>persisted.has(p.uri)),activatePermission:async policies=>policies.forEach(p=>activated.push(p.uri))};
  const media={createAVMetadataExtractor:async()=>({async fetchMetadata(){const uri=copySources.get(this.fdSrc.fd)||this.fdSrc.fd;return metadata.get(uri)||{duration:120000};},async release(){}})};
  const core={room:raw=>{const request=JSON.parse(raw);if(request.type!=='audioFacts')return '{}';let uri=request.path.replace('/proc/self/fd/','');uri=copySources.get(uri)||uri;return JSON.stringify({bytes:100,factsVersion:3,quality:'lossless',hasLyrics:false,...(uri.endsWith('/commonIntro.flac')?{album:'公共解析器的真实专辑'}:{})});}};
  const {LocalLibrary}=loadEts(await read(etsRoot+'LocalLibrary.ets'),{fs,fileUri:{FileUri},picker,ScanFilter,fileShare,media,core,util:{generateRandomUUID:()=>`id-${++serial}`},setTimeout});
  const create=()=>new LocalLibrary({filesDir:'/private'},()=>{});
  return{library:create(),create,root,blocked,copied,opened,listed,entries,metadata,persisted,activated,storage,versions,statFailures,pickerCount:()=>pickerCount};
}

test('HarmonyOS restores user imports with demo titles and filters only reserved built-in IDs',async()=>{
  const fixture=await libraryFixture();
  const demos=['demo','demo-moon','demo-forest'].map((id,i)=>({id,title:['潮汐之间','月色落在水面','林间的呼吸'][i]}));
  const imports=demos.map((song,i)=>({...song,id:'user-'+i,sourceUri:'file://docs/'+song.title+'.wav'}));
  fixture.storage.set('/private/music.json',JSON.stringify([...demos,...imports]));
  assert.deepEqual(Array.from(fixture.create().songs,song=>song.id),imports.map(song=>song.id));
  fixture.storage.set('/private/music.json',JSON.stringify(demos));
  assert.equal(fixture.create().songs.length,0);
});

for(const rescan of [false,true])test(`HarmonyOS real folder traversal combines format/folder/album rules (rescan=${rescan})`,async()=>{
  const f=await libraryFixture();
  await f.library.pick(true,true,[f.blocked],[' .mP3 ','AMR'],rescan);
  const names=Array.from(f.library.songs,s=>s.title).sort();
  assert.deepEqual(names,['exact','long','mix.mp3','unknown','visible','intro','commonIntro'].sort());
  assert(!f.listed.includes(f.blocked));assert(f.listed.includes(f.root+'/blockedSibling'));
  assert(!f.opened.includes(f.root+'/filtered.MP3'),'excluded format must not be opened/copied');
  assert(!f.copied.includes(f.root+'/custom.AMR'),'unsupported HarmonyOS extensions stay unsupported');
  assert.match(f.library.scanStatus,/跳过屏蔽格式 2 首/);
  assert.match(f.library.scanStatus,/跳过屏蔽目录 1 个/);
  assert.match(f.library.scanStatus,/跳过短音频 3 首/);
  assert(f.library.songs.find(s=>s.title==='commonIntro').album==='公共解析器的真实专辑');
});

test('HarmonyOS remembers selection, restores access after restart, discovers additions and deduplicates repeat scans',async()=>{
  const f=await libraryFixture();
  await f.library.pick(true,true,[f.blocked],['mp3'],false);
  assert.equal(f.pickerCount(),1);assert(f.persisted.has(f.root));assert(f.storage.has('/private/scan-roots.json'));
  f.entries.get(f.root+'/Album').push('new.flac');
  let library=f.create();await library.pick(true,true,[f.blocked],['mp3'],true);
  assert.equal(f.pickerCount(),1);assert(f.activated.includes(f.root));
  assert.equal(library.songs.filter(s=>s.title==='new').length,1);assert.match(library.scanStatus,/新增 1 首/);
  library=f.create();await library.pick(true,true,[f.blocked],['mp3'],true);
  assert.equal(library.songs.filter(s=>s.title==='new').length,1);assert.match(library.scanStatus,/新增 0 首/);
  f.persisted.clear();library=f.create();await library.pick(true,true,[f.blocked],['mp3'],true);
  assert.match(library.scanStatus,/授权已失效/);assert.equal(library.scanning,false);
  await library.pick(true,true,[f.blocked],['mp3'],false);assert.equal(f.pickerCount(),2);assert(f.persisted.has(f.root));
});

test('HarmonyOS regular duration toggle and explicit file import preserve existing behavior',async()=>{
  const f=await libraryFixture();await f.library.pick(true,false,[f.blocked],['mp3'],false);
  assert(f.library.songs.some(s=>s.title==='short'));
  const direct=await libraryFixture();await direct.library.pick(false,true,[direct.root],['mp3'],false);
  assert.deepEqual(Array.from(direct.library.songs,s=>s.title),['filtered','short']);
});

test('HarmonyOS incremental scans enumerate unchanged files without reads, copies or metadata extraction',async()=>{
  const f=await libraryFixture(),run=async()=>{const library=f.create();await library.pick(true,true,[f.blocked],['mp3'],true);return library;};
  await f.library.pick(true,true,[f.blocked],['mp3'],false);
  assert.equal(f.library.scanRead,10);
  console.log('EVIDENCE HarmonyOS first:',JSON.stringify({enumerated:f.library.scanFound,audioRead:f.library.scanRead}));
  f.opened.length=0;f.copied.length=0;f.listed.length=0;
  let library=await run();
  assert.equal(library.scanRead,0);assert(f.listed.length>0);assert.equal(f.copied.length,0);
  assert(f.opened.every(p=>f.entries.has(p)||p.startsWith('/private/')),'only directories and cache persistence are opened');
  console.log('EVIDENCE HarmonyOS unchanged:',JSON.stringify({enumerated:library.scanFound,audioRead:library.scanRead,copies:f.copied.length}));
  f.entries.get(f.root+'/Album').push('new.flac');f.opened.length=0;
  library=await run();assert.equal(library.scanRead,1);assert.deepEqual(f.copied,[f.root+'/Album/new.flac']);
  console.log('EVIDENCE HarmonyOS added:',JSON.stringify({enumerated:library.scanFound,audioRead:library.scanRead,copies:f.copied.length}));
  const old=library.songs.find(s=>s.sourceUri===f.root+'/exact.FLAC'),id=old.id;
  old.hidden=true;old.playCount=9;library.saveSongs();
  f.versions.set(old.sourceUri,{mtime:101});f.metadata.set(old.sourceUri,{duration:120000,title:'Changed title'});
  f.copied.length=0;library=await run();
  const changed=library.songs.find(s=>s.id===id);
  assert.equal(library.scanRead,1);assert.deepEqual(f.copied,[old.sourceUri]);assert.equal(changed.title,'Changed title');assert.equal(changed.hidden,true);assert.equal(changed.playCount,9);
  assert.equal(f.storage.get('/private/'+id),'copy:'+old.sourceUri+':101');
  console.log('EVIDENCE HarmonyOS modified:',JSON.stringify({enumerated:library.scanFound,audioRead:library.scanRead,copies:f.copied.length,stableId:changed.id===id}));
  const image=f.root+'/exact.jpg';
  f.entries.get(f.root).push('exact.jpg');f.copied.length=0;library=await run();
  const firstCover=library.songs.find(s=>s.id===id).coverFile;
  assert.ok(firstCover);assert.equal(library.scanRead,0);assert.deepEqual(f.copied,[image]);
  f.copied.length=0;library=await run();assert.equal(library.songs.find(s=>s.id===id).coverFile,firstCover);assert.deepEqual(f.copied,[]);
  f.versions.set(image,{mtime:102});library=await run();
  assert.notEqual(library.songs.find(s=>s.id===id).coverFile,firstCover);assert.deepEqual(f.copied,[image]);
  f.entries.get(f.root).push('exact.lrc');f.copied.length=0;library=await run();
  assert.equal(library.scanRead,0);assert.deepEqual(f.copied,[f.root+'/exact.lrc']);assert.equal(library.songs.find(s=>s.id===id).hasLyrics,true);
  f.copied.length=0;library=await run();assert.equal(library.scanRead,0);assert.equal(f.copied.length,0);
  f.versions.set(f.root+'/exact.lrc',{mtime:101});library=await run();assert.equal(library.scanRead,0);assert.deepEqual(f.copied,[f.root+'/exact.lrc']);
  f.statFailures.add(f.root+'/exact.lrc');library=await run();assert.equal(library.songs.find(s=>s.id===id).hasLyrics,true,'partial enumeration must preserve external lyrics');
  f.statFailures.clear();f.entries.set(f.root,f.entries.get(f.root).filter(n=>n!=='exact.lrc'));f.copied.length=0;
  library=await run();assert.equal(library.scanRead,0);assert.equal(library.songs.find(s=>s.id===id).hasLyrics,false);assert.equal(f.copied.length,0);
  const legacy=library.songs.find(s=>s.id===id);legacy.factsVersion=0;library.saveSongs();f.copied.length=0;
  library=await run();assert.equal(library.scanRead,1);assert.equal(library.songs.find(s=>s.id===id).factsVersion,3,'statistics upgrade bypasses unchanged shortcut');
  const count=library.songs.length;f.entries.set(f.root+'/Album',f.entries.get(f.root+'/Album').filter(n=>n!=='new.flac'));
  library=await run();assert.equal(library.songs.length,count-1);assert(!library.songs.some(s=>s.sourceUri?.endsWith('/new.flac')));assert.equal(library.scanRead,0,'confirmed missing source is removed without rereading other audio');
  f.versions.set(old.sourceUri,{mtime:0});library=await run();assert.equal(library.scanRead,1,'unknown timestamp must fall back to re-reading');
  f.versions.set(old.sourceUri,{mtime:101});await library.pick(true,false,[f.blocked],['mp3'],true);
  assert.equal(library.songs.length,count-1+3,'new filter reconsiders short-file cache');
});

test('Shared UI presets match both native extension allowlists and both bridges carry all rules',async()=>{
  const ui=await read('mobile/player-assets/player/scan-rules.js');
  const presets=ui.match(/const formats = \[([^\]]+)\]/)[1].replaceAll("'",'').split(',').sort();
  const android=await read(javaRoot+'LibraryPlayer.java'),harmony=await read(etsRoot+'LocalLibrary.ets');
  for(const code of [android,harmony]){
    const allow=code.match(/\(mp3\|m4a\|aac\|flac\|ogg\|opus\|wav\|aif\|aiff\|wma\|alac\)/)[0].slice(1,-1).split('|').sort();
    assert.deepEqual(presets,allow);
    const candidate=code.indexOf(code===android?'candidates.add(':'candidates.push(');
    assert(code.indexOf('scanFilter.blocksName(name)')<candidate,'filter before collecting candidates');
  }
  assert.match(android,/skipShort=options.optBoolean\("skipShort",true\)/);
  assert.match(android,/formatList=options.optJSONArray\("blockedFormats"\)/);
  assert.match(android,/scanFilter.blocksName\(name\)\)\{(?:run\.)?excludedFormats\+\+;continue;\}/);
  assert.match(harmony,/this.readFile\(item.uri,item.folder,!prior&&folderMode&&skipShort,run,created,replacements,prior\)/);
  const bridge=await read('mobile/harmony/entry/src/main/ets/pages/Index.ets');
  assert.match(bridge,/this.local.pick\(folderMode,skipShort,blocked,blockedFormats,rescan\)/);
  assert.match(bridge,/case 'rescan':this.importSongs\(true,a.skipShort\?\?true,a.blocked\?\?\[\],a.blockedFormats\?\?\[\],true\)/);
  const staged='mobile/harmony/entry/src/main/resources/rawfile/player/';
  assert.equal(await read(staged+'scan-rules.js'),await read('mobile/player-assets/player/scan-rules.js'));
  assert((await read(staged+'home-bundle.css')).includes(await read('mobile/player-assets/player/scan-rules.css')));
  for(const base of ['mobile/player-assets/player/','mobile/harmony/entry/src/main/resources/rawfile/player/'])for(const command of ['scan','rescan'])assert((await read(base+'sidebar.js')).includes(`command('${command}',{skipShort,blocked,blockedFormats});`));
});
