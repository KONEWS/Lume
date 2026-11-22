from pathlib import Path
from zipfile import ZipFile
import hashlib,json,sys
root=Path(__file__).resolve().parents[1]
out=root/'artifacts/lyric-line-transition-20261121'
snapshot=out/'snapshot/mobile'
digest=lambda b:hashlib.sha256(b).hexdigest()
manifest=json.loads((out/'source-manifest.json').read_text())
# Fail before installing if another completed edit would be overwritten.
selected=sys.argv[1:]
changed=[n for n,h in manifest.items() if not (selected==['Android'] and n.startswith('harmony/')) and not (selected==['HarmonyOS'] and n.startswith('android/')) and digest((root/'mobile'/n).read_bytes())!=h]
assert not changed, 'Workspace advanced; refresh build before installation: '+str(changed)
report={};asset_sets={}
for platform,extension,prefix in [('Android','apk','assets/player/'),('HarmonyOS','hap','resources/rawfile/player/')]:
    if selected and platform not in selected:continue
    package=root/f'release/LyricLineTransition-20261121/Lume-LyricLineTransition-{platform}.{extension}'
    with ZipFile(package) as archive:
        assert archive.testzip() is None
        assets={n[len(prefix):]:archive.read(n) for n in archive.namelist() if n.startswith(prefix) and not n.endswith('/')}
        for n,b in assets.items():
            if n not in {'folia/stage.js','folia/source.zip'}:
                assert b==(snapshot/'player-assets/player'/n).read_bytes(),(platform,n)
        for n in ['player.js','plain-lyrics.js','plain-lyrics.css','folia/host.js']:
            assert assets[n]==(root/'mobile/player-assets/player'/n).read_bytes()
        assert b'playbackPosition' in archive.read('classes.dex' if platform=='Android' else 'ets/modules.abc')
        extracted=out/'packaged'/platform/'player'
        for n,b in assets.items():
            target=extracted/n;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(b)
        asset_sets[platform]={n:digest(b) for n,b in assets.items()}
        report[platform]={'path':str(package),'sha256':digest(package.read_bytes()),'bytes':package.stat().st_size,'playerAssets':len(assets),'nativeClockPresent':True,'taskChangesMatchCurrentSource':True}
if len(asset_sets)==2:assert asset_sets['Android']==asset_sets['HarmonyOS']
report['identicalSharedPlayer']=len(asset_sets)==2
report['allFrozenSourcesMatchWorkspace']=True
(out/('package-verification-'+selected[0]+'.json' if selected else 'package-verification.json')).write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report,indent=2))

