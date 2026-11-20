// Trees and scrub: what they look like and where they stand.
//
// Kinds (SPECIES): an oak (broad, round-headed), a birch (slender, pale-stemmed, light), a Scots pine (a bare
// stem under flat pads of needles), a spruce (tiers of drooping skirts: the dark blocks of a plantation), a
// hawthorn shaped by the wind (leaning, its head swept to leeward: the tree of an exposed coast), and bushes
// (gorse and thorn in low clumps). Each is built at four levels of detail with the kit, as a tree one unit
// tall: a trunk and limbs, and a head of lumpy puffs of foliage whose normals lean toward the head's own, so a
// tree is lit as one mass and not as a bunch of balls. The far level is a dozen triangles that keep the
// outline and the colour.
//
// The meshes are not drawn as meshes: every kind at one level is padded to the same vertex count and written
// into one float texture (packLevel), a row of positions, a row of normals and a row of colours per kind. The
// coastal system draws a cell of trees as one instanced draw whatever kinds are in it; the vertex shader
// fetches its vertex from the row of the instance's kind.
//
// Where they stand (plantTrees) is a pure function of the course: in the woods the terrain shader paints
// (models/cover.js: the same functions), spruce in plantation blocks, pine and birch higher up, wind-shaped
// thorn and smaller trees near the sea; along the hedges of the fields; scattered thorn and gorse on rough
// ground; and among the houses. Never in water, on a quay, a building's plot, a lane or a pier.
//
// Triangles a tree (near / middle / far / farthest): 1520 / 670 / 52 / 8 (every kind padded to the largest).
import { Geo, rng, TAU, lerp, smooth, clamp, hash1, vn, fb, sheet, tube } from './kit.js';
import { woodsAt, woodsGate, fieldAt, fieldMask, fieldGate, trackD, lvn } from './cover.js';

export const SPECIES = ['oak', 'birch', 'pine', 'spruce', 'thorn', 'bush'];
// height range (m), width relative to the unit tree, leaf and bark colours
const KIND = {
  oak: { h: [8, 14], leaf: [0.07, 0.115, 0.03], bark: [0.085, 0.07, 0.055] },
  birch: { h: [8, 13], leaf: [0.105, 0.15, 0.04], bark: [0.42, 0.4, 0.36] },
  pine: { h: [10, 17], leaf: [0.035, 0.07, 0.04], bark: [0.15, 0.095, 0.065] },
  spruce: { h: [9, 17], leaf: [0.028, 0.058, 0.03], bark: [0.08, 0.06, 0.045] },
  thorn: { h: [3.2, 5.6], leaf: [0.06, 0.095, 0.03], bark: [0.07, 0.06, 0.05] },
  bush: { h: [1.1, 2.4], leaf: [0.05, 0.085, 0.028], bark: [0.07, 0.06, 0.05] },
};
export const TREE_H = SPECIES.map((s) => KIND[s].h);
const BARK = [0, 0, 0], LEAF = [1, 0, 0];
// puff detail by level: latitude rows, longitude columns
const PUFF = [[5, 8], [4, 7], [2, 5], [0, 0]];

