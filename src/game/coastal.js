// The coast as a lived-in place: everything on the land and along the shore that is not height field.
// One system; the plan of a course is plain data (models/coastplan.js), a pure function of the course.
//
//   ground    quay decks, slipways, the boulders of the `rocks` features, the shells of the sea stacks, the
//             bedded skins of the cliffs and the loose blocks under them: meshes handed to the terrain (land.js draws them with its own
//             shading, so rock is one rock everywhere and paving takes shadows)
//   fixed     quay walls and their furniture, piers, and the buildings in chunks: meshes for the mesh pass
//   afloat    a small craft and a buoy at every mooring spot, riding the sea by the mesh pass's float mode
//   trees     every tree and bush, instanced: a cell of trees is one draw whatever kinds stand in it (the
//             vertex shader fetches its vertex from a float texture that holds every kind at that level of
//             detail); four levels by the cell's distance; leaves with ragged outlines and a slight sway
//   lights    one instanced draw of glows for every lamp post, lit window and pier light; the nearest lamp
//             posts also light the ground (land.js)
//   shadows   a top-down height map of what stands on the ground, rendered once per course; the terrain
//             shader marches it for the sun's shadow and darkens the ground at the foot of things
//
// Levels of detail. Everything has three (the trees four). Only the coarsest of each is built when a course
// loads (and the middle level of the harbour, for the shadow map); a finer level is built the first time the
// camera comes near enough to want it, one mesh a frame. Culling is by the view frustum (the terrain's planes)
// and a distance per kind.
//
// Quality. The tier (settings.active) sets the trees' range and scales the distances the levels change at; app.fx.shadows scales those again as the governor sheds load, and at 0 the
// object shadows are off.
//
// Cost (software GL only; nothing measured on a GPU). A close pass along a harbour at the medium tier draws
// about 250k triangles in 60 to 110 draws for this system; see the report for views per course.
import { Program, Texture, Target } from '../gl.js';
import { SKY_LOOKUP_GLSL } from '../sky/atmosphere.js';
import { smoothstep } from '../math.js';
import { boxVisible, LAMPS } from './land.js';
import { settings } from './settings.js';
import { planCoast } from './models/coastplan.js';
import { Geo } from './models/kit.js';
import { quayGeo, deckGeo, pierGeo, slipGeo } from './models/harbour.js';
import { buildingGeo } from './models/village.js';
import { rockFieldGeo, stackGeo, looseRockGeo, rockSet, cliffGeo, CLIFF_TILE } from './models/rocks.js';
import { packLevel, FLOATS } from './models/trees.js';
import { openBoatGeo, dayBoatGeo, mooringBuoyGeo } from './models/smallcraft.js';
import { ribGeo } from './models/vessels.js';

const TIERS = {
  low: { treeFar: 800, lod: 0.7, rocks: 900 },
  medium: { treeFar: 1250, lod: 1, rocks: 1400 },
  high: { treeFar: 1650, lod: 1.3, rocks: 1800 },
};
// where a cell of trees steps down a level (m to the cell)
const TREE_LOD = [60, 230, 560];
const CHUNK = 96;              // buildings are built in chunks this size, so only the near ones are fine

