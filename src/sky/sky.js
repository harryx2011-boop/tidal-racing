// Sky background (atmosphere LUT + sun disk + clouds composite) and the reflection
// environment map (equirectangular, mip chain used as a roughness pre-filter).
import { Program, Texture, Target, fullscreen, bindEmpty, FULLSCREEN_VS } from '../gl.js';
import { SKY_LOOKUP_GLSL } from './atmosphere.js';

// Shared by the sky pass and the reflection environment: the cirrus sheet is a pure function of
// the view direction, so the sea and the boat reflect the same streaks the sky shows.
const CIRRUS_GLSL = `
uniform sampler2D uCirrusTex;  // r fibres, g fall-streak tufts, b ripples, a patches (built in clouds.js)
uniform vec4 uCirrus;        // xy: advection aloft (m), z: amount, w: altitude (m)
uniform vec3 uCirrusCam;     // camera position (the env pass has no uCamPos of its own)
float hgc(float c, float g) { float g2 = g * g; return (1.0 - g2) / (4.0 * 3.14159 * pow(1.0 + g2 - 2.0 * g * c, 1.5)); }
// Cirrus: a thin sheet of ice crystals at ~8.5 km, above the haze and the cumulus. It is evaluated
// per pixel from a fixed texture (no ray march, no history), so it is as sharp as the screen is and
// costs three texture fetches. The tile is read at three scales: 56 km (the filaments and tufts one
// sees as shapes), 15 km (the fine hairs inside them) and
// 97 km (which part of the sky holds what). The sheet thickens towards the horizon (longer slant
// path) and fades into the haze there.
vec4 cirrusLayer(vec3 d) {
  float amount = uCirrus.z;
  const float RG = 6360000.0;
  float R = RG + uCirrus.w;
  vec3 o = vec3(0.0, RG + uCirrusCam.y, 0.0);
  float b = dot(o, d);
  float t = -b + sqrt(max(b * b - (dot(o, o) - R * R), 0.0));
  vec2 xz = uCirrusCam.xz + d.xz * t + uCirrus.xy;
  vec2 ax = vec2(0.9, 0.436);
  vec2 q = vec2(dot(xz, ax), dot(xz, vec2(-ax.y, ax.x)));
  // (fetched before any branch: the mip level comes from screen-space derivatives)
  vec4 A = texture(uCirrusTex, q / 56000.0);
  // (the fine set is turned four degrees: hairs that run a little askew, not one combed direction)
  vec4 B = texture(uCirrusTex, vec2(q.x * 0.9976 - q.y * 0.0698, q.x * 0.0698 + q.y * 0.9976) / 15000.0 + vec2(0.37, 0.61));
  vec4 C = texture(uCirrusTex, q.yx / 97000.0 + vec2(0.13, 0.52));
  if (amount < 0.01 || d.y < 0.004) return vec4(0.0, 0.0, 0.0, 1.0);
  // a thin sheet is patchy: with little amount only the thickest patches hold cirrus, so a calm sky
  // keeps wide gaps instead of a veil
  float th = mix(0.62, 0.42, clamp(amount / 0.6, 0.0, 1.0));
  float region = smoothstep(th, th + 0.22, C.a * 0.55 + A.a * 0.45);
  // inside a sheaf: a faint veil and the hairs at two scales, denser at the head of a tuft; the hairs
  // run on past the veil and thin out, so a sheaf has no outline
  // (each hair comes and goes along its length, and no two are equally thick)
  float hair = max(A.r * (0.45 + 0.55 * B.a), 0.75 * B.r * (0.35 + 0.65 * A.a));
  float dens = region * (0.5 + 0.5 * B.g) * (0.34 * A.g * A.g + 0.6 * hair * smoothstep(0.0, 0.55, A.g)) * (1.0 + 0.8 * smoothstep(0.75, 1.0, A.g));
  // in places the sheet is banded across the flow (billows aloft)
  dens *= mix(1.0, 0.35 + 1.1 * A.b, smoothstep(0.55, 0.75, C.g + 0.4 * C.a));
  float slant = clamp(0.35 / max(d.y, 0.02), 1.0, 3.0);
  float tau = amount * 1.25 * dens * slant * smoothstep(0.004, 0.05, d.y);
  float Tc = exp(-tau);
  float cosT = dot(d, uSunDir);
  vec3 sunE = sunTransmittanceAt(uCirrus.w * 0.001, uSunDir.y);
  // a low sun reaches the sheet through the long, dusty path along the ground; the part of the sheet
  // seen away from the sun is lit by the reddest of it and shows rose against the blue
  float low = smoothstep(0.3, 0.05, uSunDir.y);
  sunE *= mix(vec3(1.0), vec3(1.0, 0.86, 0.9), low * smoothstep(0.5, -0.5, cosT));
  // ice crystals: a diffraction peak forward and a broad, nearly isotropic remainder
  float ph = mix(0.0796, hgc(cosT, 0.6), 0.2);
  vec3 L = (1.0 - Tc) * (sunE * ph * 2.4 + skyIrradiance() / 3.14159 * 0.5);
  float distKm = t * 0.001;
  vec3 aL, aT;
  aerial(d, min(distKm, uAerialMax), aL, aT);
  float sEl = d.y * distKm / 2.0;
  float fsl = sEl > 1e-3 ? (1.0 - exp(-sEl)) / sEl : 1.0;
  vec3 aT2 = pow(max(aT, vec3(1e-4)), vec3(fsl));
  aL *= (1.0 - aT2) / max(1.0 - aT, vec3(1e-4));
  return vec4(L * aT2, Tc);
}
uniform float uGap;          // strength of the open strip under a closed deck's far edge (0 = none)
// Under a closed storm deck the rain is local. Far off, below the deck's distant edge, the sky is
// open and lights the rain and haze there: from under the deck that is a pale strip along the
// horizon, the brightest thing in the picture, cut by the dark shafts of the showers that stand in
// front of it. It takes the clear sky's colour in that direction (so it burns orange toward a low
// sun) at a few times the luminance of the rain under the deck; the same shower cells that thicken
// the fog (rainCell) close it. Returns radiance to add after the fog.
vec3 deckGap(vec3 d) {
  if (uGap <= 0.0 || d.y < -0.01) return vec3(0.0);
  vec2 dh = normalize(d.xz + vec2(1e-6, 0.0));
  float m = rainCell(uFogCam + dh * 5000.0) * 0.4 + rainCell(uFogCam + dh * 9000.0) * 0.35 + rainCell(uFogCam + dh * 14000.0) * 0.25;
  float open = exp(-1.7 * max(m - 0.1, 0.0));
  // (the far base hangs lower in places: a ragged upper edge)
  float top = 0.03 + 0.035 * fogNoise2(dh * 6.0 + 11.3) + 0.012 * fogNoise2(dh * 19.0 + 3.1);
  float band = smoothstep(-0.006, 0.004, d.y) * (1.0 - smoothstep(top * 0.4, top, d.y));
  vec3 sky = skyRadiance(normalize(vec3(dh.x, 0.03, dh.y)));
  float ls = max(dot(sky, vec3(0.2126, 0.7152, 0.0722)), 1e-7);
  float lf = dot(fogRadiance(d, 0.0), vec3(0.2126, 0.7152, 0.0722));
  return mix(vec3(1.0), sky / ls, 0.75) * lf * 3.2 * band * open * uGap;
}
// Rain seen against the sky. The fog (applyFog) thickens in shower cells but is lit evenly, so a
// curtain of rain was only a paler patch. Under the heart of a shower the light is dimmer (the cloud
// that sheds it is the thickest) and the falling rain is combed into streaks that lean with the
// wind: the sky's fogged colour is shaded by the cells that stand in the first kilometres of the
// view, darkest low down where the path through them is longest.
vec3 rainShafts(vec3 col, vec3 d) {
  if (uRainCell.x <= 0.0 || d.y < -0.01) return col;
  vec2 dh = normalize(d.xz + vec2(1e-6, 0.0));
  float m = rainCell(uFogCam + dh * 1500.0) * 0.3 + rainCell(uFogCam + dh * 3500.0) * 0.4 + rainCell(uFogCam + dh * 7000.0) * 0.3;
  float cell = smoothstep(0.25, 1.1, m);
  // (2D noise read on the circle of view azimuths has no seam; the lean is a turn that grows with elevation)
  float a = d.y * 0.3, ca = cos(a), sa = sin(a);
  vec2 ds = vec2(ca * dh.x - sa * dh.y, sa * dh.x + ca * dh.y);
  float streak = fogNoise2(ds * 37.0 + 3.1) * 0.45 + fogNoise2(vec2(ds.x + ds.y, ds.y - ds.x) * 71.0 + 7.7) * 0.33 + fogNoise2(ds * 211.0 + 1.3) * 0.22;
  float w = (1.0 - smoothstep(0.08, 0.38, d.y)) * clamp(uRainCell.x / 0.7e-3, 0.0, 1.0);
  return col * mix(1.0, mix(1.12, 0.68, cell) * (1.0 + 0.2 * (streak - 0.5) * (0.25 + cell)), w);
}
`;

