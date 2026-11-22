from pathlib import Path
from zipfile import ZipFile
import hashlib,json
root=Path(__file__).resolve().parents[1];out=root/'artifacts/phone-invites-20261121-final';assets=out/'snapshot/mobile/player-assets/player';report={}
for p in (root/'release/Phone-Invites-20261121').glob('*'):
 if p.suffix not in ['.apk','.hap']:continue
 with ZipFile(p) as z:
  index=next(n for n in z.namelist() if n.endswith('/player/index.html'));prefix=index[:-len('index.html')]
  names=[f.relative_to(assets).as_posix() for f in assets.rglob('*') if f.is_file() and f.relative_to(assets).as_posix() not in ['folia/stage.js','folia/source.zip']]
  for n in names:assert z.read(prefix+n)==(assets/n).read_bytes(),n
  libs=[n for n in z.namelist() if n.endswith('/liblume.so')]
  for n in libs:
   for marker in [b'join/invite',b'inviteToken',b'nearbyPhones',b'searchPhones',b'invitePhone']:assert marker in z.read(n),(n,marker)
  bridge='classes.dex' if p.suffix=='.apk' else next(n for n in z.namelist() if n.endswith('/modules.abc'))
  for marker in [b'inviteToken',b'deviceId',b'/api/join/invite',b'nearbyPhones']:assert marker in z.read(bridge),(bridge,marker)
  report[p.name]={'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size,'sharedAssetsMatch':names,'nativeLibraries':libs,'nativeAndBridgeMarkers':True}
(out/'package-verification.json').write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report,indent=2))
