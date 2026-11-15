import { Geo, MAT, add, sub, norm, cross } from '../geo.js';
import { noise3, recolour, seaStain, rod, lerp, clamp, mixc, texQuad } from './marks.js';
import { obox, solid, rng } from './structures.js';

// Vessels at anchor and under way: a committee boat, a sailing yacht with bare poles, a cabin
// cruiser, a rigid inflatable and a container ship. Model space: x forward, y up, z starboard, the
// origin amidships at the waterline (the system floats the model on the sea there, see scenery.js
// and the float mode of mesh.js). Every builder returns { g, lamps, foot } where `foot` is the
// length (m) over which the sea's slope is taken for pitch and roll. Lamps are { p, col, kind }.
// Lens colours and glows are scaled by the darkness level in scenery.js. Colours are linear albedo.

const M = (id, tint = 0, glow = 0) => [id, tint, glow];
const GEL = M(MAT.GELCOAT), RUB = M(MAT.RUBBER), MET = M(MAT.METAL), GLS = M(MAT.GLASS), LIT = M(MAT.LIGHT, 0, 1), NSK = M(MAT.NONSKID), TEAK = M(MAT.TEAK), TEX = M(MAT.TEXTURED);
const TAU = Math.PI * 2;
const lamp = (p, col, kind, extra = {}) => ({ p, col, kind, ...extra });
const WHITE = [1, 0.96, 0.85], RED = [1, 0.06, 0.04], GREEN = [0.05, 1, 0.2], WARM = [1, 0.78, 0.4];

// a small lens: an emissive ball
function ball(g, p, r, col) { solid(g, [[0, -r], [r * 0.7, -r * 0.7], [r, 0], [r * 0.7, r * 0.7], [0, r]], col, LIT, 6, p[0], p[1], p[2]); }

// ---- hulls ------------------------------------------------------------------------------
// A hull from stations along its length. t runs 0 (transom) to 1 (stem). Sections are
// y = keel + (sheer - keel) |u|^p across u in -1..1; p near 1 is a V, near 3 a round bilge.
// bands: [[lo, hi, colour, material], ...] where lo and hi are heights as functions of t, so a
// stripe follows the sheer line. The topmost band should reach the sheer.
function hull(g, S, bandsOf) {
  const { L, B, draft, free, rise = 0.3, p = 2.2, bow = 2.6, bowK = 0.6, keelBow = 0.8, N = 18, nu = 4, sternLift = 0, camber = 0.07, deck = null } = S;
  const x = (t) => -L / 2 + t * L;
  const half = (t) => Math.max((B / 2) * Math.pow(1 - Math.pow(t, bow), bowK), 0.05);
  const ys = (t) => free + rise * Math.pow(t, 2.4) + sternLift * Math.pow(1 - t, 2);
  const yk = (t) => -draft * (1 - keelBow * Math.pow(t, 2));
  const uAt = (t, y) => clamp(Math.pow(clamp((y - yk(t)) / (ys(t) - yk(t)), 0, 1), 1 / p), 0, 1);
  const T = []; for (let i = 0; i <= N; i++) T.push(i === N ? 0.995 : i / N);
  const H = { x, half, ys, yk };
  const bands = bandsOf(H);
  for (const [lo, hi, col, mat] of bands) for (const sg of [-1, 1]) {
    const rings = T.map((t) => {
      const ua = uAt(t, typeof lo === 'function' ? lo(t) : lo, ), ub = uAt(t, typeof hi === 'function' ? hi(t) : hi);
      const pts = [];
      for (let k = 0; k <= nu; k++) {
        const u = lerp(ua, ub, k / nu);
        pts.push([x(t), yk(t) + (ys(t) - yk(t)) * Math.pow(u, p), sg * half(t) * u]);
      }
      return pts;
    });
    g.loft(rings, col, mat, { closed: false, ref: (i) => [x(T[i]), (ys(T[i]) + yk(T[i])) / 2, 0] });
  }
  // transom: a flat plate across the stern
  const ring = [];
  for (let k = 0; k <= 8; k++) { const u = -1 + (k / 8) * 2, a = Math.abs(u); ring.push([x(0), yk(0) + (ys(0) - yk(0)) * Math.pow(a, p), half(0) * u]); }
  const c = ring.reduce((s, q) => add(s, q), [0, 0, 0]).map((v) => v / ring.length);
  g.fan(ring, c, [-1, 0, 0], bands[bands.length - 1][2], bands[bands.length - 1][3]);
  // deck, with a little camber
  if (deck) {
    const pts = [];
    for (let i = 0; i <= N; i++) {
      const t = T[i], row = [];
      for (let k = 0; k <= 6; k++) { const u = -1 + (k / 6) * 2; row.push([x(t), ys(t) + camber * (1 - u * u) * Math.min(half(t), 1.5), half(t) * u * 0.985]); }
      pts.push(row);
    }
    g.grid(pts, deck[0], deck[1], (P) => [P[0], P[1] - 6, P[2]]);
  }
  return H;
}

