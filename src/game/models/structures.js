import { MAT } from '../geo.js';
import { Geo, rng, TAU, lerp, clamp, smooth, scl, vn, fb, hash1, mat, DV, GEL, RUB, MET, GLS, NSK, LIT, CLOTH, STONE, GRAIN, tube, rod, lathe, box, slab, quad, fan, loft, sheet, blob, lin, mark, paint, xf, frame, stamp, text, mixIn, mottle, stain, rust, faded, guano, both, railing, ladder, chain, hoop, lifering, bollard, coil, stoneProto } from './kit.js';
import { lifeboat } from './vessels.js';

// Fixed structures: a lighthouse on a rock, a rubble-mound breakwater with a light on its head,
// piled channel beacons, an offshore platform. Model space: y up, y = 0 the still waterline; a
// fixed structure does not move with the waves (the sea rises and falls against it). Every
// builder returns { g, lamps } where a lamp is { p, col, kind, ... } in model space (scenery.js
// draws the glows). Colours are linear albedo.
//
// Levels of detail: 0 near (fittings, masonry, every stone of the armour), 1 middle (the masses and the
// larger fittings, thicker bars so they hold a pixel), 2 far (a few hundred triangles with the same
// outline and colours, and no surface laid on another).

export { rng };
const polar = (r, a, y) => [r * Math.cos(a), y, r * Math.sin(a)];
const ASHLAR = mat(MAT.RUBBER, 0, 0, DV.ASHLAR + DV.ALONG), ASHLAR_FLAT = mat(MAT.RUBBER, 0, 0, DV.ASHLAR), CONC = mat(MAT.RUBBER, 0, 0, DV.CONCRETE + DV.ALONG), CONC_FLAT = mat(MAT.RUBBER, 0, 0, DV.CONCRETE);
const SLATE = mat(MAT.RUBBER, 0, 0, DV.SLATE), PLATE = mat(MAT.RUBBER, 0, 0, DV.PLATE), CORR = mat(MAT.RUBBER, 0, 0, DV.CORRUGATED);
const STEEL = [0.5, 0.52, 0.55], DARK = [0.04, 0.04, 0.045], GLASS = [0.015, 0.02, 0.03];
// round the vertical through the origin: the distance along a wall for the masonry pattern
const roundY = (P, i) => Math.atan2(P[i + 2], P[i]) * Math.hypot(P[i], P[i + 2]);
const lamp = (p, col, kind, extra = {}) => ({ p, col, kind, ...extra });

// box with its centre at c, half sizes, rotated by yaw about the vertical through c
export function obox(g, c, hx, hy, hz, yaw, col, m) { box(g, c, hx, hy, hz, col, m, { yaw }); }
// a surface of revolution placed at (cx, y0, cz); the profile goes up the side then inward across the top
export function solid(g, prof, col, m, segs = 12, cx = 0, y0 = 0, cz = 0) { lathe(g, prof, col, m, { segs, at: [cx, y0, cz] }); }

// a triangular lattice mast between two points
function lattice(g, a, b, w, bays, col, rr = 0.07, lod = 0, m = MET) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(d[0], d[1], d[2]);
  d[0] /= L; d[1] /= L; d[2] /= L;
  const ref = Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  let u = [d[1] * ref[2] - d[2] * ref[1], d[2] * ref[0] - d[0] * ref[2], d[0] * ref[1] - d[1] * ref[0]];
  const ul = Math.hypot(u[0], u[1], u[2]); u = [u[0] / ul, u[1] / ul, u[2] / ul];
  const v = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
  const corner = (k, i) => {
    const th = (k / 3) * TAU + Math.PI / 2, c = Math.cos(th) * w, s = Math.sin(th) * w, f = (L * i) / bays;
    return [a[0] + d[0] * f + u[0] * c + v[0] * s, a[1] + d[1] * f + u[1] * c + v[1] * s, a[2] + d[2] * f + u[2] * c + v[2] * s];
  };
  for (let k = 0; k < 3; k++) rod(g, corner(k, 0), corner(k, bays), rr * 1.5, col, m, lod ? 3 : 4);
  for (let i = 0; i < bays; i++) for (let k = 0; k < 3; k++) {
    const k2 = (k + 1) % 3;
    rod(g, corner(k, i), corner(k2, i + 1), rr, col, m, 3);
    if (!lod) rod(g, corner(k, i), corner(k2, i), rr, col, m, 3);
  }
}
// a square lattice tower from half width w0 at y0 to w1 at y1 about (cx, cz)
function derrick(g, cx, cz, y0, y1, w0, w1, bays, col, rr, lod) {
  const c = (k, y) => { const w = lerp(w0, w1, (y - y0) / (y1 - y0)); return [cx + (k === 0 || k === 3 ? w : -w), y, cz + (k < 2 ? w : -w)]; };
  for (let k = 0; k < 4; k++) rod(g, c(k, y0), c(k, y1), rr * 1.6, col, MET, lod ? 3 : 4);
  for (let b = 0; b < bays; b++) {
    const ya = lerp(y0, y1, b / bays), yb = lerp(y0, y1, (b + 1) / bays);
    for (let k = 0; k < 4; k++) { const k2 = (k + 1) % 4; rod(g, c(k, yb), c(k2, yb), rr, col, MET, 3); rod(g, c(k, ya), c(k2, yb), rr, col, MET, 3); if (!lod) rod(g, c(k2, ya), c(k, yb), rr, col, MET, 3); }
  }
}
// a window let into a wall: a stone or painted surround, glass, glazing bars, a sill. c: centre on the wall, n: outward (unit, level)
function wallWindow(g, c, n, w, h, lod, { frame: fc = [0.6, 0.6, 0.56], sill = true, lit = false } = {}) {
  const t = [-n[2], 0, n[0]], P = (a, b, o) => [c[0] + t[0] * a + n[0] * o, c[1] + b, c[2] + t[2] * a + n[2] * o];
  quad(g, P(-w / 2, -h / 2, 0.03), P(w / 2, -h / 2, 0.03), P(w / 2, h / 2, 0.03), P(-w / 2, h / 2, 0.03), lit ? [0.9, 0.7, 0.35] : GLASS, lit ? LIT : GLS);
  if (lod) return;
  tube(g, [P(-w / 2, -h / 2, 0.04), P(w / 2, -h / 2, 0.04), P(w / 2, h / 2, 0.04), P(-w / 2, h / 2, 0.04)], 0.035, fc, RUB, { segs: 4, closed: true });
  rod(g, P(0, -h / 2, 0.045), P(0, h / 2, 0.045), 0.015, fc, RUB, 3); rod(g, P(-w / 2, 0, 0.045), P(w / 2, 0, 0.045), 0.015, fc, RUB, 3);
  if (sill) box(g, P(0, -h / 2 - 0.06, 0.07), w / 2 + 0.08, 0.04, 0.09, scl(fc, 0.9), RUB, { yaw: Math.atan2(n[2], n[0]) + Math.PI / 2 });
}
// a plank door in a frame, with strap hinges and a ring handle
function wallDoor(g, c, n, w, h, col, lod) {
  const t = [-n[2], 0, n[0]], P = (a, b, o) => [c[0] + t[0] * a + n[0] * o, c[1] + b, c[2] + t[2] * a + n[2] * o];
  quad(g, P(-w / 2, 0, 0.03), P(w / 2, 0, 0.03), P(w / 2, h, 0.03), P(-w / 2, h, 0.03), col, RUB);
  if (lod) return;
  tube(g, [P(-w / 2, 0, 0.04), P(-w / 2, h, 0.04), P(w / 2, h, 0.04), P(w / 2, 0, 0.04)], 0.05, [0.5, 0.5, 0.47], RUB, { segs: 4 });
  for (const k of [-0.25, 0, 0.25]) rod(g, P(w * k, 0.02, 0.036), P(w * k, h - 0.02, 0.036), 0.008, scl(col, 0.5), RUB, 3);
  for (const y of [h * 0.22, h * 0.78]) rod(g, P(-w / 2 + 0.03, y, 0.045), P(w * 0.3, y, 0.045), 0.018, DARK, RUB, 3);
  hoop(g, P(w * 0.32, h * 0.5, 0.06), n, 0.05, 0.01, DARK, RUB, 8, 3);
}

