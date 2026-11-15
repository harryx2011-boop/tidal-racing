// Spray thrown by the boats: sheets off the bow wave, a rooster tail behind the props, a burst when a
// boat lands, and a thin mist that hangs and drifts downwind behind the boat. Particles are simulated
// on the CPU (up to 3,000 per boat, ballistic with a little drag), uploaded each frame and drawn as one
// instanced batch of billboards, lit by the sun and sky like the foam and run through aerial
// perspective and fog like everything else in the pass. Droplets are stretched along their velocity
// (a fast drop is a streak, a mass of them a sheet); mist is a soft, slowly billowing puff.
import { Program } from '../gl.js';
import { SKY_LOOKUP_GLSL } from '../sky/atmosphere.js';
import { clamp } from '../math.js';
import { BOAT_ANCHORS } from './models/boat.js';
import { waterlineHalf, WATERLINE_END, WK } from './wake.js';

const MAX = 3000;          // particles per boat at full level
const MIST = 0.2;          // share of them that is mist
const G = 9.81;

const VS = `
layout(location = 0) in vec4 aA;   // position, full size
layout(location = 1) in vec4 aB;   // age 0..1, seed, kind (0 sheet, 1 rooster, 2 burst, 3 mist), density
layout(location = 2) in vec4 aC;   // velocity, brightness
uniform mat4 uViewProj;
uniform vec3 uCamPos;
centroid out vec2 vUv;
out float vAlpha;
out float vDist;
out float vSeed;
out float vKind;
out float vBright;
out vec3 vDir;
void main() {
  float age = aB.x, kind = aB.z;
  bool mist = kind > 2.5;
  vec3 pos = aA.xyz;
  // droplets start small and dense, then billow out and thin; mist puffs open up as they drift
  float size = aA.w * (mist ? 0.5 + 1.1 * age : 0.35 + 0.65 * sqrt(age));
  vec3 toCam = uCamPos - pos;
  float dist = length(toCam);
  vec3 vdir = toCam / max(dist, 1e-3);
  // a drop is drawn as a streak along its velocity as the camera sees it
  vec3 vel = aC.xyz;
  vec3 vp = vel - vdir * dot(vel, vdir);
  float sp = length(vel), spp = length(vp);
  vec3 u = spp > 0.05 ? vp / spp : normalize(cross(vec3(0.0, 1.0, 0.0), vdir));
  vec3 w = normalize(cross(vdir, u));
  float stretch = mist ? 1.0 : 1.0 + clamp(0.16 * spp, 0.0, 6.0);
  vec2 c = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1)) - 0.5;
  vec2 rc = c;
  if (mist) {
    float a = aB.y * 6.2831853;
    rc = vec2(c.x * cos(a) - c.y * sin(a), c.x * sin(a) + c.y * cos(a));
  }
  // the streak's head is its leading end (+y); the quad is centred a little behind the drop
  vec3 P = pos + w * rc.x * size + u * (rc.y * size * stretch - (mist ? 0.0 : 0.25 * size * (stretch - 1.0)));
  vUv = c + 0.5;
  vAlpha = aB.w * sin(3.14159 * min(age, 1.0)) * (1.0 - 0.4 * age) * smoothstep(0.3, 1.2, dist);
  vDist = dist;
  vDir = -vdir;
  vSeed = aB.y;
  vKind = kind;
  vBright = aC.w;
  gl_Position = uViewProj * vec4(P, 1.0);
}`;