// ---- trees ----
const TREE_VS = `
layout(location = 0) in float aVid;
layout(location = 1) in vec4 iPos;    // x, y, z, height
layout(location = 2) in vec4 iPar;    // kind, yaw, width, tint
uniform sampler2D uMesh;              // every kind at this level: rows of position + shade, normal + part, colour
uniform ivec2 uDim;                   // its width, and how many texture rows one row of vertices wraps over
uniform mat4 uViewProj;
uniform vec3 uCamPos;
uniform float uTime;
uniform vec2 uWindDir;
uniform float uSway;
uniform vec4 uTop;                    // the shadow map's rectangle (top-down pass)
uniform float uTopOn;
out vec3 vWorld;
out vec3 vN;
out vec3 vCol;
out vec4 vP;                          // shade, leaf, tint, height up the tree
void main() {
  int row = int(iPar.x + 0.5) * 3, v = int(aVid + 0.5);
  ivec2 t = ivec2(v % uDim.x, v / uDim.x);
  vec4 A = texelFetch(uMesh, ivec2(t.x, row * uDim.y + t.y), 0), B = texelFetch(uMesh, ivec2(t.x, (row + 1) * uDim.y + t.y), 0), C = texelFetch(uMesh, ivec2(t.x, (row + 2) * uDim.y + t.y), 0);
  float part = floor(B.w + 0.001), sway = (B.w - part) / 0.49;
  float c = cos(iPar.y), s = sin(iPar.y);
  vec3 lp = A.xyz * vec3(iPar.z, 1.0, iPar.z) * iPos.w;
  vec3 P = iPos.xyz + vec3(c * lp.x - s * lp.z, lp.y, s * lp.x + c * lp.z);
  vec3 N = vec3(c * B.x - s * B.z, B.y, s * B.x + c * B.z);
  // the wind: the head leans and nods, more the higher up, each tree in its own time
  float ph = uTime * 1.5 + iPos.x * 0.13 + iPos.z * 0.17;
  P.xz += uWindDir * (sin(ph) * 0.6 + sin(ph * 2.3 + 1.7) * 0.4 + 0.6) * sway * uSway * iPos.w * 0.02;
  vWorld = P; vN = N; vCol = C.rgb; vP = vec4(A.w, part, iPar.w, A.y);
  if (uTopOn > 0.5) {
    vec2 uv = (P.xz - uTop.xy) * uTop.zw;
    gl_Position = vec4(uv * 2.0 - 1.0, 1.0 - 2.0 * clamp((P.y + 20.0) / 220.0, 0.0, 1.0), 1.0);
    return;
  }
  float dr = length(P.xz - uCamPos.xz);
  P.y -= dr * dr / (2.0 * 6360000.0);
  gl_Position = uViewProj * vec4(P, 1.0);
}`;
const TREE_FS = SKY_LOOKUP_GLSL + `
in vec3 vWorld;
in vec3 vN;
in vec3 vCol;
in vec4 vP;
out vec4 oColor;
uniform vec3 uCamPos;
uniform vec3 uRrs;
uniform vec3 uFlash;
uniform float uRain;
uniform float uTopOn;
const float PI = 3.14159265359;
float h13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h13(i), h13(i + vec3(1, 0, 0)), f.x), mix(h13(i + vec3(0, 1, 0)), h13(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h13(i + vec3(0, 0, 1)), h13(i + vec3(1, 0, 1)), f.x), mix(h13(i + vec3(0, 1, 1)), h13(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
void main() {
  if (uTopOn > 0.5) { oColor = vec4(vWorld.y, 0.0, 0.0, 1.0); return; }
  vec3 toCam = uCamPos - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  vec3 N = normalize(vN);
  float fp = length(fwidth(vWorld));
  float leaf = step(0.5, vP.y), shade = vP.x;
  vec3 albedo = vCol;
  if (leaf > 0.5) {
    // every tree its own green, a few turning; clumps of leaves light and dark, then the leaves themselves
    float t = vP.z;
    albedo *= mix(vec3(0.78, 0.88, 0.7), vec3(1.25, 1.12, 0.9), t);
    albedo = mix(albedo, albedo.grb * vec3(1.25, 0.8, 0.6), smoothstep(0.9, 1.0, t) * 0.55);
    float n1 = mix(0.5, vnoise(vWorld * 1.7), 1.0 - smoothstep(0.2, 0.6, fp * 1.7));
    float n2 = mix(0.5, vnoise(vWorld * 9.0), 1.0 - smoothstep(0.03, 0.1, fp));
    float cut = vnoise(vWorld * 5.0) * 0.6 + vnoise(vWorld * 13.0) * 0.4;
    // a ragged outline: leaves against the sky, not the edge of a balloon (only where a pixel can show it)
    // (the rim is the lump's own, from the surface as drawn: toward its edge more and more of it is sky)
    vec3 Ng = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
    float rim = 1.0 - abs(dot(Ng, V));
    float near = 1.0 - smoothstep(0.08, 0.22, fp);
    if (cut < (0.24 + rim * sqrt(rim) * 0.95) * near) discard;
    float gap = mix(1.0, smoothstep(0.3, 0.6, cut), near);
    albedo *= (0.68 + 0.64 * n1) * (0.66 + 0.68 * n2);
    shade *= (0.5 + 0.5 * gap) * (gl_FrontFacing ? 1.0 : 0.6);
  } else {
    albedo *= 0.7 + 0.6 * vnoise(vWorld * vec3(11.0, 2.5, 11.0));
  }
  albedo *= 1.0 - 0.25 * uRain;
  vec3 sunE = sunIlluminance(), skyE = skyIrradiance();
  vec3 L = uSunDir;
  vec2 suv = (vWorld.xz - uShaftRect.xy) * uShaftRect.zw;
  float sunVis = mix(uHazeSun, texture(uShaftShadow, suv).r, smoothstep(0.0, 0.04, min(min(suv.x, suv.y), min(1.0 - suv.x, 1.0 - suv.y))));
  float nl = dot(N, L);
  // leaves pass light on: the lit side wraps round, and a head against the sun glows
  float wrap = leaf > 0.5 ? max(nl * 0.62 + 0.38, 0.0) : max(nl, 0.0);
  float through = leaf * pow(max(dot(-V, L), 0.0), 3.0) * 0.45 * (0.5 - 0.5 * nl);
  float up = N.y * 0.5 + 0.5;
  // (from below a tree is lit by the grass)
  vec3 groundE = vec3(0.07, 0.1, 0.04) * (sunE * sunVis * max(L.y, 0.0) + skyE);
  vec3 Eamb = (skyE * up + groundE * (1.0 - up)) * shade;
  vec3 col = albedo * (sunE * sunVis * (wrap * mix(0.5, 1.0, shade) + through) + Eamb + uFlash * 0.3) / PI;
  vec3 aL, aT;
  aerial(-V, dist * 0.001, aL, aT);
  col = col * aT + aL;
  col = applyFog(col, -V, dist);
  oColor = vec4(col, 1.0);
}`;

// ---- the top-down height map of what stands on the ground ----
const TOP_VS = `
layout(location = 0) in vec3 aPos;
uniform mat4 uModel;
uniform vec4 uTop;
out float vY;
void main() {
  vec3 P = (uModel * vec4(aPos, 1.0)).xyz;
  vec2 uv = (P.xz - uTop.xy) * uTop.zw;
  vY = P.y;
  gl_Position = vec4(uv * 2.0 - 1.0, 1.0 - 2.0 * clamp((P.y + 20.0) / 220.0, 0.0, 1.0), 1.0);
}`;
const TOP_FS = `
in float vY;
out vec4 oColor;
void main() { oColor = vec4(vY, 0.0, 0.0, 1.0); }`;

