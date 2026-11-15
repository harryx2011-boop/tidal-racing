// The land as one height field per course: a pure function of the course id, so every player gets the
// same coast. It is baked once into two Float32Arrays, a fine one over the racing area and a coarse one
// over 40 km round it (the hills and mountains on the horizon). JS reads them bilinearly here
// (heightAt, sample); the shaders read the very same arrays uploaded as float textures, so the physics, the
// collisions, the minimap and the picture agree. Heights are metres above the still sea, negative under it.
//
// How a height is made: every shape in the course's definition (models/coast.js) is a closed polygon of
// land; its signed distance to the coast (positive inland) is computed exactly on a coarse grid and
// interpolated to every texel, with noise added to the distance so no shoreline is a smooth curve. The
// height follows from that distance by a profile: a shelving seabed, a beach and dune, or a cliff and plunging
// rock where the coast is cliffy, then a plateau and hills inland. Shapes combine by taking the highest.
import { COASTS } from './models/coast.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

// ---- noise: hashed lattice, smooth interpolation ----
function hash2(ix, iz, s) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(s | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function vnoise(x, z, s = 0) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, s), b = hash2(ix + 1, iz, s), c = hash2(ix, iz + 1, s), d = hash2(ix + 1, iz + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, z, s, oct) {
  let a = 0.5, f = 1, sum = 0, n = 0;
  for (let i = 0; i < oct; i++) { sum += a * vnoise(x * f, z * f, s + i * 17); n += a; a *= 0.5; f *= 2.03; }
  return sum / n;
}

// ---- shapes ----
function chaikin(pts, n) {
  for (let k = 0; k < n; k++) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    pts = out;
  }
  return pts;
}
// the polygon of land, its edges as a flat array, its bounds
function makeShape(sh, i) {
  const pts = chaikin(sh.pts, sh.round ?? 2);
  const n = pts.length, e = new Float64Array(n * 4);
  let x0 = 1e30, x1 = -1e30, z0 = 1e30, z1 = -1e30;
  for (let k = 0; k < n; k++) {
    const a = pts[k], b = pts[(k + 1) % n];
    e[k * 4] = a[0]; e[k * 4 + 1] = a[1]; e[k * 4 + 2] = b[0]; e[k * 4 + 3] = b[1];
    x0 = Math.min(x0, a[0]); x1 = Math.max(x1, a[0]); z0 = Math.min(z0, a[1]); z1 = Math.max(z1, a[1]);
  }
  return {
    i, e, n, bounds: [x0, z0, x1, z1],
    relief: sh.relief ?? 0, cliff: sh.cliff ?? 0.3, plateau: sh.plateau ?? 6, seed: (sh.seed ?? i) * 31 + 7, cliffH: sh.cliffH ?? 22, warp: sh.warp ?? 1,
  };
}
// signed distance from (px, pz) to the polygon: positive inside
function signedDistance(sh, px, pz) {
  const e = sh.e, n = sh.n;
  let best = 1e30, inside = false;
  for (let k = 0; k < n; k++) {
    const ax = e[k * 4], az = e[k * 4 + 1], bx = e[k * 4 + 2], bz = e[k * 4 + 3];
    const dx = bx - ax, dz = bz - az;
    let t = ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = ax + dx * t - px, qz = az + dz * t - pz, d = qx * qx + qz * qz;
    if (d < best) best = d;
    if ((az > pz) !== (bz > pz) && px < ax + ((pz - az) / (bz - az)) * dx) inside = !inside;
  }
  best = Math.sqrt(best);
  return inside ? best : -best;
}

// ---- profile: height from the signed distance s and the place (for the noise) ----
// c is how cliffy the coast is here (0 a beach, 1 a cliff), from slow noise along the coast.
function profile(sh, s, x, z) {
  const sd = sh.seed;
  const c = smooth(0.42, 0.58, vnoise(x / 420, z / 420, sd) * 0.7 + vnoise(x / 130, z / 130, sd + 3) * 0.3 + (sh.cliff - 0.5));
  if (s < 0) {
    const d = -s;
    // a beach shelves gently, then drops away; a cliff plunges at once
    const beach = 0.045 * d + 14 * Math.pow(smooth(8, 130, d), 1.15) + 34 * smooth(140, 900, d) + 14 * smooth(900, 3000, d);
    const rock = 16 * (1 - Math.exp(-d / 7)) + 0.06 * d + 30 * smooth(300, 1500, d);
    let h = -lerp(beach, Math.max(rock, beach * 0.9), c);
    // skerries and ledges off a rocky shore
    if (c > 0.3 && d < 140) h += c * Math.max(0, fbm(x / 22, z / 22, sd + 9, 3) - 0.6) * 26 * (1 - d / 140);
    return h;
  }
  // inland: dune, plateau, hills
  const rolling = fbm(x / 160, z / 160, sd + 21, 4), ridge = 1 - Math.abs(fbm(x / 600, z / 600, sd + 40, 3) - 0.5) * 2;
  const berm = 2.6 * smooth(0, 40, s) + 0.5 * smooth(40, 120, s);
  const cliff = sh.cliffH * (0.55 + 0.9 * vnoise(x / 260, z / 260, sd + 5)) * smooth(0, 9, s);
  let h = lerp(berm, cliff, c);
  h += (sh.plateau * (0.4 + 0.6 * rolling)) * smooth(20, 200, s);
  h += sh.relief * smooth(120, 1100, s) * (0.25 + 0.75 * ridge) * (0.5 + 0.8 * rolling);
  h += 1.6 * (fbm(x / 28, z / 28, sd + 60, 3) - 0.5) * smooth(15, 90, s);
  return h;
}

