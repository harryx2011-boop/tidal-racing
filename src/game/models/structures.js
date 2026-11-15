import { Geo, MAT, add, sub, norm, cross } from '../geo.js';
import { noise3, fbm, recolour, seaStain, revolve, rod, lerp, clamp, smooth, mixc } from './marks.js';

// Fixed structures: a lighthouse on a rock, a rubble-mound breakwater with a light on its head,
// piled channel beacons, an offshore platform. Model space: y up, y = 0 the still waterline; a
// fixed structure does not move with the waves (the sea rises and falls against it). Every
// builder returns { g, lamps } where a lamp is { p, col, kind, ... } in model space (scenery.js
// draws the glows); lod 0 is the near model (thousands of triangles), lod 1 the far one.
// Colours are linear albedo.

const M = (id, tint = 0, glow = 0) => [id, tint, glow];
const GEL = M(MAT.GELCOAT), RUB = M(MAT.RUBBER), MET = M(MAT.METAL), GLS = M(MAT.GLASS), LIT = M(MAT.LIGHT, 0, 1), NSK = M(MAT.NONSKID);
const polar = (r, a, y) => [r * Math.cos(a), y, r * Math.sin(a)];
const TAU = Math.PI * 2;

export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// box with its centre at c, half sizes, rotated by yaw about the vertical through c
export function obox(g, c, hx, hy, hz, yaw, col, mat) {
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  const P = (x, y, z) => [c[0] + x * cs - z * sn, c[1] + y, c[2] + x * sn + z * cs];
  g.hexa([P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, -hy, hz), P(-hx, -hy, hz)], [P(-hx, hy, -hz), P(hx, hy, -hz), P(hx, hy, hz), P(-hx, hy, hz)], col, mat);
}
// a vertical quad facing out along the direction a (angle in the xz plane), width w along the tangent, standing on the point c
function wallQuad(g, c, a, w, h, col, mat, y0 = 0) {
  const t = [-Math.sin(a), 0, Math.cos(a)], n = [Math.cos(a), 0, Math.sin(a)];
  const P = (s, y) => [c[0] + t[0] * s, c[1] + y, c[2] + t[2] * s];
  g.quad(P(-w / 2, y0), P(w / 2, y0), P(w / 2, y0 + h), P(-w / 2, y0 + h), col, mat, n);
}
// round-ended ring of posts and two rails (a railing) at radius r
function railing(g, r, y, h, n, col, lod) {
  if (lod) return;
  for (let k = 0; k < n; k++) rod(g, polar(r, (k / n) * TAU, y), polar(r, (k / n) * TAU, y + h), 0.025, col, MET, 4);
  for (const f of [0.5, 1]) {
    const pts = Array.from({ length: n + 1 }, (_, k) => polar(r, (k / n) * TAU, y + h * f));
    g.tube(pts, 0.03, col, MET, { segs: 4 });
  }
}
// a surface of revolution placed at (cx, y0, cz); the profile goes up the side then inward across the top (see revolve)
export function solid(g, prof, col, mat, segs = 12, cx = 0, y0 = 0, cz = 0) {
  const t = new Geo();
  revolve(t, prof, col, mat, segs);
  for (let i = 0; i < t.p.length; i += 3) { t.p[i] += cx; t.p[i + 1] += y0; t.p[i + 2] += cz; }
  for (const k of ['p', 'n', 'c', 'm', 'uv']) g[k].push(...t[k]);
}
// a lamp description
const lamp = (p, col, kind, extra = {}) => ({ p, col, kind, ...extra });

// ---- a triangular lattice mast between two points ---------------------------------------
function lattice(g, a, b, w, bays, col, rr = 0.07, segs = 4) {
  const d = norm(sub(b, a)), L = Math.hypot(...sub(b, a));
  const ref = Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = norm(cross(d, ref)), v = cross(d, u);
  const corner = (k, i) => {
    const th = (k / 3) * TAU + Math.PI / 2;
    const c = add(u.map((x) => x * Math.cos(th) * w), v.map((x) => x * Math.sin(th) * w));
    return add(a, add(d.map((x) => x * (L * i) / bays), c));
  };
  for (let k = 0; k < 3; k++) rod(g, corner(k, 0), corner(k, bays), rr * 1.5, col, MET, segs);
  for (let i = 0; i < bays; i++) for (let k = 0; k < 3; k++) {
    const k2 = (k + 1) % 3;
    rod(g, corner(k, i), corner(k2, i + 1), rr, col, MET, 3);
    rod(g, corner(k, i), corner(k2, i), rr, col, MET, 3);
  }
}

