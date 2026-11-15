import { Geo as SoupGeo, MAT } from '../geo.js';
import { makeMesh } from '../../gl.js';

// The building kit behind the detailed models (vessels, structures, marks, people, props).
//
// Geo's own methods copy three small arrays per triangle; a world of some 800,000 triangles built
// at load cannot afford that. Everything here writes straight into a Geo's arrays instead, from
// a grid of nodes held in scratch buffers: positions, normals, a colour per node (so weathering
// is computed once per node, not once per triangle corner) and one free number per node.
//
// That free number goes out as uv.y, and a material's fourth entry as uv.x: together they pick a
// procedural surface in the mesh shader for RUBBER (see DV and mesh.js): stone grain, masonry
// courses, cast concrete, hull plating, corrugated steel, slates, planks. uv.y is the distance along the
// surface where the model wants the pattern to follow a curve (round a tower, along a wall).
//
// A painter is fn(P, N, C, i): it reads the node at offset i of the position and normal arrays and
// rewrites its colour in C. The same painters run on scratch nodes (the `paint` option of every
// primitive) and on finished geometry (paint()).

export const TAU = Math.PI * 2;

// A Geo that keeps its vertices in typed arrays that double when full. Geo's own methods still work
// on it (they all end in tri()), and p, n, c, m and uv read as the filled part of each array.
const Z2 = [0, 0];
export class Geo extends SoupGeo {
  constructor(cap = 1536) {
    super();
    this.nv = 0; this.cap = cap;
    this.P = new Float32Array(cap * 3); this.N = new Float32Array(cap * 3); this.C = new Float32Array(cap * 3); this.M = new Float32Array(cap * 3); this.U = new Float32Array(cap * 2);
  }
  get p() { return this.P.subarray(0, this.nv * 3); } set p(v) { /* the base constructor's empty list */ }
  get n() { return this.N.subarray(0, this.nv * 3); } set n(v) { /* as p */ }
  get c() { return this.C.subarray(0, this.nv * 3); } set c(v) { /* as p */ }
  get m() { return this.M.subarray(0, this.nv * 3); } set m(v) { /* as p */ }
  get uv() { return this.U.subarray(0, this.nv * 2); } set uv(v) { /* as p */ }
  reserve(extra) {
    if (this.nv + extra <= this.cap) return;
    let c = this.cap; while (c < this.nv + extra) c *= 2;
    const grow = (a, k) => { const b = new Float32Array(c * k); b.set(a.subarray(0, this.nv * k)); return b; };
    this.P = grow(this.P, 3); this.N = grow(this.N, 3); this.C = grow(this.C, 3); this.M = grow(this.M, 3); this.U = grow(this.U, 2);
    this.cap = c;
  }
  tri(a, b, c, na, nb, nc, col, mat, ua = Z2, ub = Z2, uc = Z2) {
    this.reserve(3);
    const P = this.P, N = this.N, C = this.C, M = this.M, U = this.U;
    let i = this.nv * 3, j = this.nv * 2;
    P[i] = a[0]; P[i + 1] = a[1]; P[i + 2] = a[2]; P[i + 3] = b[0]; P[i + 4] = b[1]; P[i + 5] = b[2]; P[i + 6] = c[0]; P[i + 7] = c[1]; P[i + 8] = c[2];
    N[i] = na[0]; N[i + 1] = na[1]; N[i + 2] = na[2]; N[i + 3] = nb[0]; N[i + 4] = nb[1]; N[i + 5] = nb[2]; N[i + 6] = nc[0]; N[i + 7] = nc[1]; N[i + 8] = nc[2];
    for (let k = 0; k < 9; k += 3) { C[i + k] = col[0]; C[i + k + 1] = col[1]; C[i + k + 2] = col[2]; M[i + k] = mat[0]; M[i + k + 1] = mat[1]; M[i + k + 2] = mat[2]; }
    U[j] = ua[0]; U[j + 1] = ua[1]; U[j + 2] = ub[0]; U[j + 3] = ub[1]; U[j + 4] = uc[0]; U[j + 5] = uc[1];
    this.nv += 3;
  }
  build(gl) {
    const mesh = makeMesh(gl, [[this.p, 3], [this.n, 3], [this.c, 3], [this.m, 3], [this.uv, 2]]);
    mesh.count = this.nv;
    return mesh;
  }
}
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const smooth = (a, b, x) => { let t = (x - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
export const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const scl = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

// material: (id, tint weight, glow, surface variant)
export const mat = (id, tint = 0, glow = 0, dv = 0) => [id, tint, glow, dv];
// surface variants of RUBBER (uv.x); add ALONG when uv.y carries the distance along the surface
export const DV = { NONE: 0, GRAIN: 1, ASHLAR: 2, CONCRETE: 3, PLATE: 4, CORRUGATED: 5, SLATE: 6, ROCK: 7, ALONG: 8 };
export const GEL = mat(MAT.GELCOAT), RUB = mat(MAT.RUBBER), MET = mat(MAT.METAL), GLS = mat(MAT.GLASS), NSK = mat(MAT.NONSKID), TEAK = mat(MAT.TEAK);
export const LIT = mat(MAT.LIGHT, 0, 1), CLOTH = mat(MAT.UPHOLSTERY, 0, 1), SKIN = mat(MAT.UPHOLSTERY, 0, 2), TEX = mat(MAT.TEXTURED);
export const GRAIN = mat(MAT.RUBBER, 0, 0, DV.GRAIN), STONE = mat(MAT.RUBBER, 0, 0, DV.ROCK);

export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---- noise: value noise on an integer hash (no trigonometry: it runs per node at load) ----
function hsh(x, y, z) {
  let h = Math.imul(x, 0x27d4eb2d);
  h = Math.imul(h ^ y ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ z ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) * 2.3283064365386963e-10;
}
export function vn(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  let fx = x - ix, fy = y - iy, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const a = hsh(ix, iy, iz), b = hsh(ix + 1, iy, iz), c = hsh(ix, iy + 1, iz), d = hsh(ix + 1, iy + 1, iz);
  const e = hsh(ix, iy, iz + 1), f = hsh(ix + 1, iy, iz + 1), g = hsh(ix, iy + 1, iz + 1), h = hsh(ix + 1, iy + 1, iz + 1);
  const p = a + (b - a) * fx, q = c + (d - c) * fx, r = e + (f - e) * fx, s = g + (h - g) * fx;
  const u = p + (q - p) * fy, v = r + (s - r) * fy;
  return u + (v - u) * fz;
}
export const fb = (x, y, z) => vn(x, y, z) * 0.55 + vn(x * 2.1 + 5.2, y * 2.1 + 1.3, z * 2.1 + 9.1) * 0.3 + vn(x * 4.3 + 2.7, y * 4.3 + 7.7, z * 4.3 + 3.1) * 0.15;
export const hash1 = (i, j = 0) => hsh(i | 0, j | 0, 17);

// ---- scratch nodes and the one emitter ---------------------------------------------------
let CAP = 4096;
let SP = new Float64Array(CAP * 3), SN = new Float64Array(CAP * 3), SC = new Float64Array(CAP * 3), SU = new Float64Array(CAP);
function need(n) {
  if (n <= CAP) return;
  while (CAP < n) CAP *= 2;
  const grow = (a, k) => { const b = new Float64Array(CAP * k); b.set(a); return b; };
  SP = grow(SP, 3); SN = grow(SN, 3); SC = grow(SC, 3); SU = grow(SU, 1);
}
function tint(n, col) { for (let i = 0; i < n; i++) { SC[i * 3] = col[0]; SC[i * 3 + 1] = col[1]; SC[i * 3 + 2] = col[2]; SU[i] = 0; } }
function dress(n, o) {
  if (!o) return;
  if (o.along) for (let i = 0; i < n; i++) SU[i] = o.along(SP, i * 3);
  if (o.paint) for (let i = 0; i < n; i++) o.paint(SP, SN, SC, i * 3);
}
function tri3(g, a, b, c, m) {
  const ax = SP[a], ay = SP[a + 1], az = SP[a + 2], bx = SP[b], by = SP[b + 1], bz = SP[b + 2], cx = SP[c], cy = SP[c + 1], cz = SP[c + 2];
  const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  if (nx * nx + ny * ny + nz * nz < 1e-18) return;
  if (g.nv + 3 > g.cap) g.reserve(3);
  const P = g.P, N = g.N, C = g.C, M = g.M, U = g.U, i = g.nv * 3, j = g.nv * 2;
  P[i] = ax; P[i + 1] = ay; P[i + 2] = az; P[i + 3] = bx; P[i + 4] = by; P[i + 5] = bz; P[i + 6] = cx; P[i + 7] = cy; P[i + 8] = cz;
  N[i] = SN[a]; N[i + 1] = SN[a + 1]; N[i + 2] = SN[a + 2]; N[i + 3] = SN[b]; N[i + 4] = SN[b + 1]; N[i + 5] = SN[b + 2]; N[i + 6] = SN[c]; N[i + 7] = SN[c + 1]; N[i + 8] = SN[c + 2];
  C[i] = SC[a]; C[i + 1] = SC[a + 1]; C[i + 2] = SC[a + 2]; C[i + 3] = SC[b]; C[i + 4] = SC[b + 1]; C[i + 5] = SC[b + 2]; C[i + 6] = SC[c]; C[i + 7] = SC[c + 1]; C[i + 8] = SC[c + 2];
  const m0 = m[0], m1 = m[1], m2 = m[2], dv = m[3] || 0;
  M[i] = m0; M[i + 1] = m1; M[i + 2] = m2; M[i + 3] = m0; M[i + 4] = m1; M[i + 5] = m2; M[i + 6] = m0; M[i + 7] = m1; M[i + 8] = m2;
  U[j] = dv; U[j + 1] = SU[a / 3]; U[j + 2] = dv; U[j + 3] = SU[b / 3]; U[j + 4] = dv; U[j + 5] = SU[c / 3];
  g.nv += 3;
}
// as tri3, but the normals lean toward the triangle's own by `f`: facets, for rock and anything hewn
function tri3f(g, a, b, c, m, f) {
  const n0 = g.nv;
  tri3(g, a, b, c, m);
  if (g.nv === n0) return;
  const P = g.P, N = g.N, i = n0 * 3;
  const ux = P[i + 3] - P[i], uy = P[i + 4] - P[i + 1], uz = P[i + 5] - P[i + 2], vx = P[i + 6] - P[i], vy = P[i + 7] - P[i + 1], vz = P[i + 8] - P[i + 2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
  if (nx * N[i] + ny * N[i + 1] + nz * N[i + 2] < 0) { nx = -nx; ny = -ny; nz = -nz; }
  for (let k = i; k < i + 9; k += 3) { const x = N[k] + (nx - N[k]) * f, y = N[k + 1] + (ny - N[k + 1]) * f, z = N[k + 2] + (nz - N[k + 2]) * f, ll = Math.hypot(x, y, z) || 1; N[k] = x / ll; N[k + 1] = y / ll; N[k + 2] = z / ll; }
}
// R rows of C nodes (o.flat: how far the shading is faceted, 0..1)
function emit(g, R, C, m, o) {
  dress(R * C, o);
  const f = (o && o.flat) || 0;
  for (let i = 0; i < R - 1; i++) for (let j = 0; j < C - 1; j++) {
    const a = (i * C + j) * 3, b = a + C * 3;
    // (the diagonal alternates, so facets do not all lean one way)
    if (f) { if ((i + j) & 1) { tri3f(g, a, b, b + 3, m, f); tri3f(g, a, b + 3, a + 3, m, f); } else { tri3f(g, a, b, a + 3, m, f); tri3f(g, b, b + 3, a + 3, m, f); } }
    else { tri3(g, a, b, b + 3, m); tri3(g, a, b + 3, a + 3, m); }
  }
}
// node 0 is the centre, 1..n the rim (closed)
function emitFan(g, n, m, o) {
  dress(n + 1, o);
  for (let j = 1; j <= n; j++) tri3(g, 0, j * 3, (j % n + 1) * 3, m);
}
// smooth normals of the scratch grid by differences (wrapJ: the columns close on themselves and the last repeats the first)
function gridNormals(R, C, wrapJ) {
  for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) {
    const i0 = i > 0 ? i - 1 : i, i1 = i < R - 1 ? i + 1 : i;
    let j0 = j - 1, j1 = j + 1;
    if (wrapJ) { if (j0 < 0) j0 = C - 2; if (j1 > C - 1) j1 = 1; } else { if (j0 < 0) j0 = 0; if (j1 > C - 1) j1 = C - 1; }
    const a = (i1 * C + j) * 3, b = (i0 * C + j) * 3, c = (i * C + j1) * 3, d = (i * C + j0) * 3;
    const ux = SP[a] - SP[b], uy = SP[a + 1] - SP[b + 1], uz = SP[a + 2] - SP[b + 2];
    const vx = SP[c] - SP[d], vy = SP[c + 1] - SP[d + 1], vz = SP[c + 2] - SP[d + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz), k = (i * C + j) * 3;
    if (l < 1e-12) { SN[k] = 0; SN[k + 1] = 0; SN[k + 2] = 0; } else { SN[k] = nx / l; SN[k + 1] = ny / l; SN[k + 2] = nz / l; }
  }
  // a row collapsed to a point (a dome's crown) or a degenerate node borrows its neighbour's normal
  for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) {
    const k = (i * C + j) * 3;
    if (SN[k] === 0 && SN[k + 1] === 0 && SN[k + 2] === 0) {
      const q = ((i > 0 ? i - 1 : i + 1) * C + j) * 3;
      SN[k] = SN[q]; SN[k + 1] = SN[q + 1]; SN[k + 2] = SN[q + 2];
      if (SN[k] === 0 && SN[k + 1] === 0 && SN[k + 2] === 0) SN[k + 1] = 1;
    }
  }
}

// ---- primitives --------------------------------------------------------------------------
// round bar along a polyline; r: one radius or one per point. o: segs, closed, caps (flat ends), paint, along
export function tube(g, pts, r, col, m, o) {
  const segs = (o && o.segs) || 6, closed = !!(o && o.closed), N = pts.length, R = closed ? N + 1 : N, C = segs + 1;
  need(R * C);
  let nx = 0, ny = 0, nz = 0, first = true, t0x = 0, t0y = 0, t0z = 0, tx = 0, ty = 0, tz = 0;
  for (let i = 0; i < R; i++) {
    const k = i % N, pa = pts[closed ? (k + N - 1) % N : Math.max(k - 1, 0)], pb = pts[closed ? (k + 1) % N : Math.min(k + 1, N - 1)], p = pts[k];
    tx = pb[0] - pa[0]; ty = pb[1] - pa[1]; tz = pb[2] - pa[2];
    let l = Math.hypot(tx, ty, tz) || 1; tx /= l; ty /= l; tz /= l;
    if (first) { first = false; if (Math.abs(ty) < 0.9) { nx = 0; ny = 1; nz = 0; } else { nx = 1; ny = 0; nz = 0; } t0x = tx; t0y = ty; t0z = tz; }
    const d = nx * tx + ny * ty + nz * tz;
    nx -= tx * d; ny -= ty * d; nz -= tz * d;
    l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const bx = ty * nz - tz * ny, by = tz * nx - tx * nz, bz = tx * ny - ty * nx;
    const rr = typeof r === 'number' ? r : r[k];
    for (let j = 0; j <= segs; j++) {
      const a = (j / segs) * TAU, ca = Math.cos(a), sa = Math.sin(a), q = (i * C + j) * 3;
      const dx = nx * ca + bx * sa, dy = ny * ca + by * sa, dz = nz * ca + bz * sa;
      SP[q] = p[0] + dx * rr; SP[q + 1] = p[1] + dy * rr; SP[q + 2] = p[2] + dz * rr;
      SN[q] = dx; SN[q + 1] = dy; SN[q + 2] = dz;
    }
  }
  tint(R * C, col);
  emit(g, R, C, m, o);
  if (o && o.caps && !closed) {
    for (const [e, s, ax, ay, az] of [[0, -1, t0x, t0y, t0z], [N - 1, 1, tx, ty, tz]]) {
      const rr = typeof r === 'number' ? r : r[e], p = pts[e];
      if (rr < 1e-5) continue;
      // the ring just written is gone from scratch after emit's reuse only if overwritten: rebuild it
      let ux, uy, uz;
      if (Math.abs(ay) < 0.9) { ux = az; uy = 0; uz = -ax; } else { ux = 0; uy = -az; uz = ay; }
      const l = Math.hypot(ux, uy, uz) || 1; ux /= l; uy /= l; uz /= l;
      const vx = ay * uz - az * uy, vy = az * ux - ax * uz, vz = ax * uy - ay * ux;
      SP[0] = p[0]; SP[1] = p[1]; SP[2] = p[2];
      for (let j = 0; j <= segs; j++) {
        const a = (j / segs) * TAU, ca = Math.cos(a) * rr, sa = Math.sin(a) * rr, q = (j + 1) * 3;
        SP[q] = p[0] + ux * ca + vx * sa; SP[q + 1] = p[1] + uy * ca + vy * sa; SP[q + 2] = p[2] + uz * ca + vz * sa;
      }
      for (let j = 0; j <= segs + 1; j++) { SN[j * 3] = ax * s; SN[j * 3 + 1] = ay * s; SN[j * 3 + 2] = az * s; }
      tint(segs + 2, col);
      emitFan(g, segs, m, o);
    }
  }
}
const _ab = [null, null];
export function rod(g, a, b, r, col, m, segs = 5, o) {
  _ab[0] = a; _ab[1] = b;
  if (o) { o.segs = segs; tube(g, _ab, r, col, m, o); } else { _o.segs = segs; tube(g, _ab, r, col, m, _o); }
}
const _o = { segs: 5 };

// Surface of revolution from a profile [[r, h], ...]. Normals come from the profile; a point given
// twice makes a hard edge. o: segs, at [x, y, z] (the axis passes through it), axis 'y' (default) or 'x'
// (then h runs along x), arc [a0, a1], ell (the radius across is scaled by it), paint, along
export function lathe(g, prof, col, m, o) {
  const segs = (o && o.segs) || 16, at = (o && o.at) || ZERO3, ax = o && o.axis === 'x', ell = (o && o.ell) || 1;
  const a0 = o && o.arc ? o.arc[0] : 0, a1 = o && o.arc ? o.arc[1] : TAU;
  const n = prof.length, C = segs + 1;
  need(n * C);
  for (let i = 0; i < n; i++) {
    const p = prof[i], pa = i > 0 ? prof[i - 1] : null, pb = i < n - 1 ? prof[i + 1] : null;
    const sa = pa && Math.abs(pa[0] - p[0]) + Math.abs(pa[1] - p[1]) > 1e-9, sb = pb && Math.abs(pb[0] - p[0]) + Math.abs(pb[1] - p[1]) > 1e-9;
    let tr = 0, th = 0;
    if (sa) { const l = Math.hypot(p[0] - pa[0], p[1] - pa[1]); tr += (p[0] - pa[0]) / l; th += (p[1] - pa[1]) / l; }
    if (sb) { const l = Math.hypot(pb[0] - p[0], pb[1] - p[1]); tr += (pb[0] - p[0]) / l; th += (pb[1] - p[1]) / l; }
    const l = Math.hypot(tr, th) || 1;
    const nr = th / l, nh = -tr / l;
    for (let j = 0; j <= segs; j++) {
      const a = a0 + (j / segs) * (a1 - a0), c = Math.cos(a), s = Math.sin(a), q = (i * C + j) * 3;
      if (ax) {
        SP[q] = at[0] + p[1]; SP[q + 1] = at[1] + c * p[0]; SP[q + 2] = at[2] + s * p[0] * ell;
        SN[q] = nh; SN[q + 1] = c * nr; SN[q + 2] = s * nr;
      } else {
        SP[q] = at[0] + c * p[0]; SP[q + 1] = at[1] + p[1]; SP[q + 2] = at[2] + s * p[0] * ell;
        SN[q] = c * nr; SN[q + 1] = nh; SN[q + 2] = s * nr;
      }
    }
  }
  tint(n * C, col);
  emit(g, n, C, m, o);
}
const ZERO3 = [0, 0, 0];

// box with its centre at c and half sizes, turned by o.yaw about the vertical; o.top / o.bottom: other colours for those faces
const _h = [0, 0, 0], _l = [0, 0, 0];
export function box(g, c, hx, hy, hz, col, m, o) {
  const yaw = (o && o.yaw) || 0, cs = Math.cos(yaw), sn = Math.sin(yaw);
  _h[0] = hx; _h[1] = hy; _h[2] = hz;
  need(4);
  for (let a = 0; a < 3; a++) for (let s = -1; s <= 1; s += 2) {
    const ib = (a + 1) % 3, ic = (a + 2) % 3;
    for (let k = 0; k < 4; k++) {
      _l[a] = s * _h[a]; _l[ib] = (k & 1 ? 1 : -1) * _h[ib]; _l[ic] = (k & 2 ? 1 : -1) * _h[ic];
      SP[k * 3] = c[0] + _l[0] * cs - _l[2] * sn; SP[k * 3 + 1] = c[1] + _l[1]; SP[k * 3 + 2] = c[2] + _l[0] * sn + _l[2] * cs;
      _l[a] = s; _l[ib] = 0; _l[ic] = 0;
      SN[k * 3] = _l[0] * cs - _l[2] * sn; SN[k * 3 + 1] = _l[1]; SN[k * 3 + 2] = _l[0] * sn + _l[2] * cs;
    }
    tint(4, a === 1 && o ? (s > 0 ? o.top || col : o.bottom || col) : col);
    emit(g, 2, 2, m, o);
  }
}
export const slab = (g, x0, x1, y0, y1, z0, z1, col, m, o) => box(g, [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], (x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2, col, m, o);

// flat quad a, b, c, d (in order round it), one normal
export function quad(g, a, b, c, d, col, m, o) {
  need(4);
  const P = [a, b, d, c];
  for (let k = 0; k < 4; k++) { SP[k * 3] = P[k][0]; SP[k * 3 + 1] = P[k][1]; SP[k * 3 + 2] = P[k][2]; }
  let nx, ny, nz;
  if (o && o.n) { nx = o.n[0]; ny = o.n[1]; nz = o.n[2]; } else {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    nx = uy * vz - uz * vy; ny = uz * vx - ux * vz; nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
  }
  for (let k = 0; k < 4; k++) { SN[k * 3] = nx; SN[k * 3 + 1] = ny; SN[k * 3 + 2] = nz; }
  tint(4, col);
  emit(g, 2, 2, m, o);
}
// convex box from 4 bottom and 4 top corners (same order round)
export function hexa(g, b, t, col, m, o) {
  quad(g, b[0], b[1], b[2], b[3], (o && o.bottom) || col, m, o); quad(g, t[0], t[1], t[2], t[3], (o && o.top) || col, m, o);
  for (let i = 0; i < 4; i++) quad(g, b[i], b[(i + 1) % 4], t[(i + 1) % 4], t[i], col, m, o);
}
// flat polygon about its centroid
export function fan(g, ring, col, m, o) {
  const n = ring.length;
  need(n + 1);
  let cx = 0, cy = 0, cz = 0;
  for (let j = 0; j < n; j++) { const p = ring[j]; cx += p[0]; cy += p[1]; cz += p[2]; SP[(j + 1) * 3] = p[0]; SP[(j + 1) * 3 + 1] = p[1]; SP[(j + 1) * 3 + 2] = p[2]; }
  SP[0] = cx / n; SP[1] = cy / n; SP[2] = cz / n;
  let nx, ny, nz;
  if (o && o.n) { nx = o.n[0]; ny = o.n[1]; nz = o.n[2]; } else {
    // Newell's method: the normal of a polygon that need not be quite flat
    nx = ny = nz = 0;
    for (let j = 0; j < n; j++) { const p = ring[j], q = ring[(j + 1) % n]; nx += (p[1] - q[1]) * (p[2] + q[2]); ny += (p[2] - q[2]) * (p[0] + q[0]); nz += (p[0] - q[0]) * (p[1] + q[1]); }
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
  }
  for (let j = 0; j <= n; j++) { SN[j * 3] = nx; SN[j * 3 + 1] = ny; SN[j * 3 + 2] = nz; }
  tint(n + 1, col);
  emitFan(g, n, m, o);
}
// Loft through rings (rings[i][j] = [x, y, z], all the same length), smooth normals. o: closed (default true),
// caps [start, end] (flat), paint, along
export function loft(g, rings, col, m, o) {
  const closed = !(o && o.closed === false), R = rings.length, M = rings[0].length, C = closed ? M + 1 : M;
  need(R * C);
  for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) { const p = rings[i][j % M], q = (i * C + j) * 3; SP[q] = p[0]; SP[q + 1] = p[1]; SP[q + 2] = p[2]; }
  gridNormals(R, C, closed);
  tint(R * C, col);
  emit(g, R, C, m, o);
  if (o && o.caps) { if (o.caps[0]) fan(g, rings[0], col, m, o); if (o.caps[1]) fan(g, rings[R - 1], col, m, o); }
}
// Parametric surface: fn(u, v, out) writes a point. us and vs are the parameter lists; with o.uv(i, j, out2)
// the parameters of node (i, j) come from that instead (bands whose edges follow a curve). Normals
// come from the function itself, so patches that share an edge agree along it.
const _p0 = [0, 0, 0], _p1 = [0, 0, 0], _p2 = [0, 0, 0], _p3 = [0, 0, 0], _uv = [0, 0];
export function surf(g, fn, us, vs, col, m, o) {
  const R = us.length, C = vs.length, e = (o && o.eps) || 1e-3;
  need(R * C);
  for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) {
    let u = us[i], v = vs[j];
    if (o && o.uv) { o.uv(i, j, _uv); u = _uv[0]; v = _uv[1]; }
    const q = (i * C + j) * 3;
    fn(u, v, _p0); SP[q] = _p0[0]; SP[q + 1] = _p0[1]; SP[q + 2] = _p0[2];
    // (o.lim = [u0, u1, v0, v1]: the function is not sampled outside its range; at an edge the difference is one-sided)
    const L = o && o.lim;
    if (L) { fn(Math.min(u + e, L[1]), v, _p0); fn(Math.max(u - e, L[0]), v, _p1); fn(u, Math.min(v + e, L[3]), _p2); fn(u, Math.max(v - e, L[2]), _p3); }
    else { fn(u + e, v, _p0); fn(u - e, v, _p1); fn(u, v + e, _p2); fn(u, v - e, _p3); }
    const ux = _p0[0] - _p1[0], uy = _p0[1] - _p1[1], uz = _p0[2] - _p1[2], vx = _p2[0] - _p3[0], vy = _p2[1] - _p3[1], vz = _p2[2] - _p3[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-14) { nx = 0; ny = 1; nz = 0; } else { nx /= l; ny /= l; nz /= l; }
    SN[q] = nx; SN[q + 1] = ny; SN[q + 2] = nz;
  }
  tint(R * C, col);
  emit(g, R, C, m, o);
}
// a grid of points fn(i, j, out) with normals by differences. o: wrap (the last column repeats the first)
export function sheet(g, R, C, fn, col, m, o) {
  need(R * C);
  for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) { fn(i, j, _p0); const q = (i * C + j) * 3; SP[q] = _p0[0]; SP[q + 1] = _p0[1]; SP[q + 2] = _p0[2]; }
  gridNormals(R, C, !!(o && o.wrap));
  tint(R * C, col);
  emit(g, R, C, m, o);
}
export const lin = (a, b, n) => Array.from({ length: n + 1 }, (_, k) => a + ((b - a) * k) / n);

