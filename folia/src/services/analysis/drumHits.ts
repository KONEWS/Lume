export type DrumHitKind = 0 | 1 | 2;
export const DRUM_KICK: DrumHitKind = 0;
export const DRUM_SNARE: DrumHitKind = 1;
export const DRUM_HAT: DrumHitKind = 2;
export interface DrumHits {
    times: Float64Array;
    strengths: Float32Array;
    kinds: Uint8Array;
    /** While the track is still separating: the time (s) the hits reach, none after it known yet. */
    until?: number;
}
export const getDrumHits = (_key: string | null): DrumHits | null => null;