// =========================================================================================
// Lighthouse on a rock
// =========================================================================================
export const LIGHTHOUSE = { rockR: 27, lampY: 30.5, height: 37, radius: 22 };
const RISE = 1.6;   // the tower stands this far above the rock's old crest
// the rock: an irregular mound from below the sea to a flat crest at y = 3.2
function rock(g, R, seed, lod) {
  const segs = lod ? 14 : 40, rows = lod ? 5 : 14;
  const rings = [];
  for (let k = 0; k <= rows; k++) {
    const v = k / rows;
    const ring = [];
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * TAU, c = Math.cos(a), s = Math.sin(a);
      const n1 = fbm(c * 1.3 + seed, v * 2.0, s * 1.3), n2 = noise3(c * 4.5 + seed * 2, v * 5, s * 4.5);
      // ridged noise: creases and buttresses run up the flanks
      const ridge = 1 - Math.abs(noise3(c * 3.2 + seed * 3, v * 1.5, s * 3.2) - 0.5) * 2;
      // the crest stays round and flat where the tower stands; the flanks are craggy
      const crag = (1 - v * 0.55) * ((n1 - 0.5) * 0.9 + (ridge - 0.5) * 0.45 + (n2 - 0.5) * 0.25);
      const r = R * (1 - 0.7 * Math.pow(v, 0.9)) * (1 + crag);
      // a ledge between the rows, a hump on the landward side
      const hump = 2.6 * Math.max(0, fbm(c * 1.1 + 9, 0.5, s * 1.1 + seed) - 0.4) * (0.4 + v);
      const y = lerp(-5, 5.2, Math.pow(v, 0.7)) + (n2 - 0.5) * 1.8 * (1 - v * v) + hump * v;
      ring.push([c * r, k === rows ? 5.0 + (n2 - 0.5) * 0.3 + hump * 0.5 : y, s * r]);
    }
    rings.push(ring);
  }
  rings.push(Array.from({ length: segs }, () => [0, 5.1, 0]));
  g.loft(rings, [0.2, 0.19, 0.17], RUB, { ref: () => [0, -1, 0] });
}
export function lighthouseGeo(lod = 0, seed = 3) {
  const g = new Geo(), lamps = [];
  const segs = lod ? 12 : 28;
  rock(g, LIGHTHOUSE.rockR, seed, lod);
  const t0 = g.p.length;
  const white = [0.62, 0.6, 0.55], red = [0.5, 0.06, 0.04], stone = [0.3, 0.28, 0.25], copper = [0.1, 0.27, 0.2];
  const rad = (y) => 4.6 - 0.065 * (y - 3.4);
  // plinth, then four painted bands
  const bands = [[3.2, 5.6, stone], [5.6, 10.7, white], [10.7, 15.8, red], [15.8, 20.9, white], [20.9, 26.0, red]];
  for (const [y0, y1, col] of bands) {
    const COLS = Array.from({ length: 26 }, (_, k) => -14 + (k * 27.5) / 25);
  const prof = lod ? [[rad(y0), y0], [rad(y1), y1]] : [[rad(y0), y0], [rad((y0 + y1) / 2), (y0 + y1) / 2], [rad(y1), y1]];
    g.lathe(prof, col, RUB, segs);
    if (!lod) revolve(g, [[rad(y1) + 0.06, y1 - 0.12], [rad(y1) + 0.06, y1 + 0.02], [rad(y1) - 0.01, y1 + 0.02]], col === white ? [0.5, 0.48, 0.44] : [0.4, 0.05, 0.03], RUB, segs);
  }
  // gallery: a corbelled slab with a railing
  revolve(g, [[3.0, 25.4], [4.5, 25.95], [4.5, 25.95], [4.5, 26.4], [4.5, 26.4], [3.0, 26.4]], [0.5, 0.5, 0.47], RUB, lod ? 12 : 28);
  railing(g, 4.3, 26.4, 1.05, 18, [0.55, 0.56, 0.55], lod);
  // lantern room: a drum, glazing between mullions, a dome of patinated copper with a ball
  g.lathe([[2.35, 26.4], [2.35, 27.6]], red, GEL, lod ? 10 : 24);
  g.lathe([[2.0, 27.6], [2.0, 30.0]], [0.03, 0.04, 0.05], GLS, lod ? 10 : 24);
  if (!lod) {
    for (let k = 0; k < 12; k++) { const a = (k / 12) * TAU; rod(g, polar(2.03, a, 27.6), polar(2.03, a, 30.05), 0.045, [0.12, 0.13, 0.13], MET, 4); }
    for (const y of [27.6, 29.0, 30.05]) g.tube(Array.from({ length: 25 }, (_, k) => polar(2.03, (k / 24) * TAU, y)), 0.05, [0.12, 0.13, 0.13], MET, { segs: 4 });
  }
  revolve(g, [[2.25, 29.95], [2.35, 30.05], [2.35, 30.05], [2.35, 30.3], [1.7, 31.5], [1.0, 32.3], [0.3, 32.8], [0, 32.9]], copper, GEL, lod ? 10 : 24);
  if (!lod) {
    solid(g, [[0.2, 32.85], [0.3, 33.2], [0.3, 33.4], [0.2, 33.6], [0.0, 33.65]], copper, GEL, 10);
    rod(g, [0, 33.6, 0], [0, 35.2, 0], 0.02, [0.3, 0.3, 0.3], MET, 3);
  }
  // the lamp: a lens inside the glazing
  g.lathe([[0.2, 28.1], [0.75, 28.4], [0.85, 28.9], [0.75, 29.4], [0.2, 29.7]], [1, 0.86, 0.5], LIT, lod ? 8 : 14);
  lamps.push(lamp([0, LIGHTHOUSE.lampY, 0], [1, 0.9, 0.62], 'beam'));
  if (!lod) {
    // windows on the climb, their stone surrounds, the door and its steps
    for (let k = 0; k < 5; k++) {
      const y = 8 + k * 4, a = 0.9 + k * 1.15, r = rad(y) + 0.02;
      const c = [Math.cos(a) * r, 0, Math.sin(a) * r];
      wallQuad(g, [c[0] * 1.012, 0, c[2] * 1.012], a, 0.7, 1.35, [0.38, 0.36, 0.33], RUB, y - 0.78);
      wallQuad(g, [c[0] * 1.02, 0, c[2] * 1.02], a, 0.46, 1.05, [0.015, 0.02, 0.025], GEL, y - 0.63);
    }
    const dr = rad(5.5);
    obox(g, [dr + 0.1, 4.55, 0], 0.22, 1.15, 0.9, 0, [0.34, 0.32, 0.29], RUB);
    obox(g, [dr + 0.28, 4.45, 0], 0.08, 1.0, 0.62, 0, [0.07, 0.04, 0.02], RUB);
    for (let k = 0; k < 3; k++) obox(g, [dr + 0.7 + k * 0.4, 3.3 + k * 0.38 - 0.4, 0], 0.4, 0.4, 1.3 - k * 0.15, 0, [0.28, 0.27, 0.25], RUB);
    // the keeper's store: a low hut with a pitched slate roof, and a landing quay
    const hc = [-8.5, 3.0, 3.0];
    obox(g, [hc[0], hc[1] + 0.5, hc[2]], 3.0, 2.4, 2.1, 0.3, [0.58, 0.56, 0.5], RUB);
    const cs = Math.cos(0.3), sn = Math.sin(0.3), rp = (x, y, z) => [hc[0] + x * cs - z * sn, hc[1] + y, hc[2] + x * sn + z * cs];
    const rf = [0.1, 0.1, 0.11];
    g.quad(rp(-3.3, 2.8, -2.4), rp(3.3, 2.8, -2.4), rp(3.3, 4.2, 0), rp(-3.3, 4.2, 0), rf, RUB, norm(cross(sub(rp(3.3, 2.8, -2.4), rp(-3.3, 2.8, -2.4)), sub(rp(-3.3, 4.2, 0), rp(-3.3, 2.8, -2.4)))));
    g.quad(rp(3.3, 2.8, 2.4), rp(-3.3, 2.8, 2.4), rp(-3.3, 4.2, 0), rp(3.3, 4.2, 0), rf, RUB, norm(cross(sub(rp(-3.3, 2.8, 2.4), rp(3.3, 2.8, 2.4)), sub(rp(3.3, 4.2, 0), rp(3.3, 2.8, 2.4)))));
    { const gn = [-cs, 0, -sn]; g.tri(rp(-3.0, 2.8, -2.1), rp(-3.0, 2.8, 2.1), rp(-3.0, 4.15, 0), gn, gn, gn, [0.58, 0.56, 0.5], RUB); }
    obox(g, rp(-3.15, 1.5, 0.3), 0.05, 0.85, 0.5, 0.3, [0.07, 0.04, 0.02], RUB);
  }
  for (let i = t0 + 1; i < g.p.length; i += 3) g.p[i] += RISE;
  // weathering: salt and weed at the waterline, grime under the gallery and the bands' joints
  recolour(g, (p, n, c, mid) => {
    if (mid === MAT.RUBBER && p[1] > 5.0 && p[1] < 28.6 && Math.hypot(p[0], p[2]) < 5.2 && Math.hypot(p[0], p[2]) > 2.0) {
      const streak = noise3(Math.atan2(p[2], p[0]) * 9 + seed, p[1] * 0.35, 0);
      const k = 0.82 + 0.3 * streak - 0.22 * smooth(1.5, 0, 28.0 - p[1]) * streak;
      return [c[0] * k, c[1] * k, c[2] * k * 0.98];
    }
    if (mid === MAT.RUBBER && Math.hypot(p[0], p[2]) > 5.3) {
      // dark wet rock with paler strata, orange lichen high up, bird droppings on the tops, weed at the waterline
      const st = noise3(p[0] * 0.18 + seed, p[1] * 1.1, p[2] * 0.18);
      let r = mixc([0.03, 0.029, 0.028], [0.11, 0.1, 0.088], st * st * 1.4);
      const top = n[1] > 0.55 ? 1 : 0.25;
      r = mixc(r, [0.2, 0.09, 0.025], smooth(0.66, 0.85, noise3(p[0] * 0.5, p[1] * 0.3, p[2] * 0.5 + seed)) * smooth(1.2, 3, p[1]) * 0.5);
      r = mixc(r, [0.55, 0.54, 0.5], smooth(0.64, 0.82, noise3(p[0] * 0.9 + seed, p[1] * 0.5, p[2] * 0.9)) * smooth(1.5, 3, p[1]) * top);
      // the sea's work: a wet black band, barnacles above it, green weed below
      const y = p[1] + (noise3(p[0] * 0.8, p[1], p[2] * 0.8) - 0.5) * 0.5;
      r = mixc(r, [0.015, 0.016, 0.015], smooth(1.8, 0.9, y) * 0.8);
      r = mixc(r, [0.3, 0.29, 0.25], smooth(0.9, 1.0, y) * smooth(1.5, 1.2, y) * 0.5);
      return mixc(r, [0.025, 0.05, 0.02], smooth(0.4, 0.0, y) * 0.9);
    }
    return c;
  });
  return { g, lamps };
}

