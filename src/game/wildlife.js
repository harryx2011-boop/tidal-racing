// Wildlife and small detail: seabirds (flocks that wheel over the course and scatter from a fast boat,
// birds perched on marks, beacons, the breakwater, the lighthouse and the boats that take off when a
// boat nears, rafts of birds on the water), a pod of dolphins and jumping fish with splashes, flotsam,
// people on the boats and the breakwater, and flags that fly the weather's wind.
//
// Where things are is a pure function of the course id and sea time (app.time; a race starts at 60), so
// every player sees the same flocks and the same dolphins. Only the reaction to the boats (a flock
// scattering, a perched bird taking off, the wing phase) is local: it depends on boat positions from
// game.renderBoats() and on this client's frame times, and is cosmetic.
//
// Cost (all unmeasured; nothing here has run on a GPU):
//   birds   one instanced draw, 172 triangles per bird, at most 400 instances (about 100 flying and 60
//           perched at full level: ~46k triangles), flapping and gliding in the vertex shader. Riding
//           birds read the wave textures at 15 taps a vertex; the rest read none.
//   mesh    a draw each for: the dolphins in view (206 tris), fish (51), flotsam within 300 m (kelp 216,
//           log 136, crate 72, pot marker 93), crews on the boats within 550 m (156 per person), flags within
//           450 m (about 170 each). Typically fewer than 30 draws and 6k triangles.
//   fx      one instanced draw of at most 320 splash particles (billboards and rings).
// Everything scales with app.fx.spray (0 draws and simulates nothing), is culled by distance and by
// view, and allocates nothing per frame (renderBoats() returns a short array each call, as in
// boatspray.js; it is called once per frame).
import { Program } from '../gl.js';
import { SKY_LOOKUP_GLSL } from '../sky/atmosphere.js';
import { smoothPath, rng } from './models/structures.js';
import {
  birdBuffers, dolphinGeo, fishGeo, kelpGeo, logGeo, crateGeo, potFloatGeo, crewGeo, WAVE_FRAMES,
  flagCloth, flagStatic, FLAG_CLOTH_VERTS,
} from './models/wildlife.js';

