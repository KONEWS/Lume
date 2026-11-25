"""Confirm both signed mobile packages contain the exact curved dock assets."""
import hashlib
from pathlib import Path
import sys
import zipfile

root=Path(__file__).resolve().parent.parent
source=root/'mobile/player-assets/player'
release=Path(sys.argv[1]) if len(sys.argv)>1 else root/'release/ProgressCurve-20261122-Final'
files=('index.html','player.js','player-motion.js','curved-dock-progress.js','curved-dock-progress.css',
       'borderless-spaces.css','song-actions.js','song-actions.css','settings-sheet.js')
packages={
    'Android':(release/'Lume-Android.apk','assets/player/'),
    'HarmonyOS':(release/'Lume-HarmonyOS.hap','resources/rawfile/player/'),
}
for platform,(package,prefix) in packages.items():
    with zipfile.ZipFile(package) as archive:
        assert archive.testzip() is None
        for name in files:
            assert archive.read(prefix+name)==(source/name).read_bytes(),(platform,name)
        html=archive.read(prefix+'index.html')
        assert b'curved-dock-progress.js' in html and b'curved-dock-progress.css' in html
        assert b'transparent-dock.css' not in html
    print(f'{platform}: {package.resolve()} SHA256 {hashlib.sha256(package.read_bytes()).hexdigest()}')
