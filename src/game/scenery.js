// Things that stand in and float on the sea besides the course marks: a lighthouse, a breakwater,
// piled beacons and an offshore platform (fixed: the sea rises and falls against them), and a
// committee boat, anchored spectator boats and a container ship (they ride the waves). Everything
// is built in code (models/structures.js, models/vessels.js) and placed deterministically from the
// course: a layout is plain data (buildLayout), the same for every player, kept clear of the racing
// line, and kept in water deep enough for what stands in it (tools/check-land.mjs checks it against the land).
//
// Lights: the lighthouse sweeps a beam round that shows at low sun and in storms; beacons, the
// breakwater head and the platform's obstruction lights flash or burn; boats show anchor lights,
// the container ship its sidelights; windows glow at dusk, the platform's flare burns all day. They
// are scaled by the darkness level game.meshes.lamp, as marks.js does.
//
// Cost (triangles): lighthouse 3.8k near / 0.6k far, breakwater 12k near in eight chunks (1.5k
// each) / 0.8k far, beacon 0.8k / 0.2k, platform 3.6k / 0.5k, yacht 2.3k / 0.6k, cruiser 2.4k / 0.7k,
// RIB 1.0k / 0.3k, committee boat 2.7k / 0.6k, container ship 3.3k (far only). One draw per
// object; objects behind the camera, beyond their cut-off (2.6 km for small boats, 12 km for the
// rest) or outside the view are skipped; glows are one quad each. No per-frame allocation.
import { lighthouseGeo, breakwaterChunks, smoothPath, beaconGeo, platformGeo, LIGHTHOUSE, BEACON, PLATFORM, BREAKWATER, rng } from './models/structures.js';
import { yachtGeo, cruiserGeo, ribGeo, committeeGeo, cargoGeo, YACHT, CRUISER, RIB, COMMITTEE, CARGO } from './models/vessels.js';
import { Texture, Target, Program, makeMesh, bindEmpty, fullscreen, FULLSCREEN_VS } from '../gl.js';
import { SKY_LOOKUP_GLSL } from '../sky/atmosphere.js';
import { smoothstep } from '../math.js';

const SEA_T0 = 60;              // sea time at the start of a race (game.js)
const REL = 0.6;                // how far a float leans toward the slope of the sea (mesh.js)
const PN = 12;                  // floating objects whose heave the glows follow
const ZERO = { dx: 0, dy: 0, dz: 0, sx: 0, sz: 0 };
const KINDS = {
  yacht: { make: yachtGeo, radius: 8, nearD: 220, cull: 2600 },
  cruiser: { make: cruiserGeo, radius: 9, nearD: 220, cull: 2600 },
  rib: { make: ribGeo, radius: 5, nearD: 160, cull: 2000 },
  committee: { make: committeeGeo, radius: 10, nearD: 280, cull: 3000 },
};

// ---- layout: plain data, a pure function of the course ---------------------------------
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
const round = (v) => Math.round(v * 10) / 10;
// a point on the course: along gate i's direction, across it (positive to starboard)
const at = (course, i, along, across) => { const g = course.gates[i]; return [g.c[0] + g.dir[0] * along + g.nrm[0] * across, g.c[1] + g.dir[1] * along + g.nrm[1] * across]; };
const KIND_CYCLE = ['yacht', 'cruiser', 'rib', 'yacht', 'cruiser', 'yacht', 'rib', 'cruiser'];

