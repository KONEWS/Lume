import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

// Run the actual controller with stand-ins only for platform services.
test('HarmonyOS card and media session share transport, background lifetime and artwork', async () => {
  const source = await readFile('mobile/harmony/entry/src/main/ets/engine/SystemPlayback.ets', 'utf8');
  const js = ts.transpileModule(source.replace(/^import .*;\r?\n/gm, ''), {
    compilerOptions: {target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS}
  }).outputText;
  const methods = {}, metadata = [], states = [], cards = [], tasks = [], errors = [], files = new Map();
  const session = {
    on: (name, fn) => methods[name] = fn, setLaunchAbility() {}, activate() {}, async destroy() {},
    setAVMetadata: async data => metadata.push({...data}), setAVPlaybackState: async data => states.push(data.state)
  };
  const songs = [{id: 'a', title: 'Alpha'}, {id: 'b', title: 'Beta', artist:'Beta artist'}];
  let finishA, reads = 0;
  class Library {
    constructor(_, changed) {
      this.changed = changed; this.songs = songs; this.index = 0;
      this.player = {state: 'paused', duration: 120000, currentTime: 0};
    }
    async toggle() { this.player.state = this.player.state === 'playing' ? 'paused' : 'playing'; this.changed(); }
    step(n) { this.index = (this.index + n + songs.length) % songs.length; this.player.state = 'playing'; this.changed(); }
    detailBytes(id) { reads++; return id === 'a' ? new Promise(r => finishA = r) : Promise.resolve('Qg=='); }
    async stop() {}
  }
  const context = {
    systemPhoneModel: 'HarmonyOS fixture',
    exports: {}, LocalLibrary: Library, setTimeout, clearTimeout,
    wantAgent: {OperationType: {}, WantAgentFlags: {}, getWantAgent: async () => ({})},
    avSession: {createAVSession: async () => session, PlaybackState: {PLAYBACK_STATE_PLAY: 1, PLAYBACK_STATE_PAUSE: 2}},
    backgroundTaskManager: {BackgroundMode: {}, startBackgroundRunning: async () => tasks.push('start'),
      stopBackgroundRunning: async () => tasks.push('stop')},
    emptyCard: {title: 'idle'}, formIds: () => ['1','2'], sendCard: async (_, id, state) => cards.push({id, ...state}),
    hilog: {warn: (...args) => errors.push(args)}, writeFile: (path, data) => files.set(path, data),
    readText: path => files.get(path) || '', fs: {accessSync: p => files.has(p), openSync: () => ({fd: 1}), closeSync() {}},
    image: {createImageSource: () => ({createPixelMap: async () => ({release() {}}), release() {}})},
    util: {Base64Helper: class {decodeSync(s) {return Uint8Array.from(Buffer.from(s, 'base64'));}}, generateRandomUUID: () => 'test'}
  };
  vm.runInNewContext(js, context);
  const engine = context.exports.systemPlayback;
  const settle = () => new Promise(r => setImmediate(r));
  engine.attach({filesDir:'/data', abilityInfo:{bundleName:'test'}});
  engine.command('toggle'); await settle();
  assert.deepEqual(tasks, ['start']);
  assert.equal(metadata.at(-1).title, 'Alpha');
  methods.playNext(); await settle(); finishA('QQ=='); await settle();
  assert.equal(metadata.at(-1).title, 'Beta'); assert.ok(metadata.at(-1).mediaImage);
  assert.equal(reads, 2); assert.deepEqual(Array.from(new Uint8Array(files.get('/data/player-cover-test.jpg'))), [66]);
  assert.deepEqual(cards.slice(-2).map(c => [c.id,c.title,c.playing,!!c.imageName]), [['1','Beta',true,true],['2','Beta',true,true]]);
  methods.pause(); await settle(); methods.pause(); await settle(); methods.play(); await settle();
  assert.deepEqual(tasks, ['start','stop','start']); assert.equal(states.at(-1), 1);
  const localKey=JSON.stringify(['local','b']), firstKey=JSON.stringify(['local','a']);
  const webStates=[];
  engine.pageFavorites=keys=>webStates.push(Array.from(keys).sort());
  engine.toggleCardFavorite(localKey); await settle();
  assert.equal(cards.at(-1).liked,true);
  engine.importFavorites([localKey,firstKey]); await settle();
  assert.equal(cards.at(-1).artist,'Beta artist');
  assert.equal(cards.at(-1).liked,false); // The pre-migration tap removed the legacy favorite.
  assert.deepEqual(webStates.at(-1),[firstKey]);
  engine.setFavorite(localKey,true); await settle();
  assert.equal(cards.at(-1).liked,true);
  engine.toggleCardFavorite(firstKey); await settle();
  assert.equal(cards.at(-1).liked,true); // A stale button cannot act on the next track.
  engine.toggleCardFavorite(localKey); await settle();
  assert.equal(cards.at(-1).liked,false);assert.deepEqual(webStates.at(-1),[firstKey]);
  engine.importFavorites([localKey]);assert.deepEqual(webStates.at(-1),[firstKey]);
  assert.deepEqual(JSON.parse(files.get('/data/player-favorites.json')).keys,[firstKey]);
  let forwarded; engine.pageControl = command => forwarded = command;
  methods.playPrevious(); assert.equal(forwarded,'previous');
  engine.update({trackId:'b',roomTrack:'Room Beta',roomPlaying:true,duration:120,
    catalog:[{id:'b',artist:'Room artist'}]},0,'http://room'); await settle();
  assert.equal(cards.at(-1).artist,'Room artist');
  const roomKey=JSON.stringify(['http://room','b']);
  engine.toggleCardFavorite(roomKey);await settle();
  assert.equal(cards.at(-1).favoriteKey,roomKey);assert.equal(cards.at(-1).liked,true);
  assert.deepEqual(webStates.at(-1),[firstKey,roomKey].sort());
  await engine.close();
  assert.equal(tasks.at(-1),'stop'); assert.equal(cards.at(-1).playing,false);
  assert.equal(errors.length,0);
});