const SEA_T0 = 60;
const TAU = Math.PI * 2;
const MAXB = 400, IF = 16;            // bird instances, floats per instance
const MAXFX = 320, FXF = 12;          // splash particles, floats per particle
const BIRD_RANGE = 1500;              // birds beyond this are not drawn
const G = 9.81;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const sst = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const angDiff = (a, b) => { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
const hashStr = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
// integer hash of two integers to 0..1: exact on every machine, no allocation
function ih(a, b) {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) + 0x7f4a7c15, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

// ---- the bird shader -------------------------------------------------------------------------
// One static mesh (birdBuffers) deformed here: the wing line is integrated station by station, each
// segment at its own angle (a bent glide pose plus a flap whose phase lags toward the tip), folded
// along the flank when the bird stands, the neck and head raised, the legs shown. Instance data:
//   aA: position (world; local to a boat in mode 2), size   aB: yaw, pitch, roll, species
//   aC: flap phase, flap amplitude (rad), fold 0..1, mode   aE: boat anchor x, z, foot, yaw
// mode: 0 world position; 0..1 ride the waves at the bird's own spot by that weight (it floats, or
// it perches on something that does); 2 anchored to a floating boat (aA is in the boat's frame, so a bird
// on a mast heaves and leans with the boat as the boat's own mesh does).
const BIRD_VS = `
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aN;
layout(location = 2) in vec4 aTag;
layout(location = 3) in vec4 aA;
layout(location = 4) in vec4 aB;
layout(location = 5) in vec4 aC;
layout(location = 6) in vec4 aE;
uniform mat4 uViewProj;
uniform vec3 uCamPos;
uniform sampler2D uDisp[3];
uniform float uSize[4];
uniform float uTexel[4];
uniform vec4 uSp[4];    // span, body length, wing chord, neck length multipliers
uniform vec4 uSp2[4];   // tail length
out vec3 vWorld;
out vec3 vN;
out vec4 vTag;
out vec3 vObjN;
out float vSp;
vec3 dispAt(vec2 xz) {
  vec3 D = textureLod(uDisp[0], xz / uSize[0], max(1.0 - log2(uTexel[0]), 0.0)).xyz;
  D += textureLod(uDisp[1], xz / uSize[1], max(1.0 - log2(uTexel[1]), 0.0)).xyz;
  D += textureLod(uDisp[2], xz / uSize[2], max(1.0 - log2(uTexel[2]), 0.0)).xyz;
  return D;
}
const float SS[7] = float[7](0.0, 0.2, 0.42, 0.62, 0.8, 0.93, 1.0);
// angle of the wing line above horizontal at span fraction s: a gull's M (arm up, hand down) when gliding, straighter when flapping
float wingAngle(float s, float amp, float ph) {
  float bend = mix(0.21, -0.16, smoothstep(0.3, 0.5, s)) * (1.0 - min(amp * 1.4, 0.85));
  return bend + amp * sin(ph - 1.5 * s) * (0.4 + 0.6 * s);
}
void main() {
  int sp = int(aB.w + 0.5);
  vec4 spec = uSp[sp], spec2 = uSp2[sp];
  float part = aTag.x, s = aTag.y, surf = aTag.z, chord = aTag.w;
  float amp = aC.y, ph = aC.x, fold = aC.z, mode = aC.w;
  vec3 p = aPos, n = aN;
  if (part < 0.5) {
    p.x *= spec.y;
  } else if (part < 1.5) {
    float side = p.z < 0.0 ? -1.0 : 1.0;
    float hs = 0.65 * spec.x;
    vec2 yz = vec2(0.0);
    for (int k = 0; k < 6; k++) {
      float s0 = SS[k];
      if (s0 >= s - 1e-4) break;
      float s1 = SS[k + 1];
      float a = wingAngle(0.5 * (s0 + s1), amp, ph);
      yz += (s1 - s0) * vec2(sin(a), cos(a));
    }
    float aEnd = wingAngle(s, amp, ph);
    float cl = aN.x * spec.z;
    vec3 sp3 = vec3(p.x * spec.z - 0.06 * s * s * sin(aEnd), yz.x * hs + 0.004 * surf, side * yz.y * hs);
    vec3 sn3 = normalize(vec3(0.0, cos(aEnd), -sin(aEnd) * side)) * surf;
    // folded along the flank, the tip trailing past the tail
    vec3 fp = vec3(0.11 - 0.55 * s - chord * cl * 0.8, 0.065 - 0.03 * s + 0.02 * (1.0 - chord) + 0.004 * surf, side * (0.085 - 0.04 * s));
    vec3 fn = normalize(vec3(0.0, 1.0, 0.35 * side)) * surf;
    p = mix(sp3, fp, fold);
    n = normalize(mix(sn3, fn, fold));
  } else if (part < 2.5) {
    p.x = -0.28 + (p.x + 0.28) * spec2.x;
  } else if (part < 4.5) {
    vec3 piv = vec3(0.27, 0.02, 0.0);
    vec3 r = p - piv;
    r.x *= spec.w;
    float a = fold * 0.85, c = cos(a), sa = sin(a);
    r = vec3(r.x * c - r.y * sa, r.x * sa + r.y * c, r.z);
    n = vec3(n.x * c - n.y * sa, n.x * sa + n.y * c, n.z);
    p = piv + r;
  } else {
    p.y *= fold;
  }
  float yaw = aB.x + (mode > 1.5 ? aE.w : 0.0), pit = aB.y, rol = aB.z;
  float cy = cos(yaw), sy = sin(yaw), cp = cos(pit), sp_ = sin(pit), cr = cos(rol), sr = sin(rol);
  vec3 f0 = vec3(cy, 0.0, sy), r0 = vec3(-sy, 0.0, cy), u0 = vec3(0.0, 1.0, 0.0);
  vec3 f1 = f0 * cp + u0 * sp_, u1 = u0 * cp - f0 * sp_;
  vec3 r2 = r0 * cr - u1 * sr, u2 = u1 * cr + r0 * sr;
  // where the bird is, and the frame the sea leans it into
  vec3 X = vec3(1.0, 0.0, 0.0), Y = vec3(0.0, 1.0, 0.0), Z = vec3(0.0, 0.0, 1.0);
  vec3 org;
  if (mode > 1.5) {
    vec2 a = aE.xy;
    float e = aE.z > 0.0 ? aE.z * 0.5 : 1.5;
    float hx = dispAt(a + vec2(e, 0.0)).y - dispAt(a - vec2(e, 0.0)).y;
    float hz = dispAt(a + vec2(0.0, e)).y - dispAt(a - vec2(0.0, e)).y;
    Y = normalize(vec3(-hx / (2.0 * e) * 0.6, 1.0, -hz / (2.0 * e) * 0.6));
    X = normalize(cross(Y, vec3(0.0, 0.0, 1.0)));
    Z = cross(X, Y);
    float ca = cos(aE.w), sa = sin(aE.w);
    vec3 lo = vec3(ca * aA.x - sa * aA.z, aA.y, sa * aA.x + ca * aA.z);
    org = vec3(a.x, 0.0, a.y) + dispAt(a) + lo.x * X + lo.y * Y + lo.z * Z;
  } else {
    org = aA.xyz;
    float rw = clamp(mode, 0.0, 1.0);
    if (rw > 0.002) {
      vec2 a = aA.xz;
      const float e = 1.5;
      float hx = dispAt(a + vec2(e, 0.0)).y - dispAt(a - vec2(e, 0.0)).y;
      float hz = dispAt(a + vec2(0.0, e)).y - dispAt(a - vec2(0.0, e)).y;
      Y = normalize(mix(vec3(0.0, 1.0, 0.0), normalize(vec3(-hx / (2.0 * e) * 0.6, 1.0, -hz / (2.0 * e) * 0.6)), rw));
      X = normalize(cross(Y, vec3(0.0, 0.0, 1.0)));
      Z = cross(X, Y);
      org += dispAt(a) * rw;
    }
  }
  // far birds are kept at least a couple of pixels wide so a flock stays visible as a flock
  float sc = aA.w * max(1.0, length(org - uCamPos) * 0.0012);
  // (f1 carries the pitch, u2 and r2 the roll)
  vec3 lw = (f1 * p.x + u2 * p.y + r2 * p.z) * sc;
  vec3 nn = f1 * n.x + u2 * n.y + r2 * n.z;
  vec3 P = org + lw.x * X + lw.y * Y + lw.z * Z;
  vN = nn.x * X + nn.y * Y + nn.z * Z;
  float dr = length(P.xz - uCamPos.xz);
  P.y -= dr * dr / (2.0 * 6360000.0);
  vWorld = P; vTag = aTag; vObjN = n; vSp = aB.w;
  gl_Position = uViewProj * vec4(P, 1.0);
}`;

const BIRD_FS = SKY_LOOKUP_GLSL + `
in vec3 vWorld;
in vec3 vN;
in vec4 vTag;
in vec3 vObjN;
in float vSp;
out vec4 oColor;
uniform vec3 uCamPos;
uniform vec3 uRrs;
uniform vec3 uFlash;
uniform vec3 uPal[28];   // per species: mantle, underside, wing tip, crown, throat, bill, legs
const float M_PI = 3.14159265359;
void main() {
  vec3 toCam = uCamPos - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  vec3 N = normalize(vN);
  if (dot(N, V) < 0.0) N = -N;
  int b = int(vSp + 0.5) * 7;
  float part = vTag.x;
  vec3 albedo;
  if (part < 0.5) albedo = mix(uPal[b + 1], uPal[b], smoothstep(0.05, 0.55, vObjN.y));
  else if (part < 1.5) albedo = mix(vTag.z > 0.0 ? uPal[b] : uPal[b + 1], uPal[b + 2], smoothstep(0.72, 0.84, vTag.y));
  else if (part < 2.5) albedo = uPal[b + 1];
  else if (part < 3.5) albedo = mix(uPal[b + 4], uPal[b + 3], smoothstep(0.1, 0.5, vObjN.y));
  else if (part < 4.5) albedo = uPal[b + 5];
  else albedo = uPal[b + 6];
  vec3 sunE = sunIlluminance(), skyE = skyIrradiance();
  vec3 L = uSunDir;
  vec2 suv = (vWorld.xz - uShaftRect.xy) * uShaftRect.zw;
  float sunVis = mix(uHazeSun, texture(uShaftShadow, suv).r, smoothstep(0.0, 0.04, min(min(suv.x, suv.y), min(1.0 - suv.x, 1.0 - suv.y))));
  float nl = dot(N, L);
  vec3 seaL = uRrs * (sunE * sunVis * max(L.y, 0.0) + skyE);
  vec3 groundE = M_PI * seaL * 1.5 + skyE * 0.06;
  float up = N.y * 0.5 + 0.5;
  vec3 sunLight = sunE * sunVis * max(nl, 0.0);
  // a wing is thin: the sun behind it shows through
  if (part > 0.5 && part < 1.5) sunLight += sunE * sunVis * max(-nl, 0.0) * 0.35;
  vec3 Ed = sunLight + skyE * up + groundE * (1.0 - up) + uFlash * 0.3;
  vec3 col = albedo * Ed / M_PI;
  vec3 aL, aT;
  aerial(-V, dist * 0.001, aL, aT);
  col = col * aT + aL;
  col = applyFog(col, -V, dist);
  oColor = vec4(col, 1.0);
}`;

// ---- splash particles: droplets, rings on the surface, foam puffs ------------------------------
// y is height above the sea at the particle's spot (the vertex shader reads the waves), so a ring
// stays on a swell and a drop falls back to the water, not to a plane.
const FX_VS = `
layout(location = 0) in vec4 aA;   // x, height above the sea, z, size (a ring: its radius)
layout(location = 1) in vec4 aB;   // kind (0 drop, 1 ring, 2 foam), age 0..1, seed, alpha
layout(location = 2) in vec4 aC;   // velocity
uniform mat4 uViewProj;
uniform vec3 uCamPos;
uniform sampler2D uDisp[3];
uniform float uSize[4];
uniform float uTexel[4];
out vec2 vUv;
out float vAlpha;
out float vDist;
out float vSeed;
out float vKind;
out vec3 vDir;
vec3 dispAt(vec2 xz) {
  vec3 D = textureLod(uDisp[0], xz / uSize[0], max(1.0 - log2(uTexel[0]), 0.0)).xyz;
  D += textureLod(uDisp[1], xz / uSize[1], max(1.0 - log2(uTexel[1]), 0.0)).xyz;
  D += textureLod(uDisp[2], xz / uSize[2], max(1.0 - log2(uTexel[2]), 0.0)).xyz;
  return D;
}
void main() {
  float kind = aB.x, age = aB.y;
  vec2 c = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1)) - 0.5;
  vec3 D = dispAt(aA.xz);
  vec3 pos = vec3(aA.x + D.x, aA.y + D.y, aA.z + D.z);
  vec3 toCam = uCamPos - pos;
  float dist = length(toCam);
  vec3 vd = toCam / max(dist, 1e-3);
  vec3 P;
  if (kind > 0.5 && kind < 1.5) {
    P = pos + vec3(c.x, 0.0, c.y) * aA.w * 2.0 + vec3(0.0, 0.03, 0.0);
  } else {
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), vd));
    vec3 upv = cross(vd, right);
    float st = kind < 0.5 ? 1.0 + clamp(length(aC.xyz) * 0.12, 0.0, 2.0) : 1.0;
    // a drop is a short streak along its fall
    vec3 vel = aC.xyz; vec3 vp = vel - vd * dot(vel, vd);
    float spp = length(vp);
    vec3 u = (kind < 0.5 && spp > 0.05) ? vp / spp : upv;
    vec3 w = normalize(cross(vd, u));
    P = pos + w * c.x * aA.w + u * c.y * aA.w * st;
  }
  vUv = c + 0.5;
  vAlpha = aB.w * (kind > 0.5 && kind < 1.5 ? (1.0 - age) * smoothstep(0.0, 0.08, age) : sin(3.14159 * min(age, 1.0))) * smoothstep(0.3, 1.0, dist);
  vDist = dist; vSeed = aB.z; vKind = kind; vDir = -vd;
  float dr = length(P.xz - uCamPos.xz);
  P.y -= dr * dr / (2.0 * 6360000.0);
  gl_Position = uViewProj * vec4(P, 1.0);
}`;
const FX_FS = SKY_LOOKUP_GLSL + `
in vec2 vUv;
in float vAlpha;
in float vDist;
in float vSeed;
in float vKind;
in vec3 vDir;
out vec4 oColor;
uniform vec3 uFlash;
float hsh(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hsh(i), hsh(i + vec2(1, 0)), f.x), mix(hsh(i + vec2(0, 1)), hsh(i + vec2(1, 1)), f.x), f.y); }
void main() {
  vec2 q = vUv * 2.0 - 1.0;
  float r = length(q);
  float a;
  if (vKind > 0.5 && vKind < 1.5) {
    // a ring: a broken band of foam, wider as it spreads
    float n = vn(q * 6.0 + vSeed * 31.0) * 0.6 + vn(q * 14.0 + vSeed * 7.0) * 0.4;
    a = smoothstep(0.62, 0.86, r) * (1.0 - smoothstep(0.9, 1.0, r)) * (0.3 + 0.7 * n) * 0.8;
  } else if (vKind > 1.5) {
    float n = vn(q * 2.4 + vSeed * 53.0) * 0.6 + vn(q * 6.0 + vSeed * 17.0) * 0.4;
    a = pow(max(1.0 - r * r, 0.0), 1.4) * (0.3 + 0.7 * n) * 0.7;
  } else {
    a = pow(max(1.0 - r * r, 0.0), 1.3);
  }
  a *= vAlpha;
  if (a < 0.003) discard;
  a = min(a, 1.0);
  vec3 dir = normalize(vDir);
  float cs = max(dot(dir, uSunDir), 0.0);
  vec3 E = skyIrradiance() * 0.8 + sunIlluminance() * uHazeSun * max(uSunDir.y, 0.0) * (0.5 + 2.0 * pow(cs, 6.0)) + uFlash * 0.3;
  vec3 Lc = vec3(dot(E, vec3(0.2126, 0.7152, 0.0722))) * (1.5 / 3.14159265);
  vec3 aL, aT;
  aerial(dir, vDist * 0.001, aL, aT);
  vec3 c = applyFog(Lc * aT + aL, dir, vDist);
  oColor = vec4(c * a, a);
}`;

// ---- species -------------------------------------------------------------------------------
// 0 herring gull (grey back, black tips), 1 cormorant (dark), 2 tern (small, black cap), 3 young gull (brown)
const SPECIES = [
  { flap: 2.7, amp: 0.78, size: 1.0, glide: 0.65 },
  { flap: 4.2, amp: 0.62, size: 1.0, glide: 0.15 },
  { flap: 3.9, amp: 0.85, size: 0.92, glide: 0.3 },
  { flap: 2.6, amp: 0.8, size: 1.0, glide: 0.6 },
];
// mantle, underside, tip, crown, throat, bill, legs (linear albedo)
const PAL = new Float32Array([
  0.30, 0.33, 0.37, 0.78, 0.78, 0.76, 0.03, 0.03, 0.035, 0.76, 0.76, 0.74, 0.76, 0.76, 0.74, 0.55, 0.38, 0.03, 0.45, 0.22, 0.2,
  0.028, 0.03, 0.034, 0.025, 0.026, 0.03, 0.028, 0.03, 0.034, 0.03, 0.03, 0.034, 0.05, 0.045, 0.03, 0.18, 0.16, 0.1, 0.03, 0.03, 0.03,
  0.40, 0.43, 0.47, 0.82, 0.82, 0.8, 0.12, 0.12, 0.14, 0.025, 0.025, 0.03, 0.8, 0.8, 0.78, 0.6, 0.1, 0.03, 0.5, 0.08, 0.03,
  0.10, 0.085, 0.07, 0.2, 0.17, 0.14, 0.04, 0.035, 0.03, 0.16, 0.14, 0.12, 0.2, 0.17, 0.14, 0.1, 0.08, 0.06, 0.35, 0.2, 0.18,
]);
const SP = new Float32Array([1, 1, 1, 1, 0.97, 1.35, 0.85, 2.1, 0.9, 0.85, 0.7, 1, 1.02, 1, 1.05, 1]);
const SP2 = new Float32Array([1, 0, 0, 0, 1.6, 0, 0, 0, 1.5, 0, 0, 0, 1, 0, 0, 0]);

// ---- course geometry ------------------------------------------------------------------------
const at = (course, i, along, across) => { const g = course.gates[i % course.gates.length]; return [g.c[0] + g.dir[0] * along + g.nrm[0] * across, g.c[1] + g.dir[1] * along + g.nrm[1] * across]; };
// the racing line: the gate centres joined (closed on a circuit), with arc length
function routeOf(course) {
  const pts = course.gates.map((g) => g.c), n = pts.length, segs = course.loop ? n : n - 1;
  const cum = [0];
  for (let i = 0; i < segs; i++) { const a = pts[i], b = pts[(i + 1) % n]; cum.push(cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  return { pts, n, segs, cum, total: cum[segs], loop: course.loop };
}
function routeDist(r, x, z) {
  let best = 1e9;
  for (let i = 0; i < r.segs; i++) {
    const a = r.pts[i], b = r.pts[(i + 1) % r.n], dx = b[0] - a[0], dz = b[1] - a[1];
    const t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1), 0, 1);
    const d = Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t));
    if (d < best) best = d;
  }
  return best;
}
// point at arc length s along one lap of the line: out = [x, z, dirx, dirz]
function routeAt(r, s, out) {
  s = ((s % r.total) + r.total) % r.total;
  let i = 0;
  while (i < r.segs - 1 && r.cum[i + 1] < s) i++;
  const a = r.pts[i], b = r.pts[(i + 1) % r.n], l = r.cum[i + 1] - r.cum[i] || 1, t = (s - r.cum[i]) / l;
  out[0] = a[0] + (b[0] - a[0]) * t; out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = (b[0] - a[0]) / l; out[3] = (b[1] - a[1]) / l;
  return out;
}