// Spray is lit from the sun and sky, and much brighter against the sun (forward scattering): a drop
// thrown across the light catches it.
const FS = SKY_LOOKUP_GLSL + `
centroid in vec2 vUv;
in float vAlpha;
in float vDist;
in float vSeed;
in float vKind;
in float vBright;
in vec3 vDir;
out vec4 oColor;
uniform vec3 uFlash;
float hsh(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hsh(i), hsh(i + vec2(1, 0)), f.x), mix(hsh(i + vec2(0, 1)), hsh(i + vec2(1, 1)), f.x), f.y); }
void main() {
  vec2 q = vUv * 2.0 - 1.0;
  float r2 = dot(q, q);
  float a;
  if (vKind > 2.5) {
    // mist: a soft puff with a little structure, very thin
    float n = vn(q * 2.2 + vSeed * 53.0) * 0.6 + vn(q * 5.0 + vSeed * 17.0) * 0.4;
    a = pow(max(1.0 - r2, 0.0), 1.6) * (0.35 + 0.65 * n) * 0.06 * vAlpha;
  } else {
    // a streak: narrow across, tapering to a thin tail behind a rounded head, torn by noise so a
    // mass of them reads as a sheet of drops and ligaments rather than a stack of sprites
    float across = exp(-q.x * q.x * 5.0);
    float along = smoothstep(-1.0, 0.1, q.y) * (1.0 - smoothstep(0.5, 1.0, q.y)) * (0.5 + 0.5 * smoothstep(-1.0, 0.4, q.y));
    float n = vn(vec2(q.x * 3.0, q.y * 1.6) + vSeed * 91.0) * 0.55 + vn(vec2(q.x * 7.0, q.y * 3.5) + vSeed * 37.0) * 0.45;
    a = across * along * (0.07 + 0.9 * smoothstep(0.3, 0.65, n)) * vAlpha * vBright;
  }
  if (a < 0.002) discard;
  a = min(a, 1.0);
  vec3 dir = normalize(vDir);
  // droplets scatter all wavelengths alike; against the sun they flare
  float cs = max(dot(dir, uSunDir), 0.0);
  float fw = pow(cs, 6.0), fw2 = pow(cs, 40.0);
  vec3 E = skyIrradiance() * 0.8 + sunIlluminance() * uHazeSun * max(uSunDir.y, 0.0) * (0.5 + 2.8 * fw + 5.0 * fw2 * (vKind > 2.5 ? 0.3 : 1.0)) + uFlash * 0.3;
  vec3 Lc = vec3(dot(E, vec3(0.2126, 0.7152, 0.0722))) * (1.5 / 3.14159265);
  // (tinted by the sun's own colour only where it is strong: warm at sunset, white at noon)
  Lc = mix(Lc, Lc * normalize(sunIlluminance() + 1e-4) * 1.7, 0.5 * fw);
  vec3 aL, aT;
  aerial(dir, vDist * 0.001, aL, aT);
  vec3 c = Lc * aT + aL;
  c = applyFog(c, dir, vDist);
  oColor = vec4(c * a, a);
}`;


// one boat's particles (struct of arrays; two ring buffers overwrite the oldest: drops, then mist)
class Pool {
  constructor() {
    this.p = new Float32Array(MAX * 3); this.v = new Float32Array(MAX * 3);
    this.age = new Float32Array(MAX).fill(1e9); this.life = new Float32Array(MAX).fill(1);
    this.size = new Float32Array(MAX); this.seed = new Float32Array(MAX); this.kind = new Float32Array(MAX);
    this.dens = new Float32Array(MAX); this.floor = new Float32Array(MAX); this.bright = new Float32Array(MAX);
    this.head = 0; this.mhead = 0;
    this.carry = [0, 0, 0, 0];  // fractional emissions: bow, rooster, mist over the wash, mist off the bow
    this.prevAir = 0;
  }
  // drops live in [0, cap - mcap), mist in [cap - mcap, cap)
  spawn(cap, mcap, x, y, z, vx, vy, vz, life, size, kind, dens, floor) {
    let i;
    if (kind > 2.5) { i = cap - mcap + this.mhead; this.mhead = (this.mhead + 1) % mcap; }
    else { const n = cap - mcap; i = this.head % n; this.head = (this.head + 1) % n; }
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
    this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
    this.age[i] = 0; this.life[i] = life; this.size[i] = size; this.seed[i] = Math.random(); this.kind[i] = kind;
    this.dens[i] = dens; this.floor[i] = floor; this.bright[i] = 0.7 + 0.6 * Math.random();
  }
}

export class BoatSpray {
  constructor(game) {
    this.game = game;
    const gl = game.app.gl;
    this.gl = gl;
    this.pools = new Map();
    this.prog = null;       // compiled on first use: at level 0 the effect costs nothing
    this.buf = null;
    this.data = new Float32Array(MAX * WK.BOATS * 12);
    this.count = 0;
    this.wind = [0, 0];     // m/s at the height of the mist
  }

  init() {
    const gl = this.gl;
    this.prog = new Program(gl, VS, FS, { label: 'boatspray' });
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    for (let k = 0; k < 3; k++) {
      gl.enableVertexAttribArray(k);
      gl.vertexAttribPointer(k, 4, gl.FLOAT, false, 48, k * 16);
      gl.vertexAttribDivisor(k, 1);
    }
    gl.bindVertexArray(null);
  }

