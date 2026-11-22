import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';
const out=path.resolve('artifacts/library-report-20261121');
const fixtures=path.join(out,'fixtures'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'lume-facts-library-'));
const handles=new Map(),resolveFD=p=>typeof p==='number'?handles.get(p):String(p).startsWith('/proc/self/fd/')?handles.get(Number(p.split('/').pop())):p;
let reads=0,selection=[];
const api={OpenMode:{READ_ONLY:fs.constants.O_RDONLY,WRITE_ONLY:fs.constants.O_WRONLY,CREATE:fs.constants.O_CREAT,TRUNC:fs.constants.O_TRUNC},
 accessSync:fs.existsSync,readTextSync:p=>fs.readFileSync(p,'utf8'),
 openSync:(p,f)=>{const fd=fs.openSync(p,f);handles.set(fd,p);return {fd,path:p};},
 closeSync:f=>{const fd=f.fd??f;fs.closeSync(fd);handles.delete(fd);},writeSync:fs.writeSync,renameSync:fs.renameSync,unlinkSync:fs.unlinkSync};
api.open=async(p,f)=>api.openSync(p,f);api.close=async f=>api.closeSync(f);api.stat=async fd=>fs.fstatSync(fd);
api.copyFile=async(fd,p)=>fs.copyFileSync(resolveFD(fd),p);
class FileUri{constructor(uri){this.name=path.basename(uri);this.uri=uri;}getFullDirectoryUri(){return path.dirname(this.uri);}}
const scope={exports:{},console,Map,Set,Promise,Array,JSON,Number,Date,setTimeout,fs:api,fileUri:{FileUri},
picker:{AudioSelectOptions:class{},AudioViewPicker:class{async select(){return selection;}}},util:{generateRandomUUID:randomUUID},
media:{createAVMetadataExtractor:async()=>({fetchMetadata:async()=>({}),release:async()=>{}})},
core:{room:raw=>{const request=JSON.parse(raw);if(request.type!=='audioFacts')return '{}';reads++;return execFileSync(path.join(out,'facts-desktop.exe'),[resolveFD(request.path)],{encoding:'utf8',windowsHide:true});}}};
function compile(file,target){vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8').replace(/^import .*;\r?\n/gm,''),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,target);}
const filter={exports:{}};compile('mobile/harmony/entry/src/main/ets/engine/ScanFilter.ets',filter);scope.ScanFilter=filter.exports.ScanFilter;
compile('mobile/harmony/entry/src/main/ets/engine/LocalLibrary.ets',scope);
const cases=JSON.parse(fs.readFileSync(path.join(out,'facts-results.json'),'utf8'));
const original=cases.map((c,i)=>({id:'old-'+i,title:'Saved title',sourceUri:path.join(fixtures,c.file),bytes:123,metadataVersion:1,quality:'unknown'}));
original.push({id:'sidecar',title:'Sidecar',sourceUri:path.join(fixtures,'plain.mp3'),bytes:123,metadataVersion:1,lyricsFile:'keep.lrc',hasLyrics:true,hidden:true,playCount:4});
for(const song of original)fs.copyFileSync(song.sourceUri,path.join(dir,song.id));
fs.writeFileSync(path.join(dir,'music.json'),JSON.stringify(original));
const library=new scope.exports.LocalLibrary({filesDir:dir},()=>{});
await library.fillLegacyFacts();
let saved=JSON.parse(fs.readFileSync(path.join(dir,'music.json'),'utf8'));
for(let i=0;i<cases.length;i++)for(const key of ['bytes','quality','hasLyrics','factsVersion'])assert.equal(saved[i][key],cases[i].facts[key],cases[i].file+': '+key);
assert.equal(saved.at(-1).hasLyrics,true);assert.equal(saved.at(-1).hidden,true);assert.equal(saved.at(-1).playCount,4);
const before=reads;await library.fillLegacyFacts();assert.equal(reads,before,'migration does not reread completed records');
// A reopened library retains migrated facts. A rescan also repairs already-versioned fields.
const reopened=new scope.exports.LocalLibrary({filesDir:dir},()=>{});await reopened.fillLegacyFacts();assert.equal(reads,before);
reopened.songs[0].quality='unknown';reopened.songs[0].hasLyrics=false;selection=[original[0].sourceUri];await reopened.pick();
assert.equal(reopened.songs[0].quality,'lossy');assert.equal(reopened.songs[0].hasLyrics,true);assert.equal(reopened.songs.length,original.length);
// Fresh import follows the real readFile/copy/persist path.
const fresh=path.join(dir,'fresh.flac');fs.copyFileSync(path.join(fixtures,'lyrics.flac'),fresh);selection=[fresh];await reopened.pick();
saved=JSON.parse(fs.readFileSync(path.join(dir,'music.json'),'utf8'));assert.equal(saved.at(-1).quality,'lossless');assert.equal(saved.at(-1).hasLyrics,true);
// Android: run the actual production scan, merge, persistence and refresh predicate on the JVM.
const root='mobile/android/app/src/main/java/local/lume/receiver/';
const source=fs.readFileSync(root+'LibraryPlayer.java','utf8');
function between(a,b){return source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));}
const methods=[between('    static class Song {','    private final ExecutorService'),between('    static String folderKey(','    volatile int scanDone'),between('    private static String extension(','    private long documentSize'),between('    private void persistSongs()','    private void refreshLegacyMetadata'),between('    private void scanOptions(','    void close()')].join('\n').replaceAll('android.content.UriPermission','UriPermission');
let harness=fs.readFileSync('tests/fixtures/AndroidScanHarness.java','utf8').replace('// PRODUCTION_SCANNER_METHODS',methods)
.replace('FakeApp app=new FakeApp();String root=',`FakeApp app=new FakeApp();
 Song legacy=new Song("Old title","old");legacy.metadataVersion=1;legacy.facts.put("bytes",123);
 check(needsMetadataRefresh(legacy),"byte-only old library must migrate");
 Song measured=new Song("Title","old");measured.facts.put("bytes",456).put("quality","lossy").put("embeddedHasLyrics",false).put("hasLyrics",false).put("factsVersion",2).put("sortMetadata",true);measured.metadataVersion=1;
 legacy.hidden=true;legacy.lyricUri="sidecar.lrc";mergeMetadata(legacy,measured);
 check(!needsMetadataRefresh(legacy),"versioned migration completes");check(legacy.hidden&&legacy.facts.get("hasLyrics").equals(true),"sidecar and hidden state preserved");
 check(legacy.facts.optString("quality").equals("lossy"),"quality refreshed");
 AndroidScanHarness migration=new AndroidScanHarness(app);migration.songs.add(legacy);migration.persistSongs();
 JSONObject persisted=new JSONArray(app.prefs.getString("songs","[]")).getJSONObject(0);
 check(persisted.optJSONObject("facts").get("hasLyrics").equals(true)&&persisted.optJSONObject("facts").optInt("factsVersion")==2,"facts persisted");
 app=new FakeApp();String root=`);
fs.writeFileSync(path.join(dir,'AndroidScanHarness.java'),harness);
execFileSync('javac',['-encoding','UTF-8','-d',dir,root+'ScanFilter.java',path.join(dir,'AndroidScanHarness.java')],{windowsHide:true});
const android=execFileSync('java',['-cp',dir,'local.lume.receiver.AndroidScanHarness'],{encoding:'utf8',windowsHide:true});
fs.writeFileSync(path.join(out,'library-results.json'),JSON.stringify({harmony:{migrated:original.length,versioned:true,reopen:true,rescan:true,freshImport:true,sidecarPreserved:true,hiddenPreserved:true},android:android.trim()},null,2));
console.log('PASS Android and HarmonyOS migration, persistence, rescan, sidecar/hidden preservation; Harmony fresh import');