// model matrices written in place (nothing allocated): a turn about the vertical, and a pose with x
// forward, y up, z to the right, pitched up about the right axis
const rotY = (m, a, x, y, z) => {
  const c = Math.cos(a), s = Math.sin(a);
  m[0] = c; m[1] = 0; m[2] = s; m[3] = 0; m[4] = 0; m[5] = 1; m[6] = 0; m[7] = 0; m[8] = -s; m[9] = 0; m[10] = c; m[11] = 0; m[12] = x; m[13] = y; m[14] = z; m[15] = 1;
  return m;
};
const poseMat = (m, x, y, z, yaw, pitch) => {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  m[0] = cy * cp; m[1] = sp; m[2] = sy * cp; m[3] = 0; m[4] = -cy * sp; m[5] = cp; m[6] = -sy * sp; m[7] = 0; m[8] = -sy; m[9] = 0; m[10] = cy; m[11] = 0; m[12] = x; m[13] = y; m[14] = z; m[15] = 1;
  return m;
};

const WIND = [0, 0];

export class Wildlife {
  constructor(game) {
    this.game = game;
    this.gl = game.app.gl;
    this.key = null;
    this.route = null;
    this.flocks = []; this.birds = []; this.perches = [];
    this.flot = []; this.crews = []; this.flags = [];
    this.inst = new Float32Array(MAXB * IF); this.nInst = 0;
    this.fx = new Float32Array(MAXFX * FXF); this.fxN = 0;
    this.pool = { p: new Float32Array(MAXFX * 3), v: new Float32Array(MAXFX * 3), age: new Float32Array(MAXFX).fill(1e9), life: new Float32Array(MAXFX), size: new Float32Array(MAXFX), kind: new Float32Array(MAXFX), seed: new Float32Array(MAXFX), alpha: new Float32Array(MAXFX), grow: new Float32Array(MAXFX), head: 0 };
    this.bp = null; this.fp = null;
    this.meshes = null;
    this.mat = new Float32Array(16);
    this.opt = { float: 0, texture: null, tint: [1, 1, 1] };
    this.foot = 0;
    this.nb = 0; this.bx = new Float32Array(8); this.bz = new Float32Array(8); this.bsp = new Float32Array(8);
    this.cam = [0, 0, 0, 0, 0, 0];
    this.act = 1; this.twi = 0; this.vis = 1; this.raftsOn = true; this.wind = 0; this.windAng = 0;
    this.lvl = 1;
    this.tmp = [0, 0, 0, 0];
    this.cloP = new Float32Array(FLAG_CLOTH_VERTS * 3); this.cloN = new Float32Array(FLAG_CLOTH_VERTS * 3);
    this.prevT = -1;
    this.pod = { k: -1e9, on: false, n: 0, x: new Float32Array(8), z: new Float32Array(8), t0: new Float32Array(8), dur: new Float32Array(8), per: new Float32Array(8), H: new Float32Array(8), arcs: new Int8Array(8), yaw: 0, v: 6 };
    this.fishList = [];
    this.dol = Array.from({ length: 8 }, () => ({ x: 0, y: 0, z: 0, yaw: 0, pit: 0 }));
    this.nDol = 0; this.nFish = 0;
    this.stats = { instances: 0, birdTris: 0, draws: 0, tris: 0, fx: 0, flying: 0, perched: 0 };
    this.land = null; this.scenery = null; this.marks = null;
  }

  // other systems, found by what they hold (this file does not import them)
  find() {
    const S = this.game.systems;
    this.scenery = this.scenery || S.find((s) => s !== this && s.items && s.layout && typeof s.layout !== 'function' && s.colliders) || null;
    this.marks = this.marks || S.find((s) => s !== this && s.items && s.spans) || null;
    this.land = this.land || S.find((s) => s !== this && typeof s.heightAt === 'function') || null;
  }
  ground(x, z) { return this.land ? this.land.heightAt(x, z) : -50; }
  // nothing of Scenery's within pad metres (its colliders are circles and boxes with a radius)
  clear(x, z, pad) {
    const sc = this.scenery;
    if (sc) for (const c of sc.colliders) if (Math.hypot(x - c.x, z - c.z) < (c.r || 22) + pad) return false;
    return true;
  }
  // placement of something that belongs in the water: clear of land (and of the racing line when asked)
  wet(x, z) { return !this.land || this.land.heightAt(x, z) < -3; }

  // ===== layout: a pure function of the course =====
  build(course) {
    const sc = this.scenery, mk = this.marks;
    this.course = course;
    this.key = [course, sc && sc.items, mk && mk.items, !!this.land];
    const R = rng(hashStr(course.id) ^ 0x51ed270b), n = course.gates.length, hw = course.gates[0].hw;
    this.seed = hashStr(course.id);
    this.route = routeOf(course);
    const route = this.route, birds = this.birds = [], flocks = this.flocks = [], perches = this.perches = [];
    this.flot = []; this.crews = []; this.flags = [];
    const L = sc && sc.layout;
    const nearStuff = (x, z, pad) => !this.clear(x, z, pad);
    // a spot on open water: off the racing line by at least `off`, on water, clear of structures
    const spot = (off, lat0, lat1) => {
      for (let k = 0; k < 40; k++) {
        const g = Math.floor(R() * n), side = R() < 0.5 ? -1 : 1;
        const [x, z] = at(course, g, (R() - 0.5) * 240, side * (hw + lat0 + R() * (lat1 - lat0)));
        if (routeDist(route, x, z) >= off && this.wet(x, z) && !nearStuff(x, z, 30)) return [x, z];
      }
      return null;
    };
    const bird = (o) => { const b = { type: 0, sp: 0, rank: 0, seed: R(), ph: R() * TAU, fl: null, x: 0, y: 5, z: 0, yaw: 0, pit: 0, rol: 0, amp: 0, fold: 0, mode: 0, sc: 1, ax: 0, az: 0, foot: 0, ayaw: 0, k: R(), gnd: -50, ...o }; birds.push(b); return b; };
    // ---- flocks: members wheel on their own slightly different circles about a slowly wandering centre
    // (a clump on an arc of the circle that drifts apart only slowly: each has its own radius and a nearly common angular speed)
    const flock = (cx, cz, Rr, alt, members, species, { kind = 'orbit', extra = 0, spread = 1.5, speed = 9.5 } = {}) => {
      const fl = { cx, cz, x0: cx, z0: cz, R: Rr, alt, alarm: 0, ax: 1, az: 0, dax: 25 + R() * 30, daz: 25 + R() * 30, dph: R() * TAU, kind };
      flocks.push(fl);
      const dir = R() < 0.5 ? 1 : -1, N = members + extra, th0 = R() * TAU, om0 = dir * speed / Rr;
      for (let i = 0; i < N; i++) {
        const tw = i >= members, sp = species[Math.floor(R() * species.length)];
        bird({ type: 0, sp, fl, rank: tw ? 0.76 + 0.24 * ((i - members + 0.5) / extra) : 0.74 * ((i + 0.5) / members), th: th0 + (members > 1 ? (R() - 0.5) * spread : 0), R: Rr * (0.82 + 0.36 * R()), om: om0 * (0.97 + 0.06 * R()), dalt: (R() - 0.5) * 12, altAmp: 1 + 3 * R(), tg: 8 + 8 * R(), sc: SPECIES[sp].size * (0.94 + 0.12 * R()) });
      }
      return fl;
    };
    // over the first stretch, off one side of the line, where the chase camera sees it at the start
    { const side = R() < 0.5 ? -1 : 1; const [x, z] = at(course, 0, 110, side * (hw + 58)); if (this.wet(x, z)) flock(x, z, 55, 20, 14, [0, 0, 0, 3], { extra: 4 }); }
    { const [x, z] = at(course, Math.floor(n / 2), 0, (R() < 0.5 ? -1 : 1) * (hw + 105)); if (this.wet(x, z)) flock(x, z, 100, 32, 11, [0, 0, 0, 2], { extra: 4 }); }
    { const [x, z] = at(course, Math.floor(n * 0.8), 0, (R() < 0.5 ? -1 : 1) * (hw + 65)); if (this.wet(x, z)) flock(x, z, 65, 19, 10, [0, 0, 3], { extra: 3 }); }
    // terns work a mark: tight, quick circles
    if (n > 3) { const g = course.gates[Math.floor(n * 0.35)]; const s = R() < 0.5 ? g.port : g.stbd; const out = s === g.port ? -1 : 1; const x = s[0] + g.nrm[0] * out * 32, z = s[1] + g.nrm[1] * out * 32; if (this.wet(x, z)) flock(x, z, 30, 13, 7, [2], { extra: 3, speed: 8 }); }
    if (sc) {
      // the committee boat draws gulls
      const cb = sc.items.find((it) => it.kind === 'committee');
      if (cb) flock(cb.x, cb.z, 42, 15, 9, [0, 0, 3], { extra: 4, speed: 8.5 });
      if (L && L.lighthouse) flock(L.lighthouse.x, L.lighthouse.z, 38, 30, 8, [0, 0], { extra: 2, speed: 9 });
      if (L && L.platform) flock(L.platform.x, L.platform.z, 55, 42, 6, [0, 0, 3], { extra: 2 });
      // gulls follow the breakwater: wheeling on an ellipse along it
      if (L && L.breakwater) {
        const P = L.breakwater.path, a = P[0], b = P[P.length - 1];
        const cx = (a[0] + b[0]) / 2, cz = (a[1] + b[1]) / 2, len = Math.hypot(b[0] - a[0], b[1] - a[1]) / 2 + 14, rot = Math.atan2(b[1] - a[1], b[0] - a[0]);
        const fl = flock(cx, cz, 1, 11, 8, [0, 0, 3], { kind: 'loop', extra: 3 });
        fl.a = len; fl.b = 28; fl.rot = rot;
        for (const bd of birds) if (bd.fl === fl) { bd.type = 1; bd.om = (bd.om > 0 ? 1 : -1) * 8.5 / len * (0.97 + 0.06 * bd.k); }
      }
    }
    // single gulls soaring high, small dots against the sky
    for (let i = 0; i < 6; i++) {
      const g = Math.floor(R() * n), [x, z] = at(course, g, 0, (R() - 0.5) * 2 * (hw + 250));
      const fl = flock(x, z, 150 + R() * 150, 45 + R() * 50, 1, [0, 3], { extra: 0, speed: 11 });
      fl.dax = 80; fl.daz = 80;
    }
    // cormorants: a line low over the water, parallel to a leg, well off the racing line
    for (let i = 0; i < 2; i++) {
      let tr = null;
      for (let k = 0; k < 30 && !tr; k++) {
        const g = Math.floor(R() * n), side = R() < 0.5 ? -1 : 1, gg = course.gates[g];
        const lat = side * (hw + 70 + R() * 160), ox = gg.c[0] + gg.nrm[0] * lat, oz = gg.c[1] + gg.nrm[1] * lat;
        const ang = Math.atan2(gg.dir[1], gg.dir[0]) + (R() - 0.5) * 0.3 + (R() < 0.5 ? 0 : Math.PI), dx = Math.cos(ang), dz = Math.sin(ang);
        let ok = true;
        for (let s = -1500; s <= 1500; s += 60) { const x = ox + dx * s, z = oz + dz * s; if (routeDist(route, x, z) < 55 || !this.wet(x, z)) { ok = false; break; } }
        if (ok) tr = { ox, oz, dx, dz };
      }
      const low = !!tr;
      if (!tr) { const gg = course.gates[Math.floor(R() * n)]; tr = { ox: gg.c[0] + gg.nrm[0] * (hw + 150), oz: gg.c[1] + gg.nrm[1] * (hw + 150), dx: gg.dir[0], dz: gg.dir[1] }; }
      const len = 3000, v = 15 + R() * 3, cnt = 5, off = R() * len;
      for (let j = 0; j < cnt; j++) bird({ type: 2, sp: 1, rank: 0.7 * ((j + 0.5) / cnt) * (i ? 0.9 : 0.8), tr, low, v, len, off, back: j * 4.5, lat: ((j & 1) ? 1 : -1) * Math.ceil(j / 2) * 3.2, alt: low ? 3.4 : 9 });
    }
    this.layoutPerches(R, course);
    this.layoutFlotsam(R, course, spot, route);
    this.layoutPeople(R);
    this.pods = null;
    this.prevT = -1;
  }

