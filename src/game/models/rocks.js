// Rock that is not height field: the boulders and skerries of a `rocks` feature, the shell of a sea stack
// round its terrain pillar, and the loose blocks and outcrops that break up a cliff and its foot. All of it is
// ground: it is drawn by the terrain shader (land.js, GROUND.ROCK), so its beds, joints, weed line, barnacles
// and lichen are the cliff's own and run on through it in world space; the meshes carry shape and a tint only
// (white guano on the crowns of sea rocks, green on a stack's cap).
//
// Shapes. A lump is a dome over a flared foot, lobed, noised, cut by a few random planes into faces and
// shaded half-faceted; the styles differ in height, how hard they are cut and how they taper (round boulder,
// low skerry awash, tall fin, angular block). A stack is a column of ledged beds, undercut at the waterline,
// leaning a little, and always wider than the terrain pillar inside it (it is measured from the height field).
//
// Triangles: a lump 560 / 176 / 70 at the three levels; a stack 6.7k / 1.7k / 0.4k.
import { Geo, sheet, stamp, frame, rng, vn, fb, TAU, lerp, smooth, clamp, paint, hash1 } from './kit.js';
import { GROUND } from './cover.js';

// (the second entry: how much finer than a cliff's the rock's beds and joints are drawn; the terrain shader reads it)
const ROCK = [GROUND.ROCK, 1, 0, 0], SMALL = [GROUND.ROCK, 3, 0, 0];
export const STYLES = {
  boulder: { top: [0.7, 1.15], cuts: 8, cut: [0.5, 0.82], pw: 2.6, sq: 0.6, dip: 0.12 },
  skerry: { top: [0.3, 0.55], cuts: 6, cut: [0.55, 0.9], pw: 3.2, sq: 0.75, dip: 0.3 },
  fin: { top: [1.3, 1.9], cuts: 8, cut: [0.45, 0.8], pw: 1.8, sq: 0.5, dip: 0.2 },
  block: { top: [0.6, 1.0], cuts: 11, cut: [0.45, 0.72], pw: 4.0, sq: 0.8, dip: 0.1 },
};
const ROWS = [14, 8, 5], COLS = [20, 11, 7];

// One lump, about one unit in radius at y = 0 (the waterline of a sea rock, the ground line of a land one), its
// foot going 1.6 below. tint: 'sea' whitens the crown with guano; 'land' leaves it bare.
export function rockProto(seed, lod = 0, style = 'boulder', tint = 'sea') {
  const S = STYLES[style], R = rng(seed * 7919 + 11), g = new Geo(lod ? 1024 : 4096);
  const rows = ROWS[lod], cols = COLS[lod];
  const top = lerp(S.top[0], S.top[1], R());
  const cuts = [];
  for (let k = 0; k < S.cuts; k++) {
    const a = R() * TAU, y = R() * 1.1 - 0.15, s = Math.sqrt(Math.max(1 - y * y, 0.05));
    cuts.push([Math.cos(a) * s, y, Math.sin(a) * s, lerp(S.cut[0], S.cut[1], R())]);
  }
  const l0 = R() * TAU, ln = 2 + Math.floor(R() * 3), la = 0.08 + 0.14 * R(), ell = style === 'fin' ? 0.45 + 0.2 * R() : 0.75 + 0.25 * R(), ea = R() * TAU;
  const lean = (R() - 0.5) * (style === 'fin' ? 0.5 : 0.25), la2 = R() * TAU;
  const ce = Math.cos(ea), se = Math.sin(ea);
  // ledges (the lump is stepped where its beds end) and one cleft down a side
  const steps = 3 + Math.floor(R() * 3), stepK = 0.5 + 0.35 * R(), cleft = R() * TAU, cleftD = 0.2 + 0.25 * R();
  sheet(g, rows + 1, cols + 1, (i, j, out) => {
    const v = i / rows, th = ((j % cols) / cols) * TAU, c = Math.cos(th), s = Math.sin(th);
    let y, rad;
    if (v < 0.28) { const t = v / 0.28; y = lerp(-1.6, 0, t); rad = lerp(1.32, 1.0, t * t); }
    else {
      let t = (v - 0.28) / 0.72;
      rad = Math.pow(Math.max(1 - Math.pow(t, S.pw), 0), S.sq);
      // (the radius follows the smooth profile, the height is held on each ledge and then rises: treads and risers)
      t = lerp(t, Math.round(t * steps) / steps, stepK);
      y = Math.pow(t, 0.85);
      const da = Math.abs(((th - cleft + Math.PI * 3) % TAU) - Math.PI);
      rad *= 1 - cleftD * smooth(0.3, 0, da) * smooth(0, 0.15, t);
    }
    let r = rad * (1 + la * Math.cos(th * ln + l0)) * (0.72 + 0.56 * fb(c * 1.4 + seed * 3.1, y * 1.7, s * 1.4)) * (0.92 + 0.16 * vn(c * 4.1 + seed, y * 4.1, s * 4.1));
    // unit-space point; the planes cut it into faces
    let x = c * r, z = s * r, yy = y;
    if (y > 0) for (const q of cuts) { const e = x * q[0] + yy * q[1] + z * q[2] - q[3]; if (e > 0) { x -= q[0] * e; yy -= q[1] * e * 0.7; z -= q[2] * e; } }
    // the beds dip: the whole lump is sheared along its long axis, so its top is a tilted slab
    if (y > 0) yy = Math.max(yy + S.dip * (x * ce + z * se) * Math.min(yy * 3, 1), 0.02);
    // squeeze across one axis, lean
    const xa = x * ce + z * se, za = (-x * se + z * ce) * ell;
    x = xa * ce - za * se; z = xa * se + za * ce;
    const h = Math.max(yy, 0) * top;
    out[0] = x + Math.cos(la2) * lean * h; out[1] = yy > 0 ? h : yy; out[2] = z + Math.sin(la2) * lean * h;
  }, [1, 1, 1], SMALL, { wrap: true, flat: 0.8 });
  // tone from face to face and patch to patch; birds whiten the crowns of rocks that stand in the sea
  paint(g, 0, (P, N, C, i) => {
    let k = 0.8 + 0.4 * fb(P[i] * 2.3 + seed, P[i + 1] * 2.3, P[i + 2] * 2.3);
    let w = 0;
    if (tint === 'sea') w = smooth(0.55, 0.85, N[i + 1]) * smooth(0.5 * top, 0.85 * top, P[i + 1]) * smooth(0.5, 0.68, vn(P[i] * 3.1 + seed, P[i + 1] * 2, P[i + 2] * 3.1));
    k *= 1 + 1.1 * w;
    C[i] = k; C[i + 1] = k; C[i + 2] = k * (1 - 0.04 * w);
  });
  g.top = top;
  return g;
}

