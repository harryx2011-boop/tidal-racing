// A seated driver, built in code. Model space: the hip point is the origin, the driver faces +x,
// y is up, z is to their right. A 1.78 m adult, knees bent, both hands on the wheel rim; the
// wheel hub is 0.65 ahead of and 0.31 above the hip (BOAT_ANCHORS.helm / .wheel) and its plane
// tilts back toward the driver.
//
// Everything is a loft through elliptical sections (limbs, torso, jacket) or a parametric patch
// (helmet), so the pose reads as one body from the chase camera and still holds up a few
// metres away. Cloth uses the upholstery material with glow 1 (a plain woven fabric, no
// quilting); skin uses glow 2.
import { Geo, MAT, add, sub, cross, norm, dot } from '../geo.js';

const lerp = (a, b, t) => a + (b - a) * t;
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const sp = (c, p) => Math.sign(c) * Math.pow(Math.abs(c), 2 / p);
const clamp = (x, a, b) => Math.min(Math.max(x, a), b);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const RAD = Math.PI / 180;

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return [0, 1, 2].map((i) => 0.5 * (2 * p1[i] + (-p0[i] + p2[i]) * t + (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2 + (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3));
}

// A smooth limb-like solid along a spline through `pts`, with an elliptical section of half
// extents ea (along the hint direction projected square to the path) and eb (the other way) at
// every control point. Ends are rounded off. p > 2 squares the section.
function tubeE(g, pts, ea, eb, col, mat, { hint = [0, 0, 1], segs = 10, per = 2, caps = [true, true], p = 2 } = {}) {
  const n = pts.length, P = [], A = [], B = [];
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(i - 1, 0)], p3 = pts[Math.min(i + 2, n - 1)];
    for (let k = 0; k < per; k++) {
      const t = k / per, s = t * t * (3 - 2 * t);
      P.push(catmull(p0, pts[i], pts[i + 1], p3, t)); A.push(lerp(ea[i], ea[i + 1], s)); B.push(lerp(eb[i], eb[i + 1], s));
    }
  }
  P.push(pts[n - 1]); A.push(ea[n - 1]); B.push(eb[n - 1]);
  const m = P.length, T = P.map((_, i) => norm(sub(P[Math.min(i + 1, m - 1)], P[Math.max(i - 1, 0)])));
  const frame = (t) => {
    let u = sub(hint, scale(t, dot(hint, t)));
    if (dot(u, u) < 1e-6) u = sub([1, 0, 0], scale(t, t[0]));
    u = norm(u);
    return [u, cross(t, u)];
  };
  const sect = (c, t, a, b) => {
    const [u, v] = frame(t);
    return Array.from({ length: segs }, (_, k) => {
      const th = (k / segs) * 2 * Math.PI;
      return add(c, add(scale(u, a * sp(Math.cos(th), p)), scale(v, b * sp(Math.sin(th), p))));
    });
  };
  const rings = [], refs = [];
  const cap = (i, sgn) => {
    const out = [];
    for (const th of [90, 55, 22]) {
      const o = Math.sin(th * RAD), s = Math.cos(th * RAD), r = (A[i] + B[i]) / 2;
      out.push([add(P[i], scale(T[i], sgn * o * r)), s]);
    }
    return out;
  };
  if (caps[0]) for (const [c, s] of cap(0, -1)) { rings.push(sect(c, T[0], A[0] * s, B[0] * s)); refs.push(P[0]); }
  for (let i = 0; i < m; i++) { rings.push(sect(P[i], T[i], A[i], B[i])); refs.push(P[i]); }
  if (caps[1]) for (const [c, s] of cap(m - 1, 1).reverse()) { rings.push(sect(c, T[m - 1], A[m - 1] * s, B[m - 1] * s)); refs.push(P[m - 1]); }
  g.loft(rings, col, mat, { ref: (i) => refs[i] });
}

// ellipsoid with axes along x, y, z
function blob(g, c, rx, ry, rz, col, mat, { n = 6, segs = 10, p = 2 } = {}) {
  const rings = [];
  for (let i = 0; i <= n; i++) {
    const a = ((i / n) * 180 - 90) * RAD, ca = Math.cos(a), sa = Math.sin(a);
    rings.push(Array.from({ length: segs }, (_, k) => {
      const th = (k / segs) * 2 * Math.PI;
      return [c[0] + rx * ca * sp(Math.cos(th), p), c[1] + ry * sa, c[2] + rz * ca * sp(Math.sin(th), p)];
    }));
  }
  g.loft(rings, col, mat, { ref: () => c });
}