// a lump of foliage: an ellipsoid whose radius wanders
function puff(g, c, rx, ry, rz, lod, seed, col) {
  const [n, m] = PUFF[lod];
  if (!n) return;
  sheet(g, n + 1, m + 1, (i, j, out) => {
    const a = (i / n - 0.5) * Math.PI, th = ((j % m) / m) * TAU, ca = Math.cos(a), sa = Math.sin(a), cx = Math.cos(th), cz = Math.sin(th);
    const k = i === 0 || i === n ? 0.9 : 0.55 + 0.9 * fb(cx * ca * 2.3 + seed, sa * 2.3, cz * ca * 2.3 + seed * 0.3);
    out[0] = c[0] + rx * ca * cx * k; out[1] = c[1] + ry * sa * (sa < 0 ? 0.7 : 1) * k; out[2] = c[2] + rz * ca * cz * k;
  }, col, LEAF, { wrap: true });
}
// One tree, one unit tall, as { g, crown: [cx, cy, cz, rx, ry, rz] } (the crown's centre and radii, for shading).
export function treeGeo(kind, lod = 0, seed = 1) {
  const K = KIND[kind], R = rng(seed * 4099 + SPECIES.indexOf(kind) * 131 + 7), g = new Geo(4096);
  const leaf = K.leaf, bark = K.bark, ts = [8, 5, 3, 0][lod];
  let crown;
  const trunk = (pts, r0, r1) => { if (ts) tube(g, pts, pts.map((p, i) => lerp(r0, r1, i / (pts.length - 1))), bark, BARK, { segs: ts }); };
  const tone = (k) => [leaf[0] * k, leaf[1] * k, leaf[2] * (2 - k)];
  if (lod === 3) {
    // the farthest level: two crossed diamonds through the head, and nothing else
    const sh = { oak: [0.62, 0.36, 0.4, 0.2], birch: [0.64, 0.38, 0.26, 0.22], pine: [0.8, 0.2, 0.3, 0.55], spruce: [0.52, 0.48, 0.2, 0.06], thorn: [0.62, 0.34, 0.6, 0.18], bush: [0.5, 0.5, 0.7, 0.0] }[kind];
    const cy = sh[0], ry = sh[1], rx = sh[2], lean = kind === 'thorn' ? 0.3 : 0;
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI, c = Math.cos(a) * rx, s = Math.sin(a) * rx, top = [lean * 1.2, cy + ry, 0], bot = [0, Math.max(cy - ry, sh[3] * 0.5), 0], yb = kind === 'spruce' ? cy - ry * 0.75 : cy;
      const L = [lean + c, yb, s], Rr = [lean - c, yb, -s];
      g.tri(bot, L, top, [c, 0, s], [c, 0.3, s], [0, 1, 0], leaf, LEAF); g.tri(bot, top, Rr, [-c, 0, -s], [0, 1, 0], [-c, 0.3, -s], leaf, LEAF);
    }
    if (kind === 'pine' || kind === 'birch' || kind === 'oak') { const w = 0.02; g.tri([-w, 0, 0], [w, 0, 0], [0, sh[3] + 0.1, 0], [0, 0, 1], [0, 0, 1], [0, 0, 1], bark, BARK); g.tri([0, 0, -w], [0, 0, w], [0, sh[3] + 0.1, 0], [1, 0, 0], [1, 0, 0], [1, 0, 0], bark, BARK); }
    return { g, crown: [lean, cy, 0, rx, ry, rx] };
  }
  if (kind === 'oak' || kind === 'birch') {
    const oak = kind === 'oak', cy = oak ? 0.63 : 0.66, ry = oak ? 0.36 : 0.34, rx = oak ? 0.4 : 0.24, tb = oak ? 0.3 : 0.4;
    trunk([[0, -0.03, 0], [0.01, tb * 0.5, 0.01], [0.0, tb, 0], [0.02, cy, 0.01]], oak ? 0.05 : 0.028, oak ? 0.022 : 0.012);
    // puffs spread through the head on a spiral, smaller toward the outside and the top, so the outline is broken
    // and there are gaps into the dark inside
    const n = lod === 0 ? (oak ? 19 : 15) : lod === 1 ? (oak ? 12 : 10) : 3;
    for (let k = 0; k < n; k++) {
      const u = (k + 0.5) / n, yy = 1 - 2 * u, rr = Math.sqrt(Math.max(1 - yy * yy, 0)), a = k * 2.39996 + R() * 0.5, d = 0.62 + 0.3 * R();
      const c = [Math.cos(a) * rr * rx * d, cy + yy * ry * 0.8 * (yy < 0 ? 0.6 : 1) + (R() - 0.5) * 0.05, Math.sin(a) * rr * rx * d];
      const pr = (oak ? 0.165 : 0.115) * (0.75 + 0.6 * R()) * (lod === 2 ? 2.0 : lod === 1 ? 1.22 : 1);
      puff(g, c, pr * 1.2, pr * (oak ? 0.82 : 1.05), pr * 1.2, lod, seed + k * 3.7, tone(0.75 + 0.5 * R()));
      if (lod === 0 && k % 2 === 0 && yy < 0.6) trunk([[0, tb * (0.75 + 0.35 * R()), 0], [c[0] * 0.45, lerp(tb, c[1], 0.55), c[2] * 0.45], [c[0] * 0.9, c[1] - pr * 0.3, c[2] * 0.9]], oak ? 0.02 : 0.011, 0.005);
    }
    crown = [0, cy, 0, rx * 1.15, ry * 1.1, rx * 1.15];
  } else if (kind === 'pine') {
    trunk([[0, -0.03, 0], [0.015, 0.3, 0.0], [0.0, 0.62, 0.01], [0.02, 0.9, 0.0]], 0.035, 0.012);
    // pads of needles on the ends of a few boughs, flat-topped, the crown open between them
    const n = lod === 0 ? 11 : lod === 1 ? 8 : 3;
    for (let k = 0; k < n; k++) {
      const t = k / (n - 1), a = k * 2.4 + R(), d = k === n - 1 ? 0 : 0.2 * (1 - t * 0.55) * (0.5 + 0.9 * R()), y = lerp(0.58, 0.95, t) + (R() - 0.5) * 0.04;
      const c = [Math.cos(a) * d, y, Math.sin(a) * d], pr = 0.15 * (1 - 0.3 * t) * (0.75 + 0.5 * R()) * (lod === 2 ? 1.7 : lod === 1 ? 1.15 : 1);
      puff(g, c, pr, pr * 0.46, pr, lod, seed + k * 5.1, tone(0.75 + 0.5 * R()));
      if (lod === 0 && d > 0) trunk([[0.01, y - 0.09, 0], [c[0] * 0.6, y - 0.05, c[2] * 0.6], [c[0], y - 0.01, c[2]]], 0.012, 0.005);
    }
    crown = [0, 0.78, 0, 0.3, 0.22, 0.3];
  } else if (kind === 'spruce') {
    trunk([[0, -0.03, 0], [0, 0.5, 0], [0, 0.97, 0]], 0.028, 0.004);
    // whorls of boughs: each a skirt whose rim runs out to the tips of its boughs and back between them, drooping
    // at the tips; smaller and closer toward the leader, none two alike, so the outline is a saw's and not a cone's
    const n = lod === 0 ? 11 : lod === 1 ? 7 : 2, m = lod === 0 ? 12 : lod === 1 ? 10 : 5;
    for (let k = 0; k < n; k++) {
      const t0 = k / n, y0 = lerp(0.1, 0.93, Math.pow(t0, 0.9)), y1 = lerp(0.1, 0.93, Math.pow((k + 1.45) / n, 0.9)), r0 = 0.235 * (1 - t0 * 0.88) * (0.82 + 0.36 * R()), sd = seed + k * 2.3, col = tone(0.78 + 0.44 * R()), tw = R() * TAU;
      sheet(g, 3, m + 1, (i, j, out) => {
        const jj = j % m, th = (jj / m) * TAU + tw, tip = lod < 2 && (jj & 1) ? 0.58 : 1.08, kk = tip * (0.8 + 0.4 * vn(Math.cos(th) * 2 + sd, k, Math.sin(th) * 2)), r = i === 0 ? r0 * kk : i === 1 ? r0 * 0.42 : 0.004;
        out[0] = Math.cos(th) * r; out[1] = i === 0 ? y0 - 0.035 * kk * (1 - t0 * 0.6) : i === 1 ? lerp(y0, y1, 0.42) : Math.min(y1, 1); out[2] = Math.sin(th) * r;
      }, col, LEAF, { wrap: true });
    }
    crown = [0, 0.52, 0, 0.24, 0.5, 0.24];
  } else if (kind === 'thorn') {
    // the trunk leans downwind (+x) and the head is swept out that way, low to windward
    trunk([[0, -0.03, 0], [0.05, 0.22, 0.01], [0.16, 0.42, 0], [0.3, 0.55, 0.01]], 0.05, 0.02);
    const n = lod === 0 ? 9 : lod === 1 ? 7 : 3;
    for (let k = 0; k < n; k++) {
      const t = k / (n - 1), x = lerp(-0.1, 0.78, t), y = 0.52 + 0.22 * Math.sin(t * 2.6) + (R() - 0.5) * 0.06, z = (R() - 0.5) * 0.36 * Math.sin(t * Math.PI + 0.4);
      const pr = (0.15 + 0.12 * Math.sin(t * Math.PI)) * (0.85 + 0.3 * R()) * (lod === 2 ? 1.4 : 1);
      puff(g, [x, y, z], pr * 1.5, pr * 0.85, pr * 1.2, lod, seed + k * 4.3, tone(0.8 + 0.4 * R()));
      if (lod === 0 && k % 2) trunk([[0.2, 0.45, 0], [lerp(0.2, x, 0.6), y - 0.08, z * 0.6], [x, y - 0.03, z]], 0.016, 0.006);
    }
    crown = [0.34, 0.6, 0, 0.6, 0.3, 0.32];
  } else {
    const n = lod === 0 ? 6 : lod === 1 ? 4 : 2;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU + R(), d = k === 0 ? 0 : 0.5 * (0.6 + 0.6 * R()), pr = (0.42 - 0.1 * (k > 0)) * (0.8 + 0.4 * R()) * (lod === 2 ? 1.3 : 1);
      puff(g, [Math.cos(a) * d, 0.34 + (k === 0 ? 0.18 : 0), Math.sin(a) * d], pr * 1.2, pr * (0.9 + 0.5 * (k === 0)), pr * 1.2, lod, seed + k * 6.1, tone(0.8 + 0.4 * R()));
    }
    crown = [0, 0.45, 0, 0.9, 0.55, 0.9];
  }
  return { g, crown };
}