  // ---- perched birds ----
  layoutPerches(R, course) {
    const sc = this.scenery, mk = this.marks, perches = this.perches, birds = this.birds;
    const L = sc && sc.layout;
    const pick = () => { const r = R(); return r < 0.72 ? 0 : r < 0.84 ? 2 : r < 0.92 ? 3 : 1; };
    const add = (kind, o, rankMax = 0.74) => {
      const sp = o.sp ?? pick();
      const b = { type: 3, sp, rank: 0, seed: R(), ph: R() * TAU, fl: null, x: 0, y: 0, z: 0, yaw: o.yaw ?? R() * TAU, pit: 0, rol: 0, amp: 0, fold: 1, mode: 0, sc: SPECIES[sp].size, ax: 0, az: 0, foot: 0, ayaw: 0, k: R(), gnd: -50,
        kind, it: o.it || null, lx: o.lx, ly: o.ly, lz: o.lz, st: 0, tS: 0, vx: 0, vy: 0, v: 0, wx: 0, wz: 0, wy: 0, circ: R() < 0.5 ? 1 : -1, altT: 0, tR: 0, tA: 0, tF: 0, fx0: 0, fz0: 0, fy0: 0, px: 0, pz: 0, py: o.ly, yaw0: 0, group: o.group || 0 };
      b.yaw0 = b.yaw;
      perches.push(b); birds.push(b);
      return b;
    };
    const rk = (b, f) => { b.rank = f; };
    if (mk) for (const it of mk.items) if (it.kind === 'buoy' && R() < 0.4) {
      // on the deck beside the tower: a can has a wide flat top, a cone a narrow one
      const r = it.side === 'port' ? 1.15 : 0.7, a = R() * TAU;
      rk(add('buoy', { it, lx: Math.cos(a) * r, ly: it.side === 'port' ? 1.3 : 2.2, lz: Math.sin(a) * r }), R() * 0.72);
    }
    if (sc && L) {
      if (L.breakwater) {
        const bw = L.breakwater, rows = smoothPath(bw.path, 11);
        for (let i = 1; i < rows.length - 1; i++) if (R() < 0.3) {
          const p = rows[i], nx = -p.tz * bw.side, nz = p.tx * bw.side, top = R() < 0.65;
          const a = top ? -2.7 : 0.4 + R();
          rk(add('world', { lx: p.x - nx * a, lz: p.z - nz * a, ly: top ? 5.35 : 3.78, yaw: Math.atan2(nz, nx) + (R() - 0.5) * 1.5 }), R() * 0.72);
        }
      }
      for (const b of L.beacons) {
        const nb = R() < 0.6 ? 1 : 2;
        for (let k = 0; k < nb; k++) { const a = R() * TAU; rk(add('world', { lx: b.x + Math.cos(a) * 1.75, lz: b.z + Math.sin(a) * 1.75, ly: 7.2 }), R() * 0.72); }
      }
      if (L.lighthouse) for (let k = 0; k < 4; k++) { const a = R() * TAU, l = L.lighthouse; rk(add('world', { lx: l.x + Math.cos(a) * 4.3, lz: l.z + Math.sin(a) * 4.3, ly: 29.05, yaw: a + Math.PI / 2 }), R() * 0.72); }
      for (const it of sc.items) {
        if (!it.float || it.kind === 'cargo') continue;
        const spots = it.kind === 'committee' ? [[0.5, 8.06, 1.55], [0.5, 8.06, -1.55], [-6.1, 3.85, 0]] : it.kind === 'yacht' ? [[1.0, 6.4, 0.95], [-5.0, 1.15, 0.0]] : it.kind === 'cruiser' ? [[-1.95, 4.7, 0]] : [];
        for (const s of spots) if (R() < (it.kind === 'committee' ? 0.7 : 0.3)) rk(add('boat', { it, lx: s[0], ly: s[1], lz: s[2] }), R() * 0.72);
      }
    }
    // rafts on the water: a loose group that sits to the wind
    for (let r = 0; r < 4; r++) {
      let p = null;
      const g = Math.floor(R() * course.gates.length), side = R() < 0.5 ? -1 : 1, hw = course.gates[0].hw;
      for (let k = 0; k < 30 && !p; k++) {
        const [x, z] = at(course, g, (R() - 0.5) * 300, side * (hw + 75 + R() * 260));
        if (routeDist(this.route, x, z) > 75 && this.wet(x, z) && !(sc && sc.colliders.some((c) => Math.hypot(x - c.x, z - c.z) < (c.r || 20) + 45))) p = [x, z];
      }
      if (!p) continue;
      const cnt = 4 + Math.floor(R() * 5), face = R() * TAU;
      for (let i = 0; i < cnt; i++) {
        const a = R() * TAU, d = 1 + R() * 5;
        const sp = R() < 0.8 ? 0 : 3;
        rk(add('water', { sp, lx: p[0] + Math.cos(a) * d, lz: p[1] + Math.sin(a) * d, ly: 0.03, yaw: face + (R() - 0.5) * 1.1 }), 0.1 + 0.55 * ((i + 0.5) / cnt));
      }
    }
  }

  // ---- flotsam ----
  layoutFlotsam(R, course, spot, route) {
    const add = (kind, x, z, o = {}) => this.flot.push({ kind, x, z, yaw: R() * TAU, foot: 0, cull: 300, r: 4, variant: Math.floor(R() * 3), ...o });
    for (let i = 0; i < 12; i++) { const p = spot(45, 55, 420); if (p) add('kelp', p[0], p[1], { foot: 6, cull: 260, r: 6 }); }
    for (let i = 0; i < 4; i++) { const p = spot(60, 80, 450); if (p) add('log', p[0], p[1], { foot: 4, cull: 330, r: 2.5 }); }
    for (let i = 0; i < 3; i++) { const p = spot(60, 80, 450); if (p) add('crate', p[0], p[1], { cull: 200, r: 1 }); }
    // lines of pot markers: a string along one direction, 25 to 35 m apart
    for (let i = 0; i < 3; i++) {
      const p = spot(70, 90, 400);
      if (!p) continue;
      const a = R() * TAU, step = 25 + R() * 10, cnt = 5 + Math.floor(R() * 3), v = Math.floor(R() * 4);
      for (let k = 0; k < cnt; k++) {
        const x = p[0] + Math.cos(a) * step * k, z = p[1] + Math.sin(a) * step * k;
        if (routeDist(route, x, z) >= 45 && this.wet(x, z)) add('pot', x, z, { cull: 240, r: 1, variant: v, pot: true });
      }
    }
  }

