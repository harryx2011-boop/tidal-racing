// The land: a chunked terrain mesh over the course's height field (landfield.js), drawn in the main pass
// before the sea, with its own shader (the mesh pass is not touched). The sea reads the same field through
// waterUniforms(): depth for the shallows and surf, and the fixed structures that stand in the water.
//
// Mesh. The racing area (the near field, a 3-4 m texel) is cut into 256 m chunks, each drawn at one of four
// levels of detail by distance (a grid of 64, 32, 16 or 8 cells a side: 4, 8, 16, 32 m), every level one
// shared vertex grid placed by uniforms; heights come from the height texture in the vertex shader, so a
// chunk is one draw and costs no vertex memory. A skirt round each chunk hides the cracks between levels.
// Beyond the near field two rings of coarse blocks (64 m and 256 m cells, out to 20 km) read the far field
// (64 m per texel), so distant hills stand on the horizon. Chunks and blocks that lie wholly under 4 m of
// water are not drawn (the sea covers them), and the rest are culled against the view.
//
// Surface. Procedural, from height, slope and place:
//   rock    bedded and jointed (beds, laminations, joint cracks, a tone per block, iron staining), with the
//           zones of a rocky shore by height: weed, barnacles, the black lichen band, orange and grey lichen,
//           guano streaks; wet and glistening in the splash zone
//   grass   several greens, heather on the higher ground, bracken, gorse, bare earth and terracettes on steep
//           banks, scree under the rock, salt-burnt turf above the shore
//   farmed  strip fields, each its own crop and its rows, hedged below and walled with stone higher up, and
//           lanes wandering across them (models/cover.js: the same functions plant the hedgerow trees)
//   woods   dark ground under the trees the coastal system plants, and a painted canopy beyond their range
//   beach   wet and dry sand, ripples, a wrack line, shingle banks, and the swash running up with the swell
//   made    the apron of a quay: setts along the edge, a worn yellow line, concrete bays, a roadway
// Every pattern fades to its mean as its period nears the pixel, and lines (hedges, lanes, joints) widen to a
// pixel and thin out, so the far hills keep their fields without shimmering.
//
// Ground meshes. Anything that is ground but not height field (a quay deck, a slipway, boulders, skerries, the
// shell of a sea stack) is drawn here too, through the same fragment shader, so rock is one rock and paving one
// paving wherever it lies: a mesh in the shared vertex format whose material id is the kind of ground
// (GROUND below). The coastal system builds them and hands them over in `ground`.
//
// Light. The sun (cloud shadows, terrain shadows marched through the height field at a low sun, and the
// shadows of buildings, quay furniture and trees marched through a top-down height map of them that the
// coastal system renders once per course), the sky above and the sea below, a little light bounced off the
// ground, contact darkening round whatever stands on it, the pools under the nearest lamp posts at dusk;
// then aerial perspective and fog as everything.
//
// Cost (unmeasured; software GL only): triangles per chunk 8.7k / 2.3k / 0.6k / 0.2k at the four levels; a
// typical view draws 6-12 chunks at the top level, 10-20 at the next and a few dozen coarser ones, so on the
// order of 100-200k triangles and 30-100 draws; the two rings are eight strips of 90-100k triangles in all,
// drawn only when in view. A terrain fragment: 5 height taps, 12 more for the terrain shadow below about 35
// degrees of sun within 4 km, 22 taps of the object map inside its rectangle only, and some 60 hashed noise
// lookups (none of them a texture).
import { Program, Texture, makeMesh } from '../gl.js';
import { SKY_LOOKUP_GLSL } from '../sky/atmosphere.js';
import { LAND_COMMON_GLSL, LAND_COVER_GLSL } from './landgl.js';
import { landFor, waveAtt } from './landfield.js';
export { GROUND } from './models/cover.js';

const CHUNK = 256;
const LODS = [{ n: 64, to: 420 }, { n: 32, to: 1000 }, { n: 16, to: 2400 }, { n: 8, to: 1e9 }];
const RING1 = { cell: 64, reach: 3072 }, RING2 = { cell: 256 };
const SEA_SKIP = -4;       // ground wholly deeper than this never shows through the sea
export const LAMPS = 8;    // lamp posts whose light falls on the ground at once

const VS = `
layout(location = 0) in vec3 aG;      // grid x, z in 0..1, skirt flag
uniform vec4 uChunk;                  // x0, z0, size x, size z
uniform float uSkirt;
uniform float uFar;                   // 1: height from the far field
uniform sampler2D uHN;
uniform sampler2D uHF;
uniform vec4 uRectN, uRectF;
uniform mat4 uViewProj;
uniform vec3 uCamPos;
out vec3 vWorld;
out vec3 vNrm;
out vec3 vTint;
out float vKind;
out float vScale;
void main() {
  vec2 xz = uChunk.xy + aG.xy * uChunk.zw;
  float h = uFar > 0.5 ? textureLod(uHF, (xz - uRectF.xy) * uRectF.zw, 0.0).r : textureLod(uHN, (xz - uRectN.xy) * uRectN.zw, 0.0).r;
  h -= aG.z * uSkirt;
  vec3 P = vec3(xz.x, h, xz.y);
  float dr = length(P.xz - uCamPos.xz);
  P.y -= dr * dr / (2.0 * 6360000.0);
  vWorld = P; vNrm = vec3(0.0, 1.0, 0.0); vTint = vec3(1.0); vKind = 0.0; vScale = 1.0;
  gl_Position = uViewProj * vec4(P, 1.0);
}`;

// ground meshes: the shared vertex format, positions relative to uOrigin, world axes
const MESH_VS = `
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aN;
layout(location = 2) in vec3 aCol;
layout(location = 3) in vec3 aMat;
uniform vec3 uOrigin;
uniform mat4 uViewProj;
uniform vec3 uCamPos;
out vec3 vWorld;
out vec3 vNrm;
out vec3 vTint;
out float vKind;
out float vScale;                     // rock: how much finer than a cliff's its beds and joints are (a boulder is a small thing)
void main() {
  vec3 P = aPos + uOrigin;
  float dr = length(P.xz - uCamPos.xz);
  P.y -= dr * dr / (2.0 * 6360000.0);
  vWorld = P; vNrm = aN; vTint = aCol; vKind = aMat.x; vScale = max(aMat.y, 1.0);
  gl_Position = uViewProj * vec4(P, 1.0);
}`;

