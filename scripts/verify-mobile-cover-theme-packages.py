"""Confirm both signed mobile packages contain the exact shared theme files."""
import hashlib
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parent.parent
source = root / 'mobile/player-assets/player'
release = root / 'release/CoverTheme-20261122'
files = ('cover-theme.js', 'sidebar.js', 'player.js',
         'listen-space.css', 'listening-surface.css',
         'borderless-spaces.css', 'cover-theme-motion.css')
packages = {
    'Android': (release / 'Lume-Android.apk', 'assets/player/'),
    'HarmonyOS': (release / 'Lume-HarmonyOS.hap', 'resources/rawfile/player/'),
}
player_html = None
for platform, (package, prefix) in packages.items():
    with zipfile.ZipFile(package) as archive:
        assert archive.testzip() is None
        for name in files:
            actual = archive.read(prefix + name)
            expected = (source / name).read_bytes()
            assert actual == expected, (platform, name)
        html = archive.read(prefix + 'index.html')
        assert b'cover-theme.js' in html
        assert b'borderless-spaces.css' in html
        if player_html is None:
            player_html = html
        else:
            assert html == player_html, 'The platforms packaged different player entry pages'
        assert '主题色随歌曲封面变化'.encode() in archive.read(prefix + 'sidebar.js')
    print(f'{platform}: {package.resolve()} SHA256 {hashlib.sha256(package.read_bytes()).hexdigest()}')
print('Both packages contain identical current theme assets.')
