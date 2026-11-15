// Ocean surface: camera-centred polar grid displaced by the FFT cascades, shaded with
// a slope-variance (LEAN / Bruneton 2010) Beckmann BRDF, physically based water-leaving
// radiance, crest subsurface scattering, foam and aerial perspective.
import { Program, makeMesh } from '../gl.js';
import { SKY_LOOKUP_GLSL } from '../sky/atmosphere.js';
import { FOAM_GLSL } from './foam.js';
import { RAIN_SURFACE_GLSL } from '../fx/ripples.js';
import { WAKE_GLSL, WAKE_AMT_GLSL } from '../game/wake.js';

// What both shader stages know about the boats: where they are, the hull's outline, and the bow wave
// (a ridge of water lifted along each hull side, thrown outward at its crest). The vertex stage
// displaces the sea with it, the fragment stage puts foam on it.
const BOAT_SHARED = `
uniform int uBoatN;
uniform vec4 uBoatPos[4];   // xyz: position
uniform vec4 uBoatX[4];     // body axes in world space
uniform vec4 uBoatY[4];
uniform vec4 uBoatZ[4];
uniform vec4 uBoatCol[4];   // rgb: accent colour, a: speed / 36
uniform vec4 uBoatFx[4];    // x: in the water (0..1), y: throttle, z: boosting
uniform vec4 uHull;         // transom x, bow x, half beam, gunwale height
uniform float uWl[12];      // half-width of the hull at the waterline, at 12 stations from the transom to uWlEnd
uniform float uWlEnd;       // where the waterline ends forward (the stem has risen clear of the water)
float hullHalf(float x) {
  float u = (x - uHull.x) / (uHull.y - uHull.x);
  if (u <= 0.0 || u >= 1.0) return 0.0;
  float tb = max(0.0, (u - 0.42) / 0.58);
  return uHull.z * pow(max(1.0 - tb * tb, 0.0), 0.8) * (0.9 + 0.1 * min(u / 0.25, 1.0));
}
float wlHalf(float x) {
  float t = (x - uHull.x) / (uWlEnd - uHull.x) * 11.0;
  if (t < 0.0 || t > 11.0) return 0.0;
  int i = min(int(t), 10);
  return mix(uWl[i], uWl[i + 1], t - float(i));
}
float bh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float bn(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(bh(i), bh(i + vec2(1.0, 0.0)), f.x), mix(bh(i + vec2(0.0, 1.0)), bh(i + vec2(1.0, 1.0)), f.x), f.y);
}
// Height of the bow wave at a point lx along and lz across the hull (boat frame), for speed k (36 m/s
// is 1). The stem shoulders water aside: it piles against the hull a little aft of the stem, peaks
// where the hull is widest in the water and rolls out and down as it runs aft. Steep on the hull
// side, long on the outside.
float bowH(float lx, float lz, float k, float soft) {
  float fw = uWlEnd - lx;
  float o = abs(lz) - wlHalf(lx);
  float along = smoothstep(-0.2, 0.9, fw) * exp(-max(fw, 0.0) / 3.4) * (1.0 - smoothstep(6.0, 9.0, fw));
  float off = 0.06 + 0.22 * fw, wid = 0.2 + 0.14 * fw;
  float u = (o - off) / (o < off ? wid * 0.9 : wid * 1.6);
  // (the mesh cannot carry a ridge narrower than its own spacing)
  return 0.5 * k * k * along * exp(-u * u) * (1.0 - smoothstep(0.5, 1.3, soft / wid));
}
`;

