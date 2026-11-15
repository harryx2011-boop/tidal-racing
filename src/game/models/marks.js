import { MAT, add, sub, norm, cross } from '../geo.js';
import { Geo, TAU, RUB, MET, GEL, LIT, CLOTH, mat, tube as ktube, rod as krod, lathe, box, quad as kquad, blob, hoop, chain, text, lifering, mark, paint, mixIn, stain, faded, both, vn as kvn, fb as kfb } from './kit.js';

// Course marks other than the lateral buoys: the start/finish gantry (a tower on a pontoon at each
// end of the gate and what spans between them) and the inflatable turn pylon. Model space: y up,
// y = 0 the waterline; the system floats each model on the sea at its origin (see marks.js and the
// float modes of mesh.js). A span model runs along +x from one tower to the other.

export const PORT = [0.62, 0.06, 0.045], STBD = [0.05, 0.36, 0.12];
export const LENS_PORT = [1, 0.06, 0.04], LENS_STBD = [0.06, 1, 0.22];

// ---- small shared helpers (also used by buoy.js) -----------------------------------------
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (x, a, b) => Math.min(Math.max(x, a), b);
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const mixc = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
// smooth value noise in 0..1 and three octaves of it (the kit's: an integer hash, no trigonometry)
export const noise3 = kvn, fbm = kfb;

// Surface of revolution about the y axis from a profile [[r, y], ...] traversed so the outside is
// on the right (up the side, then inward across the top). Normals come from the profile; a point
// repeated twice makes a hard edge, anything else is smooth.
export function revolve(g, prof, col, mat, segs = 24, { flip = false } = {}) {
  const n = prof.length;
  const same = (a, b) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
  const dir = (a, b) => { const dr = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dr, dy) || 1; return [dr / l, dy / l]; };
  const pn = prof.map((p, i) => {
    let t;
    const prev = i > 0 && !same(prof[i - 1], p), next = i < n - 1 && !same(prof[i + 1], p);
    if (prev && next) { const a = dir(prof[i - 1], p), b = dir(p, prof[i + 1]); t = [a[0] + b[0], a[1] + b[1]]; const l = Math.hypot(t[0], t[1]) || 1; t = [t[0] / l, t[1] / l]; }
    else if (prev) t = dir(prof[i - 1], p);
    else if (next) t = dir(p, prof[i + 1]);
    else t = [0, 1];
    return flip ? [-t[1], t[0]] : [t[1], -t[0]];
  });
  const pts = [], nrm = [];
  for (let i = 0; i < n; i++) {
    const pr = [], nr = [];
    for (let j = 0; j <= segs; j++) {
      const a = (j / segs) * 2 * Math.PI, c = Math.cos(a), s = Math.sin(a);
      pr.push([c * prof[i][0], prof[i][1], s * prof[i][0]]);
      nr.push([c * pn[i][0], pn[i][1], s * pn[i][0]]);
    }
    pts.push(pr); nrm.push(nr);
  }
  g.mesh(pts, nrm, col, mat);
}

export const rod = (g, a, b, r, col, mat, segs = 5) => g.tube([a, b], r, col, mat, { segs });

// a quad with its texture coordinates (corners bottom-left, bottom-right, top-right, top-left;
// v = 0 is the top row of the image)
export function texQuad(g, bl, br, tr, tl, col, mat, n) {
  n = n || norm(cross(sub(br, bl), sub(tl, bl)));
  g.tri(bl, br, tr, n, n, n, col, mat, [0, 1], [1, 1], [1, 0]);
  g.tri(bl, tr, tl, n, n, n, col, mat, [0, 1], [1, 0], [0, 0]);
}
// a textured sheet fn(u, v) -> point over nu x nv cells, uv = (u, 1 - v); normals face `toward`'s side
export function texSheet(g, fn, nu, nv, col, mat, face, { u0 = 0, u1 = 1, v0 = 0, v1 = 1 } = {}) {
  const e = 1e-3;
  const P = [], N = [];
  for (let i = 0; i <= nu; i++) { P.push([]); N.push([]); for (let j = 0; j <= nv; j++) {
    const u = lerp(u0, u1, i / nu), v = lerp(v0, v1, j / nv);
    P[i].push(fn(u, v));
    let n = norm(cross(sub(fn(Math.min(u + e, u1), v), fn(Math.max(u - e, u0), v)), sub(fn(u, Math.min(v + e, v1)), fn(u, Math.max(v - e, v0)))));
    if (n[0] * face[0] + n[1] * face[1] + n[2] * face[2] < 0) n = [-n[0], -n[1], -n[2]];
    N[i].push(n);
  } }
  const uv = (i, j) => [i / nu, j / nv];
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    g.tri(P[i][j], P[i + 1][j], P[i + 1][j + 1], N[i][j], N[i + 1][j], N[i + 1][j + 1], col, mat, uv(i, j), uv(i + 1, j), uv(i + 1, j + 1));
    g.tri(P[i][j], P[i + 1][j + 1], P[i][j + 1], N[i][j], N[i + 1][j + 1], N[i][j + 1], col, mat, uv(i, j), uv(i + 1, j + 1), uv(i, j + 1));
  }
}

// rounded rectangle outline in (x, z), counter-clockwise, with the sides subdivided so a loft's
// smooth normals stay flat along them
function rrect(hx, hz, r, nc = 4, ns = 5) {
  const pts = [];
  const corners = [[hx - r, hz - r, 0], [-hx + r, hz - r, 90], [-hx + r, -hz + r, 180], [hx - r, -hz + r, 270]];
  corners.forEach(([cx, cz, a0], ci) => {
    for (let k = 0; k <= nc; k++) { const a = ((a0 + (90 * k) / nc) * Math.PI) / 180; pts.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]); }
    const [nx, nz] = corners[(ci + 1) % 4];
    const ex = nx + r * Math.cos(((((ci + 1) % 4) * 90) * Math.PI) / 180), ez = nz + r * Math.sin(((((ci + 1) % 4) * 90) * Math.PI) / 180);
    const sx = cx + r * Math.cos(((a0 + 90) * Math.PI) / 180), sz = cz + r * Math.sin(((a0 + 90) * Math.PI) / 180);
    for (let k = 1; k < ns; k++) pts.push([lerp(sx, ex, k / ns), lerp(sz, ez, k / ns)]);
  });
  return pts;
}

