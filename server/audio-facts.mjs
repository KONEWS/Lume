export function audioFacts(metadata, bytes, sidecar = false) {
  const { format, common } = metadata;
  const quality = format.lossless === true
    ? (format.bitsPerSample >= 24 && format.sampleRate >= 88200 ? 'hires' : 'lossless')
    : format.lossless === false ? 'lossy' : 'unknown';
  const hasLyrics = sidecar || Boolean(common.lyrics?.some(tag =>
    typeof tag === 'string' ? tag.trim() : tag.text?.trim() || tag.syncText?.some(line => line.text?.trim())));
  return { bytes, quality, hasLyrics, sampleRate:format.sampleRate, bitDepth:format.bitsPerSample, channels:format.numberOfChannels };
}
