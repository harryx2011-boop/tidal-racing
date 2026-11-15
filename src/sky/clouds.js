// Volumetric clouds (Nubis-style): procedural tileable Perlin-Worley / Worley 3D noise,
// a scrolling weather map, Beer-powder lighting with multiple-scattering octaves,
// temporal accumulation at reduced resolution, a reflection-probe variant and a
// cloud-shadow map that dapples the sea with moving light.
import { Program, Texture, Target, fullscreen, FULLSCREEN_VS } from '../gl.js';
import { SKY_LOOKUP_GLSL } from './atmosphere.js';

const smoothstep = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };

const NOISE_COMMON = `
vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}
float worley(vec3 uv, float freq) {
  vec3 id = floor(uv * freq);
  vec3 p = fract(uv * freq);
  float md = 1e4;
  for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) for (int z = -1; z <= 1; z++) {
    vec3 o = vec3(x, y, z);
    vec3 h = hash33(mod(id + o, vec3(freq))) + o;
    vec3 d = p - h;
    md = min(md, dot(d, d));
  }
  return 1.0 - md;
}
vec3 grad3(vec3 p) { return normalize(hash33(p) * 2.0 - 1.0); }
float gnoise(vec3 x, float freq) {
  vec3 p = floor(x), w = fract(x);
  vec3 u = w * w * w * (w * (w * 6.0 - 15.0) + 10.0);
  float r = 0.0;
  float v[8];
  for (int i = 0; i < 8; i++) {
    vec3 o = vec3(float(i & 1), float((i >> 1) & 1), float((i >> 2) & 1));
    v[i] = dot(grad3(mod(p + o, freq)), w - o);
  }
  return mix(mix(mix(v[0], v[1], u.x), mix(v[2], v[3], u.x), u.y),
             mix(mix(v[4], v[5], u.x), mix(v[6], v[7], u.x), u.y), u.z);
}
float perlinFbm(vec3 p, float freq, int oct) {
  float G = exp2(-0.85), amp = 1.0, noise = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    noise += amp * gnoise(p * freq, freq);
    freq *= 2.0; amp *= G;
  }
  return noise;
}
float worleyFbm(vec3 p, float f) {
  return worley(p, f) * 0.625 + worley(p, f * 2.0) * 0.25 + worley(p, f * 4.0) * 0.125;
}
float remap(float x, float a, float b, float c, float d) { return c + (x - a) / (b - a) * (d - c); }
`;

const SHAPE_FS = NOISE_COMMON + `
uniform float uSlice;
uniform float uSize;
out vec4 o;
void main() {
  vec3 p = vec3(gl_FragCoord.xy / uSize, (uSlice + 0.5) / uSize);
  float pfbm = mix(1.0, perlinFbm(p, 4.0, 7), 0.5);
  pfbm = abs(pfbm * 2.0 - 1.0);
  float w0 = worleyFbm(p, 4.0);
  float pw = remap(pfbm, 0.0, 1.0, w0, 1.0);
  o = vec4(clamp(pw, 0.0, 1.0), w0, worleyFbm(p, 8.0), worleyFbm(p, 16.0));
}`;

const DETAIL_FS = NOISE_COMMON + `
uniform float uSlice;
uniform float uSize;
out vec4 o;
void main() {
  vec3 p = vec3(gl_FragCoord.xy / uSize, (uSlice + 0.5) / uSize);
  o = vec4(worleyFbm(p, 2.0), worleyFbm(p, 4.0), worleyFbm(p, 8.0), 1.0);
}`;

const WEATHER_FS = NOISE_COMMON + `
in vec2 vUv;
out vec4 o;
// One scale of a fair-weather cumulus field: a mound per lattice cell, of random place, width and
// strength. A threshold cuts clouds out of the mounds: a strong, wide one becomes a large cloud with a
// tall middle, a weak one a scrap or nothing, so one sky holds every size from fractus to congestus
// (a noise threshold alone gives blobs of one size at even spacing).
vec2 mounds(vec2 uv, float freq, float seed) {
  vec2 id = floor(uv * freq), f = fract(uv * freq);
  vec2 m = vec2(0.0);
  for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) {
    vec2 o2 = vec2(x, y);
    vec3 cell = vec3(mod(id + o2, vec2(freq)), seed);
    vec3 h = hash33(cell), h2 = hash33(cell + 19.19);
    vec2 d = f - o2 - (0.25 + 0.5 * h.xy);
    // (an ellipse at a random angle, up to twice as long as wide)
    float a = h2.y * 3.14159, ca = cos(a), sa = sin(a), st = mix(1.0, 2.0, h2.z);
    d = vec2(ca * d.x + sa * d.y, (ca * d.y - sa * d.x) * st);
    float r = mix(0.5, 0.9, h2.x);
    float v = mix(0.5, 1.0, h.z) * (1.0 - dot(d, d) / (r * r));
    if (v > m.x) m = vec2(v, r / sqrt(st) / freq);
  }
  return m;
}
void main() {
  vec3 p = vec3(vUv, 0.37);
  float base = perlinFbm(p, 6.0, 6) * 0.5 + 0.5;
  float cells = worleyFbm(p, 10.0);
  float cov = clamp(remap(base, 0.25, 0.85, 0.0, 1.0) * 0.6 + cells * 0.55 - 0.15, 0.0, 1.0);
  float type = clamp(perlinFbm(p + 3.7, 3.0, 4) * 0.5 + 0.5, 0.0, 1.0);
  float big = clamp(perlinFbm(p + 9.1, 2.0, 3) * 0.6 + 0.5, 0.0, 1.0);
  // cumulus field (alpha): mounds at three scales (cells of 3.7 km, 1.8 km, 800 m on the 30 km tile), their
  // outlines bent by up to half a kilometre (and again, finely, by a hundred metres) so that no cloud is a disc
  vec2 wp = vUv + 0.016 * vec2(perlinFbm(p + 5.3, 7.0, 3), perlinFbm(p + 7.9, 7.0, 3)) + 0.004 * vec2(perlinFbm(p + 2.1, 31.0, 3), perlinFbm(p + 8.6, 31.0, 3));
  vec2 m1 = mounds(wp, 8.0, 1.0), m2 = mounds(wp + 0.37, 17.0, 2.0), m3 = mounds(wp + 0.71, 37.0, 3.0);
  // (each mound carries the smaller ones on its back: the cut-out cloud gets a lumpy outline and, since the
  // cloud top follows the field, turrets of its own)
  float f1 = m1.x + 0.45 * (m2.x - 0.5) + 0.25 * (m3.x - 0.5), f2 = 0.9 * m2.x + 0.25 * (m3.x - 0.5), f3 = 0.8 * m3.x;
  float cu = max(f1, max(f2, f3));
  // green: how large the mound is that makes the cloud here (its mean radius over 3.2 km: about 0.15 for a
  // scrap, 0.4 for a middling cumulus, 0.6 to 1 for a large one), a little taller or lower by region. A
  // cloud's height and how ragged it is follow from its size.
  float size = (f1 >= max(f2, f3) ? m1.y : (f2 >= f3 ? m2.y : m3.y)) * 30.0 / 3.2;
  // (alpha stored at 0.8 scale: the sum can pass 1)
  o = vec4(cov, clamp(size * mix(0.75, 1.1, type), 0.0, 1.0), big, cu * 0.8);
}`;

