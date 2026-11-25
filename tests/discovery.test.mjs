import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import dgram from 'node:dgram';
import { nearbyPhones } from '../server/discovery.mjs';

test('nearby search lists separate phones of the same model and only invites live results', async t => {
  const sent = [];
  const socket = Object.assign(new EventEmitter(), {
    bind(_port, ready) { ready(); },
    setBroadcast() {},
    close() {},
    send(bytes, port, address, complete) {
      sent.push({message:bytes==='LUME_DISCOVER_1'?bytes:JSON.parse(bytes), port, address});
      complete();
    }
  });
  t.mock.method(dgram, 'createSocket', () => socket);
  let time = Date.now();
  t.mock.method(Date, 'now', () => time);
  const scan = nearbyPhones(47000, () => '测试空间');
  try {
    assert.deepEqual(await scan.search(), []);
    const {nonce, service} = sent.find(p=>p.port===46324).message;
    assert.equal(service, 'lume-find-phone/1');
    const data = {service:'lume-phone/1', nonce, id:'a'.repeat(32), platform:'Android', model:'测试型号'};
    const peer = {address:'192.168.1.15', port:46324};
    const receive = (message, source=peer) => socket.emit('message',Buffer.from(JSON.stringify(message)),source);
    receive({...data, nonce:'old'});
    receive({...data, platform:'unknown'});
    assert.deepEqual(await scan.search(), []);
    receive(data);
    receive(data);
    receive({...data,id:'b'.repeat(32)}, {...peer,address:'192.168.1.16'});
    const phones = await scan.search();
    assert.equal(phones.length, 2);
    assert.equal(phones[0].name, data.model);
    assert.equal(await scan.invite(data.id), true);
    const grant=sent.at(-1).message.inviteToken;assert.match(grant,/^[0-9a-f]{32}$/);
    assert.deepEqual(sent.at(-1), {message:{service:'lume-invite/1', id:data.id, name:'测试空间', port:47000,inviteToken:grant,inviteProof:''},
      port:46324,address:peer.address});
    assert.equal(scan.redeem(grant,data.id,'192.0.2.77'),false);
    assert.equal(scan.redeem(grant,data.id,peer.address),true);
    assert.equal(scan.redeem(grant,data.id,peer.address),false);
    receive({service:'lume-room/1',name:'手机空间',port:46321,guest:true},{address:'192.168.1.15',port:46322});
    const room=(await scan.search()).find(p=>p.roomPort);
    assert.equal(room.name,'手机空间');
    assert.equal(scan.roomUrl(room.id),'http://192.168.1.15:46321');
    assert.equal(await scan.invite(room.id),false);
    time += 8000;
    assert.equal(scan.roomUrl(room.id),null);
    assert.equal(await scan.invite(data.id), false);
    assert.deepEqual(await scan.search(), []);
  } finally { scan.close(); }
});
