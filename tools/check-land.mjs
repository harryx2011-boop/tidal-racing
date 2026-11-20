// Checks for the courses against their land and features (no GL):
//   node tools/check-land.mjs
// The racing line is meant to hug the coast now, so land and features are allowed within 20 to 40 m of a
// leg. What is checked is that the line itself is in deep water, that gates have water across the racing
// width, that features stand where they should (piers rooted ashore, moorings afloat) and clear of the
// line, and how much of a lap is spent close to something (reported per course, with the closest passes).
import { COURSES, grid } from '../src/game/courses.js';
import { landFor } from '../src/game/landfield.js';
import { COASTS, featureColliders, mooringSpots } from '../src/game/models/coast.js';

let bad = 0;
const fail = (m) => { bad++; console.log('  FAIL', m); };
const MIN_CLEAR = 14;          // metres from the centre line to the surface of any solid (hull is 1.3 m half-width)
const NEAR = 40, WIDE = 80;    // the close-pass and "near the coast" distances
const MERGE = 60;              // runs of close passing closer than this along the line are one pass

// distance from a point to a collider's surface (circle or oriented box); 0 inside
function solidDist(c, x, z) {
  if (c.hx === undefined) return Math.max(Math.hypot(x - c.x, z - c.z) - c.r, 0);
  const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw), dx = x - c.x, dz = z - c.z;
  const lx = cs * dx + sn * dz, lz = -sn * dx + cs * dz;
  return Math.hypot(Math.max(Math.abs(lx) - c.hx, 0), Math.max(Math.abs(lz) - c.hz, 0));
}

const sceneryMod = await import('../src/game/scenery.js').catch(() => ({}));
const planMod = await import('../src/game/models/coastplan.js').catch(() => ({}));
const villageMod = await import('../src/game/models/village.js').catch(() => ({}));
const structMod = await import('../src/game/models/structures.js').catch(() => ({}));
const { buildLayout } = sceneryMod;

