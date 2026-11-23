import test from 'node:test';
import assert from 'node:assert/strict';
import { COURSES, Progress, grid, CONDITIONS, TIMES, rollConditions, sunFor } from '../src/game/courses.js';
import { landFor } from '../src/game/landfield.js';

// drive straight through gate i's centre, from 10 m before to 10 m after
const cross = (P, g, lateral = 0, dir = 1, dt = 1 / 60) => {
  const a = [g.c[0] - g.dir[0] * 10 * dir + g.nrm[0] * lateral, g.c[1] - g.dir[1] * 10 * dir + g.nrm[1] * lateral];
  const b = [g.c[0] + g.dir[0] * 10 * dir + g.nrm[0] * lateral, g.c[1] + g.dir[1] * 10 * dir + g.nrm[1] * lateral];
  return P.advance(a, b, dt);
};

test('every gate is well formed', () => {
  for (const c of COURSES) {
    assert.ok(c.gates.length >= 6);
    for (const g of c.gates) {
      assert.ok(Math.abs(Math.hypot(...g.dir) - 1) < 1e-9);
      assert.ok(Math.abs(g.dir[0] * g.nrm[0] + g.dir[1] * g.nrm[1]) < 1e-9, 'nrm is perpendicular to dir');
      assert.ok(Math.abs(Math.hypot(g.port[0] - g.stbd[0], g.port[1] - g.stbd[1]) - 2 * g.hw) < 1e-9);
      // starboard (+nrm) is to the right of the direction of travel in a z-down plan: dir x nrm has the sign of +1
      assert.ok(g.dir[0] * g.nrm[1] - g.dir[1] * g.nrm[0] > 0.99);
    }
    assert.equal(c.total, c.loop ? c.laps * c.gates.length + 1 : c.gates.length);
  }
});

test('gate crossing counts forward crossings inside the marks only', () => {
  for (const c of COURSES) {
    const g = c.gates[0];
    let P = new Progress(c);
    assert.equal(cross(P, g, 0, -1), null, 'backwards across the line');
    assert.equal(P.next, 0);
    assert.equal(cross(P, g, g.hw + 5), null, 'outside the marks');
    assert.equal(P.next, 0);
    assert.ok(P.missed > 0, 'a near miss is remembered for the HUD');
    P = new Progress(c);
    assert.equal(cross(P, g, g.hw + 400), null, 'far outside is not even a near miss');
    assert.equal(P.missed, 0);
    P = new Progress(c);
    assert.equal(cross(P, g, g.hw - 1), 'gate');
    assert.equal(P.next, 1);
    // the same line again does nothing: it is not the next gate
    assert.equal(cross(P, g), null);
    assert.equal(P.next, 1);
  }
});

test('a boat that has not moved, or moves along the line, does not cross', () => {
  const c = COURSES[0], g = c.gates[0], P = new Progress(c);
  assert.equal(P.advance([g.c[0] - 5 * g.dir[0], g.c[1] - 5 * g.dir[1]], [g.c[0] - 5 * g.dir[0], g.c[1] - 5 * g.dir[1]], 1 / 60), null);
  // moving along the line, 2 m short of it
  const along = [g.nrm[0] * 8, g.nrm[1] * 8], back = [-g.dir[0] * 2, -g.dir[1] * 2];
  assert.equal(P.advance([g.c[0] - along[0] + back[0], g.c[1] - along[1] + back[1]], [g.c[0] + along[0] + back[0], g.c[1] + along[1] + back[1]], 1 / 60), null);
  // a step that starts exactly on the line does not count (s0 < 0 is required): the crossing was the step before
  assert.equal(P.advance([g.c[0], g.c[1]], [g.c[0] + g.dir[0], g.c[1] + g.dir[1]], 1 / 60), null);
});

test('skipped gates do not count and the right one still does', () => {
  const c = COURSES[0], P = new Progress(c);
  assert.equal(cross(P, c.gates[0]), 'gate');
  assert.equal(cross(P, c.gates[2]), null, 'gate 2 before gate 1');
  assert.equal(P.next, 1);
  assert.equal(cross(P, c.gates[1]), 'gate');
  assert.equal(cross(P, c.gates[2]), 'gate');
  assert.equal(P.next, 3);
});

test('wrong-way flag decays with time', () => {
  const c = COURSES[0], g = c.gates[0], P = new Progress(c);
  cross(P, g, g.hw + 10);
  assert.equal(P.missed, 4);
  P.advance([0, 0], [0, 0], 1.5);
  assert.ok(Math.abs(P.missed - 2.5) < 1e-9);
  P.advance([0, 0], [0, 0], 10);
  assert.equal(P.missed, 0);
});

test('a full race counts every lap and finishes', () => {
  for (const c of COURSES) {
    const P = new Progress(c), n = c.gates.length, events = [];
    for (let k = 0; k < c.total; k++) {
      assert.ok(!P.done);
      const ev = cross(P, c.gates[k % n]);
      events.push(ev);
      assert.equal(P.next, k + 1);
    }
    assert.ok(P.done);
    assert.equal(events[events.length - 1], 'finish');
    assert.equal(events.filter((e) => e === 'finish').length, 1);
    assert.equal(events.filter((e) => e === 'lap').length, c.loop ? c.laps - 1 : 0);
    assert.equal(events.filter((e) => e === 'gate').length, c.total - 1 - (c.loop ? c.laps - 1 : 0));
    // nothing more happens once it is done
    assert.equal(cross(P, c.gates[0]), null);
    assert.equal(P.next, c.total);
  }
});

