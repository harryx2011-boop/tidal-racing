import { Geo, MAT } from '../geo.js';

// Named points on the boat, in its own space (x forward, y up, z starboard; y = 0 is the design
// waterline). Other systems place things by these, never by guessing at the model.
export const BOAT_ANCHORS = {
  length: 9.0, halfBeam: 1.3,
  bow: [4.8, 0.3, 0], transom: [-4.2, 0.0, 0],
  props: [[-4.5, -0.6, -0.5], [-4.5, -0.6, 0.5]],     // where the propellers churn the water
  helm: [0.2, 0.85, 0.35],                             // the driver's hip point, facing +x
  navPort: [3.6, 1.0, -0.7], navStbd: [3.6, 1.0, 0.7], sternLight: [-3.4, 1.4, 0],
  // the open part of the hull at deck level, as a box [x0, x1, halfWidth]: the sea is hidden inside it
  cockpit: [-4.0, 3.6, 1.15],
};

// A 9 m planing powerboat. Local axes: x forward, y up, z starboard; y = 0 is the design waterline.
export function boatGeo() {
  const g = new Geo();
  const WHITE = [0.82, 0.83, 0.84], DECK = [0.62, 0.58, 0.5], GLASS = [0.02, 0.03, 0.04], BLACK = [0.03, 0.03, 0.035], TRIM = [0.75, 0.76, 0.78];
  const n = 32;
  const sec = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n, x = -4.2 + 9.0 * u;
    const tb = Math.max(0, (u - 0.42) / 0.58);
    const b = 1.3 * Math.pow(Math.max(1 - tb * tb, 0), 0.8) * (0.9 + 0.1 * Math.min(u / 0.25, 1));
    const sheer = 0.72 + 0.38 * u * u;
    const tk = Math.max(0, (u - 0.62) / 0.38);
    const keel = -0.42 + tk * tk * tk * (sheer + 0.4);
    const chine = keel + (sheer - keel) * 0.36;
    sec.push({ x, b, sheer, pts: [[-b, sheer], [-b * 0.88, chine], [0, keel], [b * 0.88, chine], [b, sheer]] });
  }
  const P = (i, j) => [sec[i].x, sec[i].pts[j][1], sec[i].pts[j][0]];
  const centre = (p) => [p[0], 0.25, 0];
  for (let j = 0; j < 4; j++) {
    const side = j === 0 || j === 3;
    // hard chines: each longitudinal strake is its own smooth strip
    g.grid(sec.map((_, i) => [P(i, j), P(i, j + 1)]), WHITE, side ? [MAT.PAINT, 1, 0] : [MAT.GELCOAT, 0, 0], centre);
  }
  // deck, slightly inset, and a rub rail
  g.grid(sec.map((s) => [[s.x, s.sheer, -s.b], [s.x, s.sheer + 0.02, 0], [s.x, s.sheer, s.b]]), DECK, [MAT.NONSKID, 0, 0], (p) => [p[0], -5, 0]);
  // transom
  const t = sec[0].pts.map(([z, y]) => [sec[0].x, y, z]);
  for (let j = 1; j < 4; j++) g.tri(t[0], t[j], t[j + 1], [-1, 0, 0], [-1, 0, 0], [-1, 0, 0], WHITE, [MAT.PAINT, 1, 0]);
  // cabin: a raked wedge with dark glass
  const sh = (x) => 0.72 + 0.38 * Math.pow((x + 4.2) / 9, 2);
  g.hexa(
    [[-1.3, sh(-1.3), -0.95], [1.9, sh(1.9), -0.8], [1.9, sh(1.9), 0.8], [-1.3, sh(-1.3), 0.95]],
    [[-1.0, 1.72, -0.78], [0.7, 1.66, -0.66], [0.7, 1.66, 0.66], [-1.0, 1.72, 0.78]], GLASS, [MAT.GLASS, 0, 0]);
  g.box(-1.15, 0.8, 1.7, 1.76, -0.84, 0.84, WHITE, [MAT.PAINT, 1, 0]);
  // engine cowls and a low spoiler
  for (const z of [-0.5, 0.5]) {
    g.hexa([[-4.75, 0.05, z - 0.2], [-4.15, 0.05, z - 0.2], [-4.15, 0.05, z + 0.2], [-4.75, 0.05, z + 0.2]],
      [[-4.7, 1.12, z - 0.17], [-4.2, 1.2, z - 0.17], [-4.2, 1.2, z + 0.17], [-4.7, 1.12, z + 0.17]], BLACK, [MAT.RUBBER, 0, 0]);
    g.box(-4.6, -4.4, -0.75, 0.05, z - 0.05, z + 0.05, BLACK, [MAT.RUBBER, 0, 0]);
  }
  g.box(-3.7, -3.2, 1.25, 1.31, -1.05, 1.05, TRIM, [MAT.PAINT, 1, 0]);
  for (const z of [-0.95, 0.95]) g.box(-3.55, -3.35, 0.75, 1.25, z - 0.04, z + 0.04, BLACK, [MAT.RUBBER, 0, 0]);
  return g;
}
