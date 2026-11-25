from hashlib import sha256
from pathlib import Path
from zipfile import ZipFile
from argparse import ArgumentParser
parser = ArgumentParser()
parser.add_argument('--prefix',default='Lume-LAN-Merged')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
assets = root / 'mobile/player-assets/player'
for name, prefix, code in [(args.prefix+'-Android.apk', 'assets/player/', 'classes.dex'),
                            (args.prefix+'-Harmony.hap', 'resources/rawfile/player/', 'ets/modules.abc')]:
    archive = root / 'release' / name
    with ZipFile(archive) as package:
        assert package.testzip() is None
        for file in ['personal-devices.js', 'personal-devices.css', 'statistics.js', 'statistics-data.js',
                     'quality-labels.js', 'library-report.js','sidebar.js','song-actions.js','scan-meter.js','scan-meter.css','song-details.js','index.html']:
            assert package.read(prefix+file)==(assets/file).read_bytes(), (name,file)
        if args.prefix=='Lume-LAN-Merged':
            for file in ['player.js','outputs.js','library-covers.js','mobile-text.js','mobile-text.css','vendor/LICENSE-utf8proc.txt']:
                assert package.read(prefix+file)==(assets/file).read_bytes(),(name,file)
        html=package.read(prefix+'index.html')
        assert b'<lume-personal-devices>' in html and b'personal-devices.js' in html
        lib, = [n for n in package.namelist() if n.endswith('/liblume.so')]
        native=package.read(lib)
        assert native.startswith(b'\x7fELF')
        for marker in [b'/personal/v1',b'personal-devices.json',b'personal-history.json',b'currentSession',b'playModeSource',b'received.json',b'approvePair',b'chunk2',b'originDeviceId',b'includeBusy','歌曲超过单首上限 500 MiB'.encode()]:
            assert marker in native,(name,marker)
        bridge=package.read(code)
        for marker in [b'lumePersonalReply',b'historyRecords',b'imported',b'currentSession']:
            assert marker in bridge,(name,marker)
        if args.prefix=='Lume-LAN-Merged':
            for marker in [b'utf8proc',b'originNameVersion',b'checkName',b'coverRevision',b'coverRequests',b'inviteProof',b'delayMs']:
                assert marker in native,(name,marker)
            for marker in [b'deviceIdentity',b'originDeviceName',b'coverRevision',b'searchPhones',b'offerFile',b'savedDelayMs']:
                assert marker in bridge,(name,marker)
    print(name,archive.stat().st_size,'bytes',sha256(archive.read_bytes()).hexdigest())

