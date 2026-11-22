from pathlib import Path
from zipfile import ZipFile
import hashlib,json
root=Path(__file__).resolve().parents[1];out=root/'artifacts/local-media-20261121';assets=out/'snapshot/mobile/player-assets/player';report={}
for p in (root/'release/Local-Media-20261121').glob('*'):
 if p.suffix not in ['.apk','.hap']:continue
 with ZipFile(p) as z:
  index=next(n for n in z.namelist() if n.endswith('/player/index.html'));prefix=index[:-len('index.html')]
  names=[f.relative_to(assets).as_posix() for f in assets.rglob('*') if f.is_file() and f.relative_to(assets).as_posix() not in ['folia/stage.js','folia/source.zip']]
  for n in names:assert z.read(prefix+n)==(assets/n).read_bytes(),n
  libs=[n for n in z.namelist() if n.endswith('/liblume.so')]
  for n in libs:
   for marker in [b'join/invite',b'inviteToken',b'audioIdentity',b'audioBytes',b'sha256:']:assert marker in z.read(n),(n,marker)
  bridge='classes.dex' if p.suffix=='.apk' else next(n for n in z.namelist() if n.endswith('/modules.abc'))
  for marker in [b'localSong',b'localTrackId',b'LocalAudio',b'audioIdentity',b'/api/join/invite']:assert marker in z.read(bridge),(bridge,marker)
  report[p.name]={'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size,'sharedAssetsMatch':names,'nativeLibraries':libs,'localAudioAndInvitationBridges':True}
m=json.loads((out/'source-manifest.json').read_text());changed=[n for n,h in m.items() if hashlib.sha256((root/'mobile'/n).read_bytes()).hexdigest()!=h];assert not changed,changed
(out/'package-verification.json').write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps({n:{'bytes':r['bytes'],'sha256':r['sha256'],'matchedAssets':len(r['sharedAssetsMatch'])} for n,r in report.items()},indent=2))
