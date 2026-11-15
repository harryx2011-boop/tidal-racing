import { Geo, MAT, norm, cross, sub } from '../geo.js';
import { recolour, noise3, mixc, smooth, lerp } from './marks.js';
import { rng } from './structures.js';

// Wildlife and small detail, as plain data and meshes. Nothing here touches GL except through
// Geo.build, so the builders run (and are counted) in node. Colours are linear albedo.
//
// Birds are not a Geo: one static mesh is deformed in the vertex shader (wildlife.js), so its
// vertices carry what the shader needs. Body space: x forward, y up, z to the right, metres, for a
// gull of 1.3 m wingspan.
//   position (3), shape normal (3), tag (4) = (part, span fraction s, surface +1 top / -1 under / 0, chord 0 LE .. 1 TE)
// Parts: 0 body, 1 wing, 2 tail, 3 neck and head, 4 bill, 5 legs. A wing vertex stores its
// chord length in the normal's x, so the shader can fold the wing along the flank.

const TAU = Math.PI * 2;
const M = (id, tint = 0, glow = 0) => [id, tint, glow];
const GEL = M(MAT.GELCOAT), RUB = M(MAT.RUBBER);
const CLOTH = M(MAT.UPHOLSTERY, 0, 1), SKIN = M(MAT.UPHOLSTERY, 0, 2), WOOD = M(MAT.TEAK);

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

// a drifting log, 3.5 m, half awash, with a couple of stubs
export function logGeo(seed = 1) {
  const g = new Geo(), R = rng(seed * 313 + 7);
  const prof = [[-1.75, 0.07], [-1.65, 0.16], [-0.9, 0.2 + 0.02 * R()], [0.2, 0.19], [1.2, 0.21 + 0.02 * R()], [1.68, 0.15], [1.77, 0.06]];
  g.lathex(prof, [0.1, 0.085, 0.068], RUB, 8, -0.05, 0);
  for (let i = 0; i < 2; i++) {
    const x = -0.8 + R() * 1.8, a = (R() < 0.5 ? 0.9 : 2.2) + R() * 0.3;
    g.tube([[x, 0.0, 0], [x + 0.05, 0.25 * Math.sin(a), 0.25 * Math.cos(a) * 1.2], [x + 0.12, 0.5 * Math.sin(a), 0.5 * Math.cos(a) * 1.3]], 0.04, [0.12, 0.1, 0.08], RUB, { segs: 5 });
  }
  recolour(g, (p, n, c) => {
    const k = 0.75 + 0.5 * noise3(p[0] * 6 + seed, p[1] * 12, p[2] * 12);
    const weed = smooth(-0.1, -0.2, p[1]);
    const base = Math.abs(p[0]) > 1.62 ? [0.32, 0.27, 0.2] : [c[0] * k, c[1] * k, c[2] * k];
    return mixc(base, [0.04, 0.06, 0.02], weed * 0.8);
  });
  return g;
}

// a slatted fish crate
export function crateGeo(seed = 1) {
  const g = new Geo();
  const col = seed & 1 ? [0.36, 0.26, 0.14] : [0.3, 0.3, 0.32];
  const hx = 0.32, hz = 0.2, hy = 0.15;
  g.box(-hx, hx, -0.1, hy, -hz, hz, col, WOOD);
  for (const sx of [-1, 1]) g.box(sx * hx - 0.02, sx * hx + 0.02, -0.12, hy + 0.04, -hz - 0.02, hz + 0.02, [col[0] * 0.8, col[1] * 0.8, col[2] * 0.8], WOOD);
  for (let k = 0; k < 3; k++) g.box(-hx, hx, hy - 0.01, hy + 0.025, -hz + 0.02 + k * 0.13, -hz + 0.1 + k * 0.13, [col[0] * 1.1, col[1] * 1.1, col[2] * 1.1], WOOD);
  return g;
}

// a pot marker: a polystyrene float, a whip and a small pennant (its long side points down +x: the
// caller turns it downwind)
export function potFloatGeo(seed = 1) {
  const g = new Geo();
  const cols = [[0.7, 0.16, 0.02], [0.75, 0.55, 0.03], [0.62, 0.62, 0.6], [0.5, 0.04, 0.03]];
  const col = cols[seed % cols.length];
  g.lathe([[0.0, -0.12], [0.1, -0.1], [0.16, 0.0], [0.17, 0.08], [0.1, 0.17], [0.0, 0.2]].map(([r, y]) => [r, y + 0.04]), col, RUB, 8);
  g.tube([[0, 0.2, 0], [0, 0.9, 0], [0, 1.4, 0]], 0.011, [0.75, 0.75, 0.72], RUB, { segs: 3 });
  const f = cols[(seed + 2) % cols.length];
  g.tri([0, 1.38, 0], [0, 1.2, 0], [0.34, 1.29, 0], [0, 0, 1], [0, 0, 1], [0, 0, 1], f, CLOTH);
  return g;
}