// Cirrus sheet, one tile (see cirrusLayer in sky.js): r hairs, g where they are (sheaves, and fall-streak
// tufts: a head and a hooked tail), b ripples (cirrocumulus), a patches. Ice crystals fall from a generating head through
// sheared wind, so real cirrus is made of long, nearly parallel filaments that curve and thin out
// downwind; stretched blob noise reads as brush strokes instead. Filaments here are the ridges of a
// strongly anisotropic noise (its zero crossings are long, thin, gently wandering lines).
const CIRRUS_FS = NOISE_COMMON + `
in vec2 vUv;
out vec4 o;
vec2 g2(vec2 p) { float a = hash33(vec3(p, 7.31)).x * 6.2831853; return vec2(cos(a), sin(a)); }
// tileable 2D gradient noise; per: period in lattice cells
float gn2(vec2 x, vec2 per) {
  vec2 p = floor(x), w = fract(x);
  vec2 u = w * w * w * (w * (w * 6.0 - 15.0) + 10.0);
  float a = dot(g2(mod(p, per)), w), b = dot(g2(mod(p + vec2(1.0, 0.0), per)), w - vec2(1.0, 0.0));
  float c = dot(g2(mod(p + vec2(0.0, 1.0), per)), w - vec2(0.0, 1.0)), d = dot(g2(mod(p + vec2(1.0, 1.0), per)), w - vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm2(vec2 x, vec2 per, int oct) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 6; i++) { if (i >= oct) break; s += a * gn2(x, per); x = x * 2.0 + 13.7; per *= 2.0; a *= 0.5; }
  return s;
}
// the flow lines meander: the cross-stream coordinate is displaced by a few percent of the tile
vec2 flow(vec2 uv) {
  return uv + vec2(0.03 * fbm2(uv * vec2(3.0, 2.0) + 4.1, vec2(3.0, 2.0), 2), 0.06 * fbm2(uv * vec2(2.0, 3.0), vec2(2.0, 3.0), 3));
}
// hairs: the union of the ridge lines of three octaves, each a line a seventh of its lattice cell wide
float hairs(vec2 p) {
  float f = 0.0, a = 1.0;
  // (twenty-four times longer than wide: a ridge line then closes on itself so far away that it reads as
  // an open hair that tapers at both ends; at a few to one the same lines are the rings of wood grain)
  vec2 fr = vec2(1.0, 24.0);
  for (int i = 0; i < 3; i++) {
    float n = gn2(p * fr + float(i) * 7.1, fr);
    f = max(f, a * smoothstep(0.45, 1.0, 1.0 - 7.0 * abs(n)));
    fr *= 2.0; a *= 0.85;
  }
  return f;
}
float heads(vec2 uv) { return smoothstep(0.14, 0.3, fbm2(uv * 11.0 + 2.2, vec2(11.0), 2)); }
void main() {
  vec2 p = flow(vUv);
  // bundles: the hairs come in sheaves several times longer than wide, with clear sky between
  float bundle = smoothstep(0.03, 0.2, fbm2(p * vec2(2.0, 7.0) + 3.7, vec2(2.0, 7.0), 3));
  // fall streaks: each head trails a tail downwind that thins out and bends to one side (the hook of
  // cirrus uncinus); which side varies slowly over the sheet
  float hook = 0.3 + fbm2(vUv * 2.0 + 9.4, vec2(2.0), 2);
  float tuft = 0.0;
  for (int k = 0; k < 14; k++) {
    float s = float(k) / 13.0;
    tuft = max(tuft, exp(-2.6 * s) * heads(vUv + vec2(s * 0.13, hook * s * s * 0.07)));
  }
  // ripples: rows of small cells across the flow (cirrocumulus), wavering
  vec2 rp = vUv + 0.02 * vec2(fbm2(vUv * 4.0 + 1.7, vec2(4.0), 3), fbm2(vUv * 4.0 + 6.1, vec2(4.0), 3));
  float rows = 0.5 + 0.5 * sin(6.2831853 * (rp.x * 40.0 + 0.8 * fbm2(vUv * 6.0 + 3.3, vec2(6.0), 2)));
  float cellsR = 1.0 - sqrt(max(1.0 - worley(vec3(rp, 0.21), 64.0), 0.0)) * 1.6;
  float ripple = clamp(mix(rows, 1.0, 0.35) * smoothstep(0.0, 0.5, cellsR), 0.0, 1.0);
  float patches = clamp(0.5 + 1.1 * fbm2(vUv * 3.0 + 0.6, vec2(3.0), 5), 0.0, 1.0);
  o = vec4(hairs(p), max(0.7 * bundle, tuft), ripple, patches);
}`;