// Boats on the sea, per pixel, in each boat's own frame: the hull hides the sea (the open cockpit
// never shows water), a thin foam line where the hull meets it, bow wash thrown out along the hull
// sides, the boat's shadow (an ellipsoid projected along the sun), the shade under the hull and the
// underwater light behind the transom. Only pixels within reach of a boat pay for it.
const BOATS_GLSL = BOAT_SHARED + `
uniform vec3 uProps[3];     // propellers (boat space)
uniform float uWaterShadow;
uniform float uTime;
uniform float uGlow;        // underwater lights: radiance as a multiple of a white card in the same light
// Half-width of the hull's cross-section at height y: flaring from the waterline out to the sheer
// above it, narrowing to the keel (0.42 m down) below it. A sea point inside this is inside the hull.
float hullSection(float x, float y) {
  float w0 = wlHalf(x);
  return y >= 0.0 ? mix(w0, hullHalf(x), clamp(y / 0.9, 0.0, 1.0)) : w0 * clamp(1.0 + y / 0.42, 0.0, 1.0);
}
struct BoatFx { float hide; float act; float shadow; float ao; vec3 glow; };
BoatFx boatFx(vec3 P, vec3 L) {
  BoatFx r;
  r.hide = 0.0; r.act = 0.0; r.shadow = 0.0; r.ao = 0.0; r.glow = vec3(0.0);
  float reach = 9.0 + min(2.4 * length(L.xz) / max(L.y, 0.05), 40.0);
  for (int b = 0; b < 4; b++) {
    if (b >= uBoatN) break;
    vec3 rel = P - uBoatPos[b].xyz;
    if (dot(rel.xz, rel.xz) > reach * reach) continue;
    vec3 X = uBoatX[b].xyz, Y = uBoatY[b].xyz, Z = uBoatZ[b].xyz;
    vec3 l = vec3(dot(rel, X), dot(rel, Y), dot(rel, Z));
    float spd = uBoatCol[b].a, gate = uBoatFx[b].x;
    // metres inside the waterline outline
    float din = min(wlHalf(l.x) - abs(l.z), l.x - uHull.x);
    float low = smoothstep(-1.0, -0.6, l.y) * (1.0 - smoothstep(0.5, 1.0, l.y));
    // The sea is hidden only where it lies inside the hull's volume (so the open cockpit stays dry).
    // Anything wider would cut a hole in the sea beside or beneath a hull that has lifted, and the
    // hole shows as black. A few centimetres of margin keep the cut behind the hull's own skin.
    if (abs(l.z) < hullSection(l.x, l.y) - 0.05 && l.x > uHull.x + 0.05 && l.y < uHull.w) r.hide = 1.0;
    float out_ = max(-din, 0.0);
    // the outline matters only alongside the hull, not ahead of the stem or behind the transom
    float xm = smoothstep(uHull.x - 0.3, uHull.x + 0.3, l.x) * (1.0 - smoothstep(uHull.y + 0.2, uHull.y + 0.8, l.x));
    // foam line at the hull: the water laps at the hull, so the line is ragged and its width comes
    // and goes along the hull, more so the faster the boat (at rest it is a calm, thin line). The
    // noise is laid out in the water, so at speed it streams aft along the hull.
    float lap = bn(P.xz * vec2(2.3, 2.3) + uTime * 0.25) * 0.6 + bn(P.xz * 7.1 - uTime * 0.6) * 0.4;
    float dinw = din + (lap - 0.5) * (0.02 + 0.2 * min(spd, 1.2));
    float wide = 0.07 + (0.05 + 0.3 * min(spd, 1.2)) * lap;
    float line = smoothstep(-0.04, 0.03, -dinw) * (1.0 - smoothstep(0.04, wide, out_));
    r.act += line * xm * gate * low * (0.5 + 0.5 * min(spd, 1.0)) * 1.5;
    // bow wave: foam rides the crest of the ridge the vertex stage lifted, and a sheet of it is
    // left running aft along the hull side below the crest
    float fx = uWlEnd - l.x;
    float hb = bowH(l.x, l.z, spd, 0.0) / max(0.5 * spd * spd, 0.02);
    float crest = smoothstep(0.35, 0.95, hb);
    float off = 0.06 + 0.22 * fx, wid = 0.2 + 0.14 * fx;
    float sheet = exp(-pow((out_ - off - 0.15 * wid) / (wid * 2.2), 2.0)) * smoothstep(-0.2, 0.9, fx) * (1.0 - smoothstep(3.5, 8.0, fx));
    r.act += (crest * 3.0 * (0.6 + 0.8 * lap) + sheet * 1.1 * lap) * spd * spd * gate * low * 1.6;
    // shade under and beside the hull (skylight is blocked)
    r.ao = max(r.ao, 0.55 * (1.0 - smoothstep(0.0, 1.6, out_)) * low * xm);
    // shadow: how far the ray to the sun misses the ellipsoid, soft by the sun's size and a little more
    if (uWaterShadow > 0.0 && L.y > 0.02) {
      vec3 Lh = vec3(dot(L, X), dot(L, Y), dot(L, Z));
      vec3 rr = vec3(0.5 * (uHull.y - uHull.x), 0.95, uHull.z * 1.05);
      vec3 o = (l - vec3(0.5 * (uHull.x + uHull.y), 0.45, 0.0)) / rr, d = Lh / rr;
      float tca = max(-dot(o, d) / dot(d, d), 0.0);
      float miss = length(o + d * tca);
      float pen = 0.22 + 0.025 * tca;
      r.shadow = max(r.shadow, (1.0 - smoothstep(1.0 - pen, 1.0 + pen, miss)) * 0.92 * uWaterShadow);
    }
    // underwater lights behind the transom, in the boat's accent colour: light from a lamp under the
    // surface falls off steeply from a bright core and trails off into a long dim tail
    for (int p = 0; p < 3; p++) {
      vec3 q = (l - (uProps[p] + vec3(-0.5, 0.0, 0.0))) / vec3(1.3, 0.9, 0.6);
      // (the tail is cut off: under a dark sky the exposure would lift it into a disc metres wide)
      r.glow += uBoatCol[b].rgb * max(pow(1.0 + 1.5 * dot(q, q), -2.0) - 0.012, 0.0) * 0.55;
    }
  }
  return r;
}
`;

const VS = WAKE_GLSL + BOAT_SHARED + `
layout(location = 0) in vec2 aPolar; // radius (m), angle (rad)
uniform mat4 uViewProj;
uniform vec3 uCamPos;
uniform sampler2D uDisp[3];
uniform float uSize[4];
uniform float uTexel[4];
uniform float uAngStep;
uniform float uDispScale;
out vec3 vWorld;
out vec2 vXZ;
out float vDisp;
out vec4 vWkC;     // boat wakes: pattern frame (along the path, across it, metres behind the stern, age)
out vec3 vWkD;     // boat wakes: strength, foam, width
out vec2 vWkS;     // boat wakes: slope
void main() {
  float r = aPolar.x;
  vec2 xz = uCamPos.xz + vec2(cos(aPolar.y), sin(aPolar.y)) * r;
  // vertex spacing at this ring -> mip level per cascade (filters waves the mesh cannot carry)
  float spacing = max(r * uAngStep, 0.02);
  vec3 D = vec3(0.0);
  float lsp = log2(spacing * 1.5);
  D += textureLod(uDisp[0], xz / uSize[0], max(lsp - log2(uTexel[0]), 0.0)).xyz;
  D += textureLod(uDisp[1], xz / uSize[1], max(lsp - log2(uTexel[1]), 0.0)).xyz;
  D += textureLod(uDisp[2], xz / uSize[2], max(lsp - log2(uTexel[2]), 0.0)).xyz;
  D *= uDispScale;
  // fade displacement where the mesh is extremely coarse (far field)
  vec3 P = vec3(xz.x + D.x, D.y, xz.y + D.z);
  // boat wakes lift the sea (the same field the physics feels, see src/game/wake.js)
  vWkC = vec4(0.0); vWkD = vec3(0.0); vWkS = vec2(0.0);
  if (uWkN > 0) {
    vec3 hg; vec4 fo;
    wakeField(P.xz, spacing, hg, fo, vWkC, vWkD);
    P.y += hg.x;
    vWkS = hg.yz;
    // bow waves: a ridge along each hull side, its crest thrown outward
    for (int b = 0; b < 4; b++) {
      if (b >= uBoatN) break;
      vec3 rel = P - uBoatPos[b].xyz;
      if (dot(rel.xz, rel.xz) > 100.0 || uBoatCol[b].a < 0.2) continue;
      vec3 X = uBoatX[b].xyz, Z = uBoatZ[b].xyz;
      float lx = dot(rel, X), lz = dot(rel, Z);
      if (lx < uHull.x || lx > uHull.y + 1.0 || abs(lz) > 4.0) continue;
      float k = uBoatCol[b].a * uBoatFx[b].x;
      float h0 = bowH(lx, lz, k, spacing), e = 0.08;
      float hx = (bowH(lx + e, lz, k, spacing) - h0) / e, hz = (bowH(lx, lz + e, k, spacing) - h0) / e;
      P.y += h0;
      // the crest overhangs: lift is paired with a push away from the hull
      P.xz += Z.xz * sign(lz) * 0.8 * h0;
      vWkS += hx * X.xz + hz * Z.xz;
    }
  }
  // earth curvature
  float dr = length(P.xz - uCamPos.xz);
  P.y -= dr * dr / (2.0 * 6360000.0);
  vWorld = P;
  vXZ = xz;
  vDisp = D.y;
  gl_Position = uViewProj * vec4(P, 1.0);
}`;

