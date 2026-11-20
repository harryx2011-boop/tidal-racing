// Small craft for the moorings and the hard: open boats (rowing and outboard), a day boat with a cuddy, and the
// buoys they lie to. Model space as the vessels': x forward, y up, z starboard, y = 0 the waterline, so the
// mesh pass floats them like the anchored boats (float mode 1; `foot` is the length their trim is taken over).
// Built with the kit, weathered like the other hulls (a wet band, weed at the waterline, salt above it).
//
// Triangles (near / middle / far): open boat 3.4k / 0.8k / 0.15k, day boat 4.2k / 1.0k / 0.2k, buoy 0.4k / 0.1k / 30.
import { Geo, GEL, RUB, MET, GLS, NSK, GRAIN, CLOTH, rng, lerp, smooth, loft, tube, rod, box, slab, lathe, quad, blob, hoop, fender, mark, paint, xf, frame, both, mottle, stain, faded, mixc, scl } from './kit.js';
import { crewGeo } from './wildlife.js';

const HULLS = [[0.78, 0.79, 0.76], [0.1, 0.2, 0.42], [0.55, 0.08, 0.06], [0.07, 0.3, 0.2], [0.75, 0.6, 0.12], [0.16, 0.17, 0.19], [0.5, 0.62, 0.7]];
const TIMBER = [0.3, 0.19, 0.09], OLD = [0.33, 0.31, 0.27];
const hullPaint = (seed, wet = 0.1) => both(mottle(seed, 0.07, 1.4), faded(seed, 0.25), stain(seed, { weedTop: 0.05, tide: 0.09, wet, salt: 0.15 }));

// the hull's section at station u (0 transom .. 1 stem): half breadth, sheer height, keel depth
function hullShape(L, B, D) {
  return (u) => {
    const b = B * (0.5 * (0.72 + 0.28 * smooth(0, 0.3, u)) * Math.pow(Math.max(1 - Math.pow(Math.max(u - 0.42, 0) / 0.58, 2.3), 0), 0.62));
    const sheer = D * (0.78 + 0.1 * (1 - u) * (1 - u) + 0.38 * u * u);
    const keel = -0.24 * (1 - 0.75 * Math.pow(u, 3)) * (0.75 + 0.25 * smooth(0, 0.2, u));
    return [b, sheer, keel];
  };
}
// one side-to-side ring of the hull at x: n points from the port gunwale round the keel to the starboard one
function ring(x, b, sheer, keel, n, inset = 0) {
  const out = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n * 2 - 1, a = Math.abs(t);                     // -1 port gunwale .. 0 keel .. 1 starboard
    // the turn of the bilge: fairly flat floors, then up to the sheer
    const z = Math.sign(t) * (b - inset) * Math.pow(a, 0.62);
    const y = lerp(keel + inset, sheer, Math.pow(a, 2.6));
    out.push([x, y, z]);
  }
  return out;
}