// ---- baking ----
export const NEAR_TEXEL = 3, FAR_SIZE = 40960, FAR_N = 640;

// The height is evaluated on a lattice every `sub` texels (it is the expensive part: noise at several scales) and
// interpolated to the texels; the exact shoreline distance comes from a coarser grid still.
function bakeRect(def, shapes, rect, nx, nz, sub, farFade) {
  const out = new Float32Array(nx * nz);
  const dx = (rect[2] - rect[0]) / nx, dz = (rect[3] - rect[1]) / nz;
  const coarse = sub * 2;
  const cn = Math.ceil(nx / coarse) + 2, cm = Math.ceil(nz / coarse) + 2;
  const grids = shapes.map((sh) => {
    const g = new Float32Array(cn * cm);
    for (let j = 0; j < cm; j++) for (let i = 0; i < cn; i++) g[j * cn + i] = signedDistance(sh, rect[0] + i * coarse * dx, rect[1] + j * coarse * dz);
    return g;
  });
  const ln = Math.ceil(nx / sub) + 2, lm = Math.ceil(nz / sub) + 2;
  const lat = new Float32Array(ln * lm);
  const cx = (rect[0] + rect[2]) / 2, cz = (rect[1] + rect[3]) / 2;
  for (let j = 0; j < lm; j++) {
    const z = rect[1] + j * sub * dz, gj = j / 2, j0 = Math.floor(gj), fj = gj - j0;
    for (let i = 0; i < ln; i++) {
      const x = rect[0] + i * sub * dx, gi = i / 2, i0 = Math.floor(gi), fi = gi - i0;
      let h = -78;
      // organic coastline: warp the distance with noise at two scales
      const wob = (vnoise(x / 95, z / 95, 77) - 0.5) * 34 + (vnoise(x / 31, z / 31, 79) - 0.5) * 9;
      for (let k = 0; k < shapes.length; k++) {
        const g = grids[k], o = j0 * cn + i0;
        const s0 = g[o] + (g[o + 1] - g[o]) * fi, s1 = g[o + cn] + (g[o + cn + 1] - g[o + cn]) * fi;
        let s = s0 + (s1 - s0) * fj;
        if (s < -800) continue;
        s += wob * shapes[k].warp * (1 - smooth(200, 500, Math.abs(s)));
        const p = profile(shapes[k], s, x, z);
        if (p > h) h = p;
      }
      if (farFade && h > 0) {
        const r = Math.max(Math.abs(x - cx), Math.abs(z - cz)) / (farFade * 0.5);
        h *= 1 - smooth(0.62, 0.97, r);
      }
      lat[j * ln + i] = h;
    }
  }
  for (let j = 0; j < nz; j++) {
    const gj = (j + 0.5) / sub, j0 = Math.floor(gj), fj = gj - j0;
    for (let i = 0; i < nx; i++) {
      const gi = (i + 0.5) / sub, i0 = Math.floor(gi), fi = gi - i0, o = j0 * ln + i0;
      const a = lat[o], b = lat[o + 1], c = lat[o + ln], d = lat[o + ln + 1];
      out[j * nx + i] = (a + (b - a) * fi) + ((c + (d - c) * fi) - (a + (b - a) * fi)) * fj;
    }
  }
  // pads: flat knolls (a lighthouse stands on one), blended into the land round them
  for (const p of def.pads || []) {
    const i0 = Math.max(0, Math.floor((p.x - p.r * 3 - rect[0]) / dx)), i1 = Math.min(nx - 1, Math.ceil((p.x + p.r * 3 - rect[0]) / dx));
    const j0 = Math.max(0, Math.floor((p.z - p.r * 3 - rect[1]) / dz)), j1 = Math.min(nz - 1, Math.ceil((p.z + p.r * 3 - rect[1]) / dz));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const d = Math.hypot(rect[0] + (i + 0.5) * dx - p.x, rect[1] + (j + 0.5) * dz - p.z);
      const w = 1 - smooth(p.r, p.r * 2.6, d);
      if (w > 0) out[j * nx + i] = lerp(out[j * nx + i], p.h, w);
    }
  }
  return out;
}

