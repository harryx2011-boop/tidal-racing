import { Geo, rng, TAU, lerp, clamp, smooth, scl, mixc, vn, fb, mat, DV, GEL, RUB, MET, GLS, NSK, TEAK, LIT, CLOTH, TEX, tube, rod, lathe, box, slab, quad, fan, loft, surf, sheet, blob, lin, mark, paint, detail, xf, frame, stamp, text, mixIn, mottle, stain, rust, faded, both, inkAt, railing, ladder, chain, hoop, lifering, cleat, bollard, fender, coil } from './kit.js';
import { MAT } from '../geo.js';

// Vessels at anchor and under way: a committee boat, a sailing yacht with her sails furled, a cabin
// cruiser, a rigid inflatable and a container ship. Model space: x forward, y up, z starboard, the
// origin amidships at the waterline (the system floats the model on the sea there, see scenery.js
// and the float mode of mesh.js). Every builder returns { g, lamps, foot } where `foot` is the
// length (m) over which the sea's slope is taken for pitch and roll. Lamps are { p, col, kind }.
// Lens colours and glows are scaled by the darkness level in scenery.js. Colours are linear albedo.
//
// Levels of detail: 0 near (everything a deckhand could trip over), 1 middle (the hull, the house, spars
// and the big fittings; wires thicker and fewer, so they do not shimmer), 2 far (a few hundred
// triangles that keep the silhouette and the colours; nothing laid on top of another surface, because
// at a kilometre the depth buffer cannot tell them apart).

const lamp = (p, col, kind, extra = {}) => ({ p, col, kind, ...extra });
const WHITE = [1, 0.96, 0.85], RED = [1, 0.06, 0.04], GREEN = [0.05, 1, 0.2], WARM = [1, 0.78, 0.4];
const STEEL = [0.7, 0.72, 0.74], ALU = [0.62, 0.64, 0.66], DARK = [0.03, 0.03, 0.035], GLASS = [0.015, 0.02, 0.03];
const PLATE = mat(MAT.RUBBER, 0, 0, DV.PLATE), CORR = mat(MAT.RUBBER, 0, 0, DV.CORRUGATED), GRAINM = mat(MAT.RUBBER, 0, 0, DV.GRAIN);

// a small lens: an emissive ball
function ball(g, p, r, col) { blob(g, p, r, r, r, col, LIT, { n: 3, segs: 6 }); }

// ---- hulls ------------------------------------------------------------------------------
// A hull is a surface P(t, u) a side: t runs from 0 at the transom to 1 at the stem, u from the keel
// (or the chine) up to the sheer. Round bilge: one surface, sections y ~ z^p with p falling toward the
// bow (a U amidships, a V forward). Hard chine: a bottom from the keel to the chine and a topside from the
// chine to the sheer, which flares where the chine tucks in under the bow.
function hullShape(S) {
  const { L, B, draft, free, rise = 0.3, sternLift = 0, bow = 2.6, bowK = 0.6, keelBow = 0.8, pMid = 2.4, pBow = 1.3, rake = 0, sternW = 1, chine = null, tumble = 0 } = S;
  const x0 = -L / 2;
  const cl = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
  const half = (t) => { t = cl(t); return (B / 2) * Math.pow(Math.max(1 - Math.pow(t, bow), 2e-4), bowK) * (1 - (1 - sternW) * Math.pow(1 - Math.min(t / 0.45, 1), 2)); };
  const ys = (t) => { t = cl(t); return free + rise * Math.pow(t, 2.4) + sternLift * (1 - t) * (1 - t); };
  const yk = (t) => { t = cl(t); return -draft * (1 - keelBow * t * t); };
  const H = { L, x0, half, ys, yk, parts: [] };
  if (!chine) {
    H.parts.push((t, u, sg, out) => {
      const tc = cl(t), zf = 1 - Math.pow(1 - u, 1.6), p = lerp(pMid, pBow, tc * tc * tc), v = Math.pow(zf, p), k = yk(t), s = ys(t);
      out[0] = x0 + L * t - rake * L * Math.pow(tc, 6) * Math.pow(1 - v, 1.3);
      out[1] = k + (s - k) * v;
      out[2] = sg * half(t) * zf * (1 - tumble * v * v * (1 - tc));
    });
  } else {
    const yc = (t) => chine.y0 + chine.rise * Math.pow(cl(t), chine.pow || 3);
    const zc = (t) => half(t) * lerp(chine.w0, chine.w1, cl(t) * cl(t));
    H.yc = yc; H.zc = zc;
    H.parts.push((t, u, sg, out) => { const k = yk(t), c = yc(t); out[0] = x0 + L * t - rake * L * Math.pow(cl(t), 6) * (1 - 0.4 * u); out[1] = k + (c - k) * Math.pow(u, 1.15); out[2] = sg * zc(t) * u; });
    H.parts.push((t, u, sg, out) => { const c = yc(t), s = ys(t), a = zc(t), b = half(t); out[0] = x0 + L * t - rake * L * Math.pow(cl(t), 6) * 0.6 * (1 - u); out[1] = lerp(c, s, u); out[2] = sg * (lerp(a, b, u) + b * 0.035 * Math.sin(Math.PI * u) * (1 - cl(t))); });
  }
  // the sheer line and the deck
  const _q = [0, 0, 0];
  H.sheer = (t, sg = 1) => { H.parts[H.parts.length - 1](t, 1, sg, _q); return [_q[0], _q[1], _q[2]]; };
  H.tOf = (x) => (x - x0) / L;
  H.deckY = (x) => ys((x - x0) / L);
  H.hw = (x) => half((x - x0) / L);
  return H;
}
const val = (v, t) => (typeof v === 'function' ? v(t) : v);
// One part of a hull as bands of colour between heights (numbers or functions of t). The bands share the part's
// own surface function, so shading runs unbroken across their edges. Also closes the transom band by band.
const _hp = [0, 0, 0];
function hullBands(g, fn, T, bands, paintFn, transom = true) {
  const inv = (t, sg, y) => {
    fn(t, 0, sg, _hp); if (y <= _hp[1]) return 0;
    fn(t, 1, sg, _hp); if (y >= _hp[1]) return 1;
    let a = 0, b = 1;
    for (let k = 0; k < 22; k++) { const m = (a + b) / 2; fn(t, m, sg, _hp); if (_hp[1] < y) a = m; else b = m; }
    return (a + b) / 2;
  };
  const t0 = T[0], t1 = T[T.length - 1], lim = [t0, t1, 0, 1];
  for (const b of bands) {
    const rows = b.rows || 2;
    const u0 = T.map((t) => inv(t, 1, val(b.y0, t))), u1 = T.map((t) => inv(t, 1, val(b.y1, t)));
    if (u1.every((u, i) => u - u0[i] < 1e-5)) continue;
    for (const sg of [-1, 1]) {
      surf(g, (t, u, out) => fn(t, u, sg, out), T, lin(0, 1, rows), b.col, b.mat || GEL, { uv: (i, j, out) => { out[0] = T[i]; out[1] = lerp(u0[i], u1[i], j / rows); }, paint: paintFn, lim, eps: 2e-3 });
    }
    if (transom) sheet(g, rows + 1, 2, (i, j, out) => fn(t0, lerp(u0[0], u1[0], i / rows), j ? 1 : -1, out), b.tcol || b.col, b.mat || GEL, { paint: paintFn });
  }
}
// the deck between two stations, from q0 to q1 across (-1 port sheer .. 1 starboard), cambered
function deck(g, H, T, q0, q1, col, m, { camber = 0.06, nq = 4, paint: pf, inset = 0.985, drop = 0 } = {}) {
  sheet(g, T.length, nq + 1, (i, j, out) => {
    const t = T[i], q = lerp(val(q0, t), val(q1, t), j / nq), s = H.sheer(t), hb = Math.abs(s[2]);
    out[0] = s[0]; out[1] = s[1] - drop + camber * (1 - q * q) * Math.min(hb, 1.5); out[2] = hb * q * inset;
  }, col, m, { paint: pf });
}
const stations = (n, a = 0, b = 0.997) => Array.from({ length: n + 1 }, (_, i) => lerp(a, b, i / n));
// a bar along the sheer (a rub rail, a toe rail) from station a to b
function sheerBar(g, H, a, b, n, r, col, m, { out = 0, up = 0, segs = 4, both: bs = true, inset = 1 } = {}) {
  for (const sg of bs ? [-1, 1] : [1]) tube(g, lin(a, b, n).map((t) => { const s = H.sheer(t, sg); return [s[0], s[1] + up, s[2] * inset + sg * out]; }), r, col, m, { segs });
}

// ---- houses ------------------------------------------------------------------------------
// A superstructure lofted through stations { x, y0, y1, w, wt, r, crown }: sides leaning in from half width w
// at the base to wt under a top corner of radius r, a cambered roof. Open underneath. Returns a description
// with side(x, y, sg) and top(x, z) for placing windows and roof gear on it.
function cabin(g, st, col, m, { nc = 3, caps = [true, true], paint: pf } = {}) {
  const ring = (s) => {
    const r = s.r ?? 0.15, wt = s.wt ?? s.w, cr = s.crown ?? 0.04, pts = [[s.x, s.y0, -s.w], [s.x, s.y1 - r, -wt]];
    for (let k = 1; k <= nc; k++) { const a = Math.PI - (k / nc) * (Math.PI / 2); pts.push([s.x, s.y1 - r + r * Math.sin(a), -wt + r + r * Math.cos(a)]); }
    pts.push([s.x, s.y1 + cr * 0.75, -(wt - r) * 0.5], [s.x, s.y1 + cr, 0], [s.x, s.y1 + cr * 0.75, (wt - r) * 0.5]);
    for (let k = 0; k <= nc; k++) { const a = Math.PI / 2 - (k / nc) * (Math.PI / 2); if (k < nc) pts.push([s.x, s.y1 - r + r * Math.sin(a), wt - r + r * Math.cos(a)]); }
    pts.push([s.x, s.y1 - r, wt], [s.x, s.y0, s.w]);
    return pts;
  };
  const rings = st.map(ring);
  loft(g, rings, col, m, { closed: false, paint: pf });
  if (caps[0]) fan(g, rings[0], col, m, { paint: pf });
  if (caps[1]) fan(g, rings[rings.length - 1], col, m, { paint: pf });
  const at = (x) => {
    let i = 0; while (i < st.length - 2 && x > st[i + 1].x) i++;
    const a = st[i], b = st[i + 1], f = clamp((x - a.x) / (b.x - a.x), 0, 1), L = (k, d) => lerp(a[k] ?? d, b[k] ?? d, f);
    return { y0: L('y0', 0), y1: L('y1', 0), w: L('w', 0), wt: lerp(a.wt ?? a.w, b.wt ?? b.w, f), r: L('r', 0.15), crown: L('crown', 0.04) };
  };
  return {
    st, at,
    side: (x, y, sg, off = 0) => { const s = at(x), f = clamp((y - s.y0) / (s.y1 - s.r - s.y0), 0, 1); return [x, y, sg * (lerp(s.w, s.wt, f) + off)]; },
    top: (x, z = 0) => { const s = at(x); return s.y1 + s.crown * (1 - Math.min(1, (z / s.wt) * (z / s.wt))); },
  };
}
// A window: glass over the polygon `pts` (already on the surface, a little proud of it) and, near, a frame round it.
function pane(g, pts, lod, frameCol = [0.72, 0.74, 0.76], fm = MET, glass = GLASS) {
  fan(g, pts, glass, GLS);
  if (!lod) tube(g, pts, 0.012, frameCol, fm, { segs: 3, closed: true });
}
// a window on the side of a house between x0..x1 and y0..y1, corners cut; rake leans the ends (a raked windscreen line)
function sideWindow(g, C, x0, x1, y0, y1, sg, lod, { rake = 0, cut = 0.06, frame: fc, fm, off = 0.012 } = {}) {
  const P = (x, y) => C.side(x + rake * (y - y0), y, sg, lod ? off * 2 : off);
  const pts = lod ? [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)] : [P(x0 + cut, y0), P(x1 - cut, y0), P(x1, y0 + cut), P(x1, y1 - cut), P(x1 - cut, y1), P(x0 + cut, y1), P(x0, y1 - cut), P(x0, y0 + cut)];
  pane(g, pts, lod, fc, fm);
}

// ---- common gear ---------------------------------------------------------------------------
// a self-tailing winch
function winch(g, p, s = 1) {
  lathe(g, [[0.075, 0], [0.075, 0.03], [0.055, 0.045], [0.048, 0.11], [0.06, 0.125], [0.065, 0.15], [0.065, 0.15], [0.03, 0.16], [0, 0.16]].map(([r, h]) => [r * s, h * s]), [0.74, 0.75, 0.77], MET, { segs: 10, at: p });
}
// a hatch: a low frame with a tinted lid
function hatch(g, c, hx, hz, lod, yaw = 0) {
  box(g, [c[0], c[1] + 0.03, c[2]], hx, 0.03, hz, [0.8, 0.8, 0.77], GEL, { yaw });
  if (lod < 2) box(g, [c[0], c[1] + 0.066, c[2]], hx - 0.035, 0.006, hz - 0.035, [0.03, 0.04, 0.05], GLS, { yaw });
}
// a cowl vent
function cowl(g, p, s = 1, col = [0.8, 0.8, 0.77]) {
  const s0 = mark(g);
  tube(g, [[0, 0, 0], [0, 0.16, 0], [0.03, 0.25, 0], [0.1, 0.29, 0]], [0.045, 0.045, 0.055, 0.075], col, GEL, { segs: 8 });
  lathe(g, [[0.0, 0], [0.07, 0.005]], [0.4, 0.03, 0.02], GEL, { segs: 8, axis: 'x', at: [0.085, 0.285, 0] });
  xf(g, s0, frame(p, 0, 0, 0, s));
}
// anchor chain from the bow down into the sea: links where it shows, a bar below the surface
function rode(g, a, b, lod) {
  const f = clamp((a[1] + 0.25) / (a[1] - b[1]), 0, 1), m = [lerp(a[0], b[0], f), lerp(a[1], b[1], f), lerp(a[2], b[2], f)];
  if (lod === 0) chain(g, a, m, [0.2, 0.19, 0.18], MET, { link: 0.1, r: 0.011 }); else rod(g, a, m, 0.02, [0.12, 0.12, 0.12], RUB, 3);
  rod(g, m, b, 0.018, [0.1, 0.1, 0.1], RUB, 3);
}
// a plough anchor stowed in a bow roller, its shank along +x from p
function anchorStowed(g, p, s = 1) {
  const s0 = mark(g), c = [0.5, 0.5, 0.52];
  box(g, [0.05, 0.02, 0], 0.3, 0.018, 0.02, c, MET);                      // shank
  fan(g, [[0.32, 0.03, 0], [0.42, -0.26, -0.17], [0.52, -0.3, 0], [0.42, -0.26, 0.17]], c, MET);
  fan(g, [[0.32, 0.03, 0], [0.42, -0.26, -0.17], [0.3, -0.12, -0.05]], scl(c, 0.8), MET); fan(g, [[0.32, 0.03, 0], [0.42, -0.26, 0.17], [0.3, -0.12, 0.05]], scl(c, 0.8), MET);
  for (const z of [-1, 1]) box(g, [0.1, 0.0, z * 0.045], 0.18, 0.04, 0.006, [0.6, 0.6, 0.62], MET);   // roller cheeks
  lathe(g, [[0.03, -0.04], [0.02, 0], [0.03, 0.04]], DARK, RUB, { segs: 6, axis: 'x', at: [0.25, -0.02, 0] });
  xf(g, s0, frame(p, 0, 0, 0, s));
}
// a small inflatable tender: a U of tube, a transom board, a floor, a thwart
function tender(g, p, yaw, lod, col = [0.5, 0.5, 0.48]) {
  const s0 = mark(g), pts = [];
  for (let k = 0; k <= 12; k++) { const a = -Math.PI / 2 + (k / 12) * Math.PI; pts.push([0.55 + Math.cos(a) * 0.75 * (1 - 0.25 * Math.pow(Math.cos(a), 2)), 0.2 + 0.1 * Math.pow(Math.max(Math.cos(a), 0), 2), Math.sin(a) * 0.58]); }
  const path = [[-1.05, 0.2, -0.58], [-0.3, 0.2, -0.58], ...pts, [-0.3, 0.2, 0.58], [-1.05, 0.2, 0.58]];
  tube(g, path, 0.2, col, RUB, { segs: lod ? 5 : 9, caps: true });
  quad(g, [-0.95, 0.06, -0.5], [1.0, 0.06, -0.4], [1.0, 0.06, 0.4], [-0.95, 0.06, 0.5], [0.25, 0.25, 0.26], RUB);
  box(g, [-0.95, 0.3, 0], 0.025, 0.22, 0.42, [0.3, 0.2, 0.1], TEAK);
  if (!lod) {
    box(g, [0.05, 0.36, 0], 0.1, 0.015, 0.5, [0.3, 0.2, 0.1], TEAK);
    for (const z of [-1, 1]) { rod(g, [-0.4, 0.42, z * 0.6], [0.9, 0.44, z * 0.5], 0.015, [0.5, 0.4, 0.2], RUB, 4); tube(g, [[-0.6, 0.39, z * 0.6], [-0.2, 0.42, z * 0.63], [0.5, 0.42, z * 0.6]], 0.008, [0.03, 0.03, 0.03], RUB, { segs: 3 }); }
    paint(g, s0, stain(3, { weedTop: 0.02, tide: 0.04 }));
  }
  xf(g, s0, frame(p, yaw));
}
// a small outboard clamped on a rail or transom at p (the leg points down)
function outboard(g, p, s = 1, col = [0.08, 0.08, 0.09]) {
  const s0 = mark(g);
  blob(g, [0, 0.12, 0], 0.17, 0.12, 0.11, col, GEL, { n: 4, segs: 8, p: 2.6 });
  box(g, [0.02, -0.02, 0], 0.11, 0.03, 0.08, [0.5, 0.5, 0.52], MET);
  box(g, [0.03, -0.32, 0], 0.035, 0.28, 0.03, [0.3, 0.31, 0.33], GEL);
  box(g, [0.01, -0.5, 0], 0.11, 0.008, 0.06, [0.3, 0.31, 0.33], GEL);
  lathe(g, [[0.0, -0.1], [0.035, -0.06], [0.035, 0.06], [0.0, 0.12]], [0.3, 0.31, 0.33], GEL, { segs: 6, axis: 'x', at: [0.02, -0.6, 0] });
  rod(g, [0.15, 0.1, 0], [0.42, 0.14, 0.05], 0.014, DARK, RUB, 4);
  xf(g, s0, frame(p, Math.PI, 0, 0, s));
}

// weathering shared by the hulls: tone, the wet band and weed at the waterline, salt above it
const hullPaint = (seed, wet = 0.14) => both(mottle(seed, 0.05, 0.9), stain(seed, { weedTop: 0.06, tide: 0.1, wet, salt: 0.12 }));

