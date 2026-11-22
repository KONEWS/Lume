"""Check the shipped shared UI, including Folia and the search-only selection policy."""
import hashlib
import json
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parents[1]
source = root / 'mobile/player-assets/player'
output = root / 'release/text-interactions-20261121'
report_dir = root / 'mobile/verification/text-interactions'
changed = ['player.js', 'studio-phone.css', 'song-actions.css', 'mobile-text.js',
           'mobile-text.css', 'index.html']
optimized = {'folia/stage.js', 'folia/source.zip'}
digest = lambda data: hashlib.sha256(data).hexdigest()
reports, assets = {}, {}
for platform, extension, prefix in [('Android', 'apk', 'assets/player/'),
                                    ('HarmonyOS', 'hap', 'resources/rawfile/player/')]:
    package = output / f'Lume-{platform}-text-interactions.{extension}'
    with zipfile.ZipFile(package) as archive:
        assert archive.testzip() is None
        files = {name[len(prefix):]: archive.read(name) for name in archive.namelist()
                 if name.startswith(prefix) and not name.endswith('/')}
    for name in changed:
        assert files[name] == (source / name).read_bytes(), (platform, name)
    # Other tasks share this workspace and can keep editing after packaging.
    # Require this task's files to match, and report later unrelated edits separately.
    later_edits = [name for name, data in files.items() if name not in optimized
                   and data != (source / name).read_bytes()]
    assert b'mobile-text.js' in files['index.html']
    assert b'install(frame.contentDocument)' in files['mobile-text.js']
    assert b'input[type="search"]' in files['mobile-text.css']
    assert b'input[type="search"]' in files['mobile-text.js']
    assert b'-webkit-line-clamp: 2' in files['studio-phone.css']
    assert b"b.querySelector('strong').textContent=s.title" in files['player.js']
    assets[platform] = {name: digest(data) for name, data in files.items()}
    reports[platform] = {'path': str(package), 'bytes': package.stat().st_size,
                         'sha256': digest(package.read_bytes()),
                         'changedFilesMatchSource': {name: assets[platform][name] for name in changed},
                         'playerAssetCount': len(files),
                         'unrelatedSourceChangesAfterPackaging': later_edits}
assert assets['Android'] == assets['HarmonyOS'], 'Both packages must carry the same shared UI snapshot'
reports['allPlayerAssetsIdenticalAcrossPackages'] = True
reports['allTaskChangesMatchCurrentSource'] = True
(report_dir / 'packages.json').write_text(json.dumps(reports, indent=2), encoding='utf8')
print(json.dumps(reports, indent=2))