const FS = SKY_LOOKUP_GLSL + LAND_COMMON_GLSL + LAND_COVER_GLSL + `
in vec3 vWorld;
in vec3 vNrm;
in vec3 vTint;
in float vKind;
in float vScale;
out vec4 oColor;
uniform vec3 uCamPos;
uniform float uFar;
uniform float uTexel;                 // metres per texel of the field in use
uniform sampler2D uHN;
uniform sampler2D uHF;
uniform vec4 uRectN, uRectF;
uniform sampler2D uEnv;
uniform vec3 uFlash;
uniform vec3 uRrs;
uniform float uRain;
uniform float uTime;
uniform float uHs;
uniform vec2 uWindDir;
uniform vec4 uQuayA[2];               // a quay's apron: the middle of its water edge (x, z), the way it faces (cos, sin)
uniform vec4 uQuayB[2];               // half its width, its depth inland, how far it flares, how deep it is paved (x = 0: none)
uniform sampler2D uObjH;              // the heights of what stands on the ground, seen from above (coastal.js)
uniform vec4 uObjRect;                // its rectangle: x0, z0, 1 / width, 1 / depth (z = 0: none)
uniform float uObjTexel;              // metres a texel
uniform float uTreeFar;               // beyond this the trees are not drawn and the woods are painted on the ground
uniform vec4 uLampP[${LAMPS}];        // the lamp posts nearest the camera: position, strength
uniform float uLampOn;                // 0 by day .. 1 in the dark
const float PI = 3.14159265359;

float H(vec2 p) {
  return uFar > 0.5 ? textureLod(uHF, (p - uRectF.xy) * uRectF.zw, 0.0).r : textureLod(uHN, (p - uRectN.xy) * uRectN.zw, 0.0).r;
}
float h11f(float x) { return fract(sin(x * 127.1 + 1.7) * 43758.5453); }
float h12(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float vn(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h12(i), h12(i + vec2(1.0, 0.0)), f.x), mix(h12(i + vec2(0.0, 1.0)), h12(i + vec2(1.0, 1.0)), f.x), f.y);
}
float h13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vn3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h13(i), h13(i + vec3(1, 0, 0)), f.x), mix(h13(i + vec3(0, 1, 0)), h13(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h13(i + vec3(0, 0, 1)), h13(i + vec3(1, 0, 1)), f.x), mix(h13(i + vec3(0, 1, 1)), h13(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
// one octave of frequency f (1/m) that fades to its mean as its period nears the pixel footprint fp (m)
float vnf(vec2 p, float f, float fp) { return mix(0.5, vn(p * f), 1.0 - smoothstep(0.25, 0.6, fp * f)); }
// zero-mean fractal noise from base frequency f0 (1/m): an octave fades out as its period nears the pixel
// footprint fp (m), so distant ground goes smoothly to its mean instead of shimmering
float dfbm(vec2 p, float fp, float f0) {
  float a = 0.5, s = 0.0, f = f0;
  for (int i = 0; i < 5; i++) {
    s += a * (vn(p * f) - 0.5) * (1.0 - smoothstep(0.25, 0.6, fp * f));
    a *= 0.5; f *= 2.1;
  }
  return s;
}
vec2 equirectUv(vec3 d) { return vec2(atan(d.z, d.x) / (2.0 * PI) + 0.5, acos(clamp(d.y, -1.0, 1.0)) / PI); }

// the sun's shadow from the ground itself: a few steps toward the sun through the height field
float terrainShadow(vec2 p, float h0, vec3 L, float dist) {
  if (L.y > 0.58 || dist > 4000.0) return 1.0;
  vec2 dir = normalize(L.xz + 1e-5);
  float slope = L.y / max(length(L.xz), 1e-3);
  float vis = 1.0, t = 2.5;
  for (int i = 0; i < 12; i++) {
    float rayH = h0 + 0.6 + t * slope;
    float hh = H(p + dir * t);
    vis = min(vis, clamp((rayH - hh) / (0.12 * t + 1.0) + 0.5, 0.0, 1.0));
    t *= 1.65;
  }
  return mix(vis, 1.0, smoothstep(2500.0, 4000.0, dist));
}

// What stands on the ground (buildings, quay furniture, trees) from its top-down height map: x, how much of
// the sun gets past it (a march toward the sun, the penumbra widening with distance); y, how much of the sky
// (a ring of taps: ground at the foot of a wall or under an eave is darker).
float objH(vec2 q, float lod) { return textureLod(uObjH, (q - uObjRect.xy) * uObjRect.zw, lod).r; }
vec2 objShade(vec2 p, float h0, vec3 L) {
  vec2 uv = (p - uObjRect.xy) * uObjRect.zw;
  if (uObjRect.z <= 0.0 || min(uv.x, uv.y) < 0.0 || max(uv.x, uv.y) > 1.0) return vec2(1.0);
  float vis = 1.0;
  if (L.y > 0.02) {
    vec2 dir = normalize(L.xz + 1e-5);
    float slope = L.y / max(length(L.xz), 1e-3), t = 0.3;
    for (int i = 0; i < 14; i++) {
      float rayH = h0 + 0.1 + t * slope;
      // (the further the thing that casts it, the wider the sun's disc smears its edge: a coarser level of the map)
      float lod = clamp(log2(max(t * 0.1 / uObjTexel, 1.0)), 0.0, 4.0);
      vis = min(vis, clamp((rayH - objH(p + dir * t, lod)) / (0.1 * t + 0.15) + 0.5, 0.0, 1.0));
      t *= 1.5;
    }
  }
  float occ = 0.0;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.7854 + 0.3, r = (i & 1) == 0 ? 0.8 : 2.0;
    occ += clamp((objH(p + vec2(cos(a), sin(a)) * r, 1.0) - h0 - 0.15) / (r * 1.6), 0.0, 1.0);
  }
  float under = smoothstep(0.4, 1.2, objH(p, 1.0) - h0);
  return vec2(vis, (1.0 - 0.6 * occ / 8.0) * (1.0 - 0.35 * under));
}

// lamp posts: the pools of light on the ground under the nearest few (relative units; scaled by the ambient light where used)
vec3 lampLight(vec3 P, vec3 N) {
  vec3 E = vec3(0.0);
  if (uLampOn <= 0.0) return E;
  for (int i = 0; i < ${LAMPS}; i++) {
    vec4 l = uLampP[i];
    if (l.w <= 0.0) continue;
    vec3 d = l.xyz - P;
    float r2 = dot(d, d);
    E += l.w * max(dot(N, d) * inversesqrt(r2), 0.0) / (r2 + 3.0) * (1.0 - smoothstep(16.0, 28.0, sqrt(r2)));
  }
  return E * vec3(1.0, 0.7, 0.36) * uLampOn;
}

// Rock: beds dipping gently, each its own tone, cut by joints that run down the face and stagger from bed to
// bed, so a face breaks into blocks; ribs and gullies a few metres across; iron staining in some beds; guano
// streaked down from the ledges of the higher beds. crev: how deep in a joint, a gully or under a ledge the
// point lies (it takes less light there). bump: how the beds and ribs turn the surface (ledge tops look up).
// P is the point in space, so a cliff is not a stretched map.
vec3 rockLook(vec3 P, vec3 Ng, float fp, float n1, float n2, out float crev, out vec3 bump) {
  float fo1 = 1.0 - smoothstep(0.3, 0.8, fp * 0.55);      // the thin beds resolve
  float fo2 = 1.0 - smoothstep(0.08, 0.3, fp);            // joints, laminations
  float fo0 = 1.0 - smoothstep(0.3, 0.8, fp * 0.16);      // the great beds
  float face = smoothstep(0.15, 0.4, 1.0 - Ng.y);
  // level, along the face: one of the two axes, whichever the face lies nearer (a direction taken from the normal
  // itself would swing the pattern metres for every degree the normal wanders)
  vec2 tdir = abs(Ng.x) > abs(Ng.z) ? vec2(0.0, 1.0) : vec2(1.0, 0.0);
  float al = dot(P.xz, tdir) + (abs(Ng.x) > abs(Ng.z) ? 37.0 : 0.0);
  float wv = vn(P.xz * 0.045 + 3.0);
  // (the beds wander a little in space, so their lines do not follow the mesh's own facets too faithfully)
  float s = P.y * 0.55 + P.x * 0.07 - P.z * 0.04 + 2.2 * wv + 0.25 * n2 + 0.9 * (vn3(P * 0.19 + 11.0) - 0.5) + 0.35 * (vn3(P * 0.6 + 5.0) - 0.5) * fo1;
  // great beds of uneven thickness (3 to 9 m), each stepping back from the one below: these carry the ledges
  float s0 = s * 0.3 + 0.9 * vn(vec2(s * 0.23, 7.0));
  float B0 = floor(s0), bf0 = s0 - B0;
  float tone0 = h11f(B0 * 1.7 + 0.3);
  // thin beds within them: tone only, and a fine line
  float b1 = floor(s), bf1 = s - b1;
  float tone1 = h11f(b1);
  float under = (1.0 - smoothstep(0.0, 0.07 + fp * 0.3, bf0)) * fo0;
  float ledge = smoothstep(0.82, 1.0, bf0) * fo0;
  float seam = (1.0 - smoothstep(0.0, 0.1 + fp * 0.6, bf1)) * fo1 * (0.3 + 0.7 * h11f(b1 + 5.0));
  float lam = 0.5 + 0.5 * sin(s * 31.0 + 5.0 * vn(P.xz * 0.35));
  // joints run down the face, a few metres apart, and stagger from one great bed to the next; not every one is open
  float jsp = 3.0 + 6.0 * tone0;
  float ja = al / jsp + tone0 * 7.0 + 0.35 * vn(vec2(P.y * 0.3, B0));
  float jc = floor(ja), dj = (0.5 - abs(ja - jc - 0.5)) * jsp;
  float open = step(0.35, h12(vec2(jc + step(0.5, ja - jc), B0 * 3.1)));
  float joint = (1.0 - smoothstep(0.0, 0.05 + fp * 0.6, dj)) * fo2 * face * open;
  float blk = h12(vec2(jc, B0 * 7.3));
  // ribs and gullies down the face, and the dark streaks where water runs
  float fr = 1.0 - smoothstep(0.3, 0.8, fp * 0.16);
  float g0 = vn(vec2(al * 0.16, 3.7)), g1 = vn(vec2(al * 0.47, 9.1));
  float rg = (vn(vec2((al + 0.8) * 0.16, 3.7)) - vn(vec2((al - 0.8) * 0.16, 3.7))) + 0.5 * (vn(vec2((al + 0.4) * 0.47, 9.1)) - vn(vec2((al - 0.4) * 0.47, 9.1))) * fo1;
  float gully = (1.0 - smoothstep(0.15, 0.4, g0)) * 0.5 + (1.0 - smoothstep(0.12, 0.35, g1)) * 0.3 * fo1;
  float streak = smoothstep(0.55, 0.75, vn(vec2(al * 0.9, 1.3)) * 0.65 + vn(vec2(al * 3.1, P.y * 0.08)) * 0.35) * face * fo1;
  vec3 c = mix(vec3(0.215, 0.195, 0.17), vec3(0.385, 0.345, 0.29), mix(0.5, tone0 * 0.6 + tone1 * 0.4 * fo1 + 0.2 * (1.0 - fo1), fo0));
  c = mix(c, vec3(0.34, 0.235, 0.15), 0.45 * smoothstep(0.55, 0.8, wv + 0.3 * tone0 - 0.15));
  c *= mix(1.0, 0.82 + 0.36 * blk, fo2) * mix(1.0, 0.9 + 0.2 * lam, fo2 * 0.7) * (0.84 + 0.5 * n1) * (0.92 + 0.3 * n2);
  c *= 1.0 - 0.3 * streak - 0.22 * seam;
  float gs = smoothstep(0.6, 0.8, vn(vec2(al * 0.7, B0 * 3.1 + 1.0))) * smoothstep(0.1, 0.9, bf0) * smoothstep(6.0, 11.0, P.y) * face * fo0;
  c = mix(c, vec3(0.6, 0.6, 0.56), gs * 0.5);
  crev = max(max(under * 0.85, joint), gully * fr * face);
  bump = (vec3(tdir.x, 0.0, tdir.y) * rg * -2.6 * fr + vec3(0.0, ledge * 1.6 - 0.3 * fo0 * (1.0 - bf0), 0.0)) * face;
  return c;
}

// The made ground of a quay, if p lies on one: x metres along its edge, y metres back from it, z its paved depth, w 1.
// (m: a margin, for a deck mesh that overhangs its apron)
vec4 quayAt(vec2 p, float m) {
  for (int i = 0; i < 2; i++) {
    vec4 A = uQuayA[i], B = uQuayB[i];
    if (B.x <= 0.0) continue;
    vec2 d = p - A.xy;
    float zin = -(d.x * A.z + d.y * A.w), x = d.y * A.z - d.x * A.w;
    if (zin > -2.0 - m && zin < B.y + m && abs(x) < B.x + B.z * clamp(zin / B.y, 0.0, 1.0) + m) return vec4(x, zin, B.w, 1.0);
  }
  return vec4(0.0);
}
// A working quay: granite setts along the edge, a worn yellow line, cast concrete bays, a tarmac roadway with
// its lines, drains across, oil and damp. q: metres along the quay and back from its edge. gloss: standing water.
vec3 pavedLook(vec2 q, float fp, float n1, float n2, out float gloss) {
  float z = q.y;
  float fo = 1.0 - smoothstep(0.3, 1.2, fp);
  float fine = 1.0 - smoothstep(0.03, 0.12, fp);
  vec2 sz = vec2(4.5, 3.6);
  vec2 cq = q / sz; cq.x += 0.5 * mod(floor(cq.y), 2.0);
  vec2 ci = floor(cq), cf = cq - ci;
  vec2 cd = min(cf, 1.0 - cf) * sz;
  float we = max(0.025, fp * 0.6);
  float cj = (1.0 - smoothstep(we, we + max(fp, 0.01), min(cd.x, cd.y))) * sqrt(0.025 / we) * fo;
  vec3 c = vec3(0.3, 0.295, 0.275) * (0.84 + 0.26 * h12(ci + 3.7)) * (1.0 - 0.5 * cj);
  // setts: the first three metres
  float setts = 1.0 - smoothstep(2.9, 3.0, z);
  vec2 sq = q / vec2(0.24, 0.14); sq.x += 0.5 * mod(floor(sq.y), 2.0);
  vec2 si = floor(sq), sf = sq - si;
  vec2 sd = min(sf, 1.0 - sf) * vec2(0.24, 0.14);
  float sj = (1.0 - smoothstep(0.008, 0.02 + fp, min(sd.x, sd.y))) * fine;
  vec3 sc = vec3(0.21, 0.205, 0.2) * mix(1.0, 0.75 + 0.5 * h12(si), fine) * (1.0 - 0.55 * sj);
  c = mix(c, sc, setts);
  // the roadway, its edge lines and centre dashes worn thin
  float road = smoothstep(11.0, 11.15, z) * (1.0 - smoothstep(17.35, 17.5, z));
  vec3 rc = vec3(0.05, 0.05, 0.052) * (0.85 + 0.3 * mix(0.5, h12(floor(q * 40.0)), fine)) * (0.9 + 0.3 * n2);
  float lw = max(0.06, fp * 0.5), lk = sqrt(0.06 / lw), le = lw + fp + 0.01;
  float edge = max(1.0 - smoothstep(lw, le, abs(z - 11.35)), 1.0 - smoothstep(lw, le, abs(z - 17.15)));
  float dash = (1.0 - smoothstep(lw, le, abs(z - 14.25))) * step(fract(q.x / 9.0), 0.33);
  rc = mix(rc, vec3(0.5, 0.5, 0.47), max(edge, dash) * lk * (0.45 + 0.55 * smoothstep(0.3, 0.6, vn(q * 1.7))) * (1.0 - smoothstep(1.5, 4.0, fp)));
  c = mix(c, rc, road);
  float yl = (1.0 - smoothstep(lw, le, abs(z - 3.3))) * lk * (0.4 + 0.6 * smoothstep(0.25, 0.55, vn(q * 2.3 + 5.0))) * (1.0 - smoothstep(1.0, 3.0, fp));
  c = mix(c, vec3(0.5, 0.36, 0.03), yl * 0.85);
  // parking bays marked out between the working strip and the roadway, their lines half worn away
  float bay = (1.0 - smoothstep(lw, le, abs(fract(q.x / 2.9) - 0.5) * 2.9)) * step(6.2, z) * step(z, 10.7) * lk * smoothstep(0.35, 0.6, vn(q * 1.3 + 17.0)) * (1.0 - smoothstep(1.0, 3.0, fp)) * (1.0 - road);
  c = mix(c, vec3(0.46, 0.46, 0.43), bay * 0.8);
  // tyre marks along the roadway and where vans turn in, patches of new concrete, iron covers
  float tm = smoothstep(0.62, 0.8, vn(vec2(q.x * 0.11, q.y * 1.9) + 3.0)) * (1.0 - smoothstep(0.6, 2.0, fp));
  c *= 1.0 - 0.3 * tm * smoothstep(5.0, 7.0, z);
  float pch = step(0.86, h12(ci + 11.3)) * (1.0 - road) * (1.0 - setts);
  c = mix(c, vec3(0.36, 0.355, 0.34), pch * 0.6);
  vec2 mq = fract(q / vec2(19.0, 13.0) + 0.37) * vec2(19.0, 13.0) - vec2(9.5, 6.5);
  float mh = (1.0 - smoothstep(0.32, 0.34 + fp, max(abs(mq.x), abs(mq.y)))) * (1.0 - smoothstep(0.3, 1.0, fp)) * step(3.5, z);
  c = mix(c, vec3(0.06, 0.055, 0.05) * (0.8 + 0.4 * step(0.5, fract(mq.x * 6.0))), mh * 0.9);
  float st = smoothstep(0.6, 0.78, vn(q * 0.23 + 9.0) * 0.6 + vn(q * 0.9) * 0.4);
  c *= 1.0 - 0.45 * st * (1.0 - smoothstep(2.0, 6.0, fp));
  c *= 0.9 + 0.25 * n2 + 0.3 * n1 * fo;
  float dr = (1.0 - smoothstep(0.1, 0.14 + fp, abs(fract(q.x / 27.0) - 0.5) * 27.0)) * (1.0 - road) * step(3.3, z) * (1.0 - smoothstep(0.5, 1.5, fp));
  c *= 1.0 - 0.6 * dr;
  float pud = smoothstep(0.66, 0.74, vn(q * 0.17 + 31.0) * 0.7 + vn(q * 0.6) * 0.3);
  c *= 1.0 - 0.3 * pud;
  gloss = pud;
  return c;
}

void main() {
  vec2 p = vWorld.xz;
  vec3 toCam = uCamPos - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  float fp = length(fwidth(vWorld));
  int kind = int(vKind + 0.5);
  // height and normal: the field's (a ring of taps spread as wide as the pixel, so far ground is a smooth average) or the mesh's
  float h = vWorld.y;
  vec3 Ng = normalize(vNrm);
  if (kind == 0) {
    h = H(p);
    float e = max(uTexel, fp * 1.2);
    // (the sea covers the bed below its deepest trough: nothing of it shows, so nothing is worked out for it)
    if (h < -3.5) { oColor = vec4(vec3(0.05, 0.06, 0.05) * skyIrradiance() / PI, 1.0); return; }
    Ng = normalize(vec3(H(p - vec2(e, 0.0)) - H(p + vec2(e, 0.0)), 2.0 * e, H(p - vec2(0.0, e)) - H(p + vec2(0.0, e))));
  } else if (dot(Ng, V) < 0.0) Ng = -Ng;
  vec3 P3 = vec3(p.x, h, p.y);
  float sl = 1.0 - Ng.y;

  float n1 = dfbm(p, fp, 0.9);
  float n2 = dfbm(p + 31.0, fp, 0.07);
  float n3 = vn(p * 0.011 + 5.0) - 0.5;
  float far = smoothstep(0.4, 1.4, fp);
  float fine = 1.0 - smoothstep(0.04, 0.2, fp);

  // what the ground is: rock on slopes and peaks, sand low and flat, grass between
  float rock = smoothstep(0.2, 0.4, sl + 0.1 * n2);
  rock = max(rock, smoothstep(170.0, 330.0, h + 50.0 * n2));
  // (sand is the beach face only: the flat ground behind it is grass, or a low shore seen from the sea is one pale band)
  float sand = (1.0 - smoothstep(1.3, 2.6, h + 1.4 * n2 + 0.7 * n1)) * (1.0 - rock);
  if (kind >= 2) { rock = 1.0; sand = 0.0; }

  // ---- grass and what grows in it ----
  vec3 grass = mix(vec3(0.062, 0.1, 0.03), vec3(0.125, 0.12, 0.042), smoothstep(-0.2, 0.25, n2));
  grass = mix(grass, vec3(0.045, 0.085, 0.026), smoothstep(0.05, 0.3, n3));
  grass = mix(grass, vec3(0.14, 0.125, 0.055), smoothstep(0.1, 0.4, -n3) * 0.6);
  grass *= 0.8 + 0.7 * n1;
  float moor = smoothstep(40.0, 120.0, h + 60.0 * n3);
  float heather = smoothstep(0.5, 0.6, vnf(p + 250.0, 0.043, fp) * 0.6 + vnf(p + 17.0, 0.17, fp) * 0.4) * (0.2 + 0.8 * moor);
  float bracken = smoothstep(0.56, 0.66, vnf(p + 410.0, 0.057, fp) * 0.6 + vnf(p + 7.0, 0.21, fp) * 0.4) * (1.0 - 0.6 * moor);
  float scrub = smoothstep(0.52, 0.78, vn(p * 0.21) * 0.6 + vn(p * 0.93) * 0.4) * (1.0 - far);
  grass = mix(grass, vec3(0.085, 0.055, 0.062) * (0.8 + 0.5 * n1), heather * 0.8);
  grass = mix(grass, vec3(0.135, 0.085, 0.03) * (0.8 + 0.5 * n1), bracken * 0.75);
  // (gorse: dark clumps, in flower seen close)
  grass = mix(grass, mix(vec3(0.026, 0.048, 0.02), vec3(0.33, 0.27, 0.03), fine * smoothstep(0.6, 0.8, vn(p * 6.0)) * 0.7), 0.7 * scrub);
  grass = mix(grass, vec3(0.085, 0.093, 0.045), smoothstep(60.0, 190.0, h));
  grass = mix(grass, vec3(0.13, 0.125, 0.06), (1.0 - smoothstep(2.5, 9.0, h)) * 0.5);

  // ---- farmed land: strip fields, hedges and walls ----
  float wood = woodsAt(p) * woodsGate(h, Ng.y);
  float fgate = fieldGate(h, Ng.y) * fieldMask(p) * (1.0 - wood);
  vec4 fl = fieldAt(p);
  float fid = fl.y;
  vec3 fcol = fid < 0.5 ? mix(vec3(0.05, 0.105, 0.025), vec3(0.115, 0.165, 0.045), fid * 2.0)
            : fid < 0.68 ? vec3(0.25, 0.21, 0.09)
            : fid < 0.8 ? vec3(0.12, 0.08, 0.05)
            : vec3(0.035, 0.075, 0.028);
  // (mowing lines and furrows along the strip, two metres apart)
  fcol *= 1.0 + (fid < 0.5 ? 0.06 : 0.16) * sin(fl.w * 3.14159) * (1.0 - smoothstep(0.25, 0.8, fp));
  fcol *= (0.85 + 0.5 * n1) * (0.92 + 0.25 * n2);
  grass = mix(grass, fcol, fgate * 0.95);
  float stone = smoothstep(55.0, 80.0, h + 30.0 * n3);
  float bw = mix(1.7, 0.6, stone), bwe = max(bw, fp * 0.55);
  float hedge = (1.0 - smoothstep(bwe, bwe + max(fp, 0.3), fl.x)) * sqrt(bw / bwe) * fgate;
  grass = mix(grass, mix(vec3(0.018, 0.035, 0.014), vec3(0.17, 0.165, 0.15), stone) * (0.8 + 0.6 * n1), hedge * 0.92);

  // ---- steep banks: bare earth, terracettes, scree under the rock ----
  float steep = smoothstep(0.1, 0.19, sl + 0.05 * n2) * (1.0 - rock);
  float earth = steep * smoothstep(0.45, 0.7, vnf(p + 91.0, 0.33, fp));
  grass = mix(grass, vec3(0.115, 0.082, 0.052) * (0.8 + 0.5 * n1), earth * 0.8);
  float scree = smoothstep(0.14, 0.22, sl + 0.08 * n2) * (1.0 - rock) * smoothstep(0.3, 0.6, vnf(p + 57.0, 0.12, fp));
  vec3 screeC = vec3(0.2, 0.185, 0.16) * (0.7 + 0.6 * mix(0.5, h12(floor(p * 2.2)), 1.0 - smoothstep(0.1, 0.35, fp * 2.2)));
  grass = mix(grass, screeC, scree * 0.8);
  grass *= 1.0 - 0.12 * steep * (0.5 + 0.5 * sin(h * 5.0 + n2 * 6.0)) * (1.0 - smoothstep(0.15, 0.5, fp));

  // ---- woods: the dark floor under the trees; beyond their range the canopy itself ----
  grass = mix(grass, vec3(0.03, 0.04, 0.018) * (0.8 + 0.6 * n1), wood * 0.85);
  float canopy = wood * smoothstep(uTreeFar * 0.85, uTreeFar * 1.05, dist);
  float crown = vnf(p + 3.0, 0.12, fp) * 0.6 + vnf(p + 29.0, 0.31, fp) * 0.4;
  grass = mix(grass, mix(vec3(0.02, 0.036, 0.014), vec3(0.062, 0.088, 0.03), crown) * (0.9 + 0.3 * n3), canopy);

  // ---- lanes ----
  float td = trackD(p);
  float twe = max(1.6, fp * 0.5);
  float track = (1.0 - smoothstep(twe, twe + max(fp, 0.4), td)) * sqrt(1.6 / twe) * smoothstep(0.88, 0.94, Ng.y) * smoothstep(4.0, 7.0, h) * (1.0 - smoothstep(150.0, 200.0, h)) * (1.0 - rock);
  // (a strip of grass down the middle, seen close)
  track *= 1.0 - 0.7 * (1.0 - smoothstep(0.2, 0.45, td)) * (1.0 - smoothstep(0.1, 0.4, fp));
  grass = mix(grass, vec3(0.21, 0.18, 0.125) * (0.85 + 0.4 * n1), track * 0.9);

  // ---- the beach ----
  vec3 sandC = mix(vec3(0.3, 0.245, 0.15), vec3(0.37, 0.31, 0.2), smoothstep(-0.2, 0.2, n2)) * (0.88 + 0.5 * n1);
  sandC *= mix(0.92, 1.08, smoothstep(0.9, 1.6, h));
  float sh = smoothstep(0.5, 0.62, vnf(p + 19.0, 0.045, fp) * 0.7 + vnf(p + 3.0, 0.31, fp) * 0.3) * smoothstep(0.5, 1.1, h);
  float peb = mix(0.5, h12(floor(p * 7.0)), 1.0 - smoothstep(0.1, 0.3, fp * 7.0)) * 0.6 + mix(0.5, h12(floor(p * 2.3 + 0.5)), 1.0 - smoothstep(0.1, 0.3, fp * 2.3)) * 0.4;
  sandC = mix(sandC, mix(vec3(0.13, 0.125, 0.12), vec3(0.34, 0.32, 0.29), peb), sh * 0.9);
  // the wrack line: weed and litter left at the top of the last tide, and a fainter older one above
  float wl = h + 0.25 * n2 + 0.1 * n1;
  float wr = (1.0 - smoothstep(0.03, 0.16, abs(wl - 0.95))) * smoothstep(0.3, 0.55, vnf(p + 7.0, 0.8, fp));
  wr = max(wr, 0.5 * (1.0 - smoothstep(0.03, 0.12, abs(wl - 1.55))) * smoothstep(0.45, 0.65, vnf(p + 77.0, 0.6, fp)));
  sandC = mix(sandC, vec3(0.045, 0.036, 0.025), wr * 0.85 * (1.0 - smoothstep(0.3, 1.2, fp)));
  sandC *= 1.0 + 0.06 * fine * sin(dot(p, uWindDir) * 14.0 + n2 * 24.0) * (1.0 - smoothstep(0.4, 1.0, h));

  // ---- rock, and the zones of a rocky shore ----
  float crev;
  vec3 rbump;
  vec3 rockC = rockLook(P3 * vScale, Ng, fp * vScale, n1, n2, crev, rbump);
  if (kind == 3) {
    // weathered concrete (a slipway, steps): cast in bays, ribbed across for grip
    rockC = vec3(0.27, 0.265, 0.25) * (0.85 + 0.3 * n2 + 0.3 * n1) * (1.0 - 0.25 * (1.0 - smoothstep(0.02, 0.05 + fp, abs(fract(dot(p, uQuayA[0].zw) / 0.5) - 0.5) * 0.5)) * (1.0 - smoothstep(0.1, 0.3, fp)));
    crev = 0.0; rbump = vec3(0.0);
  }
  crev *= rock;
  // (rock that lies flat on a hilltop is weathered grey and half grown over, not a fresh face)
  if (kind == 0) rockC = mix(rockC, mix(rockC * 0.55, grass, 0.45), 1.0 - smoothstep(0.1, 0.28, sl));
  vec3 albedo = mix(mix(grass, sandC, sand), rockC, rock);
  float hard = rock;
  float zn = (h + 0.5 * (vnf(p, 0.6, fp) - 0.5) + 0.25 * n1) / (1.0 + 0.25 * uHs);
  float lich = 1.0 - smoothstep(0.4, 1.5, fp);
  float weed = 1.0 - smoothstep(0.1, 0.7, zn);
  float barn = smoothstep(0.45, 0.8, zn) * (1.0 - smoothstep(1.1, 1.6, zn)) * (0.35 + 0.65 * vnf(p + 9.0, 3.1, fp));
  float tar = smoothstep(1.0, 1.5, zn) * (1.0 - smoothstep(2.2, 3.4, zn));
  float xan = smoothstep(2.4, 3.2, zn) * (1.0 - smoothstep(4.5, 7.5, zn)) * mix(0.25, smoothstep(0.5, 0.64, vn3(P3 * 0.55 + 3.0) * 0.6 + vn3(P3 * 2.1) * 0.4), lich);
  float grey = smoothstep(3.5, 6.0, zn) * mix(0.3, smoothstep(0.5, 0.64, vn3(P3 * 0.8 + 17.0)), lich);
  albedo = mix(albedo, vec3(0.31, 0.3, 0.24), grey * 0.4 * hard);
  albedo = mix(albedo, vec3(0.38, 0.27, 0.07), xan * 0.42 * hard);
  albedo = mix(albedo, vec3(0.03, 0.03, 0.03), tar * 0.75 * hard);
  albedo = mix(albedo, vec3(0.3, 0.285, 0.24), barn * 0.6 * hard);
  albedo = mix(albedo, mix(vec3(0.028, 0.03, 0.014), vec3(0.085, 0.07, 0.022), vnf(p + 5.0, 2.3, fp)), weed * 0.9 * hard);
  if (kind >= 2) albedo *= vTint;

  // ---- made ground: the apron of a quay ----
  float gloss = 0.0;
  vec4 qy = kind <= 1 ? quayAt(p, kind == 1 ? 40.0 : 0.0) : vec4(0.0);
  if (kind == 1 || qy.w > 0.5) {
    vec3 pv = pavedLook(qy.xy, fp, n1, n2, gloss);
    // (behind the paving the block is hardstanding going back to rough grass)
    float pk = kind == 1 ? 1.0 : 1.0 - smoothstep(qy.z - 4.0, qy.z + 2.0, qy.y + 6.0 * n2);
    vec3 town = mix(vec3(0.19, 0.18, 0.16) * (0.8 + 0.6 * n1), grass, smoothstep(-0.12, 0.2, n2 + 0.5 * n3));
    albedo = mix(town, pv, pk);
    if (kind == 1) albedo *= vTint;
    gloss *= pk; sand = 0.0; rock = 0.0; crev = 0.0;
  }

  // the swash: the sea runs up the beach and back; the sand it has wetted is dark, the sheet of water white at its front
  float run = swashRun(p, uTime, uHs, uWindDir);
  float wet = 1.0 - smoothstep(run * 1.4 + 0.06, run * 1.4 + 0.4 + 0.25 * uHs, h + 0.2 * n1);
  float splash = 1.0 - smoothstep(0.6, 3.5 + 2.0 * uHs, h);
  albedo *= mix(1.0, mix(0.42, 0.6, rock), max(wet * (1.0 - 0.4 * rock), splash * rock * 0.8));
  albedo *= 1.0 - 0.3 * uRain;
  float gentle = 1.0 - smoothstep(0.2, 0.5, sl);
  float edgeD = run - h;
  // (the wash runs up beaches; a boulder's facets at the waterline are not one)
  float sheet = smoothstep(0.0, 0.03, edgeD) * gentle * (kind >= 2 ? 0.0 : 1.0);
  float front = (1.0 - smoothstep(0.0, 0.3 + 0.12 * uHs, edgeD)) * sheet * (0.55 + 0.9 * (vn(p * 1.3 + uTime * 0.2) - 0.35));
  front = clamp(front, 0.0, 1.0);
  albedo = mix(albedo, albedo * 0.55, sheet * 0.6);

  // ---- the shading normal: small bumps on open ground, facets on rock, crowns on a painted canopy ----
  float bf = 1.0 - smoothstep(0.1, 0.5, fp * 1.1);
  vec2 bg = vec2(vn((p + vec2(0.3, 0.0)) * 1.1) - vn((p - vec2(0.3, 0.0)) * 1.1), vn((p + vec2(0.0, 0.3)) * 1.1) - vn((p - vec2(0.0, 0.3)) * 1.1));
  vec3 bump = vec3(bg.x, 0.0, bg.y) * 0.35 * bf * (kind == 1 ? 0.2 : 1.0);
  if (rock > 0.01) {
    float rf2 = 1.0 - smoothstep(0.2, 0.6, fp * 3.1);
    vec3 q3 = P3 * 3.1 + 5.0;
    bump += rbump * rock + (vec3(vn3(q3), vn3(q3 + 17.0), vn3(q3 + 41.0)) - 0.5) * 0.5 * rock * rf2;
  }
  if (canopy > 0.01) bump += vec3(vnf(p + 61.0, 0.14, fp) - 0.5, 0.0, vnf(p + 137.0, 0.14, fp) - 0.5) * 1.5 * canopy;
  vec3 N = normalize(Ng + bump);

  // ---- light: the sun (cloud shadows, the ground's own, what stands on it), the sky above, the sea below ----
  vec3 sunE = sunIlluminance(), skyE = skyIrradiance();
  vec3 L = uSunDir;
  vec2 suv = (p - uShaftRect.xy) * uShaftRect.zw;
  float sunVis = mix(uHazeSun, texture(uShaftShadow, suv).r, smoothstep(0.0, 0.04, min(min(suv.x, suv.y), min(1.0 - suv.x, 1.0 - suv.y))));
  float tsh = terrainShadow(p, h, L, dist);
  vec2 osh = objShade(p, h, L);
  float nl = max(dot(N, L), 0.0);
  vec3 seaL = uRrs * (sunE * sunVis * max(L.y, 0.0) + skyE);
  vec3 groundE = PI * seaL * 1.5 + skyE * 0.06;
  float up = N.y * 0.5 + 0.5;
  float ao = (mix(0.72, 0.88, rock) + mix(0.28, 0.12, rock) * smoothstep(0.0, 0.6, N.y)) * (0.88 + 0.5 * n2) * osh.y * (1.0 - 0.5 * crev);
  // (a face that looks out over lit ground and sea gets some of their light back, and sees the bright sky low down)
  vec3 bounce = sunE * sunVis * max(L.y, 0.0) * 0.1 * (1.0 - up) * smoothstep(0.0, 5.0, h);
  vec3 Eamb = (skyE * mix(up, 0.8, 0.4 * rock) + groundE * (1.0 - up) + bounce) * ao;
  vec3 sunLight = sunE * sunVis * tsh * osh.x * nl * (1.0 - 0.65 * crev);
  float amb = dot(skyE + sunE * max(L.y, 0.0), vec3(0.3333));
  vec3 Ed = sunLight + Eamb + uFlash * 0.3 + lampLight(vWorld, N) * amb * 9.0;
  vec3 col = albedo * Ed / PI;
  // wet ground, standing water and the swash sheet mirror the sky a little
  float nv = clamp(dot(N, V), 0.0, 1.0);
  vec3 R = reflect(-V, N); R.y = max(R.y, 0.04);
  // (rain wets the ground but rough ground is no mirror: a small share, or flat land seen low across the water glares)
  float shine = max(wet * (1.0 - rock), sheet) * 0.3 + uRain * 0.04 + gloss * (0.25 + 0.6 * uRain) + 0.2 * splash * rock;
  col += shine * (0.03 + 0.97 * pow(1.0 - nv, 5.0)) * textureLod(uEnv, equirectUv(normalize(R)), 3.5).rgb * (0.4 + 0.6 * sunVis) * osh.y;
  // foam at the front of the wash
  vec3 Nf = vec3(0.0, 1.0, 0.0);
  vec3 foamCol = 0.8 * (sunE * sunVis * tsh * max(dot(Nf, L) * 0.8 + 0.2, 0.0) + skyE) / PI;
  col = mix(col, foamCol, front * 0.85);

  vec3 aL, aT;
  aerial(-V, dist * 0.001, aL, aT);
  col = col * aT + aL;
  col = applyFog(col, -V, dist);
  oColor = vec4(col, 1.0);
}`;
// (for the shader check tool)
export const LAND_SHADERS = [{ label: 'land', vs: VS, fs: FS }, { label: 'land-mesh', vs: MESH_VS, fs: FS }];