export function buildLayout(course) {
  const R = rng(hash(course.id)), n = course.gates.length;
  const g0 = course.gates[0], hw = g0.hw;
  const heading = Math.atan2(g0.dir[1], g0.dir[0]);
  // anchored boats lie to the same wind, give or take
  const windYaw = heading + (R() < 0.5 ? 1 : -1) * (1.9 + R() * 0.5);
  const L = { id: course.id, seed: hash(course.id), windYaw, lighthouse: null, breakwater: null, beacons: [], platform: null, spectators: [], committee: null, cargo: null };
  const spec = (kind, x, z, spread = 0.4) => L.spectators.push({ kind, x: round(x), z: round(z), yaw: round(windYaw + (R() - 0.5) * 2 * spread), seed: 1 + Math.floor(R() * 3) });
  // the committee boat lies off the starboard end of the line, broadside to it
  { const [x, z] = at(course, 0, 4, hw + 34); L.committee = { x: round(x), z: round(z), yaw: round(windYaw + 0.2) }; }
  const cluster = (kinds, i, pts) => pts.forEach(([al, ac], k) => { const [x, z] = at(course, i, al, ac); spec(kinds[k % kinds.length], x, z); });
  if (course.id === 'circuit') {
    // Breakwater Circuit: a rubble wall runs out from the shore at the east end of the harbour (its root buried
    // in the land), its head 36 m off the line where the course turns away; the lighthouse stands on the
    // headland to the east; a platform stands off to the south-west
    L.breakwater = { path: [[470, -215], [478, -160], [488, -100], [503, -24]], side: -1, seed: 5 };
    L.lighthouse = { x: 706, z: 46, yaw: round(heading + Math.PI) };
    L.beacons = [{ x: 560, z: 462, style: 'stbd' }, { x: 215, z: 592, style: 'north' }, { x: -318, z: 100, style: 'port' }];
    L.platform = { x: -300, z: 1080, yaw: 0.6 };
    cluster(KIND_CYCLE, 0, [[60, 44], [110, 62], [150, 48], [-52, 52]]);
    spec('yacht', 660, 236); spec('cruiser', 640, 405); spec('rib', 505, 560); spec('yacht', 380, 40); spec('rib', 20, 50);
    L.cargo = { x: -852, z: 1186, heading: 3.14, speed: 3.5 };    // outbound to the west, in deep water for 9 km
  } else if (course.id === 'sprint') {
    // Long Reach: beacons on the open side of the line (south in the west, north along the islands), the lighthouse beyond the finish
    for (const [k, across, style] of [[1, 60, 'stbd'], [2, 62, 'stbd'], [4, 62, 'stbd'], [6, -62, 'port'], [10, -64, 'port'], [13, 64, 'stbd']]) { const [x, z] = at(course, k, 0, across); L.beacons.push({ x: round(x), z: round(z), style }); }
    L.lighthouse = { x: 4580, z: -300, yaw: round(Math.atan2(g0.dir[1], g0.dir[0]) + 2.6) };   // on the headland by the harbour
    L.platform = { x: 2100, z: 950, yaw: 0.3 };
    cluster(KIND_CYCLE, 0, [[110, 62], [175, 82], [240, 66], [95, -64], [165, -86]]);
    cluster(KIND_CYCLE.slice(2), n - 1, [[-70, 54], [-20, 72], [-150, 60]]);
    cluster(KIND_CYCLE.slice(1), 6, [[-40, -60], [30, -76]]);
    L.cargo = { x: 2700, z: 782, heading: 0, speed: 4 };            // eastbound in the fairway 450 m south of the line: the fleet overtakes it
  } else {
    // Tidal Speedway: spectators line the infield side of the north straight and the turns, the platform
    // stands off in the distance beyond the barrier beach
    L.beacons = [{ x: -700, z: 152, style: 'port' }, { x: -540, z: -72, style: 'stbd' }, { x: -690, z: 280, style: 'north' }];
    L.platform = { x: 700, z: 1150, yaw: 0.9 };
    [[110, 56], [190, 68], [270, 58], [350, 66], [-120, 56], [-260, 62]].forEach(([x, z], k) => spec(KIND_CYCLE[k], x, z));
    [[-330, 140], [-120, 122], [150, 112], [330, 140]].forEach(([x, z], k) => spec(KIND_CYCLE[(k + 3) % 8], x, z));
    L.cargo = { x: -780, z: 800, heading: 2.75, speed: 3.2 };       // outside the barrier beach, deep water for 2.8 km (a quarter of an hour)
  }
  return L;
}

