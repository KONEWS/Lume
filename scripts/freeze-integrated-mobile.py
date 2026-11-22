"""Freeze the final shared workspace only after the coordinating tasks are ready."""
from pathlib import Path
import hashlib
import json
import shutil

root = Path(__file__).resolve().parents[1]
output = root / 'artifacts/integrated-mobile-20261121'
destination = output / 'snapshot/mobile'
assert not destination.exists(), 'A frozen snapshot already exists; inspect it before replacing it'
excluded = {'build', '.hvigor', '.cxx', '.idea', 'oh_modules', 'verification-edge'}

def ignore(directory, names):
    omitted = [name for name in names if name in excluded or name.endswith('.log')]
    if Path(directory).name == 'rawfile':
        omitted += ['player']
    return omitted

def files(directory):
    for current, dirs, names in __import__('os').walk(directory):
        dirs[:] = [name for name in dirs if name not in ignore(current, dirs)]
        for name in names:
            if name not in ignore(current, names):
                yield Path(current) / name

selected = []
for folder in ['android', 'harmony', 'native', 'player-assets']:
    selected.extend(files(root / 'mobile' / folder))
selected.extend(root / 'mobile' / name for name in ['optimize-player-assets.py', 'packaging-requirements.txt'])
before = {str(p.relative_to(root / 'mobile')).replace('\\', '/'): hashlib.sha256(p.read_bytes()).hexdigest() for p in selected}
for name in before:
    target = destination / name
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(root / 'mobile' / name, target)
# aapt2 requires the (currently empty) native assets directory as an input.
(destination / 'android/app/src/main/assets').mkdir(parents=True, exist_ok=True)
for name, digest in before.items():
    assert hashlib.sha256((destination / name).read_bytes()).hexdigest() == digest, f'Copy changed: {name}'
    assert hashlib.sha256((root / 'mobile' / name).read_bytes()).hexdigest() == digest, f'Source changed during freeze: {name}'
(output / 'source-manifest.json').write_text(json.dumps(before, indent=2), encoding='utf-8')
(root / 'release/Integrated-20261121').mkdir(parents=True, exist_ok=True)
print('Frozen', len(before), 'source and build-input files without concurrent changes')
