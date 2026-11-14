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
