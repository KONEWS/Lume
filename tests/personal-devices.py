"""Exercise the production peer protocol on three loopback interfaces, without phones."""
from pathlib import Path
import hashlib
import json
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
BIN = ROOT / 'resources/personal-device'
HELPER = BIN / (BIN / 'current.txt').read_text().strip()


class Device:
    def __init__(self, root, number):
        self.root = root / str(number)
        self.address = '127.0.0.' + str(number)
        self.process = subprocess.Popen([HELPER], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                        text=True, encoding='utf-8')
        self.origin=self.call('init', dir=str(self.root), name='测试设备' + str(number), bind=self.address)
        self.id = self.call('status')['id']

    def call(self, op, **fields):
        self.process.stdin.write(json.dumps(dict(op=op, **fields)) + '\n')
        self.process.stdin.flush()
        value = json.loads(self.process.stdout.readline())
        assert 'error' not in value, value
        return value

    def close(self):
        self.process.stdin.close()
        self.process.wait(15)
        assert self.process.returncode == 0


def until(check, seconds=45):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        value = check()
        if value:
            return value
        time.sleep(.18)
    raise AssertionError('condition did not converge')


def main():
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        devices = []
        try:
            devices = [Device(root, i) for i in (2, 3, 4)]
            for i, d in enumerate(devices):
                rows = [dict(session=f'{i}-{n}', id='same-song', title='离线歌曲', startedAt=1000+n,
                             completed=False, listenedMs=n, playModeSource='local', **(d.origin if n else {})) for n in range(155)]
                rows.append(dict(session='same-room-session', id='one', title='空间歌曲', startedAt=2000,
                                 completed=i==2, listenedMs=i*200, playModeSource='room', **(d.origin if i==0 else {})))
                d.call('feed', rows=rows, flush=True)
            for i, d in enumerate(devices):
                for other in devices[i+1:]:
                    d.call('find', address=other.address)
            time.sleep(2.5)
            assert all(len(d.call('records')['records'])==156 for d in devices)
            def pair(sender,receiver,approve):
                sender.call('find',address=receiver.address)
                sender.call('trust',peer=receiver.id)
                prompt=until(lambda: next((p for p in receiver.call('status')['pairRequests'] if p['peer']==sender.id),None))
                sender.call('find',address=receiver.address)
                sender.call('trust',peer=receiver.id)
                assert [p['key'] for p in receiver.call('status')['pairRequests'] if p['peer']==sender.id]==[prompt['key']]
                assert not any(p['trusted'] for p in receiver.call('status')['peers'] if p['id']==sender.id)
                receiver.call('approvePair' if approve else 'rejectPair',peer=sender.id,key=prompt['key'])
                until(lambda: not any(p['requestPending'] for p in sender.call('status')['peers'] if p['id']==receiver.id))
            pair(devices[0],devices[1],False)
            pair(devices[0],devices[1],True)
            pair(devices[1],devices[2],True)
            def merged():
                for d in devices:
                    rows=d.call('records')['records']
                    if len(rows)!=466:return False
                    room=[r for r in rows if r['session']=='same-room-session']
                    if len(room)!=1 or not room[0]['completed'] or room[0]['listenedMs']!=400:return False
                    assert room[0]['originDeviceId']==devices[0].id
                    for row in rows:
                        if row['session']=='same-room-session':continue
                        i,n=map(int,row['session'].split('-'))
                        if n: assert all(row[k]==v for k,v in devices[i].origin.items())
                        else: assert not row.get('originDeviceId')
                return True
            until(merged)
            time.sleep(2.5)
            assert merged()
            original=devices[0]
            family="👨‍👩‍👧‍👦"
            for value in ['华'*32, family*32, ('e\u0301'*32)]:
                assert original.call('checkName',displayName=value)['count']==32
                assert original.call('rename',displayName=value)['name']==value
            try:
                original.call('rename',displayName='字'*33)
            except AssertionError as error:
                assert '32' in str(error)
            else: raise AssertionError('33 graphemes must be rejected')
            assert original.call('rename',displayName='  ')['name']==original.origin['originDeviceName']
            chosen='华为Mate 70 Pro Max'
            before=original.call('records')['records']
            original.call('rename',displayName=chosen)
            def known_name(d):
                st=d.call('status')
                return (st['name']==chosen if d is original else any(p['id']==original.id and p['trusted'] and p['name']==chosen for p in st['peers']))
            until(lambda: all(known_name(d) for d in devices[:2]))
            # Device 3 knows the source only via device 2.
            until(lambda: all(r.get('originDeviceName')==chosen for r in devices[2].call('records')['records'] if r.get('originDeviceId')==original.id))
            for d in devices:
                after=d.call('records')['records']
                public=lambda rows:{r['session']:{k:v for k,v in r.items() if k not in ('originDeviceName','originNameVersion','originDisplayName')} for r in rows}
                assert public(before)==public(after)
                assert all(r['originDeviceName']==chosen for r in after if r.get('originDeviceId')==original.id)
                assert not next(r for r in after if r['session']=='0-0').get('originDeviceName')
            pair(devices[0],devices[2],True)
            sample = root / '原始歌曲.wav' 
            sample.write_bytes((ROOT/'tests/fixtures/channel-check.wav').read_bytes()*16)
            digest = hashlib.sha256(sample.read_bytes()).digest()
            for sender in devices:
                for receiver in devices:
                    if sender is not receiver:
                        sender.call('offer', peer=receiver.id, path=str(sample), title='声道验证', ext='wav')
            for receiver in devices:
                def incoming():
                    state=receiver.call('status')
                    assert not state['files']
                    return state['offers'] if len(state['offers'])==2 else None
                for offer in until(incoming):
                    receiver.call('accept', key=offer['key'])
            for receiver in devices:
                def finished():
                    files=receiver.call('status')['files']
                    return files if len(files)==2 else None
                for song in until(finished,75):
                    content=(receiver.root/'received'/song['file']).read_bytes()
                    assert hashlib.sha256(content).digest()==digest
                    receiver.call('imported',key=song['key'])
            for d in devices:d.close()
            devices.clear()
            for number in (2,3,4):
                d=Device(root,number);devices.append(d)
                stored=d.call('records')['records']
                assert len(stored)==466
                assert all(r['playModeSource']=='local' for r in stored if r.get('originDeviceId') and r['session']!='same-room-session')
                assert next(r for r in stored if r['session']=='same-room-session')['originDeviceName']==chosen
                if number==2:assert d.id==original.id and d.call('status')['name']==chosen
                assert len([p for p in d.call('status')['peers'] if p['trusted']])==2
                assert len(list((d.root/'received').glob('*.wav')))==2
                d.close();devices.pop()
            print('PASS: three isolated stores, 465 offline events + one room session; six consented transfers; offline restart.')
        finally:
            for d in devices:
                if d.process.poll() is None:d.close()


if __name__=='__main__':
    main()