// =========================================================================================
// Breakwater: a rubble mound with a concrete crown wall and a lit head
// =========================================================================================
// seaward profile first: [offset across, height]; offsets are measured from the crest axis, negative
// toward the sea
const MOUND = [[-18, -4.0], [-13.5, -1.6], [-9.5, 0.6], [-6.5, 2.2], [-4.4, 3.4], [-3.2, 3.75], [-2.2, 3.7], [2.8, 3.6], [4.6, 2.6], [7.2, 1.0], [10.5, -0.8], [14.5, -2.6], [17, -4.0]];
export const BREAKWATER = { crest: 3.7, wall: 5.3, headR: 15, chunk: 56 };
const moundY = (a) => {
  for (let i = 0; i < MOUND.length - 1; i++) if (a <= MOUND[i + 1][0]) { const t = (a - MOUND[i][0]) / (MOUND[i + 1][0] - MOUND[i][0]); return lerp(MOUND[i][1], MOUND[i + 1][1], t); }
  return MOUND[MOUND.length - 1][1];
};
// resample a polyline as a smooth path (Catmull-Rom), points every `step` metres: [{ x, z, tx, tz, s }]
export function smoothPath(path, step) {
  const P = (i) => path[clamp(i, 0, path.length - 1)];
  const dense = [];
  for (let i = 0; i < path.length - 1; i++) for (let k = 0; k < 100; k++) {
    const t = k / 100, p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
    dense.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
  }
  dense.push(path[path.length - 1]);
  const out = [];
  let acc = 0, next = 0;
  for (let i = 0; i < dense.length; i++) {
    if (i > 0) acc += Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]);
    if (i === 0 || i === dense.length - 1 || acc >= next) { out.push({ x: dense[i][0], z: dense[i][1], s: acc }); next = acc + step; if (i === dense.length - 1) break; }
  }
  for (let i = 0; i < out.length; i++) {
    const a = out[Math.max(i - 1, 0)], b = out[Math.min(i + 1, out.length - 1)];
    const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    out[i].tx = (b.x - a.x) / l; out[i].tz = (b.z - a.z) / l;
  }
  return out;
}
// Cellular (Worley) noise on the plane: [distance to the nearest cell centre in cells, that cell's random 0..1].
// Cobbles and rubble: each cell is one stone.
const cellHash = (x, z) => { const n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return n - Math.floor(n); };
export function cells(x, z, cs, out) {
  const gx = Math.floor(x / cs), gz = Math.floor(z / cs);
  let f1 = 9, id = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = gx + i, cz = gz + j, h = cellHash(cx, cz), px = (cx + 0.15 + 0.7 * h) * cs, pz = (cz + 0.15 + 0.7 * cellHash(cz + 7.3, cx - 3.1)) * cs;
    const d = Math.hypot(x - px, z - pz) / cs;
    if (d < f1) { f1 = d; id = h; }
  }
  out[0] = f1; out[1] = id;
  return out;
}
const _cell = [0, 0];
// A cube knocked about: one armour stone
function stone(g, c, s, rnd, col) {
  const yaw = rnd() * TAU, cs = Math.cos(yaw), sn = Math.sin(yaw);
  const corner = (sx, sy, sz) => {
    const j = () => 0.62 + rnd() * 0.5;
    const x = sx * s * j(), y = sy * s * 0.7 * j(), z = sz * s * j();
    return [c[0] + x * cs - z * sn, c[1] + y, c[2] + x * sn + z * cs];
  };
  const b = [corner(-1, -1, -1), corner(1, -1, -1), corner(1, -1, 1), corner(-1, -1, 1)];
  const t = [corner(-1, 1, -1), corner(1, 1, -1), corner(1, 1, 1), corner(-1, 1, 1)];
  g.hexa(b, t, col, RUB);
}
// All the chunks of a breakwater following `path` (world xz points), `side` = +1 when the sea is to
// the left of the direction of travel. Each chunk is { g, x, z, r }: geometry relative to (x, z).
// The last point is the head, with a round mound and a white tower carrying a red light.
export function breakwaterChunks(path, side, lod, seed = 5) {
  const rows = smoothPath(path, lod ? 14 : 1.2);
  const rnd = rng(seed * 77 + (lod ? 1 : 0));
  const chunks = [];
  const nSea = (p) => [-p.tz * side, p.tx * side];       // to the sea
  const at = (p, a, y) => { const n = nSea(p); return [p.x - n[0] * a, y, p.z - n[1] * a]; };
  const COLS = Array.from({ length: 26 }, (_, k) => -14 + (k * 27.5) / 25);
  const prof = lod ? MOUND.filter((_, i) => i % 2 === 0 || i === 5 || i === 7 || i === MOUND.length - 1) : MOUND;
    // chunk k covers arc length [k, k + 1) * chunk, the same at both levels of detail
  const total = rows[rows.length - 1].s;
  for (let k0 = 0; k0 * BREAKWATER.chunk < total - 1; k0++) {
    const s0 = k0 * BREAKWATER.chunk, s1 = Math.min(s0 + BREAKWATER.chunk, total);
    const i0 = rows.findIndex((r) => r.s >= s0 - 1e-6);
    let i1 = rows.findIndex((r) => r.s >= s1 - 1e-6);
    if (i1 < 0 || s1 >= total) i1 = rows.length - 1;
    if (i1 <= i0) continue;
    const g = new Geo(), lamps = [];
    const o = rows[i0], ox = o.x, oz = o.z;
    const slice = rows.slice(i0, i1 + 1);
    // the mound surface: rubble. Near: a fine grid whose height follows cellular noise, one cell a
    // stone, with the crest road left flat; far: the plain profile
    const cols = lod ? prof.map((q) => q[0]) : COLS;
    const pts = slice.map((p) => cols.map((a) => {
      const y = moundY(a), n = nSea(p), q = at(p, a, y);
      if (lod) return [q[0] - ox, y, q[2] - oz];
      const w = smooth(-3.0, -4.6, a) + smooth(2.6, 4.2, a);
      const c = cells(q[0], q[2], 2.1, _cell), big = fbm(q[0] * 0.25 + 3, y * 0.4, q[2] * 0.25) - 0.5;
      const dy = w * (0.78 * (1 - smooth(0.0, 0.85, c[0])) * (0.6 + 0.8 * c[1]) + big * 1.5);
      const sh = w * (c[0] - 0.4) * 0.35 * (c[1] - 0.5);
      return [q[0] - ox + n[0] * sh, y + dy, q[2] - oz + n[1] * sh];
    }));
    g.grid(pts, [0.11, 0.11, 0.105], RUB, (P) => [P[0], P[1] - 8, P[2]]);
    // the crown wall on the seaward edge of the crest, and a low kerb on the harbour edge
    for (let i = 0; i < slice.length - 1; i++) {
      const A = slice[i], B = slice[i + 1], nA = nSea(A), nB = nSea(B);
      const Q = (p, n, a, y) => [p.x - n[0] * a - ox, y, p.z - n[1] * a - oz];
      const wc = [0.42, 0.41, 0.39];
      const nn = [nA[0] + nB[0], 0, nA[1] + nB[1]], nl = norm(nn), un = nl.map((x) => -x);
      g.quad(Q(A, nA, -3.2, 3.7), Q(B, nB, -3.2, 3.7), Q(B, nB, -3.2, BREAKWATER.wall), Q(A, nA, -3.2, BREAKWATER.wall), wc, RUB, nl);
      g.quad(Q(A, nA, -3.2, BREAKWATER.wall), Q(B, nB, -3.2, BREAKWATER.wall), Q(B, nB, -2.2, BREAKWATER.wall), Q(A, nA, -2.2, BREAKWATER.wall), [0.5, 0.49, 0.46], RUB, [0, 1, 0]);
      g.quad(Q(B, nB, -2.2, 3.7), Q(A, nA, -2.2, 3.7), Q(A, nA, -2.2, BREAKWATER.wall), Q(B, nB, -2.2, BREAKWATER.wall), wc, RUB, un);
      if (!lod) {
        // the road deck, a little lighter, between the wall and the kerb
        g.quad(Q(A, nA, -2.2, 3.76), Q(B, nB, -2.2, 3.76), Q(B, nB, 2.6, 3.7), Q(A, nA, 2.6, 3.7), [0.3, 0.3, 0.28], RUB, [0, 1, 0]);
      }
    }
    // armour stones on the slopes
    if (!lod) {
      const len = slice[slice.length - 1].s - slice[0].s;
      const count = Math.round(len * 0.5);
      for (let k = 0; k < count; k++) {
        const u = rnd() * (slice.length - 1), i = Math.floor(u), f = u - i;
        const A = slice[i], B = slice[Math.min(i + 1, slice.length - 1)];
        const p = { x: lerp(A.x, B.x, f), z: lerp(A.z, B.z, f), tx: lerp(A.tx, B.tx, f), tz: lerp(A.tz, B.tz, f) };
        const seaSide = rnd() < 0.62;
        const a = seaSide ? -(3.8 + rnd() * 11) : 3.4 + rnd() * 8;
        const q = at(p, a, moundY(a) + 0.1);
        const s = 0.8 + rnd() * 0.9;
        const v = 0.07 + rnd() * 0.14;
        stone(g, [q[0] - ox, q[1] + s * 0.3, q[2] - oz], s, rnd, [v * 1.03, v, v * 0.94]);
      }
    }
    // the head: a round mound and a tower with a red light
    if (i1 === rows.length - 1) {
      const e = rows[rows.length - 1], c = [e.x - ox, 0, e.z - oz];
      const R = BREAKWATER.headR;
      const prof2 = lod ? [[R + 4, -4], [R - 5, 1], [R - 8.5, 3.7], [0, 3.8]] : [[R + 4, -4], [R - 1.5, -1.4], [R - 5, 0.8], [R - 7, 2.4], [R - 9.5, 3.7], [R - 10.5, 3.8], [0, 3.8]];
      solid(g, prof2, [0.22, 0.21, 0.2], RUB, lod ? 12 : 24, c[0], 0, c[2]);
      if (!lod) for (let k = 0; k < 50; k++) {
        const a = rnd() * TAU, rr = R - 1 - rnd() * 8, s = 0.6 + rnd() * 0.7, v = 0.16 + rnd() * 0.18;
        const y = rr > R - 9 ? lerp(3.7, 0.2, (rr - (R - 9)) / 8) : 3.8;
        stone(g, [c[0] + Math.cos(a) * rr, y + s * 0.3, c[2] + Math.sin(a) * rr], s, rnd, [v * 1.03, v, v * 0.94]);
      }
      const ty = 3.8;
      g.lathe([[2.0, ty], [1.55, ty + 4.5], [1.45, ty + 5.2]], [0.7, 0.69, 0.66], RUB, lod ? 8 : 16, c[0], c[2]);
      g.lathe([[1.45, ty + 5.2], [1.45, ty + 6.0]], [0.55, 0.05, 0.04], RUB, lod ? 8 : 16, c[0], c[2]);
      solid(g, [[2.2, ty + 6.0], [2.2, ty + 6.25], [1.3, ty + 6.25]], [0.4, 0.4, 0.4], RUB, lod ? 8 : 16, c[0], 0, c[2]);
      g.lathe([[0.9, ty + 6.3], [0.9, ty + 7.6]], [0.03, 0.04, 0.05], GLS, lod ? 8 : 12, c[0], c[2]);
      g.lathe([[0.3, ty + 6.6], [0.65, ty + 6.9], [0.3, ty + 7.3]], [1, 0.1, 0.06], LIT, lod ? 6 : 10, c[0], c[2]);
      solid(g, [[1.0, ty + 7.6], [0.7, ty + 8.4], [0.0, ty + 8.8]], [0.5, 0.05, 0.04], GEL, lod ? 8 : 14, c[0], 0, c[2]);
      lamps.push(lamp([c[0], ty + 7.0, c[2]], [1, 0.1, 0.06], 'flash', { period: 5, on: 0.9 }));
    }
    recolour(g, (p, n, c, mid) => {
      if (mid !== MAT.RUBBER) return c;
      const wx = p[0] + ox, wz = p[2] + oz;
      if (!lod && p[1] < 3.5 && n[1] > 0.2) {
        // each stone its own grey, dark in the crevices
        const ce = cells(wx, wz, 2.1, _cell), v = 0.05 + 0.14 * ce[1] * ce[1], dark = 1 - 0.7 * smooth(0.5, 0.95, ce[0]);
        c = [v * 1.04 * dark, v * dark, v * 0.93 * dark];
      }
      return seaStain(c, [wx, p[1], wz], seed, { weedTop: 1.0, tide: 1.3 });
    });
    // chunk radius: half its length plus the width of the mound
    const mid = slice[slice.length >> 1];
    chunks.push({ g, lamps, x: ox, z: oz, cx: mid.x, cz: mid.z, r: (slice[slice.length - 1].s - slice[0].s) / 2 + 20 });
  }
  return chunks;
}

