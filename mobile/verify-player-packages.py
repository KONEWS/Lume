"""Compare control/optimized APK and HAP from the same source snapshot."""
import argparse
import base64
import hashlib
import io
import json
from pathlib import Path
import re
import zipfile
from PIL import Image


def digest(data):
    return hashlib.sha256(data).hexdigest()


def verify(before, after, prefix):
    with zipfile.ZipFile(before) as old, zipfile.ZipFile(after) as new:
        assert old.testzip() is None and new.testzip() is None
        names = {n for n in old.namelist() if n.startswith(prefix) and not n.endswith('/')}
        new_names = {n for n in new.namelist() if n.startswith(prefix) and not n.endswith('/')}
        removed = names - new_names
        assert not new_names - names
        assert removed <= {prefix + 'folia/styles.json'}, removed
        for name in names:
            if name.endswith(('.js', '.css', '.html')):
                assert not removed or b'styles.json' not in old.read(name)
        changed = []
        for name in sorted(new_names):
            if old.read(name) != new.read(name):
                changed.append(name.removeprefix(prefix))
        assert changed == ['folia/source.zip', 'folia/stage.js'], changed
        a, b = (z.read(prefix + 'folia/stage.js') for z in (old, new))
        pattern = rb'data:image/[\w.+-]+;base64,[A-Za-z0-9+/=]+'
        # Everything outside image literals must remain byte-for-byte identical.
        assert re.sub(pattern, b'IMAGE', a) == re.sub(pattern, b'IMAGE', b)
        pairs = list(zip(re.findall(pattern, a), re.findall(pattern, b)))
        assert len(re.findall(pattern, a)) == len(re.findall(pattern, b))
        changed_images = 0
        for x, y in pairs:
            if x == y:
                continue
            changed_images += 1
            with Image.open(io.BytesIO(base64.b64decode(x.split(b',')[1]))) as im1, Image.open(io.BytesIO(base64.b64decode(y.split(b',')[1]))) as im2:
                assert im1.size == im2.size
                assert im1.convert('RGBA').tobytes() == im2.convert('RGBA').tobytes()
        with zipfile.ZipFile(io.BytesIO(old.read(prefix + 'folia/source.zip'))) as source1, zipfile.ZipFile(io.BytesIO(new.read(prefix + 'folia/source.zip'))) as source2:
            assert source2.testzip() is None
            for name in source1.namelist():
                assert source1.read(name) == source2.read(name), name
            source_count = len(source1.namelist())
        native = [n for n in old.namelist() if n.endswith('.so')]
        for name in native:
            assert old.read(name) == new.read(name), name
        return {'before': str(before.resolve()), 'after': str(after.resolve()),
                'beforePackageBytes': before.stat().st_size, 'afterPackageBytes': after.stat().st_size,
                'packageBytesSaved': before.stat().st_size - after.stat().st_size,
                'beforeEntryBytes': sum(i.file_size for i in old.infolist()),
                'afterEntryBytes': sum(i.file_size for i in new.infolist()),
                'afterSha256': digest(after.read_bytes()), 'changedPlayerFiles': changed,
                'obsoleteUnreferencedFilesRemoved': [n.removeprefix(prefix) for n in sorted(removed)],
                'imageDataUrls': len(pairs), 'losslesslyConvertedImages': changed_images,
                'sourceMembersByteIdentical': source_count, 'nativeLibrariesByteIdentical': native,
                'stageLogicByteIdenticalOutsideImageLiterals': True,
                'playerAssets': {n.removeprefix(prefix): digest(new.read(n)) for n in sorted(new_names)}}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('baseline', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--report', required=True, type=Path)
    args = parser.parse_args()
    reports = {}
    for label, ext, prefix in [('Android', 'apk', 'assets/player/'), ('HarmonyOS', 'hap', 'resources/rawfile/player/')]:
        reports[label] = verify(args.baseline / ('Control.' + ext), args.output / ('Lume-' + label + '.' + ext), prefix)
    assert reports['Android']['playerAssets'] == reports['HarmonyOS']['playerAssets']
    reports['bothPlatformsHaveIdenticalPlayerAssets'] = True
    reports['installedFootprint'] = 'Not inferred from archive sizes. Measure on the same device with preserved data.'
    args.report.write_text(json.dumps(reports, indent=2), encoding='utf8')
    print(json.dumps({k: {key: value for key, value in v.items() if key != 'playerAssets'} if isinstance(v, dict) else v for k, v in reports.items()}, indent=2))
