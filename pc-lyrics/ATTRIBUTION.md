# 澄音 PC 歌词页

This directory is an independent adaptation of Folia Desktop Lyrics 0.5.7
by chthollyphile, copied from the user's existing `G:/AI/folia-Lyrics` source.
The original project and all mobile assets are left unchanged.

Upstream: https://github.com/chthollyphile/folia-major
License: GNU Affero General Public License v3.0; see LICENSE.
Original copyright, bundled font notices and asset licenses remain in their
source files and generated assets.

Changes made for LUME on 2026-11-21: same-origin parent message bridge;
LUME window controls and transport; fullscreen-only idle controls; local
playback settings; a timeline-free text fallback; seekable spectrum progress.
The original visualizer, scenes, backgrounds, typography and settings UI are
retained. Source and this notice are distributed with the generated renderer.

Build: install Node.js and run `npm ci` followed by `npm run build` in this
directory. If the model files are absent, run `npm run models:fetch` first.
The lockfile records dependencies. The build writes only
`../public/pc-lyrics`; it does not write to either mobile platform.