// a flat strap (webbing) along a path: path points with outward normals, width w, thickness t
function strap(g, pts, nrm, w, t, col, mat) {
  const path = pts.map((p, i) => ({ p, n: nrm[i] }));
  g.sweep(path, [[t, -w], [t, w], [-t, w], [-t, -w], [t, -w]], col, mat, { hard: true, up: [0, 1, 0] });
}

export { tubeE, blob };
// part: 'all' (the whole driver) or 'arms' (sleeves and gloves on the wheel, for the helm camera,
// where the head and body would sit around the lens)
export function driverGeo(part = 'all') {
  const g = new Geo();
  const SUIT = [0.045, 0.06, 0.1], SHIRT = [0.07, 0.085, 0.12], VEST = [0.86, 0.2, 0.03], VEST2 = [0.16, 0.17, 0.19];
  const WEB = [0.03, 0.03, 0.035], GLOVE = [0.035, 0.036, 0.04], GRIP = [0.82, 0.2, 0.04], SKIN = [0.62, 0.43, 0.32];
  const SHOE = [0.62, 0.58, 0.5], SOLE = [0.86, 0.84, 0.78], VISOR = [0.02, 0.02, 0.025], CHROME = [0.74, 0.76, 0.79], HELM = [0.85, 0.86, 0.87];
  const CLOTH = [MAT.UPHOLSTERY, 0, 1], SKINM = [MAT.UPHOLSTERY, 0, 2], RUB = [MAT.RUBBER, 0, 0], METAL = [MAT.METAL, 0, 0];
  const body = part === 'all', arms = part === 'all' || part === 'arms';
  const HELMM = [MAT.PAINT, 1, 0];
  const mirror = (f) => { f(1); f(-1); };

  // wheel: hub, rim point at 3 o'clock and the direction toward the driver (see boat.js)
  const HUB = [0.65, 0.31, 0], A = norm([-0.78, 0.62, 0]), E2 = cross(A, [0, 0, 1]);

  if (body) {
    // ---- torso: elliptical sections, leaning forward a little; centre x(y), half width, half depth ----
    const cx = (y) => -0.02 + 0.07 * (y / 0.55);
    const sec = (y, a, b, p = 2.6, n = 14, k = 0) => Array.from({ length: n }, (_, j) => {
      const th = (j / n) * 2 * Math.PI;
      return [cx(y) + (b + k) * sp(Math.cos(th), p), y, (a + k) * sp(Math.sin(th), p)];
    });
    // [y, half width, half depth]: seat, belly, waist, chest, shoulders
    const T = [[-0.02, 0.15, 0.12], [0.04, 0.165, 0.135], [0.2, 0.148, 0.118], [0.36, 0.172, 0.128], [0.48, 0.19, 0.115], [0.55, 0.15, 0.095], [0.585, 0.075, 0.07], [0.6, 0.06, 0.06]];
    const tr = T.map(([y, a, b]) => sec(y, a, b, 2.4));
    tr.push(sec(0.6, 0, 0).map(() => [cx(0.6), 0.608, 0]));
    g.loft(tr, SHIRT, CLOTH, { ref: (i) => [cx(T[Math.min(i, T.length - 1)][0]), T[Math.min(i, T.length - 1)][0], 0] });
    // pelvis and trousers waistband blend
    // life jacket: a slightly larger shell from the belly to the shoulders, open at the neck
    const J = [[0.1, 0.178, 0.148], [0.2, 0.172, 0.14], [0.36, 0.2, 0.148], [0.47, 0.215, 0.137], [0.535, 0.17, 0.112], [0.57, 0.105, 0.092]];
    const jr = J.map(([y, a, b]) => sec(y, a, b, 2.7, 28));
    g.loft(jr, VEST, CLOTH, { ref: (i) => [cx(J[i][0]), J[i][0], 0] });
    // jacket bottom hem: a darker bound edge
    g.tube(sec(0.1, 0.178, 0.148, 2.7, 16).concat([sec(0.1, 0.178, 0.148, 2.7, 16)[0]]), 0.007, VEST2, CLOTH, { segs: 5 });
    // point on the jacket surface at height y, angle th (0 = straight ahead, + toward +z), lifted by off
    const jy = (y) => {
      let i = 0; while (i < J.length - 2 && y > J[i + 1][0]) i++;
      const t = clamp((y - J[i][0]) / (J[i + 1][0] - J[i][0]), 0, 1);
      return [lerp(J[i][1], J[i + 1][1], t), lerp(J[i][2], J[i + 1][2], t)];
    };
    const jp = (y, th, off = 0.004) => {
      const [a, b] = jy(y);
      const c = Math.cos(th), s = Math.sin(th);
      return [cx(y) + (b + off) * sp(c, 2.7), y, (a + off) * sp(s, 2.7)];
    };
    const jn = (y, th) => { const c = Math.cos(th), s = Math.sin(th); return norm([sp(c, 2.7) / jy(y)[1] * 0.5 + c * 0.5, 0, sp(s, 2.7) / jy(y)[0] * 0.5 + s * 0.5]); };
    // panels: foam panel seams as dark piping; a centre zip with a pull
    const line = (y0, y1, th, n = 6) => Array.from({ length: n + 1 }, (_, k) => jp(lerp(y0, y1, k / n), th, 0.003));
    g.tube(line(0.11, 0.545, 0, 6), 0.0065, WEB, CLOTH, { segs: 5 });
    g.box(cx(0.5) + 0.125, cx(0.5) + 0.138, 0.485, 0.515, -0.007, 0.007, CHROME, METAL);
    mirror((s) => {
      g.tube(line(0.13, 0.5, s * 0.55, 5), 0.005, VEST2, CLOTH, { segs: 5 });
      // chest panel's lower edge
      g.tube(Array.from({ length: 7 }, (_, k) => jp(0.31 + 0.012 * k * 0, s * lerp(0.05, 1.45, k / 6), 0.003)), 0.005, VEST2, CLOTH, { segs: 5 });
    });
    // two waist straps with buckles that cinch the jacket
    for (const [y, w] of [[0.17, 0.02], [0.27, 0.017]]) {
      const pts = [], nr = [];
      for (let k = 0; k <= 10; k++) { const th = (k / 10) * 2 * Math.PI; pts.push(jp(y, th, 0.006)); nr.push(jn(y, th)); }
      strap(g, pts, nr, w, 0.004, WEB, CLOTH);
      // buckle on the front, a quick-release block off the centre line
      const b = jp(y, 0.28, 0.012);
      g.box(b[0] - 0.012, b[0] + 0.012, y - 0.022, y + 0.022, b[2] - 0.026, b[2] + 0.026, [0.06, 0.06, 0.065], [MAT.RUBBER, 0, 0]);
      g.box(b[0] + 0.009, b[0] + 0.015, y - 0.014, y + 0.014, b[2] - 0.018, b[2] + 0.018, CHROME, METAL);
    }
    // shoulder straps, a collar, and a reflective tab
    mirror((s) => {
      const pts = [], nr = [];
      for (let k = 0; k <= 8; k++) {
        const t = k / 8, y = lerp(0.5, 0.585, t), th = s * lerp(0.55, 1.5, t);
        pts.push(jp(y, th, 0.01)); nr.push(jn(y, th));
      }
      strap(g, pts, nr, 0.022, 0.005, WEB, CLOTH);
    });
    // collar: a padded roll behind and beside the neck
    {
      const ring = Array.from({ length: 15 }, (_, k) => { const th = (k / 14) * 2 * Math.PI; return [cx(0.6) + 0.02 + 0.07 * Math.cos(th), 0.587 + 0.012 * Math.cos(th - 2.4), 0.085 * Math.sin(th)]; });
      g.tube(ring, 0.027, VEST, CLOTH, { segs: 6, closed: true });
    }
    // shoulders: deltoids rounded over the arm joint
    mirror((s) => blob(g, [cx(0.5) + 0.012, 0.493, s * 0.2], 0.066, 0.068, 0.062, SHIRT, CLOTH, { n: 6, segs: 10 }));

    // ---- neck and head ----
    const HC = [0.07, 0.805, 0];
    tubeE(g, [[0.03, 0.57, 0], [0.045, 0.64, 0], [0.065, 0.72, 0]], [0.052, 0.048, 0.05], [0.055, 0.05, 0.052], SKIN, SKINM, { hint: [0, 0, 1], caps: [false, false], segs: 8 });
    // face and head under the helmet
    blob(g, [HC[0] + 0.025, HC[1] - 0.012, 0], 0.092, 0.115, 0.078, SKIN, SKINM, { n: 6, segs: 10 });
    blob(g, [HC[0] + 0.115, HC[1] - 0.03, 0], 0.03, 0.026, 0.02, SKIN, SKINM, { n: 6, segs: 10 });          // nose
    blob(g, [HC[0] + 0.1, HC[1] - 0.105, 0], 0.035, 0.028, 0.045, SKIN, SKINM, { n: 6, segs: 10 });         // chin

    // helmet shell: dome of a parametric ellipsoid; the front below the brow is the face opening
    const HX = HC[0] - 0.015, HY = HC[1], AX = 0.172, AY = 0.152, AZ = 0.148;
    const TO = 62 * RAD, PB = 30 * RAD;
    const phiRim = (th) => (-26 - 24 * smooth(TO, Math.PI, Math.abs(th > Math.PI ? 2 * Math.PI - th : th))) * RAD;
    const shell = (off) => (u, th, phi) => {
      const f = phi, ca = Math.cos(f), sa = Math.sin(f);
      return [HX + (AX + off) * ca * Math.cos(th), HY + (AY + off) * sa, (AZ + off) * ca * Math.sin(th)];
    };
    const sh0 = shell(0);
    const FULL = (u, th) => sh0(0, th, lerp(PB, Math.PI / 2, u));
    g.surf((u, th) => FULL(u, th), lin(0, 1, 5), lin(0, 2 * Math.PI, 24), HELM, HELMM, { away: [HX, HY, 0] });
    g.surf((u, th) => { const r = phiRim(th); return sh0(0, th, lerp(r, PB, u)); }, lin(0, 1, 5), lin(TO, 2 * Math.PI - TO, 18), HELM, HELMM, { away: [HX, HY, 0] });
    // rim bead round the opening and the lower edge
    const rimB = (th, f) => shell(0.004)(0, th, f);
    {
      const op = [];
      for (let k = 0; k <= 8; k++) op.push(rimB(2 * Math.PI - TO, lerp(phiRim(TO), PB, 1 - k / 8)));
      for (let k = 1; k <= 12; k++) op.push(rimB(2 * Math.PI - TO + (2 * TO * k) / 12, PB));
      for (let k = 1; k <= 8; k++) op.push(rimB(TO, lerp(PB, phiRim(TO), k / 8)));
      g.tube(op, 0.007, [0.12, 0.12, 0.13], RUB, { segs: 3 });
      const low = [];
      for (let k = 0; k <= 16; k++) { const th = TO + ((2 * Math.PI - 2 * TO) * k) / 16; low.push(rimB(th, phiRim(th))); }
      g.tube(low, 0.008, [0.12, 0.12, 0.13], RUB, { segs: 3 });
    }
    // a white racing stripe over the crown and a dark vent on each side
    {
      const stripe = (zc) => g.surf((u, v) => { const f = lerp(PB + 0.02, Math.PI / 2, u), th = 0; const q = shell(0.0025)(0, th, f); return [q[0] - 0.0, q[1], zc + (v - 0.5) * 0.03 * Math.cos(f)]; }, lin(0, 1, 8), lin(0, 1, 1), [0.9, 0.9, 0.92], [MAT.GELCOAT, 0, 0], { away: [HX, HY, 0] });
      stripe(0);
      g.surf((u, v) => { const f = lerp(-0.05, 0.35, u); const th = lerp(-0.14, 0.14, v) + Math.PI * 0.5; return shell(0.0025)(0, th, f); }, lin(0, 1, 4), lin(0, 1, 4), [0.06, 0.06, 0.07], [MAT.RUBBER, 0, 0], { away: [HX, HY, 0] });
      g.surf((u, v) => { const f = lerp(-0.05, 0.35, u); const th = lerp(-0.14, 0.14, v) - Math.PI * 0.5; return shell(0.0025)(0, th, f); }, lin(0, 1, 4), lin(0, 1, 4), [0.06, 0.06, 0.07], [MAT.RUBBER, 0, 0], { away: [HX, HY, 0] });
    }
    // tinted visor across the eye opening, held on two pivots
    {
      const f0 = -6 * RAD, f1 = 34 * RAD, tv = 66 * RAD;
      g.surf((u, th) => shell(0.012)(0, th, lerp(f0, f1, u)), lin(0, 1, 5), lin(-tv, tv, 16).map((t) => (t < 0 ? t + 2 * Math.PI : t)), VISOR, [MAT.GLASS, 0, 0], { away: [HX, HY, 0] });
      mirror((s) => blob(g, [shell(0.02)(0, s * (tv + 0.03), 0.1)[0], HY + 0.015, shell(0.02)(0, s * (tv + 0.03), 0.1)[2]], 0.017, 0.017, 0.012, CHROME, METAL, { n: 5, segs: 8 }));
    }
    // chin bar: a padded guard that runs from the cheeks round under the jaw, leaving the mouth open above it
    {
      const yL = HC[1] - 0.125, xs = [[HX + 0.0, 0.118], [HX + 0.07, 0.112], [HX + 0.145, 0.07], [HX + 0.175, 0.0]];
      const half = xs.map(([x, z]) => [x, yL - 0.008 * (x - HX) / 0.175, z]);
      const pts = [];
      for (const [x, y, z] of half.slice().reverse()) pts.push([x, y, -z]);
      for (const [x, y, z] of half.slice(1)) pts.push([x, y, z]);
      tubeE(g, pts, pts.map(() => 0.034), pts.map(() => 0.024), HELM, HELMM, { hint: [0, 1, 0], segs: 8, per: 1 });
      // up from each side of the bar to the shell
      mirror((s) => tubeE(g, [[HX + 0.0, yL + 0.0, s * 0.118], [HX + 0.0, HC[1] - 0.06, s * 0.13]], [0.03, 0.025], [0.014, 0.012], HELM, HELMM, { hint: [1, 0, 0], caps: [false, false], segs: 8 }));
    }
    // chin strap and a small buckle
    mirror((s) => g.tube([[HX + 0.0, HC[1] - 0.1, s * 0.12], [HX + 0.05, HC[1] - 0.17, s * 0.075], [HX + 0.1, HC[1] - 0.18, s * 0.03]], 0.006, WEB, CLOTH, { segs: 5 }));

    // ---- legs ----
    mirror((s) => {
      // thigh: over the seat to the knee; shin: down to the ankle
      tubeE(g, [[-0.02, 0.0, s * 0.1], [0.2, 0.035, s * 0.11], [0.42, 0.045, s * 0.118]], [0.088, 0.083, 0.068], [0.1, 0.085, 0.07], SUIT, CLOTH, { hint: [0, 0, 1], caps: [true, false], segs: 8 });
      blob(g, [0.44, 0.044, s * 0.118], 0.07, 0.07, 0.066, SUIT, CLOTH, { n: 6, segs: 10 });
      tubeE(g, [[0.43, 0.035, s * 0.118], [0.5, -0.17, s * 0.12], [0.545, -0.405, s * 0.12]], [0.064, 0.056, 0.044], [0.064, 0.055, 0.044], SUIT, CLOTH, { hint: [0, 0, 1], caps: [false, false], segs: 8 });
      // trouser cuff gathered above the shoe
      g.tube(Array.from({ length: 9 }, (_, k) => { const a = (k / 8) * 2 * Math.PI; return [0.545 + 0.047 * Math.cos(a), -0.41, s * 0.12 + 0.047 * Math.sin(a)]; }), 0.007, [0.06, 0.07, 0.11], CLOTH, { segs: 5, closed: true });
      // deck shoe: upper, tongue and lace panel, sole
      tubeE(g, [[0.47, -0.462, s * 0.12], [0.56, -0.455, s * 0.12], [0.67, -0.485, s * 0.12], [0.77, -0.5, s * 0.12]], [0.043, 0.047, 0.045, 0.036], [0.05, 0.048, 0.03, 0.022], SHOE, CLOTH, { hint: [0, 0, 1], segs: 8, per: 1 });
      g.box(0.455, 0.8, -0.528, -0.502, s * 0.12 - 0.049, s * 0.12 + 0.049, SOLE, RUB);
      for (const x of [0.6, 0.64, 0.68]) g.tube([[x - 0.02, -0.455, s * 0.12 - 0.032], [x, -0.446, s * 0.12], [x - 0.02, -0.455, s * 0.12 + 0.032]], 0.004, WEB, CLOTH, { segs: 4 });
    });
    // hips and the seat of the trousers
    blob(g, [-0.01, -0.005, 0], 0.13, 0.095, 0.185, SUIT, CLOTH, { n: 8, segs: 14, p: 2.4 });
  }

  // ---- arms: shoulder, a visible elbow, forearm, glove on the rim ----
  const cx0 = (y) => -0.02 + 0.07 * (y / 0.55);
  if (arms) {
    mirror((s) => {
      // the hand holds the rim at 3 / 9 o'clock; its frame: o outward, A toward the driver, E2 along the rim
      const o = [0, 0, s], R = add(HUB, scale(o, 0.17));
      const palm = add(R, add(scale(o, 0.032), scale(A, 0.026)));
      const wrist = sub(sub(palm, scale(E2, 0.05)), scale(A, 0.002));
      {
        const sho = [cx0(0.493) + 0.012, 0.493, s * 0.2], elb = [0.3, 0.3, s * 0.255];
        tubeE(g, [sho, [0.14, 0.4, s * 0.235], elb], [0.058, 0.055, 0.048], [0.058, 0.054, 0.047], SHIRT, CLOTH, { hint: [0, 0, 1], caps: [false, false], segs: 8 });
        blob(g, add(elb, [-0.012, 0.0, s * 0.01]), 0.052, 0.05, 0.05, SHIRT, CLOTH, { n: 6, segs: 10 });
        tubeE(g, [elb, add(elb, scale(sub(wrist, elb), 0.5)), wrist], [0.047, 0.042, 0.034], [0.047, 0.04, 0.032], SHIRT, CLOTH, { hint: [0, 0, 1], caps: [false, false], segs: 8 });
        // sleeve cuff
        tubeE(g, [add(wrist, scale(sub(elb, wrist), 0.12)), add(wrist, scale(sub(wrist, elb), 0.02))], [0.04, 0.041], [0.036, 0.037], WEB, CLOTH, { hint: [0, 0, 1], caps: [false, false], per: 1 });
      }
      // glove: the back of the hand, a closed block of fingers wrapped round the rim, and a thumb
      tubeE(g, [wrist, add(palm, scale(E2, -0.018)), add(palm, scale(E2, 0.036))], [0.036, 0.042, 0.04], [0.026, 0.03, 0.028], GLOVE, [MAT.RUBBER, 0, 0], { hint: scale(A, -1), segs: 8, per: 1 });
      // grip patch (accent colour) on the back of the glove
      blob(g, add(palm, add(scale(o, 0.018), scale(A, 0.012))), 0.02, 0.025, 0.012, GRIP, [MAT.RUBBER, 0, 0], { n: 5, segs: 8 });
      // fingers: an arc round the rim, from the outside / behind, across the front, to the inside
      const arc = [];
      const rf = 0.018 + 0.012;
      for (let k = 0; k <= 6; k++) {
        const f = (28 - (200 * k) / 6) * RAD;   // phi from the outward direction toward A, then past the front
        arc.push(add(add(R, add(scale(o, 0.0), scale(E2, 0.028))), add(scale(o, rf * Math.cos(f)), scale(A, rf * Math.sin(f)))));
      }
      tubeE(g, arc, arc.map(() => 0.04), arc.map(() => 0.0125), GLOVE, [MAT.RUBBER, 0, 0], { hint: E2, segs: 6, per: 1 });
      // knuckle line and finger separations
      for (const k of [0]) g.tube(arc.map((p) => add(p, add(scale(E2, k * 0.0135), scale(sub(p, add(R, scale(E2, 0.028))), 0.12)))), 0.0022, [0.012, 0.012, 0.014], [MAT.RUBBER, 0, 0], { segs: 3 });
      // thumb laid along the rim on the driver's side
      tubeE(g, [add(palm, add(scale(E2, -0.012), scale(A, 0.03))), add(palm, add(scale(E2, 0.02), scale(A, 0.034))), add(R, add(scale(E2, 0.062), add(scale(A, 0.028), scale(o, 0.003))))], [0.012, 0.011, 0.01], [0.012, 0.011, 0.01], GLOVE, [MAT.RUBBER, 0, 0], { hint: o, segs: 6, per: 1 });
    });
  }
  return g;
}

function lin(a, b, n) { return Array.from({ length: n + 1 }, (_, k) => a + ((b - a) * k) / n); }
