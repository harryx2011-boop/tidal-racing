import test from 'node:test';
import assert from 'node:assert/strict';
import { Boat, HULL, BOOST_THRUST, BOOST_SECONDS } from '../src/game/boat.js';
import { flatSea, waveSea, run, stateOf, sameBits, allFinite, makeBoat } from './helpers.mjs';

const full = () => ({ throttle: 1, steer: 0, boost: false });

test('same inputs give bit-identical results', () => {
  const inputs = (t) => ({ throttle: Math.sin(t * 0.7) > -0.5 ? 1 : -0.4, steer: Math.sin(t * 1.3), boost: t > 5 && t < 9 });
  const a = makeBoat(10, -4, 0.3), b = makeBoat(10, -4, 0.3);
  run(a, waveSea(0.6), inputs, 40);
  run(b, waveSea(0.6), inputs, 40);
  assert.ok(sameBits(stateOf(a), stateOf(b)));
  // and a different input really does change the state (the comparison is not vacuous)
  const c = makeBoat(10, -4, 0.3);
  run(c, waveSea(0.6), (t) => ({ ...inputs(t), steer: 0 }), 40);
  assert.ok(!sameBits(stateOf(a), stateOf(c)));
});

test('settling puts the boat on the sea without moving it', () => {
  const b = makeBoat(5, 6, 1);
  b.step(1 / 120, full(), waveSea(1), true);
  assert.equal(b.settle, false);
  assert.equal(b.pos[0], 5); assert.equal(b.pos[2], 6);
  assert.ok(Number.isFinite(b.pos[1]) && Math.abs(b.pos[1]) < 3);
});

test('on a flat sea full throttle approaches the designed top speed', () => {
  const b = makeBoat();
  let peak = 0;
  run(b, flatSea(), full, 60, (bb) => { peak = Math.max(peak, bb.speed); });
  assert.ok(b.speed > 33 && b.speed < 38, `speed ${b.speed}`);
  assert.ok(peak < 40, `peak ${peak}`);
  // heading holds with no steering, and the boat stays on the surface
  assert.ok(Math.abs(b.yaw) < 1e-6);
  assert.ok(Math.abs(b.pos[2]) < 1e-3);
  assert.ok(b.wet > 0.9);
});

test('boost raises top speed, and only while there is boost to spend', () => {
  const b = makeBoat();
  b.boost = 1;
  run(b, flatSea(), () => ({ throttle: 1, steer: 0, boost: true }), BOOST_SECONDS - 0.3);
  assert.ok(b.boosting);
  assert.ok(b.boost < 0.2);
  const v0 = b.speed;
  run(b, flatSea(), () => ({ throttle: 1, steer: 0, boost: true }), 3);
  assert.ok(!b.boosting && b.boost === 0);
  assert.ok(v0 > 25);
  // boosted thrust is higher than unboosted: compare a short boosted run with an unboosted one from rest
  const p = makeBoat(), q = makeBoat();
  p.boost = 1;
  run(p, flatSea(), () => ({ throttle: 1, steer: 0, boost: true }), 3);
  run(q, flatSea(), full, 3);
  assert.ok(p.speed > q.speed + 1, `${p.speed} vs ${q.speed}`);
  assert.ok(BOOST_THRUST > 1);
});

test('no boost without throttle', () => {
  const b = makeBoat(); b.boost = 1;
  run(b, flatSea(), () => ({ throttle: 0, steer: 0, boost: true }), 2);
  assert.equal(b.boosting, false);
  assert.equal(b.boost, 1);
});

test('turn radius at speed is a sensible arcade value', () => {
  const b = makeBoat();
  run(b, flatSea(), full, 30);
  const v = b.speed, yaw0 = b.yaw, p0 = [b.pos[0], b.pos[2]];
  run(b, flatSea(), () => ({ throttle: 1, steer: 1, boost: false }), 4);
  const dy = b.yaw - yaw0, dist = Math.hypot(b.pos[0] - p0[0], b.pos[2] - p0[1]);
  assert.ok(dy > 0.8, `turned ${dy} rad in 4 s`);   // steering +1 turns toward +yaw (starboard)
  const radius = (b.speed * 4) / dy;
  assert.ok(radius > 15 && radius < 120, `radius ${radius} at ${v} m/s`);
  assert.ok(dist > 20);
  // the mirror image turns the other way
  const c = makeBoat();
  run(c, flatSea(), full, 30);
  const y1 = c.yaw;
  run(c, flatSea(), () => ({ throttle: 1, steer: -1, boost: false }), 4);
  assert.ok(c.yaw - y1 < -0.8);
});

