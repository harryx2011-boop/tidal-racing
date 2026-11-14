// The lit mesh pass. Objects are lit by the same sun, sky, haze and fog as the sea, so they sit
// in the scene. Vertex format and material ids: see geo.js.
//
// Every material is procedural and laid out in object space (vObj, vObjN), so a pattern stays
// glued to the model whatever its pose. Boats additionally get a baked ambient-occlusion map and
// the sun shadow map of shadow.js.
import { Program, Texture, Target } from '../gl.js';
import { SKY_LOOKUP_GLSL } from '../sky/atmosphere.js';

const VS = `
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aN;
layout(location = 2) in vec3 aCol;
layout(location = 3) in vec3 aMat;
layout(location = 4) in vec2 aUV;
uniform mat4 uModel;
uniform mat4 uViewProj;
uniform vec3 uCamPos;
uniform float uFloat;        // 1: ride the waves at the model origin (buoys); 0: the model matrix is the pose
uniform sampler2D uDisp[3];
uniform float uSize[4];
uniform float uTexel[4];
out vec3 vWorld;
out vec3 vN;
out vec3 vCol;
out vec3 vMat;
out vec3 vObj;   // model-space position
out vec3 vObjN;  // model-space normal
out vec2 vUV;
vec3 dispAt(vec2 xz) {
  // (waves shorter than ~2 m do not move a 2 m drum)
  vec3 D = textureLod(uDisp[0], xz / uSize[0], max(1.0 - log2(uTexel[0]), 0.0)).xyz;
  D += textureLod(uDisp[1], xz / uSize[1], max(1.0 - log2(uTexel[1]), 0.0)).xyz;
  D += textureLod(uDisp[2], xz / uSize[2], max(1.0 - log2(uTexel[2]), 0.0)).xyz;
  return D;
}
void main() {
  vec3 P = (uModel * vec4(aPos, 1.0)).xyz;
  vec3 N = mat3(uModel) * aN;
  if (uFloat > 0.5) {
    vec2 a = uModel[3].xz;
    vec3 D = dispAt(a);
    const float e = 1.5;
    float hx = dispAt(a + vec2(e, 0.0)).y - dispAt(a - vec2(e, 0.0)).y;
    float hz = dispAt(a + vec2(0.0, e)).y - dispAt(a - vec2(0.0, e)).y;
    vec3 up = normalize(vec3(-hx / (2.0 * e) * 0.6, 1.0, -hz / (2.0 * e) * 0.6));
    vec3 X = normalize(cross(up, vec3(0.0, 0.0, 1.0)));
    vec3 Z = cross(X, up);
    vec3 l = P - uModel[3].xyz;
    P = vec3(a.x, uModel[3].y, a.y) + D + l.x * X + l.y * up + l.z * Z;
    N = N.x * X + N.y * up + N.z * Z;
  }
  float dr = length(P.xz - uCamPos.xz);
  P.y -= dr * dr / (2.0 * 6360000.0);
  vWorld = P; vN = N; vCol = aCol; vMat = aMat; vObj = aPos; vObjN = aN; vUV = aUV;
  gl_Position = uViewProj * vec4(P, 1.0);
}`;

