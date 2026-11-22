from pathlib import Path
from zipfile import ZipFile
import json,hashlib
root=Path.cwd();out=root/'artifacts/listening-statistics-20261121';manifest=json.loads((out/'source-manifest.json').read_text());changed=[n for n,h in manifest.items() if hashlib.sha256((root/'mobile'/n).read_bytes()).hexdigest()!=h];assert not changed,changed
result={};assets={}
for platform,ext,prefix in [('Android','apk','assets/player/'),('HarmonyOS','hap','resources/rawfile/player/')]:
 package=root/f'release/ListeningStatistics-20261121/Lume-Statistics-{platform}.{ext}'
 if not package.exists():print(platform,'not built yet');continue
 with ZipFile(package) as z:
  assert z.testzip() is None
  files={n[len(prefix):]:z.read(n) for n in z.namelist() if n.startswith(prefix) and not n.endswith('/')}
  for n,b in files.items():
   if n not in ['folia/stage.js','folia/source.zip']:assert b==(root/'mobile/player-assets/player'/n).read_bytes(),(platform,n)
  for n in ['statistics.js','statistics-data.js','statistics.css','listening.js','listen-home.js','library-report.js','library-report.css','player.js','sidebar.js']:assert n in files
  native=[z.read(n) for n in z.namelist() if n.endswith('/liblume.so')];assert native and b'historyRecords' in native[0] and b'listenedMs' in native[0]
  extracted=out/'packaged'/platform/'player'
  for n,b in files.items():p=extracted/n;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b)
  assets[platform]={n:hashlib.sha256(b).hexdigest() for n,b in files.items()}
  result[platform]={'path':str(package),'sha256':hashlib.sha256(package.read_bytes()).hexdigest(),'bytes':package.stat().st_size,'sharedAssets':len(files),'nativeRecordSupport':True,'matchesWorkspace':True}
if len(assets)==2:assert assets['Android']==assets['HarmonyOS'];result['identicalSharedPlayer']=True
(out/'package-verification.json').write_text(json.dumps(result,indent=2),encoding='utf8');print(json.dumps(result,indent=2))