  update(dt) {
    const level = clamp(this.game.app.fx?.spray ?? 1, 0, 1);
    this.count = 0;
    if (level <= 0 || dt <= 0) { this.pools.clear(); return; }
    const cap = Math.max(Math.floor(MAX * level), 16), mcap = Math.max(Math.floor(cap * MIST), 4);
    const A = BOAT_ANCHORS;
    const S = this.game.app.weather?.state;
    if (S) { const wd = (S.windDir * Math.PI) / 180; this.wind[0] = Math.cos(wd) * S.wind * 0.45; this.wind[1] = Math.sin(wd) * S.wind * 0.45; }
    const seen = new Set();
    let n = 0;
    for (const b of this.game.renderBoats()) {
      if (b.ghost) continue;
      const pose = b.pose;
      const pool = this.pools.get(pose) || new Pool();
      this.pools.set(pose, pool);
      seen.add(pose);
      this.emit(pool, pose, dt, level, cap, mcap, A);
      n = this.step(pool, dt, n);
    }
    for (const k of this.pools.keys()) if (!seen.has(k)) this.pools.delete(k);
    this.count = n;
  }

  emit(pool, pose, dt, level, cap, mcap, A) {
    const { X, Y, Z } = pose.axes();
    const spd = pose.speed, q = clamp((spd - 6) / 30, 0, 1.2);
    const wet = pose.wet > 0.2;
    const at = (lx, ly, lz) => [pose.pos[0] + X[0] * lx + Y[0] * ly + Z[0] * lz, pose.pos[1] + X[1] * lx + Y[1] * ly + Z[1] * lz, pose.pos[2] + X[2] * lx + Y[2] * ly + Z[2] * lz];
    const vel = pose.vel, floor0 = pose.pos[1] - 0.45;
    const rnd = Math.random;
    // sizes are skewed: a few big drops and ligaments among many fine ones
    const sz = (lo, hi) => lo + (hi - lo) * rnd() * rnd();
    // bow sheets: the crest of the bow wave (see bowH in water.js) is torn off and thrown outward and up
    if (wet && q > 0) {
      pool.carry[0] += 2 * 400 * q * q * level * dt;
      for (; pool.carry[0] >= 1; pool.carry[0]--) {
        const side = rnd() < 0.5 ? -1 : 1;
        const fw = rnd() * rnd() * 3.4, lx = WATERLINE_END - fw;
        const lz = side * (waterlineHalf(lx) + 0.2 + 0.22 * fw);
        const [px, py, pz] = at(lx, 0.06 + 0.16 * q * q, lz);
        // (thrown flat and wide: a planing hull peels its bow wave outward, and drops that climb would hang in front of the topsides)
        const out = (2.4 + 3.6 * rnd()) * (0.6 + 0.7 * q), up = (0.7 + 2.4 * rnd() * rnd()) * (0.5 + 0.6 * q);
        pool.spawn(cap, mcap, px, py, pz,
          vel[0] * 0.45 + Z[0] * side * out + (rnd() - 0.5), vel[1] * 0.4 + up, vel[2] * 0.45 + Z[2] * side * out + (rnd() - 0.5),
          0.4 + 0.5 * rnd(), sz(0.05, 0.22), 0, 0.22, floor0);
      }
    }
    // rooster tail: the props throw a plume up and aft
    const thr = clamp(pose.throttle, 0, 1);
    if (wet && spd > 10 && thr > 0.1) {
      const k = clamp((spd - 10) / 26, 0, 1.2) * (0.4 + 0.6 * thr);
      const props = A.props;
      pool.carry[1] += props.length * 320 * k * level * dt;
      for (; pool.carry[1] >= 1; pool.carry[1]--) {
        const pr = props[Math.floor(rnd() * props.length)];
        const [px, py, pz] = at(pr[0] - 0.3, 0.1, pr[2] + (rnd() - 0.5) * 0.3);
        const up = (4 + 4.5 * rnd()) * (0.55 + 0.5 * k);
        pool.spawn(cap, mcap, px, py, pz,
          vel[0] * 0.3 + (rnd() - 0.5) * 2.4, vel[1] * 0.3 + up, vel[2] * 0.3 + (rnd() - 0.5) * 2.4,
          0.7 + 0.7 * rnd(), sz(0.2, 1.0), 1, 0.6, floor0);
      }
    }
    // mist: the finest drops, hanging in the air behind the boat and drifting downwind. It is born
    // over the wash and along the bow wave and left where it is: the trail it makes is as long as it lives
    if (wet && spd > 8) {
      const k = clamp((spd - 8) / 28, 0, 1.2);
      pool.carry[2] += 150 * k * level * dt;
      for (; pool.carry[2] >= 1; pool.carry[2]--) {
        const lx = A.transom[0] - rnd() * 6, lz = (rnd() - 0.5) * 3.2;
        const [px, py, pz] = at(lx, 0.3 + 0.9 * rnd(), lz);
        pool.spawn(cap, mcap, px, py, pz,
          vel[0] * 0.12 + (rnd() - 0.5) * 1.2, 0.5 + rnd() * 0.8, vel[2] * 0.12 + (rnd() - 0.5) * 1.2,
          1.4 + 1.4 * rnd(), 1.0 + 1.4 * rnd(), 3, 0.5 * (0.5 + 0.5 * k), pose.pos[1] - 1.5);
      }
      pool.carry[3] += 60 * k * k * level * dt;
      for (; pool.carry[3] >= 1; pool.carry[3]--) {
        const side = rnd() < 0.5 ? -1 : 1, fw = rnd() * 4, lx = WATERLINE_END - fw;
        const [px, py, pz] = at(lx, 0.3 + 0.6 * rnd(), side * (waterlineHalf(lx) + 0.4 + 0.3 * fw));
        pool.spawn(cap, mcap, px, py, pz,
          vel[0] * 0.2 + Z[0] * side * 1.5, 0.6 + rnd(), vel[2] * 0.2 + Z[2] * side * 1.5,
          1.4 + 1.4 * rnd(), 1.0 + 1.4 * rnd(), 3, 0.4 * (0.4 + 0.6 * k), pose.pos[1] - 1.5);
      }
    }
    // landing: a ring of water thrown out from the hull
    if (pool.prevAir > 0.25 && pose.airTime === 0) {
      const nB = Math.floor(clamp(150 + 2000 * pose.slam + 220 * pose.lastAir, 120, 650) * level);
      const half = 0.5 * (A.bow[0] - A.transom[0]), mid = 0.5 * (A.bow[0] + A.transom[0]);
      for (let i = 0; i < nB; i++) {
        const a = rnd() * Math.PI * 2;
        const lx = mid + Math.cos(a) * half * 0.9, lz = Math.sin(a) * A.halfBeam * 0.95;
        const [px, py, pz] = at(lx, 0.0, lz);
        const out = 2 + 6 * rnd(), up = 3 + 6 * rnd();
        const dx = X[0] * Math.cos(a) * 0.5 + Z[0] * Math.sin(a), dz = X[2] * Math.cos(a) * 0.5 + Z[2] * Math.sin(a);
        pool.spawn(cap, mcap, px, py, pz, vel[0] * 0.5 + dx * out, vel[1] * 0.2 + up, vel[2] * 0.5 + dz * out,
          0.6 + 0.7 * rnd(), sz(0.15, 1.0), 2, 0.6, floor0);
      }
    }
    pool.prevAir = pose.airTime;
  }

