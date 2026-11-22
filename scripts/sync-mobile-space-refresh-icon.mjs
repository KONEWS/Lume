// Bake the installed Lucide component into the shared WebView HTML for offline use.
// Do not edit its SVG paths by hand. Run this script after upgrading lucide-react.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RefreshCw } from 'lucide-react';

const root = fileURLToPath(new URL('../', import.meta.url));
const htmlPath = resolve(root, 'mobile/player-assets/player/index.html');
const licensePath = resolve(root, 'mobile/player-assets/player/vendor/lucide/LICENSE');
const require = createRequire(import.meta.url);
const packageRoot = dirname(require.resolve('lucide-react/package.json'));
const license = readFileSync(resolve(packageRoot, 'LICENSE'), 'utf8');
const svg = renderToStaticMarkup(createElement(RefreshCw, {
  size: 22, strokeWidth: 2, 'aria-hidden': 'true', focusable: 'false',
}));
const html = readFileSync(htmlPath, 'utf8');
const button = /(<button\b[^>]*\bid="refresh-spaces"[^>]*>)[\s\S]*?(<\/button>)/g;
if ([...html.matchAll(button)].length !== 1) throw new Error('Expected one space refresh button');
const updated = html.replace(button, (_, open, close) => open + svg + close);
if (process.argv.includes('--check')) {
  if (html !== updated || readFileSync(licensePath, 'utf8') !== license) {
    throw new Error('Space refresh icon or license differs from installed Lucide');
  }
  console.log('Space refresh SVG and license match the installed Lucide package.');
} else {
  writeFileSync(htmlPath, updated);
  mkdirSync(dirname(licensePath), { recursive: true });
  writeFileSync(licensePath, license);
}