// =========================================================================================
// Sailing yacht at anchor: a 10.6 m sloop, sails furled
// =========================================================================================
export const YACHT = { length: 10.6, radius: 8, mast: 14.6 };
const YACHTS = [
  { hull: [0.03, 0.06, 0.16], stripe: [0.7, 0.7, 0.66], boot: [0.7, 0.7, 0.66], anti: [0.3, 0.05, 0.04], canvas: [0.03, 0.06, 0.18], teak: true, wheel: true, name: 'KITTIWAKE' },
  { hull: [0.72, 0.7, 0.62], stripe: [0.28, 0.03, 0.04], boot: [0.28, 0.03, 0.04], anti: [0.04, 0.07, 0.16], canvas: [0.25, 0.03, 0.04], teak: false, wheel: false, name: 'SELKIE', moored: true, tender: true, fenders: true },
  { hull: [0.04, 0.16, 0.1], stripe: [0.62, 0.5, 0.2], boot: [0.72, 0.72, 0.68], anti: [0.12, 0.13, 0.2], canvas: [0.42, 0.36, 0.24], teak: true, wheel: true, name: 'PETREL', radar: true, outboard: true, fenders: true },
];
export function yachtGeo(lod = 0, seed = 1) {
  const g = new Geo(lod ? 4096 : 65536), lamps = [], V = YACHTS[(((seed - 1) % 3) + 3) % 3], R = rng(seed * 31 + 7);
  const near = lod === 0, far = lod === 2;
  const white = [0.8, 0.79, 0.74], teakC = [0.42, 0.3, 0.17], deckC = V.teak ? teakC : [0.66, 0.66, 0.62], DM = V.teak ? TEAK : NSK;
  const S = { L: 10.6, B: 3.4, draft: 0.62, free: 0.95, rise: 0.42, sternLift: 0.06, bow: 2.3, bowK: 0.62, keelBow: 0.9, pMid: 2.6, pBow: 1.35, rake: 0.05, sternW: 0.8, tumble: 0.03 };
  const H = hullShape(S), fn = H.parts[0];
  const T = stations(far ? 6 : lod ? 10 : 26), hp = far ? null : hullPaint(seed);
  const sy = (t) => H.ys(t);
  hullBands(g, fn, T, far
    ? [{ y0: -9, y1: 0.08, col: V.anti, rows: 1 }, { y0: 0.08, y1: (t) => sy(t) - 0.18, col: V.hull, rows: 2 }, { y0: (t) => sy(t) - 0.18, y1: 9, col: V.stripe, rows: 1 }]
    : [{ y0: -9, y1: 0.03, col: V.anti, rows: lod ? 2 : 3 }, { y0: 0.03, y1: 0.11, col: V.boot, rows: 1 }, { y0: 0.11, y1: (t) => sy(t) - 0.2, col: V.hull, rows: lod ? 2 : 4 },
      { y0: (t) => sy(t) - 0.2, y1: (t) => sy(t) - 0.15, col: V.stripe, rows: 1 }, { y0: (t) => sy(t) - 0.15, y1: 9, col: V.hull, rows: 1 }], hp);
  const dy = H.deckY, hw = H.hw;
  const MY = 1.66, top = YACHT.mast, MX = 1.0;
  // ---- deck: one sheet forward; aft of the bridge deck it parts round the cockpit well ----
  const tA = H.tOf(-4.55), tB = H.tOf(-2.55), WELL = 0.5, FLOOR = 0.5;
  if (far) deck(g, H, T, -1, 1, deckC, DM, { nq: 2 });
  else {
    const dn = lod ? 2 : 4;
    deck(g, H, lin(tB, 0.997, lod ? 7 : 14), -1, 1, deckC, DM, { nq: dn });
    deck(g, H, lin(0, tA, 2), -1, 1, deckC, DM, { nq: dn });
    const wq = (t) => WELL / (H.half(t) * 0.985);
    deck(g, H, lin(tA, tB, 3), -1, (t) => -wq(t), deckC, DM, { nq: 2 });
    deck(g, H, lin(tA, tB, 3), wq, 1, deckC, DM, { nq: 2 });
    // the well: sides, ends and a grating on the sole
    const xa = -4.55, xb = -2.55, top = dy(-3.5) + 0.05;
    for (const s of [-1, 1]) quad(g, [xa, FLOOR, s * WELL], [xb, FLOOR, s * WELL], [xb, top, s * WELL], [xa, top, s * WELL], white, GEL);
    quad(g, [xa, FLOOR, -WELL], [xa, FLOOR, WELL], [xa, top, WELL], [xa, top, -WELL], white, GEL);
    quad(g, [xb, FLOOR, -WELL], [xb, FLOOR, WELL], [xb, top, WELL], [xb, top, -WELL], white, GEL);
    quad(g, [xa, FLOOR, -WELL], [xb, FLOOR, -WELL], [xb, FLOOR, WELL], [xa, FLOOR, WELL], scl(teakC, 0.8), TEAK);
    // coamings with a teak cap, toe rails, rub rails
    for (const s of [-1, 1]) {
      box(g, [-3.5, dy(-3.5) + 0.11, s * 1.1], 1.2, 0.11, 0.045, white, GEL);
      if (near) box(g, [-3.5, dy(-3.5) + 0.225, s * 1.1], 1.22, 0.012, 0.06, teakC, TEAK);
    }
    sheerBar(g, H, 0, 0.997, lod ? 10 : 20, 0.022, V.teak ? teakC : white, V.teak ? TEAK : GEL, { up: 0.02, segs: 4, inset: 0.985 });
    if (near) sheerBar(g, H, 0, 0.99, 20, 0.018, [0.75, 0.75, 0.72], GEL, { up: -0.06, out: 0.004, segs: 4 });
  }
  // ---- coachroof ----
  const CS = [{ x: -2.45, y0: 0.85, y1: 1.6, w: 1.16, wt: 0.98, r: 0.13 }, { x: -1.2, y0: 0.85, y1: 1.67, w: 1.22, wt: 1.0, r: 0.14 }, { x: 1.0, y0: 0.9, y1: 1.66, w: 1.16, wt: 0.94, r: 0.14 }, { x: 2.15, y0: 1.0, y1: 1.5, w: 0.92, wt: 0.7, r: 0.12 }, { x: 2.8, y0: 1.08, y1: 1.2, w: 0.6, wt: 0.45, r: 0.05 }];
  const C = cabin(g, CS, white, GEL, { nc: far ? 1 : 3, caps: [true, false] });
  if (!far) {
    for (const s of [-1, 1]) { sideWindow(g, C, -2.0, -0.95, 1.15, 1.42, s, lod, { cut: 0.07, fm: MET }); sideWindow(g, C, -0.7, 0.45, 1.16, 1.42, s, lod, { cut: 0.07 }); sideWindow(g, C, 1.2, 1.85, 1.2, 1.38, s, lod, { cut: 0.05 }); }
    // companionway: washboards under a sliding hatch on its garage
    box(g, [-2.47, 1.2, 0], 0.012, 0.32, 0.3, scl(teakC, 0.85), TEAK);
    box(g, [-2.05, C.top(-2.05) + 0.035, 0], 0.42, 0.03, 0.36, [0.76, 0.76, 0.72], GEL);
    box(g, [-1.35, C.top(-1.35) + 0.03, 0], 0.32, 0.035, 0.42, white, GEL);
  }
  // sprayhood: canvas on two hoops, a clear panel in front
  if (!far) {
    const hoopAt = (x, hgt, wd, n) => Array.from({ length: n + 1 }, (_, k) => { const a = Math.PI * (k / n); return [x, lerp(C.top(x) - 0.25, hgt, Math.sin(a)), -Math.cos(a) * wd]; });
    const nh = lod ? 6 : 10, rings = [hoopAt(-1.72, C.top(-1.7) + 0.05, 0.86, nh), hoopAt(-2.0, 1.92, 0.9, nh), hoopAt(-2.35, 2.02, 0.92, nh), hoopAt(-2.85, 1.99, 0.9, nh)];
    loft(g, rings, V.canvas, CLOTH, { closed: false, paint: (P, N, C2, i) => { if (P[i] > -2.02 && P[i] < -1.7 && Math.abs(P[i + 2]) < 0.6 && P[i + 1] > 1.72) { C2[i] = 0.05; C2[i + 1] = 0.06; C2[i + 2] = 0.07; } } });
    if (near) for (const r of [rings[2], rings[3]]) tube(g, r, 0.013, STEEL, MET, { segs: 4 });
  } else blob(g, [-2.3, 1.75, 0], 0.55, 0.3, 0.85, V.canvas, CLOTH, { n: 2, segs: 5 });
  // ---- cockpit gear ----
  if (near) {
    for (const s of [-1, 1]) { winch(g, [-3.05, dy(-3) + 0.24, s * 1.1], 1.1); winch(g, [-1.9, C.top(-1.9, 0.62) - 0.03, s * 0.62], 0.85); cleat(g, [-4.75, dy(-4.75) + 0.03, s * (hw(-4.75) - 0.14)], 0.1); cleat(g, [4.25, dy(4.25) + 0.03, s * (hw(4.25) - 0.1)], -0.2 * s); cleat(g, [-0.2, dy(-0.2) + 0.03, s * (hw(-0.2) - 0.09)], 0); }
    // traveller on the bridge deck
    box(g, [-2.62, dy(-2.6) + 0.07, 0], 0.03, 0.02, 0.62, STEEL, MET); box(g, [-2.62, dy(-2.6) + 0.11, 0.1], 0.05, 0.03, 0.06, DARK, RUB);
    if (V.wheel) {
      // pedestal, binnacle compass, wheel with spokes, engine lever
      lathe(g, [[0.09, FLOOR], [0.07, FLOOR + 0.1], [0.06, FLOOR + 0.85], [0.1, FLOOR + 0.9], [0.1, FLOOR + 0.98], [0.07, FLOOR + 1.06], [0, FLOOR + 1.08]], white, GEL, { segs: 10, at: [-3.95, 0, 0] });
      blob(g, [-3.95, FLOOR + 1.05, 0], 0.06, 0.04, 0.06, [0.02, 0.02, 0.03], GLS, { n: 3, segs: 8 });
      const wc = [-4.08, FLOOR + 0.82, 0];
      hoop(g, wc, [1, 0.2, 0], 0.42, 0.014, STEEL, MET, 20, 4);
      for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU; rod(g, wc, [wc[0] - 0.2 * 0.42 * Math.cos(a) * 0.98, wc[1] + Math.cos(a) * 0.412, wc[2] + Math.sin(a) * 0.42], 0.007, STEEL, MET, 3); }
      rod(g, [-3.95, FLOOR + 0.7, 0.07], [-3.9, FLOOR + 0.84, 0.16], 0.01, STEEL, MET, 3);
    } else {
      // tiller: a laminated curve from the rudder head
      tube(g, [[-5.0, dy(-5) + 0.08, 0], [-4.7, dy(-5) + 0.28, 0], [-4.2, FLOOR + 0.82, 0.05], [-3.7, FLOOR + 0.84, 0.12]], [0.03, 0.028, 0.022, 0.018], [0.4, 0.26, 0.12], TEAK, { segs: 6, caps: true });
      lathe(g, [[0.05, 0], [0.05, 0.12], [0, 0.13]], STEEL, MET, { segs: 8, at: [-5.0, dy(-5), 0] });
    }
    // instruments over the companionway, a horseshoe buoy and a danbuoy on the pushpit
    box(g, [-2.44, 1.52, 0.72], 0.02, 0.07, 0.16, DARK, RUB); box(g, [-2.455, 1.52, 0.72], 0.008, 0.05, 0.14, [0.1, 0.25, 0.2], LIT);
    const s0 = mark(g);
    tube(g, Array.from({ length: 10 }, (_, k) => { const a = 0.6 + (k / 9) * (TAU - 1.2); return [0, Math.cos(a) * 0.2, Math.sin(a) * 0.2]; }), 0.045, [0.75, 0.55, 0.03], RUB, { segs: 6, caps: true });
    xf(g, s0, frame([-5.25, dy(-5.2) + 0.42, 0.72], 0.25));
    rod(g, [-5.2, dy(-5.2), -1.0], [-5.25, dy(-5.2) + 2.3, -1.02], 0.012, [0.7, 0.5, 0.05], RUB, 4);
    // the lazarette box aft, and the name across the transom
    box(g, [-5.0, dy(-5) + 0.075, 0], 0.2, 0.075, 0.3, white, GEL);
    text(g, V.name, [-5.3, 0.5, 0], [0, 0, 1], [0, 1, 0], 0.13, V.hull[0] > 0.4 ? [0.05, 0.06, 0.12] : [0.75, 0.68, 0.4], RUB, { off: 0.012, centre: true });
    // boarding ladder folded up on the transom
    ladder(g, [-5.33, 0.35, -0.55], [-5.36, dy(-5.3) + 0.75, -0.55], [0, 0, 1], STEEL, MET, { w: 0.3, r: 0.012, step: 0.25, segs: 3 });
  }
  // ---- foredeck ----
  if (!far) {
    hatch(g, [3.3, dy(3.3) + 0.03, 0], 0.3, 0.3, lod);
    hatch(g, [-0.55, C.top(-0.55) - 0.01, 0], 0.25, 0.25, lod);
  }
  if (near) {
    for (const s of [-1, 1]) cowl(g, [1.75, C.top(1.75, 0.45) - 0.03, s * 0.45], 0.8);
    // grab rails on the coachroof
    for (const s of [-1, 1]) { const pts = lin(-1.5, 1.5, 6).map((x) => [x, C.top(x, 0.78) + 0.03, s * 0.78]); tube(g, pts.map((p) => [p[0], p[1] + 0.045, p[2]]), 0.014, teakC, TEAK, { segs: 4, caps: true }); for (const p of pts) rod(g, p, [p[0], p[1] + 0.045, p[2]], 0.012, teakC, TEAK, 4); }
    // windlass, bow roller, the stem fitting
    lathe(g, [[0.09, -0.11], [0.09, 0.11]], [0.6, 0.6, 0.62], MET, { segs: 8, axis: 'x', at: [4.35, dy(4.35) + 0.14, 0] }); box(g, [4.25, dy(4.25) + 0.08, 0], 0.16, 0.06, 0.1, white, GEL);
    box(g, [5.12, dy(5.12) + 0.03, 0], 0.24, 0.018, 0.07, [0.6, 0.6, 0.62], MET);
    // portlights in the topsides forward
    for (const s of [-1, 1]) for (const x of [1.6, 2.5]) { const t = H.tOf(x), q = [0, 0, 0]; fn(t, 0.86, s, q); pane(g, [[-0.16, -0.05], [0.16, -0.05], [0.2, 0], [0.16, 0.05], [-0.16, 0.05], [-0.2, 0]].map(([a, b]) => [q[0] + a, q[1] + b, q[2] + s * 0.012 + s * b * 0.25]), 0); }
  }
  if (near) {
    // cockpit cushions, sheet tracks with their cars and the genoa sheets led aft to the winches
    const cush = mat(MAT.UPHOLSTERY);
    for (const s of [-1, 1]) {
      box(g, [-3.5, dy(-3.5) + 0.075, s * 0.78], 0.95, 0.035, 0.24, V.canvas, cush);
      const zt = (x) => s * (hw(x) - 0.3);
      tube(g, lin(-1.4, 1.2, 4).map((x) => [x, dy(x) + 0.075, zt(x)]), 0.012, [0.12, 0.12, 0.13], MET, { segs: 4 });
      box(g, [0.2, dy(0.2) + 0.11, zt(0.2)], 0.06, 0.03, 0.03, DARK, RUB);
      tube(g, [[4.55, dy(4.5) + 0.55, 0], [2.6, dy(2.6) + 0.3, s * 0.9], [0.2, dy(0.2) + 0.13, zt(0.2)], [-2.0, dy(-2) + 0.22, s * 1.2], [-3.0, dy(-3) + 0.32, s * 1.1]], 0.006, s > 0 ? [0.6, 0.12, 0.1] : [0.1, 0.2, 0.5], RUB, { segs: 3 });
      // jackstays: webbing along the side decks
      tube(g, lin(-2.3, 4.1, 6).map((x) => [x, dy(x) + 0.068, s * (hw(x) - 0.2)]), 0.006, [0.1, 0.3, 0.6], CLOTH, { segs: 3 });
    }
    // liferaft canister in its cradle, a solar panel on the hatch garage, a boat hook, halyard tails coiled at the mast
    lathe(g, [[0.0, -0.33], [0.17, -0.3], [0.2, -0.2], [0.2, 0.2], [0.17, 0.3], [0, 0.33]], [0.82, 0.82, 0.79], GEL, { segs: 10, axis: 'x', at: [0.2, C.top(0.2) + 0.19, 0], ell: 1.25 });
    for (const x of [0.02, 0.38]) lathe(g, [[0.205, 0], [0.205, 0.035]], DARK, RUB, { segs: 10, axis: 'x', at: [x, C.top(0.2) + 0.19, 0], ell: 1.25 });
    quad(g, [-1.6, C.top(-1.35) + 0.072, -0.33], [-1.1, C.top(-1.35) + 0.072, -0.33], [-1.1, C.top(-1.35) + 0.072, 0.33], [-1.6, C.top(-1.35) + 0.072, 0.33], [0.03, 0.05, 0.14], GLS);
    rod(g, [-1.3, C.top(0, 0.55) + 0.06, -0.55], [1.0, C.top(0.9, 0.55) + 0.06, -0.52], 0.012, ALU, MET, 4);
    for (const s of [-1, 1]) coil(g, [MX - 0.35, C.top(MX - 0.35, 0.3) + 0.01, s * 0.3], 0.14, s > 0 ? [0.6, 0.55, 0.42] : [0.5, 0.15, 0.12]);
    hoop(g, [-5.27, dy(-5.2) + 0.4, -0.6], [1, 0, 0], 0.13, 0.02, [0.6, 0.55, 0.42], CLOTH, 10, 4);
    // navigation lights: a bicolour on the pulpit, a stern light
    box(g, [5.18, dy(5.2) + 0.5, 0.035], 0.03, 0.03, 0.03, [0.1, 0.5, 0.15], LIT); box(g, [5.18, dy(5.2) + 0.5, -0.035], 0.03, 0.03, 0.03, [0.5, 0.05, 0.04], LIT);
    box(g, [-5.3, dy(-5.3) + 0.55, 0.34], 0.025, 0.03, 0.03, [0.7, 0.7, 0.66], LIT);
    // anchor locker lid and the mast collar
    box(g, [4.0, dy(4.0) + 0.045, 0], 0.22, 0.012, 0.26, deckC, DM);
    lathe(g, [[0.13, 0], [0.1, 0.05], [0.095, 0.1]], white, GEL, { segs: 10, at: [MX, MY - 0.01, 0] });
  }
  // ground tackle: at anchor on chain with the black ball hoisted, or on a mooring with the anchor stowed
  const stem = [5.28, dy(5.25) + 0.02, 0];
  if (V.moored) {
    if (near) anchorStowed(g, [5.0, dy(5.1) + 0.06, 0], 0.9);
    if (!far) {
      tube(g, [[4.3, dy(4.3) + 0.06, 0.2], [5.2, dy(5.2) + 0.05, 0.12], [5.9, 0.45, 0.05], [7.2, 0.12, 0]], 0.014, [0.6, 0.56, 0.45], CLOTH, { segs: 3 });
      const s0 = mark(g);
      blob(g, [7.45, 0.1, 0], 0.3, 0.26, 0.3, [0.7, 0.2, 0.25], RUB, { n: lod ? 3 : 5, segs: lod ? 6 : 10 });
      if (near) { hoop(g, [7.45, 0.4, 0], [0, 0, 1], 0.05, 0.012, STEEL, MET, 8, 3); paint(g, s0, stain(seed, { weedTop: 0.0, tide: 0.02 })); }
    }
  } else {
    if (!far) rode(g, stem, [8.6, -6, 0], lod);
    if (!far) { blob(g, [3.55, 3.7, 0], 0.16, 0.16, 0.16, DARK, RUB, { n: lod ? 3 : 4, segs: lod ? 5 : 8 }); if (near) rod(g, [3.55, 3.86, 0], [2.7, 7.2, 0], 0.004, [0.6, 0.6, 0.55], RUB, 3); }
  }
  // ---- rails: pulpit, pushpit, stanchions and two lifelines a side ----
  const railH = 0.62;
  if (!far) {
    const rc = STEEL, rr = lod ? 0.016 : 0.012;
    for (const s of [-1, 1]) {
      // pulpit: the top rail runs forward to the stem, a lower rail and legs
      const pp = [[4.2, s * (hw(4.2) - 0.08)], [4.75, s * (hw(4.75) - 0.05)], [5.25, 0]].map(([x, z]) => [x, dy(x) + railH + 0.02, z]);
      tube(g, [[4.2, dy(4.2), pp[0][2]], pp[0], pp[1], pp[2]], rr, rc, MET, { segs: 4 });
      rod(g, [4.75, dy(4.75), pp[1][2]], pp[1], rr, rc, MET, 4);
      if (near) tube(g, [[4.2, dy(4.2) + 0.32, pp[0][2]], [4.75, dy(4.75) + 0.33, pp[1][2]], [5.12, dy(5.1) + 0.34, s * 0.05]], rr * 0.8, rc, MET, { segs: 3 });
      // pushpit: round the quarter to a gate on the centreline
      const q = [[-4.45, s * (hw(-4.45) - 0.07)], [-5.0, s * (hw(-5.0) - 0.07)], [-5.24, s * 0.95], [-5.26, s * 0.34]].map(([x, z]) => [x, dy(x) + railH + 0.02, z]);
      tube(g, [[-4.45, dy(-4.45), q[0][2]], ...q, [-5.26, dy(-5.26), q[3][2]]], rr, rc, MET, { segs: 4 });
      rod(g, [-5.22, dy(-5.2), q[2][2]], q[2], rr, rc, MET, 4);
      if (near) tube(g, q.map((p) => [p[0], p[1] - 0.3, p[2]]), rr * 0.8, rc, MET, { segs: 3 });
      // stanchions and wires between them
      const xs = lin(-4.45, 4.2, lod ? 4 : 6), posts = xs.map((x) => [x, dy(x), s * (hw(x) - 0.07)]);
      railing(g, posts, rc, MET, { h: railH, every: 9, rails: near ? [0.5, 1] : [1], r: lod ? 0.012 : 0.008, segs: lod ? 3 : 4 });
    }
  }
  // ---- spars ----

  tube(g, [[MX, MY, 0], [MX, 9, 0], [MX, top, 0]], far ? [0.1, 0.09, 0.07] : [0.085, 0.078, 0.06], ALU, MET, { segs: far ? 3 : lod ? 5 : 8 });
  const b0 = [MX - 0.12, 2.3, 0], b1 = [-3.75, 2.18, 0];
  rod(g, b0, b1, far ? 0.08 : 0.06, ALU, MET, far ? 3 : 6);
  // the mainsail flaked on the boom under its cover
  {
    const n = far ? 3 : lod ? 6 : 12, pts = [], rr = [];
    for (let k = 0; k <= n; k++) { const f = k / n; pts.push([lerp(b0[0] - 0.02, b1[0] + 0.25, f), lerp(b0[1], b1[1], f) + 0.15 + 0.035 * Math.sin(f * 9 + seed), 0.012 * Math.sin(f * 14)]); rr.push((0.19 - 0.07 * f) * (0.4 + 0.6 * Math.sin(Math.PI * Math.min(f * 6, 0.5))) * (1 - 0.6 * Math.pow(f, 8)) + 0.012 * Math.sin(f * 23)); }
    tube(g, pts, rr, V.canvas, CLOTH, { segs: far ? 4 : lod ? 6 : 10, caps: true, paint: near ? mottle(seed + 4, 0.1, 6) : undefined });
    if (near) for (let k = 1; k < 6; k++) { const f = k / 6.3, c = [lerp(b0[0], b1[0], f), lerp(b0[1], b1[1], f) + 0.13, 0]; hoop(g, c, [1, 0, 0], 0.19 - 0.05 * f, 0.008, [0.75, 0.75, 0.7], CLOTH, 8, 3); }
    if (near) { text(g, V.name, [-1.5, 2.37, 0.168], [1, 0, 0], [0, 1, 0], 0.11, [0.75, 0.75, 0.7], CLOTH, { off: 0.004, centre: true }); text(g, V.name, [-1.5, 2.37, -0.168], [-1, 0, 0], [0, 1, 0], 0.11, [0.75, 0.75, 0.7], CLOTH, { off: 0.004, centre: true }); }
  }
  // the genoa rolled on its stay, the sun strip spiralling round it
  {
    const a = [4.82, dy(4.8) + 0.3, 0], b = [MX + 0.1, top - 1.35, 0], n = far ? 3 : lod ? 8 : 16, pts = [], rr = [];
    for (let k = 0; k <= n; k++) { const f = k / n; pts.push([lerp(a[0], b[0], f), lerp(a[1], b[1], f), 0]); rr.push(0.028 + 0.075 * Math.pow(Math.sin(Math.PI * Math.pow(f, 0.6)), 0.7) * (1 - 0.4 * f)); }
    const dx = b[0] - a[0], dyy = b[1] - a[1], dl = Math.hypot(dx, dyy);
    tube(g, pts, rr, far ? mixc([0.84, 0.84, 0.8], V.canvas, 0.42) : [0.84, 0.84, 0.8], CLOTH, { segs: far ? 3 : lod ? 6 : 10, paint: far ? undefined : (P, N, C2, i) => { const al = ((P[i] - a[0]) * dx + (P[i + 1] - a[1]) * dyy) / dl, ang = Math.atan2(P[i + 2], (P[i] - a[0]) * dyy / dl - (P[i + 1] - a[1]) * dx / dl); const f = ((ang / TAU + al * 1.1) % 1 + 1) % 1; if (f < 0.42) { C2[i] = V.canvas[0]; C2[i + 1] = V.canvas[1]; C2[i + 2] = V.canvas[2]; } } });
    if (!far) lathe(g, [[0.03, 0], [0.085, 0.01], [0.085, 0.07], [0.03, 0.08]], DARK, RUB, { segs: 8, at: [4.86, dy(4.8) + 0.1, 0] });
    if (!far) { rod(g, [5.2, dy(5.2) + 0.03, 0], a, 0.01, STEEL, MET, 3); rod(g, b, [MX + 0.05, top - 0.3, 0], 0.008, STEEL, MET, 3); }
  }
  if (!far) {
    const wire = [0.55, 0.57, 0.6], wr = lod ? 0.011 : 0.006, ws = 3, cx = 0.75, cz = hw(0.75) - 0.06, cy = dy(0.75);
    // spreaders
    for (const [y, l] of [[6.3, 0.95], [10.2, 0.7]]) for (const s of [-1, 1]) tube(g, [[MX, y, 0], [MX - 0.08, y + 0.08, s * l]], [0.03, 0.018], ALU, MET, { segs: 4 });
    for (const s of [-1, 1]) {
      // cap shrouds over the spreader tips, a lower shroud, their rigging screws
      tube(g, [[cx, cy, s * cz], [MX - 0.08, 6.38, s * 0.95], [MX - 0.08, 10.28, s * 0.7], [MX, top - 0.5, 0]], wr, wire, MET, { segs: ws });
      rod(g, [cx - 0.45, cy, s * (cz - 0.02)], [MX, 6.2, s * 0.06], wr, wire, MET, ws);
      if (near) { rod(g, [cx + 0.4, cy, s * (cz - 0.04)], [MX, 6.2, s * 0.06], wr, wire, MET, ws); for (const o of [-0.45, 0, 0.4]) rod(g, [cx + o, cy, s * (cz - 0.02)], [cx + o + (MX - cx - o) * 0.035, cy + 0.26, s * (cz - 0.05)], 0.011, STEEL, MET, 4); }
      // backstay legs from a bridle
      rod(g, [-5.2, dy(-5.2), s * 0.9], [-4.0, 4.6, 0], wr, wire, MET, ws);
    }
    rod(g, [-4.0, 4.6, 0], [MX, top - 0.3, 0], wr, wire, MET, ws);
    // topping lift, kicker, mainsheet
    rod(g, [b1[0] + 0.05, b1[1] + 0.05, 0], [MX - 0.05, top - 0.2, 0], wr * 0.8, [0.7, 0.7, 0.64], RUB, 3);
    rod(g, [MX - 0.1, MY + 0.12, 0], [-0.6, 2.24, 0], 0.012, ALU, MET, 4);
    if (near) {
      for (const o of [-0.035, 0.035]) rod(g, [-2.62, dy(-2.6) + 0.12, 0.1 + o], [-3.1, 2.14, o], 0.005, [0.7, 0.2, 0.2], RUB, 3);
      // halyards down the mast, lazy jacks, a masthead unit: wind vane, aerial
      for (const [ox, oz] of [[0.09, 0.02], [-0.09, -0.02], [0.07, -0.05]]) rod(g, [MX + ox, MY + 0.15, oz], [MX + ox * 0.8, top - 0.25, oz], 0.004, [0.72, 0.7, 0.6], RUB, 3);
      for (const s of [-1, 1]) for (const xb of [-1.2, -2.6]) rod(g, [xb, 2.32, s * 0.12], [MX - 0.03, 9.3, s * 0.03], 0.003, [0.6, 0.6, 0.55], RUB, 3);
      box(g, [MX, top + 0.06, 0], 0.07, 0.06, 0.035, DARK, RUB);
      rod(g, [MX, top + 0.1, 0.03], [MX, top + 1.0, 0.03], 0.004, [0.2, 0.2, 0.2], RUB, 3);
      rod(g, [MX, top + 0.14, -0.02], [MX - 0.45, top + 0.2, -0.02], 0.006, [0.7, 0.7, 0.7], MET, 3);
      fan(g, [[MX - 0.45, top + 0.2, -0.02], [MX - 0.62, top + 0.27, -0.02], [MX - 0.62, top + 0.13, -0.02]], [0.5, 0.05, 0.04], RUB);
      // steaming light and, on some, a radar on the mast
      box(g, [MX + 0.1, 7.6, 0], 0.03, 0.04, 0.03, DARK, RUB);
    }
    if (V.radar) { rod(g, [MX, 5.0, 0], [MX + 0.3, 5.05, 0], 0.02, ALU, MET, 4); lathe(g, [[0.0, 0], [0.27, 0.02], [0.3, 0.1], [0.25, 0.17], [0, 0.19]], [0.85, 0.85, 0.82], GEL, { segs: lod ? 6 : 12, at: [MX + 0.38, 5.02, 0] }); }
    if (V.outboard && near) outboard(g, [-5.42, dy(-5.3) + 0.5, -0.78], 0.9);
    // fenders along one side, on their lanyards from the lifelines
    if (V.fenders) for (const x of [-2.2, 0.1, 2.0]) { const z = hw(x) + 0.1, t = H.tOf(x), q = [0, 0, 0]; fn(t, 0.82, 1, q); fender(g, [x, 0.52, Math.max(q[2] + 0.11, z - 0.2)], near ? [x, dy(x) + railH, hw(x) - 0.07] : null, 0.1, 0.52, [0.8, 0.8, 0.76], lod); }
  } else {
    // far: the stays that give a sloop her outline, thick enough to hold a pixel
    rod(g, [-5.2, 1.0, 0], [MX, top - 0.3, 0], 0.02, [0.5, 0.52, 0.55], RUB, 3);
  }
  if (V.tender && !far) { tender(g, [-8.6, 0, 0.9], 0.35, lod); tube(g, [[-5.3, dy(-5.3), 0.6], [-6.4, 0.25, 0.7], [-7.55, 0.3, 0.8]], 0.01, [0.6, 0.56, 0.45], CLOTH, { segs: 3 }); }
  ball(g, [MX, top + 0.38, 0], 0.07, WHITE);
  lamps.push(lamp([MX, top + 0.38, 0], WHITE, 'anchor', { size: 0.5 }));
  lamps.push(lamp([0.0, 1.3, 1.3], WARM, 'window', { size: 0.8 }), lamp([0.0, 1.3, -1.3], WARM, 'window', { size: 0.8 }));
  void R; void mixc; void vn; void fb; void smooth; void slab; void TEX; void LIT; void detail; void stamp; void rust; void faded; void lifering; void bollard; void coil; void mixIn; void PLATE; void CORR; void GRAINM; void RED; void GREEN;
  return { g, lamps, foot: 7 };
}

