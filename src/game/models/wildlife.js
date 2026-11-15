import { Geo as SoupGeo, MAT, norm, cross, sub } from '../geo.js';
import { recolour, mixc } from './marks.js';
import { Geo, rng, TAU, lerp, clamp, smooth, scl, vn, fb, hash1, RUB, GEL, GLS, TEAK, CLOTH, SKIN, GRAIN, tube, rod, lathe, box, quad, fan, loft, surf, sheet, blob, limb, lin, mark, paint, xf, frame, text, mixIn, faded, stain, both } from './kit.js';

// Wildlife and small detail, as plain data and meshes. Nothing here touches GL except through
// Geo.build, so the builders run (and are counted) in node. Colours are linear albedo.
//
// Birds are not a Geo: one static mesh is deformed in the vertex shader (wildlife.js), so its
// vertices carry what the shader needs. Body space: x forward, y up, z to the right, metres, for a
// gull of 1.3 m wingspan.
//   position (3), shape normal (3), tag (4) = (part, span fraction s, surface +1 top / -1 under / 0, chord 0 LE .. 1 TE)
// Parts: 0 body, 1 wing, 2 tail, 3 neck and head, 4 bill, 5 legs. A wing vertex stores its
// chord length in the normal's x, so the shader can fold the wing along the flank.

const M = (id, tint = 0, glow = 0) => [id, tint, glow];

// ---- the bird ------------------------------------------------------------------------------
// wing stations (span fraction), leading and trailing edge x at each: a long, narrow, swept wing
export const WING_S = [0, 0.2, 0.42, 0.62, 0.8, 0.93, 1.0];
export const WING_HALF = 0.65;
const LE = [0.12, 0.13, 0.11, 0.05, -0.06, -0.2, -0.34];
const TE = [-0.1, -0.11, -0.13, -0.14, -0.2, -0.28, -0.37];

export function birdBuffers() {
  const P = [], N = [], T = [];
  const v = (p, n, part, s, surf, c) => { P.push(p[0], p[1], p[2]); N.push(n[0], n[1], n[2]); T.push(part, s, surf, c); };
  const tri = (a, b, c, na, nb, nc, part, tg) => { v(a, na, part, tg[0], tg[1], tg[2]); v(b, nb, part, tg[0], tg[1], tg[2]); v(c, nc, part, tg[0], tg[1], tg[2]); };
  // body: a spindle of elliptical rings
  const bx = [-0.3, -0.22, -0.1, 0.05, 0.18, 0.27, 0.31], by = [0.012, 0.04, 0.078, 0.09, 0.085, 0.058, 0.04], bz = [0.012, 0.05, 0.085, 0.095, 0.085, 0.05, 0.035];
  const ring = (x, ry, rz, y0, S, k) => { const a = (k / S) * TAU; return [[x, y0 + Math.sin(a) * ry, Math.cos(a) * rz], [0, Math.sin(a) / ry, Math.cos(a) / rz]]; };
  const loft = (xs, rys, rzs, ys, S, part) => {
    for (let i = 0; i < xs.length - 1; i++) for (let k = 0; k < S; k++) {
      const q = [[i, k], [i + 1, k], [i + 1, k + 1], [i, k + 1]].map(([a, b]) => { const r = ring(xs[a], rys[a], rzs[a], ys[a], S, b % S); const nn = norm(r[1]); return [r[0], nn]; });
      tri(q[0][0], q[1][0], q[2][0], q[0][1], q[1][1], q[2][1], part, [0, 0, 0]);
      tri(q[0][0], q[2][0], q[3][0], q[0][1], q[2][1], q[3][1], part, [0, 0, 0]);
    }
  };
  loft(bx, by, bz, bx.map(() => 0), 6, 0);
  // neck and head (pivot at the shoulder; rotated up when the bird stands)
  loft([0.27, 0.3, 0.34, 0.385, 0.41], [0.045, 0.036, 0.047, 0.04, 0.02], [0.04, 0.032, 0.044, 0.038, 0.018], [0.02, 0.035, 0.045, 0.045, 0.04], 5, 3);
  // bill: a cone
  for (let k = 0; k < 4; k++) {
    const a0 = (k / 4) * TAU, a1 = ((k + 1) / 4) * TAU;
    const p0 = [0.4, 0.038 + Math.sin(a0) * 0.016, Math.cos(a0) * 0.014], p1 = [0.4, 0.038 + Math.sin(a1) * 0.016, Math.cos(a1) * 0.014], tip = [0.47, 0.03, 0];
    const n = norm(cross(sub(p1, p0), sub(tip, p0)));
    tri(p0, p1, tip, n, n, n, 4, [0, 0, 0]);
  }
  // tail: a flat fan, top and bottom
  for (const surf of [1, -1]) {
    const n = [0, surf, 0], y = 0.004 * surf;
    tri([-0.28, y, -0.04], [-0.28, y, 0.04], [-0.46, y, 0.075], n, n, n, 2, [0, 0, surf]);
    tri([-0.28, y, -0.04], [-0.46, y, 0.075], [-0.46, y, -0.075], n, n, n, 2, [0, 0, surf]);
  }
  // legs: two thin blades (collapsed unless the bird stands)
  for (const z of [-0.04, 0.04]) {
    const n = [0, 0, 1];
    tri([0.02, -0.04, z], [-0.02, -0.04, z], [0.0, -0.17, z], n, n, n, 5, [0, 0, 0]);
    tri([0.0, -0.17, z], [-0.01, -0.17, z], [0.03, -0.17, z + 0.0], n, n, n, 5, [0, 0, 0]);
  }
  // wings: strips between stations, one mesh for the right wing; the left is its mirror in the shader
  // (z of the vertex carries the side: +z right, -z left). Top at +0.004, underside at -0.004.
  for (const side of [1, -1]) for (const surf of [1, -1]) for (let i = 0; i < WING_S.length - 1; i++) {
    const a = WING_S[i], b = WING_S[i + 1];
    const mk = (s, x, c, cl) => [[x, 0.004 * surf, side * s * WING_HALF], [cl, 0, 0], [1, s, surf, c]];
    const a0 = mk(a, LE[i], 0, LE[i] - TE[i]), a1 = mk(a, TE[i], 1, LE[i] - TE[i]), b0 = mk(b, LE[i + 1], 0, LE[i + 1] - TE[i + 1]), b1 = mk(b, TE[i + 1], 1, LE[i + 1] - TE[i + 1]);
    const emit = (p, q, r) => { for (const w of [p, q, r]) v(w[0], w[1], 1, w[2][1], surf, w[2][3]); };
    // a wing vertex's (side) is its z sign; surface is stored in tag.z, chord in tag.w
    if ((side * surf) > 0) { emit(a0, b0, b1); emit(a0, b1, a1); } else { emit(a0, b1, b0); emit(a0, a1, b1); }
  }
  return { pos: new Float32Array(P), nrm: new Float32Array(N), tag: new Float32Array(T), count: P.length / 3 };
}