// ellipsoid (p > 2 squares its plan section)
const spw = (c, p) => Math.sign(c) * Math.pow(Math.abs(c), 2 / p);
export function blob(g, c, rx, ry, rz, col, m, o) {
  const n = (o && o.n) || 6, segs = (o && o.segs) || 10, p = (o && o.p) || 2, C = segs + 1;
  need((n + 1) * C);
  for (let i = 0; i <= n; i++) {
    const a = (i / n - 0.5) * Math.PI, ca = Math.cos(a), sa = Math.sin(a);
    for (let j = 0; j <= segs; j++) {
      const t = (j / segs) * TAU, q = (i * C + j) * 3;
      const ex = ca * spw(Math.cos(t), p), ez = ca * spw(Math.sin(t), p);
      SP[q] = c[0] + rx * ex; SP[q + 1] = c[1] + ry * sa; SP[q + 2] = c[2] + rz * ez;
      let nx = ex / rx, ny = sa / ry, nz = ez / rz;
      const l = Math.hypot(nx, ny, nz) || 1;
      SN[q] = nx / l; SN[q + 1] = ny / l; SN[q + 2] = nz / l;
    }
  }
  tint((n + 1) * C, col);
  emit(g, n + 1, C, m, o);
}

// A limb: a smooth solid along a spline through pts with an elliptical section (half extents ea along the
// hint direction, eb across it) at each point; rounded ends. As driver.js's tubeE, on the fast path.
// rounded ends as rings of (offset fraction, section fraction): three, two or one of them (o.cr)
const CAP_RINGS = [null, [[0.7, 0.03]], [[1, 0.02], [0.6, 0.8]], [[1, 0.02], [0.82, 0.57], [0.4, 0.92]]];
function cat(p0, p1, p2, p3, t, k) { const t2 = t * t, t3 = t2 * t; return 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3); }
export function limb(g, pts, ea, eb, col, m, o) {
  const hint = (o && o.hint) || [0, 0, 1], segs = (o && o.segs) || 8, per = (o && o.per) || 2, pw = (o && o.p) || 2;
  const cap0 = !(o && o.caps && !o.caps[0]), cap1 = !(o && o.caps && !o.caps[1]);
  const n = pts.length, P = [], A = [], B = [];
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(i - 1, 0)], p3 = pts[Math.min(i + 2, n - 1)];
    for (let k = 0; k < per; k++) {
      const t = k / per, s = t * t * (3 - 2 * t);
      P.push([cat(p0, pts[i], pts[i + 1], p3, t, 0), cat(p0, pts[i], pts[i + 1], p3, t, 1), cat(p0, pts[i], pts[i + 1], p3, t, 2)]);
      A.push(lerp(ea[i], ea[i + 1], s)); B.push(lerp(eb[i], eb[i + 1], s));
    }
  }
  P.push(pts[n - 1]); A.push(ea[n - 1]); B.push(eb[n - 1]);
  const CAPS = CAP_RINGS[(o && o.cr) || 3], nc = CAPS.length;
  const mm = P.length, C = segs + 1, R = mm + (cap0 ? nc : 0) + (cap1 ? nc : 0);
  need(R * C);
  let row = 0;
  const ring = (c, tx, ty, tz, a, b, off) => {
    let ux = hint[0], uy = hint[1], uz = hint[2];
    let d = ux * tx + uy * ty + uz * tz;
    ux -= tx * d; uy -= ty * d; uz -= tz * d;
    if (ux * ux + uy * uy + uz * uz < 1e-6) { ux = 1 - tx * tx; uy = -tx * ty; uz = -tx * tz; }
    const l = Math.hypot(ux, uy, uz) || 1; ux /= l; uy /= l; uz /= l;
    const vx = ty * uz - tz * uy, vy = tz * ux - tx * uz, vz = tx * uy - ty * ux;
    for (let j = 0; j <= segs; j++) {
      const th = (j / segs) * TAU, ca = a * spw(Math.cos(th), pw), sb = b * spw(Math.sin(th), pw), q = (row * C + j) * 3;
      SP[q] = c[0] + tx * off + ux * ca + vx * sb; SP[q + 1] = c[1] + ty * off + uy * ca + vy * sb; SP[q + 2] = c[2] + tz * off + uz * ca + vz * sb;
    }
    row++;
  };
  const tan = (i) => { const a = P[Math.max(i - 1, 0)], b = P[Math.min(i + 1, mm - 1)]; const l = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || 1; return [(b[0] - a[0]) / l, (b[1] - a[1]) / l, (b[2] - a[2]) / l]; };
  if (cap0) { const t = tan(0), r = (A[0] + B[0]) / 2; for (const [o1, s] of CAPS) ring(P[0], t[0], t[1], t[2], A[0] * s, B[0] * s, -o1 * r); }
  for (let i = 0; i < mm; i++) { const t = tan(i); ring(P[i], t[0], t[1], t[2], A[i], B[i], 0); }
  if (cap1) { const t = tan(mm - 1), r = (A[mm - 1] + B[mm - 1]) / 2; for (let k = nc - 1; k >= 0; k--) ring(P[mm - 1], t[0], t[1], t[2], A[mm - 1] * CAPS[k][1], B[mm - 1] * CAPS[k][1], CAPS[k][0] * r); }
  gridNormals(R, C, true);
  tint(R * C, col);
  emit(g, R, C, m, o);
}

