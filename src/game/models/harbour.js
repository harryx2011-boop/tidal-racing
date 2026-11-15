// Harbours and piers: what stands on the `harbour` and `pier` features of a course (models/coast.js).
//
// A quay. The feature gives the middle of the water edge, the way it faces, its width; the made ground behind
// it is the course's quay shape. The plan (planQuay) measures the ground: the level the deck must stand at to
// clear it, how far back the sides stand in water. From the plan:
//   deckGeo   the paved apron as ground (drawn by the terrain shader, so it takes the shadows of what stands
//             on it): level along the front, lying on the ground further back
//   quayGeo   the wall and everything on it, for the mesh pass: coursed masonry with a weed line and tide
//             stains, coping stones, timber fender piles, tyres on chains, ladders, mooring rings, bollards,
//             lamp posts, a hoist, benches, bins, life-ring posts, a name board, stacks of creels and fish
//             boxes, net heaps, rope, drums, pallets, vans, trailers with dinghies hauled out, and people
// The frame of a quay: x along the edge, z out over the water, the origin at the feature's point, y the height.
//
// A pier. From its root on the shore out along its heading (x), z across: paired timber piles with weed and
// wet bands, cross-braced and walered, cap beams, stringers, a plank deck, kerbs, railings, lamp posts,
// ladders, life rings, a bench, a shelter and a light at the head, and a few people. Its deck is the pier's
// collider box; it stands at the quay's level where it leaves a quay and at about 3 m elsewhere, and runs
// ashore as a boardwalk until the ground comes up to it.
//
// Triangles (near / middle / far): a quay about 150 / 25 / 3 per metre of wall plus 60k / 9k / 0.6k of
// furniture; a 165 m pier 62k / 9k / 0.5k.
import { Geo, MAT, mat, GEL, RUB, MET, GLS, GRAIN, CLOTH, LIT, DV, rng, TAU, lerp, smooth, clamp, hash1, vn, fb, sheet, loft, tube, rod, box, slab, lathe, quad, blob, hoop, mark, paint, xf, frame, stamp, both, mottle, stain, rust, faded, guano, mixc, scl, text, railing, ladder, chain, lifering, bollard, coil } from './kit.js';
import { crewGeo } from './wildlife.js';
import { GROUND } from './cover.js';
import { openBoatGeo } from './smallcraft.js';

const PAVED = [GROUND.PAVED, 0, 0, 0], CONC = [GROUND.CONCRETE, 0, 0, 0];
const ASHLAR = mat(MAT.RUBBER, 0, 0, DV.ASHLAR + DV.ALONG), CORR = mat(MAT.RUBBER, 0, 0, DV.CORRUGATED + DV.ALONG);
const GRANITE = [0.3, 0.29, 0.275], COPING = [0.38, 0.37, 0.35], TIMBER = [0.19, 0.14, 0.095], DECK = [0.33, 0.3, 0.26], STEEL = [0.45, 0.47, 0.48], BLACK = [0.035, 0.035, 0.04];
export const WARM = [1, 0.74, 0.42];
const NAMES = { circuit: 'BREAKWATER QUAY', sprint: 'LONG REACH HARBOUR', oval: 'SPEEDWAY QUAY' };

// append one geometry to another as it stands
export function append(g, c) {
  g.reserve(c.nv);
  g.P.set(c.P.subarray(0, c.nv * 3), g.nv * 3); g.N.set(c.N.subarray(0, c.nv * 3), g.nv * 3); g.C.set(c.C.subarray(0, c.nv * 3), g.nv * 3);
  g.M.set(c.M.subarray(0, c.nv * 3), g.nv * 3); g.U.set(c.U.subarray(0, c.nv * 2), g.nv * 2);
  g.nv += c.nv;
}

// ---- plans: measured from the height field, a pure function of the course ----
export function planQuay(field, def, f, courseId) {
  const ox = Math.cos(f.yaw), oz = Math.sin(f.yaw), ax = Math.sin(f.yaw), az = -Math.cos(f.yaw);
  const hw = f.w / 2;
  // the made ground: the quay shape whose water edge this feature names
  let depth = f.d, flare = 0;
  for (const sh of def.shapes) {
    if (sh.round !== 0 || sh.pts.length !== 4) continue;
    const c = sh.pts[2], d = sh.pts[3], mx = (c[0] + d[0]) / 2, mz = (c[1] + d[1]) / 2;
    if (Math.hypot(mx - f.x, mz - f.z) > 6) continue;
    const a = sh.pts[0];
    depth = Math.abs((a[0] - d[0]) * ox + (a[1] - d[1]) * oz);
    flare = Math.abs((a[0] - d[0]) * ax + (a[1] - d[1]) * az);
  }
  const W = (X, Z) => [f.x + ax * X + ox * Z, f.z + az * X + oz * Z];
  const hAt = (X, Z) => { const p = W(X, Z); return field.heightAt(p[0], p[1]); };
  // the deck's level: above all the ground of the front strip
  let yq = 2.2;
  for (let X = -hw + 4; X <= hw - 4; X += 3) for (let zin = 9; zin <= 32; zin += 3) yq = Math.max(yq, hAt(X, -zin) + 0.12);
  yq = Math.min(yq, 4.6);
  const paved = Math.min(f.d * 0.5, 55, depth - 6);
  // how far back each side stands in water (a wall there), as distance inland
  const side = [0, 0];
  for (const s of [-1, 1]) {
    let last = 0;
    for (let zin = 2; zin <= depth; zin += 2) { const Xs = s * (hw + flare * zin / depth + 3.5); if (hAt(Xs, -zin) < 0.4) last = zin; else if (zin - last > 8) break; }
    side[s < 0 ? 0 : 1] = Math.min(last + 3, depth);
  }
  const q = { kind: 'quay', f, id: courseId, x: f.x, z: f.z, yaw: f.yaw, ox, oz, ax, az, hw, depth, flare, yq, paved, wo: 0.4, side, W, hAt, name: NAMES[courseId] || 'HARBOUR' };
  // half the width of the apron at a distance inland
  q.half = (zin) => hw + flare * clamp(zin / depth, 0, 1);
  // the height of the paved surface at a point of the apron
  q.deckY = (X, zin) => Math.max(yq, hAt(X, -zin) + 0.12);
  q.inside = (x, z, m = 0) => { const dx = x - f.x, dz = z - f.z, zin = -(dx * ox + dz * oz), X = dx * ax + dz * az; return zin > -1 - m && zin < depth + m && Math.abs(X) < q.half(zin) + m; };
  q.local = (x, z) => { const dx = x - f.x, dz = z - f.z; return [dx * ax + dz * az, -(dx * ox + dz * oz)]; };
  return q;
}