// ---- people --------------------------------------------------------------------------------
export const PALETTES = [
  { top: [0.62, 0.15, 0.02], legs: [0.03, 0.05, 0.12], hat: [0.62, 0.15, 0.02] },   // hi-vis orange
  { top: [0.02, 0.04, 0.12], legs: [0.28, 0.22, 0.12], hat: [0.5, 0.04, 0.03] },    // navy and khaki
  { top: [0.62, 0.62, 0.6], legs: [0.04, 0.05, 0.1], hat: [0.04, 0.05, 0.1] },      // white and navy
  { top: [0.5, 0.04, 0.03], legs: [0.04, 0.04, 0.045], hat: [0.62, 0.62, 0.6] },    // red
  { top: [0.62, 0.48, 0.03], legs: [0.04, 0.05, 0.08], hat: [0.62, 0.48, 0.03] },   // yellow oilskin
  { top: [0.07, 0.2, 0.3], legs: [0.07, 0.07, 0.08], hat: [0.07, 0.07, 0.08] },     // blue jacket
];
const SKIN_TONES = [[0.55, 0.36, 0.26], [0.34, 0.2, 0.13], [0.15, 0.09, 0.06], [0.6, 0.42, 0.3]];

export const WAVE_FRAMES = 6;

// A lathe cannot go through the person transform, so the head is built about its own axis.
function headAt(g, T, sk, hatCol, hat, scale) {
  const hy = 1.6;
  const prof = [[0.0, hy - 0.1], [0.075, hy - 0.08], [0.105, hy], [0.09, hy + 0.1], [0.0, hy + 0.14]];
  const [cx, , cz] = T(0, 0, 0);
  const y0 = T(0, 0, 0)[1];
  g.lathe(prof.map(([r, yy]) => [r * scale, y0 + yy * scale]), sk, SKIN, 6, cx, cz);
  if (hat) g.lathe([[0.11 * scale, y0 + (hy + 0.04) * scale], [0.115 * scale, y0 + (hy + 0.09) * scale], [0.0, y0 + (hy + 0.16) * scale]], hatCol, CLOTH, 6, cx, cz);
}

// A crew: people placed in a host's frame. pose: 0 arms down, 1 waving (one arm raised, the forearm
// swinging, by frame), 2 hands forward (a wheel, a rail). A few variants of the whole mesh (frame
// 0..WAVE_FRAMES-1) share the same people, offset so they do not wave in step.
export function crewGeo(people, frame = 0) {
  const g = new Geo();
  people.forEach((o, idx) => {
    const { x, y, z, yaw = 0, pal = 0, skin = 0, pose = 0, hat = true, scale = 1 } = o;
    const P = PALETTES[pal % PALETTES.length], sk = SKIN_TONES[skin % SKIN_TONES.length];
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const T = (px, py, pz) => [x + (c * px - s * pz) * scale, y + py * scale, z + (s * px + c * pz) * scale];
    const hexa = (b, t, col, mat) => g.hexa(b.map((q) => T(...q)), t.map((q) => T(...q)), col, mat);
    const rect = (y0, hd, hw) => [[-hd, y0, -hw], [hd, y0, -hw], [hd, y0, hw], [-hd, y0, hw]];
    for (const sz of [-1, 1]) {
      const z0 = sz * 0.095;
      hexa([[-0.06, 0.0, z0 - 0.06], [0.09, 0.0, z0 - 0.06], [0.09, 0.0, z0 + 0.06], [-0.06, 0.0, z0 + 0.06]],
        [[-0.075, 0.92, z0 - 0.075], [0.075, 0.92, z0 - 0.075], [0.075, 0.92, z0 + 0.075], [-0.075, 0.92, z0 + 0.075]], P.legs, CLOTH);
    }
    hexa(rect(0.88, 0.11, 0.17), rect(1.48, 0.12, 0.23), P.top, CLOTH);
    headAt(g, T, sk, P.hat, o.hat !== false, scale);
    // arms: [shoulder, elbow, hand] in person space
    const wave = pose === 1;
    const ph = ((frame + idx * 2) % WAVE_FRAMES) / WAVE_FRAMES * TAU;
    for (const sd of [-1, 1]) {
      const up = wave && sd === (o.side || 1);
      let sh = [0, 1.4, sd * 0.24], el, hd;
      if (up) { el = [0.02, 1.64, sd * 0.42]; const f = 0.55 * Math.sin(ph); hd = [0.02, el[1] + 0.27 * Math.cos(f), el[2] + sd * 0.27 * Math.sin(f)]; }
      else if (pose === 2) { el = [0.2, 1.17, sd * 0.26]; hd = [0.4, 1.1, sd * 0.2]; }
      else { el = [0.02, 1.14, sd * 0.29]; hd = [0.05, 0.9, sd * 0.28]; }
      const mid = [el[0] * 0.55 + sh[0] * 0.45, el[1] * 0.55 + sh[1] * 0.45, el[2] * 0.55 + sh[2] * 0.45];
      g.tube([T(...sh), T(...mid), T(...el)], 0.048 * scale, P.top, CLOTH, { segs: 4 });
      g.tube([T(...el), T(...hd)], 0.04 * scale, sk, SKIN, { segs: 4 });
    }
  });
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
    for (let k = 0; k < 6; k++) { col.push(...c); mat.push(...CLOTH); }
  }
  // the pole: a four-sided prism, below the hoist
  const pole = new Geo();
  if (poleH > 0.05) pole.tube([[0, -poleH - 0.0, 0], [0, 0.04, 0]], 0.018, [0.7, 0.7, 0.68], M(MAT.METAL), { segs: 4 });
  return { col, mat, pole };
}

export { rng };
