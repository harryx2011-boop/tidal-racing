// The buildings of a shore: cottages, two-storey houses, terraces, a pub, a chapel with a tower, a harbour
// office, net lofts, sheds, boathouses, a fish market, and farms on the hills behind. Built in code with the kit.
// A building's own space: y up, y = 0 its floor, x along its front, +z the way its front faces. Colours are
// linear albedo.
//
// What a building has (near level): walls with a damp, darker foot and a plinth; a roof of slate courses that
// lap (each course its own strip, tones varying along it), ridge tiles, eaves that overhang, fascias, gutters
// and downpipes, bargeboards; chimneys with caps and pots; windows with frames, glazing bars, sills and
// lintels, some lit (emissive panes: they glow at dusk and in storms by the mesh pass's lamp level), the rest
// dark glass; panelled doors with frames and steps; and, round the houses, garden walls that follow the
// ground, sheds, washing lines, benches, barrels, headstones, signs with lettering.
// The middle level keeps the shape, the roof, the chimneys and flat windows and doors; the far level is walls,
// roof, chimneys and dark panes, so a white cottage on a hill is still a white cottage with a dark roof.
//
// Triangles (near / middle / far): cottage 3.3k / 0.3k / 60, house 4.4k / 0.4k / 70, terrace 2.6k a unit,
// pub 6k, chapel 5k, net loft 0.9k, shed 1.2k, boathouse 1.5k, market 3k.
import { MAT, mat, GEL, RUB, MET, GLS, GRAIN, CLOTH, DV, rng, TAU, lerp, smooth, hash1, vn, fb, sheet, tube, rod, box, slab, lathe, quad, mark, paint, xf, frame, mottle, scl, text } from './kit.js';
import { fieldAt, fieldMask, fieldGate, woodsAt, woodsGate, trackD } from './cover.js';

const ASHLAR = mat(MAT.RUBBER, 0, 0, DV.ASHLAR + DV.ALONG), SLATE = mat(MAT.RUBBER, 0, 0, DV.SLATE + DV.ALONG), CORR = mat(MAT.RUBBER, 0, 0, DV.CORRUGATED + DV.ALONG), STONEW = mat(MAT.RUBBER, 0, 0, DV.ASHLAR + DV.ALONG);
const PANE = mat(MAT.LIGHT, 0, 1);
const RENDER = [[0.74, 0.74, 0.7], [0.72, 0.68, 0.56], [0.6, 0.68, 0.72], [0.74, 0.58, 0.52], [0.72, 0.66, 0.4], [0.52, 0.6, 0.5], [0.66, 0.66, 0.66], [0.7, 0.5, 0.36]];
const STONES = [[0.34, 0.31, 0.27], [0.4, 0.36, 0.3], [0.28, 0.27, 0.26]];
const SLATES = [[0.13, 0.14, 0.16], [0.1, 0.105, 0.12], [0.16, 0.15, 0.15], [0.14, 0.16, 0.15]];
const TILES = [0.3, 0.12, 0.07], RUSTRED = [0.32, 0.12, 0.07], TAR = [0.03, 0.03, 0.035];
const DOORS = [[0.06, 0.12, 0.3], [0.4, 0.05, 0.04], [0.05, 0.22, 0.12], [0.5, 0.42, 0.1], [0.08, 0.08, 0.09], [0.12, 0.3, 0.36], [0.28, 0.16, 0.08]];
// (a lit pane is emissive: by day it shows a fifth of what a white card would, a dark amber room; in the dark the
// mesh pass raises it seventeen-fold)
const WHITE = [0.78, 0.78, 0.75], GLOW = [0.1, 0.07, 0.035], GLASS = [0.1, 0.12, 0.14];
export const WARM = [1, 0.72, 0.4];

// ---- parts ----
// a face of a wall: p0 its bottom-left corner seen from outside, U along it (unit), N out of it
function wface(p0, U, N, len) {
  const yaw = Math.atan2(U[2], U[0]);
  return { len, N, U, yaw, P: (u, v, off = 0) => [p0[0] + U[0] * u + N[0] * off, p0[1] + v, p0[2] + U[2] * u + N[2] * off] };
}
const rect = (g, F, u0, u1, v0, v1, off, col, m) => quad(g, F.P(u0, v0, off), F.P(u1, v0, off), F.P(u1, v1, off), F.P(u0, v1, off), col, m, { n: F.N });
const bar = (g, F, u0, u1, v0, v1, o0, o1, col, m) => box(g, F.P((u0 + u1) / 2, (v0 + v1) / 2, (o0 + o1) / 2), (u1 - u0) / 2, (v1 - v0) / 2, (o1 - o0) / 2, col, m, { yaw: F.yaw });

// a window on a face, centred at u, its sill at v
function windowOn(g, F, u, v, w, h, o) {
  const lod = o.lod, lit = o.lit, u0 = u - w / 2, u1 = u + w / 2, v1 = v + h, trim = o.trim || WHITE;
  // (a lit window is a lamp at every level of detail: the glows do not change as the building does)
  if (lit && o.lamps) o.lamps.push({ p: F.P(u, v + h / 2, 0.15), col: WARM, kind: 'window', size: 0.9 });
  if (lod === 2) { if (w * h > 0.9) rect(g, F, u0, u1, v, v1, 0.03, lit ? GLOW : [0.03, 0.035, 0.04], lit ? PANE : RUB); return; }
  if (lod === 1) { rect(g, F, u0 - 0.06, u1 + 0.06, v - 0.06, v1 + 0.06, 0.03, trim, RUB); rect(g, F, u0, u1, v, v1, 0.045, lit ? GLOW : GLASS, lit ? PANE : GLS); return; }
  rect(g, F, u0, u1, v, v1, 0.014, lit ? GLOW : GLASS, lit ? PANE : GLS);
  // frame, glazing bars, sill, lintel
  bar(g, F, u0 - 0.06, u0, v, v1, 0, 0.05, trim, GEL); bar(g, F, u1, u1 + 0.06, v, v1, 0, 0.05, trim, GEL);
  bar(g, F, u0 - 0.06, u1 + 0.06, v1, v1 + 0.06, 0, 0.05, trim, GEL); bar(g, F, u0 - 0.06, u1 + 0.06, v - 0.05, v, 0, 0.05, trim, GEL);
  if (o.lancet) {
    // a pointed head
    quad(g, F.P(u0, v1, 0.014), F.P(u1, v1, 0.014), F.P(u, v1 + w * 0.9, 0.014), F.P(u, v1 + w * 0.9, 0.014), lit ? GLOW : GLASS, lit ? PANE : GLS, { n: F.N });
    bar(g, F, u - 0.015, u + 0.015, v, v1 + w * 0.5, 0.014, 0.04, trim, GEL);
  } else {
    const nb = w > 1.3 ? 2 : 1;
    for (let k = 1; k <= nb; k++) bar(g, F, lerp(u0, u1, k / (nb + 1)) - 0.015, lerp(u0, u1, k / (nb + 1)) + 0.015, v, v1, 0.014, 0.038, trim, GEL);
    if (h > 0.9) bar(g, F, u0, u1, v + h * 0.5 - 0.015, v + h * 0.5 + 0.015, 0.014, 0.038, trim, GEL);
    rect(g, F, u0 - 0.1, u1 + 0.1, v1 + 0.06, v1 + 0.22, 0.008, o.stone || [0.42, 0.4, 0.36], GRAIN);
  }
  bar(g, F, u0 - 0.12, u1 + 0.12, v - 0.13, v - 0.05, 0, 0.11, o.stone || [0.42, 0.4, 0.36], GRAIN);
}
function doorOn(g, F, u, w, h, col, o) {
  const lod = o.lod, u0 = u - w / 2, u1 = u + w / 2, trim = o.trim || WHITE;
  if (lod === 2) { rect(g, F, u0, u1, 0, h, 0.03, scl(col, 0.8), RUB); return; }
  rect(g, F, u0, u1, 0.02, h, lod ? 0.04 : 0.025, col, GEL);
  if (lod === 1) return;
  bar(g, F, u0 - 0.07, u0, 0, h + 0.07, 0, 0.06, trim, GEL); bar(g, F, u1, u1 + 0.07, 0, h + 0.07, 0, 0.06, trim, GEL); bar(g, F, u0, u1, h, h + 0.07, 0, 0.06, trim, GEL);
  // panels, a knob, a step
  if (o.boards) { const n = Math.round(w / 0.16); for (let k = 1; k < n; k++) rect(g, F, u0 + (k / n) * w - 0.008, u0 + (k / n) * w + 0.008, 0.03, h - 0.02, 0.028, scl(col, 0.45), RUB); bar(g, F, u0 + 0.05, u1 - 0.05, h * 0.3, h * 0.3 + 0.1, 0.025, 0.05, scl(col, 0.9), GEL); bar(g, F, u0 + 0.05, u1 - 0.05, h * 0.75, h * 0.75 + 0.1, 0.025, 0.05, scl(col, 0.9), GEL); }
  else {
    for (const [a, b, c, d] of [[0.14, 0.44, 0.12, 0.42], [0.56, 0.86, 0.12, 0.42], [0.14, 0.44, 0.5, 0.9], [0.56, 0.86, 0.5, 0.9]]) rect(g, F, u0 + a * w, u0 + b * w, c * h, d * h, 0.03, scl(col, 0.7), GEL);
    box(g, F.P(u1 - 0.12, h * 0.47, 0.06), 0.025, 0.025, 0.025, [0.7, 0.6, 0.3], MET);
  }
  bar(g, F, u0 - 0.15, u1 + 0.15, -0.5, 0.02, 0, 0.42, [0.4, 0.38, 0.35], GRAIN);
}