// a closed rounded section: half width w at the base, wt at the top, radius r on the top corners
function section(x, y0, y1, w, wt, r) {
  const P = (z, y) => [x, y, z];
  const arc = (cz, cy, a0, a1, n = 3) => Array.from({ length: n }, (_, k) => { const a = lerp(a0, a1, k / (n - 1)); return P(cz + r * Math.cos(a), cy + r * Math.sin(a)); });
  return [P(-w, y0), P(0, y0), P(w, y0), P((w + wt) / 2, (y0 + y1 - r) / 2), ...arc(wt - r, y1 - r, 0, Math.PI / 2), P(0, y1), ...arc(-wt + r, y1 - r, Math.PI / 2, Math.PI), P(-(w + wt) / 2, (y0 + y1 - r) / 2)];
}
// a lofted superstructure through stations { x, y0, y1, w, wt, r }, closed with flat ends
function cabin(g, st, col, mat) {
  const rings = st.map((s) => section(s.x, s.y0, s.y1, s.w, s.wt ?? s.w, s.r ?? 0.2));
  g.loft(rings, col, mat, { ref: (i) => [st[i].x, (st[i].y0 + st[i].y1) / 2, 0] });
  for (const [r, n] of [[rings[0], [-1, 0, 0]], [rings[rings.length - 1], [1, 0, 0]]]) {
    const c = r.reduce((s, q) => add(s, q), [0, 0, 0]).map((v) => v / r.length);
    g.fan(r, c, n, col, mat);
  }
}
// side windows as dark slabs set just proud of a vertical side at half width w
function windows(g, x0, x1, y, h, w, n, gap = 0.12) {
  const len = (x1 - x0 - gap * (n - 1)) / n;
  for (let k = 0; k < n; k++) {
    const xc = x0 + len / 2 + k * (len + gap);
    for (const s of [-1, 1]) obox(g, [xc, y + h / 2, s * (w + 0.012)], len / 2, h / 2, 0.018, 0, [0.015, 0.02, 0.03], GLS);
  }
}
// stanchions and a lifeline round a deck outline (points in the xz plane at height y)
function lifeline(g, pts, y, h, col = [0.62, 0.64, 0.66], every = 1.2) {
  const line = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(len / every));
    for (let k = 0; k < n; k++) { const f = k / n, px = lerp(a[0], b[0], f), pz = lerp(a[1], b[1], f), yy = y(px, pz); line.push([px, yy + h, pz]); rod(g, [px, yy, pz], [px, yy + h, pz], 0.014, col, MET, 3); }
  }
  const e = pts[pts.length - 1]; line.push([e[0], y(e[0], e[1]) + h, e[1]]);
  g.tube(line, 0.011, col, MET, { segs: 3 });
}

// weathering shared by the hulls: a waterline stain and salt streaks (y is height above the waterline)
function weather(g, seed) {
  recolour(g, (p, n, c, mid) => {
    if (mid !== MAT.GELCOAT && mid !== MAT.RUBBER && mid !== MAT.NONSKID && mid !== MAT.TEAK) return c;
    const k = 0.93 + 0.1 * noise3(p[0] * 0.9 + seed, p[1] * 1.5, p[2] * 0.9);
    c = [c[0] * k, c[1] * k, c[2] * k];
    return p[1] < 0.6 && mid === MAT.GELCOAT ? seaStain(c, p, seed, { weedTop: 0.15, tide: 0.2 }) : c;
  });
}