// ---- working on finished geometry ---------------------------------------------------------
export const mark = (g) => g.nv;   // the index of the next vertex
// run a painter over the vertices from `from` on
export function paint(g, from, fn, to = g.nv) { const P = g.P, N = g.N, C = g.C, M = g.M; for (let i = from * 3; i < to * 3; i += 3) fn(P, N, C, i, M); }
// give the vertices from `from` on a surface variant (and a distance along, if asked)
export function detail(g, from, dv, along) { const U = g.U, P = g.P; for (let i = from; i < g.nv; i++) { U[i * 2] = dv; if (along) U[i * 2 + 1] = along(P, i * 3); } }
// a placement: p -> o + s (X p.x + Y p.y + Z p.z), turned by yaw about y, then pitch about the new z, then roll about the new x
export function frame(o, yaw = 0, pitch = 0, roll = 0, s = 1) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
  // yaw: x -> (cy, 0, sy), z -> (-sy, 0, cy); pitch: x -> up; roll: y -> z
  const X = [cy * cp, sp, sy * cp], Y0 = [-cy * sp, cp, -sy * sp], Z0 = [-sy, 0, cy];
  const Y = [Y0[0] * cr + Z0[0] * sr, Y0[1] * cr + Z0[1] * sr, Y0[2] * cr + Z0[2] * sr], Z = [Z0[0] * cr - Y0[0] * sr, Z0[1] * cr - Y0[1] * sr, Z0[2] * cr - Y0[2] * sr];
  return [X[0], X[1], X[2], Y[0], Y[1], Y[2], Z[0], Z[1], Z[2], o[0], o[1], o[2], s];
}
// move the vertices from `from` on by a placement (sv: stretch along the local axes first)
export function xf(g, from, F, sv) {
  const P = g.P, N = g.N, s = F[12], sx = sv ? sv[0] : 1, sy = sv ? sv[1] : 1, sz = sv ? sv[2] : 1, end = g.nv * 3;
  for (let i = from * 3; i < end; i += 3) {
    const x = P[i] * sx * s, y = P[i + 1] * sy * s, z = P[i + 2] * sz * s;
    P[i] = F[9] + F[0] * x + F[3] * y + F[6] * z; P[i + 1] = F[10] + F[1] * x + F[4] * y + F[7] * z; P[i + 2] = F[11] + F[2] * x + F[5] * y + F[8] * z;
    let nx = N[i] / sx, ny = N[i + 1] / sy, nz = N[i + 2] / sz;
    if (sv) { const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l; }
    N[i] = F[0] * nx + F[3] * ny + F[6] * nz; N[i + 1] = F[1] * nx + F[4] * ny + F[7] * nz; N[i + 2] = F[2] * nx + F[5] * ny + F[8] * nz;
  }
}
// append a placed copy of a prototype; mul: multiply its colours; sv: stretch along its own axes first
export function stamp(g, proto, F, mul, sv) {
  const P = proto.P, N = proto.N, C = proto.C, M = proto.M, U = proto.U, n = proto.nv;
  const s = F[12], sx = (sv ? sv[0] : 1) * s, sy = (sv ? sv[1] : 1) * s, sz = (sv ? sv[2] : 1) * s;
  const ix = sv ? 1 / sv[0] : 1, iy = sv ? 1 / sv[1] : 1, iz = sv ? 1 / sv[2] : 1;
  const mr = mul ? mul[0] : 1, mg = mul ? mul[1] : 1, mb = mul ? mul[2] : 1;
  g.reserve(n);
  const gp = g.P, gn = g.N, gc = g.C, o = g.nv * 3;
  for (let i = 0; i < n * 3; i += 3) {
    const x = P[i] * sx, y = P[i + 1] * sy, z = P[i + 2] * sz, q = o + i;
    gp[q] = F[9] + F[0] * x + F[3] * y + F[6] * z; gp[q + 1] = F[10] + F[1] * x + F[4] * y + F[7] * z; gp[q + 2] = F[11] + F[2] * x + F[5] * y + F[8] * z;
    let nx = N[i] * ix, ny = N[i + 1] * iy, nz = N[i + 2] * iz;
    if (sv) { const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l; }
    gn[q] = F[0] * nx + F[3] * ny + F[6] * nz; gn[q + 1] = F[1] * nx + F[4] * ny + F[7] * nz; gn[q + 2] = F[2] * nx + F[5] * ny + F[8] * nz;
    gc[q] = C[i] * mr; gc[q + 1] = C[i + 1] * mg; gc[q + 2] = C[i + 2] * mb;
  }
  g.M.set(M.subarray(0, n * 3), o);
  g.U.set(U.subarray(0, n * 2), g.nv * 2);
  g.nv += n;
}
export const tris = (g) => g.nv / 3;
export { MAT };