export function planPier(field, f, quays) {
  const cx = Math.cos(f.yaw), cz = Math.sin(f.yaw);
  const hAt = (t, s = 0) => field.heightAt(f.x + cx * t - cz * s, f.z + cz * t + cx * s);
  const quay = quays.find((q) => q.inside(f.x, f.z, 2));
  const yp = quay ? quay.yq + 0.03 : clamp(hAt(0) + 0.2, 2.9, 3.4);
  // where the deck leaves the ground, and how far back the boardwalk runs to meet it
  let tOut = 0;
  for (let t = 0; t <= f.len; t += 1) if (hAt(t) < yp - 0.6) { tOut = t; break; }
  let t0 = tOut;
  if (!quay) { for (let t = tOut; t >= tOut - 22; t -= 1) { t0 = t; if (hAt(t) > yp - 0.12) break; } }
  else t0 = tOut - 1.5;
  return { kind: 'pier', f, x: f.x, z: f.z, yaw: f.yaw, cx, cz, len: f.len, w: f.w, yp, tOut, t0, hAt, quay, W: (t, s) => [f.x + cx * t - cz * s, f.z + cz * t + cx * s] };
}

// ---- the paved apron, as ground ----
// About (f.x, 0, f.z) in world axes. Level at the quay's height wherever the ground is lower, lying on the
// ground behind, and going under it at its back edge so paving runs into the paved ground the shader paints.
export function deckGeo(q, lod = 0) {
  const g = new Geo(lod ? 4096 : 32768), cell = lod ? 6 : 2;
  const z0 = -q.wo + 0.05, z1 = q.paved + 8, nz = Math.ceil((z1 - z0) / cell);
  const pt = (X, zin) => {
    let y = q.deckY(X, zin);
    if (zin > q.paved + 2) y = q.hAt(X, -zin) + lerp(0.12, -0.25, (zin - q.paved - 2) / 6);
    return [q.ax * X - q.ox * zin, y, q.az * X - q.oz * zin];
  };
  const up = { n: [0, 1, 0] };
  for (let j = 0; j < nz; j++) {
    const za = lerp(z0, z1, j / nz), zb = lerp(z0, z1, (j + 1) / nz);
    // (beyond where a side stands in water the apron joins the land: the paving stops at the block's own edge)
    const wa = q.half(za) + (za < q.side[0] ? q.wo : 0), wb = q.half(zb) + (zb < q.side[0] ? q.wo : 0);
    const wa2 = q.half(za) + (za < q.side[1] ? q.wo : 0), wb2 = q.half(zb) + (zb < q.side[1] ? q.wo : 0);
    const nx = Math.ceil((wa + wa2) / cell);
    for (let i = 0; i < nx; i++) {
      const u0 = i / nx, u1 = (i + 1) / nx;
      quad(g, pt(lerp(-wa, wa2, u0), za), pt(lerp(-wb, wb2, u0), zb), pt(lerp(-wb, wb2, u1), zb), pt(lerp(-wa, wa2, u1), za), [1, 1, 1], PAVED, up);
    }
  }
  return g;
}