// =========================================================================================
// A piled beacon: three raking piles, a platform, a post with a topmark and a light
// =========================================================================================
// style: 'port' (red can), 'stbd' (green cone), 'north' (black over yellow, cones up), 'east', 'isolated'
export const BEACON = { radius: 3, height: 13 };
const BEACON_STYLES = {
  port: { body: [0.5, 0.05, 0.04], band: [0.5, 0.05, 0.04], lens: [1, 0.1, 0.06], mark: 'can', period: 4 },
  stbd: { body: [0.04, 0.32, 0.1], band: [0.04, 0.32, 0.1], lens: [0.1, 1, 0.25], mark: 'cone', period: 4 },
  north: { body: [0.04, 0.04, 0.045], band: [0.62, 0.5, 0.05], lens: [1, 1, 1], mark: 'cones', period: 3 },
  isolated: { body: [0.04, 0.04, 0.045], band: [0.5, 0.05, 0.04], lens: [1, 1, 1], mark: 'ball', period: 6 },
};
export function beaconGeo(style = 'port', lod = 0, seed = 1) {
  const S = BEACON_STYLES[style], g = new Geo(), lamps = [];
  const pile = [0.16, 0.15, 0.14], rnd = rng(seed);
  const a0 = rnd() * TAU, ns = lod ? 5 : 8;
  for (let k = 0; k < 3; k++) {
    const a = a0 + (k / 3) * TAU;
    g.tube([polar(2.2, a, -4), polar(1.55, a, 1.5), polar(1.0, a, 6.2)], 0.3, pile, RUB, { segs: ns });
  }
  if (!lod) {
    // horizontal ties and a ladder up one pile
    for (const [y, r] of [[1.2, 1.6], [3.6, 1.28]]) for (let k = 0; k < 3; k++) rod(g, polar(r, a0 + (k / 3) * TAU, y), polar(r, a0 + ((k + 1) / 3) * TAU, y), 0.07, pile, RUB, 4);
    for (let y = 0.6; y < 6; y += 0.5) { const a = a0 + 0.1, r = 1.7 - (y / 6) * 0.65; rod(g, polar(r, a - 0.12, y), polar(r, a + 0.12, y), 0.03, [0.4, 0.4, 0.4], MET, 3); }
  }
  // platform and rail
  solid(g, [[0.0, 6.0], [1.9, 6.0], [1.9, 6.0], [1.9, 6.25], [0.0, 6.25]], [0.3, 0.3, 0.28], RUB, lod ? 8 : 18);
  railing(g, 1.8, 6.25, 0.95, 12, [0.55, 0.55, 0.55], lod);
  // post, painted in bands, with the day mark
  const post = (y0, y1, col) => g.lathe([[0.2, y0], [0.2, y1]], col, GEL, lod ? 6 : 10);
  post(6.25, 8.0, S.body); post(8.0, 9.6, S.band); post(9.6, 10.3, S.body);
  if (style === 'north' || style === 'isolated') post(6.25, 8.0, S.band);
  // lantern
  g.lathe([[0.42, 10.3], [0.42, 10.45], [0.5, 10.5], [0.5, 11.3], [0.42, 11.35], [0.42, 11.5]], [0.12, 0.12, 0.13], MET, lod ? 6 : 12);
  g.lathe([[0.4, 10.5], [0.4, 11.3]], S.lens, LIT, lod ? 6 : 12);
  lamps.push(lamp([0, 10.9, 0], S.lens, 'flash', { period: S.period, on: 0.7 }));
  // top mark
  const tm = (y0, h, r) => solid(g, [[r, y0], [0.0, y0 + h]], [0.04, 0.04, 0.045], GEL, lod ? 6 : 10);
  if (S.mark === 'can') solid(g, [[0.5, 11.6], [0.5, 12.5], [0.0, 12.5]], S.body, GEL, lod ? 6 : 10);
  else if (S.mark === 'cone') tm(11.6, 1.2, 0.55);
  else if (S.mark === 'cones') { tm(11.6, 0.8, 0.5); tm(12.5, 0.8, 0.5); }
  else solid(g, [[0.0, 11.6], [0.35, 11.8], [0.5, 12.2], [0.35, 12.6], [0.0, 12.8]], S.body, GEL, lod ? 6 : 10);
  // weed and growth on the piles, guano on the platform
  recolour(g, (p, n, c, mid) => {
    if (mid !== MAT.RUBBER) return c;
    if (p[1] > 6.1 && n[1] > 0.5) return mixc(c, [0.55, 0.54, 0.5], 0.5 * noise3(p[0] * 3 + seed, p[2] * 3, 1));
    return seaStain(c, p, seed, { weedTop: 0.8, tide: 1.0 });
  });
  return { g, lamps };
}