// The shell of a gabled building: walls down past the floor (so it sits on sloping ground), gables, the roof
// with its eaves, ridge, fascias and gutters. The ridge runs along x. Returns the four faces and the roof's
// height at a distance z from the ridge line.
function shell(g, o) {
  const { w, d, h, lod } = o, pitch = o.pitch ?? 0.78, rh = Math.tan(pitch) * d / 2, eave = o.eave ?? 0.32, verge = o.verge ?? 0.22;
  const wc = o.wall.col, kind = o.wall.kind, stone = kind === 'stone', seed = o.seed || 1;
  const wm = stone ? ASHLAR : kind === 'corr' ? CORR : kind === 'boards' || kind === 'tar' ? GRAIN : GRAIN;
  const faces = {
    front: wface([-w / 2, 0, d / 2], [1, 0, 0], [0, 0, 1], w), back: wface([w / 2, 0, -d / 2], [-1, 0, 0], [0, 0, -1], w),
    right: wface([w / 2, 0, d / 2], [0, 0, -1], [1, 0, 0], d), left: wface([-w / 2, 0, -d / 2], [0, 0, 1], [-1, 0, 0], d),
  };
  // walls: the foot is damp and darker, the render blotchy, boards each their own tone
  const wp = (P, N, C, i) => {
    const y = P[i + 1], x = P[i], z = P[i + 2];
    let k = 0.86 + 0.28 * fb(x * 0.7 + seed, y * 0.7, z * 0.7);
    if (kind === 'boards' || kind === 'tar') k *= 0.82 + 0.36 * hash1(Math.round((x + z) / 0.18), seed);
    const damp = smooth(0.9, 0.0, y) * 0.3;
    C[i] *= k * (1 - damp); C[i + 1] *= k * (1 - damp * 0.8); C[i + 2] *= k * (1 - damp);
  };
  const rowsV = lod === 0 ? [-3.4, 0, 0.35, 0.9, h * 0.6, h] : [-3.4, h];
  let along = 0;
  for (const key of ['front', 'right', 'back', 'left']) {
    const F = faces[key], n = lod === 0 ? Math.max(1, Math.round(F.len / 1.6)) : 1, a0 = along;
    sheet(g, rowsV.length, n + 1, (i, j, out) => { const p = F.P((j / n) * F.len, rowsV[i]); out[0] = p[0]; out[1] = p[1]; out[2] = p[2]; }, wc, wm, { paint: lod < 2 ? wp : undefined, along: (P, i) => a0 + Math.abs((P[i] - F.P(0, 0)[0]) * F.U[0] + (P[i + 2] - F.P(0, 0)[2]) * F.U[2]) });
    along += F.len;
  }
  // gables
  for (const s of [-1, 1]) {
    const x = s * w / 2, F = s > 0 ? faces.right : faces.left;
    if (lod === 0) sheet(g, 3, 5, (i, j, out) => { const t = j / 4, v = i / 2, z = lerp(-d / 2, d / 2, t), top = h + rh * (1 - Math.abs(z) / (d / 2)); out[0] = x; out[1] = lerp(h, top, v); out[2] = z * (s > 0 ? -1 : 1); }, wc, wm, { paint: wp, along: (P, i) => Math.abs(P[i + 2]) });
    else quad(g, [x, h, -d / 2], [x, h, d / 2], [x, h + rh, 0], [x, h + rh, 0], wc, wm, { n: [s, 0, 0] });
  }
  // a plinth, where the walls are rendered
  if (o.plinth && lod < 2) for (const key of ['front', 'right', 'back', 'left']) { const F = faces[key]; bar(g, F, -0.04, F.len + 0.04, -1.5, 0.42, 0, 0.045, o.plinth, GRAIN); }
  // ---- the roof ----
  const rc = o.roof.col, rk = o.roof.kind, x0 = -w / 2 - verge, x1 = w / 2 + verge, zl = d / 2 + eave, ye = h - Math.tan(pitch) * eave, yr = h + rh, sl = Math.hypot(zl, yr - ye);
  const rm = rk === 'corr' ? CORR : rk === 'tar' ? GRAIN : SLATE;
  for (const s of [-1, 1]) {
    const nrm = [0, Math.cos(pitch), s * Math.sin(pitch)];
    if (lod === 0 && rk !== 'tar') {
      // courses lapping from the ridge down to the eave; each stands a little proud at its lower edge
      const nc = rk === 'corr' ? 3 : Math.max(4, Math.round(sl / 0.3)), ncol = Math.max(2, Math.round((x1 - x0) / 1.1));
      for (let c = 0; c < nc; c++) {
        const t0 = c / nc, t1 = (c + 1) / nc;
        sheet(g, 2, ncol + 1, (i, j, out) => {
          const t = i ? t1 : t0, lift = i ? 0.0 : (rk === 'corr' ? 0.012 : 0.024);
          out[0] = lerp(x0, x1, j / ncol); out[1] = lerp(ye, yr, t) + lift * Math.cos(pitch); out[2] = s * (lerp(zl, 0, t) + lift * Math.sin(pitch));
        // (each course starts its slates somewhere of its own: the mesh pass tones a slate by where it lies along
        // the course, and courses that all began together would stripe the roof from eave to ridge)
        }, rc, rm, { along: (P, i) => P[i] + (rk === 'corr' ? 0 : 7.3 * hash1(c * 5 + 1, seed)), paint: (P, N, C, i) => { const k = 0.8 + 0.4 * hash1(Math.round(P[i] / 1.1) + c * 37, seed + (s > 0 ? 3 : 9)) + 0.15 * (fb(P[i] * 0.4 + seed, c * 0.3, s) - 0.5); const m = 0.94 + 0.12 * vn(P[i] * 0.8, c * 0.7, seed); C[i] *= k * m; C[i + 1] *= k * m * (1 + 0.06 * (hash1(c, Math.round(P[i])) - 0.5)); C[i + 2] *= k; N[i] = nrm[0]; N[i + 1] = nrm[1]; N[i + 2] = nrm[2]; } });
      }
    } else quad(g, [x0, ye, s * zl], [x1, ye, s * zl], [x1, yr, 0], [x0, yr, 0], rc, lod === 2 ? RUB : rm, { n: nrm, along: (P, i) => P[i] });
    if (lod < 2) {
      // fascia, gutter, the roof's underside at the eave
      slab(g, x0, x1, ye - 0.16, ye - 0.01, s * zl - 0.02, s * zl + 0.02, o.trim || WHITE, GEL);
      if (lod === 0) { tube(g, [[x0 + 0.05, ye - 0.1, s * (zl + 0.07)], [x1 - 0.05, ye - 0.1, s * (zl + 0.07)]], 0.055, [0.06, 0.06, 0.065], RUB, { segs: 5 }); const dx = s > 0 ? x1 - 0.25 : x0 + 0.25; tube(g, [[dx, ye - 0.12, s * (zl + 0.07)], [dx, ye - 0.35, s * (d / 2 + 0.07)], [dx, 0.1, s * (d / 2 + 0.07)]], 0.04, [0.06, 0.06, 0.065], RUB, { segs: 4 }); }
      quad(g, [x0, ye - 0.01, s * zl], [x1, ye - 0.01, s * zl], [x1, h, s * d / 2], [x0, h, s * d / 2], scl(o.trim || WHITE, 0.7), RUB);
    }
  }
  if (lod < 2) {
    // ridge, bargeboards
    if (rk === 'slate' || rk === 'tile') tube(g, [[x0, yr + 0.03, 0], [x1, yr + 0.03, 0]], 0.09, rk === 'tile' ? TILES : [0.2, 0.19, 0.19], GRAIN, { segs: 5 });
    else slab(g, x0, x1, yr - 0.02, yr + 0.05, -0.12, 0.12, scl(rc, 0.8), RUB);
    for (const sx of [x0, x1]) for (const s of [-1, 1]) { const a = [sx, ye - 0.02, s * zl], b = [sx, yr - 0.02, 0]; quad(g, a, b, [b[0], b[1] - 0.17, b[2]], [a[0], a[1] - 0.17, a[2]], o.trim || WHITE, GEL, { n: [Math.sign(sx), 0, 0] }); }
  }
  return { faces, rh, roofY: (z) => h + rh * (1 - Math.abs(z) / (d / 2)), top: yr };
}
function chimney(g, x, z, S, lod, col, pots = 2) {
  const y0 = S.roofY(z) - 0.3, y1 = S.top + 0.75;
  box(g, [x, (y0 + y1) / 2, z], 0.32, (y1 - y0) / 2, 0.26, col, lod === 2 ? RUB : GRAIN);
  if (lod === 2) return;
  box(g, [x, y1 + 0.04, z], 0.37, 0.05, 0.31, scl(col, 0.8), GRAIN);
  if (lod === 0) for (let k = 0; k < pots; k++) lathe(g, [[0.09, 0], [0.075, 0.3], [0.09, 0.32], [0.06, 0.34]], [0.42, 0.2, 0.1], GRAIN, { segs: 6, at: [x + (pots > 1 ? (k - 0.5) * 0.3 : 0), y1 + 0.09, z] });
}