// ---- glow sprite (as the marks' lanterns, see marks.js) ----
const GVS = `
uniform vec3 uPos;
uniform vec2 uHalf;
uniform mat4 uViewProj;
out vec2 vQ;
void main() {
  int k = gl_VertexID % 6;
  vec2 q = k == 0 ? vec2(-1, -1) : k == 1 ? vec2(1, -1) : k == 2 ? vec2(1, 1) : k == 3 ? vec2(-1, -1) : k == 4 ? vec2(1, 1) : vec2(-1, 1);
  vQ = q;
  vec4 p = uViewProj * vec4(uPos, 1.0);
  p.xy += q * uHalf * p.w;
  gl_Position = p;
}`;
const GFS = SKY_LOOKUP_GLSL + `
in vec2 vQ;
out vec4 oColor;
uniform vec3 uPos;
uniform vec3 uCamPos;
uniform vec3 uColor;
uniform float uGain;
void main() {
  float r2 = dot(vQ, vQ);
  if (r2 >= 1.0) discard;
  float g = exp(-r2 * 6.0) * 0.5 + exp(-r2 * 50.0) * 1.6;
  g *= 1.0 - r2 * r2;
  vec3 toCam = uCamPos - uPos;
  float dist = length(toCam);
  vec3 skyE = skyIrradiance(), sunE = sunIlluminance();
  float amb = dot(skyE + sunE * max(uSunDir.y, 0.0), vec3(0.3333)) / 3.14159265;
  vec3 col = uColor * g * (amb * uGain + 3e-4 * uGain * 0.2);
  vec3 aL, aT;
  aerial(-toCam / dist, dist * 0.001, aL, aT);
  vec3 fogged = applyFog(col * aT, -toCam / dist, dist);
  oColor = vec4(fogged - applyFog(vec3(0.0), -toCam / dist, dist), 1.0);
}`;

// ---- the lighthouse beam: a long, soft cone, additive, drawn from its lantern ----
// Unit cone along +x (s = distance fraction, then the unit direction round the axis), placed by
// uniforms. Its brightness at a point is the length of the chord through the cone there, so the
// edge fades; it thins out along its length and is dimmed by the haze like the glows.
const BVS = `
layout(location = 0) in vec3 aPos;
uniform mat4 uViewProj;
uniform vec3 uOrigin;
uniform vec2 uDir;        // unit direction in xz
uniform float uLen;
uniform vec2 uR;          // radius at the lantern and at the far end
out vec3 vWorld;
out vec3 vRad;
out float vS;
void main() {
  vec3 d = vec3(uDir.x, 0.0, uDir.y);
  vec3 side = vec3(-d.z, 0.0, d.x);
  vec3 rad = side * aPos.y + vec3(0.0, 1.0, 0.0) * aPos.z;
  float r = mix(uR.x, uR.y, aPos.x);
  vec3 P = uOrigin + d * (aPos.x * uLen) + rad * r;
  vWorld = P; vRad = rad; vS = aPos.x;
  gl_Position = uViewProj * vec4(P, 1.0);
}`;
const BFS = SKY_LOOKUP_GLSL + `
in vec3 vWorld;
in vec3 vRad;
in float vS;
out vec4 oColor;
uniform vec3 uCamPos;
uniform vec3 uColor;
uniform float uGain;
void main() {
  vec3 toCam = uCamPos - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  float k = abs(dot(normalize(vRad), V));
  // the light spreads as the cone widens, so a shaft is brightest at the lantern and thins fast
  float along = smoothstep(0.0, 0.02, vS) * pow(1.0 - vS, 1.6) / (1.0 + vS * 16.0);
  vec3 skyE = skyIrradiance(), sunE = sunIlluminance();
  float amb = dot(skyE + sunE * max(uSunDir.y, 0.0), vec3(0.3333)) / 3.14159265;
  vec3 col = uColor * k * k * k * along * (amb * uGain + 3e-4 * uGain * 0.2);
  vec3 aL, aT;
  aerial(-V, dist * 0.001, aL, aT);
  vec3 fogged = applyFog(col * aT, -V, dist);
  oColor = vec4(fogged - applyFog(vec3(0.0), -V, dist), 1.0);
}`;
const BEAM_COLOUR = [1, 0.9, 0.62];
// (short and faint: there is no night in this game, and by day a long bright beam seen side-on is a pale band across the far shore)
const BEAM_LEN = 2600, BEAM_R = [1.2, 72], BEAM_PERIOD = 10;
function beamMesh(gl) {
  const segs = 14, rings = 14, p = [];
  const pt = (i, j) => { const s = Math.pow(i / rings, 1.8), a = (j / segs) * Math.PI * 2; return [s, Math.cos(a), Math.sin(a)]; };
  for (let i = 0; i < rings; i++) for (let j = 0; j < segs; j++) {
    p.push(...pt(i, j), ...pt(i + 1, j), ...pt(i + 1, j + 1), ...pt(i, j), ...pt(i + 1, j + 1), ...pt(i, j + 1));
  }
  const m = makeMesh(gl, [[new Float32Array(p), 3]]);
  m.count = p.length / 3;
  return m;
}