// ---- painters ----------------------------------------------------------------------------
const lumOf = (C, i) => C[i] * 0.2126 + C[i + 1] * 0.7152 + C[i + 2] * 0.0722;
const mixIn = (C, i, r, g, b, t) => { C[i] += (r - C[i]) * t; C[i + 1] += (g - C[i + 1]) * t; C[i + 2] += (b - C[i + 2]) * t; };
export { mixIn };
// blotchy tone: multiply by 1 - amt .. 1 + amt at the given scale (per metre)
export const mottle = (seed, amt = 0.1, f = 1) => (P, N, C, i) => { const k = 1 - amt + 2 * amt * fb(P[i] * f + seed, P[i + 1] * f, P[i + 2] * f); C[i] *= k; C[i + 1] *= k; C[i + 2] *= k; };
// Weed, barnacles, the tide line and salt, for anything that stands or floats in the sea; y is the
// height above the still waterline. wet: how far the darkened, always-wet band reaches up.
export function stain(seed, { weedTop = 0.3, tide = 0.38, wet = 0, salt = 0.22, y0 = 0 } = {}) {
  // (at: the same for a point given apart from the colour it stains, for geometry kept relative to a moving origin)
  const at = (x, yy, z, C, i) => {
    const y = yy - y0;
    if (y > Math.max(tide, weedTop, wet) + 1.6) return;
    const nz = fb(x * 5 + seed, y * 8, z * 5);
    const wl = y + (nz - 0.5) * 0.24;
    if (wet > 0) { const w = smooth(wet, wet * 0.35, wl) * 0.45; C[i] *= 1 - w; C[i + 1] *= 1 - w; C[i + 2] *= 1 - w * 0.9; }
    // (a top at or below the waterline: weed only under it)
    const weed = weedTop > 0.03 ? smooth(weedTop, 0.0, wl) : smooth(weedTop + 0.015, weedTop - 0.03, wl);
    if (weed > 0) { const lush = smooth(0.52, 0.7, vn(x * 11 + seed, y * 6, z * 11)); mixIn(C, i, lerp(0.035, 0.11, lush), lerp(0.05, 0.115, lush), lerp(0.022, 0.04, lush), weed * 0.93); }
    const barn = smooth(0.74, 0.8, vn(x * 38, y * 38 + seed, z * 38)) * smooth(0.5, 0.0, Math.abs(wl - 0.12));
    if (barn > 0) mixIn(C, i, 0.46, 0.43, 0.36, barn * 0.8);
    const tl = Math.exp(-Math.pow((y - tide - 0.08 * nz) / 0.09, 2));
    mixIn(C, i, 0.5, 0.46, 0.36, tl * 0.8);
    const l = lumOf(C, i) * 0.9;
    mixIn(C, i, l + 0.12, l + 0.11, l + 0.1, smooth(1.4, 0.4, y) * salt * (1 - weed));
  };
  const fn = (P, N, C, i) => at(P[i], P[i + 1], P[i + 2], C, i);
  fn.at = at;
  return fn;
}
// rust: patches where noise is high, and streaks running down from y = top (when given)
export function rust(seed, { amt = 0.6, f = 6, lo = 0.6, hi = 0.84, top = null, len = 1.2 } = {}) {
  return (P, N, C, i) => {
    const x = P[i], y = P[i + 1], z = P[i + 2];
    let k = smooth(lo, hi, vn(x * f + seed, y * f * 0.5, z * f)) * amt;
    if (top !== null) { const d = top - y; if (d > -0.02 && d < len * 1.5) { const a = x * 3.1 + z * 2.3; k = Math.max(k, smooth(0.5, 0.78, vn(a * 2.2 + seed, 0.5, a * 0.7)) * smooth(len * (0.4 + vn(a * 3, 1.5, seed)), 0, d) * amt * 1.2); } }
    if (k > 0) { const t = vn(x * 17, y * 17, z * 17 + seed); mixIn(C, i, lerp(0.36, 0.16, t), lerp(0.16, 0.07, t), lerp(0.06, 0.035, t), Math.min(k, 1)); }
  };
}
// sun-faded, chalky paint: lighter and greyer on what faces up, blotchy
export const faded = (seed, amt = 0.5) => (P, N, C, i) => {
  const x = P[i], y = P[i + 1], z = P[i + 2], up = N[i + 1] > 0 ? N[i + 1] : 0;
  const f = clamp(0.25 + 0.5 * fb(x * 1.2 + seed, y * 1.2, z * 1.2) + 0.25 * up, 0, 1) * amt;
  mixIn(C, i, C[i] * 0.55 + 0.27, C[i + 1] * 0.55 + 0.26, C[i + 2] * 0.55 + 0.25, f);
  const bl = 0.84 + 0.32 * fb(x * 3 + seed, y * 3, z * 3);
  C[i] *= bl; C[i + 1] *= bl; C[i + 2] *= bl;
};
// bird droppings on what faces up
export const guano = (seed, amt = 0.8, f = 7, th = 0.8) => (P, N, C, i) => {
  if (N[i + 1] < 0.45) return;
  const sp = smooth(th, th + 0.04, vn(P[i] * f + seed, P[i + 1] * f, P[i + 2] * f)) * smooth(0.45, 0.85, N[i + 1]);
  if (sp > 0) mixIn(C, i, 0.82, 0.82, 0.78, sp * amt);
};
// several painters as one
export const both = (...fns) => (P, N, C, i, M) => { for (const f of fns) f(P, N, C, i, M); };