// An open boat 3.8 to 5 m long. seed picks its length, colours, whether it rows or has an outboard, a cover, and
// (crew > 0) who sits in it.
export function openBoatGeo(lod = 0, seed = 1, opt = {}) {
  const R = rng(seed * 331 + 7), g = new Geo(lod ? 2048 : 8192);
  const L = 3.9 + 1.1 * R(), B = 1.5 + 0.3 * R(), D = 0.62;
  const hc = HULLS[Math.floor(R() * HULLS.length)], strake = R() < 0.5 ? [0.8, 0.8, 0.76] : HULLS[Math.floor(R() * HULLS.length)];
  const inside = R() < 0.5 ? [0.62, 0.63, 0.6] : mixc(hc, [0.6, 0.6, 0.58], 0.6);
  const outboard = opt.outboard ?? R() < 0.6, cover = opt.cover ?? R() < 0.18, clinker = R() < 0.6;
  const S = hullShape(L, B, D), NS = [14, 7, 4][lod], NR = [12, 6, 4][lod];
  const xs = (u) => (u - 0.5) * L;
  const paintHull = hullPaint(seed);
  const rings = [], inner = [];
  for (let i = 0; i <= NS; i++) {
    const u = i / NS, [b, sh, k] = S(u);
    rings.push(ring(xs(u) + (u > 0.98 ? 0.06 : 0), Math.max(b, 0.012), sh, k, NR));
    inner.push(ring(xs(Math.min(u, 0.985)), Math.max(b - 0.03, 0.006), sh, k + 0.05, NR, 0.035));
  }
  // outside: the planking shows as strakes (clinker laps darken their lower edges), a contrasting sheer strake
  const strakes = (P, N, C, i) => {
    const u = clamp01((P[i] / L) + 0.5), [, sh, k] = S(u), t = (P[i + 1] - k) / (sh - k);
    if (t > 0.8) { C[i] = strake[0]; C[i + 1] = strake[1]; C[i + 2] = strake[2]; }
    else if (clinker && lod === 0) { const f = (t * 6) % 1; const d = 1 - 0.22 * (1 - smooth(0, 0.22, f)); C[i] *= d; C[i + 1] *= d; C[i + 2] *= d; }
    paintHull(P, N, C, i);
  };
  loft(g, rings, hc, GEL, { closed: false, paint: strakes });
  loft(g, inner.slice().reverse(), inside, NSK, { closed: false, paint: mottle(seed + 3, 0.1, 2) });
  // transom
  { const r0 = rings[0], n = r0.length; for (let k = 0; k < n - 1; k++) quad(g, r0[k], r0[k + 1], [r0[k + 1][0], Math.max(r0[k + 1][1], S(0)[1]), r0[k + 1][2]], [r0[k][0], Math.max(r0[k][1], S(0)[1]), r0[k][2]], hc, GEL, { paint: paintHull }); }
  // gunwales and the rubbing strake
  const sheerL = (side, dy = 0, dz = 0) => { const out = []; for (let i = 0; i <= NS; i++) { const u = i / NS, [b, sh] = S(u); out.push([xs(u), sh + dy, side * (Math.max(b, 0.012) + dz)]); } return out; };
  for (const side of [-1, 1]) tube(g, sheerL(side, 0.012, 0.0), lod ? 0.03 : 0.028, TIMBER, GRAIN, { segs: lod ? 4 : 6 });
  if (!cover) {
    // thwarts, a stern sheet, floorboards
    const thw = [0.3, 0.52, 0.76];
    for (const u of thw) { const [b, sh] = S(u); slab(g, xs(u) - 0.11, xs(u) + 0.11, sh - 0.2, sh - 0.165, -(b - 0.04), b - 0.04, OLD, GRAIN, { paint: mottle(seed + u * 9, 0.15, 3) }); }
    { const [b, sh] = S(0.06); slab(g, xs(0) + 0.02, xs(0.13), sh - 0.2, sh - 0.165, -(b - 0.05), b - 0.05, OLD, GRAIN); }
    if (lod === 0) for (let k = -2; k <= 2; k++) slab(g, xs(0.14), xs(0.74), -0.11, -0.09, k * 0.17 - 0.07, k * 0.17 + 0.07, scl(OLD, 0.85), GRAIN, { paint: mottle(seed + k, 0.18, 4) });
    else slab(g, xs(0.14), xs(0.74), -0.11, -0.09, -0.42, 0.42, scl(OLD, 0.8), GRAIN);
    // gear: a fish box, a fuel can or a bucket, a coil of line
    if (lod < 2) {
      const bx = xs(0.63), fc = [[0.1, 0.25, 0.6], [0.6, 0.1, 0.08], [0.75, 0.6, 0.1]][Math.floor(R() * 3)];
      box(g, [bx, 0.05, 0.12], 0.36, 0.13, 0.22, fc, RUB, { top: [0.03, 0.03, 0.035] });
      if (outboard) box(g, [xs(0.2), 0.07, -0.3], 0.16, 0.15, 0.11, [0.62, 0.08, 0.05], RUB);
      else lathe(g, [[0.1, 0], [0.13, 0.24], [0.12, 0.24], [0.09, 0.02]], [0.1, 0.1, 0.12], RUB, { segs: 8, at: [xs(0.22), -0.09, 0.3] });
    }
    if (!outboard && lod < 2) {
      // oars shipped along the thwarts
      for (const side of [-1, 1]) { const z = side * 0.38, y = S(0.5)[1] - 0.14; rod(g, [xs(0.2), y, z], [xs(0.86), y + 0.03, z * 0.7], 0.022, [0.5, 0.36, 0.18], GRAIN, lod ? 3 : 5); slab(g, xs(0.08), xs(0.22), y - 0.012, y + 0.012, z - 0.07, z + 0.07, [0.5, 0.36, 0.18], GRAIN); }
    }
  } else {
    // a cover laced over the gunwales, sagging between them
    const cc = [[0.08, 0.2, 0.42], [0.1, 0.3, 0.2], [0.35, 0.33, 0.3]][Math.floor(R() * 3)], cv = [];
    for (let i = 0; i <= NS; i++) { const u = i / NS, [b, sh] = S(u), row = []; for (let k = 0; k <= 6; k++) { const t = k / 6 * 2 - 1; row.push([xs(u), sh + 0.03 + 0.16 * (1 - t * t) * (0.6 + 0.4 * Math.sin(u * 9 + seed)), t * Math.max(b, 0.012) * 1.02]); } cv.push(row); }
    loft(g, cv, cc, CLOTH, { closed: false, paint: both(mottle(seed, 0.12, 2.5), faded(seed + 2, 0.4)) });
  }
  if (outboard) {
    // a small outboard tilted up on the transom
    const s0 = mark(g), oc = R() < 0.5 ? [0.08, 0.09, 0.1] : [0.6, 0.62, 0.62];
    box(g, [0, 0.42, 0], 0.2, 0.13, 0.13, oc, GEL);
    box(g, [0.02, 0.12, 0], 0.06, 0.2, 0.05, [0.2, 0.21, 0.22], MET);
    if (lod < 2) { box(g, [0.06, -0.18, 0], 0.05, 0.14, 0.03, [0.2, 0.21, 0.22], MET); lathe(g, [[0.0, -0.1], [0.07, -0.03], [0.07, 0.03], [0.0, 0.08]], [0.25, 0.26, 0.27], MET, { segs: 6, axis: 'x', at: [0.1, -0.3, 0] }); rod(g, [-0.12, 0.42, 0], [-0.5, 0.5, 0.04], 0.016, [0.05, 0.05, 0.05], RUB, 4); }
    xf(g, s0, frame([xs(0) - 0.14, S(0)[1] - 0.12, 0], Math.PI, 0.55, 0));
  }
  if (lod < 2) {
    // the mooring pennant from the stem down into the water, a ring in the stem, two fenders over the side
    const [, shB] = S(1);
    tube(g, [[xs(1) + 0.02, shB - 0.06, 0], [xs(1) + 0.5, shB - 0.45, 0.03], [xs(1) + 1.1, -0.1, 0.05], [xs(1) + 1.5, -0.6, 0.06]], 0.014, [0.5, 0.46, 0.34], CLOTH, { segs: lod ? 3 : 4 });
    for (const [u, side] of [[0.4, 1], [0.66, -1]]) { const [b, sh] = S(u); fender(g, [xs(u), sh - 0.42, side * (b + 0.1)], [xs(u), sh, side * b], 0.09, 0.42, [0.82, 0.82, 0.78], lod); }
  }
  // someone aboard
  if (opt.crew && lod < 2 && !cover) {
    const [, sh] = S(0.3);
    const people = [{ x: xs(0.3), y: sh - 0.66, z: 0.05, yaw: 0, pal: (seed * 3) % 10, skin: seed % 4, pose: opt.crew === 2 ? 'mug' : 'sit' }];
    const c = crewGeo(people, 0, { lod });
    g.reserve(c.nv); g.P.set(c.p, g.nv * 3); g.N.set(c.n, g.nv * 3); g.C.set(c.c, g.nv * 3); g.M.set(c.m, g.nv * 3); g.U.set(c.uv, g.nv * 2); g.nv += c.nv;
  }
  return { g, lamps: [], foot: L * 0.75, L, B };
}
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