// ---- dolphin ---------------------------------------------------------------------------------
// bottlenose, 2.6 m: a lofted body, a dorsal fin, flippers and flukes. x forward, y up.
export function dolphinGeo() {
  const g = new Geo();
  const xs = [-1.25, -1.0, -0.7, -0.35, 0.0, 0.35, 0.7, 0.95, 1.1, 1.22, 1.38];
  const ry = [0.015, 0.045, 0.085, 0.155, 0.215, 0.235, 0.2, 0.145, 0.095, 0.04, 0.012];
  const rz = [0.02, 0.05, 0.085, 0.14, 0.185, 0.2, 0.17, 0.12, 0.085, 0.045, 0.014];
  const yc = [0.03, 0.025, 0.015, 0.0, 0, 0, 0, 0, -0.01, -0.04, -0.05];
  const rings = xs.map((x, i) => Array.from({ length: 10 }, (_, k) => { const a = (k / 10) * TAU; return [x, yc[i] + Math.sin(a) * ry[i], Math.cos(a) * rz[i]]; }));
  g.loft(rings, [0.2, 0.22, 0.25], GEL, { ref: (i) => [xs[i], yc[i], 0] });
  const flat = (a, b, c, n, col) => g.tri(a, b, c, n, n, n, col, GEL);
  const fin = [0.1, 0.11, 0.13];
  flat([0.22, 0.2, 0], [-0.2, 0.2, 0], [-0.26, 0.47, 0], [0, 0, 1], fin);
  flat([0.22, 0.2, 0], [-0.26, 0.47, 0], [0.0, 0.26, 0], [0, 0, 1], fin);
  for (const s of [-1, 1]) flat([0.36, -0.15, s * 0.15], [0.12, -0.34, s * 0.4], [0.1, -0.1, s * 0.15], [0, 0.6, s * 0.8], fin);
  flat([-1.2, 0.02, 0.02], [-1.46, 0.02, 0.32], [-1.34, 0.02, 0], [0, 1, 0], fin);
  flat([-1.2, 0.02, -0.02], [-1.34, 0.02, 0], [-1.46, 0.02, -0.32], [0, 1, 0], fin);
  // dark back, pale belly: by the normal
  recolour(g, (p, n) => {
    const k = smooth(-0.35, 0.45, n[1]);
    const back = [0.06, 0.075, 0.09], belly = [0.5, 0.5, 0.5];
    const c = mixc(belly, back, k);
    return p[0] > 0.9 ? mixc(c, [0.12, 0.13, 0.14], 0.4) : c;
  });
  return g;
}

// a jumping mullet, 0.32 m
export function fishGeo() {
  const g = new Geo();
  const xs = [-0.16, -0.1, 0, 0.1, 0.18], ry = [0.008, 0.03, 0.046, 0.036, 0.008], rz = [0.006, 0.02, 0.03, 0.024, 0.006];
  g.loft(xs.map((x, i) => Array.from({ length: 6 }, (_, k) => { const a = (k / 6) * TAU; return [x, Math.sin(a) * ry[i], Math.cos(a) * rz[i]]; })), [0.6, 0.65, 0.7], GEL, { ref: (i) => [xs[i], 0, 0] });
  const fin = [0.3, 0.33, 0.38];
  g.tri([-0.15, 0.0, 0], [-0.27, 0.08, 0], [-0.25, 0.0, 0], [0, 0, 1], [0, 0, 1], [0, 0, 1], fin, GEL);
  g.tri([-0.15, 0.0, 0], [-0.25, 0.0, 0], [-0.27, -0.08, 0], [0, 0, 1], [0, 0, 1], [0, 0, 1], fin, GEL);
  g.tri([0.0, 0.045, 0], [-0.07, 0.045, 0], [-0.05, 0.1, 0], [0, 0, 1], [0, 0, 1], [0, 0, 1], fin, GEL);
  recolour(g, (p, n, c) => (n[1] > 0.25 ? [0.1, 0.14, 0.18] : c));
  return g;
}

// ---- flotsam -------------------------------------------------------------------------------
// a mat of kelp: ribbons laid out from a few centres, floating at the surface
export function kelpGeo(seed = 1) {
  const g = new Geo(), R = rng(seed * 977 + 3);
  const centres = [[0, 0], [R() * 3 - 1.5 + 2.2, R() * 3 - 1.5 - 1.0], [R() * 3 - 1.5 - 2.0, R() * 3 - 1.5 + 1.3]];
  for (const [cx, cz] of centres) for (let i = 0; i < 12; i++) {
    const a = R() * TAU, L = 0.7 + 1.9 * R() * R() + 0.3, w0 = 0.07 + 0.09 * R(), ph = R() * 6;
    const dx = Math.cos(a), dz = Math.sin(a), px = -dz, pz = dx;
    const sx = cx + (R() - 0.5) * 0.8, sz = cz + (R() - 0.5) * 0.8;
    const k = 0.55 + 0.8 * R();
    const col = mixc([0.022, 0.026, 0.007], [0.07, 0.075, 0.018], R());
    const c = [col[0] * k, col[1] * k, col[2] * k];
    const at = (u, side) => {
      const wobble = Math.sin(ph + u * 4.0) * L * 0.1;
      const w = w0 * (1 - 0.7 * u) * side;
      return [sx + dx * L * u + px * (wobble + w), 0.025 + 0.03 * Math.sin(ph * 2 + u * 5) * u, sz + dz * L * u + pz * (wobble + w)];
    };
    for (let s = 0; s < 3; s++) {
      const u0 = s / 3, u1 = (s + 1) / 3;
      g.quad(at(u0, -1), at(u0, 1), at(u1, 1), at(u1, -1), c, RUB, norm([0.05 * Math.sin(ph + s), 1, 0.05 * Math.cos(ph + s)]));
    }
  }
  return g;
}

