from pathlib import Path
import hashlib,json,shutil,os,sys
root=Path(__file__).resolve().parents[1]
out=root/'artifacts/harmony-word-chain-20261121';dest=out/'snapshot/mobile'
assert '--refresh' in sys.argv or not (out/'source-manifest.json').exists(),'A completed snapshot already exists'
excluded={'build','.hvigor','.cxx','.idea','oh_modules','verification','verification-edge'}
files=[]
for folder in ['android','harmony','native','player-assets']:
    for current,dirs,names in os.walk(root/'mobile'/folder):
        dirs[:]=[d for d in dirs if d not in excluded and not(Path(current).name=='rawfile' and d=='player')]
        files.extend(Path(current)/n for n in names if not n.endswith('.log'))
files.extend(root/'mobile'/n for n in ['optimize-player-assets.py','packaging-requirements.txt'])
contents={str(f.relative_to(root/'mobile')).replace('\\','/'):f.read_bytes() for f in files}
hashes={name:hashlib.sha256(data).hexdigest() for name,data in contents.items()}
for name,digest in hashes.items():
    target=dest/name;target.parent.mkdir(parents=True,exist_ok=True)
    if not target.exists() or target.read_bytes()!=contents[name]:target.write_bytes(contents[name])
    assert hashlib.sha256(target.read_bytes()).hexdigest()==digest,name
    assert hashlib.sha256((root/'mobile'/name).read_bytes()).hexdigest()==digest,name
(dest/'android/app/src/main/assets').mkdir(parents=True,exist_ok=True)
(out/'source-manifest.json').write_text(json.dumps(hashes,indent=2),encoding='utf-8')
(root/'release/HarmonyWordChain-20261121').mkdir(exist_ok=True)
print('Frozen',len(hashes),'files')



