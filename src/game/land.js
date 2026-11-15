// The land: a chunked terrain mesh over the course's height field (landfield.js), drawn in the main pass
// after the sea, with its own shader (the mesh pass is not touched). The sea reads the same field through
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
// Surface. Procedural, by height and slope: wet and dry sand, grass and scrub, banded rock on slopes and
// peaks, with detail noise whose octaves fade out as they shrink toward a pixel (no shimmer at distance),
// and a swash that runs up the beach with the swell. Lit by the sun (cloud shadows, and terrain shadows
// marched through the height field at a low sun) and the sky, then aerial perspective and fog as everything.
//
// Cost (unmeasured; software GL only): triangles per chunk 8.7k / 2.3k / 0.6k / 0.2k at the four levels; a
// typical view draws 6-12 chunks at the top level, 10-20 at the next and a few dozen coarser ones, so on the
// order of 100-200k triangles and 30-100 draws (seen in software GL: 77k-190k triangles, 19-99 draws); the
// two rings are eight strips of 90-100k triangles in all, drawn only when in view. Terrain fragments: 1 height tap for the vertex and 4 for the normal, 12 more for the sun's
// shadow below about 35 degrees of sun elevation within 4 km, plus two small noise octaves.
import { Program, Texture, makeMesh } from '../gl.js';
import { SKY_LOOKUP_GLSL } from '../sky/atmosphere.js';
import { LAND_COMMON_GLSL } from './landgl.js';
import { landFor, waveAtt } from './landfield.js';
import { houseGeo, placeHouses } from './models/village.js';

const CHUNK = 256;
const LODS = [{ n: 64, to: 420 }, { n: 32, to: 1000 }, { n: 16, to: 2400 }, { n: 8, to: 1e9 }];
const RING1 = { cell: 64, reach: 3072 }, RING2 = { cell: 256 };
const SEA_SKIP = -4;       // ground wholly deeper than this never shows through the sea

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
void main() {
  vec2 xz = uChunk.xy + aG.xy * uChunk.zw;
  float h = uFar > 0.5 ? textureLod(uHF, (xz - uRectF.xy) * uRectF.zw, 0.0).r : textureLod(uHN, (xz - uRectN.xy) * uRectN.zw, 0.0).r;
  h -= aG.z * uSkirt;
  vec3 P = vec3(xz.x, h, xz.y);
  float dr = length(P.xz - uCamPos.xz);
  P.y -= dr * dr / (2.0 * 6360000.0);
  vWorld = P;
  gl_Position = uViewProj * vec4(P, 1.0);
}`;

const FS = SKY_LOOKUP_GLSL + LAND_COMMON_GLSL + `
in vec3 vWorld;
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
const float PI = 3.14159265359;

float H(vec2 p) {
  return uFar > 0.5 ? texture(uHF, (p - uRectF.xy) * uRectF.zw).r : texture(uHN, (p - uRectN.xy) * uRectN.zw).r;
}
float h12(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float vn(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h12(i), h12(i + vec2(1.0, 0.0)), f.x), mix(h12(i + vec2(0.0, 1.0)), h12(i + vec2(1.0, 1.0)), f.x), f.y);
}
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