// a drifting log, 3.5 m, half awash: furrowed bark, a pale snapped end and a sawn one, stubs of branches, weed below
export function logGeo(seed = 1) {
  const g = new Geo(1024), R = rng(seed * 313 + 7);
  const L = 1.75, bark = [0.085, 0.07, 0.055], wood = [0.34, 0.28, 0.19];
  const bend = (R() - 0.5) * 0.16, taper = 0.75 + 0.2 * R(), r0 = 0.19 + 0.04 * R();
  const NX = 15, NS = 12;
  const rad = (u, a) => r0 * lerp(1, taper, u) * (1 + 0.1 * Math.sin(a * 5 + seed + u * 3) * vn(u * 6 + seed, a * 2, 1) + 0.07 * (vn(u * 9 + seed, Math.cos(a) * 2, Math.sin(a) * 2) - 0.5) + 0.12 * Math.exp(-Math.pow((u - 0.35) / 0.06, 2)) * (0.5 + 0.5 * Math.cos(a - 1)));
  const at = (i, j, out) => { const u = i / NX, a = (j / NS) * TAU, r = rad(u, a); out[0] = -L + u * 2 * L; out[1] = -0.05 + bend * Math.sin(u * Math.PI) + Math.sin(a) * r; out[2] = Math.cos(a) * r; };
  sheet(g, NX + 1, NS + 1, at, bark, GRAIN, { wrap: true, paint: (P, N, C, i) => {
    // furrows along the grain, lighter where the bark has gone, weed and a wet band below the waterline
    const k = 0.7 + 0.6 * vn(P[i] * 3 + seed, P[i + 1] * 30, P[i + 2] * 30), bare = smooth(0.62, 0.72, fb(P[i] * 1.3 + seed, P[i + 1] * 4, P[i + 2] * 4));
    C[i] *= k; C[i + 1] *= k; C[i + 2] *= k;
    mixIn(C, i, 0.3, 0.26, 0.19, bare * 0.8);
    mixIn(C, i, 0.03, 0.045, 0.02, smooth(-0.02, -0.16, P[i + 1]) * 0.85);
  } });
  // ends: one sawn flat with rings, one snapped into splinters
  const ring = (u) => Array.from({ length: NS }, (_, j) => { const o = [0, 0, 0]; at(u * NX, j, o); return o; });
  const e0 = ring(0), e1 = ring(1);
  fan(g, e0, wood, GRAIN, { paint: (P, N, C, i) => { const d = Math.hypot(P[i + 1] + 0.05, P[i + 2]); const k = 0.75 + 0.25 * Math.cos(d * 160); C[i] *= k; C[i + 1] *= k; C[i + 2] *= k; } });
  const c1 = e1.reduce((q, v) => [q[0] + v[0] / NS, q[1] + v[1] / NS, q[2] + v[2] / NS], [0, 0, 0]);
  for (let j = 0; j < NS; j++) { const a = e1[j], b = e1[(j + 1) % NS], tip = [c1[0] + 0.1 + 0.25 * R(), lerp(c1[1], (a[1] + b[1]) / 2, 0.5), lerp(c1[2], (a[2] + b[2]) / 2, 0.5)]; fan(g, [a, b, tip], scl(wood, 0.7 + 0.5 * R()), GRAIN); fan(g, [a, tip, c1], scl(wood, 0.5), GRAIN); }
  // branch stubs
  for (let i = 0; i < 3; i++) {
    const x = -1.2 + R() * 2.2, a = 0.5 + R() * 2.2, len = 0.18 + 0.4 * R(), c = Math.cos(a), sn = Math.sin(a), rr = 0.035 + 0.025 * R();
    tube(g, [[x, -0.05 + sn * 0.12, c * 0.12], [x + 0.04, -0.05 + sn * (0.2 + len * 0.5), c * (0.2 + len * 0.5)], [x + 0.1, -0.05 + sn * (0.2 + len), c * (0.2 + len) + 0.03]], [rr * 1.3, rr, rr * 0.7], bark, GRAIN, { segs: 6, caps: true });
  }
  return g;
}

// A fish box adrift. Odd seeds: a slatted wooden crate with rope beckets; even: a moulded plastic fish box with a
// rim, grips and a faded stripe. Both float low and a little down by one corner.
export function crateGeo(seed = 1) {
  const g = new Geo(512), R = rng(seed * 131 + 3);
  const hx = 0.34, hz = 0.22, y0 = -0.13, y1 = 0.17;
  if (seed & 1) {
    const col = [0.36, 0.27, 0.15], dark = scl(col, 0.6);
    const tone = () => scl(col, 0.78 + 0.4 * R());
    // corner posts, then slats with gaps on the sides and ends, and a boarded bottom
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, [sx * (hx - 0.02), (y0 + y1) / 2 + 0.01, sz * (hz - 0.02)], 0.022, (y1 - y0) / 2 + 0.01, 0.022, dark, TEAK);
    for (let k = 0; k < 3; k++) {
      const y = y0 + 0.045 + k * 0.1;
      for (const sz of [-1, 1]) box(g, [0, y, sz * hz], hx, 0.038, 0.008, tone(), TEAK);
      for (const sx of [-1, 1]) box(g, [sx * hx, y, 0], 0.008, 0.038, hz, tone(), TEAK);
    }
    for (let k = 0; k < 5; k++) box(g, [-hx + 0.07 + k * 0.136, y0 + 0.008, 0], 0.06, 0.008, hz - 0.01, tone(), TEAK);
    for (const sx of [-1, 1]) tube(g, [[sx * (hx + 0.01), y1 - 0.05, -0.08], [sx * (hx + 0.07), y1 - 0.11, -0.03], [sx * (hx + 0.07), y1 - 0.11, 0.03], [sx * (hx + 0.01), y1 - 0.05, 0.08]], 0.009, [0.5, 0.45, 0.32], CLOTH, { segs: 4 });
    if (R() < 0.6) box(g, [0.02, y1 + 0.012, -0.03], hx * 0.96, 0.009, hz * 0.6, tone(), TEAK, { yaw: 0.12 });
  } else {
    const col = [[0.05, 0.16, 0.42], [0.62, 0.2, 0.03], [0.5, 0.5, 0.48]][(seed >> 1) % 3], mark0 = mark(g);
    // tapered tub: outer wall, rolled rim, inner wall and floor
    const sec = (y, k) => [[-hx * k, y, -hz * k], [hx * k, y, -hz * k], [hx * k, y, hz * k], [-hx * k, y, hz * k]];
    const b0 = sec(y0, 0.86), t0 = sec(y1, 1), ti = sec(y1, 0.93), bi = sec(y0 + 0.03, 0.82);
    for (let k = 0; k < 4; k++) { quad(g, b0[k], b0[(k + 1) % 4], t0[(k + 1) % 4], t0[k], col, RUB); quad(g, ti[k], ti[(k + 1) % 4], bi[(k + 1) % 4], bi[k], scl(col, 0.7), RUB); quad(g, t0[k], t0[(k + 1) % 4], ti[(k + 1) % 4], ti[k], scl(col, 1.15), RUB); }
    quad(g, b0[0], b0[1], b0[2], b0[3], scl(col, 0.6), RUB); quad(g, bi[0], bi[1], bi[2], bi[3], scl(col, 0.55), RUB);
    tube(g, t0.map((q) => [q[0] * 1.03, q[1] - 0.015, q[2] * 1.04]), 0.018, scl(col, 1.1), RUB, { segs: 5, closed: true });
    // ribs on the long sides, hand grips in the ends, stencilled letters
    for (const sz of [-1, 1]) for (let k = 0; k < 4; k++) { const x = -0.24 + k * 0.16; quad(g, [x - 0.012, y0 + 0.02, sz * (hz * 0.89 + 0.012)], [x + 0.012, y0 + 0.02, sz * (hz * 0.89 + 0.012)], [x + 0.012, y1 - 0.03, sz * (hz + 0.01)], [x - 0.012, y1 - 0.03, sz * (hz + 0.01)], scl(col, 0.85), RUB); }
    for (const sx of [-1, 1]) box(g, [sx * (hx * 0.97 + 0.004), y1 - 0.07, 0], 0.004, 0.02, 0.07, [0.02, 0.02, 0.025], RUB);
    text(g, 'FV' + (11 + seed * 7), [-0.16, y1 - 0.13, hz * 0.96 + 0.014], [1, 0, 0], [0, 0.99, -0.12], 0.07, [0.8, 0.8, 0.76], RUB, { off: 0.003 });
    paint(g, mark0, both(faded(seed, 0.35), stain(seed, { weedTop: -0.02, tide: 0.02 })));
  }
  // down by a corner
  xf(g, 0, frame([0, 0, 0], 0, 0.07 + 0.08 * R(), 0.1 * (R() - 0.5)));
  return g;
}