  // integrate and pack the live particles into the upload buffer
  step(pool, dt, n) {
    const d = this.data, drag = Math.exp(-0.7 * dt), mdrag = 1 - Math.exp(-1.1 * dt);
    const wx = this.wind[0], wz = this.wind[1];
    for (let i = 0; i < MAX; i++) {
      if (pool.age[i] >= pool.life[i]) continue;
      pool.age[i] += dt;
      const o = i * 3;
      if (pool.kind[i] > 2.5) {
        // mist is carried by the air: it relaxes to the wind and sinks only very slowly
        pool.v[o] += (wx - pool.v[o]) * mdrag; pool.v[o + 2] += (wz - pool.v[o + 2]) * mdrag;
        pool.v[o + 1] += (0.0 - pool.v[o + 1]) * mdrag - 0.05 * dt;
      } else {
        pool.v[o] *= drag; pool.v[o + 2] *= drag; pool.v[o + 1] = pool.v[o + 1] * drag - G * dt;
      }
      pool.p[o] += pool.v[o] * dt; pool.p[o + 1] += pool.v[o + 1] * dt; pool.p[o + 2] += pool.v[o + 2] * dt;
      if (pool.age[i] >= pool.life[i] || pool.p[o + 1] < pool.floor[i]) { pool.age[i] = 1e9; continue; }
      if (n >= MAX * WK.BOATS) break;
      const w = n * 12;
      d[w] = pool.p[o]; d[w + 1] = pool.p[o + 1]; d[w + 2] = pool.p[o + 2]; d[w + 3] = pool.size[i];
      d[w + 4] = pool.age[i] / pool.life[i]; d[w + 5] = pool.seed[i]; d[w + 6] = pool.kind[i]; d[w + 7] = pool.dens[i];
      d[w + 8] = pool.v[o]; d[w + 9] = pool.v[o + 1]; d[w + 10] = pool.v[o + 2]; d[w + 11] = pool.bright[i];
      n++;
    }
    return n;
  }

  drawTransparent(scene) {
    if (this.count <= 0) return;
    const gl = this.gl;
    if (!this.prog) this.init();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, this.count * 12);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    this.prog.use(scene);
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.count);
    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }
}