// =========================================================================================
// Offshore platform: a jacket on four legs, decks, accommodation with a helideck, a crane, a flare
// =========================================================================================
export const PLATFORM = { deckY: 17, radius: 40, height: 58, flareTip: [-38, 52, -25] };
const LEG = (y) => [lerp(18, 13.5, (y + 6) / 23), lerp(14, 9.5, (y + 6) / 23)];   // half extents of the leg frame at height y
export function platformGeo(lod = 0, seed = 2) {
  const g = new Geo(), lamps = [];
  const steel = [0.24, 0.26, 0.28], white = [0.62, 0.64, 0.64], blue = [0.07, 0.14, 0.28], orange = [0.62, 0.2, 0.04], deck = [0.19, 0.2, 0.21], yellow = [0.62, 0.5, 0.05];
  const segs = lod ? 5 : 10;
  const corners = (y) => { const [hx, hz] = LEG(y); return [[-hx, y, -hz], [hx, y, -hz], [hx, y, hz], [-hx, y, hz]]; };
  // legs
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const pts = [-6, 5, PLATFORM.deckY].map((y) => { const [hx, hz] = LEG(y); return [sx * hx, y, sz * hz]; });
    g.tube(pts, 1.05, steel, MET, { segs });
  }
  // bracing: horizontals and cross bracing between levels
  const levels = lod ? [-1.5, 6.5, 14] : [-1.5, 3.5, 8.5, 14];
  for (let li = 0; li < levels.length; li++) {
    const c = corners(levels[li]);
    if (!lod) for (let k = 0; k < 4; k++) rod(g, c[k], c[(k + 1) % 4], 0.45, steel, MET, 5);
    if (li === levels.length - 1) continue;
    const d = corners(levels[li + 1]);
    for (let k = 0; k < 4; k++) {
      const k2 = (k + 1) % 4;
      rod(g, c[k], d[k2], lod ? 0.4 : 0.5, steel, MET, lod ? 3 : 5);
      if (!lod) rod(g, c[k2], d[k], 0.5, steel, MET, 5);
    }
  }
  // decks
  const dy = PLATFORM.deckY;
  g.box(-20, 20, dy, dy + 1.4, -14.5, 14.5, deck, M(MAT.NONSKID));
  g.box(-18, 18, dy - 2.2, dy, -12.5, 12.5, [0.12, 0.13, 0.14], RUB);
  // process modules
  const mods = [[2, 7, -3.5, 8, 4.4, 5.5, white], [11, 5.5, -8, 5, 3.6, 4, blue], [8.5, 15.5, 2.5, 4.5, 2.6, 3.5, white], [0.5, 8, 6.8, 5, 5, 3.4, orange]];
  for (const [x, y, z, hx, hy, hz, col] of mods) { g.box(x - hx, x + hx, dy + 1.4, dy + 1.4 + 2 * hy, z - hz, z + hz, col, GEL); }
  // accommodation block at the -x end: four storeys with window bands, on the roof the helideck
  const ax0 = -19.5, ax1 = -4, ay0 = dy + 1.4, ay1 = dy + 1.4 + 13;
  g.box(ax0, ax1, ay0, ay1, -6, 6.5, [0.66, 0.66, 0.62], GEL);
  g.box(ax0 - 0.2, ax1 + 0.2, ay1, ay1 + 0.5, -6.2, 6.7, [0.3, 0.3, 0.3], RUB);
  const win = [1, 0.8, 0.45];
  for (let f = 0; f < 4; f++) {
    const y = ay0 + 2.2 + f * 3, nw = lod ? 0 : 9;
    for (let k = 0; k < nw; k++) {
      const x = ax0 + 1.4 + k * (ax1 - ax0 - 2.8) / (nw - 1);
      for (const [zz, n] of [[6.5, [0, 0, 1]], [-6, [0, 0, -1]]]) { const o = n[2] * 0.02; g.quad([x - 0.45, y, zz + o], [x + 0.45, y, zz + o], [x + 0.45, y + 1.05, zz + o], [x - 0.45, y + 1.05, zz + o], win, LIT, n); }
    }
    if (!lod) for (let k = 0; k < 5; k++) {
      const z = -4.5 + k * 2.4;
      g.quad([ax0 - 0.02, y, z - 0.4], [ax0 - 0.02, y, z + 0.4], [ax0 - 0.02, y + 1.05, z + 0.4], [ax0 - 0.02, y + 1.05, z - 0.4], win, LIT, [-1, 0, 0]);
    }
  }
  if (lod) {
    // far: one lit band per side stands for the windows
    for (let f = 0; f < 3; f++) { const y = ay0 + 2.2 + f * 3.6; g.quad([ax0 + 1, y, 6.52], [ax1 - 1, y, 6.52], [ax1 - 1, y + 1.1, 6.52], [ax0 + 1, y + 1.1, 6.52], win, LIT, [0, 0, 1]); g.quad([ax1 - 1, y, -6.02], [ax0 + 1, y, -6.02], [ax0 + 1, y + 1.1, -6.02], [ax1 - 1, y + 1.1, -6.02], win, LIT, [0, 0, -1]); }
  }
  // helideck: an octagon on struts, a green surface with a painted circle and H
  const hy = ay1 + 2.8, hc = [-17, hy, 0.25], hr = 11;
  const oct = Array.from({ length: 16 }, (_, k) => [hc[0] + Math.cos((k / 16) * TAU) * hr, hy, hc[2] + Math.sin((k / 16) * TAU) * hr]);
  g.fan(oct, hc, [0, 1, 0], [0.1, 0.2, 0.14], NSK);
  g.fan(oct.map((p) => [p[0], p[1] - 0.45, p[2]]).reverse(), [hc[0], hy - 0.45, hc[2]], [0, -1, 0], [0.12, 0.12, 0.12], RUB);
  for (let k = 0; k < 16; k++) { const a = oct[k], b = oct[(k + 1) % 16]; g.quad([a[0], hy - 0.45, a[2]], [b[0], hy - 0.45, b[2]], b, a, [0.55, 0.55, 0.5], RUB, norm([(a[0] + b[0]) / 2 - hc[0], 0, (a[2] + b[2]) / 2 - hc[2]])); }
  // painted ring and H (thin slabs just above the surface)
  const ring = (r0, r1, n, col) => { for (let k = 0; k < n; k++) { const a0 = (k / n) * TAU, a1 = ((k + 1) / n) * TAU, y = hy + 0.015; g.quad([hc[0] + Math.cos(a0) * r0, y, hc[2] + Math.sin(a0) * r0], [hc[0] + Math.cos(a0) * r1, y, hc[2] + Math.sin(a0) * r1], [hc[0] + Math.cos(a1) * r1, y, hc[2] + Math.sin(a1) * r1], [hc[0] + Math.cos(a1) * r0, y, hc[2] + Math.sin(a1) * r0], col, RUB, [0, 1, 0]); } };
  ring(hr - 1.3, hr - 0.4, 16, [0.62, 0.62, 0.6]);
  ring(5.6, 6.2, lod ? 10 : 20, [0.6, 0.5, 0.05]);
  const hb = (x0, x1, z0, z1) => g.quad([hc[0] + x0, hy + 0.02, hc[2] + z0], [hc[0] + x1, hy + 0.02, hc[2] + z0], [hc[0] + x1, hy + 0.02, hc[2] + z1], [hc[0] + x0, hy + 0.02, hc[2] + z1], [0.7, 0.7, 0.68], RUB, [0, 1, 0]);
  hb(-1.6, -1.0, -2.1, 2.1); hb(1.0, 1.6, -2.1, 2.1); hb(-1.0, 1.0, -0.3, 0.3);
  if (!lod) {
    for (const [x, z] of [[-9, -6], [-9, 6.5], [-9, 0], [-22, 0]]) rod(g, [x, ay1, z], [hc[0] + (x - hc[0]) * 0.55, hy - 0.45, hc[2] + (z - hc[2]) * 0.55], 0.28, steel, MET, 5);
    // green perimeter lights, and a net rail
    for (let k = 0; k < 16; k++) { const p = oct[k]; solid(g, [[0.0, 0.0], [0.16, 0.0], [0.16, 0.0], [0.16, 0.2], [0.0, 0.2]], [0.2, 1, 0.3], LIT, 6, p[0], hy + 0.05, p[2]); }
  }
  for (let k = 0; k < 8; k++) lamps.push(lamp([oct[k * 2][0], hy + 0.3, oct[k * 2][2]], [0.3, 1, 0.4], 'steady', { size: 0.25, level: 0.5 }));
  // crane: pedestal, cab, lattice boom
  const cp = [13, dy + 1.4, 10.5];
  solid(g, [[1.5, 0], [1.4, 3.4], [0.0, 3.4]], yellow, GEL, lod ? 6 : 12, cp[0], cp[1], cp[2]);
  g.box(cp[0] - 1.6, cp[0] + 1.6, cp[1] + 3.4, cp[1] + 6.4, cp[2] - 1.5, cp[2] + 2.2, yellow, GEL);
  g.box(cp[0] + 1.62, cp[0] + 1.75, cp[1] + 4.3, cp[1] + 6.0, cp[2] - 0.9, cp[2] + 1.6, [0.02, 0.03, 0.04], GLS);
  const tip = [cp[0] + 18, cp[1] + 26, cp[2] + 9];
  if (lod) rod(g, [cp[0], cp[1] + 6, cp[2]], tip, 0.9, yellow, GEL, 4);
  else {
    lattice(g, [cp[0], cp[1] + 6, cp[2]], tip, 0.8, 11, yellow, 0.09);
    rod(g, [cp[0] - 3.6, cp[1] + 5.4, cp[2]], [cp[0] + 8, cp[1] + 14, cp[2] + 4], 0.12, [0.3, 0.3, 0.3], MET, 3);
    rod(g, tip, [tip[0] - 0.1, tip[1] - 14, tip[2] - 0.1], 0.04, [0.2, 0.2, 0.2], MET, 3);
    obox(g, [tip[0] - 0.1, tip[1] - 14.2, tip[2] - 0.1], 0.6, 0.35, 0.6, 0.3, [0.5, 0.5, 0.5], MET);
  }
  lamps.push(lamp([tip[0], tip[1] + 0.8, tip[2]], [1, 0.1, 0.06], 'obstruction', { size: 0.4 }));
  // flare boom: a long lattice leaning out from a corner, with the flare tip
  const fb = [-18, dy + 1.4, -12.5], ft = PLATFORM.flareTip;
  if (lod) rod(g, fb, ft, 0.8, [0.45, 0.46, 0.46], MET, 4);
  else lattice(g, fb, ft, 1.0, 14, [0.45, 0.46, 0.46], 0.09);
  g.lathe([[0.45, 0], [0.3, 0.8], [0.7, 1.4], [0.55, 1.5]].map(([r, y]) => [r, y + ft[1] - 0.2]), [0.25, 0.1, 0.05], MET, lod ? 6 : 10, ft[0], ft[2]);
  lamps.push(lamp([ft[0], ft[1] + 2.2, ft[2]], [1, 0.5, 0.15], 'flare', { size: 3 }));
  // radio mast on the roof of the process module, with a dish
  const mb = [4, dy + 1.4 + 11.5, -3.5], mt = [4, 49, -3.5];
  if (lod) rod(g, mb, mt, 0.5, [0.5, 0.5, 0.5], MET, 3); else {
    lattice(g, mb, mt, 0.45, 12, [0.5, 0.5, 0.5], 0.06);
    solid(g, [[0.0, 0.0], [0.9, 0.35], [1.0, 0.45]], [0.7, 0.7, 0.7], GEL, 10, 4.9, 40, -3.5);
  }
  lamps.push(lamp([mt[0], mt[1] + 0.6, mt[2]], [1, 0.1, 0.06], 'obstruction', { size: 0.5 }));
  lamps.push(lamp([-19.5, ay1 + 0.8, 6.2], [1, 0.1, 0.06], 'obstruction', { size: 0.3 }));
  // lifeboats, tanks and pipework on the deck; deck rail
  if (!lod) {
    for (const z of [-6.8, 7.4]) g.lathex([[-8, 0.2], [-7.4, 0.8], [-5, 1.0], [-2.6, 0.8], [-2, 0.2]], orange, GEL, 10, ay0 + 6, z);
    for (const [x, z] of [[-3, 11.5], [4, 11.5], [10, -12]]) solid(g, [[1.4, 0], [1.4, 4.2], [1.0, 5.0], [0, 5.3]], [0.65, 0.66, 0.66], GEL, 14, x, dy + 1.4, z);
    for (let k = 0; k < 5; k++) rod(g, [-3, dy + 3 + k * 0.5, 1 + k], [14, dy + 3 + k * 0.5, 1 + k], 0.22, [0.5, 0.52, 0.5], MET, 5);
    for (const [x0, z0, x1, z1] of [[-20, -14.5, 20, -14.5], [-20, 14.5, 20, 14.5], [20, -14.5, 20, 14.5]]) { rod(g, [x0, dy + 2.4, z0], [x1, dy + 2.4, z1], 0.05, [0.7, 0.55, 0.05], MET, 4); rod(g, [x0, dy + 1.9, z0], [x1, dy + 1.9, z1], 0.05, [0.7, 0.55, 0.05], MET, 4); }
    // boat landing: a ladder on one leg and a landing platform
    obox(g, [LEG(1)[0] + 2.2, 1.6, -LEG(1)[1]], 1.6, 0.12, 1.3, 0, [0.5, 0.45, 0.05], MET);
  }
  // floodlights: white points along the deck edge
  for (const [x, z] of [[18, -13], [18, 13], [-4, 13], [-4, -13], [18, 0], [8, 14]]) lamps.push(lamp([x, dy + 5.6, z], [1, 0.95, 0.8], 'flood', { size: 0.9 }));
  for (const [x, z] of [[18, -13], [18, 13], [-4, 13], [-4, -13], [18, 0], [8, 14]]) if (!lod) { rod(g, [x, dy + 1.4, z], [x, dy + 5.4, z], 0.07, steel, MET, 3); g.box(x - 0.3, x + 0.3, dy + 5.4, dy + 5.7, z - 0.4, z + 0.4, [0.9, 0.9, 0.8], LIT); }
  // splash zone: marine growth and rust streaks
  recolour(g, (p, n, c, mid) => {
    if (mid === MAT.METAL && p[1] < 5 && Math.hypot(p[0], p[2]) > 10) return seaStain(mixc(c, [0.2, 0.17, 0.12], 0.4), p, seed, { weedTop: 2.5, tide: 3.2 });
    if (mid === MAT.GELCOAT || mid === MAT.RUBBER) {
      const k = 0.88 + 0.2 * noise3(p[0] * 0.6 + seed, p[1] * 0.3, p[2] * 0.6);
      return [c[0] * k, c[1] * k, c[2] * k];
    }
    return c;
  });
  return { g, lamps };
}
