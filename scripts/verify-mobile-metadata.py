"""Exercise the shared C++ reader locally; --devices explicitly opts into phone probes."""
from pathlib import Path
import json, os, subprocess, sys

root=Path(__file__).resolve().parents[1]
out=root/'artifacts/metadata-20261121'
fixtures=out/'fixtures';fixtures.mkdir(parents=True,exist_ok=True)
def run(args,**kw):
    return subprocess.run([str(x) for x in args],check=True,capture_output=True,**kw).stdout
tags={'title':'标签测试曲','artist':'测试艺术家 · Artist','album':'测试专辑 Album'}
cases=[('id3v23.mp3',['-c:a','libmp3lame','-id3v2_version','3']),('id3v24.mp3',['-c:a','libmp3lame','-id3v2_version','4']),
       ('tagged.flac',['-c:a','flac']),('hires.flac',['-c:a','flac','-ar','96000','-sample_fmt','s32']),
       ('tagged.m4a',['-c:a','aac']),('tagged.wav',['-c:a','pcm_s16le']),
       ('tagged.ogg',['-c:a','libvorbis']),('tagged.opus',['-c:a','libopus']),
       ('untagged.wav',['-c:a','pcm_s16le']),('album-artist.flac',['-c:a','flac'])]
for name,codec in cases:
    args=['ffmpeg','-hide_banner','-loglevel','error','-y','-f','lavfi','-i','sine=frequency=440:duration=0.2',*codec,'-map_metadata','-1']
    for key,value in ({} if name=='untagged.wav' else {'album_artist':tags['artist'],'album':tags['album']} if name=='album-artist.flac' else tags).items():args+=['-metadata',key+'='+value]
    run(args+[fixtures/name])
def check(values,platform):
    parsed=[json.loads(line) for line in values.splitlines() if line.startswith('{')]
    assert len(parsed)==len(cases),(platform,values)
    report=[]
    for (name,_),facts in zip(cases,parsed):
        expected={} if name=='untagged.wav' else {'albumArtist':tags['artist'],'album':tags['album']} if name=='album-artist.flac' else tags
        for key,value in expected.items():assert facts.get(key)==value,(platform,name,key,facts)
        if not expected:assert not any(facts.get(k) for k in tags),(platform,name,facts)
        if name=='hires.flac':assert facts.get('quality')=='hires',facts
        report.append({'file':name,'facts':facts,'passed':True})
    return report
if '--devices' not in sys.argv:
    build=out/'compile-desktop.cmd'
    build.write_text('@echo off\ncall "C:/Program Files/Microsoft Visual Studio/2022/Community/VC/Auxiliary/Build/vcvars64.bat" >nul\ncl /nologo /EHsc /std:c++17 /utf-8 /O2 "'+str(root/'tests/mobile-metadata.cpp')+'" /Fe:"'+str(out/'metadata-desktop.exe')+'" /Fo:"'+str(out/'metadata-desktop.obj')+'"\n',encoding='utf-8')
    run(['cmd.exe','/c',build])
    values=run([out/'metadata-desktop.exe',*[fixtures/name for name,_ in cases]]).decode('utf-8')
    report=check(values,'Windows')
    (out/'native-desktop-results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print('Passed 10 native metadata tests locally. No phone accessed.');sys.exit(0)
sdk=Path(os.environ['LOCALAPPDATA'])/'Android/Sdk'
ndk=next((sdk/'ndk').iterdir())
android=out/'metadata-android'
run([ndk/'toolchains/llvm/prebuilt/windows-x86_64/bin/aarch64-linux-android28-clang++.cmd','-std=c++17','-O2','-static-libstdc++',root/'tests/mobile-metadata.cpp','-o',android])
oh=Path('D:/DevEco Studio/sdk/default/openharmony/native')
harmony=out/'metadata-harmony'
run([oh/'llvm/bin/clang++.exe','--target=aarch64-linux-ohos','--sysroot='+str(oh/'sysroot'),'-std=c++17','-O2','-static-libstdc++',root/'tests/mobile-metadata.cpp','-o',harmony])
reports={}
for platform,tool,exe,base in [('Android',sdk/'platform-tools/adb.exe',android,'/data/local/tmp/lume-metadata-test'),('HarmonyOS',Path('D:/DevEco Studio/sdk/default/openharmony/toolchains/hdc.exe'),harmony,'/data/local/tmp/lume-metadata-test')]:
    run([tool,'shell','mkdir','-p',base])
    for file in [exe,*fixtures.iterdir()]:
        run([tool,*(['push'] if platform=='Android' else ['file','send']),file,base+'/'+file.name])
    run([tool,'shell','chmod','755',base+'/'+exe.name])
    values=run([tool,'shell',base+'/'+exe.name,*[base+'/'+name for name,_ in cases]]).decode('utf-8').splitlines()
    parsed=[json.loads(line) for line in values if line.startswith('{')]
    if len(parsed)!=len(cases):
        reports[platform]={'blocked':values};continue
    reports[platform]=check('\n'.join(values),platform)
(out/'native-device-results.json').write_text(json.dumps(reports,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({platform:len(result) if isinstance(result,list) else result for platform,result in reports.items()},ensure_ascii=False))