// per-vertex recolouring after a model is built (weathering is baked into vertex colours)
export function recolour(g, fn, from = 0) {
  const P = g.P || g.p, N = g.N || g.n, C = g.C || g.c, M = g.M || g.m, nv = g.nv ?? g.p.length / 3;
  for (let i = from; i < nv; i++) {
    const mid = M[i * 3];
    if (mid === MAT.LIGHT || mid === MAT.TEXTURED || mid === MAT.GLASS) continue;
    const c = fn([P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], [N[i * 3], N[i * 3 + 1], N[i * 3 + 2]], [C[i * 3], C[i * 3 + 1], C[i * 3 + 2]], mid);
    C[i * 3] = c[0]; C[i * 3 + 1] = c[1]; C[i * 3 + 2] = c[2];
  }
}
const lumOf = (c) => c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;

// salt, weed, barnacles and the tide line, for anything that floats: y is height above the
// still waterline
export function seaStain(col, p, seed, { weedTop = 0.3, tide = 0.38 } = {}) {
  const [x, y, z] = p;
  const nz = fbm(x * 5 + seed, y * 8, z * 5);
  const wl = y + (nz - 0.5) * 0.24;
  const weed = smooth(weedTop, 0.0, wl);
  const lush = smooth(0.52, 0.7, noise3(x * 11 + seed, y * 6, z * 11));
  let c = mixc(col, mixc([0.035, 0.05, 0.022], [0.11, 0.115, 0.04], lush), weed * 0.93);
  const barn = smooth(0.74, 0.8, noise3(x * 38, y * 38 + seed, z * 38)) * smooth(0.5, 0.0, Math.abs(wl - 0.12));
  c = mixc(c, [0.46, 0.43, 0.36], barn * 0.8);
  const tl = Math.exp(-Math.pow((y - tide - 0.08 * nz) / 0.09, 2));
  c = mixc(c, [0.5, 0.46, 0.36], tl * 0.8);
  // salt crust and spray staining fade out with height
  c = mixc(c, [lumOf(c) * 0.9 + 0.12, lumOf(c) * 0.9 + 0.11, lumOf(c) * 0.9 + 0.1], smooth(1.4, 0.4, y) * 0.22 * (1 - weed));
  return c;
}

// ---- the number plates ------------------------------------------------------------------
// a plate is a flat sheet that takes a canvas texture (drawn in marks.js); a standard size
export const PLATE_W = 0.84, PLATE_H = 0.54;
function plate(g, c, nrm, right, wd = PLATE_W, ht = PLATE_H) {
  // c: centre; nrm: outward normal; right: along the plate's width (left to right as seen from outside)
  const up = [0, 1, 0], hw = wd / 2, hh = ht / 2;
  const P = (a, b) => add(c, add(right.map((x) => x * a), up.map((x) => x * b)));
  texQuad(g, P(-hw, -hh), P(hw, -hh), P(hw, hh), P(-hw, hh), [1, 1, 1], [MAT.TEXTURED, 0, 0], nrm);
  // the board it is screwed to, a little larger
  const o = nrm.map((x) => x * 0.012);
  const B = (a, b) => add(sub(c, o), add(right.map((x) => x * a), up.map((x) => x * b)));
  g.quad(B(-hw - 0.03, -hh - 0.03), B(hw + 0.03, -hh - 0.03), B(hw + 0.03, hh + 0.03), B(-hw - 0.03, hh + 0.03), [0.07, 0.075, 0.08], [MAT.RUBBER, 0, 0], nrm);
}
export { plate };

// a fresnel-ribbed lantern lens (glow) between y0 and y1 with a pair of guard bars; returns the top
export function lantern(g, y0, lens, { lod = 0, r = 0.21, h = 0.52, steel = [0.5, 0.52, 0.55], dark = [0.08, 0.085, 0.09], paint = null } = {}) {
  const seg = lod ? 12 : 28;
  // housing
  revolve(g, [[0, y0], [r + 0.1, y0], [r + 0.1, y0], [r + 0.1, y0 + 0.04], [r + 0.08, y0 + 0.18], [r + 0.08, y0 + 0.18], [r + 0.02, y0 + 0.2]], dark, [MAT.METAL, 0, 0], seg);
  const yl = y0 + 0.2;
  // the lens: horizontal ribs like a fresnel lens
  const prof = [];
  const nr = lod ? 3 : 7;
  for (let k = 0; k <= nr * 2; k++) prof.push([r + (k % 2 ? 0.028 : 0), yl + (h * k) / (nr * 2)]);
  g.lathe(prof.map(([rr, y]) => [rr, y]), lens, [MAT.GELCOAT, 0, 1], seg);
  // cap and finial
  const yt = yl + h;
  revolve(g, [[r + 0.0, yt], [r + 0.1, yt + 0.01], [r + 0.1, yt + 0.01], [r + 0.1, yt + 0.04], [r + 0.04, yt + 0.12], [r + 0.04, yt + 0.12], [0.03, yt + 0.2], [0.02, yt + 0.24]], paint || steel, [MAT.METAL, 0, 0], seg);
  if (!lod) {
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * 2 * Math.PI + Math.PI / 4;
      rod(g, [Math.cos(a) * (r + 0.03), yl, Math.sin(a) * (r + 0.03)], [Math.cos(a) * (r + 0.03), yt, Math.sin(a) * (r + 0.03)], 0.011, steel, [MAT.METAL, 0, 0], 4);
    }
    // anti-perching spikes round the cap
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * 2 * Math.PI;
      const c = Math.cos(a), s = Math.sin(a);
      rod(g, [c * (r + 0.09), yt + 0.03, s * (r + 0.09)], [c * (r + 0.16), yt + 0.2, s * (r + 0.16)], 0.006, steel, [MAT.METAL, 0, 0], 3);
    }
  }
  return yt + 0.24;
}

