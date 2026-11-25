"""Losslessly optimize a STAGED mobile player; never edits the shared UI sources.

Requires Python 3 and Pillow (see packaging-requirements.txt).
All original Folia source/archive members are retained byte-for-byte.
"""
import argparse
import base64
import hashlib
import io
import json
from pathlib import Path
import re
import struct
import zipfile

from PIL import Image, __version__ as pillow_version


def sha(data):
    return hashlib.sha256(data).hexdigest()


def bundle_home_styles(player):
    # Combine the top-level player styles in their HTML cascade order. The
    # bundle stays in the same directory, so relative URLs keep their bases.
    index = player / 'index.html'
    html = index.read_text(encoding='utf8')
    link = re.compile(r'<link rel="stylesheet" href="([\w-]+\.css)">')
    names = link.findall(html)
    if len(names) < 2:
        return
    sheets = [(player / name).read_bytes() for name in names]
    if any(re.search(rb'^\s*@(import|charset|namespace)\b', sheet, re.M | re.I) for sheet in sheets):
        return
    bundle = 'home-bundle.css'
    (player / bundle).write_bytes(b'\n'.join(sheets))
    first = link.search(html)
    index.write_text(html[:first.start()] + f'<link rel="stylesheet" href="{bundle}">' +
                     link.sub('', html[first.end():]), encoding='utf8')
    for name in set(names):
        (player / name).unlink()


def optimize(player, report_path=None):
    stage = player / 'folia/stage.js'
    source = player / 'folia/source.zip'
    original = stage.read_bytes()
    records = []

    def replace(match):
        old = base64.b64decode(match[0].split(b',', 1)[1], validate=True)
        chunks = {}
        offset = 8
        while offset < len(old):
            size = struct.unpack('>I', old[offset:offset + 4])[0]
            kind = old[offset + 4:offset + 8]
            chunks[kind] = old[offset + 8:offset + 8 + size]
            offset += size + 12
        # Leave animation, orientation and non-sRGB color interpretation untouched.
        if any(k in chunks for k in (b'acTL', b'iCCP', b'cHRM', b'eXIf')):
            return match[0]
        if b'gAMA' in chunks and (b'sRGB' not in chunks or chunks[b'gAMA'] != struct.pack('>I', 45455)):
            return match[0]
        with Image.open(io.BytesIO(old)) as image:
            if image.mode not in ('RGB', 'RGBA', 'P', 'L', 'LA'):
                return match[0]
            output = io.BytesIO()
            image.save(output, 'WEBP', lossless=True, quality=100, method=4, exact=True)
            new = output.getvalue()
            if len(new) >= len(old):
                return match[0]
            with Image.open(io.BytesIO(new)) as decoded:
                if image.size != decoded.size or image.convert('RGBA').tobytes() != decoded.convert('RGBA').tobytes():
                    raise RuntimeError('Lossless pixel verification failed')
            records.append({'beforeSha256': sha(old), 'afterSha256': sha(new),
                            'beforeBytes': len(old), 'afterBytes': len(new),
                            'width': image.width, 'height': image.height,
                            'rgbaSha256': sha(image.convert('RGBA').tobytes())})
        return b'data:image/webp;base64,' + base64.b64encode(new)

    optimized = re.sub(rb'data:image/png;base64,[A-Za-z0-9+/=]+', replace, original)
    report = {'format': 1, 'pillow': pillow_version, 'beforeStageSha256': sha(original),
              'afterStageSha256': sha(optimized), 'beforeStageBytes': len(original),
              'afterStageBytes': len(optimized), 'convertedImages': records,
              'originalSourceMembersPreserved': True}
    # Standard ZIP/DEFLATE, retaining every original editable file and license.
    # Include this postprocessor so the mobile distribution can be reproduced.
    with zipfile.ZipFile(source) as archive:
        contents = {item.filename: archive.read(item) for item in archive.infolist()}
    originals = dict(contents)
    contents['lume-mobile-packaging/optimize-player-assets.py'] = Path(__file__).read_bytes()
    contents['lume-mobile-packaging/packaging-requirements.txt'] = b'Pillow==12.3.0\n'
    contents['lume-mobile-packaging/README.txt'] = (
        'The complete original Folia renderer source is retained unchanged.\n'
        'After its original build.mjs builds stage.js, run this postprocessor on\n'
        'a staged player directory containing folia/stage.js and folia/source.zip:\n'
        'python optimize-player-assets.py /path/to/staged/player\n'
        'Install requirements first: python -m pip install -r packaging-requirements.txt\n'
        'Only embedded static sRGB PNG data URLs are recoded as lossless WebP.\n'
        'Dimensions and all RGBA pixels (including transparent RGB) are verified.\n'
        'No layout, animation, playback, source images or user data is changed.\n'
    ).encode()
    contents['lume-mobile-packaging/optimization.json'] = json.dumps(report, indent=2).encode()
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, data in sorted(contents.items()):
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, data, compresslevel=9)
    with zipfile.ZipFile(io.BytesIO(output.getvalue())) as archive:
        for name, data in originals.items():
            # Packaging metadata may be replaced on a repeated invocation.
            if not name.startswith('lume-mobile-packaging/'):
                assert archive.read(name) == data, name
    report['beforeSourceZipBytes'] = source.stat().st_size
    report['afterSourceZipBytes'] = len(output.getvalue())
    stage.write_bytes(optimized)
    source.write_bytes(output.getvalue())
    if report_path:
        report_path.write_text(json.dumps(report, indent=2), encoding='utf8')
    print(json.dumps({k: v for k, v in report.items() if k != 'convertedImages'}, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('player', type=Path)
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    optimize(args.player.resolve(), args.report)
    bundle_home_styles(args.player.resolve())