// ---- garden things, standing on the ground (gy(x, z): the ground's height relative to the floor) ----
function gardenWall(g, pts, gy, lod, seed, col = [0.33, 0.31, 0.28], hh = 0.95) {
  if (lod === 2) return;
  let along = 0;
  for (let s = 0; s < pts.length - 1; s++) {
    const a = pts[s], b = pts[s + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(len / (lod ? 4 : 1.6))), ux = (b[0] - a[0]) / len, uz = (b[1] - a[1]) / len, a0 = along;
    for (const side of [-1, 1]) sheet(g, 2, n + 1, (i, j, out) => {
      const t = j / n, x = lerp(a[0], b[0], t) - uz * side * 0.2, z = lerp(a[1], b[1], t) + ux * side * 0.2, y = gy(x, z);
      out[0] = x; out[1] = i ? y + hh + 0.08 * (hash1(Math.round(t * len * 2), seed) - 0.5) : y - 0.6; out[2] = z;
    }, col, STONEW, { along: (P, i) => a0 + Math.hypot(P[i] - a[0], P[i + 2] - a[1]), paint: mottle(seed, 0.25, 1.5) });
    // the cope
    sheet(g, 2, n + 1, (i, j, out) => { const t = j / n, sd = i ? 1 : -1, x = lerp(a[0], b[0], t) - uz * sd * 0.2, z = lerp(a[1], b[1], t) + ux * sd * 0.2; out[0] = x; out[1] = gy(x, z) + hh + 0.08 * (hash1(Math.round(t * len * 2), seed) - 0.5); out[2] = z; }, scl(col, 1.15), GRAIN, { paint: mottle(seed + 1, 0.2, 2) });
    along += len;
  }
}
function washing(g, a, b, gy, lod, seed) {
  if (lod > 0) return;
  const ya = gy(a[0], a[1]), yb = gy(b[0], b[1]);
  rod(g, [a[0], ya - 0.2, a[1]], [a[0], ya + 2.0, a[1]], 0.035, [0.4, 0.33, 0.24], GRAIN, 4); rod(g, [b[0], yb - 0.2, b[1]], [b[0], yb + 2.0, b[1]], 0.035, [0.4, 0.33, 0.24], GRAIN, 4);
  const R = rng(seed * 13 + 1), n = 3 + Math.floor(R() * 4);
  const at = (t) => [lerp(a[0], b[0], t), lerp(ya, yb, t) + 1.95 - 0.25 * 4 * t * (1 - t), lerp(a[1], b[1], t)];
  tube(g, [0, 0.25, 0.5, 0.75, 1].map(at), 0.006, [0.7, 0.7, 0.65], CLOTH, { segs: 3 });
  for (let k = 0; k < n; k++) {
    const t0 = 0.1 + (k / n) * 0.8, t1 = t0 + 0.07 + 0.06 * R(), p0 = at(t0), p1 = at(t1), hgt = 0.45 + 0.5 * R(), c = [[0.75, 0.75, 0.72], [0.15, 0.25, 0.55], [0.6, 0.12, 0.1], [0.7, 0.6, 0.2], [0.2, 0.45, 0.3]][Math.floor(R() * 5)], sw = 0.12 * (R() - 0.3);
    quad(g, p0, p1, [p1[0] + sw, p1[1] - hgt, p1[2] + sw], [p0[0] + sw, p0[1] - hgt, p0[2] + sw], c, CLOTH);
  }
}
function hut(g, p, yaw, lod, seed) {
  const s0 = mark(g), c = [[0.2, 0.26, 0.2], [0.3, 0.2, 0.12], [0.1, 0.2, 0.3]][seed % 3];
  const S = shell(g, { w: 2.2, d: 1.7, h: 1.8, pitch: 0.5, lod: Math.max(lod, 1), wall: { col: c, kind: 'boards' }, roof: { col: [0.09, 0.09, 0.1], kind: 'tar' }, eave: 0.12, verge: 0.1, seed, trim: scl(c, 0.7) });
  doorOn(g, S.faces.front, 1.1, 0.75, 1.7, scl(c, 0.8), { lod: Math.max(lod, 1) });
  xf(g, s0, frame(p, yaw));
}
function barrel(g, p, lod) {
  lathe(g, [[0, 0], [0.24, 0], [0.3, 0.25], [0.32, 0.45], [0.3, 0.65], [0.24, 0.9], [0, 0.9]], [0.3, 0.2, 0.1], GRAIN, { segs: lod ? 6 : 10, at: p });
  if (lod === 0) for (const y of [0.12, 0.78]) lathe(g, [[0.275, y - 0.02], [0.285, y + 0.02]], [0.12, 0.12, 0.13], MET, { segs: 10, at: p });
}