// =========================================================================================
// Sailing yacht at anchor: bare poles
// =========================================================================================
export const YACHT = { length: 10.6, radius: 8, mast: 14.6 };
const HULL_COLOURS = [[0.74, 0.74, 0.7], [0.03, 0.06, 0.16], [0.66, 0.6, 0.45], [0.04, 0.16, 0.1]];
export function yachtGeo(lod = 0, seed = 1) {
  const g = new Geo(), lamps = [], r = rng(seed * 31 + 7);
  const top = HULL_COLOURS[seed % HULL_COLOURS.length], dark = top[0] < 0.2;
  const stripe = dark ? [0.7, 0.7, 0.66] : [0.03, 0.06, 0.2], anti = [0.12, 0.13, 0.2];
  const S = { L: 10.6, B: 3.4, draft: 1.2, free: 0.95, rise: 0.4, p: 2.4, bow: 2.2, bowK: 0.62, keelBow: 0.85, N: lod ? 8 : 16, nu: lod ? 2 : 4, deck: [[0.42, 0.3, 0.17], TEAK], sternLift: 0.05 };
  const H = hull(g, S, (H) => [[-9, 0.0, anti, GEL], [0.0, 0.1, [0.78, 0.78, 0.76], GEL], [0.1, (t) => H.ys(t) - 0.36, top, GEL], [(t) => H.ys(t) - 0.36, (t) => H.ys(t) - 0.2, stripe, GEL], [(t) => H.ys(t) - 0.2, (t) => H.ys(t), top, GEL]]);
  const dy = (x, z) => H.ys((x + S.L / 2) / S.L);
  // coachroof and cockpit coaming
  cabin(g, [{ x: -2.5, y0: 0.9, y1: 1.45, w: 0.9, wt: 0.75, r: 0.2 }, { x: -1.6, y0: 0.9, y1: 1.62, w: 1.25, wt: 0.95, r: 0.25 }, { x: 1.0, y0: 0.9, y1: 1.7, w: 1.3, wt: 0.95, r: 0.25 }, { x: 2.4, y0: 0.9, y1: 1.5, w: 0.9, wt: 0.65, r: 0.2 }], [0.8, 0.79, 0.74], GEL);
  if (!lod) {
    windows(g, -1.5, 1.4, 1.08, 0.38, 1.29, 4, 0.18);
    obox(g, [-2.55, 0.95, 0], 0.03, 0.4, 0.55, 0, [0.02, 0.02, 0.03], GLS);          // companionway
    for (const s of [-1, 1]) obox(g, [-3.5, 0.95, s * 1.22], 0.9, 0.17, 0.06, 0, [0.42, 0.3, 0.17], TEAK);   // cockpit coaming
    obox(g, [-4.6, 0.82, 0], 0.03, 0.2, 1.0, 0, [0.4, 0.28, 0.16], TEAK);
    obox(g, [-3.6, 0.45, 0], 0.62, 0.015, 0.55, 0, [0.18, 0.12, 0.07], TEAK);        // wheel pedestal and wheel
    g.tube(Array.from({ length: 13 }, (_, k) => [-3.9, 1.1 + Math.cos((k / 12) * TAU) * 0.3, Math.sin((k / 12) * TAU) * 0.3]), 0.015, [0.15, 0.1, 0.06], MET, { segs: 3, closed: false });
  }
  // pulpit, stanchions and lifelines
  if (!lod) {
    const hw = (x) => H.half((x + S.L / 2) / S.L) * 0.97;
    for (const s of [-1, 1]) lifeline(g, [[-4.5, s * hw(-4.5)], [-1, s * hw(-1)], [2, s * hw(2)], [4.3, s * hw(4.3)]], dy, 0.62, [0.7, 0.72, 0.74], 1.3);
    rod(g, [4.55, 1.55, -0.3], [4.55, 1.55, 0.3], 0.013, [0.7, 0.72, 0.74], MET, 3);
    // bow roller, anchor and its chain going down to the bottom
    obox(g, [5.0, 1.0, 0], 0.22, 0.04, 0.12, 0, [0.5, 0.5, 0.52], MET);
    obox(g, [5.1, 0.55, 0], 0.12, 0.2, 0.03, 0, [0.2, 0.2, 0.22], MET);
    rod(g, [5.18, 0.95, 0], [8.5, -6, 0], 0.012, [0.08, 0.08, 0.09], MET, 3);
  }
  // spars: a mast with two sets of spreaders, a boom with the mainsail furled in a cover, a furled genoa
  const M0 = [1.0, 0.95, 0], top2 = [1.0, YACHT.mast, 0], al = [0.62, 0.64, 0.66];
  rod(g, M0, top2, 0.075, al, MET, lod ? 4 : 8);
  rod(g, [0.75, 1.9, 0], [-3.7, 1.75, 0], 0.055, al, MET, lod ? 4 : 6);
  const cover = [0.03, 0.06, 0.18];
  rod(g, [0.7, 2.08, 0], [-3.4, 1.95, 0], 0.15, cover, RUB, lod ? 5 : 8);
  rod(g, [4.7, 1.2, 0], [1.05, YACHT.mast - 1.5, 0], 0.09, [0.84, 0.84, 0.8], RUB, lod ? 4 : 6);   // furled genoa on its foil
  if (!lod) {
    for (const [y, l] of [[6.3, 0.95], [10.2, 0.7]]) for (const s of [-1, 1]) rod(g, [1.0, y, 0], [1.0, y + 0.08, s * l], 0.03, al, MET, 4);
    // standing rigging: forestay, backstay, cap shrouds and lowers
    const wire = [0.55, 0.57, 0.6];
    rod(g, [4.55, 1.0, 0], [1.0, YACHT.mast - 0.4, 0], 0.011, wire, MET, 3);
    rod(g, [-5.2, 1.0, 0], [1.0, YACHT.mast - 0.4, 0], 0.011, wire, MET, 3);
    for (const s of [-1, 1]) {
      rod(g, [0.85, 1.0, s * 1.5], [1.0, 6.4, s * 0.95], 0.01, wire, MET, 3);
      rod(g, [1.0, 6.4, s * 0.95], [1.0, 10.3, s * 0.7], 0.01, wire, MET, 3);
      rod(g, [1.0, 10.3, s * 0.7], [1.0, YACHT.mast - 0.5, 0], 0.01, wire, MET, 3);
      rod(g, [0.5, 1.0, s * 1.5], [1.0, 6.3, s * 0.05], 0.009, wire, MET, 3);
    }
    // a masthead unit and the wind vane
    obox(g, [1.0, YACHT.mast + 0.1, 0], 0.07, 0.12, 0.03, 0, [0.1, 0.1, 0.12], MET);
    rod(g, [1.0, YACHT.mast + 0.2, 0], [0.4, YACHT.mast + 0.2, 0], 0.012, [0.7, 0.7, 0.7], MET, 3);
    // winches and a hatch on the foredeck
    for (const s of [-1, 1]) g.lathe([[0.07, 1.62], [0.09, 1.68], [0.07, 1.78]].map(([rr, y]) => [rr, y - 0.34]), [0.7, 0.7, 0.72], MET, 6, -2.2, s * 0.62);
    obox(g, [3.3, 1.07, 0], 0.4, 0.05, 0.36, 0, [0.82, 0.82, 0.78], GEL);
  }
  ball(g, [1.0, YACHT.mast + 0.38, 0], 0.07, WHITE);
  lamps.push(lamp([1.0, YACHT.mast + 0.38, 0], WHITE, 'anchor', { size: 0.5 }));
  // a window glow or two for the saloon
  lamps.push(lamp([0.0, 1.3, 1.3], WARM, 'window', { size: 0.8 }), lamp([0.0, 1.3, -1.3], WARM, 'window', { size: 0.8 }));
  weather(g, seed);
  return { g, lamps, foot: 7 };
}

