// Execute the production clock methods with deterministic clock and packet fixtures.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const out='artifacts/room-lyrics-sync-20261121/clock';await mkdir(out,{recursive:true});
const android=await readFile('mobile/android/app/src/main/java/local/lume/receiver/RoomReceiver.java','utf8');
const method=android.match(/    double playbackPosition\(\)\{[\s\S]*?\n    \}/)[0];
await writeFile(out+'/ClockCheck.java',`public class ClockCheck {
  static class SystemClock {static long now;static long elapsedRealtime(){return now;}}
  static class JSONObject {
    double position=42,duration=120;long serverTime=900000;int delayMs=250;boolean playing=true;
    double optDouble(String key,double fallback){return key.equals("position")?position:duration;}
    long optLong(String key){return serverTime;}int optInt(String key){return delayMs;}
    boolean optBoolean(String key){return playing;}
  }
  JSONObject latest=new JSONObject();long clockBase=800000;
${method}
  void check(double expected){double actual=playbackPosition();if(Math.abs(actual-expected)>.000001)throw new AssertionError(actual+" != "+expected);}
  public static void main(String[] args){ClockCheck t=new ClockCheck();SystemClock.now=100500;t.check(42.25);
    SystemClock.now+=350;t.check(42.6);t.latest.playing=false;t.check(42);
    SystemClock.now+=5000;t.check(42);t.latest.position=70;t.latest.serverTime=905850;t.latest.playing=true;t.check(69.75);
    t.latest.position=10;t.check(9.75);t.latest.position=0;t.check(0);
    t.latest.position=120;SystemClock.now+=2000;t.check(120);t.latest=null;t.check(0);
    System.out.println("PASS Android actual Java clock method: latency, delay, pause/resume, seek, bounds");}
}`);
execFileSync('javac',['-encoding','UTF-8',out+'/ClockCheck.java'],{windowsHide:true});
const java=execFileSync('java',['-cp',out,'ClockCheck'],{encoding:'utf8',windowsHide:true});console.log(java.trim());
const harmony=await readFile('mobile/harmony/entry/src/main/ets/engine/Receiver.ets','utf8');
const body=harmony.match(/  playbackPosition\(\):number \{([\s\S]*?)\n  \}/)[1];
const position=Function(body);
let now=100500;const receiver={mono:()=>now,offset:800000,latest:{serverTime:900000,delayMs:250,position:42,duration:120,roomPlaying:true}};
const check=expected=>assert(Math.abs(position.call(receiver)-expected)<.000001);
check(42.25);now+=350;check(42.6);receiver.latest.roomPlaying=false;check(42);now+=5000;check(42);
Object.assign(receiver.latest,{position:70,serverTime:905850,roomPlaying:true});check(69.75);
receiver.latest.position=10;check(9.75);receiver.latest.position=0;check(0);receiver.latest.position=120;now+=2000;check(120);receiver.latest=undefined;check(0);
console.log('PASS HarmonyOS production clock method: latency, delay, pause/resume, seek, bounds');
await writeFile(out+'/results.json',JSON.stringify({android:true,harmony:true,checks:['500ms transit age','250ms output delay','350ms between native publishes','pause freezes','resume and forward/backward seek','duration bounds','disconnect']},null,2));