// a set of prototypes at one level of detail: n of a style
export function rockSet(style, n, lod, tint, seed0 = 1) {
  const out = [];
  for (let k = 0; k < n; k++) out.push(rockProto(seed0 + k * 17 + style.length * 3, lod, style, tint));
  return out;
}

// The boulders of a `rocks` feature, about (0, 0, 0) = (f.x, 0, f.z): one lump per spot, its waterline radius the
// spot's r (the collider), and a few small ones awash at its foot. spots: rockSpots(f).
export function rockFieldGeo(f, spots, lod = 0) {
  const g = new Geo(lod ? 4096 : 16384), R = rng(Math.round(f.x * 13 + f.z * 7) + 5);
  const sets = { boulder: rockSet('boulder', 3, lod, 'sea', 21), skerry: rockSet('skerry', 2, lod, 'sea', 41), fin: rockSet('fin', 2, lod, 'sea', 61) };
  spots.forEach((s, i) => {
    const q = R(), style = q < 0.5 ? 'boulder' : q < 0.8 ? 'skerry' : 'fin', P = sets[style][Math.floor(R() * sets[style].length)];
    // (a prototype is 0.85 to 1.15 across at the waterline: a little under the collider is right)
    const hk = style === 'skerry' ? 1.1 : 0.85 + 0.5 * R();
    stamp(g, P, frame([s.x - f.x, 0, s.z - f.z], R() * TAU, 0, 0, 1), null, [s.r * 0.98, s.r * hk, s.r * 0.98]);
    if (lod < 2) {
      const n = 1 + Math.floor(R() * 3);
      for (let k = 0; k < n; k++) {
        const a = R() * TAU, d = s.r * (0.95 + 0.3 * R()), rr = 0.35 + 0.5 * R();
        stamp(g, sets.boulder[k % 3], frame([s.x - f.x + Math.cos(a) * d, -0.15 * R(), s.z - f.z + Math.sin(a) * d], R() * TAU, 0, 0, 1), null, [rr, rr * (0.5 + 0.5 * R()), rr]);
      }
    }
  });
  return g;
}