// Every kind at one level as rows of a float texture: per kind a row of (position, shade), a row of (normal,
// part + sway), a row of (colour). Returns { data, width, rows, verts } (verts: the vertices every instance draws).
export function packLevel(lod, seed = 1) {
  const trees = SPECIES.map((k, i) => treeGeo(k, lod, seed + i * 11));
  // (a row of vertices wraps at 2048 texels, so the texture fits any GL's size limit)
  const verts = Math.max(...trees.map((t) => t.g.nv)), width = Math.min(verts, 2048), wrap = Math.ceil(verts / width), rows = SPECIES.length * 3 * wrap;
  const data = new Float32Array(width * rows * 4);
  const at = (row, v) => ((row * wrap + Math.floor(v / width)) * width + (v % width)) * 4;
  trees.forEach((t, s) => {
    const g = t.g, P = g.P, N = g.N, C = g.C, M = g.M, cr = t.crown;
    for (let v = 0; v < verts; v++) {
      // (padding repeats the last vertex: triangles of no area)
      const i = Math.min(v, g.nv - 1) * 3, a = at(s * 3, v), b = at(s * 3 + 1, v), c = at(s * 3 + 2, v);
      const x = P[i], y = P[i + 1], z = P[i + 2], leaf = M[i] > 0.5;
      let nx = N[i], ny = N[i + 1], nz = N[i + 2], shade = 1;
      if (leaf) {
        // the head's own normal, and how far out in the head the point is: the inside and the underside are dark
        let dx = (x - cr[0]) / cr[3], dy = (y - cr[1]) / cr[4], dz = (z - cr[2]) / cr[5];
        const dl = Math.hypot(dx, dy, dz) || 1, out = clamp(dl, 0, 1.2);
        dx /= dl; dy /= dl; dz /= dl;
        const facing = nx * dx + ny * dy + nz * dz;
        shade = clamp(0.28 + 0.5 * out * (0.5 + 0.5 * facing) + 0.3 * (dy * 0.5 + 0.5), 0.25, 1);
        nx = nx * 0.45 + dx * 0.55; ny = ny * 0.45 + dy * 0.55 + 0.12; nz = nz * 0.45 + dz * 0.55;
        const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      } else shade = 0.55 + 0.45 * smooth(0, 0.35, y) * (1 - smooth(0.4, 0.7, y) * 0.5);
      data[a] = x; data[a + 1] = y; data[a + 2] = z; data[a + 3] = shade;
      data[b] = nx; data[b + 1] = ny; data[b + 2] = nz; data[b + 3] = (leaf ? 1 : 0) + 0.49 * clamp(y * y * (leaf ? 1 : 0.6), 0, 1);
      data[c] = C[i]; data[c + 1] = C[i + 1]; data[c + 2] = C[i + 2]; data[c + 3] = 1;
    }
  });
  return { data, width, rows, wrap, verts, tris: verts / 3 };
}