// ---------------------------------------------------------------- raymarch core
export const CLOUD_GLSL = `
uniform sampler3D uShape;
uniform sampler3D uDetail;
uniform sampler2D uWeather;
uniform vec3 uWindOffset;     // metres of advection (xz) and detail evolution (y)
uniform float uCoverage;      // fair-weather side of the front
uniform float uBase;          // m
uniform float uTop;           // m
uniform float uDensity;       // extinction scale (1/m)
uniform float uDark;          // storm darkness 0..1
uniform vec4 uFront;          // squall front: xy unit normal (towards the storm), z offset (m), w width (0 = off)
uniform vec4 uStormA;         // storm side: coverage, darkness, density, base
uniform float uStormTop;      // storm side: top (m)
uniform float uShapeLod;      // debug: >= 0 forces the shape-noise mip level
uniform float uPixelAngle;    // radians per pixel of the pass (footprint for texture LOD)
uniform float uDetailFoot;    // erosion detail is marched where a pixel covers less than this (m)
uniform int uUpSteps;         // steps of the sky-light (upward) march through decks
// pixel footprint (m) at the current sample; set by the caller before density lookups
float gFoot = 0.0;
float lodFor(float texel) { return max(log2(max(gFoot, 1e-3) / texel), 0.0); }
uniform vec4 uFlash;          // lightning position xyz (m), intensity
uniform vec3 uFlashColor;
const float RG_M = 6360000.0;

float remapc(float x, float a, float b, float c, float d) { return c + (x - a) / (b - a) * (d - c); }
// the squall line meanders (frontCurve is shared with the fog in SKY_LOOKUP_GLSL and the CPU)
float frontDist(vec2 xz) { return dot(xz, uFront.xy) - uFront.z - frontCurve(dot(xz, vec2(-uFront.y, uFront.x))); }
float frontMask(vec2 xz) { return uFront.w > 0.0 ? smoothstep(-uFront.w, uFront.w, frontDist(xz)) : 0.0; }
const float SCUD_BASE = 260.0;
float shellBase() {
  float b = uFront.w > 0.0 ? min(uBase, uStormA.w) : uBase;
  // (only once scud is visible: a lowered shell with no cloud in it is pure cost)
  bool storm = smoothstep(0.5, 0.9, uDark) > 0.02 || (uFront.w > 0.0 && uStormA.y > 0.5);
  return storm ? min(b, SCUD_BASE) : b;
}
float shellTop() { return uFront.w > 0.0 ? max(uTop, uStormTop) : uTop; }
float maxCoverage() { return uFront.w > 0.0 ? max(uCoverage, uStormA.x) : uCoverage; }

// local cloud regime at a point: x coverage, y darkness, z density, w front mask; base/top out
// h: sample height. High up, the storm's anvil spreads ahead of the line (~3.5 km).
vec4 regime(vec2 xz, float h, out float base, out float top) {
  float anvil = smoothstep(uStormTop * 0.62, uStormTop * 0.86, h) * 3500.0;
  float m = 0.0, tv = 1.0;
  if (uFront.w > 0.0) {
    // the storm's face bulges forward and recedes by kilometres: convective towers, not a wall
    vec3 bp = vec3(xz.x + uWindOffset.x, h * 1.3, xz.y + uWindOffset.z) / 8500.0 + 0.77;
    vec4 bn = textureLod(uShape, bp, 2.0);
    vec4 bf = textureLod(uShape, bp * 3.1 + 0.29, 2.0);
    float bulge = ((bn.r * 0.7 + bn.g * 0.3 - 0.5) * 5500.0 + (bf.r - 0.5) * 1400.0) * smoothstep(300.0, 2500.0, h);
    tv = 0.7 + 0.3 * bn.g;
    m = smoothstep(-uFront.w, uFront.w, frontDist(xz) + anvil + bulge);
  }
  base = mix(uBase, uStormA.w, m);
  top = mix(uTop, uStormTop * tv, m);
  // the storm's coverage closes over the outer half of the ramp: its face has no see-through gaps
  // (and darkens just as fast: the storm's leading towers are part of one dark mass, not fair-weather cumulus)
  return vec4(mix(uCoverage, uStormA.x, smoothstep(0.0, 0.35, m)), mix(uDark, uStormA.y, smoothstep(0.0, 0.2, m)), mix(uDensity, uStormA.z, m), m);
}

// Height of a storm deck's underside above its nominal base (m), from the weather map and the 3 km shape
// noise at a point: masses three to five kilometres across hang a few hundred metres below the rest and
// end at steep edges (shelves, rolls), pouches the size of the shape cells hang from both, and smaller
// ones crumple those.
float deckRelief(vec4 wm, vec4 n) {
  return 20.0 + 240.0 * (1.0 - smoothstep(0.56, 0.7, wm.r)) + 130.0 * (1.0 - smoothstep(0.62, 0.92, n.g)) + 70.0 * (1.0 - n.b);
}
float deckReliefAt(vec3 p) {
  vec4 wm = textureLod(uWeather, (p.xz + uWindOffset.xz) / 30000.0, lodFor(30000.0 / 512.0));
  vec4 n = textureLod(uShape, (p + vec3(uWindOffset.x, 0.0, uWindOffset.z)) / 3000.0, uShapeLod < 0.0 ? lodFor(3000.0 / 128.0) : uShapeLod);
  return deckRelief(wm, n);
}
// Set by cloudDensityR for the lighting of the sample it was called for:
float gRelief = 0.0;  // deckRelief there
float gCrev = 0.25;   // erosion noise there: 0 on the crown of a billow, 1 in the crease between two
float gLump = 0.5;    // deck base: 0 in a recess, 1 where a mass hangs lowest
float gTopF = 1.0;    // local cloud top (fraction of the shell)
float gBaseF = 0.0;   // local cloud base (fraction of the shell)
// mean of the erosion noise (inverted Worley, one feature point per cell: 1 - E[d^2] = 0.70)
const float DETAIL_MEAN = 0.7;

float cloudDensityR(vec3 p, float h, bool detail, vec4 R, float base, float top) {
  // scud (fractus): ragged low fragments racing under a storm deck
  if (h < base) {
    float sg = uFront.w > 0.0 ? smoothstep(0.5, 0.85, R.w) * (1.0 - smoothstep(5000.0, 9000.0, frontDist(p.xz))) : smoothstep(0.5, 0.9, R.y);
    if (sg < 0.02 || h < SCUD_BASE) return 0.0;
    vec3 sp2 = (p + vec3(uWindOffset.x, 0.0, uWindOffset.z) * 1.8) / vec3(1900.0, 600.0, 1900.0);
    // (two mips down: the fragments are tens of metres wide at their finest; at full resolution the Perlin octaves
    // are a few metres across, each pixel's ray then crosses a different random scatter, and it prints as grain)
    vec4 n2 = textureLod(uShape, sp2, lodFor(1900.0 / 128.0) + 2.0);
    float sb = SCUD_BASE + n2.b * 300.0;
    float sh = (h - sb) / max(base - sb, 1.0);
    if (sh <= 0.0) return 0.0;
    float frag = n2.r * 0.7 + n2.g * 0.3;
    // (the blurred noise keeps close to its mean, about 0.73: the cut sits above it, so that the scud is
    // separate fragments. Cut below the mean, as it was, it is one thin veil that hides the deck's relief)
    float d2 = smoothstep(0.77, 0.88, frag) * (0.4 + 0.6 * n2.b) * smoothstep(0.0, 0.35, sh) * (1.0 - smoothstep(0.55, 1.0, sh));
    // (a near-field feature: at the horizon it would read as flat slabs under the storm)
    d2 *= 1.0 - smoothstep(3000.0, 8000.0, gFoot / max(uPixelAngle, 1e-6));
    if (d2 <= 0.0) return 0.0;
    // torn edges: the fragments are eroded by strands of the detail noise (one mip down at least, where its
    // finest cells are still several march steps wide; the 12 m step under a deck is set for this)
    // (probes read it too: a probe that reports a fragment the march then finds eroded away sends the ray
    // back and forth, and it runs out of steps under the deck with the sky still showing through)
    {
      vec3 dn = textureLod(uDetail, (p + uWindOffset * vec3(1.8, 1.0, 1.8)) / vec3(520.0, 260.0, 520.0), max(lodFor(520.0 / 64.0), 1.0)).rgb;
      float df = dn.r * 0.625 + dn.g * 0.25 + dn.b * 0.125;
      d2 = clamp(remapc(d2, df * 0.45, df * 0.45 + 0.55, 0.0, 1.0), 0.0, 1.0);
    }
    // (thin: a fragment fades out at its edge. Dense, a ray either hits the edge or misses, which is grain)
    return d2 * min(R.z, 0.07) * sg * 0.3;
  }
  if (h > top) return 0.0;
  float H = max(top - base, 100.0);
  float hf = (h - base) / (top - base);
  float cov = R.x, dark = R.y;
  // (a calm sky still holds a scatter of cumulus humilis: the thin end of the coverage ramp is lifted)
  cov += 0.07 * (1.0 - smoothstep(0.2, 0.45, cov)) * smoothstep(0.02, 0.1, cov) * (1.0 - dark);
  // broken stratocumulus: a closed-ish but thin, flat-topped layer with gaps, between fair weather and a storm deck
  float strat = smoothstep(0.55, 0.8, cov) * (1.0 - smoothstep(0.5, 0.75, dark));
  // fair-weather cumulus: cut from the field of mounds in the weather map's alpha (see WEATHER_FS)
  float cu = (1.0 - smoothstep(0.45, 0.6, cov)) * (1.0 - smoothstep(0.15, 0.4, dark));
  vec2 wuv = (p.xz + uWindOffset.xz) / 30000.0;
  vec4 wm = textureLod(uWeather, wuv, lodFor(30000.0 / 512.0));
  float fld = wm.r * 0.85 + wm.b * 0.25 * cov;
  // a stratocumulus layer breaks into cells ~1 km across (the weather map alone gives gaps 5-10 km wide)
  vec4 wm2 = vec4(0.5);
  // (and the cells line up along the wind, half as long again as wide: rolls and streets, not a honeycomb)
  if (strat > 0.01) {
    vec2 ws = vec2(dot(wuv, vec2(0.87, 0.5)) * 0.8, dot(wuv, vec2(-0.5, 0.87)) * 1.2);
    wm2 = textureLod(uWeather, ws * 3.1 + 0.17, lodFor(30000.0 / 3.1 / 512.0));
    fld = mix(fld, wm2.r * 0.85 + wm2.b * 0.25 * cov, 0.55 * strat);
  }
  // (the weather map's values sit between about 0.35 and 0.95, so a layer with gaps needs a higher cut than
  // the fair-weather ramp, which assumes values spread over 0..1)
  float cmS = mix(0.95, 0.27, clamp((cov - 0.5) * 2.0, 0.0, 1.0));
  float cm = mix(1.0 - cov + 0.01, cmS, strat), sw = mix(0.19, 0.13, strat);
  // (the mound field passes the cut over about the nominal fraction of the sky: 38% at 0.38)
  // (a small mound is steep: over a wider ramp all of it is edge, carved by the noise into a ragged scrap
  // instead of cut out as a smooth ball)
  fld = mix(fld, wm.a * 1.25, cu); cm = mix(cm, 0.96 - cov, cu); sw = mix(sw, mix(0.4, 0.22, smoothstep(0.15, 0.6, wm.g)), cu);
  float c = smoothstep(cm - sw, cm + sw, fld);
  // an overcast deck is closed: no column-shaped gaps from the 2D coverage map
  c = max(c, smoothstep(0.82, 0.96, cov));
  // (the skirt of a mound holds no cloud: nothing passes the coverage remap below there)
  if (c <= mix(0.001, 0.05, cu)) return 0.0;
  // how far the field stands above the cut: a strong mound grows a tower, a weak one stays a flat scrap
  float ex = max(fld - cm, 0.0);
  // (cumulus grow taller and larger as the coverage rises: humilis, mediocris, congestus)
  float topCu = mix(mix(0.45, 0.12, cu), 1.0, wm.g) * mix(0.62, 1.0, smoothstep(0.1, 0.5, cov));
  // cumulus tops dome over the core of the coverage cell instead of a flat slab
  topCu *= mix(mix(0.55, 1.0, smoothstep(0.0, 0.85, c)), clamp(0.16 + 5.0 * ex * ex, 0.16, 1.0), cu);
  // (above every turret this cloud could have, or above the thickest a stratocumulus layer gets: no shape
  // noise is read. Most of a fair-weather shell is empty air)
  if (hf > 1.2 * min(mix(topCu, 1.0, dark), mix(1.0, 0.24, strat))) return 0.0;
  // shape noise: ~350 m billows for cumulus, ~750 m cells for decks and layers (blended in between)
  vec3 wo = vec3(uWindOffset.x, 0.0, uWindOffset.z);
  float wS = max(smoothstep(0.15, 0.85, dark), strat);
  vec4 n = vec4(0.5);
  if (wS < 0.999) n = textureLod(uShape, (p + wo) / 1400.0 + 0.37, uShapeLod < 0.0 ? lodFor(1400.0 / 128.0) : uShapeLod);
  if (wS > 0.001) {
    vec4 nl = textureLod(uShape, (p + wo) / 3000.0, uShapeLod < 0.0 ? lodFor(3000.0 / 128.0) : uShapeLod);
    n = wS < 0.999 ? mix(n, nl, wS) : nl;
  }
  float wf = n.g * 0.625 + n.b * 0.25 + n.a * 0.125;
  // vertical profile. Fair weather: cumulus towers with type-dependent tops.
  // Storm: a deck whose underside is relief (deckRelief). The lighting reads gLump (what hangs lowest has
  // the most cloud above it) and the slope of the relief towards the light.
  float m1 = smoothstep(0.56, 0.7, wm.r), m2 = smoothstep(0.62, 0.92, n.g);
  gLump = 0.6 * m1 + 0.4 * m2;
  gRelief = deckRelief(wm, n);
  // (a stratocumulus layer has the same relief on its underside, shallower)
  float baseFrac = max(dark, 0.55 * strat) * gRelief / H;
  float cells = uFront.w > 0.0 ? smoothstep(0.35, 0.75, wm.b * 0.6 + sin(dot(p.xz, vec2(-uFront.y, uFront.x)) / 5200.0) * 0.25 + 0.3) : 0.0;
  float topSt = mix(0.18, 1.0, clamp(wm.b * 0.9 + n.r * 0.7 - 0.3 + cells * 0.6, 0.0, 1.0));
  // the anvil itself: a flat, smooth spreading layer near the top of the storm
  topSt = max(topSt, step(0.86, hf) * dark);
  float tf = mix(topCu, topSt, dark);
  // stratocumulus: a layer a fraction of the shell thick, with a rolling base
  // (thick in the middle of a cell, thin at its rim: from below the middle is grey and the rim, where the
  // light comes through, bright; that is what a stratocumulus sky looks like)
  float exS = clamp((fld - cm + sw) / (2.0 * sw), 0.0, 1.5);
  tf = min(tf, mix(1.0, (0.03 + 0.085 * exS) * (0.4 + 1.1 * smoothstep(0.62, 0.92, n.r)) + 0.03 * wm2.b, strat));

  // cauliflower tops: the ceiling follows the Worley cells of the shape noise (a lobe per ~350 m
  // cell) and falls away over a short distance, so the top is a row of turrets, not a soft dome
  float lobe = mix(mix(0.78, 0.62, cu) + mix(0.42, 0.66, cu) * smoothstep(0.35, 0.85, n.g), 1.0, dark);
  float topW = mix(0.28, 0.45, dark);
  // per-cloud base height (flat bases that differ from cloud to cloud)
  baseFrac += (wm.b - 0.5) * 0.06 * (1.0 - dark);
  gTopF = tf * lobe; gBaseF = baseFrac;
  float hg = smoothstep(baseFrac, baseFrac + mix(110.0, 220.0, dark) / H, hf) * (1.0 - smoothstep(tf * lobe * (1.0 - topW), tf * lobe, hf));
  bool anvilSlab = dark > 0.5 && hf > 0.8;
  if (anvilSlab) hg = smoothstep(baseFrac, baseFrac + 0.05, hf) * (1.0 - smoothstep(0.95, 1.0, hf));
  float shape = remapc(n.r, wf - 1.0, 1.0, 0.0, 1.0);
  if (R.w > 0.6 && hf < 0.8) shape = max(shape, 0.35 * smoothstep(0.6, 0.9, R.w));
  shape = max(shape, 0.45 * smoothstep(0.35, 0.8, c) * (1.0 - dark));
  float d = shape * hg;
  // the base of a cumulus is a little narrower than its body
  c *= mix(mix(0.8, 1.0, smoothstep(0.0, 0.12, hf)), 1.0, dark);
  // coverage erodes with height (Schneider 2017): the cloud narrows upward into turrets
  // (a cumulus by its own height, so that a low one grows turrets as a tall one does)
  float hErode = mix(hf, clamp(hf / max(tf, 0.03), 0.0, 1.0), cu);
  d = remapc(d, 1.0 - c * mix(1.0, mix(0.55, 0.4, cu), hErode * (1.0 - dark)), 1.0, 0.0, 1.0) * c;
  if (d <= 0.0) return 0.0;
  if (detail) {
    // The erosion noise is read where a pixel resolves it and replaced by its mean beyond (blended over
    // the last octave of footprint, so nothing pops as a cloud drifts through the limit). A distant cloud
    // is then eroded evenly and keeps the same hard edge, instead of swelling into a soft blob.
    float farF = smoothstep(0.5, 1.0, gFoot / uDetailFoot);
    float df = DETAIL_MEAN, wis = DETAIL_MEAN;
    float stormy = smoothstep(0.6, 0.9, dark);
    if (farF < 1.0) {
      // (a cumulonimbus billows at ~1 km, a fair-weather cumulus at ~400 m; the cells are displaced by the
      // billow they sit on, which hides the lattice they are laid out on)
      vec3 dp = (p + uWindOffset * vec3(1.15, 1.0, 1.15) + (n.gba - 0.5) * mix(60.0, 150.0, stormy)) / mix(420.0, 1100.0, stormy);
      vec3 dn = textureLod(uDetail, dp, lodFor(420.0 / 64.0)).rgb;
      df = dn.r * 0.625 + dn.g * 0.25 + dn.b * 0.125;
      wis = mix(dn.g * 0.6 + dn.b * 0.4, DETAIL_MEAN, farF);
      // a finer octave (~140 m) for cauliflower lobes
      // (only where it is resolved, and not on closed decks: no sub-pixel speckle, no cotton balls;
      // where it is not wanted the tap is skipped, which pays for the extra reach of the first one)
      float w2 = 0.22 * (1.0 - smoothstep(1.0, 2.0, lodFor(140.0 / 32.0))) * (1.0 - smoothstep(0.88, 0.97, cov));
      if (w2 > 0.0) {
        vec3 dn2 = textureLod(uDetail, dp * 3.0 + 0.41, lodFor(140.0 / 64.0)).rgb;
        df = mix(df, dn2.r * 0.625 + dn2.g * 0.25 + dn2.b * 0.125, w2);
      }
      df = mix(df, DETAIL_MEAN, farF);
    }
    float bil = 1.0 - df;
    // (creases exist where the erosion shapes the surface: not on a flat base)
    gCrev = smoothstep(0.15, 0.65, bil) * mix(smoothstep(0.02, 0.15, hf), 1.0, dark);
    // A growing turret has hard, billowed edges; a small cloud (the weather map's green) is a scrap that
    // is evaporating, and frays into wisps, its lower flanks most: there the density fades out
    // gradually over the eroded zone instead of ending at an edge.
    float wsp = cu * (1.0 - smoothstep(0.2, 0.45, wm.g)) * (1.0 - smoothstep(0.3, 0.8, hf / max(tf, 0.05)));
    // fair-weather cumulus are billowy everywhere; decks wispy at the base, billowy towards the tops
    // (wisps are the finer octaves the other way up: what is left of a cell is its walls, strands, where a
    // billow leaves its middle, a ball)
    float dm = mix(mix(bil, wis, wsp), mix(df, bil, clamp(hf * 5.0, 0.0, 1.0)), dark);
    float thr = dm * mix(0.55, 0.45, dark) * mix(1.0, 0.3, smoothstep(0.88, 0.97, cov)) * (anvilSlab ? 0.0 : 1.0);
    // (a fair-weather base is flat: the detail erodes it only a little)
    thr *= mix(mix(0.35, 1.0, smoothstep(0.02, 0.12, hf)), 1.0, dark);
    thr *= mix(1.0, 0.7, stormy);
    // (the underside of a storm deck is ragged: its lowest hundred metres fray)
    thr *= 1.0 + 2.0 * stormy * (1.0 - smoothstep(0.0, 150.0 / H, hf - baseFrac));
    d = clamp(remapc(d, thr, thr + (1.0 - thr) * mix(mix(0.16, 0.7, wsp), 0.5, dark), 0.0, 1.0), 0.0, 1.0);
  }
  // a storm deck seen from below is mottled because its optical thickness varies 2-3x over a few km
  // (the base radiance goes ~1/tau): thicker, darker masses beside thinner, brighter patches
  float thick = mix(1.0, 0.5 + 1.2 * smoothstep(0.15, 0.85, wm.b * 0.6 + n.g * 0.6 - 0.1), smoothstep(0.3, 0.7, dark));
  // (a stratocumulus layer is optically thick for its depth: dense, so its base is grey and not white)
  return max(d, 0.0) * R.z * thick * mix(1.0, 1.7, strat);
}
float cloudDensity(vec3 p, float h, bool detail) {
  float base, top;
  vec4 R = regime(p.xz, h, base, top);
  return cloudDensityR(p, h, detail, R, base, top);
}

// Fraction of the haze path (camera to distance md along rd) that is sunlit when a storm stands
// between the path and the sun: the storm's shadow reaches uStormTop / tan(elevation) ahead of the
// line, scaled by how much the sun stands behind the line. Skylight still scatters in the shadow.
float stormHazeLit(vec3 cam, vec3 rd, float md) {
  if (uFront.w <= 0.0 || uStormA.y < 0.5) return 1.0;
  vec2 sh = uSunDir.xz / max(length(uSunDir.xz), 1e-3);
  float tanE = max(uSunDir.y, 0.02) / max(length(uSunDir.xz), 1e-3);
  float reach = uStormTop / tanE * max(dot(sh, uFront.xy), 0.0);
  float fd0 = frontDist(cam.xz);
  float rate = dot(rd.xz, uFront.xy);
  // distance along the ray at which it enters the shadow (or never)
  float sEdge = fd0 >= -reach ? 0.0 : (rate > 1e-4 ? (-reach - fd0) / rate : 1e9);
  // the first 12 km are handled by the shadow-mapped crepuscular term (shafts) in the composite
  float tF = rate > 1e-4 ? max(-fd0 / rate, 0.0) : 1e9;
  float lit = 1.0 - max(md - min(max(sEdge, 12000.0), tF), 0.0) / max(md, 1.0);
  return mix(0.15, 1.0, lit);
}
float hg(float c, float g) { float g2 = g * g; return (1.0 - g2) / (4.0 * 3.14159 * pow(1.0 + g2 - 2.0 * g * c, 1.5)); }

vec2 shellHits(vec3 ro, vec3 rd, float R) {
  vec3 o = ro + vec3(0.0, RG_M, 0.0);
  float b = dot(o, rd);
  float c = dot(o, o) - R * R;
  float disc = b * b - c;
  if (disc < 0.0) return vec2(-1.0);
  float s = sqrt(disc);
  return vec2(-b - s, -b + s);
}
float heightOf(vec3 p) { return length(p + vec3(0.0, RG_M, 0.0)) - RG_M; }

// returns rgb in-scattered radiance (sun illuminance = 1 units), a = transmittance; also mean distance
vec4 marchClouds(vec3 ro, vec3 rd, int steps, int lightSteps, int lightDetail, float jitter, vec3 sunE, vec3 ambTop, vec3 ambBot, vec3 ambFace, out float meanDist) {
  meanDist = 0.0;
  if (maxCoverage() < 0.01) return vec4(0.0, 0.0, 0.0, 1.0);
  float sB = shellBase(), sT = shellTop();
  vec2 hb = shellHits(ro, rd, RG_M + sB);
  vec2 ht = shellHits(ro, rd, RG_M + sT);
  float t0, t1;
  float h0 = heightOf(ro);
  if (h0 < sB) {
    if (rd.y < -0.02) return vec4(0.0, 0.0, 0.0, 1.0);
    t0 = hb.y; t1 = ht.y;
  } else if (h0 < sT) {
    t0 = 0.0; t1 = rd.y > 0.0 ? ht.y : (hb.x > 0.0 ? hb.x : ht.y);
  } else {
    if (ht.x < 0.0) return vec4(0.0, 0.0, 0.0, 1.0);
    t0 = ht.x; t1 = hb.x > 0.0 ? hb.x : ht.y;
  }
  t1 = min(t1, t0 + (uFront.w > 0.0 ? 120000.0 : 60000.0));
  if (t1 <= t0) return vec4(0.0, 0.0, 0.0, 1.0);
  // adaptive stepping: coarse probes in empty space, fine steps inside clouds.
  // Fine step grows with distance (pixel footprint) to bound the cost near the horizon.
  float fine = clamp(t0 * 0.008, 30.0, 700.0) * (64.0 / float(steps));
  float coarse = fine * 3.0;
  float t = t0 + coarse * jitter;
  vec3 L = vec3(0.0);
  float T = 1.0;
  float wsum = 0.0;
  float cosT = dot(rd, uSunDir);
  // multiple-scattering octaves (Wrenninge 2013): energy a^i, extinction b^i, eccentricity c^i
  float ph0 = mix(hg(cosT, 0.82), hg(cosT, -0.3), 0.4);
  float ph1 = mix(hg(cosT, 0.41), hg(cosT, -0.15), 0.5);
  float ph2 = mix(hg(cosT, 0.2), hg(cosT, -0.07), 0.5);
  float ph3 = mix(hg(cosT, 0.1), hg(cosT, -0.035), 0.5);
  bool inside = false;
  bool allowBack = true;
  float emptyBack = 0.0;        // length of the step just taken, if it started in clear air
  float tEnter = 0.0, tDone = t0;
  int miss = 0;
  // (budget: a ray may cross a few near cumulus and still has to reach a storm 20+ km away)
  bool deckAhead = false;
  for (int i = 0; i < 320; i++) {
    if (T < 0.02 || t > t1) { deckAhead = false; break; }
    if (i >= steps * 3) break;
    vec3 p = ro + rd * t;
    gFoot = t * uPixelAngle;
    float h = heightOf(p);
    float base, top;
    vec4 R = regime(p.xz, h, base, top);
    deckAhead = R.x > 0.9 && R.y > 0.5 && rd.y > 0.02 && h < top;
    if (!inside) {
      // a probe that hits steps back one stride at every entry: the cloud's near edge is not skipped
      float stride = clamp(t * 0.02, coarse, max(coarse, 600.0));
      if (cloudDensityR(p, h, false, R, base, top) > 0.0) {
        inside = true; miss = 0;
        // (fine steps restart at a jittered phase: a back-step clamped to the shell entry would
        // otherwise put every pixel's samples at the same depths, printing contour bands)
        if (allowBack) { tEnter = t; t = max(t - stride, max(t0, tDone)) + fine * jitter; allowBack = false; emptyBack = 0.0; continue; }
      } else { t += stride; continue; }
    }
    // distance LOD: long light paths are sub-pixel far away (the erosion detail fades out by itself)
    bool nearField = t * uPixelAngle < uDetailFoot;
    float sigma = cloudDensityR(p, h, true, R, base, top);
    float crev = gCrev, lump = gLump, topF = gTopF, baseF = gBaseF, relief = gRelief;
    // Entering a cloud: its surface lies somewhere in the step just taken, and what a pixel shows is the
    // light of the first few metres under it. Left there, the first sample lands anywhere up to a step
    // deep, where the light is anything from the lit skin's to the shade's, and the lit side is grain.
    // Two bisections put it within a quarter step of the surface.
    if (sigma > 0.0 && emptyBack > 0.0) {
      float back = emptyBack;
      for (int k = 0; k < 2; k++) {
        back *= 0.5;
        vec3 pb = ro + rd * (t - back);
        float hb = heightOf(pb), bb, tb;
        vec4 Rb = regime(pb.xz, hb, bb, tb);
        float sb = cloudDensityR(pb, hb, true, Rb, bb, tb);
        if (sb > 0.0) {
          t -= back; p = pb; h = hb; R = Rb; base = bb; top = tb; sigma = sb;
          crev = gCrev; lump = gLump; topF = gTopF; baseF = gBaseF; relief = gRelief;
        }
      }
    }
    float stepLen = max(fine, min(max(t - 15000.0, 0.0) * 0.005, 150.0) * (64.0 / float(steps))) * (1.0 + t * 0.00004);
    if (sigma > 0.0 && T > 0.05) stepLen = min(stepLen, max(1.2 / sigma, 8.0));
    // scud fragments are thin along a ray: a coarse step takes a third of the light at once, so which
    // pixels catch a fragment in two samples and which in three shows as contour rings (and grain)
    // (12 m, or a quarter of an optical depth where the cloud is thinner than that: at 12 m through the faint
    // fringe of a deck's base the march ran out of steps before the deck was opaque, and the sun's disc
    // showed through six kilometres of storm as a speckled glare)
    if (sigma > 0.0 && (h < base || R.y > 0.5)) stepLen = min(stepLen, max(12.0, 0.25 / sigma));
    if (sigma > 0.0) {
      miss = 0;
      float hf = clamp((h - base) / (top - base), 0.0, 1.0);
      float colH = max(top - base, 100.0);
      // optical depth of the column above: diffuse light filtering down through the deck.
      // It is summed over cells fixed in height (not marched in steps that start at the sample): a
      // sum whose sample positions slide with the ray's phase changes by large factors from one pixel
      // to the next (the extrapolated remainder multiplies the error), and prints as pixel speckle.
      // Here the estimate is continuous in the sample's height and position, so it is smooth.
      float tauUp = 0.0;
      bool scud = h < base;
      if (scud) {
        tauUp = R.z * (top - base) * 0.5;
      } else if (R.x > 0.55 && R.y > 0.5) {
        int nU = uUpSteps + 1;
        for (int j = 0; j < 5; j++) {
          if (j >= nU) break;
          float c0 = base + pow(float(j) / float(nU), 1.6) * colH, c1 = base + pow(float(j + 1) / float(nU), 1.6) * colH;
          float ov = c1 - max(h, c0);
          if (ov <= 0.0) continue;
          float hc = 0.5 * (c0 + c1);
          tauUp += cloudDensityR(vec3(p.x, p.y + hc - h, p.z), hc, false, R, base, top) * ov;
        }
      } else {
        // a cumulus or a thin layer: this cloud's own top is all that stands above the sample
        // (a little over half of that column is cloud, the rest creases and gaps)
        tauUp = sigma * max(topF - hf, 0.0) * colH * 0.6;
      }
      // a closed deck is a slab: the sun's slant path is the column over the sine of its elevation
      // (scud, and decks with sky showing between them, keep the marched estimate)
      bool slabLit = !scud && R.y > 0.5 && R.x > 0.8;
      // light march towards the sun (geometric step growth)
      float tau = 0.0;
      // far away the light path must still span the cloud (few long steps), or shading follows noise
      // the march spans the same ~2.6 km whatever the step count (env, far field, quality tier),
      // so coarse passes don't see thick decks as thin and sunlit inside
      // scud under a deck is lit analytically: the column above it is opaque to the sun anyway
      int nL = (scud || slabLit) ? 0 : ((nearField || R.y > 0.5) ? lightSteps : 4);
      // Up close the first step is about 50 m: the billow next door, which is what shades a crease, is
      // that near. (At twice the reach the first sample overshoots it and every lobe is lit alike.)
      float lgrow = nearField ? 0.88 * pow(52.0, 1.0 / float(max(nL - 1, 1))) : 2.0;
      float lsum = 0.0, lg = 1.0;
      for (int j = 0; j < 8; j++) { if (j >= nL) break; lsum += lg; lg *= lgrow; }
      float ls = 2600.0 / max(lsum, 1.0);
      vec3 lp = p;
      float marched = 0.0;
      bool exited = false;
      for (int j = 0; j < 8; j++) {
        if (j >= nL) break;
        lp += uSunDir * ls;
        float lh = heightOf(lp);
        if (lh > sT || lh < sB - 50.0) { exited = true; break; }
        tau += cloudDensity(lp, lh, j < lightDetail) * ls;
        marched += ls;
        ls *= lgrow;
      }
      // still inside a deck after 2.6 km: extrapolate the rest of the column with the mean density
      if (!exited && marched > 0.0) {
        float rest = clamp((top - heightOf(lp)) / max(uSunDir.y, 0.05), 0.0, 60000.0);
        tau += tau / marched * rest;
      }
      if (slabLit) tau = tauUp / max(uSunDir.y, 0.12);
      // scud sits under the deck: sunlight must cross the whole layer above it
      if (scud) tau += R.z * (top - base) * 0.8 / max(uSunDir.y, 0.1);
      // (a deck is a slab lit from above: E mu0 T_d / pi; an isolated cumulus is lit on its sunward side)
      float slab = smoothstep(0.75, 0.95, R.x);
      float iso = 1.0 - slab;
      // the crease between two billows sees little of the sun's scattered light and little of the sky:
      // it is what draws the outline of every lobe on a sunlit cumulus
      float ao = 1.0 - 0.38 * crev * iso;
      float msK = 1.0 - exp(-(tau + sigma * 30.0));
      // silver lining: thin cloud toward the sun passes the forward diffraction lobe almost unattenuated
      float silver = 1.0 + 1.6 * exp(-1.5 * tau) * smoothstep(0.8, 0.99, cosT) * (1.0 - R.y);
      // Sunlight scattered a few times. It falls off within a few optical depths of the lit surface
      // (to a quarter by tau = 5), which is what makes a face turned to the sun bright and the next
      // lobe's shadow on it dark. On an isolated cloud it is scaled so that a face lit and seen
      // square-on returns about 0.2 of the sun's illuminance, a thick cloud's albedo over pi.
      // (the forward peak is capped: on a hard-edged cloud the rim it lights is a metre or two wide, far under a
      // pixel, and one ray per pixel sees either all of it or none: a line of sparks instead of a lining)
      float ms = min(silver * ph0, 0.8) * exp(-tau) + ao * msK * mix(1.5, 1.0, slab) * (0.7 * ph1 * exp(-0.5 * tau) + 0.49 * ph2 * exp(-0.25 * tau) + 0.343 * ph3 * exp(-0.125 * tau));
      // powder: in-scattering probability is low at cloud edges facing the light
      float powder = 1.0 - exp(-2.0 * tau - sigma * 80.0);
      // two-stream diffusion transmittance for thick media (asymmetry g ~ 0.85): 1/(1 + 0.75(1-g) tau)
      float diffSun = 1.0 / (1.0 + 0.11 * tau);
      float diffUp = 1.0 / (1.0 + 0.11 * tauUp);
      // Sunlight scattered many times fills a thick cloud with near-isotropic light, L ~ E T_diff / pi.
      // In a deck that is all the light there is. In an isolated cumulus it is the glow of the shaded
      // side and the base, a tenth to a quarter of the lit face: were it as strong as the face (as a
      // slab's would be), every lobe would be the same white and the cloud a flat cut-out.
      float diffuse = diffSun * mix(mix(0.07, 0.1, 1.0 - smoothstep(-0.6, 0.3, cosT)) * (1.0 - exp(-0.3 * tau)), max(uSunDir.y, 0.0) / 3.14159 * (1.0 - exp(-0.15 * tau)), slab);
      // the diffused light of a deck carries the colour of the whole illumination at its top, sun and
      // blue skylight: neutral-cool (~6500 K) at the sun's luminance. An isolated cloud keeps the sun's
      // own colour (so does any cloud at a low sun: a golden-hour cumulus glows from within, it does
      // not turn a neutral grey), or its lit side would be blotched cream and white.
      float lumE = dot(sunE, vec3(0.2126, 0.7152, 0.0722));
      vec3 diffCol = lumE * mix(vec3(0.93, 1.0, 1.09), sunE / max(lumE, 1e-6), max(0.75 * smoothstep(0.3, 0.08, uSunDir.y), iso));
      vec3 sunD = sunE * ms * mix(1.0, powder, 0.25 * (1.0 - max(cosT, 0.0)));
      vec3 sunF = diffCol * diffuse * ao;
      vec3 sun = sunD + sunF;
      // skylight from above, through this cloud's own column; light from the sea and the horizon haze
      // from below, which is all that lights a cumulus base (a deck's underside is closed off from it)
      float hfl = clamp((hf - baseF) / max(topF - baseF, 0.02), 0.0, 1.0);
      float diffDown = 1.0 / (1.0 + 0.11 * sigma * max(hf - baseF, 0.0) * colH * 0.6);
      vec3 ambIso = (ambTop * diffUp * mix(0.45, 1.0, hfl) + ambBot * diffDown * (1.0 - 0.5 * hfl)) * ao;
      vec3 ambSlab = ambTop * diffUp * mix(mix(0.32, 0.6, R.y), 1.0, hf) + ambBot * (1.0 - hf) * diffUp * 0.6;
      vec3 amb = mix(ambIso, ambSlab, max(slab, smoothstep(0.3, 0.6, R.y)));
      // the face toward the camera reflects the sky/sea light behind the camera where the column
      // above no longer lets skylight through
      // (a storm face: its shadowed sides fall to ~30% of the sunlit side; its underside, which looks
      // down on the dark sea and the rain, gets an eighth of it)
      // (under a broken layer that fill is weak: were it not, the thick middle of a cell would be as bright
      // from below as its thin rim)
      float layer = smoothstep(0.55, 0.8, R.x) * (1.0 - smoothstep(0.5, 0.75, R.y));
      amb += ambFace * (1.0 - diffUp) * mix(1.0, 0.3, layer) * smoothstep(0.5, 0.9, R.x) * mix(1.0, 0.55, R.w) * mix(1.0, mix(0.12, 1.0, smoothstep(0.03, 0.25, hf)), step(0.5, R.y)) * mix(1.0, 0.4, step(0.5, R.y) * R.w);
      // a tall storm's faces see half the sky and half the dark sea: a thick cloud returns ~0.45 of the
      // sky radiance there, not all of it (fair-weather tops are lit by the whole dome)
      amb *= mix(1.0, 0.45, smoothstep(0.5, 0.9, R.y));
      // broken stratocumulus of a rough day: the light under a thick grey layer is a good deal below the open sky's
      float greyDay = smoothstep(0.2, 0.4, R.y) * smoothstep(0.55, 0.75, R.x) * (1.0 - smoothstep(0.5, 0.7, R.y));
      amb *= mix(1.0, 0.55, greyDay);
      sun *= mix(1.0, 0.8, greyDay);
      // scud hangs in the dim light under the deck, lit from all round by it: darker than the recesses
      // of the base above, about as dark as its lowest masses
      if (scud) amb = ambFace * mix(0.5, 0.8, smoothstep(1500.0, 6000.0, t));
      // The underside of a closed deck is lit from above, through it: what hangs lowest (see gLump) has
      // the most cloud over it and is darkest, the recesses between are brightest. The relief and its
      // shading come from the same fields, so the dark masses overlap and slide with the view.
      // And it is lit from the side, by the open strip along the horizon, brightest under the sun: the
      // flank of a mass or a pouch that faces that way is light, the far flank dark. That slope (the
      // relief 160 m towards the sun's azimuth against the relief here) is what makes it read as relief.
      // (the underside of a broken layer the same, less strongly: it has the sun through its gaps as well)
      if (slabLit || (layer > 0.5 && !scud)) {
        vec2 lh = normalize(uSunDir.xz + vec2(1e-5, 0.0));
        float slope = (deckReliefAt(p + vec3(lh.x, 0.0, lh.y) * 160.0) - relief) / 160.0;
        float dv = mix(1.3, 0.6, smoothstep(0.05, 0.95, lump)) * mix(0.55, 1.5, smoothstep(-0.55, 0.55, slope));
        dv = slabLit ? dv : mix(1.0, dv, 0.6 * (1.0 - smoothstep(0.25, 0.6, hfl)));
        sun *= dv; amb *= dv;
      }
      vec3 S = (sun + amb) * sigma;
      if (uFlash.w > 0.0) {
        float fd = length(p - uFlash.xyz);
        S += uFlashColor * uFlash.w * sigma * exp(-fd / 1400.0) / (1.0 + fd * fd * 1e-6);
      }
      float a = exp(-sigma * stepLen);
      vec3 Sint = (S - S * a) / max(sigma, 1e-7);
      L += T * Sint;
      wsum += T * (1.0 - a);
      meanDist += t * T * (1.0 - a);
      T *= a;
    } else if (t > tEnter && ++miss > 5) {
      inside = false; allowBack = true; tDone = t;
    }
    emptyBack = sigma > 0.0 ? 0.0 : stepLen;
    t += stepLen;
  }
  // (out of steps on the way up into a closed deck: nothing shows through it)
  if (deckAhead && T > 0.02 && t < t1) T = 0.0;
  meanDist = wsum > 0.0 ? meanDist / wsum : t0;
  // early termination leaves a residual: treat it as opaque
  // (all of it: the march stops below 0.02, and one percent of the sun's aureole behind a storm deck is
  // several times the deck's own light, a speckled glare where the sun stands)
  T = clamp((T - 0.02) / 0.98, 0.0, 1.0);
  return vec4(L, T);
}
`;