// ---- where the floating things are (a copy of the marks' probe with a per-point baseline) ----
const PROBE_FS = `
uniform sampler2D uDisp[3];
uniform float uSize[4];
uniform float uTexel[4];
uniform vec3 uPts[${PN}];   // x, z, half baseline
out vec4 o;
vec3 dispAt(vec2 xz) {
  vec3 D = textureLod(uDisp[0], xz / uSize[0], max(1.0 - log2(uTexel[0]), 0.0)).xyz;
  D += textureLod(uDisp[1], xz / uSize[1], max(1.0 - log2(uTexel[1]), 0.0)).xyz;
  D += textureLod(uDisp[2], xz / uSize[2], max(1.0 - log2(uTexel[2]), 0.0)).xyz;
  return D;
}
void main() {
  int k = int(gl_FragCoord.x);
  vec3 q = uPts[k >> 1];
  vec2 a = q.xy;
  if ((k & 1) == 0) { o = vec4(dispAt(a), 1.0); return; }
  float e = q.z;
  float hx = dispAt(a + vec2(e, 0.0)).y - dispAt(a - vec2(e, 0.0)).y;
  float hz = dispAt(a + vec2(0.0, e)).y - dispAt(a - vec2(0.0, e)).y;
  o = vec4(hx / (2.0 * e), hz / (2.0 * e), 0.0, 1.0);
}`;
class FloatProbe {
  constructor(gl) {
    this.gl = gl;
    this.prog = new Program(gl, FULLSCREEN_VS, PROBE_FS, { label: 'scenery-probe' });
    this.tex = new Texture(gl, { w: PN * 2, h: 1, format: 'rgba32f', filter: 'nearest' });
    this.target = new Target(gl, [this.tex]);
    this.pbo = gl.createBuffer();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, PN * 32, gl.STREAM_READ);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    this.data = new Float32Array(PN * 8);
    this.flat = new Float32Array(PN * 3);
    this.pending = []; this.n = 0;
    this.fence = null;
  }
  // items: up to PN objects with x, z, e and a result record pr
  run(ot, items, n) {
    const gl = this.gl;
    if (this.fence) {
      if (gl.clientWaitSync(this.fence, 0, 0) === gl.TIMEOUT_EXPIRED) return;
      gl.deleteSync(this.fence); this.fence = null;
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this.data);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      const d = this.data;
      for (let i = 0; i < this.n; i++) { const r = this.pending[i].pr; r.dx = d[i * 8]; r.dy = d[i * 8 + 1]; r.dz = d[i * 8 + 2]; r.sx = d[i * 8 + 4]; r.sz = d[i * 8 + 5]; }
    }
    this.n = n;
    for (let i = 0; i < n; i++) { this.pending[i] = items[i]; this.flat[i * 3] = items[i].x; this.flat[i * 3 + 1] = items[i].z; this.flat[i * 3 + 2] = items[i].foot * 0.5; }
    fullscreen(gl, this.prog, { uDisp: ot.disp.slice(0, 3), uSize: ot.sizes, uTexel: ot.texels, uPts: this.flat }, this.target);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
    gl.readPixels(0, 0, PN * 2, 1, gl.RGBA, gl.FLOAT, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    this.fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
  }
}

// the committee boat's sign, drawn once
function signTexture(gl) {
  const w = 1024, h = 220, c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.fillStyle = '#0d1f45'; x.fillRect(0, 0, w, h);
  x.fillStyle = '#e8e8e2'; x.fillRect(0, 0, w, 12); x.fillRect(0, h - 12, w, 12);
  x.fillStyle = '#e8e8e2'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = 'bold 96px "Arial Black", "Helvetica Neue", Arial, "DejaVu Sans", sans-serif';
  x.fillText('RACE COMMITTEE', w / 2, h / 2 + 4);
  const data = x.getImageData(0, 0, w, h).data;
  const t = new Texture(gl, { w, h, format: 'rgba8', filter: 'linear', mips: true, aniso: 4, data: new Uint8Array(data.buffer) });
  t.genMips();
  return t;
}

const rotY = (m, a, x, z) => {
  const c = Math.cos(a), s = Math.sin(a);
  m.set([c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, x, 0, z, 1]);
  return m;
};

