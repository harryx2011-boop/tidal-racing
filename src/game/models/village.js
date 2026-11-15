// A few buildings for a shore: plain gabled houses and sheds, built in code like everything else. Model space: y up,
// y = 0 the ground at the centre of the footprint, the long side along x. Windows are emissive (LIGHT) panes, so
// they glow at dusk with the same darkness level the marks use. Colours are linear albedo.
import { Geo, MAT, norm, cross, sub } from '../geo.js';
import { rng } from './structures.js';

const RUB = [MAT.RUBBER, 0, 0], LIT = [MAT.LIGHT, 0, 1];
const WALLS = [[0.52, 0.5, 0.45], [0.55, 0.28, 0.2], [0.46, 0.5, 0.52], [0.58, 0.54, 0.38], [0.32, 0.36, 0.4]];
const ROOFS = [[0.2, 0.08, 0.06], [0.1, 0.11, 0.13], [0.26, 0.1, 0.06], [0.12, 0.1, 0.09]];

export function houseGeo(seed) {
  const R = rng(seed * 977 + 5), g = new Geo();
  const w = 6 + R() * 6, d = 4.5 + R() * 3, h = 2.8 + R() * 2.4, rh = 1.6 + R() * 1.4, o = 0.35;
  const wall = WALLS[Math.floor(R() * WALLS.length)], roof = ROOFS[Math.floor(R() * ROOFS.length)];
  g.box(-w / 2, w / 2, -1.5, h, -d / 2, d / 2, wall, RUB);
  const A = [-w / 2 - o, h, -d / 2 - o], B = [w / 2 + o, h, -d / 2 - o], C = [w / 2 + o, h, d / 2 + o], D = [-w / 2 - o, h, d / 2 + o];
  const E = [-w / 2 - o, h + rh, 0], F = [w / 2 + o, h + rh, 0];
  const face = (a, b, c, e) => { let n = norm(cross(sub(b, a), sub(e, a))); if (n[1] < 0) n = n.map((x) => -x); g.quad(a, b, c, e, roof, RUB, n); };
  face(A, B, F, E); face(C, D, E, F);
  // gable ends
  const gab = (s) => { const x = s * w / 2; g.tri([x, h, -d / 2], [x, h, d / 2], [x, h + rh * 0.9, 0], [s, 0, 0], [s, 0, 0], [s, 0, 0], wall, RUB); };
  gab(-1); gab(1);
  // a door and two windows on each long side; the panes are emissive and just proud of the wall
  for (const side of [-1, 1]) {
    const z = side * d / 2, pane = (x, y0, y1, hw, c, m, dz) => g.quad([x - hw, y0, z + side * dz], [x + hw, y0, z + side * dz], [x + hw, y1, z + side * dz], [x - hw, y1, z + side * dz], c, m, [0, 0, side]);
    pane(-w * 0.22, h * 0.35, h * 0.78, 0.45, [0.34, 0.27, 0.17], LIT, 0.015);
    pane(w * 0.2, h * 0.35, h * 0.78, 0.45, [0.34, 0.27, 0.17], LIT, 0.015);
    pane(0, 0, h * 0.72, 0.5, [0.09, 0.06, 0.04], RUB, 0.02);
  }
  // chimney
  g.box(w * 0.22, w * 0.22 + 0.7, h + rh * 0.3, h + rh + 0.9, -0.35, 0.35, [0.3, 0.27, 0.25], RUB);
  return { g, radius: Math.hypot(w, d) / 2 + o + 1, h: h + rh };
}

// where the houses stand: on a jittered grid inside a rectangle, kept to ground that is dry, level and above the
// dune, so a village sits on the flat behind a beach. A pure function of the course (the field and the seed).
export function placeHouses(field, v, seed) {
  const R = rng(seed * 131 + 17), out = [];
  const n = v.n || 10, s = field.sample ? { h: 0, gx: 0, gz: 0 } : null;
  const nx = Math.ceil(Math.sqrt(n * (v.w / v.d))), nz = Math.ceil(n / nx) + 1;
  for (let j = 0; j < nz * 2 && out.length < n; j++) for (let i = 0; i < nx * 2 && out.length < n; i++) {
    const x = v.x + ((i + 0.5 + (R() - 0.5) * 0.6) / (nx * 2) - 0.5) * v.w, z = v.z + ((j + 0.5 + (R() - 0.5) * 0.6) / (nz * 2) - 0.5) * v.d;
    const yaw = (v.yaw || 0) + (R() - 0.5) * 0.35, kind = Math.floor(R() * 3);
    if (R() < 0.45) continue;
    field.sample(x, z, s);
    if (s.h < v.min || s.h > v.max || Math.hypot(s.gx, s.gz) > 0.12) continue;
    out.push({ x, z, y: s.h, yaw, seed: kind + 1 });
  }
  return out;
}
