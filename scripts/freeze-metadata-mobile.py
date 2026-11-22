from pathlib import Path
import hashlib,json,shutil,os
root=Path(__file__).resolve().parents[1]
out=root/'artifacts/metadata-20261121';dest=out/'snapshot/mobile'
assert not dest.exists(),'Snapshot already exists'
excluded={'build','.hvigor','.cxx','.idea','oh_modules','verification','verification-edge'}
files=[]
for folder in ['android','harmony','native','player-assets']:
    for current,dirs,names in os.walk(root/'mobile'/folder):
        dirs[:]=[d for d in dirs if d not in excluded and not(Path(current).name=='rawfile' and d=='player')]
        files.extend(Path(current)/n for n in names if not n.endswith('.log'))
files.extend(root/'mobile'/n for n in ['optimize-player-assets.py','packaging-requirements.txt'])
hashes={str(f.relative_to(root/'mobile')).replace('\\','/'):hashlib.sha256(f.read_bytes()).hexdigest() for f in files}
for name,digest in hashes.items():
    target=dest/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(root/'mobile'/name,target)
    assert hashlib.sha256(target.read_bytes()).hexdigest()==digest,name
    assert hashlib.sha256((root/'mobile'/name).read_bytes()).hexdigest()==digest,name
(dest/'android/app/src/main/assets').mkdir(parents=True,exist_ok=True)
(out/'source-manifest.json').write_text(json.dumps(hashes,indent=2),encoding='utf-8')
(root/'release/Metadata-20261121').mkdir(exist_ok=True)
print('Frozen',len(hashes),'files')
