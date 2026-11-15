// Drives a point-mass boat at full thrust into each pier, stack, boulder field and shore of every course
// (no GL, no sea) and checks what collide.js does with it:
//   node tools/check-collide.mjs
// It must stop short of the solid (never inside it), never be stuck (turn away and it leaves), and a hard
// hit must not throw the boat anywhere odd. Boat dynamics are a stand-in: 9 m/s^2 up to 36 m/s, a little drag.
import { COURSES } from '../src/game/courses.js';
import { landFor } from '../src/game/landfield.js';
import { COASTS, featureColliders } from '../src/game/models/coast.js';
import { Collisions } from '../src/game/collide.js';

const CAP = [[3.0, 1.25], [0, 1.35], [-3.0, 1.25]];
let bad = 0;
const fail = (m) => { bad++; console.log('    FAIL', m); };

// signed gap between the hull's three circles and a solid (negative: overlapping)
function gap(c, b) {
  const cy = Math.cos(b.yaw), sy = Math.sin(b.yaw);
  let g = 1e9;
  for (const [ax, R] of CAP) {
    const x = b.pos[0] + cy * ax, z = b.pos[2] + sy * ax;
    if (c.hx === undefined) g = Math.min(g, Math.hypot(x - c.x, z - c.z) - c.r - R);
    else {
      const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw), dx = x - c.x, dz = z - c.z;
      const lx = cs * dx + sn * dz, lz = -sn * dx + cs * dz;
      const ex = Math.max(Math.abs(lx) - c.hx, 0), ez = Math.max(Math.abs(lz) - c.hz, 0);
      g = Math.min(g, Math.hypot(ex, ez) - R);
    }
  }
  return g;
}

// a start is fair when the water between it and the target is deep (5 m) all the way
function wet(field, sx, sz, tx, tz) {
  const n = Math.ceil(Math.hypot(tx - sx, tz - sz) / 5);
  for (let i = 0; i <= n - 7; i++) if (-field.heightAt(sx + (tx - sx) * i / n, sz + (tz - sz) * i / n) < 5) return false;
  return true;
}
// approach (tx, tz) from the first bearing among `bearings` that gives a start 130 m out with water all the way
function approach(course, name, tx, tz, bearings, targets, n = 2) {
  const field = landFor(course.id);
  let used = 0;
  for (const a of bearings) {
    const sx = tx + Math.cos(a) * 130, sz = tz + Math.sin(a) * 130;
    if (!wet(field, sx, sz, tx, tz)) continue;
    run(course, `${name} from bearing ${a.toFixed(2)}`, sx, sz, a + Math.PI, targets);
    if (++used >= n) break;
  }
  if (!used) console.log(`  ${name}: no clear approach found`);
}
function run(course, name, sx, sz, yaw, targets) {
  const field = landFor(course.id), game = { land: { field }, systems: [], course };
  const col = new Collisions(game), b = { pos: [sx, 0.2, sz], vel: [0, 0, 0], yaw, ground: 0 };
  const feats = featureColliders(course.id), dt = 1 / 120;
  let minGap = 1e9, maxSpeedOut = 0, maxHeight = -1e9, hit = false, lastHitT = -1;
  const thrust = (fwd) => { const s = Math.hypot(b.vel[0], b.vel[2]); const a = fwd ? 9 - 0.05 * s - 0.006 * s * s : 0; b.vel[0] += Math.cos(b.yaw) * a * dt; b.vel[2] += Math.sin(b.yaw) * a * dt; };
  // phase 1: full thrust at the target for 10 s; phase 2: turn back toward where it came from and go for 6 s
  const T1 = 10, T2 = 6;
  for (let i = 0; i < (T1 + T2) * 120; i++) {
    const t = i * dt;
    if (i === T1 * 120) b.yaw = yaw + Math.PI + 0.35;   // back the way it came, a little off
    thrust(true);
    b.pos[0] += b.vel[0] * dt; b.pos[2] += b.vel[2] * dt;
    col.step(b, dt);
    if (col.hits || b.ground > 0) { hit = true; lastHitT = t; }
    if (t < T1) for (const c of targets || feats) minGap = Math.min(minGap, gap(c, b));
    maxHeight = Math.max(maxHeight, field.heightAt(b.pos[0], b.pos[2]));
    if (!isFinite(b.pos[0]) || Math.hypot(b.vel[0], b.vel[2]) > 60) maxSpeedOut = 99;
  }
  const d1 = Math.hypot(b.pos[0] - sx, b.pos[2] - sz);
  const sp = Math.hypot(b.vel[0], b.vel[2]);
  const ok = hit && minGap > -0.3 && maxHeight < 0.2 && maxSpeedOut === 0 && sp > 8;
  console.log(`  ${name}: ${hit ? 'hit' : 'NO HIT'}, closest gap ${minGap > 1e8 ? '-' : minGap.toFixed(2)} m, highest ground under the hull centre ${maxHeight.toFixed(2)} m, left again at ${sp.toFixed(1)} m/s${ok ? '' : '  <-- check'}`);
  if (!hit) fail(`${name}: never touched anything`);
  if (minGap <= -0.3 && !(targets && targets.length === 0)) fail(`${name}: hull ended ${(-minGap).toFixed(2)} m inside a solid`);
  if (maxHeight >= 0.2) fail(`${name}: the hull centre got onto land (${maxHeight.toFixed(2)} m up)`);
  if (sp <= 8) fail(`${name}: could not drive away (stuck at ${sp.toFixed(1)} m/s)`);
  if (maxSpeedOut) fail(`${name}: speed or position blew up`);
}