// ---- furniture, each built at the origin and placed ----
function lampPost(g, p, yaw, h, lamps, lod, col = STEEL) {
  const s0 = mark(g);
  lathe(g, [[0.16, 0], [0.16, 0.05], [0.09, 0.08], [0.085, 0.9], [0.06, 1.0], [0.045, h]], col, MET, { segs: lod ? 5 : 8 });
  if (lod < 2) {
    // the outreach arm and the lantern
    tube(g, [[0, h - 0.05, 0], [0, h + 0.25, 0], [0.3, h + 0.42, 0], [0.95, h + 0.42, 0]], 0.035, col, MET, { segs: lod ? 4 : 6 });
    box(g, [1.05, h + 0.4, 0], 0.3, 0.06, 0.14, [0.1, 0.1, 0.11], RUB);
    box(g, [1.05, h + 0.335, 0], 0.24, 0.012, 0.1, [1, 0.86, 0.6], LIT);
    if (lod === 0) { box(g, [0, 0.5, 0.09], 0.05, 0.12, 0.012, [0.3, 0.31, 0.32], MET); }
  } else box(g, [0.5, h + 0.4, 0], 0.5, 0.05, 0.08, [0.1, 0.1, 0.11], RUB);
  xf(g, s0, frame(p, yaw));
  const c = Math.cos(yaw), s = Math.sin(yaw);
  lamps.push({ p: [p[0] + c * 1.05, p[1] + h + 0.3, p[2] + s * 1.05], col: WARM, kind: 'post', size: 1.5 });
}
function bench(g, p, yaw, lod) {
  const s0 = mark(g), wood = [0.3, 0.2, 0.11];
  if (lod === 0) {
    for (let k = 0; k < 4; k++) slab(g, -0.9, 0.9, 0.43, 0.46, -0.22 + k * 0.115, -0.13 + k * 0.115, wood, GRAIN, { paint: mottle(k + p[0], 0.15, 3) });
    for (let k = 0; k < 3; k++) box(g, [0, 0.6 + k * 0.13, -0.27 - k * 0.03], 0.9, 0.05, 0.015, wood, GRAIN);
    for (const x of [-0.75, 0.75]) { box(g, [x, 0.22, 0], 0.03, 0.22, 0.24, BLACK, RUB); box(g, [x, 0.66, -0.28], 0.03, 0.26, 0.03, BLACK, RUB); }
  } else { slab(g, -0.9, 0.9, 0.0, 0.46, -0.24, 0.22, scl(wood, 0.8), RUB); slab(g, -0.9, 0.9, 0.46, 0.9, -0.32, -0.26, wood, RUB); }
  xf(g, s0, frame(p, yaw));
}
// a creel: a D-section pot of netting on a steel frame
function creelProto(lod) {
  const g = new Geo(512), L = 0.62, W = 0.46, H = 0.36, net = [0.06, 0.16, 0.2];
  const prof = []; for (let k = 0; k <= 6; k++) { const a = (k / 6) * Math.PI; prof.push([Math.cos(a) * W / 2, Math.sin(a) * H]); }
  const rings = [-L / 2, L / 2].map((x) => prof.map(([z, y]) => [x, y + 0.015, z]));
  loft(g, rings, net, CLOTH, { closed: false, caps: [true, true] });
  slab(g, -L / 2, L / 2, 0, 0.02, -W / 2, W / 2, [0.12, 0.12, 0.12], RUB);
  if (lod === 0) { for (const x of [-L / 2, 0, L / 2]) tube(g, prof.map(([z, y]) => [x, y + 0.02, z]), 0.012, [0.5, 0.25, 0.06], RUB, { segs: 3 }); for (const z of [-W / 2, W / 2]) rod(g, [-L / 2, 0.03, z], [L / 2, 0.03, z], 0.012, [0.5, 0.25, 0.06], RUB, 3); }
  return g;
}
function creelStack(g, p, yaw, R, lod, protos) {
  const s0 = mark(g), nx = 3 + Math.floor(R() * 3), ny = 2 + Math.floor(R() * 3), nz = 1 + Math.floor(R() * 2);
  if (lod === 2) { box(g, [0, ny * 0.19, 0], nx * 0.33, ny * 0.19, nz * 0.25, [0.07, 0.15, 0.18], RUB); xf(g, s0, frame(p, yaw)); return; }
  const tints = [[1, 1, 1], [0.6, 1.3, 0.9], [1.6, 0.9, 0.6], [0.8, 0.8, 1.4]];
  for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) for (let i = 0; i < nx - (j > 1 ? j - 1 : 0); i++) {
    if (j === ny - 1 && R() < 0.3) continue;
    stamp(g, protos.creel, frame([(i - (nx - 1) / 2 + (j > 1 ? (j - 1) / 2 : 0)) * 0.66 + (R() - 0.5) * 0.05, j * 0.37, (k - (nz - 1) / 2) * 0.5 + (R() - 0.5) * 0.05], (R() - 0.5) * 0.15), tints[Math.floor(R() * 4)]);
  }
  // marker floats and a tangle of rope on top
  if (lod === 0) for (let k = 0; k < 3; k++) blob(g, [(R() - 0.5) * nx * 0.5, ny * 0.37 + 0.1, (R() - 0.5) * 0.4], 0.11, 0.14, 0.11, [[0.8, 0.3, 0.05], [0.8, 0.75, 0.1], [0.75, 0.75, 0.7]][k], GEL, { n: 4, segs: 6 });
  xf(g, s0, frame(p, yaw));
}
const BOXC = [[0.08, 0.2, 0.55], [0.6, 0.1, 0.07], [0.75, 0.6, 0.08], [0.75, 0.75, 0.7], [0.08, 0.4, 0.25], [0.85, 0.35, 0.05]];
function fishBoxes(g, p, yaw, R, lod) {
  const s0 = mark(g), n = 2 + Math.floor(R() * 4), lay = [];
  // (the layout first, so every level of detail stacks the same boxes)
  for (let s = 0; s < n; s++) lay.push([(s % 3 - 1) * 0.95 + (R() - 0.5) * 0.2, Math.floor(s / 3) * 0.6 + (R() - 0.5) * 0.15, 1 + Math.floor(R() * 5), (R() - 0.5) * 0.3, Math.floor(R() * 1e6)]);
  for (const [x, z, h, yw, sd] of lay) {
    const Q = rng(sd);
    if (lod === 2) { box(g, [x, h * 0.15, z], 0.4, h * 0.15, 0.23, BOXC[Math.floor(Q() * 6)], RUB, { yaw: yw }); continue; }
    for (let k = 0; k < h; k++) {
      const c = BOXC[Math.floor(Q() * 6)];
      box(g, [x, 0.15 + k * 0.3, z], 0.4, 0.14, 0.23, c, GEL, { yaw: yw + (Q() - 0.5) * 0.08, top: k === h - 1 ? scl(c, 0.25) : c });
      if (lod === 0) box(g, [x, 0.28 + k * 0.3, z], 0.42, 0.02, 0.25, scl(c, 1.1), GEL, { yaw: yw });
    }
  }
  xf(g, s0, frame(p, yaw));
}
function netHeap(g, p, yaw, R, lod) {
  const s0 = mark(g), c = [[0.05, 0.35, 0.3], [0.1, 0.2, 0.4], [0.5, 0.25, 0.05], [0.12, 0.3, 0.1]][Math.floor(R() * 4)], sd = R() * 50;
  const n = lod ? 5 : 10, m = lod ? 8 : 16, rx = 1.1 + R() * 0.8, rz = 0.8 + R() * 0.5, h = 0.45 + R() * 0.3;
  sheet(g, n + 1, m + 1, (i, j, out) => {
    const v = i / n, th = ((j % m) / m) * TAU, r = Math.sin(v * Math.PI / 2 + 0.001) , k = 0.7 + 0.6 * fb(Math.cos(th) * 1.5 + sd, v * 2, Math.sin(th) * 1.5);
    out[0] = Math.cos(th) * rx * (1 - v * v) * k; out[1] = h * r * (0.6 + 0.8 * vn(Math.cos(th) * 3 + sd, v * 3, Math.sin(th) * 3)) * (i === 0 ? 0 : 1); out[2] = Math.sin(th) * rz * (1 - v * v) * k;
  }, c, CLOTH, { wrap: true, paint: (P, N, C, i) => { const k = 0.6 + 0.9 * vn(P[i] * 9 + sd, P[i + 1] * 9, P[i + 2] * 9); C[i] *= k; C[i + 1] *= k; C[i + 2] *= k; } });
  if (lod === 0) for (let k = 0; k < 7; k++) { const a = R() * TAU, d = 0.3 + R() * 0.6; blob(g, [Math.cos(a) * d * rx * 0.7, h * 0.5 + 0.05, Math.sin(a) * d * rz * 0.7], 0.07, 0.05, 0.07, k % 2 ? [0.85, 0.4, 0.05] : [0.8, 0.8, 0.75], GEL, { n: 3, segs: 6 }); }
  xf(g, s0, frame(p, yaw));
}
function drum(g, p, col, lod, seed = 1) {
  lathe(g, [[0, 0], [0.29, 0], [0.29, 0], [0.295, 0.28], [0.285, 0.3], [0.295, 0.32], [0.295, 0.58], [0.285, 0.6], [0.295, 0.62], [0.29, 0.88], [0.29, 0.88], [0.27, 0.86], [0, 0.86]], col, GEL, { segs: lod ? 6 : 12, at: p, paint: lod ? undefined : rust(seed, { amt: 0.5, f: 5 }) });
}
function pallet(g, p, yaw, n, lod) {
  const s0 = mark(g), w = [0.42, 0.33, 0.2];
  for (let k = 0; k < n; k++) {
    const y = k * 0.145;
    if (lod === 0) { for (let i = 0; i < 5; i++) slab(g, -0.6, 0.6, y + 0.12, y + 0.142, -0.4 + i * 0.175, -0.3 + i * 0.175, w, GRAIN, { paint: mottle(i + k, 0.2, 3) }); for (const z of [-0.36, 0, 0.36]) slab(g, -0.6, 0.6, y, y + 0.12, z - 0.04, z + 0.04, scl(w, 0.8), GRAIN); }
    else slab(g, -0.6, 0.6, y, y + 0.142, -0.4, 0.4, scl(w, 0.85), RUB);
  }
  xf(g, s0, frame(p, yaw));
}
function wheel(g, c, r, w, lod) {
  lathe(g, [[0, -w / 2], [r * 0.6, -w / 2], [r * 0.92, -w / 2], [r, -w * 0.3], [r, w * 0.3], [r * 0.92, w / 2], [r * 0.6, w / 2], [0, w / 2]], [0.03, 0.03, 0.032], RUB, { segs: lod ? 6 : 12, axis: 'x', at: c });
  if (lod === 0) for (const s of [-1, 1]) lathe(g, [[0, s * (w / 2 + 0.004)], [r * 0.56, s * (w / 2 + 0.004)]], [0.5, 0.5, 0.5], MET, { segs: 10, axis: 'x', at: c });
}
// a panel van, x forward
function van(g, p, yaw, R, lod) {
  const s0 = mark(g), c = [[0.78, 0.78, 0.76], [0.1, 0.2, 0.45], [0.55, 0.07, 0.05], [0.75, 0.75, 0.2], [0.2, 0.3, 0.22]][Math.floor(R() * 5)];
  const L = 4.9, W = 1.9, Hh = 2.0, y0 = 0.32;
  if (lod === 2) { box(g, [0, y0 + Hh / 2, 0], L / 2, Hh / 2, W / 2, c, RUB); xf(g, s0, frame(p, yaw)); return; }
  // body: sections from the tail to the nose
  const sec = (x, h, w, yb = y0) => [[x, yb, -w / 2], [x, yb + h * 0.55, -w / 2], [x, yb + h, -w / 2 * 0.9], [x, yb + h, w / 2 * 0.9], [x, yb + h * 0.55, w / 2], [x, yb, w / 2]];
  const body = [sec(-L / 2, Hh, W), sec(L * 0.16, Hh, W), sec(L * 0.3, Hh * 0.98, W), sec(L * 0.42, Hh * 0.52, W * 0.98), sec(L / 2, Hh * 0.46, W * 0.94)];
  loft(g, body, c, GEL, { closed: false, caps: [true, true], paint: both(faded(p[0], 0.15), rust(p[0] + 2, { amt: 0.25, f: 3, lo: 0.7, hi: 0.9 })) });
  // screen and side windows
  quad(g, [L * 0.3 + 0.01, y0 + Hh * 0.95, -W * 0.42], [L * 0.3 + 0.01, y0 + Hh * 0.95, W * 0.42], [L * 0.415, y0 + Hh * 0.55, W * 0.46], [L * 0.415, y0 + Hh * 0.55, -W * 0.46], [0.08, 0.1, 0.12], GLS);
  for (const s of [-1, 1]) quad(g, [L * 0.17, y0 + Hh * 0.6, s * (W / 2 + 0.006)], [L * 0.3, y0 + Hh * 0.6, s * (W / 2 + 0.006)], [L * 0.28, y0 + Hh * 0.9, s * (W / 2 * 0.93 + 0.006)], [L * 0.17, y0 + Hh * 0.9, s * (W / 2 * 0.93 + 0.006)], [0.08, 0.1, 0.12], GLS);
  // bumpers, lamps
  box(g, [L / 2 + 0.03, y0 + 0.12, 0], 0.06, 0.1, W * 0.48, BLACK, RUB); box(g, [-L / 2 - 0.03, y0 + 0.12, 0], 0.05, 0.09, W * 0.48, BLACK, RUB);
  if (lod === 0) { for (const s of [-1, 1]) { box(g, [L / 2 + 0.01, y0 + 0.55, s * W * 0.36], 0.02, 0.07, 0.13, [0.85, 0.85, 0.8], GEL); box(g, [-L / 2 - 0.01, y0 + 0.75, s * W * 0.42], 0.02, 0.16, 0.05, [0.5, 0.03, 0.02], GEL); } }
  for (const x of [L * 0.3, -L * 0.3]) for (const s of [-1, 1]) { const s1 = mark(g); wheel(g, [0, 0, 0], 0.34, 0.22, lod); xf(g, s1, frame([x, 0.34, s * (W / 2 - 0.12)], Math.PI / 2)); }
  xf(g, s0, frame(p, yaw));
}
// a boat trailer with a dinghy on it, x forward (the drawbar)
function trailerBoat(g, p, yaw, R, lod, protos) {
  const s0 = mark(g), st = [0.4, 0.42, 0.43];
  if (lod < 2) {
    for (const s of [-1, 1]) rod(g, [-1.9, 0.42, s * 0.62], [1.2, 0.42, s * 0.62], 0.035, st, MET, 4);
    rod(g, [1.2, 0.42, -0.62], [2.6, 0.42, 0], 0.035, st, MET, 4); rod(g, [1.2, 0.42, 0.62], [2.6, 0.42, 0], 0.035, st, MET, 4);
    for (const x of [-1.6, -0.3, 1.0]) rod(g, [x, 0.42, -0.62], [x, 0.42, 0.62], 0.03, st, MET, 4);
    rod(g, [2.5, 0.42, 0], [2.5, 0.02, 0], 0.03, st, MET, 4);
    for (const s of [-1, 1]) { const s1 = mark(g); wheel(g, [0, 0, 0], 0.29, 0.16, lod); xf(g, s1, frame([-0.5, 0.29, s * 0.78], Math.PI / 2)); }
  }
  const b = protos.boats[Math.floor(R() * protos.boats.length)];
  stamp(g, b, frame([-0.2, 0.74, 0], 0, 0.03, 0));
  xf(g, s0, frame(p, yaw));
}
// a slewing hoist on the quay's edge, its jib out over the water (+z)
function hoist(g, p, lod, lamps) {
  const s0 = mark(g), y = [0.75, 0.55, 0.05], pr = lod === 0 ? both(faded(3, 0.3), rust(7, { amt: 0.5, f: 4 })) : undefined;
  lathe(g, [[0.36, 0], [0.36, 0.06], [0.2, 0.1], [0.17, 1.2], [0.15, 4.3], [0.19, 4.35], [0.19, 4.5], [0, 4.5]], y, GEL, { segs: lod ? 6 : 12, paint: pr });
  // the jib, a box beam rising outward, its tie and hook
  const s1 = mark(g);
  box(g, [0, 0, 1.9], 0.09, 0.14, 2.0, y, GEL, { paint: pr });
  xf(g, s1, frame([0, 4.2, 0], 0, 0, -0.3));
  const tip = [0, 4.2 + Math.sin(0.3) * 3.8, Math.cos(0.3) * 3.8];
  rod(g, [0, 5.4, -0.1], tip, 0.025, [0.2, 0.2, 0.2], MET, 4); rod(g, [0, 4.5, 0], [0, 5.4, -0.1], 0.06, y, GEL, 5);
  if (lod < 2) {
    rod(g, tip, [tip[0], 2.2, tip[2]], 0.012, [0.15, 0.15, 0.15], MET, 3);
    box(g, [tip[0], 2.1, tip[2]], 0.07, 0.12, 0.05, [0.7, 0.5, 0.05], GEL); hoop(g, [tip[0], 1.9, tip[2]], [1, 0, 0], 0.07, 0.016, [0.2, 0.2, 0.2], MET, 8, 4);
    box(g, [0.3, 1.1, -0.2], 0.16, 0.2, 0.2, [0.2, 0.3, 0.42], GEL);
  }
  xf(g, s0, frame(p, 0));
  void lamps;
}
function bin(g, p, yaw, lod) {
  const s0 = mark(g), c = [0.08, 0.25, 0.12];
  loft(g, [[[-0.26, 0.06, -0.3], [0.26, 0.06, -0.3], [0.26, 0.06, 0.3], [-0.26, 0.06, 0.3]], [[-0.3, 1.0, -0.36], [0.3, 1.0, -0.36], [0.3, 1.0, 0.36], [-0.3, 1.0, 0.36]]], c, GEL, { caps: [true, false] });
  box(g, [0, 1.03, 0.02], 0.32, 0.035, 0.4, scl(c, 0.8), GEL);
  if (lod === 0) for (const s of [-1, 1]) { const s1 = mark(g); wheel(g, [0, 0, 0], 0.1, 0.05, 1); xf(g, s1, frame([s * 0.22, 0.1, -0.3], Math.PI / 2)); }
  xf(g, s0, frame(p, yaw));
}
function ringPost(g, p, yaw, lod) {
  const s0 = mark(g);
  rod(g, [0, 0, 0], [0, 1.5, 0], 0.045, [0.6, 0.06, 0.04], GEL, lod ? 4 : 6);
  box(g, [0, 1.25, 0.05], 0.3, 0.3, 0.02, [0.6, 0.06, 0.04], GEL);
  if (lod < 2) lifering(g, [0, 1.25, 0.11], [0, 0, 1], 0.24, lod);
  xf(g, s0, frame(p, yaw));
}
// a tyre fender hung on two chains from the coping
function tyre(g, x, y, z, yq, lod) {
  hoop(g, [x, y, z + 0.12], [0, 0, 1], 0.3, 0.11, [0.028, 0.028, 0.03], RUB, lod ? 8 : 14, lod ? 4 : 6);
  if (lod === 0) for (const s of [-1, 1]) chain(g, [x + s * 0.22, y + 0.25, z + 0.1], [x + s * 0.3, yq + 0.02, z - 0.05], [0.25, 0.14, 0.08], MET, { bar: true });
}