const SCREEN_FS = SKY_LOOKUP_GLSL + CLOUD_GLSL + `
in vec2 vUv;
layout(location = 0) out vec4 o;
layout(location = 1) out vec4 oD;   // mean distance of the cloud light (km)
uniform sampler2D uHistoryD;
uniform mat4 uInvViewProj;
uniform mat4 uPrevViewProj;
uniform vec3 uCamPos;
uniform sampler2D uHistory;
uniform float uFrame;
uniform float uBlend;
uniform vec3 uAmbTop;
uniform vec3 uAmbBot;
uniform int uSteps;
uniform int uLightSteps;
uniform int uLightDetail;
uniform int uCheck;   // 1: raymarch one pixel of every 2x2 block per frame, reproject the rest
uniform vec3 uPrevWindOffset;
float jhash(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
// History fetch. A bilinear fetch blurs a little every time it is repeated, and a moving camera repeats
// it every frame (and for three pixels in four every frame of a checkerboard): the clouds melt into
// mush. Catmull-Rom (five taps, the corner weights dropped) keeps the resampling loss near zero; the
// result is clamped to the four nearest texels so an edge cannot ring or grow a halo.
vec4 histCR(vec2 uv) {
  vec2 size = vec2(textureSize(uHistory, 0));
  vec2 sp = uv * size - 0.5;
  vec2 tp = floor(sp) + 0.5;
  vec2 f = sp - floor(sp);
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2;
  vec2 t0 = (tp - 1.0) / size, t3 = (tp + 2.0) / size, t12 = (tp + w2 / w12) / size;
  vec4 r = texture(uHistory, vec2(t12.x, t0.y)) * (w12.x * w0.y)
    + texture(uHistory, vec2(t0.x, t12.y)) * (w0.x * w12.y) + texture(uHistory, t12) * (w12.x * w12.y) + texture(uHistory, vec2(t3.x, t12.y)) * (w3.x * w12.y)
    + texture(uHistory, vec2(t12.x, t3.y)) * (w12.x * w3.y);
  r /= w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
  ivec2 ip = ivec2(floor(sp)), mx = ivec2(size) - 1;
  vec4 a = texelFetch(uHistory, clamp(ip, ivec2(0), mx), 0), b = texelFetch(uHistory, clamp(ip + ivec2(1, 0), ivec2(0), mx), 0);
  vec4 c = texelFetch(uHistory, clamp(ip + ivec2(0, 1), ivec2(0), mx), 0), d = texelFetch(uHistory, clamp(ip + ivec2(1, 1), ivec2(0), mx), 0);
  return clamp(r, min(min(a, b), min(c, d)), max(max(a, b), max(c, d)));
}
void main() {
  vec4 ndc = vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec4 w = uInvViewProj * ndc;
  vec3 rd = normalize(w.xyz / w.w - uCamPos);
  // clouds are effectively at infinity: reproject by direction
  vec4 prevClip = uPrevViewProj * vec4(uCamPos + rd * 1e4, 1.0);
  vec2 puv = prevClip.xy / prevClip.w * 0.5 + 0.5;
  vec2 bord = 1.0 / vec2(textureSize(uHistory, 0));
  bool valid = prevClip.w > 0.0 && all(greaterThanEqual(puv, bord)) && all(lessThanEqual(puv, 1.0 - bord)) && uBlend < 1.0;
  vec4 hist = valid ? histCR(puv) : vec4(0.0);
  float histD = valid ? texture(uHistoryD, puv).r : 0.0;
  ivec2 ip = ivec2(gl_FragCoord.xy);
  int slot = (ip.x & 1) + 2 * (ip.y & 1);
  if (uCheck == 1 && valid && uBlend < 0.5 && slot != (int(uFrame) & 3)) { o = hist; oD = vec4(histD); return; }
  // jitter: a golden-ratio sequence in time from a random offset per pixel (stratified in time, no
  // spatial pattern: a low-discrepancy pattern in space, IGN, leaves a crosshatch no photograph has)
  float j = fract(jhash(vec3(gl_FragCoord.xy, 17.0)) + uFrame * 0.618034);
  float hKm = max(uBase, 0.0) * 0.001;
  vec3 sunE = sunTransmittanceAt(hKm + 0.5, uSunDir.y) * mix(vec3(1.0), vec3(1.0, 0.84, 0.64), smoothstep(0.32, 0.06, uSunDir.y));
  vec3 zen = skyRadiance(vec3(0.0, 1.0, 0.0));
  vec3 hor = skyRadiance(normalize(vec3(uSunDir.z, 0.15, -uSunDir.x)));
  vec3 ambTop = (zen * 0.55 + hor * 0.45) * uAmbTop;
  // light from below: the sea's (6% of what falls on it) and the bright haze along the horizon
  vec3 ambBot = ((sunTransmittanceAt(0.0, uSunDir.y) * max(uSunDir.y, 0.0) + zen * 3.14159) * 0.06 / 3.14159 + hor * 0.2) * uAmbBot;
  float md;
  // light of the sky and sea behind the camera (mean radiance of the actual, clouded sky)
  vec3 ambFace = skyIrradiance() / 3.14159 * 0.45 * uAmbTop;
  vec4 c = marchClouds(uCamPos, rd, uSteps, uLightSteps, uLightDetail, j, sunE, ambTop, ambBot, ambFace, md);
  // aerial perspective toward the cloud
  if (c.a < 0.999) {
    vec3 aL, aT;
    aerial(rd, md * 0.001, aL, aT);
    // the aerial table holds horizontal sea-level paths; a raised cloud is seen through less haze:
    // scale the optical depth by the slant-path factor of the boundary layer (H ~ 2 km)
    float sEl = max(rd.y, 0.0) * md * 0.001 / 2.0;
    float fsl = sEl > 1e-3 ? (1.0 - exp(-sEl)) / sEl : 1.0;
    vec3 aT2 = pow(max(aT, vec3(1e-4)), vec3(fsl));
    aL *= (1.0 - aT2) / max(1.0 - aT, vec3(1e-4));
    aT = aT2;
    aL *= stormHazeLit(uCamPos, rd, md);
    c.rgb = c.rgb * aT + aL * (1.0 - c.a) * 0.9;
  }
  // the clouds drift with the wind aloft (their noise is sampled at p + windOffset): the cloud now at
  // X was at X + dWind a frame ago. Refetch the history there (the camera's own motion included).
  if (uCheck == 0 && c.a < 0.999 && uBlend < 1.0) {
    vec3 X = uCamPos + rd * md + vec3(uWindOffset.x - uPrevWindOffset.x, 0.0, uWindOffset.z - uPrevWindOffset.z);
    vec4 pc = uPrevViewProj * vec4(X, 1.0);
    vec2 pu = pc.xy / pc.w * 0.5 + 0.5;
    valid = pc.w > 0.0 && all(greaterThanEqual(pu, bord)) && all(lessThanEqual(pu, 1.0 - bord));
    if (valid) { hist = histCR(pu); histD = texture(uHistoryD, pu).r; }
  }
  // temporal accumulation (a checkerboarded pixel is refreshed every 4th frame: blend harder)
  float dk = md * 0.001;
  if (valid) {
    float bl = uCheck == 1 ? min(uBlend * 2.5, 1.0) : uBlend;
    // (a non-finite history texel would persist and spread through the bilinear reprojection)
    if (any(isnan(hist)) || any(isinf(hist)) || !(abs(hist.r) + abs(hist.g) + abs(hist.b) + abs(hist.a) < 1e5) || !(abs(histD) < 1e6)) { hist = c; histD = dk; }
    // history rejection: where the fresh sample disagrees with the history about how much sky is
    // covered, the history is stale (a newly uncovered edge, a turret that grew), so it is dropped
    // quickly; while the view turns (the history was resampled by whole pixels) it is refreshed faster
    float mv = length((puv - vUv) * vec2(textureSize(uHistory, 0)));
    bl = max(bl, smoothstep(0.12, 0.4, abs(hist.a - c.a)) * 0.75);
    bl = max(bl, 0.3 * smoothstep(2.0, 10.0, mv));
    c = mix(hist, c, bl);
    dk = mix(histD, dk, bl);
  }
  o = c;
  oD = vec4(dk);
}`;