// =========================================================================================
// Lighthouse on a rock
// =========================================================================================
export const LIGHTHOUSE = { rockR: 27, lampY: 30.5, height: 37, radius: 22 };
const CREST = 5.0;                    // the rock's flat top, where the tower, the store and the path stand
const STAIR = { x0: 12.4, x1: 19.6, y1: 1.1, hw: 0.95 };   // the steps down to the landing, along +x
const stairY = (x) => lerp(CREST, STAIR.y1, clamp((x - STAIR.x0) / (STAIR.x1 - STAIR.x0), 0, 1));
// The rock: a skerry with a level top, ledges stepping down to a weedy shore, and a few yards of it under water.
// Height at a point, and the mesh. The outline is not round: lobes and gullies, by direction.
function skerry(R, seed) {
  const edge = (c, s) => R * clamp(0.8 + 0.5 * (fb(c * 1.15 + seed, s * 1.15, 3.3) - 0.5) + 0.16 * (vn(c * 3.1 + seed, s * 3.1, 7.7) - 0.5), 0.6, 1);
  return (x, z, out) => {
    const r = Math.hypot(x, z) || 1e-6, c = x / r, s = z / r, e = edge(c, s), q = r / e, pl = 0.5;
    let y = q < pl ? CREST : q < 0.82 ? lerp(CREST, 1.0, Math.pow((q - pl) / (0.82 - pl), 1.25)) : q < 1 ? lerp(1.0, -0.6, (q - 0.82) / 0.18) : lerp(-0.6, -5.5, Math.min((q - 1) / 0.28, 1));
    const a = smooth(pl, pl + 0.2, q) * (1 - 0.6 * smooth(1.0, 1.25, q));
    y += ((fb(x * 0.11 + seed, 1.7, z * 0.11) - 0.5) * 3.6 + (vn(x * 0.42, seed, z * 0.42) - 0.5) * 1.3) * a;
    // ledges: the rock breaks along its bedding, which dips to one side, so heights gather at tilted steps
    const st = 1.3, dip = 0.16 * x + 0.09 * z, d = (y + dip) / st, fl = Math.floor(d), fr = d - fl;
    y = lerp(y, (fl + smooth(0.3, 0.62, fr)) * st - dip, 0.9 * a * smooth(-2, 0.3, y));
    // gullies: narrow clefts run in from the sea
    y -= 1.6 * a * smooth(0.82, 0.93, vn(c * 4.2 + seed * 3, 0.5, s * 4.2)) * smooth(0.5, 0.75, q);
    // the cut for the steps and the landing
    if (x > STAIR.x0 - 2 && Math.abs(z) < 3.2) { const w = smooth(3.2, 1.6, Math.abs(z)) * smooth(STAIR.x0 - 2, STAIR.x0, x); y = lerp(y, Math.min(y, stairY(x) - 0.25), w); }
    if (out) out[0] = e;
    return y;
  };
}
function rockMesh(g, hgt, R, seed, lod) {
  const NS = lod === 0 ? 96 : lod === 1 ? 40 : 16, NR = lod === 0 ? 40 : lod === 1 ? 16 : 6, e = [0];
  const rp = stain(seed, { weedTop: 1.0, tide: 1.25, wet: 1.9, salt: 0.1 });
  sheet(g, NR + 1, NS + 1, (i, j, out) => {
    const a = (j / NS) * TAU, c = Math.cos(a), s = Math.sin(a);
    hgt(c, s, e);
    const q = Math.pow(i / NR, 0.85) * 1.27, r = q * e[0] * (1 + 0.05 * (vn(c * 5 + seed, q * 6, s * 5) - 0.5) * smooth(0.5, 0.7, q));
    out[0] = c * r; out[2] = s * r; out[1] = hgt(out[0], out[2]);
  }, [0.085, 0.08, 0.074], lod === 2 ? RUB : STONE, { wrap: true, flat: lod === 2 ? 0 : 0.75, paint: (P, N, C, i) => {
    const x = P[i], y = P[i + 1], z = P[i + 2];
    // beds of lighter and darker stone along the dip, then lichen in small patches above the splash, white
    // where birds roost, thin turf in the hollows of the top, and last the sea's bands
    const bed = vn(3.1, (y + 0.16 * x + 0.09 * z) * 1.9 + seed, 0.7), k = (0.62 + 0.5 * bed) * (0.85 + 0.3 * fb(x * 0.3 + seed, y * 0.6, z * 0.3));
    C[i] *= k; C[i + 1] *= k; C[i + 2] *= k * 0.96;
    if (y > 2.6) {
      mixIn(C, i, 0.36, 0.25, 0.04, smooth(0.74, 0.86, vn(x * 1.3, y * 1.1, z * 1.3 + seed)) * smooth(2.6, 3.6, y) * 0.6);
      mixIn(C, i, 0.55, 0.55, 0.5, smooth(0.7, 0.84, vn(x * 1.7 + seed, y * 0.7, z * 1.7)) * (N[i + 1] > 0.75 ? 0.55 : 0.08));
      mixIn(C, i, 0.07, 0.11, 0.04, smooth(0.52, 0.7, fb(x * 0.33, 3.3, z * 0.33 + seed)) * smooth(0.86, 0.97, N[i + 1]) * smooth(4.2, 4.9, y) * 0.75);
    }
    rp(P, N, C, i);
  } });
}
export function lighthouseGeo(lod = 0, seed = 3) {
  const g = new Geo(lod === 0 ? 65536 : 4096), lamps = [], near = lod === 0, far = lod === 2;
  const hgt = skerry(LIGHTHOUSE.rockR, seed);
  rockMesh(g, hgt, LIGHTHOUSE.rockR, seed, lod);
  const R = rng(seed * 101 + 7);
  // loose boulders on the ledges and at the water's edge
  if (!far) {
    const protos = [0, 1, 2, 3, 4].map((k) => stoneProto(seed * 10 + k, near ? 0 : 1, STONE)), s0 = mark(g);
    for (let k = 0; k < (near ? 60 : 26); k++) {
      const a = R() * TAU, r = (0.6 + 0.5 * R()) * 22, x = Math.cos(a) * r, z = Math.sin(a) * r, y = hgt(x, z), s = 0.9 + 3.2 * R() * R();
      if (x > 10 && Math.abs(z) < 4.5) continue;
      const v = 0.07 + 0.07 * R();
      stamp(g, protos[k % 5], frame([x, y + s * 0.18, z], R() * TAU, R() * 0.5, R() * 0.5, s), [v * 1.05, v, v * 0.92], [1.2, 0.75, 1]);
    }
    paint(g, s0, stain(seed + 1, { weedTop: 1.0, tide: 1.25, wet: 1.9, salt: 0.1 }));
  }
  const white = [0.66, 0.64, 0.59], red = [0.5, 0.06, 0.04], stone = [0.3, 0.28, 0.25], copper = [0.1, 0.27, 0.2], iron = [0.05, 0.05, 0.055];
  const segs = far ? 10 : lod ? 16 : 32;
  const Y0 = 4.8, rad = (y) => 4.6 - 0.065 * (y - 5.0);
  // ---- tower: a stone plinth, then four painted bands of dressed masonry with a string course at each change ----
  const bands = [[Y0, 7.2, stone], [7.2, 12.3, white], [12.3, 17.4, red], [17.4, 22.5, white], [22.5, 27.6, red]];
  const wx = (P, N, C, i) => {
    const y = P[i + 1], a = Math.atan2(P[i + 2], P[i]);
    // rain streaks from the gallery and the string courses, green on the weather side near the rock, paint flaked off the lower courses
    const streak = vn(a * 9 + seed, y * 0.3, 0.7), k = 0.84 + 0.26 * streak - 0.25 * smooth(2.5, 0, 27.6 - y) * streak;
    C[i] *= k; C[i + 1] *= k; C[i + 2] *= k * 0.97;
    mixIn(C, i, 0.1, 0.13, 0.06, smooth(10.5, 6, y) * smooth(-0.2, 0.7, Math.cos(a - 2.2)) * 0.4);
    mixIn(C, i, stone[0], stone[1], stone[2], smooth(0.66, 0.8, fb(a * 2.3 + seed, y * 0.5, 1.9)) * smooth(15, 7.5, y) * 0.75);
  };
  for (const [y0, y1, col] of bands) {
    const n = far ? 1 : lod ? 2 : 5, prof = lin(y0, y1, n).map((y) => [rad(y) + (col === stone ? 0.22 : 0), y]);
    lathe(g, prof, col, far ? RUB : ASHLAR, { segs, along: far ? undefined : roundY, paint: far ? undefined : wx });
    if (!far) lathe(g, [[rad(y1) + (col === stone ? 0.22 : 0), y1 - 0.02], [rad(y1) + 0.12, y1 - 0.02], [rad(y1) + 0.12, y1 - 0.02], [rad(y1) + 0.12, y1 + 0.16], [rad(y1) + 0.12, y1 + 0.16], [rad(y1), y1 + 0.2]], col === stone ? scl(stone, 1.15) : [0.5, 0.48, 0.44], GRAIN, { segs });
  }
  // ---- gallery: a corbelled stone deck on brackets, an iron railing ----
  const GY = 28.0;
  lathe(g, [[rad(27.6), 27.2], [4.0, 27.55], [4.55, 27.62], [4.55, 27.62], [4.6, GY], [4.6, GY], [2.3, GY]], [0.5, 0.5, 0.47], far ? RUB : GRAIN, { segs });
  if (!far) {
    const nb = lod ? 12 : 24;
    if (near) for (let k = 0; k < nb; k++) { const a = (k / nb) * TAU, s0 = mark(g); fan(g, [[rad(26.6), 26.5, -0.09], [4.5, 27.55, -0.09], [rad(27.4), 27.55, -0.09]], [0.42, 0.41, 0.38], GRAIN); fan(g, [[rad(26.6), 26.5, 0.09], [4.5, 27.55, 0.09], [rad(27.4), 27.55, 0.09]], [0.42, 0.41, 0.38], GRAIN); quad(g, [rad(26.6), 26.5, -0.09], [4.5, 27.55, -0.09], [4.5, 27.55, 0.09], [rad(26.6), 26.5, 0.09], [0.36, 0.35, 0.33], GRAIN); xf(g, s0, frame([0, 0, 0], a)); }
    const rc = iron, np = lod ? 12 : 24;
    for (let k = 0; k < np; k++) { const a = (k / np) * TAU; rod(g, polar(4.3, a, GY), polar(4.3, a, GY + 1.05), lod ? 0.04 : 0.028, rc, RUB, 4); if (near) blob(g, polar(4.3, a, GY + 1.09), 0.045, 0.045, 0.045, rc, RUB, { n: 3, segs: 5 }); }
    for (const f of near ? [0.3, 0.62, 1] : [0.55, 1]) tube(g, Array.from({ length: np * 2 }, (_, k) => polar(4.3, (k / (np * 2)) * TAU, GY + 1.02 * f)), lod ? 0.035 : 0.022, rc, RUB, { segs: 4, closed: true });
  }
  // ---- lantern: a red murette, glazing in astragals, the lens, a copper dome with its ventilator ----
  lathe(g, [[2.35, GY], [2.35, 29.2], [2.35, 29.2], [2.45, 29.24], [2.45, 29.3], [2.1, 29.3]], red, far ? RUB : GEL, { segs: far ? 8 : lod ? 12 : 24 });
  lathe(g, [[2.02, 29.3], [2.02, 31.6]], [0.03, 0.04, 0.05], GLS, { segs: far ? 8 : lod ? 12 : 24 });
  if (!far) {
    const nbar = lod ? 8 : 16;
    for (let k = 0; k < nbar; k++) { const a = (k / nbar) * TAU; rod(g, polar(2.05, a, 29.3), polar(2.05, a, 31.65), lod ? 0.06 : 0.04, iron, RUB, 4); if (near) rod(g, polar(2.05, a, 30.1), polar(2.05, a + TAU / nbar, 30.9), 0.022, iron, RUB, 3); }
    for (const y of [29.3, 30.1, 30.9, 31.65]) tube(g, Array.from({ length: 24 }, (_, k) => polar(2.05, (k / 24) * TAU, y)), lod ? 0.055 : 0.04, iron, RUB, { segs: 4, closed: true });
    if (near) { for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU + 0.3; box(g, polar(2.37, a, 28.6), 0.02, 0.1, 0.16, DARK, RUB, { yaw: a }); } wallDoor(g, polar(2.34, 2.2, GY + 0.05), [Math.cos(2.2), 0, Math.sin(2.2)], 0.62, 1.1, [0.3, 0.04, 0.03], 0); }
  }
  // the optic: a beehive of ribbed glass on its pedestal
  {
    const prof = [], n = far ? 2 : lod ? 5 : 12;
    for (let k = 0; k <= n * 2; k++) { const f = k / (n * 2); prof.push([(0.55 + 0.4 * Math.sin(Math.PI * f)) * (k % 2 ? 1.05 : 0.97), 29.7 + 1.6 * f]); }
    lathe(g, prof, [1, 0.86, 0.5], LIT, { segs: far ? 6 : lod ? 10 : 16 });
    if (!far) lathe(g, [[0.5, 29.2], [0.45, 29.7], [0.45, 29.7], [0.6, 29.72]], [0.25, 0.2, 0.08], MET, { segs: 10 });
  }
  lamps.push(lamp([0, LIGHTHOUSE.lampY, 0], [1, 0.9, 0.62], 'beam'));
  lathe(g, [[2.3, 31.55], [2.5, 31.68], [2.5, 31.68], [2.45, 31.9], [1.8, 33.05], [1.0, 33.85], [0.35, 34.3], [0.25, 34.42]], copper, far ? RUB : GEL, { segs: far ? 8 : lod ? 12 : 24, paint: far ? undefined : (P, N, C, i) => { const k = 0.75 + 0.5 * fb(P[i] * 1.2, P[i + 1] * 1.5, P[i + 2] * 1.2); C[i] *= k; C[i + 1] *= k; C[i + 2] *= k; mixIn(C, i, 0.6, 0.6, 0.55, smooth(0.7, 0.85, vn(P[i] * 3, P[i + 1] * 2, P[i + 2] * 3)) * 0.5); } });
  if (!far) {
    lathe(g, [[0.22, 34.4], [0.32, 34.75], [0.32, 34.95], [0.2, 35.15], [0.0, 35.2]], copper, GEL, { segs: 10 });
    rod(g, [0, 35.15, 0], [0, 36.8, 0], lod ? 0.04 : 0.02, [0.3, 0.3, 0.3], RUB, 3);
    if (near) { for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; tube(g, [[2.45, 31.9], [1.8, 33.05], [1.0, 33.85], [0.35, 34.3]].map(([r, y]) => polar(r + 0.02, a, y + 0.02)), 0.03, scl(copper, 0.8), GEL, { segs: 3 }); } rod(g, [0, 36.3, 0], [0.5, 36.3, 0], 0.012, iron, RUB, 3); fan(g, [[0.5, 36.3, 0], [0.75, 36.42, 0], [0.75, 36.18, 0]], iron, RUB); }
  }
  if (near) {
    // windows up the stair, each with its surround; the door under a lamp, the date stone over it
    for (let k = 0; k < 5; k++) { const y = 9.6 + k * 4, a = 0.9 + k * 1.15, r = rad(y) + 0.0; wallWindow(g, polar(r, a, y), [Math.cos(a), 0, Math.sin(a)], 0.6, 1.1, 0, { frame: [0.42, 0.4, 0.37] }); }
    const dr = rad(5.5) + 0.22;
    wallDoor(g, [dr, CREST + 0.38, 0], [1, 0, 0], 1.1, 2.1, [0.07, 0.09, 0.05], 0);
    box(g, [dr + 0.05, CREST + 2.75, 0], 0.06, 0.2, 0.75, [0.4, 0.38, 0.35], GRAIN); text(g, '1874', [dr + 0.11, CREST + 2.65, 0.3], [0, 0, -1], [0, 1, 0], 0.2, [0.2, 0.19, 0.17], RUB, { off: 0.004 });
    for (let k = 0; k < 2; k++) box(g, [dr + 0.5 + k * 0.4, CREST + 0.28 - k * 0.19, 0], 0.22, 0.1, 1.0 + k * 0.15, [0.32, 0.31, 0.29], GRAIN);
    rod(g, [dr + 0.05, CREST + 3.2, 0.5], [dr + 0.45, CREST + 3.3, 0.5], 0.02, iron, RUB, 4); box(g, [dr + 0.45, CREST + 3.15, 0.5], 0.08, 0.12, 0.08, [0.9, 0.8, 0.5], LIT);
    // modern kit on the gallery: solar panels on the rail, a fog signal, an aerial
    for (const a of [-0.6, -0.25]) { const s0 = mark(g); quad(g, [-0.5, 0, 0], [0.5, 0, 0], [0.5, 0.75, -0.35], [-0.5, 0.75, -0.35], [0.03, 0.05, 0.14], GLS); tube(g, [[-0.5, 0, 0], [0.5, 0, 0], [0.5, 0.75, -0.35], [-0.5, 0.75, -0.35]], 0.015, [0.6, 0.6, 0.6], MET, { segs: 3, closed: true }); xf(g, s0, frame(polar(4.4, a, GY + 0.35), Math.PI / 2 - a)); }
    tube(g, [polar(4.0, 2.6, GY + 0.5), polar(4.5, 2.6, GY + 0.55)], [0.05, 0.16], [0.5, 0.06, 0.04], GEL, { segs: 8 }); box(g, polar(3.9, 2.6, GY + 0.3), 0.15, 0.3, 0.15, [0.4, 0.4, 0.4], RUB);
    rod(g, polar(4.3, 4.0, GY + 1.0), polar(4.35, 4.0, GY + 3.4), 0.012, iron, RUB, 3);
    rod(g, [3.6, GY, 0], [3.6, 31.0, 0], 0.03, [0.7, 0.7, 0.68], RUB, 4);
  }
  // ---- the keeper's store: a whitewashed cottage with a slate roof, a chimney, an oil tank; a wall round its yard ----
  {
    const hc = [-8.0, CREST, 2.6], yaw = 0.3, s0 = mark(g), wallC = [0.6, 0.58, 0.52], hx = 2.9, hz = 2.0, eave = 2.5, ridge = 4.1;
    box(g, [0, eave / 2 - 0.4, 0], hx, eave / 2 + 0.4, hz, wallC, far ? RUB : ASHLAR_FLAT);
    for (const s of [-1, 1]) { fan(g, [[s * hx, eave, -hz], [s * hx, eave, hz], [s * hx, ridge - 0.08, 0]], wallC, far ? RUB : ASHLAR_FLAT); quad(g, [-hx - 0.3, eave - 0.12, s * (hz + 0.3)], [hx + 0.3, eave - 0.12, s * (hz + 0.3)], [hx + 0.3, ridge, 0], [-hx - 0.3, ridge, 0], [0.09, 0.095, 0.11], far ? RUB : SLATE); }
    if (!far) {
      box(g, [1.9, ridge + 0.25, 0], 0.3, 0.75, 0.3, wallC, ASHLAR_FLAT); for (const z of [-0.12, 0.12]) lathe(g, [[0.09, 0], [0.07, 0.3]], [0.4, 0.16, 0.09], RUB, { segs: 6, at: [1.9, ridge + 1.0, z] });
      rod(g, [-hx - 0.3, ridge + 0.03, 0], [hx + 0.3, ridge + 0.03, 0], 0.05, [0.07, 0.07, 0.08], RUB, 4);
      wallDoor(g, [-0.2, 0, hz], [0, 0, 1], 0.9, 1.9, [0.05, 0.12, 0.16], lod);
      wallWindow(g, [1.5, 1.4, hz], [0, 0, 1], 0.8, 0.9, lod); wallWindow(g, [-1.7, 1.4, hz], [0, 0, 1], 0.8, 0.9, lod); wallWindow(g, [0.8, 1.4, -hz], [0, 0, -1], 0.8, 0.9, lod); wallWindow(g, [-hx, 1.4, 0], [-1, 0, 0], 0.7, 0.9, lod);
      // gutters and a water butt, the oil tank on its cradle
      if (near) { for (const s of [-1, 1]) rod(g, [-hx - 0.3, eave - 0.14, s * (hz + 0.32)], [hx + 0.3, eave - 0.14, s * (hz + 0.32)], 0.05, DARK, RUB, 4); rod(g, [hx + 0.2, eave - 0.14, hz + 0.3], [hx + 0.2, 0.75, hz + 0.3], 0.035, DARK, RUB, 4); lathe(g, [[0.32, 0], [0.36, 0.4], [0.32, 0.8], [0.0, 0.8]], [0.12, 0.2, 0.12], RUB, { segs: 10, at: [hx + 0.3, 0, hz + 0.45] }); }
      lathe(g, [[0.0, -1.1], [0.55, -1.0], [0.6, -0.8], [0.6, 0.8], [0.55, 1.0], [0, 1.1]], [0.2, 0.3, 0.22], RUB, { segs: lod ? 8 : 12, axis: 'x', at: [0.6, 1.0, -hz - 1.2], paint: near ? rust(seed, { amt: 0.5, f: 2.5 }) : undefined });
      for (const x of [0.0, 1.2]) box(g, [x, 0.25, -hz - 1.2], 0.08, 0.3, 0.5, [0.3, 0.3, 0.3], RUB);
    }
    xf(g, s0, frame(hc, yaw));
  }
  if (!far) {
    // a dry-stone wall along the landward edge of the top, a paved path from the door to the head of the steps
    const s0 = mark(g);
    for (let k = 0; k < (lod ? 10 : 22); k++) { const a = 2.0 + (k / (lod ? 10 : 22)) * 2.6, r = 11.3 + 0.5 * Math.sin(k * 1.7); box(g, polar(r, a, CREST + 0.3), 0.28, 0.5 + 0.07 * Math.sin(k * 2.3), lod ? 1.6 : 0.8, [0.2, 0.19, 0.17], ASHLAR_FLAT, { yaw: a }); }
    slab(g, rad(5) + 0.9, STAIR.x0, CREST - 0.3, CREST + 0.03, -0.75, 0.75, [0.36, 0.35, 0.33], CONC_FLAT);
    // steps cut down to the landing, a handrail, the landing with its bollard, ladder and rings; a derrick for stores
    const n = lod ? 7 : 14, dx = (STAIR.x1 - STAIR.x0) / n, dyy = (CREST - STAIR.y1) / n;
    for (let k = 0; k < n; k++) slab(g, STAIR.x0 + k * dx, STAIR.x0 + (k + 1) * dx + 0.02, CREST - (k + 1) * dyy - 1.6, CREST - (k + 1) * dyy, -STAIR.hw, STAIR.hw, [0.33, 0.32, 0.3], CONC_FLAT);
    for (const s of [-1, 1]) { quad(g, [STAIR.x0, CREST - 2, s * (STAIR.hw + 0.02)], [STAIR.x1, STAIR.y1 - 2, s * (STAIR.hw + 0.02)], [STAIR.x1, STAIR.y1 + 0.25, s * (STAIR.hw + 0.02)], [STAIR.x0, CREST + 0.25, s * (STAIR.hw + 0.02)], [0.3, 0.29, 0.27], CONC_FLAT); }
    railing(g, [[STAIR.x0, CREST + 0.2, -STAIR.hw - 0.08], [STAIR.x1, STAIR.y1 + 0.2, -STAIR.hw - 0.08], [23.2, STAIR.y1, -STAIR.hw - 0.08]], iron, RUB, { h: 0.95, every: 1.6, rails: near ? [0.5, 1] : [1], r: lod ? 0.04 : 0.025, segs: 4 });
    slab(g, STAIR.x1, 23.6, -2.5, STAIR.y1, -2.4, 2.4, [0.33, 0.32, 0.3], CONC_FLAT);
    if (near) {
      bollard(g, [22.6, STAIR.y1, 1.7], 1.1); bollard(g, [20.6, STAIR.y1, 1.9], 1.1);
      ladder(g, [23.66, -1.2, -1.2], [23.66, STAIR.y1 + 0.9, -1.2], [0, 0, 1], iron, RUB, { w: 0.45, r: 0.03 });
      for (const z of [-0.3, 1.0]) hoop(g, [23.64, 0.55, z], [0, 0, 1], 0.12, 0.025, iron, RUB, 8, 3);
      for (const z of [-2.0, 0.2, 2.0]) rod(g, [23.68, -1.5, z], [23.68, STAIR.y1 - 0.05, z], 0.11, [0.12, 0.09, 0.06], GRAIN, 6);
      coil(g, [21.5, STAIR.y1 + 0.02, -1.4], 0.4, [0.5, 0.45, 0.3], 4);
      for (const [x, z] of [[20.5, -1.9], [20.9, -1.5]]) box(g, [x, STAIR.y1 + 0.22, z], 0.32, 0.22, 0.22, [0.28, 0.2, 0.1], RUB, { yaw: x });
      // the stores derrick: a post, a jib, its tackle
      rod(g, [20.2, STAIR.y1, 1.2], [20.2, STAIR.y1 + 3.6, 1.2], 0.09, iron, RUB, 6); tube(g, [[20.2, STAIR.y1 + 3.2, 1.2], [22.8, STAIR.y1 + 4.3, 2.9]], [0.07, 0.05], iron, RUB, { segs: 5 }); rod(g, [20.2, STAIR.y1 + 3.6, 1.2], [22.8, STAIR.y1 + 4.3, 2.9], 0.012, [0.3, 0.3, 0.3], RUB, 3); rod(g, [22.8, STAIR.y1 + 4.3, 2.9], [22.8, STAIR.y1 + 2.2, 2.9], 0.012, [0.3, 0.3, 0.3], RUB, 3); hoop(g, [22.8, STAIR.y1 + 2.1, 2.9], [1, 0, 0], 0.07, 0.02, iron, RUB, 8, 3);
    }
    paint(g, s0, both(mottle(seed, 0.12, 0.6), stain(seed + 2, { weedTop: 0.9, tide: 1.2, wet: 1.7, salt: 0.1 })));
  }
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
let STONES = null;
// the sea's bands on rock armour by height: wet and dark, weed below, a pale belt of shell at the top of the
// tide. One noise sample a corner: a breakwater has a quarter of a million of them.
const shore = (seed) => (x, y, z, C, i) => {
  if (y > 2.7) return;
  const n = vn(x * 0.9 + seed, y * 1.4, z * 0.9), wl = y + (n - 0.5) * 0.7, wet = 1 - 0.5 * smooth(2.0, 0.9, wl);
  C[i] *= wet; C[i + 1] *= wet; C[i + 2] *= wet;
  if (wl < 0.95) mixIn(C, i, 0.04 + 0.06 * n, 0.055 + 0.05 * n, 0.024, smooth(0.95, 0.15, wl) * 0.9);
  else if (wl < 1.7) mixIn(C, i, 0.4, 0.38, 0.32, smooth(0.45, 0.0, Math.abs(wl - 1.3)) * (n > 0.45 ? 0.55 : 0.15));
};
// All the chunks of a breakwater following `path` (world xz points), `side` = +1 when the sea is to
// the left of the direction of travel. Each chunk is { g, x, z, r }: geometry relative to (x, z).
// The last point is the head, with a round mound and a white tower carrying a red light.
// Near, the armour is stones: each a cut block of its own shape and grey, laid in courses up both slopes
// (heavier on the sea side), on a dark core that shows in the gaps.
export function breakwaterChunks(path, side, lod, seed = 5) {
  const near = lod === 0, far = lod === 2;
  const rows = smoothPath(path, far ? 14 : near ? 1.6 : 4);
  const chunks = [];
  if (!STONES) STONES = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((k) => stoneProto(100 + k, 0, GRAIN, 6 + (k % 3))), [0, 1, 2, 3, 4, 5].map((k) => stoneProto(100 + k, 1, GRAIN, 5))];
  const nSea = (p) => [-p.tz * side, p.tx * side];       // to the sea
  // the point at arc length s along the path, offset a across (negative toward the sea)
  const total = rows[rows.length - 1].s;
  const rowAt = (s) => {
    let lo = 0, hi = rows.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (rows[m].s <= s) lo = m; else hi = m; }
    const A = rows[lo], B = rows[hi], f = clamp((s - A.s) / (B.s - A.s || 1), 0, 1);
    return { x: lerp(A.x, B.x, f), z: lerp(A.z, B.z, f), tx: lerp(A.tx, B.tx, f), tz: lerp(A.tz, B.tz, f), s };
  };
  const concrete = [0.4, 0.39, 0.37], steel = [0.3, 0.31, 0.33], rusty = [0.24, 0.16, 0.1];
  for (let k0 = 0; k0 * BREAKWATER.chunk < total - 1; k0++) {
    const s0 = k0 * BREAKWATER.chunk, s1 = Math.min(s0 + BREAKWATER.chunk, total);
    if (s1 - s0 < 0.5) continue;
    const g = new Geo(near ? 131072 : 4096), lamps = [];
    const o = rowAt(s0), ox = o.x, oz = o.z;
    const Q = (s, a, y) => { const p = rowAt(s), n = nSea(p); return [p.x - n[0] * a - ox, y, p.z - n[1] * a - oz]; };
    const isHead = s1 >= total - 1e-6, len = s1 - s0;
    const ns = Math.max(2, Math.round(len / (far ? 14 : near ? 2 : 4))), ss = lin(s0, s1, ns);
    const st = { at: shore(seed) };
    // ---- the core: the mound's own surface, dark, a little under the armour ----
    {
      const prof = far ? MOUND : MOUND.filter((q) => q[1] > -3.2 || true), drop = far ? 0 : 0.55;
      sheet(g, ss.length, prof.length, (i, j, out) => { const q = Q(ss[i], prof[j][0], prof[j][1] - (prof[j][0] < -3.3 || prof[j][0] > 2.9 ? drop : 0)); out[0] = q[0]; out[1] = q[1]; out[2] = q[2]; }, far ? [0.12, 0.118, 0.11] : [0.035, 0.035, 0.035], far ? RUB : GRAIN, { paint: far ? (P, N, C, i) => { const k = 0.6 + 0.8 * vn((P[i] + ox) * 0.4, P[i + 1], (P[i + 2] + oz) * 0.4); C[i] *= k; C[i + 1] *= k; C[i + 2] *= k; st.at(P[i] + ox, P[i + 1], P[i + 2] + oz, C, i); } : undefined });
    }
    // ---- armour ----
    if (!far) {
      const SP = near ? 1.85 : 3.0, protos = STONES[near ? 0 : 1], g0 = mark(g);
      // courses up each slope: [offset, height] with the stone size for that course
      const course = (a0, a1, size) => { const n = Math.max(1, Math.round(Math.abs(a1 - a0) / (size * 0.78))); return Array.from({ length: n }, (_, k) => [lerp(a0, a1, (k + 0.5) / n), size]); };
      const lanes = [...course(-13.6, -3.9, near ? 2.3 : 3.2), ...course(3.9, 10.6, near ? 1.8 : 2.8)];
      const i0 = Math.ceil(s0 / SP - 0.5), i1 = Math.ceil(s1 / SP - 0.5);
      for (let i = i0; i < i1; i++) lanes.forEach(([a, size], li) => {
        const h1 = hash1(i * 31 + li, seed), h2 = hash1(i, li * 17 + seed + 5), h3 = hash1(i * 7 + 3, li + seed * 3);
        const s = (i + 0.5 + (li & 1 ? 0.5 : 0) + (h1 - 0.5) * 0.5) * SP;
        if (s < s0 || s >= s1) return;
        const aa = a + (h2 - 0.5) * size * 0.45, sc = size * (0.82 + 0.5 * h3), q = Q(Math.min(s, total), aa, moundY(aa) - (a > 0 ? 0.75 : 0.5) + sc * 0.3);
        const v = 0.085 + 0.1 * h2 * h2 + 0.03 * h1;
        stamp(g, protos[Math.floor(h3 * 997) % protos.length], frame(q, h1 * TAU, (h2 - 0.5) * 0.9, (h3 - 0.5) * 0.9, sc), [v * 1.05, v, v * 0.93], [1.25, 0.72, 1.0]);
      });
      if (isHead) {
        // the round head: rings of stone about the end
        const e = rowAt(total), c = [e.x - ox, e.z - oz];
        for (let ring = 0; ring < (near ? 7 : 4); ring++) {
          const rr = BREAKWATER.headR - 7.6 + ring * (near ? 1.75 : 3), size = near ? 2.2 : 3.2, n = Math.round((TAU * rr) / (size * 0.85)), y = lerp(3.5, -1.8, ring / (near ? 6 : 3));
          for (let k = 0; k < n; k++) { const h1 = hash1(k * 13 + ring, seed + 9), h2 = hash1(k, ring * 7 + seed), a = ((k + 0.5 * (ring & 1)) / n) * TAU, sc = size * (0.8 + 0.5 * h2), v = 0.085 + 0.1 * h2 * h2 + 0.03 * h1; stamp(g, protos[(k + ring) % protos.length], frame([c[0] + Math.cos(a) * rr, y - 0.5 + sc * 0.3, c[1] + Math.sin(a) * rr], h1 * TAU, (h2 - 0.5) * 0.8, (h1 - 0.5) * 0.8, sc), [v * 1.05, v, v * 0.93], [1.25, 0.72, 1.0]); }
        }
      }
      // the sea's bands on every stone, by its place in the world
      paint(g, g0, (P, N, C, i) => st.at(P[i] + ox, P[i + 1], P[i + 2] + oz, C, i));
    }
    // ---- crown wall with a recurved face, the walkway, a kerb ----
    {
      const wm = far ? RUB : CONC;
      const prof = far ? [[-3.25, 3.5], [-3.6, 5.3], [-2.2, 5.3], [-2.2, 3.74], [2.7, 3.7]] : [[-3.2, 3.2], [-3.3, 4.5], [-3.62, 5.05], [-3.62, 5.3], [-3.62, 5.3], [-2.2, 5.3], [-2.2, 5.3], [-2.2, 3.76], [-2.2, 3.76], [2.45, 3.72], [2.45, 3.72], [2.45, 3.98], [2.45, 3.98], [2.78, 3.98], [2.78, 3.98], [2.8, 3.3]];
      // hard edges where a profile point repeats: build the strips between them one by one
      let a = 0;
      const cp = (P, N, C, i) => {
        const wx = P[i] + ox, wz = P[i + 2] + oz, y = P[i + 1];
        const k = 0.82 + 0.34 * fb(wx * 0.35, y * 0.8, wz * 0.35);
        C[i] *= k; C[i + 1] *= k; C[i + 2] *= k;
        // damp and algae low on the seaward face, rust weeping from the rail fixings, tyre-dark down the middle of the deck
        if (N[i + 1] < 0.5) mixIn(C, i, 0.1, 0.12, 0.07, smooth(4.6, 3.4, y) * (0.3 + 0.5 * vn(wx * 0.6, 2, wz * 0.6)));
        else if (y < 4) mixIn(C, i, 0.2, 0.2, 0.19, 0.25 * vn(wx * 0.2, 1, wz * 0.2));
        mixIn(C, i, 0.62, 0.62, 0.58, smooth(0.72, 0.85, vn(wx * 1.3, y * 1.3, wz * 1.3)) * (N[i + 1] > 0.6 ? 0.4 : 0.06));
      };
      for (let b = 1; b <= prof.length; b++) if (b === prof.length || (prof[b][0] === prof[b - 1][0] && prof[b][1] === prof[b - 1][1])) {
        const seg = prof.slice(a, b);
        if (seg.length > 1) sheet(g, ss.length, seg.length, (i, j, out) => { const q = Q(ss[i], seg[j][0], seg[j][1]); out[0] = q[0]; out[1] = q[1]; out[2] = q[2]; }, concrete, wm, { paint: far ? undefined : cp, along: far ? undefined : (P, i) => { const dx = P[i] + ox - o.x, dz = P[i + 2] + oz - o.z; return s0 + dx * o.tx + dz * o.tz; } });
        a = b;
      }
    }
    // ---- fittings along the walkway ----
    if (!far) {
      const g0 = mark(g), railA = 2.62;
      // a rail on the harbour edge, on the kerb
      const pts = lin(s0, s1, Math.max(2, Math.round(len / 2))).map((s) => Q(s, railA, 3.98));
      railing(g, pts, rusty, RUB, { h: 1.05, every: 99, rails: near ? [0.36, 0.7, 1] : [0.55, 1], r: near ? 0.028 : 0.045, segs: 4 });
      for (let s = Math.ceil(s0 / 14) * 14; s < s1; s += 14) {
        const k = Math.round(s / 14);
        // bollards on the sea wall's foot; a lamp standard every other one, its light the next unit over
        if (near) bollard(g, Q(s + 1.5, -1.75, 3.76), 1.3, [0.06, 0.06, 0.065]);
        if (k % 2 === 0) {
          const b = Q(s, 2.2, 3.74), t = Q(s, 2.2, 8.6), arm = Q(s, 1.0, 9.0), lp = Q(s, 0.7, 8.92);
          tube(g, [b, t, arm], near ? [0.09, 0.06, 0.045] : [0.12, 0.09, 0.07], [0.28, 0.33, 0.3], RUB, { segs: near ? 6 : 4 });
          box(g, lp, 0.3, 0.07, 0.14, [0.2, 0.2, 0.21], RUB, { yaw: Math.atan2(o.tz, o.tx) + Math.PI / 2 });
          box(g, [lp[0], lp[1] - 0.075, lp[2]], 0.24, 0.012, 0.1, [0.9, 0.85, 0.7], LIT, { yaw: Math.atan2(o.tz, o.tx) + Math.PI / 2 });
          lamps.push(lamp([lp[0], lp[1] - 0.15, lp[2]], [1, 0.9, 0.7], 'flood', { size: 0.9 }));
          if (near) lathe(g, [[0.16, 0], [0.13, 0.5], [0.1, 0.55]], [0.28, 0.33, 0.3], RUB, { segs: 6, at: b });
        } else if (near) {
          // a life ring in its red housing on a post, a warning plate; iron rungs up the back of the wall
          const p = Q(s, 2.25, 3.74), yawN = Math.atan2(-nSea(rowAt(s))[1], -nSea(rowAt(s))[0]);
          rod(g, p, [p[0], p[1] + 1.5, p[2]], 0.04, [0.5, 0.06, 0.04], RUB, 5);
          box(g, [p[0], p[1] + 1.55, p[2]], 0.08, 0.42, 0.42, [0.5, 0.06, 0.04], RUB, { yaw: yawN });
          const n = nSea(rowAt(s)); lifering(g, [p[0] + n[0] * 0.1, p[1] + 1.55, p[2] + n[1] * 0.1], [n[0], 0, n[1]], 0.3);
          const w0 = Q(s + 4, -2.17, 3.9), w1 = Q(s + 4, -2.17, 5.35), tn = rowAt(s + 4);
          ladder(g, w0, w1, [tn.tx, 0, tn.tz], rusty, RUB, { w: 0.45, r: 0.025, step: 0.3, segs: 3 });
        }
      }
      if (near) {
        // what fishermen leave: stacked pots, fish boxes, a coil of warp, a net heap; a bench; drain covers
        const Rn = rng(seed * 131 + k0 * 17 + 3);
        for (let c = 0; c < 2; c++) {
          const s = s0 + 6 + Rn() * (len - 12), a = -1.2 + Rn() * 1.0, tn = rowAt(s), yaw = Math.atan2(tn.tz, tn.tx);
          if (Rn() < 0.75) for (let p = 0; p < 4; p++) { const q = Q(s + (p % 2) * 0.75, a, 3.78 + 0.22 + Math.floor(p / 2) * 0.42), s9 = mark(g); for (const x of [-0.3, 0, 0.3]) hoop(g, [x, 0, 0], [1, 0, 0], 0.21, 0.014, [0.05, 0.06, 0.07], RUB, 8, 3); for (let r = 0; r < 6; r++) { const an = (r / 6) * TAU; rod(g, [-0.3, Math.cos(an) * 0.21, Math.sin(an) * 0.21], [0.3, Math.cos(an) * 0.21, Math.sin(an) * 0.21], 0.008, [0.1, 0.25, 0.3], RUB, 3); } xf(g, s9, frame(q, yaw + (Rn() - 0.5) * 0.3)); }
          const q2 = Q(s + 2.2, a + 0.3, 3.78);
          for (let p = 0; p < 3; p++) box(g, [q2[0] + (p === 2 ? 0.1 : p * 0.72 * tn.tx), q2[1] + 0.13 + (p === 2 ? 0.27 : 0), q2[2] + (p === 2 ? 0.1 : p * 0.72 * tn.tz)], 0.33, 0.13, 0.22, [[0.05, 0.16, 0.42], [0.62, 0.2, 0.03], [0.4, 0.4, 0.38]][p], RUB, { yaw: yaw + Rn() * 0.4 });
          coil(g, Q(s - 1.6, a, 3.79), 0.38, [0.3, 0.42, 0.5], 4);
          blob(g, Q(s - 3.2, a - 0.3, 3.9), 0.7, 0.22, 0.5, [0.06, 0.2, 0.2], CLOTH, { n: 3, segs: 8 });
        }
        { const s = s0 + len * 0.5, q = Q(s, -1.85, 3.76), tn = rowAt(s), yaw = Math.atan2(tn.tz, tn.tx); box(g, [q[0], q[1] + 0.45, q[2]], 0.9, 0.03, 0.2, [0.3, 0.2, 0.1], RUB, { yaw }); box(g, [q[0], q[1] + 0.22, q[2]], 0.75, 0.22, 0.05, [0.3, 0.3, 0.3], RUB, { yaw }); }
      }
      paint(g, g0, mottle(seed + 3, 0.12, 1.5));
    }
    // ---- the head: a round platform and a white tower with a red band and a lantern ----
    if (isHead) {
      const e = rowAt(total), c = [e.x - ox, 0, e.z - oz], R0 = BREAKWATER.headR, at = c;
      lathe(g, far ? [[R0 + 4, -4], [R0 - 5, 1], [R0 - 8.5, 3.7], [0, 3.8]] : [[R0 + 3, -4.4], [R0 - 2, -2.2], [R0 - 6.5, 1.2], [R0 - 8.6, 3.0]], far ? [0.12, 0.118, 0.11] : [0.035, 0.035, 0.035], far ? RUB : GRAIN, { segs: far ? 12 : 20, at });
      if (!far) lathe(g, [[R0 - 8.6, 2.6], [R0 - 8.9, 3.8], [R0 - 8.9, 3.8], [0, 3.86]], concrete, CONC_FLAT, { segs: near ? 28 : 14, at, paint: mottle(seed, 0.14, 0.5) });
      const ty = 3.8, tw = [0.7, 0.69, 0.66], sg = far ? 8 : lod ? 10 : 20;
      lathe(g, [[2.1, ty], [2.05, ty + 0.5], [2.05, ty + 0.5], [1.95, ty + 0.5], [1.55, ty + 4.5], [1.45, ty + 5.2]], tw, far ? RUB : CONC, { segs: sg, at, along: far ? undefined : (P, i) => Math.atan2(P[i + 2] - c[2], P[i] - c[0]) * 1.8, paint: far ? undefined : both(mottle(seed + 8, 0.1, 0.8), rust(seed, { amt: 0.4, f: 1.2, top: ty + 5.2, len: 2.5 })) });
      lathe(g, [[1.45, ty + 5.2], [1.45, ty + 6.0]], [0.55, 0.05, 0.04], far ? RUB : GRAIN, { segs: sg, at });
      lathe(g, [[1.45, ty + 5.9], [2.25, ty + 6.05], [2.25, ty + 6.05], [2.25, ty + 6.25], [2.25, ty + 6.25], [1.0, ty + 6.25]], [0.4, 0.4, 0.4], RUB, { segs: sg, at });
      lathe(g, [[0.9, ty + 6.25], [0.9, ty + 7.6]], [0.03, 0.04, 0.05], GLS, { segs: far ? 8 : 12, at });
      lathe(g, [[0.3, ty + 6.6], [0.65, ty + 6.9], [0.3, ty + 7.3]], [1, 0.1, 0.06], LIT, { segs: far ? 6 : 10, at });
      lathe(g, [[1.05, ty + 7.55], [1.0, ty + 7.7], [0.7, ty + 8.4], [0.0, ty + 8.8]], [0.5, 0.05, 0.04], far ? RUB : GEL, { segs: far ? 8 : 14, at });
      if (!far) {
        for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; rod(g, [c[0] + Math.cos(a) * 0.92, ty + 6.25, c[2] + Math.sin(a) * 0.92], [c[0] + Math.cos(a) * 0.92, ty + 7.62, c[2] + Math.sin(a) * 0.92], lod ? 0.045 : 0.03, DARK, RUB, 3); }
        const rp = Array.from({ length: 13 }, (_, k) => [c[0] + Math.cos((k / 12) * TAU) * 2.15, ty + 6.25, c[2] + Math.sin((k / 12) * TAU) * 2.15]);
        railing(g, rp, DARK, RUB, { h: 0.95, every: 99, rails: near ? [0.5, 1] : [1], r: lod ? 0.04 : 0.025, segs: 4 });
        rod(g, [c[0], ty + 8.75, c[2]], [c[0], 14.2, c[2]], 0.03, [0.6, 0.6, 0.58], RUB, 4);
        if (near) {
          const da = Math.atan2(-e.tz, -e.tx);
          wallDoor(g, [c[0] + Math.cos(da) * 2.0, ty + 0.5, c[2] + Math.sin(da) * 2.0], [Math.cos(da), 0, Math.sin(da)], 0.8, 1.9, [0.05, 0.14, 0.1], 0);
          ladder(g, [c[0] + Math.cos(da + 1.6) * 2.0, ty + 0.5, c[2] + Math.sin(da + 1.6) * 2.0], [c[0] + Math.cos(da + 1.6) * 1.52, ty + 6.2, c[2] + Math.sin(da + 1.6) * 1.52], [-Math.sin(da + 1.6), 0, Math.cos(da + 1.6)], DARK, RUB, { w: 0.42, r: 0.022 });
          for (let k = 0; k < 4; k++) { const a = da + 0.9 + k * 1.3; bollard(g, [c[0] + Math.cos(a) * 5.4, ty + 0.06, c[2] + Math.sin(a) * 5.4], 1.3, [0.06, 0.06, 0.065]); }
          text(g, 'N', [c[0] + Math.cos(da - 0.9) * 1.9, ty + 2.6, c[2] + Math.sin(da - 0.9) * 1.9], [Math.sin(da - 0.9), 0, -Math.cos(da - 0.9)], [0, 1, 0], 0.6, [0.5, 0.05, 0.04], RUB, { off: 0.02, weight: 0.22 });
        }
        // a rail round the platform's rim
        railing(g, Array.from({ length: 25 }, (_, k) => [c[0] + Math.cos((k / 24) * TAU) * (R0 - 9.1), ty + 0.02, c[2] + Math.sin((k / 24) * TAU) * (R0 - 9.1)]).slice(3, 23), rusty, RUB, { h: 1.05, every: 99, rails: near ? [0.5, 1] : [1], r: near ? 0.028 : 0.045, segs: 4 });
      }
      lamps.push(lamp([c[0], ty + 7.0, c[2]], [1, 0.1, 0.06], 'flash', { period: 5, on: 0.9 }));
    }
    const mid = rowAt((s0 + s1) / 2);
    chunks.push({ g, lamps, x: ox, z: oz, cx: mid.x, cz: mid.z, r: len / 2 + 20 });
  }
  return chunks;
}

