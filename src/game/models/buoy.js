import { Geo, MAT } from '../geo.js';

// A race mark: a floating drum with a fender band and a collar, a lattice mast and a glowing top
// mark. Tinted per side (port red, starboard green); the mast and fittings stay metal.
export function buoyGeo() {
  const g = new Geo();
  const W = [1, 1, 1], GREY = [0.7, 0.72, 0.75], DARK = [0.05, 0.05, 0.055];
  // drum: round bilge, straight side, a domed deck
  g.lathe([[0.0, -0.9], [0.55, -0.86], [0.88, -0.7], [1.0, -0.4], [1.05, 0.0], [1.02, 0.35], [0.9, 0.55], [0.55, 0.72], [0.3, 0.78], [0.3, 0.84]], W, [MAT.PAINT, 1, 0], 24);
  // rubber fender band round the waterline
  g.lathe([[1.0, -0.18], [1.075, -0.12], [1.085, 0.0], [1.075, 0.12], [1.0, 0.18]], DARK, [MAT.RUBBER, 0, 0], 24);
  // mast collar and mast, with three struts
  g.lathe([[0.3, 0.7], [0.3, 0.84], [0.17, 0.95], [0.1, 1.2]], GREY, [MAT.METAL, 0, 0], 14);
  g.lathe([[0.09, 1.1], [0.07, 7.0]], GREY, [MAT.METAL, 0, 0], 10);
  for (let k = 0; k < 3; k++) {
    const a = (k * 2 * Math.PI) / 3;
    g.tube([[Math.cos(a) * 0.5, 0.8, Math.sin(a) * 0.5], [Math.cos(a) * 0.08, 2.3, Math.sin(a) * 0.08]], 0.025, GREY, [MAT.METAL, 0, 0], { segs: 6 });
  }
  // top mark: a glowing ball on a short cup
  g.lathe([[0.1, 6.95], [0.28, 7.05], [0.3, 7.12], [0.06, 7.15]], GREY, [MAT.METAL, 0, 0], 12);
  const ball = [];
  for (let i = 0; i <= 10; i++) { const a = (i / 10) * Math.PI; ball.push([Math.sin(a) * 0.6, 7.45 - Math.cos(a) * 0.6]); }
  g.lathe(ball, W, [MAT.LIGHT, 1, 1], 16);
  return g;
}
