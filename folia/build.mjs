import {build} from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import {readFile, writeFile, mkdir, copyFile, readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {zipSync} from 'fflate';

const root = fileURLToPath(new URL('.', import.meta.url));
const out = path.resolve(root, '../public/folia');
await mkdir(out, {recursive:true});
const worker = await build({absWorkingDir:root,entryPoints:['src/components/visualizer/monet/monetBackground.worker.ts'],
  bundle:true,write:false,minify:true,target:'es2022'});
const result = await build({
  absWorkingDir:root, entryPoints:['stage.tsx'], outfile:path.join(out,'stage.js'),
  bundle:true, write:false, minify:true, metafile:true, jsx:'automatic', target:'es2022', legalComments:'eof',
  loader:{'.png':'dataurl','.jpg':'dataurl','.svg':'dataurl','.webp':'dataurl','.gif':'dataurl'},
  define:{MONET_PAINTER_CODE:JSON.stringify(worker.outputFiles[0].text),'process.env.NODE_ENV':'"production"', 'import.meta.env.DEV':'false','import.meta.env.BASE_URL':'"./"'}
});
const css = await postcss([tailwind({base:root,optimize:true})]).process(await readFile(path.join(root,'stage.css'),'utf8'),{from:path.join(root,'stage.css')});
const componentCss = result.outputFiles.find(file=>file.path.endsWith('.css'))?.text || '';
await writeFile(path.join(out,'stage.js'),result.outputFiles.find(file=>file.path.endsWith('.js')).contents);
await copyFile(path.join(root,'host.js'),path.join(out,'host.js'));
await writeFile(path.join(out,'stage.css'),css.css + componentCss);
await copyFile(path.join(root,'LICENSE'),path.join(out,'LICENSE.txt'));
// Bundle the editable renderer fork and its licenses alongside the compiled styles.
const sources = {};
async function include(name) {
  sources[name] = new Uint8Array(await readFile(path.join(root,name)));
}
for (const name of ['stage.tsx','StyleStudio.tsx','stage.css','mobile-stage.css','host.js','build.mjs','package.json','package-lock.json','README.md','LICENSE']) await include(name);
async function includeTree(dir) {
  for (const entry of await readdir(path.join(root,dir),{withFileTypes:true})) {
    const name = dir + '/' + entry.name;
    if (entry.isDirectory()) await includeTree(name);
    else await include(name);
  }
}
await includeTree('src');
const packages = new Set(Object.keys(result.metafile.inputs).map(file=>file.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/)?.[1]).filter(Boolean));
for (const pkg of packages) {
  const dir = 'node_modules/'+pkg;
  for (const name of await readdir(path.join(root,dir))) {
    if (/^(license|licence|copying|notice)(\.|$)/i.test(name)) {
      const filename = dir+'/'+name;
      sources['licenses/'+pkg+'/'+name] = new Uint8Array(await readFile(path.join(root,filename)));
    }
  }
}
await writeFile(path.join(out,'source.zip'),zipSync(sources));
const mobile = path.resolve(root,'../mobile/player-assets/player/folia');
await mkdir(mobile,{recursive:true});
for(const name of ['stage.js','host.js','LICENSE.txt','source.zip']) await copyFile(path.join(out,name),path.join(mobile,name));
const mobileCss = await readFile(path.join(root,'mobile-stage.css'),'utf8');
await writeFile(path.join(mobile,'stage.css'),css.css + componentCss + '\n' + mobileCss);
if(process.env.FOLIA_INPUTS) await writeFile(process.env.FOLIA_INPUTS,JSON.stringify(Object.keys(result.metafile.inputs)));