// three crossed discs: the radar reflector, with one corner up
export function radarReflector(g, c, r, col, segs = 14) {
  // an octahedral reflector sits with a corner up: three plates, two of them 45 degrees to the vertical
  const planes = [[norm([1, 0, 1]), [0, 1, 0]], [norm([1, 0, -1]), [0, 1, 0]], [[1, 0, 0], [0, 0, 1]]];
  for (const [u, v] of planes) {
    const ring = Array.from({ length: segs }, (_, k) => { const a = (k / segs) * 2 * Math.PI; return add(c, add(u.map((x) => x * Math.cos(a) * r), v.map((x) => x * Math.sin(a) * r))); });
    const n = norm(cross(u, v));
    g.fan(ring, c, n, col, [MAT.METAL, 0, 0]);
    g.fan(ring, c, n.map((x) => -x), col, [MAT.METAL, 0, 0]);
  }
}

// ---- gantry tower ------------------------------------------------------------------------
// A lattice tower on a steel pontoon. The pontoon is the gate's end: boats pass between two of
// these. The truss or the flag line attaches at TOWER.attach, on the face toward the other tower.
export const TOWER = { height: 10.2, attach: 9.0, pontoon: [3.4, 3.8], radius: 2.6 };

// lod 0 near; 1 middle (no diagonals' twins, plain plates, thicker bars); 2 far (legs, frames, pontoon, top mark)
export function towerGeo(side, lod = 0) {
  const g = new Geo(lod ? 2048 : 16384);
  const port = side === 'port', near = lod === 0, far = lod === 2, TH = far ? 2.2 : lod ? 1.5 : 1;
  const body = port ? PORT : STBD, lens = port ? LENS_PORT : LENS_STBD;
  const inw = port ? 1 : -1;
  const steel = [0.5, 0.52, 0.55], dark = [0.07, 0.075, 0.08];
  const [px, pz] = TOWER.pontoon;
  // pontoon: a rounded-rectangle hull, flared above the waterline, with a non-skid deck
  const levels = [[-0.75, 0.74, 0.8], [-0.4, 0.92, 0.95], [-0.05, 1.0, 1.0], [0.3, 1.0, 1.0], [0.52, 0.98, 0.98]];
  const rc = far ? 1 : lod ? 2 : 4, rs = far ? 1 : lod ? 2 : 5;
  const rings = levels.map(([y, fx, fz]) => rrect((px / 2) * fx, (pz / 2) * fz, 0.55, rc, rs).map(([x, z]) => [x, y, z]));
  g.loft(rings, body, [MAT.RUBBER, 0, 0], { ref: (i) => [0, levels[i][0], 0] });
  // deck with a rolled edge
  const deck = rrect(px / 2 * 0.98 - 0.06, pz / 2 * 0.98 - 0.06, 0.5, rc, rs).map(([x, z]) => [x, 0.54, z]);
  g.fan(deck, [0, 0.54, 0], [0, 1, 0], [0.32, 0.33, 0.34], [MAT.NONSKID, 0, 0]);
  if (!far) g.tube(rrect(px / 2 * 0.98, pz / 2 * 0.98, 0.55, rc, rs).map(([x, z]) => [x, 0.53, z]), 0.05, steel, [MAT.METAL, 0, 0], { segs: near ? 6 : 3, closed: true });
  // fender: a heavy rubber half-round at the waterline, and a yellow collision strip above it
  g.tube(rrect(px / 2 * 1.0 + 0.04, pz / 2 * 1.0 + 0.04, 0.58, rc, rs).map(([x, z]) => [x, 0.0, z]), 0.11, dark, [MAT.RUBBER, 0, 0], { segs: near ? 8 : 4, closed: true });
  // bollards and a locker on the deck
  if (near) for (const [x, z] of [[1.3, 1.5], [1.3, -1.5], [-1.3, 1.5], [-1.3, -1.5]]) lathe(g, [[0.12, 0.54], [0.1, 0.62], [0.1, 0.62], [0.13, 0.72], [0.07, 0.74]], steel, MET, { segs: 8, at: [x, 0, z] });
  // tower: four tapering legs, braced
  const y0 = 0.58, yT = TOWER.height, hb = 0.85, ht = 0.5, bays = 5;
  const hw = (y) => lerp(hb, ht, (y - y0) / (yT - y0));
  const corner = (y, k) => { const w = hw(y); return [[w, y, w], [-w, y, w], [-w, y, -w], [w, y, -w]][k]; };
  for (let k = 0; k < 4; k++) rod(g, corner(y0, k), corner(yT, k), 0.06 * TH, steel, [MAT.METAL, 0, 0], near ? 6 : 3);
  for (let b = 0; b <= bays; b++) {
    const y = y0 + ((yT - y0) * b) / bays;
    for (let k = 0; k < 4; k++) rod(g, corner(y, k), corner(y, (k + 1) % 4), 0.04 * TH, steel, [MAT.METAL, 0, 0], near ? 5 : 3);
  }
  if (!far) for (let b = 0; b < bays; b++) {
    const ya = y0 + ((yT - y0) * b) / bays, yb = y0 + ((yT - y0) * (b + 1)) / bays;
    for (let k = 0; k < 4; k++) {
      rod(g, corner(ya, k), corner(yb, (k + 1) % 4), 0.027 * TH, steel, [MAT.METAL, 0, 0], near ? 4 : 3);
      if (near) rod(g, corner(ya, (k + 1) % 4), corner(yb, k), 0.027, steel, [MAT.METAL, 0, 0], 4);
    }
  }
  // a ladder up the outside face, away from the gate
  const lz = -inw * (hw(y0) + 0.22);
  if (near) rod(g, [-0.22, y0, lz], [-0.22 * 0.6, yT - 0.2, -inw * (hw(yT) + 0.22)], 0.025, steel, [MAT.METAL, 0, 0], 4);
  if (near) rod(g, [0.22, y0, lz], [0.22 * 0.6, yT - 0.2, -inw * (hw(yT) + 0.22)], 0.025, steel, [MAT.METAL, 0, 0], 4);
  if (near) for (let y = y0 + 0.4; y < yT - 0.3; y += 0.4) {
    const t = (y - y0) / (yT - y0), zz = lerp(lz, -inw * (hw(yT) + 0.22), t), w = lerp(0.22, 0.13, t);
    rod(g, [-w, y, zz], [w, y, zz], 0.014, steel, [MAT.METAL, 0, 0], 3);
  }
  // number plates ("S/F") on the four faces, low, where a boat passes
  const yp = y0 + 2.3;
  for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const n = [nx, 0, nz], right = [nz, 0, -nx], c = [nx * (hw(yp) + 0.06), yp, nz * (hw(yp) + 0.06)];
    if (near) plate(g, c, n, right, 1.2, 0.78);
    else kquad(g, [c[0] - right[0] * 0.6, yp - 0.39, c[2] - right[2] * 0.6], [c[0] + right[0] * 0.6, yp - 0.39, c[2] + right[2] * 0.6], [c[0] + right[0] * 0.6, yp + 0.39, c[2] + right[2] * 0.6], [c[0] - right[0] * 0.6, yp + 0.39, c[2] - right[2] * 0.6], [0.75, 0.75, 0.72], RUB);
  }
  // top platform with rail posts, the span's end brackets and the lantern
  const hp = hw(yT) + 0.2;
  g.box(-hp, hp, yT - 0.02, yT + 0.04, -hp, hp, [0.2, 0.2, 0.21], [MAT.METAL, 0, 0]);
  if (near) for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) rod(g, [sx * hp, yT + 0.04, sz * hp], [sx * hp, yT + 0.6, sz * hp], 0.022, steel, [MAT.METAL, 0, 0], 4);
  if (near) for (const y of [yT + 0.35, yT + 0.6]) for (let k = 0; k < 4; k++) {
    const a = [[hp, hp], [-hp, hp], [-hp, -hp], [hp, -hp]][k], b = [[hp, hp], [-hp, hp], [-hp, -hp], [hp, -hp]][(k + 1) % 4];
    rod(g, [a[0], y, a[1]], [b[0], y, b[1]], 0.016, steel, [MAT.METAL, 0, 0], 3);
  }
  // topmark ahead of the lantern: a painted drum, in the side's colour
  revolve(g, [[0, yT + 0.04], [0.34, yT + 0.04], [0.34, yT + 0.04], [0.34, yT + 0.7], [0.34, yT + 0.7], [0, yT + 0.7]], body, [MAT.GELCOAT, 0, 0.1], near ? 20 : 8);
  const top = lantern(g, yT + 0.7, lens, { r: 0.24, h: 0.6, lod: near ? 0 : 1 });
  g.lamp = yT + 0.7 + 0.2 + 0.3;
  rod(g, [0, top, 0], [0, top + 0.4, 0], 0.02, steel, [MAT.METAL, 0, 0], 4);
  radarReflector(g, [0, top + 0.58, 0], 0.3, steel, near ? 14 : 6);
  if (!far) {
    // stays from the head of the tower to the pontoon's corners
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) krod(g, [sx * hw(yT) * 0.9, yT - 0.1, sz * hw(yT) * 0.9], [sx * (px / 2 - 0.2), 0.56, sz * (pz / 2 - 0.2)], near ? 0.012 : 0.025, [0.35, 0.36, 0.38], MET, 3);
    // sponsors' banners laced to the two faces the fleet passes: blocks of colour, the name reading up the tower
    const BN = [[[0.03, 0.08, 0.3], [0.8, 0.8, 0.76], 'TIDAL RACING'], [[0.7, 0.25, 0.02], [0.05, 0.05, 0.06], 'OPEN WATER']];
    [1, -1].forEach((sx, bi) => {
      const [bg, ink, word] = BN[(bi + (port ? 0 : 1)) % 2], ya = y0 + 3.6, yb = yT - 0.5, P = (y, z) => [sx * (hw(y) + 0.09), y, z * hw(y) * 0.92];
      kquad(g, P(ya + 0.5, -1), P(ya + 0.5, 1), P(yb - 0.5, 1), P(yb - 0.5, -1), bg, CLOTH);
      kquad(g, P(ya, -1), P(ya, 1), P(ya + 0.5, 1), P(ya + 0.5, -1), ink, CLOTH); kquad(g, P(yb - 0.5, -1), P(yb - 0.5, 1), P(yb, 1), P(yb, -1), ink, CLOTH);
      if (near) {
        const mid = (ya + yb) / 2, sl = (hw(yb) - hw(ya)) / (yb - ya);
        text(g, word, [sx * (hw(mid) + 0.1), mid, sx * 0.19], [sx * sl, 1, 0], [0, 0, sx], 0.38, ink, CLOTH, { off: 0.006, weight: 0.2, centre: true });
        for (const y of [ya, (ya + yb) / 2, yb]) for (const z of [-1, 1]) krod(g, P(y, z), [sx * hw(y), y, z * hw(y)], 0.008, [0.1, 0.1, 0.1], RUB, 3);
      }
    });
  }
  if (near) {
    // what the timekeepers leave on the pontoon: a generator, its fuel, cable up the tower; a rail, a life ring; horns at the top
    box(g, [-0.95, 0.82, inw * 1.1], 0.42, 0.28, 0.3, [0.55, 0.42, 0.05], RUB); box(g, [-0.95, 1.13, inw * 1.1], 0.36, 0.03, 0.24, dark, RUB);
    for (const z of [-0.2, 0.2]) krod(g, [-1.25, 0.56, inw * 1.1 + z], [-0.65, 0.56, inw * 1.1 + z], 0.03, dark, RUB, 4);
    box(g, [-1.2, 0.74, inw * 0.5], 0.09, 0.2, 0.16, [0.5, 0.06, 0.04], RUB);
    ktube(g, [[-0.6, 0.75, inw * 1.0], [-0.5, 0.6, inw * 0.75], corner(y0 + 0.3, port ? 1 : 2), corner(yT - 0.6, port ? 1 : 2)], 0.014, dark, RUB, { segs: 4 });
    for (const sx of [-1, 1]) { const pts = [[sx * (px / 2 - 0.12), 0.56, -pz / 2 + 0.5], [sx * (px / 2 - 0.12), 0.56, pz / 2 - 0.5]]; for (const p of pts) krod(g, p, [p[0], 1.5, p[2]], 0.022, steel, MET, 4); for (const y of [1.05, 1.5]) krod(g, [pts[0][0], y, pts[0][2]], [pts[1][0], y, pts[1][2]], 0.018, steel, MET, 4); }
    lifering(g, [-(px / 2 - 0.1), 1.1, 0], [-1, 0, 0], 0.27);
    for (const s of [-1, 1]) ktube(g, [[s * 0.3, yT - 0.5, inw * hw(yT - 0.5)], [s * 0.5, yT - 0.6, inw * (hw(yT - 0.5) + 0.42)]], [0.05, 0.17], [0.6, 0.6, 0.58], GEL, { segs: 8 });
    // old tyres down the sides, a mooring chain off each seaward corner
    for (const sx of [-1, 1]) for (const z of [-1.1, 0, 1.1]) hoop(g, [sx * (px / 2 + 0.12), 0.25, z], [sx, 0, 0], 0.24, 0.09, [0.025, 0.025, 0.027], RUB, 10, 5);
    for (const sx of [-1, 1]) { chain(g, [sx * (px / 2 - 0.25), 0.5, -inw * (pz / 2 - 0.1)], [sx * (px / 2 + 0.7), -0.3, -inw * (pz / 2 + 1.6)], [0.22, 0.2, 0.18], MET, { link: 0.14, r: 0.018 }); krod(g, [sx * (px / 2 + 0.7), -0.3, -inw * (pz / 2 + 1.6)], [sx * (px / 2 + 2.2), -3, -inw * (pz / 2 + 4)], 0.03, [0.1, 0.1, 0.1], RUB, 3); }
  }
  // the span's end bracket: a plate on the gate side at the attach height
  g.box(-0.1, 0.1, TOWER.attach - 0.7, TOWER.attach + 0.45, inw * (hw(TOWER.attach) - 0.02), inw * (hw(TOWER.attach) + 0.18), [0.15, 0.15, 0.16], [MAT.METAL, 0, 0]);

  recolour(g, (p, n, c, mid) => {
    const [x, y, z] = p;
    let col = c;
    const seed = port ? 3.1 : 8.7;
    if (mid === MAT.METAL) {
      const m = fbm(x * 4, y * 4, z * 4 + seed);
      col = [c[0] * (0.7 + 0.5 * m), c[1] * (0.7 + 0.5 * m), c[2] * (0.7 + 0.5 * m)];
      const rust = smooth(0.62, 0.84, noise3(x * 13, y * 6, z * 13 + seed)) * (1 - smooth(2, 10, y) * 0.8);
      col = mixc(col, [0.34, 0.15, 0.07], rust * 0.75);
    } else if (lumOf(c) > 0.04 && mid !== MAT.NONSKID) {
      // painted steel: faded, chalky, with streaks running down from the deck edge
      const fade = clamp(0.22 + 0.4 * fbm(x * 1.3, y * 1.3, z * 1.3 + seed), 0, 1) * 0.55;
      col = mixc(c, [c[0] * 0.7 + 0.22, c[1] * 0.7 + 0.21, c[2] * 0.7 + 0.2], fade);
      const u = Math.atan2(z, x) * Math.hypot(x, z);
      const st = smooth(0.58, 0.82, noise3(x * 5 + z * 5 + seed, 0.5, 3)) * smooth(-0.2, 0.5, y);
      col = mixc(col, [0.3, 0.13, 0.06], st * 0.55 * (1 - smooth(0.3, 0.55, y - 0.0)));
      void u;
    }
    if (y < 1.3 && mid !== MAT.LIGHT) col = seaStain(col, p, seed, { weedTop: 0.3, tide: 0.4 });
    // gulls
    const sp = smooth(0.78, 0.82, noise3(x * 8, y * 8, z * 8 + seed)) * smooth(0.5, 0.85, n[1]);
    return mixc(col, [0.8, 0.8, 0.76], sp * 0.8);
  });
  return g;
}

