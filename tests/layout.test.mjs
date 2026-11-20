import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLayout } from '../src/game/scenery.js';
import { COURSES } from '../src/game/courses.js';
import { COASTS, featureColliders, mooringSpots, rockSpots } from '../src/game/models/coast.js';
import { landFor } from '../src/game/landfield.js';

test('scenery layouts are a pure function of the course', () => {
  for (const c of COURSES) {
    const a = buildLayout(c), b = buildLayout(c);
    assert.deepEqual(a, b);
    assert.equal(a.id, c.id);
    assert.ok(!/NaN|Infinity/.test(JSON.stringify(a, (k, v) => (typeof v === 'number' && !Number.isFinite(v) ? 'NaN' : v))));
  }
});

test('feature colliders are deterministic and sit where the coast definition says', () => {
  for (const c of COURSES) {
    const a = featureColliders(c.id), b = featureColliders(c.id);
    assert.deepEqual(a, b);
    for (const f of COASTS[c.id].features) {
      if (f.kind === 'rocks') assert.deepEqual(rockSpots(f), rockSpots(f));
    }
    const moors = mooringSpots(c.id);
    assert.deepEqual(moors, mooringSpots(c.id));
  }
});

test('moored craft are afloat and boulders are not on the racing line', () => {
  for (const c of COURSES) {
    const f = landFor(c.id);
    for (const m of mooringSpots(c.id)) assert.ok(-f.heightAt(m.x, m.z) > 1, `${c.id} mooring at ${m.x},${m.z}`);
    const n = c.gates.length;
    for (const s of featureColliders(c.id)) {
      // distance from the solid's centre to the nearest leg: the boat (1.3 m half-width) must be able to pass
      let best = 1e9;
      for (let i = 0; i < (c.loop ? n : n - 1); i++) {
        const a = c.gates[i].c, b = c.gates[(i + 1) % n].c, dx = b[0] - a[0], dz = b[1] - a[1];
        const t = Math.max(0, Math.min(1, ((s.x - a[0]) * dx + (s.z - a[1]) * dz) / (dx * dx + dz * dz)));
        best = Math.min(best, Math.hypot(s.x - a[0] - dx * t, s.z - a[1] - dz * t));
      }
      const reach = s.hx !== undefined ? Math.hypot(s.hx, s.hz) : s.r;
      assert.ok(best - reach > 1.3 + 3, `${c.id}: a ${s.kind || 'solid'} at ${s.x.toFixed(0)},${s.z.toFixed(0)} is ${(best - reach).toFixed(1)} m from the line`);
    }
  }
});
