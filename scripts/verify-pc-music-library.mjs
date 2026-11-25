import {chromium} from '../pc-lyrics/node_modules/playwright/index.mjs';
import {startServer} from '../server/index.mjs';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const dir=await mkdtemp(path.join(os.tmpdir(),'lume-library-ui-'));
const now=Date.now()-20000;
const records=['local','room','legacy'].map((mode,i)=>({id:'history-fixture',session:mode,title:'来源测试 '+mode,
  startedAt:now+i*1000,listenedMs:900,completed:false,source:'local',...(mode==='legacy'?{}:{playModeSource:mode})}));
const media=path.join(dir,'media');
await mkdir(media);
const audio=await readFile(new URL('../tests/fixtures/channel-check.wav',import.meta.url));
const tracks=['history-fixture','second','third'].map(id=>({id,source:'import',file:id+'.wav',title:id,format:'WAV',duration:2}));
for(const track of tracks)await writeFile(path.join(media,track.file),audio);
await writeFile(path.join(dir,'library.json'),JSON.stringify({tracks,playRecords:records}));
const server=await startServer({host:'127.0.0.1',port:0,dataDir:dir});
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1440,height:960}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(server.url);
  await page.getByRole('button',{name:'音乐库',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.library-storage')||!document.querySelector('#root')?.children.length);
  assert.deepEqual(errors,[]);
  assert.equal(await page.locator('.library-chart').count(),2);
  await page.getByRole('button',{name:/主机曲库/}).click();
  assert.equal(await page.locator('.track-row').count(),3);
  await page.getByRole('button',{name:'统计',exact:true}).click();
  await page.getByRole('tab',{name:'播放记录',exact:true}).click();
  await page.getByRole('button',{name:'逐次记录',exact:true}).click();
  const rows=page.locator('.stats-record');
  assert.equal(await rows.count(),3);
  assert(await rows.filter({hasText:'旧记录 · 播放模式未知'}).count());
  for(const [mode,label] of [['local','本地播放'],['room','空间播放']]){
    await page.getByLabel('播放来源',{exact:true}).selectOption(mode);
    assert.equal(await rows.count(),1);assert((await rows.innerText()).includes(label));
  }
  await page.getByLabel('播放来源',{exact:true}).selectOption('all');assert.equal(await rows.count(),3);
  assert.deepEqual(errors,[]);
  console.log('PASS: desktop navigation → 音乐库 → both charts → 主机曲库, history source filters and legacy rows.');
}finally{await browser.close();await server.close();await rm(dir,{recursive:true,force:true});}