// ---- what spans between the towers -------------------------------------------------------
// Spans run from x = 0 (the first tower's origin) to x = L (the second's). A model's x is the
// span parameter, so everything keeps its offset above the water while the ends follow the towers.

// A rigid triangular truss with zig-zag bracing. width: across the section.
export function trussGeo(L) {
  const g = new Geo();
  const yA = TOWER.attach, x0 = 0.45, x1 = L - 0.45;
  const alu = [0.62, 0.64, 0.67];
  const yt = yA + 0.5, yb = yA - 0.34, zb = 0.5;
  const top = [0, yt, 0], bl = [0, yb, -zb], br = [0, yb, zb];
  const at = (p, x) => [x, p[1], p[2]];
  for (const p of [top, bl, br]) rod(g, at(p, x0), at(p, x1), 0.075, alu, [MAT.METAL, 0, 0], 7);
  const n = Math.max(Math.round((x1 - x0) / 1.7), 4), dx = (x1 - x0) / n;
  for (let i = 0; i < n; i++) {
    const a = x0 + i * dx, b = a + dx;
    const f = i % 2 ? [b, a] : [a, b];
    rod(g, at(bl, f[0]), at(br, f[1]), 0.035, alu, [MAT.METAL, 0, 0], 4);          // bottom face
    rod(g, at(bl, f[0]), at(top, f[1]), 0.035, alu, [MAT.METAL, 0, 0], 4);         // faces up to the top chord
    rod(g, at(br, f[0]), at(top, f[1]), 0.035, alu, [MAT.METAL, 0, 0], 4);
  }
  // end frames
  for (const x of [x0, x1]) { rod(g, at(bl, x), at(br, x), 0.05, alu, [MAT.METAL, 0, 0], 5); rod(g, at(bl, x), at(top, x), 0.05, alu, [MAT.METAL, 0, 0], 5); rod(g, at(br, x), at(top, x), 0.05, alu, [MAT.METAL, 0, 0], 5); }
  // flood lights along the top chord, aimed down at the line
  for (const f of [0.18, 0.5, 0.82]) {
    const x = x0 + (x1 - x0) * f;
    g.box(x - 0.18, x + 0.18, yt + 0.08, yt + 0.24, -0.1, 0.1, [0.12, 0.12, 0.13], [MAT.METAL, 0, 0]);
    g.box(x - 0.14, x + 0.14, yt + 0.02, yt + 0.09, -0.07, 0.07, [1, 0.95, 0.85], [MAT.LIGHT, 0, 1]);
  }
  const tr0 = g.nv;
  // the starting lights: five red lamps in a row under the middle of the span, shown to both sides; a race clock beside them
  {
    const xm = (x0 + x1) / 2, yl = yb - 0.45;
    box(g, [xm, yl, 0], 1.75, 0.2, 0.09, [0.03, 0.03, 0.035], RUB);
    for (let k = 0; k < 5; k++) for (const s of [-1, 1]) kquad(g, [xm - 1.36 + k * 0.68 - 0.13, yl - 0.13, s * 0.093], [xm - 1.36 + k * 0.68 + 0.13, yl - 0.13, s * 0.093], [xm - 1.36 + k * 0.68 + 0.13, yl + 0.13, s * 0.093], [xm - 1.36 + k * 0.68 - 0.13, yl + 0.13, s * 0.093], [0.9, 0.06, 0.04], LIT);
    for (const x of [xm - 1.5, xm + 1.5]) krod(g, [x, yb, 0], [x, yl + 0.2, 0], 0.025, alu, MET, 4);
    box(g, [xm + 3.2, yl, 0], 0.75, 0.24, 0.07, [0.03, 0.03, 0.035], RUB);
    for (const s of [-1, 1]) text(g, '00.00', [xm + 3.2, yl - 0.15, s * 0.072], [s, 0, 0], [0, 1, 0], 0.3, [0.95, 0.6, 0.1], LIT, { off: 0.003, weight: 0.2, centre: true });
    krod(g, [xm + 3.2, yb, 0], [xm + 3.2, yl + 0.24, 0], 0.025, alu, MET, 4);
    for (const x of [x0 + 1.2, x1 - 1.2]) for (const s of [-1, 1]) ktube(g, [[x, yb - 0.1, s * 0.1], [x, yb - 0.25, s * 0.5]], [0.05, 0.17], [0.6, 0.6, 0.58], GEL, { segs: 8 });
  }
  recolour(g, (p, nn, c) => {
    const m = fbm(p[0] * 0.6, p[1] * 3, p[2] * 3);
    let col = [c[0] * (0.78 + 0.35 * m), c[1] * (0.78 + 0.35 * m), c[2] * (0.78 + 0.35 * m)];
    // salt streaks and a little rust at the node points
    const rust = smooth(0.7, 0.9, noise3(p[0] * 2.2, p[1] * 5, p[2] * 5));
    col = mixc(col, [0.35, 0.17, 0.09], rust * 0.5);
    return col;
  });
  return g;
}

