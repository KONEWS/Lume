// Execute the production Android scanner methods on the JVM with a deterministic
// document-provider/permission fixture. Full Android compilation is a separate check.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
const root='mobile/android/app/src/main/java/local/lume/receiver/';
const source=await readFile(root+'LibraryPlayer.java','utf8');
function between(a,b){const start=source.indexOf(a),end=source.indexOf(b,start);assert(start>=0&&end>start);return source.slice(start,end);}
const methods=[between('    static class Song {','    private final ExecutorService'),
  between('    static String folderKey(','    volatile int scanDone'),
  between('    private static String extension(','    private long documentSize'),
  between('    private void persistSongs()','    private void refreshLegacyMetadata'),
  between('    private void scanOptions(','    void close()')].join('\n').replaceAll('android.content.UriPermission','UriPermission');
const template=await readFile('tests/fixtures/AndroidScanHarness.java','utf8');
const dir=await mkdtemp(path.join(os.tmpdir(),'lume-android-scan-'));
await writeFile(path.join(dir,'AndroidScanHarness.java'),template.replace('// PRODUCTION_SCANNER_METHODS',methods));
execFileSync('javac',['-encoding','UTF-8','-d',dir,root+'ScanFilter.java',path.join(dir,'AndroidScanHarness.java')],{windowsHide:true,stdio:'pipe'});
process.stdout.write(execFileSync('java',['-cp',dir,'local.lume.receiver.AndroidScanHarness'],{windowsHide:true,encoding:'utf8'}));