// people in a host's frame, appended at a level of detail
export function people(g, list, lod) {
  if (lod > 1 || !list.length) return;
  append(g, crewGeo(list, 0, { lod: lod ? 2 : 1 }));
}

// ---- the quay: wall, coping, fittings, furniture ----
export function quayGeo(q, lod = 0, extras = {}) {
  const g = new Geo(lod === 0 ? 131072 : 16384), lamps = [], yq = q.yq, hw = q.hw, wo = q.wo;
  const protos = { creel: creelProto(lod), boats: [1, 2, 3].map((s) => openBoatGeo(Math.max(lod, 1), s * 5 + 2, { outboard: false }).g) };
  // ---- the wall: front and the two sides, as far back as they stand in water ----
  const path = [];
  const sideX = (s, zin) => s * (q.half(zin) + wo);
  for (let zin = q.side[0]; zin > 0.01; zin -= 3) path.push([sideX(-1, zin), -zin, -1]);
  path.push([-(hw + wo), wo, 0]); path.push([hw + wo, wo, 0]);
  for (let zin = 3; zin <= q.side[1] + 0.01; zin += 3) path.push([sideX(1, zin), -zin, 1]);
  const ys = lod === 2 ? [-3.2, 0, yq - 0.28] : [-3.2, -1.2, -0.2, 0.35, 0.9, 1.6, (yq - 0.28 + 1.6) / 2, yq - 0.28];
  const st = both(mottle(q.x, 0.14, 0.6), stain(q.z, { weedTop: 0.5, tide: 0.95, wet: 1.5, salt: 0.1 }), (P, N, C, i) => {
    // run-off streaks down from the coping, and green slime in the damp
    const a = P[i] * 1.3 + P[i + 2] * 0.9, k = smooth(0.55, 0.8, vn(a * 1.4, 0.5, q.x)) * smooth(-0.2, yq, P[i + 1]) * 0.3;
    C[i] *= 1 - k; C[i + 1] *= 1 - k * 0.8; C[i + 2] *= 1 - k;
  });
  let along = 0;
  for (let s = 0; s < path.length - 1; s++) {
    const a = path[s], b = path[s + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(len / (lod ? 6 : 1.5)));
    const nx = -(b[1] - a[1]) / len, nz = (b[0] - a[0]) / len;      // outward (the path runs with the water on its left)
    const a0 = along;
    sheet(g, ys.length, n + 1, (i, j, out) => {
      const t = j / n, y = ys[i], bat = (yq - y) * 0.035;
      out[0] = lerp(a[0], b[0], t) + nx * bat; out[1] = y; out[2] = lerp(a[1], b[1], t) + nz * bat;
    }, GRANITE, ASHLAR, { paint: st, along: (P, i) => a0 + Math.hypot(P[i] - a[0], P[i + 2] - a[1]) });
    // coping stones
    if (lod === 0) {
      const m = Math.max(1, Math.round(len / 1.25));
      for (let k = 0; k < m; k++) {
        const t0 = k / m, t1 = (k + 1) / m, tone = 0.85 + 0.3 * hash1(s * 131 + k, 5), cx = lerp(a[0], b[0], (t0 + t1) / 2), cz = lerp(a[1], b[1], (t0 + t1) / 2);
        box(g, [cx - nx * 0.22, yq - 0.12, cz - nz * 0.22], len / m / 2 - 0.008, 0.15, 0.36, scl(COPING, tone), GRAIN, { yaw: Math.atan2(b[1] - a[1], b[0] - a[0]) });
      }
    } else {
      const yw = Math.atan2(b[1] - a[1], b[0] - a[0]);
      box(g, [(a[0] + b[0]) / 2 - nx * 0.22, yq - 0.12, (a[1] + b[1]) / 2 - nz * 0.22], len / 2, 0.15, 0.36, COPING, RUB, { yaw: yw });
    }
    along += len;
  }
  // ---- along the front: fender piles, tyres, ladders, rings, bollards ----
  const zf = wo;
  if (lod < 2) {
    const pilePaint = stain(q.x + 3, { weedTop: 0.55, tide: 1.0, wet: 1.6, salt: 0.15 });
    for (let X = -hw + 3; X <= hw - 3; X += 6) {
      const pts = []; for (let y = -1.6; y <= yq + 0.12; y += lod ? 1.6 : 0.5) pts.push([X, y, zf + 0.16]);
      pts.push([X, yq + 0.14, zf + 0.16]);
      tube(g, pts, 0.15, TIMBER, GRAIN, { segs: 4, caps: true, paint: pilePaint });
      if (hash1(Math.round(X), 3) < 0.55) tyre(g, X + 2.2 + hash1(Math.round(X), 9), 1.0 + 0.9 * hash1(Math.round(X), 4), zf + 0.02, yq, lod);
      if (hash1(Math.round(X), 6) < 0.3) tyre(g, X - 1.7, 0.7 + 0.8 * hash1(Math.round(X), 8), zf + 0.02, yq, lod);
    }
  }
  if (lod === 0) {
    for (let X = -hw + 14; X <= hw - 10; X += 36) {
      ladder(g, [X, -0.9, zf + 0.14], [X, yq + 0.05, zf + 0.14], [1, 0, 0], [0.4, 0.3, 0.2], MET, { w: 0.42, r: 0.022 });
      for (const s of [-1, 1]) tube(g, [[X + s * 0.21, yq, zf + 0.14], [X + s * 0.21, yq + 0.9, zf + 0.1], [X + s * 0.21, yq + 1.0, zf - 0.2], [X + s * 0.21, yq + 0.02, zf - 0.55]], 0.022, [0.75, 0.6, 0.05], MET, { segs: 4 });
    }
    for (let X = -hw + 8; X <= hw - 8; X += 12) { hoop(g, [X, yq - 0.75, zf + 0.06], [1, 0, 0], 0.12, 0.022, [0.22, 0.12, 0.07], MET, 10, 4); box(g, [X, yq - 0.6, zf + 0.02], 0.08, 0.08, 0.02, [0.22, 0.12, 0.07], MET); }
  }
  for (let X = -hw + 7; X <= hw - 7; X += 15) { if (lod < 2) bollard(g, [X, yq + 0.02, -0.75], 1.7, [0.05, 0.05, 0.055], lod); if (lod === 0 && hash1(Math.round(X), 2) < 0.5) coil(g, [X + 0.9, yq + 0.02, -1.1], 0.3 + 0.1 * hash1(Math.round(X), 1)); }
  // ---- lamp posts, benches, bins, life rings, the name board ----
  for (let X = -hw + 16; X <= hw - 8; X += 32) lampPost(g, [X, yq, -4.6], Math.PI / 2, 6.4, lamps, lod);
  if (lod < 2) {
    for (let X = -hw + 30; X <= hw - 20; X += 44) { bench(g, [X, yq, -5.6], 0, lod); bin(g, [X + 1.6, yq, -5.7], 0, lod); }
    for (let X = -hw + 24; X <= hw - 12; X += 58) ringPost(g, [X, yq, -1.6], 0, lod);
    // the name board, facing the water
    const bw = q.name.length * 0.52 + 0.8, bx = hw * 0.35;
    for (const s of [-1, 1]) rod(g, [bx + s * (bw / 2 - 0.2), yq, -6.4], [bx + s * (bw / 2 - 0.2), yq + 3.2, -6.4], 0.06, [0.75, 0.75, 0.72], GEL, 5);
    box(g, [bx, yq + 2.75, -6.33], bw / 2, 0.45, 0.03, [0.06, 0.12, 0.3], GEL);
    if (lod === 0) text(g, q.name, [bx, yq + 2.52, -6.29], [1, 0, 0], [0, 1, 0], 0.46, [0.85, 0.85, 0.8], GEL, { centre: true, weight: 0.2 });
    hoist(g, [-hw * 0.55, yq, -1.3], lod, lamps);
  }
  // ---- working clutter in the strip between the edge and the roadway, placed in slots along the quay ----
  // (a slot's choices are all drawn before anything is built, so every level of detail lays out the same quay)
  const slotW = 9, n = Math.floor((2 * hw - 16) / slotW), who = [], seed0 = Math.round(q.x * 7 + q.z * 3);
  for (let k = 0; k < n; k++) {
    const S = rng(seed0 + k * 977 + 5);
    const X = -hw + 8 + (k + 0.5) * slotW + (S() - 0.5) * 2, r = S(), zin = 5.5 + S() * 3.5, yaw = (S() - 0.5) * 0.5, y = yq;
    const person = S() < 0.6, px = X + 1.6 + S(), pz = -zin + 1.4 + S(), pyaw = S() * TAU, pal = Math.floor(S() * 10), skin = Math.floor(S() * 4), pose = ['hips', 'stand', 'point', 'mug', 'clipboard', 'camera'][Math.floor(S() * 6)];
    const jit = (S() - 0.5) * 0.3, cnt = 2 + Math.floor(S() * 4);
    const Q = rng(seed0 + k * 31 + 11);
    if (Math.abs(X + hw * 0.55) < 5) continue;                      // the hoist's ground
    if (r < 0.2) creelStack(g, [X, y, -zin], yaw, Q, lod, protos);
    else if (r < 0.36) fishBoxes(g, [X, y, -zin], yaw, Q, lod);
    else if (r < 0.46) { if (lod < 2) netHeap(g, [X, y, -zin], yaw, Q, lod); }
    else if (r < 0.56) van(g, [X, y, -8.6], Math.PI + jit * 0.4, Q, lod);
    else if (r < 0.66) trailerBoat(g, [X, y, -8.2], Math.PI / 2 + jit, Q, lod, protos);
    else if (r < 0.74) { if (lod < 2) { for (let d = 0; d < 3; d++) drum(g, [X + (d - 1) * 0.66, y, -zin + (d === 1 ? 0.5 : 0)], [[0.1, 0.2, 0.5], [0.55, 0.1, 0.06], [0.2, 0.2, 0.22]][d], lod, k + d); pallet(g, [X + 2.2, y, -zin], yaw, cnt, lod); } }
    else if (r < 0.8) { if (lod < 2) { const b = protos.boats[k % 3]; stamp(g, b, frame([X, y + 0.52, -zin - 0.5], yaw + 1.2, 0, Math.PI)); for (const s of [-1, 1]) box(g, [X + s * 0.9, y + 0.1, -zin - 0.5], 0.08, 0.1, 0.5, [0.3, 0.22, 0.13], RUB, { yaw: yaw + 1.2 }); } }
    // people stand about where there is something to stand by
    if (r < 0.5 && who.length < 7 && person) who.push({ x: px, y, z: pz, yaw: pyaw, pal, skin, pose });
  }
  // someone on a bench, someone at the edge
  if (2 * hw > 60) { who.push({ x: -hw + 30.3, y: yq - 0.04, z: -5.6, yaw: Math.PI / 2, pal: 3, skin: 1, pose: 'sit' }); who.push({ x: hw * 0.2, y: yq, z: -1.7, yaw: Math.PI / 2 + 0.3, pal: 6, skin: 2, pose: 'binoculars' }); }
  people(g, who.concat(extras.people || []), lod);
  return { g, lamps };
}

