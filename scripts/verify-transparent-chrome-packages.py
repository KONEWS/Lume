"""Verify both signed mobile packages contain the shared transparent chrome."""
import hashlib
from pathlib import Path
import sys
import zipfile

root = Path(__file__).resolve().parent.parent
source = root / 'mobile/player-assets/player'
preview = '--android-preview' in sys.argv
release = root / ('release/HeaderPreview-20261122' if preview else 'release/TransparentChrome-20261122')
packages = {'Android': (release / 'Lume-Android.apk', 'assets/player/')}
if not preview:
    packages['HarmonyOS'] = (release / 'Lume-HarmonyOS.hap', 'resources/rawfile/player/')
for platform, (package, prefix) in packages.items():
    with zipfile.ZipFile(package) as archive:
        assert archive.testzip() is None
        assert archive.read(prefix + 'transparent-chrome.css') == (source / 'transparent-chrome.css').read_bytes()
        assert archive.read(prefix + 'index.html') == (source / 'index.html').read_bytes()
        assert b'href="transparent-chrome.css"' in archive.read(prefix + 'index.html')
        if preview:
            assert b'href="transparent-dock.css"' not in archive.read(prefix + 'index.html')
    digest = hashlib.sha256(package.read_bytes()).hexdigest()
    print(f'{platform}: {package.resolve()} SHA256 {digest}')