// =========================================================================================
// A piled beacon: three raking piles, a platform, a post with a topmark and a light
// =========================================================================================
// style: 'port' (red can), 'stbd' (green cone), 'north' (black over yellow, cones up), 'east', 'isolated'
export const BEACON = { radius: 3, height: 13 };
const BEACON_STYLES = {
  port: { body: [0.5, 0.05, 0.04], band: [0.5, 0.05, 0.04], lens: [1, 0.1, 0.06], mark: 'can', period: 4, name: 'P4' },
  stbd: { body: [0.04, 0.32, 0.1], band: [0.04, 0.32, 0.1], lens: [0.1, 1, 0.25], mark: 'cone', period: 4, name: 'S3' },
  north: { body: [0.04, 0.04, 0.045], band: [0.62, 0.5, 0.05], lens: [1, 1, 1], mark: 'cones', period: 3, name: 'N' },
  isolated: { body: [0.04, 0.04, 0.045], band: [0.5, 0.05, 0.04], lens: [1, 1, 1], mark: 'balls', period: 6, name: 'ID' },
};
export function beaconGeo(style = 'port', lod = 0, seed = 1) {
  const S = BEACON_STYLES[style] || BEACON_STYLES.port, g = new Geo(lod ? 2048 : 16384), lamps = [];
  const near = lod === 0, far = lod === 2;
  const pile = [0.2, 0.17, 0.14], galv = [0.42, 0.44, 0.46], rnd = rng(seed), a0 = rnd() * TAU;
  const PY = 6.0;
  const pa = (k) => a0 + (k / 3) * TAU, pr = (y) => lerp(2.2, 1.0, (y + 4) / 10.2);
  const s0 = mark(g);
  // ---- three raking steel piles with collars, ties and diagonals between them ----
  for (let k = 0; k < 3; k++) {
    const a = pa(k);
    tube(g, [polar(2.2, a, -4), polar(1.55, a, 1.5), polar(1.0, a, PY + 0.2)], 0.3, pile, RUB, { segs: far ? 5 : lod ? 6 : 12, caps: true });
    if (!far) for (const y of [2.6, 4.9]) lathe(g, [[0.3, -0.12], [0.36, -0.1], [0.36, 0.1], [0.3, 0.12]], pile, RUB, { segs: lod ? 6 : 10, at: polar(pr(y), a, y) });
  }
  if (!far) for (let k = 0; k < 3; k++) {
    const a = pa(k), b = pa(k + 1);
    for (const y of [1.3, 3.7]) rod(g, polar(pr(y), a, y), polar(pr(y), b, y), lod ? 0.1 : 0.08, pile, RUB, lod ? 4 : 6);
    rod(g, polar(pr(1.3), a, 1.3), polar(pr(3.7), b, 3.7), lod ? 0.08 : 0.06, pile, RUB, 4);
    if (near) { rod(g, polar(pr(3.7), a, 3.7), polar(pr(5.6), b, 5.6), 0.05, pile, RUB, 4); box(g, polar(pr(-0.6) - 0.34, a, -0.6), 0.06, 0.35, 0.1, [0.5, 0.5, 0.48], RUB, { yaw: a }); }
  }
  // the sea's work on the steel: weed and shell to the top of the tide, rust above it, a bleached band where spray dries
  paint(g, s0, both(rust(seed, { amt: 0.75, f: 2.6, lo: 0.42, hi: 0.75 }), stain(seed, { weedTop: 0.9, tide: 1.2, wet: 1.9, salt: 0.3 })));
  if (near) {
    // boat ladder up one pile through a hoop cage, a timber fender on chains, a tide board
    const la = pa(0) + 0.0, lo = polar(pr(-1) + 0.42, la, -1.2), hi = polar(pr(PY) + 0.5, la, PY + 1.15), side = [-Math.sin(la), 0, Math.cos(la)];
    ladder(g, lo, hi, side, galv, MET, { w: 0.42, r: 0.025, step: 0.3, segs: 4 });
    for (let y = 3.2; y < PY + 1; y += 0.75) { const f = (y - lo[1]) / (hi[1] - lo[1]), c = [lerp(lo[0], hi[0], f) + Math.cos(la) * 0.33, y, lerp(lo[2], hi[2], f) + Math.sin(la) * 0.33]; hoop(g, c, [0, 1, 0], 0.36, 0.014, galv, MET, 10, 3); }
    for (const o of [-0.3, 0.3]) rod(g, [lerp(lo[0], hi[0], 0.55) + Math.cos(la) * (0.33 + 0.36) + side[0] * o, 3.2, lerp(lo[2], hi[2], 0.55) + Math.sin(la) * 0.69 + side[2] * o], [hi[0] + Math.cos(la) * 0.69 + side[0] * o, PY + 1.0, hi[2] + Math.sin(la) * 0.69 + side[2] * o], 0.012, galv, MET, 3);
    const fa = pa(1), f0 = polar(pr(-0.8) + 0.36, fa, -0.9), f1 = polar(pr(2.6) + 0.36, fa, 2.6);
    tube(g, [f0, f1], 0.13, [0.14, 0.1, 0.06], GRAIN, { segs: 6, caps: true, paint: stain(seed + 4, { weedTop: 0.9, tide: 1.2, wet: 1.9 }) });
    for (const f of [0.2, 0.85]) hoop(g, [lerp(f0[0], f1[0], f), lerp(f0[1], f1[1], f), lerp(f0[2], f1[2], f)], [0, 1, 0.1], 0.2, 0.02, [0.2, 0.12, 0.07], RUB, 8, 3);
    const ta = pa(2), tb = polar(pr(1.5) + 0.33, ta, 1.6), tn = [Math.cos(ta), 0, Math.sin(ta)], tt = [-tn[2], 0, tn[0]];
    box(g, tb, 0.02, 1.3, 0.14, [0.75, 0.75, 0.72], RUB, { yaw: ta });
    for (let m = 0; m < 5; m++) text(g, String(m), [tb[0] + tn[0] * 0.022 - tt[0] * 0.05, 0.42 + m * 0.5, tb[2] + tn[2] * 0.022 - tt[2] * 0.05], tt, [0, 1, 0], 0.16, [0.05, 0.05, 0.06], RUB, { off: 0.004, weight: 0.2 });
    for (let m = 0; m < 10; m++) box(g, [tb[0] + tn[0] * 0.022 + tt[0] * 0.09, 0.42 + m * 0.25, tb[2] + tn[2] * 0.022 + tt[2] * 0.09], 0.003, 0.012, 0.04, [0.05, 0.05, 0.06], RUB, { yaw: ta });
  }
  // ---- platform: a steel deck of grating in a channel frame, rails with a toe board ----
  const g1 = mark(g);
  lathe(g, [[0.0, PY], [1.9, PY], [1.9, PY], [1.95, PY + 0.02], [1.95, PY + 0.24], [1.9, PY + 0.26], [1.9, PY + 0.26], [0.0, PY + 0.26]], [0.25, 0.26, 0.26], far ? RUB : NSK, { segs: far ? 8 : lod ? 12 : 24 });
  if (!far) {
    const np = lod ? 8 : 12, rp = Array.from({ length: np + 1 }, (_, k) => polar(1.8, a0 + 0.35 + (k / np) * (TAU - 0.7), PY + 0.26));
    railing(g, rp, galv, MET, { h: 0.94, every: 99, rails: near ? [0.36, 0.68, 1] : [0.55, 1], r: lod ? 0.03 : 0.02, segs: 4, kick: near ? 0.12 : 0 });
    if (near) for (let k = 0; k < 6; k++) { const a = pa(k / 2) + 0.5; rod(g, polar(0.9, a, PY - 0.14), polar(1.9, a, PY - 0.14), 0.07, pile, RUB, 4); }
  }
  // ---- what keeps the light burning: battery cabinet, solar panels on a frame, an aerial, a radar reflector ----
  if (!far) {
    const ca = a0 + Math.PI, cp = polar(1.0, ca, PY + 0.26);
    box(g, [cp[0], cp[1] + 0.45, cp[2]], 0.3, 0.45, 0.42, [0.5, 0.52, 0.5], GEL, { yaw: ca });
    if (near) { for (let k = 0; k < 4; k++) box(g, [cp[0] - Math.cos(ca) * 0.305, cp[1] + 0.25 + k * 0.07, cp[2] - Math.sin(ca) * 0.305], 0.004, 0.02, 0.3, DARK, RUB, { yaw: ca }); box(g, [cp[0] - Math.cos(ca) * 0.31, cp[1] + 0.6, cp[2] - Math.sin(ca) * 0.31 + 0.3 * Math.cos(ca)], 0.02, 0.05, 0.03, [0.6, 0.5, 0.1], MET, { yaw: ca }); box(g, [cp[0], cp[1] + 0.92, cp[2]], 0.34, 0.02, 0.46, [0.42, 0.44, 0.42], GEL, { yaw: ca }); }
    for (const da of [-0.55, 0.55]) {
      const s9 = mark(g);
      quad(g, [-0.45, 0, 0], [0.45, 0, 0], [0.45, 0.62, 0.42], [-0.45, 0.62, 0.42], [0.03, 0.05, 0.14], GLS);
      if (near) { tube(g, [[-0.45, 0, 0], [0.45, 0, 0], [0.45, 0.62, 0.42], [-0.45, 0.62, 0.42]], 0.018, [0.6, 0.6, 0.6], MET, { segs: 3, closed: true }); for (const x of [-0.15, 0.15]) rod(g, [x, 0.004, 0.003], [x, 0.624, 0.423], 0.006, [0.5, 0.5, 0.55], MET, 3); for (const x of [-0.35, 0.35]) rod(g, [x, 0.6, 0.4], [x, -0.75, 0.25], 0.02, galv, MET, 4); }
      xf(g, s9, frame(polar(1.86, a0 + da + 1.2, PY + 1.25), -(a0 + da + 1.2) + Math.PI / 2));
    }
    if (near) { rod(g, polar(1.7, a0 + 2.6, PY + 1.2), polar(1.75, a0 + 2.6, PY + 3.4), 0.01, DARK, RUB, 3); lifering(g, polar(1.84, a0 + 4.4, PY + 0.75), [Math.cos(a0 + 4.4), 0, Math.sin(a0 + 4.4)], 0.26); }
  }
  // ---- post, painted in the mark's bands, with climbing rungs and a number board ----
  const post = (y0, y1, col) => lathe(g, [[0.2, y0], [0.2, y1]], col, far ? RUB : GEL, { segs: far ? 5 : lod ? 6 : 12 });
  post(PY + 0.26, 8.0, style === 'north' || style === 'isolated' ? S.band : S.body); post(8.0, 9.6, style === 'north' ? S.body : S.band); post(9.6, 10.3, S.body);
  if (near) {
    lathe(g, [[0.34, PY + 0.26], [0.34, PY + 0.32], [0.22, PY + 0.34]], galv, MET, { segs: 10 });
    for (let y = PY + 0.7; y < 10.2; y += 0.32) rod(g, [0.2, y, -0.14], [0.2, y, 0.14], 0.012, galv, MET, 3);
    for (const sg of [-1, 1]) { box(g, [0, 8.8, sg * 0.24], 0.32, 0.26, 0.012, [0.76, 0.76, 0.72], RUB); text(g, S.name, [-0.02 * sg, 8.62, sg * 0.254], [sg, 0, 0], [0, 1, 0], 0.34, S.body[0] + S.body[1] > 0.3 ? S.body : [0.03, 0.03, 0.035], RUB, { off: 0.003, weight: 0.2, centre: true }); }
  }
  // ---- lantern: a ribbed lens in a guarded housing ----
  lathe(g, [[0.2, 10.3], [0.44, 10.32], [0.44, 10.32], [0.44, 10.46], [0.5, 10.5]], [0.12, 0.12, 0.13], far ? RUB : MET, { segs: far ? 6 : 12 });
  { const prof = [], n = far ? 1 : lod ? 2 : 5; for (let k = 0; k <= n * 2; k++) prof.push([0.4 + (k % 2 ? 0.03 : 0), 10.5 + (0.8 * k) / (n * 2)]); lathe(g, prof, S.lens, LIT, { segs: far ? 6 : 12 }); }
  lathe(g, [[0.5, 11.3], [0.5, 11.36], [0.42, 11.44], [0.06, 11.56], [0.06, 11.6]], [0.12, 0.12, 0.13], far ? RUB : MET, { segs: far ? 6 : 12 });
  if (near) { for (let k = 0; k < 4; k++) { const a = (k / 4) * TAU + 0.4; rod(g, polar(0.47, a, 10.5), polar(0.47, a, 11.32), 0.012, galv, MET, 3); } for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; rod(g, polar(0.44, a, 11.38), polar(0.56, a, 11.62), 0.005, galv, MET, 3); } }
  lamps.push(lamp([0, 10.9, 0], S.lens, 'flash', { period: S.period, on: 0.7 }));
  // ---- top mark ----
  const tm = far ? RUB : GEL, ts = far ? 6 : lod ? 8 : 16, black = [0.04, 0.04, 0.045];
  rod(g, [0, 11.5, 0], [0, 12.9, 0], 0.035, black, RUB, 4);
  if (S.mark === 'can') lathe(g, [[0.0, 11.75], [0.5, 11.75], [0.5, 11.75], [0.5, 12.65], [0.5, 12.65], [0.0, 12.65]], S.body, tm, { segs: ts });
  else if (S.mark === 'cone') lathe(g, [[0.0, 11.7], [0.56, 11.7], [0.56, 11.7], [0.0, 12.9]], S.body, tm, { segs: ts });
  else if (S.mark === 'cones') for (const y of [11.65, 12.3]) lathe(g, [[0.0, y], [0.42, y], [0.42, y], [0.0, y + 0.62]], black, tm, { segs: ts });
  else for (const y of [11.95, 12.6]) blob(g, [0, y, 0], 0.3, 0.3, 0.3, black, tm, { n: far ? 2 : 5, segs: ts });
  if (!far) paint(g, g1, both(faded(seed + 6, 0.35), guano(seed, 0.7, 5, 0.78)));
  return { g, lamps };
}

