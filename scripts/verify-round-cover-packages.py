"""Verify both independently built packages contain the tested shared player."""
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile

root = Path(__file__).resolve().parents[1]
output = root / 'artifacts/round-cover'
source = output / 'build/mobile/player-assets/player'
files = ['index.html', 'sidebar.js', 'player.js', 'player-motion.js',
         'cover-style.js', 'cover-style.css']
packages = [root / 'release/Lume-Android-round-cover-debug.apk',
            root / 'release/Lume-HarmonyOS-round-cover-signed.hap']
report = []
players = []
for platform, package in zip(['Android', 'HarmonyOS'], packages):
    with ZipFile(package) as archive:
        assert archive.testzip() is None
        asset = next(n for n in archive.namelist() if n.endswith('/player/cover-style.js'))
        prefix = asset.removesuffix('cover-style.js')
        player = {n.removeprefix(prefix): archive.read(n) for n in archive.namelist()
                  if n.startswith(prefix) and not n.endswith('/')}
        players.append(player)
        for file in files:
            assert player[file] == (source / file).read_bytes(), f'{platform}: stale {file}'
        assert b'cover-style.css' in player['index.html'] and b'cover-style.js' in player['index.html']
        assert b'window.lumeCover.setting()' in player['sidebar.js']
        assert b'window.lumeCover.transition(cover, animate)' in player['player-motion.js']
        assert b"$('album').dataset.playing=String(state.playing)" in player['player.js']
        assert any(n.endswith('/liblume.so') for n in archive.namelist())
        destination = output / 'unpacked' / platform / 'player'
        for name, data in player.items():
            target = destination / name
            assert target.resolve().is_relative_to(destination.resolve())
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        report.append({'platform': platform, 'package': str(package), 'bytes': package.stat().st_size,
                       'sha256': hashlib.sha256(package.read_bytes()).hexdigest(),
                       'playerFiles': len(player), 'verifiedFiles': {
                           name: hashlib.sha256(player[name]).hexdigest() for name in files},
                       'nativeLibraryPresent': True, 'deviceTested': False})
assert players[0] == players[1], 'Android and HarmonyOS must ship identical shared player files'
(output / 'package-results.json').write_text(json.dumps({
    'packages': report, 'identicalSharedPlayer': True,
    'sourceSnapshot': str(source)}, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'verified': [p['platform'] for p in report],
                  'sharedFiles': len(players[0]), 'identicalSharedPlayer': True}))