// =========================================================================================
// Cabin cruiser: a flybridge motor yacht
// =========================================================================================
export const CRUISER = { length: 11.8, radius: 9 };
export function cruiserGeo(lod = 0, seed = 1) {
  const g = new Geo(), lamps = [];
  const white = [0.78, 0.78, 0.75], navy = [0.02, 0.05, 0.14], anti = [0.1, 0.1, 0.13];
  const accent = seed & 1 ? [0.3, 0.03, 0.03] : navy;
  const S = { L: 11.8, B: 3.9, draft: 0.85, free: 1.2, rise: 0.55, p: 1.5, bow: 2.7, bowK: 0.62, keelBow: 0.9, N: lod ? 8 : 16, nu: lod ? 2 : 4, deck: [[0.74, 0.74, 0.7], NSK], sternLift: 0.1 };
  const H = hull(g, S, (H) => [[-9, 0.0, anti, GEL], [0.0, 0.1, white, GEL], [0.1, (t) => H.ys(t) - 0.5, white, GEL], [(t) => H.ys(t) - 0.5, (t) => H.ys(t) - 0.3, accent, GEL], [(t) => H.ys(t) - 0.3, (t) => H.ys(t), white, GEL]]);
  // saloon, sloping windscreen, flybridge
  cabin(g, [{ x: -3.7, y0: 1.2, y1: 3.0, w: 1.62, wt: 1.45, r: 0.3 }, { x: -3.0, y0: 1.2, y1: 3.12, w: 1.7, wt: 1.45, r: 0.3 }, { x: 0.6, y0: 1.2, y1: 3.12, w: 1.7, wt: 1.45, r: 0.3 }, { x: 1.8, y0: 1.2, y1: 2.7, w: 1.45, wt: 1.1, r: 0.25 }, { x: 2.7, y0: 1.2, y1: 2.2, w: 1.1, wt: 0.8, r: 0.2 }], white, GEL);
  cabin(g, [{ x: -2.1, y0: 3.0, y1: 3.45, w: 1.4, wt: 1.3, r: 0.1 }, { x: 0.6, y0: 3.0, y1: 3.6, w: 1.5, wt: 1.35, r: 0.2 }, { x: 1.2, y0: 3.0, y1: 3.45, w: 1.4, wt: 1.2, r: 0.2 }], white, GEL);
  if (!lod) {
    windows(g, -3.0, 0.5, 1.8, 0.7, 1.72, 4, 0.2);
    // windscreen glass on the slope and the flybridge screen
    const sl = (x0, y0, x1, y1, w) => g.quad([x0, y0, -w], [x0, y0, w], [x1, y1, w], [x1, y1, -w], [0.015, 0.02, 0.03], GLS, norm([y1 - y0, x0 - x1, 0]));
    sl(0.66, 3.1, 1.75, 2.72, 1.3);
    // flybridge: a console, a seat, a screen, rails
    obox(g, [0.3, 3.9, 0], 0.3, 0.3, 0.55, 0, [0.7, 0.7, 0.67], GEL);
    obox(g, [-0.9, 3.8, 0], 0.4, 0.2, 0.75, 0, [0.88, 0.88, 0.85], RUB);
    g.quad([0.62, 3.55, -1.15], [0.62, 3.55, 1.15], [0.55, 4.25, 1.15], [0.55, 4.25, -1.15], [0.015, 0.02, 0.03], GLS, [1, 0, 0]);
    // radar arch with a dome and an antenna
    for (const s of [-1, 1]) rod(g, [-2.2, 3.4, s * 1.2], [-2.0, 4.5, s * 1.1], 0.045, white, GEL, 5);
    g.tube([[-2.0, 4.5, -1.1], [-1.9, 4.65, 0], [-2.0, 4.5, 1.1]], 0.05, white, GEL, { segs: 5 });
    solid(g, [[0.28, 4.7], [0.28, 4.88], [0.22, 5.02], [0.0, 5.08]], [0.85, 0.85, 0.82], GEL, 10, -1.9, 0, 0);
    rod(g, [-2.0, 4.65, 0.5], [-1.95, 5.8, 0.5], 0.012, [0.3, 0.3, 0.3], MET, 3);
    // the foredeck: rails, an anchor and a hatch; the swim platform and ladder
    const hw = (x) => H.half((x + S.L / 2) / S.L) * 0.96;
    const dy = (x) => H.ys((x + S.L / 2) / S.L);
    for (const s of [-1, 1]) lifeline(g, [[-4.1, s * hw(-4.1)], [-1.5, s * hw(-1.5)], [2.5, s * hw(2.5)], [5.2, s * hw(5.2)]], dy, 0.55, [0.75, 0.77, 0.78], 1.4);
    obox(g, [-6.1, 0.42, 0], 0.45, 0.05, 1.5, 0, [0.7, 0.7, 0.66], NSK);
    for (const s of [-1, 1]) rod(g, [-6.4, 0.5, s * 0.7], [-6.4, 1.3, s * 0.7], 0.02, [0.7, 0.72, 0.74], MET, 4);
    rod(g, [5.0, 1.55, 0], [8.0, -5, 0], 0.012, [0.08, 0.08, 0.09], MET, 3);
    obox(g, [5.0, 1.45, 0], 0.2, 0.04, 0.12, 0, [0.5, 0.5, 0.52], MET);
    // fenders hung along both sides
    for (const s of [-1, 1]) for (const x of [-2.5, -0.5, 1.5]) solid(g, [[0.0, -0.4], [0.1, -0.35], [0.12, -0.2], [0.12, 0.2], [0.1, 0.35], [0.0, 0.4]], [0.04, 0.1, 0.4], RUB, 6, x, 0.55, s * (hw(x) + 0.1));
    // engine trunk hatch aft
    obox(g, [-4.8, 1.3, 0], 0.6, 0.04, 0.8, 0, [0.72, 0.72, 0.68], GEL);
  }
  rod(g, [-0.9, 3.9, 1.3], [-0.9, 5.3, 1.3], 0.02, [0.75, 0.75, 0.78], MET, 3);
  ball(g, [-1.9, 5.85, 0.5], 0.08, WHITE);
  lamps.push(lamp([-1.9, 5.85, 0.5], WHITE, 'anchor', { size: 0.5 }));
  lamps.push(lamp([-1.4, 1.9, 1.72], WARM, 'window', { size: 0.9 }), lamp([-1.4, 1.9, -1.72], WARM, 'window', { size: 0.9 }), lamp([0.3, 3.7, 0], WARM, 'window', { size: 0.5 }));
  weather(g, seed);
  return { g, lamps, foot: 8 };
}