// a grid of n x n cells over the unit square, with a skirt: a second row of vertices along every edge, flagged to drop
function gridMesh(gl, nx, nz) {
  const vx = nx + 1, vz = nz + 1;
  const pos = [], idx = [];
  for (let j = 0; j < vz; j++) for (let i = 0; i < vx; i++) pos.push(i / nx, j / nz, 0);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = j * vx + i, b = a + 1, c = a + vx, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  // skirt vertices (a copy of each edge vertex, dropped)
  const edge = (list) => {
    const base = pos.length / 3;
    for (const v of list) pos.push(pos[v * 3], pos[v * 3 + 1], 1);
    for (let k = 0; k < list.length - 1; k++) { const a = list[k], b = list[k + 1], c = base + k, d = base + k + 1; idx.push(a, c, b, b, c, d); }
  };
  const top = [], bot = [], lef = [], rig = [];
  for (let i = 0; i < vx; i++) { top.push(i); bot.push(nz * vx + i); }
  for (let j = 0; j < vz; j++) { lef.push(j * vx); rig.push(j * vx + nx); }
  edge(top); edge(bot); edge(lef); edge(rig);
  const m = makeMesh(gl, [[new Float32Array(pos), 3]], new Uint32Array(idx));
  m.tris = idx.length / 3;
  return m;
}

