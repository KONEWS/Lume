"""Publish a freshly built helper without replacing an executable in use."""
from hashlib import sha256
from pathlib import Path
import shutil
import sys
import tempfile

source = Path(sys.argv[1])
root = Path(__file__).resolve().parents[1]
dest = root / 'resources/personal-device'
dest.mkdir(parents=True, exist_ok=True)
shutil.copyfile(root / 'mobile/native/vendor/utf8proc/LICENSE.md', dest / 'LICENSE-utf8proc.txt')
name = 'host-' + sha256(source.read_bytes()).hexdigest()[:16] + '.exe'
if not (dest / name).exists():
    shutil.copyfile(source, dest / name)
with tempfile.NamedTemporaryFile(dir=dest, delete=False) as manifest:
    manifest.write(name.encode('ascii'))
Path(manifest.name).replace(dest / 'current.txt')