// ---- a slipway: concrete laid down a natural shore, as ground, about (0, 0, 0) = its top ----
// s: { x, z, dx, dz (down the slope), len, w }; heightAt gives the ground it lies on
export function slipGeo(s, heightAt, lod = 0) {
  const g = new Geo(2048), n = lod ? 6 : Math.ceil(s.len / 1.5), m = lod ? 1 : 4, px = -s.dz, pz = s.dx;
  sheet(g, n + 1, m + 1, (i, j, out) => {
    const t = (i / n) * s.len, u = (j / m - 0.5) * s.w, x = s.x + s.dx * t + px * u, z = s.z + s.dz * t + pz * u;
    // a slab: it bridges the hollows of the ground and is level across
    const yc = heightAt(s.x + s.dx * t, s.z + s.dz * t);
    out[0] = x - s.x; out[1] = Math.max(yc, heightAt(x, z)) + 0.14; out[2] = z - s.z;
  }, [1, 1, 1], CONC);
  // kerbs down both sides
  if (lod === 0) for (const side of [-1, 1]) sheet(g, n + 1, 2, (i, j, out) => {
    const t = (i / n) * s.len, u = side * (s.w / 2 + j * 0.25), x = s.x + s.dx * t + px * u, z = s.z + s.dz * t + pz * u;
    out[0] = x - s.x; out[1] = heightAt(s.x + s.dx * t, s.z + s.dz * t) + (j ? -0.3 : 0.28); out[2] = z - s.z;
  }, [0.9, 0.9, 0.9], CONC);
  return g;
}
// find a gentle natural shore beside a quay to lay a slipway on: down from about 2.4 m to 1.3 m under water
export function findSlip(field, q) {
  let best = null;
  const sm = { h: 0, gx: 0, gz: 0 };
  for (const s of [-1, 1]) for (let zin = 10; zin <= q.depth + 40; zin += 4) for (let off = 8; off <= 70; off += 6) {
    const X = s * (q.half(zin) + off), p = q.W(X, -zin);
    field.sample(p[0], p[1], sm);
    if (sm.h < 1.9 || sm.h > 2.9) continue;
    const gl = Math.hypot(sm.gx, sm.gz);
    if (gl < 0.03 || gl > 0.3) continue;
    const dx = -sm.gx / gl, dz = -sm.gz / gl;
    // walk down: it must fall steadily and reach the water within 45 m
    let len = 0, ok = true, prev = sm.h;
    for (let t = 2; t <= 46; t += 2) { const h = field.heightAt(p[0] + dx * t, p[1] + dz * t); if (h > prev + 0.15) { ok = false; break; } prev = h; if (h < -1.3) { len = t; break; } }
    if (!ok || !len || len < 14) continue;
    const score = Math.abs(len - 26) + off * 0.2;
    if (!best || score < best.score) best = { x: p[0], z: p[1], dx, dz, len, w: 6.5, score };
  }
  return best;
}

