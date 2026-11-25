const qualityLabels = globalThis.lumeQualityLabels = Object.freeze({
  hires: 'HR',
  lossless: 'SQ',
  lossy: 'LOSSY',
  unknown: '未知'
});

function songQualityLabel(song) {
  const quality = song?.quality;
  if (quality === 'hires' || quality === 'lossless') return qualityLabels[quality];
  if (quality !== 'lossy') return '';

  const extension = /\.([^.]+)$/.exec(song.fileName || '')?.[1];
  const format = String(song.format || extension || '').toUpperCase();
  return ['MP3', 'AAC', 'OPUS', 'VORBIS'].includes(format) ? format : qualityLabels.lossy;
}

function songQualityDescription(song) {
  switch(song?.quality){
    case 'hires': return '高解析无损';
    case 'lossless': return '无损';
    case 'lossy': return '有损';
    default: return '未知';
  }
}