// ---- planting ----
export const TREE_CELL = 96, TREE_BLOCK = 4, TREE_REACH = 1650, FLOATS = 8;
export const WIND_YAW = 0.6;     // the way the prevailing wind blows (the thorn trees lean with it)
// Plant a course. avoid: [{ x, z, r }] (buildings and other plots); quays: plans with inside(); piers: plans.
// Returns { data: Float32Array (x, y, z, height, kind, yaw, width, tint per tree), cells: [{ x0, z0, x1, z1, y0, y1,
// start, count }], blocks: [{ the same, and first, n: its run of cells }] }. Cells are stored block by block
// (TREE_BLOCK cells a side), so a far block's trees are one run of the buffer and one draw.
export function plantTrees(field, segs, avoid, quays, piers, reach = TREE_REACH) {
  const step = 6.5, sm = { h: 0, gx: 0, gz: 0 }, f = { d: 0, id: 0, along: 0 };
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const s of segs) { x0 = Math.min(x0, s[0], s[2]); x1 = Math.max(x1, s[0], s[2]); z0 = Math.min(z0, s[1], s[3]); z1 = Math.max(z1, s[1], s[3]); }
  const lineD = (x, z) => {
    let best = 1e9;
    for (const s of segs) {
      const dx = s[2] - s[0], dz = s[3] - s[1];
      let t = ((x - s[0]) * dx + (z - s[1]) * dz) / (dx * dx + dz * dz || 1); t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(s[0] + dx * t - x, s[1] + dz * t - z); if (d < best) best = d;
    }
    return best;
  };
  // a coarse grid of what to keep clear of
  const AG = 24, amap = new Map();
  for (const a of avoid) for (let j = Math.floor((a.z - a.r) / AG); j <= Math.floor((a.z + a.r) / AG); j++) for (let i = Math.floor((a.x - a.r) / AG); i <= Math.floor((a.x + a.r) / AG); i++) { const k = i * 65536 + j; let l = amap.get(k); if (!l) amap.set(k, l = []); l.push(a); }
  const blocked = (x, z) => { const l = amap.get(Math.floor(x / AG) * 65536 + Math.floor(z / AG)); if (l) for (const a of l) if (Math.hypot(a.x - x, a.z - z) < a.r) return true; return false; };
  const nearHouse = (x, z) => { for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const l = amap.get((Math.floor(x / AG) + di) * 65536 + Math.floor(z / AG) + dj); if (l) for (const a of l) if (a.house && Math.hypot(a.x - x, a.z - z) < a.r + 16) return true; } return false; };
  const cells = [];
  const ci0 = Math.floor((x0 - reach) / TREE_CELL), ci1 = Math.floor((x1 + reach) / TREE_CELL), cj0 = Math.floor((z0 - reach) / TREE_CELL), cj1 = Math.floor((z1 + reach) / TREE_CELL);
  const per = Math.round(TREE_CELL / step);
  let total = 0;
  for (let cj = cj0; cj <= cj1; cj++) for (let ci = ci0; ci <= ci1; ci++) {
    const cx = (ci + 0.5) * TREE_CELL, cz = (cj + 0.5) * TREE_CELL, dl = lineD(cx, cz);
    if (dl > reach + TREE_CELL * 0.7) continue;
    // a quick look: a cell that is all sea has no trees
    let land = false;
    for (let b = 0; b < 9 && !land; b++) if (field.heightAt(cx + ((b % 3) - 1) * TREE_CELL * 0.45, cz + (Math.floor(b / 3) - 1) * TREE_CELL * 0.45) > 2.5) land = true;
    if (!land) continue;
    const thin = dl > 700 ? 0.55 : 1, big = dl > 700 ? 1.25 : 1;
    const list = [];
    let y0 = 1e9, y1 = -1e9;
    for (let j = 0; j < per; j++) for (let i = 0; i < per; i++) {
      const gi = ci * per + i, gj = cj * per + j;
      const x = (gi + hash1(gi * 3 + 1, gj * 5 + 2)) * step, z = (gj + hash1(gi * 7 + 3, gj * 11 + 4)) * step;
      const q = hash1(gi * 13 + 5, gj * 17 + 6);
      if (q > thin) continue;
      const q1 = q / thin;
      const w = woodsAt(x, z);
      let kind = -1, sizeK = 1;
      // (the cheap tests first: most of a course is open ground or sea)
      const fm = w > 0.02 ? 0 : fieldMask(x, z);
      const hedge = fm > 0.5 && fieldAt(x, z, f).d < 1.7;
      const scrub = w <= 0.02 && !hedge && lvn(x / 38, z / 38, 961) > 0.63;
      const lone = q1 < 0.012;
      if (!(w > 0.02 || hedge || scrub || lone) && !(q1 < 0.1 && nearHouse(x, z))) continue;
      field.sample(x, z, sm);
      const h = sm.h;
      if (h < 3.0) continue;
      const ny = 1 / Math.hypot(sm.gx, 1, sm.gz);
      const r2 = hash1(gi * 19 + 7, gj * 23 + 8), r3 = hash1(gi * 29 + 9, gj * 31 + 10);
      const exposed = 1 - smooth(6, 28, h);       // low ground by the sea takes the wind
      if (w > 0.02 && q1 < w * woodsGate(h, ny) * 0.9) {
        const plantation = lvn(x / 240, z / 240, 951) > 0.6;
        const high = smooth(60, 130, h);
        kind = plantation ? 3 : r2 < 0.15 + 0.4 * high ? 2 : r2 < 0.4 + 0.3 * high ? 1 : r2 < 0.5 + 0.4 * exposed ? 4 : 0;
        // the edge of a wood is lower
        sizeK = 0.7 + 0.3 * smooth(0.05, 0.6, w);
      } else if (hedge && fieldGate(h, ny) > 0.5 && q1 < 0.34) { kind = r2 < 0.5 ? 5 : r2 < 0.75 ? 4 : r2 < 0.9 ? 0 : 1; sizeK = 0.85; }
      else if (scrub && ny > 0.8 && h < 150 && q1 < 0.3) { kind = r2 < 0.75 ? 5 : 4; }
      else if (lone && ny > 0.85 && h < 140) { kind = r2 < 0.45 ? 4 : r2 < 0.7 ? 5 : r2 < 0.85 ? 0 : 1; }
      else if (q1 < 0.1 && ny > 0.85 && nearHouse(x, z)) { kind = r2 < 0.35 ? 0 : r2 < 0.6 ? 1 : r2 < 0.8 ? 5 : 4; sizeK = 0.8; }
      if (kind < 0) continue;
      if (trackD(x, z) < 3.2 || blocked(x, z)) continue;
      // (a quay keeps its apron and the row behind it clear; further back its block is ground like any other)
      if (quays.some((qq) => qq.inside(x, z, 3) && qq.local(x, z)[1] < qq.paved + 16) || piers.some((p) => { const dx = x - p.x, dz = z - p.z, t = dx * p.cx + dz * p.cz, s = -dx * p.cz + dz * p.cx; return t > -3 && t < p.len + 3 && Math.abs(s) < p.w / 2 + 3; })) continue;
      const H = TREE_H[kind], hgt = lerp(H[0], H[1], r3) * sizeK * big * (kind < 4 ? 1 - 0.4 * exposed : 1);
      list.push(x, h - 0.1, z, hgt, kind, kind === 4 ? WIND_YAW + (r2 - 0.5) * 0.5 : r2 * 39.7, 0.85 + 0.4 * hash1(gi, gj * 3 + 1), hash1(gi * 5 + 2, gj));
      if (h < y0) y0 = h; if (h + hgt > y1) y1 = h + hgt;
    }
    if (!list.length) continue;
    const n = list.length / FLOATS;
    cells.push({ x0: ci * TREE_CELL, z0: cj * TREE_CELL, x1: (ci + 1) * TREE_CELL, z1: (cj + 1) * TREE_CELL, y0, y1, start: 0, count: n, list, bi: Math.floor(ci / TREE_BLOCK), bj: Math.floor(cj / TREE_BLOCK) });
    total += n;
  }
  // block by block
  cells.sort((a, b) => a.bj - b.bj || a.bi - b.bi || a.z0 - b.z0 || a.x0 - b.x0);
  const data = new Float32Array(total * FLOATS), blocks = [];
  let o = 0, blk = null;
  cells.forEach((c, k) => {
    if (!blk || blk.bi !== c.bi || blk.bj !== c.bj) { blk = { bi: c.bi, bj: c.bj, x0: c.x0, z0: c.z0, x1: c.x1, z1: c.z1, y0: c.y0, y1: c.y1, start: o, count: 0, first: k, n: 0 }; blocks.push(blk); }
    c.start = o; data.set(c.list, o * FLOATS); o += c.count; delete c.list;
    blk.count += c.count; blk.n++;
    blk.x0 = Math.min(blk.x0, c.x0); blk.z0 = Math.min(blk.z0, c.z0); blk.x1 = Math.max(blk.x1, c.x1); blk.z1 = Math.max(blk.z1, c.z1); blk.y0 = Math.min(blk.y0, c.y0); blk.y1 = Math.max(blk.y1, c.y1);
  });
  return { data, cells, blocks, count: total };
}
