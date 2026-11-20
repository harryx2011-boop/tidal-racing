// Rock that is not height field: the boulders and skerries of a `rocks` feature, the shell of a sea stack
// round its terrain pillar, and the loose blocks and outcrops that break up a cliff and its foot. All of it is
// ground: it is drawn by the terrain shader (land.js, GROUND.ROCK), so its beds, joints, weed line, barnacles
// and lichen are the cliff's own and run on through it in world space; the meshes carry shape and a tint only
// (white guano on the crowns of sea rocks, green on a stack's cap).
//
// Shapes. A lump is a dome over a flared foot, lobed, noised, cut by a few random planes into faces and
// shaded half-faceted; the styles differ in height, how hard they are cut and how they taper (round boulder,
// low skerry awash, tall fin, angular block). A stack is a sheer pillar of flat-lying beds on a rubble foot
// (see stackGeo), always wider than the terrain pillar inside it (it is measured from the height field).
//
// Triangles: a lump 940 / 216 / 70 at the three levels; a stack 7-9k / 3k / 0.3k.
import { Geo, sheet, stamp, frame, rng, vn, fb, TAU, lerp, smooth, clamp, paint, hash1 } from './kit.js';
import { GROUND } from './cover.js';

// (the second entry: how much finer than a cliff's the rock's beds and joints are drawn; the terrain shader reads it)
const ROCK = [GROUND.ROCK, 1, 0, 0], SMALL = [GROUND.ROCK, 2.2, 0, 0];
// (turf on a ledge is a tint of the rock under it: this much of the rock's tone makes the terrain's own grass)
const TURF = [0.3, 0.44, 0.15];
// top: the height of the dome the lump is cut from; cuts, cut: how many joints part it and how deep; pw, sq: the
// dome's profile; dip: how steeply its beds lie (radians); slab: where the bedding plane that is its top cuts it
export const STYLES = {
  boulder: { top: [0.8, 1.2], cuts: 6, cut: [0.5, 0.85], pw: 2.6, sq: 0.6, dip: [0.12, 0.5], slab: [0.5, 0.8] },
  skerry: { top: [0.5, 0.75], cuts: 5, cut: [0.55, 0.9], pw: 3.2, sq: 0.75, dip: [0.15, 0.4], slab: [0.22, 0.42] },
  fin: { top: [1.4, 2.0], cuts: 5, cut: [0.5, 0.85], pw: 1.8, sq: 0.5, dip: [0.95, 1.25], slab: [0.25, 0.45] },
  block: { top: [0.7, 1.0], cuts: 9, cut: [0.45, 0.72], pw: 4.0, sq: 0.8, dip: [0.0, 0.2], slab: [0.5, 0.75] },
};
const ROWS = [18, 9, 5], COLS = [26, 12, 7];

