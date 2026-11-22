import { build } from 'vite';
import { zipSync } from 'fflate';
import { readFile, writeFile, readdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
await build({ configFile: path.join(root, 'vite.desktop.config.ts') });
const out = path.resolve(root, '../public/pc-lyrics');
const sources = {};
async function include(relative) {
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const name = relative ? relative + '/' + entry.name : entry.name;
    if (entry.isDirectory()) await include(name);
    else sources[name] = new Uint8Array(await readFile(path.join(root, name)));
  }
}
for (const directory of ['src', 'dev', 'tools', 'build', 'shared', 'assets', 'public']) await include(directory);
for (const name of ['LICENSE','ATTRIBUTION.md','package.json','package-lock.json','tsconfig.json','tsconfig.desktop.json','postcss.config.js','vite.desktop.config.ts','desktop.html','build.mjs']) {
  sources[name] = new Uint8Array(await readFile(path.join(root, name)));
}
await writeFile(path.join(out, 'source.zip'), zipSync(sources));
await copyFile(path.join(root,'LICENSE'),path.join(out,'LICENSE.txt'));
await copyFile(path.join(root,'ATTRIBUTION.md'),path.join(out,'ATTRIBUTION.md'));
console.log('LUME PC lyrics built to '+out);