// a house at the far level: white below and above a dark band that stands for its windows (three lofts
// stacked, no glass laid on a wall)
function cabinFar(g, st, yb, yt, col, m = GEL) {
  const zAt = (s, y) => lerp(s.w, s.wt ?? s.w, clamp((y - s.y0) / (s.y1 - (s.r ?? 0.15) - s.y0), 0, 1));
  cabin(g, st.map((s) => ({ x: s.x, y0: s.y0, y1: Math.min(yb, s.y1), w: s.w, wt: zAt(s, Math.min(yb, s.y1)), r: 0.01, crown: 0 })), col, m, { nc: 1 });
  const band = st.filter((s) => s.y1 > yt + 0.1);
  if (band.length > 1) cabin(g, band.map((s) => ({ x: s.x, y0: yb, y1: yt, w: zAt(s, yb) - 0.02, wt: zAt(s, yt) - 0.02, r: 0.01, crown: 0 })), GLASS, GLS, { nc: 1 });
  if (band.length > 1) cabin(g, band.map((s) => ({ x: s.x, y0: yt, y1: s.y1, w: zAt(s, yt), wt: s.wt ?? s.w, r: s.r ?? 0.15, crown: s.crown })), col, m, { nc: 1 });
}

// =========================================================================================
// Cabin cruiser: a flybridge motor yacht
// =========================================================================================
export const CRUISER = { length: 11.8, radius: 9 };
const CRUISERS = [
  { hull: [0.78, 0.78, 0.75], accent: [0.02, 0.05, 0.14], canvas: [0.03, 0.06, 0.18], anti: [0.1, 0.1, 0.13], name: 'OSPREY', bimini: true },
  { hull: [0.78, 0.78, 0.75], accent: [0.3, 0.03, 0.03], canvas: [0.62, 0.6, 0.52], anti: [0.28, 0.05, 0.04], name: 'MERIDIAN', bimini: false },
  { hull: [0.03, 0.06, 0.15], accent: [0.6, 0.48, 0.2], canvas: [0.5, 0.5, 0.47], anti: [0.3, 0.05, 0.04], name: 'CORMORANT', bimini: true },
];
export function cruiserGeo(lod = 0, seed = 1) {
  const g = new Geo(lod ? 4096 : 65536), lamps = [], V = CRUISERS[(((seed - 1) % 3) + 3) % 3];
  const near = lod === 0, far = lod === 2;
  const white = [0.78, 0.78, 0.75], teakC = [0.42, 0.3, 0.17];
  const S = { L: 11.8, B: 3.9, draft: 0.8, free: 1.22, rise: 0.6, sternLift: 0.08, bow: 2.7, bowK: 0.6, keelBow: 0.9, rake: 0.07, chine: { y0: 0.1, rise: 0.8, pow: 2.3, w0: 0.94, w1: 0.45 } };
  const H = hullShape(S), T = stations(far ? 6 : lod ? 10 : 24), hp = far ? null : hullPaint(seed + 10);
  const sy = (t) => H.ys(t), dy = H.deckY, hw = H.hw;
  hullBands(g, H.parts[0], T, [{ y0: -9, y1: 0.02, col: V.anti, rows: 2 }, { y0: 0.02, y1: 0.1, col: V.hull[0] > 0.4 ? V.accent : [0.75, 0.75, 0.72], rows: 1 }, { y0: 0.1, y1: 9, col: V.hull, rows: 1 }], hp);
  hullBands(g, H.parts[1], T, far
    ? [{ y0: -9, y1: (t) => sy(t) - 0.42, col: V.hull, rows: 1 }, { y0: (t) => sy(t) - 0.42, y1: (t) => sy(t) - 0.26, col: V.accent, rows: 1 }, { y0: (t) => sy(t) - 0.26, y1: 9, col: V.hull, rows: 1 }]
    : [{ y0: -9, y1: (t) => sy(t) - 0.42, col: V.hull, rows: lod ? 2 : 4 }, { y0: (t) => sy(t) - 0.42, y1: (t) => sy(t) - 0.26, col: V.accent, rows: 1 }, { y0: (t) => sy(t) - 0.26, y1: 9, col: V.hull, rows: 1 }], hp);
  // ---- decks: the foredeck and side decks at the sheer, a cockpit let down aft, a swim platform ----
  const XC = -3.2, tC = H.tOf(XC), CF = 0.78;
  deck(g, H, lin(tC, 0.997, far ? 4 : lod ? 6 : 12), -1, 1, white, NSK, { nq: far ? 2 : 4 });
  if (!far) {
    const cw = (x) => hw(x) - 0.09, xa = -5.86;
    quad(g, [xa, CF, -cw(xa)], [XC, CF, -cw(XC)], [XC, CF, cw(XC)], [xa, CF, cw(xa)], teakC, TEAK);
    // the cockpit's inner sides and its capping all round, with a gate in the transom to starboard
    for (const s of [-1, 1]) {
      quad(g, [xa, CF, s * cw(xa)], [XC, CF, s * cw(XC)], [XC, dy(XC), s * cw(XC)], [xa, dy(xa), s * cw(xa)], white, GEL);
      tube(g, lin(xa, XC, 3).map((x) => [x, dy(x) + 0.02, s * (hw(x) - 0.05)]), 0.05, white, GEL, { segs: lod ? 4 : 6 });
    }
    quad(g, [xa, CF, -cw(xa)], [xa, CF, 0.55], [xa, dy(xa), 0.55], [xa, dy(xa), -cw(xa)], white, GEL);
    tube(g, [[xa + 0.02, dy(xa) + 0.02, -cw(xa)], [xa + 0.02, dy(xa) + 0.02, 0.55]], 0.05, white, GEL, { segs: lod ? 4 : 6, caps: true });
    quad(g, [xa, CF, 1.25], [xa, CF, cw(xa)], [xa, dy(xa), cw(xa)], [xa, dy(xa), 1.25], white, GEL);
    // swim platform on brackets, a folded ladder, a rail each side
    box(g, [-6.2, 0.36, 0], 0.32, 0.03, 1.55, teakC, TEAK);
    if (near) {
      for (const z of [-1.1, 0, 1.1]) quad(g, [-5.9, 0.33, z], [-6.45, 0.33, z], [-5.9, 0.05, z], [-5.9, 0.33, z], [0.7, 0.7, 0.7], MET);
      ladder(g, [-6.5, 0.4, -0.9], [-6.2, 0.95, -0.9], [0, 0, 1], STEEL, MET, { w: 0.32, r: 0.012, step: 0.22, segs: 3 });
      for (const s of [-1, 1]) tube(g, [[-5.95, 0.4, s * 1.45], [-5.98, 0.95, s * 1.45], [-6.4, 0.95, s * 1.45], [-6.45, 0.4, s * 1.45]], 0.016, STEEL, MET, { segs: 4 });
      // a bench across the transom with cushions, a table leg, a life ring on the side
      box(g, [-5.55, CF + 0.2, -0.45], 0.26, 0.2, 0.95, white, GEL);
      box(g, [-5.52, CF + 0.44, -0.45], 0.26, 0.045, 0.93, V.canvas, mat(MAT.UPHOLSTERY));
      box(g, [-5.8, CF + 0.7, -0.45], 0.05, 0.22, 0.93, V.canvas, mat(MAT.UPHOLSTERY));
      lifering(g, [-4.4, CF + 0.42, -(cw(-4.4) - 0.06)], [0, 0, 1], 0.26);
      // exhausts in the transom, soot below them; the name and port of registry
      for (const s of [-1, 1]) { lathe(g, [[0.07, 0], [0.07, 0.04], [0.05, 0.04]], [0.5, 0.5, 0.5], MET, { segs: 8, axis: 'x', at: [-5.94, 0.22, s * 1.3] }); quad(g, [-5.905, 0.18, s * 1.3 - 0.08], [-5.905, 0.18, s * 1.3 + 0.08], [-5.905, 0.02, s * 1.3 + 0.05], [-5.905, 0.02, s * 1.3 - 0.05], [0.12, 0.11, 0.1], RUB); }
      text(g, V.name, [-5.905, 0.72, -0.35], [0, 0, 1], [0, 1, 0], 0.16, V.hull[0] > 0.4 ? V.accent : [0.75, 0.68, 0.4], RUB, { off: 0.012, centre: true });
    }
    // spray rails along the chine, a rubbing band along the sheer
    for (const s of [-1, 1]) tube(g, lin(0, 0.96, lod ? 8 : 16).map((t) => { const q = [0, 0, 0]; H.parts[0](t, 1, s, q); return [q[0], q[1], q[2] + s * 0.015]; }), 0.03, V.hull, GEL, { segs: 4 });
    sheerBar(g, H, 0, 0.995, lod ? 10 : 20, 0.035, [0.05, 0.05, 0.055], RUB, { up: -0.05, out: 0.01, segs: lod ? 4 : 6 });
  } else box(g, [-6.2, 0.36, 0], 0.32, 0.03, 1.55, teakC, TEAK);
  // ---- saloon, windscreen and trunk cabin ----
  const ST = [{ x: XC, y0: 1.1, y1: 3.1, w: 1.62, wt: 1.5, r: 0.12 }, { x: 0.9, y0: 1.1, y1: 3.1, w: 1.6, wt: 1.45, r: 0.12 }, { x: 2.3, y0: 1.1, y1: 2.02, w: 1.36, wt: 1.2, r: 0.1 }, { x: 2.45, y0: 1.1, y1: 1.96, w: 1.3, wt: 1.1, r: 0.14 }, { x: 4.2, y0: 1.1, y1: 1.74, w: 0.76, wt: 0.6, r: 0.1 }, { x: 4.75, y0: 1.1, y1: 1.62, w: 0.4, wt: 0.3, r: 0.05 }];
  let C;
  if (far) { cabinFar(g, ST, 2.0, 2.78, white); C = cabin(new Geo(64), ST, white, GEL, { nc: 1 }); } else C = cabin(g, ST, white, GEL, { nc: 3 });
  if (!far) {
    for (const s of [-1, 1]) {
      sideWindow(g, C, -2.95, -1.75, 2.02, 2.76, s, lod, { cut: 0.1, frame: DARK, fm: RUB });
      sideWindow(g, C, -1.6, -0.4, 2.02, 2.76, s, lod, { cut: 0.1, frame: DARK, fm: RUB });
      sideWindow(g, C, -0.25, 0.75, 2.02, 2.76, s, lod, { cut: 0.1, frame: DARK, fm: RUB, rake: -0.35 });
      if (near) for (const x of [2.9, 3.6]) sideWindow(g, C, x, x + 0.45, 1.52, 1.66, s, 0, { cut: 0.04 });
    }
    // the aft bulkhead: a sliding glass door and a window
    pane(g, [[XC - 0.014, CF + 0.08, 0.1], [XC - 0.014, CF + 0.08, 0.95], [XC - 0.014, 2.85, 0.95], [XC - 0.014, 2.85, 0.1]], lod, DARK, RUB);
    pane(g, [[XC - 0.014, 2.0, -1.25], [XC - 0.014, 2.0, -0.1], [XC - 0.014, 2.8, -0.1], [XC - 0.014, 2.8, -1.2]], lod, DARK, RUB);
    // windscreen: three raked panes between mullions, wipers
    const ws = (x, z) => [x, lerp(3.1, 2.02, (x - 0.9) / 1.4) + 0.045 * (1 - (z / 1.3) * (z / 1.3)) + 0.02, z];
    for (const [z0, z1] of [[-1.16, -0.44], [-0.38, 0.38], [0.44, 1.16]]) {
      const k = (z) => 1 - 0.1 * Math.abs(z);
      pane(g, [ws(1.02, z0 * 1.12), ws(1.02, z1 * 1.12), ws(2.2, z1 * k(z1)), ws(2.2, z0 * k(z0))], lod, DARK, RUB);
      if (near) { const zc = (z0 + z1) / 2; tube(g, [ws(2.22, zc), ws(1.7, zc + 0.25)].map((q) => [q[0], q[1] + 0.02, q[2]]), 0.006, DARK, RUB, { segs: 3 }); }
    }
  }
  // ---- flybridge: a coaming round the saloon roof carried aft over the cockpit, helm, seats ----
  const FY = 3.14, FX0 = -4.4;
  slab(g, FX0, XC + 0.05, FY - 0.09, FY, -1.5, 1.5, white, GEL);
  if (!far) quad(g, [FX0 + 0.05, FY + 0.012, -1.42], [0.6, FY + 0.012, -1.3], [0.6, FY + 0.012, 1.3], [FX0 + 0.05, FY + 0.012, 1.42], [0.6, 0.6, 0.57], NSK);
  {
    const out = [[FX0, -1.5], [-2, -1.52], [0.1, -1.48], [0.75, -1.2], [1.0, -0.6], [1.05, 0], [1.0, 0.6], [0.75, 1.2], [0.1, 1.48], [-2, 1.52], [FX0, 1.5]];
    const lean = (k) => out.map(([x, z]) => [x + (x > 0.5 ? 0.12 * k : 0), FY - 0.06 + 0.56 * k, z * (1 + 0.03 * k)]);
    loft(g, [lean(0), lean(1)], white, GEL, { closed: false });
    if (!far) {
      tube(g, lean(1), 0.03, white, GEL, { segs: lod ? 4 : 6 });
      // wind deflector, console with wheel and screen, helm seat, an L of seating aft
      const fr = out.slice(3, 8).map(([x, z]) => [x + 0.12, FY + 0.5, z * 1.03]);
      loft(g, [fr, fr.map((q) => [q[0] - 0.12, q[1] + 0.3, q[2] * 0.97])], [0.02, 0.03, 0.04], GLS, { closed: false });
      box(g, [0.45, FY + 0.33, -0.35], 0.22, 0.33, 0.5, white, GEL, { top: [0.05, 0.05, 0.06] });
      box(g, [-2.9, FY + 0.2, 0], 0.3, 0.2, 1.3, white, GEL, { top: V.canvas });
      for (const s of [-1, 1]) box(g, [-2.0, FY + 0.2, s * 1.15], 0.6, 0.2, 0.28, white, GEL, { top: V.canvas });
      if (near) {
        box(g, [0.25, FY + 0.72, -0.35], 0.02, 0.1, 0.17, DARK, RUB); box(g, [0.236, FY + 0.72, -0.35], 0.006, 0.08, 0.15, [0.1, 0.25, 0.2], LIT);
        hoop(g, [0.2, FY + 0.6, -0.35], [1, 0.5, 0], 0.19, 0.014, DARK, RUB, 14, 4);
        lathe(g, [[0.05, 0], [0.05, 0.45]], STEEL, MET, { segs: 6, at: [-0.4, FY, -0.35] });
        box(g, [-0.42, FY + 0.5, -0.35], 0.22, 0.05, 0.24, V.canvas, mat(MAT.UPHOLSTERY)); box(g, [-0.66, FY + 0.78, -0.35], 0.045, 0.28, 0.24, V.canvas, mat(MAT.UPHOLSTERY));
        box(g, [-2.9, FY + 0.43, 0], 0.3, 0.04, 1.28, V.canvas, mat(MAT.UPHOLSTERY));
        // the ladder down to the cockpit and the rail across the after end
        ladder(g, [-3.5, CF, 1.05], [-4.1, FY, 1.05], [0, 0, 1], STEEL, MET, { w: 0.42, r: 0.016, step: 0.26, segs: 4 });
        railing(g, [[FX0, FY, -1.48], [FX0, FY, 0.7]], STEEL, MET, { h: 0.6, every: 0.75, r: 0.012 });
        for (const s of [-1, 1]) rod(g, [FX0 + 0.1, dy(FX0) + 0.06, s * 1.42], [FX0 + 0.1, FY - 0.09, s * 1.42], 0.025, STEEL, MET, 5);
      }
    }
  }
  // radar arch: two raked legs and a hoop, the dome, a searchlight, aerials, a horn
  {
    const AX = -1.95, at = (k, s) => [lerp(-2.45, AX, k), lerp(FY + 0.5, 4.63, k), s * lerp(1.5, 1.12, k)];
    for (const s of [-1, 1]) tube(g, [at(0, s), at(0.5, s), at(1, s)], far ? 0.09 : 0.07, white, GEL, { segs: far ? 3 : lod ? 5 : 8 });
    tube(g, [at(1, -1), [AX, 4.66, 0], at(1, 1)], far ? 0.09 : 0.07, white, GEL, { segs: far ? 3 : lod ? 5 : 8 });
    if (!far) {
      lathe(g, [[0.0, 0], [0.26, 0.01], [0.3, 0.09], [0.25, 0.2], [0.0, 0.23]], [0.85, 0.85, 0.82], GEL, { segs: lod ? 6 : 12, at: [AX, 4.72, -0.55] });
      rod(g, [AX, 4.66, 0.5], [AX, 5.8, 0.5], 0.012, [0.3, 0.3, 0.3], MET, 3);
      if (near) {
        for (const s of [-1, 1]) tube(g, [[AX - 0.05, 4.66, s * 0.95], [AX - 0.9, 6.3, s * 1.0]], [0.012, 0.004], [0.85, 0.85, 0.82], GEL, { segs: 4 });
        blob(g, [AX + 0.12, 4.82, 0], 0.09, 0.09, 0.09, [0.7, 0.72, 0.74], MET, { n: 4, segs: 8 }); rod(g, [AX + 0.05, 4.7, 0], [AX + 0.1, 4.78, 0], 0.02, STEEL, MET, 4);
        tube(g, [[AX + 0.05, 4.72, 0.2], [AX + 0.25, 4.72, 0.2]], [0.02, 0.05], [0.6, 0.1, 0.08], GEL, { segs: 6, caps: true });
        for (const s of [-1, 1]) box(g, [1.0, 2.9, s * 1.5], 0.06, 0.05, 0.025, s < 0 ? [0.5, 0.05, 0.04] : [0.05, 0.5, 0.15], LIT);
      }
    }
    // canvas over the helm, on a frame from the arch
    if (V.bimini) {
      const hoopB = (x, n) => Array.from({ length: n + 1 }, (_, k) => { const q = -1 + (2 * k) / n; return [x, 4.98 + 0.12 * (1 - q * q) - 0.03 * Math.abs(x + 0.6), q * 1.4]; });
      const nb = far ? 2 : lod ? 4 : 8;
      loft(g, [hoopB(-1.75, nb), hoopB(-0.6, nb), hoopB(0.55, nb)], V.canvas, CLOTH, { closed: false });
      if (!far) for (const s of [-1, 1]) { rod(g, [0.5, FY + 0.5, s * 1.38], [0.55, 4.96, s * 1.4], lod ? 0.02 : 0.014, STEEL, MET, 4); rod(g, at(1, s), [-1.75, 4.96, s * 1.4], lod ? 0.02 : 0.014, STEEL, MET, 4); if (near) rod(g, [0.5, FY + 0.5, s * 1.38], [-0.6, 4.98, s * 1.4], 0.012, STEEL, MET, 3); }
    }
  }
  // ---- foredeck: rails round the bow, sun pad, hatch, windlass, the anchor on its roller ----
  if (!far) {
    for (const s of [-1, 1]) {
      const xs = lin(-0.6, 5.3, lod ? 4 : 7), posts = xs.map((x) => [x, dy(x), s * (hw(x) - 0.08) * (x > 5 ? 0.6 : 1)]);
      railing(g, posts, STEEL, MET, { h: 0.6, every: 9, rails: near ? [0.5, 1] : [1], r: lod ? 0.017 : 0.014, segs: 4 });
      rod(g, [5.3, dy(5.3) + 0.6, s * (hw(5.3) - 0.08) * 0.6], [5.75, dy(5.7) + 0.6, 0], lod ? 0.018 : 0.015, STEEL, MET, 4);
      // grab rail along the saloon side, fenders on their lanyards
      if (near) tube(g, lin(-2.9, 0.6, 4).map((x) => C.side(x, 2.92, s, 0.05)), 0.014, STEEL, MET, { segs: 4 });
      for (const x of [-2.3, 0.2, 2.4]) { const q = [0, 0, 0]; H.parts[1](H.tOf(x), 0.55, s, q); fender(g, [x, 0.62, q[2] + s * 0.13], near ? [x, dy(x), s * (hw(x) - 0.02)] : null, 0.12, 0.6, s > 0 || seed !== 2 ? [0.82, 0.82, 0.78] : [0.05, 0.1, 0.4], lod); }
    }
    hatch(g, [3.3, C.top(3.3) - 0.01, 0], 0.26, 0.26, lod);
    box(g, [2.75, C.top(2.75) + 0.035, 0], 0.22, 0.03, 0.75, V.canvas, mat(MAT.UPHOLSTERY));
    if (near) {
      box(g, [5.0, dy(5.0) + 0.07, 0], 0.16, 0.07, 0.13, white, GEL); lathe(g, [[0.1, -0.05], [0.1, 0.05]], [0.6, 0.6, 0.62], MET, { segs: 8, axis: 'x', at: [5.0, dy(5.0) + 0.17, 0.2] });
      box(g, [5.75, dy(5.7) + 0.02, 0], 0.3, 0.02, 0.09, [0.6, 0.6, 0.62], MET);
      for (const s of [-1, 1]) { cleat(g, [5.1, dy(5.1) + 0.02, s * (hw(5.1) - 0.2)], 0.3 * s, 1.3); cleat(g, [-0.2, dy(-0.2) + 0.02, s * (hw(-0.2) - 0.2)], 0, 1.3); cleat(g, [-5.6, dy(-5.6) + 0.07, s * (hw(-5.6) - 0.05)], 0, 1.3); }
      // portlights in the topsides forward
      for (const s of [-1, 1]) for (const x of [2.2, 3.2, 4.1]) { const q = [0, 0, 0]; H.parts[1](H.tOf(x), 0.42, s, q); pane(g, [[-0.2, -0.07], [0.2, -0.07], [0.26, 0], [0.2, 0.07], [-0.2, 0.07], [-0.26, 0]].map(([a, b]) => [q[0] + a, q[1] + b, q[2] + s * (0.014 + b * 0.3)]), 0); }
    // bow name on each side
      for (const s of [-1, 1]) { const q = [0, 0, 0]; H.parts[1](H.tOf(3.4), 0.6, s, q); text(g, V.name, [q[0], q[1], q[2] + s * 0.012], [s, 0, -0.26], [0, 1, 0], 0.15, V.hull[0] > 0.4 ? V.accent : [0.75, 0.68, 0.4], RUB, { off: 0.008, centre: true }); }
    }
    rode(g, [5.95, dy(5.8), 0], [8.6, -5.5, 0], lod);
  }
  ball(g, [-1.9, 5.85, 0.5], 0.08, WHITE);
  lamps.push(lamp([-1.9, 5.85, 0.5], WHITE, 'anchor', { size: 0.5 }));
  lamps.push(lamp([-1.4, 2.4, 1.6], WARM, 'window', { size: 0.9 }), lamp([-1.4, 2.4, -1.6], WARM, 'window', { size: 0.9 }), lamp([0.3, 3.9, 0], WARM, 'window', { size: 0.5 }));
  return { g, lamps, foot: 8 };
}
// =========================================================================================
// Rigid inflatable boat with a centre console and an outboard
// =========================================================================================
export const RIB = { length: 6.8, radius: 5 };
const RIBS = [
  { tube: [0.5, 0.17, 0.03], trim: [0.05, 0.05, 0.055], grp: [0.7, 0.7, 0.68], cowl: [0.06, 0.06, 0.07], word: 'RESCUE', frame: true },
  { tube: [0.2, 0.21, 0.23], trim: [0.05, 0.05, 0.055], grp: [0.72, 0.72, 0.7], cowl: [0.75, 0.75, 0.73], word: 'MARSHAL', frame: false },
  { tube: [0.06, 0.065, 0.075], trim: [0.5, 0.17, 0.03], grp: [0.6, 0.62, 0.64], cowl: [0.06, 0.06, 0.07], word: 'SAFETY', frame: true },
];
// an outboard on a transom at p: cowl, leg, plate, gearcase, propeller
function bigOutboard(g, p, lod, col) {
  const s0 = mark(g), leg = [0.55, 0.57, 0.6];
  blob(g, [-0.3, 0.72, 0], 0.4, 0.27, 0.2, col, GEL, { n: lod ? 3 : 6, segs: lod ? 6 : 12, p: 2.8 });
  box(g, [-0.24, 0.3, 0], 0.14, 0.2, 0.11, leg, GEL);
  box(g, [-0.3, -0.15, 0], 0.09, 0.3, 0.06, leg, GEL);
  if (lod < 2) {
    box(g, [-0.3, 0.5, 0], 0.36, 0.035, 0.17, [0.8, 0.8, 0.78], GEL);                          // the band under the cowl
    box(g, [-0.36, -0.42, 0], 0.2, 0.012, 0.1, leg, GEL);                                      // anti-ventilation plate
    lathe(g, [[0.0, -0.3], [0.05, -0.22], [0.075, -0.05], [0.07, 0.12], [0.0, 0.22]], leg, GEL, { segs: 8, axis: 'x', at: [-0.3, -0.62, 0] });
    fan(g, [[-0.25, -0.68, 0], [-0.5, -0.68, 0], [-0.42, -0.9, 0]], leg, GEL);                // skeg
    for (let k = 0; k < 3; k++) { const a = (k / 3) * TAU; fan(g, [[-0.58, -0.62, 0], [-0.6, -0.62 + Math.cos(a) * 0.17, Math.sin(a) * 0.17], [-0.52, -0.62 + Math.cos(a + 0.9) * 0.15, Math.sin(a + 0.9) * 0.15]], [0.15, 0.15, 0.16], MET); }
    box(g, [-0.02, 0.36, 0], 0.07, 0.17, 0.2, [0.3, 0.3, 0.32], MET);                         // clamp bracket
    if (!lod) { rod(g, [0.0, 0.5, 0.1], [0.5, 0.42, 0.25], 0.012, DARK, RUB, 4); text(g, 'TIDE 90', [-0.52, 0.66, 0.205], [1, 0, 0], [0, 1, 0], 0.07, col[0] > 0.4 ? [0.05, 0.05, 0.06] : [0.75, 0.75, 0.72], RUB, { off: 0.004 }); }
  }
  xf(g, s0, frame(p));
}
export function ribGeo(lod = 0, seed = 1) {
  const g = new Geo(lod ? 2048 : 32768), lamps = [], V = RIBS[(((seed - 1) % 3) + 3) % 3];
  const near = lod === 0, far = lod === 2, floor = [0.5, 0.51, 0.5];
  const S = { L: 6.3, B: 1.86, draft: 0.4, free: 0.52, rise: 0.3, bow: 2.3, bowK: 0.62, keelBow: 0.75, rake: 0.05, chine: { y0: 0.02, rise: 0.45, pow: 2.4, w0: 0.96, w1: 0.4 } };
  const H = hullShape(S), T = stations(far ? 5 : lod ? 8 : 16), hp = far ? null : hullPaint(seed + 20, 0.1);
  hullBands(g, H.parts[0], T, [{ y0: -9, y1: 0.03, col: [0.1, 0.1, 0.12], rows: 1 }, { y0: 0.03, y1: 9, col: V.grp, rows: 1 }], hp);
  hullBands(g, H.parts[1], T, [{ y0: -9, y1: 9, col: V.grp, rows: far ? 1 : 2 }], hp);
  deck(g, H, lin(0, 0.93, far ? 3 : 6), -1, 1, floor, NSK, { camber: 0.01, nq: 2, inset: 0.92, drop: 0.08 });
  // the collar: one tube from the starboard quarter round the bow to the port quarter, cone ends aft
  const half = [[-3.62, 0.9, 0.05, 0.6], [-3.25, 0.9, 0.24, 0.6], [-2.9, 0.9, 0.275, 0.6], [-1.5, 0.93, 0.28, 0.61], [0.2, 0.92, 0.28, 0.63], [1.5, 0.82, 0.275, 0.68], [2.4, 0.58, 0.265, 0.75], [2.95, 0.3, 0.255, 0.82]];
  const path = [...half.map(([x, z, r, y]) => [x, y, z, r]), [3.12, 0.86, 0, 0.25], ...half.slice().reverse().map(([x, z, r, y]) => [x, y, -z, r])];
  const dense = [];
  for (let i = 0; i < path.length - 1; i++) { const n = far ? 1 : lod ? 2 : 3; for (let k = 0; k < n; k++) { const f = k / n, a = path[Math.max(i - 1, 0)], b = path[i], c = path[i + 1], d = path[Math.min(i + 2, path.length - 1)], cr = (j) => 0.5 * (2 * b[j] + (-a[j] + c[j]) * f + (2 * a[j] - 5 * b[j] + 4 * c[j] - d[j]) * f * f + (-a[j] + 3 * b[j] - 3 * c[j] + d[j]) * f * f * f); dense.push([cr(0), cr(1), cr(2), cr(3)]); } }
  dense.push(path[path.length - 1]);
  const s0 = mark(g);
  tube(g, dense, dense.map((q) => q[3]), V.tube, RUB, { segs: far ? 5 : lod ? 8 : 14, caps: true });
  if (!far) paint(g, s0, both(faded(seed + 3, 0.3), stain(seed, { weedTop: 0.0, tide: 0.03, wet: 0.08, salt: 0.1 })));
  // outward normal of the collar's line at a point of the dense path
  const outw = (i) => { const a = dense[Math.max(i - 1, 0)], b = dense[Math.min(i + 1, dense.length - 1)], tx = b[0] - a[0], tz = b[2] - a[2], l = Math.hypot(tx, tz) || 1; return [-tz / l, tx / l]; };
  if (!far) {
    // the rubbing strake round the outside, and a lighter wear strip on top
    const band = (ang, r, col, k = 1) => tube(g, dense.filter((q, i) => i % k === 0 || i === dense.length - 1).map((q) => { const i = dense.indexOf(q), o = outw(i); return [q[0] + o[0] * q[3] * Math.cos(ang), q[1] + q[3] * Math.sin(ang), q[2] + o[1] * q[3] * Math.cos(ang)]; }).slice(2, -2), r, col, RUB, { segs: lod ? 3 : 5 });
    band(0.0, lod ? 0.045 : 0.04, V.trim);
    if (near) {
      band(1.5, 0.025, scl(V.tube, 0.6));
      // seams between the collar's chambers, handles, and the grab line looped through its patches
      for (let i = 4; i < dense.length - 4; i += 5) { const q = dense[i], a = dense[i - 1], b = dense[i + 1]; hoop(g, [q[0], q[1], q[2]], [(b[0] - a[0]) / Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), (b[1] - a[1]) / Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), (b[2] - a[2]) / Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])], q[3] + 0.004, 0.012, scl(V.tube, 0.55), RUB, 14, 3); }
      const line = [];
      for (let i = 3; i < dense.length - 3; i++) { const q = dense[i], o = outw(i), hang = i % 3 === 0 ? 0 : 0.07, ang = 0.75; line.push([q[0] + o[0] * (q[3] * Math.cos(ang) + 0.012), q[1] + q[3] * Math.sin(ang) + 0.012 - hang, q[2] + o[1] * (q[3] * Math.cos(ang) + 0.012)]); if (i % 3 === 0) box(g, [q[0] + o[0] * q[3] * Math.cos(ang), q[1] + q[3] * Math.sin(ang), q[2] + o[1] * q[3] * Math.cos(ang)], 0.05, 0.012, 0.05, V.trim, RUB, { yaw: Math.atan2(o[1], o[0]) }); }
      tube(g, line, 0.009, [0.75, 0.75, 0.7], CLOTH, { segs: 3 });
      for (const s of [-1, 1]) text(g, V.word, [-1.0, 0.7, s * 1.19], [s, 0, 0], [0, 0.93, s * -0.37], 0.2, V.tube[0] + V.tube[1] > 0.5 ? [0.04, 0.04, 0.05] : [0.78, 0.78, 0.74], RUB, { off: 0.012, centre: true });
    }
    // centre console: body, raked screen in a grab rail, wheel, throttle, a lit plotter
    const cx = 0.25, fy = H.deckY(0) - 0.07;
    hexaBox(g, [cx - 0.38, cx + 0.42], fy, [0.32, 0.26], 0.95, V.grp);
    quad(g, [cx + 0.3, fy + 0.97, -0.27], [cx + 0.3, fy + 0.97, 0.27], [cx + 0.14, fy + 1.42, 0.24], [cx + 0.14, fy + 1.42, -0.24], [0.02, 0.03, 0.04], GLS);
    tube(g, [[cx + 0.34, fy + 0.9, -0.31], [cx + 0.13, fy + 1.47, -0.27], [cx + 0.13, fy + 1.47, 0.27], [cx + 0.34, fy + 0.9, 0.31]], lod ? 0.02 : 0.015, STEEL, MET, { segs: 4 });
    if (near) {
      hoop(g, [cx - 0.42, fy + 0.82, 0], [1, 0.45, 0], 0.17, 0.014, DARK, RUB, 14, 4);
      for (let k = 0; k < 3; k++) { const a = (k / 3) * TAU + 0.5; rod(g, [cx - 0.41, fy + 0.82, 0], [cx - 0.42 - 0.076 * Math.cos(a), fy + 0.82 + 0.155 * Math.cos(a), 0.17 * Math.sin(a)], 0.008, STEEL, MET, 3); }
      box(g, [cx - 0.2, fy + 1.0, 0.36], 0.08, 0.05, 0.04, DARK, RUB); rod(g, [cx - 0.2, fy + 1.03, 0.36], [cx - 0.13, fy + 1.2, 0.36], 0.012, STEEL, MET, 4);
      box(g, [cx - 0.1, fy + 1.03, -0.05], 0.1, 0.07, 0.13, DARK, RUB, { yaw: 0 }); box(g, [cx - 0.21, fy + 1.04, -0.05], 0.005, 0.055, 0.11, [0.1, 0.25, 0.2], LIT);
      rod(g, [cx + 0.1, fy + 0.96, 0.2], [cx + 0.05, fy + 2.2, 0.2], 0.006, [0.2, 0.2, 0.2], RUB, 3);
    }
    // a jockey seat pod behind the console
    hexaBox(g, [-1.05, -0.45], fy, [0.22, 0.17], 0.62, V.grp);
    box(g, [-0.75, fy + 0.67, 0], 0.3, 0.05, 0.18, [0.05, 0.05, 0.055], mat(MAT.UPHOLSTERY));
    box(g, [-1.07, fy + 0.86, 0], 0.045, 0.2, 0.17, [0.05, 0.05, 0.055], mat(MAT.UPHOLSTERY));
    // the transom and the engine well
    box(g, [-3.12, fy + 0.3, 0], 0.035, 0.34, 0.66, V.grp, GEL);
  }
  bigOutboard(g, [-3.18, 0.45, 0], lod, V.cowl);
  // an A-frame over the stern with the all-round light, a reflector and an aerial
  const AX = -2.55, AT = 2.08;
  if (V.frame) {
    const rr = far ? 0.035 : 0.022;
    for (const s of [-1, 1]) tube(g, [[AX - 0.3, 0.85, s * 0.74], [AX, AT - 0.08, s * 0.42], [AX, AT, s * 0.3]], rr, [0.7, 0.72, 0.74], MET, { segs: far ? 3 : 5 });
    rod(g, [AX, AT, -0.3], [AX, AT, 0.3], rr, [0.7, 0.72, 0.74], MET, far ? 3 : 5);
    if (near) {
      for (const s of [-1, 1]) rod(g, [AX - 0.2, 1.2, s * 0.63], [AX + 0.5, 0.86, s * 0.76], 0.016, [0.7, 0.72, 0.74], MET, 4);
      lathe(g, [[0.05, 0], [0.05, 0.3]], [0.8, 0.8, 0.78], GEL, { segs: 6, at: [AX, AT + 0.02, -0.2] });
      rod(g, [AX, AT, 0.22], [AX - 0.1, AT + 1.3, 0.22], 0.005, [0.2, 0.2, 0.2], RUB, 3);
      lifering(g, [AX - 0.14, 1.55, 0], [-1, 0.3, 0], 0.2);
    }
  } else if (!far) rod(g, [-1.07, 1.0, 0.12], [-1.07, AT, 0.12], 0.014, STEEL, MET, 4);
  if (near) {
    // what a working boat carries: fuel tank, battery box, an anchor on its warp in the bow, a paddle, a fender, a mark's sinker
    const fy = H.deckY(0) - 0.07;
    box(g, [-2.3, fy + 0.14, -0.3], 0.26, 0.14, 0.17, [0.5, 0.05, 0.04], RUB); lathe(g, [[0.035, 0], [0.035, 0.035], [0, 0.035]], DARK, RUB, { segs: 6, at: [-2.4, fy + 0.28, -0.3] });
    box(g, [-2.3, fy + 0.12, 0.32], 0.2, 0.12, 0.14, [0.08, 0.08, 0.09], RUB);
    tube(g, [[-2.1, fy + 0.2, -0.3], [-2.6, fy + 0.12, -0.1], [-3.0, fy + 0.3, -0.05]], 0.012, DARK, RUB, { segs: 3 });
    coil(g, [2.0, fy + 0.06, 0.1], 0.2, [0.62, 0.58, 0.45]);
    for (let k = 0; k < 4; k++) { const a = (k / 4) * TAU; tube(g, [[2.05, fy + 0.1, 0.1], [2.05 + Math.cos(a) * 0.16, fy + 0.07, 0.1 + Math.sin(a) * 0.16], [2.05 + Math.cos(a) * 0.2, fy + 0.16, 0.1 + Math.sin(a) * 0.2]], 0.01, [0.35, 0.35, 0.36], MET, { segs: 3 }); }
    rod(g, [-1.8, 0.93, 0.72], [0.1, 0.95, 0.7], 0.016, [0.5, 0.4, 0.2], RUB, 4); box(g, [0.25, 0.95, 0.7], 0.18, 0.012, 0.08, [0.5, 0.4, 0.2], RUB);
    fender(g, [-0.3, fy + 0.13, -0.45], null, 0.1, 0.5, [0.8, 0.8, 0.76], 0);
    xf(g, mark(g) - 1, frame([0, 0, 0]));
    // bow fitting: a fairlead on the nose and a towing eye under it
    box(g, [3.2, 1.0, 0], 0.12, 0.02, 0.07, [0.6, 0.6, 0.62], MET);
    hoop(g, [3.22, 0.5, 0], [0, 0, 1], 0.05, 0.014, STEEL, MET, 8, 3);
    cleat(g, [2.7, fy + 0.02, 0], 0, 1.2);
  }
  const lp = V.frame ? [AX, AT + 0.12, 0] : [-1.07, AT + 0.05, 0.12];
  ball(g, lp, 0.05, WHITE);
  lamps.push(lamp(lp, WHITE, 'anchor', { size: 0.3 }));
  return { g, lamps, foot: 4.5 };
}
// a tapered locker standing on a deck: from x0 to x1, half widths [bottom, top], height h
function hexaBox(g, [x0, x1], y, [wb, wt], h, col) {
  const sl = 0.06;
  const b = [[x0, y, -wb], [x1, y, -wb], [x1, y, wb], [x0, y, wb]], t = [[x0 + sl, y + h, -wt], [x1 - sl, y + h, -wt], [x1 - sl, y + h, wt], [x0 + sl, y + h, wt]];
  quad(g, t[0], t[1], t[2], t[3], col, GEL);
  for (let i = 0; i < 4; i++) quad(g, b[i], b[(i + 1) % 4], t[(i + 1) % 4], t[i], col, GEL);
}