const planes = new Float32Array(24);
function framePlanes(m) {
  // Gribb-Hartmann, column-major view-projection; each plane normalised
  const set = (k, a, b, c, d) => { const l = Math.hypot(a, b, c) || 1; planes[k * 4] = a / l; planes[k * 4 + 1] = b / l; planes[k * 4 + 2] = c / l; planes[k * 4 + 3] = d / l; };
  set(0, m[3] + m[0], m[7] + m[4], m[11] + m[8], m[15] + m[12]);
  set(1, m[3] - m[0], m[7] - m[4], m[11] - m[8], m[15] - m[12]);
  set(2, m[3] + m[1], m[7] + m[5], m[11] + m[9], m[15] + m[13]);
  set(3, m[3] - m[1], m[7] - m[5], m[11] - m[9], m[15] - m[13]);
  set(4, m[3] + m[2], m[7] + m[6], m[11] + m[10], m[15] + m[14]);
  set(5, m[3] - m[2], m[7] - m[6], m[11] - m[10], m[15] - m[14]);
}
// is the box [x0,x1] x [y0,y1] x [z0,z1] possibly in view? (the planes are those of the last frame set: the
// coastal system, drawn after the land, culls with the same ones)
export function boxVisible(x0, y0, z0, x1, y1, z1) {
  for (let k = 0; k < 6; k++) {
    const a = planes[k * 4], b = planes[k * 4 + 1], c = planes[k * 4 + 2], d = planes[k * 4 + 3];
    if (a * (a > 0 ? x1 : x0) + b * (b > 0 ? y1 : y0) + c * (c > 0 ? z1 : z0) + d < 0) return false;
  }
  return true;
}

