// What grows where: woods, fields and tracks as pure functions of the place. The terrain shader paints them
// (landgl.js holds the same functions in GLSL, on the same integer hash, so both sides agree to the metre) and
// the coastal system plants by them: trees stand where the shader darkens the ground for a wood, hedgerow trees
// on the field boundaries the shader draws, and nothing on a track.
// the kinds of ground a mesh drawn by the terrain shader can be (its material id): paved quay, rock, weathered concrete
export const GROUND = { TERRAIN: 0, PAVED: 1, ROCK: 2, CONCRETE: 3 };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// the hash of landfield.js (its lattice noise is the land's own); GLSL twin: lhash
export function lhash(ix, iz, s) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(s | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function lvn(x, z, s) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = lhash(ix, iz, s), b = lhash(ix + 1, iz, s), c = lhash(ix, iz + 1, s), d = lhash(ix + 1, iz + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// ---- woods: 0 open ground .. 1 deep in a wood ----
export function woodsAt(x, z) {
  const n = lvn(x / 310, z / 310, 901) * 0.6 + lvn(x / 97, z / 97, 902) * 0.4;
  return smooth(0.5, 0.58, n);
}
// where a wood can stand at all: above the shore, below the tops, not on a cliff (ny: the ground normal's y)
export const WOOD_H = [3.5, 5.5, 170, 215], WOOD_NY = [0.74, 0.82];
export function woodsGate(h, ny) {
  return smooth(WOOD_H[0], WOOD_H[1], h) * (1 - smooth(WOOD_H[2], WOOD_H[3], h)) * smooth(WOOD_NY[0], WOOD_NY[1], ny);
}

// ---- fields: strips of enclosed land, their boundaries warped so no hedge is a ruler line ----
export const FIELD_ROW = 84;
const _f = { d: 0, id: 0, along: 0 };
// d: metres to the nearest boundary; id: the field's own number 0..1; along: metres along the strip
export function fieldAt(x, z, out = _f) {
  const wx = x + 55 * lvn(x / 380, z / 380, 911), wz = z + 55 * lvn(x / 380, z / 380, 912);
  const qx = wx * 0.866 + wz * 0.5, qz = -wx * 0.5 + wz * 0.866;
  const row = Math.floor(qz / FIELD_ROW);
  const off = lhash(row, 7, 913) * 150, w = 110 + 70 * lhash(row, 3, 914);
  const cx = (qx + off) / w, col = Math.floor(cx), fx = cx - col, fy = qz / FIELD_ROW - row;
  out.d = Math.min(Math.min(fx, 1 - fx) * w, Math.min(fy, 1 - fy) * FIELD_ROW);
  out.id = lhash(col, row, 915);
  out.along = qx;
  return out;
}
// how far the land is farmed here, 0..1 (before height and slope are counted)
export function fieldMask(x, z) {
  return smooth(0.4, 0.47, lvn(x / 900, z / 900, 916) * 0.6 + lvn(x / 350, z / 350, 917) * 0.4);
}
export const FIELD_H = [5, 9, 130, 175], FIELD_NY = [0.9, 0.95];
export function fieldGate(h, ny) {
  return smooth(FIELD_H[0], FIELD_H[1], h) * (1 - smooth(FIELD_H[2], FIELD_H[3], h)) * smooth(FIELD_NY[0], FIELD_NY[1], ny);
}

// ---- tracks: one contour of a slow noise is a lane that wanders across the country ----
const trackField = (x, z) => lvn(x / 520, z / 520, 921) * 0.7 + lvn(x / 170, z / 170, 922) * 0.3;
// metres to the nearest track
export function trackD(x, z) {
  const t = trackField(x, z), e = 4;
  const gx = (trackField(x + e, z) - t) / e, gz = (trackField(x, z + e) - t) / e;
  return Math.abs(t - 0.5) / Math.max(Math.hypot(gx, gz), 1e-4);
}