// =========================================================================================
// Committee boat: a 13 m work boat with a signal mast, flags and a sign
// =========================================================================================
export const COMMITTEE = { length: 13.4, radius: 10, sign: [3.3, 0.71] };
// a signal flag hoisted on a halyard, its hoist at p, streaming aft (the boat lies head to wind)
function hoisted(g, p, w, h, fnCol, lod) {
  const nu = lod ? 2 : 5, nv = lod ? 1 : 3;
  surf(g, (u, v, out) => { out[0] = p[0] - u * w * 0.92; out[1] = p[1] - v * h - 0.12 * u * u * w; out[2] = p[2] + 0.06 * w * Math.sin(u * 5.5 + v) * u; }, lin(0, 1, nu), lin(0, 1, nv), [1, 1, 1], CLOTH, { paint: (P, N, C, i) => { const u = clamp((p[0] - P[i]) / (w * 0.92), 0, 0.999), v = clamp((p[1] - P[i + 1] - 0.12 * u * u * w) / h, 0, 0.999), c = fnCol(u, v); C[i] = c[0]; C[i + 1] = c[1]; C[i + 2] = c[2]; } });
}
const FW = [0.72, 0.72, 0.7], FB = [0.04, 0.07, 0.4], FR = [0.6, 0.04, 0.03], FY = [0.65, 0.52, 0.04], FK = [0.03, 0.03, 0.035], FO = [0.7, 0.22, 0.02];
const CODE = {
  P: (u, v) => (u > 0.3 && u < 0.7 && v > 0.3 && v < 0.7 ? FW : FB),                    // "Papa": the preparatory signal
  I: (u, v) => (Math.hypot(u - 0.5, v - 0.5) < 0.24 ? FK : FY),
  S: (u, v) => (u > 0.3 && u < 0.7 && v > 0.3 && v < 0.7 ? FB : FW),
  AP: (u, v) => (Math.floor(u * 5) % 2 ? FW : FR),
  X: (u, v) => (Math.abs(u - 0.5) < 0.13 || Math.abs(v - 0.5) < 0.16 ? FB : FW),
  O: () => FO,
  E: (u, v) => (v < 0.5 ? FB : FR),
};
// a tyre hung on a hull as a fender
function tyre(g, c, sg, lod) { hoop(g, c, [0, 0, sg], 0.26, 0.095, [0.025, 0.025, 0.027], RUB, lod ? 8 : 12, lod ? 4 : 6); }
export function committeeGeo(lod = 0, seed = 1) {
  const g = new Geo(lod ? 8192 : 65536), lamps = [];
  const near = lod === 0, far = lod === 2;
  const navy = [0.02, 0.05, 0.14], white = [0.78, 0.78, 0.75], orange = [0.7, 0.2, 0.03], anti = [0.28, 0.04, 0.03], deckC = [0.2, 0.3, 0.24], buff = [0.6, 0.5, 0.3];
  const S = { L: 13.4, B: 4.3, draft: 0.95, free: 1.4, rise: 0.75, sternLift: 0.12, bow: 3.0, bowK: 0.55, keelBow: 0.85, pMid: 2.2, pBow: 1.5, rake: 0.035, sternW: 0.88 };
  const H = hullShape(S), fn = H.parts[0], T = stations(far ? 6 : lod ? 10 : 24);
  const sy = (t) => H.ys(t), dy = H.deckY, hw = H.hw;
  const hp = far ? null : both(hullPaint(seed + 30, 0.18), rust(seed, { amt: 0.45, f: 2.2, lo: 0.66, hi: 0.86 }));
  hullBands(g, fn, T, far
    ? [{ y0: -9, y1: 0.1, col: anti, rows: 1 }, { y0: 0.1, y1: (t) => sy(t) - 0.4, col: navy, rows: 2 }, { y0: (t) => sy(t) - 0.4, y1: 9, col: orange, rows: 1 }]
    : [{ y0: -9, y1: 0.03, col: anti, rows: lod ? 2 : 3 }, { y0: 0.03, y1: 0.14, col: white, rows: 1 }, { y0: 0.14, y1: (t) => sy(t) - 0.42, col: navy, rows: lod ? 2 : 4 }, { y0: (t) => sy(t) - 0.42, y1: (t) => sy(t) - 0.2, col: orange, rows: 1 }, { y0: (t) => sy(t) - 0.2, y1: 9, col: navy, rows: 1 }], hp);
  deck(g, H, lin(0, 0.997, far ? 5 : lod ? 8 : 16), -1, 1, deckC, NSK, { nq: far ? 2 : 4 });
  // bulwarks: plating carried up above the deck, a capping rail, freeing ports with their rust
  const BW = 0.36;
  {
    const n = far ? 6 : lod ? 10 : 24, ts = lin(0, 0.997, n);
    for (const s of [-1, 1]) {
      const lo = ts.map((t) => H.sheer(t, s)), hi = lo.map((q, i) => [q[0] + 0.012 * ts[i], q[1] + BW + 0.12 * Math.pow(ts[i], 4), q[2] * (1 + 0.012)]);
      loft(g, [lo, hi], navy, GEL, { closed: false, paint: hp });
      if (!far) tube(g, hi, 0.04, buff, GEL, { segs: lod ? 4 : 6 });
      if (near) for (let i = 2; i < n - 5; i += 3) { const a = lo[i], b = lo[i + 1], o = s * 0.012; quad(g, [a[0], a[1] + 0.02, a[2] * 1.004 + o], [b[0], b[1] + 0.02, b[2] * 1.004 + o], [b[0], b[1] + 0.12, b[2] * 1.008 + o], [a[0], a[1] + 0.12, a[2] * 1.008 + o], [0.01, 0.01, 0.012], RUB); quad(g, [a[0] + 0.1, a[1] + 0.02, a[2] * 1.003 + o * 0.8], [b[0] - 0.1, b[1] + 0.02, b[2] * 1.003 + o * 0.8], [b[0] - 0.14, b[1] - 0.5, b[2] * 0.985 + o], [a[0] + 0.16, a[1] - 0.42, a[2] * 0.985 + o], [0.2, 0.09, 0.04], RUB); }
    }
    const a = H.sheer(0, -1), b = H.sheer(0, 1);
    quad(g, a, b, [b[0], b[1] + BW, b[2] * 1.012], [a[0], a[1] + BW, a[2] * 1.012], navy, GEL);
    if (!far) rod(g, [a[0], a[1] + BW, a[2] * 1.012], [b[0], b[1] + BW, b[2] * 1.012], 0.04, buff, GEL, 6);
    // a heavy rubbing strake under the orange band, and old tyres hung along it
    if (!far) for (const s of [-1, 1]) tube(g, lin(0, 0.99, lod ? 10 : 20).map((t) => { const q = [0, 0, 0]; fn(t, 1, s, q); const p = [0, 0, 0]; fn(t, 0.9, s, p); return [lerp(q[0], p[0], 0.9), sy(t) - 0.46, lerp(q[2], p[2], 0.95) + s * 0.03]; }), 0.055, [0.03, 0.03, 0.032], RUB, { segs: lod ? 4 : 6 });
  }
  // ---- wheelhouse with a roof deck ----
  const ST = [{ x: -1.2, y0: 1.3, y1: 3.72, w: 1.62, wt: 1.56, r: 0.08, crown: 0.03 }, { x: 2.2, y0: 1.3, y1: 3.72, w: 1.62, wt: 1.56, r: 0.08, crown: 0.03 }, { x: 3.1, y0: 1.3, y1: 3.72, w: 1.38, wt: 1.34, r: 0.08, crown: 0.03 }, { x: 3.6, y0: 1.3, y1: 3.72, w: 1.15, wt: 1.12, r: 0.08, crown: 0.03 }];
  let C;
  if (far) { cabinFar(g, ST, 2.55, 3.35, white); C = cabin(new Geo(64), ST, white, GEL, { nc: 1 }); } else C = cabin(g, ST, white, GEL, { nc: 2 });
  slab(g, -1.35, 3.72, 3.72, 3.84, -1.75, 1.75, [0.5, 0.52, 0.5], NSK);
  if (!far) {
    for (const s of [-1, 1]) {
      for (const [x0, x1] of [[-0.8, 0.05], [0.22, 1.07], [1.24, 2.09]]) sideWindow(g, C, x0, x1, 2.55, 3.35, s, lod, { cut: 0.06, frame: [0.2, 0.2, 0.2], fm: RUB });
      // the wheelhouse door, aft on each side, with a port in it and a handle
      const dz = (y) => C.side(-0.95, y, s, 0.014)[2];
      if (near) { quad(g, [-1.1, 1.5, dz(1.5)], [-1.1 + 0.02, 1.5, dz(1.5)], [-1.1 + 0.02, 3.42, dz(3.42)], [-1.1, 3.42, dz(3.42)], [0.3, 0.3, 0.3], RUB); rod(g, [-0.98, 2.4, dz(2.4) + s * 0.03], [-0.98, 2.55, dz(2.5) + s * 0.03], 0.012, STEEL, MET, 4); }
      // the sign board under the windows
      const w = COMMITTEE.sign[0] / 2, h = COMMITTEE.sign[1], [a, b] = s > 0 ? [-w, w] : [w, -w], n = [0, 0, s], zb = s * 1.73, y0 = 3.95;
      g.tri([0.45 + a, y0, zb], [0.45 + b, y0, zb], [0.45 + b, y0 + h, zb], n, n, n, [1, 1, 1], TEX, [0, 1], [1, 1], [1, 0]);
      g.tri([0.45 + a, y0, zb], [0.45 + b, y0 + h, zb], [0.45 + a, y0 + h, zb], n, n, n, [1, 1, 1], TEX, [0, 1], [1, 0], [0, 0]);
      box(g, [0.45, y0 + h / 2, zb - s * 0.012], w + 0.03, h / 2 + 0.03, 0.008, [0.08, 0.09, 0.1], RUB);
    }
    // forward windows: three panes with a centre one that opens, wipers; a visor over them
    for (const [z0, z1] of [[-1.0, -0.4], [-0.33, 0.33], [0.4, 1.0]]) { pane(g, [[3.614, 2.55, z0], [3.614, 2.55, z1], [3.614, 3.38, z1], [3.614, 3.38, z0]], lod, [0.2, 0.2, 0.2], RUB); if (near) rod(g, [3.63, 3.36, (z0 + z1) / 2], [3.63, 2.75, (z0 + z1) / 2 + 0.2], 0.006, DARK, RUB, 3); }
    slab(g, 3.6, 3.95, 3.5, 3.54, -1.2, 1.2, white, GEL);
    // after bulkhead: a door and a window, the ladder to the roof
    pane(g, [[-1.214, 2.5, -1.15], [-1.214, 2.5, -0.3], [-1.214, 3.3, -0.3], [-1.214, 3.3, -1.15]], lod, [0.2, 0.2, 0.2], RUB);
    quad(g, [-1.212, 1.5, 0.3], [-1.212, 1.5, 1.05], [-1.212, 3.4, 1.05], [-1.212, 3.4, 0.3], [0.68, 0.68, 0.65], GEL);
    if (near) { pane(g, [[-1.222, 2.7, 0.5], [-1.222, 2.7, 0.85], [-1.222, 3.2, 0.85], [-1.222, 3.2, 0.5]], 0, [0.2, 0.2, 0.2], RUB); ladder(g, [-1.45, dy(-1.4) + 0.05, -1.3], [-1.3, 3.86, -1.3], [0, 0, 1], STEEL, MET, { w: 0.4, r: 0.016, step: 0.3 }); }
  }
  // ---- rails: pipe rails on the bulwark aft and forward, round the roof deck ----
  if (!far) {
    const rr = lod ? 0.02 : 0.016, ro = { h: 0.55, every: 1.2, rails: near ? [0.5, 1] : [1], r: rr, segs: 4 };
    for (const s of [-1, 1]) {
      railing(g, lin(-6.55, -1.4, 4).map((x) => [x, dy(x) + BW, s * hw(x) * 1.012]), STEEL, MET, ro);
      railing(g, lin(4.0, 6.3, 3).map((x) => [x, dy(x) + BW + 0.12 * Math.pow(H.tOf(x), 4), s * hw(x) * 1.012]), STEEL, MET, ro);
      railing(g, [[-1.3, 3.84, s * 1.7], [3.65, 3.84, s * 1.7]], STEEL, MET, { h: 0.9, every: 1.1, rails: near ? [0.5, 1] : [1], r: rr, segs: 4 });
    }
    railing(g, [[-6.68, dy(-6.7) + BW, -hw(-6.7) * 1.012], [-6.68, dy(-6.7) + BW, hw(-6.7) * 1.012]], STEEL, MET, ro);
    railing(g, [[3.65, 3.84, -1.7], [3.65, 3.84, 1.7]], STEEL, MET, { h: 0.9, every: 1.2, rails: near ? [0.5, 1] : [1], r: rr, segs: 4 });
    railing(g, [[-1.3, 3.84, -0.9], [-1.3, 3.84, 1.7]], STEEL, MET, { h: 0.9, every: 1.2, rails: near ? [0.5, 1] : [1], r: rr, segs: 4 });
    for (const s of [-1, 1]) for (const x of [-5.2, -3.1, -0.9, 1.4, 3.6]) { const q = [0, 0, 0]; fn(H.tOf(x), 0.86, s, q); tyre(g, [x, sy(H.tOf(x)) - 0.75, q[2] + s * 0.1], s, lod); if (near) rod(g, [x, sy(H.tOf(x)) - 0.5, q[2] + s * 0.14], [x, dy(x) + BW, s * hw(x) * 1.02], 0.012, [0.6, 0.56, 0.45], CLOTH, 3); }
  }
  // ---- mast: yardarm, signal halyards and what is flying, radar, the all-round light ----
  const mast = [0.5, 3.84, 0], mr = far ? 0.1 : 0.075, mc = [0.72, 0.74, 0.76];
  tube(g, [mast, [0.5, 7, 0], [0.5, 9.4, 0]], [mr, mr * 0.9, mr * 0.6], mc, GEL, { segs: far ? 3 : lod ? 5 : 8 });
  rod(g, [0.5, 8.0, -1.7], [0.5, 8.0, 1.7], far ? 0.06 : 0.04, mc, GEL, far ? 3 : 5);
  if (!far) {
    for (const s of [-1, 1]) { rod(g, [0.5, 8.9, 0], [0.5, 8.02, s * 1.65], lod ? 0.012 : 0.008, mc, MET, 3); rod(g, [0.5, 9.0, 0], [-1.25, 3.9, s * 1.66], lod ? 0.012 : 0.007, [0.4, 0.4, 0.42], MET, 3); }
    rod(g, [0.5, 9.0, 0], [3.55, 3.9, 0], lod ? 0.012 : 0.007, [0.4, 0.4, 0.42], MET, 3);
    // radar scanner on a bracket
    box(g, [0.8, 5.6, 0], 0.3, 0.03, 0.12, mc, GEL); lathe(g, [[0.12, 0], [0.12, 0.14], [0, 0.16]], white, GEL, { segs: 8, at: [0.95, 5.63, 0] }); box(g, [0.95, 5.84, 0], 0.05, 0.045, 0.62, white, GEL, { yaw: 0.6 });
  }
  // flags: two hoists on the starboard yardarm, one to port, a pennant at the truck
  const fl = (z, y, code, w = 0.62, h = 0.48) => { if (!far) rod(g, [0.5, 8.0, z], [0.5 - 0.02, 4.75, z * 1.08], 0.004, [0.7, 0.7, 0.64], RUB, 3); hoisted(g, [0.47, y, z], w, h, CODE[code], lod); };
  fl(1.5, 7.9, 'P'); fl(1.5, 7.3, 'I'); fl(0.8, 7.9, 'O', 0.75, 0.55); fl(-0.85, 7.9, 'E'); fl(-1.5, 7.9, 'AP', 0.8, 0.4); if (!far) fl(-1.5, 7.38, 'X');
  hoisted(g, [0.47, 9.38, 0], 0.7, 0.3, (u, v) => (Math.abs(v - 0.5) > 0.5 - 0.42 * (1 - u) ? [1, 1, 1] : u < 0.4 ? FB : FR), lod);
  if (!far) {
    // ---- roof: liferaft, searchlight, horns, floodlights, a compass binnacle, aerials ----
    lathe(g, [[0.0, -0.4], [0.2, -0.36], [0.24, -0.25], [0.24, 0.25], [0.2, 0.36], [0, 0.4]], white, GEL, { segs: lod ? 6 : 10, axis: 'x', at: [2.6, 4.12, -0.9] });
    for (const s of [-1, 1]) for (const x of [2.3, -0.5]) { rod(g, [x, 3.84, s * 1.45], [x, 4.2, s * 1.45], 0.02, STEEL, MET, 4); box(g, [x, 4.28, s * 1.45], 0.09, 0.08, 0.12, [0.15, 0.15, 0.16], RUB); box(g, [x, 4.28, s * 1.574], 0.075, 0.065, 0.004, [0.9, 0.9, 0.8], LIT); }
    if (near) {
      for (const x of [2.45, 2.75]) lathe(g, [[0.245, 0], [0.245, 0.04]], DARK, RUB, { segs: 10, axis: 'x', at: [x, 4.12, -0.9] });
      box(g, [2.6, 3.9, -0.9], 0.3, 0.05, 0.2, STEEL, MET);
      lathe(g, [[0.05, 0], [0.05, 0.25]], STEEL, MET, { segs: 6, at: [3.2, 3.84, 0] }); blob(g, [3.22, 4.2, 0], 0.16, 0.13, 0.13, [0.75, 0.75, 0.73], GEL, { n: 4, segs: 8 }); lathe(g, [[0.0, 0], [0.1, 0.005]], [0.9, 0.9, 0.8], LIT, { segs: 8, axis: 'x', at: [3.375, 4.2, 0] });
      for (const z of [0.5, 0.7]) tube(g, [[2.0, 3.95, z], [2.5, 3.95, z]], [0.03, 0.08], [0.6, 0.08, 0.05], GEL, { segs: 6, caps: true });
      for (const s of [-1, 1]) tube(g, [[-1.1, 3.84, s * 1.5], [-1.6, 6.6, s * 1.55]], [0.014, 0.004], white, GEL, { segs: 4 });
      lifering(g, [2.9, 4.3, 1.72], [0, 0, 1], 0.3); lifering(g, [2.9, 4.3, -1.72], [0, 0, -1], 0.3);
      // course boards on the roof rail: three numerals the fleet can read
      for (const [z, d] of [[0.3, '2'], [0.75, '7'], [1.2, '4']]) { box(g, [-1.33, 4.25, z], 0.012, 0.24, 0.19, [0.76, 0.76, 0.72], RUB); text(g, d, [-1.345, 4.08, z - 0.09], [0, 0, 1], [0, 1, 0], 0.34, [0.03, 0.03, 0.035], RUB, { off: 0.003, weight: 0.2 }); }
    }
    // ---- working deck aft: a stack with soot, a capstan, hatch, bitts, the day's spare marks, an orange flag staff ----
    lathe(g, [[0.22, 0], [0.2, 1.5], [0.2, 1.5], [0.23, 1.52], [0.23, 1.7], [0.17, 1.72]], buff, GEL, { segs: lod ? 6 : 10, at: [-1.75, dy(-1.75), 1.0], paint: (P, N, C2, i) => { if (P[i + 1] > dy(-1.75) + 1.45) { C2[i] = 0.02; C2[i + 1] = 0.02; C2[i + 2] = 0.02; } } });
    box(g, [-3.6, dy(-3.6) + 0.12, 0], 0.7, 0.12, 0.6, [0.5, 0.52, 0.5], GEL, { top: [0.3, 0.32, 0.3] });
    for (const [x, z, c, r] of [[-4.6, -1.2, [0.75, 0.3, 0.02], 0.42], [-5.4, -0.9, [0.7, 0.55, 0.03], 0.36], [-5.2, 1.15, [0.75, 0.3, 0.02], 0.4]]) lathe(g, [[0.0, 0], [r * 0.8, 0.02], [r, 0.2], [r, 0.9], [r * 0.6, 1.2], [0, 1.25]], c, RUB, { segs: lod ? 6 : 12, at: [x, dy(x) + 0.04, z], paint: near ? faded(x, 0.3) : undefined });
    if (near) {
      lathe(g, [[0.2, 0], [0.2, 0.05], [0.11, 0.08], [0.09, 0.32], [0.15, 0.36], [0.15, 0.42], [0, 0.44]], [0.1, 0.1, 0.11], RUB, { segs: 10, at: [-2.6, dy(-2.6) + 0.04, -1.1] });
      for (const s of [-1, 1]) { for (const z of [0.1, -0.1]) bollard(g, [-6.2, dy(-6.2) + 0.03, s * 1.3 + z], 0.7); bollard(g, [5.0, dy(5.0) + 0.03, s * 0.55], 0.8); cleat(g, [-2.6, dy(-2.6) + 0.04, s * (hw(-2.6) - 0.3)], 0, 1.6); }
      coil(g, [-4.5, dy(-4.5) + 0.05, 0.9], 0.34, [0.6, 0.55, 0.4], 4); coil(g, [-5.8, dy(-5.8) + 0.05, 0.2], 0.28, [0.2, 0.3, 0.55], 3); coil(g, [4.4, dy(4.4) + 0.05, -0.5], 0.3, [0.6, 0.55, 0.4], 3);
      // mark anchors and a crate of gear; a fire bucket; the fuel filler
      for (const [x, z] of [[-4.0, -1.45], [-4.25, -1.5]]) { box(g, [x, dy(x) + 0.1, z], 0.1, 0.07, 0.1, [0.12, 0.12, 0.13], RUB); hoop(g, [x, dy(x) + 0.2, z], [1, 0, 0], 0.05, 0.012, [0.3, 0.3, 0.3], MET, 6, 3); }
      slab(g, -3.0, -2.5, dy(-2.7) + 0.04, dy(-2.7) + 0.38, 1.0, 1.5, [0.05, 0.16, 0.42], RUB);
      lathe(g, [[0.1, 0], [0.13, 0.26], [0.13, 0.26], [0.12, 0.27]], [0.6, 0.06, 0.04], RUB, { segs: 8, at: [-1.5, dy(-1.5) + 0.04, -1.45] });
      // windlass and chain stopper forward, the anchor's cable over the stem roller
      lathe(g, [[0.14, -0.25], [0.14, -0.2], [0.09, -0.18], [0.09, 0.18], [0.14, 0.2], [0.14, 0.25]], [0.12, 0.12, 0.13], RUB, { segs: 10, axis: 'x', at: [5.6, dy(5.6) + 0.3, 0], ell: 1 });
      box(g, [5.6, dy(5.6) + 0.14, 0], 0.2, 0.12, 0.24, [0.12, 0.12, 0.13], RUB);
      // her name on each bow and the port of registry aft
      for (const s of [-1, 1]) { const q = [0, 0, 0]; fn(H.tOf(4.6), 0.93, s, q); text(g, 'STARTER', [q[0], q[1] - 0.1, q[2] + s * 0.02], [s, 0, -0.38], [0, 1, 0], 0.17, [0.75, 0.75, 0.72], RUB, { off: 0.012, centre: true }); }
      text(g, 'STARTER', [-6.7, 1.05, 0], [0, 0, 1], [0, 1, 0], 0.16, [0.75, 0.75, 0.72], RUB, { off: 0.014, centre: true });
    }
    // an ensign staff aft (the system flies the flag), nav lights on the wheelhouse sides
    rod(g, [-6.1, dy(-6.1) + BW, 0], [-6.1, 3.8, 0], 0.03, [0.65, 0.65, 0.65], MET, 4);
    for (const s of [-1, 1]) box(g, [2.0, 3.6, s * 1.6], 0.07, 0.06, 0.03, s < 0 ? [0.5, 0.05, 0.04] : [0.05, 0.5, 0.15], LIT);
    rode(g, [6.72, dy(6.7) + 0.2, 0], [10.2, -6, 0], lod);
  }
  rod(g, [0.5, 9.3, 0], [0.5, 9.9, 0], 0.03, [0.7, 0.7, 0.7], MET, 4);
  ball(g, [0.5, 10.0, 0], 0.08, WHITE);
  lamps.push(lamp([0.5, 10.0, 0], WHITE, 'anchor', { size: 0.6 }));
  lamps.push(lamp([2.3, 4.3, 1.5], WHITE, 'flood', { size: 0.8 }), lamp([2.3, 4.3, -1.5], WHITE, 'flood', { size: 0.8 }), lamp([-0.5, 4.3, 1.5], WHITE, 'flood', { size: 0.8 }), lamp([-0.5, 4.3, -1.5], WHITE, 'flood', { size: 0.8 }));
  for (const x of [-0.4, 0.65, 1.65]) lamps.push(lamp([x, 2.9, 1.64], WARM, 'window', { size: 0.9 }), lamp([x, 2.9, -1.64], WARM, 'window', { size: 0.9 }));
  return { g, lamps, foot: 8 };
}