export class Land {
  constructor(game) {
    this.game = game;
    this.gl = game.app.gl;
    this.field = null;
    this.course = null;
    this.gpu = null;           // what belongs to the course on the GPU: textures, chunk list
    this.prog = null; this.meshProg = null;
    this.lods = null;
    this.stats = { drawn: 0, tris: 0, chunks: 0, culled: 0 };
    this.chunkU = new Float32Array(4);
    this.rectN = new Float32Array(4); this.rectF = new Float32Array(4);
    this.fixed = new Float32Array(32); this.fixedN = 0;
    // What the coastal system adds to the ground (coastal.js fills these in per course):
    // ground: meshes drawn with the terrain's own shading, { lods: [{ mesh, tris } or null if not built yet], at: [d0, d1,
    //   ...] (the distances the levels change at), origin: [x, y, z], box: [x0, y0, z0, x1, y1, z1], cull: a distance }
    this.ground = [];
    this.cover = {
      quayA: new Float32Array(8), quayB: new Float32Array(8),      // quay aprons (see the shader)
      objTex: null, objRect: new Float32Array(4), objTexel: 1,     // top-down heights of what stands on the ground
      treeFar: 1e9,                                                // the trees' range; the woods are painted beyond it
      lampP: new Float32Array(LAMPS * 4), lampOn: 0,               // lamp posts lighting the ground
    };
    this.blank = null;
    this.origin = new Float32Array(3);
  }

