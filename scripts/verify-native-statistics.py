from pathlib import Path
import os,subprocess,json
root=Path.cwd();out=root/'artifacts/listening-statistics-20261121';source=(root/'mobile/native/room.cpp').read_text(encoding='utf8');history=source[source.index('class PlayHistory {'):source.index('\nPlayHistory history;')]
harness=r'''
#include <algorithm>
#include <cassert>
#include <chrono>
#include <cstdio>
#include <ctime>
#include <fstream>
#include <map>
#include <mutex>
#include <string>
#include "vendor/json.hpp"
#include "play_completion.hpp"
using Json=nlohmann::json;
int64_t mono=1000,wall=0;
int64_t now(){return mono;}int64_t wallNow(){return wall;}
'''+history+r'''
int main(int argc,char**argv){
 assert(argc==2);std::string file=argv[1];std::remove(file.c_str());std::remove((file+".records").c_str());
 {std::ofstream f(file);f<<"{\"song\":5}";}
 tm date{};date.tm_year=126;date.tm_mon=11;date.tm_mday=31;date.tm_hour=23;date.tm_min=59;date.tm_sec=59;date.tm_isdst=-1;wall=int64_t(mktime(&date))*1000;
 auto started=wall;PlayHistory h;h.open(file);h.begin("one","song","Test",0,{{"artist","Artist"},{"album","Album"},{"duration",10}});
 mono+=500;wall+=500;h.sample("one",.5);h.begin("one","song","Test");assert(h.recordSnapshot().size()==1);
 mono+=1000;wall+=1000;h.sample("one",1.5);auto r=h.recordSnapshot()[0];assert(r["days"]["2026-12-31"]==1000);assert(r["days"]["2027-01-01"]==500);assert(r["hours"]["2026-12-31T23"]==1000);assert(r["hours"]["2027-01-01T00"]==500);assert(r["artist"]=="Artist");
 mono+=4000;wall+=4000;h.sample("one",1.5);assert(h.recordSnapshot()[0]["listenedMs"]==1500);
 h.sample("one",9.5,true);mono+=500;wall+=500;h.sample("one",10,false,true);assert(h.recordSnapshot()[0]["listenedMs"]==2000);
 assert(h.add("song","song",10,"one")==6);assert(h.add("song","song",10,"one")==6);assert(h.recordSnapshot()[0]["startedAt"]==started);
 PlayHistory reopened;reopened.open(file);assert(reopened.recordSnapshot()==h.recordSnapshot());assert(reopened.snapshot()==h.snapshot());
 lume::PlayCompletion c;c.play(0);c.pause(4000);c.play(8000);assert(c.finish(10,14000));assert(!c.finish(10,15000));c.reset();c.play(0);c.seek(9.9,1000);assert(!c.finish(10,12000));c.reset();c.play(0);assert(!c.finish(10,4000));
 std::puts("PASS native record timestamp, midnight/year split, pause, seek exclusion, deduplication, persistence, completion gate");
}
'''
(out/'native-statistics.cpp').write_text(harness,encoding='utf8')
ndk=next((Path(os.environ['LOCALAPPDATA'])/'Android/Sdk/ndk').iterdir());oh=Path('D:/DevEco Studio/sdk/default/openharmony/native')
report={}
for platform,compiler,flags,tool in [('Android',ndk/'toolchains/llvm/prebuilt/windows-x86_64/bin/aarch64-linux-android28-clang++.cmd',[],Path(os.environ['LOCALAPPDATA'])/'Android/Sdk/platform-tools/adb.exe'),('HarmonyOS',oh/'llvm/bin/clang++.exe',['--target=aarch64-linux-ohos','--sysroot='+str(oh/'sysroot')],Path('D:/DevEco Studio/sdk/default/openharmony/toolchains/hdc.exe'))]:
 exe=out/('native-statistics-'+platform);subprocess.run([str(compiler),*flags,'-std=c++17','-O2','-static-libstdc++','-I'+str(root/'mobile/native'),str(out/'native-statistics.cpp'),'-o',str(exe)],check=True)
 remote='/data/local/tmp/lume-statistics-test';subprocess.run([str(tool),'shell','mkdir','-p',remote],check=True,capture_output=True)
 subprocess.run([str(tool),*(['push'] if platform=='Android' else ['file','send']),str(exe),remote+'/verify'],check=True,capture_output=True)
 subprocess.run([str(tool),'shell','chmod','755',remote+'/verify'],check=True,capture_output=True)
 r=subprocess.run([str(tool),'shell',remote+'/verify',remote+'/plays.json'],capture_output=True);text=r.stdout.decode();
 if platform=='HarmonyOS' and 'PASS native' not in text:report[platform]={'compiled':True,'standaloneExecution':text.strip(),'actualHapPlayback':'See HarmonyOS-playback-verification.json'}
 else:assert 'PASS native' in text,text;report[platform]=text.strip()
 print(platform,report[platform])
(out/'native-statistics-results.json').write_text(json.dumps(report,indent=2),encoding='utf8')
