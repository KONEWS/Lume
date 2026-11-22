export interface VocalEnvelope {
    fps: number;
    /** Level per frame, dB. */
    db: Float32Array;
    /** The track's loud singing, dB: the 97th percentile of `db`. */
    top: number;
    /** Frames where a sung syllable starts, ascending. */
    onsets: Uint32Array;
    /** The first frame read (see the header): before it the stem was not separated. Missing for the whole track. */
    from?: number;
}
export const VOCAL_FPS = 50;
export const getVocalEnvelope = (_key: string | null): VocalEnvelope | null => null;