// the banner hung under the truss: a sheet with a gentle ripple, textured (drawn in marks.js)
export function bannerGeo(L) {
  const g = new Geo();
  const yA = TOWER.attach, x0 = 1.0, x1 = L - 1.0, top = yA - 0.34, h = 2.1;
  const fn = (u, v) => [lerp(x0, x1, u), top - v * h, 0.07 * Math.sin(u * L * 0.55 + v * 1.4) * (0.3 + 0.7 * v) + 0.03];
  texSheet(g, fn, Math.round((x1 - x0) / 0.9), 4, [1, 1, 1], [MAT.TEXTURED, 0, 0], [0, 0, 1]);
  // eyelets and ties along the top
  for (let x = x0 + 0.5; x < x1; x += 2.5) rod(g, [x, top + 0.02, -0.08], [x, top - 0.1, 0.03], 0.012, [0.08, 0.08, 0.09], [MAT.RUBBER, 0, 0], 3);
  return g;
}

// the catenary line of flags for wide gates: a rope between the tower tops and a flag every metre
export function flagLineGeo(L) {
  const g = new Geo();
  const yA = TOWER.attach + 0.55, x0 = 0.5, x1 = L - 0.5, half = (x1 - x0) / 2;
  const sag = 0.03 * L;
  // catenary y = a (cosh(x / a) - cosh(half / a)) with the given sag
  // find a (the catenary parameter) with a (cosh(half / a) - 1) = sag by bisection
  let lo = 0.5, hi = 1e5;
  for (let i = 0; i < 60; i++) { const m = Math.sqrt(lo * hi); if (m * (Math.cosh(half / m) - 1) > sag) lo = m; else hi = m; }
  const a = lo;
  const yAt = (x) => yA - sag + a * (Math.cosh((x - x0 - half) / a) - 1);
  const rope = [];
  const nr = Math.round((x1 - x0) / 2);
  for (let i = 0; i <= nr; i++) { const x = x0 + (i / nr) * (x1 - x0); rope.push([x, yAt(x), 0]); }
  g.tube(rope, 0.025, [0.6, 0.55, 0.45], [MAT.RUBBER, 0, 0], { segs: 5 });
  const cols = [[0.78, 0.05, 0.04], [0.95, 0.75, 0.05], [0.04, 0.12, 0.6], [0.85, 0.85, 0.82], [0.04, 0.4, 0.14], [0.9, 0.35, 0.05]];
  const fw = 0.95, fh = 0.7;
  let k = 0;
  for (let x = x0 + 1.0; x < x1 - 0.8; x += 1.05, k++) {
    const yt = yAt(x) - 0.03;
    const chk = k % 2 === 0;
    const tw = (Math.sin(k * 1.9) * 0.35);      // each flag hangs a little twisted
    const bil = 0.08 + 0.05 * Math.sin(k * 2.7);
    const P = (u, v) => {
      const xx = x + (u - 0.5) * fw * Math.cos(tw), zz = (u - 0.5) * fw * Math.sin(tw) + bil * Math.sin(u * Math.PI) * v;
      return [xx, yt - v * fh, zz];
    };
    const base = cols[(k >> 1) % cols.length];
    const nu = 3, nv = 3;
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      const col = chk ? ((i + j) % 2 ? [0.9, 0.9, 0.88] : [0.04, 0.04, 0.045]) : base;
      const a0 = P(i / nu, j / nv), b0 = P((i + 1) / nu, j / nv), c0 = P((i + 1) / nu, (j + 1) / nv), d0 = P(i / nu, (j + 1) / nv);
      g.quad(a0, b0, c0, d0, col, [MAT.RUBBER, 0, 0]);
    }
  }
  recolour(g, (p, n, c) => { const s = 0.85 + 0.2 * fbm(p[0] * 0.8, p[1] * 3, p[2] * 3); return [c[0] * s, c[1] * s, c[2] * s]; });
  return g;
}

