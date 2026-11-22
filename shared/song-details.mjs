export function coverMime(bytes) {
  if (!bytes?.length) return '';
  const head = String.fromCharCode(...bytes.subarray(0, 12));
  if (head.startsWith('\xff\xd8\xff')) return 'image/jpeg';
  if (head.startsWith('\x89PNG\r\n\x1a\n')) return 'image/png';
  if (head.startsWith('RIFF') && head.endsWith('WEBP')) return 'image/webp';
  if (/^GIF8[79]a/.test(head)) return 'image/gif';
  if (head.startsWith('BM')) return 'image/bmp';
  return '';
}

export function frontCover(pictures = []) {
  const valid = pictures.filter(p => p.data.length <= 32 * 1024 * 1024 && coverMime(p.data));
  return valid.find(p => /front/i.test(p.type || p.name || '')) ?? valid[0];
}

export function embeddedLyrics(metadata) {
  const tags = metadata?.common?.lyrics || [];
  // Some tag writers store USLT as a user-defined ID3 text frame.
  const extra = Object.values(metadata?.native || {}).flat()
    .filter(tag => /^(?:TXXX:|----:com\.apple\.iTunes:)(?:USLT|LYRICS|UNSYNCEDLYRICS)$/i.test(tag.id))
    .map(tag => tag.value);
  for (const tag of [...tags,...extra]) {
    if (tag.syncText?.length && tag.timeStampFormat === 2) {
      return tag.syncText.map(line => {
        const ms = Math.max(0, line.timestamp ?? 0);
        return '[' + Math.floor(ms / 60000) + ':' + ((ms % 60000) / 1000).toFixed(3).padStart(6, '0') + ']' + line.text;
      }).join('\n');
    }
    const text = typeof tag === 'string' ? tag : tag.text || tag.syncText?.map(l => l.text).join('\n');
    if (text?.trim()) return text.trim();
  }
  return '';
}

export function decodeLyrics(bytes) {
  if (!bytes?.length) return '';
  if (bytes[0] === 255 && bytes[1] === 254) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 254 && bytes[1] === 255) return new TextDecoder('utf-16be').decode(bytes);
  try { return new TextDecoder('utf-8', {fatal:true}).decode(bytes); }
  catch { return new TextDecoder('gb18030').decode(bytes); }
}

const clockStamp = String.raw`(\d+):(\d{1,2})(?:[.:,](\d+))?`;
const lineStamp = new RegExp(String.raw`^\[\s*${clockStamp}\s*\]\s*`);
const wordStamp = new RegExp(String.raw`<\s*${clockStamp}\s*>`, 'g');
const translationLabel = /^(?:【(?:译文|翻译)】|\[(?:译文|翻译|translation)\]|(?:译文|翻译|translation)\s*[:：])\s*/i;
const metadataLine = /^\[(?:ar|al|ti|au|by|re|ve|offset|length|language|tool|id|kana|作词|作曲):[^\]]*\]\s*$/i;
function seconds(match) {
  return Number(match[1]) * 60 + Number(match[2]) + Number('0.' + (match[3] || '0'));
}
function readLyricLine(raw, offset) {
  let body = raw.trim();
  const starts = [];
  let stamp;
  while ((stamp = lineStamp.exec(body))) {
    starts.push(seconds(stamp));
    body = body.slice(stamp[0].length);
  }
  const translated = translationLabel.test(body);
  body = body.replace(translationLabel, '');
  const markers = [...body.matchAll(wordStamp)];
  if (!starts.length && markers.length) starts.push(seconds(markers[0]));
  const text = body.replace(wordStamp, '').trim();
  const words = [];
  for (let i = 0; i < markers.length; i++) {
    const marker = markers[i], next = markers[i + 1];
    const fragment = body.slice(marker.index + marker[0].length, next?.index);
    if (fragment) words.push({text:fragment,startTime:seconds(marker),endTime:next ? seconds(next) : undefined});
  }
  const completeWords = words.length && words.map(w=>w.text).join('').trim() === text;
  return {text, translated, rows:starts.map(start => {
    const shift = start - starts[0] - offset;
    return {time:start-offset, text, translated, ...(completeWords ? {words:words.map(w=>({
      text:w.text, startTime:w.startTime+shift, endTime:w.endTime===undefined ? undefined : w.endTime+shift
    }))} : {})};
  })};
}

export function parseSongLyrics(content = '') {
  const offset = Number(content.match(/\[offset:\s*([+-]?\d+)\]/i)?.[1] || 0) / 1000;
  const timed = [], plain = [];
  let preceding = [];
  for (const raw of content.replace(/[\uFEFF\0]/g, '').split(/\r\n?|\n/)) {
    if (metadataLine.test(raw.trim())) continue;
    const parsed = readLyricLine(raw, offset);
    if (parsed.rows.length) {
      timed.push(...parsed.rows);
      preceding = parsed.rows;
    } else if (parsed.text && parsed.translated && preceding.length) {
      for (const row of preceding) row.translation = parsed.text;
    } else {
      plain.push(parsed.text);
    }
  }
  timed.sort((a,b)=>a.time-b.time);
  const rows = [];
  for (let i = 0; i < timed.length;) {
    const group = [timed[i++]];
    while (i < timed.length) {
      const candidate = timed[i], first = group[0];
      const sameTime = Math.abs(candidate.time-first.time) < 0.00001;
      // Some bilingual LRC writers move the translation a few milliseconds past the original.
      const paired = candidate.time-first.time <= 0.03 && group.length === 1 &&
        (candidate.translated || Boolean(first.words) !== Boolean(candidate.words));
      if (!sameTime && !paired) break;
      group.push(candidate); i++;
    }
    const nonempty = group.filter(row=>row.text);
    const main = nonempty.find(row=>!row.translated && row.words) ??
      nonempty.find(row=>!row.translated) ?? nonempty[0] ?? group[0];
    const translations = new Set([main.translation, ...nonempty.filter(row=>row!==main).map(row=>row.text)]);
    translations.delete(undefined); translations.delete(main.text);
    const translation = [...translations].join('\n');
    rows.push({time:main.time,text:main.text,...(main.words ? {words:main.words} : {}),...(translation ? {translation} : {})});
  }
  return {rows, plain:plain.join('\n').trim()};
}

export function lyricLines(content) { return parseSongLyrics(content).rows; }