  // ---- people and flags on what Scenery placed ----
  layoutPeople(R) {
    const sc = this.scenery, L = sc && sc.layout;
    if (!sc) return;
    const crew = (host, people, foot = 0, fixed = null) => this.crews.push({ host, people, foot, fixed, variants: null, waving: people.some((p) => p.pose === 1) });
    for (const it of sc.items) {
      if (!it.float || it.kind === 'cargo') continue;
      const h = ih(this.seed, Math.round(it.x * 3 + it.z * 7));
      let people = null;
      if (it.kind === 'committee') people = [
        { x: -4.3, y: 1.47, z: 0.85, yaw: -0.5, pal: 0, skin: 0 }, { x: -3.3, y: 1.47, z: -0.95, yaw: 0.4, pal: 0, skin: 1, pose: 1, side: -1 },
        { x: -5.4, y: 1.47, z: 0.1, yaw: 0, pal: 1, skin: 2 }, { x: 1.3, y: 3.84, z: 0.95, yaw: 1.2, pal: 2, skin: 3, pose: 1, side: 1 }, { x: -0.3, y: 3.84, z: -0.9, yaw: -0.8, pal: 4, skin: 0 }];
      else if (it.kind === 'yacht' && h < 0.75) people = [{ x: -4.4, y: 0.47, z: 0.0, yaw: 0, pal: 2, skin: 0, pose: 2 }, { x: -3.2, y: 0.47, z: 0.7, yaw: 0.9, pal: 5, skin: 3, pose: h < 0.35 ? 1 : 0, side: 1 }];
      else if (it.kind === 'cruiser' && h < 0.8) people = [{ x: -5.3, y: 1.3, z: 0.55, yaw: 2.8, pal: 3, skin: 1, pose: 1, side: -1 }, { x: -0.15, y: 3.55, z: 0.95, yaw: 0, pal: 4, skin: 0 }, { x: -4.6, y: 1.3, z: -0.7, yaw: 1.2, pal: 1, skin: 2 }];
      else if (it.kind === 'rib' && h < 0.7) people = [{ x: -1.9, y: 0.3, z: 0.0, yaw: 0, pal: 0, skin: 1, pose: 2 }];
      if (people) crew(it, people, 0);
    }
    // on the breakwater: a few figures on the road deck, one waving, in hi-vis
    if (L && L.breakwater) {
      const bw = L.breakwater, rows = smoothPath(bw.path, 30);
      const people = [];
      for (let i = 1; i < rows.length - 1 && people.length < 5; i++) {
        if (ih(this.seed, i * 17 + 3) < 0.4) continue;
        const p = rows[i], nx = -p.tz * bw.side, nz = p.tx * bw.side, a = 0.3 + 1.4 * ih(this.seed, i * 5);
        people.push({ x: p.x - nx * a, y: 3.78, z: p.z - nz * a, yaw: Math.atan2(nz, nx) + (ih(this.seed, i) - 0.5), pal: 0, skin: i & 3, pose: people.length === 1 ? 1 : 0, side: 1 });
      }
      if (people.length) {
        const o = people[0];
        const ox = o.x, oz = o.z;
        for (const q of people) { q.x -= ox; q.z -= oz; }
        crew(null, people, 0, { x: ox, z: oz });
      }
    }
    // flags: the weather's wind decides which way and how stiffly they fly
    const flag = (host, style, bx, by, bz, poleH, L2, H2, fixed = null) => this.flags.push({ host, style, bx, by, bz, poleH, L: L2, H: H2, fixed, mesh: null, seed: R() * 6.28 });
    for (const it of sc.items) {
      if (it.kind === 'yacht') { flag(it, 'ensign', -5.15, 2.5, 0, 1.55, 0.55, 0.36); flag(it, 'burgee', 1.0, 14.3, 0.05, 0, 0.55, 0.28); }
      else if (it.kind === 'cruiser') { flag(it, 'ensign', -6.2, 2.0, 0, 1.45, 0.5, 0.33); flag(it, 'burgee', -1.95, 5.75, 0.5, 0, 0.4, 0.22); }
      else if (it.kind === 'committee') flag(it, 'signal', -1.0, 6.2, -1.7, 2.4, 1.1, 0.75);
      else if (it.kind === 'lighthouse') flag(it, 'white', 3.6, 31.0, 0, 3.0, 1.4, 0.9);
    }
    if (L && L.breakwater) { const P = L.breakwater.path, e = P[P.length - 1]; flag(null, 'pennant', 0, 14.2, 0, 1.7, 1.0, 0.45, { x: e[0], z: e[1] }); }
  }

  // ===== the weather =====
  weather() {
    const app = this.game.app, S = app.weather && app.weather.state;
    if (!S) return;
    const wind = S.wind, rain = (app.local && app.local.rain) ?? S.rain;
    this.wind = wind;
    const wd = (S.windDir * Math.PI) / 180;
    this.windAng = Math.atan2(Math.sin(wd), Math.cos(wd));
    this.act = (1 - 0.85 * sst(8.5, 18, wind)) * (1 - 0.5 * sst(0.05, 0.3, rain));
    this.twi = 1 - sst(5, 14, app.weather.time?.sunElev ?? 30);
    this.raftsOn = wind < 11 && rain < 0.15;
    this.podProb = 0.62 * (1 - sst(9, 14, wind));
    this.fishProb = 0.28 * (1 - sst(5, 9, wind));
    this.lvl = clamp(app.fx?.spray ?? 1, 0, 1);
    this.vis = this.lvl * (0.75 + 0.25 * this.twi) * this.act;
  }

  // ===== per frame =====
  update(dt, ot) {
    const g = this.game, app = g.app;
    if (!ot || dt <= 0) return;
    this.find();
    this.weather();
    const sc = this.scenery, mk = this.marks;
    const k = this.key;
    if (this.course !== g.course || !k || k[1] !== (sc && sc.items) || k[2] !== (mk && mk.items) || k[3] !== !!this.land) {
      if (!sc || sc.course === g.course) this.build(g.course);
    }
    const t = app.time;
    this.nInst = 0; this.stats.flying = 0; this.stats.perched = 0;
    if (this.lvl <= 0) { this.fxN = 0; this.stats.instances = 0; return; }
    // the boats
    let nb = 0;
    for (const b of g.renderBoats()) {
      if (b.ghost || nb >= 8) continue;
      this.bx[nb] = b.pose.pos[0]; this.bz[nb] = b.pose.pos[2]; this.bsp[nb] = b.pose.speed; nb++;
    }
    this.nb = nb;
    const c = app.cam, cp = Math.cos(c.pitch), cam = this.cam;
    cam[0] = c.pos[0]; cam[1] = c.pos[1]; cam[2] = c.pos[2];
    cam[3] = Math.cos(c.yaw) * cp; cam[4] = Math.sin(c.pitch); cam[5] = Math.sin(c.yaw) * cp;
    this.frame = (this.frame || 0) + 1;
    // flocks: the wandering centre and how alarmed they are
    for (const fl of this.flocks) {
      fl.cx = fl.x0 + fl.dax * Math.sin(0.017 * t + fl.dph); fl.cz = fl.z0 + fl.daz * Math.sin(0.013 * t + fl.dph * 1.7);
      let tgt = 0;
      for (let i = 0; i < nb; i++) {
        const dx = fl.cx - this.bx[i], dz = fl.cz - this.bz[i], d = Math.hypot(dx, dz), sp = this.bsp[i];
        const reach = (fl.kind === 'loop' ? 30 : fl.R) + 45 + sp * 1.3;
        if (sp > 9 && d < reach) { const a = sst(reach, reach * 0.4, d) * sst(9, 20, sp); if (a > tgt) { tgt = a; fl.ax = dx / (d || 1); fl.az = dz / (d || 1); } }
      }
      fl.alarm += (tgt - fl.alarm) * (1 - Math.exp(-dt * (tgt > fl.alarm ? 2.4 : 0.16)));
      if (this.land && (this.frame & 7) === 0) fl.floor = this.land.heightAt(fl.cx, fl.cz) + 18;
    }
    const vis = this.vis;
    for (const b of this.birds) {
      if (b.rank > vis || (b.type === 3 && b.kind === 'water' && !this.raftsOn)) { if (b.type === 3) b.st = 0; continue; }
      switch (b.type) {
        case 0: this.orbit(b, dt, t); break;
        case 1: this.loopFlight(b, dt, t); break;
        case 2: this.line(b, dt, t); break;
        default: this.perch(b, dt, t); break;
      }
      if (b.mode < 1.5) {
        const ddx = b.x - cam[0], ddy = b.y - cam[1], ddz = b.z - cam[2], d2 = ddx * ddx + ddy * ddy + ddz * ddz;
        if (d2 > BIRD_RANGE * BIRD_RANGE) continue;
        if (ddx * cam[3] + ddy * cam[4] + ddz * cam[5] < -0.4 * Math.sqrt(d2) && d2 > 400) continue;
      } else {
        const it = b.it, ddx = it.x - cam[0], ddz = it.z - cam[2];
        if (ddx * ddx + ddz * ddz > 1400 * 1400) continue;
      }
      if (this.nInst < MAXB) this.emit(b);
    }
    this.stats.instances = this.nInst;
    this.events(dt, t);
    this.fxStep(dt);
  }

  emit(b) {
    const I = this.inst, o = this.nInst++ * IF;
    I[o] = b.x; I[o + 1] = b.y; I[o + 2] = b.z; I[o + 3] = b.sc;
    I[o + 4] = b.yaw; I[o + 5] = b.pit; I[o + 6] = b.rol; I[o + 7] = b.sp;
    I[o + 8] = b.ph; I[o + 9] = b.amp; I[o + 10] = b.fold; I[o + 11] = b.mode;
    I[o + 12] = b.ax; I[o + 13] = b.az; I[o + 14] = b.foot; I[o + 15] = b.ayaw;
  }

  // keep a flying bird 16 m above the land beneath it and just ahead (sampled on a stagger, a few frames apart)
  clearTerrain(b, x, z, yaw, y) {
    if (((this.frame + Math.floor(b.seed * 8)) & 3) === 0) b.gnd = Math.max(this.land.heightAt(x, z), this.land.heightAt(x + Math.cos(yaw) * 40, z + Math.sin(yaw) * 40), this.land.heightAt(x + Math.cos(yaw) * 80, z + Math.sin(yaw) * 80));
    return Math.max(y, b.gnd + 16);
  }

  // wing phase: flap rate from the species and the bout (a glide has none to speak of)
  beat(b, dt, f) { b.ph = (b.ph + dt * TAU * f) % TAU; }

  // a gull on its circle: glides mostly, flaps in bouts, banks into the turn; alarm sends it up and away
  orbit(b, dt, t) {
    const fl = b.fl, sp = SPECIES[b.sp], a = fl.alarm;
    const th = b.th + b.om * t, speed = Math.abs(b.om) * b.R, sgn = b.om > 0 ? 1 : -1;
    let x = fl.cx + Math.cos(th) * b.R, z = fl.cz + Math.sin(th) * b.R;
    const ph2 = 0.21 * t + b.seed * 6.28;
    let y = fl.alt + b.dalt + b.altAmp * Math.sin(ph2);
    const dy = b.altAmp * 0.21 * Math.cos(ph2);
    let yaw = th + sgn * Math.PI / 2;
    let pit = Math.atan2(dy, speed);
    if (a > 0.002) {
      x += fl.ax * a * (35 + 35 * b.k); z += fl.az * a * (35 + 35 * b.k); y += a * (10 + 16 * b.k);
      const hx = Math.cos(yaw) * (1 - 0.7 * a) + fl.ax * 0.7 * a, hz = Math.sin(yaw) * (1 - 0.7 * a) + fl.az * 0.7 * a;
      yaw = Math.atan2(hz, hx); pit += 0.28 * a;
    }
    if (this.land) y = this.clearTerrain(b, x, z, yaw, y);
    b.x = x; b.y = y; b.z = z; b.yaw = yaw; b.pit = pit;
    b.rol = clamp(Math.atan(b.om * speed / G) * 2.2, -0.6, 0.6) * (1 - 0.5 * a);
    // glide or flap
    const g = sst(-0.25, 0.25, Math.sin(TAU * t / b.tg + b.seed * TAU) + (sp.glide - 0.5) * 0.8) * (1 - a);
    b.amp = lerp(sp.amp, 0.04, g) * (1 + 0.25 * a);
    this.beat(b, dt, lerp(sp.flap, 0.6, g) * (1 + 0.5 * a));
    b.fold = 0; b.mode = 0; b.pit += 0.05 * Math.sin(b.ph) * (1 - g);
    this.stats.flying++;
  }