  // the CPU side, at once (the physics needs the height field before the first frame)
  setCourse(course) {
    this.course = course;
    this.field = landFor(course.id);
    this.gpu = null;
  }

  // ---- the sea over the shore (physics and shader agree: see waveAtt) ----
  // how much of its height a wave keeps at (x, z)
  wave(x, z) { return waveAtt(-this.field.heightAt(x, z)); }
  // height of the ground at (x, z) in metres, negative under water (other systems find the land by this method)
  heightAt(x, z) { return this.field ? this.field.heightAt(x, z) : -50; }

  // ---- building the GPU side, outside the draw pass (making a texture rebinds units) ----
  build() {
    const gl = this.gl, f = this.field;
    const fmt = gl.ext.fl ? 'r32f' : 'r16f';
    const near = new Texture(gl, { w: f.nx, h: f.nz, format: fmt, filter: 'linear', data: f.near });
    const far = new Texture(gl, { w: f.fn, h: f.fn, format: fmt, filter: 'linear', data: f.far });
    const G = { near, far, chunks: [], blocks: [], meshes: new Map() };
    if (!this.blank) this.blank = new Texture(gl, { w: 1, h: 1, format: 'r16f', filter: 'nearest', data: new Float32Array([-100]) });
    this.rectN.set([f.x0, f.z0, 1 / (f.x1 - f.x0), 1 / (f.z1 - f.z0)]);
    this.rectF.set([f.fx0, f.fz0, 1 / (f.fn * f.fd), 1 / (f.fn * f.fd)]);
    if (!this.lods) this.lods = LODS.map((l) => gridMesh(gl, l.n, l.n));
    // near chunks
    const cols = Math.ceil((f.x1 - f.x0) / CHUNK), rows = Math.ceil((f.z1 - f.z0) / CHUNK);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const x0 = f.x0 + i * CHUNK, z0 = f.z0 + j * CHUNK;
      let lo = 1e9, hi = -1e9;
      const u0 = Math.floor((x0 - f.x0) / f.dx), u1 = Math.min(Math.ceil((x0 + CHUNK - f.x0) / f.dx), f.nx - 1);
      const v0 = Math.floor((z0 - f.z0) / f.dz), v1 = Math.min(Math.ceil((z0 + CHUNK - f.z0) / f.dz), f.nz - 1);
      for (let v = v0; v <= v1; v++) for (let u = u0; u <= u1; u++) { const h = f.near[v * f.nx + u]; if (h < lo) lo = h; if (h > hi) hi = h; }
      if (hi < SEA_SKIP) continue;
      G.chunks.push({ x0, z0, x1: x0 + CHUNK, z1: z0 + CHUNK, lo, hi, cx: x0 + CHUNK / 2, cz: z0 + CHUNK / 2 });
    }
    // rings of coarse blocks round the near field, out to the edge of the far field
    const R = f.far, fn = f.fn;
    const addBlock = (x0, z0, x1, z1, cell) => {
      if (x1 - x0 < 1 || z1 - z0 < 1) return;
      const nx = Math.max(1, Math.round((x1 - x0) / cell)), nz = Math.max(1, Math.round((z1 - z0) / cell));
      let hi = -1e9;
      const u0 = Math.max(0, Math.floor((x0 - f.fx0) / f.fd)), u1 = Math.min(fn - 1, Math.ceil((x1 - f.fx0) / f.fd));
      const v0 = Math.max(0, Math.floor((z0 - f.fz0) / f.fd)), v1 = Math.min(fn - 1, Math.ceil((z1 - f.fz0) / f.fd));
      let lo = 1e9;
      for (let v = v0; v <= v1; v++) for (let u = u0; u <= u1; u++) { const h = R[v * fn + u]; if (h > hi) hi = h; if (h < lo) lo = h; }
      if (hi < SEA_SKIP) return;
      const key = nx + 'x' + nz;
      let mesh = G.meshes.get(key);
      if (!mesh) { mesh = gridMesh(gl, nx, nz); G.meshes.set(key, mesh); }
      G.blocks.push({ x0, z0, x1, z1, lo, hi, mesh, cell, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2 });
    };
    const ring = (a, b, cell) => {      // the rectangle b minus the rectangle a, as four strips
      addBlock(b[0], b[1], b[2], a[1], cell);
      addBlock(b[0], a[3], b[2], b[3], cell);
      addBlock(b[0], a[1], a[0], a[3], cell);
      addBlock(a[2], a[1], b[2], a[3], cell);
    };
    const n0 = [f.x0, f.z0, f.x1, f.z1];
    const r1 = RING1.reach;
    const n1 = [f.x0 - r1, f.z0 - r1, f.x1 + r1, f.z1 + r1];
    const n2 = [f.fx0, f.fz0, f.fx0 + fn * f.fd, f.fz0 + fn * f.fd];
    ring(n0, n1, RING1.cell);
    ring(n1, n2, RING2.cell);
    this.gpu = G;
  }

  update() {
    if (this.course !== this.game.course) this.setCourse(this.game.course);
    if (!this.gpu) this.build();
    this.fixedFor();
  }

  // ---- the sea shader's side ----
  waterUniforms() {
    const G = this.gpu, f = this.field;
    if (!G) return { uLandOn: 0 };
    return { uLandOn: 1, uLandTex: G.near, uLandRect: this.rectN, uFixN: this.fixedN, uFix: this.fixed };
  }

  // The fixed structures nearest the point just ahead of the camera, as foam rings for the sea shader:
  // x, z, radius, strength. A breakwater is a chain of circles, a platform four legs, a beacon one pile.
  fixedFor() {
    const sc = this.scenery || (this.scenery = this.game.systems.find((s) => s.colliders && s.models));
    const out = this.fixed, cam = this.game.app.cam;
    let n = 0;
    if (sc) {
      const fx = cam.pos[0] + Math.cos(cam.yaw) * 30, fz = cam.pos[2] + Math.sin(cam.yaw) * 30;
      const best = this._best || (this._best = Array.from({ length: 8 }, () => ({ d: 0, x: 0, z: 0, r: 0, w: 0 })));
      const put = (x, z, r, w) => {
        const d = (x - fx) * (x - fx) + (z - fz) * (z - fz);
        if (d > 160 * 160) return;
        let k = n < 8 ? n++ : (d < best[7].d ? 7 : -1);
        if (k < 0) return;
        const b = best[k]; b.d = d; b.x = x; b.z = z; b.r = r; b.w = w;
        while (k > 0 && best[k - 1].d > best[k].d) { const t = best[k - 1]; best[k - 1] = best[k]; best[k] = t; k--; }
      };
      for (const c of sc.colliders) {
        switch (c.kind) {
          case 'lighthouse': put(c.x, c.z, c.r, 1.2); break;
          case 'breakwater': put(c.x, c.z, c.r + 1.5, 1.0); break;
          case 'beacon': put(c.x, c.z, 3.2, 0.7); break;
          case 'platform': {
            const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
            for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
              const lx = sx * 16.8, lz = sz * 12.8;
              put(c.x + cs * lx - sn * lz, c.z + sn * lx + cs * lz, 2.0, 0.9);
            }
            break;
          }
          default:
        }
      }
      for (let k = 0; k < n; k++) { const b = best[k]; out[k * 4] = b.x; out[k * 4 + 1] = b.z; out[k * 4 + 2] = b.r; out[k * 4 + 3] = b.w; }
    }
    this.fixedN = n;
  }

  // ---- drawing ----
  draw(scene, meshes) {
    const G = this.gpu;
    if (!G) return;
    const gl = this.gl, f = this.field, cam = this.game.app.cam.pos, C = this.cover;
    if (!this.prog) { this.prog = new Program(gl, VS, FS, { label: 'land' }); this.meshProg = new Program(gl, MESH_VS, FS, { label: 'land-mesh' }); }
    const st = this.stats, u = this.chunkU;
    framePlanes(scene.uViewProj);
    const common = (p) => {
      p.use(scene);
      p.set('uHN', G.near); p.set('uHF', G.far);
      p.set('uRectN', this.rectN); p.set('uRectF', this.rectF);
      p.set('uQuayA', C.quayA); p.set('uQuayB', C.quayB);
      p.set('uObjH', C.objTex || this.blank); p.set('uObjRect', C.objRect); p.set('uObjTexel', C.objTexel);
      p.set('uTreeFar', C.treeFar);
      p.set('uLampP', C.lampP); p.set('uLampOn', C.lampOn);
    };
    const p = this.prog;
    common(p);
    gl.disable(gl.CULL_FACE);
    st.drawn = 0; st.tris = 0; st.culled = 0; st.chunks = G.chunks.length;
    // near chunks
    p.set('uFar', 0); p.set('uTexel', f.dx);
    for (const c of G.chunks) {
      if (!boxVisible(c.x0, c.lo - 8, c.z0, c.x1, c.hi + 40, c.z1)) { st.culled++; continue; }
      const dx = Math.max(c.x0 - cam[0], 0, cam[0] - c.x1), dz = Math.max(c.z0 - cam[2], 0, cam[2] - c.z1), d = Math.hypot(dx, dz);
      let l = 0; while (l < 3 && d > LODS[l].to) l++;
      const mesh = this.lods[l];
      u[0] = c.x0; u[1] = c.z0; u[2] = CHUNK; u[3] = CHUNK;
      p.set('uChunk', u); p.set('uSkirt', 3 + CHUNK / LODS[l].n * 0.7);
      gl.bindVertexArray(mesh.vao);
      gl.drawElements(gl.TRIANGLES, mesh.count, mesh.itype, 0);
      st.drawn++; st.tris += mesh.tris;
    }
    // the rings read the far field
    p.set('uFar', 1); p.set('uTexel', f.fd);
    for (const b of G.blocks) {
      if (!boxVisible(b.x0, b.lo - 40, b.z0, b.x1, b.hi + 60, b.z1)) { st.culled++; continue; }
      u[0] = b.x0; u[1] = b.z0; u[2] = b.x1 - b.x0; u[3] = b.z1 - b.z0;
      p.set('uChunk', u); p.set('uSkirt', 10 + b.cell * 0.5);
      gl.bindVertexArray(b.mesh.vao);
      gl.drawElements(gl.TRIANGLES, b.mesh.count, b.mesh.itype, 0);
      st.drawn++; st.tris += b.mesh.tris;
    }
    // ground meshes: quay decks, slipways, rocks
    if (this.ground.length) {
      const q = this.meshProg, o = this.origin;
      let on = false;
      for (const g of this.ground) {
        const b = g.box;
        if (!boxVisible(b[0], b[1], b[2], b[3], b[4], b[5])) continue;
        const d = Math.hypot(Math.max(b[0] - cam[0], 0, cam[0] - b[3]), Math.max(b[2] - cam[2], 0, cam[2] - b[5]));
        if (g.cull && d > g.cull) continue;
        let l = 0; while (l < g.lods.length - 1 && d > g.at[l]) l++;
        // (a level not built yet: ask for it, and draw the next coarser one meanwhile)
        if (!g.lods[l]) { if (g.want === undefined || l < g.want) g.want = l; while (l < g.lods.length - 1 && !g.lods[l]) l++; }
        const L = g.lods[l];
        if (!L) continue;
        if (!on) { common(q); q.set('uFar', 0); q.set('uTexel', f.dx); on = true; }
        o[0] = g.origin[0]; o[1] = g.origin[1]; o[2] = g.origin[2];
        q.set('uOrigin', o);
        gl.bindVertexArray(L.mesh.vao);
        gl.drawArrays(gl.TRIANGLES, 0, L.mesh.count);
        st.drawn++; st.tris += L.tris;
      }
    }
    gl.bindVertexArray(null);
    // the mesh pass's textures were bound over by ours: bind them back for what is drawn after us
    meshes.begin(scene);
  }
}
