import type { CappellaAvatarSource } from '../../../types';

// src/components/visualizer/cappella/avatarImages.ts
// Loads built-in Cappella avatar images and resolves the active avatar source.
export type CappellaAvatarSide = 'left' | 'right';

export interface CappellaAvatarImage {
    id: string;
    name: string;
    url: string;
}

interface ResolveCappellaAvatarUrlInput {
    avatarSource: CappellaAvatarSource;
    coverUrl?: string | null;
    avatarIndex: number;
    side: CappellaAvatarSide;
    seed?: string | number;
    avatars?: CappellaAvatarImage[];
    customAvatarImages?: CappellaAvatarImage[];
}

import asset0 from "./avatar/avatar10.png";
import asset1 from "./avatar/avatar11.png";
import asset2 from "./avatar/avatar12.png";
import asset3 from "./avatar/avatar13.png";
import asset4 from "./avatar/avatar14.png";
import asset5 from "./avatar/avatar15.png";
import asset6 from "./avatar/avatar16.png";
import asset7 from "./avatar/avatar17.png";
import asset8 from "./avatar/avatar2.png";
import asset9 from "./avatar/avatar3.png";
import asset10 from "./avatar/avatar4.png";
import asset11 from "./avatar/avatar5.png";
import asset12 from "./avatar/avatar6.png";
import asset13 from "./avatar/avatar8.png";
import asset14 from "./avatar/avatar9.png";
const avatarModules = {
  "./avatar/avatar10.png": {default:asset0},
  "./avatar/avatar11.png": {default:asset1},
  "./avatar/avatar12.png": {default:asset2},
  "./avatar/avatar13.png": {default:asset3},
  "./avatar/avatar14.png": {default:asset4},
  "./avatar/avatar15.png": {default:asset5},
  "./avatar/avatar16.png": {default:asset6},
  "./avatar/avatar17.png": {default:asset7},
  "./avatar/avatar2.png": {default:asset8},
  "./avatar/avatar3.png": {default:asset9},
  "./avatar/avatar4.png": {default:asset10},
  "./avatar/avatar5.png": {default:asset11},
  "./avatar/avatar6.png": {default:asset12},
  "./avatar/avatar8.png": {default:asset13},
  "./avatar/avatar9.png": {default:asset14},
};

const toStableAvatarImages = (): CappellaAvatarImage[] =>
    Object.entries(avatarModules)
        .sort(([leftPath], [rightPath]) => leftPath.localeCompare(rightPath))
        .map(([path, mod]) => {
            const filename = path.split('/').pop() ?? '';
            const name = filename.replace(/\.[^.]+$/, '');
            return {
                id: `builtin-avatar-${name}`,
                name,
                url: mod.default,
            };
        });

export const builtinAvatarImages = toStableAvatarImages();

const hashString = (input: string) => {
    let hash = 2166136261;
    for (let index = 0; index < input.length; index += 1) {
        hash ^= input.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
};

const getSeededIndex = (seed: string | number, side: CappellaAvatarSide, length: number) =>
    hashString(`${seed}|${side}|${length}`) % length;

export const pickStableBuiltinAvatarImage = (
    avatars: CappellaAvatarImage[],
    avatarIndex: number,
    side: CappellaAvatarSide,
    seed: string | number = 'cappella',
): CappellaAvatarImage | null => {
    if (avatars.length === 0) {
        return null;
    }

    const rightAvatarIndex = getSeededIndex(seed, 'right', avatars.length);
    if (side === 'right') {
        return avatars[rightAvatarIndex] ?? null;
    }

    const leftAvatarPool = avatars.filter((_, index) => index !== rightAvatarIndex);
    if (leftAvatarPool.length === 0) {
        return avatars[rightAvatarIndex] ?? null;
    }

    const leftSeedOffset = getSeededIndex(seed, 'left', leftAvatarPool.length);
    const resolvedLeftIndex = Math.abs(Math.trunc(avatarIndex + leftSeedOffset)) % leftAvatarPool.length;
    return leftAvatarPool[resolvedLeftIndex] ?? null;
};

export const resolveCappellaAvatarUrl = ({
    avatarSource,
    coverUrl,
    avatarIndex,
    side,
    seed,
    avatars = builtinAvatarImages,
    customAvatarImages,
}: ResolveCappellaAvatarUrlInput): string | null => {
    if (avatarSource === 'color') {
        return null;
    }

    if (avatarSource === 'cover' && coverUrl) {
        return coverUrl;
    }

    if (avatarSource === 'custom' && customAvatarImages && customAvatarImages.length > 0) {
        return pickStableBuiltinAvatarImage(customAvatarImages, avatarIndex, side, seed)?.url ?? null;
    }

    return pickStableBuiltinAvatarImage(avatars, avatarIndex, side, seed)?.url ?? null;
};
