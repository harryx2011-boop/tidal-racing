import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRoomCode, normalizeCode, isValidCode, roomFromSearch, roomLink, cleanName, encodePose, decodePose, POSE_BYTES, seqNewer, rankPlayers, CODE_ALPHABET, CODE_LEN } from '../../src/game/net/protocol.js';

test('room codes: generated codes are valid, distinct enough, use only the alphabet', () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) { const c = makeRoomCode(); assert.equal(c.length, CODE_LEN); assert.ok([...c].every((x) => CODE_ALPHABET.includes(x))); assert.ok(isValidCode(c)); seen.add(c); }
  assert.ok(seen.size > 490);
  assert.ok(!/[01OI]/.test([...seen].join('')));
});
test('room codes: edge values of the random source stay in range', () => {
  assert.equal(makeRoomCode(() => 0), 'AAAAA');
  assert.equal(makeRoomCode(() => 0.999999999), '99999');
});
test('room codes: normalize and validate typed input', () => {
  assert.equal(normalizeCode(' ab-cd2 '), 'ABCD2');
  assert.equal(normalizeCode('abcd'), '');
  assert.equal(normalizeCode('ABCDE6'), '');
  assert.equal(normalizeCode('ABC0E'), '');   // 0 is not in the alphabet
  assert.equal(normalizeCode('ABCIE'), '');
  assert.equal(normalizeCode(null), '');
  assert.ok(!isValidCode('ab cd'));
});
test('room link: parse and build', () => {
  assert.equal(roomFromSearch(''), '');
  assert.equal(roomFromSearch('?room=abcd2'), 'ABCD2');
  assert.equal(roomFromSearch('?room=bad'), null);
  assert.equal(roomFromSearch('?q=low&room=KKKKK'), 'KKKKK');
  assert.equal(roomLink('https://x.github.io/tidal/?q=low&room=OLD12#h', 'ABCD2'), 'https://x.github.io/tidal/?room=ABCD2');
});
test('names are cleaned for the bitmap font', () => {
  assert.equal(cleanName('  <b>Ann</b>  '), 'bAnnb');
  assert.equal(cleanName(''), 'Racer');
  assert.equal(cleanName('a'.repeat(40)).length, 12);
  assert.equal(cleanName('x  y'), 'x y');
});
test('pose packet round trip', () => {
  const p = { id: 3, seq: 70000, t: 123456.789012, pos: [1234.5, -0.25, -987.125], vel: [30, 1.5, -12], yaw: 3.1, pitch: -0.2, roll: 0.4, wet: 0.5, throttle: -1, boosting: true, next: 17 };
  const b = encodePose(p);
  assert.equal(b.byteLength, POSE_BYTES);
  const d = decodePose(b);
  assert.equal(d.id, 3); assert.equal(d.seq, 70000 & 65535); assert.equal(d.t, p.t); assert.equal(d.next, 17); assert.equal(d.boosting, true);
  for (let i = 0; i < 3; i++) { assert.ok(Math.abs(d.pos[i] - p.pos[i]) < 1e-3); assert.ok(Math.abs(d.vel[i] - p.vel[i]) < 1e-5); }
  assert.ok(Math.abs(d.yaw - p.yaw) < 1e-6); assert.ok(Math.abs(d.wet - 0.5) < 0.005); assert.equal(d.throttle, -1);
});
test('pose decode takes views and rejects junk', () => {
  const b = encodePose({ id: 1, seq: 1, t: 5, pos: [0, 0, 0], vel: [0, 0, 0], yaw: 0, pitch: 0, roll: 0, wet: 1, throttle: 0, boosting: false, next: 0 });
  const padded = new Uint8Array(POSE_BYTES + 10); padded.set(new Uint8Array(b), 5);
  assert.equal(decodePose(padded.subarray(5, 5 + POSE_BYTES)).id, 1);
  assert.equal(decodePose(new ArrayBuffer(10)), null);
  assert.equal(decodePose({ t: 'x' }), null);
  assert.equal(decodePose(null), null);
  const bad = new Uint8Array(b.slice(0)); bad[0] = 9;
  assert.equal(decodePose(bad), null);
});
test('sequence numbers wrap', () => {
  assert.ok(seqNewer(5, 4)); assert.ok(!seqNewer(4, 5)); assert.ok(seqNewer(2, 65534)); assert.ok(!seqNewer(65534, 2)); assert.ok(!seqNewer(7, 7));
});
test('ranking: finished first by time, then gates, then distance, leavers last', () => {
  const r = rankPlayers([
    { id: 0, next: 4, dist: 50, fin: null }, { id: 1, next: 4, dist: 20, fin: null }, { id: 2, next: 9, fin: 80.5 },
    { id: 3, next: 2, dist: 10, fin: null, gone: true }, { id: 4, next: 9, fin: 79 }, { id: 5, next: 6, dist: 99, fin: null },
  ]).map((p) => p.id);
  assert.deepEqual(r, [4, 2, 5, 1, 0, 3]);
});