// =========================================================================================
// Offshore platform: a jacket on four legs, decks of process plant, accommodation with a helideck,
// a drilling derrick, cranes, a flare
// =========================================================================================
export const PLATFORM = { deckY: 17, radius: 40, height: 58, flareTip: [-38, 52, -25] };
const LEG = (y) => [lerp(18, 13.5, (y + 6) / 23), lerp(14, 9.5, (y + 6) / 23)];   // half extents of the leg frame at height y
// a run of parallel pipes on supports, with flanges
function pipeRun(g, a, b, n, pitch, r, cols, lod, up = [0, 1, 0]) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(d[0], d[1], d[2]), t = [d[0] / L, d[1] / L, d[2] / L];
  const s = [t[1] * up[2] - t[2] * up[1], t[2] * up[0] - t[0] * up[2], t[0] * up[1] - t[1] * up[0]];
  for (let k = 0; k < n; k++) {
    const o = (k - (n - 1) / 2) * pitch, p0 = [a[0] + s[0] * o, a[1] + s[1] * o, a[2] + s[2] * o], p1 = [b[0] + s[0] * o, b[1] + s[1] * o, b[2] + s[2] * o], col = cols[k % cols.length];
    rod(g, p0, p1, r, col, RUB, lod ? 4 : 6);
    if (!lod) for (let f = 0.18 + 0.1 * (k % 3); f < 1; f += 0.33) { const c = [lerp(p0[0], p1[0], f), lerp(p0[1], p1[1], f), lerp(p0[2], p1[2], f)]; tube(g, [[c[0] - t[0] * 0.06, c[1] - t[1] * 0.06, c[2] - t[2] * 0.06], [c[0] + t[0] * 0.06, c[1] + t[1] * 0.06, c[2] + t[2] * 0.06]], r * 1.7, scl(col, 0.8), RUB, { segs: 6, caps: true }); }
  }
  if (!lod) for (let f = 0.1; f < 1; f += 0.25) { const c = [lerp(a[0], b[0], f), lerp(a[1], b[1], f), lerp(a[2], b[2], f)], w = (n * pitch) / 2 + 0.1; rod(g, [c[0] - s[0] * w, c[1] - s[1] * w - r * 1.2, c[2] - s[2] * w], [c[0] + s[0] * w, c[1] + s[1] * w - r * 1.2, c[2] + s[2] * w], 0.07, [0.3, 0.31, 0.32], RUB, 4); }
}
// a module: a clad box with a framed base, doors and louvres on its long sides, and a railed roof
function module(g, x0, x1, y0, y1, z0, z1, col, lod, { roof = true, doors = true } = {}) {
  slab(g, x0, x1, y0, y1, z0, z1, col, lod === 2 ? RUB : CORR);
  if (lod === 2) return;
  slab(g, x0 - 0.1, x1 + 0.1, y0, y0 + 0.3, z0 - 0.1, z1 + 0.1, [0.25, 0.26, 0.27], RUB);
  slab(g, x0 - 0.12, x1 + 0.12, y1 - 0.05, y1 + 0.12, z0 - 0.12, z1 + 0.12, scl(col, 0.8), RUB);
  if (lod) return;
  if (doors) for (const z of [z0 - 0.03, z1 + 0.03]) { const n = [0, 0, z < (z0 + z1) / 2 ? -1 : 1]; for (let x = x0 + 1.4; x < x1 - 1; x += 4.2) { wallDoor(g, [x, y0 + 0.3, z], n, 0.95, 2.05, [0.5, 0.42, 0.06], 0); for (let k = 0; k < 5; k++) box(g, [x + 1.8, y0 + 1.6 + k * 0.16, z + n[2] * 0.03], 0.5, 0.05, 0.03, [0.2, 0.2, 0.21], RUB); } }
  if (roof) railing(g, [[x0, y1 + 0.12, z0], [x1, y1 + 0.12, z0], [x1, y1 + 0.12, z1], [x0, y1 + 0.12, z1], [x0, y1 + 0.12, z0]], [0.62, 0.5, 0.05], RUB, { h: 1.1, every: 2.6, r: 0.035, segs: 3 });
}
// a flight of stairs from a (bottom) to b (top), w wide along `side`, with stringers and a rail
function stairs(g, a, b, side, w, col, lod) {
  const n = Math.max(2, Math.round((b[1] - a[1]) / 0.25)), hw = w / 2;
  for (const s of [-1, 1]) rod(g, [a[0] + side[0] * hw * s, a[1], a[2] + side[2] * hw * s], [b[0] + side[0] * hw * s, b[1], b[2] + side[2] * hw * s], 0.07, col, RUB, 4);
  if (!lod) for (let k = 0; k < n; k++) { const f = (k + 0.5) / n, c = [lerp(a[0], b[0], f), lerp(a[1], b[1], f), lerp(a[2], b[2], f)]; box(g, c, side[0] ? hw : 0.13, 0.015, side[2] ? hw : 0.13, [0.3, 0.31, 0.32], RUB); }
  for (const s of [-1, 1]) railing(g, [[a[0] + side[0] * hw * s, a[1], a[2] + side[2] * hw * s], [b[0] + side[0] * hw * s, b[1], b[2] + side[2] * hw * s]], [0.62, 0.5, 0.05], RUB, { h: 1.0, every: 1.8, rails: lod ? [1] : [0.5, 1], r: lod ? 0.05 : 0.03, segs: 3 });
}
export function platformGeo(lod = 0, seed = 2) {
  const g = new Geo(lod === 0 ? 131072 : 8192), lamps = [], near = lod === 0, far = lod === 2;
  const steel = [0.24, 0.26, 0.28], white = [0.64, 0.65, 0.64], blue = [0.07, 0.14, 0.28], orange = [0.62, 0.2, 0.04], deckC = [0.19, 0.2, 0.21], yellow = [0.62, 0.5, 0.05], grey = [0.4, 0.41, 0.42], green = [0.08, 0.22, 0.15];
  const dy = PLATFORM.deckY, D1 = dy + 1.4;   // the top of the main deck
  const corners = (y) => { const [hx, hz] = LEG(y); return [[-hx, y, -hz], [hx, y, -hz], [hx, y, hz], [-hx, y, hz]]; };
  // ---- the jacket: four battered legs, horizontal frames and X bracing on every face, plan bracing at the waterline ----
  const j0 = mark(g), ls = far ? 5 : lod ? 8 : 14;
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) tube(g, [-6, 3.3, 4.3, dy].map((y) => { const [hx, hz] = LEG(y); return [sx * hx, y, sz * hz]; }), 1.05, steel, RUB, { segs: ls });
  const levels = far ? [-1.5, 14] : [-1.5, 4.5, 9.5, 14];
  for (let li = 0; li < levels.length; li++) {
    const c = corners(levels[li]);
    if (!far) for (let k = 0; k < 4; k++) rod(g, c[k], c[(k + 1) % 4], 0.42, steel, RUB, lod ? 4 : 8);
    if (near && li < 2) { rod(g, c[0], c[2], 0.3, steel, RUB, 6); rod(g, c[1], c[3], 0.3, steel, RUB, 6); }
    if (li === levels.length - 1) continue;
    const d = corners(levels[li + 1]);
    for (let k = 0; k < 4; k++) { const k2 = (k + 1) % 4; rod(g, c[k], d[k2], far ? 0.5 : 0.38, steel, RUB, far ? 3 : lod ? 4 : 8); if (!far) rod(g, c[k2], d[k], 0.38, steel, RUB, lod ? 4 : 8); }
  }
  if (!far) {
    // conductors and risers down through the jacket, a caisson, anodes on the legs
    for (let k = 0; k < 6; k++) rod(g, [6 + (k % 3) * 1.5, -6, -2 + Math.floor(k / 3) * 1.6], [6 + (k % 3) * 1.5, dy - 2, -2 + Math.floor(k / 3) * 1.6], 0.38, [0.3, 0.2, 0.12], RUB, lod ? 4 : 8);
    for (const [x, z, r] of [[-9, 6, 0.3], [-10.5, -7, 0.45], [12, 7.5, 0.25]]) rod(g, [x, -6, z], [x, dy - 2, z], r, steel, RUB, lod ? 4 : 6);
    // the boat landing on the +x face: fender posts, a platform at the top of the tide, a ladder up to the cellar deck
    const [lx, lz] = LEG(1.5);
    for (let k = 0; k < 5; k++) rod(g, [lx + 2.6, -2.5, -4 + k * 2], [lx + 2.2, 4.2, -4 + k * 2], 0.22, [0.05, 0.05, 0.055], RUB, lod ? 4 : 6);
    for (const y of [0.4, 3.9]) rod(g, [lx + 2.5, y, -4.4], [lx + 2.5, y, 4.4], 0.18, yellow, RUB, 5);
    slab(g, lx + 0.3, lx + 2.3, 3.9, 4.05, -3.5, 3.5, [0.3, 0.31, 0.32], NSK);
    for (const z of [-3.4, 3.4]) rod(g, [lx - 0.6, 4, z * 0.9], [lx + 2.2, 4, z], 0.2, steel, RUB, 5);
    if (near) { railing(g, [[lx + 0.4, 4.05, -3.45], [lx + 2.25, 4.05, -3.45]], yellow, RUB, { h: 1.1, every: 1.2, r: 0.03, segs: 3 }); railing(g, [[lx + 0.4, 4.05, 3.45], [lx + 2.25, 4.05, 3.45]], yellow, RUB, { h: 1.1, every: 1.2, r: 0.03, segs: 3 }); ladder(g, [lx + 0.5, 4.05, 0], [lx - 1.9, dy - 2.2, 0], [0, 0, 1], yellow, RUB, { w: 0.6, r: 0.035, step: 0.33, segs: 4 }); for (let y = 6.5; y < dy - 3; y += 1.1) { const f = (y - 4.05) / (dy - 2.2 - 4.05); hoop(g, [lx + 0.5 - 2.4 * f + 0.4, y, 0], [0, 1, 0], 0.45, 0.02, yellow, RUB, 10, 3); } lifering(g, [lx + 2.3, 4.7, -3.5], [1, 0, 0], 0.34); }
  }
  // the splash zone: a coat of yellow to the top of the waves, weed and shell below, rust weeping down the steel above
  paint(g, j0, both((P, N, C, i) => { const y = P[i + 1]; if (y < 4.3 && C[i] < 0.3 && C[i + 2] > 0.2) mixIn(C, i, 0.5, 0.4, 0.06, smooth(4.3, 3.3, y) * 0.9); }, far ? () => {} : rust(seed, { amt: 0.6, f: 0.9, lo: 0.5, hi: 0.8 }), stain(seed, { weedTop: 1.6, tide: 2.4, wet: 3.4, salt: 0.2 })));
  // ---- decks: cellar deck, main deck on a grid of girders ----
  slab(g, -20, 20, dy, D1, -14.5, 14.5, deckC, far ? RUB : NSK);
  if (!far) {
    slab(g, -18, 18, dy - 2.4, dy - 2.2, -12.5, 12.5, [0.16, 0.17, 0.18], NSK);
    for (let k = 0; k < (lod ? 4 : 9); k++) { const x = lerp(-19, 19, k / (lod ? 3 : 8)); slab(g, x - 0.2, x + 0.2, dy - 1.1, dy, -14.3, 14.3, [0.2, 0.21, 0.22], RUB); }
    for (const z of [-13.8, -7, 0, 7, 13.8]) slab(g, -19.8, 19.8, dy - 1.3, dy, z - 0.25, z + 0.25, [0.2, 0.21, 0.22], RUB);
    for (const [x, z] of [[-17, -12], [17, -12], [17, 12], [-17, 12], [0, -12], [0, 12]]) rod(g, [x, dy - 2.3, z], [x, dy - 1, z], 0.25, steel, RUB, 5);
    // under the deck: headers, a drain caisson, cable trays (what a boat passing beneath looks up at)
    pipeRun(g, [-16, dy - 1.7, -5], [16, dy - 1.7, -5], near ? 5 : 3, 0.7, 0.24, [[0.5, 0.52, 0.5], [0.45, 0.2, 0.08], [0.55, 0.45, 0.1]], lod);
    pipeRun(g, [-14, dy - 1.75, 6.5], [14, dy - 1.75, 6.5], near ? 4 : 2, 0.8, 0.3, [[0.3, 0.33, 0.36], [0.5, 0.52, 0.5]], lod);
    if (near) { slab(g, -17, 17, dy - 1.45, dy - 1.38, 9.6, 10.6, [0.42, 0.44, 0.46], RUB); railing(g, [[-18, dy - 2.2, -12.5], [18, dy - 2.2, -12.5], [18, dy - 2.2, 12.5], [-18, dy - 2.2, 12.5], [-18, dy - 2.2, -12.5]], yellow, RUB, { h: 1.1, every: 3, r: 0.04, segs: 3 }); }
  }
  // ---- the main deck's rail ----
  if (!far) railing(g, [[-20, D1, -14.5], [20, D1, -14.5], [20, D1, 14.5], [-20, D1, 14.5]], yellow, RUB, { h: 1.15, every: 2.5, rails: near ? [0.5, 1] : [1], r: lod ? 0.06 : 0.035, segs: 3, kick: near ? 0.15 : 0, noPosts: !!lod });
  // ---- process plant ----
  module(g, -3, 11, D1, D1 + 5.6, -10.5, -2.5, white, lod);                       // separation
  module(g, 12, 19.3, D1, D1 + 7.2, -12.8, -5.5, blue, lod);                      // power generation
  module(g, -3, 6, D1, D1 + 4.4, 4.5, 12.5, orange, lod, { roof: false });        // compression, open-topped
  module(g, 3, 13.5, D1 + 5.72, D1 + 9.8, -9.5, -3.5, grey, lod, { doors: false });   // the drill floor's substructure
  if (!far) {
    // exhaust stacks on the power module, sooty at the lip
    for (const z of [-11.4, -9, -6.8]) lathe(g, [[0.55, 0], [0.55, 6.5], [0.55, 6.5], [0.62, 6.52], [0.62, 7.0], [0.5, 7.0]], [0.5, 0.5, 0.48], RUB, { segs: lod ? 6 : 10, at: [17, D1 + 7.3, z], paint: (P, N, C, i) => { const k = smooth(D1 + 11.5, D1 + 14.2, P[i + 1]); mixIn(C, i, 0.03, 0.03, 0.03, k * 0.9); } });
    // separators: long vessels on saddles, with nozzles and a manway; a pipe rack between the modules
    for (const [x, z, r, l, c] of [[-0.5, 1.2, 1.0, 4.4, [0.55, 0.56, 0.55]], [-0.5, -0.9, 0.75, 3.6, [0.55, 0.56, 0.55]], [8.5, 9.5, 1.15, 3.4, [0.5, 0.42, 0.1]], [8.5, 6.4, 0.8, 3.0, [0.3, 0.36, 0.42]]]) {
      lathe(g, [[0.0, -l - r * 0.5], [r * 0.7, -l - r * 0.3], [r, -l], [r, l], [r * 0.7, l + r * 0.3], [0, l + r * 0.5]], c, GEL, { segs: lod ? 8 : 14, axis: 'x', at: [x, D1 + r + 0.5, z], paint: near ? rust(seed + x, { amt: 0.35, f: 1.4 }) : undefined });
      for (const o of [-l * 0.6, l * 0.6]) box(g, [x + o, D1 + 0.3, z], 0.15, 0.4, r * 0.8, [0.3, 0.31, 0.32], RUB);
      if (near) { for (const o of [-l * 0.5, 0, l * 0.5]) lathe(g, [[0.14, r - 0.05], [0.14, r + 0.4], [0.24, r + 0.4], [0.24, r + 0.46], [0, r + 0.46]], c, GEL, { segs: 6, at: [x + o, D1 + r + 0.5, z] }); lathe(g, [[0.4, 0], [0.4, 0.2], [0, 0.22]], scl(c, 0.8), GEL, { segs: 8, axis: 'x', at: [x + l + r * 0.42, D1 + r + 0.5, z] }); }
    }
    pipeRun(g, [-3, D1 + 2.6, 2.6], [15, D1 + 2.6, 2.6], near ? 6 : 3, 0.5, 0.18, [[0.5, 0.52, 0.5], [0.55, 0.45, 0.1], [0.45, 0.2, 0.08], [0.3, 0.36, 0.42]], lod);
    pipeRun(g, [14.6, D1 + 2.6, 3], [14.6, D1 + 2.6, -5.3], near ? 4 : 2, 0.5, 0.18, [[0.5, 0.52, 0.5], [0.55, 0.45, 0.1]], lod);
    if (near) {
      for (const x of [-2, 4, 10, 15]) for (const z of [1.2, 4.0]) rod(g, [x, D1, z], [x, D1 + 2.45, z], 0.1, steel, RUB, 4);
      // storage tanks, a laydown of crates and drums, gas bottles in a rack
      for (const [x, z] of [[14.5, 9.5], [17.3, 9.5], [16, 12.2]]) lathe(g, [[1.15, 0], [1.15, 3.6], [0.9, 4.2], [0, 4.4]], [0.62, 0.63, 0.62], GEL, { segs: 12, at: [x, D1, z], paint: rust(seed + z, { amt: 0.35, f: 1.2, top: D1 + 3.6, len: 2 }) });
      for (let k = 0; k < 7; k++) { const x = -1 + (k % 4) * 1.5, z = -13.2 + Math.floor(k / 4) * 1.3; box(g, [x, D1 + 0.55, z], 0.6, 0.55, 0.5, [[0.3, 0.2, 0.1], [0.05, 0.16, 0.42], [0.5, 0.06, 0.04]][k % 3], RUB, { yaw: 0.1 * k }); }
      for (let k = 0; k < 8; k++) lathe(g, [[0.3, 0], [0.3, 0.9], [0, 0.9]], k % 3 ? [0.05, 0.16, 0.42] : [0.5, 0.06, 0.04], RUB, { segs: 8, at: [6.5 + (k % 4) * 0.66, D1, -13.6 + Math.floor(k / 4) * 0.66] });
      for (let k = 0; k < 6; k++) lathe(g, [[0.12, 0], [0.12, 1.4], [0.05, 1.55], [0, 1.56]], k % 2 ? [0.5, 0.42, 0.06] : [0.35, 0.1, 0.08], RUB, { segs: 6, at: [10.3 + k * 0.3, D1, 13.8] });
      // stair towers between the levels
      stairs(g, [11.5, D1, -1.9], [5.5, D1 + 5.72, -1.9], [0, 0, 1], 1.0, steel, 0);
      stairs(g, [19.3, dy - 2.2, 11.4], [19.3, D1, 6.4], [1, 0, 0], 1.0, steel, 0);
      stairs(g, [3, D1 + 5.72, -11.2], [10, D1 + 9.92, -11.2], [0, 0, 1], 1.0, steel, 0);
    }
  }
  // ---- derrick over the drill floor, with its crown block, a pipe rack and the V-door ramp ----
  {
    const cx = 8.2, cz = -6.5, y0 = D1 + 9.92, y1 = PLATFORM.height - 1.2;
    derrick(g, cx, cz, y0, y1, 3.0, 0.9, far ? 3 : lod ? 5 : 9, [0.55, 0.56, 0.56], far ? 0.22 : lod ? 0.13 : 0.09, lod);
    slab(g, cx - 1.3, cx + 1.3, y1, y1 + 0.5, cz - 1.3, cz + 1.3, yellow, RUB);
    if (!far) { rod(g, [cx, y1, cz], [cx, y0 + 6, cz], 0.06, [0.1, 0.1, 0.1], RUB, 3); box(g, [cx, y0 + 5.2, cz], 0.5, 0.8, 0.35, yellow, RUB); for (let k = 0; k < (near ? 9 : 4); k++) rod(g, [cx - 2.2 + (k % 3) * 0.3, y0, cz + 1.4 + Math.floor(k / 3) * 0.3], [cx - 1.6 + (k % 3) * 0.2, y0 + 17.5, cz + 0.8], 0.09, [0.3, 0.2, 0.12], RUB, 4); slab(g, cx - 3.2, cx + 3.2, y0 - 0.12, y0, cz - 3.2, cz + 3.2, [0.3, 0.31, 0.32], NSK); if (near) { railing(g, [[cx - 3.2, y0, cz - 3.2], [cx + 3.2, y0, cz - 3.2], [cx + 3.2, y0, cz + 3.2]], yellow, RUB, { h: 1.1, every: 1.6, r: 0.035, segs: 3 }); quad(g, [cx - 3.2, y0, cz + 1], [cx - 3.2, y0, cz + 3], [cx - 9.5, D1 + 5.75, cz + 3], [cx - 9.5, D1 + 5.75, cz + 1], [0.3, 0.31, 0.32], NSK); } }
  }
  // ---- accommodation at the -x end: four storeys of cabins, the helideck over them ----
  const ax0 = -19.5, ax1 = -4.5, az0 = -6, az1 = 6.5, ay0 = D1, st = 3.25, ay1 = ay0 + 4 * st;
  {
    const wall = (y0, y1, col, m) => { for (const [a, b] of [[[ax0, az0], [ax1, az0]], [[ax1, az0], [ax1, az1]], [[ax1, az1], [ax0, az1]], [[ax0, az1], [ax0, az0]]]) quad(g, [a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], col, m); };
    const wc = [0.66, 0.66, 0.62];
    for (let f = 0; f < 4; f++) {
      const y = ay0 + f * st;
      wall(y, y + 1.3, wc, far ? RUB : PLATE); wall(y + 2.35, y + st, wc, far ? RUB : PLATE);
      if (!near) { wall(y + 1.3, y + 2.35, [0.1, 0.11, 0.13], GLS); continue; }
      // windows between piers on every side, a few of them lit
      const strip = (a, b, n) => { for (let k = 0; k < n * 2 + 1; k++) { const f0 = k / (n * 2 + 1), f1 = (k + 1) / (n * 2 + 1), gl = k % 2 === 1, lit = gl && hash1(k * 7 + f * 13, Math.round(a[0] + a[1] * 3)) > 0.72; quad(g, [lerp(a[0], b[0], f0), y + 1.3, lerp(a[1], b[1], f0)], [lerp(a[0], b[0], f1), y + 1.3, lerp(a[1], b[1], f1)], [lerp(a[0], b[0], f1), y + 2.35, lerp(a[1], b[1], f1)], [lerp(a[0], b[0], f0), y + 2.35, lerp(a[1], b[1], f0)], gl ? (lit ? [0.9, 0.7, 0.35] : GLASS) : wc, gl ? (lit ? LIT : GLS) : PLATE); } };
      strip([ax0, az0], [ax1, az0], 7); strip([ax1, az1], [ax0, az1], 7); strip([ax1, az0], [ax1, az1], 5); strip([ax0, az1], [ax0, az0], 5);
      // a walkway round each storey on the seaward end, with its rail
      if (f > 0) { slab(g, ax0 - 1.3, ax0, y - 0.1, y, az0, az1, [0.3, 0.31, 0.32], NSK); railing(g, [[ax0 - 1.25, y, az0], [ax0 - 1.25, y, az1]], yellow, RUB, { h: 1.1, every: 2.1, r: 0.035, segs: 3 }); }
    }
    slab(g, ax0 - 0.2, ax1 + 0.2, ay1, ay1 + 0.5, az0 - 0.2, az1 + 0.2, [0.3, 0.3, 0.3], RUB);
    if (near) { text(g, 'TIDAL ALPHA', [ax1 + 0.02, ay0 + 3 * st + 0.35, az1 - 1.2], [0, 0, -1], [0, 1, 0], 0.85, [0.07, 0.14, 0.28], RUB, { off: 0.03, weight: 0.2 }); for (const z of [-3, 2]) wallDoor(g, [ax1, ay0 + 0.02, z], [1, 0, 0], 1.0, 2.1, [0.5, 0.42, 0.06], 0); stairs(g, [ax0 - 0.65, ay0 + st, az1 + 0.9], [ax0 - 0.65 + 5.5, ay0, az1 + 0.9], [0, 0, 1], 1.0, steel, 0); }
  }
  // lifeboats in their davits on the accommodation's sides, liferaft canisters on a rack
  if (!far) {
    for (const s of [-1, 1]) { const z = s > 0 ? az1 + 2.0 : az0 - 2.0; lifeboat(g, [-13, ay0 + 5.2, z], 0, 0, Math.max(lod, 1)); for (const x of [-15.6, -10.4]) tube(g, [[x, ay0 + 6.5, z - s * 2.0], [x, ay0 + 7.8, z - s * 1.6], [x, ay0 + 8.1, z]], 0.16, yellow, RUB, { segs: 4 }); if (near) for (const x of [-15.6, -10.4]) rod(g, [x, ay0 + 8.1, z], [x, ay0 + 6.6, z], 0.03, [0.1, 0.1, 0.1], RUB, 3); }
    if (near) for (let k = 0; k < 4; k++) lathe(g, [[0.0, -0.6], [0.3, -0.55], [0.36, -0.4], [0.36, 0.4], [0.3, 0.55], [0, 0.6]], [0.8, 0.8, 0.78], GEL, { segs: 8, axis: 'x', at: [-6.5 + k * 0.0, ay0 + 0.55 + k * 0.0, 8.0 + k * 0.85] });
  } else for (const z of [az1 + 2, az0 - 2]) box(g, [-13, ay0 + 5.2, z], 4, 1.4, 1.4, [0.7, 0.2, 0.03], RUB);
  // ---- helideck: an octagon on a truss, a net round its edge, the aiming circle and H, lights ----
  const hy = ay1 + 2.8, hc = [-17, hy, 0.25], hr = 11;
  {
    const n = 16, oct = Array.from({ length: n }, (_, k) => [hc[0] + Math.cos((k / n) * TAU) * hr, hy, hc[2] + Math.sin((k / n) * TAU) * hr]);
    // the surface as rings, so the markings are part of it: green, a yellow aiming circle, green, a white edge
    const rings = far ? [[0, green], [5.6, yellow], [6.3, green], [hr - 1.2, [0.62, 0.62, 0.6]], [hr, null]] : [[0, green], [5.5, yellow], [6.2, green], [hr - 1.3, [0.62, 0.62, 0.6]], [hr - 0.45, green], [hr, null]];
    for (let k = 0; k < rings.length - 1; k++) lathe(g, [[rings[k][0], hy], [rings[k + 1][0], hy]], rings[k][1], far ? RUB : NSK, { segs: n, at: [hc[0], 0, hc[2]] });
    lathe(g, [[hr, hy], [hr, hy - 0.45], [hr, hy - 0.45], [0, hy - 0.45]], [0.3, 0.31, 0.32], RUB, { segs: n, at: [hc[0], 0, hc[2]] });
    if (!far) {
      // the H: three bars a little proud (near only: farther off the depth buffer could not hold them apart)
      if (near) { const hb = (x0, x1, z0, z1) => slab(g, hc[0] + x0, hc[0] + x1, hy, hy + 0.03, hc[2] + z0, hc[2] + z1, [0.72, 0.72, 0.7], RUB); hb(-1.7, -1.0, -2.2, 2.2); hb(1.0, 1.7, -2.2, 2.2); hb(-1.0, 1.0, -0.35, 0.35); text(g, 'TIDAL ALPHA', [hc[0] + 8.1, hy + 0.03, hc[2] + 3.6], [0, 0, -1], [-1, 0, 0], 0.9, [0.72, 0.72, 0.7], RUB, { off: 0.0, weight: 0.2 }); }
      // the safety net: a frame sloping out and up, with stays
      const out = oct.map((p) => [hc[0] + (p[0] - hc[0]) * 1.14, hy + 0.25, hc[2] + (p[2] - hc[2]) * 1.14]);
      tube(g, out, lod ? 0.07 : 0.05, yellow, RUB, { segs: 3, closed: true });
      for (let k = 0; k < n; k++) { rod(g, oct[k], out[k], lod ? 0.06 : 0.04, yellow, RUB, 3); if (near) { const m = [(oct[k][0] + oct[(k + 1) % n][0]) / 2, hy, (oct[k][2] + oct[(k + 1) % n][2]) / 2], mo = [(out[k][0] + out[(k + 1) % n][0]) / 2, hy + 0.25, (out[k][2] + out[(k + 1) % n][2]) / 2]; rod(g, m, mo, 0.02, [0.1, 0.1, 0.1], RUB, 3); quad(g, oct[k], oct[(k + 1) % n], out[(k + 1) % n], out[k], [0.05, 0.05, 0.05], NSK); } }
      // the truss that carries it off the roof, access stairs, a windsock, fire monitors
      for (const [x, z] of [[-9, -6], [-9, 6.5], [-12, 0], [-19.5, -5.5], [-19.5, 6]]) rod(g, [x, ay1 + 0.5, z], [hc[0] + (x - hc[0]) * 0.75 - 2, hy - 0.45, hc[2] + (z - hc[2]) * 0.75], 0.3, steel, RUB, lod ? 4 : 6);
      for (const [x, z] of [[-26, -3], [-26, 4], [-22, -9], [-22, 9.5]]) rod(g, [ax0, ay1 - 1.5, clamp(z, az0, az1)], [x, hy - 0.45, z], 0.26, steel, RUB, lod ? 4 : 6);
      if (near) {
        stairs(g, [ax1 + 1.6, ay1 + 0.5, 5.8], [ax1 - 1.4, hy, 8.3], [1, 0, 0], 1.0, steel, 0);
        rod(g, [-6, ay1 + 0.5, -5], [-6, ay1 + 5.5, -5], 0.07, white, RUB, 5); tube(g, [[-6, ay1 + 5.4, -5], [-7.6, ay1 + 5.2, -5.4]], [0.3, 0.14], [0.75, 0.3, 0.03], CLOTH, { segs: 8 });
        for (const a of [0.7, 3.9]) { const p = [hc[0] + Math.cos(a) * (hr + 1.2), hy, hc[2] + Math.sin(a) * (hr + 1.2)]; rod(g, [p[0], hy - 0.45, p[2]], [p[0], hy + 1.3, p[2]], 0.09, [0.5, 0.06, 0.04], RUB, 5); tube(g, [[p[0], hy + 1.3, p[2]], [p[0] - Math.cos(a) * 1.0, hy + 1.7, p[2] - Math.sin(a) * 1.0]], [0.09, 0.05], [0.5, 0.06, 0.04], RUB, { segs: 6 }); }
        for (let k = 0; k < n; k++) lathe(g, [[0.16, 0], [0.16, 0.2], [0, 0.2]], [0.2, 1, 0.3], LIT, { segs: 6, at: [oct[k][0] * 0.985 + hc[0] * 0.015, hy, oct[k][2] * 0.985 + hc[2] * 0.015] });
      }
    }
    for (let k = 0; k < 8; k++) lamps.push(lamp([oct[k * 2][0], hy + 0.3, oct[k * 2][2]], [0.3, 1, 0.4], 'steady', { size: 0.25, level: 0.5 }));
  }
  // ---- cranes: a pedestal crane with a lattice boom at one corner, a smaller one at another ----
  const cp = [13, D1, 10.8], tip = [cp[0] + 18, cp[1] + 26, cp[2] + 9];
  {
    lathe(g, [[1.5, 0], [1.4, 3.4], [1.4, 3.4], [1.9, 3.5], [1.9, 3.9]], yellow, far ? RUB : GEL, { segs: far ? 6 : 12, at: cp });
    box(g, [cp[0], cp[1] + 5.4, cp[2] + 0.35], 1.6, 1.5, 1.85, yellow, far ? RUB : GEL);
    if (!far) { box(g, [cp[0] + 1.66, cp[1] + 5.6, cp[2] + 0.9], 0.05, 0.75, 0.9, GLASS, GLS); box(g, [cp[0] - 2.3, cp[1] + 5.0, cp[2] + 0.35], 0.75, 0.9, 1.5, grey, RUB); }
    if (far) rod(g, [cp[0], cp[1] + 6, cp[2]], tip, 0.8, yellow, RUB, 4);
    else {
      lattice(g, [cp[0] + 1, cp[1] + 5.2, cp[2] + 0.4], tip, 0.8, lod ? 7 : 12, yellow, lod ? 0.13 : 0.09, lod, RUB);
      tube(g, [[cp[0] - 1.6, cp[1] + 6.9, cp[2] - 0.6], [cp[0] - 0.8, cp[1] + 11.5, cp[2] + 0.35], [cp[0] - 1.6, cp[1] + 6.9, cp[2] + 1.3]], 0.16, yellow, RUB, { segs: 4 });
      for (const o of [-0.25, 0.25]) rod(g, [cp[0] - 0.8, cp[1] + 11.5, cp[2] + 0.35 + o], [tip[0] - 0.4, tip[1] + 0.3, tip[2] + o * 0.5], lod ? 0.08 : 0.04, [0.1, 0.1, 0.1], RUB, 3);
      rod(g, tip, [tip[0] - 0.1, tip[1] - 13, tip[2] - 0.1], lod ? 0.08 : 0.04, [0.1, 0.1, 0.1], RUB, 3);
      box(g, [tip[0] - 0.1, tip[1] - 13.5, tip[2] - 0.1], 0.5, 0.5, 0.3, yellow, RUB, { yaw: 0.3 });
      if (near) { hoop(g, [tip[0] - 0.1, tip[1] - 14.3, tip[2] - 0.1], [0, 0, 1], 0.22, 0.06, [0.1, 0.1, 0.1], RUB, 8, 4); railing(g, [[cp[0] - 1.7, cp[1] + 3.9, cp[2] - 1.6], [cp[0] + 1.7, cp[1] + 3.9, cp[2] - 1.6]], yellow, RUB, { h: 1.1, every: 1.2, r: 0.03, segs: 3 }); ladder(g, [cp[0] - 1.45, cp[1], cp[2]], [cp[0] - 1.45, cp[1] + 3.9, cp[2]], [0, 0, 1], yellow, RUB, { w: 0.5, r: 0.03 }); }
      // the second crane, boom lowered along the deck edge
      const c2 = [-1.5, D1, -13.2];
      lathe(g, [[0.9, 0], [0.85, 5.5], [1.2, 5.6], [1.2, 5.9]], yellow, GEL, { segs: lod ? 6 : 10, at: c2 }); box(g, [c2[0], c2[1] + 6.9, c2[2]], 1.1, 1.0, 1.1, yellow, GEL);
      lattice(g, [c2[0] + 0.8, c2[1] + 6.8, c2[2]], [c2[0] + 15, c2[1] + 9.5, c2[2] - 0.5], 0.5, lod ? 5 : 9, yellow, lod ? 0.1 : 0.07, lod, RUB);
    }
  }
  lamps.push(lamp([tip[0], tip[1] + 0.8, tip[2]], [1, 0.1, 0.06], 'obstruction', { size: 0.4 }));
  // ---- flare boom: a long lattice leaning out from a corner with the flare line along it, a tip with a shield ----
  const fb0 = [-18, D1, -12.5], ft = PLATFORM.flareTip;
  if (far) rod(g, fb0, ft, 0.8, [0.45, 0.46, 0.46], RUB, 4);
  else { lattice(g, fb0, ft, 1.0, lod ? 9 : 16, [0.45, 0.46, 0.46], lod ? 0.13 : 0.09, lod, RUB); rod(g, [fb0[0], fb0[1] + 0.6, fb0[2]], [ft[0], ft[1] - 0.2, ft[2]], 0.2, [0.3, 0.2, 0.12], RUB, lod ? 4 : 6); }
  lathe(g, [[0.45, 0], [0.3, 0.8], [0.7, 1.4], [0.55, 1.5]].map(([r, y]) => [r, y + ft[1] - 0.2]), [0.25, 0.1, 0.05], RUB, { segs: far ? 6 : 10, at: [ft[0], 0, ft[2]] });
  lamps.push(lamp([ft[0], ft[1] + 2.2, ft[2]], [1, 0.5, 0.15], 'flare', { size: 3 }));
  // ---- radio mast on the accommodation, dishes and a dome ----
  const mb = [-8, ay1 + 0.5, -3.5], mt = [-8, ay1 + 14, -3.5];
  if (far) rod(g, mb, mt, 0.4, [0.5, 0.5, 0.5], RUB, 3);
  else {
    lattice(g, mb, mt, 0.45, lod ? 7 : 12, [0.6, 0.2, 0.15], lod ? 0.09 : 0.06, lod, RUB);
    lathe(g, [[0.0, 0.0], [0.9, 0.35], [1.0, 0.45]], [0.7, 0.7, 0.7], GEL, { segs: 10, axis: 'x', at: [-7.4, ay1 + 7, -3.5] });
    lathe(g, [[0.0, 0.0], [0.6, 0.25], [0.66, 0.32]], [0.7, 0.7, 0.7], GEL, { segs: 10, axis: 'x', at: [-7.5, ay1 + 10, -3.5] });
    lathe(g, [[0.25, 0], [0.25, 1.2]], white, GEL, { segs: 6, at: [-10.5, ay1 + 0.5, 4] }); blob(g, [-10.5, ay1 + 2.5, 4], 1.0, 1.05, 1.0, [0.82, 0.82, 0.8], GEL, { n: lod ? 3 : 5, segs: lod ? 6 : 10 });
  }
  lamps.push(lamp([mt[0], mt[1] + 0.6, mt[2]], [1, 0.1, 0.06], 'obstruction', { size: 0.5 }));
  lamps.push(lamp([8.2, PLATFORM.height, -6.5], [1, 0.1, 0.06], 'obstruction', { size: 0.5 }));
  lamps.push(lamp([-19.5, ay1 + 0.8, 6.2], [1, 0.1, 0.06], 'obstruction', { size: 0.3 }));
  // floodlights on posts along the deck edge
  for (const [x, z] of [[18, -13], [18, 13], [-4, 13], [-4, -13], [18, 0], [8, 14]]) {
    lamps.push(lamp([x, dy + 5.6, z], [1, 0.95, 0.8], 'flood', { size: 0.9 }));
    if (!far) { rod(g, [x, D1, z], [x, dy + 5.4, z], lod ? 0.12 : 0.07, steel, RUB, 3); box(g, [x, dy + 5.55, z], 0.3, 0.15, 0.4, [0.9, 0.9, 0.8], LIT); }
  }
  return { g, lamps };
}
