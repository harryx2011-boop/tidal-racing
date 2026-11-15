import { Geo, MAT, add, sub, norm, cross } from '../geo.js';
import { tubeE, blob } from './driver.js';

// A 9 m open performance boat with three outboards. Local axes: x forward, y up, z starboard;
// y = 0 is the design waterline. Everything is built from a handful of smooth functions of x
// (beam, chine, keel, sheer), so strips that share an edge share its points exactly and the hull
// stays closed from any angle.

const X0 = -4.2, X1 = 4.8;                 // transom, stem top
const clamp = (x, a, b) => Math.min(Math.max(x, a), b);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ---- hull: half-beams, heights ----------------------------------------------------------
const tt = (x) => clamp((x + 0.2) / 5.0, 0, 1);                        // 0 over the parallel body, 1 at the stem
// deck-edge half-beam: long parallel body, then a fine, convex bow
const bs = (x) => 1.3 * Math.pow(Math.max(1 - Math.pow(tt(x), 2.2), 0), 0.85) * (1 - 0.025 * Math.pow(clamp((-0.8 - x) / 3.4, 0, 1), 1.5));
// chine half-beam: narrower than the deck forward of midships, which is what flares the bow
const bc = (x) => bs(x) * (0.90 - 0.40 * Math.pow(tt(x), 1.6));
// sheer: a slight dip amidships, rising to the bow
const ys = (x) => 0.80 - 0.10 * (x < 0.5 ? Math.sin(Math.PI * (x + 4.2) / 4.7) : 0) + 0.40 * Math.pow(Math.max(x / 4.8, 0), 2.1);
// keel: deep and level through the planing length, a forefoot, then a raked stem
const yk = (x) => -0.42 + 1.05 * Math.pow(Math.max((x - 1.6) / 3.2, 0), 2.6);
const yc = (x) => { const k = yk(x); return k + (ys(x) - k) * lerp(0.37, 0.62, smooth(1.0, 4.8, x)); };
const flareP = (x) => 1.0 + 0.6 * smooth(-1, 3.5, x);                  // sides bell out toward the sheer
const camber = (x) => 0.03 + 0.07 * smooth(0.5, 3.0, x);
const dBs = (x) => (bs(x + 1e-3) - bs(x - 1e-3)) / 2e-3;

// the stem rakes: low points of the bow sit further aft than the sheer
const H = (x, y, z) => [x - 0.5 * (1 - clamp(y / 1.15, 0, 1)) * smooth(1.6, 4.8, x), y, z];

const vee = (s) => { const e = 0.012; return (Math.sqrt(s * s + e) - Math.sqrt(e)) / (Math.sqrt(1 + e) - Math.sqrt(e)); };
const bottomFn = (x, s) => H(x, yk(x) + (yc(x) - yk(x)) * vee(s), s * bc(x));
const sideFn = (sg) => (x, v) => H(x, lerp(yc(x), ys(x), v), sg * (bc(x) + (bs(x) - bc(x)) * Math.pow(v, flareP(x))));
const deckY = (x, z) => { const b = bs(x); return ys(x) + camber(x) * (1 - (b > 1e-3 ? (z / b) * (z / b) : 0)); };
const dk = (x, z) => H(x, deckY(x, z), z);

// ---- cockpit and windscreen layout ------------------------------------------------------
const XA = -3.0;                 // aft wall of the cockpit (behind it: the sun-pad deck)
const XS = 0.6, XN = 1.85;       // windscreen base: its ends at the gunwale, its nose on the centreline
const ZW = 1.02;                 // half width of the opening
const SOLE = 0.30;               // teak sole
const wOpen = (x) => (x <= XS ? ZW : x >= XN ? 0 : ZW * Math.pow((XN - x) / (XN - XS), 1 / 2.2));
const xBase = (z) => XN - (XN - XS) * Math.pow(Math.min(Math.abs(z) / ZW, 1), 2.2);
const glassBaseY = (z) => deckY(xBase(z), z) + 0.02;
const glassH = (z) => 0.58 - 0.12 * Math.pow(Math.min(Math.abs(z) / ZW, 1), 2);
const DASH_X = 1.0;              // rear face of the console
const WHEEL = [0.80, 1.16, 0.38];
const SEAT_Z = 0.38;

// rows (x stations) shared by the hull, the deck and the cockpit liner
const ROWS = (() => {
  const r = [];
  for (let k = 0; k < 6; k++) r.push(X0 + k * 0.2);
  for (let k = 0; k < 12; k++) r.push(XA + k * 0.3);
  for (let k = 0; k <= 16; k++) r.push(XS + (XN - XS) * (1 - Math.pow(1 - k / 16, 2.2)));
  for (let k = 1; k <= 44; k++) r.push(XN + (X1 - XN) * (1 - Math.pow(1 - k / 44, 1.6)));
  return r;
})();
const rowsFrom = (a, b) => ROWS.filter((x) => x >= a - 1e-9 && x <= b + 1e-9);
const lin = (a, b, n) => Array.from({ length: n + 1 }, (_, k) => a + ((b - a) * k) / n);

// ---- anchors ----------------------------------------------------------------------------
// the hull's half-width at height y, found on the section curve
function halfBeamAt(x, y) {
  const pts = [];
  for (const s of lin(0, 1, 16)) pts.push(bottomFn(x, s));
  for (const v of lin(0, 1, 16)) pts.push(sideFn(1)(x, v));
  let z = null;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if ((a[1] - y) * (b[1] - y) <= 0 && a[1] !== b[1]) z = Math.max(z ?? 0, lerp(a[2], b[2], (y - a[1]) / (b[1] - a[1])));
  }
  return z;
}
const outline = (y) => { const o = []; for (let x = X0; x <= X1; x += 0.25) { const z = halfBeamAt(x, y); if (z !== null && z > 0.02) o.push([+x.toFixed(2), +z.toFixed(3)]); } return o; };
const MOTOR_Z = [-0.86, 0, 0.86];
const lampPos = (sg) => { const x = 3.4, z = sg * (bs(x) - 0.1); const p = dk(x, z); return [p[0], p[1] + 0.07, z]; };
const sternTop = [-3.95, deckY(-3.95, 0) + 0.34, 0];

// Named points on the boat, in its own space (x forward, y up, z starboard; y = 0 is the design
// waterline). Other systems place things by these, never by guessing at the model.
export const BOAT_ANCHORS = {
  length: 9.0, halfBeam: 1.3,
  bow: [X1 - 0.1, ys(X1) + camber(X1), 0], transom: [X0, 0.0, 0],
  props: MOTOR_Z.map((z) => [-5.22, -0.45, z]),         // where the three propellers churn the water
  helm: [0.15, 0.85, SEAT_Z],                            // the driver's hip point, facing +x: the seat cushion top is 0.10 below it
  wheel: WHEEL,                                          // wheel hub; the rim is 0.17 m in radius
  eye: [0.2, 1.47, SEAT_Z],                              // a seated adult's eye point (helm camera)
  navPort: lampPos(-1), navStbd: lampPos(1), sternLight: sternTop,
  underLights: [[X0 - 0.03, 0.0, -0.5], [X0 - 0.03, 0.0, 0.5]],   // glowing lenses on the transom, a hand above the waterline
  // the open part of the hull at deck level, as a box [x0, x1, halfWidth]: the sea is hidden inside it
  cockpit: [XA, XN, ZW], sole: SOLE,
  // hull plan outlines as [x, halfWidth] pairs along the hull: at the waterline and at the sheer
  outline: { waterline: outline(0), sheer: outline(ys(0) - 0.01) },
};