  // along the breakwater: an ellipse about it, tangent heading
  loopFlight(b, dt, t) {
    const fl = b.fl, sp = SPECIES[b.sp], a = fl.alarm;
    const th = b.th + b.om * t, c = Math.cos(th), s = Math.sin(th), cr = Math.cos(fl.rot), sr = Math.sin(fl.rot);
    const ex = fl.a * c, ez = fl.b * s, vx = -fl.a * s * b.om, vz = fl.b * c * b.om;
    let x = fl.x0 + ex * cr - ez * sr, z = fl.z0 + ex * sr + ez * cr;
    const wx = vx * cr - vz * sr, wz = vx * sr + vz * cr, speed = Math.hypot(wx, wz);
    let y = fl.alt + b.dalt * 0.5 + b.altAmp * Math.sin(0.21 * t + b.seed * 6.28);
    let yaw = Math.atan2(wz, wx), pit = 0;
    if (a > 0.002) {
      x += fl.ax * a * 40 * (0.6 + b.k); z += fl.az * a * 40 * (0.6 + b.k); y += a * (10 + 14 * b.k); pit = 0.28 * a;
      const hx = Math.cos(yaw) * (1 - 0.7 * a) + fl.ax * 0.7 * a, hz = Math.sin(yaw) * (1 - 0.7 * a) + fl.az * 0.7 * a; yaw = Math.atan2(hz, hx);
    }
    if (this.land) y = this.clearTerrain(b, x, z, yaw, y);
    b.x = x; b.y = y; b.z = z; b.yaw = yaw; b.pit = pit;
    // banked most where the ellipse turns hardest, at its ends
    b.rol = Math.sign(b.om) * (0.1 + 0.3 * Math.abs(c)) * (1 - 0.5 * a);
    void speed;
    const g = sst(-0.25, 0.25, Math.sin(TAU * t / b.tg + b.seed * TAU) + (sp.glide - 0.5) * 0.8) * (1 - a);
    b.amp = lerp(sp.amp, 0.04, g) * (1 + 0.25 * a);
    this.beat(b, dt, lerp(sp.flap, 0.6, g) * (1 + 0.5 * a));
    b.fold = 0; b.mode = 0;
    this.stats.flying++;
  }

  // cormorants: straight and fast, low, flapping steadily with short glides, skimming the swell
  line(b, dt, t) {
    const T = b.tr, s = ((((t - SEA_T0) * b.v + b.off) % b.len) + b.len) % b.len - b.len / 2 - b.back;
    b.x = T.ox + T.dx * s - T.dz * b.lat; b.z = T.oz + T.dz * s + T.dx * b.lat;
    b.y = b.alt + 0.35 * Math.sin(0.9 * t + b.seed * 9);
    b.yaw = Math.atan2(T.dz, T.dx) + 0.04 * Math.sin(0.5 * t + b.seed * 5);
    b.pit = 0.04 * Math.sin(1.1 * t + b.seed * 3); b.rol = 0.08 * Math.sin(0.6 * t + b.seed * 7);
    const g = sst(0.55, 0.8, Math.sin(TAU * t / 6.5 + b.seed * TAU));
    b.amp = lerp(SPECIES[1].amp, 0.05, g); this.beat(b, dt, lerp(SPECIES[1].flap, 0.5, g));
    b.fold = 0; b.mode = b.low ? 1 : 0;
    this.stats.flying++;
  }

  threat(x, z, trig) {
    for (let i = 0; i < this.nb; i++) { const sp = this.bsp[i]; if (sp > 6 && Math.hypot(this.bx[i] - x, this.bz[i] - z) < trig + sp * 0.5) return i; }
    return -1;
  }

  // perched: stands until a boat comes fast and close, takes off away from it, circles, comes back
  perch(b, dt, t) {
    const it = b.it, kind = b.kind;
    // the perch in the world
    if (kind === 'boat') { const a = it.yaw + (it.sw || 0), c = Math.cos(a), s = Math.sin(a); b.px = it.x + c * b.lx - s * b.lz; b.pz = it.z + s * b.lx + c * b.lz; b.ayaw = a; }
    else if (kind === 'buoy') { b.px = it.x + b.lx; b.pz = it.z + b.lz; }
    else { b.px = b.lx; b.pz = b.lz; }
    const py = b.ly, world = kind === 'world', sp = SPECIES[b.sp];
    const trig = kind === 'water' ? 78 : kind === 'buoy' ? 62 : kind === 'boat' ? 34 : 42;
    if (b.st === 0) {
      if (kind === 'boat') { b.mode = 2; b.x = b.lx; b.y = b.ly; b.z = b.lz; b.ax = it.x; b.az = it.z; b.foot = it.foot || 0; }
      else { b.mode = world ? 0 : 1; b.x = b.px; b.y = py; b.z = b.pz; }
      b.yaw = b.yaw0; b.pit = 0.2; b.rol = 0; b.fold = 1; b.amp = 0;
      // the head turns now and then: a small flutter of the wings is enough to be alive
      const bt = (t * 0.07 + b.seed * 13) % 1;
      if (bt < 0.02) b.amp = 0.12 * Math.sin(bt / 0.02 * Math.PI);
      this.stats.perched++;
      const th = this.threat(b.px, b.pz, trig);
      if (th >= 0) {
        b.st = 1; b.tS = 0;
        b.yaw = Math.atan2(b.pz - this.bz[th], b.px - this.bx[th]) + (b.seed - 0.5) * 0.8;
        b.wx = b.px; b.wz = b.pz; b.wy = py; b.v = 0.6; b.vy = 0; b.mode = world ? 0 : 1; b.ayaw = 0;
        b.altT = py + 13 + 10 * b.k; b.tR = 28 + 40 * b.seed; b.tF = 0;
        if (kind === 'water') { this.spawnRing(b.px, b.pz, 1.3, 0.8); for (let i = 0; i < 6; i++) this.spawnDrop(b.px, b.pz, 0.12, 1.5 + 1.5 * Math.random(), 0.5); }
      }
      return;
    }
    const ride = world ? 0 : 1 - sst(py + 1.5, py + 6, b.wy);
    b.mode = ride; b.x = b.wx; b.y = b.wy; b.z = b.wz; b.ax = 0; b.az = 0; b.foot = 0; b.ayaw = 0;
    b.tS += dt;
    this.stats.flying++;
    if (b.st === 1) {
      const TK = kind === 'water' ? 1.6 : 0.9, k = b.tS / TK;
      b.fold = 1 - sst(0, 0.55, b.tS); b.amp = 0.9 * sst(0.05, 0.4, b.tS);
      this.beat(b, dt, 3.8);
      b.v = 0.6 + 8.9 * k * k; b.vy = 2.6 * sst(TK * 0.35, TK, b.tS);
      b.wx += Math.cos(b.yaw) * b.v * dt; b.wz += Math.sin(b.yaw) * b.v * dt; b.wy += b.vy * dt;
      b.pit = 0.15 + Math.atan2(b.vy, b.v) * 0.8; b.rol = 0;
      if (b.tS >= TK) { b.st = 2; b.tS = 0; b.tF = 0; }
    } else if (b.st === 2) {
      b.tF += dt; b.fold = 0; b.v = 9.5;
      if (b.tF > 5) { b.yaw += b.circ * 0.17 * dt; b.rol += (b.circ * 0.45 - b.rol) * Math.min(1, dt); }
      b.vy += (clamp((b.altT - b.wy) * 0.6, -1.5, 2.5) - b.vy) * Math.min(1, dt * 1.2);
      b.wx += Math.cos(b.yaw) * b.v * dt; b.wz += Math.sin(b.yaw) * b.v * dt; b.wy += b.vy * dt;
      b.pit = Math.atan2(b.vy, b.v);
      const g = sst(-0.2, 0.3, Math.sin(TAU * t / 11 + b.seed * TAU)) * sst(7, 11, b.tF);
      b.amp = lerp(sp.amp, 0.05, g); this.beat(b, dt, lerp(sp.flap, 0.8, g));
      if (b.tF > b.tR && this.threat(b.px, b.pz, 95) < 0) { b.st = 3; b.tA = 0; }
    } else if (b.st === 3) {
      b.tA += dt;
      const dx = b.px - b.wx, dz = b.pz - b.wz, d = Math.hypot(dx, dz);
      const dyaw = angDiff(Math.atan2(dz, dx), b.yaw);
      b.yaw += clamp(dyaw, -0.9 * dt, 0.9 * dt); b.rol += (clamp(dyaw * 0.8, -0.5, 0.5) - b.rol) * Math.min(1, dt * 2);
      b.v = clamp(d * 0.28, 3.2, 9.5);
      const yt = py + d * 0.2 + 0.2;
      b.vy = clamp((yt - b.wy) * 1.5, -3, 2);
      b.wx += Math.cos(b.yaw) * b.v * dt; b.wz += Math.sin(b.yaw) * b.v * dt; b.wy += b.vy * dt;
      b.fold = 0.7 * sst(7, 1.5, d); b.amp = d < 7 ? 0.9 : 0.4;
      this.beat(b, dt, d < 7 ? 3.2 : 2.4);
      b.pit = Math.atan2(b.vy, b.v) + 0.45 * sst(8, 2, d);
      if ((d < 0.8 && b.wy - py < 0.9) || b.tA > 40) { b.st = 4; b.tS = 0; b.fx0 = b.wx; b.fz0 = b.wz; b.fy0 = b.wy; }
      else if (this.threat(b.px, b.pz, trig * 0.85) >= 0) { b.st = 2; b.tF = 0; b.tR += 25; }
    } else {
      const k = clamp(b.tS / 0.35, 0, 1);
      b.wx = lerp(b.fx0, b.px, k); b.wz = lerp(b.fz0, b.pz, k); b.wy = lerp(b.fy0, py, k);
      b.fold = lerp(0.7, 1, k); b.amp = 0.6 * (1 - k); this.beat(b, dt, 2.5);
      b.pit = lerp(b.pit, 0.2, k); b.rol *= 1 - k;
      if (k >= 1) { b.st = 0; b.yaw = b.yaw0; b.rol = 0; }
    }
    // (a standing bird on a boat stays put in the boat's frame: see state 0)
  }