const FS = SKY_LOOKUP_GLSL + `
in vec3 vWorld;
in vec3 vN;
in vec3 vCol;
in vec3 vMat;
in vec3 vObj;
in vec3 vObjN;
in vec2 vUV;
out vec4 oColor;
uniform vec3 uCamPos;
uniform sampler2D uEnv;
uniform vec3 uTint;          // accent colour (the livery colour on boats)
uniform float uGlow;
uniform float uAlpha;
uniform float uFloat;
uniform vec3 uFlash;
uniform vec3 uRrs;           // water-leaving reflectance: the sea colour the hull reflects
uniform float uLamp;         // boat lights: 0 in full sun, 1 in the dark
uniform vec3 uLivery;        // x: on, y: stripe style 0..3, z: race number 0..99
uniform sampler2D uTexture;
uniform float uHasTex;
// boat shadow map (shadow.js): world -> light clip, depth in 0..1 away from the sun
uniform sampler2D uBoatShadow;
uniform mat4 uBoatShadowVP;
uniform vec4 uBoatShadowInfo;   // x: on, y: used fraction of the map, z: 1/used texels, w: taps
uniform float uBoatShadowDepth; // depth units per metre
// top-down height map of the mesh in object space (ambient occlusion), baked once per mesh
uniform sampler2D uAoTex;
uniform vec4 uAoRect;           // x0, z0, 1/width, 1/depth
uniform float uAoOn;
uniform float uGlassMode;       // 0: everything opaque; 1: all but glass; 2: only glass, blended over the rest
const float M_PI = 3.14159265359;
vec2 equirectUv(vec3 d) { return vec2(atan(d.z, d.x) / (2.0 * M_PI) + 0.5, acos(clamp(d.y, -1.0, 1.0)) / M_PI); }

float h11(float x) { return fract(sin(x * 127.1) * 43758.5453); }
float h13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h13(i), h13(i + vec3(1, 0, 0)), f.x), mix(h13(i + vec3(0, 1, 0)), h13(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h13(i + vec3(0, 0, 1)), h13(i + vec3(1, 0, 1)), f.x), mix(h13(i + vec3(0, 1, 1)), h13(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
// a pattern of spatial frequency f (1/m) averages out where one pixel spans more than ~a third of its period
float fadeOut(float pf, float f) { return 1.0 - smoothstep(0.3, 0.8, pf * f); }

// ---- shadow and occlusion ----
float boatShadow(vec3 P, vec3 N, float ndl) {
  if (uBoatShadowInfo.x < 0.5) return 1.0;
  // push the lookup off the surface along its normal: a texel is ~1 cm, the offset must grow with the slope
  vec3 Po = P + N * (0.012 + 0.03 * (1.0 - ndl));
  vec3 s = (uBoatShadowVP * vec4(Po, 1.0)).xyz * 0.5 + 0.5;
  if (any(lessThan(s.xy, vec2(0.0))) || any(greaterThan(s.xy, vec2(1.0))) || s.z > 1.0) return 1.0;
  float bias = 0.012 * uBoatShadowDepth;
  float rot = 6.2831853 * ign(gl_FragCoord.xy);
  int n = int(uBoatShadowInfo.w);
  float lit = 0.0;
  for (int i = 0; i < 12; i++) {
    if (i >= n) break;
    float r = sqrt((float(i) + 0.5) / float(n));
    float a = 2.3999632 * float(i) + rot;
    vec2 o = vec2(cos(a), sin(a)) * r * 2.0 * uBoatShadowInfo.z;
    lit += step(s.z - bias, texture(uBoatShadow, (s.xy + o) * uBoatShadowInfo.y).r);
  }
  return lit / float(n);
}
float boatAO(vec3 p, vec3 n) {
  if (uAoOn < 0.5) return 1.0;
  vec2 nd = length(n.xz) > 1e-3 ? normalize(n.xz) : vec2(0.0);
  float rot = 6.2831853 * ign(gl_FragCoord.xy + 17.0);
  float occ = 0.0, wsum = 0.0;
  for (int i = 0; i < 8; i++) {
    float a = rot + float(i) * 0.785398;
    float r = 0.07 + 0.065 * float(i);
    vec2 d = vec2(cos(a), sin(a));
    float h = textureLod(uAoTex, (p.xz + d * r - uAoRect.xy) * uAoRect.zw, 0.0).r;
    float rise = h - p.y - 0.04;
    float o = rise > 0.0 ? rise / sqrt(rise * rise + r * r) : 0.0;
    // a wall only sees what lies on its own side
    float w = mix(1.0, smoothstep(0.25, 0.85, dot(d, nd)), 1.0 - abs(n.y));
    occ += o * w; wsum += w;
  }
  float ao = 1.0 - 0.85 * occ / max(wsum, 1e-3);
  // directly under another surface (below a dash, inside a locker)
  float over = textureLod(uAoTex, (p.xz - uAoRect.xy) * uAoRect.zw, 0.0).r - p.y;
  return ao * mix(1.0, 0.5, smoothstep(0.15, 0.5, over) * smoothstep(-0.5, 0.2, n.y));
}

// ---- race number: seven-segment digits as distance fields (a bold, racing look) ----
float segBox(vec2 p, vec2 c, vec2 h) { vec2 d = abs(p - c) - h; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
// p in digit units: the digit spans x -0.5..0.5, y -1..1
float digitSdf(vec2 p, int d) {
  const int MASK[10] = int[10](63, 6, 91, 79, 102, 109, 125, 7, 127, 111);
  int m = MASK[d];
  float s = 9.0;
  const float t = 0.15;
  if ((m & 1) != 0)  s = min(s, segBox(p, vec2(0.0, 0.9), vec2(0.36, t)));
  if ((m & 2) != 0)  s = min(s, segBox(p, vec2(0.42, 0.45), vec2(t, 0.4)));
  if ((m & 4) != 0)  s = min(s, segBox(p, vec2(0.42, -0.45), vec2(t, 0.4)));
  if ((m & 8) != 0)  s = min(s, segBox(p, vec2(0.0, -0.9), vec2(0.36, t)));
  if ((m & 16) != 0) s = min(s, segBox(p, vec2(-0.42, -0.45), vec2(t, 0.4)));
  if ((m & 32) != 0) s = min(s, segBox(p, vec2(-0.42, 0.45), vec2(t, 0.4)));
  if ((m & 64) != 0) s = min(s, segBox(p, vec2(0.0, 0.0), vec2(0.36, t)));
  return s - 0.03;
}
// q: position on the hull side in digit units relative to the number's centre
float numberSdf(vec2 q, int num) {
  if (num < 10) return digitSdf(q, num);
  const float pitch = 1.3;
  float s = digitSdf(q - vec2(-0.5 * pitch, 0.0), num / 10);
  return min(s, digitSdf(q - vec2(0.5 * pitch, 0.0), num - (num / 10) * 10));
}

// The hull side look: accent paint for stripe 0, white with accent stripes otherwise, and a race
// number. Laid out in object space (x forward, y up) from the sheer line, so it follows the hull.
vec3 livery(vec3 base, vec3 accent, float pf) {
  float x = vObj.x, y = vObj.y;
  float sgn = vObj.z < 0.0 ? -1.0 : 1.0;
  float aa = max(pf * 1.2, 0.002);
  // the sheer line of the 9 m hull: a slight dip amidships, rising to the bow
  float sheer = 0.80 - (x < 0.5 ? 0.10 * sin(3.14159 * (x + 4.2) / 4.7) : 0.0) + 0.40 * pow(max(x / 4.8, 0.0), 2.1);
  int style = int(uLivery.y + 0.5);
  vec3 col = accent;
  if (style > 0) {
    col = vec3(0.86, 0.87, 0.88);
    float st = 0.0;
    if (style == 1) {
      // a broad band under the sheer
      st = smoothstep(sheer - 0.17 - aa, sheer - 0.17 + aa, y);
    } else if (style == 2) {
      // a wide and a thin stripe, running parallel to the sheer
      float d = sheer - y;
      st = max(smoothstep(0.14 - aa, 0.14 + aa, d) * (1.0 - smoothstep(0.26 - aa, 0.26 + aa, d)),
               smoothstep(0.34 - aa, 0.34 + aa, d) * (1.0 - smoothstep(0.38 - aa, 0.38 + aa, d)));
    } else {
      // a blade that rises from the transom to the bow and narrows as it goes
      float t = smoothstep(-4.2, 4.6, x);
      float c = mix(0.22, sheer - 0.14, t), hw = mix(0.17, 0.03, t);
      st = 1.0 - smoothstep(hw - aa, hw + aa, abs(y - c));
    }
    col = mix(col, accent, st);
  }
  // the race number, reading forward on both sides
  int num = int(uLivery.z + 0.5);
  if (num >= 0) {
    const float unit = 0.19;   // metres per glyph unit: a number is 0.38 m tall
    vec2 q = vec2((x - 1.5) * sgn, y - (sheer - 0.3)) / unit;
    float s = numberSdf(q, min(num, 99));
    float m = 1.0 - smoothstep(-aa / unit, aa / unit, s);
    // light digits on dark paint, dark digits on light
    vec3 ink = lum(col) < 0.5 ? vec3(0.92) : accent * 0.4;
    col = mix(col, ink, m);
  }
  return col;
}

// ---- reflections ----
// A ray going up sees the sky and clouds. A ray going down sees the sea: its own colour (the
// light it receives times the water's reflectance) and, at a grazing angle, the sky reflected in it.
vec3 reflectEnv(vec3 R, float lod, vec3 seaL) {
  float below = smoothstep(0.03, -0.1, R.y);
  vec3 up = vec3(R.x, max(abs(R.y), 0.01), R.z);
  vec3 sky = textureLod(uEnv, equirectUv(normalize(up)), lod).rgb;
  float Fs = 0.02 + 0.98 * pow(1.0 - clamp(abs(R.y) + 0.08, 0.0, 1.0), 5.0);
  return mix(sky, sky * Fs + seaL * (1.0 - Fs), below);
}
float ggx(float nh, float a) { float a2 = a * a; float d = nh * nh * (a2 - 1.0) + 1.0; return a2 / (M_PI * d * d); }

void main() {
  vec3 toCam = uCamPos - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  vec3 N = normalize(vN);
  vec3 On = normalize(vObjN);
  if (dot(N, V) < 0.0) { N = -N; On = -On; }
  float pf = length(fwidth(vObj));   // object-space size of a pixel: patterns fade out below it
  int mid = clamp(int(vMat.x + 0.5), 0, 9);
  if ((uGlassMode > 0.5 && uGlassMode < 1.5 && mid == 4) || (uGlassMode > 1.5 && mid != 4)) discard;
  vec3 sunE = sunIlluminance(), skyE = skyIrradiance();
  vec3 L = uSunDir;

  // surface description: albedo, two specular lobes (a base and a clear coat), emission
  vec3 albedo = mix(vCol, uTint, vMat.y);
  vec3 F0a = vec3(0.04), F0b = vec3(0.04);
  float ra = 0.5, rb = 0.5, wb = 0.0;
  vec3 emis = vec3(0.0);
  vec3 Nm = N;
  float sheen = 0.0;
  if (mid == 0 || mid == 1) {
    // gelcoat and paint: a diffuse base under a glossy clear coat with a faint orange peel
    if (mid == 1 && uLivery.x > 0.5 && vMat.y > 0.5 && abs(vObjN.z) > 0.35 && abs(vObj.z) > 0.25) albedo = livery(vCol, uTint, pf);
    float pk = fadeOut(pf, 70.0);
    Nm = normalize(N + (vec3(vnoise(vObj * 28.0), vnoise(vObj * 28.0 + 17.3), vnoise(vObj * 28.0 + 31.7)) - 0.5) * 0.03 * pk);
    ra = 0.42; rb = 0.07; wb = 1.0;
  } else if (mid == 2) {
    // teak: planks along the boat with dark caulked seams and staggered butt joints
    float across, along;
    if (abs(On.y) > 0.55) { across = vObj.z; along = vObj.x; }
    else if (abs(On.z) > abs(On.x)) { across = vObj.y; along = vObj.x; }
    else { across = vObj.z; along = vObj.y; }
    const float W = 0.065, LEN = 0.95;
    float row = floor(across / W);
    float dz = min(fract(across / W), 1.0 - fract(across / W)) * W;
    float al = along + h11(row) * 1.7;
    float cell = floor(al / LEN);
    float dx = min(fract(al / LEN), 1.0 - fract(al / LEN)) * LEN;
    float aa = max(pf * 1.2, 0.0015);
    float seam = max(1.0 - smoothstep(0.0022, 0.0022 + aa, dz), 1.0 - smoothstep(0.0022, 0.0022 + aa, dx));
    float fg = fadeOut(pf, 85.0);
    float grain = vnoise(vec3(al * 2.5, across * 85.0, row * 3.1)) * fg + 0.5 * (1.0 - fg);
    vec3 tone = mix(vCol, vec3(0.5, 0.3, 0.14) * clamp(lum(vCol) * 1.8, 0.5, 1.2), 0.7);
    albedo = tone * (0.82 + 0.3 * h11(row + cell * 13.1)) * (0.86 + 0.28 * grain);
    albedo *= mix(1.0, 0.1, seam);
    ra = 0.55; rb = 0.22; wb = 0.6 * (1.0 - seam);
  } else if (mid == 3) {
    // upholstery: matte, with piped panel seams and a soft quilted puff between them
    vec2 uv2 = abs(On.y) > 0.55 ? vObj.xz : (abs(On.z) > abs(On.x) ? vObj.xy : vObj.zy);
    const vec2 P = vec2(0.44, 0.36);
    vec2 f = fract(uv2 / P);
    vec2 dd = min(f, 1.0 - f) * P;
    float aa = max(pf * 1.2, 0.002);
    float seam = 1.0 - smoothstep(0.003, 0.003 + aa, min(dd.x, dd.y));
    float puff = smoothstep(0.0, 0.07, dd.x) * smoothstep(0.0, 0.07, dd.y);
    float fg = fadeOut(pf, 140.0);
    float grain = vnoise(vObj * 140.0) * fg + 0.5 * (1.0 - fg);
    // (subtle: from the chase camera heavy seams read as a grid drawn on the cushions)
    albedo *= (0.92 + 0.08 * puff) * (0.94 + 0.12 * grain) * mix(1.0, 0.86, seam);
    ra = 0.85; sheen = 0.35;
  } else if (mid == 4) {
    // tinted glass: nearly black, a strong clean reflection
    albedo = vCol * 0.08;
    F0a = vec3(0.07); ra = 0.03;
  } else if (mid == 5) {
    // brushed metal: streaks along the part's length, coloured reflections
    float fg = fadeOut(pf, 260.0);
    float streak = vnoise(vec3(vObj.x * 2.5, vObj.y * 260.0, vObj.z * 260.0)) * fg + 0.5 * (1.0 - fg);
    F0a = clamp(vCol * 0.95 + 0.03, 0.0, 1.0) * (0.88 + 0.24 * streak);
    albedo = vCol * 0.08;
    ra = 0.2 + 0.12 * streak;
  } else if (mid == 6) {
    // non-skid: a stipple of small raised dots; far away it averages to a slightly darker tone
    vec2 uv2 = abs(On.y) > 0.55 ? vObj.xz : (abs(On.z) > abs(On.x) ? vObj.xy : vObj.zy);
    const float C = 0.02;
    vec2 g = uv2 / C, gi = floor(g), gf = fract(g) - 0.5;
    gf += (vec2(h11(gi.x * 7.0 + gi.y * 13.0), h11(gi.x * 3.0 - gi.y * 11.0 + 5.0)) - 0.5) * 0.3;
    float dotm = 1.0 - smoothstep(0.26, 0.4, length(gf));
    albedo *= mix(0.86, mix(1.0, 0.72, dotm), fadeOut(pf, 1.0 / C));
    ra = 0.8;
  } else if (mid == 7) {
    albedo = vCol * 0.8; ra = 0.7;
  } else if (mid == 8) {
    emis = albedo * (vMat.z > 0.0 ? vMat.z : 1.0);
    ra = 0.15;
  } else {
    if (uHasTex > 0.5) albedo = texture(uTexture, vUV).rgb;
    ra = 0.7;
  }

  float nl = max(dot(Nm, L), 0.0);
  vec2 suv = (vWorld.xz - uShaftRect.xy) * uShaftRect.zw;
  float sunVis = mix(uHazeSun, texture(uShaftShadow, suv).r, smoothstep(0.0, 0.04, min(min(suv.x, suv.y), min(1.0 - suv.x, 1.0 - suv.y))));
  float sh = boatShadow(vWorld, N, nl);
  float ao = boatAO(vObj, On);
  float specOcc = mix(1.0, ao, 0.8);

  // what the sea sends back up: its reflectance times the light that falls on it
  vec3 seaL = uRrs * (sunE * sunVis * max(L.y, 0.0) + skyE);
  // light: the sun (shadowed), the sky from above, the sea and the white wake from below
  vec3 groundE = M_PI * seaL * 1.5 + skyE * 0.06;
  float up = Nm.y * 0.5 + 0.5;
  vec3 Eamb = (skyE * up + groundE * (1.0 - up)) * ao;
  vec3 sunLight = sunE * sunVis * sh * nl;
  vec3 Ed = sunLight + Eamb + uFlash * 0.3;

  float nv = clamp(dot(Nm, V), 0.0, 1.0);
  vec3 R = reflect(-V, Nm);
  vec3 H = normalize(L + V);
  float nh = max(dot(Nm, H), 0.0), vh = max(dot(V, H), 0.0);
  float fw = pow(1.0 - nv, 5.0);
  vec3 Fa = F0a + (max(vec3(1.0 - ra), F0a) - F0a) * fw;
  vec3 Fb = F0b + (max(vec3(1.0 - rb), F0b) - F0b) * fw;
  vec3 spec = reflectEnv(R, ra * 6.5, seaL) * Fa * specOcc;
  float aA = max(ra * ra, 0.012), aB = max(rb * rb, 0.012);
  float fh = pow(1.0 - vh, 5.0);
  float vis = 0.25 / max(vh * vh, 0.05);
  vec3 sunSpec = sunLight * ggx(nh, aA) * (F0a + (1.0 - F0a) * fh) * vis;
  float kd = 1.0 - Fa.g;
  if (wb > 0.0) {
    // clear coat over the base: its own sharp reflection and highlight; the base shows through it
    spec += wb * reflectEnv(R, rb * 6.5, seaL) * Fb * specOcc;
    sunSpec += wb * sunLight * ggx(nh, aB) * (F0b + (1.0 - F0b) * fh) * vis;
    kd *= 1.0 - wb * Fb.g;
  }
  vec3 col = albedo * kd * Ed / M_PI + spec + sunSpec;
  // soft fabric catches light at grazing angles
  col += albedo * sheen * pow(1.0 - nv, 3.0) * (skyE * up * ao / M_PI);
  // marks glow a few times brighter than a white card in the same light, so they read through haze
  float amb = dot(skyE + sunE * max(L.y, 0.0), vec3(0.3333)) / M_PI;
  col += albedo * vMat.z * uGlow * (amb * 3.0 + 2e-4);
  // lamps: a little lit in daylight, much brighter than their surroundings when it is dark
  float lampE = uFloat > 0.5 ? amb * 3.0 + 2e-4 : amb * (0.6 + 12.0 * uLamp * uLamp) + 4e-4 * uLamp * uLamp;
  col += emis * lampE;
  // glass lets a good part of what is behind it through (a premultiplied blend), more at a steep view
  float aG = (uGlassMode > 1.5) ? 0.5 + 0.5 * Fa.g : 1.0;
  vec3 aL, aT;
  aerial(-V, dist * 0.001, aL, aT);
  col = col * aT + aL * aG;
  col = applyFog(col, -V, dist) - applyFog(vec3(0.0), -V, dist) * (1.0 - aG);
  oColor = vec4(col, aG * uAlpha);
}`;

