from pathlib import Path
import json, os, subprocess, sys
root=Path(__file__).resolve().parents[1]
out=root/'artifacts/library-report-20261121'
fixtures=out/'fixtures';fixtures.mkdir(parents=True,exist_ok=True)
def run(args):
    return subprocess.run([str(x) for x in args],check=True,capture_output=True).stdout
cases=[('lyrics.mp3',['-c:a','libmp3lame','-metadata','lyrics=[00:00.00]Test lyrics'],'lossy',True),
       ('plain.mp3',['-c:a','libmp3lame','-id3v2_version','0'],'lossy',False),
       ('plain.aac',['-c:a','aac'],'lossy',False),
       ('lyrics.flac',['-c:a','flac','-metadata','lyrics=Test lyrics'],'lossless',True),
       ('hires.flac',['-c:a','flac','-ar','48000','-sample_fmt','s32'],'hires',False),
       ('plain.wav',['-c:a','pcm_s16le'],'lossless',False),
       ('hires.wav',['-c:a','pcm_s24le','-ar','48000'],'hires',False),
       ('lyrics.m4a',['-c:a','aac','-metadata','lyrics=Test lyrics'],'lossy',True),
       ('plain.m4a',['-c:a','alac'],'lossless',False),
       ('lyrics.ogg',['-c:a','libvorbis','-metadata','lyrics=Test lyrics'],'lossy',True),
       ('plain.opus',['-c:a','libopus'],'lossy',False)]
for name,codec,_,_ in cases:
    run(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','lavfi','-i','sine=frequency=440:duration=1',
         '-map_metadata','-1',*codec,fixtures/name])
(fixtures/'unknown.bin').write_bytes(b'unrecognized audio')
files=[fixtures/c[0] for c in cases]+[fixtures/'unknown.bin']
def check(raw):
    values=[json.loads(line) for line in raw.decode('utf8').splitlines() if line.startswith('{')]
    assert len(values)==len(files),raw
    for (name,_,quality,lyrics),facts in zip(cases,values):
        assert facts['quality']==quality,(name,facts)
        assert facts['hasLyrics']==lyrics,(name,facts)
        assert facts['bytes']==(fixtures/name).stat().st_size,(name,facts)
        assert facts['factsVersion']==3
    assert values[-1]['quality']=='unknown' and 'hasLyrics' not in values[-1]
    return [dict(file=f.name,facts=v) for f,v in zip(files,values)]
if '--devices' not in sys.argv:
    build=out/'compile-facts.cmd'
    build.write_text('@echo off\ncall "C:/Program Files/Microsoft Visual Studio/2022/Community/VC/Auxiliary/Build/vcvars64.bat" >nul\ncl /nologo /EHsc /std:c++17 /utf-8 /O2 "'+str(root/'tests/library-report-facts.cpp')+'" /Fe:"'+str(out/'facts-desktop.exe')+'" /Fo:"'+str(out/'facts-desktop.obj')+'"\n',encoding='utf8')
    run(['cmd.exe','/c',build]);report=check(run([out/'facts-desktop.exe',*files]))
    (out/'facts-results.json').write_text(json.dumps(report,indent=2),encoding='utf8')
    print('PASS 12 native facts fixtures without extensions, including embedded lyrics and extensible WAV')
else:
    sdk=Path(os.environ['LOCALAPPDATA'])/'Android/Sdk';ndk=next((sdk/'ndk').iterdir())
    android=out/'facts-android';harmony=out/'facts-harmony'
    run([ndk/'toolchains/llvm/prebuilt/windows-x86_64/bin/aarch64-linux-android28-clang++.cmd','-std=c++17','-O2','-static-libstdc++',root/'tests/library-report-facts.cpp','-o',android])
    oh=Path('D:/DevEco Studio/sdk/default/openharmony/native')
    run([oh/'llvm/bin/clang++.exe','--target=aarch64-linux-ohos','--sysroot='+str(oh/'sysroot'),'-std=c++17','-O2','-static-libstdc++',root/'tests/library-report-facts.cpp','-o',harmony])
    reports={}
    for platform,tool,exe in [('Android',sdk/'platform-tools/adb.exe',android),('HarmonyOS',Path('D:/DevEco Studio/sdk/default/openharmony/toolchains/hdc.exe'),harmony)]:
        base='/data/local/tmp/lume-library-report'
        run([tool,'shell','mkdir','-p',base])
        for f in [exe,*files]:run([tool,*(['push'] if platform=='Android' else ['file','send']),f,base+'/'+f.name])
        run([tool,'shell','chmod','755',base+'/'+exe.name])
        raw=run([tool,'shell',base+'/'+exe.name,*[base+'/'+f.name for f in files]])
        if b'Permission denied' in raw:
            reports[platform]={'blocked':raw.decode('utf8').strip(),'passed':False}
        else:reports[platform]=check(raw)
    (out/'device-facts-results.json').write_text(json.dumps(reports,indent=2),encoding='utf8')
    print(json.dumps({k:('PASS '+str(len(v))+' real descriptor-based fixtures' if isinstance(v,list) else v) for k,v in reports.items()},ensure_ascii=False))
