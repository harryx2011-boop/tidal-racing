import { Geo, MAT } from '../geo.js';
import { PORT, STBD, LENS_PORT, LENS_STBD, revolve, rod, plate, lantern, radarReflector, recolour, seaStain, noise3, fbm, smooth, mixc, clamp, lerp } from './marks.js';

// A lateral navigation buoy, IALA region A: red with a flat-topped can to port, green with a cone to
// starboard. A wide painted float with a rubber fender belt and lifting eyes, a galvanised
// lattice tower with number plates, a solar panel, a flashing lantern under a radar reflector.
// y = 0 is the waterline; the mark stands about 6.5 m clear of it. The paint is faded and the steel
// rusted, weed and a tide line mark the waterline: all baked into vertex colours.
// side: 'port' | 'stbd'; seed varies the weathering; lod 1 is a cheap version for distance.

export const BUOY = { radius: 1.5, height: 6.6 };

export function buoyGeo(side = 'port', { seed = 1, lod = 0 } = {}) {
  const g = new Geo();
  const port = side === 'port';
  const paint = port ? PORT : STBD, lens = port ? LENS_PORT : LENS_STBD;
  const inw = port ? 1 : -1;                         // toward the other mark of the gate
  const steel = [0.52, 0.54, 0.57], dark = [0.06, 0.065, 0.07];
  const SEG = lod ? 20 : 120;
  const sd = seed * 7.13;

  // ---- float ----
  // radius of the body at height y (below the waterline it rounds off into the keel)
  const top = port ? 1.06 : 1.95;                    // top of the straight side
  const rFn = port
    ? (y) => (y >= 0 ? 1.48 - 0.07 * (y / 1.1) : 1.48 * Math.pow(Math.max(1 - Math.pow(-y / 0.9, 3), 0), 0.5))
    : (y) => (y >= 0 ? 1.5 - 0.7 * (y / 1.95) : 1.5 * Math.pow(Math.max(1 - Math.pow(-y / 0.9, 3), 0), 0.5));
  const ys = lod ? [-0.9, -0.55, -0.15, 0, 0.4, top * 0.7, top] : [-0.9, -0.86, -0.78, -0.66, -0.52, -0.38, -0.26, -0.14, -0.05, 0.03, 0.1, 0.17, 0.24, 0.31, 0.38, 0.46, 0.54, 0.64, 0.75, 0.87, 1.0, 1.0 + (top - 1.0) * 0.5, top].filter((y, i, a) => y <= top && a.indexOf(y) === i);
  const prof = ys.map((y) => [rFn(y), y]);
  const rt = rFn(top), dy = top;
  // rolled rim, then the deck rising a little to the tower flange
  const dk = port ? 0.5 : 0.42;
  prof.push([rt + 0.035, dy + 0.035], [rt + 0.04, dy + 0.09], [rt, dy + 0.13], [rt - 0.09, dy + 0.14]);
  const deckTop = dy + 0.14 + 0.1;
  prof.push([lerp(rt - 0.09, dk + 0.1, 0.5), dy + 0.14 + 0.06], [dk + 0.1, deckTop - 0.01], [dk, deckTop]);
  revolve(g, prof, paint, [MAT.RUBBER, 0, 0], SEG);
  // fender belt
  const fr = (y) => rFn(y);
  const fenderYs = lod ? [-0.28, -0.1, 0.1, 0.26] : [-0.3, -0.22, -0.1, 0.0, 0.1, 0.2, 0.28];
  const fofs = (y) => 0.11 * Math.sqrt(Math.max(1 - Math.pow((y - 0.0) / 0.3, 2), 0)) + 0.01;
  revolve(g, fenderYs.map((y) => [fr(y) + fofs(y), y]), dark, [MAT.RUBBER, 0, 0], lod ? 20 : 64);
  // a steel rubbing strake round the rim
  if (!lod) g.tube(Array.from({ length: 41 }, (_, k) => { const a = (k / 40) * 2 * Math.PI; return [Math.cos(a) * (rt + 0.045), dy + 0.065, Math.sin(a) * (rt + 0.045)]; }), 0.03, steel, [MAT.METAL, 0, 0], { segs: 5, closed: false });

  // lifting eyes on the rim, a ladder, flange bolts
  const at = (a, r, y) => [Math.cos(a) * r, y, Math.sin(a) * r];
  if (!lod) {
    for (let k = 0; k < 3; k++) {
      const a = sd * 0.9 + (k * 2 * Math.PI) / 3;
      const cA = Math.cos(a), sA = Math.sin(a), c = at(a, rt + 0.03, dy + 0.2);
      const ring = Array.from({ length: 14 }, (_, j) => { const t = (j / 14) * 2 * Math.PI; return [c[0] + cA * Math.cos(t) * 0.13, c[1] + Math.sin(t) * 0.13 + 0.06, c[2] + sA * Math.cos(t) * 0.13]; });
      g.tube(ring, 0.024, steel, [MAT.METAL, 0, 0], { segs: 5, closed: true });
    }
    const la = sd * 0.9 + Math.PI / 3;
    for (const o of [-0.18, 0.18]) {
      const a = la + o / 1.45;
      rod(g, at(a, rFn(0.1) + 0.2, 0.05), at(a, rt + 0.06, dy + 0.12), 0.02, steel, [MAT.METAL, 0, 0], 4);
    }
    for (let y = 0.25; y < dy; y += 0.3) { const rr = rFn(y) + 0.08; rod(g, at(la - 0.18 / 1.45, rr, y), at(la + 0.18 / 1.45, rr, y), 0.014, steel, [MAT.METAL, 0, 0], 3); }
  }

  // ---- tower ----
  const y0 = deckTop, yT = port ? 4.1 : 4.5, hb = port ? 0.55 : 0.46, ht = 0.27, bays = 3;
  const hw = (y) => lerp(hb, ht, (y - y0) / (yT - y0));
  const corner = (y, k) => { const w = hw(y); return [[w, y, w], [-w, y, w], [-w, y, -w], [w, y, -w]][k]; };
  g.box(-hb - 0.1, hb + 0.1, y0, y0 + 0.05, -hb - 0.1, hb + 0.1, [0.2, 0.2, 0.21], [MAT.METAL, 0, 0]);
  for (let k = 0; k < 4; k++) rod(g, corner(y0, k), corner(yT, k), 0.05, steel, [MAT.METAL, 0, 0], lod ? 4 : 6);
  const rings = lod ? [0, bays] : [0, 1, 2, 3];
  for (const b of rings) {
    const y = y0 + ((yT - y0) * b) / bays;
    for (let k = 0; k < 4; k++) rod(g, corner(y, k), corner(y, (k + 1) % 4), 0.032, steel, [MAT.METAL, 0, 0], 4);
  }
  if (!lod) for (let b = 0; b < bays; b++) {
    const ya = y0 + ((yT - y0) * b) / bays, yb = y0 + ((yT - y0) * (b + 1)) / bays;
    for (let k = 0; k < 4; k++) {
      rod(g, corner(ya, k), corner(yb, (k + 1) % 4), 0.02, steel, [MAT.METAL, 0, 0], 4);
      rod(g, corner(ya, (k + 1) % 4), corner(yb, k), 0.02, steel, [MAT.METAL, 0, 0], 4);
    }
  }
  // number plates on the four faces of the lowest bay
  const yp = y0 + (yT - y0) / bays * 0.52;
  if (!lod) for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) plate(g, [nx * (hw(yp) + 0.05), yp, nz * (hw(yp) + 0.05)], [nx, 0, nz], [nz, 0, -nx]);
  else for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const hh = hw(yp) + 0.04, c = [nx * hh, yp, nz * hh], r = [nz, 0, -nx]; g.quad([c[0] - r[0] * 0.4, yp - 0.27, c[2] - r[2] * 0.4], [c[0] + r[0] * 0.4, yp - 0.27, c[2] + r[2] * 0.4], [c[0] + r[0] * 0.4, yp + 0.27, c[2] + r[2] * 0.4], [c[0] - r[0] * 0.4, yp + 0.27, c[2] - r[2] * 0.4], [0.75, 0.75, 0.72], [MAT.RUBBER, 0, 0], [nx, 0, nz]); }

  // top platform, then the topmark (the shape that says port or starboard), the lantern and the reflector
  const hp = ht + 0.1;
  g.box(-hp, hp, yT - 0.02, yT + 0.04, -hp, hp, [0.2, 0.2, 0.21], [MAT.METAL, 0, 0]);
  const yb = yT + 0.04;
  const tm = port
    ? [[0, yb], [0.4, yb], [0.4, yb], [0.4, yb + 0.7], [0.4, yb + 0.7], [0, yb + 0.7]]
    : [[0, yb], [0.52, yb], [0.52, yb], [0.24, yb + 0.85], [0.24, yb + 0.85], [0, yb + 0.85]];
  revolve(g, tm, paint, [MAT.GELCOAT, 0, 0.1], lod ? 14 : 36);
  const yLant = yb + (port ? 0.7 : 0.85);
  const tip = lantern(g, yLant, lens, { lod, r: 0.2, h: 0.5, steel, dark });
  g.lamp = yLant + 0.2 + 0.25;                         // height of the lens centre, for the glow
  rod(g, [0, tip, 0], [0, tip + 0.28, 0], 0.018, steel, [MAT.METAL, 0, 0], 4);
  if (!lod) radarReflector(g, [0, tip + 0.46, 0], 0.27, steel); else radarReflector(g, [0, tip + 0.46, 0], 0.27, steel, 8);

  // ---- solar panel on a bracket, tilted up and out on the side that faces the gate ----
  if (!lod) {
    const t = (35 * Math.PI) / 180, o = [0, 0, inw], up = [0, 1, 0];
    const nrm = [0, Math.cos(t), inw * Math.sin(t)];
    const sv = [0, Math.sin(t), -inw * Math.cos(t)];     // up the slope, toward the tower
    const C = [0, yT - 0.5, inw * 0.9];
    const P = (a, b) => [C[0] + a, C[1] + sv[1] * b, C[2] + sv[2] * b];
    void o; void up;
    const W = 0.36, D = 0.27;
    // frame
    const fr0 = [P(-W, -D), P(W, -D), P(W, D), P(-W, D)];
    for (let k = 0; k < 4; k++) rod(g, fr0[k], fr0[(k + 1) % 4], 0.014, [0.7, 0.72, 0.75], [MAT.METAL, 0, 0], 4);
    // cells: dark blue glass with thin gaps
    const nu = 6, nv = 4, cg = 0.01;
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      const a0 = lerp(-W, W, i / nu) + cg, a1 = lerp(-W, W, (i + 1) / nu) - cg, b0 = lerp(-D, D, j / nv) + cg, b1 = lerp(-D, D, (j + 1) / nv) - cg;
      const e = nrm.map((x) => x * 0.006);
      const q = (a, b) => { const p = P(a, b); return [p[0] + e[0], p[1] + e[1], p[2] + e[2]]; };
      g.quad(q(a0, b0), q(a1, b0), q(a1, b1), q(a0, b1), [0.07, 0.1, 0.3], [MAT.GLASS, 0, 0], nrm);
    }
    g.quad(P(-W, -D), P(W, -D), P(W, D), P(-W, D), [0.4, 0.42, 0.45], [MAT.METAL, 0, 0], nrm);
    // bracket struts to the tower's top corners
    for (const sx of [-1, 1]) {
      rod(g, P(sx * W * 0.8, -D), [sx * hw(yT - 0.35), yT - 0.35, inw * hw(yT - 0.35)], 0.016, steel, [MAT.METAL, 0, 0], 4);
      rod(g, P(sx * W * 0.8, D * 0.9), [sx * hw(yT - 0.1), yT - 0.1, inw * hw(yT - 0.1)], 0.016, steel, [MAT.METAL, 0, 0], 4);
    }
  }

  // ---- weathering ----
  const rimY = dy + 0.1;
  recolour(g, (p, n, c, mid) => {
    const [x, y, z] = p;
    const rad = Math.hypot(x, z);
    let col = c;
    const body = mid === MAT.RUBBER && c[0] + c[1] + c[2] > 0.18;
    if (mid === MAT.METAL) {
      const m = fbm(x * 4 + sd, y * 4, z * 4);
      col = [c[0] * (0.62 + 0.55 * m), c[1] * (0.62 + 0.55 * m), c[2] * (0.62 + 0.55 * m)];
      // rust: patchy everywhere, worst low down and at the flange
      const patch = smooth(0.6, 0.82, noise3(x * 12 + sd, y * 7, z * 12));
      col = mixc(col, [0.36, 0.16, 0.07], patch * (0.55 + 0.3 * smooth(3.5, y0, y)));
      // dark staining under the platform and the lantern housing
    } else if (body || mid === MAT.GELCOAT) {
      // sun-faded, chalky paint: lighter and greyer on the tops, blotchy
      const up = clamp(n[1], 0, 1);
      const fade = clamp(0.28 + 0.5 * fbm(x * 1.2 + sd, y * 1.2, z * 1.2) + 0.25 * up + 0.04 * y, 0, 1) * 0.5;
      col = mixc(c, [c[0] * 0.55 + 0.27, c[1] * 0.55 + 0.26, c[2] * 0.55 + 0.25], fade);
      const bl = 0.8 + 0.4 * fbm(x * 3 + sd, y * 3, z * 3);
      col = [col[0] * bl, col[1] * bl, col[2] * bl];
      // vertical rust and dirt streaks from the rim, the lifting eyes and the flange
      if (mid === MAT.RUBBER) {
        const u = Math.atan2(z, x) * rad;
        const n1 = (q) => noise3(q, sd, 0.3);
        const len = 0.35 + 1.5 * n1(u * 1.7 + 4);
        const dist = rimY - y;
        const st = smooth(0.5, 0.7, n1(u * 4.2)) * smooth(-0.05, 0.05, dist) * smooth(len, 0.0, dist);
        // the three lifting eyes make thick streaks of their own
        let eyes = 0;
        for (let k = 0; k < 3; k++) { let da = Math.atan2(z, x) - (sd * 0.9 + (k * 2 * Math.PI) / 3); da = Math.atan2(Math.sin(da), Math.cos(da)); eyes = Math.max(eyes, Math.exp(-Math.pow(da * rad / 0.1, 2))); }
        const es = eyes * smooth(1.3, 0.0, dist) * smooth(-0.05, 0.05, dist) * (0.6 + 0.4 * n1(u * 9));
        const rust = clamp(st * 0.8 + es * 0.9, 0, 1);
        col = mixc(col, mixc([0.46, 0.22, 0.05], [0.12, 0.05, 0.028], n1(y * 7 + u * 3)), rust * 0.95);
        // bare, rusted patches where the paint has gone
        const bare = smooth(0.7, 0.8, fbm(x * 2.6 + sd, y * 2.6, z * 2.6)) * (0.35 + 0.65 * smooth(0.9, 0.0, Math.abs(y - rimY)) + 0.5 * smooth(0.55, 0.1, y));
        col = mixc(col, mixc([0.4, 0.17, 0.08], [0.22, 0.1, 0.05], fbm(x * 12, y * 12, z * 12)), clamp(bare, 0, 1) * 0.85);
        // rust ring round the tower flange
        const fl = smooth(dk + 0.45, dk + 0.12, rad) * smooth(rimY - 0.2, rimY + 0.05, y);
        col = mixc(col, [0.3, 0.14, 0.07], fl * 0.7 * (0.5 + 0.5 * fbm(x * 9, y * 9, z * 9)));
      }
    }
    // bird droppings on whatever faces up
    const sp = smooth(0.84, 0.86, noise3(x * 7 + sd, y * 7, z * 7)) * smooth(0.45, 0.85, n[1]) * smooth(0.6, 1.0, y);
    col = mixc(col, [0.82, 0.82, 0.78], sp * 0.85);
    return seaStain(col, p, sd, { weedTop: 0.32, tide: 0.4 });
  });
  return g;
}