// A pot marker: a float with a band (a hard plastic buoy or a pair of net floats), a cane through it with a
// pennant, a weight below, and the pick-up line trailing downwind to a small second float (+x: the caller
// turns it downwind).
export function potFloatGeo(seed = 1) {
  const g = new Geo(512);
  const cols = [[0.7, 0.16, 0.02], [0.75, 0.55, 0.03], [0.62, 0.62, 0.6], [0.5, 0.04, 0.03]];
  const col = cols[seed % cols.length], f = cols[(seed + 2) % cols.length], s0 = mark(g);
  if (seed & 1) {
    lathe(g, [[0.0, -0.2], [0.07, -0.19], [0.14, -0.12], [0.185, 0.0], [0.19, 0.1], [0.15, 0.2], [0.08, 0.26], [0.035, 0.28], [0.035, 0.31], [0.0, 0.31]], col, RUB, { segs: 12 });
    lathe(g, [[0.193, 0.03], [0.196, 0.06], [0.193, 0.09]], [0.03, 0.03, 0.035], RUB, { segs: 12 });
  } else {
    for (const [y, r] of [[-0.02, 0.15], [0.2, 0.13]]) blob(g, [0, y, 0], r, r * 0.8, r, y > 0 ? f : col, RUB, { n: 5, segs: 10 });
  }
  paint(g, s0, both(faded(seed + 2, 0.4), stain(seed, { weedTop: 0.02, tide: 0.05 })));
  // cane, lashing, pennant, counterweight
  tube(g, [[0, -0.75, 0], [0, 0.3, 0], [0.01, 1.0, 0], [0.03, 1.62, 0]], [0.012, 0.012, 0.01, 0.007], [0.42, 0.34, 0.18], RUB, { segs: 5 });
  for (const y of [0.3, 0.34]) lathe(g, [[0.016, y], [0.02, y + 0.012], [0.016, y + 0.024]], [0.05, 0.05, 0.05], RUB, { segs: 6 });
  lathe(g, [[0.0, -0.9], [0.045, -0.88], [0.045, -0.74], [0.0, -0.72]], [0.2, 0.2, 0.2], RUB, { segs: 6 });
  const fl = (u, v, out) => { out[0] = 0.03 + u * 0.4; out[1] = 1.6 - v * 0.24 * (1 - 0.75 * u) - 0.06 * u * u; out[2] = 0.03 * Math.sin(u * 5 + seed); };
  surf(g, fl, lin(0, 1, 5), lin(0, 1, 2), f, CLOTH);
  // pick-up line on the surface and its float
  tube(g, [[0.16, -0.02, 0.02], [0.5, -0.04, 0.1], [0.95, -0.03, 0.02], [1.35, -0.02, 0.09]], 0.008, [0.5, 0.42, 0.2], CLOTH, { segs: 3 });
  blob(g, [1.42, 0.0, 0.1], 0.075, 0.06, 0.075, cols[(seed + 1) % cols.length], RUB, { n: 4, segs: 8 });
  return g;
}

// ---- people --------------------------------------------------------------------------------
// kit: jacket | hivis | vest (a buoyancy aid over a shirt) | tee | oilskin | fleece. head: cap | beanie | hair |
// long | hood | sunhat | bald. shorts: bare legs below the knee. boots: sea boots up the calf.
export const PALETTES = [
  { top: [0.62, 0.15, 0.02], legs: [0.03, 0.05, 0.12], hat: [0.62, 0.15, 0.02], kit: 'hivis', head: 'cap', shoe: [0.03, 0.03, 0.035] },    // hi-vis orange
  { top: [0.02, 0.04, 0.12], legs: [0.28, 0.22, 0.12], hat: [0.5, 0.04, 0.03], kit: 'jacket', head: 'cap', shoe: [0.3, 0.2, 0.1] },       // navy and khaki
  { top: [0.62, 0.62, 0.6], legs: [0.04, 0.05, 0.1], hat: [0.04, 0.05, 0.1], kit: 'tee', head: 'hair', shorts: true, shoe: [0.6, 0.58, 0.5] },   // white polo, navy shorts
  { top: [0.5, 0.04, 0.03], legs: [0.04, 0.04, 0.045], hat: [0.62, 0.62, 0.6], kit: 'vest', head: 'cap', shoe: [0.05, 0.05, 0.06] },      // red buoyancy aid
  { top: [0.62, 0.48, 0.03], legs: [0.62, 0.48, 0.03], hat: [0.62, 0.48, 0.03], kit: 'oilskin', head: 'hood', boots: [0.55, 0.42, 0.03] }, // yellow oilskins
  { top: [0.07, 0.2, 0.3], legs: [0.07, 0.07, 0.08], hat: [0.07, 0.07, 0.08], kit: 'jacket', head: 'beanie', shoe: [0.05, 0.05, 0.06] },   // blue jacket
  { top: [0.25, 0.42, 0.55], legs: [0.5, 0.42, 0.28], hat: [0.6, 0.5, 0.3], kit: 'tee', head: 'sunhat', shorts: true, shoe: [0.35, 0.22, 0.12] },  // summer: shirt, shorts, straw hat
  { top: [0.08, 0.17, 0.09], legs: [0.16, 0.16, 0.17], hat: [0.3, 0.3, 0.32], kit: 'fleece', head: 'long', shoe: [0.4, 0.38, 0.34] },      // green fleece
  { top: [0.55, 0.2, 0.3], legs: [0.6, 0.6, 0.57], hat: [0.6, 0.6, 0.57], kit: 'vest', head: 'long', shorts: true, shoe: [0.6, 0.58, 0.5], lj: [0.7, 0.45, 0.03] }, // pink top, yellow buoyancy aid
  { top: [0.3, 0.31, 0.33], legs: [0.05, 0.07, 0.13], hat: [0.05, 0.07, 0.13], kit: 'fleece', head: 'bald', boots: [0.03, 0.05, 0.12] },    // grey fleece, navy boots
];
const SKIN_TONES = [[0.55, 0.36, 0.26], [0.34, 0.2, 0.13], [0.15, 0.09, 0.06], [0.6, 0.42, 0.3]];
const HAIR = [[0.05, 0.035, 0.025], [0.02, 0.02, 0.02], [0.42, 0.31, 0.14], [0.38, 0.38, 0.37], [0.2, 0.08, 0.035]];
const POSES = ['stand', 'wave', 'helm'];

export const WAVE_FRAMES = 6;
const v3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const DI = [-0.02, 0.17, 0.36, 0.49, 0.545];   // where the torso's sections sit along the spine