// ---- lettering: a stroke font on a 4 x 6 grid, drawn as flat bars -----------------------------
const GLYPH = {
  0: '0,0 4,0 4,6 0,6 0,0', 1: '1,5 2,6 2,0|1,0 3,0', 2: '0,6 4,6 4,3 0,3 0,0 4,0', 3: '0,6 4,6 4,0 0,0|1,3 4,3', 4: '0,6 0,3 4,3|4,6 4,0',
  5: '4,6 0,6 0,3 4,3 4,0 0,0', 6: '4,6 0,6 0,0 4,0 4,3 0,3', 7: '0,6 4,6 2,0', 8: '0,0 4,0 4,6 0,6 0,0|0,3 4,3', 9: '0,0 4,0 4,6 0,6 0,3 4,3',
  A: '0,0 0,4 2,6 4,4 4,0|0,2 4,2', B: '0,0 0,6 3,6 4,5 4,4 3,3 0,3|3,3 4,2 4,1 3,0 0,0', C: '4,6 0,6 0,0 4,0', D: '0,0 0,6 3,6 4,5 4,1 3,0 0,0',
  E: '4,6 0,6 0,0 4,0|0,3 3,3', F: '4,6 0,6 0,0|0,3 3,3', G: '4,6 0,6 0,0 4,0 4,3 2,3', H: '0,0 0,6|4,0 4,6|0,3 4,3', I: '2,0 2,6|1,0 3,0|1,6 3,6',
  J: '0,1 1,0 3,0 4,1 4,6', K: '0,0 0,6|4,6 0,3 4,0', L: '0,6 0,0 4,0', M: '0,0 0,6 2,3 4,6 4,0', N: '0,0 0,6 4,0 4,6', O: '0,0 4,0 4,6 0,6 0,0',
  P: '0,0 0,6 4,6 4,3 0,3', Q: '0,0 4,0 4,6 0,6 0,0|2,2 4,0', R: '0,0 0,6 4,6 4,3 0,3|2,3 4,0', S: '4,6 0,6 0,3 4,3 4,0 0,0', T: '0,6 4,6|2,6 2,0',
  U: '0,6 0,0 4,0 4,6', V: '0,6 2,0 4,6', W: '0,6 1,0 2,3 3,0 4,6', X: '0,0 4,6|0,6 4,0', Y: '0,6 2,3 4,6|2,3 2,0', Z: '0,6 4,6 0,0 4,0', '-': '1,3 3,3', '.': '2,0 2,0.6',
};
const STROKES = {};
for (const k in GLYPH) STROKES[k] = GLYPH[k].split('|').map((s) => s.split(' ').map((q) => q.split(',').map(Number)));
// str drawn from `at` (bottom-left) along the unit vector `right`, `up` the letters' up; h: letter height; the
// bars sit `off` proud of the surface along n = right x up. Returns the width used.
export function text(g, str, at, right, up, h, col, m, { off = 0.012, weight = 0.17, gap = 0.3, centre = false } = {}) {
  const u = h / 6, w = weight * h, adv = (4 + gap * 4) * u;
  const n = [right[1] * up[2] - right[2] * up[1], right[2] * up[0] - right[0] * up[2], right[0] * up[1] - right[1] * up[0]];
  const width = str.length * adv - gap * 4 * u;
  let x0 = centre ? -width / 2 : 0;
  const P = (x, y) => [at[0] + right[0] * x + up[0] * y + n[0] * off, at[1] + right[1] * x + up[1] * y + n[1] * off, at[2] + right[2] * x + up[2] * y + n[2] * off];
  const o = { n };
  for (const ch of str.toUpperCase()) {
    const S = STROKES[ch];
    if (S) for (const st of S) for (let k = 0; k < st.length - 1; k++) {
      const ax = x0 + st[k][0] * u, ay = st[k][1] * u, bx = x0 + st[k + 1][0] * u, by = st[k + 1][1] * u;
      let dx = bx - ax, dy = by - ay; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
      const ex = dx * w * 0.5, ey = dy * w * 0.5, px = -dy * w * 0.5, py = dx * w * 0.5;
      quad(g, P(ax - ex + px, ay - ey + py), P(bx + ex + px, by + ey + py), P(bx + ex - px, by + ey - py), P(ax - ex - px, ay - ey - py), col, m, o);
    }
    x0 += adv;
  }
  return width;
}