// =========================================================================================
// Container ship, under way far off the course
// =========================================================================================
export const CARGO = { length: 200, radius: 110 };
const BOX_COLS = [[0.5, 0.06, 0.04], [0.04, 0.12, 0.35], [0.5, 0.35, 0.04], [0.06, 0.28, 0.12], [0.55, 0.55, 0.53], [0.3, 0.12, 0.06], [0.08, 0.3, 0.38], [0.55, 0.22, 0.04], [0.42, 0.42, 0.44], [0.32, 0.05, 0.1]];
// one forty-foot container, 12.19 x 2.59 x 2.44 m, its corner at the origin: corrugated sides, and on the door
// end (x = 0) the locking bars
let BOX40 = null, BOX40_PLAIN = null;
function container(detail) {
  if (detail ? BOX40 : BOX40_PLAIN) return detail ? BOX40 : BOX40_PLAIN;
  const g = new Geo(256), L = 12.19, Hh = 2.59, W = 2.44, c = [1, 1, 1];
  box(g, [L / 2, Hh / 2, W / 2], L / 2, Hh / 2, W / 2, c, detail ? CORR : RUB);
  if (detail) {
    for (const z of [0.35, 0.95, 1.49, 2.09]) box(g, [-0.07, Hh / 2, z], 0.05, Hh / 2 - 0.1, 0.035, [1.25, 1.25, 1.25], RUB);
    box(g, [-0.03, Hh / 2, W / 2], 0.02, Hh / 2 - 0.05, 0.02, [0.35, 0.35, 0.35], RUB);
  }
  if (detail) BOX40 = g; else BOX40_PLAIN = g;
  return g;
}
// an enclosed lifeboat, 8 m, bow toward +x
export function lifeboat(g, p, yaw, pitch, lod) {
  const s0 = mark(g), o = [0.7, 0.2, 0.03];
  lathe(g, [[0.0, -4.0], [0.9, -3.6], [1.45, -2.2], [1.5, 0], [1.4, 2.2], [0.8, 3.6], [0, 4.0]], o, GEL, { segs: lod ? 6 : 12, axis: 'x', ell: 1.0 });
  if (lod < 2) { blob(g, [0.6, 1.2, 0], 2.2, 0.75, 1.15, o, GEL, { n: lod ? 3 : 5, segs: lod ? 6 : 10, p: 3 }); box(g, [2.3, 1.45, 0], 0.5, 0.25, 0.7, [0.02, 0.03, 0.04], GLS); }
  if (!lod) { for (const z of [-1, 1]) for (const x of [-1.2, 0, 1.2]) box(g, [x, 1.2, z * 1.14], 0.3, 0.14, 0.03, [0.02, 0.03, 0.04], GLS); tube(g, lin(-3, 3, 6).map((x) => [x, 0.2, 1.5 * Math.sqrt(Math.max(1 - (x / 4.2) * (x / 4.2), 0))]), 0.05, [0.75, 0.75, 0.72], RUB, { segs: 3 }); }
  xf(g, s0, frame(p, yaw, pitch));
}
// a pedestal crane: column, slewing house with a cab, a box jib lowered onto its rest
function deckCrane(g, p, yaw, lod, col) {
  const s0 = mark(g), grey = [0.35, 0.36, 0.38];
  lathe(g, [[1.6, 0], [1.4, 14], [1.4, 14], [1.9, 14.3], [1.9, 14.9]], col, GEL, { segs: lod ? 6 : 12 });
  box(g, [0.3, 17.2, 0], 2.6, 2.3, 2.1, col, GEL);
  if (lod < 2) { box(g, [2.8, 17.6, 1.5], 0.9, 1.2, 0.8, col, GEL); box(g, [3.72, 17.9, 1.5], 0.02, 0.7, 0.65, [0.02, 0.03, 0.04], GLS); box(g, [-1.8, 19.9, 0], 0.9, 0.5, 1.6, grey, RUB); }
  // jib: two tapered box girders joined at the head, luffing wires from an A-frame
  const tip = [30, 14.2, 0];
  for (const z of lod === 2 ? [0] : [-0.9, 0.9]) { const a = [2.6, 16.2, z * 1.3], d = [tip[0] - a[0], tip[1] - a[1], -z * 1.0]; for (let k = 0; k < (lod ? 1 : 3); k++) { const n = lod ? 1 : 3, f0 = k / n, f1 = (k + 1) / n, q0 = [a[0] + d[0] * f0, a[1] + d[1] * f0, a[2] + d[2] * f0], q1 = [a[0] + d[0] * f1, a[1] + d[1] * f1, a[2] + d[2] * f1]; tube(g, [q0, q1], [lerp(0.7, 0.35, f0) * (lod === 2 ? 1.6 : 1), lerp(0.7, 0.35, f1) * (lod === 2 ? 1.6 : 1)], col, GEL, { segs: 4 }); } }
  if (lod < 2) {
    tube(g, [[-2.2, 19.5, -1.2], [-1.2, 24.5, 0], [-2.2, 19.5, 1.2]], 0.25, col, GEL, { segs: 4 });
    for (const z of [-0.3, 0.3]) rod(g, [-1.2, 24.5, z], [tip[0] - 1, tip[1] + 0.5, z * 0.5], lod ? 0.09 : 0.05, [0.08, 0.08, 0.09], RUB, 3);
    rod(g, [tip[0] - 0.5, tip[1], 0], [tip[0] - 0.5, tip[1] - 3.2, 0], 0.06, [0.08, 0.08, 0.09], RUB, 3);
    box(g, [tip[0] - 0.5, tip[1] - 3.7, 0], 0.5, 0.6, 0.35, [0.6, 0.45, 0.03], RUB);
    if (!lod) { ladder(g, [1.75, 0.2, 0], [1.6, 14.2, 0], [0, 0, 1], grey, MET, { w: 0.6, r: 0.04, step: 0.5, segs: 3 }); railing(g, [[-2.3, 19.5, -2.1], [2.9, 19.5, -2.1], [2.9, 19.5, 2.1], [-2.3, 19.5, 2.1], [-2.3, 19.5, -2.1]], [0.6, 0.5, 0.05], MET, { h: 1.1, every: 2.6, r: 0.035, segs: 3 }); }
  }
  xf(g, s0, frame(p, yaw));
}
// lod 0: within a few hundred metres; 1: to two kilometres (no surface lies on another: at that range the
// depth buffer resolves about a metre); 2: beyond
export function cargoGeo(seed = 1, lod = 0) {
  const g = new Geo(lod === 0 ? 131072 : lod === 1 ? 32768 : 2048), lamps = [], R = rng(seed * 13 + 5);
  const near = lod === 0, far = lod === 2;
  const topside = [0.03, 0.04, 0.075], boot = [0.36, 0.06, 0.04], deckC = [0.22, 0.09, 0.07], houseC = [0.74, 0.74, 0.71], NAME = 'TIDAL LINE';
  const deckY = 13.7;
  // ---- hull: a parallel middle body, a flared bow with a raised forecastle, a cruiser stern ----
  const hd = (t) => 16 * (t < 0.12 ? 1 - 0.26 * Math.pow((0.12 - t) / 0.12, 2) : t > 0.76 ? Math.pow(Math.max(1 - Math.pow((t - 0.76) / 0.24, 2.4), 3e-4), 0.55) : 1);
  const fl = (t) => (t > 0.7 ? 0.72 * smooth(0.7, 1.0, t) : t < 0.16 ? 0.55 * smooth(0.16, 0, t) : 0);
  const ys = (t) => deckY - 0.2 + 3.6 * smooth(0.84, 0.93, t) + 0.6 * smooth(0.93, 1, t);
  const Y0 = -2.5;
  const fn = (t, u, sg, out) => {
    const tc = clamp(t, 0, 1), s = ys(tc), y = lerp(Y0, s, u), d = 1 - (y - Y0) / (deckY + 3 - Y0);
    out[0] = -100 + 200 * t + 7.5 * smooth(0.86, 1, tc) * (y / 14) - 5 * smooth(0.1, 0, tc) * (1 - d) * (1 - d) * 1.0;
    out[1] = y;
    out[2] = sg * hd(tc) * (1 - fl(tc) * Math.pow(Math.max(d, 0), 1.4));
  };
  const T = far ? stations(12, 0, 0.999) : stations(lod ? 48 : 130, 0, 0.999);
  const ink = (x, y) => inkAt(NAME, 5.2, x + 24.5, y - 4.6, 0.2);
  const hp = far ? null : (P, N, C, i) => {
    const x = P[i], y = P[i + 1];
    const k = 0.86 + 0.28 * fb(x * 0.11 + seed, y * 0.3, 2.2);
    C[i] *= k; C[i + 1] *= k; C[i + 2] *= k;
    // rust weeping from the sheer and the scuppers, heavier round the hawse and the stern; a chalky, scuffed boot-top
    const dd = deckY - y, col = vn(x * 0.3 + seed, 7.3, 1.1), len = 2.5 + 9 * vn(x * 0.13, 2.2, seed) + 5 * smooth(70, 95, Math.abs(x));
    const st = smooth(0.55, 0.8, col) * smooth(len, 0, dd) * smooth(-0.5, 0.3, dd);
    mixIn(C, i, 0.3, 0.13, 0.06, st * 0.7);
    if (y < 2.2) { const w = smooth(2.2, 0.6, y + 0.8 * vn(x * 0.5, 1, seed)); mixIn(C, i, 0.36, 0.2, 0.14, w * 0.35); mixIn(C, i, 0.05, 0.07, 0.04, smooth(0.5, -0.1, y) * 0.75); }
  };
  const name = (P, N, C, i) => { hp(P, N, C, i); if (Math.abs(P[i]) < 25 && ink(P[i] * Math.sign(P[i + 2] || 1) * (P[i + 2] > 0 ? 1 : -1), P[i + 1])) { C[i] = 0.78; C[i + 1] = 0.78; C[i + 2] = 0.75; } };
  void name;
  if (far) hullBands(g, fn, T, [{ y0: -9, y1: 1.3, col: boot, rows: 1, mat: RUB }, { y0: 1.3, y1: 99, col: topside, rows: 2, mat: RUB }], null);
  else {
    hullBands(g, fn, T, [{ y0: -9, y1: 1.3, col: boot, rows: 2, mat: PLATE }, { y0: 1.3, y1: 1.65, col: [0.7, 0.7, 0.67], rows: 1, mat: PLATE }, { y0: 1.65, y1: 4.4, col: topside, rows: 2, mat: PLATE }, { y0: 10.2, y1: 99, col: topside, rows: 2, mat: PLATE }], hp);
    // the band that carries her owner's name is meshed finely amidships, and the letters are painted into it
    const Ta = T.filter((t) => t <= 0.37), Tb = lin(0.37, 0.63, lod ? 52 : 104), Tc = T.filter((t) => t >= 0.63);
    Ta.push(0.37); Tc.unshift(0.63);
    const nb = { y0: 4.4, y1: 10.2, col: topside, mat: PLATE };
    hullBands(g, fn, Ta, [{ ...nb, rows: 2 }], hp); hullBands(g, fn, Tc, [{ ...nb, rows: 2 }], hp, false);
    for (const sg of [-1, 1]) surf(g, (t, u, out) => fn(t, u, sg, out), Tb, lin((4.4 - Y0) / (ys(0.5) - Y0), (10.2 - Y0) / (ys(0.5) - Y0), lod ? 6 : 12), topside, PLATE, { lim: [0.37, 0.63, 0, 1], paint: (P, N, C, i) => { hp(P, N, C, i); if (ink(sg > 0 ? P[i] : -P[i], P[i + 1])) { C[i] = 0.78; C[i + 1] = 0.78; C[i + 2] = 0.75; } } });
  }
  const sheer = (t, sg) => { const q = [0, 0, 0]; fn(t, 1, sg, q); return q; };
  // weather deck
  sheet(g, T.length, 3, (i, j, out) => { const q = sheer(T[i], 1); out[0] = q[0]; out[1] = q[1] - 0.02; out[2] = q[2] * (j - 1) * 0.995; }, deckC, far ? RUB : GRAINM);
  const hwx = (x) => hd((x + 100) / 200);
  if (!far) {
    // bulwark round the forecastle, the stem; rails along the sides and round the poop
    for (const s of [-1, 1]) { const ts = lin(0.84, 0.999, lod ? 8 : 16), lo = ts.map((t) => sheer(t, s)), hi = lo.map((q, i) => [q[0] + 0.25 * i / ts.length, q[1] + 1.3, q[2] * 1.01]); loft(g, [lo, hi], topside, PLATE, { closed: false, paint: hp }); }
    for (const s of [-1, 1]) railing(g, lin(0.005, 0.84, lod ? 30 : 80).map((t) => { const q = sheer(t, s); return [q[0], q[1], q[2] * 0.995]; }), [0.6, 0.6, 0.58], lod ? RUB : MET, { h: 1.15, every: 99, rails: lod ? [1] : [0.5, 1], r: lod ? 0.09 : 0.03, segs: 3, noPosts: !!lod });
    { const a = sheer(0.002, -1), b = sheer(0.002, 1); railing(g, [[a[0], a[1], a[2]], [b[0], b[1], b[2]]], [0.6, 0.6, 0.58], lod ? RUB : MET, { h: 1.15, every: 3, rails: lod ? [1] : [0.5, 1], r: lod ? 0.09 : 0.03, segs: 3, noPosts: !!lod }); }
  }
  if (near) {
    // draught marks at the stem and the stern, a load line disc amidships; anchors home in their hawse pipes
    for (const s of [-1, 1]) {
      for (const [t, u] of [[0.955, 0], [0.04, 0]]) for (let m = 2; m <= 8; m += 2) { const q = [0, 0, 0]; fn(t, (m * 0.9 - Y0) / (ys(t) - Y0), s, q); void u; text(g, String(m), [q[0] - 0.4 * s, q[1], q[2] + s * 0.14], [s, 0, -0.25 * (t > 0.5 ? 1 : -0.6)], [0, 1, 0], 0.7, [0.75, 0.75, 0.72], RUB, { off: 0.1, weight: 0.2 }); }
      hoop(g, [3, 2.6, s * 16.14], [0, 0, s], 0.55, 0.07, [0.75, 0.75, 0.72], RUB, 14, 3); box(g, [3, 2.6, s * 16.14], 0.85, 0.06, 0.05, [0.75, 0.75, 0.72], RUB);
      const hz = sheer(0.925, s), a0 = mark(g);
      box(g, [0, 0, 0], 0.22, 1.6, 0.22, [0.1, 0.1, 0.11], RUB); for (const z of [-1, 1]) hexaFluke(g, z);
      xf(g, a0, frame([hz[0] + 0.3, hz[1] - 4.6, hz[2] * 0.8 + s * 0.5], s > 0 ? 0.5 : -0.5 + Math.PI, 0, 0));
      lathe(g, [[0.75, 0], [0.75, 0.5]], [0.02, 0.02, 0.025], RUB, { segs: 8, axis: 'x', at: [hz[0] + 0.1, hz[1] - 2.9, hz[2] * 0.8 + s * 0.15] });
      // the accommodation ladder stowed along the rail
      slab(g, -52, -38, deckY + 0.3, deckY + 1.1, s * 16.3 - 0.2, s * 16.3 + 0.2, [0.6, 0.6, 0.58], RUB);
    }
  }
  // ---- accommodation block: decks of windows, the bridge with its wings, the monkey island ----
  const AX0 = -82, AX1 = -68, AW = 14.2, DH = 3.0, ND = 7;
  if (far) { slab(g, AX0, AX1, deckY, deckY + ND * DH, -AW, AW, houseC, RUB); slab(g, AX0 + 1, AX1 + 0.5, deckY + ND * DH, deckY + ND * DH + 1.2, -17, 17, houseC, RUB); slab(g, AX0 + 1.5, AX1 + 0.3, deckY + ND * DH + 1.2, deckY + ND * DH + 2.4, -17, 17, GLASS, GLS); slab(g, AX0 + 1, AX1 + 0.5, deckY + ND * DH + 2.4, deckY + ND * DH + 3.1, -17, 17, houseC, RUB); }
  else {
    // each deck: a sill strip, a window strip (glass between mullions near; one dark band beyond), a head strip, an overhanging edge
    const wallStrip = (y0, y1, col, m, x0 = AX0, x1 = AX1, w = AW) => { quad(g, [x1, y0, -w], [x1, y0, w], [x1, y1, w], [x1, y1, -w], col, m); quad(g, [x0, y0, -w], [x0, y0, w], [x0, y1, w], [x0, y1, -w], col, m); for (const s of [-1, 1]) quad(g, [x0, y0, s * w], [x1, y0, s * w], [x1, y1, s * w], [x0, y1, s * w], col, m); };
    const hpw = mottle(seed + 5, 0.06, 0.25);
    for (let d = 0; d < ND; d++) {
      const y = deckY + d * DH;
      wallStrip(y, y + 1.15, houseC, GRAINM); wallStrip(y + 2.15, y + DH, houseC, GRAINM);
      if (near) {
        // windows: glass panes set between white mullions
        const nz = 9, nx = 4;
        for (let k = 0; k < nz * 2 + 1; k++) { const z0 = -AW + (k * 2 * AW) / (nz * 2 + 1), z1 = z0 + (2 * AW) / (nz * 2 + 1), glass = k % 2 === 1; for (const x of [AX0, AX1]) quad(g, [x, y + 1.15, z0], [x, y + 1.15, z1], [x, y + 2.15, z1], [x, y + 2.15, z0], glass ? GLASS : houseC, glass ? GLS : GRAINM); }
        for (let k = 0; k < nx * 2 + 1; k++) { const x0 = AX0 + (k * (AX1 - AX0)) / (nx * 2 + 1), x1 = x0 + (AX1 - AX0) / (nx * 2 + 1), glass = k % 2 === 1; for (const s of [-1, 1]) quad(g, [x0, y + 1.15, s * AW], [x1, y + 1.15, s * AW], [x1, y + 2.15, s * AW], [x0, y + 2.15, s * AW], glass ? GLASS : houseC, glass ? GLS : GRAINM); }
        // side galleries with rails on alternate decks, and their stairs
        if (d > 0) { slab(g, AX0 - 0.2, AX1 + 1.4, y - 0.12, y, -AW - 1.3, AW + 1.3, [0.5, 0.5, 0.48], RUB); for (const s of [-1, 1]) railing(g, [[AX0, y, s * (AW + 1.25)], [AX1 + 1.35, y, s * (AW + 1.25)]], [0.75, 0.75, 0.72], MET, { h: 1.1, every: 2.4, r: 0.03, segs: 3 }); railing(g, [[AX1 + 1.35, y, -AW - 1.25], [AX1 + 1.35, y, AW + 1.25]], [0.75, 0.75, 0.72], MET, { h: 1.1, every: 2.4, r: 0.03, segs: 3 }); }
      } else { wallStrip(y + 1.15, y + 2.15, [0.1, 0.11, 0.13], GLS); if (d > 0) slab(g, AX0 - 0.2, AX1 + 1.4, y - 0.15, y, -AW - 1.3, AW + 1.3, [0.5, 0.5, 0.48], RUB); }
    }
    paint(g, 0, () => {}, 0); void hpw;
    // bridge: wider than the house, glass all round under a visor, open wings to the ship's side
    const by = deckY + ND * DH, bw = 13.5;
    slab(g, AX0 - 0.2, AX1 + 1.5, by - 0.2, by, -17.2, 17.2, [0.5, 0.5, 0.48], RUB);
    wallStrip(by, by + 1.2, houseC, GRAINM, AX0 + 1.5, AX1 + 0.5, bw); wallStrip(by + 2.4, by + 3.1, houseC, GRAINM, AX0 + 1.5, AX1 + 0.5, bw);
    if (near) {
      const nz = 13;
      for (let k = 0; k < nz * 2 + 1; k++) { const z0 = -bw + (k * 2 * bw) / (nz * 2 + 1), z1 = z0 + (2 * bw) / (nz * 2 + 1), glass = k % 2 === 1 || true, mull = k % 2 === 0; quad(g, [AX1 + 0.5, by + 1.2, z0], [AX1 + 0.5, by + 1.2, z1], [AX1 + 0.5 + 0.35, by + 2.4, z1], [AX1 + 0.5 + 0.35, by + 2.4, z0], mull ? houseC : GLASS, mull ? GRAINM : GLS); void glass; }
      wallStrip(by + 1.2, by + 2.4, GLASS, GLS, AX0 + 1.5, AX1 + 0.45, bw);
      for (const s of [-1, 1]) { railing(g, [[AX0 + 2, by, s * 17.1], [AX1 + 1.4, by, s * 17.1]], houseC, MET, { h: 1.2, every: 2, r: 0.035, segs: 3, kick: 1.0 }); railing(g, [[AX1 + 1.4, by, s * 13.6], [AX1 + 1.4, by, s * 17.1]], houseC, MET, { h: 1.2, every: 2, r: 0.035, segs: 3, kick: 1.0 }); box(g, [AX1 + 0.6, by + 1.5, s * 16.6], 0.25, 0.3, 0.25, [0.2, 0.2, 0.2], RUB); }
    } else wallStrip(by + 1.2, by + 2.4, GLASS, GLS, AX0 + 1.5, AX1 + 0.5, bw);
    slab(g, AX0 + 1.2, AX1 + 1.2, by + 3.1, by + 3.3, -bw - 0.4, bw + 0.4, [0.5, 0.5, 0.48], RUB);
    if (near) railing(g, [[AX0 + 1.4, by + 3.3, -bw], [AX1 + 1, by + 3.3, -bw], [AX1 + 1, by + 3.3, bw], [AX0 + 1.4, by + 3.3, bw], [AX0 + 1.4, by + 3.3, -bw]], houseC, MET, { h: 1.1, every: 2.5, r: 0.03, segs: 3 });
    // radar mast: a post with yards, two scanners, domes for the satellite gear
    const my = by + 3.3, mx = -72;
    tube(g, [[mx, my, 0], [mx, my + 5, 0], [mx, my + 13.5, 0]], [0.55, 0.45, 0.22], houseC, GEL, { segs: lod ? 4 : 8 });
    rod(g, [mx, my + 6, -4.2], [mx, my + 6, 4.2], 0.18, houseC, GEL, 4); rod(g, [mx, my + 9.5, -2.6], [mx, my + 9.5, 2.6], 0.14, houseC, GEL, 4);
    for (const [y, z, l] of [[4.2, 0, 2.2], [7.4, 0, 1.5]]) { box(g, [mx + 1.2, my + y, z], 0.7, 0.08, 0.5, houseC, GEL); box(g, [mx + 1.3, my + y + 0.45, z], 0.14, 0.14, l, [0.8, 0.8, 0.78], GEL, { yaw: 0.5 + y }); }
    for (const z of [-7, 7]) { lathe(g, [[0.25, 0], [0.25, 1.4]], houseC, GEL, { segs: 6, at: [AX0 + 5, my, z] }); blob(g, [AX0 + 5, my + 2.3, z], 1.15, 1.2, 1.15, [0.82, 0.82, 0.8], GEL, { n: lod ? 3 : 5, segs: lod ? 6 : 10 }); }
    if (near) for (const z of [-3, 3, -1.2]) rod(g, [AX0 + 9, my, z], [AX0 + 8.6, my + 6.5, z], 0.04, [0.8, 0.8, 0.78], GEL, 3);
  }
  // ---- funnel: the company's colours, a black top, uptakes ----
  {
    const fx = -89.5, fy = deckY + (far ? 0 : 0), fh = far ? 31 : 30.5, funnelC = [0.04, 0.13, 0.36];
    if (!far) slab(g, -94, AX0, deckY, deckY + 12.5, -11, 11, houseC, GRAINM);
    const bands = [[0, 0.62, funnelC], [0.62, 0.74, [0.78, 0.78, 0.75]], [0.74, 0.84, funnelC], [0.84, 1, [0.02, 0.02, 0.022]]];
    const y0f = far ? deckY : deckY + 12.5, hh = far ? fh : fh - 12.5;
    for (const [a, b, c] of bands) lathe(g, [[3.4, y0f + hh * a], [3.3 - 0.25 * b, y0f + hh * b]], c, far ? RUB : GRAINM, { segs: far ? 6 : lod ? 10 : 20, at: [fx, 0, 0], ell: 1.7 });
    lathe(g, [[3.05, y0f + hh], [0, y0f + hh]], [0.02, 0.02, 0.022], RUB, { segs: far ? 6 : lod ? 10 : 20, at: [fx, 0, 0], ell: 1.7 });
    if (!far) for (const [dx, dz, r, h] of [[0.8, 0, 0.7, 1.6], [-0.9, 1.6, 0.4, 1.1], [-0.9, -1.6, 0.4, 1.1]]) lathe(g, [[r, 0], [r, h], [r * 0.8, h]], [0.03, 0.03, 0.03], RUB, { segs: 6, at: [fx + dx, y0f + hh, dz] });
    if (near) for (const s of [-1, 1]) text(g, 'T', [fx - 1.6 * s, y0f + hh * 0.2, s * 5.75], [s, 0, 0], [0, 1, 0], 3.6, [0.78, 0.78, 0.75], RUB, { off: 0.12, weight: 0.22 });
    fy; void fy;
  }
  // ---- boats: an enclosed lifeboat in davits each side, a free-fall boat on its ramp over the stern ----
  if (!far) {
    for (const s of [-1, 1]) { lifeboat(g, [-87, deckY + 15.3, s * 13.2], 0, 0, lod); for (const x of [-89.6, -84.4]) tube(g, [[x, deckY + 12.5, s * 10.8], [x, deckY + 18, s * 11], [x, deckY + 18.6, s * 13.2]], 0.22, houseC, GEL, { segs: 4 }); }
    lifeboat(g, [-97.5, deckY + 6.2, 0], Math.PI, 0.5, lod);
    for (const z of [-1.6, 1.6]) { rod(g, [-93.5, deckY + 8.9, z], [-101.5, deckY + 3.4, z], 0.25, [0.5, 0.5, 0.48], RUB, 4); rod(g, [-94.5, deckY, z], [-94.5, deckY + 8.4, z], 0.22, [0.5, 0.5, 0.48], RUB, 4); rod(g, [-99, deckY, z], [-99, deckY + 5.1, z], 0.22, [0.5, 0.5, 0.48], RUB, 4); }
  } else { box(g, [-87, deckY + 15.3, 13.2], 4, 1.5, 1.5, [0.7, 0.2, 0.03], RUB); box(g, [-87, deckY + 15.3, -13.2], 4, 1.5, 1.5, [0.7, 0.2, 0.03], RUB); }
  // ---- cargo: bays of containers on hatch covers between lashing bridges ----
  const NB = 12, PITCH = 12.75, X0 = -63.5, ROWP = 2.5, cranes = [-38, 0.25, 38.5];
  const proto = container(near), plain = container(false), F = frame([0, 0, 0]);
  for (let bay = 0; bay < NB; bay++) {
    const x0 = X0 + bay * PITCH, xm = x0 + 6.1, rows = Math.max(2, Math.floor((2 * (hwx(xm + 6) - 1.2)) / ROWP)), z00 = -(rows * ROWP) / 2;
    const maxT = bay > NB - 3 ? 3 : bay > NB - 5 ? 5 : 7, craneBay = cranes.some((c) => Math.abs(c - (x0 - 0.3)) < 2);
    const hy = deckY + 1.1;
    if (!far) { slab(g, x0 - 0.1, x0 + 12.3, deckY, hy, z00 - 0.2, z00 + rows * ROWP + 0.2, [0.3, 0.31, 0.32], GRAINM); if (near && bay > 0) { for (const s of [-1, 1]) slab(g, x0 - 0.5, x0 - 0.15, deckY, deckY + 6.5, s * (z00 + 0.4) - 0.2, s * (z00 + 0.4) + 0.2, [0.45, 0.46, 0.46], RUB); slab(g, x0 - 0.5, x0 - 0.15, deckY + 6.2, deckY + 6.5, z00, -z00, [0.45, 0.46, 0.46], RUB); } }
    let base = 3 + Math.floor(R() * (maxT - 2));
    const farBands = [];
    for (let r = 0; r < rows; r++) {
      if (r % 3 === 0) base = clamp(base + Math.floor(R() * 3) - 1, 2, maxT);
      const tiers = clamp(base - (R() < 0.25 ? 1 : 0), 1, maxT), z = z00 + r * ROWP + 0.03;
      const skip = craneBay && r === 0;
      let run = 0, col = BOX_COLS[0];
      for (let k = 0; k < tiers; k++) {
        if (run-- <= 0) { col = BOX_COLS[Math.floor(R() * BOX_COLS.length)]; run = Math.floor(R() * 3); }
        const tone = 0.75 + 0.4 * R(), c = [col[0] * tone, col[1] * tone, col[2] * tone], two = R() < 0.12;
        if (skip) continue;
        if (far) { farBands.push([r, k, c]); continue; }
        F[10] = hy + k * 2.6; F[11] = z;
        if (two) { F[9] = x0; stamp(g, k === tiers - 1 || r === 0 || r === rows - 1 ? proto : plain, F, c, [0.495, 1, 1]); F[9] = x0 + 6.15; stamp(g, plain, F, [c[1] * 1.3 + 0.05, c[2] + 0.05, c[0] * 0.8 + 0.05], [0.495, 1, 1]); }
        else { F[9] = x0; stamp(g, lod ? plain : proto, F, c); }
        if (near && (r === 0 || r === rows - 1) && R() < 0.22) { const s = r === 0 ? -1 : 1; text(g, 'TIDAL', [x0 + 6.1, hy + k * 2.6 + 0.85, r === 0 ? z : z + 2.44], [s, 0, 0], [0, 1, 0], 0.9, [0.8, 0.8, 0.77], RUB, { off: 0.08, weight: 0.22, centre: true }); }
      }
    }
    if (far) {
      // far: one block for every three rows, as tall as their mean, in the colour most of them share
      for (let r0 = 0; r0 < rows; r0 += 3) { const cells = farBands.filter(([r]) => r >= r0 && r < r0 + 3); if (!cells.length) continue; const nr = Math.min(3, rows - r0), h = cells.length / nr, c = cells[Math.floor(cells.length / 2)][2], top = cells[cells.length - 1][2]; slab(g, x0, x0 + 12.19, hy, hy + (h - 1) * 2.6, z00 + r0 * ROWP, z00 + (r0 + nr) * ROWP - 0.06, c, RUB); slab(g, x0, x0 + 12.19, hy + (h - 1) * 2.6, hy + h * 2.6, z00 + r0 * ROWP, z00 + (r0 + nr) * ROWP - 0.06, top, RUB); }
    }
  }
  for (const cx of cranes) deckCrane(g, [cx - 6.9, deckY, -hwx(cx) + 2.0], 0, lod, [0.62, 0.5, 0.06]);
  // ---- forecastle: breakwater, windlasses, bitts, the foremast ----
  const fyk = ys(0.95);
  if (!far) {
    for (const s of [-1, 1]) quad(g, [84, fyk, s * 0.2], [80.5, fyk, s * 11], [80.5, fyk + 2.2, s * 11], [84, fyk + 2.2, s * 0.2], [0.3, 0.31, 0.32], RUB);
    for (const s of [-1, 1]) { lathe(g, [[1.1, -1.4], [1.1, -1.1], [0.7, -1.0], [0.7, 1.0], [1.1, 1.1], [1.1, 1.4]], [0.1, 0.1, 0.11], RUB, { segs: lod ? 6 : 10, axis: 'x', at: [88, fyk + 1.3, s * 3.6] }); box(g, [88, fyk + 0.5, s * 3.6], 1.6, 0.5, 1.2, [0.2, 0.3, 0.24], RUB); }
    if (near) { for (const s of [-1, 1]) for (const x of [86, 91, 94]) for (const dz of [0, 0.9]) bollard(g, [x, fyk, s * (hwx(x) * 0.62 + dz)], 2.6, [0.1, 0.1, 0.11]); for (const s of [-1, 1]) chain(g, [88.6, fyk + 1.9, s * 3.6], [93.4, fyk + 0.2, s * 3.9], [0.12, 0.11, 0.1], RUB, { link: 0.5, r: 0.07 }); }
  }
  const fmx = 80.5, fmh = 16;
  tube(g, [[fmx, fyk, 0], [fmx, fyk + fmh, 0]], far ? [0.5, 0.3] : [0.42, 0.2], [0.72, 0.72, 0.7], far ? RUB : GEL, { segs: far ? 3 : 6 });
  if (!far) { rod(g, [fmx, fyk + 11, -3.5], [fmx, fyk + 11, 3.5], 0.14, [0.72, 0.72, 0.7], GEL, 4); for (const s of [-1, 1]) rod(g, [fmx, fyk + 14, 0], [fmx - 5, fyk, s * 5], 0.05, [0.3, 0.3, 0.3], RUB, 3); }
  // lights: masthead lights fore and aft, sidelights on the bridge wings, a stern light, deck floods, lit cabins
  const hTop = deckY + ND * DH + 3.3;
  ball(g, [fmx, fyk + fmh + 0.4, 0], 0.5, WHITE); ball(g, [-72, hTop + 13.9, 0], 0.5, WHITE);
  lamps.push(lamp([fmx, fyk + fmh + 0.4, 0], WHITE, 'anchor', { size: 3 }), lamp([-72, hTop + 13.9, 0], WHITE, 'anchor', { size: 3 }));
  ball(g, [AX1 + 0.6, deckY + ND * DH + 1.5, -17.2], 0.5, RED); ball(g, [AX1 + 0.6, deckY + ND * DH + 1.5, 17.2], 0.5, GREEN);
  lamps.push(lamp([AX1 + 0.6, deckY + ND * DH + 1.5, -17.3], RED, 'nav', { size: 3 }), lamp([AX1 + 0.6, deckY + ND * DH + 1.5, 17.3], GREEN, 'nav', { size: 3 }));
  lamps.push(lamp([-103, deckY + 3, 0], WHITE, 'nav', { size: 2.5 }));
  for (const x of [-30, 10, 50]) for (const s of [-1, 1]) lamps.push(lamp([x, deckY + 18, s * 12], WHITE, 'flood', { size: 2.5 }));
  for (const z of [-8, 8]) lamps.push(lamp([AX1 + 0.3, deckY + 14, z], WARM, 'window', { size: 3 }));
  return { g, lamps, foot: 120 };
}
// one fluke of a stockless anchor (the model is built at the origin, shank up)
function hexaFluke(g, z) { fan(g, [[0, -1.6, z * 0.2], [0.5, -1.7, z * 1.5], [0.1, 0.1, z * 1.1]], [0.1, 0.1, 0.11], RUB); fan(g, [[0, -1.6, z * 0.2], [-0.4, -1.7, z * 1.5], [0.1, 0.1, z * 1.1]], [0.08, 0.08, 0.09], RUB); }