// One figure in its own space (x forward, y up, z to its right, the feet on y = 0), 1.76 m at scale 1.
// lod 0: about 1,400 triangles; 1: about 330; 2: about 60 (the same joints, bare prisms).
// part: 'all', 'body' (everything but an arm that waves) or 'wave' (only that arm, for the wave frames).
function person(g, o, idx, fno, lod, part) {
  const Pl = PALETTES[(o.pal || 0) % PALETTES.length], sk = SKIN_TONES[(o.skin || 0) % SKIN_TONES.length];
  const hs = hash1(idx * 7 + (o.pal || 0) * 31 + (o.skin || 0) * 101, Math.round(((o.x || 0) * 13 + (o.z || 0) * 7) * 10)), h2 = hash1(idx + 3, (o.pal || 0) * 11 + (o.skin || 0) * 5 + 1);
  const build = o.build ?? (hs < 0.3 ? 0 : hs < 0.78 ? 1 : 2);
  const wide = [0.9, 1, 1.12][build], deep = [0.9, 1, 1.22][build];
  const pose = typeof o.pose === 'string' ? o.pose : POSES[o.pose || 0];
  const side = o.side || 1, kit = o.kit || Pl.kit || 'jacket';
  const head = o.hat === false ? 'hair' : o.head || Pl.head || 'cap';
  const hair = HAIR[Math.floor(h2 * 4.99) % HAIR.length];
  const body = part !== 'wave', s0 = mark(g);
  const S = lod === 0 ? 8 : 5, per = 1, cr = lod === 0 ? 2 : 1;
  const sit = pose === 'sit';
  const la = pose === 'lean' ? 0.42 : pose === 'helm' ? 0.07 : pose === 'binoculars' ? -0.04 : sit ? 0.06 : 0.02 + 0.04 * (hs - 0.5);
  const pel = [pose === 'lean' ? -0.1 : 0, sit ? 0.5 : 0.93, 0], td = [Math.sin(la), Math.cos(la), 0];
  const along = (d, x = 0) => [pel[0] + td[0] * d + td[1] * x, pel[1] + td[1] * d - td[0] * x, 0];
  const shc = along(0.5), nk = along(0.565), hc = [nk[0] + Math.sin(la * 0.35) * 0.14 + 0.012, nk[1] + 0.135, 0];
  const top = Pl.top, legsC = Pl.legs, shoe = Pl.boots || Pl.shoe || [0.05, 0.05, 0.06];
  const under = scl(top, 0.55);
  const sleeves = kit === 'tee' || (kit === 'vest' && Pl.shorts) ? sk : kit === 'vest' ? under : top;
  const far = lod === 2;
  if (body) {
    // ---- legs and feet ----
    for (const sd of [-1, 1]) {
      const hip = [pel[0], pel[1] - 0.03, sd * 0.085 * wide];
      let knee, ank, toe;
      if (sit) { knee = [0.42, pel[1] + 0.01, sd * 0.11]; ank = [0.45, 0.09, sd * 0.12]; toe = sd * 0.05; }
      else {
        const fwd = (sd === side ? 0.07 : -0.04) * (pose === 'lean' ? 1.5 : 1) + (pose === 'lean' ? 0.02 : 0);
        ank = [fwd, 0.09, sd * (0.1 + 0.03 * hs)];
        knee = [(hip[0] + ank[0]) / 2 + 0.035 + (sd === side ? 0.02 : 0), (hip[1] + ank[1]) / 2 + 0.02, (hip[2] + ank[2]) / 2];
        toe = sd * (0.12 + 0.2 * h2);
      }
      if (far) { rod(g, hip, [ank[0], 0, ank[2]], 0.07 * wide, legsC, CLOTH, 3); continue; }
      const mid = (f) => [lerp(knee[0], ank[0], f), lerp(knee[1], ank[1], f), lerp(knee[2], ank[2], f)];
      limb(g, [hip, knee], [0.088 * wide, 0.064], [0.095 * deep, 0.066], legsC, CLOTH, { segs: S, per, cr, caps: [true, lod === 0] });
      const calf = mid(0.4); calf[0] -= 0.012;
      if (Pl.shorts) limb(g, [knee, calf, ank], [0.056, 0.054, 0.038], [0.058, 0.06, 0.04], sk, SKIN, { segs: S, per, cr, caps: [lod === 0, false] });
      else limb(g, [knee, calf, ank], [0.064, 0.058, 0.05], [0.066, 0.062, 0.052], legsC, CLOTH, { segs: S, per, cr, caps: [lod === 0, false] });
      // sea boots come up the calf; shoes stop at the ankle
      const ct = Math.cos(toe), st = Math.sin(toe), F = (x, y, z) => [ank[0] + x * ct - z * st, y, ank[2] + x * st + z * ct];
      if (Pl.boots && lod === 0) limb(g, [mid(0.45), ank], [0.066, 0.06], [0.068, 0.062], shoe, RUB, { segs: S, per: 1, caps: [false, false] });
      if (lod === 0) {
        limb(g, [F(-0.07, 0.05, 0), F(0.03, 0.055, 0), F(0.17, 0.034, 0)], [0.04, 0.047, 0.038], [0.045, 0.05, 0.026], shoe, RUB, { hint: [-st, 0, ct], segs: 6, per: 1, cr });
        box(g, F(0.045, 0.006, 0), 0.118, 0.006, 0.04, [0.1, 0.1, 0.1], RUB, { yaw: toe });
      } else box(g, F(0.05, 0.035, 0), 0.12, 0.035, 0.045, shoe, RUB, { yaw: toe });
    }
    // ---- torso ----
    const tw = [0.165 * wide, 0.15 * wide * (build === 2 ? 1.08 : 1), 0.182 * wide, 0.172 * wide, 0.1], tdp = [0.115 * deep, 0.108 * deep * (build === 2 ? 1.18 : 1), 0.122 * deep, 0.1 * deep, 0.07];
    const spine = DI.map((d, k) => along(d, k === 1 && build === 2 ? 0.02 : 0));
    if (far) limb(g, [spine[0], spine[2], spine[3]], [tw[0], tw[2], tw[3]], [tdp[0], tdp[2], tdp[3]], top, CLOTH, { segs: 4, per: 1, caps: [false, false], p: 3 });
    else {
      limb(g, spine, tw, tdp, kit === 'vest' ? under : top, CLOTH, { segs: lod ? 6 : 12, per, p: 2.5, cr, caps: [false, true] });
      // the seat and the top of the trousers
      limb(g, [along(-0.11), along(0.0)], [0.15 * wide, 0.156 * wide], [0.104 * deep, 0.107 * deep], legsC, CLOTH, { segs: lod ? 6 : 10, per: 1, p: 2.5, cr, caps: [true, false] });
      // a ring round the torso at distance d along the spine, `grow` proud of it
      const ringAt = (d, grow, n = 10) => {
        let k = 0; while (k < 3 && d > DI[k + 1]) k++;
        const u = clamp((d - DI[k]) / (DI[k + 1] - DI[k]), 0, 1), w = lerp(tw[k], tw[k + 1], u) + grow, dp = lerp(tdp[k], tdp[k + 1], u) + grow, c = along(d);
        return Array.from({ length: n }, (_, j) => { const a = (j / n) * TAU, cs = Math.cos(a), sn = Math.sin(a), ex = Math.sign(cs) * Math.pow(Math.abs(cs), 0.8), ez = Math.sign(sn) * Math.pow(Math.abs(sn), 0.8); return [c[0] + td[1] * ex * dp, c[1] - td[0] * ex * dp, ez * w]; });
      };
      if (kit === 'vest') {
        // a buoyancy aid: a padded shell from the waist to the shoulders, two belts, a zip
        const lj = o.lj || Pl.lj || top;
        loft(g, [ringAt(0.14, 0.012), ringAt(0.17, 0.03), ringAt(0.3, 0.036), ringAt(0.42, 0.034), ringAt(0.49, 0.022), ringAt(0.53, 0.004)].map((r) => (lod ? r.filter((_, j) => j % 2 === 0) : r)), lj, CLOTH);
        if (lod === 0) {
          for (const d of [0.2, 0.33]) tube(g, ringAt(d, 0.04), 0.011, [0.03, 0.03, 0.035], CLOTH, { segs: 3, closed: true });
          tube(g, [0.16, 0.25, 0.34, 0.43, 0.5].map((d) => ringAt(d, 0.038, 4)[0]), 0.006, [0.03, 0.03, 0.035], CLOTH, { segs: 3 });
        }
      } else if (lod === 0) {
        // hem, a zip or placket, reflective bands, pocket welts
        tube(g, ringAt(-0.015, 0.004), 0.008, scl(top, 0.72), CLOTH, { segs: 3, closed: true });
        if (kit !== 'tee') tube(g, [0.03, 0.15, 0.3, 0.42, 0.5].map((d) => ringAt(d, 0.004, 4)[0]), 0.005, scl(top, 0.45), CLOTH, { segs: 3 });
        if (kit === 'hivis') for (const d of [0.14, 0.3]) loft(g, [ringAt(d, 0.005), ringAt(d + 0.045, 0.005)], [0.7, 0.7, 0.66], CLOTH);
        if (kit === 'fleece' || kit === 'jacket') for (const j of [2, 14]) tube(g, [0.08, 0.15].map((d) => ringAt(d, 0.005, 16)[j]), 0.005, scl(top, 0.5), CLOTH, { segs: 3 });
      }
      if (lod === 0) {
        const col2 = kit === 'tee' ? scl(top, 0.85) : kit === 'vest' ? (o.lj || Pl.lj || top) : scl(top, 0.8);
        tube(g, Array.from({ length: 8 }, (_, k) => { const a = (k / 8) * TAU; return [nk[0] - 0.005 + 0.062 * Math.cos(a), nk[1] - 0.012 + 0.018 * Math.cos(a - 2.6), 0.07 * Math.sin(a)]; }), kit === 'tee' ? 0.012 : 0.02, col2, CLOTH, { segs: 4, closed: true });
      }
    }
    // ---- neck and head ----
    const s1 = mark(g);
    if (far) {
      const hcol = head === 'bald' ? sk : head === 'hair' || head === 'long' ? hair : head === 'hood' ? top : Pl.hat;
      blob(g, hc, 0.1, 0.12, 0.09, sk, SKIN, { n: 2, segs: 4, paint: (P, N, C, i) => { if (P[i + 1] > hc[1] + 0.02) { C[i] = hcol[0]; C[i + 1] = hcol[1]; C[i + 2] = hcol[2]; } } });
    } else {
      limb(g, [[nk[0] - 0.01, nk[1] - 0.03, 0], [hc[0] - 0.02, hc[1] - 0.06, 0]], [0.05, 0.047], [0.052, 0.05], sk, SKIN, { segs: lod ? 5 : 8, per: 1, caps: [false, false] });
      const hn = lod ? 4 : 6, hsg = lod ? 6 : 10, ho = { n: hn, segs: hsg }, hd = { n: lod ? 3 : 5, segs: hsg };
      blob(g, hc, 0.094, 0.116, 0.078, sk, SKIN, ho);
      if (lod === 0) {
        blob(g, [hc[0] + 0.045, hc[1] - 0.065, 0], 0.05, 0.05, 0.058, sk, SKIN, { n: 3, segs: 8 });      // jaw and chin
        blob(g, [hc[0] + 0.094, hc[1] - 0.015, 0], 0.02, 0.028, 0.017, scl(sk, 0.95), SKIN, { n: 3, segs: 5 });   // nose
        for (const sd of [-1, 1]) { blob(g, [hc[0] - 0.005, hc[1] - 0.005, sd * 0.078], 0.018, 0.03, 0.01, scl(sk, 0.9), SKIN, { n: 2, segs: 5 }); box(g, [hc[0] + 0.078, hc[1] + 0.02, sd * 0.034], 0.004, 0.006, 0.014, scl(hair, 0.8), RUB); }
        if (h2 > 0.7 && head !== 'hood' && head !== 'long') blob(g, [hc[0] + 0.05, hc[1] - 0.075, 0], 0.052, 0.05, 0.06, scl(hair, 1.1), CLOTH, { n: 4, segs: 8 });   // a beard
        if (hs > 0.55 && pose !== 'binoculars') { for (const sd of [-1, 1]) box(g, [hc[0] + 0.088, hc[1] + 0.018, sd * 0.034], 0.004, 0.017, 0.028, [0.01, 0.01, 0.012], GLS); box(g, [hc[0] + 0.09, hc[1] + 0.024, 0], 0.003, 0.004, 0.012, [0.01, 0.01, 0.012], RUB); }   // sunglasses
      }
      if (head !== 'bald') { const gr = head === 'hood' ? 0.016 : 0; blob(g, [hc[0] - 0.012, hc[1] + 0.016, 0], 0.098 + gr, 0.112 + gr, 0.084 + gr, head === 'hood' ? top : hair, CLOTH, head === 'hood' ? ho : hd); }
      if (head === 'long') blob(g, [hc[0] - 0.06, hc[1] - 0.1, 0], 0.05, 0.13, 0.082, hair, CLOTH, hd);
      if (head === 'cap') { blob(g, [hc[0] - 0.006, hc[1] + 0.03, 0], 0.103, 0.1, 0.09, Pl.hat, CLOTH, hd); blob(g, [hc[0] + 0.1, hc[1] + 0.045, 0], 0.075, 0.007, 0.066, scl(Pl.hat, 0.8), CLOTH, { n: 2, segs: lod ? 6 : 8 }); }
      if (head === 'beanie') {
        blob(g, [hc[0] - 0.008, hc[1] + 0.04, 0], 0.104, 0.1, 0.091, Pl.hat, CLOTH, hd);
        if (lod === 0) tube(g, Array.from({ length: 12 }, (_, k) => { const a = (k / 12) * TAU; return [hc[0] - 0.008 + 0.103 * Math.cos(a), hc[1] + 0.035 + 0.012 * Math.cos(a), 0.09 * Math.sin(a)]; }).filter((_, k) => k % 2 === 0 || true), 0.016, scl(Pl.hat, 0.8), CLOTH, { segs: 4, closed: true });
      }
      if (head === 'sunhat') {
        const at = [hc[0] - 0.006, hc[1] + 0.05, 0];
        blob(g, [at[0], hc[1] + 0.045, 0], 0.1, 0.095, 0.09, Pl.hat, CLOTH, hd);
        lathe(g, [[0.09, 0.012], [0.19, -0.012], [0.195, -0.01], [0.09, 0.02]], Pl.hat, CLOTH, { segs: hsg, at });
        if (lod === 0) lathe(g, [[0.101, 0.02], [0.101, 0.045]], scl(top, 0.6), CLOTH, { segs: hsg, at });
      }
      // the head turned on the neck
      if (o.look) { const c = Math.cos(o.look), sn = Math.sin(o.look); xf(g, s1, frame([nk[0] - c * nk[0], 0, -sn * nk[0]], o.look)); }
    }
  }
  // ---- arms ----
  const ph = ((fno + idx * 2) % WAVE_FRAMES) / WAVE_FRAMES * TAU;
  for (const sd of [-1, 1]) {
    const waving = pose === 'wave' && sd === side;
    if (waving ? part === 'body' : part === 'wave') continue;
    const sh = [shc[0], shc[1] - 0.035, sd * 0.19 * wide];
    let d1, d2, prop = null;
    const main = sd === side;
    if (waving) { const f = 0.55 * Math.sin(ph) + 0.12; d1 = [0.03, 0.19, sd * 0.2]; d2 = [0.032, 0.27 * Math.cos(f), sd * 0.27 * Math.sin(f)]; }
    else if (pose === 'helm') { d1 = [0.17, -0.22, sd * 0.04]; d2 = [0.24, -0.05, -sd * 0.07]; }
    else if (pose === 'binoculars') { d1 = [0.15, -0.11, sd * 0.13]; d2 = [0.05, 0.27, -sd * 0.22]; prop = main ? 'binoculars' : null; }
    else if (pose === 'camera') { d1 = [0.14, -0.16, sd * 0.1]; d2 = [0.13, 0.22, -sd * 0.18]; prop = main ? 'camera' : null; }
    else if (pose === 'lean') { d1 = [0.1, -0.25, sd * 0.03]; d2 = [0.22, -0.04, -sd * 0.11]; }
    else if (pose === 'sit') { d1 = [0.07, -0.26, sd * 0.05]; d2 = [0.21, -0.11, -sd * 0.09]; }
    else if (pose === 'hips') { d1 = [-0.05, -0.21, sd * 0.18]; d2 = [0.1, -0.16, -sd * 0.17]; }
    else if (pose === 'flag' && main) { d1 = [0.16, -0.12, sd * 0.1]; d2 = [0.13, 0.2, sd * 0.02]; prop = 'flag'; }
    else if (pose === 'point' && main) { d1 = [0.2, -0.06, sd * 0.07]; d2 = [0.26, 0.03, sd * 0.02]; }
    else if (pose === 'clipboard') { d1 = main ? [0.09, -0.25, sd * 0.04] : [0.12, -0.2, sd * 0.03]; d2 = main ? [0.2, 0.03, -sd * 0.12] : [0.18, 0.02, -sd * 0.16]; prop = main ? 'clipboard' : null; }
    else if (pose === 'mug' && main) { d1 = [0.1, -0.24, sd * 0.03]; d2 = [0.17, 0.12, -sd * 0.05]; prop = 'mug'; }
    else { d1 = [0.015, -0.28, sd * (0.05 + 0.03 * build)]; d2 = [0.06 + 0.04 * hs, -0.245, -sd * 0.02]; }
    const el = v3(sh, d1), wr = v3(el, d2);
    const dl = Math.hypot(d2[0], d2[1], d2[2]), dir = [d2[0] / dl, d2[1] / dl, d2[2] / dl], reach = (k) => [wr[0] + dir[0] * k, wr[1] + dir[1] * k, wr[2] + dir[2] * k], hand = reach(0.07);
    const tee = sleeves === sk;
    if (far) { rod(g, sh, el, 0.05, top, CLOTH, 3); rod(g, el, hand, 0.04, sleeves, tee ? SKIN : CLOTH, 3); continue; }
    if (lod === 0) blob(g, [sh[0], sh[1] + 0.005, sh[2] - sd * 0.012], 0.064, 0.064, 0.06, kit === 'vest' ? under : top, CLOTH, { n: 4, segs: 8 });
    limb(g, [sh, el], [0.054 * wide, 0.044], [0.056 * wide, 0.045], tee ? sk : sleeves, tee ? SKIN : CLOTH, { segs: S, per, cr, caps: [lod > 0, true] });
    if (tee && lod === 0) limb(g, [sh, [lerp(sh[0], el[0], 0.55), lerp(sh[1], el[1], 0.55), lerp(sh[2], el[2], 0.55)]], [0.06 * wide, 0.056], [0.062 * wide, 0.058], top, CLOTH, { segs: S, per: 1, caps: [false, false] });
    limb(g, [el, wr], [0.043, 0.031], [0.044, 0.03], sleeves, tee ? SKIN : CLOTH, { segs: S, per, cr, caps: [true, false] });
    if (!tee && lod === 0) limb(g, [reach(-0.035), wr], [0.036, 0.036], [0.035, 0.035], scl(sleeves, 0.7), CLOTH, { segs: S, per: 1, caps: [false, false] });
    // the hand: a flat palm and a thumb
    const hint = Math.abs(dir[1]) > 0.8 ? [1, 0, 0] : [0, 1, 0];
    limb(g, [wr, reach(0.05), reach(0.105)], [0.034, 0.04, 0.03], [0.018, 0.02, 0.013], sk, SKIN, { hint, segs: lod ? 4 : 6, per: 1, cr, caps: [false, true] });
    if (lod === 0) { const a = reach(0.02), b = reach(0.065); rod(g, [a[0] + hint[0] * 0.03, a[1] + hint[1] * 0.03, a[2] + hint[2] * 0.03], [b[0] + hint[0] * 0.05, b[1] + hint[1] * 0.05, b[2] + hint[2] * 0.05], 0.011, sk, SKIN, 4, { caps: true }); }
    if (prop === 'binoculars') for (const z of [-0.034, 0.034]) lathe(g, [[0.0, 0], [0.024, 0], [0.024, 0], [0.027, 0.06], [0.034, 0.1], [0.034, 0.12], [0.034, 0.12], [0, 0.12]], [0.03, 0.03, 0.035], RUB, { segs: lod ? 5 : 8, axis: 'x', at: [hc[0] + 0.095, hc[1] + 0.02, z] });
    if (prop === 'camera') box(g, [hand[0] + 0.02, hand[1] + 0.01, 0], 0.035, 0.035, 0.06, [0.04, 0.04, 0.045], RUB);
    if (prop === 'mug' && lod === 0) lathe(g, [[0.03, -0.04], [0.035, 0.05], [0.03, 0.05], [0.027, -0.03]], [0.7, 0.7, 0.66], GEL, { segs: 8, at: [hand[0] + 0.02, hand[1] + 0.02, hand[2]] });
    if (prop === 'clipboard') { const s2 = mark(g); box(g, [0, 0, 0], 0.115, 0.006, 0.16, [0.3, 0.2, 0.1], RUB); box(g, [0.005, 0.008, 0], 0.1, 0.002, 0.145, [0.8, 0.8, 0.76], RUB); xf(g, s2, frame([hand[0] + 0.03, hand[1] + 0.04, hand[2] - sd * 0.1], 0, 0.9, 0)); }
    if (prop === 'flag') {
      // a hand flag on a short staff, as a start boat's flagman holds
      const b = [hand[0] - 0.04, hand[1] - 0.2, hand[2]], tp = [hand[0] + 0.1, hand[1] + 0.95, hand[2] + sd * 0.06];
      rod(g, b, tp, 0.012, [0.5, 0.4, 0.25], RUB, lod ? 3 : 5);
      const fc = o.flag || [0.75, 0.1, 0.04];
      const chq = (P, N, C, i) => { const a = Math.floor((tp[1] - P[i + 1]) / 0.11) + Math.floor(Math.abs(P[i + 2] - tp[2]) / 0.13), c = a & 1 ? 0.03 : 0.8; C[i] = c; C[i + 1] = c; C[i + 2] = c; };
      surf(g, (u, v, out) => { out[0] = tp[0] - 0.01 * v - 0.05 * u * u + 0.05 * Math.sin(u * 5 + v * 2); out[1] = tp[1] - 0.02 - v * 0.4 - 0.22 * u * u; out[2] = tp[2] + sd * (0.02 + u * 0.5); }, lin(0, 1, lod ? 2 : 5), lin(0, 1, lod ? 1 : 3), fc, CLOTH, o.chequer ? { paint: chq } : undefined);
    }
  }
  // place it
  const sc = (o.scale || 1) * (0.95 + 0.1 * h2);
  xf(g, s0, frame([o.x, o.y, o.z], o.yaw || 0, 0, 0, sc));
}