// ---- small builders ---------------------------------------------------------------------
// rounded rectangle in the (x, z) plane, counter-clockwise
function rrect(cx, cz, hx, hz, r, n = 4) {
  const pts = [];
  for (const [x, z, a0] of [[cx + hx - r, cz + hz - r, 0], [cx - hx + r, cz + hz - r, 90], [cx - hx + r, cz - hz + r, 180], [cx + hx - r, cz - hz + r, 270]])
    for (let k = 0; k <= n; k++) { const a = ((a0 + (90 * k) / n) * Math.PI) / 180; pts.push([x + r * Math.cos(a), z + r * Math.sin(a)]); }
  return pts;
}

// A cushion or any soft or rounded slab standing on a surface: vertical sides, a rounded top
// edge and a slightly crowned top. outline: [[x, z], ...] counter-clockwise; base(x, z): the
// surface it stands on; post(p) reshapes the result (a leaning backrest, the bow's rake).
function pad(g, outline, base, h, rad, col, mat, { post = (p) => p, crown = 0.02, bottom = false } = {}) {
  const n = outline.length;
  let area = 0;
  for (let j = 0; j < n; j++) { const a = outline[j], b = outline[(j + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
  const side = area >= 0 ? 1 : -1;
  const inward = outline.map((_, j) => {
    const a = outline[(j + n - 1) % n], b = outline[(j + 1) % n];
    const tx = b[0] - a[0], tz = b[1] - a[1], l = Math.hypot(tx, tz) || 1;
    return [(-tz / l) * side, (tx / l) * side];
  });
  const prof = [[0, 0], [0, h - rad]];
  for (let k = 1; k <= 3; k++) { const a = (k * Math.PI) / 6; prof.push([rad * (1 - Math.cos(a)), h - rad + rad * Math.sin(a)]); }
  const rings = prof.map(([ins, lift]) => outline.map(([x, z], j) => {
    const px = x + inward[j][0] * ins, pz = z + inward[j][1] * ins;
    return post([px, base(px, pz) + lift, pz]);
  }));
  const cx = outline.reduce((s, p) => s + p[0], 0) / n, cz = outline.reduce((s, p) => s + p[1], 0) / n;
  const top = post([cx, base(cx, cz) + h + crown, cz]);
  rings.push(outline.map(() => top));
  g.loft(rings, col, mat);
  if (bottom) g.fan(rings[0], post([cx, base(cx, cz), cz]), [0, -1, 0], col, mat);
}

// replace sharp corners of a polyline with short cut corners (a bar bent around a corner)
function bent(pts, r) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = norm(sub(pts[i - 1], pts[i])), b = norm(sub(pts[i + 1], pts[i]));
    out.push(add(pts[i], a.map((x) => x * r)), pts[i], add(pts[i], b.map((x) => x * r)));
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// ring of a superellipse (x, z) at height y: cowls and leg housings
const ring = (y, cx, ax, az, p = 2.6, n = 20, cz = 0) => Array.from({ length: n }, (_, k) => {
  const a = (k / n) * 2 * Math.PI, c = Math.cos(a), s = Math.sin(a);
  return [cx + ax * Math.sign(c) * Math.pow(Math.abs(c), 2 / p), y, cz + az * Math.sign(s) * Math.pow(Math.abs(s), 2 / p)];
});

export function boatGeo() {
  const g = new Geo();
  // (real white gelcoat and vinyl reflect about 0.7-0.78 of the light; brighter albedos clip in full sun)
  const WHITE = [0.72, 0.73, 0.74], GEL = [0.74, 0.75, 0.76], CREAM = [0.83, 0.82, 0.79], TEAK = [0.55, 0.36, 0.18];
  const GLASS = [0.02, 0.035, 0.05], CHROME = [0.74, 0.76, 0.79], DARK = [0.05, 0.055, 0.06], BLACK = [0.025, 0.025, 0.03], SKID = [0.55, 0.57, 0.58];
  const M = (id, tint = 0, glow = 0) => [id, tint, glow];
  const PAINT1 = M(MAT.PAINT, 1), GELM = M(MAT.GELCOAT), UPH = M(MAT.UPHOLSTERY), METAL = M(MAT.METAL), RUBBER = M(MAT.RUBBER);
  const INSIDE = [0, 0.4, 0];

  // ---- hull ----
  const sv = lin(-1, 1, 16), vLow = lin(0, 0.33, 4), vUp = lin(0.33, 1, 9);
  g.surf(bottomFn, ROWS, sv, GEL, GELM, { away: INSIDE });
  for (const sg of [-1, 1]) {
    g.surf(sideFn(sg), ROWS, vLow, WHITE, PAINT1, { away: INSIDE });
    g.surf(sideFn(sg), ROWS, vUp, WHITE, PAINT1, { away: INSIDE });
  }
  // spray strake: a small downward lip that kicks the spray off the hull
  for (const sg of [-1, 1]) {
    const fn = sideFn(sg), path = [];
    for (const x of rowsFrom(-4.1, 3.7)) {
      const e = 1e-3, v = 0.33, p = fn(x, v);
      let n = [0, 0, 0];
      const du = sub(fn(x + e, v), fn(x - e, v)), dv = sub(fn(x, v + e), fn(x, v - e));
      n = [du[1] * dv[2] - du[2] * dv[1], du[2] * dv[0] - du[0] * dv[2], du[0] * dv[1] - du[1] * dv[0]];
      n = norm(n); if (n[2] * sg < 0) n = n.map((c) => -c);
      path.push({ p, n });
    }
    g.sweep(path, [[0, 0.02], [0.055, -0.012], [0, -0.05]], WHITE, PAINT1, { hard: true });
  }
  // transom: one flat panel closed over the section outline
  {
    const r = [];
    for (const v of lin(1, 0, 8)) r.push(sideFn(-1)(X0, v));
    for (const s of lin(-1, 1, 16).slice(1, -1)) r.push(bottomFn(X0, s));
    for (const v of lin(0, 1, 8)) r.push(sideFn(1)(X0, v));
    for (const s of lin(1, -1, 14).slice(1, -1)) r.push(dk(X0, s * bs(X0)));
    g.fan(r, [X0, 0.25, 0], [-1, 0, 0], GEL, GELM);
  }

  // ---- deck ----
  const aftRows = rowsFrom(X0, XA), openRows = rowsFrom(XA, X1);
  const sFull = lin(-1, 1, 12);
  g.surf((x, s) => dk(x, s * bs(x)), aftRows, sFull, GEL, GELM, { away: [0, -5, 0] });
  const deckStrip = (sg) => (x, q) => { const w = wOpen(x), z = sg * lerp(w, bs(x), q); return dk(x, z); };
  for (const sg of [-1, 1]) g.surf(deckStrip(sg), openRows, lin(0, 1, 6), GEL, GELM, { away: [0, -5, 0] });
  // cockpit liner and sole
  const cockRows = rowsFrom(XA, XN);
  const IN = [-0.5, 0.6, 0];
  for (const sg of [-1, 1]) g.surf((x, v) => { const z = sg * wOpen(x), t = dk(x, z); return [t[0], lerp(t[1], SOLE, v), z]; }, cockRows, lin(0, 1, 4), GEL, GELM, { toward: IN });
  g.surf((z, v) => { const t = dk(XA, z); return [XA, lerp(t[1], SOLE, v), z]; }, lin(-ZW, ZW, 12), lin(0, 1, 4), GEL, GELM, { toward: IN });
  g.surf((x, s) => [x, SOLE, s * wOpen(x)], cockRows, lin(-1, 1, 6), TEAK, M(MAT.TEAK), { away: [0, -5, 0] });
  // rolled edge round the opening
  {
    const rim = (sg) => cockRows.map((x) => { const p = dk(x, sg * wOpen(x)); return [p[0], p[1] + 0.012, sg * (wOpen(x) + 0.012)]; });
    g.tube(rim(1), 0.02, GEL, GELM, { segs: 8 }); g.tube(rim(-1), 0.02, GEL, GELM, { segs: 8 });
    g.tube(lin(-ZW, ZW, 12).map((z) => { const p = dk(XA, z); return [XA + 0.012, p[1] + 0.012, z]; }), 0.02, GEL, GELM, { segs: 8 });
  }
  // thin accent light under the coaming lip
  for (const sg of [-1, 1]) g.tube(cockRows.map((x) => [x, deckY(x, sg * wOpen(x)) - 0.07, sg * (wOpen(x) - 0.012)]), 0.008, [1, 1, 1], M(MAT.LIGHT, 1, 0.5), { segs: 5 });

  // rub rail: a black rubber D-section along the sheer and across the transom, with a stainless insert
  {
    const bead = lin(-90, 90, 8).map((a) => [0.04 * Math.cos((a * Math.PI) / 180), 0.046 * Math.sin((a * Math.PI) / 180)]);
    const insert = [[0.0375, -0.016], [0.0405, -0.011], [0.0415, 0], [0.0405, 0.011], [0.0375, 0.016]];
    for (const sg of [-1, 1]) {
      const path = rowsFrom(X0, 4.45).map((x) => ({ p: H(x, ys(x), sg * (bs(x) + 0.008)), n: norm([-dBs(x), 0, sg]) }));
      g.sweep(path, bead, BLACK, RUBBER);
      g.sweep(path, insert, CHROME, METAL);
    }
    const across = lin(-1, 1, 24).map((s) => ({ p: [X0 - 0.008, ys(X0) + camber(X0) * (1 - s * s), s * bs(X0)], n: [-1, 0, 0] }));
    g.sweep(across, bead, BLACK, RUBBER);
    g.sweep(across, insert, CHROME, METAL);
  }

  // ---- windscreen ----
  {
    const zs = lin(-ZW, ZW, 40);
    const glass = (z, v) => [xBase(z) - 0.36 * v + 0.025 * Math.sin(Math.PI * v), glassBaseY(z) + glassH(z) * v, z * (1 - 0.05 * v)];
    g.surf(glass, zs, lin(0, 1, 6), GLASS, M(MAT.GLASS), { away: [0.3, 1.0, 0] });
    const baseLine = zs.map((z) => glass(z, 0)), topLine = zs.map((z) => glass(z, 1));
    g.tube(baseLine, 0.022, DARK, METAL, { segs: 6 });
    g.tube(topLine, 0.02, DARK, METAL, { segs: 6 });
    for (const e of [0, zs.length - 1]) g.tube([baseLine[e], topLine[e]], 0.022, DARK, METAL, { segs: 6 });
    g.tube([baseLine[20], topLine[20]], 0.016, DARK, METAL, { segs: 6 });
  }

  // ---- console, dash, wheel ----
  {
    const zd = ZW * Math.pow((XN - DASH_X) / (XN - XS), 1 / 2.2);
    const zs = lin(-zd, zd, 24);
    const dash = (z, v) => [lerp(DASH_X, xBase(z), v), 1.0 + 0.035 * Math.sin(Math.PI * v), z];
    g.surf(dash, zs, lin(0, 1, 6), DARK, RUBBER, { away: [0, -5, 0] });
    g.surf((z, v) => [DASH_X, lerp(1.0, SOLE, v), z], zs, lin(0, 1, 6), GEL, GELM, { toward: [0.3, 0.6, 0] });
    // gauge panel and a grab handle for the passenger
    pad(g, rrect(1.17, SEAT_Z, 0.13, 0.15, 0.04), () => 1.015, 0.018, 0.008, GLASS, M(MAT.GLASS), { crown: 0.004 });
    g.tube(bent([[1.02, 1.0, -0.62], [1.02, 1.13, -0.62], [1.02, 1.13, -0.16], [1.02, 1.0, -0.16]], 0.03), 0.014, CHROME, METAL, { segs: 8 });
    // wheel: column, hub, three spokes and a rubber rim, tilted toward the driver
    const C = WHEEL, A = norm([-0.78, 0.62, 0]), E1 = [0, 0, 1], E2 = [A[1] * E1[2] - A[2] * E1[1], A[2] * E1[0] - A[0] * E1[2], A[0] * E1[1] - A[1] * E1[0]];
    const at = (t, r) => add(C, add(E1.map((x) => x * Math.cos(t) * r), E2.map((x) => x * Math.sin(t) * r)));
    g.tube([[1.0, 0.99, SEAT_Z], add(C, A.map((x) => x * -0.03))], 0.03, DARK, METAL, { segs: 8 });
    g.tube([add(C, A.map((x) => x * -0.03)), add(C, A.map((x) => x * 0.035))], 0.05, CHROME, METAL, { segs: 12 });
    g.tube(lin(0, 2 * Math.PI, 36).map((t) => at(t, 0.17)), 0.018, BLACK, RUBBER, { segs: 8 });
    for (let k = 0; k < 3; k++) g.tube([at(((k * 120 + 90) * Math.PI) / 180, 0.04), at(((k * 120 + 90) * Math.PI) / 180, 0.165)], 0.011, CHROME, METAL, { segs: 6 });
  }

  // ---- seats ----
  const sole = () => SOLE;
  const lean = (x0, y0, k) => (p) => [p[0] + k * (p[1] - y0), p[1], p[2]];
  for (const sg of [-1, 1]) {
    const z0 = sg * SEAT_Z;
    pad(g, rrect(0.18, z0, 0.22, 0.2, 0.05), sole, 0.29, 0.02, GEL, GELM, { crown: 0 });                      // pedestal
    pad(g, rrect(0.2, z0, 0.31, 0.3, 0.09), () => 0.58, 0.15, 0.05, CREAM, UPH);                             // cushion
    pad(g, rrect(0.44, z0, 0.1, 0.3, 0.05), () => 0.58, 0.21, 0.05, CREAM, UPH);                             // front bolster
    pad(g, rrect(-0.12, z0, 0.075, 0.3, 0.05), () => 0.62, 0.68, 0.05, CREAM, UPH, { post: lean(-0.12, 0.62, -0.25) });   // back
  }
  // rear bench with a back, and a lounge along each side
  for (const sg of [-1, 1]) {
    pad(g, rrect(-2.69, sg * 0.5, 0.29, 0.49, 0.03), sole, 0.2, 0.02, GEL, GELM, { crown: 0 });
    pad(g, rrect(-2.69, sg * 0.5, 0.3, 0.495, 0.07), () => 0.5, 0.15, 0.05, CREAM, UPH);
    pad(g, rrect(-2.93, sg * 0.5, 0.06, 0.485, 0.04), () => 0.62, 0.42, 0.04, CREAM, UPH, { post: lean(-2.93, 0.62, -0.2) });
    pad(g, rrect(-1.4, sg * 0.72, 0.85, 0.26, 0.03), sole, 0.2, 0.02, GEL, GELM, { crown: 0 });
    pad(g, rrect(-1.4, sg * 0.72, 0.86, 0.27, 0.08), () => 0.5, 0.15, 0.05, CREAM, UPH);
    pad(g, rrect(-1.4, sg * 0.93, 0.85, 0.05, 0.04), () => 0.62, 0.38, 0.04, CREAM, UPH, { post: (p) => [p[0], p[1], p[2] + sg * 0.06 * (p[1] - 0.62) / 0.38] });
  }

  // ---- aft deck: sun pads, swim platform, outboards ----
  for (const sg of [-1, 1]) pad(g, rrect(-3.6, sg * 0.62, 0.52, 0.54, 0.14), deckY, 0.14, 0.05, CREAM, UPH, { crown: 0.03 });
  g.tube([[-3.95, deckY(-3.95, 0), 0], sternTop], 0.012, CHROME, METAL, { segs: 6 });
  g.lathe([[0, 0], [0.028, 0], [0.028, 0.02], [0.016, 0.04], [0, 0.05]].map(([r, y]) => [r, y + sternTop[1] - 0.01]), WHITE, M(MAT.LIGHT, 0, 1), 10, sternTop[0], 0);
  // swim platform on two pods
  pad(g, rrect(-4.42, 0, 0.23, 1.22, 0.1), () => 0.27, 0.07, 0.025, SKID, M(MAT.NONSKID), { crown: 0, bottom: true });
  for (const z of [-0.6, 0.6]) g.box(-4.6, -4.2, -0.1, 0.27, z - 0.05, z + 0.05, GEL, GELM);
  // underwater light lenses on the transom (they take the accent colour)
  for (const [x, y, z] of BOAT_ANCHORS.underLights) g.lathex([[X0, 0], [X0, 0.07], [x, 0.07], [x, 0]], [1, 1, 1], M(MAT.LIGHT, 1, 1), 14, y, z);

  // steering: a tie bar through the three engines, driven by a ram on the starboard side
  {
    const bar = -4.5, y = 0.62;
    g.tube([[bar, y, MOTOR_Z[0] - 0.02], [bar, y, MOTOR_Z[2] + 0.02]], 0.011, CHROME, METAL, { segs: 6 });
    g.tube([[bar, y, 0.88], [bar, y, 1.2]], 0.024, [0.1, 0.1, 0.11], METAL, { segs: 8 });
    g.tube([[bar, y, 0.84], [bar, y, 0.9]], 0.01, CHROME, METAL, { segs: 6 });
    g.box(-4.52, -4.2, y - 0.025, y + 0.025, 1.17, 1.23, CHROME, METAL);
    g.box(-4.2 - 0.001, -4.19, y - 0.04, y + 0.04, 1.15, 1.25, DARK, RUBBER);
  }
  for (const z0 of MOTOR_Z) {
    const R = [[0.93, -4.84, 0.27, 0.19], [1.05, -4.83, 0.30, 0.22], [1.135, -4.825, 0.306, 0.227], [1.22, -4.82, 0.31, 0.23], [1.38, -4.82, 0.29, 0.215], [1.49, -4.83, 0.225, 0.165], [1.55, -4.84, 0.13, 0.095]];
    const rg = (r, k = 1, n = 20) => ring(r[0], r[1], r[2] * k, r[3] * k, 2.6, n, z0);
    // cowl: lower, a band that takes the livery colour, then the upper cowl and its top
    g.loft([rg(R[0]), rg(R[1])], WHITE, GELM, { closed: true, ref: () => [R[0][1], 1, z0] });
    g.loft([rg(R[1], 1.004), rg(R[2], 1.004), rg(R[3], 1.004)], WHITE, PAINT1, { ref: (i) => [R[1 + i][1], R[1 + i][0], z0] });
    const up = R.slice(3).map((r) => rg(r)); up.push(up[up.length - 1].map(() => [-4.84, 1.565, z0]));
    g.loft(up, WHITE, GELM);
    for (const y of [1.05, 1.22]) { const q = R.find((r) => Math.abs(r[0] - y) < 1e-3), rr = rg(q, 1.006, 16); g.tube(rr.concat([rr[0]]), 0.0035, BLACK, RUBBER, { segs: 3 }); }
    // air intake: a squared, louvred scoop on the top aft of the cowl
    blob(g, [-4.93, 1.51, z0], 0.085, 0.012, 0.075, [0.05, 0.052, 0.058], RUBBER, { n: 3, segs: 12, p: 4 });
    for (let i = 0; i < 3; i++) g.box(-4.99 + i * 0.05, -4.975 + i * 0.05, 1.517, 1.525, z0 - 0.065, z0 + 0.065, [0.5, 0.52, 0.55], METAL);
    // rear badge (a white decal on the band) and the cowl latch
    g.box(-5.133, -5.127, 1.1, 1.17, z0 - 0.09, z0 + 0.09, [0.92, 0.92, 0.93], GELM);
    g.box(-5.13, -5.1, 0.99, 1.02, z0 - 0.03, z0 + 0.03, CHROME, METAL);
    // leg housing and gear case
    g.loft([[0.94, -4.84, 0.25, 0.17], [0.5, -4.85, 0.22, 0.14], [0.1, -4.87, 0.2, 0.12], [-0.32, -4.88, 0.19, 0.11]].map(([y, cx, ax, az]) => ring(y, cx, ax, az, 2.4, 16, z0)), WHITE, GELM);
    // trailing edge of the leg, where the exhaust leaves: a dark seam
    g.box(-5.07, -5.06, -0.2, 0.9, z0 - 0.003, z0 + 0.003, BLACK, RUBBER);
    g.lathex([[-5.2, 0], [-5.17, 0.06], [-5.05, 0.11], [-4.9, 0.125], [-4.75, 0.11], [-4.66, 0.06], [-4.64, 0]], WHITE, GELM, 14, -0.46, z0);
    // skeg and anti-ventilation plate, an anode on the gear case, water intakes
    tubeE(g, [[-5.04, -0.5, z0], [-4.95, -0.59, z0], [-4.82, -0.65, z0], [-4.68, -0.64, z0]], [0.014, 0.013, 0.012, 0.012], [0.05, 0.06, 0.045, 0.02], WHITE, GELM, { hint: [0, 0, 1], segs: 8, per: 2 });
    blob(g, [-4.88, -0.2 + 0.005, z0], 0.24, 0.014, 0.18, WHITE, GELM, { n: 4, segs: 14 });
    g.box(-5.12, -5.0, -0.36, -0.32, z0 - 0.026, z0 + 0.026, [0.35, 0.37, 0.4], METAL);
    for (const sg of [-1, 1]) g.box(-4.95, -4.87, -0.44, -0.425, z0 + sg * 0.122 - 0.004, z0 + sg * 0.122 + 0.004, BLACK, RUBBER);
    // swivel bracket, clamp arms into the transom, trim and tilt rams, steering arm
    g.box(-4.66, -4.56, 0.3, 0.86, z0 - 0.14, z0 + 0.14, CHROME, METAL);
    for (const sg of [-1, 1]) {
      g.box(-4.6, -4.2, 0.44, 0.5, z0 + sg * 0.13 - 0.016, z0 + sg * 0.13 + 0.016, CHROME, METAL);
      g.tube([[-4.4, 0.36, z0 + sg * 0.1], [-4.56, 0.62, z0 + sg * 0.1]], 0.013, CHROME, METAL, { segs: 6 });
      g.tube([[-4.4, 0.36, z0 + sg * 0.1], [-4.47, 0.46, z0 + sg * 0.1]], 0.02, [0.08, 0.08, 0.09], METAL, { segs: 6 });
    }
    g.box(-4.58, -4.48, 0.59, 0.65, z0 - 0.03, z0 + 0.03, CHROME, METAL);
    // rigging: a fuel hose, a steering and power harness and a hydraulic line, from the transom up into the cowl
    for (const [dz, col, r] of [[-0.07, [0.62, 0.64, 0.66], 0.011], [0.0, BLACK, 0.017], [0.075, [0.03, 0.05, 0.12], 0.009]])
      g.tube([[X0 - 0.02, 0.58, z0 + dz], [-4.3, 0.64, z0 + dz], [-4.5, 0.78, z0 + dz * 0.9], [-4.64, 0.96, z0 + dz * 0.7]], r, col, RUBBER, { segs: 5, per: 1 });
    // propeller
    g.lathex([[-5.2, 0], [-5.23, 0.035], [-5.27, 0.03], [-5.3, 0]], CHROME, METAL, 10, -0.46, z0);
    for (let k = 0; k < 3; k++) {
      const ph = ((k * 120 + 20) * Math.PI) / 180;
      g.surf((r, c) => {
        const half = 0.065 * Math.sin((Math.PI * (r - 0.03)) / 0.17) + 0.012, t = c * half;
        return [-5.24 + 0.6 * t, -0.46 + r * Math.cos(ph) - t * Math.sin(ph), z0 + r * Math.sin(ph) + t * Math.cos(ph)];
      }, lin(0.03, 0.2, 6), lin(-1, 1, 4), CHROME, METAL, { flip: k % 2 === 1 });
    }
  }

  // ---- foredeck ----
  {
    const hw = (x) => 0.62 * bs(x);
    const xs = lin(2.4, 3.9, 10), pts = [];
    pts.push([2.4, -hw(2.4)]);
    for (const x of xs) pts.push([x, -hw(x)]);
    pts.push([3.97, 0]);
    for (const x of xs.slice().reverse()) pts.push([x, hw(x)]);
    pts.push([2.4, hw(2.4)]);
    pad(g, pts, deckY, 0.07, 0.03, CREAM, UPH, { crown: 0.015, post: (p) => H(p[0], p[1], p[2]) });
    pad(g, rrect(2.14, 0, 0.14, 0.3, 0.03), deckY, 0.015, 0.006, CHROME, METAL, { crown: 0, post: (p) => H(p[0], p[1], p[2]) });
  }
  // cleats and bow eye
  for (const [x, z] of [[-3.7, -1.2], [-3.7, 1.2], [1.4, -1.19], [1.4, 1.19], [4.3, 0]]) {
    const p = dk(x, z), y = p[1];
    pad(g, rrect(p[0], z, 0.075, 0.016, 0.012, 2), () => y, 0.032, 0.008, CHROME, METAL, { crown: 0 });
    for (const dx of [-0.05, 0.05]) g.box(p[0] + dx - 0.012, p[0] + dx + 0.012, y - 0.005, y + 0.03, z - 0.012, z + 0.012, CHROME, METAL);
  }
  // navigation lights: a small housing and a lit lens
  for (const [sg, col] of [[-1, [1, 0.04, 0.04]], [1, [0.05, 1, 0.12]]]) {
    const L = BOAT_ANCHORS[sg < 0 ? 'navPort' : 'navStbd'], y0 = L[1] - 0.07;
    g.lathe([[0, y0], [0.05, y0], [0.05, y0 + 0.018], [0.034, y0 + 0.05], [0, y0 + 0.06]], DARK, METAL, 12, L[0], L[2]);
    g.lathe([[0, y0 + 0.05], [0.03, y0 + 0.045], [0.026, y0 + 0.07], [0, y0 + 0.08]], col, M(MAT.LIGHT, 0, 1), 12, L[0], L[2]);
  }

  // ======================= close-up detail =======================
  const GAUGE_FACE = [0.012, 0.014, 0.017], TICK = [0.9, 0.9, 0.88], AMBER = [1, 0.42, 0.06], NAVY = [0.02, 0.04, 0.09];
  const pt = (c, u, a, v, b) => [c[0] + u[0] * a + v[0] * b, c[1] + u[1] * a + v[1] * b, c[2] + u[2] * a + v[2] * b];
  const lift = (c, N, k) => [c[0] + N[0] * k, c[1] + N[1] * k, c[2] + N[2] * k];
  const closedRing = (c, u, v, ru, rv, n = 16) => Array.from({ length: n }, (_, k) => { const a = (k / n) * 2 * Math.PI; return pt(c, u, Math.cos(a) * ru, v, Math.sin(a) * rv); });
  // a raised slab on the dash whose top leans back toward the driver (front edge stays low)
  function slab(cx, cz, hx, hz, h, k, col, mat, rad = 0.03) {
    const post = (p) => [p[0], 1.0 + (p[1] - 1.0) * (1 + k * clamp((cx + hx - p[0]) / (2 * hx), 0, 1)), p[2]];
    pad(g, rrect(cx, cz, hx, hz, rad, 3), () => 1.0, h, 0.006, col, mat, { post, crown: 0 });
    const topY = (x) => 1.0 + (h + 0.0) * (1 + k * clamp((cx + hx - x) / (2 * hx), 0, 1));
    const slope = (topY(cx - hx) - topY(cx + hx)) / (2 * hx);
    const N = norm([slope, 1, 0]), v = [N[1], -N[0], 0];
    return { c: [cx, topY(cx), cz], N, u: [0, 0, 1], v };
  }
  // a round instrument: bezel, dark face, scale ticks and a glowing needle (needle: 0..1 of the sweep)
  function gauge(S, a, b, r, needle, ticks = 9) {
    const c = lift(pt(S.c, S.u, a, S.v, b), S.N, 0.002), { u, v, N } = S;
    g.tube(closedRing(lift(c, N, 0.004), u, v, r + 0.005, r + 0.005, 18), 0.0065, CHROME, METAL, { segs: 5, closed: true });
    g.fan(closedRing(lift(c, N, 0.002), u, v, r, r, 18), lift(c, N, 0.002), N, GAUGE_FACE, M(MAT.RUBBER));
    const arc = (t) => (225 - 270 * t) * Math.PI / 180;
    for (let i = 0; i < ticks; i++) {
      const th = arc(i / (ticks - 1)), cs = Math.cos(th), sn = Math.sin(th), w = 0.0022;
      const p0 = lift(pt(c, u, cs * r * 0.7, v, sn * r * 0.7), N, 0.0035), p1 = lift(pt(c, u, cs * r * 0.88, v, sn * r * 0.88), N, 0.0035);
      const t = [-sn * w, cs * w];
      g.quad(pt(p0, u, -t[0], v, -t[1]), pt(p0, u, t[0], v, t[1]), pt(p1, u, t[0], v, t[1]), pt(p1, u, -t[0], v, -t[1]), i > ticks - 3 ? [0.95, 0.15, 0.1] : TICK, M(MAT.RUBBER), N);
    }
    const th = arc(needle), cs = Math.cos(th), sn = Math.sin(th), w = 0.0034;
    const p1 = lift(pt(c, u, cs * r * 0.78, v, sn * r * 0.78), N, 0.005), p0 = lift(pt(c, u, -cs * r * 0.14, v, -sn * r * 0.14), N, 0.005);
    g.quad(pt(p0, u, sn * w, v, -cs * w), pt(p0, u, -sn * w, v, cs * w), pt(p1, u, -sn * w * 0.3, v, cs * w * 0.3), pt(p1, u, sn * w * 0.3, v, -cs * w * 0.3), AMBER, M(MAT.LIGHT, 0, 0.7), N);
    g.fan(closedRing(lift(c, N, 0.0058), u, v, r * 0.11, r * 0.11, 8), lift(c, N, 0.0058), N, CHROME, METAL);
  }
  // a rectangle on a panel
  const rect = (S, a, b, hw, hh, col, mat, lf = 0.004) => {
    const { u, v, N } = S, c = lift(pt(S.c, u, a, v, b), N, lf);
    g.quad(pt(c, u, -hw, v, -hh), pt(c, u, hw, v, -hh), pt(c, u, hw, v, hh), pt(c, u, -hw, v, hh), col, mat, N);
  };
  // flat ring outline of a rounded rectangle at height y
  const outlineTube = (cx, cz, hx, hz, r, y, tr, col, mat) => g.tube(rrect(cx, cz, hx, hz, r, 2).map(([x, z]) => [x, y, z]), tr, col, mat, { segs: 4, closed: true });

  // ---- dash: gauge pod, chart plotter, switch panel, throttle ----
  {
    // gauge pod in front of the driver
    const P = slab(1.3, SEAT_Z, 0.19, 0.25, 0.06, 2.0, DARK, RUBBER);
    gauge(P, -0.05, -0.11, 0.058, 0.62); gauge(P, -0.05, 0.075, 0.058, 0.34);
    gauge(P, 0.12, -0.14, 0.034, 0.7, 5); gauge(P, 0.12, -0.04, 0.034, 0.45, 5); gauge(P, 0.12, 0.06, 0.034, 0.8, 5); gauge(P, 0.12, 0.16, 0.034, 0.5, 5);
    // warning lamps along the lower edge of the pod
    [[0.22, [1, 0.12, 0.08]], [0.25, [1, 0.62, 0.1]], [0.28, [0.1, 0.9, 0.3]]].forEach(([z, col], i) => rect(P, 0.17, -0.2 + i * 0.03 - 0.0, 0.007, 0.007, col, M(MAT.LIGHT, 0, 0.6), 0.004));

    // chart plotter on the passenger side: a bezel, a lit screen with a chart, buttons
    const C = slab(1.36, -0.36, 0.11, 0.195, 0.05, 1.3, DARK, RUBBER, 0.02);
    rect(C, 0, 0, 0.088, 0.171, [0.01, 0.012, 0.015], M(MAT.RUBBER), 0.003);
    rect(C, 0, 0, 0.074, 0.158, [0.05, 0.16, 0.34], M(MAT.LIGHT, 0, 0.55), 0.0045);
    rect(C, 0.012, -0.07, 0.05, 0.05, [0.4, 0.36, 0.22], M(MAT.LIGHT, 0, 0.5), 0.0055);
    rect(C, 0.02, -0.08, 0.03, 0.03, [0.16, 0.36, 0.17], M(MAT.LIGHT, 0, 0.5), 0.0065);
    rect(C, -0.02, 0.06, 0.007, 0.07, [1, 0.8, 0.12], M(MAT.LIGHT, 0, 0.9), 0.007);
    rect(C, -0.052, 0.0, 0.006, 0.04, [1, 0.8, 0.12], M(MAT.LIGHT, 0, 0.9), 0.007);
    rect(C, -0.066, 0.0, 0.006, 0.158, [0.02, 0.07, 0.15], M(MAT.LIGHT, 0, 0.4), 0.0055);
    rect(C, 0.01, 0.12, 0.012, 0.012, [1, 1, 1], M(MAT.LIGHT, 0, 0.9), 0.0075);
    for (let i = 0; i < 6; i++) rect(C, 0.1, -0.12 + i * 0.048, 0.01, 0.014, [0.2, 0.21, 0.23], M(MAT.METAL), 0.003);

    // switch panel between them: rocker switches with small indicators
    const W = slab(1.3, 0.0, 0.085, 0.1, 0.03, 0.5, DARK, RUBBER, 0.015);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) {
      const a = -0.035 + j * 0.07, b = -0.075 + i * 0.05;
      rect(W, a, b, 0.017, 0.015, [0.11, 0.115, 0.12], M(MAT.RUBBER), 0.0035);
      rect(W, a, b, 0.012, 0.006, j === 0 ? [0.8, 0.8, 0.78] : [0.9, 0.9, 0.9], M(MAT.RUBBER), 0.0065);
      rect(W, a + 0.0, b + 0.024 - 0.0, 0.0045, 0.0025, i === 1 || i === 2 ? AMBER : [0.1, 0.1, 0.1], M(MAT.LIGHT, 0, i === 1 || i === 2 ? 0.8 : 0.02), 0.004);
    }

    // throttle and shift: a binnacle with three levers and black knobs
    const Th = slab(1.1, 0.74, 0.095, 0.062, 0.03, 0.0, DARK, METAL, 0.02);
    for (const z of [0.706, 0.74, 0.774]) {
      g.tube([[1.075, 1.04, z], [1.1, 1.09, z], [1.15, 1.16, z]], 0.0065, CHROME, METAL, { segs: 6 });
      blob(g, [1.162, 1.172, z], 0.018, 0.017, 0.013, BLACK, RUBBER, { n: 5, segs: 8 });
    }
    g.box(1.1 - 0.012, 1.1 + 0.012, 1.025, 1.04, 0.69, 0.79, CHROME, METAL);
    for (const [x, z, col] of [[1.17, 0.7, [1, 0.12, 0.08]], [1.17, 0.78, [0.1, 0.9, 0.3]]]) g.lathe([[0, 1.025], [0.012, 1.025], [0.012, 1.036], [0, 1.038]], col, M(MAT.LIGHT, 0, 0.7), 8, x, z);
    // ignition and the engine kill lanyard clip
    g.lathe([[0, 1.0], [0.02, 1.0], [0.02, 1.02], [0.012, 1.026], [0, 1.026]], CHROME, METAL, 10, 1.18, 0.58);
  }
  // a grab handle's base plates, and cup holders in the side decks
  for (const z of [-0.62, -0.16]) g.lathe([[0, 1.0], [0.032, 1.0], [0.032, 1.012], [0.02, 1.018], [0, 1.018]], CHROME, METAL, 10, 1.02, z);
  for (const sg of [-1, 1]) for (const x of [-2.4]) {
    const p = dk(x, sg * 1.16), y = p[1];
    g.lathe([[0, y + 0.012], [0.034, y + 0.012], [0.034, y + 0.006], [0, y + 0.006]], BLACK, RUBBER, 14, x, sg * 1.16);
    g.tube(Array.from({ length: 14 }, (_, k) => { const a = (k / 14) * 2 * Math.PI; return [x + 0.043 * Math.cos(a), y + 0.014, sg * 1.16 + 0.043 * Math.sin(a)]; }), 0.0075, CHROME, METAL, { segs: 5, closed: true });
  }
  // fuel and water fillers
  for (const [sg, x, col] of [[-1, -2.78, [0.8, 0.12, 0.1]], [1, -2.78, [0.1, 0.35, 0.8]]]) {
    const z = sg * 1.17, y = dk(x, z)[1];
    g.lathe([[0, y + 0.014], [0.026, y + 0.014], [0.032, y + 0.01], [0.04, y + 0.004], [0.042, y]], CHROME, METAL, 16, x, z);
    g.lathe([[0, y + 0.02], [0.016, y + 0.02], [0.019, y + 0.014], [0.019, y + 0.012]], col, M(MAT.RUBBER), 12, x, z);
    g.box(x - 0.012, x + 0.012, y + 0.018, y + 0.022, z - 0.003, z + 0.003, BLACK, RUBBER);
  }

  // ---- console aft face: a locker door with hinges and a latch ----
  {
    const x = DASH_X + 0.004;
    for (const [y0, y1, z0, z1] of [[0.56, 0.58, -0.52, 0.52], [0.9, 0.92, -0.52, 0.52], [0.56, 0.92, -0.52, -0.5], [0.56, 0.92, 0.5, 0.52]]) g.box(x - 0.002, x + 0.006, y0, y1, z0, z1, DARK, RUBBER);
    for (const y of [0.64, 0.84]) g.box(x, x + 0.01, y - 0.03, y + 0.03, 0.5, 0.54, CHROME, METAL);
    g.box(x, x + 0.014, 0.72, 0.78, -0.46, -0.4, CHROME, METAL);
    g.box(x + 0.01, x + 0.02, 0.73, 0.77, -0.45, -0.41, DARK, RUBBER);
  }

  // ---- windscreen frame: bolt-on brackets, stays and a thicker frame ----
  {
    for (const z of [-0.96, -0.64, -0.32, 0.0, 0.32, 0.64, 0.96]) {
      const x = xBase(z), y = deckY(x, z);
      g.box(x - 0.045, x + 0.045, y, y + 0.022, z - 0.034, z + 0.034, CHROME, METAL);
      for (const dz of [-0.018, 0.018]) g.lathe([[0, y + 0.022], [0.01, y + 0.022], [0.01, y + 0.027], [0, y + 0.029]], [0.6, 0.62, 0.65], METAL, 6, x - 0.02, z + dz);
    }
    // stays from the top corners back to the gunwale
    for (const sg of [-1, 1]) {
      const z = sg * ZW * 0.94, x = xBase(z) - 0.33, y = glassBaseY(z) + glassH(z) - 0.02;
      g.tube([[x, y, z], [x - 0.12, y - 0.2, z + sg * 0.05], [x - 0.24, deckY(x - 0.24, z + sg * 0.1) + 0.01, z + sg * 0.1]], 0.012, CHROME, METAL, { segs: 6 });
    }
    // grab rail along the top of the frame in front of the passenger
    g.tube(bent([[1.45, 1.52, -0.7], [1.54, 1.56, -0.7], [1.54, 1.56, -0.25], [1.45, 1.52, -0.25]], 0.04), 0.011, CHROME, METAL, { segs: 6 });
  }

  // ---- stitched piping on the seats (it takes the livery colour) ----
  {
    const pipe = (outline, base, h, rad, post = (p) => p, closeUp = 0) => {
      const n = outline.length, pts = [];
      const a = (Math.PI / 3), ins = rad * (1 - Math.cos(a)), lf = h - rad + rad * Math.sin(a);
      let area = 0;
      for (let j = 0; j < n; j++) { const p = outline[j], q = outline[(j + 1) % n]; area += p[0] * q[1] - q[0] * p[1]; }
      const side = area >= 0 ? 1 : -1;
      outline.forEach(([x, z], j) => {
        const p0 = outline[(j + n - 1) % n], p1 = outline[(j + 1) % n];
        const tx = p1[0] - p0[0], tz = p1[1] - p0[1], l = Math.hypot(tx, tz) || 1;
        const px = x + (-tz / l) * side * ins, pz = z + (tx / l) * side * ins;
        pts.push(post([px, base(px, pz) + lf, pz]));
      });
      g.tube(pts, 0.0055, [0.95, 0.95, 0.95], M(MAT.UPHOLSTERY, 1, 1), { segs: 4, closed: true });
    };
    const lean2 = (y0, k) => (p) => [p[0] + k * (p[1] - y0), p[1], p[2]];
    for (const sg of [-1, 1]) {
      const z0 = sg * SEAT_Z;
      pipe(rrect(0.2, z0, 0.31, 0.3, 0.09), () => 0.58, 0.15, 0.05);
      pipe(rrect(0.44, z0, 0.1, 0.3, 0.05), () => 0.58, 0.21, 0.05);
      pipe(rrect(-0.12, z0, 0.075, 0.3, 0.05), () => 0.62, 0.68, 0.05, lean2(0.62, -0.25));
      pipe(rrect(-2.69, sg * 0.5, 0.3, 0.495, 0.07), () => 0.5, 0.15, 0.05);
      pipe(rrect(-2.93, sg * 0.5, 0.06, 0.485, 0.04), () => 0.62, 0.42, 0.04, lean2(0.62, -0.2));
      pipe(rrect(-1.4, sg * 0.72, 0.86, 0.27, 0.08), () => 0.5, 0.15, 0.05);
    }
  }

  // ---- hatches: the anchor locker on the foredeck and two in the cockpit sole ----
  {
    const hatch = (cx, cz, hx, hz, y, hingeSide) => {
      outlineTube(cx, cz, hx, hz, 0.02, y + 0.003, 0.006, BLACK, RUBBER);
      outlineTube(cx, cz, hx - 0.03, hz - 0.03, 0.015, y + 0.003, 0.004, CHROME, METAL);
      for (const dz of [-hz * 0.55, hz * 0.55]) g.box(cx + hingeSide * hx - 0.022, cx + hingeSide * hx + 0.022, y, y + 0.014, cz + dz - 0.03, cz + dz + 0.03, CHROME, METAL);
      g.box(cx - hingeSide * (hx - 0.045) - 0.022, cx - hingeSide * (hx - 0.045) + 0.022, y, y + 0.012, cz - 0.03, cz + 0.03, CHROME, METAL);
      g.box(cx - hingeSide * (hx - 0.045) - 0.012, cx - hingeSide * (hx - 0.045) + 0.012, y + 0.012, y + 0.016, cz - 0.016, cz + 0.016, DARK, RUBBER);
    };
    hatch(2.14, 0, 0.14, 0.3, deckY(2.14, 0) + 0.015, 1);
    hatch(-1.25, 0, 0.36, 0.3, SOLE, 1);
  }

  // ---- hull: lifting strakes, boot stripe, transom fittings, trim tabs, bow eye ----
  {
    // lifting strakes on the bottom: narrow steps that carry the boat up on the plane (and show when it jumps)
    for (const s0 of [-0.78, -0.45, 0.45, 0.78]) {
      const path = [];
      for (const x of rowsFrom(-4.1, 2.6)) {
        const e = 1e-3, p = bottomFn(x, s0);
        const du = sub(bottomFn(x + e, s0), bottomFn(x - e, s0)), dv = sub(bottomFn(x, s0 + e), bottomFn(x, s0 - e));
        let n = norm([du[1] * dv[2] - du[2] * dv[1], du[2] * dv[0] - du[0] * dv[2], du[0] * dv[1] - du[1] * dv[0]]);
        if (n[1] > 0) n = n.map((c) => -c);
        // fade the strake out toward the bow where the bottom rises
        const k = smooth(2.7, 1.6, x);
        path.push({ p, n, k });
      }
      // a triangular fin: its base sunk into the hull, its tip standing out along the bottom's normal
      const rings = path.map(({ p, n, k }) => {
        const u = norm(cross(n, [1, 0, 0]));
        return [add(p, add(u.map((c) => -c * 0.03), n.map((c) => -c * 0.004))), add(p, n.map((c) => c * (0.032 * k + 0.001))), add(p, add(u.map((c) => c * 0.03), n.map((c) => -c * 0.004)))];
      });
      g.loft(rings, GEL, GELM, { closed: false, ref: (i) => add(path[i].p, path[i].n.map((c) => -c * 0.1)) });
    }
    // boot stripe: a dark band along the lower side, just above the waterline
    for (const sg of [-1, 1]) g.surf((x, v) => { const p = sideFn(sg)(x, lerp(0.07, 0.17, v)); return [p[0], p[1], p[2] + sg * 0.004]; }, rowsFrom(-4.1, 3.4), lin(0, 1, 2), NAVY, GELM, { away: INSIDE });
    // hull side vents (louvred, flush) aft of midships
    for (const sg of [-1, 1]) {
      const p = sideFn(sg)(-1.9, 0.62), zo = p[2] + sg * 0.008, zi = p[2] - sg * 0.01;
      g.box(p[0] - 0.1, p[0] + 0.1, p[1] - 0.025, p[1] + 0.025, Math.min(zo, zi), Math.max(zo, zi), BLACK, RUBBER);
      for (let i = 0; i < 4; i++) g.box(p[0] - 0.085 + i * 0.045, p[0] - 0.072 + i * 0.045, p[1] - 0.02, p[1] + 0.02, Math.min(p[2] + sg * 0.006, p[2] + sg * 0.012), Math.max(p[2] + sg * 0.006, p[2] + sg * 0.012), CHROME, METAL);
    }
    // transom: drain plugs, a bilge outlet and a transom plate
    for (const z of [-0.95, 0.95]) g.lathex([[X0, 0], [X0 - 0.008, 0.026], [X0 - 0.016, 0.022], [X0 - 0.02, 0]], CHROME, METAL, 12, 0.14, z);
    for (const z of [-0.35, 0.35]) g.lathex([[X0, 0], [X0 - 0.006, 0.018], [X0 - 0.012, 0.014], [X0 - 0.014, 0]], CHROME, METAL, 10, 0.5, z);
    // trim tabs: hinged plates under the aft end of the bottom, with their actuators
    for (const s of [-0.8, 0.8]) {
      const p = bottomFn(X0 + 0.02, s), z = p[2];
      g.box(X0 - 0.3, X0 + 0.01, p[1] - 0.018, p[1] - 0.004, z - 0.17, z + 0.17, [0.3, 0.32, 0.35], METAL);
      g.box(X0 - 0.012, X0 + 0.004, p[1] - 0.024, p[1] + 0.012, z - 0.17, z + 0.17, CHROME, METAL);
      g.tube([[X0 - 0.01, p[1] + 0.07, z], [X0 - 0.2, p[1] - 0.012, z]], 0.012, [0.1, 0.1, 0.11], METAL, { segs: 6 });
    }
    // bow eye with its backing plate and a stem-head fitting
    {
      const y = 0.92, x = 4.74 + 0.012;
      const eye = Array.from({ length: 14 }, (_, k) => { const a = (k / 14) * 2 * Math.PI; return [x + 0.035 + 0.035 * Math.cos(a), y + 0.035 * Math.sin(a), 0]; });
      g.tube(eye, 0.009, CHROME, METAL, { segs: 6, closed: true });
      g.box(x - 0.03, x + 0.012, y - 0.04, y + 0.04, -0.045, 0.045, CHROME, METAL);
    }
    // fairleads on the foredeck edge
    for (const sg of [-1, 1]) {
      const x = 3.7, z = sg * (bs(x) - 0.12), p = dk(x, z);
      g.box(p[0] - 0.05, p[0] + 0.05, p[1] - 0.004, p[1] + 0.018, z - 0.022, z + 0.022, CHROME, METAL);
      g.tube([[p[0] - 0.045, p[1] + 0.018, z], [p[0], p[1] + 0.034, z], [p[0] + 0.045, p[1] + 0.018, z]], 0.011, CHROME, METAL, { segs: 6 });
    }
  }

  // ---- non-skid panels with borders on the walkways and the foredeck ----
  {
    const walk = (sg, xa, xb, inner, outer) => {
      const pts = [];
      const xs = lin(xa, xb, 8);
      for (const x of xs) pts.push([x, sg * outer(x)]);
      for (const x of xs.slice().reverse()) pts.push([x, sg * inner(x)]);
      return pts;
    };
    for (const sg of [-1, 1]) {
      // the side decks of the cockpit
      pad(g, walk(sg, -2.15, 0.4, (x) => wOpen(x) + 0.06, (x) => bs(x) - 0.075), deckY, 0.011, 0.004, SKID, M(MAT.NONSKID), { crown: 0 });
      // beside the bow pad
      pad(g, walk(sg, 2.5, 3.2, (x) => 0.62 * bs(x) + 0.05, (x) => bs(x) - 0.12), deckY, 0.011, 0.004, SKID, M(MAT.NONSKID), { crown: 0, post: (p) => H(p[0], p[1], p[2]) });
      // in front of the windscreen
      pad(g, walk(sg, 2.0, 2.4, (x) => 0.44, (x) => bs(x) - 0.12), deckY, 0.011, 0.004, SKID, M(MAT.NONSKID), { crown: 0, post: (p) => H(p[0], p[1], p[2]) });
    }
    // a step on the aft deck and one on the swim platform's edge
    pad(g, rrect(-3.99, 0, 0.1, 0.5, 0.03), deckY, 0.011, 0.004, SKID, M(MAT.NONSKID), { crown: 0 });
  }
  return g;
}