const ENV_FS = SKY_LOOKUP_GLSL + CLOUD_GLSL + `
in vec2 vUv;
out vec4 o;
uniform vec3 uCamPos;
uniform vec3 uAmbTop;
uniform vec3 uAmbBot;
uniform float uFrame;
uniform sampler2D uHistory;
float jhash(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
void main() {
  float phi = (vUv.x - 0.5) * 2.0 * 3.14159265;
  float theta = vUv.y * 3.14159265;
  vec3 rd = vec3(cos(phi) * sin(theta), cos(theta), sin(phi) * sin(theta));
  if (rd.y < 0.0) { o = vec4(0.0, 0.0, 0.0, 1.0); return; }
  rd = normalize(rd + vec3(0.0, 0.002, 0.0));
  // jitter: a golden-ratio sequence in time from a random offset per pixel (stratified in time, no
  // spatial pattern: a low-discrepancy pattern in space, IGN, leaves a crosshatch no photograph has)
  float j = fract(jhash(vec3(gl_FragCoord.xy, 17.0)) + uFrame * 0.618034);
  vec3 sunE = sunTransmittanceAt(uBase * 0.001 + 0.5, uSunDir.y) * mix(vec3(1.0), vec3(1.0, 0.84, 0.64), smoothstep(0.32, 0.06, uSunDir.y));
  vec3 zen = skyRadiance(vec3(0.0, 1.0, 0.0));
  vec3 hor = skyRadiance(normalize(vec3(uSunDir.z, 0.15, -uSunDir.x)));
  vec3 ambTop = (zen * 0.55 + hor * 0.45) * uAmbTop;
  // light from below: the sea's (6% of what falls on it) and the bright haze along the horizon
  vec3 ambBot = ((sunTransmittanceAt(0.0, uSunDir.y) * max(uSunDir.y, 0.0) + zen * 3.14159) * 0.06 / 3.14159 + hor * 0.2) * uAmbBot;
  float md;
  // light of the sky and sea behind the camera (mean radiance of the actual, clouded sky)
  vec3 ambFace = skyIrradiance() / 3.14159 * 0.45 * uAmbTop;
  vec4 c = marchClouds(uCamPos, rd, 36, 3, 0, j, sunE, ambTop, ambBot, ambFace, md);
  if (c.a < 0.999) {
    vec3 aL, aT;
    aerial(rd, md * 0.001, aL, aT);
    // the aerial table holds horizontal sea-level paths; a raised cloud is seen through less haze:
    // scale the optical depth by the slant-path factor of the boundary layer (H ~ 2 km)
    float sEl = max(rd.y, 0.0) * md * 0.001 / 2.0;
    float fsl = sEl > 1e-3 ? (1.0 - exp(-sEl)) / sEl : 1.0;
    vec3 aT2 = pow(max(aT, vec3(1e-4)), vec3(fsl));
    aL *= (1.0 - aT2) / max(1.0 - aT, vec3(1e-4));
    aT = aT2;
    aL *= stormHazeLit(uCamPos, rd, md);
    c.rgb = c.rgb * aT + aL * (1.0 - c.a) * 0.9;
  }
  vec4 h = texture(uHistory, vUv);
  if (any(isnan(h)) || any(isinf(h)) || !(abs(h.r) + abs(h.g) + abs(h.b) + abs(h.a) < 1e5)) h = c;
  o = mix(h, c, uFrame < 1.5 ? 1.0 : 0.25);
}`;