const SKY_FS = SKY_LOOKUP_GLSL + CIRRUS_GLSL + `
in vec2 vUv;
out vec4 o;
uniform mat4 uInvViewProj;
uniform vec3 uCamPos;
uniform sampler2D uClouds;   // rgb: in-scattered radiance, a: transmittance
uniform sampler2D uCloudDepth; // mean distance of the cloud light (km)
uniform float uCloudsOn;
uniform float uSunVis;
uniform float uIsMoon;
uniform float uPixelAngle;
uniform float uTime;
const float SUN_COS = 0.99998917; // cos(0.2666 deg)
float mhash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float mnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mhash(i), mhash(i + vec2(1, 0)), f.x), mix(mhash(i + vec2(0, 1)), mhash(i + vec2(1, 1)), f.x), f.y); }
vec4 cloudBicubic(vec2 uv, vec2 size) {
  vec2 sp = uv * size - 0.5;
  vec2 tp = floor(sp) + 0.5;
  vec2 f = sp - floor(sp);
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2;
  vec2 t0 = (tp - 1.0) / size, t3 = (tp + 2.0) / size, t12 = (tp + w2 / w12) / size;
  vec4 r = texture(uClouds, vec2(t12.x, t0.y)) * w12.x * w0.y
    + texture(uClouds, vec2(t0.x, t12.y)) * w0.x * w12.y + texture(uClouds, t12) * w12.x * w12.y + texture(uClouds, vec2(t3.x, t12.y)) * w3.x * w12.y
    + texture(uClouds, vec2(t12.x, t3.y)) * w12.x * w3.y;
  r /= w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
  ivec2 ip = ivec2(floor(sp));
  ivec2 mx = ivec2(size) - 1;
  vec4 a = texelFetch(uClouds, clamp(ip, ivec2(0), mx), 0), b = texelFetch(uClouds, clamp(ip + ivec2(1, 0), ivec2(0), mx), 0);
  vec4 c = texelFetch(uClouds, clamp(ip + ivec2(0, 1), ivec2(0), mx), 0), d = texelFetch(uClouds, clamp(ip + ivec2(1, 1), ivec2(0), mx), 0);
  vec4 lo = min(min(a, b), min(c, d)), hi = max(max(a, b), max(c, d));
  r = clamp(r, lo, hi);
  // The outline of a cloud. The buffer has one ray per texel and a hard-edged cloud is either hit or
  // missed, so its outline arrives as a staircase two screen pixels to the step, which no interpolation
  // of those texels removes. A cubic B-spline of the same texels is too soft to draw with, but its
  // half-way contour runs straight through the steps: where the nearest texels disagree about there
  // being a cloud at all, the transmittance is that blur pushed back to an edge a pixel wide (the way a
  // glyph is drawn from a distance field), and the cloud's light is the blurred light per unit of
  // opacity under the new edge. Inside a cloud and in thin veils nothing changes.
  float k = smoothstep(0.25, 0.6, hi.a - lo.a);
  if (k > 0.0) {
    vec2 v0 = (1.0 - f) * (1.0 - f) * (1.0 - f) / 6.0, v3 = f * f * f / 6.0;
    vec2 v1 = (3.0 * f * f * f - 6.0 * f * f + 4.0) / 6.0, v2 = 1.0 - v0 - v1 - v3;
    vec2 g0 = v0 + v1, g1 = v2 + v3;
    vec2 h0 = (tp - 1.0 + v1 / g0) / size, h1 = (tp + 1.0 + v3 / g1) / size;
    vec4 bs = g0.y * (g0.x * texture(uClouds, h0) + g1.x * texture(uClouds, vec2(h1.x, h0.y)))
      + g1.y * (g0.x * texture(uClouds, vec2(h0.x, h1.y)) + g1.x * texture(uClouds, h1));
    float as = lo.a + (hi.a - lo.a) * smoothstep(0.26, 0.74, clamp((bs.a - lo.a) / (hi.a - lo.a), 0.0, 1.0));
    vec4 e = vec4(bs.rgb / max(1.0 - bs.a, 0.02) * (1.0 - as), as);
    r = mix(r, e, k);
  }
  return r;
}
// Crepuscular rays, as atmosphere.js's shafts() but with the cloud-shadow map read through its mip
// chain, at the level whose texel matches the spacing of the samples along the ray. The samples are
// jittered per pixel; read from the full-resolution map each pixel catches a different edge of a
// cloud's shadow and the haze around a low sun prints as grain. Filtered at the sample spacing the
// jitter averages out inside the filter (that is what the integral over a pixel's footprint is).
vec3 shaftsLod(vec3 ro, vec3 dir, float dist) {
  if (uShaft.z <= 0.0 || uSunDir.y < 0.02) return vec3(0.0);
  float tMax = dist;
  if (dir.y > 0.0) tMax = min(tMax, (uShaft.y - ro.y) / max(dir.y, 1e-3));
  tMax = min(tMax, 12000.0);
  if (tMax <= 0.0) return vec3(0.0);
  const int N = 28;
  float vis = 0.0, wsum = 0.0;
  float texelM = 1.0 / max(uShaftRect.z * float(textureSize(uShaftShadow, 0).x), 1e-9);
  for (int i = 0; i < N; i++) {
    float f = (float(i) + fract(uShaft.w + fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453))) / float(N);
    float t = tMax * f * f;
    vec3 p = ro + dir * t;
    vec2 xz0 = p.xz - uSunDir.xz * (max(p.y, 0.0) / uSunDir.y);
    vec2 suv = (xz0 - uShaftRect.xy) * uShaftRect.zw;
    float inR = smoothstep(0.0, 0.04, min(min(suv.x, suv.y), min(1.0 - suv.x, 1.0 - suv.y)));
    float spacing = 2.0 * tMax * f / float(N);
    float v = mix(uHazeSun, textureLod(uShaftShadow, suv, log2(max(spacing / texelM, 1.0))).r, inR);
    float w = 2.0 * f;
    vis += v * w;
    wsum += w;
  }
  vis /= max(wsum, 1e-4);
  float c = dot(dir, uSunDir);
  float g = 0.76;
  float ph = (1.0 - g * g) / (4.0 * 3.14159 * pow(1.0 + g * g - 2.0 * g * c, 1.5));
  float trans = exp(-uShaft.x * tMax);
  return sunIlluminance() * uShaft.x * ph * (1.0 - trans) / max(uShaft.x, 1e-9) * (vis - uHazeSun) * uShaft.z;
}
vec3 withShaftsLod(vec3 col, vec3 ro, vec3 dir, float dist) {
  vec3 sh = shaftsLod(ro, dir, dist);
  float ds = dot(sh, vec3(0.2126, 0.7152, 0.0722));
  if (ds >= 0.0) return col + sh;
  float y = max(dot(col, vec3(0.2126, 0.7152, 0.0722)), 1e-7);
  return col * max(1.0 + ds / y, 0.2);
}
void main() {
  vec4 ndc = vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec4 w = uInvViewProj * ndc;
  vec3 d = normalize(w.xyz / w.w - uCamPos);
  vec3 col = skyRadiance(d);
  col += starField(d, uPixelAngle, uTime);
  float c = dot(d, uSunDir);
  float wEdge = 0.00465 * uPixelAngle;
  if (c > SUN_COS - wEdge) {
    // sun disk with limb darkening (Neckel & Labs approximation)
    float mu = sqrt(max(0.0, 1.0 - (1.0 - c) / (1.0 - SUN_COS)));
    // limb darkening I(mu) = mu^a, normalised so the disk carries the full illuminance
    vec3 limb = pow(vec3(mu), vec3(0.397, 0.503, 0.652)) * (1.0 + 0.5 * vec3(0.397, 0.503, 0.652));
    if (uIsMoon > 0.5) {
      // the moon: no limb darkening, darker maria (albedo ~0.07 vs ~0.12 highlands)
      vec3 t1 = normalize(cross(uSunDir, vec3(0.0, 1.0, 0.0)));
      vec2 q = vec2(dot(d - uSunDir, t1), dot(d - uSunDir, cross(t1, uSunDir))) / 0.00465;
      float maria = mnoise(q * 2.2 + 3.1) * 0.6 + mnoise(q * 5.0) * 0.3 + mnoise(q * 11.0) * 0.1;
      limb = vec3(mix(1.15, 0.62, smoothstep(0.45, 0.62, maria)));
    }
    float edge = smoothstep(SUN_COS - wEdge, SUN_COS + wEdge, c);
    col += sunIlluminance() * uSunVis / 6.8e-5 * limb * edge * 1.0;
  }
  if (uCloudsOn > 0.5) {
    // tent-filtered upsample of the low-resolution cloud buffer: removes residual ray-jitter speckle
    // (edge-aware: taps across a cloud edge, i.e. a different transmittance, get little weight)
    vec2 cts = vec2(textureSize(uClouds, 0));
    vec2 ct = (cts.x < float(textureSize(uSkyView, 0).x) * 4.0 && cts.x * 1.5 < 1.0 / max(fwidth(vUv.x), 1e-6) ? 0.6 : 0.0) / cts;
    // a low-resolution buffer is upsampled with Catmull-Rom (sharp: a tent or bilinear filter smears
    // the billows into mush), clamped to the four nearest texels so edges cannot ring
    vec4 cl = ct.x > 0.0 ? cloudBicubic(vUv, cts) : texture(uClouds, vUv);
    vec3 sunPart = col - skyRadiance(d);
    vec4 ci = cirrusLayer(d);
    // (the blue of the sky is scattered mostly below the cirrus, in front of it: the sheet only dims the
    // part beyond it, about a fifth, and the sun's direct beam)
    // (the disc shows through thin cloud only: the march stops at a transmittance near 0.01, and that
    // residual times the disc's radiance would print a speckled sun on the underside of a storm deck)
    vec3 skyCol = skyRadiance(d) * mix(1.0, ci.a, 0.2) + sunPart * cl.a * cl.a * smoothstep(0.015, 0.08, cl.a) * ci.a + ci.rgb;
    // rain and mist lie in front of the clouds only up to the clouds' distance (single scattering:
    // fog(x, s) = x T(s) + Lf (1 - T(s)), so cloud light and sky light are fogged separately)
    float cmd = max(texture(uCloudDepth, vUv).r * 1000.0, 1.0);
    vec3 Lm = applyFog(vec3(0.0), d, cmd);
    col = cl.a * applyFog(skyCol, d, 1e9) + applyFog(cl.rgb, d, cmd) - cl.a * Lm;
    col = rainShafts(col, d);
  } else {
    col = applyFog(col, d, 1e9);
  }
  col += deckGap(d);
  col = withShaftsLod(col, uCamPos, d, 1e9);
  o = vec4(col, 1.0);
}`;

