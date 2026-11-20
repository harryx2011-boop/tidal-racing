import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalTransport } from '../../src/game/net/transport.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const code = () => 'T' + Math.random().toString(36).slice(2, 6).toUpperCase();

test('local transport: host, join, both directions, relay addressing, leave', async () => {
  const c = code();
  const h = new LocalTransport(), a = new LocalTransport(), b = new LocalTransport();
  const log = { h: [], a: [], b: [], joined: [], left: [] };
  h.onPeerJoin = (id) => log.joined.push(id); h.onPeerLeave = (id) => log.left.push(id); h.onMessage = (f, m) => log.h.push([f, m]);
  a.onMessage = (f, m) => log.a.push(m); b.onMessage = (f, m) => log.b.push(m);
  await h.host(c); await a.join(c); await b.join(c);
  assert.equal(log.joined.length, 2);
  a.send({ t: 'x', n: 1 });
  h.send({ t: 'all' });
  h.sendTo(b.id, { t: 'only-b' });
  const pose = new ArrayBuffer(53);
  b.send(pose);
  await wait(60);
  assert.deepEqual(log.h.map((x) => x[1]).filter((m) => m.t === 'x'), [{ t: 'x', n: 1 }]);
  assert.equal(log.h.find((x) => x[0] === b.id && x[1] instanceof ArrayBuffer)[1].byteLength, 53);
  assert.deepEqual(log.a, [{ t: 'all' }]);
  assert.deepEqual(log.b, [{ t: 'all' }, { t: 'only-b' }]);
  a.close(); await wait(60);
  assert.deepEqual(log.left, [a.id]);
  let closed = null; b.onClose = (why) => { closed = why; };
  h.close(); await wait(60);
  assert.equal(closed, 'host-left');
  b.close();
});
test('local transport: no host gives not-found, a second host gives taken', async () => {
  const c = code();
  await assert.rejects(new LocalTransport().join(c), (e) => e.code === 'not-found');
  const h = new LocalTransport(); await h.host(c);
  await assert.rejects(new LocalTransport().host(c), (e) => e.code === 'taken');
  h.close();
});
test('local transport: clients do not hear each other', async () => {
  const c = code();
  const h = new LocalTransport(), a = new LocalTransport(), b = new LocalTransport();
  let got = 0; b.onMessage = () => got++;
  await h.host(c); await a.join(c); await b.join(c);
  a.send({ t: 'secret' });
  await wait(50);
  assert.equal(got, 0);
  h.close(); a.close(); b.close();
});