for (const course of COURSES) {
  const f = landFor(course.id), n = course.gates.length, def = COASTS[course.id];
  console.log(`${course.id}: bake ${f.bakeMs.toFixed(0)} ms, near ${f.nx}x${f.nz} at ${f.dx} m, far ${f.fn}^2 at ${f.fd} m`);
  // a gate: 6 m of water across most of its racing width, 3 m under the marks and for 3 m beyond them (the shore may stand just outside)
  let minGate = 1e9;
  course.gates.forEach((g, i) => {
    let m = 1e9, mo = 1e9;
    for (let t = -(g.hw + 3); t <= g.hw + 3; t += 1) {
      const w = -f.heightAt(g.c[0] + g.nrm[0] * t, g.c[1] + g.nrm[1] * t);
      if (Math.abs(t) <= g.hw * 0.8) m = Math.min(m, w); else mo = Math.min(mo, w);
    }
    minGate = Math.min(minGate, m);
    if (m < 6) fail(`${course.id} gate ${i} has only ${m.toFixed(1)} m of water across its racing width`);
    if (mo < 3) fail(`${course.id} gate ${i} has only ${mo.toFixed(1)} m of water under or beyond its marks`);
  });
  // legs: the line between consecutive gates, 5 m of water on it, 3 m across the racing width
  let minLeg = 1e9, minEdge = 1e9;
  const last = course.loop ? n : n - 1;
  const samples = [];      // { x, z, s } along one lap every 4 m
  let s = 0;
  for (let i = 0; i < last; i++) {
    const a = course.gates[i], b = course.gates[(i + 1) % n], L = Math.hypot(b.c[0] - a.c[0], b.c[1] - a.c[1]);
    const dx = (b.c[0] - a.c[0]) / L, dz = (b.c[1] - a.c[1]) / L, hw = Math.max(a.hw, b.hw);
    for (let t = 0; t <= L; t += 4) {
      const x = a.c[0] + dx * t, z = a.c[1] + dz * t;
      minLeg = Math.min(minLeg, -f.heightAt(x, z));
      for (const o of [-hw, hw]) minEdge = Math.min(minEdge, -f.heightAt(x - dz * o, z + dx * o));
      samples.push({ x, z, s: s + t, leg: i });
    }
    s += L;
  }
  if (minLeg < 5) fail(`${course.id} a leg's centre line has only ${minLeg.toFixed(1)} m of water`);
  if (minEdge < 3) fail(`${course.id} a leg's racing width has only ${minEdge.toFixed(1)} m of water`);
  let minGrid = 1e9;
  for (let slot = 0; slot < 4; slot++) { const p = grid(course, slot); for (const t of [-8, 0, 8]) minGrid = Math.min(minGrid, -f.heightAt(p.x + Math.cos(p.yaw + 1.5708) * t, p.z + Math.sin(p.yaw + 1.5708) * t)); }
  if (minGrid < 6) fail(`${course.id} a start slot has only ${minGrid.toFixed(1)} m of water`);
  console.log(`  gates >= ${minGate.toFixed(1)} m of water across the racing width; legs: centre >= ${minLeg.toFixed(1)} m, edges >= ${minEdge.toFixed(1)} m; start slots >= ${minGrid.toFixed(1)} m`);

  // ---- features ----
  const feats = def.features || [];
  const kinds = {};
  for (const ft of feats) kinds[ft.kind] = (kinds[ft.kind] || 0) + 1;
  console.log('  features: ' + (feats.length ? Object.entries(kinds).map(([k, v]) => `${k} ${v}`).join(', ') : 'none'));
  for (const ft of feats) {
    const tag = `${course.id} ${ft.kind} at ${ft.x},${ft.z}`;
    if (ft.kind === 'pier') {
      const cs = Math.cos(ft.yaw), sn = Math.sin(ft.yaw);
      const root = f.heightAt(ft.x, ft.z), tip = -f.heightAt(ft.x + cs * ft.len, ft.z + sn * ft.len);
      if (root < 0.3) fail(`${tag}: root is not on land (height ${root.toFixed(1)} m)`);
      if (tip < 2.5) fail(`${tag}: tip has only ${tip.toFixed(1)} m of water`);
      // it must cross the shore once: land at the root, water beyond, never back on land after the shore
      let wet = false;
      for (let t = 0; t <= ft.len; t += 2) { const h = f.heightAt(ft.x + cs * t, ft.z + sn * t); if (h < -0.3) wet = true; else if (wet && h > 0.3) { fail(`${tag}: crosses land again at ${t} m`); break; } }
    } else if (ft.kind === 'moorings') {
      for (const m of mooringSpots(ft)) { const d = -f.heightAt(m.x, m.z); if (d < 3) fail(`${tag}: a mooring at ${m.x.toFixed(0)},${m.z.toFixed(0)} has only ${d.toFixed(1)} m of water`); }
    } else if (ft.kind === 'stack') {
      const d = -f.heightAt(ft.x + ft.r * 1.6, ft.z);
      if (d < 0.5 && f.heightAt(ft.x, ft.z) < 1) fail(`${tag}: the stack has no ground under it`);
    } else if (ft.kind === 'harbour') {
      const cs = Math.cos(ft.yaw), sn = Math.sin(ft.yaw);
      const front = -f.heightAt(ft.x + cs * 6, ft.z + sn * 6), back = f.heightAt(ft.x - cs * 8, ft.z - sn * 8);
      if (front < 3) fail(`${tag}: only ${front.toFixed(1)} m of water 6 m off the quay`);
      if (back < 0.5) fail(`${tag}: nothing but water 8 m behind the quay edge`);
    }
  }

  // ---- solids: feature colliders and scenery ----
  const solids = featureColliders(course.id).map((c) => ({ ...c, label: c.kind }));
  if (buildLayout) {
    const L = buildLayout(course);
    if (L.lighthouse) solids.push({ x: L.lighthouse.x, z: L.lighthouse.z, r: 19, label: 'lighthouse' });
    L.beacons.forEach((o) => solids.push({ x: o.x, z: o.z, r: 2.6, label: 'beacon' }));
    if (L.platform) solids.push({ x: L.platform.x, z: L.platform.z, hx: 20, hz: 15, yaw: L.platform.yaw, label: 'platform' });
    L.spectators.forEach((o) => solids.push({ x: o.x, z: o.z, r: 6, label: o.kind, boat: true }));
    if (L.committee) solids.push({ x: L.committee.x, z: L.committee.z, r: 7, label: 'committee', boat: true });
    if (L.breakwater && structMod.smoothPath) {
      const rows = structMod.smoothPath(L.breakwater.path, 9);
      rows.forEach((q, i) => solids.push({ x: q.x, z: q.z, r: i === rows.length - 1 ? 12.75 : 8, label: 'breakwater' }));
    }
    // scenery must stand in enough water (the lighthouse on its knoll excepted) and clear of the line
    const items = [];
    const add = (kind, o, need) => items.push({ kind, x: o.x, z: o.z, need });
    if (L.lighthouse) add('lighthouse', L.lighthouse, -1);
    L.beacons.forEach((o) => add('beacon', o, 6));
    if (L.platform) add('platform', L.platform, 15);
    L.spectators.forEach((o) => add(o.kind, o, 6));
    if (L.committee) add('committee', L.committee, 6);
    if (L.breakwater) L.breakwater.path.forEach((p, i) => add('breakwater' + i, { x: p[0], z: p[1] }, i < 2 ? -9 : 1));
    for (const it of items) {
      const d = -f.heightAt(it.x, it.z);
      const ok = it.need < 0 ? (it.need === -1 ? d < 0 : true) : d >= it.need;
      if (!ok) fail(`${course.id} ${it.kind} at ${it.x.toFixed(0)},${it.z.toFixed(0)}: water ${d.toFixed(1)} m (needs ${it.need})`);
    }
    console.log(`  ${items.length} scenery items checked`);
  }

  // ---- what the coastal system plants and builds: nothing in the water, on a pier or on a quay's working strip ----
  if (planMod.planCoast) {
    const P = planMod.planCoast(course), piers = featureColliders(course.id).filter((c) => c.kind === 'pier');
    const onPier = (x, z, m) => piers.some((c) => { const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw), dx = x - c.x, dz = z - c.z; return Math.abs(cs * dx + sn * dz) < c.hx + m && Math.abs(-sn * dx + cs * dz) < c.hz + m; });
    let wetB = 0, pierB = 0, quayB = 0;
    for (const b of P.buildings) {
      const F = (villageMod.FOOT || {})[b.type] || [5, 5], c = Math.cos(b.yaw), sn = Math.sin(b.yaw);
      // the building itself (its garden may run down a bank): the middle six tenths of its plot
      for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]]) {
        const x = b.x + c * u * F[0] * 0.6 - sn * v * F[1] * 0.45, z = b.z + sn * u * F[0] * 0.6 + c * v * F[1] * 0.45;
        if (f.heightAt(x, z) < 0.6) wetB++;
        if (onPier(x, z, 1)) pierB++;
        if (P.quays.some((q) => { const L = q.local(x, z); return q.inside(x, z, 0) && L[1] < 17.5; })) quayB++;
      }
    }
    if (wetB) fail(`${course.id} ${wetB} building corners stand in or at the water`);
    if (pierB) fail(`${course.id} ${pierB} building corners stand on a pier`);
    if (quayB) fail(`${course.id} ${quayB} building corners stand on a quay's working strip or roadway`);
    const T = P.trees;
    let wetT = 0, pierT = 0, quayT = 0, lowT = 1e9;
    for (let i = 0; i < T.count; i++) {
      const x = T.data[i * 8], z = T.data[i * 8 + 2], h = f.heightAt(x, z);
      lowT = Math.min(lowT, h);
      if (h < 2) wetT++;
      if (onPier(x, z, 2)) pierT++;
      if (P.quays.some((q) => q.inside(x, z, 1))) quayT++;
    }
    if (wetT) fail(`${course.id} ${wetT} trees stand in the water or on the beach`);
    if (pierT) fail(`${course.id} ${pierT} trees stand on a pier`);
    if (quayT) fail(`${course.id} ${quayT} trees stand on a quay`);
    let wetR = 0;
    for (const r of P.rocks) if (f.heightAt(r.x, r.z) < -0.35) wetR++;      // loose rock has no collider: it must stand where a hull cannot float
    if (wetR) fail(`${course.id} ${wetR} loose rocks stand in water a boat could reach`);
    for (const p of P.piers) if (p.t0 > 3 && !p.quay) fail(`${course.id} pier at ${p.x},${p.z}: its deck starts ${p.t0.toFixed(1)} m out from its root`);
    for (const q of P.quays) if (q.yq < 1.5 || q.yq > 4.6) fail(`${course.id} quay at ${q.x},${q.z}: deck level ${q.yq.toFixed(1)} m`);
    console.log(`  coast: ${P.buildings.length} buildings, ${T.count} trees (lowest ground ${lowT.toFixed(1)} m), ${P.rocks.length} loose rocks, ${P.moorings.length} moored craft, ${P.quays.length} quay (deck ${P.quays.map((q) => q.yq.toFixed(1)).join(', ')} m), ${P.piers.length} piers, ${P.slips.length} slipways`);
  }

  // ---- how close the line runs to things ----
  const RN = Math.ceil(WIDE / 3), DIRS = 24;
  let in40 = 0, in80 = 0, closest = 1e9, closestWhat = '';
  const runs = [];
  let run = null;
  for (const p of samples) {
    let dl = 1e9;
    for (let k = 1; k <= RN && dl === 1e9; k++) for (let a = 0; a < DIRS; a++) {
      const t = (a / DIRS) * Math.PI * 2;
      if (f.heightAt(p.x + Math.cos(t) * k * 3, p.z + Math.sin(t) * k * 3) > -0.5) { dl = k * 3; break; }
    }
    let d = dl, what = 'land';
    let dc = dl;   // the clearance counts the anchored boats too; the close passes count land and fixed things only
    for (const c of solids) { const e = solidDist(c, p.x, p.z); if (e < dc) dc = e; if (!c.boat && e < d) { d = e; what = c.label; } }
    if (dc < MIN_CLEAR) fail(`${course.id} the line passes ${dc.toFixed(0)} m from something at ${p.x.toFixed(0)},${p.z.toFixed(0)}`);
    if (d <= NEAR) in40 += 4;
    if (d <= WIDE) in80 += 4;
    if (d < closest) { closest = d; closestWhat = what; }
    if (d <= NEAR) {
      if (run && p.s - run.end < MERGE) { run.end = p.s; if (d < run.min) { run.min = d; run.what = what; } run.whats.add(what); }
      else { run = { start: p.s, end: p.s, min: d, what, whats: new Set([what]) }; runs.push(run); }
    }
  }
  const lap = s;
  // a loop's last run may join its first across the lap boundary
  if (course.loop && runs.length > 1 && lap - runs[runs.length - 1].end + runs[0].start < MERGE) { const r = runs.pop(); runs[0].start = r.start - lap; runs[0].min = Math.min(runs[0].min, r.min); }
  const need = course.id === 'sprint' ? 6 : 4;
  console.log(`  lap ${lap.toFixed(0)} m: ${in40.toFixed(0)} m within ${NEAR} m (${(100 * in40 / lap).toFixed(0)}%), ${in80.toFixed(0)} m within ${WIDE} m (${(100 * in80 / lap).toFixed(0)}%); closest ${closest.toFixed(0)} m (${closestWhat}); ${runs.length} close passes`);
  console.log('   passes: ' + runs.map((r) => `${Math.round(r.start)}-${Math.round(r.end)}m ${[...r.whats].join('/')} ${r.min.toFixed(0)}`).join('; '));
  if (in80 / lap < 1 / 3) fail(`${course.id} only ${(100 * in80 / lap).toFixed(0)}% of the lap is within ${WIDE} m of land or a feature (wanted a third)`);
  if (runs.length < need) fail(`${course.id} only ${runs.length} close passes (wanted ${need})`);
}
console.log(bad ? `${bad} problems` : 'all clear');
process.exit(bad ? 1 : 0);