// =========================================================================================
// Rigid inflatable boat with a centre console and an outboard
// =========================================================================================
export const RIB = { length: 6.8, radius: 5 };
export function ribGeo(lod = 0, seed = 1) {
  const g = new Geo(), lamps = [];
  const tubeCol = seed & 1 ? [0.5, 0.17, 0.03] : [0.09, 0.1, 0.11], floor = [0.62, 0.62, 0.6], grp = [0.7, 0.7, 0.68];
  const S = { L: 6.6, B: 2.1, draft: 0.28, free: 0.55, rise: 0.15, p: 1.4, bow: 2.2, bowK: 0.6, keelBow: 0.7, N: lod ? 6 : 12, nu: lod ? 2 : 3, deck: [floor, NSK], camber: 0.01 };
  const H = hull(g, S, (H) => [[-9, 0.05, [0.12, 0.12, 0.15], GEL], [0.05, (t) => H.ys(t), grp, GEL]]);
  // sponsons: a tube along each side that narrows to meet its twin at the bow
  const path = [[-3.1, 0.96, 0.3], [-1.8, 1.03, 0.3], [0, 1.03, 0.3], [1.5, 0.95, 0.29], [2.5, 0.64, 0.25], [3.15, 0.2, 0.17], [3.3, 0.05, 0.12]];
  const ns = lod ? 5 : 10;
  for (const sg of [-1, 1]) {
    const rings = path.map(([x, z, rr], i) => {
      const y = 0.62 + (i > 3 ? (i - 3) * 0.02 : 0);
      return Array.from({ length: ns }, (_, k) => { const a = (k / ns) * TAU; return [x, y + Math.sin(a) * rr * 1.0, sg * (z + Math.cos(a) * rr * 0.92 - (i === 0 ? 0 : 0))]; });
    });
    g.loft(rings, tubeCol, RUB, { ref: (i) => [path[i][0], 0.62, sg * path[i][1]] });
    // a flat end cap at the transom
    g.fan(rings[0], [path[0][0], 0.62, sg * path[0][1]], [-1, 0, 0], tubeCol, RUB);
  }
  if (!lod) {
    // grab line along each tube, bow towing eye, console, windscreen and wheel, a jockey seat
    for (const sg of [-1, 1]) g.tube(path.slice(0, 6).map(([x, z, rr]) => [x, 0.62 + rr * 0.7, sg * (z - rr * 0.6)]), 0.014, [0.02, 0.02, 0.02], RUB, { segs: 3 });
    obox(g, [-0.1, 0.62, 0], 0.4, 0.4, 0.3, 0, grp, GEL);
    g.quad([0.2, 1.0, -0.3], [0.2, 1.0, 0.3], [0.1, 1.45, 0.3], [0.1, 1.45, -0.3], [0.015, 0.02, 0.03], GLS, [0.97, 0.23, 0]);
    g.tube(Array.from({ length: 13 }, (_, k) => [0.15, 1.05 + Math.cos((k / 12) * TAU) * 0.15, Math.sin((k / 12) * TAU) * 0.15]), 0.012, [0.1, 0.1, 0.1], RUB, { segs: 3 });
    obox(g, [-1.1, 0.78, 0], 0.32, 0.18, 0.2, 0, [0.08, 0.08, 0.09], RUB);
    obox(g, [-1.1, 0.78, 0], 0.1, 0.18, 0.5, 0, [0.08, 0.08, 0.09], RUB);
    // outboard on the transom: cowling, leg and cavitation plate
    obox(g, [-3.35, 1.0, 0], 0.25, 0.38, 0.22, 0, [0.7, 0.72, 0.74], GEL);
    obox(g, [-3.45, 0.2, 0], 0.12, 0.6, 0.1, 0, [0.5, 0.52, 0.55], MET);
    obox(g, [-3.45, -0.38, 0], 0.3, 0.03, 0.14, 0, [0.5, 0.52, 0.55], MET);
    obox(g, [-3.5, -0.55, 0], 0.1, 0.14, 0.07, 0, [0.45, 0.47, 0.5], MET);
    rod(g, [-1.1, 0.9, 0.5], [-1.1, 2.0, 0.5], 0.015, [0.5, 0.5, 0.5], MET, 3);
  }
  ball(g, [-1.1, 2.05, 0.5], 0.05, WHITE);
  lamps.push(lamp([-1.1, 2.05, 0.5], WHITE, 'anchor', { size: 0.3 }));
  weather(g, seed);
  return { g, lamps, foot: 4.5 };
}