// A crew: people placed in a host's frame. pose: 0 or 'stand', 1 or 'wave' (one arm raised, the forearm
// swinging by frame), 2 or 'helm' (hands forward), and 'sit', 'lean' (on a rail), 'hips', 'binoculars', 'camera',
// 'flag', 'point', 'clipboard', 'mug'. The frames (0..WAVE_FRAMES-1) differ only in the arms that wave, which are
// offset so that a crew does not wave in step. opt.lod: 0 near, 1 middle, 2 far. opt.part: 'all', or 'body' and
// 'wave', so the system can build the bodies once and only the waving arms per frame.
export function crewGeo(people, frame = 0, opt = {}) {
  const g = new Geo(256), lod = opt.lod || 0, part = opt.part || 'all';
  people.forEach((o, idx) => person(g, o, idx, frame, lod, part));
  return g;
}

// ---- flags ---------------------------------------------------------------------------------
export const FLAG_NU = 8, FLAG_NV = 3;
// styles: colour of the quad at (u along the fly, v down the hoist), and whether the flag tapers to a point
export const FLAG_STYLES = {
  ensign: { taper: false, col: (u, v) => (u < 0.38 && v < 0.55 ? [0.03, 0.05, 0.2] : [0.55, 0.03, 0.03]) },
  burgee: { taper: true, col: (u, v) => (u < 0.5 ? [0.55, 0.03, 0.03] : [0.7, 0.7, 0.68]) },
  signal: { taper: false, col: (u, v) => ((u < 0.5) !== (v < 0.5) ? [0.65, 0.2, 0.02] : [0.7, 0.7, 0.68]) },
  white: { taper: false, col: (u, v) => (v > 0.3 && v < 0.7 ? [0.5, 0.04, 0.03] : [0.7, 0.7, 0.68]) },
  pennant: { taper: true, col: () => [0.62, 0.45, 0.03] },
};

