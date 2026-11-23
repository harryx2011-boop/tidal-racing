// GLSL both the terrain and the sea shader need: reading the height field, how far waves get into shallow
// water, and the swash that runs up a beach. One formula each, so the sand goes wet exactly where the
// foam laps. (The JS twins are waveAtt in landfield.js; the constants come from there.)
import { WAVE_ATT } from './landfield.js';
import { FIELD_ROW, WOOD_H, WOOD_NY, FIELD_H, FIELD_NY } from './models/cover.js';

// The shared formulas. uLandOn says whether a height field is bound at all.
export const LAND_COMMON_GLSL = `
uniform float uLandOn;
float waveAtt(float depth) { return smoothstep(${WAVE_ATT[0].toFixed(2)}, ${WAVE_ATT[1].toFixed(2)}, depth); }
// How high up the beach the last wave has run, in metres above the still waterline, at world point xz and time t:
// swell trains of about 70 m arrive every 8 s, break up along the shore, and run higher in a bigger sea.
float swashRun(vec2 xz, float t, float hs, vec2 wdir) {
  float ph = t / 8.0 - dot(xz, wdir) / 70.0 + 0.35 * sin(xz.x * 0.045 + xz.y * 0.031);
  float s = 0.5 + 0.5 * sin(6.2831853 * ph);
  return 0.08 + (0.12 + 0.3 * min(hs, 3.0)) * s * s;
}
`;

// Reading the near height field (the sea's vertex stage only: the fragment stage of the sea is at the
// sixteen texture units every WebGL2 implementation must offer, so it gets the depth as a varying).
export const LAND_TEX_GLSL = `
uniform sampler2D uLandTex;   // the near height field: metres above the still sea, bilinear
uniform vec4 uLandRect;       // its world rectangle: x0, z0, 1 / width, 1 / depth
float landH(vec2 xz) { return textureLod(uLandTex, (xz - uLandRect.xy) * uLandRect.zw, 0.0).r; }
`;

// What grows where, for the terrain shader and anything else that paints or plants by it: the GLSL twins of
// models/cover.js, on the same integer hash, so a wood is painted exactly where the trees stand.
const f1 = (v) => v.toFixed(2);
export const LAND_COVER_GLSL = `
float lhash(ivec2 i, int s) {
  uint h = (uint(i.x) * 374761393u) ^ (uint(i.y) * 668265263u) ^ (uint(s) * 1274126177u);
  h = (h ^ (h >> 13)) * 1274126177u;
  return float(h ^ (h >> 16)) * (1.0 / 4294967296.0);
}
float lvn(vec2 p, int s) {
  vec2 fl = floor(p), f = p - fl;
  ivec2 i = ivec2(fl);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = lhash(i, s), b = lhash(i + ivec2(1, 0), s), c = lhash(i + ivec2(0, 1), s), d = lhash(i + ivec2(1, 1), s);
  return a + (b - a) * u.x + (c - a) * u.y + (a - b - c + d) * u.x * u.y;
}
float woodsAt(vec2 p) { return smoothstep(0.5, 0.58, lvn(p / 310.0, 901) * 0.6 + lvn(p / 97.0, 902) * 0.4); }
float woodsGate(float h, float ny) {
  return smoothstep(${f1(WOOD_H[0])}, ${f1(WOOD_H[1])}, h) * (1.0 - smoothstep(${f1(WOOD_H[2])}, ${f1(WOOD_H[3])}, h)) * smoothstep(${f1(WOOD_NY[0])}, ${f1(WOOD_NY[1])}, ny);
}
// x: metres to the nearest field boundary, y: the field's own number, z: metres along its strip, w: across it
vec4 fieldAt(vec2 p) {
  vec2 wq = p + 55.0 * vec2(lvn(p / 380.0, 911), lvn(p / 380.0, 912));
  vec2 q = vec2(wq.x * 0.866 + wq.y * 0.5, -wq.x * 0.5 + wq.y * 0.866);
  float row = floor(q.y / ${f1(FIELD_ROW)});
  int ir = int(row);
  float off = lhash(ivec2(ir, 7), 913) * 150.0, w = 110.0 + 70.0 * lhash(ivec2(ir, 3), 914);
  float cx = (q.x + off) / w, col = floor(cx), fx = cx - col, fy = q.y / ${f1(FIELD_ROW)} - row;
  return vec4(min(min(fx, 1.0 - fx) * w, min(fy, 1.0 - fy) * ${f1(FIELD_ROW)}), lhash(ivec2(int(col), ir), 915), q.x, q.y);
}
float fieldMask(vec2 p) { return smoothstep(0.4, 0.47, lvn(p / 900.0, 916) * 0.6 + lvn(p / 350.0, 917) * 0.4); }
float fieldGate(float h, float ny) {
  return smoothstep(${f1(FIELD_H[0])}, ${f1(FIELD_H[1])}, h) * (1.0 - smoothstep(${f1(FIELD_H[2])}, ${f1(FIELD_H[3])}, h)) * smoothstep(${f1(FIELD_NY[0])}, ${f1(FIELD_NY[1])}, ny);
}
float trackField(vec2 p) { return lvn(p / 520.0, 921) * 0.7 + lvn(p / 170.0, 922) * 0.3; }
float trackD(vec2 p) {
  float t = trackField(p);
  vec2 g = vec2(trackField(p + vec2(4.0, 0.0)) - t, trackField(p + vec2(0.0, 4.0)) - t) / 4.0;
  return abs(t - 0.5) / max(length(g), 1e-4);
}
`;
