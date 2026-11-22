import { hapTasks } from '@ohos/hvigor-ohos-plugin';
import { cpSync, rmSync } from 'fs';
import { resolve } from 'path';
import { execFileSync } from 'child_process';

// This directory is generated exclusively from the shared mobile player.
// Start fresh so obsolete resources from earlier builds cannot remain in the HAP.
const stagedPlayer = resolve(__dirname, 'src/main/resources/rawfile/player');
rmSync(stagedPlayer, { recursive: true, force: true });
cpSync(resolve(__dirname, '../../player-assets/player'), stagedPlayer, { recursive: true });
// Run after the final asset copy, including builds launched from DevEco Studio.
execFileSync('python', [resolve(__dirname, '../../optimize-player-assets.py'),
  stagedPlayer, '--report',
  resolve(__dirname, '../asset-optimization.json')], { stdio: 'inherit', windowsHide: true });

export default { system: hapTasks, plugins: [] };