const FS = SKY_LOOKUP_GLSL + WAKE_AMT_GLSL + FOAM_GLSL + RAIN_SURFACE_GLSL + BOATS_GLSL + `
in vec4 vWkC;
in vec3 vWkD;
in vec2 vWkS;
in vec3 vWorld;
in vec2 vXZ;
in float vDisp;
out vec4 oColor;
uniform vec3 uCamPos;
uniform sampler2D uDisp[3];
uniform sampler2D uSlope[4];
uniform sampler2D uActive;      // active breaking of the main whitecap cascade (117 m)
uniform sampler2D uActive0;     // active breaking of the dominant waves (1800 m cascade)
uniform float uSize[4];
uniform float uTexel[4];
uniform sampler2D uEnv;          // reflection environment (equirect, mips = roughness)
uniform float uUnresolved;       // unresolved mean square slope (Cox-Munk remainder)
uniform float uMssTotal;         // total mean square slope of the surface (Cox-Munk)
uniform float uLongSlope;        // rms slope of the dominant (1800 m cascade) waves
uniform float uGlintArea;        // area of a glinting capillary facet (m2)
uniform vec4 uBolt;              // ground strike: foot xz, channel top height, channel radiance (0: none)
uniform float uHs;
uniform float uGlintExp;          // glints integrated by the exposure (long at night)
uniform vec3 uRrs;               // water-leaving remote sensing reflectance (1/sr)
uniform vec3 uSSS;               // crest scatter colour * strength
uniform float uFoamAmount;
uniform float uFoamLace;         // residual foam lace everywhere at gale force (stage-B whitecaps)
uniform float uRain;
uniform vec3 uGust;              // x: gustiness 0..1, yz: downwind drift of the gust pattern (m)
float ghash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float gnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(ghash(i), ghash(i + vec2(1, 0)), f.x), mix(ghash(i + vec2(0, 1)), ghash(i + vec2(1, 1)), f.x), f.y);
}
uniform vec3 uFlash;             // lightning illuminance
uniform int uDebug;
uniform vec3 uDbgMask; // debug: reflection, sun, body multipliers

const float M_PI = 3.14159265359;

vec2 equirectUv(vec3 d) {
  return vec2(atan(d.z, d.x) / (2.0 * M_PI) + 0.5, acos(clamp(d.y, -1.0, 1.0)) / M_PI);
}
// Sky seen by a rough facet ensemble: reflected rays spread by el (radians) in elevation. Tilting a
// facet sideways turns a reflected ray of elevation e by only ~el tan(e) in azimuth, so at grazing
// angles the blur is a narrow vertical streak, not a disk (a disk would average in sky far to the
// side: the sun's aureole). Hardware anisotropic filtering takes the streak.
vec3 envSample(vec3 d, float el) {
  d.y = max(d.y, 0.0);
  d = normalize(d);
  float az = el * min(d.y / max(sqrt(1.0 - d.y * d.y), 1e-3) + 0.03, 3.0);
  return textureGrad(uEnv, equirectUv(d), vec2(az / (2.0 * M_PI), 0.0), vec2(0.0, el / M_PI)).rgb;
}

// Bruneton et al. 2010 (after Ross et al. 2005), Beckmann with slope variance.
float erfc_(float x) { return 2.0 * exp(-x * x) / (2.319 * x + sqrt(4.0 + 1.52 * x * x)); }
float Lambda(float cosTheta, float sigmaSq) {
  float v = cosTheta / sqrt((1.0 - cosTheta * cosTheta) * (2.0 * sigmaSq));
  return max(0.0, (exp(-v * v) - v * sqrt(M_PI) * erfc_(v)) / (2.0 * v * sqrt(M_PI)));
}
float meanFresnel(float cosThetaV, float sigmaV) {
  return pow(max(1.0 - cosThetaV, 0.0), 5.0 * exp(-2.69 * sigmaV)) / (1.0 + 22.7 * pow(sigmaV, 1.5));
}
float reflectedSun(vec3 L, vec3 V, vec3 N, vec3 Tx, vec3 Ty, vec2 sigmaSq) {
  vec3 H = normalize(L + V);
  float zH = dot(H, N);
  if (zH <= 0.0) return 0.0;
  float zetax = dot(H, Tx) / zH;
  float zetay = dot(H, Ty) / zH;
  float zL = dot(L, N), zV = dot(V, N);
  float p = exp(-0.5 * (zetax * zetax / sigmaSq.x + zetay * zetay / sigmaSq.y)) / (2.0 * M_PI * sqrt(sigmaSq.x * sigmaSq.y));
  vec2 tv = vec2(dot(V, Tx), dot(V, Ty));
  float cosV2 = tv.x * tv.x / max(dot(tv, tv), 1e-12);
  float sigmaV2 = sigmaSq.x * cosV2 + sigmaSq.y * (1.0 - cosV2);
  vec2 tl = vec2(dot(L, Tx), dot(L, Ty));
  float cosL2 = tl.x * tl.x / max(dot(tl, tl), 1e-12);
  float sigmaL2 = sigmaSq.x * cosL2 + sigmaSq.y * (1.0 - cosL2);
  float fresnel = 0.02 + 0.98 * pow(max(1.0 - dot(V, H), 0.0), 5.0);
  zL = clamp(zL, 0.01, 0.9999);
  zV = clamp(zV, 0.01, 0.9999);
  return fresnel * p / ((1.0 + Lambda(zL, sigmaL2) + Lambda(zV, sigmaV2)) * zV * zH * zH * zH * zH * 4.0);
}

// C2-smooth bilinear (Quilez): remap the fractional texel position with a quintic
vec2 smoothUv(vec2 uv, float res) {
  vec2 x = uv * res + 0.5;
  vec2 i = floor(x), f = x - i;
  f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return (i + f - 0.5) / res;
}

uniform int uMarkN;
uniform vec4 uMarks[4];       // the nearest floating marks: x, z, float radius
// Where a mark meets the sea: foam lapping at its float and rings running out from it, stronger the
// rougher the sea. Returns the foam amount and adds the ripples' slope to sl.
float markFx(vec2 xz, inout vec2 sl) {
  float foam = 0.0;
  float rough = 0.3 + 0.7 * smoothstep(0.2, 2.5, uHs);
  for (int i = 0; i < 4; i++) {
    if (i >= uMarkN) break;
    vec2 dv = xz - uMarks[i].xy;
    float r = uMarks[i].z, d = length(dv);
    if (d > r + 4.0 || d < r * 0.9) continue;
    float a = atan(dv.y, dv.x);
    // the swash laps unevenly round the float and over time
    float n = bn(vec2(a * 3.0 * r * 0.5, uTime * 0.8 + float(i) * 7.0)) * 0.6 + bn(vec2(a * 9.0 * r * 0.5 + 3.0, uTime * 1.7)) * 0.4;
    float e = d - r;
    float w = 0.1 + (0.12 + 0.35 * rough) * n;
    foam += exp(-pow((e - 0.05) / w, 2.0)) * (0.8 + 1.8 * rough);
    // a thinner, broken fringe further out
    foam += exp(-pow((e - 0.35 - 0.8 * rough * n) / (0.25 + 0.3 * rough), 2.0)) * 0.5 * rough * smoothstep(0.35, 0.7, n);
    float ph = 14.0 * e - uTime * 4.5 + float(i) * 2.0;
    sl += dv / d * 0.05 * (0.4 + rough) * sin(ph) * exp(-e * 0.9) * smoothstep(0.0, 0.15, e);
  }
  return foam;
}

// Foam of the boats (the wash, the V arms, the hull line, the bow wave, the rings round the marks), made
// apart from the sea's own whitecaps so it can have its own structure: boiling froth where the props churn
// (marbled cells, thick and white), settling into streaks and lace laid out along the path of the wake
// and spreading with it, feathered edges. Every pattern is a mip-mapped texture lookup in a frame fixed
// in the water, so detail grows with the pixel's footprint and fades out with it instead of shimmering.
// Returns (coverage, thickness).
vec2 wakeFoam(vec4 fo, float contact, vec4 wc, float hw, vec2 dAx, vec2 dAy, vec2 dWx, vec2 dWy, out vec2 bump) {
  bump = vec2(0.0);
  // (broad ramps: a density that saturates quickly would leave only a hard rim to fray)
  float freshA = 1.0 - exp(-(fo.x * 0.22 + contact * 0.9));
  float oldA = 1.0 - exp(-fo.y * 0.6);
  float armA = 1.0 - exp(-fo.w * 0.7);
  if (freshA + oldA + armA < 0.01) return vec2(0.0);
  float age = wc.w;
  // pixel footprint in metres: beyond about a decimetre the fine structure is sub-pixel
  float fpm = sqrt(length(dWx) * length(dWy));
  float far = smoothstep(0.12, 0.7, fpm);
  // path frame: the trail's structure stretches sideways as the trail widens
  float kk = clamp(hw / 2.4, 1.0, 4.0);
  vec2 pc = vec2(wc.x, wc.y / kk), ix = vec2(dAx.x, dAx.y / kk), iy = vec2(dAy.x, dAy.y / kk);
  // the water churns: the world-frame cells drift slowly and differently in two layers
  vec2 wp = vXZ + 0.35 * vec2(sin(uTime * 0.9 + vXZ.y), cos(uTime * 1.1 + vXZ.x)) * (1.0 - smoothstep(0.0, 3.0, age));
  vec2 w1 = wp / 2.6, w2 = wp / 0.85 + 0.37;
  // (every lookup is blurred a few pixels wide: a pattern with single-pixel features thresholded
  // into coverage is confetti; the structure should be a dozen pixels or more)
  const float SOFT = 4.0;
  vec4 tb = textureGrad(uFoamTex, w1, dWx * SOFT / 2.6, dWy * SOFT / 2.6);
  // the relief of the froth (boils and billows catch the light on one side), from the same pattern
  vec2 e0 = vec2(0.14 / 2.6, 0.0);
  float tx = textureGrad(uFoamTex, w1 + e0, dWx * SOFT / 2.6, dWy * SOFT / 2.6).r;
  float tz = textureGrad(uFoamTex, w1 + e0.yx, dWx * SOFT / 2.6, dWy * SOFT / 2.6).r;
  bump = vec2(tx - tb.r, tz - tb.r) * (0.15 / 0.14) * (1.0 - far);
  vec4 tf = textureGrad(uFoamTex, w2, dWx * SOFT / 0.85, dWy * SOFT / 0.85);
  // streaks along the path at two scales, lace along it
  vec2 s1 = vec2(1.0 / 20.0, 1.0 / 7.0), s2 = vec2(1.0 / 6.0, 1.0 / 2.2), s3 = vec2(1.0 / 12.0, 1.0 / 4.5);
  float st1 = textureGrad(uFoamTex, pc * s1 + 0.31, ix * s1 * SOFT, iy * s1 * SOFT).b;
  float st2 = textureGrad(uFoamTex, pc * s2 + 0.67, ix * s2 * SOFT, iy * s2 * SOFT).b;
  float lc = textureGrad(uFoamTex, pc * s3 + 0.12, ix * s3 * SOFT, iy * s3 * SOFT).a;
  // where the foam thins toward its edges it breaks into fingers along the path (streaks of
  // water that stay clear), while the dense core is left whole
  float fing = 0.35 + 1.3 * (0.6 * st2 + 0.4 * st1);
  freshA *= mix(fing, 1.0, smoothstep(0.45, 0.85, freshA));
  oldA *= mix(0.55 + 0.9 * (0.5 * st1 + 0.5 * lc), 1.0, smoothstep(0.5, 0.9, oldA));
  // thresholds: foam fills the low values of a pattern first
  // (a little unblurred detail on top, thresholded softly, makes the lacy fringe of a froth edge)
  float fine = textureGrad(uFoamTex, w2, dWx / 0.85, dWy / 0.85).r - 0.5;
  float Pf = 0.1 + 0.5 * tb.r + 0.25 * (tf.r * 0.7 + tf.g * 0.3) + 0.35 * fine * (1.0 - far);
  float Pt = 0.1 + 0.25 * st1 + 0.15 * st2 + 0.2 * lc + 0.2 * tb.r;
  float Pa = 0.1 + 0.55 * tb.r + 0.35 * tf.g;
  // the edge softens with age (old foam is a loose film) and as detail goes sub-pixel
  float e = 0.15 + 0.12 * smoothstep(1.0, 7.0, age) + 0.25 * far;
  float cf = smoothstep(Pf - e, Pf + e, freshA * 1.8);
  float ct = smoothstep(Pt - e * 1.4, Pt + e * 1.4, (oldA + 0.6 * freshA) * 1.15) * mix(0.7, 1.0, oldA);
  float ca = smoothstep(Pa - e, Pa + e, armA * 1.1) * 0.85;
  // sub-pixel structure: the mean coverage
  cf = mix(cf, clamp(freshA * 1.05, 0.0, 1.0), far);
  ct = mix(ct, clamp(oldA * 0.7, 0.0, 1.0) * 0.8, far);
  ca = mix(ca, clamp(armA * 0.7, 0.0, 1.0), far);
  float cov = max(cf, max(ct, ca));
  // thickness: dense froth near the boat, brighter where it is thick, thinning with age
  float bub = mix(0.78 + 0.3 * tf.g * (0.6 + 0.8 * tb.r), 0.9, far);
  // (low pattern values are where the froth is deepest: mottling the white from bright to pale)
  float mott = smoothstep(0.3, 0.62, 1.0 - Pf);
  float th = max(cf * mix(0.35, 1.0, mott) * mix(0.75, 1.0, freshA) * bub, max(ct * mix(0.3, 0.7, oldA), ca * 0.45));
  return vec2(cov, clamp(th, 0.0, 1.0));
}

void main() {
  vec3 uSunE = sunIlluminance();
  vec3 uSkyE = skyIrradiance();
  vec3 P = vWorld;
  // area of the pixel footprint on the sea (m2)
  float footA = max(length(cross(dFdx(P), dFdy(P))), 1e-9);
  vec3 toCam = uCamPos - P;
  float dist = length(toCam);
  // footprint-aligned cells of about one pixel (for per-pixel random events: glints, impacts)
  vec2 ex = dFdx(vXZ), ey = dFdy(vXZ), qc = vXZ - uCamPos.xz;
  vec2 gCell = floor(vec2(dot(qc, ex) / max(dot(ex, ex), 1e-12), dot(qc, ey) / max(dot(ey, ey), 1e-12)));
  vec3 V = toCam / dist;

  // slopes and their variance from all cascades (hardware anisotropic + trilinear filtering)
  vec2 s = vec2(0.0);
  vec2 var = vec2(0.0);
// short-wave modulation: gust patches (cat's paws, ~100-300 m, drifting with the wind) and
  // hydrodynamic modulation (short waves steepen on the crests of the long waves)
  vec2 gq = vXZ - uGust.yz;
  float gust = gnoise(gq / 210.0) * 0.6 + gnoise(gq / 70.0 + 7.3) * 0.4;
  float crestM = smoothstep(-0.3 * uHs, 0.3 * uHs, vDisp);
#define SLOPE(c, k) { vec4 m = texture(uSlope[c], vXZ / uSize[c]); s += m.xy * k; var += max(m.zw - m.xy * m.xy, vec2(0.0)) * k * k; }
  SLOPE(0, 1.0)
  // the forward (downwind) faces of the dominant waves: steep short waves and breaking live there
  float face = smoothstep(0.0, 1.0, -dot(s, uWindDir) / max(uLongSlope, 0.01));
  float hm = clamp(0.6 * crestM + 0.4 * face, 0.0, 1.0);
  float sm = clamp((1.0 + uGust.x * (gust - 0.5)) * mix(0.8, 1.25, hm), 0.6, 1.5);
  SLOPE(1, mix(1.0, sm, 0.5))
  // slopes of the waves long enough to make thin, backlit crests
  vec2 sL = s;
  SLOPE(2, sm) SLOPE(3, sm)
  float foamRaw = 0.0;
  float plume = 0.0;
  float activeRaw = 0.0;
  {
    // quintic-smoothed lookups: thresholding a bilinear coarse field gives polygonal outlines
    // (explicit gradients: the remapped coordinates must not drive mip selection)
    vec2 u0 = vXZ / uSize[0], u1 = vXZ / uSize[1];
    vec4 d0 = textureGrad(uDisp[0], smoothUv(u0, uSize[0] / uTexel[0]), dFdx(u0) * 0.5, dFdy(u0) * 0.5);
    vec4 d1 = textureGrad(uDisp[1], smoothUv(u1, uSize[1] / uTexel[1]), dFdx(u1) * 0.5, dFdy(u1) * 0.5);
    vec4 d2 = texture(uDisp[2], vXZ / uSize[2]);
    foamRaw = d0.w * 0.15 + d1.w * 1.0 + d2.w * 0.75;
    // waves break on the crests of the energetic (dominant) waves: whitecaps cluster there
    float crest = smoothstep(-0.2 * uHs, 0.3 * uHs, vDisp);
    foamRaw *= mix(0.4, 1.5, crest);
    // (a soft density ramp: the bubble pattern, not the field's outline, shapes the cap)
    // (the crest moves downwind: a point collects the froth of crests now 1.5-5 m downwind of it)
    vec2 ga = dFdx(u1) * 1.6, gb = dFdy(u1) * 1.6, wo = uWindDir / uSize[1];
    float c0 = textureGrad(uActive, u1, ga, gb).r;
    float aT = max(c0, (c0 + textureGrad(uActive, u1 + wo * 1.5, ga, gb).r * 0.8
              + textureGrad(uActive, u1 + wo * 3.0, ga, gb).r * 0.55 + textureGrad(uActive, u1 + wo * 5.0, ga, gb).r * 0.3) / 1.8);
    activeRaw = aT * 1.2 * mix(0.6, 1.6, clamp(textureGrad(uActive0, u0, dFdx(u0) * 1.2, dFdy(u0) * 1.2).r, 0.0, 1.0));
    activeRaw *= mix(0.6, 1.35, crest) * mix(0.6, 1.4, face);
    // bubble plume: the same foam fields blurred over a few metres (bubbles spread and sink)
    // (it follows recent breaking: mostly the active field, a little of the old foam)
    float pa = textureLod(uActive, u1, 3.5).r;
    plume = clamp(pa * 1.5 * mix(0.5, 1.3, crest), 0.0, 2.0);
  }

  // rain ripples: normal perturbation near the camera, extra roughness further away
  vec3 rr = rainRipples(vXZ, uTime, uRain, dist, sqrt(footA));
  s += rr.xy + vWkS;
  // (against the displaced surface: the mark rides with the water, not with the grid)
  float markFoam = markFx(P.xz, s);
  // unresolved capillary roughness: sparkles near the camera, smooth BRDF lobe far away
  float unres = uUnresolved * 0.5 * sm * sm * (1.0 - 0.4 * uRain);
  vec2 sigmaSq = var + vec2(unres);
  sigmaSq = max(sigmaSq, vec2(2e-5));

  vec3 N = normalize(vec3(-s.x, 1.0, -s.y));
  // specular anti-aliasing (Kaplanyan & Hoffman 2016): normal variation inside the pixel
  // footprint becomes extra slope variance, so sub-pixel ripples don't alias into hairlines
  vec3 dNx = dFdx(N), dNy = dFdy(N);
  float kv = min(0.5 * (dot(dNx, dNx) + dot(dNy, dNy)), 0.08);
  // the footprint cannot hold more slope variance than the whole surface has (Cox-Munk): beyond that
  // the glitter path would stop narrowing toward the horizon. Rain roughness comes on top.
  vec2 sigmaSun = min(sigmaSq + vec2(kv), vec2(0.5 * uMssTotal)) + vec2(rr.z);
  sigmaSq = min(sigmaSq, vec2(0.5 * uMssTotal)) + vec2(rr.z);
  vec3 Ty = normalize(cross(N, vec3(1.0, 0.0, 0.0)));
  vec3 Tx = cross(Ty, N);

  vec3 L = uSunDir;
  float nv = clamp(dot(N, V), 0.0, 1.0);
  // view-direction slope variance for the averaged Fresnel
  vec2 vh = normalize(V.xz + 1e-6);
  float sigmaV = sqrt(dot(vh * vh, sigmaSq));
  float F = 0.02 + 0.98 * meanFresnel(nv, sigmaV);

  // sun visibility through clouds
  vec2 suv = (P.xz - uShaftRect.xy) * uShaftRect.zw;
  float sunVis = mix(uHazeSun, texture(uShaftShadow, suv).r, smoothstep(0.0, 0.04, min(min(suv.x, suv.y), min(1.0 - suv.x, 1.0 - suv.y))));

  // boats: hull, shadow, shade, underwater light
  BoatFx bfx = boatFx(P, L);
  sunVis *= 1.0 - bfx.shadow;
  uSkyE *= 1.0 - bfx.ao;

  // reflection of the sky / clouds, blurred by the unresolved roughness
  vec3 R = reflect(-V, N);
  float dR = length(fwidth(R));
  vec3 Ed = uSunE * sunVis * max(L.y, 0.0) + uSkyE + uFlash * 0.3;
  // on a rough sea the facets we see lean toward us (Smith masking): the reflected rays rise
  R.y += 1.1 * sigmaV * (1.0 - nv);
  // a ray reflected downwards hits the next wave: it sees that wave's water and, reflected once
  // more, the sky about two rms slopes up (not the brightest band at the horizon). The lobe has
  // an angular width ~2 sigma: blend by the fraction below the horizon (no per-pixel dashes).
  float lobe = 2.0 * sqrt(sigmaSq.x + sigmaSq.y) + 0.02;
  float below = smoothstep(-lobe, lobe, -R.y);
  float s2 = sqrt(0.5 * (sigmaSq.x + sigmaSq.y));
  float F2 = 0.02 + 0.98 * pow(1.0 - clamp(abs(R.y) + s2, 0.0, 1.0), 5.0);
  R.y = mix(abs(R.y), max(2.0 * s2 - abs(R.y), 0.01), below);
  R = normalize(R);
  // extended sources (sky, clouds) are blurred by the full capillary roughness, except near the
  // camera where only the sun's tiny disk resolves into sparkles
  float rough = sqrt(max(sigmaSq.x + sigmaSq.y - 2.0 * unres * (1.0 - smoothstep(2.0, 8.0, dist)), 4e-5));
  // mip from the BRDF width and from the spread of reflected directions within the pixel
  float envSpread = min(rough * 1.18, 1.2);
  vec3 sky = envSample(R, envSpread) * mix(1.0, F2, below) + below * (1.0 - F2) * uRrs * Ed;
  vec3 refl = F * sky;
  // rain impact stipple where a single impact (crater + crown, ~2 cm2) is about pixel-sized: a
  // Poisson count of impacts within the ~60 ms they stay visible; craters see the lower sky
  // (darker), crowns catch the light (brighter)
  if (uRain > 0.01) {
    float pix = sqrt(footA);
    float vis = smoothstep(0.003, 0.006, pix) * (1.0 - smoothstep(0.05, 0.15, pix));
    if (vis > 0.0) {
      float lamC = 2600.0 * uRain * footA * 0.15;
      vec2 cell = gCell;
      float u1 = fract(sin(dot(vec3(cell, floor(uTime * 16.0)), vec3(12.9898, 78.233, 45.164))) * 43758.5453);
      float pk = exp(-lamC), cdf = pk, k = 0.0;
      for (int i = 0; i < 16; i++) { if (u1 <= cdf) break; k += 1.0; pk *= lamC / k; cdf += pk; }
      float frac = min(2e-4 / footA, 1.0);
      vec3 Limp = 0.035 * envSample(vec3(0.0, 1.0, 0.0), 0.8) + uRrs * Ed;
      float e = (k - lamC) * frac;
      refl = e > 0.0 ? mix(refl, 0.4 * uSkyE / M_PI, clamp(e * 0.15, 0.0, 0.2) * vis) : mix(refl, Limp, clamp(-e * 0.35, 0.0, 0.5) * vis);
    }
  }

  // sun glitter
  vec3 sun = uSunE * sunVis * reflectedSun(L, V, N, Tx, Ty, sigmaSun);
  // Glints: the expected sun reflection is carried by a few capillary facets (~1 cm2) whose slopes
  // happen to mirror the sun's disk (6.8e-5 sr) into the eye. With N facets in the pixel footprint,
  // lambda = E[L] Omega_sun / (F L_sun) N glint on average: near the camera lambda << 1 (sparse,
  // full-brightness sparkles on dark water), far away it is large (the smooth glitter path).
  {
    vec3 Hs = normalize(L + V);
    float fH = 0.02 + 0.98 * pow(max(1.0 - dot(V, Hs), 0.0), 5.0);
    // (glinting capillary facets of a few cm2)
    float lam = dot(sun, vec3(0.2126, 0.7152, 0.0722)) / max(dot(uSunE * sunVis, vec3(0.2126, 0.7152, 0.0722)), 1e-9)
              * 6.8e-5 / fH * (footA / (uGlintArea * mix(1.5, 1.0, smoothstep(8.0, 80.0, dist)))) * uGlintExp;
    float gx = clamp(0.15 / max(V.y, 0.0375), 1.0, 3.0);
    lam *= gx;
    if (lam > 1e-7 && lam < 400.0) {
      vec2 cell = vec2(floor((gCell.x + floor(fract(sin(gCell.y * 12.97 + 3.7) * 43758.5453) * gx)) / gx), gCell.y);
      float ph = fract(sin(dot(cell, vec2(7.13, 3.71))) * 912.3);
      float u = fract(sin(dot(vec3(cell, floor(uTime * 12.0 + ph)), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
      float k = 0.0;
      if (lam < 12.0) {
        // Poisson sample by inversion
        float pk = exp(-lam), cdf = pk;
        for (int i = 0; i < 24; i++) { if (u <= cdf) break; k += 1.0; pk *= lam / k; cdf += pk; }
      } else {
        // shot noise: Gaussian approximation
        float u2 = fract(u * 113.37 + 0.71);
        k = max(lam + sqrt(lam) * sqrt(-2.0 * log(max(u, 1e-6))) * cos(6.2831853 * u2), 0.0);
      }
      float u3 = fract(u * 71.13 + 0.23);
      sun *= k / lam * mix(min(-log(max(u3, 1e-3)), 3.0) / 0.95, 1.0, min(k * 0.25, 1.0));
    }
  }

  // the lightning channel mirrored by the rough sea: a glitter column under the strike
  if (uBolt.w > 0.0) {
    vec2 toB = uBolt.xy - P.xz;
    float dh = max(length(toB), 1.0);
    vec2 rh = R.xz / max(length(R.xz), 1e-4);
    float ang = acos(clamp(dot(rh, toB / dh), -1.0, 1.0));
    // reflected directions spread by twice the facet slope spread
    float lobeW = max(2.0 * sqrt(0.5 * (sigmaSq.x + sigmaSq.y)), 3.0 / dh);
    float elev = R.y / max(length(R.xz), 1e-4);
    float span = smoothstep(-0.005, 0.01, elev) * (1.0 - smoothstep(0.7, 1.0, elev * dh / max(uBolt.z, 1.0)));
    // a channel ~2 m wide seen through a slope lobe of width lobeW: its radiance spreads over the lobe
    float spread = (2.0 / dh) / (lobeW * 2.5066);
    // (only the brightest part of the channel, near the sea, is not hidden by rain and cloud: ~3%)
    sun += F * vec3(0.82, 0.86, 1.0) * uBolt.w * 0.02 * exp(-ang * ang / (2.0 * lobeW * lobeW)) * span * min(spread, 1.0);
  }

  // water-leaving radiance (deep, optically infinite water)
  vec3 body = uRrs * Ed * (1.0 - F) / 0.98;

  // crest subsurface scattering (light transmitted through thin backlit crests)
  float H = max(vDisp + 0.15 * uHs, 0.0) / max(uHs, 0.3);
  // only thin, steep crests near enough to resolve transmit light
  float back = pow(max(dot(L, -V), 0.0), 4.0) * pow(max(0.5 - 0.5 * dot(L, N), 0.0), 3.0)
             * (1.0 - smoothstep(20.0, 200.0, dist)) * smoothstep(0.15, 0.35, length(sL));
  vec3 sss = uSSS * (1.0 - F) * H * back * 3.0 * uSunE * sunVis;

  // (the wake's foam amounts, per pixel)
  vec4 wkAmt = vec4(0.0);
  float wkHw = 2.4;
  if (vWkD.x + vWkD.y > 0.0) { wkAmt = wakeAmounts(vWkC, vWkD); wkHw = (1.8 + 0.8 * sqrt(vWkC.z)) * vWkD.z; }
  // submerged bubbles backscatter strongly: the water around and beneath whitecaps turns pale aquamarine
  float pl = (1.0 - exp(-(plume * uFoamAmount + wkAmt.z) * 1.8)) * (1.0 - smoothstep(150.0, 900.0, dist) * 0.6);
  body += (1.0 - F) * pl * vec3(0.035, 0.062, 0.053) * Ed / M_PI;
  vec3 col = refl * uDbgMask.x + sun * uDbgMask.y + (body + sss) * uDbgMask.z;
  col += (1.0 - F) * uRain * 0.008 * smoothstep(3.0, 40.0, dist) * (uSkyE + uSunE * sunVis * max(L.y, 0.0)) / M_PI;

  // foam
  vec2 fc = foamCoverage(vXZ, foamRaw * uFoamAmount, uFoamLace * uFoamAmount, activeRaw * uFoamAmount, dist);
  // (derivatives of the wake's frame, taken here where every pixel runs: the lookups inside are not)
  vec2 dAx = dFdx(vWkC.xy), dAy = dFdy(vWkC.xy), dWx = dFdx(vXZ), dWy = dFdy(vXZ);
  vec2 wbump;
  vec2 wf = wakeFoam(wkAmt, bfx.act + markFoam, vWkC, wkHw, dAx, dAy, dWx, dWy, wbump);
  foamBump = mix(foamBump, wbump, wf.x);
  fc = vec2(1.0 - (1.0 - fc.x) * (1.0 - wf.x), mix(fc.y, wf.y, wf.x / max(fc.x + wf.x, 1e-3)));
  float foam = fc.x;
  if (uDebug == 1) { oColor = vec4(foam, foamRaw, foamCovA, 1.0); return; }
  if (foam > 0.0) {
    // bubble layer: thick fresh foam is a bright diffuse scatterer (albedo ~0.8);
    // thin residual foam is translucent and picks up the water's blue-green
    float thick = fc.y;
    vec3 Nf = normalize(vec3(-s.x + foamBump.x * 1.8, 1.0, -s.y + foamBump.y * 1.8));
    float wrapL = max((dot(Nf, L) + 0.2) / 1.2, 0.0);
    vec3 Ein = uSunE * sunVis * wrapL + uSkyE * (0.45 + 0.55 * Nf.y) + uFlash;
    // bubble foam scatters like a diffuse white layer (albedo ~0.6-0.85); only its thinnest
    // parts let a little of the blue-green water show through
    float albedo = mix(0.5, 0.9, thick);
    vec3 tint = mix(vec3(0.93, 0.97, 0.98), vec3(1.0), thick);
    vec3 foamCol = albedo * tint * Ein / M_PI;
    col = col * (1.0 - foam * mix(0.55, 1.0, thick)) + foam * foamCol;
  }

  // underwater lights shine up through the water (and tint the wash)
  // The lamps are set against the daylight, not in absolute units: a fixed radiance would vanish at
  // noon and flood the frame under storm cloud, where the exposure is ten times longer.
  col += bfx.glow * uGlow * (dot(Ed, vec3(0.2126, 0.7152, 0.0722)) / M_PI) * (1.0 - F) * (1.0 - 0.6 * foam);

  // lightning reflection (broad, from cloud base)
  col += F * uFlash * 0.08;

  // aerial perspective
  vec3 dir = -V;
  vec3 aL, aT;
  aerial(dir, dist * 0.001, aL, aT);
  col = col * aT + aL;
  // light shafts through cloud gaps in the haze between the camera and this point
  col = withShafts(col, uCamPos, -V, dist);
  // rain / mist fog
  col = applyFog(col, -V, dist);
  // the sea inside a hull is not there (decided last: the derivatives above need every pixel)
  if (bfx.hide > 0.5) discard;
  oColor = vec4(col, 1.0);
}`;