  // ===== events: dolphins, fish, splashes =====
  // A pod surfaces about every 40 s in calm water, ahead of where a player at a nominal pace would be, but
  // well off the racing line. The plan for each 42 s window is a pure function of the course and the window.
  planPod(k) {
    // (seeds that differ by a multiple make mulberry's first draws alike, so the seed is mixed first)
    const P = this.pod, course = this.course, R = rng((ih(this.seed, k * 31 + 7) * 4294967296) >>> 0);
    P.k = k; P.on = false;
    if (ih(this.seed + 5, k) > this.podProb) return;
    const startOff = 4 + R() * 14, tStart = SEA_T0 + k * 42 + startOff, tmp = this.tmp;
    const side = R() < 0.5 ? -1 : 1, lat = 52 + R() * 70, hw = course.gates[0].hw, jit = (R() - 0.5) * 50;
    routeAt(this.route, 30 * ((tStart - SEA_T0) + 7) + jit, tmp);
    // up to ten tries: both sides, a little along and farther out; clear of structures and of land along the pod's run
    for (let tryN = 0; tryN < 10; tryN++) {
      // (each try moves along the line a little and farther out, alternating sides)
      if (tryN > 0 && (tryN & 1) === 0) routeAt(this.route, 30 * ((tStart - SEA_T0) + 7) + jit + (tryN >> 1) * 45 * ((tryN & 2) ? -1 : 1), tmp);
      const sd = (tryN & 1) ? -side : side, off = hw + lat * (1 + 0.35 * (tryN >> 1));
      const x = tmp[0] - tmp[3] * sd * off, z = tmp[1] + tmp[2] * sd * off;
      if (this.wet(x, z) && this.wet(x + tmp[2] * 100, z + tmp[3] * 100) && this.clear(x, z, 35) && this.clear(x + tmp[2] * 90, z + tmp[3] * 90, 30) && this.clear(x - tmp[2] * 90, z - tmp[3] * 90, 30)) {
        const hd = Math.atan2(tmp[3], tmp[2]) + (R() < 0.5 ? 0 : Math.PI) + (R() - 0.5) * 0.9;
        P.yaw = hd; P.v = 5.5 + R() * 2; P.n = 3 + Math.floor(R() * 3);
        const nx = -Math.sin(hd), nz = Math.cos(hd);
        for (let j = 0; j < P.n; j++) {
          const off = (j - (P.n - 1) / 2) * 4.5 + (R() - 0.5) * 2, back = j * 3 * (R() + 0.4);
          P.x[j] = x + nx * off - Math.cos(hd) * back; P.z[j] = z + nz * off - Math.sin(hd) * back;
          P.t0[j] = tStart + j * 0.35 + R() * 0.3; P.dur[j] = 1.0 + R() * 0.3; P.per[j] = P.dur[j] + 0.9 + R() * 0.5; P.H[j] = 1.4 + R() * 0.7;
          P.arcs[j] = 3 + Math.floor(R() * 3);
        }
        P.on = true;
        return;
      }
    }
  }

  events(dt, t) {
    const cam = this.cam, prev = this.prevT;
    this.prevT = t;
    // dolphins
    const k = Math.floor((t - SEA_T0) / 42);
    if (this.pod.k !== k || this.podRoute !== this.route) { this.podRoute = this.route; this.planPod(k); }
    const P = this.pod, cy = Math.cos(P.yaw), sy = Math.sin(P.yaw);
    this.nDol = 0;
    if (P.on) for (let j = 0; j < P.n; j++) {
      const tau = t - P.t0[j], pt = prev - P.t0[j];
      for (let m = 0; m < P.arcs[j]; m++) {
        const te = m * P.per[j], ti = te + P.dur[j], u = (tau - te) / P.dur[j];
        // a splash where it leaves the sea and where it comes back
        if (prev >= 0 && t >= prev) {
          if (pt < te && tau >= te) this.dolphinSplash(P.x[j] + cy * P.v * te, P.z[j] + sy * P.v * te, 0);
          if (pt < ti && tau >= ti) this.dolphinSplash(P.x[j] + cy * P.v * ti, P.z[j] + sy * P.v * ti, 1);
        }
        if (u > -0.2 && u < 1.2 && this.nDol < 8) {
          const x = P.x[j] + cy * P.v * tau, z = P.z[j] + sy * P.v * tau, uu = clamp(u, -0.2, 1.2);
          if (Math.abs(x - cam[0]) + Math.abs(z - cam[2]) < 1000) {
            const d = this.dol[this.nDol++];
            d.x = x; d.z = z; d.y = P.H[j] * 4 * uu * (1 - uu) - 0.28;
            d.pit = Math.atan(P.H[j] * 4 * (1 - 2 * uu) / P.dur[j] / P.v);
            d.yaw = P.yaw + 0.05 * Math.sin(t * 2 + j);
          }
        }
      }
    }
    // fish: near each mark, outside the gate, in calm water
    this.nFish = 0;
    if (this.fishProb > 0.005) {
      const course = this.course, n = course.gates.length, WIN = 7.3;
      for (let gi = 0; gi < n; gi++) for (let sd = 0; sd < 2; sd++) {
        const idx = gi * 2 + sd, kk = Math.floor((t + idx * 1.37) / WIN);
        if (ih(this.seed + idx * 7919, kk) > this.fishProb) continue;
        const tj = kk * WIN - idx * 1.37 + ih(idx + 3, kk * 13) * 5.5, tau = t - tj, dur = 0.55;
        const G = course.gates[gi], mark = sd ? G.stbd : G.port, out = sd ? 1 : -1;
        const far = 15 + 18 * ih(idx + 11, kk * 7), al = (ih(idx + 17, kk * 3) - 0.5) * 12;
        const x0 = mark[0] + G.nrm[0] * out * far + G.dir[0] * al, z0 = mark[1] + G.nrm[1] * out * far + G.dir[1] * al;
        const hd = ih(idx + 29, kk * 5) * TAU, ap = 0.4 + 0.35 * ih(idx + 31, kk * 9);
        if (prev >= 0 && t >= prev && Math.hypot(x0 - cam[0], z0 - cam[2]) < 500) {
          const pt = prev - tj;
          if (pt < 0 && tau >= 0) this.splash(x0, z0, -1);
          if (pt < dur && tau >= dur) this.splash(x0 + Math.cos(hd) * 1.6, z0 + Math.sin(hd) * 1.6, -1);
        }
        if (tau > -0.05 && tau < dur + 0.05 && this.nFish < 8 && Math.hypot(x0 - cam[0], z0 - cam[2]) < 300) {
          const u = clamp(tau / dur, 0, 1), f = this.fishList[this.nFish] || (this.fishList[this.nFish] = { x: 0, y: 0, z: 0, yaw: 0, pit: 0 });
          f.x = x0 + Math.cos(hd) * 1.6 * u; f.z = z0 + Math.sin(hd) * 1.6 * u; f.y = ap * 4 * u * (1 - u) - 0.05;
          f.pit = Math.atan(ap * 4 * (1 - 2 * u) / dur / 3); f.yaw = hd; this.nFish++;
        }
      }
    }
  }

  dolphinSplash(x, z, big) {
    const cam = this.cam;
    if (Math.hypot(x - cam[0], z - cam[2]) < 900) this.splash(x, z, big);
  }

  // ---- splash particles ----
  spawn(kind, x, y, z, vx, vy, vz, life, size, alpha, grow = 0) {
    const P = this.pool, i = P.head; P.head = (P.head + 1) % MAXFX;
    P.p[i * 3] = x; P.p[i * 3 + 1] = y; P.p[i * 3 + 2] = z; P.v[i * 3] = vx; P.v[i * 3 + 1] = vy; P.v[i * 3 + 2] = vz;
    P.age[i] = 0; P.life[i] = life; P.size[i] = size; P.kind[i] = kind; P.seed[i] = Math.random(); P.alpha[i] = alpha; P.grow[i] = grow;
  }
  spawnRing(x, z, r, a) { this.spawn(1, x, 0, z, 0, 0, 0, 2.2, r * 0.15, a, (r * 0.85) / 2.2); }
  spawnDrop(x, z, size, up, spread) { const a = Math.random() * TAU, s = spread * Math.random(); this.spawn(0, x, 0.05, z, Math.cos(a) * s, up, Math.sin(a) * s, 0.5 + up * 0.12, size, 0.9); }
  // a dolphin leaving (big 0) or entering (big 1) the sea, or a fish (-1)
  splash(x, z, big) {
    const q = this.lvl;
    if (big < 0) { this.spawnRing(x, z, 0.9, 0.7); for (let i = 0; i < 4; i++) this.spawnDrop(x, z, 0.04, 1.5 + Math.random() * 1.2, 0.5); return; }
    this.spawnRing(x, z, 2.6 + 1.5 * big, 0.9);
    this.spawn(1, x, 0, z, 0, 0, 0, 2.6, 0.4, 0.6, 1.5 + big);
    this.spawn(2, x, 0.25, z, 0, 0.5, 0, 1.6, 0.5, 0.7, 0.9 + 0.7 * big);
    const n = Math.floor((big ? 22 : 12) * q) + 2;
    for (let i = 0; i < n; i++) this.spawnDrop(x, z, 0.06 + 0.1 * Math.random(), 2.2 + 3.5 * Math.random() * (big ? 1.2 : 1), 1.8 + 1.5 * big);
  }
  fxStep(dt) {
    const P = this.pool, d = this.fx; let n = 0;
    for (let i = 0; i < MAXFX; i++) {
      if (P.age[i] >= P.life[i]) continue;
      P.age[i] += dt;
      const o = i * 3, kind = P.kind[i];
      if (kind < 0.5) { P.v[o + 1] -= G * dt; P.p[o] += P.v[o] * dt; P.p[o + 1] += P.v[o + 1] * dt; P.p[o + 2] += P.v[o + 2] * dt; if (P.p[o + 1] < 0 && P.v[o + 1] < 0) { P.age[i] = 1e9; continue; } }
      else if (kind > 1.5) { P.p[o + 1] += P.v[o + 1] * dt; P.v[o + 1] *= Math.exp(-2 * dt); P.size[i] += P.grow[i] * dt; }
      else P.size[i] += P.grow[i] * dt;
      if (P.age[i] >= P.life[i]) continue;
      const w = n++ * FXF;
      d[w] = P.p[o]; d[w + 1] = P.p[o + 1]; d[w + 2] = P.p[o + 2]; d[w + 3] = P.size[i];
      d[w + 4] = kind; d[w + 5] = P.age[i] / P.life[i]; d[w + 6] = P.seed[i]; d[w + 7] = P.alpha[i];
      d[w + 8] = P.v[o]; d[w + 9] = P.v[o + 1]; d[w + 10] = P.v[o + 2]; d[w + 11] = 0;
    }
    this.fxN = n;
  }