// Cloth of a flag at time t, written into `out` (3 floats per vertex, triangles of the grid) and
// `nrm`. The hoist is at the origin and the pole runs up the y axis. wd: the direction the wind blows
// toward, in the flag's own frame (radians, x forward, z right); wind in m/s. In a light wind the cloth
// droops against the pole and barely stirs; by 9 m/s it flies straight out and ripples. Returns the
// number of vertices written.
const _nodes = new Float32Array((FLAG_NU + 1) * (FLAG_NV + 1) * 3), _nn = new Float32Array((FLAG_NU + 1) * (FLAG_NV + 1) * 3);
export function flagCloth(out, nrm, L, H, taper, wd, wind, t, seed) {
  const NU = FLAG_NU, NV = FLAG_NV, W = NU + 1;
  const stiff = smooth(1.2, 9.5, wind), limp = 1 - stiff;
  const dx = Math.cos(wd), dz = Math.sin(wd), lx = -dz, lz = dx;
  const k = TAU / (L * 0.62), om = TAU * (1.1 + 0.55 * wind) * 0.35;
  let h = 0, v = 0;
  for (let iu = 0; iu <= NU; iu++) {
    const u = iu / NU;
    if (iu > 0) {
      const s = (iu - 0.5) / NU;
      // the fly lies at an angle below horizontal that grows with limpness and along the cloth, and is shaken by the gusts
      const a = Math.min(limp * (0.5 + 0.7 * s) + 0.1 * s * limp, 1.1) + (0.05 + 0.16 * stiff) * s * Math.sin(k * L * s * 1.0 - om * t + seed + 1.3);
      const step = (L / NU) * (1 - 0.3 * limp);
      h += step * Math.cos(a); v -= step * Math.sin(a);
    }
    const lat = L * (0.03 + 0.17 * stiff) * Math.pow(u, 1.15) * Math.sin(k * h - om * t + seed) + L * 0.02 * limp * u * Math.sin(0.9 * t + seed);
    const hh = H * (taper ? 1 - 0.93 * u : 1);
    for (let iv = 0; iv <= NV; iv++) {
      const o = (iv * W + iu) * 3, vv = iv / NV;
      _nodes[o] = h * dx + lat * lx;
      _nodes[o + 1] = v - vv * hh;
      _nodes[o + 2] = h * dz + lat * lz;
    }
  }
  // node normals from the grid, then the triangles
  for (let iv = 0; iv <= NV; iv++) for (let iu = 0; iu <= NU; iu++) {
    const a = (iv * W + Math.min(iu + 1, NU)) * 3, b = (iv * W + Math.max(iu - 1, 0)) * 3, c = (Math.min(iv + 1, NV) * W + iu) * 3, d = (Math.max(iv - 1, 0) * W + iu) * 3;
    const ux = _nodes[a] - _nodes[b], uy = _nodes[a + 1] - _nodes[b + 1], uz = _nodes[a + 2] - _nodes[b + 2];
    const wx = _nodes[c] - _nodes[d], wy = _nodes[c + 1] - _nodes[d + 1], wz = _nodes[c + 2] - _nodes[d + 2];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const l = Math.hypot(nx, ny, nz) || 1;
    const o = (iv * W + iu) * 3;
    _nn[o] = nx / l; _nn[o + 1] = ny / l; _nn[o + 2] = nz / l;
  }
  let n = 0;
  const put = (o) => { out[n * 3] = _nodes[o]; out[n * 3 + 1] = _nodes[o + 1]; out[n * 3 + 2] = _nodes[o + 2]; nrm[n * 3] = _nn[o]; nrm[n * 3 + 1] = _nn[o + 1]; nrm[n * 3 + 2] = _nn[o + 2]; n++; };
  for (let iv = 0; iv < NV; iv++) for (let iu = 0; iu < NU; iu++) {
    const p00 = (iv * W + iu) * 3, p10 = (iv * W + iu + 1) * 3, p11 = ((iv + 1) * W + iu + 1) * 3, p01 = ((iv + 1) * W + iu) * 3;
    put(p00); put(p10); put(p11); put(p00); put(p11); put(p01);
  }
  return n;
}
export const FLAG_CLOTH_VERTS = FLAG_NU * FLAG_NV * 6;

// the colours, materials and pole of a flag mesh: static vertex data for the dynamic mesh
export function flagStatic(style, poleH) {
  const S = FLAG_STYLES[style] || FLAG_STYLES.ensign;
  const col = [], mat = [];
  for (let iv = 0; iv < FLAG_NV; iv++) for (let iu = 0; iu < FLAG_NU; iu++) {
    const c = S.col((iu + 0.5) / FLAG_NU, (iv + 0.5) / FLAG_NV);
    for (let k = 0; k < 6; k++) { col.push(...c); mat.push(CLOTH[0], CLOTH[1], CLOTH[2]); }
  }
  // the pole: a four-sided prism, below the hoist
  const pole = new SoupGeo();
  if (poleH > 0.05) pole.tube([[0, -poleH - 0.0, 0], [0, 0.04, 0]], 0.018, [0.7, 0.7, 0.68], M(MAT.METAL), { segs: 4 });
  return { col, mat, pole };
}

export { rng };
