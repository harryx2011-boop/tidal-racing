import { Geo, MAT, add, sub, norm } from '../geo.js';

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
  const WHITE = [0.86, 0.87, 0.88], GEL = [0.88, 0.89, 0.9], CREAM = [0.9, 0.88, 0.83], TEAK = [0.55, 0.36, 0.18];
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

  // rub rail: a half-round bead along the sheer and across the transom
  {
    const bead = lin(-90, 90, 8).map((a) => [0.036 * Math.cos((a * Math.PI) / 180), 0.04 * Math.sin((a * Math.PI) / 180)]);
    for (const sg of [-1, 1]) {
      const path = rowsFrom(X0, 4.45).map((x) => ({ p: H(x, ys(x), sg * (bs(x) + 0.008)), n: norm([-dBs(x), 0, sg]) }));
      g.sweep(path, bead, CHROME, METAL);
    }
    const across = lin(-1, 1, 24).map((s) => ({ p: [X0 - 0.008, ys(X0) + camber(X0) * (1 - s * s), s * bs(X0)], n: [-1, 0, 0] }));
    g.sweep(across, bead, CHROME, METAL);
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

  for (const z0 of MOTOR_Z) {
    const cowl = [[0.93, -4.84, 0.27, 0.19], [1.05, -4.83, 0.30, 0.22], [1.22, -4.82, 0.31, 0.23], [1.38, -4.82, 0.29, 0.215], [1.49, -4.83, 0.225, 0.165], [1.55, -4.84, 0.13, 0.095]]
      .map(([y, cx, ax, az]) => ring(y, cx, ax, az, 2.6, 20, z0));
    cowl.push(cowl[cowl.length - 1].map(() => [-4.84, 1.565, z0]));
    g.loft(cowl, WHITE, GELM);
    g.tube(ring(1.1, -4.826, 0.305, 0.225, 2.6, 24, z0).concat([ring(1.1, -4.826, 0.305, 0.225, 2.6, 24, z0)[0]]), 0.01, BLACK, RUBBER, { segs: 5 });
    // leg housing and gear case
    g.loft([[0.94, -4.84, 0.25, 0.17], [0.5, -4.85, 0.22, 0.14], [0.1, -4.87, 0.2, 0.12], [-0.32, -4.88, 0.19, 0.11]].map(([y, cx, ax, az]) => ring(y, cx, ax, az, 2.4, 16, z0)), WHITE, GELM);
    g.lathex([[-5.2, 0], [-5.17, 0.06], [-5.05, 0.11], [-4.9, 0.125], [-4.75, 0.11], [-4.66, 0.06], [-4.64, 0]], WHITE, GELM, 14, -0.46, z0);
    g.box(-5.02, -4.72, -0.62, -0.45, z0 - 0.02, z0 + 0.02, WHITE, GELM);
    g.box(-5.12, -4.64, -0.2, -0.17, z0 - 0.17, z0 + 0.17, WHITE, GELM);
    g.box(-4.66, -4.56, 0.3, 0.86, z0 - 0.14, z0 + 0.14, CHROME, METAL);
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
  return g;
}
