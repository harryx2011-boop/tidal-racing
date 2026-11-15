// Clearance checks for the courses against their land (no GL): gates, legs, start slots, scenery.
//   node tools/check-land.mjs
import { COURSES, grid } from '../src/game/courses.js';
import { landFor } from '../src/game/landfield.js';

let bad = 0;
const fail = (m) => { bad++; console.log('  FAIL', m); };
for (const course of COURSES) {
  const f = landFor(course.id), n = course.gates.length;
  console.log(`${course.id}: bake ${f.bakeMs.toFixed(0)} ms, near ${f.nx}x${f.nz} at ${f.dx} m, far ${f.fn}^2 at ${f.fd} m`);
  // a gate: 6 m of water along its line out to 25 m beyond the racing width
  let minGate = 1e9;
  course.gates.forEach((g, i) => {
    let m = 1e9;
    for (let t = -(g.hw + 25); t <= g.hw + 25; t += 2) m = Math.min(m, -f.heightAt(g.c[0] + g.nrm[0] * t, g.c[1] + g.nrm[1] * t));
    minGate = Math.min(minGate, m);
    if (m < 6) fail(`${course.id} gate ${i} has only ${m.toFixed(1)} m of water along its line`);
  });
  // legs: the line between consecutive gates, 5 m of water on it, 3 m across the racing width
  let minLeg = 1e9, minEdge = 1e9, landD = 1e9;
  const last = course.loop ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = course.gates[i], b = course.gates[(i + 1) % n], L = Math.hypot(b.c[0] - a.c[0], b.c[1] - a.c[1]);
    const dx = (b.c[0] - a.c[0]) / L, dz = (b.c[1] - a.c[1]) / L, hw = Math.max(a.hw, b.hw);
    for (let s = 0; s <= L; s += 4) {
      const x = a.c[0] + dx * s, z = a.c[1] + dz * s;
      minLeg = Math.min(minLeg, -f.heightAt(x, z));
      for (const o of [-hw, hw]) minEdge = Math.min(minEdge, -f.heightAt(x - dz * o, z + dx * o));
      // distance to the nearest ground above -0.5 m, looking out to 140 m
      for (let r = 4; r < Math.min(landD, 140); r += 4) for (let k = 0; k < 24; k++) {
        const t = (k / 24) * Math.PI * 2;
        if (f.heightAt(x + Math.cos(t) * r, z + Math.sin(t) * r) > -0.5) { landD = Math.min(landD, r); break; }
      }
    }
  }
  if (minLeg < 5) fail(`${course.id} a leg's centre line has only ${minLeg.toFixed(1)} m of water`);
  if (minEdge < 3) fail(`${course.id} a leg's racing width has only ${minEdge.toFixed(1)} m of water`);
  let minGrid = 1e9;
  for (let slot = 0; slot < 4; slot++) { const p = grid(course, slot); for (const t of [-8, 0, 8]) minGrid = Math.min(minGrid, -f.heightAt(p.x + Math.cos(p.yaw + 1.5708) * t, p.z + Math.sin(p.yaw + 1.5708) * t)); }
  if (minGrid < 6) fail(`${course.id} a start slot has only ${minGrid.toFixed(1)} m of water`);
  console.log(`  gates >= ${minGate.toFixed(1)} m of water over their line +-(hw+25); legs: centre >= ${minLeg.toFixed(1)} m, edges >= ${minEdge.toFixed(1)} m; start slots >= ${minGrid.toFixed(1)} m; land never closer than ${landD >= 140 ? '>140' : landD} m to a leg`);
}
// scenery: everything in water deep enough, and clear of the racing line
const { buildLayout } = await import('../src/game/scenery.js').catch(() => ({}));
if (buildLayout) for (const course of COURSES) {
  const f = landFor(course.id), L = buildLayout(course), n = course.gates.length;
  const lineD = (x, z) => { let m = 1e9; for (let i = 0; i < (course.loop ? n : n - 1); i++) { const a = course.gates[i].c, b = course.gates[(i + 1) % n].c, dx = b[0] - a[0], dz = b[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz))); m = Math.min(m, Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t)); } return m; };
  const items = [];
  const add = (kind, o, need) => items.push({ kind, x: o.x, z: o.z, need });
  if (L.lighthouse) add('lighthouse', L.lighthouse, -1);
  L.beacons.forEach((o) => add('beacon', o, 6));
  if (L.platform) add('platform', L.platform, 15);
  L.spectators.forEach((o) => add(o.kind, o, 6));
  if (L.committee) add('committee', L.committee, 6);
  if (L.breakwater) L.breakwater.path.forEach((p, i) => add('breakwater' + i, { x: p[0], z: p[1] }, i < 2 ? -9 : 1));
  console.log(`${course.id} scenery:`);
  for (const it of items) {
    const d = -f.heightAt(it.x, it.z), ld = lineD(it.x, it.z);
    const ok = it.need < 0 ? (it.need === -1 ? d < 0 : true) : d >= it.need;
    const near = it.kind !== 'committee' && it.kind !== 'breakwater0' && ld < 40;
    if (!ok || near) fail(`${it.kind} at ${it.x.toFixed(0)},${it.z.toFixed(0)}: water ${d.toFixed(1)} m (needs ${it.need}), ${ld.toFixed(0)} m from the racing line`);
  }
  console.log(`  ${items.length} items checked`);
}
console.log(bad ? `${bad} problems` : 'all clear');
process.exit(bad ? 1 : 0);