// Ambient occlusion for a mesh drawn in its own space: a top-down map of the highest surface above
// each point, baked once. A point is hidden from the sky by higher surfaces near it, so the
// cockpit floor, seat bases and the creases under rails darken, at no per-frame cost.
const AO_VS = `
layout(location = 0) in vec3 aPos;
uniform vec4 uRect;
uniform vec2 uY;
out float vY;
void main() {
  vec2 uv = (aPos.xz - uRect.xy) * uRect.zw;
  vY = aPos.y;
  gl_Position = vec4(uv * 2.0 - 1.0, 1.0 - 2.0 * clamp((aPos.y - uY.x) / (uY.y - uY.x), 0.0, 1.0), 1.0);
}`;
const AO_FS = `
in float vY;
out vec4 oColor;
void main() { oColor = vec4(vY, 0.0, 0.0, 1.0); }`;
// object-space window of the map (x0, z0, 1/width, 1/depth), height range, texels
const AO_RECT = [-6.5, -2.0, 1 / 13, 1 / 4], AO_Y = [-3, 4], AO_W = 512, AO_H = 160;

export class MeshPass {
  constructor(gl) {
    this.gl = gl;
    this.prog = new Program(gl, VS, FS, { label: 'mesh' });
    this.aoProg = null;
    this.scene = null;
    this.lamp = 0;   // how much the boats' lights show: 0 in full sun, 1 in the dark (lights.js)
  }
  // scene: the frame's shared lighting uniforms (the water pass's uniform set)
  begin(scene) {
    this.scene = scene;
    this.prog.use(scene);
  }
  bakeAo(mesh) {
    const gl = this.gl;
    mesh.ao = null;
    const fbo = gl.getParameter(gl.FRAMEBUFFER_BINDING), vp = gl.getParameter(gl.VIEWPORT);
    const depthOn = gl.isEnabled(gl.DEPTH_TEST), depthFn = gl.getParameter(gl.DEPTH_FUNC);
    if (!this.aoProg) this.aoProg = new Program(gl, AO_VS, AO_FS, { label: 'mesh-ao' });
    const tex = new Texture(gl, { w: AO_W, h: AO_H, format: 'r16f', filter: 'nearest' });
    const target = new Target(gl, [tex], { depth: true });
    target.bind();
    gl.clearColor(-10, 0, 0, 1);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS);
    this.aoProg.use({ uRect: AO_RECT, uY: AO_Y });
    gl.bindVertexArray(mesh.vao);
    gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(vp[0], vp[1], vp[2], vp[3]);
    if (!depthOn) gl.disable(gl.DEPTH_TEST);
    gl.depthFunc(depthFn);
    target.dispose();   // the texture stays
    mesh.ao = tex;
    // creating the texture bound it on whatever unit was active: put the scene's textures back
    this.prog.use(this.scene || {});
  }
  // livery: { color, stripe, number } (boats); texture: base colour for MAT.TEXTURED surfaces;
  // ao: use the mesh's baked occlusion (default: when a livery is given, i.e. for boats)
  draw(mesh, model, { tint = [1, 1, 1], glow = 0, alpha = 1, float = 0, livery = null, texture = null, ao = !!livery } = {}) {
    const gl = this.gl;
    const p = this.prog;
    if (ao && mesh.ao === undefined) this.bakeAo(mesh);
    p.use();
    p.set('uModel', model); p.set('uTint', livery ? livery.color : tint); p.set('uGlow', glow); p.set('uAlpha', alpha); p.set('uFloat', float);
    p.set('uLamp', this.lamp);
    p.set('uLivery', livery ? [1, livery.stripe, livery.number] : [0, 0, -1]);
    p.set('uHasTex', texture ? 1 : 0);
    if (texture) p.set('uTexture', texture);
    const useAo = ao && mesh.ao;
    p.set('uAoOn', useAo ? 1 : 0);
    if (useAo) { p.set('uAoTex', mesh.ao); p.set('uAoRect', AO_RECT); }
    if (alpha < 1) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); }
    gl.bindVertexArray(mesh.vao);
    // boats: the glass is drawn last, blended, so the cockpit shows through the windscreen
    const split = ao && !float && alpha >= 1;
    p.set('uGlassMode', split ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    if (split) {
      p.set('uGlassMode', 2);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      p.set('uGlassMode', 0);
    }
    gl.bindVertexArray(null);
    if (alpha < 1) gl.disable(gl.BLEND);
  }
}