// ---- the buildings ----
// spec: { type, seed }; gy(x, z): the ground under a point of its own space, relative to its floor. Returns
// { hx, hz, h } (half the footprint with its garden, the height) and pushes lamps (own space).
const litOf = (R, p = 0.38) => R() < p;
function cottage(g, sp, lod, lamps, gy) {
  const R = rng(sp.seed * 911 + 3), w = 8.5 + R() * 3, d = 5.2 + R() * 0.8, h = 2.45 + R() * 0.3;
  const stone = R() < 0.3, wc = stone ? STONES[Math.floor(R() * 3)] : RENDER[Math.floor(R() * RENDER.length)], roofTile = R() < 0.12;
  const dc = DOORS[Math.floor(R() * DOORS.length)], trim = R() < 0.8 ? WHITE : dc;
  const S = shell(g, { w, d, h, pitch: 0.74 + R() * 0.1, lod, wall: { col: wc, kind: stone ? 'stone' : 'render' }, roof: { col: roofTile ? TILES : SLATES[Math.floor(R() * 4)], kind: roofTile ? 'tile' : 'slate' }, seed: sp.seed, trim, plinth: stone || R() < 0.5 ? null : [0.2, 0.2, 0.2] });
  const o = { lod, lamps, trim }, F = S.faces;
  const du = w * (0.42 + 0.16 * R());
  doorOn(g, F.front, du, 0.92, 2.0, dc, o);
  windowOn(g, F.front, du - w * 0.27, 0.95, 1.0, 1.15, { ...o, lit: litOf(R) }); windowOn(g, F.front, du + w * 0.27, 0.95, 1.0, 1.15, { ...o, lit: litOf(R) });
  windowOn(g, F.back, w * 0.28, 1.1, 0.8, 0.9, { ...o, lit: litOf(R) }); windowOn(g, F.back, w * 0.72, 1.1, 0.8, 0.9, { ...o, lit: litOf(R) });
  // (every random choice is drawn whatever the level of detail, so the levels are the same building)
  const gable = R() < 0.5 ? F.left : F.right, gl = litOf(R, 0.25), porch = R() < 0.35, hasHut = R() < 0.6;
  if (lod < 2) windowOn(g, gable, d / 2, h + 0.5, 0.6, 0.75, { ...o, lit: gl });
  chimney(g, -w / 2 + 0.35, 0, S, lod, stone ? wc : scl(wc, 0.92), 2); chimney(g, w / 2 - 0.35, 0, S, lod, stone ? wc : scl(wc, 0.92), 1);
  // a porch on some
  if (porch && lod < 2) { const s0 = mark(g); const P = shell(g, { w: 1.9, d: 1.3, h: 2.0, pitch: 0.8, lod: Math.max(lod, 1), wall: { col: wc, kind: 'render' }, roof: { col: SLATES[0], kind: 'slate' }, eave: 0.12, verge: 0.12, seed: sp.seed + 1, trim }); doorOn(g, P.faces.right, 0.65, 0.8, 1.9, dc, { lod }); xf(g, s0, frame([du - w / 2, 0, d / 2 + 0.66], Math.PI / 2)); }
  // garden: a wall round the front, a shed and a line at the back
  const gz = d / 2 + 3 + R() * 2;
  gardenWall(g, [[-w / 2 - 1.5, d / 2], [-w / 2 - 1.5, gz], [du - w / 2 - 0.7, gz]], gy, lod, sp.seed); gardenWall(g, [[du - w / 2 + 0.7, gz], [w / 2 + 1.5, gz], [w / 2 + 1.5, d / 2]], gy, lod, sp.seed + 5);
  if (lod < 2 && hasHut) hut(g, [w / 2 - 1.5, gy(w / 2 - 1.5, -d / 2 - 3.5), -d / 2 - 3.5], 0, lod, sp.seed);
  if (R() < 0.6) washing(g, [-w / 2 + 0.5, -d / 2 - 2.2], [-w / 2 + 5, -d / 2 - 4], gy, lod, sp.seed);
  return { hx: w / 2 + 1.8, hz: gz + 0.3, h: S.top + 1 };
}
function house2(g, sp, lod, lamps, gy, farm = false) {
  const R = rng(sp.seed * 733 + 5), w = 8 + R() * 2, d = 6 + R() * 1, h = 5.1 + R() * 0.4;
  const stone = R() < 0.25, wc = farm ? RENDER[0] : stone ? STONES[Math.floor(R() * 3)] : RENDER[Math.floor(R() * RENDER.length)];
  const dc = DOORS[Math.floor(R() * DOORS.length)], trim = R() < 0.75 ? WHITE : [0.08, 0.08, 0.09];
  const S = shell(g, { w, d, h, pitch: 0.72 + R() * 0.1, lod, wall: { col: wc, kind: stone ? 'stone' : 'render' }, roof: { col: SLATES[Math.floor(R() * 4)], kind: 'slate' }, seed: sp.seed, trim, plinth: stone ? null : [0.22, 0.22, 0.22] });
  const o = { lod, lamps, trim }, F = S.faces;
  doorOn(g, F.front, w / 2, 0.95, 2.05, dc, o);
  if (lod === 0) { rect(g, F.front, w / 2 - 0.4, w / 2 + 0.4, 2.12, 2.42, 0.014, GLASS, GLS); bar(g, F.front, w / 2 - 0.8, w / 2 + 0.8, 2.5, 2.58, 0, 0.5, trim, GEL); }
  for (const k of [0.2, 0.8]) windowOn(g, F.front, w * k, 0.9, 1.05, 1.3, { ...o, lit: litOf(R) });
  for (const k of [0.2, 0.5, 0.8]) windowOn(g, F.front, w * k, 3.2, 1.0, 1.25, { ...o, lit: litOf(R) });
  for (const k of [0.25, 0.75]) { windowOn(g, F.back, w * k, 1.0, 0.9, 1.1, { ...o, lit: litOf(R) }); windowOn(g, F.back, w * k, 3.3, 0.9, 1.1, { ...o, lit: litOf(R) }); }
  const l1 = litOf(R), l2 = litOf(R), hasHut = R() < 0.5;
  if (lod < 2) { windowOn(g, F.right, d / 2, 3.3, 0.8, 1.0, { ...o, lit: l1 }); windowOn(g, F.left, d / 2, 1.0, 0.8, 1.0, { ...o, lit: l2 }); }
  chimney(g, -w / 2 + 0.36, 0, S, lod, stone ? wc : scl(wc, 0.9), 2); chimney(g, w / 2 - 0.36, 0, S, lod, stone ? wc : scl(wc, 0.9), 2);
  // a lean-to at the back on some
  if (R() < 0.5) { box(g, [w * 0.2, 1.2, -d / 2 - 1.4], w * 0.25, 1.2 + 1.2, 1.4, wc, lod === 2 ? RUB : GRAIN); quad(g, [w * 0.2 - w * 0.25 - 0.15, 3.0, -d / 2], [w * 0.2 + w * 0.25 + 0.15, 3.0, -d / 2], [w * 0.2 + w * 0.25 + 0.15, 2.3, -d / 2 - 3.0], [w * 0.2 - w * 0.25 - 0.15, 2.3, -d / 2 - 3.0], SLATES[1], lod === 2 ? RUB : SLATE, { along: (P, i) => P[i] }); }
  const gz = d / 2 + 3.5 + R() * 2;
  gardenWall(g, [[-w / 2 - 1.8, d / 2], [-w / 2 - 1.8, gz], [-0.8, gz]], gy, lod, sp.seed); gardenWall(g, [[0.8, gz], [w / 2 + 1.8, gz], [w / 2 + 1.8, d / 2]], gy, lod, sp.seed + 5);
  if (R() < 0.5) washing(g, [-w / 2, -d / 2 - 3.6], [-w / 2 + 5.5, -d / 2 - 5], gy, lod, sp.seed);
  if (lod < 2 && hasHut) hut(g, [w / 2 - 1.2, gy(w / 2 - 1.2, -d / 2 - 5), -d / 2 - 5], 0.3, lod, sp.seed + 1);
  return { hx: w / 2 + 2, hz: gz + 0.3, h: S.top + 1 };
}
function terrace(g, sp, lod, lamps, gy) {
  const R = rng(sp.seed * 577 + 9), n = 3 + Math.floor(R() * 3), uw = 4.8 + R() * 0.6, w = n * uw, d = 6.5, h = 5.0 + R() * 0.3;
  const roofc = SLATES[Math.floor(R() * 4)];
  // each house its own colour: the shell is built per unit, the roof runs through
  let top = 0;
  for (let k = 0; k < n; k++) {
    const s0 = mark(g), wc = RENDER[Math.floor(R() * RENDER.length)], dc = DOORS[Math.floor(R() * DOORS.length)], trim = R() < 0.7 ? WHITE : dc;
    const S = shell(g, { w: uw, d, h, pitch: 0.75, lod, wall: { col: wc, kind: 'render' }, roof: { col: roofc, kind: 'slate' }, seed: sp.seed + k * 7, trim, verge: k === 0 || k === n - 1 ? 0.15 : 0.0, plinth: [0.2, 0.2, 0.21] });
    const own = [], o = { lod, lamps: lamps ? own : null, trim }, F = S.faces, flip = k % 2 === 0, lit = [litOf(R), litOf(R), litOf(R), litOf(R), litOf(R)];
    doorOn(g, F.front, flip ? uw * 0.25 : uw * 0.75, 0.9, 2.02, dc, o);
    windowOn(g, F.front, flip ? uw * 0.68 : uw * 0.32, 0.9, 1.15, 1.3, { ...o, lit: lit[0] });
    windowOn(g, F.front, uw * 0.27, 3.15, 0.95, 1.2, { ...o, lit: lit[1] }); windowOn(g, F.front, uw * 0.73, 3.15, 0.95, 1.2, { ...o, lit: lit[2] });
    windowOn(g, F.back, uw * 0.3, 1.0, 0.9, 1.1, { ...o, lit: lit[3] }); windowOn(g, F.back, uw * 0.7, 3.3, 0.9, 1.1, { ...o, lit: lit[4] });
    chimney(g, flip ? -uw / 2 + 0.3 : uw / 2 - 0.3, 0, S, lod, [0.36, 0.2, 0.14], 2);
    const ox = (k - (n - 1) / 2) * uw;
    xf(g, s0, frame([ox, 0, 0]));
    if (lamps) for (const l of own) lamps.push({ ...l, p: [l.p[0] + ox, l.p[1], l.p[2]] });
    top = S.top;
    // yards behind, divided by walls
    if (k > 0) gardenWall(g, [[ox - uw / 2, -d / 2], [ox - uw / 2, -d / 2 - 5]], gy, lod, sp.seed + k, [0.36, 0.2, 0.15], 1.5);
  }
  gardenWall(g, [[-w / 2, -d / 2 - 5], [w / 2, -d / 2 - 5]], gy, lod, sp.seed + 31, [0.36, 0.2, 0.15], 1.5);
  if (R() < 0.7) washing(g, [-w / 2 + 1, -d / 2 - 1.5], [-w / 2 + 1 + 3.2, -d / 2 - 4], gy, lod, sp.seed);
  return { hx: w / 2 + 0.5, hz: d / 2 + 5.5, h: top + 1 };
}
function pub(g, sp, lod, lamps, gy) {
  const R = rng(sp.seed * 389 + 1), w = 13, d = 7.2, h = 5.4, wc = [0.76, 0.76, 0.72], trim = [0.05, 0.05, 0.055], name = ['THE ANCHOR', 'THE SHIP INN', 'THE HARBOUR BAR'][sp.seed % 3];
  const S = shell(g, { w, d, h, pitch: 0.76, lod, wall: { col: wc, kind: 'render' }, roof: { col: SLATES[1], kind: 'slate' }, seed: sp.seed, trim, plinth: [0.05, 0.05, 0.055] });
  const o = { lod, lamps, trim }, F = S.faces;
  doorOn(g, F.front, w * 0.5, 1.1, 2.1, [0.3, 0.05, 0.04], o);
  for (const k of [0.14, 0.32, 0.68, 0.86]) windowOn(g, F.front, w * k, 0.85, 1.25, 1.4, { ...o, lit: true });
  for (const k of [0.14, 0.32, 0.5, 0.68, 0.86]) windowOn(g, F.front, w * k, 3.3, 1.0, 1.25, { ...o, lit: litOf(R, 0.5) });
  for (const k of [0.2, 0.5, 0.8]) { windowOn(g, F.back, w * k, 1.0, 0.9, 1.1, { ...o, lit: litOf(R) }); windowOn(g, F.back, w * k, 3.3, 0.9, 1.1, { ...o, lit: litOf(R) }); }
  if (lod < 2) { windowOn(g, F.right, d / 2, 3.3, 0.9, 1.1, { ...o, lit: true }); windowOn(g, F.left, d / 2, 1.0, 0.9, 1.1, { ...o, lit: true }); }
  for (const x of [-w / 2 + 0.36, 0, w / 2 - 0.36]) chimney(g, x, 0, S, lod, scl(wc, 0.9), 2);
  if (lamps) lamps.push({ p: [0, 2.6, d / 2 + 0.5], col: WARM, kind: 'post', size: 1.1 });
  if (lod < 2) {
    // the name along the front, a hanging sign on a bracket, a lamp over the door
    bar(g, F.front, w * 0.2, w * 0.8, 2.45, 3.0, 0, 0.06, [0.05, 0.05, 0.055], GEL);
    if (lod === 0) text(g, name, F.front.P(w / 2, 2.57, 0.065), [1, 0, 0], [0, 1, 0], 0.32, [0.8, 0.66, 0.2], GEL, { centre: true, weight: 0.2 });
    rod(g, [w / 2 - 0.2, 4.4, d / 2], [w / 2 - 0.2, 4.4, d / 2 + 1.1], 0.025, [0.05, 0.05, 0.05], MET, 4);
    box(g, [w / 2 - 0.2, 3.85, d / 2 + 0.7], 0.02, 0.45, 0.35, [0.1, 0.2, 0.36], GEL);
    if (lod === 0) box(g, [w / 2 - 0.2, 3.85, d / 2 + 0.7], 0.025, 0.2, 0.18, [0.8, 0.66, 0.2], GEL);
    // tables and benches outside, barrels, a board
    for (const x of [-4.2, -1.8, 2.2, 4.4]) {
      const z = d / 2 + 2.4 + (x > 0 ? 0.4 : 0), y = gy(x, z);
      slab(g, x - 0.75, x + 0.75, y + 0.7, y + 0.75, z - 0.38, z + 0.38, [0.36, 0.26, 0.15], GRAIN);
      for (const sz of [-0.7, 0.7]) slab(g, x - 0.75, x + 0.75, y + 0.42, y + 0.46, z + sz - 0.13, z + sz + 0.13, [0.36, 0.26, 0.15], GRAIN);
      if (lod === 0) for (const sx of [-0.55, 0.55]) { rod(g, [x + sx, y, z - 0.75], [x + sx, y + 0.72, z + 0.2], 0.035, [0.3, 0.22, 0.13], GRAIN, 4); rod(g, [x + sx, y, z + 0.75], [x + sx, y + 0.72, z - 0.2], 0.035, [0.3, 0.22, 0.13], GRAIN, 4); }
    }
    for (const x of [-w / 2 + 0.6, -w / 2 + 1.3, w / 2 - 0.7]) barrel(g, [x, gy(x, d / 2 + 0.5), d / 2 + 0.5], lod);
    if (lod === 0) { const s0 = mark(g); box(g, [0, 0.5, 0], 0.3, 0.5, 0.02, [0.05, 0.05, 0.05], RUB); xf(g, s0, frame([1.2, gy(1.2, d / 2 + 1.2), d / 2 + 1.2], 0.3, 0, -0.25)); }
  }
  return { hx: w / 2 + 0.6, hz: d / 2 + 3.6, h: S.top + 1 };
}
function chapel(g, sp, lod, lamps, gy) {
  const R = rng(sp.seed * 271 + 7), w = 15, d = 7.6, h = 5.2, wc = STONES[sp.seed % 3], trim = [0.3, 0.28, 0.25];
  // the nave, its ridge along x; the tower at its west end (-x)
  const S = shell(g, { w, d, h, pitch: 0.92, lod, wall: { col: wc, kind: 'stone' }, roof: { col: SLATES[0], kind: 'slate' }, seed: sp.seed, trim, eave: 0.2, verge: 0.12 });
  const o = { lod, lamps, trim, stone: scl(wc, 1.25) }, F = S.faces;
  for (const k of [0.2, 0.4, 0.6, 0.8]) { windowOn(g, F.front, w * k, 1.5, 0.75, 2.3, { ...o, lancet: true, lit: R() < 0.5 }); windowOn(g, F.back, w * k, 1.5, 0.75, 2.3, { ...o, lancet: true, lit: R() < 0.5 }); }
  windowOn(g, F.right, d / 2, 2.0, 1.3, 3.0, { ...o, lancet: true, lit: true });
  // buttresses
  if (lod < 2) for (const k of [0.1, 0.3, 0.5, 0.7, 0.9]) for (const s of [-1, 1]) { const x = (k - 0.5) * w; box(g, [x, 1.6, s * (d / 2 + 0.3)], 0.3, 2.6, 0.32, wc, ASHLAR); quad(g, [x - 0.3, 4.2, s * (d / 2 + 0.62)], [x + 0.3, 4.2, s * (d / 2 + 0.62)], [x + 0.3, 4.8, s * d / 2], [x - 0.3, 4.8, s * d / 2], scl(wc, 1.1), GRAIN); }
  // the tower: square, a string course, louvred openings, a parapet and a short spire
  const tw = 2.3, th = 13.5, tx = -w / 2 - tw + 0.4;
  if (lod === 0) {
    const along = (P, i) => (Math.abs(P[i] - tx) > Math.abs(P[i + 2]) ? P[i + 2] : P[i]) + 20;
    for (const [n, U, c] of [[[0, 0, 1], [1, 0, 0], [tx - tw, 0, tw]], [[1, 0, 0], [0, 0, -1], [tx + tw, 0, tw]], [[0, 0, -1], [-1, 0, 0], [tx + tw, 0, -tw]], [[-1, 0, 0], [0, 0, 1], [tx - tw, 0, -tw]]]) {
      const Ft = wface(c, U, n, tw * 2);
      sheet(g, 6, 3, (i, j, out) => { const p = Ft.P(j * tw, [-2, 0, 0.6, 4, 9, th][i]); out[0] = p[0]; out[1] = p[1]; out[2] = p[2]; }, wc, ASHLAR, { along, paint: (P, N, C, i) => { const k = 0.85 + 0.3 * fb(P[i] * 0.5, P[i + 1] * 0.5, P[i + 2] * 0.5 + sp.seed) - 0.12 * smooth(1.2, 0, P[i + 1]); C[i] *= k; C[i + 1] *= k; C[i + 2] *= k; } });
      bar(g, Ft, -0.06, tw * 2 + 0.06, 9.2, 9.4, 0, 0.08, scl(wc, 1.2), GRAIN); bar(g, Ft, -0.08, tw * 2 + 0.08, th - 0.1, th + 0.25, 0, 0.1, scl(wc, 1.2), GRAIN);
      // louvres
      rect(g, Ft, tw - 0.45, tw + 0.45, 10.1, 12.2, 0.02, [0.03, 0.03, 0.03], RUB);
      for (let k = 0; k < 6; k++) bar(g, Ft, tw - 0.45, tw + 0.45, 10.2 + k * 0.33, 10.3 + k * 0.33, 0.02, 0.07, [0.2, 0.19, 0.18], GRAIN);
      // battlements
      for (let k = 0; k < 4; k++) bar(g, Ft, k * tw * 2 / 3.5, k * tw * 2 / 3.5 + tw * 2 / 7, th + 0.25, th + 0.85, -0.25, 0.1, wc, ASHLAR);
    }
    const Fw = wface([tx - tw, 0, 1.0], [0, 0, -1], [-1, 0, 0], 2);
    doorOn(g, Fw, 1.0, 1.3, 2.4, [0.2, 0.1, 0.05], { lod, trim, boards: true });
    windowOn(g, Fw, 1.0, 4.6, 0.7, 2.0, { ...o, lancet: true, lit: false });
  } else box(g, [tx, th / 2 - 1, 0], tw, th / 2 + 1, tw, wc, lod === 2 ? RUB : ASHLAR);
  const sp0 = th + (lod === 0 ? 0.2 : 0);
  for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + Math.PI / 4, b = a + Math.PI / 2, r = tw * 1.2; quad(g, [tx + Math.cos(a) * r, sp0, Math.sin(a) * r], [tx + Math.cos(b) * r, sp0, Math.sin(b) * r], [tx, sp0 + 4.2, 0], [tx, sp0 + 4.2, 0], SLATES[0], lod === 2 ? RUB : SLATE, { along: (P, i) => P[i] + P[i + 2] }); }
  if (lod < 2) { rod(g, [tx, sp0 + 4.1, 0], [tx, sp0 + 5.4, 0], 0.03, [0.6, 0.5, 0.2], MET, 4); box(g, [tx, sp0 + 5.0, 0], 0.3, 0.02, 0.02, [0.6, 0.5, 0.2], MET); }
  // the churchyard: a wall round it and headstones
  const hx = w / 2 + 9, hz = d / 2 + 8;
  gardenWall(g, [[-hx, hz], [-1.2, hz]], gy, lod, sp.seed, scl(wc, 0.95), 1.1); gardenWall(g, [[1.2, hz], [hx - 3, hz], [hx - 3, -hz], [-hx, -hz], [-hx, hz]], gy, lod, sp.seed + 3, scl(wc, 0.95), 1.1);
  if (lod < 2) for (let k = 0; k < 22; k++) {
    const x = lerp(-hx + 1.5, hx - 5, R()), z = (R() < 0.5 ? -1 : 1) * lerp(d / 2 + 2, hz - 1.2, R()), y = gy(x, z), hh = 0.6 + 0.6 * R(), lean = (R() - 0.5) * 0.25, s0 = mark(g);
    box(g, [0, hh / 2, 0], 0.26 + 0.1 * R(), hh / 2 + 0.2, 0.05, scl([0.36, 0.35, 0.32], 0.7 + 0.6 * R()), GRAIN);
    xf(g, s0, frame([x, y, z], Math.PI / 2 + (R() - 0.5) * 0.3, 0, lean));
  }
  return { hx, hz, h: sp0 + 6 };
}
function office(g, sp, lod, lamps, gy) {
  const R = rng(sp.seed * 199 + 3), w = 7.5, d = 5.2, h = 3.0, wc = STONES[1], trim = [0.08, 0.16, 0.3];
  const S = shell(g, { w, d, h, pitch: 0.6, lod, wall: { col: wc, kind: 'stone' }, roof: { col: SLATES[2], kind: 'slate' }, seed: sp.seed, trim });
  const o = { lod, lamps, trim: WHITE }, F = S.faces;
  doorOn(g, F.front, w * 0.3, 0.95, 2.05, [0.08, 0.16, 0.3], o);
  windowOn(g, F.front, w * 0.68, 0.95, 1.6, 1.3, { ...o, lit: true }); windowOn(g, F.right, d / 2, 0.95, 1.2, 1.3, { ...o, lit: true }); windowOn(g, F.back, w / 2, 1.1, 1.0, 1.0, { ...o, lit: false });
  chimney(g, w / 2 - 0.36, 0, S, lod, wc, 1);
  if (lod < 2) {
    bar(g, F.front, w * 0.08, w * 0.92, 2.42, 2.82, 0, 0.05, [0.08, 0.16, 0.3], GEL);
    if (lod === 0) text(g, 'HARBOUR OFFICE', F.front.P(w / 2, 2.52, 0.055), [1, 0, 0], [0, 1, 0], 0.2, WHITE, GEL, { centre: true, weight: 0.2 });
    // a flagstaff with a yard, and a flag flying stiff in the breeze
    const fx = -w / 2 - 1.6, fz = d / 2 + 1, fy = gy(fx, fz);
    lathe(g, [[0.07, 0], [0.05, 5], [0.03, 9]], WHITE, GEL, { segs: 6, at: [fx, fy, fz] });
    rod(g, [fx - 1.2, fy + 6.5, fz], [fx + 1.2, fy + 6.5, fz], 0.025, WHITE, GEL, 4);
    sheet(g, 4, 6, (i, j, out) => { const u = j / 5, v = i / 3; out[0] = fx + 0.05 + u * 1.5; out[1] = fy + 8.9 - v * 0.9 - 0.25 * u * u; out[2] = fz + 0.12 * Math.sin(u * 6 + v); }, [0.1, 0.2, 0.5], CLOTH, { paint: (P, N, C, i) => { if (Math.abs(P[i + 1] - (fy + 8.45 - 0.25 * Math.pow((P[i] - fx) / 1.5, 2))) < 0.16 || Math.abs(P[i] - fx - 0.6) < 0.16) { C[i] = 0.8; C[i + 1] = 0.8; C[i + 2] = 0.76; } } });
    // a notice board
    const nx = w / 2 + 1.3, ny = gy(nx, d / 2);
    for (const s of [-1, 1]) rod(g, [nx + s * 0.5, ny, d / 2], [nx + s * 0.5, ny + 1.9, d / 2], 0.04, [0.2, 0.14, 0.08], GRAIN, 4);
    box(g, [nx, ny + 1.4, d / 2], 0.6, 0.45, 0.03, [0.06, 0.12, 0.08], GEL); if (lod === 0) for (const [a, b] of [[-0.3, 0.15], [0.2, 0.1], [0.15, -0.2], [-0.25, -0.2]]) box(g, [nx + a, ny + 1.4 + b, d / 2 + 0.035], 0.15, 0.11, 0.004, [0.8, 0.8, 0.75], GEL);
  }
  return { hx: w / 2 + 2.4, hz: d / 2 + 1.6, h: 10 };
}
function netLoft(g, sp, lod, lamps) {
  const R = rng(sp.seed * 151 + 9), n = 3 + (sp.seed % 3), uw = 3.1, d = 4.6, w = n * (uw + 0.35);
  for (let k = 0; k < n; k++) {
    const s0 = mark(g), h = 6.2 + R() * 1.6, c = scl(TAR, 0.9 + R() * 1.2);
    const S = shell(g, { w: d, d: uw, h, pitch: 0.95, lod, wall: { col: c, kind: 'tar' }, roof: { col: scl(TAR, 1.2), kind: 'tar' }, seed: sp.seed + k * 3, trim: scl(TAR, 1.5), eave: 0.1, verge: 0.12 });
    // doors one above another in the gable, a hoist beam at the top
    const F = S.faces.right;
    doorOn(g, F, uw / 2, 1.0, 1.95, scl(TAR, 1.6), { lod, trim: scl(TAR, 2), boards: true });
    if (lod < 2) { rect(g, F, uw / 2 - 0.45, uw / 2 + 0.45, 2.7, 3.9, 0.03, scl(TAR, 1.6), GEL); rect(g, F, uw / 2 - 0.45, uw / 2 + 0.45, 4.5, 5.6, 0.03, scl(TAR, 1.6), GEL); rod(g, [d / 2, h + 0.5, 0], [d / 2 + 0.9, h + 0.5, 0], 0.06, [0.2, 0.15, 0.1], GRAIN, 4); }
    xf(g, s0, frame([(k - (n - 1) / 2) * (uw + 0.35), 0, 0], Math.PI / 2));
  }
  return { hx: w / 2 + 0.3, hz: d / 2 + 0.6, h: 9 };
}
function shed(g, sp, lod, lamps, gy, big = false) {
  const R = rng(sp.seed * 113 + 5), w = big ? 14 + R() * 5 : 6 + R() * 4, d = big ? 8 + R() * 2 : 5 + R() * 2, h = big ? 4.2 : 2.9 + R() * 0.6;
  const k = R(), wc = k < 0.35 ? [0.2, 0.26, 0.22] : k < 0.6 ? RUSTRED : k < 0.8 ? [0.3, 0.32, 0.33] : STONES[0], kind = k < 0.8 ? 'corr' : 'stone';
  const rc = R() < 0.5 ? [0.2, 0.21, 0.22] : scl(RUSTRED, 0.9);
  const S = shell(g, { w, d, h, pitch: big ? 0.38 : 0.5, lod, wall: { col: wc, kind }, roof: { col: rc, kind: 'corr' }, seed: sp.seed, trim: scl(wc, 0.7), eave: 0.2, verge: 0.15 });
  const o = { lod, lamps, trim: scl(wc, 0.6) }, F = S.faces, dc = [[0.1, 0.2, 0.36], [0.3, 0.3, 0.3], [0.1, 0.28, 0.16]][sp.seed % 3];
  if (big) { for (let q = 0; q < 3; q++) { const u = w * (0.2 + q * 0.3); if (lod < 2) rect(g, F.front, u - 1.6, u + 1.6, 0.02, 3.2, 0.03, dc, CORR); else rect(g, F.front, u - 1.6, u + 1.6, 0, 3.2, 0.04, dc, RUB); } }
  else { if (lod < 2) rect(g, F.front, w * 0.5 - 1.3, w * 0.5 + 1.3, 0.02, 2.4, 0.03, dc, CORR); else rect(g, F.front, w * 0.5 - 1.3, w * 0.5 + 1.3, 0, 2.4, 0.04, dc, RUB); windowOn(g, F.right, d / 2, 1.2, 0.9, 0.8, { ...o, lit: R() < 0.3 }); }
  if (lod < 2 && R() < 0.7) { const x = -w / 2 - 1.2, z = d / 2 - 1; for (let q = 0; q < 3; q++) barrel(g, [x + (q % 2) * 0.66, gy(x, z), z - q * 0.5], lod); }
  return { hx: w / 2 + 1.5, hz: d / 2 + 0.6, h: S.top + 1 };
}
function boathouse(g, sp, lod, lamps, gy) {
  const R = rng(sp.seed * 97 + 1), wd = 6.4 + R(), len = 10.5 + R() * 2, h = 3.1;
  const stone = R() < 0.5, wc = stone ? STONES[Math.floor(R() * 3)] : [0.5, 0.12, 0.08], dc = [[0.08, 0.2, 0.36], [0.1, 0.28, 0.2], [0.55, 0.5, 0.42]][sp.seed % 3];
  const s0 = mark(g);
  // the gable faces the water: the shell is built ridge-along-x and turned
  const S = shell(g, { w: len, d: wd, h, pitch: 0.7, lod, wall: { col: wc, kind: stone ? 'stone' : 'boards' }, roof: { col: R() < 0.5 ? SLATES[0] : RUSTRED, kind: R() < 0.5 ? 'slate' : 'corr' }, seed: sp.seed, trim: WHITE });
  const own = [], F = S.faces.right, o = { lod, lamps: lamps ? own : null, trim: WHITE };
  // double doors, boarded, with strap hinges; a round window in the gable
  if (lod < 2) { rect(g, F, wd / 2 - 2.2, wd / 2 + 2.2, 0.02, 2.9, 0.03, dc, GEL); if (lod === 0) { for (let k = 1; k < 22; k++) rect(g, F, wd / 2 - 2.2 + k * 0.2 - 0.008, wd / 2 - 2.2 + k * 0.2 + 0.008, 0.03, 2.88, 0.034, scl(dc, 0.5), RUB); for (const v of [0.6, 2.3]) for (const s of [-1, 1]) bar(g, F, wd / 2 + s * 2.15 - (s > 0 ? 1.4 : 0), wd / 2 + s * 2.15 + (s > 0 ? 0 : 1.4), v, v + 0.09, 0.03, 0.05, [0.05, 0.05, 0.05], MET); bar(g, F, wd / 2 - 0.02, wd / 2 + 0.02, 0, 2.9, 0.03, 0.045, scl(dc, 0.4), RUB); } }
  else rect(g, F, wd / 2 - 2.2, wd / 2 + 2.2, 0, 2.9, 0.04, dc, RUB);
  if (lod < 2) windowOn(g, F, wd / 2, 3.5, 0.7, 0.7, { ...o, lit: false });
  windowOn(g, S.faces.front, len * 0.5, 1.2, 1.0, 0.9, { ...o, lit: R() < 0.3 });
  xf(g, s0, frame([0, 0, 0], Math.PI / 2));
  if (lamps) for (const l of own) lamps.push({ ...l, p: [-l.p[2], l.p[1], l.p[0]] });
  // rails down toward the water, a winch, a dinghy's chocks
  if (lod === 0) { for (const s of [-1, 1]) for (let k = 0; k < 6; k++) { const z = len / 2 + 0.5 + k * 2, y = gy(s * 0.9, z); rod(g, [s * 0.9, y + 0.06, z], [s * 0.9, gy(s * 0.9, z + 2) + 0.06, z + 2], 0.04, [0.3, 0.17, 0.1], MET, 4); if (s > 0) slab(g, -1.3, 1.3, y - 0.05, y + 0.05, z - 0.1, z + 0.1, [0.25, 0.19, 0.12], GRAIN); } }
  return { hx: wd / 2 + 0.8, hz: len / 2 + 1, h: S.top + 1 };
}
function barn(g, sp, lod, lamps, gy) {
  const R = rng(sp.seed * 61 + 3), w = 12 + R() * 6, d = 6.5 + R() * 1.5, h = 3.6;
  const S = shell(g, { w, d, h, pitch: 0.62, lod, wall: { col: STONES[sp.seed % 3], kind: 'stone' }, roof: { col: R() < 0.6 ? RUSTRED : [0.25, 0.26, 0.27], kind: 'corr' }, seed: sp.seed, trim: [0.3, 0.2, 0.12], eave: 0.2 });
  const F = S.faces;
  if (lod < 2) { rect(g, F.front, w * 0.3 - 1.5, w * 0.3 + 1.5, 0.02, 3.1, 0.03, [0.3, 0.2, 0.12], GRAIN); rect(g, F.front, w * 0.75 - 0.6, w * 0.75 + 0.6, 0.02, 2.0, 0.03, [0.3, 0.2, 0.12], GRAIN); }
  else rect(g, F.front, w * 0.3 - 1.5, w * 0.3 + 1.5, 0, 3.1, 0.04, [0.2, 0.14, 0.09], RUB);
  // a yard wall
  gardenWall(g, [[-w / 2, d / 2], [-w / 2, d / 2 + 9], [w * 0.2, d / 2 + 9]], gy, lod, sp.seed, [0.34, 0.32, 0.29], 1.2);
  return { hx: w / 2 + 0.5, hz: d / 2 + 9.5, h: S.top + 1 };
}
const BUILDERS = { cottage, house2, terrace, pub, chapel, office, netloft: netLoft, shed, market: (g, sp, lod, lamps, gy) => shed(g, sp, lod, lamps, gy, true), boathouse, barn, farmhouse: (g, sp, lod, lamps, gy) => house2(g, sp, lod, lamps, gy, true) };
// half the footprint (with its garden) of each kind, for laying a settlement out before anything is built
export const FOOT = { cottage: [7.5, 9], house2: [7.2, 9.5], terrace: [14.5, 9.5], pub: [7.2, 7.5], chapel: [17, 12], office: [6.5, 4.5], netloft: [7.5, 3.2], shed: [6.6, 4.2], market: [11.5, 5.8], boathouse: [4.6, 7.5], barn: [9.6, 13.5], farmhouse: [7.2, 9.5] };