export class Scenery {
  constructor(game) {
    this.game = game;
    this.gl = game.app.gl;
    this.course = null;
    this.layout = null;
    this.items = [];          // everything drawn: { kind, model, x, z, yaw, float, foot, ... }
    this.colliders = [];      // { kind, x, z, r } or { kind, x, z, hx, hz, yaw }: for collisions later
    this.models = new Map();
    this.tex = {};
    this.ready = null;
    this.probe = new FloatProbe(this.gl);
    this.glow = null; this.beam = null; this.beamMesh = null;
    this.mat = new Float32Array(16);
    this.opt = { float: 0, texture: null };
    this.foot = 0;
    this.cand = []; this.byDist = (a, b) => a.d - b.d;
    this.stats = { drawn: 0, tris: 0, items: 0, glows: 0 };
    this.glowPos = [0, 0, 0]; this.glowHalf = [0, 0];
    this.lampPos = [0, 0, 0];
    this.dark = 0;
  }

  // ---- layout into items and colliders ----
  setLayout(course) {
    const L = buildLayout(course);
    this.layout = L; this.course = course;
    const items = this.items = [], col = this.colliders = [];
    const add = (it) => { items.push(it); return it; };
    const rnd = rng(L.seed);
    if (L.lighthouse) {
      add({ kind: 'lighthouse', key: 'lighthouse', ...L.lighthouse, radius: LIGHTHOUSE.rockR + 4, cy: 12, nearD: 1300, cull: 14000, phase: 0 });
      col.push({ kind: 'lighthouse', x: L.lighthouse.x, z: L.lighthouse.z, r: LIGHTHOUSE.rockR * 0.72 });
    }
    if (L.breakwater) {
      const b = L.breakwater;
      add({ kind: 'breakwater', key: 'bw', path: b.path, side: b.side, seed: b.seed, x: b.path[0][0], z: b.path[0][1], yaw: 0, radius: 0, cull: 0, chunks: true });
      // colliders: circles along the mound, wider at the round head
      const rows = smoothPath(b.path, 9);
      rows.forEach((q, i) => col.push({ kind: 'breakwater', x: round(q.x), z: round(q.z), r: i === rows.length - 1 ? BREAKWATER.headR * 0.85 : 8 }));
    }
    for (const b of L.beacons) {
      add({ kind: 'beacon', key: 'beacon-' + b.style, style: b.style, x: b.x, z: b.z, yaw: 0, radius: BEACON.radius + 2, cy: 6, nearD: 500, cull: 6000, phase: rnd() * 8 });
      col.push({ kind: 'beacon', x: b.x, z: b.z, r: 2.6 });
    }
    if (L.platform) {
      const p = L.platform;
      add({ kind: 'platform', key: 'platform', ...p, radius: PLATFORM.radius, cy: 25, nearD: 1500, cull: 16000, phase: 0 });
      col.push({ kind: 'platform', x: p.x, z: p.z, hx: 20, hz: 15, yaw: p.yaw });
    }
    const vessel = (kind, v, i) => {
      const K = KINDS[kind];
      add({ kind, key: kind + (kind === 'committee' ? '' : v.seed), seed: v.seed || 1, x: v.x, z: v.z, yaw: v.yaw, radius: K.radius, cy: 3, nearD: K.nearD, cull: K.cull, float: 1, phase: rnd() * 6.28, swing: 0.04 + rnd() * 0.05, pr: { dx: 0, dy: 0, dz: 0, sx: 0, sz: 0 }, d: 0 });
      col.push({ kind, x: v.x, z: v.z, r: K.radius * 0.7 });
    };
    vessel('committee', { ...L.committee, seed: 1 });
    L.spectators.forEach((s, i) => vessel(s.kind, s, i));
    if (L.cargo) {
      const c = L.cargo;
      add({ kind: 'cargo', key: 'cargo', ...c, yaw: c.heading, x0: c.x, z0: c.z, radius: CARGO.radius, cy: 25, nearD: 0, cull: 14000, float: 1, phase: 0, pr: { dx: 0, dy: 0, dz: 0, sx: 0, sz: 0 }, d: 0 });
    }
    this.ready = null;
  }

  // a model at both levels of detail (one level when `single`: the container ship is only ever far)
  model(key, make, texKey, single = false) {
    let m = this.models.get(key);
    if (m) return m;
    const gl = this.gl;
    const a = make(0), b = single ? a : make(1);
    const A = { mesh: a.g.build(gl), tris: a.g.p.length / 9 };
    m = { near: A, far: single ? A : { mesh: b.g.build(gl), tris: b.g.p.length / 9 }, lamps: a.lamps, foot: a.foot || 0, tex: texKey ? this.tex[texKey] : null };
    this.models.set(key, m);
    return m;
  }