// A day boat: a 5.6 m hull with a cuddy forward, a screen, and an outboard on a bracket
export function dayBoatGeo(lod = 0, seed = 1) {
  const R = rng(seed * 517 + 3), g = new Geo(lod ? 2048 : 8192);
  const L = 5.4 + 0.6 * R(), B = 2.05, D = 0.82;
  const hc = HULLS[Math.floor(R() * HULLS.length)], top = [0.8, 0.8, 0.77], trim = HULLS[Math.floor(R() * HULLS.length)];
  const S = hullShape(L, B, D), NS = [14, 7, 4][lod], NR = [12, 6, 4][lod], xs = (u) => (u - 0.5) * L, paintHull = hullPaint(seed, 0.12);
  const rings = [];
  for (let i = 0; i <= NS; i++) { const u = i / NS, [b, sh, k] = S(u); rings.push(ring(xs(u), Math.max(b, 0.012), sh, k * 1.15, NR)); }
  loft(g, rings, hc, GEL, { closed: false, paint: (P, N, C, i) => { const u = clamp01(P[i] / L + 0.5), [, sh] = S(u); if (P[i + 1] > sh - 0.1) { C[i] = trim[0]; C[i + 1] = trim[1]; C[i + 2] = trim[2]; } paintHull(P, N, C, i); } });
  { const r0 = rings[0], n = r0.length; for (let k = 0; k < n - 1; k++) quad(g, r0[k], r0[k + 1], [r0[k + 1][0], S(0)[1], r0[k + 1][2]], [r0[k][0], S(0)[1], r0[k][2]], hc, GEL, { paint: paintHull }); }
  // deck: a foredeck over the cuddy, side decks, a cockpit sole
  const deckRing = (u, y) => { const [b] = S(u); return [[xs(u), y, -Math.max(b, 0.012)], [xs(u), y, Math.max(b, 0.012)]]; };
  const dk = []; for (let i = 0; i <= NS; i++) { const u = i / NS; dk.push(deckRing(u, u > 0.5 ? S(u)[1] : 0.02)); }
  loft(g, dk, top, NSK, { closed: false, paint: mottle(seed + 5, 0.08, 2) });
  // cockpit coamings (the hull's inside, simply)
  for (const side of [-1, 1]) { const pts = []; for (let i = 0; i <= NS / 2; i++) { const u = i / NS, [b, sh] = S(u); pts.push([[xs(u), 0.02, side * (b - 0.04)], [xs(u), sh, side * (b - 0.02)]]); } loft(g, pts, top, GEL, { closed: false }); }
  // the cuddy: a low cabin with a raked front, windows, a screen at its after end
  const c0 = xs(0.5), c1 = xs(0.8), cy = S(0.6)[1], ch = 0.42, cw = (u) => S(u)[0] * 0.74;
  const cab = [];
  for (let k = 0; k <= 4; k++) { const u = lerp(0.5, 0.82, k / 4), w = cw(u), h = ch * (1 - 0.5 * Math.pow(k / 4, 2)); cab.push([[xs(u), cy, -w], [xs(u), cy + h, -w * 0.82], [xs(u), cy + h * 1.06, 0], [xs(u), cy + h, w * 0.82], [xs(u), cy, w]]); }
  loft(g, cab, top, GEL, { closed: false, caps: [true, true], paint: faded(seed, 0.2) });
  if (lod < 2) {
    for (const side of [-1, 1]) for (const [ua, ub] of [[0.54, 0.62], [0.65, 0.72]]) { const wa = cw(ua) * 0.93 + 0.012, wb = cw(ub) * 0.93 + 0.012; quad(g, [xs(ua), cy + 0.12, side * wa], [xs(ub), cy + 0.12, side * wb], [xs(ub), cy + 0.3, side * wb * 0.93], [xs(ua), cy + 0.32, side * wa * 0.93], [0.1, 0.12, 0.14], GLS); }
    // the screen and its frame
    const w = cw(0.5) * 0.86;
    quad(g, [c0 - 0.02, cy + ch + 0.02, -w], [c0 - 0.02, cy + ch + 0.02, w], [c0 - 0.2, cy + ch + 0.5, w * 0.95], [c0 - 0.2, cy + ch + 0.5, -w * 0.95], [0.1, 0.12, 0.14], GLS);
    tube(g, [[c0 - 0.02, cy + ch, -w], [c0 - 0.2, cy + ch + 0.52, -w * 0.95], [c0 - 0.2, cy + ch + 0.52, w * 0.95], [c0 - 0.02, cy + ch, w]], 0.016, [0.7, 0.72, 0.74], MET, { segs: 4 });
    // a helm seat, a wheel
    box(g, [xs(0.36), 0.3, 0.42], 0.2, 0.28, 0.2, [0.75, 0.75, 0.72], RUB);
    hoop(g, [c0 - 0.16, cy + 0.2, 0.42], [1, 0.3, 0], 0.15, 0.014, [0.08, 0.08, 0.09], RUB, 10, 4);
    for (const [u, side] of [[0.3, 1], [0.55, -1], [0.7, 1]]) { const [b, sh] = S(u); fender(g, [xs(u), sh - 0.45, side * (b + 0.1)], [xs(u), sh, side * b], 0.1, 0.46, [0.82, 0.82, 0.78], lod); }
    // pulpit rail at the bow
    const pr = []; for (let k = 0; k <= 6; k++) { const u = lerp(0.8, 1.0, Math.sin(k / 6 * Math.PI)), side = k < 3 ? -1 : 1; pr.push([xs(u), S(u)[1] + 0.42, side * S(u)[0] * 0.9 * (k === 3 ? 0 : 1)]); }
    tube(g, pr, 0.014, [0.72, 0.74, 0.76], MET, { segs: 4 });
    for (const k of [0, 2, 4, 6]) rod(g, [pr[k][0], pr[k][1] - 0.42, pr[k][2]], pr[k], 0.012, [0.72, 0.74, 0.76], MET, 3);
    tube(g, [[xs(1) + 0.02, S(1)[1] - 0.06, 0], [xs(1) + 0.5, S(1)[1] - 0.5, 0.03], [xs(1) + 1.2, -0.1, 0.05], [xs(1) + 1.6, -0.6, 0.06]], 0.015, [0.5, 0.46, 0.34], CLOTH, { segs: 3 });
  }
  // rubbing strake
  for (const side of [-1, 1]) { const pts = []; for (let i = 0; i <= NS; i++) { const u = i / NS, [b, sh] = S(u); pts.push([xs(u), sh - 0.02, side * (Math.max(b, 0.012) + 0.012)]); } tube(g, pts, 0.03, [0.06, 0.06, 0.065], RUB, { segs: lod ? 3 : 5 }); }
  // outboard, down
  { const s0 = mark(g), oc = R() < 0.5 ? [0.08, 0.09, 0.1] : [0.62, 0.64, 0.64];
    box(g, [0, 0.62, 0], 0.26, 0.2, 0.17, oc, GEL); box(g, [0.03, 0.2, 0], 0.08, 0.26, 0.06, [0.2, 0.21, 0.22], MET);
    if (lod < 2) box(g, [0.05, -0.25, 0], 0.07, 0.22, 0.03, [0.2, 0.21, 0.22], MET);
    xf(g, s0, frame([xs(0) - 0.22, 0.25, 0], Math.PI, 0.1, 0)); }
  return { g, lamps: [{ p: [c0 - 0.1, cy + ch + 0.75, 0], col: [1, 0.98, 0.9], kind: 'anchor', size: 0.3 }], foot: L * 0.75, L, B };
}

// a mooring buoy: a ball floating half out, a ring on top, weed below; seed picks its colour
export function mooringBuoyGeo(lod = 0, seed = 1) {
  const g = new Geo(512), c = [[0.85, 0.3, 0.05], [0.85, 0.2, 0.35], [0.8, 0.8, 0.75], [0.8, 0.65, 0.05]][seed % 4], r = 0.26 + 0.05 * (seed % 3);
  const st = both(faded(seed, 0.35), stain(seed, { weedTop: 0.02, tide: 0.05, wet: 0.08, salt: 0.2 }));
  blob(g, [0, 0.04, 0], r, r * 0.95, r, c, GEL, { n: lod ? 4 : 8, segs: lod ? 6 : 12, paint: st });
  if (lod < 2) { hoop(g, [0, r + 0.06, 0], [1, 0, 0], 0.05, 0.012, [0.3, 0.3, 0.3], MET, 8, 4); rod(g, [0, r, 0], [0, r + 0.03, 0], 0.03, [0.3, 0.3, 0.3], MET, 5); }
  return { g, lamps: [], foot: 0 };
}
