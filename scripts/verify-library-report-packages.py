from pathlib import Path
import hashlib,json,zipfile
root=Path(__file__).resolve().parents[1];out=root/'artifacts/library-report-20261121';snapshot=out/'snapshot/mobile'
manifest=json.loads((out/'source-manifest.json').read_text('utf8'))
def digest(data):return hashlib.sha256(data).hexdigest()
changed=['native/audio_facts.hpp','android/app/src/main/java/local/lume/receiver/LibraryPlayer.java','harmony/entry/src/main/ets/engine/LocalLibrary.ets','player-assets/player/sidebar.js','player-assets/player/library-report.css']
for file in changed:assert digest((snapshot/file).read_bytes())==manifest[file]==digest((root/'mobile'/file).read_bytes()),file
reports={};assets={}
for platform,ext,prefix,code,markers in [('Android','apk','assets/player/','classes.dex',[b'factsVersion',b'needsMetadataRefresh']),('HarmonyOS','hap','resources/rawfile/player/','ets/modules.abc',[b'factsVersion',b'applyFacts'])]:
    package=root/'release/LibraryReport-20261121'/('Lume-'+platform+'.'+ext)
    with zipfile.ZipFile(package) as archive:
        assert archive.testzip() is None
        assets[platform]={n[len(prefix):]:digest(archive.read(n)) for n in archive.namelist() if n.startswith(prefix) and not n.endswith('/')}
        for name in ['sidebar.js','library-report.js','library-report.css','scan-rules.js','scan-rules.css']:
            assert archive.read(prefix+name)==(snapshot/'player-assets/player'/name).read_bytes(),name
        bytecode=archive.read(code)
        for marker in markers:assert marker in bytecode,(platform,marker)
        lib=archive.read(('lib' if platform=='Android' else 'libs')+'/arm64-v8a/liblume.so')
        assert b'factsVersion' in lib
        candidates=list((snapshot/'android/build').glob('sdk-*/lib/arm64-v8a/liblume.so')) if platform=='Android' else [snapshot/'harmony/entry/build/default/intermediates/stripped_native_libs/default/arm64-v8a/liblume.so']
        assert any(f.read_bytes()==lib for f in candidates)
        extracted=out/'unpacked'/platform/'player';extracted.mkdir(parents=True,exist_ok=True)
        for name in assets[platform]:
            target=extracted/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(archive.read(prefix+name))
        reports[platform]={'package':str(package),'sha256':digest(package.read_bytes()),'bytes':package.stat().st_size,'nativeMatchesBuild':True,'bytecodeMigrationPresent':True,'reportAndRestoreAssetsMatch':True,'scanPageAssetsPreserved':True}
assert assets['Android']==assets['HarmonyOS']
reports['sharedAssetsIdentical']=True
(out/'package-results.json').write_text(json.dumps(reports,indent=2),encoding='utf8');print(json.dumps(reports,indent=2))
