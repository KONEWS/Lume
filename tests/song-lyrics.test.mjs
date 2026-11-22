import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSongLyrics} from '../shared/song-details.mjs';

test('Android enhanced LRC keeps original and translation at one playhead',()=>{
  const {rows}=parseSongLyrics('[offset:100]\r[00:10.500]译文：早安\r[00:10.500]<00:10.500>Good <00:10.800>morning<00:11.200>\r[00:15]Next');
  assert.equal(rows.length,2);
  assert.equal(rows[0].text,'Good morning');
  assert.equal(rows[0].translation,'早安');
  assert.deepEqual(rows[0].words.map(w=>[w.text,w.startTime.toFixed(1),w.endTime.toFixed(1)]),
    [['Good ','10.4','10.7'],['morning','10.7','11.1']]);
});
test('word-only and repeated timestamps never become lyric text',()=>{
  const {rows}=parseSongLyrics('<00:01.234>私<00:01.800>は\n[00:01.235]我是\n[00:05][00:15]Meet at 12:30');
  assert.deepEqual(rows.map(r=>r.text),['私は','Meet at 12:30','Meet at 12:30']);
  assert.equal(rows[0].translation,'我是');
});
test('plain text, metadata and unmarked bilingual rows',()=>{
  assert.deepEqual(parseSongLyrics('[ar:歌手]\nMeet at 12:30'),{rows:[],plain:'Meet at 12:30'});
  assert.deepEqual(parseSongLyrics('[00:01]原詞\n[00:01]译句').rows,[{time:1,text:'原詞',translation:'译句'}]);
});