// ---- glows: one instanced quad a lamp ----
const GLOW_VS = `
layout(location = 0) in vec2 aQ;
layout(location = 1) in vec4 iPos;    // x, y, z, size (m)
layout(location = 2) in vec4 iCol;    // colour, kind (0 a lamp post, 1 a window, 2 a pier light)
uniform mat4 uViewProj;
uniform vec3 uCamPos;
uniform vec3 uView;                   // tan(fov / 2), aspect, darkness 0..1
out vec2 vQ;
out vec3 vCol;
out vec3 vPos;
out float vGain;
void main() {
  float dark = uView.z, kind = iCol.w;
  vec3 toCam = uCamPos - iPos.xyz;
  float d = length(toCam);
  // (a little toward the eye, so the lantern's own glass does not cut the glow in half)
  vec3 P = iPos.xyz + toCam / d * 0.3;
  float gain = kind < 0.5 ? 0.05 + dark * 3.2 : kind < 1.5 ? dark * dark * 1.3 : 0.14 + dark * 4.0;
  float size = iPos.w * (kind < 0.5 ? 0.45 + 0.55 * dark : kind < 1.5 ? 0.8 : 0.7 + dark);
  float far = kind < 0.5 ? 2600.0 : kind < 1.5 ? 900.0 : 5000.0;
  gain *= 1.0 - smoothstep(far * 0.7, far, d);
  vec4 p = uViewProj * vec4(P, 1.0);
  float sy = max(size / (d * uView.x), 0.005 + 0.005 * dark);
  p.xy += aQ * vec2(sy / uView.y, sy) * p.w;
  if (gain < 0.02) p = vec4(2.0, 2.0, 2.0, 1.0);
  gl_Position = p;
  vQ = aQ; vCol = iCol.rgb; vPos = iPos.xyz; vGain = gain;
}`;
const GLOW_FS = SKY_LOOKUP_GLSL + `
in vec2 vQ;
in vec3 vCol;
in vec3 vPos;
in float vGain;
out vec4 oColor;
uniform vec3 uCamPos;
void main() {
  float r2 = dot(vQ, vQ);
  if (r2 >= 1.0) discard;
  float g = exp(-r2 * 6.0) * 0.5 + exp(-r2 * 50.0) * 1.6;
  g *= 1.0 - r2 * r2;
  vec3 toCam = uCamPos - vPos;
  float dist = length(toCam);
  vec3 skyE = skyIrradiance(), sunE = sunIlluminance();
  float amb = dot(skyE + sunE * max(uSunDir.y, 0.0), vec3(0.3333)) / 3.14159265;
  vec3 col = vCol * g * (amb * vGain + 3e-4 * vGain * 0.2);
  vec3 aL, aT;
  aerial(-toCam / dist, dist * 0.001, aL, aT);
  vec3 fogged = applyFog(col * aT, -toCam / dist, dist);
  oColor = vec4(fogged - applyFog(vec3(0.0), -toCam / dist, dist), 1.0);
}`;
// (for the shader check tool)
export const COASTAL_SHADERS = [{ label: 'coastal-trees', vs: TREE_VS, fs: TREE_FS }, { label: 'coastal-top', vs: TOP_VS, fs: TOP_FS }, { label: 'coastal-glow', vs: GLOW_VS, fs: GLOW_FS }];

const rotY = (m, a, x, y, z) => {
  const c = Math.cos(a), s = Math.sin(a);
  m[0] = c; m[1] = 0; m[2] = s; m[3] = 0; m[4] = 0; m[5] = 1; m[6] = 0; m[7] = 0; m[8] = -s; m[9] = 0; m[10] = c; m[11] = 0; m[12] = x; m[13] = y; m[14] = z; m[15] = 1;
  return m;
};
const now = () => performance.now();

export class Coastal {
  constructor(game) {
    this.game = game;
    this.gl = game.app.gl;
    this.course = null;
    this.byCourse = new Map();       // what is built for each course, kept when the course changes
    this.G = null;
    this.mat = new Float32Array(16);
    this.opt = { float: 0 };
    this.view = new Float32Array(3);
    this.top = new Float32Array(4);
    this.stats = { draws: 0, tris: 0, trees: 0, treeTris: 0, treeLod: [0, 0, 0, 0], glows: 0, built: 0, buildMs: 0 };
    this.prog = null;
    this.levels = null;              // the trees' meshes as textures, shared by every course
    this.vid = null;
    this.rush = 0;                   // frames left in which every level asked for is built at once (see update)
    this.tier = TIERS[settings.active] || TIERS.medium;
    this.foot = 0;
    this.best = Array.from({ length: LAMPS }, () => ({ d: 0, l: null }));
  }