  // ===== drawing =====
  visible(x, y, z, r, far) {
    const cam = this.cam, dx = x - cam[0], dy = y - cam[1], dz = z - cam[2], d = Math.hypot(dx, dy, dz);
    if (d > far) return false;
    if (d < r + 1) return true;
    const app = this.game.app, c = app.cam;
    const half = Math.atan(Math.tan(c.fov / 2) * Math.hypot(1, app.w / app.h)) + Math.asin(Math.min(r / d, 1));
    return (dx * cam[3] + dy * cam[4] + dz * cam[5]) / d > Math.cos(Math.min(half, 3.1));
  }

  gpu() {
    const gl = this.gl;
    if (this.meshes) return;
    const B = birdBuffers(), mk = (data, loc, size, div = 0) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); if (typeof data === 'number') gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW); else gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0); if (div) gl.vertexAttribDivisor(loc, div); return b; };
    this.bp = new Program(gl, BIRD_VS, BIRD_FS, { label: 'wildlife-birds' });
    this.bvao = gl.createVertexArray(); gl.bindVertexArray(this.bvao);
    mk(B.pos, 0, 3); mk(B.nrm, 1, 3); mk(B.tag, 2, 4);
    this.ibuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.ibuf); gl.bufferData(gl.ARRAY_BUFFER, this.inst.byteLength, gl.DYNAMIC_DRAW);
    const ia = [[3, 0], [4, 4], [5, 8], [6, 12]];
    for (const [loc, off] of ia) { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, IF * 4, off * 4); gl.vertexAttribDivisor(loc, 1); }
    gl.bindVertexArray(null);
    this.birdVerts = B.count;
    this.fp = new Program(gl, FX_VS, FX_FS, { label: 'wildlife-fx' });
    this.fvao = gl.createVertexArray(); gl.bindVertexArray(this.fvao);
    this.fbuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.fbuf); gl.bufferData(gl.ARRAY_BUFFER, this.fx.byteLength, gl.DYNAMIC_DRAW);
    for (let k = 0; k < 3; k++) { gl.enableVertexAttribArray(k); gl.vertexAttribPointer(k, 4, gl.FLOAT, false, FXF * 4, k * 16); gl.vertexAttribDivisor(k, 1); }
    gl.bindVertexArray(null);
    const m = { dolphin: dolphinGeo(), fish: fishGeo() };
    this.meshes = {};
    for (const k in m) this.meshes[k] = { mesh: m[k].build(gl), tris: m[k].p.length / 9 };
    this.meshes.kelp = [1, 2, 3].map((s) => { const g = kelpGeo(s); return { mesh: g.build(gl), tris: g.p.length / 9 }; });
    this.meshes.log = [1, 2, 3].map((s) => { const g = logGeo(s); return { mesh: g.build(gl), tris: g.p.length / 9 }; });
    this.meshes.crate = [1, 2, 3].map((s) => { const g = crateGeo(s); return { mesh: g.build(gl), tris: g.p.length / 9 }; });
    this.meshes.pot = [0, 1, 2, 3].map((s) => { const g = potFloatGeo(s); return { mesh: g.build(gl), tris: g.p.length / 9 }; });
  }

  // a flag's mesh: the pole (static) and the cloth (rewritten each frame it is drawn)
  flagMesh(f) {
    const gl = this.gl, S = flagStatic(f.style, f.poleH), pole = S.pole, np = pole.p.length / 3, total = np + FLAG_CLOTH_VERTS;
    const pos = new Float32Array(total * 3), nrm = new Float32Array(total * 3), col = new Float32Array(total * 3), mat = new Float32Array(total * 3), uv = new Float32Array(total * 2);
    for (let i = 0; i < np; i++) {
      pos[i * 3] = pole.p[i * 3] + f.bx; pos[i * 3 + 1] = pole.p[i * 3 + 1] + f.by; pos[i * 3 + 2] = pole.p[i * 3 + 2] + f.bz;
      nrm.set(pole.n.slice(i * 3, i * 3 + 3), i * 3); col.set(pole.c.slice(i * 3, i * 3 + 3), i * 3); mat.set(pole.m.slice(i * 3, i * 3 + 3), i * 3);
    }
    col.set(S.col, np * 3); mat.set(S.mat, np * 3);
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const bufs = [pos, nrm, col, mat].map((d, loc) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, d, loc < 2 ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0); return b; });
    const ub = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, ub); gl.bufferData(gl.ARRAY_BUFFER, uv, gl.STATIC_DRAW); gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    f.mesh = { vao, count: total, pos, nrm, bufs, np };
    f.lod = { mesh: f.mesh, tris: total / 3 };
  }

  crewMeshes(c) {
    if (c.variants) return;
    const nv = c.waving ? WAVE_FRAMES : 1;
    c.variants = [];
    for (let v = 0; v < nv; v++) { const g = crewGeo(c.people, v); c.variants.push({ mesh: g.build(this.gl), tris: g.p.length / 9 }); }
  }

  put(m, lod, float, foot) {
    const p = m.prog;
    if (foot !== this.foot) { p.use(); p.set('uFoot', foot); this.foot = foot; }
    this.opt.float = float;
    m.draw(lod.mesh, this.mat, this.opt);
    this.stats.draws++; this.stats.tris += lod.tris;
  }

  draw(scene, m) {
    if (this.lvl <= 0 || !this.course) return;
    this.gpu();
    const gl = this.gl, cam = this.cam, mat = this.mat, st = this.stats, t = this.game.app.time;
    st.draws = 0; st.tris = 0;
    this.foot = 0;
    const wind = this.wind, wa = this.windAng;
    // flotsam
    const vis = this.lvl;
    for (const f of this.flot) {
      const d = Math.hypot(f.x - cam[0], f.z - cam[2]);
      if (d > f.cull * (0.5 + 0.5 * vis) || !this.visible(f.x, 0, f.z, f.r + 2, f.cull)) continue;
      const M = this.meshes[f.kind === 'pot' ? 'pot' : f.kind];
      const mm = Array.isArray(M) ? M[f.pot ? f.variant : f.variant % M.length] : M;
      rotY(mat, f.pot ? wa : f.yaw, f.x, f.kind === 'kelp' ? 0.03 : 0, f.z);
      this.put(m, mm, 1, f.foot);
    }
    // dolphins and fish: float mode puts the arc's height above the sea under them
    for (let i = 0; i < this.nDol; i++) { const d = this.dol[i]; poseMat(mat, d.x, d.y, d.z, d.yaw, d.pit); this.put(m, this.meshes.dolphin, 1, 0); }
    for (let i = 0; i < this.nFish; i++) { const d = this.fishList[i]; poseMat(mat, d.x, d.y, d.z, d.yaw, d.pit); this.put(m, this.meshes.fish, 1, 0); }
    // people, in their host's frame (a boat's own float mode, so they heave with it)
    const wave = Math.floor(t * 5);
    for (const c of this.crews) {
      const h = c.host;
      if (h) {
        if (!h.shown || h.d > 550) continue;
        rotY(mat, h.yaw + (h.sw || 0), h.x, 0, h.z);
        this.crewMeshes(c);
        this.put(m, c.variants[(wave + Math.floor(h.phase * 3)) % c.variants.length], 1, h.foot || 0);
      } else {
        const f = c.fixed;
        if (!this.visible(f.x, 4, f.z, 40, 550)) continue;
        rotY(mat, 0, f.x, 0, f.z);
        this.crewMeshes(c);
        this.put(m, c.variants[wave % c.variants.length], 0, 0);
      }
    }
    // flags
    for (const f of this.flags) {
      const h = f.host;
      let x, z, yaw, fl, foot, ok;
      if (h) { ok = h.shown && h.d < 450; x = h.x; z = h.z; yaw = h.yaw + (h.sw || 0); fl = h.float ? 1 : 0; foot = h.float ? h.foot || 0 : 0; }
      else { x = f.fixed.x; z = f.fixed.z; yaw = 0; fl = 0; foot = 0; ok = this.visible(x, f.by, z, 20, 450); }
      if (!ok) continue;
      if (!f.mesh) this.flagMesh(f);
      const M = f.mesh;
      const n = flagCloth(this.cloP, this.cloN, f.L, f.H, f.style === 'burgee' || f.style === 'pennant', wa - yaw, wind, t, f.seed);
      const o = M.np * 3, P = M.pos, N = M.nrm;
      for (let i = 0; i < n; i++) { P[o + i * 3] = this.cloP[i * 3] + f.bx; P[o + i * 3 + 1] = this.cloP[i * 3 + 1] + f.by; P[o + i * 3 + 2] = this.cloP[i * 3 + 2] + f.bz; N[o + i * 3] = this.cloN[i * 3]; N[o + i * 3 + 1] = this.cloN[i * 3 + 1]; N[o + i * 3 + 2] = this.cloN[i * 3 + 2]; }
      gl.bindBuffer(gl.ARRAY_BUFFER, M.bufs[0]); gl.bufferSubData(gl.ARRAY_BUFFER, o * 4, P, o, n * 3);
      gl.bindBuffer(gl.ARRAY_BUFFER, M.bufs[1]); gl.bufferSubData(gl.ARRAY_BUFFER, o * 4, N, o, n * 3);
      rotY(mat, yaw, x, 0, z);
      this.put(m, f.lod, fl, foot);
    }
    if (this.foot) { m.prog.use(); m.prog.set('uFoot', 0); this.foot = 0; }
    // birds: one instanced draw
    if (this.nInst > 0) {
      this.bp.use(scene);
      this.bp.set('uSp', SP); this.bp.set('uSp2', SP2); this.bp.set('uPal', PAL);
      gl.bindVertexArray(this.bvao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.ibuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.inst, 0, this.nInst * IF);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, this.birdVerts, this.nInst);
      gl.bindVertexArray(null);
      st.draws++; st.tris += this.nInst * this.birdVerts / 3;
    }
    // the mesh pass's own textures were rebound by the programs above
    m.begin(scene);
  }

  drawTransparent(scene) {
    if (this.fxN <= 0 || this.lvl <= 0 || !this.fp) return;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.fbuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.fx, 0, this.fxN * FXF);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    this.fp.use(scene);
    gl.bindVertexArray(this.fvao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.fxN);
    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    this.stats.fx = this.fxN;
  }
}
