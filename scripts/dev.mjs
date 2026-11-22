import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tasks = [spawn(process.execPath, ['server/index.mjs'], { cwd: root, stdio: 'inherit' }), spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1'], { cwd: root, stdio: 'inherit' })];
let closing = false;
function stop() { if (closing) return; closing = true; tasks.forEach(task => task.kill()); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
tasks.forEach(task => task.on('exit', code => { stop(); process.exitCode = code || 0; }));
