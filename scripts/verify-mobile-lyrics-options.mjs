import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';

const require=createRequire(new URL('../pc-lyrics/package.json',import.meta.url));
const {chromium}=require('playwright');
const assets=path.resolve(process.env.LUME_TEST_ASSETS||'mobile/player-assets');
const output=path.resolve('artifacts/lyrics-options');
await mkdir(output,{recursive:true});
const server=createServer(async(req,res)=>{
  try{
    const file=path.join(assets,decodeURIComponent(new URL(req.url,'http://localhost').pathname));
    res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[path.extname(file)]||'application/octet-stream');
    res.end(await readFile(file));
  }catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-swiftshader']});
try{
  for(const platform of ['Android','HarmonyOS']){
    const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.stack||error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/player/index.html`);
    await page.waitForFunction(()=>window.lumePlain&&window.lumeSongDetails);
    await page.evaluate(platform=>{
      document.documentElement.dataset.platform=platform;document.documentElement.dataset.phoneTheme='dark';
      lumeUpdate({platform,songs:[{id:'lyrics-test',title:'歌词测试',artist:'LUME'}],id:'lyrics-test',title:'歌词测试',duration:20,pos:1,playing:false});
      openPlayer();renderLyrics('[00:00.00]きょうは あおいそら\n[00:04.00]さくら が さいた');setLyrics(true);
    },platform);
    await page.locator('#style-settings').click();
    assert(await page.locator('#plain-lyric-settings').evaluate(element=>element.open),'real settings button opens lyric controls');
    const parse=lyric=>page.evaluate(lyric=>lumePlain.parse(lyric,lumeSongDetails.parseSongLyrics).rows,lyric);
    const kana='[00:00.00]きょうは あおいそら\n[00:04.00]さくら が さいた';
    assert.equal((await parse(kana))[0].romanization,undefined,'auto does not invent a reading');
    await page.locator('#plain-romaji').selectOption('always');
    assert.equal((await parse(kana))[0].romanization,'kyouwa aoisora');
    assert.equal((await parse('[00:00.00]世界\n[00:00.00][romaji] sekai'))[0].romanization,'sekai','tagged reading works for kanji');
    const readingFirst=(await parse('[00:00.00][romaji] sekai\n[00:00.00]世界'))[0];
    assert.equal(readingFirst.text,'世界');assert.equal(readingFirst.romanization,'sekai');
    await page.locator('#plain-romaji').selectOption('never');
    assert.equal((await parse(kana))[0].romanization,undefined);
    await page.locator('#plain-karaoke').selectOption('always');
    const rows=await parse('[00:00.00]春風が吹く\n[00:04.00]また会おう');
    assert.equal(rows[0].words.map(word=>word.text).join(''),rows[0].text);
    assert(rows[0].words.every((word,i)=>word.endTime>word.startTime&&(i===0||word.startTime>=rows[0].words[i-1].endTime)));
    assert(rows[0].words.at(-1).endTime<=rows[1].time);
    const rendered=await page.evaluate(()=>{
      const rows=lumePlain.parse('[00:00.00]春風が吹く\n[00:04.00]また会おう',lumeSongDetails.parseSongLyrics).rows;
      const panel=document.getElementById('lyrics-panel');panel.replaceChildren(...rows.map(lumePlain.row));
      lumePlain.progress(panel,rows,.3,8,true);
      return {count:panel.querySelectorAll('.plain-word').length,progress:panel.querySelector('.plain-word').style.getPropertyValue('--word-progress')};
    });
    assert(rendered.count>1&&parseFloat(rendered.progress)>0&&parseFloat(rendered.progress)<100,'generated timing paints a partial word');
    const native=await parse('[00:00.00]<00:00.00>春<00:01.00>風<00:02.00>が');
    assert.equal(native[0].words[1].startTime,1,'source word timing stays authoritative');
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.locator('#plain-karaoke').selectOption('auto');
    assert.equal((await parse('[00:00.00]春風が吹く\n[00:04.00]また会おう'))[0].words,undefined,'auto respects reduced motion');
    await page.emulateMedia({reducedMotion:'no-preference'});
    assert((await parse('[00:00.00]春風が吹く\n[00:04.00]また会おう'))[0].words.length>1);
    await page.locator('#plain-karaoke').selectOption('never');
    assert.equal((await parse('[00:00.00]春風が吹く\n[00:04.00]また会おう'))[0].words,undefined);
    const storedModes=await page.evaluate(()=>JSON.parse(localStorage.getItem('lume-plain-lyrics')));
    assert.equal(storedModes.romaji,'never');assert.equal(storedModes.karaoke,'never');
    await page.locator('#plain-text-color').fill('#555555');
    await page.locator('#plain-highlight-color').fill('#f0f0f0');
    assert(await page.locator('#plain-lyric-settings').evaluate(element=>element.open),'color settings remain open');
    await page.waitForTimeout(450);
    await page.locator('#plain-lyric-settings').screenshot({path:path.join(output,`${platform}-settings.png`)});
    const dark=await page.evaluate(()=>({stored:JSON.parse(localStorage.getItem('lume-plain-lyrics')),text:document.getElementById('lyrics-panel').style.getPropertyValue('--plain-text-color'),highlight:document.getElementById('lyrics-panel').style.getPropertyValue('--plain-highlight-color')}));
    assert.equal(dark.stored.colors.dark.text,'#555555');
    assert.notEqual(dark.text,'#555555','low contrast color is adjusted');
    assert.equal(dark.highlight,'#f0f0f0');
    await page.locator('[aria-label="高亮字与逐字进度：粉"]').click();
    assert.match((await page.evaluate(()=>JSON.parse(localStorage.getItem('lume-plain-lyrics')).colors.dark.highlight)),/^#[\da-f]{6}$/);
    await page.evaluate(()=>document.documentElement.dataset.phoneTheme='light');
    await page.locator('#plain-text-color').fill('#123456');
    const light=await page.evaluate(()=>JSON.parse(localStorage.getItem('lume-plain-lyrics')));
    assert.equal(light.colors.dark.text,'#555555');
    assert.equal(light.colors.light.text,'#123456');
    await page.reload();
    await page.waitForFunction(()=>window.lumePlain);
    await page.evaluate(()=>document.documentElement.dataset.phoneTheme='light');
    assert.equal(await page.locator('#plain-text-color').inputValue(),'#123456','saved light theme color reloads');
    assert.equal(await page.locator('#plain-romaji').inputValue(),'never');
    assert.equal(await page.locator('#plain-karaoke').inputValue(),'never');
    await page.setViewportSize({width:844,height:390});
    await page.evaluate(()=>{
      const container=document.createElement('div');container.id='folia-test';
      container.style.cssText='position:fixed;inset:0;z-index:9999';document.body.append(container);
      window.testFolia=LumeFolia.mount(container,()=>window.testFoliaError=true);
      window.testTrack={id:'spacing',title:'Spacing',artist:'LUME',duration:20,translated:false,cover:'',rows:[
        {time:0,text:'今夜の星空を見上げながら歩き続ける私たちの長い歌詞'},
        {time:10,text:'次の行'}]};
      testFolia.update(testTrack,'classic',2,false);
    });
    const frame=page.frameLocator('#folia-test iframe');
    await frame.locator('[data-visualizer-style=classic] [data-overlap-fit-line]').waitFor({timeout:20000});
    const classic=await frame.locator('[data-visualizer-style=classic] [data-overlap-fit-line]').evaluate(element=>({line:element.getBoundingClientRect().height,area:element.parentElement.getBoundingClientRect().height,style:getComputedStyle(element).minHeight}));
    assert(classic.line<=classic.area+1,`Flow line fits short landscape area: ${JSON.stringify(classic)}`);
    await page.evaluate(()=>testFolia.update(testTrack,'partita',2,false));
    await frame.locator('[data-visualizer-style=partita] [data-overlap-fit-line]').waitFor({timeout:20000});
    const partita=await frame.locator('[data-visualizer-style=partita] [data-overlap-fit-line]').evaluate(element=>({line:element.getBoundingClientRect().height,area:element.parentElement.getBoundingClientRect().height}));
    assert(partita.line<=partita.area+1,`Partita line fits short landscape area: ${JSON.stringify(partita)}`);
    await page.waitForTimeout(600);
    await page.screenshot({path:path.join(output,`${platform}-partita.png`)});
    await page.evaluate(()=>testFolia.close());
    assert.deepEqual(errors.filter(error=>/plain-lyrics|folia\/host|folia\/stage/i.test(error)),[]);
    await context.close();
    console.log(`PASS ${platform}: romaji, line-to-word timing, modes, colors, Folia landscape spacing`);
  }
}finally{await browser.close();server.close();}
