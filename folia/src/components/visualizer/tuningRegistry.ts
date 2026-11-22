import builtin0 from './cadenza/tuning';
import builtin1 from './cappella/tuning';
import builtin2 from './claddagh/tuning';
import builtin3 from './classic/tuning';
import builtin4 from './diorama/tuning';
import builtin5 from './fume/tuning';
import builtin6 from './hanabi/tuning';
import builtin7 from './lumiere/tuning';
import builtin8 from './machi/tuning';
import builtin9 from './metaphor/tuning';
import builtin10 from './monet/tuning';
import builtin11 from './nebbia/tuning';
import builtin12 from './partita/tuning';
import builtin13 from './pendolo/tuning';
import builtin14 from './sonnet/tuning';
import builtin15 from './tempera/tuning';
import builtin16 from './tilt/tuning';
import builtin17 from './backgrounds/latent/tuning';
import builtin18 from './backgrounds/monet/tuning';
import builtin19 from './backgrounds/nomand/tuning';
import builtin20 from './backgrounds/sora/tuning';
import type {
    CappellaTuning,
    CadenzaTuning,
    ClassicTuning,
    CladdaghTuning,
    DioramaTuning,
    FumeTuning,
    LumiereTuning,
    MonetTuning,
    PartitaTuning,
    PendoloTuning,
    SonnetTuning,
    TemperaTuning,
    TiltTuning,
    VisualizerMode,
} from '../../types';
import type { VisualizerSharedProps } from './definition';
import type { BackgroundSettingsSlice, BackgroundTuningDefinition, StoredTuning, StoredTuningAdapter, VisualizerTuningAdapter } from './tuningDefinition';

// src/components/visualizer/tuningRegistry.ts
// Pure-data registry for transporting heterogeneous visualizer tuning without importing renderers.

// The types of the 13 styles that existed before a tuning.ts stated its own. A new style adds no
// line here: its tuning.ts carries the type, and its entry takes the tuning with read().
export interface VisualizerTuningMap {
    classic: ClassicTuning;
    cadenza: CadenzaTuning;
    partita: PartitaTuning;
    fume: FumeTuning;
    claddagh: CladdaghTuning;
    cappella: CappellaTuning;
    tilt: TiltTuning;
    diorama: DioramaTuning;
    monet: MonetTuning;
    pendolo: PendoloTuning;
    sonnet: SonnetTuning;
    tempera: TemperaTuning;
    lumiere: LumiereTuning;
}

export type VisualizerTuningBundle = Partial<VisualizerTuningMap>;

interface VisualizerTuningModule {
    default: VisualizerTuningAdapter;
}

const tuningModules = {
  './cadenza/tuning.ts': {default:builtin0},
  './cappella/tuning.ts': {default:builtin1},
  './claddagh/tuning.ts': {default:builtin2},
  './classic/tuning.ts': {default:builtin3},
  './diorama/tuning.ts': {default:builtin4},
  './fume/tuning.ts': {default:builtin5},
  './hanabi/tuning.ts': {default:builtin6},
  './lumiere/tuning.ts': {default:builtin7},
  './machi/tuning.ts': {default:builtin8},
  './metaphor/tuning.ts': {default:builtin9},
  './monet/tuning.ts': {default:builtin10},
  './nebbia/tuning.ts': {default:builtin11},
  './partita/tuning.ts': {default:builtin12},
  './pendolo/tuning.ts': {default:builtin13},
  './sonnet/tuning.ts': {default:builtin14},
  './tempera/tuning.ts': {default:builtin15},
  './tilt/tuning.ts': {default:builtin16}
};
const adapters = Object.values(tuningModules).map(module => module.default);
const adaptersByMode = new Map<string, VisualizerTuningAdapter>();

adapters.forEach(adapter => {
    if (adaptersByMode.has(adapter.mode)) {
        throw new Error(`[VisualizerTuningRegistry] Duplicate adapter for "${adapter.mode}"`);
    }
    adaptersByMode.set(adapter.mode, adapter);
});

