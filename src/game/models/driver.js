// A seated driver, built in code: a stand-in until a generated character model replaces it.
// Model space: the hip point is the origin, the driver faces +x, y is up, z is to their right.
// Proportions are those of a 1.78 m adult; the pose is hands-on-wheel, knees bent.
import { Geo, MAT } from '../geo.js';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// A round-ended limb through the points of a path, with a radius at each point.
function limb(g, path, radii, col, mat, segs = 10) {
  const rings = [];
  const ring = (c, t, r) => {
    const u = norm(cross(t, Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), v = cross(t, u);
    return Array.from({ length: segs + 1 }, (_, k) => {
      const a = (k / segs) * 2 * Math.PI, cs = Math.cos(a) * r, sn = Math.sin(a) * r;
      return [c[0] + u[0] * cs + v[0] * sn, c[1] + u[1] * cs + v[1] * sn, c[2] + u[2] * cs + v[2] * sn];
    });
  };
  const n = path.length;
  for (let i = 0; i < n; i++) {
    const t = norm(sub(path[Math.min(i + 1, n - 1)], path[Math.max(i - 1, 0)]));
    // hemispherical caps: two shrinking rings pushed out along the axis at each end
    if (i === 0) for (const [k, s] of [[1.0, 0.0], [0.72, 0.7]]) rings.push(ring([path[0][0] - t[0] * radii[0] * k, path[0][1] - t[1] * radii[0] * k, path[0][2] - t[2] * radii[0] * k], t, radii[0] * s + 1e-4));
    rings.push(ring(path[i], t, radii[i]));
    if (i === n - 1) for (const [k, s] of [[0.72, 0.7], [1.0, 0.0]]) rings.push(ring([path[i][0] + t[0] * radii[i] * k, path[i][1] + t[1] * radii[i] * k, path[i][2] + t[2] * radii[i] * k], t, radii[i] * s + 1e-4));
  }
  // faces point away from the limb's axis; the nearest path point stands in for it
  g.grid(rings, col, mat, (P) => {
    let best = path[0], bd = 1e9;
    for (const q of path) { const d = Math.hypot(P[0] - q[0], P[1] - q[1], P[2] - q[2]); if (d < bd) { bd = d; best = q; } }
    return best;
  });
}

function ball(g, c, r, col, mat, sy = 1) {
  const pts = [];
  for (let i = 0; i <= 10; i++) {
    const a = (i / 10) * Math.PI;
    pts.push(Array.from({ length: 15 }, (_, k) => {
      const b = (k / 14) * 2 * Math.PI;
      return [c[0] + Math.sin(a) * Math.cos(b) * r, c[1] - Math.cos(a) * r * sy, c[2] + Math.sin(a) * Math.sin(b) * r];
    }));
  }
  g.grid(pts, col, mat, () => c);
}

export function driverGeo() {
  const g = new Geo();
  const SUIT = [0.03, 0.05, 0.11], VEST = [0.85, 0.2, 0.02], HELMET = [0.85, 0.86, 0.87], VISOR = [0.02, 0.02, 0.03], GLOVE = [0.02, 0.02, 0.02];
  const cloth = [MAT.UPHOLSTERY, 0, 0];
  // torso: hips to shoulders, leaning back a touch; a life jacket over the chest
  limb(g, [[0, 0.02, 0], [-0.03, 0.25, 0], [-0.05, 0.5, 0]], [0.17, 0.165, 0.17], SUIT, cloth, 12);
  limb(g, [[-0.035, 0.2, 0], [-0.05, 0.5, 0]], [0.2, 0.2], VEST, cloth, 12);
  // shoulders, neck
  limb(g, [[-0.05, 0.53, -0.19], [-0.05, 0.53, 0.19]], [0.075, 0.075], VEST, cloth);
  limb(g, [[-0.05, 0.56, 0], [-0.04, 0.66, 0]], [0.055, 0.055], SUIT, cloth, 8);
  // helmet with the visor as a dark band across the front (the helmet takes the player's colour)
  ball(g, [-0.02, 0.79, 0], 0.145, HELMET, [MAT.PAINT, 1, 0], 1.08);
  limb(g, [[0.085, 0.8, -0.09], [0.125, 0.8, 0], [0.085, 0.8, 0.09]], [0.045, 0.05, 0.045], VISOR, [MAT.GLASS, 0, 0], 8);
  for (const s of [-1, 1]) {
    // arms: shoulder, elbow, hand on the wheel
    limb(g, [[-0.04, 0.52, 0.2 * s], [0.14, 0.33, 0.25 * s], [0.4, 0.42, 0.16 * s]], [0.06, 0.05, 0.042], SUIT, cloth);
    ball(g, [0.44, 0.43, 0.15 * s], 0.05, GLOVE, [MAT.RUBBER, 0, 0]);
    // legs: hip, knee, ankle, then the foot
    limb(g, [[0.02, 0.0, 0.1 * s], [0.44, 0.04, 0.12 * s], [0.56, -0.4, 0.12 * s]], [0.085, 0.065, 0.048], SUIT, cloth);
    limb(g, [[0.55, -0.43, 0.12 * s], [0.72, -0.44, 0.12 * s]], [0.05, 0.045], GLOVE, [MAT.RUBBER, 0, 0], 8);
  }
  return g;
}
