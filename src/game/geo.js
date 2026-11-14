import { makeMesh } from '../gl.js';

// Triangle soup builder and the shared vertex format.
// Per vertex: position (loc 0), normal (1), colour (2), material (3) = (material id, tint weight,
// glow), uv (4). Positions are in the model's own space; the mesh shader also receives them
// untransformed, so procedural materials can be laid out in object space without uvs.

// Material ids (the mesh shader decides how each one looks).
export const MAT = { GELCOAT: 0, PAINT: 1, TEAK: 2, UPHOLSTERY: 3, GLASS: 4, METAL: 5, NONSKID: 6, RUBBER: 7, LIGHT: 8, TEXTURED: 9 };

export class Geo {
  constructor() { this.p = []; this.n = []; this.c = []; this.m = []; this.uv = []; }
  tri(a, b, c, na, nb, nc, col, mat, ua = [0, 0], ub = [0, 0], uc = [0, 0]) {
    this.p.push(...a, ...b, ...c);
    this.uv.push(...ua, ...ub, ...uc);
    this.n.push(...na, ...nb, ...nc);
    for (let i = 0; i < 3; i++) { this.c.push(...col); this.m.push(...mat); }
  }
  quad(a, b, c, d, col, mat, n) {
    n = n || norm(cross(sub(b, a), sub(d, a)));
    this.tri(a, b, c, n, n, n, col, mat);
    this.tri(a, c, d, n, n, n, col, mat);
  }
  // rows x cols grid of points with smooth normals (pts[i][j]); out: a point the surface faces away from
  grid(pts, col, mat, out) {
    const R = pts.length, C = pts[0].length;
    const nrm = pts.map((row, i) => row.map((P, j) => {
      const du = sub(pts[Math.min(i + 1, R - 1)][j], pts[Math.max(i - 1, 0)][j]);
      const dv = sub(pts[i][Math.min(j + 1, C - 1)], pts[i][Math.max(j - 1, 0)]);
      let n = norm(cross(du, dv));
      if (out && dot(n, sub(P, out(P))) < 0) n = [-n[0], -n[1], -n[2]];
      return n;
    }));
    for (let i = 0; i < R - 1; i++)
      for (let j = 0; j < C - 1; j++) {
        this.tri(pts[i][j], pts[i + 1][j], pts[i + 1][j + 1], nrm[i][j], nrm[i + 1][j], nrm[i + 1][j + 1], col, mat);
        this.tri(pts[i][j], pts[i + 1][j + 1], pts[i][j + 1], nrm[i][j], nrm[i + 1][j + 1], nrm[i][j + 1], col, mat);
      }
  }
  // convex box from 4 bottom and 4 top corners (same winding order)
  hexa(b, t, col, mat) {
    const mid = b.concat(t).reduce((s, p) => add(s, p), [0, 0, 0]).map((x) => x / 8);
    const face = (a, c, d, e) => {
      let n = norm(cross(sub(c, a), sub(e, a)));
      if (dot(n, sub(a, mid)) < 0) n = [-n[0], -n[1], -n[2]];
      this.quad(a, c, d, e, col, mat, n);
    };
    face(b[0], b[1], b[2], b[3]); face(t[0], t[1], t[2], t[3]);
    for (let i = 0; i < 4; i++) face(b[i], b[(i + 1) % 4], t[(i + 1) % 4], t[i]);
  }
  box(x0, x1, y0, y1, z0, z1, col, mat) {
    this.hexa([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], col, mat);
  }
  // surface of revolution about the y axis through (cx, cz): profile [[r, y], ...]
  lathe(profile, col, mat, segs = 20, cx = 0, cz = 0) {
    const pts = profile.map(([r, y]) => Array.from({ length: segs + 1 }, (_, k) => {
      const a = (k / segs) * 2 * Math.PI;
      return [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r];
    }));
    this.grid(pts, col, mat, (P) => [cx, P[1], cz]);
  }
  // triangles from a grid of points with matching normals; zero-area triangles are dropped
  mesh(pts, nrm, col, mat) {
    const R = pts.length, C = pts[0].length;
    const ok = (a, b, c) => { const x = cross(sub(b, a), sub(c, a)); return x[0] * x[0] + x[1] * x[1] + x[2] * x[2] > 1e-14; };
    for (let i = 0; i < R - 1; i++)
      for (let j = 0; j < C - 1; j++) {
        const a = pts[i][j], b = pts[i + 1][j], c = pts[i + 1][j + 1], d = pts[i][j + 1];
        if (ok(a, b, c)) this.tri(a, b, c, nrm[i][j], nrm[i + 1][j], nrm[i + 1][j + 1], col, mat);
        if (ok(a, c, d)) this.tri(a, c, d, nrm[i][j], nrm[i + 1][j + 1], nrm[i][j + 1], col, mat);
      }
  }
  // Parametric surface fn(u, v) -> [x, y, z] sampled at the parameter lists us x vs. Normals come
  // from the function itself, so two surfaces sharing an edge agree there and smooth surfaces
  // stay smooth. Orientation: the normal faces away from `away` (or toward `toward`) as decided at
  // the middle of the patch; with neither it follows cross(dP/du, dP/dv), reversed by `flip`.
  surf(fn, us, vs, col, mat, { flip = false, away = null, toward = null } = {}) {
    const e = 1e-3, u0 = us[0], u1 = us[us.length - 1], v0 = vs[0], v1 = vs[vs.length - 1];
    const nAt = (u, v) => {
      const uc = Math.min(Math.max(u, u0 + e), u1 - e), vc = Math.min(Math.max(v, v0 + e), v1 - e);
      return cross(sub(fn(uc + e, vc), fn(uc - e, vc)), sub(fn(uc, vc + e), fn(uc, vc - e)));
    };
    let sgn = flip ? -1 : 1;
    const ref = away || toward;
    if (ref) {
      const um = (u0 + u1) / 2, vm = (v0 + v1) / 2;
      sgn = Math.sign(dot(nAt(um, vm), sub(fn(um, vm), ref))) * (away ? 1 : -1) || 1;
    }
    const pts = [], nrm = [];
    for (const u of us) {
      const pr = [], nr = [];
      for (const v of vs) {
        pr.push(fn(u, v));
        let n = nAt(u, v);
        if (n[0] * n[0] + n[1] * n[1] + n[2] * n[2] < 1e-20) n = [0, 1, 0];
        n = norm(n);
        nr.push([n[0] * sgn, n[1] * sgn, n[2] * sgn]);
      }
      pts.push(pr); nrm.push(nr);
    }
    this.mesh(pts, nrm, col, mat);
  }
  // Loft through rings (rings[i][j]); each ring a closed loop unless closed = false. Normals are
  // smooth across rings and around them. A ring that has collapsed to a point (a dome's crown, a
  // nose) takes the direction it was approached from. Orientation: away from ref(i) (a point
  // inside the solid at ring i), by default the centroid of all points.
  loft(rings, col, mat, { closed = true, ref = null, flip = false } = {}) {
    const R = rings.length, M = rings[0].length;
    let c0 = [0, 0, 0];
    if (!ref) { for (const r of rings) for (const p of r) c0 = add(c0, p); c0 = c0.map((x) => x / (R * M)); }
    const isPole = rings.map((r) => r.every((p) => Math.abs(p[0] - r[0][0]) + Math.abs(p[1] - r[0][1]) + Math.abs(p[2] - r[0][2]) < 1e-6));
    const nrm = new Array(R);
    const orient = (n, P, i) => {
      n = norm(n);
      if (dot(n, sub(P, ref ? ref(i) : c0)) < 0) n = [-n[0], -n[1], -n[2]];
      return flip ? [-n[0], -n[1], -n[2]] : n;
    };
    for (let i = 0; i < R; i++) {
      if (isPole[i]) continue;
      nrm[i] = rings[i].map((P, j) => {
        const du = sub(rings[Math.min(i + 1, R - 1)][j], rings[Math.max(i - 1, 0)][j]);
        const jp = closed ? (j + 1) % M : Math.min(j + 1, M - 1), jm = closed ? (j + M - 1) % M : Math.max(j - 1, 0);
        let n = cross(du, sub(rings[i][jp], rings[i][jm]));
        if (dot(n, n) < 1e-14) n = sub(P, ref ? ref(i) : c0);
        return orient(n, P, i);
      });
    }
    // a ring collapsed to a point (a dome's crown, a nose) faces along the axis: the mean normal of its neighbour
    for (let i = 0; i < R; i++) {
      if (!isPole[i]) continue;
      const nb = nrm[i > 0 ? i - 1 : i + 1] || [[0, 1, 0]];
      let s = [0, 0, 0]; for (const n of nb) s = add(s, n);
      const n = norm(s);
      nrm[i] = rings[i].map(() => n);
    }
    const pts = closed ? rings.map((r) => [...r, r[0]]) : rings;
    const nn = closed ? nrm.map((r) => [...r, r[0]]) : nrm;
    this.mesh(pts, nn, col, mat);
  }
  // Ribbon of the profile [[a, b], ...] swept along path [{ p, n }] (a along n, b along up).
  // hard: every profile segment is its own strip (sharp edges at the profile's corners).
  sweep(path, profile, col, mat, { hard = false, up = [0, 1, 0], flip = false } = {}) {
    const rings = path.map(({ p, n }) => {
      const u = norm(sub(up, n.map((x) => x * dot(up, n))));
      return profile.map(([a, b]) => add(p, add(n.map((x) => x * a), u.map((x) => x * b))));
    });
    const ref = (i) => sub(path[i].p, path[i].n.map((x) => x * 0.05));
    if (!hard) return this.loft(rings, col, mat, { closed: false, ref, flip });
    for (let k = 0; k < profile.length - 1; k++) this.loft(rings.map((r) => [r[k], r[k + 1]]), col, mat, { closed: false, ref, flip });
  }
  // round bar along a polyline (parallel-transported frame)
  tube(pts, radius, col, mat, { segs = 8, closed = false } = {}) {
    const N = pts.length, T = pts.map((p, i) => norm(sub(pts[closed ? (i + 1) % N : Math.min(i + 1, N - 1)], pts[closed ? (i + N - 1) % N : Math.max(i - 1, 0)])));
    let a = Math.abs(T[0][1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let nv = norm(cross(T[0], cross(a, T[0])));
    const rings = pts.map((p, i) => {
      nv = norm(sub(nv, T[i].map((x) => x * dot(nv, T[i]))));
      const bv = cross(T[i], nv);
      return Array.from({ length: segs }, (_, k) => {
        const t = (k / segs) * 2 * Math.PI;
        return add(p, add(nv.map((x) => x * Math.cos(t) * radius), bv.map((x) => x * Math.sin(t) * radius)));
      });
    });
    this.loft(rings, col, mat, { ref: (i) => pts[i] });
  }
  // solid of revolution about an axis parallel to x through (., cy, cz): profile [[x, r], ...]
  lathex(profile, col, mat, segs = 16, cy = 0, cz = 0) {
    const rings = profile.map(([x, r]) => Array.from({ length: segs }, (_, k) => {
      const a = (k / segs) * 2 * Math.PI;
      return [x, cy + Math.cos(a) * r, cz + Math.sin(a) * r];
    }));
    this.loft(rings, col, mat, { ref: (i) => [profile[i][0], cy, cz] });
  }
  // flat polygon fan about a point, one normal
  fan(ring, centre, n, col, mat) {
    for (let j = 0; j < ring.length; j++) this.tri(centre, ring[j], ring[(j + 1) % ring.length], n, n, n, col, mat);
  }
  build(gl) {
    const mesh = makeMesh(gl, [[new Float32Array(this.p), 3], [new Float32Array(this.n), 3], [new Float32Array(this.c), 3], [new Float32Array(this.m), 3], [new Float32Array(this.uv), 2]]);
    mesh.count = this.p.length / 3;
    return mesh;
  }
}
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