test('lap number follows the gates', () => {
  const c = COURSES[0], P = new Progress(c), n = c.gates.length;
  assert.equal(P.lap, 1);
  for (let k = 0; k < c.total - 1; k++) {
    cross(P, c.gates[k % n]);
    assert.equal(P.lap, Math.min(Math.floor(Math.max(P.next - 1, 0) / n) + 1, c.laps));
  }
  assert.equal(P.lap, c.laps);
  const sprint = COURSES.find((x) => !x.loop);
  assert.equal(new Progress(sprint).lap, 1);
});

test('reset goes to the last gate passed, facing along it', () => {
  for (const c of COURSES) {
    const P = new Progress(c), n = c.gates.length;
    const g0 = grid(c);
    const r0 = P.respawn();
    assert.deepEqual(r0, g0);
    for (let k = 0; k < Math.min(c.total - 1, 2 * n + 3); k++) {
      cross(P, c.gates[k % n]);
      const r = P.respawn(), g = c.gates[k % n];
      assert.equal(r.x, g.c[0]); assert.equal(r.z, g.c[1]);
      assert.ok(Math.abs(Math.cos(r.yaw) - g.dir[0]) < 1e-12 && Math.abs(Math.sin(r.yaw) - g.dir[1]) < 1e-12);
    }
  }
});

test('grid slots are distinct, behind the line, and in deep water', () => {
  for (const c of COURSES) {
    const f = landFor(c.id), g = c.gates[0], pts = [];
    for (let slot = 0; slot < 8; slot++) {
      const s = grid(c, slot);
      pts.push(s);
      assert.ok(Number.isFinite(s.x) && Number.isFinite(s.z) && Number.isFinite(s.yaw));
      const along = (s.x - g.c[0]) * g.dir[0] + (s.z - g.c[1]) * g.dir[1];
      assert.ok(along < -20, `${c.id} slot ${slot} is ${along} m from the line`);
      assert.ok(Math.abs((s.x - g.c[0]) * g.nrm[0] + (s.z - g.c[1]) * g.nrm[1]) <= g.hw, 'between the marks');
      assert.ok(-f.heightAt(s.x, s.z) > 4, `${c.id} slot ${slot} in only ${-f.heightAt(s.x, s.z)} m of water`);
      // a starting boat is 7 m long: clear water all round it
      for (const [dx, dz] of [[4, 0], [-4, 0], [0, 2], [0, -2]]) assert.ok(-f.heightAt(s.x + Math.cos(s.yaw) * dx - Math.sin(s.yaw) * dz, s.z + Math.sin(s.yaw) * dx + Math.cos(s.yaw) * dz) > 3);
    }
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) assert.ok(Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z) >= 7, `${c.id} slots ${i} and ${j} overlap`);
    // the start of a race is behind gate 0 so that the first crossing is gate 0 itself
    const P = new Progress(c), s = grid(c);
    assert.equal(P.advance([s.x, s.z], [g.c[0] + g.dir[0], g.c[1] + g.dir[1]], 1 / 60), 'gate');
  }
});

test('every course starts on a clear line: gates in water, legs between gates in water', () => {
  for (const c of COURSES) {
    const f = landFor(c.id), n = c.gates.length;
    for (const g of c.gates) {
      for (const p of [g.c, g.port, g.stbd]) assert.ok(-f.heightAt(p[0], p[1]) > 3, `${c.id} gate ${g.number} has no water at ${p}`);
    }
    for (let i = 0; i < (c.loop ? n : n - 1); i++) {
      const a = c.gates[i].c, b = c.gates[(i + 1) % n].c, L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let t = 0; t <= L; t += 10) assert.ok(-f.heightAt(a[0] + (b[0] - a[0]) * t / L, a[1] + (b[1] - a[1]) * t / L) > 5, `${c.id} leg ${i} at ${t} m`);
    }
  }
});

test('seeded conditions are deterministic and valid', () => {
  const seen = new Set(), tods = new Set();
  for (let seed = 0; seed < 400; seed++) {
    const a = rollConditions(seed), b = rollConditions(seed);
    assert.deepEqual(a, b);
    assert.ok(a.id in CONDITIONS && a.tod in TIMES);
    seen.add(a.id); tods.add(a.tod);
    for (const c of COURSES) for (const [cond, tod, rolled] of [['calm', 'day', false], ['storm', 'sunset', false], ['rough', 'day', true], ['breeze', 'sunrise', true]]) {
      const s1 = sunFor(c, cond, tod, seed, rolled), s2 = sunFor(c, cond, tod, seed, rolled);
      assert.deepEqual(s1, s2);
      assert.ok(s1.length === 2 && s1.every(Number.isFinite));
    }
  }
  assert.deepEqual([...seen].sort(), Object.keys(CONDITIONS).sort(), 'every sea state can be rolled');
  assert.deepEqual([...tods].sort(), Object.keys(TIMES).sort());
  // different seeds differ somewhere
  assert.notDeepEqual(rollConditions(1), rollConditions(2) && { id: 'x', tod: 'y' });
  assert.ok(new Set(Array.from({ length: 50 }, (_, i) => sunFor(COURSES[0], 'breeze', 'day', i, true)[0])).size > 1);
});

test('low suns sit within their documented elevation range, away from the heading', () => {
  const c = COURSES[0], g = c.gates[0], heading = Math.atan2(g.dir[1], g.dir[0]) * 180 / Math.PI;
  for (let seed = 0; seed < 100; seed++) {
    for (const tod of ['sunrise', 'sunset']) {
      const [el, az] = sunFor(c, 'breeze', tod, seed);
      assert.ok(el >= TIMES[tod].elev[0] && el <= TIMES[tod].elev[1]);
      const off = (az - heading) * TIMES[tod].side;
      assert.ok(off >= 22 - 1e-9 && off <= 48 + 1e-9, `${tod} ${off}`);
    }
  }
  assert.deepEqual(sunFor(c, 'calm', 'day', 5, false), CONDITIONS.calm.sun);
});
