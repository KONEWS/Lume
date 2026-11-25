import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';

const {chromium}=createRequire(new URL('../pc-lyrics/package.json',import.meta.url))('playwright');
const browser=await chromium.launch({channel:'chrome'});
try{
  for(const platform of ['Android','HarmonyOS']){
    const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,reducedMotion:'reduce'});
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('http://player.test/**',route=>route.fulfill({
      path:path.join('mobile/player-assets/player',new URL(route.request().url()).pathname)
    }));
    await page.addInitScript(()=>{window.LumeNative={dispatch(){}};});
    await page.goto('http://player.test/index.html');
    const songs=[{id:'s1',title:'Track One'},{id:'s2',title:'Track Two'}];
    await page.evaluate(({platform,songs})=>{
      lumeUpdate({platform,songs});
      savePreference(playlistKey(),[{id:'old',name:'旧歌单',songs:['s1','s2']}]);
      openBrowse('playlists');
    },{platform,songs});
    const btn=(name,root=page)=>root.getByRole('button',{name,exact:true});
    const browse=page.locator('#browse-content'),editor=page.locator('.list-editor'),menu=page.locator('#song-actions');
    const stored=()=>page.evaluate(()=>readPreference(playlistKey(),[]));
    await btn('＋ 新建歌单').click();
    assert.equal(await editor.locator('input').count(),1);
    await editor.getByLabel('歌单名称').fill('新歌单');await btn('保存',editor).click();
    assert.deepEqual((await stored())[1].songs,[]);
    const plus=btn('添加音乐'),picker=editor.locator('.playlist-options');
    assert.equal(await plus.innerText(),'');
    const position=await plus.boundingBox();
    assert.ok(position.x>page.viewportSize().width/2 && position.y>page.viewportSize().height/2);
    await page.emulateMedia({reducedMotion:'no-preference'});
    await plus.click();
    assert.equal(await editor.evaluate(node=>getComputedStyle(node).animationName),'song-sheet-enter');
    await picker.getByLabel(/Track Two/).check();
    await editor.getByRole('searchbox').fill('One');
    assert.equal(await picker.locator('label').count(),1);
    await btn('添加（1）',editor).click();
    await editor.waitFor({state:'hidden'});
    assert.deepEqual((await stored())[1].songs,['s2']);
    await plus.click();
    assert.equal(await picker.getByLabel(/Track Two/).isDisabled(),true);
    await picker.getByLabel(/Track One/).check();
    await btn('取消',editor).click();await editor.waitFor({state:'hidden'});
    assert.deepEqual((await stored())[1].songs,['s2']);
    await page.evaluate(()=>navigate('library'));
    await page.locator('#library-list .end').first().click();
    assert.equal(await btn('移出歌单',menu).count(),0);
    await btn('添加到歌单',menu).click();await btn('新歌单',menu).click();
    await menu.waitFor({state:'hidden'});
    await page.emulateMedia({reducedMotion:'reduce'});
    const [old,list]=await stored();
    assert.deepEqual(list.songs,['s2','s1']);
    await page.evaluate(id=>openBrowse('playlists',id),list.id);
    await btn('编辑歌单',browse).click();
    const name=editor.getByLabel('歌单名称');
    await name.press('End');
    for(const character of list.name)await name.press('Backspace');
    await name.fill('改名后');await btn('保存',editor).click();
    assert.deepEqual((await stored())[1],{...list,name:'改名后'});
    await browse.locator('.end').first().click();await btn('移出歌单',menu).click();
    await browse.locator('.end').click();await btn('移出歌单',menu).click();
    assert.equal(await browse.locator('.song').count(),0);
    assert.deepEqual((await stored())[0],old);
    await btn('删除歌单',browse).click();await btn('取消',editor).click();
    assert.equal((await stored()).length,2);
    await btn('删除歌单',browse).click();await btn('删除歌单',editor).click();
    assert.deepEqual(await stored(),[old]);
    assert.equal(await page.evaluate(()=>browseDetail),null);
    // Existing nonempty playlists can also be deleted, leaving the songs available.
    await page.evaluate(()=>openBrowse('playlists','old'));
    await btn('删除歌单',browse).click();await btn('删除歌单',editor).click();
    assert.deepEqual(await page.evaluate(()=>state.songs.map(s=>s.id)),['s1','s2']);
    await page.reload();assert.deepEqual(await stored(),[]);
    assert.deepEqual(errors,[]);
    console.log(platform+' playlist creation, membership, rename and deletion passed');
    await page.close();
  }
}finally{await browser.close();}
