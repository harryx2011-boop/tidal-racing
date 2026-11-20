import test from 'node:test';
import assert from 'node:assert/strict';
import { Collisions } from '../src/game/collide.js';
import { landFor } from '../src/game/landfield.js';
import { COURSES } from '../src/game/courses.js';
import { featureColliders } from '../src/game/models/coast.js';
import { fakeGame } from './helpers.mjs';

const CAP = [[3.0, 1.25], [0, 1.35], [-3.0, 1.25]];
const mkBoat = (x, z, yaw, speed = 0) => ({ pos: [x, 0.2, z], vel: [Math.cos(yaw) * speed, 0, Math.sin(yaw) * speed], yaw, ground: 0 });
// the gap between the hull's three circles and a circle or box solid (negative: overlapping)
function gap(c, b) {
  const cy = Math.cos(b.yaw), sy = Math.sin(b.yaw);
  let g = 1e9;
  for (const [ax, R] of CAP) {
    const x = b.pos[0] + cy * ax, z = b.pos[2] + sy * ax;
    if (c.hx === undefined) g = Math.min(g, Math.hypot(x - c.x, z - c.z) - c.r - R);
    else {
      const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw), dx = x - c.x, dz = z - c.z;
      const lx = cs * dx + sn * dz, lz = -sn * dx + cs * dz;
      g = Math.min(g, Math.hypot(Math.max(Math.abs(lx) - c.hx, 0), Math.max(Math.abs(lz) - c.hz, 0)) - R);
    }
  }
  return g;
}
// a synthetic coast: deep water for x < 100, then a beach rising 0.6 m per metre (the waterline at x = 150)
const beach = {
  heightAt: (x) => (x < 100 ? -30 : -30 + (x - 100) * 0.6),
  sample(x, z, out) { out.h = this.heightAt(x); out.gx = x < 100 ? 0 : 0.6; out.gz = 0; return out; },
};
const deep = { heightAt: () => -30, sample(x, z, out) { out.h = -30; out.gx = 0; out.gz = 0; return out; } };

test('open water does nothing', () => {
  const col = new Collisions(fakeGame(deep));
  const b = mkBoat(0, 0, 0.7, 30), v = [...b.vel], p = [...b.pos];
  col.step(b, 1 / 120);
  assert.deepEqual(b.vel, v); assert.deepEqual(b.pos, p);
  assert.equal(b.ground, 0); assert.equal(col.hits, 0);
});

test('a circle (a buoy) pushes the boat out and takes the closing speed', () => {
  const buoy = { x: 50, z: 0, r: 1.5 };
  const col = new Collisions(fakeGame(deep, [buoy]));
  // bow overlapping: boat centre 3 m short of the buoy, heading at it
  const b = mkBoat(46, 0.2, 0, 20);   // the bow circle (3 m ahead of the centre) is inside the buoy
  assert.ok(gap(buoy, b) < 0);
  col.step(b, 1 / 120);
  assert.equal(col.hits > 0, true);
  assert.ok(gap(buoy, b) > -1e-6, `gap ${gap(buoy, b)}`);
  assert.ok(b.vel[0] <= 0, 'the closing speed is gone (a little bounce back)');
  assert.ok(b.vel[0] >= -0.31 * 20 - 1e-9, 'bounce is at most 30%');
  assert.ok(b.pos.every(Number.isFinite));
});

test('a boat heading away from a solid keeps its speed', () => {
  const buoy = { x: 0, z: 0, r: 2 };
  const col = new Collisions(fakeGame(deep, [buoy]));
  const b = mkBoat(2, 0, 0, 20);   // overlapping but leaving
  b.pos[0] = 4.9;
  col.step(b, 1 / 120);
  assert.ok(b.vel[0] >= 20 - 1e-9);
});

test('a box (pier) pushes out from the side, the end and from inside', () => {
  const pier = { x: 0, z: 0, hx: 40, hz: 3, yaw: 0.4 };
  const col = new Collisions(fakeGame(deep, [pier]));
  const cs = Math.cos(0.4), sn = Math.sin(0.4);
  const local = (lx, lz) => [pier.x + cs * lx - sn * lz, pier.z + sn * lx + cs * lz];
  // broadside, 3 m off the side, heading into it
  for (const [lx, lz, h] of [[0, 6, -Math.PI / 2], [0, -6, Math.PI / 2], [43.5, 0, Math.PI], [-43.5, 0, 0], [0, 0.5, 0]]) {
    const [x, z] = local(lx, lz);
    const b = mkBoat(x, z, 0.4 + h, 12);
    col.step(b, 1 / 120);
    assert.ok(col.hits > 0, `no hit at ${lx},${lz}`);
    assert.ok(gap(pier, b) > -0.05, `${lx},${lz} gap ${gap(pier, b)}`);
    assert.ok(b.pos.every(Number.isFinite) && b.vel.every(Number.isFinite));
  }
});