// One lump, about one unit in radius at y = 0 (the waterline of a sea rock, the ground line of a land one), its
// foot going 1.6 below. tint: 'sea' whitens the crown with guano; 'land' leaves it bare.
// It is a piece of bedded rock: a dome cut off along one bedding plane, which is its top (a slab dipping one
// way), with the ends of the beds below it stepping down the other sides, each bed standing out or back by its
// own measure, and parted by a few joints square to the bedding. Steep beds make a fin, level ones a block.
export function rockProto(seed, lod = 0, style = 'boulder', tint = 'sea') {
  const S = STYLES[style], R = rng(seed * 7919 + 11), g = new Geo(lod ? 1024 : 4096);
  const rows = ROWS[lod], cols = COLS[lod];
  const top = lerp(S.top[0], S.top[1], R());
  const l0 = R() * TAU, ln = 2 + Math.floor(R() * 3), la = 0.08 + 0.14 * R(), ell = style === 'fin' ? 0.5 + 0.2 * R() : 0.75 + 0.25 * R(), ea = R() * TAU;
  const lean = (R() - 0.5) * (style === 'fin' ? 0.4 : 0.2), la2 = R() * TAU;
  const ce = Math.cos(ea), se = Math.sin(ea);
  // the bedding: its normal leans along the lump's long axis; the plane that is the top; the beds' thickness
  const dip = lerp(S.dip[0], S.dip[1], R()), nb = [Math.sin(dip) * ce, Math.cos(dip), Math.sin(dip) * se], slab = lerp(S.slab[0], S.slab[1], R()) * top;
  const tb = 0.13 + 0.12 * R(), bph = R(), boff = (b) => -hash1(b * 5 + 1, seed * 3 + 2) * 0.17;
  // joints: planes near enough square to the bedding, each cutting a face off one side
  const cuts = [];
  for (let k = 0; k < S.cuts; k++) {
    const a = R() * TAU, t = (R() - 0.5) * 0.5;
    let n = [Math.cos(a), t, Math.sin(a)];
    const d = n[0] * nb[0] + n[1] * nb[1] + n[2] * nb[2];
    n = [n[0] - nb[0] * d * 0.8, n[1] - nb[1] * d * 0.8, n[2] - nb[2] * d * 0.8];
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    cuts.push([n[0] / l, n[1] / l, n[2] / l, lerp(S.cut[0], S.cut[1], R())]);
  }
  const cleft = R() * TAU, cleftD = 0.2 + 0.25 * R();
  sheet(g, rows + 1, cols + 1, (i, j, out) => {
    const v = i / rows, th = ((j % cols) / cols) * TAU, c = Math.cos(th), s = Math.sin(th);
    let y, rad;
    if (v < 0.28) { const t = v / 0.28; y = lerp(-1.6, 0, t); rad = lerp(1.32, 1.0, t * t); }
    else {
      const t = (v - 0.28) / 0.72;
      rad = Math.pow(Math.max(1 - Math.pow(t, S.pw), 0), S.sq);
      y = Math.pow(t, 0.85) * top;
      const da = Math.abs(((th - cleft + Math.PI * 3) % TAU) - Math.PI);
      rad *= 1 - cleftD * smooth(0.3, 0, da) * smooth(0, 0.15, t);
    }
    const r = rad * (1 + la * Math.cos(th * ln + l0)) * (0.72 + 0.56 * fb(c * 1.4 + seed * 3.1, y * 1.7, s * 1.4)) * (0.92 + 0.16 * vn(c * 4.1 + seed, y * 4.1, s * 4.1));
    let x = c * r, z = s * r, yy = y;
    if (y > 0) {
      const rise = smooth(0, 0.25, y);
      // the top: everything above the bedding plane is gone (a parting, not a saw cut: a little stays proud)
      let e = x * nb[0] + yy * nb[1] + z * nb[2] - slab;
      if (e > 0) yy -= 0.93 * e / nb[1];      // (straight down onto it: nothing overhangs the foot)
      else {
        // the sides: the ends of the beds under it, each out or back from the last
        const sb = (x * nb[0] + yy * nb[1] + z * nb[2]) / tb + bph, b = Math.floor(sb), f = sb - b;
        const k = 1 + lerp(boff(b), boff(b + 1), smooth(0.8, 1, f)) * rise;
        x *= k; z *= k;
      }
      // the joints (they too keep a tenth of what stood proud, so no two faces meet in a ruled line)
      for (const q of cuts) { const d = x * q[0] + yy * q[1] + z * q[2] - q[3]; if (d > 0) { const k = 0.9 * d * rise; x -= q[0] * k; yy -= Math.max(q[1], 0) * k; z -= q[2] * k; } }
      const d = 1 + (0.09 * (fb(x * 3.3 + seed * 1.3, yy * 3.3, z * 3.3) - 0.5) + 0.05 * (vn(x * 9.1, yy * 9.1 + seed, z * 9.1) - 0.5)) * rise;
      // (down the dip the top runs on under the water: a ledge awash, not a rim at the waterline)
      x *= d; z *= d; yy = Math.max(yy, -0.35);
    }
    // squeeze across one axis, lean
    const xa = x * ce + z * se, za = (-x * se + z * ce) * ell;
    x = xa * ce - za * se; z = xa * se + za * ce;
    const h = Math.max(yy, 0);
    out[0] = x + Math.cos(la2) * lean * h; out[1] = yy; out[2] = z + Math.sin(la2) * lean * h;
  }, [1, 1, 1], SMALL, { wrap: true, flat: 0.65 });
  // tone from face to face and patch to patch; birds whiten the crowns of rocks that stand in the sea
  let hi = 0.1; for (let i = 1; i < g.nv * 3; i += 3) if (g.P[i] > hi) hi = g.P[i];
  paint(g, 0, (P, N, C, i) => {
    let k = 0.8 + 0.4 * fb(P[i] * 2.3 + seed, P[i + 1] * 2.3, P[i + 2] * 2.3);
    let w = 0;
    if (tint === 'sea') w = smooth(0.55, 0.85, N[i + 1]) * smooth(0.55 * hi, 0.9 * hi, P[i + 1]) * smooth(0.5, 0.68, vn(P[i] * 3.1 + seed, P[i + 1] * 2, P[i + 2] * 3.1));
    k *= 1 + 0.8 * w;
    C[i] = k; C[i + 1] = k; C[i + 2] = k * (1 - 0.04 * w);
  });
  g.top = hi;
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

// A sea stack round (0, 0, 0) = (f.x, 0, f.z): a pillar of flat-lying beds, as the sea leaves one when it has
// cut the headland away behind it. Its plan is a rough polygon (the joints it parted along), its sides sheer;
// each bed is its own course, standing proud of the next or weathered back under it, so the profile steps in
// and out in ledges and overhangs; joints run down it as grooves, and blocks have fallen out of the courses
// here and there. The top beds break back one by one to a small flat cap of turf, off to one side. At the foot
// a ramp of rubble and wave-cut rock comes up out of the water to the wall.
// terrainR(theta, y): how far out the terrain pillar reaches at that bearing and height (0 if it does not): the
// shell always stands outside it. Its waterline radius is about 0.9 of the feature's r (the collider), with
// fallen blocks out to r. The feature's h is the height of its shoulder; the cap stands a fifth higher.
export function stackGeo(f, terrainR, lod = 0) {
  const g = new Geo(lod ? 8192 : 32768), seed = Math.round(f.x * 3 + f.z * 5), R = rng(seed + 9);
  const cols = [72, 36, 16][lod], H = f.h * 1.2, rw = f.r * 0.9, rc = f.r * (0.6 + 0.06 * R());
  // the plan: a polygon of five to seven sides, its corners eased, longer one way than the other
  const sides = 4 + Math.floor(R() * 3), a0 = R() * TAU, ea = R() * TAU, ell = 0.14 + 0.14 * R();
  const plan = (th) => {
    const w = TAU / sides, q = (((th - a0) % w) + w) % w - w / 2;
    return lerp(1, Math.cos(w / 2) / Math.cos(q), 0.85) * (1 + ell * Math.cos(2 * (th - ea)));
  };
  // through-going joints: grooves down the whole column, wandering a little
  const joints = []; for (let k = 0, n = 5 + Math.floor(R() * 3); k < n; k++) joints.push([(k + 0.2 + 0.6 * R()) / n * TAU, 0.06 + 0.07 * R(), 0.45 + 0.8 * R(), R() * 9]);
  // the beds: 1 to 3 m thick; each stands out or back by its own measure, breaks into blocks of its own length
  const beds = []; { let y = 1.9 + 0.5 * R(), k = 0; while (y < H - 0.8) { const th = Math.min((k % 3 === 2 ? 0.7 : 1.3) + 2.0 * R() * R(), H - y); beds.push({ y0: y, y1: y + th, off: R() < 0.22 ? -0.5 - 0.4 * R() : (k & 1 ? -1 : 1) * (0.08 + 0.3 * R()), blk: 0.25 + 0.45 * R(), ph: R() * TAU, id: k }); y += th; k++; } }
  beds[beds.length - 1].y1 = H;
  // the crown: above yc each bed is smaller than the one below and sits toward one side
  const yc = H * (0.66 + 0.1 * R()), ca = R() * TAU, nb = beds.length;
  let kc = 1, cx = 0, cz = 0;
  for (const b of beds) {
    // (the column wanders as it rises: no bed sits square on the one below)
    cx += (R() - 0.5) * 0.7; cz += (R() - 0.5) * 0.7;
    if (b.y0 >= yc) { b.off = Math.min(b.off, 0) * 0.3; const k2 = kc * (0.62 + 0.22 * R()), sh = (kc - k2) * rc * (0.55 + 0.35 * R()), da = ca + (R() - 0.5) * 1.6; cx += Math.cos(da) * sh; cz += Math.sin(da) * sh; kc = k2; }
    b.k = kc; b.cx = cx; b.cz = cz;
  }
  const leanA = R() * TAU, lean = 0.03 + 0.04 * R();
  // the rows: the foot under water, the ramp, then each bed from its bottom edge to its top one
  const rows = [];
  for (const y of lod === 2 ? [-4.5, 0, 1.9] : [-4.5, -2, -0.6, 0, 0.3, 0.65, 1.0, 1.3, 1.6, 1.9]) rows.push([y, null]);
  for (const b of beds) {
    const th = b.y1 - b.y0, n = lod === 0 ? Math.max(1, Math.round(th / 0.9)) : lod === 1 ? 1 : 0;
    if (lod === 2) { if (b.id % 2 === 0 || b.id === nb - 1) rows.push([(b.y0 + b.y1) / 2, b]); continue; }
    for (let k = 0; k <= n; k++) rows.push([lerp(b.y0 + 0.02, b.y1 - 0.02, k / n), b]);
  }
  const top = beds[nb - 1];
  rows.push([H, top, 0.45], [H, top, 0]);
  const col = (b, th, y) => {
    const c = Math.cos(th), s = Math.sin(th);
    let r = rc * plan(th) * (1 - 0.16 * y / H) * (0.93 + 0.14 * fb(c * 1.3 + seed, y * 0.06, s * 1.3)) + b.off;
    // the bed's own wander, and the blocks gone from it
    r += 0.3 * (vn(c * 3.1 + b.id * 7.1, b.id * 1.7, s * 3.1) - 0.5);
    const cell = Math.floor((th + b.ph) / b.blk), gone = hash1(cell * 7 + 3, b.id * 13 + seed);
    if (gone < 0.26) r -= 0.3 + 3.2 * gone;
    for (const q of joints) { const da = Math.abs(((th - q[0] - 0.05 * Math.sin(y * 0.4 + q[3]) + Math.PI * 3) % TAU) - Math.PI); r -= q[2] * smooth(q[1], 0, da) * (0.6 + 0.4 * vn(q[3], y * 0.5, 1)); }
    return Math.max(r, 0.5) * b.k;
  };
  sheet(g, rows.length, cols + 1, (i, j, out) => {
    const [y, b, cap] = rows[i], th = ((j % cols) / cols) * TAU, c = Math.cos(th), s = Math.sin(th);
    let rr, ox = 0, oz = 0;
    let yy = y;
    if (!b) {
      // the foot: flared under water; above it rubble and wave-cut rock slope up to the wall, high on one side
      // of the stack and hardly there on another, and the wall stands on that
      const base = rw * (0.9 + 0.2 * fb(c * 1.7 + seed, 0.3, s * 1.7)) * (1 + 0.25 * ell * Math.cos(2 * (th - ea)));
      const wall = col(beds[0], th, 1.9) + 0.2, hr = 0.25 + 1.6 * smooth(0.3, 0.75, fb(c * 1.1 + seed * 0.7, 1.7, s * 1.1));
      if (y < 0) rr = base * lerp(1, 1.35, y / -4.5);
      else {
        const t = y / 1.9, u = Math.min(t / 0.7, 1);
        yy = t <= 0.7 ? hr * Math.pow(u, 1.3) : lerp(hr, 1.9, (t - 0.7) / 0.3);
        rr = lerp(base, wall, Math.pow(u, 0.7)) + 0.7 * (vn(c * 5.3 + seed, u * 2.3, s * 5.3) - 0.5) * u * (1 - u) * 4 * (hr / 1.85);
      }
    } else { rr = col(b, th, y) * (cap === undefined ? 1 : cap); ox = b.cx; oz = b.cz; }
    // (the pillar of the height field inside: a bed clears it by its widest, at the bed's foot, so the wall of a bed
    // stays a wall and the stack steps in over the pillar's cone instead of following it)
    if (yy > -0.5 && yy < H - 0.5) { const tr = terrainR(th, b ? b.y0 : yy); if (tr > 0) rr = Math.max(rr, tr + 0.7 + Math.hypot(ox, oz)); }
    const l = lean * Math.max(yy, 0);
    out[0] = c * rr + ox + Math.cos(leanA) * l; out[1] = yy; out[2] = s * rr + oz + Math.sin(leanA) * l;
  }, [1, 1, 1], ROCK, { wrap: true, flat: 0.93 });
  // tone; guano on the ledges where birds sit; turf on the cap and the ledges of the crown
  paint(g, 0, (P, N, C, i) => {
    const y = P[i + 1], t = y / H;
    const k = 0.84 + 0.32 * fb(P[i] * 0.9 + seed, y * 0.9, P[i + 2] * 0.9);
    let cr = k, cg = k, cb = k;
    const white = smooth(0.35, 0.8, N[i + 1]) * smooth(0.2, 0.4, t) * smooth(0.4, 0.6, vn(P[i] * 1.7 + seed, y * 0.8, P[i + 2] * 1.7)) * (1 - smooth(0.85, 0.95, t));
    cr *= 1 + 1.5 * white; cg *= 1 + 1.5 * white; cb *= 1 + 1.4 * white;
    const turf = smooth(0.6, 0.85, N[i + 1]) * Math.max(smooth(0.93, 0.99, t), smooth(yc / H - 0.05, yc / H + 0.1, t) * smooth(0.42, 0.6, vn(P[i] * 0.9 + seed, y * 0.4, P[i + 2] * 0.9)));
    cr = lerp(cr, TURF[0] * k, turf); cg = lerp(cg, TURF[1] * k, turf); cb = lerp(cb, TURF[2] * k, turf);
    C[i] = cr; C[i + 1] = cg; C[i + 2] = cb;
  });
  // fallen blocks round the foot, awash, the largest under the wall they came from
  if (lod < 2) {
    const blocks = rockSet('block', 3, Math.max(lod, 1), 'sea', 81);
    const n = lod ? 7 : 13;
    for (let k = 0; k < n; k++) {
      const a = R() * TAU, d = f.r * (0.62 + 0.36 * R()), rr = (0.7 + 1.5 * R()) * (1.3 - 0.5 * d / f.r);
      stamp(g, blocks[k % 3], frame([Math.cos(a) * d, -0.3 * R(), Math.sin(a) * d], R() * TAU, 0, 0, 1), null, [rr, rr * (0.6 + 0.6 * R()), rr]);
    }
  }
  return g;
}

// ---- cliffs: the steep faces of the height field, rebuilt as bedded rock ----
// The height field is a smooth sheet a few metres a texel: its cliffs are ramps, and a headland is a drum. Over
// every steep face near the course lies a skin of finer mesh that gives the face its build:
//   buttresses  the face stands forward in ribs some ten metres across with gullies between them, and in
//               lesser ribs on those, so the foot, the profile and the brow are all broken lines
//   beds        the great beds of the rock (3 to 8 m thick) each end in a sheer riser and a ledge: the profile
//               is a flight of steps, not a slope
//   blocks      joints running down the face part each bed into blocks, some standing out to the full ledge,
//               some weathered back, with a groove between; ledge and face are rough, and turf takes the ledges
// The skin never lies below the ground it covers (the cliff grows outward), sinks under it where the slope
// eases, never stands above the ground behind its brow, and stays out of the water (the hull's grounding is the
// height field's, so no rock may stand where the field says sea).
// The beds are the ones the terrain shader paints on such a mesh (land.js, rockLook, `bedded`): the same
// formula here and there, so a seam of colour runs along the foot of a real riser.
export const CLIFF_TILE = 96;
const CLIFF_CELL = [0.5, 1, 3];
const bedS = (x, y, z) => y * 0.55 + x * 0.07 - z * 0.04 + 1.1 * Math.sin(x * 0.031 + 1.3) * Math.sin(z * 0.027 + 0.4) + 0.45 * Math.sin(x * 0.093 + 2.1) * Math.sin(z * 0.081 + 1.7);
// the bed a point lies in (whole part) and how far up it (fraction); the beds' thickness there in metres
export const bedU = (x, y, z) => { const sA = bedS(x, y, z); return sA * 0.4 + 0.2 * Math.sin(sA * 0.9 + 1.0); };
export const bedT = (x, y, z) => 1 / (0.55 * (0.4 + 0.18 * Math.cos(bedS(x, y, z) * 0.9 + 1.0)));
const TREAD = 0.9, RISER = 0.12;     // a ledge lies this far up its bed; the riser takes this share of the bed's run

// the tiles of a course that hold steep ground within `reach` of the line: [{ x0, z0, y0, y1 }]
export function placeCliffs(field, segs, reach = 420) {
  const out = [], sm = { h: 0, gx: 0, gz: 0 }, T = CLIFF_TILE;
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const s of segs) { x0 = Math.min(x0, s[0], s[2]); x1 = Math.max(x1, s[0], s[2]); z0 = Math.min(z0, s[1], s[3]); z1 = Math.max(z1, s[1], s[3]); }
  x0 = Math.max(x0 - reach, field.x0 + 8); x1 = Math.min(x1 + reach, field.x1 - 8); z0 = Math.max(z0 - reach, field.z0 + 8); z1 = Math.min(z1 + reach, field.z1 - 8);
  const near = (x, z) => {
    for (const s of segs) {
      const dx = s[2] - s[0], dz = s[3] - s[1];
      let t = ((x - s[0]) * dx + (z - s[1]) * dz) / (dx * dx + dz * dz || 1); t = t < 0 ? 0 : t > 1 ? 1 : t;
      if (Math.hypot(s[0] + dx * t - x, s[1] + dz * t - z) < reach + T * 0.7) return true;
    }
    return false;
  };
  for (let j = Math.floor(z0 / T); j <= Math.floor(z1 / T); j++) for (let i = Math.floor(x0 / T); i <= Math.floor(x1 / T); i++) {
    if (!near((i + 0.5) * T, (j + 0.5) * T)) continue;
    let n = 0, lo = 1e9, hi = -1e9;
    for (let b = 0; b <= T; b += 3) for (let a = 0; a <= T; a += 3) {
      field.sample(i * T + a, j * T + b, sm);
      if (sm.h > -0.3 && sm.h < 180 && Math.hypot(sm.gx, sm.gz) > 0.62) { n++; if (sm.h < lo) lo = sm.h; if (sm.h > hi) hi = sm.h; }
    }
    if (n >= 3) out.push({ x0: i * T, z0: j * T, y0: lo - 3, y1: hi + 16 });
  }
  return out;
}