// =========================================================================================
// Committee boat: a 13 m work boat with a signal mast, flags and a sign
// =========================================================================================
export const COMMITTEE = { length: 13.4, radius: 10, sign: [4.4, 0.95] };
function flag(g, p, w, h, cols, sg = 1) {
  const n = cols.length;
  for (let k = 0; k < n; k++) {
    const x0 = p[0] + (w * k) / n, x1 = p[0] + (w * (k + 1)) / n, sag = (x) => -0.05 * Math.sin(((x - p[0]) / w) * Math.PI * 2);
    g.quad([x0, p[1], p[2] + sag(x0)], [x1, p[1], p[2] + sag(x1)], [x1, p[1] - h, p[2] + sag(x1)], [x0, p[1] - h, p[2] + sag(x0)], cols[k], RUB, [0, 0, sg]);
    g.quad([x1, p[1], p[2] + sag(x1)], [x0, p[1], p[2] + sag(x0)], [x0, p[1] - h, p[2] + sag(x0)], [x1, p[1] - h, p[2] + sag(x1)], cols[k], RUB, [0, 0, -sg]);
  }
}
export function committeeGeo(lod = 0, seed = 1) {
  const g = new Geo(), lamps = [];
  const navy = [0.02, 0.05, 0.14], white = [0.78, 0.78, 0.75], orange = [0.7, 0.2, 0.03], anti = [0.28, 0.04, 0.03];
  const S = { L: 13.4, B: 4.3, draft: 0.95, free: 1.4, rise: 0.7, p: 1.9, bow: 3.0, bowK: 0.55, keelBow: 0.85, N: lod ? 8 : 16, nu: lod ? 2 : 4, deck: [[0.55, 0.57, 0.56], NSK], sternLift: 0.1 };
  const H = hull(g, S, (H) => [[-9, 0.0, anti, GEL], [0.0, 0.12, white, GEL], [0.12, (t) => H.ys(t) - 0.42, navy, GEL], [(t) => H.ys(t) - 0.42, (t) => H.ys(t) - 0.2, orange, GEL], [(t) => H.ys(t) - 0.2, (t) => H.ys(t), navy, GEL]]);
  // wheelhouse forward of amidships with a roof deck; open working deck aft
  cabin(g, [{ x: -1.2, y0: 1.4, y1: 3.7, w: 1.75, wt: 1.7, r: 0.15 }, { x: 3.0, y0: 1.4, y1: 3.7, w: 1.75, wt: 1.7, r: 0.15 }, { x: 3.7, y0: 1.4, y1: 3.2, w: 1.4, wt: 1.3, r: 0.12 }], white, GEL);
  g.box(-1.3, 3.2, 3.7, 3.82, -1.95, 1.95, [0.55, 0.57, 0.56], NSK);
  if (!lod) {
    windows(g, -0.8, 2.6, 2.55, 0.8, 1.76, 3, 0.35);
    g.quad([3.02, 3.55, -1.62], [3.02, 3.55, 1.62], [3.62, 3.15, 1.28], [3.62, 3.15, -1.28], [0.015, 0.02, 0.03], GLS, norm([0.6, 0.4, 0]));
    // the sign boards on each side of the wheelhouse
    for (const s of [-1, 1]) {
      const z = s * 1.77, w = COMMITTEE.sign[0] / 2, h = COMMITTEE.sign[1];
      const [a, b] = s > 0 ? [-w, w] : [w, -w];
      texQuad(g, [0.9 + a, 1.55, z], [0.9 + b, 1.55, z], [0.9 + b, 1.55 + h, z], [0.9 + a, 1.55 + h, z], [1, 1, 1], TEX, [0, 0, s]);
    }
    // railings, a mast with a yardarm, flags and a horn, floodlights
    const dy = (x) => H.ys((x + S.L / 2) / S.L), hw = (x) => H.half((x + S.L / 2) / S.L) * 0.97;
    for (const s of [-1, 1]) lifeline(g, [[-6.4, s * hw(-6.4)], [-3, s * hw(-3)], [-1.2, s * hw(-1.2)]], dy, 0.9, [0.7, 0.72, 0.74], 1.1);
    for (const s of [-1, 1]) lifeline(g, [[3.4, s * hw(3.4)], [5.0, s * hw(5.0)], [6.4, s * hw(6.4) * 0.4]], dy, 0.9, [0.7, 0.72, 0.74], 1.1);
    lifeline(g, [[-6.45, -hw(-6.4)], [-6.45, hw(-6.4)]], dy, 0.9, [0.7, 0.72, 0.74], 1.1);
    for (const s of [-1, 1]) lifeline(g, [[-1.3, s * 1.9], [3.2, s * 1.9]], () => 3.82, 0.9, [0.7, 0.72, 0.74], 1.1);
    lifeline(g, [[-1.3, -1.9], [-1.3, 1.9]], () => 3.82, 0.9, [0.7, 0.72, 0.74], 1.1);
    // mast, yardarm and flags
    rod(g, [0.5, 3.8, 0], [0.5, 9.4, 0], 0.07, [0.72, 0.74, 0.76], MET, 6);
    rod(g, [0.5, 8.0, -1.7], [0.5, 8.0, 1.7], 0.04, [0.72, 0.74, 0.76], MET, 5);
    rod(g, [0.5, 6.6, 0], [-2.8, 4.0, 0], 0.012, [0.3, 0.3, 0.3], MET, 3);
    flag(g, [0.5, 8.0, 1.25], 0.5, 0.45, [[0.05, 0.08, 0.4], [0.7, 0.7, 0.68]], 1);
    flag(g, [0.5, 8.0, 0.55], 0.5, 0.45, [[0.6, 0.04, 0.03], [0.7, 0.7, 0.68], [0.6, 0.04, 0.03]], 1);
    flag(g, [0.5, 8.0, -0.4], 0.5, 0.45, [[0.62, 0.5, 0.04], [0.05, 0.08, 0.4]], 1);
    flag(g, [0.5, 8.0, -1.3], 0.55, 0.45, [[0.04, 0.22, 0.1], [0.7, 0.7, 0.68]], 1);
    flag(g, [0.5, 9.4, 0.05], 0.65, 0.42, [[0.06, 0.07, 0.35], [0.62, 0.62, 0.6], [0.6, 0.04, 0.03]], 1);
    // ensign staff aft and flag
    rod(g, [-6.1, 1.45, 0], [-6.1, 3.8, 0], 0.03, [0.65, 0.65, 0.65], MET, 4);
    flag(g, [-6.1, 3.8, 0.0], 0.8, 0.5, [[0.55, 0.04, 0.03], [0.55, 0.04, 0.03]], 1);
    // roof fittings: a horn, floodlights, a radar, a lifebuoy on the rail
    obox(g, [2.0, 4.0, 0], 0.2, 0.15, 0.3, 0, [0.2, 0.2, 0.22], MET);
    for (const s of [-1, 1]) { obox(g, [2.3, 4.05, s * 1.5], 0.15, 0.12, 0.12, 0, [0.85, 0.85, 0.8], GEL); obox(g, [-0.5, 4.05, s * 1.5], 0.15, 0.12, 0.12, 0, [0.85, 0.85, 0.8], GEL); }
    solid(g, [[0.4, 0.0], [0.4, 0.12], [0.18, 0.12]], [0.7, 0.08, 0.03], RUB, 10, -0.4, 3.9, 1.9);
    // fenders along the hull
    for (const s of [-1, 1]) for (const x of [-4.2, -2, 0.2, 2.4, 4.4]) solid(g, [[0.0, -0.4], [0.12, -0.35], [0.14, -0.2], [0.14, 0.2], [0.12, 0.35], [0.0, 0.4]], [0.6, 0.35, 0.03], RUB, 6, x, 0.6, s * (hw(x) + 0.12));
    // anchor chain
    rod(g, [6.2, 1.5, 0], [10, -6, 0], 0.014, [0.08, 0.08, 0.09], MET, 3);
  }
  rod(g, [0.5, 9.3, 0], [0.5, 9.9, 0], 0.03, [0.7, 0.7, 0.7], MET, 4);
  ball(g, [0.5, 10.0, 0], 0.08, WHITE);
  lamps.push(lamp([0.5, 10.0, 0], WHITE, 'anchor', { size: 0.6 }));
  lamps.push(lamp([2.3, 4.3, 1.5], WHITE, 'flood', { size: 0.8 }), lamp([2.3, 4.3, -1.5], WHITE, 'flood', { size: 0.8 }), lamp([-0.5, 4.3, 1.5], WHITE, 'flood', { size: 0.8 }), lamp([-0.5, 4.3, -1.5], WHITE, 'flood', { size: 0.8 }));
  for (const x of [-0.3, 1.2, 2.3]) lamps.push(lamp([x, 2.9, 1.78], WARM, 'window', { size: 0.9 }), lamp([x, 2.9, -1.78], WARM, 'window', { size: 0.9 }));
  weather(g, seed);
  return { g, lamps, foot: 8 };
}

