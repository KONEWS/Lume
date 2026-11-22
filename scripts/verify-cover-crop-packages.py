"""Verify isolated APK/HAP builds carry the same tested shared player."""
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile

root = Path(__file__).resolve().parents[1]
output = root / 'artifacts/round-cover-crop-20261121'
source = output / 'build/mobile/player-assets/player'
reports, players = [], []
for platform, suffix in [('Android', 'apk'), ('HarmonyOS', 'hap')]:
    package = output / f'Lume-{platform}-round-cover-crop.{suffix}'
    with ZipFile(package) as archive:
        assert archive.testzip() is None
        entry = next(n for n in archive.namelist() if n.endswith('/player/cover-style.js'))
        prefix = entry.removesuffix('cover-style.js')
        player = {n.removeprefix(prefix): archive.read(n) for n in archive.namelist()
                  if n.startswith(prefix) and not n.endswith('/')}
        for name, data in player.items():
            if name not in ('folia/stage.js', 'folia/source.zip'):
                assert data == (source / name).read_bytes(), f'{platform}: stale {name}'
            target = output / 'unpacked' / platform / 'player' / name
            assert target.resolve().is_relative_to((output / 'unpacked').resolve())
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        assert b'clip-path: circle' in player['cover-style.css']
        assert b'measureFrame(image)' in player['cover-style.js']
        assert b'cover-style.css' in player['index.html'] and b'cover-style.js' in player['index.html']
        assert any(n.endswith('/liblume.so') for n in archive.namelist())
        players.append(player)
        reports.append({'platform': platform, 'package': str(package), 'bytes': package.stat().st_size,
                        'sha256': hashlib.sha256(package.read_bytes()).hexdigest(),
                        'playerFiles': len(player), 'nativeLibraryPresent': True,
                        'changedFiles': {name: hashlib.sha256(player[name]).hexdigest()
                                         for name in ['cover-style.css', 'cover-style.js']},
                        'deviceTested': False})
assert players[0] == players[1], 'Both platforms must ship the same player'
for name in ['cover-style.css', 'cover-style.js']:
    assert (source / name).read_bytes() == (root / 'mobile/player-assets/player' / name).read_bytes()
(output / 'package-results.json').write_text(json.dumps({
    'packages': reports, 'identicalSharedPlayer': True, 'sourceSnapshot': str(source)}, indent=2), encoding='utf-8')
print('PASS APK and HAP:', len(players[0]), 'identical shared player files, updated CSS and JS verified')
