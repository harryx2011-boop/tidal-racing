import test from 'node:test';
import assert from 'node:assert/strict';
import { ghostStore, encodeGhost, decodeGhost, ghostPose, GHOST_HZ, GHOST_STRIDE, angDiff } from '../src/game/ghost.js';

const mem = () => { const m = new Map(); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); } }; };
const run = (n, seed = 1) => {
  const g = new Float32Array(n * GHOST_STRIDE);
  let a = seed;
  for (let i = 0; i < g.length; i++) { a = (Math.imul(a, 1664525) + 1013904223) >>> 0; g[i] = (a / 4294967296 - 0.5) * 2000; }
  return g;
};

test('encode and decode round trip, including the largest recording', () => {
  for (const n of [1, 2, 99, 12 * 60 * GHOST_HZ]) {
    const g = run(n, n);
    const back = decodeGhost(encodeGhost(g));
    assert.equal(back.length, g.length);
    assert.ok(Buffer.from(back.buffer).equals(Buffer.from(g.buffer)));
  }
});

test('a sliced recording (a view into a bigger buffer) encodes only its own bytes', () => {
  const big = run(100), part = big.slice(0, 12 * GHOST_STRIDE);
  assert.equal(decodeGhost(encodeGhost(part)).length, 12 * GHOST_STRIDE);
  const view = big.subarray(6 * GHOST_STRIDE, 10 * GHOST_STRIDE);
  assert.ok(Buffer.from(decodeGhost(encodeGhost(view)).buffer).equals(Buffer.from(view.buffer, view.byteOffset, view.byteLength)));
});

test('the store saves and loads a best time with its ghost', () => {
  const st = mem(), s = ghostStore(() => st);
  assert.equal(s.load('circuit', 'calm'), null);
  const g = run(300);
  s.save('circuit', 'calm', 123.45, g);
  const b = s.load('circuit', 'calm');
  assert.equal(b.time, 123.45);
  assert.ok(Buffer.from(b.ghost.buffer).equals(Buffer.from(g.buffer)));
  assert.equal(s.load('circuit', 'storm'), null, 'per condition');
  assert.equal(s.load('oval', 'calm'), null, 'per course');
  assert.ok(s.key('a', 'b').includes('best3'));
});

test('corrupt or foreign storage loads as no best, never throws', () => {
  const good = { time: 50, ghost: encodeGhost(run(5)) };
  const cases = [
    '{nope', '', 'null', '7', '"x"', '[]', '{}',
    JSON.stringify({ time: 50 }),                              // no ghost
    JSON.stringify({ ghost: good.ghost }),                      // no time
    JSON.stringify({ ...good, time: 'fast' }),
    JSON.stringify({ ...good, time: -3 }),
    JSON.stringify({ ...good, time: null }),
    JSON.stringify({ ...good, ghost: '!!!not base64!!!' }),
    JSON.stringify({ ...good, ghost: btoa('abc') }),             // not a multiple of a pose
    JSON.stringify({ ...good, ghost: btoa('') }),
    JSON.stringify({ ...good, ghost: 12 }),
    JSON.stringify({ ...good, ghost: encodeGhost(new Float32Array(6).fill(NaN)) }),
  ];
  for (const raw of cases) {
    const st = mem(); st.m.set('tidal.best3.c.w', raw);
    assert.equal(ghostStore(() => st).load('c', 'w'), null, raw);
  }
  assert.ok(ghostStore(() => ({ getItem: () => JSON.stringify(good) })).load('c', 'w'));
});

test('storage that throws (private mode) is survived', () => {
  const bad = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } };
  const s = ghostStore(() => bad);
  assert.equal(s.load('c', 'w'), null);
  assert.doesNotThrow(() => s.save('c', 'w', 10, run(3)));
  // no localStorage global at all (node)
  const none = ghostStore();
  assert.equal(none.load('c', 'w'), null);
  assert.doesNotThrow(() => none.save('c', 'w', 10, run(3)));
  const throwing = ghostStore(() => { throw new Error('SecurityError'); });
  assert.equal(throwing.load('c', 'w'), null);
  assert.doesNotThrow(() => throwing.save('c', 'w', 1, run(1)));
});

test('ghostPose interpolates position and angles, wrapping yaw the short way', () => {
  const g = new Float32Array([0, 0, 0, 3.0, 0, 0, 10, 2, 20, -3.0, 0.2, 0.4, 20, 4, 40, -2.9, 0.4, 0.8]);
  const out = { pos: [0, 0, 0], yaw: 0, pitch: 0, roll: 0 };
  assert.equal(ghostPose(g, 0, out), true);
  assert.deepEqual(out.pos, [0, 0, 0]);
  assert.equal(ghostPose(g, 0.5 / GHOST_HZ, out), true);
  assert.ok(Math.abs(out.pos[0] - 5) < 1e-9 && Math.abs(out.pos[1] - 1) < 1e-9 && Math.abs(out.pos[2] - 10) < 1e-9);
  // 3.0 to -3.0 rad is 0.283 rad across the wrap (not 6): halfway is about 3.14
  assert.ok(Math.abs(Math.abs(out.yaw) - Math.PI) < 0.01 || Math.abs(out.yaw - (3.0 + 0.2832 / 2)) < 0.01, `yaw ${out.yaw}`);
  assert.ok(Math.abs(out.pitch - 0.1) < 1e-6 && Math.abs(out.roll - 0.2) < 1e-6);
  // the last pose is not interpolated past: the ghost is over
  assert.equal(ghostPose(g, 2 / GHOST_HZ, out), false);
  assert.equal(ghostPose(g, 99, out), false);
  assert.equal(ghostPose(g, -1, out), false);
  assert.equal(ghostPose(g, NaN, out), false);
});

test('angDiff stays within a half turn', () => {
  for (let a = -10; a < 10; a += 0.37) for (let b = -10; b < 10; b += 0.41) {
    const d = angDiff(a, b);
    assert.ok(Math.abs(d) <= Math.PI + 1e-12);
    assert.ok(Math.abs(Math.sin(a - b) - Math.sin(d)) < 1e-9);
  }
});
