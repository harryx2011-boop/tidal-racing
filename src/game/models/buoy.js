import { Geo, MAT } from '../geo.js';

// A race mark: floating drum, mast and a glowing top mark. Tinted per side (port red, starboard green).
export function buoyGeo() {
  const g = new Geo();
  g.lathe([[0.0, -0.9], [0.95, -0.7], [1.05, 0.0], [0.95, 0.55], [0.35, 0.8], [0.0, 0.8]], [1, 1, 1], [MAT.PAINT, 1, 0], 18);
  g.lathe([[0.09, 0.7], [0.07, 7.0]], [0.7, 0.7, 0.7], [MAT.METAL, 0, 0], 8);
  const ball = [];
  for (let i = 0; i <= 8; i++) { const a = (i / 8) * Math.PI; ball.push([Math.sin(a) * 0.6, 7.3 - Math.cos(a) * 0.6]); }
  g.lathe(ball, [1, 1, 1], [MAT.LIGHT, 1, 1], 14);
  return g;
}
