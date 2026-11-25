import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';

const {chromium}=createRequire(new URL('../pc-lyrics/package.json',import.meta.url))('playwright');
const assets=path.resolve('mobile/player-assets/player');
const server=createServer(async(req,res)=>{
  try {
    const file=path.join(assets,new URL(req.url,'http://localhost').pathname);
    res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html'})[path.extname(file)]||'application/octet-stream');
    res.end(await readFile(file));
  } catch {res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
  for(const platform of ['Android','HarmonyOS']) {
    const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,reducedMotion:'reduce'});
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{
      window.LumeNative={dispatch:raw=>{
        const call=JSON.parse(raw);
        if(call.type==='detailRead')queueMicrotask(()=>lumeReadResult(call.token,''));
      }};
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
    await page.evaluate(platform=>{
      const songs=Array.from({length:78},(_,index)=>{
        const letter=String.fromCharCode(65+Math.floor(index/3));
        const fileLetter=String.fromCharCode(90-Math.floor(index/3));
        return {id:`song-${index}`,title:`${letter} Title ${index}`,fileName:`${fileLetter} File ${index}.mp3`,artist:`${letter} Artist ${index}`};
      });
      lumeUpdate({platform,songs});
      openBrowse('artists');
    },platform);
    const artistRail=page.locator('#library-frame > .collection-index[data-page=artists]');
    assert.equal(await artistRail.locator('button').count(),26);
    for(const {width,height,insets} of [
      {width:390,height:844,insets:[0,0,0,0]},
      {width:320,height:700,insets:[28,12,24,12]},
      {width:844,height:390,insets:[0,28,16,28]}
    ]) {
      await page.setViewportSize({width,height});
      await page.evaluate(values=>lumeInsets(...values),insets);
      const before=await artistRail.boundingBox();
      await page.locator('#scroll').evaluate(element=>element.scrollTop=element.scrollHeight);
      assert.deepEqual(await artistRail.boundingBox(),before,'artist index remains fixed while scrolling');
      assert(before.x>=0&&before.x+before.width<=width);
      assert(before.y>=(await page.locator('#library-frame > header').boundingBox()).y);
      assert(before.y+before.height<=(await page.locator('#phone-dock').boundingBox()).y);
      await artistRail.getByRole('button',{name:'跳到 A'}).click();
      const firstArtist=await page.locator('.artist-row').first().boundingBox();
      const scroller=await page.locator('#scroll').boundingBox();
      assert.ok(Math.abs(firstArtist.y-scroller.y)<2,'A jump aligns the first artist');
      if(width===390) {
        const x=before.x+before.width/2;
        await page.mouse.move(x,before.y+4);
        await page.mouse.down();
        await page.mouse.move(x,before.y+before.height-4,{steps:8});
        await page.mouse.up();
        assert.ok(await page.locator('#scroll').evaluate(element=>element.scrollTop)>0,'dragging the index reaches later artists');
      }
    }
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(()=>{lumeInsets(0,0,0,0);navigate('library');});
    await page.locator('#library-sort-button').click();
    await page.locator('#sort-choices [data-mode=title]').click();
    const libraryRail=page.locator('#library-frame > .collection-index[data-page=library]');
    assert.equal(await libraryRail.locator('button').count(),26);
    assert.equal(await artistRail.isVisible(),false);
    for(const [mode,field] of [['title','title'],['fileName','fileName']]) {
      if(mode==='fileName') {
        await page.locator('#library-sort-button').click();
        await page.locator('#sort-choices [data-mode=fileName]').click();
      }
      const result=await page.evaluate(field=>{
        const list=$('library-list'),songs=list.songItems;
        const letters=songs.map(song=>initialLetter(song[field]));
        const anchors=[...document.querySelectorAll('.collection-index[data-page=library] button')].map(button=>button.textContent);
        return {letters,anchors,first:songs[0][field],last:songs.at(-1)[field]};
      },field);
      assert.deepEqual([...new Set(result.letters)],result.anchors,`${mode} index follows sorted rows`);
      assert.equal(result.letters[0],'A');
      assert.equal(result.letters.at(-1),'Z');
      const bounds=await libraryRail.boundingBox();
      await page.locator('#scroll').evaluate(element=>element.scrollTop=element.scrollHeight);
      assert.deepEqual(await libraryRail.boundingBox(),bounds,`${mode} index remains fixed`);
      await libraryRail.getByRole('button',{name:'跳到 M'}).click();
      assert.ok(await page.locator('#scroll').evaluate(element=>element.scrollTop)>0);
      const middle=await page.evaluate(field=>{
        const list=$('library-list'),index=list.songItems.findIndex(song=>initialLetter(song[field])==='M');
        return {row:list.children[index].getBoundingClientRect().top,scroll:$('scroll').getBoundingClientRect().top};
      },field);
      assert.ok(Math.abs(middle.row-middle.scroll)<2,`${mode} jump reaches first M row`);
    }
    await page.locator('#library-sort-button').click();
    await page.locator('#sort-choices [data-mode=custom]').click();
    assert.equal(await libraryRail.count(),0,'other sort modes have no misleading alphabet index');
    assert.equal(await page.locator('#locate-current').evaluate(button=>getComputedStyle(button).boxShadow),'none');
    assert.deepEqual(errors,[]);
    console.log(`${platform} letter index passed`);
    await context.close();
  }
} finally {await browser.close();server.close();}
