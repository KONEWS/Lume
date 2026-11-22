/** Original, deterministic ambient synthesis. No recordings or external sound assets. */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const destination = fileURLToPath(new URL('../resources/demo/', import.meta.url));
const sampleRate = 44100;
const duration = 60;
const frames = sampleRate * duration;
const tau = Math.PI * 2;
const frequency = midi => 440 * 2 ** ((midi - 69) / 12);
const tracks = [
  { id: 'demo-tide', title: '潮汐之间', file: 'tide.wav', artwork: '/covers/1.svg',
    chords: [[48,55,59,64],[45,52,55,60],[41,48,52,57],[43,50,55,59]],
    melody: [76,74,71,67,69,72,76,74,72,69,67,64,67,71,74,71], tone: 0.18, beat: 0.9375 },
  { id: 'demo-moon', title: '月色落在水面', file: 'moon.wav', artwork: '/covers/2.svg',
    chords: [[50,57,60,65],[46,53,57,62],[48,55,58,64],[45,52,57,60]],
    melody: [77,76,72,69,74,72,69,65,70,69,67,64,69,72,76,72], tone: 0.1, beat: 1.25 },
  { id: 'demo-forest', title: '林间的呼吸', file: 'forest.wav', artwork: '/covers/3.svg',
    chords: [[43,50,54,59],[40,47,50,55],[36,43,47,52],[38,45,50,54]],
    melody: [71,74,78,74,71,67,66,62,64,67,71,69,66,62,66,69], tone: 0.14, beat: 1.071428571 },
];

function addNote(left, right, { midi, start, length, gain, pan, kind, tone }) {
  const first = Math.max(0, Math.floor(start * sampleRate));
  const last = Math.min(frames, Math.ceil((start + length) * sampleRate));
  const f = frequency(midi);
  const angle = (pan + 1) * Math.PI / 4;
  const lGain = gain * Math.cos(angle);
  const rGain = gain * Math.sin(angle);
  const attack = kind === 'pad' ? 1.8 : 0.045;
  const release = kind === 'pad' ? 2.5 : 0.5;
  for (let i = first; i < last; i++) {
    const t = i / sampleRate - start;
    const rise = Math.min(1, t / attack);
    const fall = Math.min(1, Math.max(0, (length - t) / release));
    const envelope = Math.sin(rise * Math.PI / 2) ** 2 * Math.sin(fall * Math.PI / 2) ** 2;
    const phase = tau * f * t;
    const fundamental = Math.sin(phase);
    let sound;
    if (kind === 'pad') {
      sound = (fundamental + 0.28 * Math.sin(phase * 1.0017) + tone * Math.sin(phase * 2)) / 1.4;
      sound *= 0.88 + 0.12 * Math.sin(tau * 0.11 * t + midi);
    } else {
      sound = (fundamental + 0.2 * Math.sin(phase * 2) * Math.exp(-t * 2) + 0.065 * Math.sin(phase * 3) * Math.exp(-t * 4)) * Math.exp(-t * 1.2);
    }
    left[i] += sound * envelope * lGain;
    right[i] += sound * envelope * rGain;
  }
}

function ambience(left, right) {
  // A quiet cross-channel echo gives the original dry synthesis a small sense of space.
  const delayA = Math.round(sampleRate * 0.281);
  const delayB = Math.round(sampleRate * 0.409);
  for (let i = Math.max(delayA, delayB); i < frames; i++) {
    const l = left[i - delayA];
    const r = right[i - delayB];
    left[i] += 0.15 * r;
    right[i] += 0.15 * l;
  }
}

function encodeWav(left, right) {
  let peak = 0;
  for (let i = 0; i < frames; i++) {
    const t = i / sampleRate;
    const edge = Math.min(1, t / 2, (duration - t) / 4);
    const fade = Math.sin(edge * Math.PI / 2) ** 2;
    left[i] *= fade;
    right[i] *= fade;
    peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  }
  const scale = peak ? 0.56 / peak : 1;
  const dataSize = frames * 4;
  const wav = Buffer.alloc(44 + dataSize);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + dataSize, 4); wav.write('WAVE', 8);
  wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(2, 22); wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 4, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(dataSize, 40);
  let squares = 0;
  for (let i = 0; i < frames; i++) {
    const l = Math.round(left[i] * scale * 32767);
    const r = Math.round(right[i] * scale * 32767);
    wav.writeInt16LE(l, 44 + i * 4); wav.writeInt16LE(r, 46 + i * 4);
    squares += l * l + r * r;
  }
  return { wav, rms: Math.sqrt(squares / (frames * 2)) / 32767 };
}

await mkdir(destination, { recursive: true });
const manifest = [];
for (const track of tracks) {
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  for (let section = 0; section < 8; section++) {
    const chord = track.chords[section % track.chords.length];
    chord.forEach((midi, voice) => addNote(left, right, {
      midi, start: section * 7.5 - 0.2, length: 9.5,
      gain: voice === 0 ? 0.105 : 0.067, pan: [-0.25, -0.55, 0.55, 0.15][voice],
      kind: 'pad', tone: track.tone,
    }));
  }
  for (let note = 0, start = 3.75; start < 56; note++, start += track.beat * (note % 4 === 3 ? 3 : 2)) {
    addNote(left, right, {
      midi: track.melody[note % track.melody.length], start, length: 3.7,
      gain: 0.057 + (note % 3) * 0.004, pan: note % 2 ? 0.35 : -0.35,
      kind: 'bell', tone: track.tone,
    });
  }
  ambience(left, right);
  const { wav, rms } = encodeWav(left, right);
  const outputPath = path.join(destination, track.file);
  await writeFile(outputPath, wav);
  const saved = await readFile(outputPath);
  if (saved.length !== 44 + frames * 4 || saved.toString('ascii', 0, 4) !== 'RIFF'
      || saved.toString('ascii', 8, 12) !== 'WAVE' || saved.readUInt16LE(22) !== 2
      || saved.readUInt32LE(24) !== sampleRate || saved.readUInt16LE(34) !== 16
      || saved.readUInt32LE(40) !== frames * 4) throw new Error(`Invalid WAV: ${track.file}`);
  manifest.push({ id: track.id, title: track.title, artist: 'LUME Studio', album: '光的形状 · 原创试听', duration, format: 'WAV', artwork: track.artwork, file: track.file });
  console.log(`${track.file}: ${saved.length} bytes · ${duration}s · ${sampleRate} Hz · stereo PCM16 · peak −5.0 dBFS · RMS ${(20 * Math.log10(rms)).toFixed(1)} dBFS`);
}
await writeFile(path.join(destination, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log('Generated 3 original ambient demos and manifest.json.');
