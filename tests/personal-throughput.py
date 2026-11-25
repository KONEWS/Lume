"""Time an accepted transfer between two production helpers using isolated stores."""
import argparse, hashlib, json, os, subprocess, tempfile, time
from pathlib import Path
ap=argparse.ArgumentParser()
ap.add_argument('sender',type=Path)
ap.add_argument('receiver',type=Path)
ap.add_argument('--progress',action='store_true')
args=ap.parse_args()
def call(proc,op,**fields):
    proc.stdin.write(json.dumps(dict(op=op,**fields))+'\n');proc.stdin.flush()
    reply=json.loads(proc.stdout.readline())
    assert not reply.get('error'),reply
    return reply
with tempfile.TemporaryDirectory() as folder:
    root=Path(folder)
    procs=[]
    try:
        for i,exe in enumerate([args.sender,args.receiver]):
            p=subprocess.Popen([exe.resolve()],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True,encoding='utf8')
            procs.append(p);call(p,'init',dir=str(root/str(i)),name='bench'+str(i),bind='127.0.0.'+str(81+i))
        a,b=procs
        aid=call(a,'status')['id'];bid=call(b,'status')['id']
        call(a,'find',address='127.0.0.82');call(a,'trust',peer=bid);call(b,'trust',peer=aid)
        path=root/'sample.wav';pattern=os.urandom(1024*1024)
        with path.open('wb') as f:
            for i in range(128):f.write(pattern)
        call(a,'offer',peer=bid,title='test',path=str(path),ext='wav')
        deadline=time.monotonic()+160
        while time.monotonic()<deadline:
            offers=call(b,'status')['offers']
            if offers:break
            time.sleep(.05)
        assert offers
        start=time.monotonic();call(b,'accept',key=offers[0]['key']);seen_send=seen_recv=False
        while time.monotonic()<deadline:
            state=call(b,'status');send=call(a,'status')
            seen_recv|=any(0<o.get('received',0)<o['bytes'] for o in state['offers'])
            seen_send|=any(0<o.get('received',0)<o['bytes'] for o in send.get('outgoing',[]))
            if state['files']:break
            time.sleep(.10)
        elapsed=time.monotonic()-start;item,=state['files']
        with path.open('rb') as original,(root/'1'/'received'/item['file']).open('rb') as saved:
            assert hashlib.file_digest(original,'sha256').digest()==hashlib.file_digest(saved,'sha256').digest()
        if args.progress:assert seen_recv and seen_send,(seen_recv,seen_send)
        print(f'128 MiB, {elapsed:.2f} seconds, {128/elapsed:.2f} MiB/s; identical SHA-256. Sender/receiver intermediate byte progress: {seen_send}/{seen_recv}.')
    finally:
        for p in procs:p.stdin.close()
        for p in procs:p.wait(30)