// ---- inflatable turn pylon ---------------------------------------------------------------
export const PYLON = { height: 7.6, radius: 2.5, cell: 1.15, y0: 0.55, cells: 5 };

// lod 0 near; 1 middle; 2 far (the column and its bands of colour)
export function pylonGeo(side, lod = 0) {
  const g = new Geo(lod ? 4096 : 32768);
  const port = side === 'port', near = lod === 0, far = lod === 2;
  const body = port ? [0.78, 0.07, 0.05] : [0.06, 0.52, 0.16];
  const white = [0.8, 0.8, 0.77];
  const lens = port ? LENS_PORT : LENS_STBD;
  const { y0, cell, cells } = PYLON;
  const seg = far ? 12 : lod ? 24 : 64;
  // radius of the column before the cells puff out
  const r0 = (y) => lerp(1.3, 0.72, clamp((y - y0) / (cell * cells), 0, 1));
  const puff = (y) => { const f = ((y - y0) / cell) % 1; const q = Math.sin(Math.PI * clamp(f, 0, 1)); return 1 + 0.15 * Math.pow(q, 0.7); };
  // ballast ring: black fabric, partly under water
  revolve(g, [[0, -0.5], [1.4, -0.5], [2.1, -0.32], [2.45, -0.02], [2.5, 0.22], [2.25, 0.46], [1.8, 0.56], [1.4, y0]], [0.05, 0.05, 0.055], [MAT.RUBBER, 0, 0], seg);
  // the column: stacked inflated cells with sewn seams between them
  const prof = [];
  const top = y0 + cell * cells;
  for (let y = y0; y <= top + 1e-6; y += cell / (far ? 4 : lod ? 6 : 12)) prof.push([r0(y) * puff(Math.min(y, top - 1e-4)), y]);
  prof.push([r0(top) * 0.97, top + 0.05]);
  // domed cap
  for (let k = 1; k <= 6; k++) { const a = (k / 6) * Math.PI / 2; prof.push([r0(top) * 0.97 * Math.cos(a) + 0.0001, top + 0.05 + 0.42 * Math.sin(a)]); }
  revolve(g, prof, body, [MAT.GELCOAT, 0, 0], seg);
  // a neck and the strobe on top
  const yc = top + 0.47;
  revolve(g, [[0.2, yc - 0.06], [0.2, yc + 0.1], [0.12, yc + 0.15]], [0.3, 0.3, 0.32], [MAT.METAL, 0, 0], 12);
  lantern(g, yc + 0.14, lens, { r: 0.17, h: 0.36, lod: near ? 0 : 1 });
  g.lamp = yc + 0.14 + 0.2 + 0.18;
  // number panels: curved patches that follow the cell, four of them round the column
  const cellN = 1;
  const ya = y0 + cell * (cellN + 0.14), yb = y0 + cell * (cellN + 0.86);
  for (let k = 0; k < (far ? 0 : 4); k++) {
    const a0 = (k * Math.PI) / 2;
    const half = 0.72;
    const fn = (u, v) => {
      const a = a0 - (u - 0.5) * half * 2, y = lerp(ya, yb, 1 - v);
      const rr = r0(y) * puff(y) + (near ? 0.012 : 0.1);
      return [Math.cos(a) * rr, y, Math.sin(a) * rr];
    };
    texSheet(g, fn, near ? 8 : 4, near ? 4 : 2, [1, 1, 1], [MAT.TEXTURED, 0, 0], [Math.cos(a0), 0, Math.sin(a0)]);
  }
  const fit0 = g.nv, surfR = (y) => r0(y) * puff(Math.min(y, top - 1e-4));
  if (near) {
    // welded seams up the column between the number panels, webbing handles, a valve
    for (let k = 0; k < 4; k++) { const a = (k + 0.5) * (Math.PI / 2); ktube(g, prof.filter((q, i) => i % 3 === 0 && q[1] <= top).map(([r, y]) => [Math.cos(a) * (r + 0.004), y, Math.sin(a) * (r + 0.004)]), 0.016, [0.3, 0.3, 0.3], RUB, { segs: 3 }); }
    for (const cn of [2, 4]) for (let k = 0; k < 4; k++) { const a = (k + 0.5) * (Math.PI / 2) + 0.35, y = y0 + cell * (cn + 0.5), r = surfR(y), P = (dy2, o) => [Math.cos(a) * (r + o), y + dy2, Math.sin(a) * (r + o)]; ktube(g, [P(-0.16, 0.005), P(-0.09, 0.07), P(0.09, 0.07), P(0.16, 0.005)], 0.014, [0.04, 0.04, 0.045], CLOTH, { segs: 4 }); for (const d of [-0.18, 0.18]) box(g, P(d, 0.008), 0.012, 0.05, 0.05, [0.04, 0.04, 0.045], RUB, { yaw: a }); }
    lathe(g, [[0.035, 0], [0.035, 0.03], [0.02, 0.04], [0, 0.04]], [0.05, 0.05, 0.05], RUB, { segs: 8, axis: 'x', at: [surfR(y0 + cell * 0.5) - 0.005, y0 + cell * 0.5, 0.3] });
    // the makers' name round a white cell
    const word = 'TIDAL RACING', yw = y0 + cell * 3.38, rw = surfR(yw + 0.12) + 0.01;
    for (const a0 of [0.35, 0.35 + Math.PI]) [...word].forEach((ch, k) => { const a = a0 - (k - word.length / 2) * (0.21 / rw); text(g, ch, [Math.cos(a) * rw, yw, Math.sin(a) * rw], [Math.sin(a), 0, -Math.cos(a)], [0, 1, 0], 0.24, body, RUB, { off: 0.004, weight: 0.2 }); });
  }
  if (!far) {
    // tie-downs from patches half way up to the ballast ring, which is weighted with water bags and moored
    for (let k = 0; k < 4; k++) { const a = k * (Math.PI / 2) + 0.78, yh = y0 + cell * 3, r = surfR(yh - 0.02); krod(g, [Math.cos(a) * r, yh, Math.sin(a) * r], [Math.cos(a) * 2.28, 0.42, Math.sin(a) * 2.28], near ? 0.012 : 0.03, [0.6, 0.55, 0.42], CLOTH, 3); if (near) { box(g, [Math.cos(a) * (r + 0.01), yh, Math.sin(a) * (r + 0.01)], 0.012, 0.09, 0.09, [0.04, 0.04, 0.045], RUB, { yaw: a }); hoop(g, [Math.cos(a) * 2.28, 0.44, Math.sin(a) * 2.28], [-Math.sin(a), 0, Math.cos(a)], 0.05, 0.012, [0.5, 0.52, 0.55], MET, 8, 3); } }
    const nb = near ? 10 : 6;
    for (let k = 0; k < nb; k++) { const a = (k / nb) * TAU; blob(g, [Math.cos(a) * 2.2, -0.12, Math.sin(a) * 2.2], 0.5, 0.3, 0.5, [0.05, 0.05, 0.055], RUB, { n: near ? 4 : 2, segs: near ? 8 : 5 }); }
    if (near) { chain(g, [2.3, 0.2, 0.4], [3.0, -0.3, 0.9], [0.22, 0.2, 0.18], MET, { link: 0.12, r: 0.015 }); krod(g, [3.0, -0.3, 0.9], [4.5, -3, 2], 0.025, [0.1, 0.1, 0.1], RUB, 3); }
    paint(g, fit0, stain(4.4, { weedTop: 0.25, tide: 0.35, wet: 0.5 }));
  }
  // paint the cells by height: alternating colour and white, dark in the seams
  recolour(g, (p, n, c, mid) => {
    const [x, y, z] = p;
    if (mid === MAT.RUBBER) return seaStain(c, p, 4.4, { weedTop: 0.5, tide: 0.55 });
    if (mid === MAT.METAL) return c;
    if (mid !== MAT.GELCOAT) return c;
    const f = (y - y0) / cell, idx = Math.floor(f + 1e-6), fr = f - idx;
    let col = idx % 2 === 0 ? body : white;
    if (y > top) col = body;
    // seams: sewn in, darker and slightly dirty
    const seam = Math.exp(-Math.pow(Math.min(fr, 1 - fr) / 0.045, 2));
    col = mixc(col, [col[0] * 0.45, col[1] * 0.45, col[2] * 0.45], seam * 0.8);
    // dirt and salt at the bottom, sun-faded at the top, blotchy overall
    const dirt = smooth(2.2, 0.55, y) * 0.5 * (0.4 + fbm(x * 2, y * 1.5, z * 2));
    col = mixc(col, [0.2, 0.18, 0.13], dirt * (idx % 2 ? 0.85 : 0.35));
    const bl = 0.92 + 0.12 * fbm(x * 3, y * 3, z * 3 + 9);
    col = [col[0] * bl, col[1] * bl, col[2] * bl];
    return seaStain(col, p, 2.2, { weedTop: 0.4, tide: 0.7 });
  });
  return g;
}