// ---- a pier ----
export function pierGeo(P, lod = 0) {
  const g = new Geo(lod === 0 ? 65536 : 8192), lamps = [], R = rng(Math.round(P.x * 5 + P.z * 11) + 3);
  const yp = P.yp, w = P.w, hw = w / 2, a = hw - 0.4, len = P.len;
  const deckY = (t) => (t >= P.tOut || P.quay ? yp : Math.max(P.hAt(t) + 0.1, yp - (P.tOut - t) * 0.12));
  const pilePaint = stain(P.x, { weedTop: 0.6, tide: 1.05, wet: 1.7, salt: 0.18 });
  const tim = (c, k = 0.2) => (lod === 0 ? { paint: both(mottle(c, k, 2.5), pilePaint) } : { paint: pilePaint });
  // ---- bents: a pair of piles, a cap beam, cross-bracing, walers ----
  const bay = 5.5, nb = Math.max(2, Math.round((len - P.tOut - 0.6) / bay)), bents = [];
  for (let k = 0; k <= nb; k++) bents.push(lerp(P.tOut + 0.6, len - 0.5, k / nb));
  for (let k = 0; k < bents.length; k++) {
    const t = bents[k], bed = Math.max(P.hAt(t) - 0.6, -4.5);
    for (const s of [-1, 1]) {
      const pts = [], top = yp - 0.42, lean = s * 0.06;
      const step = lod === 0 ? 0.45 : lod === 1 ? 1.2 : 9;
      for (let y = bed; y < top; y += y < -1 || y > 2.4 ? Math.max(step, 1.2) : step) pts.push([t + (hash1(k, 3) - 0.5) * 0.05, y, s * a + lean * (1 - (y - bed) / (top - bed))]);
      pts.push([t, top, s * a]);
      tube(g, pts, lod === 2 ? 0.2 : 0.185, TIMBER, GRAIN, { segs: lod === 0 ? 8 : lod === 1 ? 5 : 3, paint: pilePaint });
    }
    if (lod < 2) {
      slab(g, t - 0.16, t + 0.16, yp - 0.42, yp - 0.12, -hw - 0.1, hw + 0.1, TIMBER, GRAIN, tim(k));
      const y0 = Math.max(bed + 0.4, 0.55), y1 = yp - 0.6;
      if (y1 - y0 > 0.8) {
        for (const s of [-1, 1]) { const s1 = mark(g); rod(g, [t + 0.2 * s, y0, -a * s], [t + 0.2 * s, y1, a * s], 0.07, TIMBER, GRAIN, 4, tim(k + 7)); void s1; }
        rod(g, [t - 0.24, y0 + 0.1, -a - 0.2], [t - 0.24, y0 + 0.1, a + 0.2], 0.075, TIMBER, GRAIN, 4, tim(k + 3));
      }
      // a brace along the pier in every other bay, each side
      if (k < bents.length - 1 && k % 2 === 0 && y1 - y0 > 0.8) for (const s of [-1, 1]) rod(g, [t, y1, s * (a + 0.2)], [bents[k + 1], y0 + 0.2, s * (a + 0.2)], 0.065, TIMBER, GRAIN, 4, tim(k + 11));
    }
  }
  // stringers
  if (lod < 2) for (const z of [-a, 0, a]) slab(g, P.tOut - 1, len, yp - 0.12, yp - 0.07, z - 0.11, z + 0.11, scl(TIMBER, 0.9), GRAIN);
  if (lod < 2) for (const s of [-1, 1]) slab(g, P.tOut - 1, len, yp - 0.34, yp - 0.07, s * (hw + 0.02) - 0.05, s * (hw + 0.02) + 0.05, TIMBER, GRAIN, tim(s + 5, 0.15));
  // ---- the deck: planks laid across, each its own tone; the boardwalk ashore follows the ground up ----
  if (lod === 0) {
    const pw = 0.22;
    for (let t = P.t0; t < len - 0.01; t += pw) {
      const y = (deckY(t) + deckY(t + pw)) / 2, h = hash1(Math.round(t * 50), 7), tone = 0.72 + 0.4 * h, fresh = hash1(Math.round(t * 50), 9) < 0.06;
      const c = fresh ? [0.5, 0.4, 0.24] : [DECK[0] * tone, DECK[1] * tone, DECK[2] * tone * 0.98];
      slab(g, t + 0.008, t + pw - 0.008, y - 0.07, y, -hw - 0.06 - 0.05 * hash1(Math.round(t * 50), 11), hw + 0.06 + 0.05 * hash1(Math.round(t * 50), 13), c, GRAIN, { bottom: scl(c, 0.4) });
    }
  } else {
    const n = Math.ceil((len - P.t0) / (lod === 1 ? 2 : 20));
    for (let k = 0; k < n; k++) { const t0 = lerp(P.t0, len, k / n), t1 = lerp(P.t0, len, (k + 1) / n), y0 = deckY(t0), y1 = deckY(t1), tone = 0.85 + 0.2 * hash1(k, 5), c = scl(DECK, tone);
      quad(g, [t0, y0, -hw - 0.08], [t0, y0, hw + 0.08], [t1, y1, hw + 0.08], [t1, y1, -hw - 0.08], c, GRAIN);
      for (const s of [-1, 1]) quad(g, [t0, y0, s * (hw + 0.08)], [t1, y1, s * (hw + 0.08)], [t1, y1 - 0.3, s * (hw + 0.08)], [t0, y0 - 0.3, s * (hw + 0.08)], scl(TIMBER, 1.1), GRAIN);
      quad(g, [t0, y0 - 0.3, -hw], [t1, y1 - 0.3, -hw], [t1, y1 - 0.3, hw], [t0, y0 - 0.3, hw], scl(TIMBER, 0.5), RUB); }
  }
  // short posts under the boardwalk where it stands clear of the ground
  if (lod < 2 && !P.quay) for (let t = P.t0 + 2; t < P.tOut; t += 3) { const y = deckY(t), h = P.hAt(t); if (y - h > 0.35) for (const s of [-1, 1]) rod(g, [t, h - 0.3, s * a], [t, y - 0.07, s * a], 0.1, TIMBER, GRAIN, 5); }
  // ---- kerbs, railings, lamp posts, ladders, rings, the head ----
  const ladders = len > 60 ? [len * 0.5, len - 3] : [len - 3];
  if (lod < 2) {
    const rs = Math.max(P.t0 + 1, P.tOut - 6), white = [0.62, 0.63, 0.62];
    for (const s of [-1, 1]) {
      slab(g, rs, len, yp, yp + 0.12, s * (hw - 0.02) - 0.07, s * (hw - 0.02) + 0.07, scl(TIMBER, 1.3), GRAIN);
      // the rail, broken at a ladder's head on the starboard side
      const runs = [];
      let from = rs;
      if (s > 0) for (const lt of ladders) { if (lt - 0.6 > from) runs.push([from, lt - 0.6]); from = lt + 0.6; }
      if (len - 0.1 > from) runs.push([from, len - 0.1]);
      for (const [r0, r1] of runs) railing(g, [[r0, deckY(r0) + 0.1, s * (hw - 0.02)], [Math.max(r0, P.tOut), yp + 0.1, s * (hw - 0.02)], [r1, yp + 0.1, s * (hw - 0.02)]].filter((p, i, A) => i === 0 || p[0] > A[i - 1][0] + 0.05), white, MET, { h: 1.05, every: 1.9, rails: lod ? [1] : [0.36, 0.68, 1], r: lod ? 0.035 : 0.026, segs: lod ? 3 : 5 });
    }
    railing(g, [[len - 0.1, yp + 0.1, -hw + 0.02], [len - 0.1, yp + 0.1, hw - 0.02]], white, MET, { h: 1.05, every: 1.5, rails: lod ? [1] : [0.36, 0.68, 1], r: lod ? 0.035 : 0.026, segs: lod ? 3 : 5 });
  }
  let side = 1;
  for (let t = Math.max(P.tOut + 4, 6); t < len - 6; t += 26) { lampPost(g, [t, yp, side * (hw - 0.3)], side > 0 ? -Math.PI / 2 : Math.PI / 2, 4.2, lamps, lod, [0.5, 0.52, 0.52]); side = -side; }
  if (lod === 0) {
    for (const lt of ladders) ladder(g, [lt, -1.0, hw + 0.1], [lt, yp + 0.1, hw + 0.1], [1, 0, 0], [0.45, 0.33, 0.2], MET, { w: 0.44, r: 0.024 });
    for (let t = Math.max(P.tOut + 10, 14); t < len - 8; t += 38) { box(g, [t, yp + 0.75, -hw + 0.05], 0.3, 0.3, 0.015, [0.6, 0.06, 0.04], GEL); lifering(g, [t, yp + 0.75, -hw + 0.1], [0, 0, 1], 0.24, 0); }
    // tyres on the head's piles
    for (const s of [-1, 1]) hoop(g, [len + 0.08, 1.2, s * a], [1, 0, 0], 0.3, 0.11, [0.028, 0.028, 0.03], RUB, 12, 5);
  }
  // the head: a light on a post, and a shelter with a bench where the pier is long enough to want one
  const who = [];
  { const s0 = mark(g);
    rod(g, [0, 0, 0], [0, 2.6, 0], 0.05, [0.6, 0.62, 0.62], MET, lod ? 4 : 6);
    if (lod < 2) { lathe(g, [[0.1, 2.6], [0.1, 2.66], [0.07, 2.68], [0.07, 2.86], [0.1, 2.88], [0, 2.95]], [0.2, 0.9, 0.3], LIT, { segs: 8 }); }
    xf(g, s0, frame([len - 0.5, yp, hw - 0.4]));
    lamps.push({ p: [len - 0.5, yp + 2.78, hw - 0.4], col: [0.2, 1, 0.35], kind: 'nav', size: 0.5 });
  }
  if (len >= 70 && lod < 2) {
    const s0 = mark(g), wall = [0.2, 0.26, 0.22], tr = [0.7, 0.7, 0.66];
    const hx = 1.5, hz = 1.05, hh = 2.25;
    // three boarded walls, open toward the pier's other side, a lean-to roof
    const board = lod === 0 ? { paint: (Pp, N, C, i) => { const k = 0.85 + 0.3 * hash1(Math.round((Pp[i] + Pp[i + 2]) / 0.14), 3); C[i] *= k; C[i + 1] *= k; C[i + 2] *= k; } } : undefined;
    box(g, [0, hh / 2, -hz], hx, hh / 2, 0.04, wall, GRAIN, board);
    for (const s of [-1, 1]) box(g, [s * hx, hh / 2, 0], 0.04, hh / 2, hz, wall, GRAIN, board);
    quad(g, [-hx - 0.2, hh + 0.05, -hz - 0.25], [hx + 0.2, hh + 0.05, -hz - 0.25], [hx + 0.2, hh + 0.42, hz + 0.3], [-hx - 0.2, hh + 0.42, hz + 0.3], [0.12, 0.13, 0.14], CORR, { along: (Pp, i) => Pp[i] });
    for (const s of [-1, 1]) quad(g, [s * hx, hh, -hz], [s * hx, hh, hz], [s * hx, hh + 0.38, hz], [s * hx, hh + 0.03, -hz], wall, GRAIN);
    slab(g, -hx + 0.1, hx - 0.1, 0.42, 0.47, -hz + 0.08, -hz + 0.5, [0.33, 0.24, 0.14], GRAIN);
    if (lod === 0) { for (const s of [-1, 1]) rod(g, [s * (hx - 0.03), 0, hz], [s * (hx - 0.03), hh + 0.36, hz], 0.05, tr, GRAIN, 4); box(g, [0, 1.75, -hz + 0.05], 0.5, 0.3, 0.01, [0.75, 0.75, 0.7], GEL); text(g, 'NO DIVING', [0, 1.68, -hz + 0.065], [1, 0, 0], [0, 1, 0], 0.13, [0.6, 0.05, 0.04], GEL, { centre: true }); }
    xf(g, s0, frame([len - 6.5, yp, -hw + 1.25]));
    who.push({ x: len - 6.9, y: yp - 0.03, z: -hw + 0.62, yaw: Math.PI / 2, pal: 2, skin: 0, pose: 'mug' });
    lamps.push({ p: [len - 6.5, yp + 2.0, -hw + 1.0], col: WARM, kind: 'window', size: 0.9 });
  }
  if (lod < 2) {
    // a bench half way, fish boxes and a bucket by the rail, and the people who fish and look
    const tb = lerp(P.tOut, len, 0.45);
    if (len > 50) bench(g, [tb, yp, -hw + 0.6], 0, lod);
    fishBoxes(g, [len - 12 > P.tOut ? len - 12 : len - 4, yp, hw - 0.9], 0.2, R, lod);
    who.push({ x: len - 2.2, y: yp, z: 0.4, yaw: 0.2, pal: 5, skin: 1, pose: 'lean' });
    if (len > 50) who.push({ x: lerp(P.tOut, len, 0.62), y: yp, z: hw - 0.55, yaw: Math.PI / 2, pal: 8, skin: 3, pose: 'lean' }, { x: tb + 0.2, y: yp - 0.04, z: -hw + 0.6, yaw: Math.PI / 2, pal: 1, skin: 2, pose: 'sit' });
    if (len > 100) who.push({ x: lerp(P.tOut, len, 0.25), y: yp, z: 0.6, yaw: 2.6, pal: 4, skin: 0, pose: 'camera' }, { x: lerp(P.tOut, len, 0.8), y: yp, z: -hw + 0.7, yaw: -Math.PI / 2, pal: 9, skin: 1, pose: 'point' });
    // a rod over the rail for whoever leans there
    if (lod === 0) rod(g, [len - 2.0, yp + 1.0, 0.7], [len + 2.4, yp + 2.6, 1.0], 0.012, [0.1, 0.1, 0.1], RUB, 3);
  }
  people(g, who, lod);
  void guano; void GLS; void CLOTH; void blob;
  return { g, lamps };
}