  // models and textures are built outside the draw pass (making a texture rebinds units)
  ensure() {
    const gl = this.gl;
    if (!this.tex.sign) this.tex.sign = signTexture(gl);
    for (const it of this.items) {
      if (it.chunks) {
        if (it.near) continue;
        const near = breakwaterChunks(it.path, it.side, 0, it.seed), far = breakwaterChunks(it.path, it.side, 1, it.seed);
        it.parts = near.map((c, i) => ({ x: c.x, z: c.z, cx: c.cx, cz: c.cz, r: c.r, near: { mesh: c.g.build(gl), tris: c.g.p.length / 9 }, far: { mesh: far[i].g.build(gl), tris: far[i].g.p.length / 9 }, lamps: c.lamps }));
        it.near = true;
        for (const c of it.parts) c.owner = { x: c.x, z: c.z, yaw: 0, phase: 1.7, float: 0 };
        continue;
      }
      let m;
      const seed = it.seed || 3;
      switch (it.kind) {
        case 'lighthouse': m = this.model('lighthouse', (l) => lighthouseGeo(l, 3)); break;
        case 'beacon': m = this.model(it.key, (l) => beaconGeo(it.style, l, 1)); break;
        case 'platform': m = this.model('platform', (l) => platformGeo(l, 2)); break;
        case 'cargo': m = this.model('cargo', () => cargoGeo(1), null, true); break;
        default: m = this.model(it.key, (l) => KINDS[it.kind].make(l, seed), it.kind === 'committee' ? 'sign' : null);
      }
      it.m = m; it.foot = m.foot;
    }
    this.ready = this.course;
  }

  // ---- per frame ----
  update(dt, ot) {
    const g = this.game;
    if (this.course !== g.course) { this.setLayout(g.course); }
    if (this.ready !== this.course) this.ensure();
    const t = this.game.app.time, cam = this.game.app.cam.pos;
    // moving things: the cargo ship steams slowly; anchored boats swing a little
    for (const it of this.items) {
      if (it.kind === 'cargo') {
        const s = it.speed * (t - SEA_T0);
        it.x = it.x0 + Math.cos(it.heading) * s; it.z = it.z0 + Math.sin(it.heading) * s;
      } else if (it.float) it.sw = it.swing * Math.sin(t * 0.09 + it.phase);
    }
    if (!ot) return;
    // the sea under the floating things nearest the camera, so their lights follow the heave and lean
    const c = this.cand; c.length = 0;
    for (const it of this.items) if (it.float && it.kind !== 'cargo') { it.d = Math.hypot(it.x - cam[0], it.z - cam[2]); if (it.d < 700) c.push(it); }
    c.sort(this.byDist);
    if (c.length) this.probe.run(ot, c, Math.min(c.length, PN));
    this.cand = c;
  }

  visible(x, y, z, r, far) {
    const app = this.game.app, c = app.cam;
    const dx = x - c.pos[0], dy = y - c.pos[1], dz = z - c.pos[2];
    const d = Math.hypot(dx, dy, dz);
    if (d > far) return false;
    if (d < r + 1) return true;
    const cp = Math.cos(c.pitch);
    const dot = (dx * Math.cos(c.yaw) * cp + dy * Math.sin(c.pitch) + dz * Math.sin(c.yaw) * cp) / d;
    const half = Math.atan(Math.tan(c.fov / 2) * Math.hypot(1, app.w / app.h)) + Math.asin(Math.min(r / d, 1));
    return dot > Math.cos(Math.min(half, 3.1));
  }

  // one draw: the slope baseline of floating things is set on the mesh program (mesh.js: uFoot) and put back for fixed ones
  put(m, lod, tex, float, foot) {
    const p = m.prog, o = this.opt;
    if (foot !== this.foot) { p.use(); p.set('uFoot', foot); this.foot = foot; }
    o.float = float; o.texture = tex;
    m.draw(lod.mesh, this.mat, o);
    this.stats.drawn++; this.stats.tris += lod.tris;
  }