// whether the point (x, y), measured from the bottom-left of `str` set h tall, falls on a stroke: lettering painted
// into the colours of a fine mesh, for where nothing may be laid over a surface
export function inkAt(str, h, x, y, weight = 0.17, gap = 0.3) {
  const u = h / 6, adv = (4 + gap * 4) * u, k = Math.floor(x / adv);
  if (k < 0 || k >= str.length || y < -weight * h || y > h * (1 + weight)) return false;
  const S = STROKES[str[k]];
  if (!S) return false;
  const px = (x - k * adv) / u, py = y / u, w = (weight * 6) / 2;
  for (const st of S) for (let j = 0; j < st.length - 1; j++) {
    const ax = st[j][0], ay = st[j][1], bx = st[j + 1][0], by = st[j + 1][1], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
    const t = clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1), ex = px - ax - dx * t, ey = py - ay - dy * t;
    if (ex * ex + ey * ey < w * w) return true;
  }
  return false;
}

// ---- fittings ----------------------------------------------------------------------------
// posts and rails along a polyline of points [x, y, z] standing on their own heights. o: h (height), every (post
// spacing), rails (heights as fractions of h), r (bar radius), segs, kick (a toe board of that height)
export function railing(g, pts, col, m, o = {}) {
  const h = o.h || 1, every = o.every || 1.5, rails = o.rails || [0.5, 1], r = o.r || 0.02, segs = o.segs || 4;
  const top = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), n = Math.max(1, Math.round(len / every));
    for (let k = 0; k < n; k++) { const f = k / n; top.push([lerp(a[0], b[0], f), lerp(a[1], b[1], f), lerp(a[2], b[2], f)]); }
  }
  top.push(pts[pts.length - 1]);
  if (!o.noPosts) for (const p of top) rod(g, p, [p[0], p[1] + h, p[2]], r * 1.15, col, m, segs);
  const so = { segs };
  for (const f of rails) tube(g, top.map((p) => [p[0], p[1] + h * f, p[2]]), r * (f === 1 ? 1.1 : 0.8), col, m, so);
  if (o.kick) for (let i = 0; i < top.length - 1; i++) { const a = top[i], b = top[i + 1]; quad(g, [a[0], a[1], a[2]], [b[0], b[1], b[2]], [b[0], b[1] + o.kick, b[2]], [a[0], a[1] + o.kick, a[2]], col, m); }
  return top;
}
// a ladder from a to b: two stiles w apart along `side` (unit), rungs every 0.3 m
export function ladder(g, a, b, side, col, m, { w = 0.4, r = 0.022, step = 0.3, segs = 4 } = {}) {
  const hw = w / 2, len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  for (const s of [-1, 1]) rod(g, [a[0] + side[0] * hw * s, a[1] + side[1] * hw * s, a[2] + side[2] * hw * s], [b[0] + side[0] * hw * s, b[1] + side[1] * hw * s, b[2] + side[2] * hw * s], r, col, m, segs);
  for (let d = step * 0.6; d < len - 0.05; d += step) {
    const f = d / len, c = [lerp(a[0], b[0], f), lerp(a[1], b[1], f), lerp(a[2], b[2], f)];
    rod(g, [c[0] - side[0] * hw, c[1] - side[1] * hw, c[2] - side[2] * hw], [c[0] + side[0] * hw, c[1] + side[1] * hw, c[2] + side[2] * hw], r * 0.7, col, m, 3);
  }
}
// a chain from a to b as alternating flat links (near) or a thin bar (far); sag: how far the middle hangs
export function chain(g, a, b, col, m, { link = 0.09, r = 0.012, sag = 0, bar = false } = {}) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), n = Math.max(2, Math.round(len / link));
  const at = (f) => [lerp(a[0], b[0], f), lerp(a[1], b[1], f) - sag * 4 * f * (1 - f), lerp(a[2], b[2], f)];
  if (bar) { tube(g, Array.from({ length: 7 }, (_, k) => at(k / 6)), r * 1.6, col, m, { segs: 3 }); return; }
  const d = [(b[0] - a[0]) / len, (b[1] - a[1]) / len, (b[2] - a[2]) / len];
  let ux, uy, uz;
  if (Math.abs(d[1]) < 0.9) { ux = d[2]; uy = 0; uz = -d[0]; } else { ux = 1; uy = 0; uz = 0; }
  const l = Math.hypot(ux, uy, uz) || 1; ux /= l; uy /= l; uz /= l;
  const vx = d[1] * uz - d[2] * uy, vy = d[2] * ux - d[0] * uz, vz = d[0] * uy - d[1] * ux;
  const o = { segs: 3, closed: true };
  for (let k = 0; k < n; k++) {
    const c = at((k + 0.5) / n), odd = k & 1, sx = odd ? vx : ux, sy = odd ? vy : uy, sz = odd ? vz : uz, hl = link * 0.72, hw = link * 0.3;
    const ring = [];
    for (let j = 0; j < 6; j++) { const t = (j / 6) * TAU, cl = Math.cos(t) * hl, cw = Math.sin(t) * hw; ring.push([c[0] + d[0] * cl + sx * cw, c[1] + d[1] * cl + sy * cw, c[2] + d[2] * cl + sz * cw]); }
    tube(g, ring, r, col, m, o);
  }
}
// a ring in the plane square to `axis` (unit) about c
export function hoop(g, c, axis, R, r, col, m, segs = 14, ts = 5) {
  let ux, uy, uz;
  if (Math.abs(axis[1]) < 0.9) { ux = axis[2]; uy = 0; uz = -axis[0]; } else { ux = 1; uy = 0; uz = 0; }
  const l = Math.hypot(ux, uy, uz) || 1; ux /= l; uy /= l; uz /= l;
  const vx = axis[1] * uz - axis[2] * uy, vy = axis[2] * ux - axis[0] * uz, vz = axis[0] * uy - axis[1] * ux;
  const pts = [];
  for (let j = 0; j < segs; j++) { const t = (j / segs) * TAU, ca = Math.cos(t) * R, sa = Math.sin(t) * R; pts.push([c[0] + ux * ca + vx * sa, c[1] + uy * ca + vy * sa, c[2] + uz * ca + vz * sa]); }
  tube(g, pts, r, col, m, { segs: ts, closed: true });
}
// a life ring: orange with white quarters, hung flat against a surface whose outward normal is `axis`
export function lifering(g, c, axis, R = 0.33, lod = 0) {
  const s0 = mark(g);
  hoop(g, c, axis, R, R * 0.2, [0.75, 0.16, 0.03], RUB, lod ? 8 : 16, lod ? 4 : 6);
  // white quarters: by the angle round the axis
  let ux, uy, uz;
  if (Math.abs(axis[1]) < 0.9) { ux = axis[2]; uy = 0; uz = -axis[0]; } else { ux = 1; uy = 0; uz = 0; }
  const l = Math.hypot(ux, uy, uz) || 1; ux /= l; uy /= l; uz /= l;
  const vx = axis[1] * uz - axis[2] * uy, vy = axis[2] * ux - axis[0] * uz, vz = axis[0] * uy - axis[1] * ux;
  paint(g, s0, (P, N, C, i) => { const dx = P[i] - c[0], dy = P[i + 1] - c[1], dz = P[i + 2] - c[2]; const a = Math.atan2(dx * vx + dy * vy + dz * vz, dx * ux + dy * uy + dz * uz); if (Math.abs(((a / TAU * 4) % 1 + 1) % 1 - 0.5) > 0.36) { C[i] = 0.8; C[i + 1] = 0.8; C[i + 2] = 0.77; } });
}
// a horn cleat on a deck at p, lying along yaw
export function cleat(g, p, yaw, s = 1, col = [0.72, 0.74, 0.76]) {
  const s0 = mark(g);
  tube(g, [[-0.11, 0.05, 0], [-0.06, 0.055, 0], [0.06, 0.055, 0], [0.11, 0.05, 0]], [0.008, 0.014, 0.014, 0.008], col, MET, { segs: 5, caps: true });
  for (const x of [-0.035, 0.035]) rod(g, [x, 0, 0], [x, 0.05, 0], 0.012, col, MET, 4);
  xf(g, s0, frame(p, yaw, 0, 0, s));
}
// a mooring bollard: a stout post with a head and a cross pin
export function bollard(g, p, s = 1, col = [0.05, 0.05, 0.055], lod = 0) {
  lathe(g, [[0.19, 0], [0.19, 0.04], [0.19, 0.04], [0.12, 0.06], [0.11, 0.3], [0.16, 0.34], [0.17, 0.4], [0.17, 0.4], [0.12, 0.44], [0, 0.45]].map(([r, h]) => [r * s, h * s]), col, RUB, { segs: lod ? 6 : 10, at: p });
}
// a cylindrical fender hung on a lanyard from `top`, its middle at c
export function fender(g, c, top, r = 0.11, len = 0.6, col = [0.82, 0.82, 0.78], lod = 0) {
  const h = len / 2;
  lathe(g, [[0.0, -h], [r * 0.5, -h * 0.97], [r, -h * 0.7], [r, h * 0.7], [r * 0.5, h * 0.95], [r * 0.3, h * 1.12], [0, h * 1.14]], col, RUB, { segs: lod ? 5 : 8, at: c });
  if (!lod) {
    lathe(g, [[r * 0.52, h * 0.93], [r * 0.52, h * 0.99], [r * 0.3, h * 1.13]], [0.05, 0.1, 0.4], RUB, { segs: 8, at: c });
    lathe(g, [[r * 0.52, -h * 0.99], [r * 0.52, -h * 0.93]], [0.05, 0.1, 0.4], RUB, { segs: 8, at: c });
  }
  if (top) rod(g, [c[0], c[1] + h * 1.1, c[2]], top, 0.007, [0.75, 0.75, 0.7], RUB, 3);
}
// a coil of rope lying on a deck
export function coil(g, p, R = 0.28, col = [0.55, 0.5, 0.38], turns = 3) {
  const pts = [], n = turns * 12;
  for (let k = 0; k <= n; k++) { const t = (k / 12) * TAU, rr = R * (1 - 0.55 * (k / n)); pts.push([p[0] + Math.cos(t) * rr, p[1] + 0.02 + 0.012 * (k / n) * turns, p[2] + Math.sin(t) * rr]); }
  tube(g, pts, 0.016, col, CLOTH, { segs: 4 });
}
// an irregular stone: a small sphere cut by random planes, so it has flat faces, edges and rounded corners.
// level 0: 80 faces, 1: 20 faces. The prototype is about one metre across.
const ICO = (() => {
  const t = (1 + Math.sqrt(5)) / 2, v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map((p) => { const l = Math.hypot(...p); return [p[0] / l, p[1] / l, p[2] / l]; });
  const f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  const sub = (V, F) => {
    const V2 = V.slice(), F2 = [], mid = new Map();
    const m = (a, b) => { const k = a < b ? a * 4096 + b : b * 4096 + a; let i = mid.get(k); if (i === undefined) { const p = [V[a][0] + V[b][0], V[a][1] + V[b][1], V[a][2] + V[b][2]], l = Math.hypot(...p); i = V2.length; V2.push([p[0] / l, p[1] / l, p[2] / l]); mid.set(k, i); } return i; };
    for (const [a, b, c] of F) { const ab = m(a, b), bc = m(b, c), ca = m(c, a); F2.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
    return [V2, F2];
  };
  const [v1, f1] = sub(v, f);
  return [{ v: v1, f: f1 }, { v, f }];
})();
export function stoneProto(seed, level = 0, m = STONE, cuts = 7) {
  const R = rng(seed * 7919 + 13), { v, f } = ICO[level], g = new Geo();
  const V = v.map((p) => [p[0] * 0.62, p[1] * 0.62, p[2] * 0.62]);
  for (let k = 0; k < cuts; k++) {
    // a random plane 0.28 to 0.5 from the centre; what lies beyond is pushed back onto it
    const a = R() * TAU, y = R() * 2 - 1, s = Math.sqrt(1 - y * y), nx = Math.cos(a) * s, ny = y, nz = Math.sin(a) * s, d = 0.28 + 0.2 * R();
    for (const p of V) { const e = p[0] * nx + p[1] * ny + p[2] * nz - d; if (e > 0) { p[0] -= nx * e; p[1] -= ny * e; p[2] -= nz * e; } }
  }
  const col = [1, 1, 1];
  need(3);
  for (const [a, b, c] of f) {
    const A = V[a], B = V[b], Cc = V[c];
    let nx = (B[1] - A[1]) * (Cc[2] - A[2]) - (B[2] - A[2]) * (Cc[1] - A[1]), ny = (B[2] - A[2]) * (Cc[0] - A[0]) - (B[0] - A[0]) * (Cc[2] - A[2]), nz = (B[0] - A[0]) * (Cc[1] - A[1]) - (B[1] - A[1]) * (Cc[0] - A[0]);
    const l = Math.hypot(nx, ny, nz); if (l < 1e-9) continue;
    nx /= l; ny /= l; nz /= l;
    // face normals, a little rounded toward the vertex direction so the corners are not razor sharp
    [A, B, Cc].forEach((p, k) => { const pl = Math.hypot(p[0], p[1], p[2]) || 1; let x = nx * 0.8 + (p[0] / pl) * 0.2, y = ny * 0.8 + (p[1] / pl) * 0.2, z = nz * 0.8 + (p[2] / pl) * 0.2; const ll = Math.hypot(x, y, z); SP[k * 3] = p[0]; SP[k * 3 + 1] = p[1]; SP[k * 3 + 2] = p[2]; SN[k * 3] = x / ll; SN[k * 3 + 1] = y / ll; SN[k * 3 + 2] = z / ll; });
    tint(3, col);
    // a face's own tone: strata and fresh breaks
    const tone = 0.82 + 0.36 * R();
    for (let k = 0; k < 3; k++) { const q = 0.9 + 0.2 * vn(SP[k * 3] * 5 + seed, SP[k * 3 + 1] * 5, SP[k * 3 + 2] * 5); SC[k * 3] = tone * q; SC[k * 3 + 1] = tone * q; SC[k * 3 + 2] = tone * q; }
    tri3(g, 0, 3, 6, m);
  }
  return g;
}