const SHADOW_FS = 'uniform vec3 uSunDir;\nfloat frontCurve(float along) { return 1400.0 * sin(along / 7000.0) + 650.0 * sin(along / 2900.0 + 1.3); }\n' + CLOUD_GLSL + `
in vec2 vUv;
out vec4 o;
uniform vec4 uRect; // origin xz, size
void main() {
  vec3 p0 = vec3(uRect.x + vUv.x * uRect.z, 0.0, uRect.y + vUv.y * uRect.z);
  vec3 L = normalize(vec3(uSunDir.x, max(uSunDir.y, 0.03), uSunDir.z));
  float tb = shellBase() / L.y, tt = shellTop() / L.y;
  float tau = 0.0;
  gFoot = uRect.z / 256.0;
  const int N = 16;
  float dt = (tt - tb) / float(N);
  for (int i = 0; i < N; i++) {
    vec3 p = p0 + L * (tb + (float(i) + 0.5) * dt);
    tau += cloudDensity(p, p.y, false) * dt;
  }
  o = vec4(exp(-tau * 0.85), 0.0, 0.0, 1.0);
}`;

export class Clouds {
  constructor(gl) {
    this.gl = gl;
    this.shape = this.make3D(128, SHAPE_FS, 'clouds.shape');
    // (64: the erosion noise is the finest thing in a cloud; at 32 its texels, 13 m, showed as soft edges up close)
    this.detail = this.make3D(64, DETAIL_FS, 'clouds.detail');
    this.weatherMap = new Texture(gl, { w: 512, h: 512, format: 'rgba8', wrap: 'repeat', mips: true });
    fullscreen(gl, new Program(gl, FULLSCREEN_VS, WEATHER_FS, { label: 'clouds.weather' }), {}, new Target(gl, [this.weatherMap]));
    this.weatherMap.genMips();
    this.cirrusTex = new Texture(gl, { w: 1024, h: 1024, format: 'rgba8', wrap: 'repeat', mips: true, aniso: 8 });
    fullscreen(gl, new Program(gl, FULLSCREEN_VS, CIRRUS_FS, { label: 'clouds.cirrus' }), {}, new Target(gl, [this.cirrusTex]));
    this.cirrusTex.genMips();
    this.pScreen = new Program(gl, FULLSCREEN_VS, SCREEN_FS, { label: 'clouds.screen' });
    this.pEnv = new Program(gl, FULLSCREEN_VS, ENV_FS, { label: 'clouds.env' });
    this.pShadow = new Program(gl, FULLSCREEN_VS, SHADOW_FS, { label: 'clouds.shadow' });
    this.envTex = [0, 1].map(() => new Texture(gl, { w: 320, h: 160, format: 'rgba16f' }));
    this.envTargets = this.envTex.map((t) => new Target(gl, [t]));
    this.envCur = 0;
    this.shadow = new Texture(gl, { w: 256, h: 256, format: 'r16f', mips: true });
    this.shadowTarget = new Target(gl, [this.shadow]);
    this.shadowSize = 24000;
    this.frame = 0;
  }