const ENV_FS = SKY_LOOKUP_GLSL + CIRRUS_GLSL + `
in vec2 vUv;
layout(location = 0) out vec4 o;
layout(location = 1) out vec4 oDeck;   // the same without rain and mist: the light entering them
uniform sampler2D uCloudsEnv;  // rgb in-scatter, a transmittance in env parameterisation
uniform float uCloudsOn;
uniform float uSunVis;
uniform vec3 uEnvRrs;          // the sea's water-leaving reflectance (1/sr)
const float PI_ = 3.14159265359;
void main() {
  float phi = (vUv.x - 0.5) * 2.0 * PI_;
  // below the horizon: the mirrored direction (see the end)
  float dy0 = cos(vUv.y * PI_);
  float vUp = min(vUv.y, 1.0 - vUv.y);
  float theta = vUp * PI_;
  vec3 d = vec3(cos(phi) * sin(theta), cos(theta), sin(phi) * sin(theta));
  d = normalize(d + vec3(0.0, 0.002, 0.0));
  vec3 col = skyRadiance(d);
  vec4 ci = cirrusLayer(d);
  col = col * mix(1.0, ci.a, 0.2) + ci.rgb;
  // a soft sun (pre-blurred); the sharp glint is handled analytically by the BRDF
  if (uCloudsOn > 0.5) {
    vec4 cl = texture(uCloudsEnv, vec2(vUv.x, min(vUp, 0.5 - 0.6 / float(textureSize(uCloudsEnv, 0).y))));
    col = col * cl.a + cl.rgb;
  }
  vec3 deck = col;
  col = rainShafts(applyFog(col, d, 1e9), d) + deckGap(d);
  // A ray reflected below the horizon meets the next wave nearby and sees that wave: the sky mirrored
  // by its Fresnel reflectance and its water. The water shader folds such rays upwards itself; this
  // half only feeds the mip chain, whose wide blur on a rough sea must not average in the haze glare
  // that hugs the horizon.
  if (dy0 < 0.0) {
    float Fs = 0.02 + 0.98 * pow(1.0 - min(-dy0 + 0.12, 1.0), 5.0);
    vec3 Ed = sunIlluminance() * uSunVis * max(uSunDir.y, 0.0) + skyIrradiance();
    vec3 sea = Fs * col + (1.0 - Fs) * uEnvRrs * Ed;
    col = sea;
    deck = sea;
  }
  oDeck = vec4(deck, 1.0);
  o = vec4(col, 1.0);
}`;