void main() {
  vec2 p = vWorld.xz;
  vec3 toCam = uCamPos - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  float fp = length(fwidth(p));
  float h = H(p);
  // the normal from a ring of height taps, spread as wide as the pixel so that far ground is a smooth average
  float e = max(uTexel, fp * 1.2);
  vec3 Ng = normalize(vec3(H(p - vec2(e, 0.0)) - H(p + vec2(e, 0.0)), 2.0 * e, H(p - vec2(0.0, e)) - H(p + vec2(0.0, e))));
  float sl = 1.0 - Ng.y;

  float n1 = dfbm(p, fp, 0.9);
  float n2 = dfbm(p + 31.0, fp, 0.07);
  // bumps: a gradient of one octave (not fading in the far field, where fp is large, so it vanishes there)
  float bf = 1.0 - smoothstep(0.1, 0.5, fp * 1.1);
  vec2 bg = vec2(vn((p + vec2(0.3, 0.0)) * 1.1) - vn((p - vec2(0.3, 0.0)) * 1.1), vn((p + vec2(0.0, 0.3)) * 1.1) - vn((p - vec2(0.0, 0.3)) * 1.1));
  vec3 N = normalize(Ng + vec3(bg.x, 0.0, bg.y) * 0.35 * bf);

  // what the ground is: rock on slopes and peaks, sand low and flat, grass between
  float rock = smoothstep(0.2, 0.4, sl + 0.1 * n2);
  rock = max(rock, smoothstep(170.0, 330.0, h + 50.0 * n2));
  // (sand is the beach face only: the flat ground behind it is grass, or a low shore seen from the sea is one pale band)
  float sand = (1.0 - smoothstep(1.3, 2.6, h + 1.4 * n2 + 0.7 * n1)) * (1.0 - rock);
  float far = smoothstep(0.4, 1.4, fp);
  vec3 grass = mix(vec3(0.07, 0.105, 0.032), vec3(0.125, 0.118, 0.042), smoothstep(-0.2, 0.25, n2));
  grass *= 0.8 + 0.7 * n1;
  float scrub = smoothstep(0.52, 0.78, vn(p * 0.21) * 0.6 + vn(p * 0.93) * 0.4);
  grass = mix(grass, vec3(0.028, 0.05, 0.02), 0.65 * scrub * (1.0 - far));
  grass = mix(grass, vec3(0.085, 0.093, 0.045), smoothstep(60.0, 190.0, h));
  vec3 sandC = mix(vec3(0.3, 0.245, 0.15), vec3(0.37, 0.31, 0.2), smoothstep(-0.2, 0.2, n2)) * (0.88 + 0.5 * n1);
  // (layers show on cliff faces only, and average out with distance: on a far hillside they would be contour lines)
  float strata = mix(0.5, smoothstep(-0.35, 0.35, sin(h * 0.85 + n2 * 5.0 + n1 * 1.5 + vn(p * 0.04) * 7.0)), smoothstep(0.22, 0.5, sl) * (1.0 - far));
  vec3 rockC = mix(vec3(0.125, 0.11, 0.092), vec3(0.215, 0.185, 0.145), strata) * (0.82 + 0.5 * n1);
  vec3 albedo = mix(mix(grass, sandC, sand), rockC, rock);

  // the swash: the sea runs up the beach and back; the sand it has wetted is dark, the sheet of water white at its front
  float run = swashRun(p, uTime, uHs, uWindDir);
  float wet = 1.0 - smoothstep(run * 1.4 + 0.06, run * 1.4 + 0.4 + 0.25 * uHs, h + 0.2 * n1);
  float splash = 1.0 - smoothstep(0.6, 3.5 + 2.0 * uHs, h);
  albedo *= mix(1.0, mix(0.42, 0.6, rock), max(wet * (1.0 - 0.4 * rock), splash * rock * 0.8));
  albedo *= 1.0 - 0.3 * uRain;
  float gentle = 1.0 - smoothstep(0.2, 0.5, sl);
  float edgeD = run - h;
  float sheet = smoothstep(0.0, 0.03, edgeD) * gentle;
  float front = (1.0 - smoothstep(0.0, 0.3 + 0.12 * uHs, edgeD)) * sheet * (0.55 + 0.9 * (vn(p * 1.3 + uTime * 0.2) - 0.35));
  front = clamp(front, 0.0, 1.0);
  albedo = mix(albedo, albedo * 0.55, sheet * 0.6);

  // light: the sun (cloud shadows, then the ground's own), the sky above, the sea below
  vec3 sunE = sunIlluminance(), skyE = skyIrradiance();
  vec3 L = uSunDir;
  vec2 suv = (p - uShaftRect.xy) * uShaftRect.zw;
  float sunVis = mix(uHazeSun, texture(uShaftShadow, suv).r, smoothstep(0.0, 0.04, min(min(suv.x, suv.y), min(1.0 - suv.x, 1.0 - suv.y))));
  float tsh = terrainShadow(p, h, L, dist);
  float nl = max(dot(N, L), 0.0);
  vec3 seaL = uRrs * (sunE * sunVis * max(L.y, 0.0) + skyE);
  vec3 groundE = PI * seaL * 1.5 + skyE * 0.06;
  float up = N.y * 0.5 + 0.5;
  float ao = (0.72 + 0.28 * smoothstep(0.0, 0.6, N.y)) * (0.88 + 0.5 * n2);
  vec3 Eamb = (skyE * up + groundE * (1.0 - up)) * ao;
  vec3 sunLight = sunE * sunVis * tsh * nl;
  vec3 Ed = sunLight + Eamb + uFlash * 0.3;
  vec3 col = albedo * Ed / PI;
  // wet ground and the swash sheet mirror the sky a little
  float nv = clamp(dot(N, V), 0.0, 1.0);
  vec3 R = reflect(-V, N); R.y = max(R.y, 0.04);
  // (rain wets the ground but rough ground is no mirror: a small share, or flat land seen low across the water glares)
  float shine = max(wet * (1.0 - rock), sheet) * 0.3 + uRain * 0.04;
  col += shine * (0.03 + 0.97 * pow(1.0 - nv, 5.0)) * textureLod(uEnv, equirectUv(normalize(R)), 3.5).rgb * (0.4 + 0.6 * sunVis);
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
// is the box [x0,x1] x [y0,y1] x [z0,z1] possibly in view?
function boxVisible(x0, y0, z0, x1, y1, z1) {
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
    this.prog = null;
    this.lods = null;
    this.stats = { drawn: 0, tris: 0, chunks: 0, culled: 0 };
    this.chunkU = new Float32Array(4);
    this.rectN = new Float32Array(4); this.rectF = new Float32Array(4);
    this.fixed = new Float32Array(32); this.fixedN = 0;
    this.mat = new Float32Array(16);
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
    // a village behind a beach, if the course has one
    G.houses = []; G.houseMesh = [];
    if (f.def.village) {
      for (let k = 1; k <= 3; k++) { const h = houseGeo(k); G.houseMesh[k] = { mesh: h.g.build(gl), radius: h.radius, h: h.h }; }
      G.houses = placeHouses(f, f.def.village, f.def.shapes.length * 7 + 3);
    }
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
    const gl = this.gl, f = this.field, cam = this.game.app.cam.pos;
    if (!this.prog) this.prog = new Program(gl, VS, FS, { label: 'land' });
    const p = this.prog, st = this.stats, u = this.chunkU;
    framePlanes(scene.uViewProj);
    p.use(scene);
    p.set('uHN', G.near); p.set('uHF', G.far);
    p.set('uRectN', this.rectN); p.set('uRectF', this.rectF);
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
    gl.bindVertexArray(null);
    // the mesh pass's textures were bound over by ours: bind them back for what is drawn after us
    meshes.begin(scene);
    // the village: one draw a house, within 3 km and in view
    const mat = this.mat;
    for (const hs of G.houses) {
      const k = G.houseMesh[hs.seed];
      if (Math.hypot(hs.x - cam[0], hs.z - cam[2]) > 3000 || !boxVisible(hs.x - k.radius, hs.y - 2, hs.z - k.radius, hs.x + k.radius, hs.y + k.h, hs.z + k.radius)) continue;
      const c = Math.cos(hs.yaw), s = Math.sin(hs.yaw);
      mat.set([c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, hs.x, hs.y, hs.z, 1]);
      meshes.draw(k.mesh, mat, {});
      st.drawn++; st.tris += k.mesh.count / 3;
    }
  }
}