  draw(scene, m) {
    if (this.ready !== this.course) { this.ensure(); m.begin(scene); }
    const cam = this.game.app.cam.pos, mat = this.mat;
    const st = this.stats; st.drawn = 0; st.tris = 0; st.items = this.items.length;
    this.foot = 0;
    for (const it of this.items) {
      if (it.chunks) {
        if (!it.parts) continue;
        for (const c of it.parts) {
          if (!this.visible(c.cx, 3, c.cz, c.r, 8000)) continue;
          const d = Math.hypot(c.cx - cam[0], c.cz - cam[2]);
          rotY(mat, 0, c.x, c.z);
          this.put(m, d < 360 ? c.near : c.far, null, 0, 0);
        }
        continue;
      }
      if (!it.m) continue;
      if (!this.visible(it.x, it.cy, it.z, it.radius, it.cull)) { it.shown = false; continue; }
      const d = Math.hypot(it.x - cam[0], it.z - cam[2]);
      it.shown = true; it.d = d;
      rotY(mat, it.yaw + (it.sw || 0), it.x, it.z);
      this.put(m, d < it.nearD ? it.m.near : it.m.far, it.m.tex, it.float || 0, it.float ? it.foot : 0);
    }
    if (this.foot) { m.prog.use(); m.prog.set('uFoot', 0); this.foot = 0; }
  }

  // ---- lights ----
  // a lamp's glow gain and size by its kind and the darkness
  lampLevel(l, it, t, dark, out) {
    switch (l.kind) {
      case 'beam': {
        const a = this.beamAngle(it, t), dx = Math.cos(a), dz = Math.sin(a);
        const cam = this.game.app.cam.pos, tx = cam[0] - it.x, tz = cam[2] - it.z, tl = Math.hypot(tx, tz) || 1;
        const c = Math.abs(dx * tx + dz * tz) / tl;
        const f = Math.pow(c, 30);
        out.gain = 0.25 + dark * (2 + 30 * f); out.size = 1.2 + dark * 1.5 + 4 * f * dark; out.max = 9000; return out;
      }
      case 'flash': {
        const T = l.period || 4, ph = (((t + it.phase) % T) + T) % T, on = smoothstep(0.0, 0.1, ph) * (1 - smoothstep(l.on || 0.8, (l.on || 0.8) + 0.2, ph));
        out.gain = 0.12 + (0.3 + dark * 2.2) * on; out.size = 0.5 + 0.8 * dark * on; out.max = 7000; return out;
      }
      case 'anchor': out.gain = 0.1 + dark * 2.6; out.size = (l.size || 0.4) * (0.5 + 0.5 * dark); out.max = 3000; return out;
      case 'nav': out.gain = 0.14 + dark * 4.5; out.size = (l.size || 0.4) * (0.7 + dark); out.max = 8000; return out;
      case 'steady': out.gain = (0.05 + dark * 3) * (l.level || 1); out.size = (l.size || 0.3); out.max = 2500; return out;
      case 'window': out.gain = dark * dark * 0.9; out.size = (l.size || 0.8) * 0.8; out.max = 700; return out;
      case 'flood': out.gain = 0.06 + dark * 2.6; out.size = (l.size || 0.8) * (0.5 + 0.5 * dark); out.max = 2500; return out;
      case 'obstruction': {
        const ph = ((t * 0.9 + it.x * 0.01) % 1 + 1) % 1, on = 0.55 + 0.45 * Math.sin(ph * 6.2832);
        out.gain = 0.15 + (0.4 + dark * 5) * on; out.size = (l.size || 0.4) * (0.8 + dark); out.max = 9000; return out;
      }
      case 'flare': {
        const f = 0.78 + 0.22 * Math.sin(t * 11 + 1.3) * Math.sin(t * 7.3) + 0.12 * Math.sin(t * 23);
        out.gain = (1.6 + dark * 4) * f; out.size = (l.size || 3) * (0.8 + 0.3 * f); out.max = 14000; return out;
      }
      default: out.gain = 0; out.size = 0; out.max = 0; return out;
    }
  }
  beamAngle(it, t) { return it.yaw + (t / BEAM_PERIOD) * Math.PI * 2 + 1.0; }

  // where a lamp is now, in world space (out: [x, y, z])
  lampWorld(it, l, out) {
    const a = it.yaw + (it.sw || 0), cs = Math.cos(a), sn = Math.sin(a), p = l.p;
    const lx = cs * p[0] - sn * p[2], lz = sn * p[0] + cs * p[2], ly = p[1];
    if (!it.float) { out[0] = it.x + lx; out[1] = ly; out[2] = it.z + lz; return out; }
    const r = it.d < 700 && it.pr ? it.pr : ZERO;
    const ux = -r.sx * REL, uz = -r.sz * REL, ul = Math.hypot(ux, 1, uz);
    const uy = 1 / ul, uxn = ux / ul, uzn = uz / ul;
    // X = normalize(cross(up, z)), Z = cross(X, up): the same frame the vertex shader builds
    const xl = Math.hypot(uy, uxn) || 1, X0 = uy / xl, X1 = -uxn / xl;
    const Z0 = X1 * uzn, Z1 = -(X0 * uzn), Z2 = X0 * uy - X1 * uxn;
    out[0] = it.x + r.dx + lx * X0 + ly * uxn + lz * Z0;
    out[1] = r.dy + lx * X1 + ly * uy + lz * Z1;
    out[2] = it.z + r.dz + ly * uzn + lz * Z2;
    return out;
  }

