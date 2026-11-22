import { build } from 'esbuild';
await build({
  entryPoints: ['src/appearance/liquid-glass.js'],
  outfile: 'mobile/player-assets/player/liquid-glass.js',
  format: 'iife', target: 'es2020', bundle: true,
  banner: { js: '/* Lens is MIT licensed. See lens/LICENSE. Built by scripts/build-mobile-glass.mjs. */' }
});