  make3D(size, fs, label) {
    const gl = this.gl;
    const tex = new Texture(gl, { w: size, h: size, d: size, format: 'rgba8', wrap: 'repeat', mips: true });
    const prog = new Program(gl, FULLSCREEN_VS, fs, { label });
    for (let z = 0; z < size; z++) {
      const t = new Target(gl, [tex], { layer: z });
      fullscreen(gl, prog, { uSlice: z, uSize: size }, t);
      gl.deleteFramebuffer(t.fbo);
    }
    tex.genMips();
    return tex;
  }

  resize(w, h, div = 2) {
    const gl = this.gl;
    const nw = Math.ceil(w / div), nh = Math.ceil(h / div);
    if (this.tex && nw === this.w && nh === this.h) return;
    if (this.targets) this.targets.forEach((t) => t.dispose(true));
    this.w = nw; this.h = nh;
    this.tex = [0, 1].map(() => new Texture(gl, { w: this.w, h: this.h, format: 'rgba16f' }));
    this.dtex = [0, 1].map(() => new Texture(gl, { w: this.w, h: this.h, format: 'r16f' }));
    this.targets = this.tex.map((t, i) => new Target(gl, [t, this.dtex[i]]));
    this.cur = 0;
    this.reset = true;
  }

  uniforms(u) {
    return {
      uShape: this.shape, uDetail: this.detail, uWeather: this.weatherMap,
      uWindOffset: u.windOffset, uCoverage: u.coverage, uBase: u.base, uTop: u.top,
      uDensity: u.density, uDark: u.dark, uFlash: u.flash, uFlashColor: u.flashColor,
      uShapeLod: u.shapeLod ?? -1, uFront: u.front || [1, 0, 0, 0], uStormA: u.stormA || [0, 0, 0, 0], uStormTop: u.stormTop || 0,
    };
  }