test('a hard drive into a pier never ends inside it', () => {
  const pier = { x: 0, z: 0, hx: 30, hz: 2.5, yaw: 0 };
  const col = new Collisions(fakeGame(deep, [pier]));
  for (const yaw of [-Math.PI / 2, Math.PI / 2, 2.4, -2.4, Math.PI]) {
    const b = mkBoat(Math.cos(yaw + Math.PI) * 60, Math.sin(yaw + Math.PI) * 60, yaw, 0);
    // aim at the middle
    b.yaw = Math.atan2(-b.pos[2], -b.pos[0]);
    let worst = 1e9;
    for (let i = 0; i < 120 * 8; i++) {
      const a = 9;
      b.vel[0] += Math.cos(b.yaw) * a / 120; b.vel[2] += Math.sin(b.yaw) * a / 120;
      b.pos[0] += b.vel[0] / 120; b.pos[2] += b.vel[2] / 120;
      col.step(b, 1 / 120);
      worst = Math.min(worst, gap(pier, b));
    }
    assert.ok(worst > -0.3, `yaw ${yaw}: ${worst}`);
  }
});

test('grounding: a beach stops the boat short of dry land and slides it back', () => {
  const col = new Collisions(fakeGame(beach));
  const b = mkBoat(60, 0, 0, 25);
  let maxX = 0, grounded = false;
  for (let i = 0; i < 120 * 12; i++) {
    b.pos[0] += b.vel[0] / 120; b.pos[2] += b.vel[2] / 120;
    col.step(b, 1 / 120);
    maxX = Math.max(maxX, b.pos[0]);
    if (b.ground > 0) grounded = true;
    // (thrust toward the shore, the player holding the throttle down)
    b.vel[0] += 9 / 120;
  }
  assert.ok(grounded);
  assert.ok(beach.heightAt(maxX) < 1, `the hull centre reached ${beach.heightAt(maxX)} m up the beach`);
  assert.ok(maxX < 150, `reached x ${maxX}`);
  assert.ok(b.pos.every(Number.isFinite) && b.vel.every(Number.isFinite));
});

test('grounding fades once the boat is afloat again', () => {
  const col = new Collisions(fakeGame(beach));
  const b = mkBoat(152, 0, Math.PI, 0);
  col.step(b, 1 / 120);
  assert.ok(b.ground > 0);
  b.pos[0] = 20;
  for (let i = 0; i < 60; i++) col.step(b, 1 / 120);
  assert.equal(b.ground, 0);
});

test('a boat on a flat plateau is sent toward the water', () => {
  // flat land at 5 m everywhere except water west of x = -200
  const f = { heightAt: (x) => (x < -200 ? -30 : 5), sample(x, z, out) { out.h = this.heightAt(x); out.gx = 0; out.gz = 0; return out; } };
  const col = new Collisions(fakeGame(f));
  const b = mkBoat(-150, 0, 0, 0);   // (the search for water reaches 60 m)
  for (let i = 0; i < 120 * 20; i++) { col.step(b, 1 / 120); b.pos[0] += b.vel[0] / 120; b.pos[2] += b.vel[2] / 120; }
  assert.ok(b.pos[0] < -150, `moved to ${b.pos[0]}`);
});

test('real coasts: driving at the nearest land from every gate never puts the hull centre ashore', () => {
  for (const c of COURSES) {
    const field = landFor(c.id), col = new Collisions(fakeGame(field, [], c));
    for (const g of c.gates.filter((_, i) => i % 3 === 0)) {
      let aim = null;
      for (let r = 10; r < 500 && aim === null; r += 6) for (let k = 0; k < 72; k++) { const t = (k / 72) * Math.PI * 2; if (field.heightAt(g.c[0] + Math.cos(t) * r, g.c[1] + Math.sin(t) * r) > 0.3) { aim = t; break; } }
      if (aim === null) continue;
      const b = mkBoat(g.c[0], g.c[1], aim, 0);
      let high = -1e9;
      for (let i = 0; i < 120 * 25; i++) {
        const s = Math.hypot(...b.vel), a = 9 - 0.05 * s - 0.006 * s * s;
        b.vel[0] += Math.cos(b.yaw) * a / 120; b.vel[2] += Math.sin(b.yaw) * a / 120;
        b.pos[0] += b.vel[0] / 120; b.pos[2] += b.vel[2] / 120;
        col.step(b, 1 / 120);
        high = Math.max(high, field.heightAt(b.pos[0], b.pos[2]));
        assert.ok(Number.isFinite(b.pos[0]) && Math.hypot(...b.vel) < 60);
      }
      assert.ok(high < 0.5, `${c.id} gate ${g.number}: hull centre ${high} m up the shore`);
    }
  }
});

test('the course feature solids exist and are well formed', () => {
  for (const c of COURSES) {
    const list = featureColliders(c.id);
    assert.ok(list.length > 0);
    for (const s of list) {
      assert.ok(Number.isFinite(s.x) && Number.isFinite(s.z));
      if (s.hx === undefined) assert.ok(s.r > 0); else assert.ok(s.hx > 0 && s.hz > 0 && Number.isFinite(s.yaw));
    }
  }
});

test('stacking solids is stable: no NaN with a boat wedged between two buoys', () => {
  const a = { x: 0, z: -2.5, r: 1.5 }, bb = { x: 0, z: 2.5, r: 1.5 };
  const col = new Collisions(fakeGame(deep, [a, bb]));
  const b = mkBoat(-3, 0, 0, 15);
  for (let i = 0; i < 600; i++) { b.vel[0] += 0.05; b.pos[0] += b.vel[0] / 120; b.pos[2] += b.vel[2] / 120; col.step(b, 1 / 120); }
  assert.ok(b.pos.every(Number.isFinite) && b.vel.every(Number.isFinite));
});
