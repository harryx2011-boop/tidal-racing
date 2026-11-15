import { MAT } from '../geo.js';
import { PORT, STBD, LENS_PORT, LENS_STBD, plate, lantern, radarReflector } from './marks.js';
import { Geo, TAU, lerp, clamp, smooth, vn, fb, mat, RUB, MET, GLS, GEL, tube, rod, lathe, box, quad, hoop, chain, text, mark, paint, xf, frame, mixIn, stain, guano, both } from './kit.js';

// A lateral navigation buoy, IALA region A: red with a flat-topped can to port, green with a cone to
// starboard. A wide painted float with a rubber fender belt, lifting eyes and a mooring bridle; a
// galvanised lattice tower with rungs, number plates, a battery box and solar panels; a flashing
// lantern under a radar reflector. y = 0 is the waterline; the mark stands about 6.5 m clear of it.
// The paint is faded, scuffed where boats have lain against it and streaked with rust; weed and a
// scum line mark the waterline: all baked into vertex colours.
// side: 'port' | 'stbd'; seed varies the weathering; lod 0 near, 1 middle, 2 far.

export const BUOY = { radius: 1.5, height: 6.6 };

export function buoyGeo(side = 'port', { seed = 1, lod = 0 } = {}) {
  const g = new Geo(lod ? 2048 : 32768);
  const port = side === 'port', near = lod === 0, far = lod === 2;
  const paintC = port ? PORT : STBD, lens = port ? LENS_PORT : LENS_STBD;
  const inw = port ? 1 : -1;                         // toward the other mark of the gate
  const steel = [0.52, 0.54, 0.57], dark = [0.06, 0.065, 0.07];
  const SEG = far ? 10 : lod ? 24 : 72;
  const sd = seed * 7.13;

  // ---- float ----
  // radius of the body at height y (below the waterline it rounds off into the keel)
  const top = port ? 1.06 : 1.95;                    // top of the straight side
  const rFn = port
    ? (y) => (y >= 0 ? 1.48 - 0.07 * (y / 1.1) : 1.48 * Math.pow(Math.max(1 - Math.pow(-y / 0.9, 3), 0), 0.5))
    : (y) => (y >= 0 ? 1.5 - 0.7 * (y / 1.95) : 1.5 * Math.pow(Math.max(1 - Math.pow(-y / 0.9, 3), 0), 0.5));
  const ys = (lod ? [-0.9, -0.55, -0.15, 0, 0.4, top * 0.7, top] : [-0.9, -0.86, -0.78, -0.66, -0.52, -0.38, -0.26, -0.14, -0.05, 0.03, 0.1, 0.17, 0.24, 0.31, 0.38, 0.46, 0.54, 0.64, 0.75, 0.87, 1.0, 1.0 + (top - 1.0) * 0.33, 1.0 + (top - 1.0) * 0.66, top]).filter((y, i, a) => y <= top && a.indexOf(y) === i);
  const prof = ys.map((y) => [rFn(y), y]);
  const rt = rFn(top), dy = top;
  // rolled rim, then the deck rising a little to the tower flange
  const dk = port ? 0.5 : 0.42;
  prof.push([rt + 0.035, dy + 0.035], [rt + 0.04, dy + 0.09], [rt, dy + 0.13], [rt - 0.09, dy + 0.14]);
  const deckTop = dy + 0.14 + 0.1, rimY = dy + 0.1;
  prof.push([lerp(rt - 0.09, dk + 0.1, 0.5), dy + 0.14 + 0.06], [dk + 0.1, deckTop - 0.01], [dk, deckTop]);
  const eyeA = (k) => sd * 0.9 + (k * TAU) / 3;
  const st = stain(sd, { weedTop: 0.32, tide: 0.42, wet: 0.5 });
  // sun-faded, chalky paint with rust running from the rim and the lifting eyes, bare patches, the scuffs of
  // boats along the fender line, droppings on the deck
  const body = (P, N, C, i) => {
    const x = P[i], y = P[i + 1], z = P[i + 2], rad = Math.hypot(x, z), ang = Math.atan2(z, x), u = ang * rad;
    const up = clamp(N[i + 1], 0, 1), fade = clamp(0.28 + 0.5 * fb(x * 1.2 + sd, y * 1.2, z * 1.2) + 0.25 * up + 0.04 * y, 0, 1) * 0.5;
    mixIn(C, i, C[i] * 0.55 + 0.27, C[i + 1] * 0.55 + 0.26, C[i + 2] * 0.55 + 0.25, fade);
    const bl = 0.8 + 0.4 * fb(x * 3 + sd, y * 3, z * 3);
    C[i] *= bl; C[i + 1] *= bl; C[i + 2] *= bl;
    if (!far) {
      const n1 = (q) => vn(q, sd, 0.3), dist = rimY - y;
      const len = 0.35 + 1.5 * n1(u * 1.7 + 4), sk = smooth(0.5, 0.7, n1(u * 4.2)) * smooth(-0.05, 0.05, dist) * smooth(len, 0.0, dist);
      let eyes = 0;
      for (let k = 0; k < 3; k++) { const da = Math.atan2(Math.sin(ang - eyeA(k)), Math.cos(ang - eyeA(k))); eyes = Math.max(eyes, Math.exp(-Math.pow((da * rad) / 0.1, 2))); }
      const rustK = clamp(sk * 0.8 + eyes * smooth(1.3, 0.0, dist) * smooth(-0.05, 0.05, dist) * (0.6 + 0.4 * n1(u * 9)) * 0.9, 0, 1), t = n1(y * 7 + u * 3);
      mixIn(C, i, lerp(0.46, 0.12, t), lerp(0.22, 0.05, t), lerp(0.05, 0.028, t), rustK * 0.95);
      const bare = smooth(0.7, 0.8, fb(x * 2.6 + sd, y * 2.6, z * 2.6)) * (0.35 + 0.65 * smooth(0.9, 0.0, Math.abs(y - rimY)) + 0.5 * smooth(0.55, 0.1, y)), t2 = fb(x * 12, y * 12, z * 12);
      mixIn(C, i, lerp(0.4, 0.22, t2), lerp(0.17, 0.1, t2), lerp(0.08, 0.05, t2), clamp(bare, 0, 1) * 0.85);
      mixIn(C, i, 0.3, 0.14, 0.07, smooth(dk + 0.45, dk + 0.12, rad) * smooth(rimY - 0.2, rimY + 0.05, y) * 0.7 * (0.5 + 0.5 * fb(x * 9, y * 9, z * 9)));
      // scuffs: pale horizontal scrapes and black rubber marks where hulls have rubbed
      const sc = smooth(0.62, 0.8, vn(u * 1.3 + sd, y * 14, 2.2)) * smooth(0.95, 0.35, Math.abs(y - 0.55));
      mixIn(C, i, 0.5, 0.48, 0.45, sc * 0.6); mixIn(C, i, 0.03, 0.03, 0.03, smooth(0.8, 0.9, vn(u * 2.1, y * 9 + sd, 5.5)) * smooth(0.6, 0.2, Math.abs(y - 0.5)) * 0.7);
    }
    st(P, N, C, i);
  };
  const metal = both((P, N, C, i) => {
    const x = P[i], y = P[i + 1], z = P[i + 2], m = 0.62 + 0.55 * fb(x * 4 + sd, y * 4, z * 4);
    C[i] *= m; C[i + 1] *= m; C[i + 2] *= m;
    mixIn(C, i, 0.36, 0.16, 0.07, smooth(0.6, 0.82, vn(x * 12 + sd, y * 7, z * 12)) * (0.55 + 0.3 * smooth(3.5, deckTop, y)));
  }, guano(sd, 0.85, 7, 0.84));
  lathe(g, prof, paintC, RUB, { segs: SEG, paint: body });
  // fender belt
  const fofs = (y) => 0.11 * Math.sqrt(Math.max(1 - Math.pow(y / 0.3, 2), 0)) + 0.01;
  lathe(g, (lod ? [-0.28, -0.1, 0.1, 0.26] : [-0.3, -0.22, -0.1, 0.0, 0.1, 0.2, 0.28]).map((y) => [rFn(y) + fofs(y), y]), dark, RUB, { segs: SEG, paint: st });
  const at = (a, r, y) => [Math.cos(a) * r, y, Math.sin(a) * r];
  const m0 = mark(g);
  if (!far) {
    // a steel rubbing strake round the rim
    tube(g, Array.from({ length: near ? 40 : 16 }, (_, k) => at((k / (near ? 40 : 16)) * TAU, rt + 0.045, dy + 0.065)), 0.03, steel, MET, { segs: near ? 5 : 3, closed: true });
    // lifting eyes on the rim
    for (let k = 0; k < 3; k++) { const a = eyeA(k); hoop(g, at(a, rt + 0.03, dy + 0.26), [-Math.sin(a), 0, Math.cos(a)], 0.13, lod ? 0.03 : 0.024, steel, MET, lod ? 8 : 14, lod ? 3 : 5); }
  }
  if (near) {
    // boarding ladder up the side
    const la = sd * 0.9 + Math.PI / 3;
    for (const o of [-0.18, 0.18]) rod(g, at(la + o / 1.45, rFn(0.1) + 0.2, 0.05), at(la + o / 1.45, rt + 0.06, dy + 0.12), 0.02, steel, MET, 4);
    for (let y = 0.25; y < dy; y += 0.3) { const rr = rFn(y) + 0.08; rod(g, at(la - 0.18 / 1.45, rr, y), at(la + 0.18 / 1.45, rr, y), 0.014, steel, MET, 3); }
    // the mooring bridle: two lugs under the fender, chain from each down to a shackle, and the riser going on below
    const ba = sd * 0.9 + 2.3, low = [0, -2.3, 0];
    for (const s of [0, Math.PI]) { const p = at(ba + s, rFn(-0.2) + 0.06, -0.2); box(g, p, 0.03, 0.09, 0.09, steel, MET, { yaw: ba + s }); chain(g, [p[0], p[1] - 0.05, p[2]], low, [0.22, 0.2, 0.18], MET, { link: 0.16, r: 0.02 }); }
    // the operator's letters round the float, and the mark's own number stencilled under them
    const word = port ? 'TIDAL P' : 'TIDAL S', y0 = port ? 0.62 : 0.72, rr = rFn(y0 + 0.1) + 0.012;
    for (const a0 of [inw > 0 ? 0.2 : 3.3, inw > 0 ? 3.3 : 0.2]) [...word].forEach((ch, k) => { const a = a0 - (k - word.length / 2) * (0.2 / rr); text(g, ch, at(a, rr, y0), [Math.sin(a), 0, -Math.cos(a)], port ? [0, 1, 0] : [-Math.cos(a) * 0.34, 0.94, -Math.sin(a) * 0.34], 0.2, [0.8, 0.8, 0.76], RUB, { off: 0.004, weight: 0.2 }); });
  }

  // ---- tower ----
  const y0 = deckTop, yT = port ? 4.1 : 4.5, hb = port ? 0.55 : 0.46, ht = 0.27, bays = 3;
  const hw = (y) => lerp(hb, ht, (y - y0) / (yT - y0));
  const corner = (y, k) => { const w = hw(y); return [[w, y, w], [-w, y, w], [-w, y, -w], [w, y, -w]][k]; };
  box(g, [0, y0 + 0.025, 0], hb + 0.1, 0.025, hb + 0.1, [0.2, 0.2, 0.21], MET);
  for (let k = 0; k < 4; k++) rod(g, corner(y0, k), corner(yT, k), far ? 0.07 : 0.05, steel, MET, far ? 3 : lod ? 4 : 6);
  for (const b of far ? [bays] : lod ? [0, bays] : [0, 1, 2, 3]) {
    const y = y0 + ((yT - y0) * b) / bays;
    for (let k = 0; k < 4; k++) rod(g, corner(y, k), corner(y, (k + 1) % 4), far ? 0.05 : 0.032, steel, MET, far ? 3 : 4);
  }
  if (!far) for (let b = 0; b < bays; b++) {
    const ya = y0 + ((yT - y0) * b) / bays, yb = y0 + ((yT - y0) * (b + 1)) / bays;
    for (let k = 0; k < 4; k++) { rod(g, corner(ya, k), corner(yb, (k + 1) % 4), lod ? 0.03 : 0.02, steel, MET, lod ? 3 : 4); if (near) rod(g, corner(ya, (k + 1) % 4), corner(yb, k), 0.02, steel, MET, 4); }
  }
  // rungs up one corner post, a battery box on the deck with its conduit up the tower
  if (near) {
    for (let y = y0 + 0.35; y < yT - 0.2; y += 0.3) { const c = corner(y, 2); rod(g, c, [c[0] - 0.2, y, c[2] - 0.2 * 0], 0.011, steel, MET, 3); }
    const bz = -inw * 0.82;
    box(g, [0.25, y0 + 0.24, bz], 0.3, 0.22, 0.2, [0.42, 0.44, 0.42], GEL); box(g, [0.25, y0 + 0.475, bz], 0.33, 0.015, 0.23, [0.36, 0.38, 0.36], GEL);
    box(g, [0.25, y0 + 0.3, bz - inw * -0.205], 0.05, 0.035, 0.008, [0.55, 0.45, 0.1], MET);
    tube(g, [[0.5, y0 + 0.35, bz], [0.52, y0 + 0.5, bz + inw * 0.3], corner(y0 + 0.6, 3), corner(yT - 0.3, 3)].map((p) => [p[0] + 0.03, p[1], p[2]]), 0.014, dark, RUB, { segs: 4 });
  }
  // number plates on the four faces of the lowest bay
  const yp = y0 + (yT - y0) / bays * 0.52;
  if (near) for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) plate(g, [nx * (hw(yp) + 0.05), yp, nz * (hw(yp) + 0.05)], [nx, 0, nz], [nz, 0, -nx]);
  else for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const hh = hw(yp) + 0.04, r = [nz, 0, -nx]; quad(g, [nx * hh - r[0] * 0.4, yp - 0.27, nz * hh - r[2] * 0.4], [nx * hh + r[0] * 0.4, yp - 0.27, nz * hh + r[2] * 0.4], [nx * hh + r[0] * 0.4, yp + 0.27, nz * hh + r[2] * 0.4], [nx * hh - r[0] * 0.4, yp + 0.27, nz * hh - r[2] * 0.4], [0.75, 0.75, 0.72], RUB); }

  // top platform, then the topmark (the shape that says port or starboard), the lantern and the reflector
  const hp = ht + 0.1;
  box(g, [0, yT + 0.01, 0], hp, 0.03, hp, [0.2, 0.2, 0.21], MET);
  paint(g, m0, metal);
  const yb = yT + 0.04, TM = mat(MAT.GELCOAT, 0, 0.1);
  lathe(g, port ? [[0, yb], [0.4, yb], [0.4, yb], [0.4, yb + 0.7], [0.4, yb + 0.7], [0, yb + 0.7]] : [[0, yb], [0.52, yb], [0.52, yb], [0.24, yb + 0.85], [0.24, yb + 0.85], [0, yb + 0.85]], paintC, TM, { segs: far ? 8 : lod ? 14 : 32, paint: far ? undefined : (P, N, C, i) => { const k = 0.82 + 0.3 * fb(P[i] * 3 + sd, P[i + 1] * 3, P[i + 2] * 3); C[i] *= k; C[i + 1] *= k; C[i + 2] *= k; mixIn(C, i, 0.8, 0.8, 0.76, smooth(0.8, 0.86, vn(P[i] * 7 + sd, P[i + 1] * 7, P[i + 2] * 7)) * (N[i + 1] > 0.5 ? 0.8 : 0)); } });
  const yLant = yb + (port ? 0.7 : 0.85);
  let tip;
  if (far) { lathe(g, [[0.3, yLant], [0.3, yLant + 0.2], [0.22, yLant + 0.2], [0.22, yLant + 0.72], [0.3, yLant + 0.74], [0.04, yLant + 0.95]], lens, mat(MAT.GELCOAT, 0, 1), { segs: 8 }); tip = yLant + 0.96; }
  else tip = lantern(g, yLant, lens, { lod: lod ? 1 : 0, r: 0.2, h: 0.5, steel, dark });
  g.lamp = yLant + 0.2 + 0.25;                         // height of the lens centre, for the glow
  rod(g, [0, tip, 0], [0, tip + 0.28, 0], far ? 0.03 : 0.018, steel, MET, 4);
  radarReflector(g, [0, tip + 0.46, 0], 0.27, steel, near ? 14 : far ? 6 : 8);

  // ---- solar panels on brackets, tilted up and out: one toward the gate, one away from it ----
  if (!far) for (const s of near ? [inw, -inw] : [inw]) {
    const t = (35 * Math.PI) / 180, nrm = [0, Math.cos(t), s * Math.sin(t)], sv = [0, Math.sin(t), -s * Math.cos(t)], C0 = [0, yT - 0.5, s * 0.9];
    const P = (a, b, o = 0) => [C0[0] + a + nrm[0] * o, C0[1] + sv[1] * b + nrm[1] * o, C0[2] + sv[2] * b + nrm[2] * o], W = 0.36, D = 0.27;
    quad(g, P(-W, -D), P(W, -D), P(W, D), P(-W, D), [0.4, 0.42, 0.45], MET);
    if (near) {
      const fr0 = [P(-W, -D), P(W, -D), P(W, D), P(-W, D)];
      tube(g, fr0, 0.014, [0.7, 0.72, 0.75], MET, { segs: 4, closed: true });
      for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) { const a0 = lerp(-W, W, i / 6) + 0.01, a1 = lerp(-W, W, (i + 1) / 6) - 0.01, b0 = lerp(-D, D, j / 4) + 0.01, b1 = lerp(-D, D, (j + 1) / 4) - 0.01; quad(g, P(a0, b0, 0.006), P(a1, b0, 0.006), P(a1, b1, 0.006), P(a0, b1, 0.006), [0.07, 0.1, 0.3], GLS); }
      for (const sx of [-1, 1]) { rod(g, P(sx * W * 0.8, -D), [sx * hw(yT - 0.35), yT - 0.35, s * hw(yT - 0.35)], 0.016, steel, MET, 4); rod(g, P(sx * W * 0.8, D * 0.9), [sx * hw(yT - 0.1), yT - 0.1, s * hw(yT - 0.1)], 0.016, steel, MET, 4); }
    } else quad(g, P(-W + 0.02, -D + 0.02, 0.04), P(W - 0.02, -D + 0.02, 0.04), P(W - 0.02, D - 0.02, 0.04), P(-W + 0.02, D - 0.02, 0.04), [0.07, 0.1, 0.3], GLS);
  }
  void xf; void frame;
  return g;
}