  // glows round the lamps and the lighthouse beam, additive, after the particles
  drawTransparent(scene) {
    const gl = this.gl, app = this.game.app, t = app.time, cam = app.cam.pos;
    // lamps start to show a little earlier than the marks' do: the sun at 5 degrees is dusk for a light
    const lampLevel = this.game.meshes.lamp, dark = smoothstep(0.2, 0.6, lampLevel), beamDark = smoothstep(0.12, 0.42, lampLevel);
    this.dark = dark;
    if (!this.glow) this.glow = new Program(gl, GVS, GFS, { label: 'scenery-glow' });
    const tanHalf = Math.tan(app.cam.fov / 2), aspect = app.w / app.h;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.depthMask(false);
    // the beam first
    if (beamDark > 0.04) {
      if (!this.beam) { this.beam = new Program(gl, BVS, BFS, { label: 'scenery-beam' }); this.beamMesh = beamMesh(gl); }
      this.beam.use(scene);
      gl.bindVertexArray(this.beamMesh.vao);
      for (const it of this.items) {
        if (it.kind !== 'lighthouse' || !it.shown) continue;
        const a = this.beamAngle(it, t);
        const o = this._org || (this._org = [0, 0, 0]);
        o[0] = it.x; o[1] = LIGHTHOUSE.lampY; o[2] = it.z;
        this.beam.set('uOrigin', o);
        this.beam.set('uLen', BEAM_LEN);
        this.beam.set('uR', BEAM_R);
        this.beam.set('uColor', BEAM_COLOUR);
        // the beam's gain is relative to the light everything else gets; under storm cloud the sky is far
        // darker than that light suggests (the sun's share does not reach the sea), and any beam bright enough
        // to see there is a pale band along the far shore: it shows at dusk and dawn only
        const L = app.local || {}, storm = Math.min(Math.max((L.dark || 0) * 0.95, (L.rain || 0) * 0.7) * 1.4, 1);
        this.beam.set('uGain', beamDark * 0.5 * (1 - storm) * (1 - storm));
        for (const k of [0, 1]) {
          const dv = this._dir || (this._dir = [0, 0]);
          dv[0] = Math.cos(a + k * Math.PI); dv[1] = Math.sin(a + k * Math.PI);
          this.beam.set('uDir', dv);
          gl.drawArrays(gl.TRIANGLES, 0, this.beamMesh.count);
        }
      }
    }
    this.glow.use(scene);
    bindEmpty(gl);
    const pos = this.glowPos, half = this.glowHalf, w = this.lampPos, out = this._lvl || (this._lvl = { gain: 0, size: 0, max: 0 });
    let n = 0;
    const lamp = (it, l) => {
      this.lampLevel(l, it, t, dark, out);
      if (out.gain < 0.02) return;
      this.lampWorld(it, l, w);
      const dx = cam[0] - w[0], dy = cam[1] - w[1], dz = cam[2] - w[2];
      const d = Math.hypot(dx, dy, dz);
      if (d > out.max || !this.visible(w[0], w[1], w[2], 2, out.max)) return;
      const k = 0.2 / d;
      pos[0] = w[0] + dx * k; pos[1] = w[1] + dy * k; pos[2] = w[2] + dz * k;
      const sy = Math.max(out.size / (d * tanHalf), 0.006 + 0.006 * dark);
      half[0] = sy / aspect; half[1] = sy;
      this.glow.set('uPos', pos);
      this.glow.set('uHalf', half);
      this.glow.set('uColor', l.col);
      this.glow.set('uGain', out.gain);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      n++;
    };
    for (const it of this.items) {
      if (it.chunks) {
        if (!it.parts) continue;
        for (const c of it.parts) for (const l of c.lamps) lamp(c.owner, l);
        continue;
      }
      if (!it.shown || !it.m) continue;
      for (const l of it.m.lamps) lamp(it, l);
    }
    this.stats.glows = n;
    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }
}
