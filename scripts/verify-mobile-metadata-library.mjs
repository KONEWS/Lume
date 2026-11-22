// Exercise the actual ArkTS library logic on desktop with filesystem/media adapters.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';
const root=process.cwd(),fixtures=path.resolve('artifacts/metadata-20261121/fixtures');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lume-library-tags-')),handles=new Map();let nativeReads=0;
const fdPath=p=>String(p).startsWith('/proc/self/fd/')?handles.get(Number(p.split('/').pop())):p;
const fileApi={OpenMode:{READ_ONLY:fs.constants.O_RDONLY,WRITE_ONLY:fs.constants.O_WRONLY,CREATE:fs.constants.O_CREAT,TRUNC:fs.constants.O_TRUNC},
  accessSync:fs.existsSync,readTextSync:p=>fs.readFileSync(p,'utf8'),
  openSync:(p,flags)=>{const fd=fs.openSync(p,flags);handles.set(fd,p);return {fd,path:p};},
  closeSync:f=>{fs.closeSync(f.fd??f);handles.delete(f.fd??f);},
  writeSync:(fd,data)=>fs.writeSync(fd,data),renameSync:fs.renameSync,unlinkSync:fs.unlinkSync};
fileApi.open=async(p,flags)=>fileApi.openSync(p,flags);fileApi.close=async f=>fileApi.closeSync(f);fileApi.stat=async fd=>fs.fstatSync(fd);
let selection=[];
class FileUri{constructor(uri){this.uri=uri;this.name=path.basename(uri);}getFullDirectoryUri(){return path.dirname(this.uri);}}
const sandbox={exports:{},console,Map,Set,Promise,Array,JSON,Number,Date,setTimeout,
  fs:fileApi,fileUri:{FileUri},picker:{AudioSelectOptions:class{},AudioViewPicker:class{async select(){return selection;}}},
  util:{generateRandomUUID:randomUUID},
  media:{createAVMetadataExtractor:async()=>({fetchMetadata:async()=>({}),release:async()=>{}})},
  core:{room:request=>{const data=JSON.parse(request);if(data.type==='audioFacts'){nativeReads++;return execFileSync(path.resolve('artifacts/metadata-20261121/metadata-desktop.exe'),[fdPath(data.path)],{encoding:'utf8'});}return '{}';}}};
const scanFilter='mobile/harmony/entry/src/main/ets/engine/ScanFilter.ets';
if(fs.existsSync(scanFilter)){
  const filterScope={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(scanFilter,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,filterScope);
  sandbox.ScanFilter=filterScope.exports.ScanFilter;
}
let source=fs.readFileSync('mobile/harmony/entry/src/main/ets/engine/LocalLibrary.ets','utf8').replace(/^import .*;\r?\n/gm,'');
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,sandbox);
const LocalLibrary=sandbox.exports.LocalLibrary;
const original=[{id:'legacy',title:'旧标题',artist:'<unknown>',album:'',bytes:10,sourceUri:path.join(fixtures,'tagged.flac'),hidden:true,lyricsFile:'keep.lrc',hasLyrics:true},
  {id:'empty',title:'无标签',bytes:10,sourceUri:path.join(fixtures,'untagged.wav')}];
fs.copyFileSync(path.join(fixtures,'tagged.flac'),path.join(dir,'legacy'));fs.copyFileSync(path.join(fixtures,'untagged.wav'),path.join(dir,'empty'));
fs.writeFileSync(path.join(dir,'music.json'),JSON.stringify(original));let changes=0;
const library=new LocalLibrary({filesDir:dir},()=>changes++);
await library.fillLegacyFacts();let saved=JSON.parse(fs.readFileSync(path.join(dir,'music.json'),'utf8'));
assert.equal(saved[0].artist,'测试艺术家 · Artist');assert.equal(saved[0].album,'测试专辑 Album');assert.equal(saved[0].hidden,true);assert.equal(saved[0].lyricsFile,'keep.lrc');assert.equal(saved[0].hasLyrics,true);
assert.equal(saved[1].artist,'');assert.equal(saved[1].album,'');assert.equal(saved[1].metadataVersion,1);
const readCount=nativeReads;await library.fillLegacyFacts();assert.equal(nativeReads,readCount);
library.songs[0].artist='旧艺术家';library.songs[0].album='旧专辑';selection=[original[0].sourceUri];await library.pick();
saved=JSON.parse(fs.readFileSync(path.join(dir,'music.json'),'utf8'));assert.equal(saved.length,2);assert.equal(saved[0].id,'legacy');assert.equal(saved[0].artist,'测试艺术家 · Artist');assert.equal(saved[0].album,'测试专辑 Album');assert.equal(saved[0].hidden,true);assert.equal(saved[0].lyricsFile,'keep.lrc');
// Empty reads preserve previously established tags; albumArtist never overrides a track artist.
library.applyTags(library.songs[0],{artist:'',album:'',albumArtist:'合辑艺术家'});assert.equal(library.songs[0].artist,'测试艺术家 · Artist');
const result={legacyMigration:true,persisted:true,missingTagsRemainEmpty:true,versionedMigration:true,rescanNoDuplicates:true,preservedSidecarsAndHidden:true,albumArtistPriority:true,changes,nativeReads};
fs.writeFileSync(path.join(root,'artifacts/metadata-20261121/library-results.json'),JSON.stringify(result,null,2));console.log(result);