  render(skyU, u, cam) {
    const gl = this.gl;
    this.frame++;
    const cu = this.uniforms(u);
    // the cirrus sheet is drawn by the sky pass (full resolution, no history): hand it its inputs
    // through the sky uniform set, which the caller spreads into that pass
    const cirrus = (1 - smoothstep(0.55, 0.95, u.coverage)) * (1 - smoothstep(0.3, 0.7, u.dark)) * (0.3 + 0.3 * smoothstep(0.1, 0.45, u.coverage));
    skyU.uCirrus = [u.windOffset[0] * 2.2, u.windOffset[2] * 2.2, cirrus, 8500];
    skyU.uCirrusCam = cam.pos;
    skyU.uCirrusTex = this.cirrusTex;
    // the open strip along the horizon under a closed storm deck (see deckGap in sky.js)
    skyU.uGap = smoothstep(0.86, 0.94, u.coverage) * smoothstep(0.6, 0.85, u.dark);
    // cloud shadow map centred on the camera, snapped to texels to avoid crawling
    const texel = this.shadowSize / 256;
    const ox = Math.floor((cam.pos[0] - this.shadowSize / 2) / texel) * texel;
    const oz = Math.floor((cam.pos[2] - this.shadowSize / 2) / texel) * texel;
    const full = this.reset || this.frame < 4 || u.everyFrame;
    if (full || this.frame % 2 === 0 || !this.shadowRect) {
      fullscreen(gl, this.pShadow, { ...cu, uSunDir: skyU.uSunDir, uRect: [ox, oz, this.shadowSize, 0] }, this.shadowTarget);
      this.shadowRect = [ox, oz, 1 / this.shadowSize, 1 / this.shadowSize];
      this.shadow.genMips();
    }

    const amb = { uAmbTop: u.ambTop || [1, 1, 1], uAmbBot: u.ambBot || [1, 1, 1] };
    // reflection probe clouds (amortised via history blend)
    const en = 1 - this.envCur;
    if (full || this.frame % 2 === 1 || u.flash[3] > 0.01) {
    fullscreen(gl, this.pEnv, { ...skyU, ...cu, ...amb, uCamPos: cam.pos, uFrame: this.reset ? 0 : this.frame, uHistory: this.envTex[this.envCur], uPixelAngle: (2 * Math.PI) / this.envTex[0].w, uDetailFoot: 25, uUpSteps: 2 }, this.envTargets[en]);
    this.envCur = en;
    }

    const next = 1 - this.cur;
    const screenU = {
      ...skyU, ...cu, ...amb,
      uInvViewProj: cam.inv, uPrevViewProj: this.prevVP || cam.vp, uCamPos: cam.pos,
      uHistory: this.tex[this.cur], uHistoryD: this.dtex[this.cur], uFrame: this.frame % 64, uBlend: this.reset ? 1 : u.blend ?? 0.2,
      uPrevWindOffset: this.prevWind || u.windOffset,
      uPixelAngle: (cam.fov || 0.75) / this.h, uDetailFoot: u.detailFoot ?? 25, uUpSteps: u.upSteps ?? 4, uSteps: u.steps ?? 64, uLightSteps: u.lightSteps ?? 6, uLightDetail: u.lightDetail ?? 3, uCheck: u.check ? 1 : 0,
    };
    // a full-resolution march is drawn in strips, each flushed on its own: one long draw can exceed the
    // GPU driver's watchdog on integrated GPUs (a reset, or worse)
    // (bounded by pixel count: a strip as wide as a 1080p frame is already 4x a 480x270 pass)
    const strips = Math.max(1, Math.ceil((this.w * this.h) / (480 * 270)));
    if (strips > 1) gl.enable(gl.SCISSOR_TEST);
    for (let s = 0; s < strips; s++) {
      const y0 = Math.floor((this.h * s) / strips), y1 = Math.floor((this.h * (s + 1)) / strips);
      if (strips > 1) gl.scissor(0, y0, this.w, y1 - y0);
      fullscreen(gl, this.pScreen, screenU, this.targets[next]);
      if (strips > 1) gl.flush();
    }
    if (strips > 1) gl.disable(gl.SCISSOR_TEST);
    this.cur = next;
    this.prevVP = cam.vp;
    this.prevWind = [...u.windOffset];
    this.reset = false;
  }

  get screen() { return this.tex[this.cur]; }
  get depth() { return this.dtex[this.cur]; }
  get env() { return this.envTex[this.envCur]; }
}