// A sea stack round (0, 0, 0) = (f.x, 0, f.z). terrainR(theta, y): how far out the terrain pillar reaches at
// that bearing and height (0 if it does not): the shell always stands outside it. Its waterline radius is 0.9
// of the feature's r (the collider), with fallen blocks out to r.
export function stackGeo(f, terrainR, lod = 0) {
  const g = new Geo(lod ? 8192 : 32768), seed = Math.round(f.x * 3 + f.z * 5), R = rng(seed + 9);
  const rows = [56, 28, 12][lod], cols = [60, 30, 16][lod], H = f.h, r0 = f.r * 0.9;
  const lobes = [[R() * TAU, 3, 0.13], [R() * TAU, 5, 0.07], [R() * TAU, 2, 0.12]];
  const leanA = R() * TAU, lean = 0.05 + 0.06 * R();
  // clefts: a few chimneys cut down the column
  const clefts = [0, 1, 2, 3].map(() => [R() * TAU, 0.1 + 0.12 * R(), 0.14 + 0.16 * R(), R()]);
  // beds: ledges where one bed steps back from the next
  const beds = []; { let y = 0.9 + R(); while (y < H) { beds.push([y, 0.2 + 0.55 * R()]); y += 1.4 + 3.2 * R(); } }
  // a shoulder: above it the column narrows to a pinnacle on one side
  const shY = H * (0.55 + 0.2 * R()), shA = R() * TAU, shK = 0.25 + 0.2 * R();
  const y0 = -4.5;
  sheet(g, rows + 1, cols + 1, (i, j, out) => {
    const v = i / rows, th = ((j % cols) / cols) * TAU, c = Math.cos(th), s = Math.sin(th);
    // rows crowd toward the top, where the shape turns over
    const y = v < 0.12 ? lerp(y0, 0, v / 0.12) : H * (1 - Math.pow(1 - (v - 0.12) / 0.88, 1.25));
    const t = clamp(y / H, 0, 1);
    // the column: flared under water, undercut where the sea works at it, tapering to a blunt crown
    let rad = y < 0 ? lerp(1.0, 1.3, y / y0) : 1 - 0.12 * smooth(0, 0.1, t) * (1 - smooth(0.1, 0.28, t)) - 0.36 * Math.pow(t, 1.4);
    rad *= Math.pow(Math.max(1 - Math.pow(t, 10), 0), 0.5);
    let k = 1;
    for (const l of lobes) k += l[2] * Math.cos(th * l[1] + l[0] + t * 1.6) * (0.6 + 0.9 * t);
    k *= 0.88 + 0.24 * fb(c * 1.6 + seed, y * 0.22, s * 1.6) + 0.12 * (vn(c * 5.3, y * 0.9 + seed, s * 5.3) - 0.5);
    for (const q of clefts) { let da = Math.abs(((th - q[0] - 0.25 * Math.sin(y * 0.3 + q[3] * 9) + Math.PI * 3) % TAU) - Math.PI); k *= 1 - q[2] * smooth(q[1], 0, da) * smooth(0.02, 0.2, t) * (0.6 + 0.4 * q[3]); }
    if (y > shY) k *= 1 - shK * smooth(shY, shY + 1.2, y) * (0.5 + 0.5 * Math.cos(th - shA));
    // ledges: each bed stands proud at its top and steps in above
    let step = 0;
    for (let b = 0; b < beds.length; b++) if (y < beds[b][0]) { const lo = b ? beds[b - 1][0] : 0; step = -beds[b][1] * (1 - Math.pow(clamp((y - lo) / (beds[b][0] - lo), 0, 1), 1.5)); break; }
    let rr = Math.max(r0 * rad * k + step * (1 - Math.pow(t, 6)), 0);
    if (y > -0.5 && t < 0.995) rr = Math.max(rr, terrainR(th, y) + 0.7);
    if (i === rows) rr = 0;
    out[0] = c * rr + Math.cos(leanA) * lean * Math.max(y, 0); out[1] = y; out[2] = s * rr + Math.sin(leanA) * lean * Math.max(y, 0);
  }, [1, 1, 1], ROCK, { wrap: true, flat: 0.45 });
  // tone; guano under the ledges where birds sit; turf on the cap
  paint(g, 0, (P, N, C, i) => {
    const y = P[i + 1], t = y / H;
    let k = 0.82 + 0.36 * fb(P[i] * 0.9 + seed, y * 0.9, P[i + 2] * 0.9);
    let cr = k, cg = k, cb = k;
    const white = smooth(0.3, 0.75, N[i + 1]) * smooth(0.25, 0.5, t) * smooth(0.42, 0.62, vn(P[i] * 1.7 + seed, y * 0.8, P[i + 2] * 1.7)) * (1 - smooth(0.9, 0.97, t));
    cr *= 1 + 1.6 * white; cg *= 1 + 1.6 * white; cb *= 1 + 1.5 * white;
    const turf = smooth(0.55, 0.85, N[i + 1]) * smooth(0.9, 0.97, t);
    cr = lerp(cr, 0.4 * k, turf); cg = lerp(cg, 0.72 * k, turf); cb = lerp(cb, 0.22 * k, turf);
    C[i] = cr; C[i + 1] = cg; C[i + 2] = cb;
  });
  // fallen blocks round the foot, awash
  if (lod < 2) {
    const blocks = rockSet('block', 3, Math.max(lod, 1), 'sea', 81);
    const n = lod ? 5 : 9;
    for (let k = 0; k < n; k++) {
      const a = R() * TAU, d = f.r * (0.86 + 0.14 * R()), rr = 0.8 + 1.5 * R();
      stamp(g, blocks[k % 3], frame([Math.cos(a) * d, -0.3 * R(), Math.sin(a) * d], R() * TAU, 0, 0, 1), null, [rr, rr * (0.6 + 0.6 * R()), rr]);
    }
  }
  return g;
}

