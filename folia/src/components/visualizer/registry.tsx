import builtin0 from './cadenza/entry';
import builtin1 from './cappella/entry';
import builtin2 from './claddagh/entry';
import builtin3 from './classic/entry';
import builtin4 from './diorama/entry';
import builtin5 from './fume/entry';
import builtin6 from './hanabi/entry';
import builtin7 from './lumiere/entry';
import builtin8 from './machi/entry';
import builtin9 from './metaphor/entry';
import builtin10 from './monet/entry';
import builtin11 from './nebbia/entry';
import builtin12 from './partita/entry';
import builtin13 from './pendolo/entry';
import builtin14 from './sonnet/entry';
import builtin15 from './still/entry';
import builtin16 from './tempera/entry';
import builtin17 from './tilt/entry';
import { type VisualizerMode } from '../../types';
import { BUILTIN_VISUALIZER_MODES, DEFAULT_VISUALIZER_MODE, assertBuiltinModeList } from '../../types/visualizerModes';
import { registerVisualizerModeLabelResolver } from '../../utils/visualizerModeLabel';
import {
    type VisualizerEntryModule,
    type VisualizerRegistryEntry,
} from './definition';

export type {
    VisualizerRegistryEntry,
    VisualizerSettingsPanelProps,
    VisualizerSharedProps,
} from './definition';

// Central mode registry. Entries are discovered from each visualizer's local entry file.
const visualizerEntryModules = {
  './cadenza/entry.tsx': {default:builtin0},
  './cappella/entry.tsx': {default:builtin1},
  './claddagh/entry.tsx': {default:builtin2},
  './classic/entry.tsx': {default:builtin3},
  './diorama/entry.tsx': {default:builtin4},
  './fume/entry.tsx': {default:builtin5},
  './hanabi/entry.tsx': {default:builtin6},
  './lumiere/entry.tsx': {default:builtin7},
  './machi/entry.tsx': {default:builtin8},
  './metaphor/entry.tsx': {default:builtin9},
  './monet/entry.tsx': {default:builtin10},
  './nebbia/entry.tsx': {default:builtin11},
  './partita/entry.tsx': {default:builtin12},
  './pendolo/entry.tsx': {default:builtin13},
  './sonnet/entry.tsx': {default:builtin14},
  './still/entry.tsx': {default:builtin15},
  './tempera/entry.tsx': {default:builtin16},
  './tilt/entry.tsx': {default:builtin17}
};

const buildVisualizerRegistry = (modules: Record<string, VisualizerEntryModule>) => {
    const entries = Object.entries(modules).map(([path, module]) => {
        if (!module.default) {
            throw new Error(`[VisualizerRegistry] Missing default export in ${path}`);
        }

        return module.default;
    });
    const byMode: Partial<Record<VisualizerMode, VisualizerRegistryEntry>> = {};

    entries.forEach(entry => {
        if (byMode[entry.mode]) {
            throw new Error(`[VisualizerRegistry] Duplicate visualizer mode "${entry.mode}"`);
        }

        byMode[entry.mode] = entry;
    });

    return {
        entries: [...entries].sort((left, right) => left.order - right.order),
        byMode,
    };
};

const { entries: VISUALIZER_REGISTRY, byMode: VISUALIZER_REGISTRY_BY_MODE } =
    buildVisualizerRegistry(visualizerEntryModules);

export { VISUALIZER_REGISTRY };

// 只有走 glob 的这一侧知道目录里真正有什么，所以自检放在这里：清单漏了或多了一个模式，
// 应用启动时就炸，而不是等到某个 store 悄悄把用户的模式重置成 classic。
assertBuiltinModeList('VisualizerRegistry', VISUALIZER_REGISTRY.map(entry => entry.mode), BUILTIN_VISUALIZER_MODES);

// 权威定义在 types/visualizerModes.ts —— 那里不含 UI，store 和 OBS 短码可以直接用。
// 这里再导出一次，是为了不打断已经从 registry 取它的 16 个模块。
export { DEFAULT_VISUALIZER_MODE };

export const hasVisualizerMode = (mode: string | null | undefined): mode is VisualizerMode =>
    Boolean(mode && VISUALIZER_REGISTRY_BY_MODE[mode as VisualizerMode]);

export const getVisualizerRegistryEntry = (mode: VisualizerMode) =>
    VISUALIZER_REGISTRY_BY_MODE[mode] ?? VISUALIZER_REGISTRY_BY_MODE[DEFAULT_VISUALIZER_MODE]!;

export const getVisualizerModeLabel = (mode: VisualizerMode, t: (key: string) => string) => {
    const entry = getVisualizerRegistryEntry(mode);
    const translated = t(entry.labelKey);
    return !translated || translated === entry.labelKey ? entry.labelFallback : translated;
};

// 让 store 等叶子层不必 import 本文件也能拿到模式名称（见 utils/visualizerModeLabel.ts）。
registerVisualizerModeLabelResolver(getVisualizerModeLabel);

export const getVisualizerPreviewStartOffset = (mode: VisualizerMode, loopDuration: number) => {
    if (loopDuration <= 0) {
        return 0;
    }

    return getVisualizerRegistryEntry(mode).previewStartOffset % loopDuration;
};

export const getVisualizerScopedSeed = (mode: VisualizerMode, scope: string) =>
    `${scope}-${getVisualizerRegistryEntry(mode).previewSeed}`;

/*
 * Runtime contribution channel for mod visualizers (src/mods/folium/registries/visualizers).
 * Appends entries to the live registry so every consumer that iterates
 * VISUALIZER_REGISTRY or queries by mode picks them up without a rebuild.
 * Mode ids are prefixed (`mod:<modId>:<id>`) by the loader so a mod can never
 * shadow a builtin mode; duplicates are rejected. The ordered list is kept
 * sorted so pickers show mod modes by the order they declare.
 */
export const appendVisualizerEntry = (entry: VisualizerRegistryEntry): boolean => {
    if (VISUALIZER_REGISTRY_BY_MODE[entry.mode]) {
        return false;
    }
    VISUALIZER_REGISTRY_BY_MODE[entry.mode] = entry;
    VISUALIZER_REGISTRY.push(entry);
    VISUALIZER_REGISTRY.sort((left, right) => left.order - right.order);
    return true;
};

/*
 * Removes a runtime-contributed mode (appended via appendVisualizerEntry).
 * Used when a mod is disabled/uninstalled or reloaded without the contribution:
 * the mode must disappear from both the ordered list and the by-mode lookup so
 * consumers no longer see it. Builtin modes have no removal path (and never
 * need one) because they only ever live in the initial registry.
 */
export const removeVisualizerEntry = (mode: VisualizerMode): boolean => {
    if (!VISUALIZER_REGISTRY_BY_MODE[mode]) {
        return false;
    }
    delete VISUALIZER_REGISTRY_BY_MODE[mode];
    const index = VISUALIZER_REGISTRY.findIndex((entry) => entry.mode === mode);
    if (index >= 0) {
        VISUALIZER_REGISTRY.splice(index, 1);
    }
    return true;
};
