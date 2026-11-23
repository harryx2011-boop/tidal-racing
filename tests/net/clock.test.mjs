import test from 'node:test';
import assert from 'node:assert/strict';
import { ClockSync, NetClock } from '../../src/game/net/clock.js';

// simulate a client whose clock is `off` ms behind the host, with one-way delays d1 (up) and d2 (down)
const ping = (cs, c0, off, d1, d2) => { const h = c0 + d1 + off; cs.add(c0, h, c0 + d1 + d2); };

test('symmetric delay: the offset is exact', () => {
  const cs = new ClockSync();
  for (let i = 0; i < 6; i++) ping(cs, 1000 + i * 100, 5000, 20, 20);
  const e = cs.estimate();
  assert.ok(Math.abs(e.offset - 5000) < 1e-9);
  assert.equal(e.rtt, 40);
});
test('jittery delays: the estimate stays within the best round trip of the truth', () => {
  let a = 7; const rnd = () => (a = (a * 1664525 + 1013904223) >>> 0) / 4294967296;
  const cs = new ClockSync();
  for (let i = 0; i < 12; i++) ping(cs, 1000 + i * 100, -3200, 15 + rnd() * 60, 15 + rnd() * 60);
  const e = cs.estimate();
  assert.ok(Math.abs(e.offset + 3200) <= e.error + 1e-9, `off ${e.offset} err ${e.error}`);
  assert.ok(Math.abs(e.offset + 3200) < 25);
});
test('queueing spikes do not drag the estimate: best-half median', () => {
  const cs = new ClockSync();
  for (let i = 0; i < 6; i++) ping(cs, 100 * i, 800, 20, 20);
  for (let i = 0; i < 4; i++) ping(cs, 700 + 100 * i, 800, 20, 400);   // asymmetric bursts
  assert.ok(Math.abs(cs.estimate().offset - 800) < 1);
});
test('needs a minimum of samples; ignores nonsense', () => {
  const cs = new ClockSync();
  cs.add(10, 5, 8);        // negative rtt
  cs.add(1, NaN, 5);
  assert.equal(cs.count, 0);
  ping(cs, 0, 1, 5, 5); ping(cs, 10, 1, 5, 5);
  assert.equal(cs.estimate(), null);
  ping(cs, 20, 1, 5, 5);
  assert.ok(cs.estimate());
});
test('NetClock: virtual time moves only on tick; host time follows the offset; later samples slew', () => {
  const c = new NetClock({ virtual: true, base: 500 });
  assert.equal(c.local(), 500);
  c.tick(0.25);
  assert.equal(c.local(), 750);
  for (let i = 0; i < 3; i++) c.addSample(750, 750 + 1000 + 10, 770);
  assert.ok(Math.abs(c.offset - 1000) < 1e-9);
  assert.equal(c.host(), 1750);
  c.addSample(750, 750 + 1100 + 10, 770);   // the best-half median holds, and the step is slewed anyway
  assert.ok(Math.abs(c.offset - 1000) < 40);
});