// ---- loose rock on the land: blocks under cliffs, outcrops on their faces, boulders along a rocky shore ----
// Where they go is a pure function of the height field. Steep ground is sampled on a jittered grid: a face
// (very steep) gets outcrops standing out of it, the ground at its foot and a rocky shore get blocks.
// Returns [{ x, y, z, s, sy, yaw, kind, id }], kept to within `reach` of the course's line (segs: [x0, z0, x1, z1]...).
export function placeRocks(field, segs, reach = 420, step = 7) {
  const out = [], sm = { h: 0, gx: 0, gz: 0 };
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const s of segs) { x0 = Math.min(x0, s[0], s[2]); x1 = Math.max(x1, s[0], s[2]); z0 = Math.min(z0, s[1], s[3]); z1 = Math.max(z1, s[1], s[3]); }
  x0 = Math.max(x0 - reach, field.x0 + 8); x1 = Math.min(x1 + reach, field.x1 - 8); z0 = Math.max(z0 - reach, field.z0 + 8); z1 = Math.min(z1 + reach, field.z1 - 8);
  const near = (x, z) => {
    for (const s of segs) {
      const dx = s[2] - s[0], dz = s[3] - s[1];
      let t = ((x - s[0]) * dx + (z - s[1]) * dz) / (dx * dx + dz * dz || 1); t = t < 0 ? 0 : t > 1 ? 1 : t;
      if (Math.hypot(s[0] + dx * t - x, s[1] + dz * t - z) < reach) return true;
    }
    return false;
  };
  const i0 = Math.floor(x0 / step), i1 = Math.ceil(x1 / step), j0 = Math.floor(z0 / step), j1 = Math.ceil(z1 / step);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const x = (i + hash1(i * 3 + 1, j * 5 + 2)) * step, z = (j + hash1(i * 7 + 3, j * 11 + 4)) * step;
    field.sample(x, z, sm);
    const h = sm.h;
    if (h < -0.3 || h > 150) continue;
    const g = Math.hypot(sm.gx, sm.gz), q = hash1(i * 13 + 5, j * 17 + 6);
    // the slope of the ground a few metres up the hill: is this the foot of something steep?
    let foot = 0;
    if (g > 0.05) { const ux = sm.gx / g, uz = sm.gz / g; const a = field.heightAt(x + ux * 8, z + uz * 8) - h; foot = a / 8; }
    let kind = null, p = 0;
    if (h < 3.5 && (g > 0.45 || foot > 0.6)) { kind = 'foot'; p = 0.85; }
    else if (g > 0.75) { kind = 'outcrop'; p = 0.7; }
    else if (g > 0.28 && foot > 0.7) { kind = 'scree'; p = 0.35; }
    else if (h < 2.2 && g > 0.22) { kind = 'shore'; p = 0.4; }
    if (!kind || q > p) continue;
    if (!near(x, z)) continue;
    const r2 = hash1(i * 19 + 7, j * 23 + 8), r3 = hash1(i * 29 + 9, j * 31 + 10);
    const s = kind === 'outcrop' ? 1.8 + 3.6 * r2 * r2 : kind === 'foot' ? 0.8 + 2.4 * r2 * r2 : 0.5 + 1.3 * r2 * r2;
    out.push({ x, y: h - s * (kind === 'outcrop' ? 0.45 : 0.25), z, s, sy: kind === 'outcrop' ? 0.9 + 1.2 * r3 : 0.6 + 0.6 * r3, yaw: r3 * 39.1, kind, id: Math.floor(r2 * 997) });
  }
  return out;
}

// the loose rocks of one cell as one mesh about `origin`, from shared prototypes (sets: { block: [...], boulder: [...] } at this level)
export function looseRockGeo(list, origin, sets) {
  const g = new Geo(Math.max(1024, list.length * 200));
  for (const r of list) {
    const set = r.kind === 'shore' ? sets.boulder : sets.block, P = set[r.id % set.length];
    const sq = r.kind === 'outcrop' ? [r.s * 0.8, r.s * r.sy, r.s] : [r.s, r.s * r.sy, r.s * 0.85];
    stamp(g, P, frame([r.x - origin[0], r.y - origin[1], r.z - origin[2]], r.yaw, 0, 0, 1), null, sq);
  }
  return g;
}