const IRR_FS = `
out vec4 o;
uniform sampler2D uEnv;
uniform sampler2D uEnvDeck;
const float PI_ = 3.14159265359;
vec2 equirectUv(vec3 d) { return vec2(atan(d.z, d.x) / (2.0 * PI_) + 0.5, acos(clamp(d.y, -1.0, 1.0)) / PI_); }
void main() {
  // cosine-weighted hemisphere integral of the environment (sky + clouds); texel 1: without rain/mist
  bool deck = gl_FragCoord.x > 1.0;
  vec3 E = vec3(0.0);
  for (int i = 0; i < 16; i++) for (int j = 0; j < 6; j++) {
    float phi = (float(i) + 0.5) / 16.0 * 2.0 * PI_;
    float ct = (float(j) + 0.5) / 6.0; // uniform in cos(theta)
    float st = sqrt(1.0 - ct * ct);
    vec3 d = vec3(cos(phi) * st, ct, sin(phi) * st);
    E += (deck ? textureLod(uEnvDeck, equirectUv(d), 4.0).rgb : textureLod(uEnv, equirectUv(d), 4.0).rgb) * ct;
  }
  // E = integral L cos dOmega = 2 pi * mean(L cos) for samples uniform in cos(theta)
  o = vec4(E / float(16 * 6) * 2.0 * PI_, 1.0);
}`;