// One building into g at its place: b = { type, seed, x, y, z, yaw } relative to the mesh's origin; groundAt(wx, wz)
// gives the ground's height at a point of the same space. lamps (if given) collects its lit windows in that space.
export function buildingGeo(g, b, lod, groundAt, lamps) {
  const s0 = mark(g), c = Math.cos(b.yaw), s = Math.sin(b.yaw), own = [];
  const gy = (x, z) => groundAt(b.x + c * x - s * z, b.z + s * x + c * z) - b.y;
  const r = BUILDERS[b.type](g, { type: b.type, seed: b.seed }, lod, lamps ? own : null, gy);
  xf(g, s0, frame([b.x, b.y, b.z], b.yaw));
  if (lamps) for (const l of own) lamps.push({ ...l, p: [b.x + c * l.p[0] - s * l.p[2], b.y + l.p[1], b.z + s * l.p[0] + c * l.p[2]] });
  return r;
}

// ---- where the buildings stand: a pure function of the course ----
// Returns [{ type, seed, x, y, z, yaw, group, r }]: the harbour's row behind each quay (office, pub, net lofts, market,
// terraces), the village on its ground (houses facing the sea, a chapel on its highest spot), a boathouse by each
// slipway, and farms on the farmed hills within `reach` of the line. Nothing stands in water, on a quay's working
// strip, across a pier or on another's plot.
export function placeBuildings(field, def, quays, piers, slips, segs, courseSeed, reach = 1500) {
  const out = [], sm = { h: 0, gx: 0, gz: 0 };
  const clash = (x, z, r) => out.some((b) => Math.hypot(b.x - x, b.z - z) < r + b.r);
  const flatY = (x, z, yaw, hx, hz, lim = 2.2) => {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    let lo = 1e9, hi = -1e9;
    for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]]) { const h = field.heightAt(x + c * u * hx - s * v * hz, z + s * u * hx + c * v * hz); lo = Math.min(lo, h); hi = Math.max(hi, h); }
    if (lo < 1.2 || hi - lo > lim) return null;
    // the floor: at the front's ground or a little above, dug into what rises behind
    const front = Math.max(field.heightAt(x - s * hz * 0.7 + c * hx * 0.5, z + c * hz * 0.7 + s * hx * 0.5), field.heightAt(x - s * hz * 0.7 - c * hx * 0.5, z + c * hz * 0.7 - s * hx * 0.5));
    return Math.max(front, hi - 1.3) + 0.12;
  };
  const add = (type, x, z, yaw, seed, group, lim, minY = -1e9) => {
    const F = FOOT[type];
    let y = flatY(x, z, yaw, F[0] * 0.8, F[1] * 0.6, lim);
    if (y === null) return false;
    y = Math.max(y, minY);
    // not across a pier (its root may lie well inland, on a quay)
    const c = Math.cos(yaw), s = Math.sin(yaw);
    for (const p of piers) for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0], [0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const dx = x + c * u * F[0] - s * v * F[1] - p.x, dz = z + s * u * F[0] + c * v * F[1] - p.z, t = dx * p.cx + dz * p.cz, w = -dx * p.cz + dz * p.cx;
      if (t > -4 && t < p.len + 2 && Math.abs(w) < p.w / 2 + 2.5) return false;
    }
    const r = Math.max(F[0], F[1]);
    if (clash(x, z, r * 0.9)) return false;
    out.push({ type, seed, x, y, z, yaw, group, r });
    return true;
  };
  // ---- the harbour row: fronts on a line behind the roadway, facing the water ----
  quays.forEach((q, qi) => {
    const R = rng(courseSeed * 31 + qi * 7 + 1), yaw = q.yaw - Math.PI / 2;
    const row = (zf, list) => {
      let X = -q.hw + 5, k = 0;
      while (X < q.hw - 5) {
        const type = list[k % list.length], F = FOOT[type], gap = 1.2 + R() * 3.5;
        const Xc = X + F[0], zin = zf + F[1] * 0.75, p = q.W(Xc, -zin);
        if (Xc + F[0] > q.half(zin) - 2) break;
        // (its floor stands on the paving, which is level with the quay where the ground is lower)
        let dy = -1e9;
        for (const u of [-1, 0, 1]) dy = Math.max(dy, q.deckY(Xc + u * F[0] * 0.8, zin - F[1] * 0.6));
        add(type, p[0], p[1], yaw + (R() - 0.5) * 0.04, 1 + Math.floor(R() * 900), 'quay' + qi, 3.2, zin < q.paved + 8 ? dy + 0.03 : -1e9);
        X += F[0] * 2 + gap; k++;
      }
    };
    const kinds = ['office', 'netloft', 'pub', 'market', 'terrace', 'house2', 'netloft', 'shed', 'terrace', 'cottage', 'market', 'house2', 'terrace', 'shed'];
    const start = Math.floor(R() * 3);
    row(20.5, kinds.slice(start).concat(kinds.slice(0, start)));
    if (q.depth > 75) row(48, ['house2', 'cottage', 'terrace', 'cottage', 'house2', 'shed', 'terrace', 'cottage']);
  });
  // a boathouse at the head of each slipway
  slips.forEach((s, i) => { const yaw = Math.atan2(s.dz, s.dx) - Math.PI / 2; add('boathouse', s.x - s.dx * 9, s.z - s.dz * 9, yaw, 11 + i * 5, 'slip' + i, 3.5); });
  // ---- the village ----
  const v = def.village;
  if (v) {
    const R = rng(courseSeed * 131 + 17);
    // which way is the sea: the lowest ground round about
    const seaward = (x, z) => { let best = 0, bh = 1e9; for (let a = 0; a < 16; a++) { const t = (a / 16) * TAU; const h = field.heightAt(x + Math.cos(t) * 45, z + Math.sin(t) * 45) + field.heightAt(x + Math.cos(t) * 90, z + Math.sin(t) * 90); if (h < bh) { bh = h; best = t; } } return best; };
    // the chapel first, on the highest fit ground
    let best = null;
    for (let j = 0; j < 6; j++) for (let i = 0; i < 12; i++) {
      const x = v.x + ((i + 0.5) / 12 - 0.5) * v.w, z = v.z + ((j + 0.5) / 6 - 0.5) * v.d;
      if (quays.some((q) => q.inside(x, z, 20))) continue;
      const yaw = seaward(x, z) - Math.PI / 2, y = flatY(x, z, yaw, 13, 8, 1.8);
      if (y !== null && y > 3 && (!best || y > best.y)) best = { x, z, yaw, y };
    }
    if (best) add('chapel', best.x, best.z, best.yaw, 3 + courseSeed, 'village', 1.8);
    const rows = Math.max(1, Math.round(v.d / 24)), n = Math.max(v.n, Math.round(v.w / 15) * rows);
    const per = Math.ceil(n / rows);
    for (let j = 0; j < rows; j++) for (let i = 0; i < per; i++) {
      const x = v.x + ((i + 0.5 + (R() - 0.5) * 0.5) / per - 0.5) * v.w, z = v.z + ((j + 0.5 + (R() - 0.5) * 0.35) / rows - 0.5) * v.d;
      const q = R(), type = q < 0.4 ? 'cottage' : q < 0.72 ? 'house2' : q < 0.9 ? 'terrace' : 'shed', seed = 1 + Math.floor(R() * 900), jit = (R() - 0.5) * 0.3;
      if (quays.some((qq) => { const L = qq.local(x, z); return qq.inside(x, z, 2) && L[1] < 20; })) continue;
      field.sample(x, z, sm);
      if (sm.h < v.min || sm.h > v.max + 6) continue;
      add(type, x, z, seaward(x, z) - Math.PI / 2 + jit, seed, 'village', 2.2);
    }
  }
  // ---- farms on the hills ----
  {
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const s of segs) { x0 = Math.min(x0, s[0], s[2]); x1 = Math.max(x1, s[0], s[2]); z0 = Math.min(z0, s[1], s[3]); z1 = Math.max(z1, s[1], s[3]); }
    const cell = 210, f = { d: 0, id: 0, along: 0 };
    for (let j = Math.floor((z0 - reach) / cell); j <= Math.ceil((z1 + reach) / cell); j++) for (let i = Math.floor((x0 - reach) / cell); i <= Math.ceil((x1 + reach) / cell); i++) {
      if (hash1(i * 3 + 7, j * 5 + 11) > 0.62) continue;
      const x = (i + 0.2 + 0.6 * hash1(i, j * 7 + 1)) * cell, z = (j + 0.2 + 0.6 * hash1(i * 7 + 2, j)) * cell;
      field.sample(x, z, sm);
      const ny = 1 / Math.hypot(sm.gx, 1, sm.gz);
      if (fieldGate(sm.h, ny) * fieldMask(x, z) < 0.6 || woodsAt(x, z) * woodsGate(sm.h, ny) > 0.3 || trackD(x, z) < 8) continue;
      if (fieldAt(x, z, f).d > 30) continue;      // a farm stands at the edge of its fields
      const gl = Math.hypot(sm.gx, sm.gz), yaw = (gl > 0.01 ? Math.atan2(-sm.gz, -sm.gx) : hash1(i, j) * TAU) - Math.PI / 2, seed = 1 + Math.floor(hash1(i * 13, j * 17) * 900), grp = 'farm' + Math.floor(x / 640) + '_' + Math.floor(z / 640);
      if (!add(hash1(i, j + 5) < 0.6 ? 'farmhouse' : 'cottage', x, z, yaw, seed, grp, 2.4)) continue;
      const c = Math.cos(yaw), s = Math.sin(yaw);
      add('barn', x + c * 19 + s * 3, z + s * 19 - c * 3, yaw + Math.PI / 2, seed + 1, grp, 3);
      if (hash1(i + 9, j) < 0.5) add('shed', x - c * 15 + s * 9, z - s * 15 - c * 9, yaw, seed + 2, grp, 2.6);
    }
  }
  return out;
}