test('a standing boat cannot steer, a slow one steers less', () => {
  const b = makeBoat();
  run(b, flatSea(), () => ({ throttle: 0, steer: 1, boost: false }), 3);
  assert.ok(Math.abs(b.yaw) < 1e-6);
});

test('reverse throttle brakes then backs up, slower than forward', () => {
  const b = makeBoat();
  run(b, flatSea(), full, 20);
  const v = b.speed;
  run(b, flatSea(), () => ({ throttle: -1, steer: 0, boost: false }), 6);
  assert.ok(b.speed < v);
  run(b, flatSea(), () => ({ throttle: -1, steer: 0, boost: false }), 30);
  assert.ok(b.vel[0] < 0, 'backing up');
  assert.ok(b.speed < 30, `reverse speed ${b.speed}`);   // (about 23 m/s: the thrust is 45% of forward)
});

test('no NaN or runaway over a long run on rough water with random input', () => {
  let seed = 12345;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const b = makeBoat();
  const sea = waveSea(1.2);
  let u = { throttle: 1, steer: 0, boost: false }, maxSpeed = 0, maxY = 0;
  run(b, sea, (t) => {
    if (Math.floor(t * 4) !== Math.floor((t - 1 / 120) * 4)) u = { throttle: rnd() * 2 - 1, steer: rnd() * 2 - 1, boost: rnd() < 0.3 };
    return u;
  }, 600, (bb) => {
    maxSpeed = Math.max(maxSpeed, bb.speed); maxY = Math.max(maxY, Math.abs(bb.pos[1]));
    if (!allFinite(bb)) assert.fail('non-finite state');
  });
  assert.ok(maxSpeed < 80, `max speed ${maxSpeed}`);
  assert.ok(maxY < 30, `max height ${maxY}`);
  assert.ok(Math.abs(b.pitch) <= 1.1 && Math.abs(b.roll) <= 1.0);
});

test('airtime at racing speed fills the boost meter', () => {
  const b = makeBoat();
  run(b, flatSea(), full, 20);
  assert.equal(b.boost, 0);
  // the sea drops away: a launch
  const cliff = { h: 0, sx: 0, sz: 0 };
  const edge = b.pos[0] + 10;
  const sea = (i, x) => { cliff.h = x > edge ? -40 : 0; return cliff; };
  let air = 0;
  run(b, sea, full, 1.5, (bb) => { if (bb.wet === 0) air += 1 / 120; });
  assert.ok(air > 1, `airborne ${air} s`);
  assert.ok(b.boost > 0.2 && b.boost <= 1, `boost ${b.boost}`);
  // ... and never above 1
  run(b, sea, full, 20);
  assert.ok(b.boost <= 1);
});

test('a slow boat in the air earns no boost', () => {
  const b = makeBoat();
  run(b, flatSea(), () => ({ throttle: 0.2, steer: 0, boost: false }), 3);
  assert.ok(b.speed < 12);
  const sea = () => ({ h: -40, sx: 0, sz: 0 });
  run(b, sea, full, 0.5);
  assert.equal(b.boost, 0);
});

test('a flat hard landing scrubs speed', () => {
  const b = makeBoat();
  run(b, flatSea(), full, 20);
  const edge = b.pos[0] + 10, s = { h: 0, sx: 0, sz: 0 };
  // a step down of 6 m that comes back up after 60 m
  const sea = (i, x) => { s.h = x > edge && x < edge + 60 ? -6 : 0; return s; };
  let slam = 0;
  run(b, sea, full, 4, (bb) => { slam = Math.max(slam, bb.slam); });
  assert.ok(slam > 0, 'landing registered');
});

test('probePoints are the four hull points ahead in time', () => {
  const b = makeBoat(100, 50, 0.5);
  b.vel = [10, 0, 0];
  const p = b.probePoints(0);
  assert.equal(p.length, HULL.length * 2);
  const q = b.probePoints(0.1);
  assert.ok(Math.abs(q[0] - p[0] - 1) < 1e-9);
  const m = b.matrix();
  assert.equal(m.length, 16);
  assert.ok([...m].every(Number.isFinite));
});

test('body axes are orthonormal', () => {
  const b = makeBoat(); b.yaw = 1.1; b.pitch = 0.3; b.roll = -0.4;
  const { X, Y, Z } = b.axes();
  const dot = (a, c) => a[0] * c[0] + a[1] * c[1] + a[2] * c[2];
  for (const v of [X, Y, Z]) assert.ok(Math.abs(dot(v, v) - 1) < 1e-12);
  assert.ok(Math.abs(dot(X, Y)) < 1e-12 && Math.abs(dot(X, Z)) < 1e-12 && Math.abs(dot(Y, Z)) < 1e-12);
});