// =========================================================================================
// Container ship, seen from a few kilometres: only ever far
// =========================================================================================
export const CARGO = { length: 200, radius: 110 };
export function cargoGeo(seed = 1) {
  const g = new Geo(), lamps = [], r = rng(seed * 13 + 5);
  const S = { L: 200, B: 32, draft: 11, free: 13.5, rise: 3.5, p: 3.2, bow: 4.2, bowK: 0.5, keelBow: 0.6, N: 22, nu: 3, deck: [[0.2, 0.08, 0.06], NSK], camber: 0.15 };
  const topside = [0.025, 0.032, 0.06];
  const H = hull(g, S, (H) => [[-14, 0.5, [0.32, 0.05, 0.035], GEL], [0.5, (t) => H.ys(t), topside, GEL]]);
  const deckY = 13.7;
  const hw = (x) => H.half((x + S.L / 2) / S.L);
  // accommodation block, bridge wings and funnel at the stern
  const ax0 = -88, ax1 = -66;
  g.box(ax0, ax1, deckY, deckY + 24, -12.5, 12.5, [0.72, 0.72, 0.7], GEL);
  g.box(ax0 + 2, ax1 - 1, deckY + 24, deckY + 27.5, -16.5, 16.5, [0.72, 0.72, 0.7], GEL);
  const win = [1, 0.8, 0.45];
  for (let k = 0; k < 5; k++) { const y = deckY + 3.5 + k * 4; g.quad([ax1 + 0.02, y, -11], [ax1 + 0.02, y, 11], [ax1 + 0.02, y + 1.5, 11], [ax1 + 0.02, y + 1.5, -11], k < 4 ? [0.2, 0.2, 0.22] : win, k < 4 ? GLS : LIT, [1, 0, 0]); }
  g.quad([ax1 + 0.02 - 1, deckY + 25.0, -16.4], [ax1 + 0.02 - 1, deckY + 25.0, 16.4], [ax1 - 1 + 0.02, deckY + 26.6, 16.4], [ax1 - 1 + 0.02, deckY + 26.6, -16.4], win, LIT, [1, 0, 0]);
  const funnel = [[-82, deckY + 24], [-72, deckY + 24]];
  g.box(-86.5, -76, deckY + 24, deckY + 34, -5, 5, [0.55, 0.05, 0.04], GEL);
  g.box(-86.5, -76, deckY + 31, deckY + 33, -5.05, 5.05, [0.75, 0.75, 0.72], GEL);
  void funnel;
  rod(g, [-72, deckY + 27.5, 0], [-72, deckY + 41, 0], 0.5, [0.6, 0.6, 0.6], MET, 5);
  // containers: bays of stacks across the deck; each stack is two colour runs
  const COL = [[0.5, 0.06, 0.04], [0.04, 0.12, 0.35], [0.5, 0.35, 0.04], [0.06, 0.28, 0.12], [0.55, 0.55, 0.53], [0.3, 0.12, 0.06], [0.08, 0.3, 0.38], [0.55, 0.22, 0.04]];
  for (let bay = 0; bay < 11; bay++) {
    const x0 = -60 + bay * 12.6, x1 = x0 + 12.2;
    const hwm = hw((x0 + x1) / 2) - 1.5;
    const cols = Math.max(2, Math.floor((2 * hwm) / 2.6));
    const wc = (2 * hwm) / cols;
    const maxT = bay > 8 ? 3 : 6;
    for (let c = 0; c < cols; c++) {
      const z0 = -hwm + c * wc, tiers = 2 + Math.floor(r() * (maxT - 1));
      const lowT = 1 + Math.floor(r() * (tiers - 0.5)), ca = COL[Math.floor(r() * COL.length)], cb = COL[Math.floor(r() * COL.length)];
      const yA = deckY + 0.3 + lowT * 2.6, yB = deckY + 0.3 + tiers * 2.6;
      g.box(x0, x1, deckY + 0.3, yA, z0 + 0.06, z0 + wc - 0.06, ca, RUB);
      if (yB > yA + 0.1) g.box(x0, x1, yA, yB, z0 + 0.06, z0 + wc - 0.06, cb, RUB);
    }
  }
  // forecastle: mooring gear, a mast with a light, bulwarks
  g.box(78, 96, deckY, deckY + 1.5, -9, 9, [0.2, 0.08, 0.06], RUB);
  g.box(80, 84, deckY + 1.5, deckY + 4.5, -2, 2, [0.5, 0.5, 0.48], GEL);
  rod(g, [72, deckY, 0], [72, deckY + 26, 0], 0.4, [0.7, 0.7, 0.7], MET, 5);
  rod(g, [72, deckY + 20, -4], [72, deckY + 20, 4], 0.25, [0.7, 0.7, 0.7], MET, 4);
  ball(g, [72, deckY + 26.4, 0], 0.5, WHITE);
  ball(g, [-72, deckY + 41.4, 0], 0.5, WHITE);
  lamps.push(lamp([72, deckY + 26.4, 0], WHITE, 'anchor', { size: 3 }), lamp([-72, deckY + 41.4, 0], WHITE, 'anchor', { size: 3 }));
  ball(g, [-70, deckY + 24.5, -16.6], 0.5, RED); ball(g, [-70, deckY + 24.5, 16.6], 0.5, GREEN);
  lamps.push(lamp([-70, deckY + 27.9, -16.6], RED, 'nav', { size: 3 }), lamp([-70, deckY + 27.9, 16.6], GREEN, 'nav', { size: 3 }));
  lamps.push(lamp([-99.5, deckY + 3, 0], WHITE, 'nav', { size: 2.5 }));
  for (const x of [-30, 10, 50]) for (const s of [-1, 1]) lamps.push(lamp([x, deckY + 18, s * 12], WHITE, 'flood', { size: 2.5 }));
  for (const [x, z] of [[-87, -8], [-87, 8]]) lamps.push(lamp([x, deckY + 28, z], WARM, 'window', { size: 3 }));
  recolour(g, (p, n, c, mid) => { const k = 0.9 + 0.2 * noise3(p[0] * 0.2 + seed, p[1] * 0.4, p[2] * 0.2); return [c[0] * k, c[1] * k, c[2] * k]; });
  return { g, lamps, foot: 120 };
}
