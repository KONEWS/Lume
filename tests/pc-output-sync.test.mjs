import test from 'node:test';
import assert from 'node:assert/strict';
import { OutputSynchronizer } from '../src/hooks/syncOutput.ts';

function fixture(shared = true) {
  const sync = new OutputSynchronizer();
  const media = { duration: 60, currentTime: 10, playbackRate: 1, readyState: 4, seeking: false, paused: false };
  const sample = (drift, now) => sync.sync(media, media.currentTime + drift, true, 0, 0, shared, undefined, now);
  sample(0, 0);
  return { sync, media, sample };
}

test('alternating phone clock jitter and an isolated late poll do not change playback', () => {
  const { media, sample } = fixture();
  for (let i = 1; i <= 20; i++) {
    const drift = i === 10 ? 0.18 : (i % 2 ? 0.045 : -0.045);
    sample(drift, i * 250);
    sample(drift, i * 250 + 1); // timer and WebSocket can sample the same packet
    assert.equal(media.currentTime, 10);
    assert.equal(media.playbackRate, 1);
  }
});

test('sustained shared drift corrects gently, settles, and realigns a sustained large error once', () => {
  for (const direction of [-1, 1]) {
    const { media, sample } = fixture();
    sample(direction * 0.06, 100);
    sample(direction * 0.06, 600);
    assert.equal(media.playbackRate, 1 + direction * 0.004);
    sample(direction * 0.024, 850);
    assert.equal(media.playbackRate, 1 + direction * 0.004);
    sample(0.006, 1100);
    sample(0.005, 1600);
    assert.equal(media.playbackRate, 1);
    sample(direction * 0.2, 1850);
    assert.equal(media.currentTime, 10);
    sample(direction * 0.2, 2350);
    assert.equal(media.currentTime, 10 + direction * 0.2);
  }
});

test('solo playback stays at normal speed and transport commands and millisecond trim are honored', () => {
  const { sync, media, sample } = fixture(false);
  sample(0.08, 100);
  sample(0.08, 600);
  assert.equal(media.playbackRate, 1);
  assert.equal(media.currentTime, 10);
  sync.sync(media, 10.08, true, 0, 0, false, 1234);
  assert.equal(media.currentTime, 10.08);
  media.seeking = true;
  sync.sync(media, 10.08, true, 1, 0, false, 1234);
  assert.equal(media.currentTime, 10.08);
  media.seeking = false;
  sync.sync(media, 10.08, true, 1, 0, false, 1234);
  assert.equal(media.currentTime, 10.08 - 0.001);
  assert.equal(sync.sync(media, -0.7, true, 1, 0, true), false);
  assert.equal(media.currentTime, 0);
  media.paused = true;
  assert.equal(sync.sync(media, 0.2, true, 0, 0.015, true), true);
  assert.ok(Math.abs(media.currentTime - 0.215) < 1e-9);
});