for (const course of COURSES) {
  console.log(course.id + ':');
  const f = landFor(course.id), def = COASTS[course.id];
  for (const ft of def.features) {
    if (ft.kind === 'pier') {
      const cs = Math.cos(ft.yaw), sn = Math.sin(ft.yaw), all = [];
      for (let k = 0; k < 16; k++) all.push((k / 16) * Math.PI * 2);
      const mid = [ft.x + cs * ft.len * 0.6, ft.z + sn * ft.len * 0.6];
      // broadside: at the pier's side, from both sides; head-on: from beyond the tip along its axis
      approach(course, `pier at ${ft.x},${ft.z} broadside`, mid[0], mid[1], [ft.yaw + Math.PI / 2, ft.yaw - Math.PI / 2, ft.yaw + 1.2, ft.yaw - 1.2], undefined, 2);
      approach(course, `pier at ${ft.x},${ft.z} head-on`, ft.x + cs * ft.len, ft.z + sn * ft.len, [ft.yaw, ft.yaw + 0.4, ft.yaw - 0.4], undefined, 1);
    } else if (ft.kind === 'stack') {
      const all = []; for (let k = 0; k < 16; k++) all.push((k / 16) * Math.PI * 2);
      approach(course, `stack at ${ft.x},${ft.z}`, ft.x, ft.z, all, undefined, 2);
    } else if (ft.kind === 'rocks') {
      const all = []; for (let k = 0; k < 16; k++) all.push((k / 16) * Math.PI * 2);
      const big = featureColliders(course.id).filter((c) => c.kind === 'rock' && Math.hypot(c.x - ft.x, c.z - ft.z) < ft.r + 1).sort((p, q) => q.r - p.r)[0];
      if (big) approach(course, `boulder (r ${big.r.toFixed(1)}) at ${big.x.toFixed(0)},${big.z.toFixed(0)}`, big.x, big.z, all, undefined, 1);
    }
  }
  // the beach or cliff nearest the line: from a point of the line, straight at the nearest land
  const g = course.gates[Math.floor(course.gates.length / 2)];
  let best = null;
  for (let r = 10; r < 400 && !best; r += 6) for (let k = 0; k < 72; k++) { const t = (k / 72) * Math.PI * 2; if (f.heightAt(g.c[0] + Math.cos(t) * r, g.c[1] + Math.sin(t) * r) > 0.3) { best = t; break; } }
  if (best !== null) {
    const sx = g.c[0], sz = g.c[1];
    run(course, `shore from gate ${Math.floor(course.gates.length / 2)} (bearing ${best.toFixed(2)})`, sx, sz, best, []);
  }
}
console.log(bad ? `${bad} problems` : 'all clear');
process.exit(bad ? 1 : 0);
