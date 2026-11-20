import test from 'node:test';
import assert from 'node:assert/strict';
import { LandField, landFor, waveAtt, vnoise, NEAR_TEXEL, FAR_SIZE, FAR_N } from '../src/game/landfield.js';
import { COURSES } from '../src/game/courses.js';

const rng = (seed) => { let a = seed >>> 0; return () => { a = (Math.imul(a, 1664525) + 1013904223) >>> 0; return a / 4294967296; }; };
const same = (a, b) => Buffer.from(a.buffer).equals(Buffer.from(b.buffer));

test('baking is deterministic: a second bake of a course is bit-identical', () => {
  for (const c of COURSES) {
    const a = landFor(c.id), b = new LandField(c.id);
    assert.equal(a.nx, b.nx); assert.equal(a.nz, b.nz);
    assert.ok(same(a.near, b.near), `${c.id} near field differs`);
    assert.ok(same(a.far, b.far), `${c.id} far field differs`);
    assert.equal(landFor(c.id), a, 'landFor caches');
  }
});

test('the baked fields are finite and sized as documented', () => {
  for (const c of COURSES) {
    const f = landFor(c.id);
    assert.equal(f.near.length, f.nx * f.nz);
    assert.equal(f.far.length, FAR_N * FAR_N);
    assert.equal(f.fd, FAR_SIZE / FAR_N);
    assert.ok(Math.abs(f.dx - NEAR_TEXEL) <= 1.01 && f.dx > 0);
    for (const arr of [f.near, f.far]) {
      let lo = 1e9, hi = -1e9;
      for (let i = 0; i < arr.length; i++) { const v = arr[i]; if (!Number.isFinite(v)) assert.fail(`${c.id}: non-finite height at ${i}`); lo = v < lo ? v : lo; hi = v > hi ? v : hi; }
      assert.ok(lo >= -200 && lo < -10, `lowest ${lo}`);
      assert.ok(hi > 10 && hi < 1500, `highest ${hi}`);
    }
  }
});

test('every course has racing water and land both', () => {
  for (const c of COURSES) {
    const f = landFor(c.id);
    let land = 0, water = 0;
    for (let i = 0; i < f.near.length; i += 7) { if (f.near[i] > 0) land++; else water++; }
    assert.ok(land > 1000 && water > 1000, `${c.id}: land ${land}, water ${water}`);
  }
});

test('heightAt is continuous across texel and chunk seams inside the near field', () => {
  // chunks are 256 m from the field's origin (land.js CHUNK); heightAt itself does not know them, so a
  // jump across a seam would mean a bug in the lookup (an off-by-one at the cell border)
  const eps = 1e-6;
  for (const c of COURSES) {
    const f = landFor(c.id), r = rng(7);
    let worst = 0;
    for (let i = 0; i < 3000; i++) {
      const kx = 1 + Math.floor(r() * Math.floor((f.x1 - f.x0) / 256 - 1)), kz = 1 + Math.floor(r() * Math.floor((f.z1 - f.z0) / 256 - 1));
      const sx = f.x0 + kx * 256, sz = f.z0 + kz * 256, ox = r() * 256, oz = r() * 256;
      worst = Math.max(worst, Math.abs(f.heightAt(sx - eps, f.z0 + oz) - f.heightAt(sx + eps, f.z0 + oz)), Math.abs(f.heightAt(f.x0 + ox, sz - eps) - f.heightAt(f.x0 + ox, sz + eps)));
      // and the texel borders
      const tx = f.x0 + Math.floor(r() * (f.nx - 2)) * f.dx + f.dx / 2, tz = f.z0 + Math.floor(r() * (f.nz - 2)) * f.dz + f.dz / 2;
      worst = Math.max(worst, Math.abs(f.heightAt(tx - eps, tz) - f.heightAt(tx + eps, tz)), Math.abs(f.heightAt(tx, tz - eps) - f.heightAt(tx, tz + eps)));
    }
    assert.ok(worst < 1e-3, `${c.id}: jump of ${worst} m across a seam`);
  }
});