export class Water {
  constructor(gl, { angular = 512, center = 0.03, far = 40000 } = {}) {
    this.gl = gl;
    this.prog = new Program(gl, VS, FS, { label: 'water' });
    const ang = (2 * Math.PI) / angular;
    const q = 1 + ang;
    const a = center / ang;
    const radii = [0];
    const rings = Math.ceil(Math.log(far / a + 1) / Math.log(q));
    for (let i = 1; i <= rings; i++) {
      const r = a * (Math.pow(q, i) - 1);
      radii.push(r);
      if (r > far) break;
    }
    const nr = radii.length;
    const verts = new Float32Array(nr * (angular + 1) * 2);
    let o = 0;
    for (let i = 0; i < nr; i++)
      for (let j = 0; j <= angular; j++) { verts[o++] = radii[i]; verts[o++] = j * ang; }
    const idx = new Uint32Array((nr - 1) * angular * 6);
    o = 0;
    for (let i = 0; i < nr - 1; i++)
      for (let j = 0; j < angular; j++) {
        const a0 = i * (angular + 1) + j, a1 = a0 + 1, b0 = a0 + angular + 1, b1 = b0 + 1;
        idx[o++] = a0; idx[o++] = b0; idx[o++] = a1;
        idx[o++] = a1; idx[o++] = b0; idx[o++] = b1;
      }
    this.mesh = makeMesh(gl, [[verts, 2]], idx);
    this.angStep = ang;
  }

  draw(uniforms) {
    const gl = this.gl;
    this.prog.use({ ...uniforms, uAngStep: this.angStep });
    gl.bindVertexArray(this.mesh.vao);
    gl.drawElements(gl.TRIANGLES, this.mesh.count, this.mesh.itype, 0);
    gl.bindVertexArray(null);
  }
}
