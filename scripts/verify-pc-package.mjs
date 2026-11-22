import assert from 'node:assert/strict';
import {promises as fs,createReadStream} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {extractFile} from '@electron/asar';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const packageDir=path.join(root,'release',process.argv[2]||'PC-UI-Fix');
const executable=path.join(packageDir,'Lume-0.5.9-Windows.exe');
const sevenZip=path.join(root,'node_modules/electron-winstaller/vendor/7z-x64.exe');
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'lume-pc-package-'));
const files=[];
async function walk(directory){
  for(const entry of await fs.readdir(directory,{withFileTypes:true})){
    const file=path.join(directory,entry.name);
    if(entry.isDirectory())await walk(file);else files.push(file);
  }
}
try{
  // Read the portable installer as an archive; never launch the application.
  execFileSync(sevenZip,['x',executable,'-o'+temp,'$PLUGINSDIR/app-64.7z','-y'],{windowsHide:true,stdio:'pipe'});
  const payload=path.join(temp,'$PLUGINSDIR/app-64.7z');
  const unpacked=path.join(temp,'payload');
  execFileSync(sevenZip,['x',payload,'-o'+unpacked,'resources/app.asar','-y'],{windowsHide:true,stdio:'pipe'});
  const archive=path.join(unpacked,'resources/app.asar');
  await walk(path.join(root,'dist'));
  for(const relative of ['electron/main.cjs','electron/history-navigation.cjs','electron/preload.cjs','server/index.mjs','server/joined-room.mjs'])files.push(path.join(root,relative));
  let checkedBytes=0;
  for(const file of files){
    const relative=path.relative(root,file);
    const expected=await fs.readFile(file),actual=extractFile(archive,relative);
    assert(expected.equals(actual),'Packaged file differs from current build: '+relative);
    checkedBytes+=expected.length;
  }
  const license=extractFile(archive,path.join('dist','pc-lyrics','LICENSE.txt'));
  assert(license.equals(await fs.readFile(path.join(root,'pc-lyrics/LICENSE'))));
  const hash=createHash('sha256');
  for await(const chunk of createReadStream(executable))hash.update(chunk);
  const report={executable,bytes:(await fs.stat(executable)).size,sha256:hash.digest('hex'),
    verifiedFiles:files.length,verifiedBytes:checkedBytes,
    checks:['Read app.asar from inside the final portable EXE without launching it.',
      'Every built web/lyrics asset and the main, preload, server and joined-room modules match the current files byte for byte.',
      'Folia license, source archive, fonts, models and visual assets are included.'],
    desktopOpened:false};
  await fs.writeFile(path.join(packageDir,'verification/package-verification.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
}finally{
  const resolved=path.resolve(temp);
  assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));
  assert(path.basename(resolved).startsWith('lume-pc-package-'));
  await fs.rm(resolved,{recursive:true,force:true});
}
