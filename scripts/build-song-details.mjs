import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const local=path=>fileURLToPath(new URL(path,import.meta.url));
await build({entryPoints:[local('../mobile/song-details-entry.js')],bundle:true,platform:'browser',format:'iife',
  target:'es2022',minify:true,outfile:local('../mobile/player-assets/player/song-details.js')});