  // ---- what a course has: items with levels of detail built on demand ----
  setCourse(course) {
    this.course = course;
    let G = this.byCourse.get(course.id);
    if (!G) { G = this.plan(course); this.byCourse.set(course.id, G); }
    this.G = G;
    const land = this.game.land, C = land.cover;
    land.ground = G.ground;
    C.quayA.fill(0); C.quayB.fill(0);
    G.P.quays.slice(0, 2).forEach((q, i) => { C.quayA.set([q.x, q.z, q.ox, q.oz], i * 4); C.quayB.set([q.hw, q.depth, q.flare, q.paved], i * 4); });
    C.objTex = G.objTex; C.objRect.set(G.objRect); C.objTexel = G.objSize ? G.objSize[2] : 1;
    this.rush = 3;
  }

  plan(course) {
    const t0 = now(), P = planCoast(course), field = P.field, gl = this.gl;
    const G = { P, fixed: [], ground: [], floats: [], lamps: [], posts: [], objTex: null, objRect: new Float32Array(4), glow: null, trees: null, ms: {} };
    const hAt = (x, z) => field.heightAt(x, z);
    const item = (list, it) => { it.lods = new Array(it.n || 3).fill(null); it.want = undefined; list.push(it); return it; };
    // ---- quays: the deck as ground, the wall and its furniture for the mesh pass ----
    for (const q of P.quays) {
      const c = [[-q.hw - q.flare - 2, 2], [q.hw + q.flare + 2, 2], [-q.hw - q.flare - 2, -q.depth], [q.hw + q.flare + 2, -q.depth]].map(([X, Z]) => q.W(X, Z));
      const bx = [Math.min(...c.map((p) => p[0])), Math.min(...c.map((p) => p[1])), Math.max(...c.map((p) => p[0])), Math.max(...c.map((p) => p[1]))];
      item(G.ground, { make: (l) => ({ g: deckGeo(q, l) }), n: 2, at: [260], origin: [q.x, 0, q.z], box: [bx[0], q.yq - 3, bx[1], bx[2], q.yq + 12, bx[3]], cull: 6000 });
      item(G.fixed, { name: 'quay', make: (l) => quayGeo(q, l), at: [130, 480], x: q.x, y: 0, z: q.z, yaw: q.yaw - Math.PI / 2, box: [bx[0], -4, bx[1], bx[2], q.yq + 12, bx[3]], cull: 7000, shadow: true, lampsFrom: 1 });
    }
    for (const s of P.slips) item(G.ground, { make: (l) => ({ g: slipGeo(s, hAt, l) }), n: 2, at: [200], origin: [s.x, 0, s.z], box: [s.x - s.len - 6, -3, s.z - s.len - 6, s.x + s.len + 6, 5, s.z + s.len + 6], cull: 2500 });
    for (const p of P.piers) {
      const a = p.W(p.t0 - 2, 0), b = p.W(p.len + 3, 0), m = p.w / 2 + 3;
      item(G.fixed, { name: 'pier', make: (l) => pierGeo(p, l), at: [120, 420], x: p.x, y: 0, z: p.z, yaw: p.yaw, box: [Math.min(a[0], b[0]) - m, -5, Math.min(a[1], b[1]) - m, Math.max(a[0], b[0]) + m, p.yp + 8, Math.max(a[1], b[1]) + m], cull: 6000, shadow: true, lampsFrom: 1 });
    }
    // ---- buildings, in chunks ----
    const chunks = new Map();
    for (const b of P.buildings) { const k = b.group + ':' + Math.floor(b.x / CHUNK) + ':' + Math.floor(b.z / CHUNK); let c = chunks.get(k); if (!c) chunks.set(k, c = []); c.push(b); }
    for (const list of chunks.values()) {
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9, y0 = 1e9, y1 = -1e9;
      for (const b of list) { x0 = Math.min(x0, b.x - b.r - 3); x1 = Math.max(x1, b.x + b.r + 3); z0 = Math.min(z0, b.z - b.r - 3); z1 = Math.max(z1, b.z + b.r + 3); y0 = Math.min(y0, b.y - 4); y1 = Math.max(y1, b.y + 20); }
      const ox = (x0 + x1) / 2, oz = (z0 + z1) / 2, far = list[0].group.startsWith('farm');
      item(G.fixed, {
        name: 'houses', at: [170, 620], x: ox, y: 0, z: oz, yaw: 0, box: [x0, y0, z0, x1, y1, z1], cull: 9000, shadow: !far, lampsFrom: 2,
        make: (l) => { const g = new Geo(l === 0 ? 65536 : 4096), lamps = []; for (const b of list) buildingGeo(g, { type: b.type, seed: b.seed, x: b.x - ox, y: b.y, z: b.z - oz, yaw: b.yaw }, l, (x, z) => field.heightAt(x + ox, z + oz), lamps); return { g, lamps }; },
      });
    }
    // ---- rock: the boulder fields, the stacks, loose rock in cells ----
    for (const rf of P.rockFields) { const f = rf.f; item(G.ground, { make: (l) => ({ g: rockFieldGeo(f, rf.spots, l) }), n: 3, at: [110, 420], origin: [f.x, 0, f.z], box: [f.x - f.r - 8, -5, f.z - f.r - 8, f.x + f.r + 8, 9, f.z + f.r + 8], cull: 3000 }); }
    for (const s of P.stacks) {
      const tr = (th, y) => { let r = 0; for (let d = 0.5; d < s.r * 1.7; d += 0.5) if (field.heightAt(s.x + Math.cos(th) * d, s.z + Math.sin(th) * d) >= y) r = d; return r; };
      item(G.ground, { make: (l) => ({ g: stackGeo(s, tr, l) }), n: 3, at: [170, 650], origin: [s.x, 0, s.z], box: [s.x - s.r * 1.9, -6, s.z - s.r * 1.9, s.x + s.r * 1.9, s.h + 3, s.z + s.r * 1.9], cull: 9000 });
    }
    // the cliffs' skins, a tile each (they go as far as the loose rock does: beyond, a cliff is the terrain's own shape)
    for (const t of P.cliffs) { const o = [t.x0 + CLIFF_TILE / 2, 0, t.z0 + CLIFF_TILE / 2]; item(G.ground, { make: (l) => ({ g: cliffGeo(field, t, o, l) }), n: 3, at: [170, 520], origin: o, box: [t.x0 - 1, t.y0, t.z0 - 1, t.x0 + CLIFF_TILE + 1, t.y1, t.z0 + CLIFF_TILE + 1], cull: this.tier.rocks }); }
    const cells = new Map();
    for (const r of P.rocks) { const k = Math.floor(r.x / 192) + ':' + Math.floor(r.z / 192); let c = cells.get(k); if (!c) cells.set(k, c = []); c.push(r); }
    const sets = [0, 1, 2].map((l) => ({ block: rockSet('block', 4, l, 'land', 101), boulder: rockSet('boulder', 3, l, 'land', 131) }));
    for (const list of cells.values()) {
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9, y0 = 1e9, y1 = -1e9;
      for (const r of list) { x0 = Math.min(x0, r.x - 6); x1 = Math.max(x1, r.x + 6); z0 = Math.min(z0, r.z - 6); z1 = Math.max(z1, r.z + 6); y0 = Math.min(y0, r.y - 6); y1 = Math.max(y1, r.y + 9); }
      const o = [(x0 + x1) / 2, 0, (z0 + z1) / 2];
      item(G.ground, { make: (l) => ({ g: looseRockGeo(list, o, sets[l]) }), n: 3, at: [120, 400], origin: o, box: [x0, y0, z0, x1, y1, z1], cull: this.tier.rocks });
    }
    // ---- afloat: the moored craft and their buoys ----
    const models = new Map();
    const model = (key, make) => { let m = models.get(key); if (!m) models.set(key, m = { make, lods: [null, null, null], foot: 0, want: undefined }); return m; };
    for (const m of P.moorings) {
      const boat = m.kind === 'rib' ? model('rib' + (m.seed % 3), (l) => ribGeo(l, 1 + (m.seed % 3))) : m.kind === 'day' ? model('day' + m.seed, (l) => dayBoatGeo(l, m.seed)) : model('open' + m.seed + m.crew, (l) => openBoatGeo(l, m.seed, { crew: m.crew }));
      G.floats.push({ m: boat, x: m.x, z: m.z, yaw: m.yaw, at: [45, 200], cull: 2200, r: 5, phase: m.seed * 1.7, swing: 0.03 + 0.03 * ((m.seed * 7) % 5) / 5 });
      G.floats.push({ m: model('buoy' + (m.buoy.seed % 4), (l) => mooringBuoyGeo(l, m.buoy.seed % 4)), x: m.buoy.x, z: m.buoy.z, yaw: m.seed, at: [35, 150], cull: 900, r: 1, phase: 0, swing: 0 });
    }
    G.models = models;
    G.ms.plan = now() - t0;
    // ---- what must exist before the first frame: the coarsest level of everything, the harbour's middle level ----
    const t1 = now();
    for (const it of G.ground) this.build(G, it, (it.n || 3) - 1);
    for (const it of G.fixed) { this.build(G, it, 2); if (it.shadow && it.name !== 'houses') this.build(G, it, 1); }
    for (const m of models.values()) this.buildModel(m, 2);
    G.ms.meshes = now() - t1;
    // ---- trees ----
    const t2 = now();
    const T = P.trees, buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, T.data, gl.STATIC_DRAW);
    G.trees = { buf, cells: T.cells, blocks: T.blocks, count: T.count };
    this.treeGL();
    this.glowBuffer(G);
    this.shadowMap(G);
    G.ms.gpu = now() - t2;
    G.ms.total = now() - t0;
    this.stats.buildMs = Math.round(G.ms.total);
    G.info = { ms: Object.fromEntries(Object.entries(G.ms).map(([k, v]) => [k, Math.round(v)])), planMs: Object.fromEntries(Object.entries(P.ms).map(([k, v]) => [k, Math.round(v)])), trees: T.count, cells: T.cells.length, buildings: P.buildings.length, rocks: P.rocks.length, lamps: G.lamps.length, fixed: G.fixed.length, ground: G.ground.length };
    return G;
  }

  // build one level of an item (CPU geometry, then the vertex buffers); a fixed item's lamps come with one level
  build(G, it, l) {
    if (it.lods[l]) return;
    const r = it.make(l), g = r.g;
    it.lods[l] = { mesh: g.build(this.gl), tris: g.nv / 3 };
    if (r.lamps && it.lampsFrom === l && !it.lit) {
      it.lit = true;
      const c = Math.cos(it.yaw), s = Math.sin(it.yaw);
      for (const lm of r.lamps) {
        const w = { x: it.x + c * lm.p[0] - s * lm.p[2], y: it.y + lm.p[1], z: it.z + s * lm.p[0] + c * lm.p[2], size: lm.size || 1, col: lm.col, kind: lm.kind === 'post' ? 0 : lm.kind === 'window' ? 1 : 2 };
        G.lamps.push(w);
        if (w.kind === 0) G.posts.push(w);
      }
      G.glowDirty = true;
    }
    this.stats.built++;
  }
  buildModel(m, l) {
    if (m.lods[l]) return;
    const r = m.make(l);
    m.lods[l] = { mesh: r.g.build(this.gl), tris: r.g.nv / 3 };
    if (r.foot !== undefined && l === 2) m.foot = r.foot;
    this.stats.built++;
  }

  // the trees' meshes as textures, the vertex-index stream, the programs (once)
  treeGL() {
    if (this.levels) return;
    const gl = this.gl;
    this.levels = [0, 1, 2, 3].map((l) => {
      const L = packLevel(l);
      return { tex: new Texture(gl, { w: L.width, h: L.rows, format: 'rgba32f', filter: 'nearest', data: L.data }), dim: new Int32Array([L.width, L.wrap]), verts: L.verts, tris: L.verts / 3 };
    });
    const n = Math.max(...this.levels.map((L) => L.verts)), ids = new Float32Array(n);
    for (let i = 0; i < n; i++) ids[i] = i;
    this.vid = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vid);
    gl.bufferData(gl.ARRAY_BUFFER, ids, gl.STATIC_DRAW);
    this.treeVao = gl.createVertexArray();
    gl.bindVertexArray(this.treeVao);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 1, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(1); gl.enableVertexAttribArray(2);
    gl.vertexAttribDivisor(1, 1); gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);
    this.treeProg = new Program(gl, TREE_VS, TREE_FS, { label: 'coastal-trees' });
    this.topProg = new Program(gl, TOP_VS, TOP_FS, { label: 'coastal-top' });
    this.glowProg = new Program(gl, GLOW_VS, GLOW_FS, { label: 'coastal-glow' });
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
    this.quad = quad;
  }

  // every lamp of the course as instances of one quad
  glowBuffer(G) {
    const gl = this.gl, n = G.lamps.length, data = new Float32Array(Math.max(n, 1) * 8);
    G.lamps.forEach((l, i) => { data.set([l.x, l.y, l.z, l.size, l.col[0], l.col[1], l.col[2], l.kind], i * 8); });
    if (!G.glow) {
      G.glow = { buf: gl.createBuffer(), vao: gl.createVertexArray(), n: 0 };
      gl.bindVertexArray(G.glow.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, G.glow.buf);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 0); gl.vertexAttribDivisor(1, 1);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, 16); gl.vertexAttribDivisor(2, 1);
      gl.bindVertexArray(null);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, G.glow.buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    G.glow.n = n;
    G.glowDirty = false;
  }

  // The top-down height map: the harbour, the piers ashore, the buildings near the water and the trees among
  // them, as the highest surface above each point of a rectangle round them. Rendered once.
  shadowMap(G) {
    const gl = this.gl, P = G.P;
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    const grow = (b) => { x0 = Math.min(x0, b[0]); z0 = Math.min(z0, b[2]); x1 = Math.max(x1, b[3]); z1 = Math.max(z1, b[5]); };
    const casters = G.fixed.filter((it) => it.shadow);
    for (const it of casters) grow(it.box);
    if (x0 > x1) return;
    x0 -= 30; z0 -= 30; x1 += 30; z1 += 30;
    const w = x1 - x0, d = z1 - z0, texel = Math.max(0.3, Math.max(w, d) / 2048), tw = Math.ceil(w / texel), th = Math.ceil(d / texel);
    for (const it of casters) if (!it.lods[1]) this.build(G, it, 1);
    const fbo = gl.getParameter(gl.FRAMEBUFFER_BINDING), vp = gl.getParameter(gl.VIEWPORT), depthOn = gl.isEnabled(gl.DEPTH_TEST), depthFn = gl.getParameter(gl.DEPTH_FUNC), blend = gl.isEnabled(gl.BLEND);
    const tex = new Texture(gl, { w: tw, h: th, format: 'r16f', filter: 'linear', mips: true });
    // (making it left it bound on the active unit: a sampler of the programs below may point there, and a texture
    // cannot be read while it is drawn to)
    gl.bindTexture(gl.TEXTURE_2D, null);
    const target = new Target(gl, [tex], { depth: true });
    target.bind();
    // (empty ground reads a little under the sea: low enough never to shade, near enough that the coarser levels of
    // the map, which average it with what stands beside it, still soften an edge and do not erase it)
    gl.clearColor(-6, 0, 0, 1); gl.depthMask(true); gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    const top = this.top, mat = this.mat;
    top[0] = x0; top[1] = z0; top[2] = 1 / (tw * texel); top[3] = 1 / (th * texel);
    const p = this.topProg;
    p.use({ uTop: top });
    for (const it of casters) { const L = it.lods[1]; p.set('uModel', rotY(mat, it.yaw, it.x, it.y, it.z)); gl.bindVertexArray(L.mesh.vao); gl.drawArrays(gl.TRIANGLES, 0, L.mesh.count); }
    // the paving itself (what stands on it is measured from it)
    for (const it of G.ground) if (it.n === 2) { const L = it.lods[1] || it.lods[0]; p.set('uModel', rotY(mat, 0, it.origin[0], it.origin[1], it.origin[2])); gl.bindVertexArray(L.mesh.vao); gl.drawArrays(gl.TRIANGLES, 0, L.mesh.count); }
    // trees in the rectangle, at the far level but one
    const T = G.trees, L2 = this.levels[2], tp = this.treeProg;
    tp.use({ uTop: top, uTopOn: 1, uSway: 0, uTime: 0, uWindDir: [1, 0], uMesh: L2.tex, uDim: L2.dim });
    gl.bindVertexArray(this.treeVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, T.buf);
    for (const c of T.cells) {
      if (c.x1 < x0 || c.x0 > x1 || c.z1 < z0 || c.z0 > z1) continue;
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, FLOATS * 4, c.start * FLOATS * 4);
      gl.vertexAttribPointer(2, 4, gl.FLOAT, false, FLOATS * 4, c.start * FLOATS * 4 + 16);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, L2.verts, c.count);
    }
    tp.set('uTopOn', 0);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(vp[0], vp[1], vp[2], vp[3]);
    if (!depthOn) gl.disable(gl.DEPTH_TEST);
    if (blend) gl.enable(gl.BLEND);
    gl.depthFunc(depthFn);
    gl.clearColor(0, 0, 0, 0);
    target.dispose();
    tex.genMips();
    gl.bindTexture(gl.TEXTURE_2D, null);
    G.objTex = tex;
    G.objRect.set([x0, z0, top[2], top[3]]);
    G.objSize = [tw, th, texel];
  }

  // ---- per frame ----
  update(dt, ot) {
    const g = this.game, app = g.app, land = g.land;
    if (this.course !== g.course) this.setCourse(g.course);
    const G = this.G;
    if (!G) return;
    this.tier = TIERS[settings.active] || TIERS.medium;
    // the governor's level: shed tree range and fine levels first, object shadows last
    const fx = app.fx ? app.fx.shadows : 1;
    this.scale = this.tier.lod * (0.6 + 0.4 * fx);
    this.treeFar = this.tier.treeFar * (0.7 + 0.3 * fx);
    const C = land.cover;
    C.treeFar = this.treeFar;
    C.objTex = fx > 0.05 ? G.objTex : null;
    if (fx > 0.05) C.objRect.set(G.objRect); else C.objRect.fill(0);
    // the lamp posts nearest a point a little ahead of the camera light the ground
    const dark = smoothstep(0.2, 0.6, g.meshes.lamp || 0);
    this.dark = dark;
    C.lampOn = dark;
    C.lampP.fill(0);
    if (dark > 0.01 && G.posts.length) {
      const cam = app.cam, fxp = cam.pos[0] + Math.cos(cam.yaw) * 25, fzp = cam.pos[2] + Math.sin(cam.yaw) * 25, best = this.best;
      let n = 0;
      for (const l of G.posts) {
        const d = (l.x - fxp) * (l.x - fxp) + (l.z - fzp) * (l.z - fzp);
        if (d > 140 * 140) continue;
        let k = n < LAMPS ? n++ : (d < best[LAMPS - 1].d ? LAMPS - 1 : -1);
        if (k < 0) continue;
        best[k].d = d; best[k].l = l;
        while (k > 0 && best[k - 1].d > best[k].d) { const t = best[k - 1]; best[k - 1] = best[k]; best[k] = t; k--; }
      }
      for (let k = 0; k < n; k++) { const l = best[k].l; C.lampP[k * 4] = l.x; C.lampP[k * 4 + 1] = l.y; C.lampP[k * 4 + 2] = l.z; C.lampP[k * 4 + 3] = l.size; }
    }
    // Finer levels asked for by the last frame: as many as fit in a few milliseconds, and at least one. Where the
    // camera has just arrived somewhere (a start, a reset, another course) everything it asks for is built at once,
    // behind the fade, so a place is never first seen at its coarse level.
    const cp = app.cam.pos, lp = this.lastCam || (this.lastCam = [1e9, 0, 1e9]);
    if (Math.hypot(cp[0] - lp[0], cp[2] - lp[2]) > 30) this.rush = 3;
    lp[0] = cp[0]; lp[2] = cp[2];
    const t0 = now(), ok = () => this.rush > 0 || now() - t0 < 4;
    let built = 0;
    const serve = (list, build) => { for (const it of list) if (it.want !== undefined) { if (!it.lods[it.want] && (!built || ok())) { build(it); built++; } if (it.lods[it.want]) it.want = undefined; } };
    serve(G.ground, (it) => this.build(G, it, it.want));
    serve(G.fixed, (it) => this.build(G, it, it.want));
    serve(G.models.values(), (m) => this.buildModel(m, m.want));
    if (this.rush > 0) this.rush--;
    if (G.glowDirty) this.glowBuffer(G);
  }

  // the level to draw at a distance: the wanted one if built, else the next coarser (and ask for the wanted one)
  level(it, d) {
    const k = this.scale;
    let l = d < it.at[0] * k ? 0 : d < it.at[1] * k ? 1 : 2;
    if (!it.lods[l]) { if (it.want === undefined || l < it.want) it.want = l; while (l < 2 && !it.lods[l]) l++; }
    return it.lods[l];
  }

  draw(scene, m) {
    const G = this.G;
    if (!G) return;
    const gl = this.gl, app = this.game.app, cam = app.cam.pos, mat = this.mat, st = this.stats, t = app.time;
    st.draws = 0; st.tris = 0; st.trees = 0; st.treeTris = 0; st.treeLod.fill(0);
    // ---- fixed things: quays, piers, buildings ----
    const o = this.opt;
    o.float = 0;
    m.begin(scene);
    for (const it of G.fixed) {
      const b = it.box;
      if (!boxVisible(b[0], b[1], b[2], b[3], b[4], b[5])) continue;
      const d = Math.hypot(Math.max(b[0] - cam[0], 0, cam[0] - b[3]), Math.max(b[2] - cam[2], 0, cam[2] - b[5]));
      if (d > it.cull) continue;
      const L = this.level(it, d);
      if (!L) continue;
      m.draw(L.mesh, rotY(mat, it.yaw, it.x, it.y, it.z), o);
      st.draws++; st.tris += L.tris;
    }
    // ---- afloat: the mesh pass floats them at their origins; the slope is taken over each one's length ----
    o.float = 1;
    this.foot = 0;
    for (const f of G.floats) {
      if (!boxVisible(f.x - f.r, -2, f.z - f.r, f.x + f.r, 6, f.z + f.r)) continue;
      const d = Math.hypot(f.x - cam[0], f.z - cam[2]);
      if (d > f.cull) continue;
      const k = this.scale, M = f.m;
      let l = d < f.at[0] * k ? 0 : d < f.at[1] * k ? 1 : 2;
      if (!M.lods[l]) { if (M.want === undefined || l < M.want) M.want = l; while (l < 2 && !M.lods[l]) l++; }
      const L = M.lods[l];
      if (!L) continue;
      if (M.foot !== this.foot) { m.prog.use(); m.prog.set('uFoot', M.foot); this.foot = M.foot; }
      m.draw(L.mesh, rotY(mat, f.yaw + f.swing * Math.sin(t * 0.09 + f.phase), f.x, 0, f.z), o);
      st.draws++; st.tris += L.tris;
    }
    if (this.foot) { m.prog.use(); m.prog.set('uFoot', 0); this.foot = 0; }
    o.float = 0;
    // ---- trees: a cell is one draw at the level its distance asks for ----
    const T = G.trees;
    if (T && T.count) {
      const p = this.treeProg, far = this.treeFar, k = this.scale, W = app.weather ? app.weather.state : null;
      p.use(scene);
      p.set('uTopOn', 0);
      p.set('uSway', Math.min((W ? W.wind : 6) / 9, 2));
      gl.disable(gl.CULL_FACE);
      gl.bindVertexArray(this.treeVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, T.buf);
      let bound = -1;
      const put = (c, l) => {
        const L = this.levels[l];
        if (l !== bound) { p.set('uMesh', L.tex); p.set('uDim', L.dim); bound = l; }
        gl.vertexAttribPointer(1, 4, gl.FLOAT, false, FLOATS * 4, c.start * FLOATS * 4);
        gl.vertexAttribPointer(2, 4, gl.FLOAT, false, FLOATS * 4, c.start * FLOATS * 4 + 16);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, L.verts, c.count);
        st.draws++; st.trees += c.count; st.treeTris += c.count * L.tris; st.treeLod[l] += c.count;
      };
      const far3 = TREE_LOD[2] * k;
      for (const B of T.blocks) {
        const db = Math.hypot(Math.max(B.x0 - cam[0], 0, cam[0] - B.x1), Math.max(B.z0 - cam[2], 0, cam[2] - B.z1));
        if (db > far || !boxVisible(B.x0 - 8, B.y0 - 2, B.z0 - 8, B.x1 + 8, B.y1 + 2, B.z1 + 8)) continue;
        // a block wholly at the farthest level is one draw; a nearer one is drawn cell by cell
        if (db > far3) { put(B, 3); continue; }
        for (let i = B.first; i < B.first + B.n; i++) {
          const c = T.cells[i];
          const d = Math.hypot(Math.max(c.x0 - cam[0], 0, cam[0] - c.x1), Math.max(c.z0 - cam[2], 0, cam[2] - c.z1));
          if (d > far || !boxVisible(c.x0 - 8, c.y0 - 2, c.z0 - 8, c.x1 + 8, c.y1 + 2, c.z1 + 8)) continue;
          put(c, d < TREE_LOD[0] * k ? 0 : d < TREE_LOD[1] * k ? 1 : d < far3 ? 2 : 3);
        }
      }
      gl.bindVertexArray(null);
      st.tris += st.treeTris;
      // our program and textures were bound over the mesh pass's: put them back for what is drawn after us
      m.begin(scene);
    }
  }

  // glows round the lamps, additive, after the particles: one draw
  drawTransparent(scene) {
    const G = this.G;
    if (!G || !G.glow || !G.glow.n) { this.stats.glows = 0; return; }
    const gl = this.gl, app = this.game.app, v = this.view;
    v[0] = Math.tan(app.cam.fov / 2); v[1] = app.w / app.h; v[2] = this.dark || 0;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.depthMask(false);
    this.glowProg.use(scene);
    this.glowProg.set('uView', v);
    gl.bindVertexArray(G.glow.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, G.glow.n);
    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    this.stats.glows = G.glow.n;
    this.stats.draws++;
  }
}