// one tile's skin about `origin`, at a level of detail (cells of 0.5, 1 or 3 m)
export function cliffGeo(field, t, origin, lod = 0) {
  const c = CLIFF_CELL[lod], n = Math.round(CLIFF_TILE / c), N1 = n + 1, sm = { h: 0, gx: 0, gz: 0 };
  const P = new Float32Array(N1 * N1 * 3), W = new Float32Array(N1 * N1), F = new Float32Array(N1 * N1);
  for (let j = 0; j < N1; j++) for (let i = 0; i < N1; i++) {
    let x = t.x0 + i * c, z = t.z0 + j * c;
    field.sample(x, z, sm);
    const h = sm.h, gr = Math.hypot(sm.gx, sm.gz), q = (j * N1 + i);
    // (the skin comes up through the ground over a narrow band of slope: where the two lie close they would fight for the pixel far off)
    const w = smooth(0.6, 0.8, gr) * smooth(-0.3, 0.25, h) * (1 - smooth(150, 180, h));
    let y = h - 0.6, turf = 0;
    if (w > 0) {
      const ux = sm.gx / gr, uz = sm.gz / gr;
      // "along the face" is one of the two axes, whichever the face lies nearer; where it lies between them both
      // patterns are worked and blended (a hard choice would flip from node to node there)
      const wz = smooth(0.38, 0.62, Math.abs(sm.gx) / (Math.abs(sm.gx) + Math.abs(sm.gz)));
      // buttresses and ribs: how far the face stands forward here (m); as height, that is so much times the slope
      const butAt = (al, as) => 2.8 * smooth(0.4, 0.56, vn(al / 12 + 3.7, 0.5, as)) + 1.0 * smooth(0.36, 0.62, vn(al / 3.3 + 9.1, h * 0.03, as + 4.1));
      const but = (wz < 1 ? butAt(x, 7.9) * (1 - wz) : 0) + (wz > 0 ? butAt(z, 1.3) * wz : 0);
      const h1 = h + but * gr * w;
      const u = bedU(x, h1, z) + 1 - TREAD, k = Math.floor(u), tk = bedT(x, h1, z), run = tk / gr;
      let tt = u - k;                                   // 0 at the foot of this bed's riser .. 1 at the foot of the next
      // joints down the face: the bed is in blocks, a few metres long, staggered from bed to bed
      const jsp = 3.5 + 4.5 * hash1(k * 7 + 1, 5);
      const blk = (al, o) => { const ja = al / jsp + 7.3 * hash1(k, 9 + o), cell = Math.floor(ja), fr = ja - cell, hb = hash1(cell * 3 + 1 + o, k * 5 + 2); return (hb < 0.16 ? 0.3 : 0.6 + 0.4 * hash1(cell * 11 + 5, k * 3 + 7 + o)) * (1 - 0.45 * smooth(0.5 / jsp, 0, Math.min(fr, 1 - fr))); };
      const m = (wz < 1 ? blk(x, 0) * (1 - wz) : 0) + (wz > 0 ? blk(z, 50) * wz : 0);
      // a node in a riser goes to its foot or its head, one just under the next riser to that one's foot: the
      // risers are walls and the ledges' edges run true, whatever way the mesh lies
      let dt = 0;
      if (tt < RISER) dt = tt < RISER / 2 ? -tt : RISER - tt;
      else if ((1 - tt) * run < 0.5 * c) dt = 1 - tt;
      const mv = clamp(dt * run, -0.5 * c, 0.5 * c);
      x += ux * mv; z += uz * mv; tt += mv / run;
      const lift = (Math.min(1, Math.max(tt, 0) / RISER) - tt) * tk * m;
      const rough = 0.5 * (vn(x * 0.83 + 3.1, h * 0.83, z * 0.83) - 0.5) + 0.3 * (vn(x * 2.3, h * 2.3 + 5.7, z * 2.3) - 0.5);
      y = field.heightAt(x, z) + (but * gr + Math.max(lift, 0) + rough * Math.min(1, c * 1.5)) * w - 0.6 * (1 - w);
      // (never above the ground a few metres up the slope: at the brow the last ledge runs into the turf, and no
      // block stands up over the cliff top like a tooth)
      y = Math.min(y, Math.max(field.heightAt(x + ux * 3, z + uz * 3), field.heightAt(x + ux * 6, z + uz * 6)) + 0.15);
      // grass and thrift take the ledges above the splash, in patches
      turf = smooth(4, 9, y) * smooth(0.4, 0.6, vn(x * 0.17 + 9.0, y * 0.11, z * 0.17) * 0.65 + vn(x * 0.9, y * 0.9 + 3.0, z * 0.9) * 0.35);
    }
    P[q * 3] = x - origin[0]; P[q * 3 + 1] = y - origin[1]; P[q * 3 + 2] = z - origin[2]; W[q] = w; F[q] = turf;
  }
  // smooth normals from the grid
  const Nn = new Float32Array(N1 * N1 * 3);
  for (let j = 0; j < N1; j++) for (let i = 0; i < N1; i++) {
    const a = (j * N1 + Math.min(i + 1, n)) * 3, b = (j * N1 + Math.max(i - 1, 0)) * 3, d = (Math.min(j + 1, n) * N1 + i) * 3, e = (Math.max(j - 1, 0) * N1 + i) * 3;
    const ux = P[a] - P[b], uy = P[a + 1] - P[b + 1], uz = P[a + 2] - P[b + 2], vx = P[d] - P[e], vy = P[d + 1] - P[e + 1], vz = P[d + 2] - P[e + 2];
    let nx = vy * uz - vz * uy, ny = vz * ux - vx * uz, nz = vx * uy - vy * ux;
    const l = Math.hypot(nx, ny, nz) || 1, q = (j * N1 + i) * 3;
    Nn[q] = nx / l; Nn[q + 1] = ny / l; Nn[q + 2] = nz / l;
    // (turf lies where the ground is level enough to hold it)
    F[q / 3] *= smooth(0.72, 0.9, ny / l);
  }
  const g = new Geo(lod ? 4096 : 32768), BED = [GROUND.ROCK, 1, 1, 0];
  const pt = (q) => [P[q * 3], P[q * 3 + 1], P[q * 3 + 2]];
  const tri = (a, b, d) => {
    const pa = pt(a), pb = pt(b), pd = pt(d);
    // (half faceted: a riser and its ledge do not shade into one another)
    let fx = (pb[1] - pa[1]) * (pd[2] - pa[2]) - (pb[2] - pa[2]) * (pd[1] - pa[1]), fy = (pb[2] - pa[2]) * (pd[0] - pa[0]) - (pb[0] - pa[0]) * (pd[2] - pa[2]), fz = (pb[0] - pa[0]) * (pd[1] - pa[1]) - (pb[1] - pa[1]) * (pd[0] - pa[0]);
    const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
    const nn = (q) => { const x = lerp(Nn[q * 3], fx, 0.7), y = lerp(Nn[q * 3 + 1], fy, 0.7), z = lerp(Nn[q * 3 + 2], fz, 0.7), l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; };
    const i0 = g.nv;
    g.tri(pa, pb, pd, nn(a), nn(b), nn(d), [1, 1, 1], BED);
    [a, b, d].forEach((q, k) => {
      const o = (i0 + k) * 3, tone = 0.86 + 0.28 * fb(P[q * 3] * 0.4 + 1.7, P[q * 3 + 1] * 0.4, P[q * 3 + 2] * 0.4), f = F[q];
      g.C[o] = lerp(tone, TURF[0] * tone, f); g.C[o + 1] = lerp(tone, TURF[1] * tone, f); g.C[o + 2] = lerp(tone, TURF[2] * tone, f);
    });
  };
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = j * N1 + i, b = a + 1, d = a + N1, e = d + 1;
    if (Math.max(W[a], W[b], W[d], W[e]) < 0.02) continue;
    // (a cell is split along the diagonal that lies the more level: a riser is then a run of slivers in one plane,
    // not a pleat)
    if (Math.abs(P[b * 3 + 1] - P[d * 3 + 1]) < Math.abs(P[a * 3 + 1] - P[e * 3 + 1])) { tri(a, d, b); tri(b, d, e); } else { tri(a, d, e); tri(a, e, b); }
  }
  return g;
}

// ---- loose rock on the land: blocks under cliffs, outcrops on their faces, boulders along a rocky shore ----
// Where they go is a pure function of the height field. Steep ground is sampled on a jittered grid: a face
// is the cliffs' own business (cliffGeo); the ground at its foot and a rocky shore get blocks.
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
    if (h < 1.6 && (g > 0.45 || foot > 0.6)) { kind = 'foot'; p = 0.8; }
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