export class LandField {
  constructor(courseId) {
    const def = COASTS[courseId];
    this.id = courseId;
    this.def = def;
    const t0 = performance.now();
    const shapes = def.shapes.map(makeShape);
    // near field: the racing area and a margin, NEAR_TEXEL metres per texel
    const r = def.rect;
    const texel = def.texel || NEAR_TEXEL;
    this.nx = Math.round((r[2] - r[0]) / texel); this.nz = Math.round((r[3] - r[1]) / texel);
    this.x0 = r[0]; this.z0 = r[1]; this.dx = (r[2] - r[0]) / this.nx; this.dz = (r[3] - r[1]) / this.nz;
    this.x1 = r[2]; this.z1 = r[3];
    this.near = bakeRect(def, shapes, r, this.nx, this.nz, 2, 0);
    // far field: 40 km round the centre of the near one, 64 m per texel; land fades to the sea at its edge
    const cx = (r[0] + r[2]) / 2, cz = (r[1] + r[3]) / 2, H = FAR_SIZE / 2;
    this.fx0 = cx - H; this.fz0 = cz - H; this.fn = FAR_N; this.fd = FAR_SIZE / FAR_N;
    this.far = bakeRect(def, shapes, [cx - H, cz - H, cx + H, cz + H], FAR_N, FAR_N, 2, FAR_SIZE);
    this.bakeMs = performance.now() - t0;
    this._s = { h: 0, gx: 0, gz: 0 };
  }

  // bilinear read of a field, as the texture unit does it: texel centres at (i + 0.5); clamped at the edge
  static read(arr, nx, nz, u, v) {
    u -= 0.5; v -= 0.5;
    let i = Math.floor(u), j = Math.floor(v);
    const fu = u - i, fv = v - j;
    const i1 = i + 1 > nx - 1 ? nx - 1 : i + 1, j1 = j + 1 > nz - 1 ? nz - 1 : j + 1;
    if (i < 0) i = 0; if (j < 0) j = 0;
    const a = arr[j * nx + i], b = arr[j * nx + i1], c = arr[j1 * nx + i], d = arr[j1 * nx + i1];
    return (a + (b - a) * fu) + ((c + (d - c) * fu) - (a + (b - a) * fu)) * fv;
  }

  // height of the ground at (x, z), metres: negative under water
  heightAt(x, z) {
    const u = (x - this.x0) / this.dx, v = (z - this.z0) / this.dz;
    if (u > 0 && v > 0 && u < this.nx && v < this.nz) return LandField.read(this.near, this.nx, this.nz, u, v);
    return LandField.read(this.far, this.fn, this.fn, (x - this.fx0) / this.fd, (z - this.fz0) / this.fd);
  }
  depthAt(x, z) { return -this.heightAt(x, z); }

  // height and slope (dh/dx, dh/dz) in one go, from the texel cell the point lies in (the slope is that cell's
  // bilinear gradient, so it is continuous enough to push a hull along)
  sample(x, z, out = this._s) {
    let arr = this.near, nx = this.nx, nz = this.nz, u = (x - this.x0) / this.dx, v = (z - this.z0) / this.dz, dx = this.dx, dz = this.dz;
    if (!(u > 0 && v > 0 && u < nx && v < nz)) { arr = this.far; nx = nz = this.fn; u = (x - this.fx0) / this.fd; v = (z - this.fz0) / this.fd; dx = dz = this.fd; }
    u -= 0.5; v -= 0.5;
    let i = Math.floor(u), j = Math.floor(v);
    const fu = u - i, fv = v - j;
    const i1 = i + 1 > nx - 1 ? nx - 1 : i + 1, j1 = j + 1 > nz - 1 ? nz - 1 : j + 1;
    if (i < 0) i = 0; if (j < 0) j = 0;
    const a = arr[j * nx + i], b = arr[j * nx + i1], c = arr[j1 * nx + i], d = arr[j1 * nx + i1];
    const top = a + (b - a) * fu, bot = c + (d - c) * fu;
    out.h = top + (bot - top) * fv;
    out.gx = ((b - a) * (1 - fv) + (d - c) * fv) / dx;
    out.gz = (bot - top) / dz;
    return out;
  }
}

// how far a wave gets into shallow water: waves die as the bottom comes up, so the surface never pokes
// through a beach. Shared with the sea shader (water.js).
export const WAVE_ATT = [0.15, 5.0];
export function waveAtt(depth) { return smooth(WAVE_ATT[0], WAVE_ATT[1], depth); }

const cache = new Map();
export function landFor(courseId) {
  let f = cache.get(courseId);
  if (!f) { f = new LandField(courseId); cache.set(courseId, f); }
  return f;
}