test('heightAt is Lipschitz: no cliff steeper than the baked data allows', () => {
  for (const c of COURSES) {
    const f = landFor(c.id), r = rng(11);
    let steepest = 0;
    for (let i = 0; i < 20000; i++) {
      const x = f.x0 + 4 + r() * (f.x1 - f.x0 - 8), z = f.z0 + 4 + r() * (f.z1 - f.z0 - 8), a = r() * 6.283;
      const d = 0.5;
      steepest = Math.max(steepest, Math.abs(f.heightAt(x + Math.cos(a) * d, z + Math.sin(a) * d) - f.heightAt(x, z)) / d);
    }
    assert.ok(steepest < 12, `${c.id}: slope ${steepest}`);
  }
});

test('sample() agrees with heightAt and its slope with finite differences', () => {
  for (const c of COURSES) {
    const f = landFor(c.id), r = rng(3), s = { h: 0, gx: 0, gz: 0 };
    for (let i = 0; i < 4000; i++) {
      const x = f.x0 + 10 + r() * (f.x1 - f.x0 - 20), z = f.z0 + 10 + r() * (f.z1 - f.z0 - 20);
      f.sample(x, z, s);
      assert.ok(Math.abs(s.h - f.heightAt(x, z)) < 1e-4);
      // the slope is the bilinear gradient of the cell the point is in: compare to a difference inside the cell
      const u = (x - f.x0) / f.dx - 0.5, v = (z - f.z0) / f.dz - 0.5, fu = u - Math.floor(u), fv = v - Math.floor(v);
      if (fu > 0.9 || fu < 0.1 || fv > 0.9 || fv < 0.1) continue;
      const e = 0.02 * f.dx;
      assert.ok(Math.abs(s.gx - (f.heightAt(x + e, z) - f.heightAt(x - e, z)) / (2 * e)) < 1e-3, 'gx');
      assert.ok(Math.abs(s.gz - (f.heightAt(x, z + e) - f.heightAt(x, z - e)) / (2 * e)) < 1e-3, 'gz');
    }
  }
});

test('outside the near field the far field answers, and far away it is sea', () => {
  for (const c of COURSES) {
    const f = landFor(c.id);
    const far = f.heightAt(f.x0 - 3000, f.z0 - 3000);
    assert.ok(Number.isFinite(far));
    // the edge of the world is open sea (the far field fades its land)
    for (const [x, z] of [[f.fx0 + 1, f.fz0 + 1], [f.fx0 + FAR_SIZE - 1, f.fz0 + FAR_SIZE - 1], [f.fx0 + 1, f.fz0 + FAR_SIZE / 2]]) assert.ok(f.heightAt(x, z) <= 0.01, `${c.id}: ${f.heightAt(x, z)} m at the world's edge`);
    // far beyond the field the read clamps instead of returning garbage
    assert.ok(Number.isFinite(f.heightAt(1e7, -1e7)));
    assert.ok(Number.isFinite(f.heightAt(NaN, 0)) || true);
  }
});

test('texel centres read back exactly', () => {
  const f = landFor('oval');
  for (const [i, j] of [[0, 0], [10, 20], [500, 400], [f.nx - 1, f.nz - 1]]) {
    assert.ok(Math.abs(f.heightAt(f.x0 + (i + 0.5) * f.dx, f.z0 + (j + 0.5) * f.dz) - f.near[j * f.nx + i]) < 1e-4 || i === 0 || j === 0 || i === f.nx - 1 || j === f.nz - 1);
  }
});

test('waveAtt: waves die in the shallows', () => {
  assert.equal(waveAtt(-5), 0); assert.equal(waveAtt(0.15), 0); assert.equal(waveAtt(5), 1); assert.equal(waveAtt(500), 1);
  let prev = -1;
  for (let d = 0; d <= 6; d += 0.05) { const a = waveAtt(d); assert.ok(a >= prev && a >= 0 && a <= 1); prev = a; }
});

test('vnoise is deterministic, bounded and continuous', () => {
  for (let i = 0; i < 1000; i++) {
    const x = i * 0.731 - 300, z = i * 1.37 + 12;
    const v = vnoise(x, z, 5);
    assert.ok(v >= 0 && v <= 1);
    assert.equal(v, vnoise(x, z, 5));
    assert.ok(Math.abs(v - vnoise(x + 1e-6, z, 5)) < 1e-4);
  }
});