export class Sky {
  constructor(gl) {
    this.gl = gl;
    this.pSky = new Program(gl, FULLSCREEN_VS, SKY_FS, { label: 'sky' });
    this.pEnv = new Program(gl, FULLSCREEN_VS, ENV_FS, { label: 'env' });
    this.env = new Texture(gl, { w: 512, h: 256, format: 'rgba16f', mips: true, wrap: 'clamp', aniso: 16 });
    this.envDeck = new Texture(gl, { w: 512, h: 256, format: 'rgba16f', mips: true, wrap: 'clamp' });
    this.envTarget = new Target(gl, [this.env, this.envDeck]);
    // wrap in azimuth (seam at 180 deg), clamp in elevation
    gl.bindTexture(gl.TEXTURE_2D, this.env.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    this.pIrr = new Program(gl, FULLSCREEN_VS, IRR_FS, { label: 'irradiance' });
    this.irradiance = new Texture(gl, { w: 2, h: 1, format: 'rgba16f', filter: 'nearest' });
    this.irrTarget = new Target(gl, [this.irradiance]);
  }
  renderEnv(uniforms) {
    fullscreen(this.gl, this.pEnv, uniforms, this.envTarget);
    this.env.genMips();
    this.envDeck.genMips();
    fullscreen(this.gl, this.pIrr, { uEnv: this.env, uEnvDeck: this.envDeck }, this.irrTarget);
  }
  drawBackground(uniforms) {
    const gl = this.gl;
    this.pSky.use(uniforms);
    bindEmpty(gl);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
