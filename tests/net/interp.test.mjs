import test from 'node:test';
import assert from 'node:assert/strict';
import { InterpBuffer, wrapAngle } from '../../src/game/net/interp.js';

const S = (t, x, vx = 0, yaw = 0) => ({ t, pos: [x, 0, 0], vel: [vx, 0, 0], yaw, pitch: 0, roll: 0 });

test('constant-velocity motion is reproduced exactly between samples', () => {
  const b = new InterpBuffer();
  for (let i = 0; i < 6; i++) b.push(S(i * 50, i * 50 * 0.03, 30));   // 30 m/s
  for (const t of [10, 55, 120, 199]) {
    const r = b.sample(t);
    assert.equal(r.mode, 'interp');
    assert.ok(Math.abs(r.pos[0] - t * 0.03) < 1e-9, `${t}: ${r.pos[0]}`);
  }
});
test('Hermite follows a curve better than a straight line would', () => {
  const b = new InterpBuffer();
  // x = t^2 (t in s): v = 2t
  const at = (ms) => { const t = ms / 1000; return S(ms, t * t, 2 * t); };
  b.push(at(0)); b.push(at(100));
  const r = b.sample(50);
  assert.ok(Math.abs(r.pos[0] - 0.0025) < 1e-9);   // Hermite is exact for a quadratic; linear gives 0.005
});
test('extrapolates on the last velocity for a short time, then holds', () => {
  const b = new InterpBuffer({ extrapMs: 200 });
  b.push(S(0, 0, 10)); b.push(S(100, 1, 10));
  let r = b.sample(200);
  assert.equal(r.mode, 'extrap'); assert.ok(Math.abs(r.pos[0] - 2) < 1e-9);
  r = b.sample(1000);
  assert.equal(r.mode, 'hold'); assert.ok(Math.abs(r.pos[0] - (1 + 10 * 0.2)) < 1e-9);
});
test('yaw takes the short way round the circle', () => {
  const b = new InterpBuffer();
  b.push(S(0, 0, 0, 3.0)); b.push(S(100, 0, 0, -3.0));
  const y = b.sample(50).yaw;
  assert.ok(Math.abs(wrapAngle(y - Math.PI)) < 0.15, String(y));
});
test('out-of-order and duplicate samples are placed or dropped; the window is bounded', () => {
  const b = new InterpBuffer({ max: 5 });
  b.push(S(0, 0)); b.push(S(200, 2)); assert.ok(b.push(S(100, 1)));
  assert.equal(b.push(S(100, 1)), false);
  assert.equal(b.sample(50).pos[0] > 0, true);
  for (let i = 3; i < 12; i++) b.push(S(i * 100, i));
  assert.equal(b.s.length, 5);
});
test('empty buffer', () => { assert.equal(new InterpBuffer().sample(5).mode, 'none'); });
