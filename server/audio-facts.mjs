// A restored library with cached facts can open without loading the tag parsers.
export async function parseFile(file, options) {
  const metadata = await import('music-metadata');
  return metadata.parseFile(file, options);
}

export function losslessQuality(bitDepth, sampleRate) {
  return bitDepth >= 24 && sampleRate >= 48000 ? 'hires' : 'lossless';
}

export function audioFacts(metadata, bytes, sidecar = false) {
  const { format, common } = metadata;
  const quality = format.lossless === true
    ? losslessQuality(format.bitsPerSample, format.sampleRate)
    : format.lossless === false ? 'lossy' : 'unknown';
  const hasLyrics = sidecar || Boolean(common.lyrics?.some(tag =>
    typeof tag === 'string' ? tag.trim() : tag.text?.trim() || tag.syncText?.some(line => line.text?.trim())));
  return { bytes, quality, hasLyrics, sampleRate:format.sampleRate, bitDepth:format.bitsPerSample, channels:format.numberOfChannels };
}