export const applyVisualizerTuning = (
    mode: VisualizerMode,
    props: VisualizerSharedProps,
    bundle?: VisualizerTuningBundle,
): VisualizerSharedProps => {
    const adapter = adaptersByMode.get(mode);
    const tuning = (bundle as Record<string, unknown> | undefined)?.[mode];
    // A style without `apply` reads its tuning from props.visualizerTunings, so the bundle goes onto the
    // props for every caller, also for one that hands it over only as the third argument (the mod export window).
    const withBundle = bundle && props.visualizerTunings !== bundle ? { ...props, visualizerTunings: bundle } : props;
    return adapter?.apply && tuning ? adapter.apply(withBundle, tuning) : withBundle;
};

export const getVisualizerTuningModes = (): string[] => [...adaptersByMode.keys()];

/** The tuning a lyric style declared; none for a style without settings of its own (a mod's style keeps its own elsewhere). */
export const getVisualizerTuning = (mode: string): VisualizerTuningAdapter | undefined => adaptersByMode.get(mode);

// The backgrounds' tunings are stored the same way, but ride no bundle: a background reads its own from the background config.
const backgroundTuningModules = {
  './backgrounds/latent/tuning.ts': {default:builtin17},
  './backgrounds/monet/tuning.ts': {default:builtin18},
  './backgrounds/nomand/tuning.ts': {default:builtin19},
  './backgrounds/sora/tuning.ts': {default:builtin20}
};
const backgroundTunings = Object.values(backgroundTuningModules).map(module => module.default);

/** The tunings the backgrounds declared, each under its background's id. */
export const getBackgroundTunings = (): readonly BackgroundTuningDefinition[] => backgroundTunings;

/**
 * The backgrounds' tunings as a background config carries them: under each background's id, as
 * `{ tuning }`. `settings` holds them under the store's field names (the settings store, or a
 * copy of its fields such as the OBS page receives).
 */
export const backgroundTuningConfig = (settings: Record<string, unknown>): Record<string, { tuning: unknown }> => Object.fromEntries(
    backgroundTunings.map(tuning => [tuning.mode, { tuning: settings[tuning.settingsKey] }]),
);

/** The actions that change and reset the backgrounds' tunings, as the background actions carry them: under each background's id. */
export const backgroundTuningActions = (settings: Record<string, unknown>): Record<string, { onTuningChange: unknown; onResetTuning: unknown }> => Object.fromEntries(
    backgroundTunings.map(tuning => [tuning.mode, {
        onTuningChange: settings[tuning.settingsSetterKey],
        onResetTuning: settings[tuning.settingsResetterKey],
    }]),
);

const backgroundSettingsModules = {

};

/** The backgrounds' stored settings that are no tuning object: each builds its own store fields. */
export const getBackgroundSettingsSlices = (): BackgroundSettingsSlice[] => (
    Object.values(backgroundSettingsModules).map(module => module.default)
);

/** The tunings that declare where they are stored, the styles' and the backgrounds': the settings store builds its fields and actions from these. */
export const getStoredVisualizerTunings = (): StoredTuning[] => [
    ...adapters.filter((adapter): adapter is StoredTuningAdapter => Boolean(adapter.storage && adapter.settingsResetterKey)),
    ...backgroundTunings,
];

export const collectVisualizerTunings = (settings: Record<string, unknown>): VisualizerTuningBundle => {
    const bundle: VisualizerTuningBundle = {};
    adapters.forEach(adapter => {
        const value = settings[adapter.settingsKey];
        if (value !== undefined) {
            (bundle as Record<string, unknown>)[adapter.mode] = value;
        }
    });
    return bundle;
};

export const applyVisualizerTuningsToSettings = (
    settings: Record<string, unknown>,
    bundle: VisualizerTuningBundle,
) => {
    adapters.forEach(adapter => {
        const value = (bundle as Record<string, unknown>)[adapter.mode];
        const setter = settings[adapter.settingsSetterKey];
        if (value !== undefined && typeof setter === 'function') {
            setter(value);
        }
    });
};
