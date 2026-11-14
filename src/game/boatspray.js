// Spray thrown by the boats: sheets off the bow, a rooster tail behind the props, a burst when a
// boat lands. Particles are simulated on the CPU (a few thousand per boat, ballistic with a little
// drag), uploaded each frame and drawn as one instanced batch of soft billboards, lit by the sun and
// sky like the foam and run through aerial perspective and fog like everything else in the pass.
import { Program } from '../gl.js';
import { SKY_LOOKUP_GLSL } from '../sky/atmosphere.js';
import { clamp } from '../math.js';
import { BOAT_ANCHORS } from './models/boat.js';
import { waterlineHalf, WK } from './wake.js';

const MAX = 3000;          // particles per boat at full level
const G = 9.81;

const VS = `
layout(location = 0) in vec4 aA;   // position, full size
layout(location = 1) in vec4 aB;   // age 0..1, seed, kind, density
uniform mat4 uViewProj;
uniform vec3 uCamPos;
centroid out vec2 vUv;
out float vAlpha;
out float vDist;
out float vSeed;
out vec3 vDir;
void main() {
  float age = aB.x;
  vec3 pos = aA.xyz;
  // droplets start small and dense, then billow out and thin
  float size = aA.w * (0.35 + 0.65 * sqrt(age));
  vec3 toCam = uCamPos - pos;
  float dist = length(toCam);
  vec3 vdir = toCam / max(dist, 1e-3);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), vdir));
  vec3 up = cross(vdir, right);
  vec2 c = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1)) - 0.5;
  float a = aB.y * 6.2831853;
  vec2 rc = vec2(c.x * cos(a) - c.y * sin(a), c.x * sin(a) + c.y * cos(a));
  vec3 P = pos + (right * rc.x + up * rc.y) * size;
  vUv = c + 0.5;
  vAlpha = aB.w * sin(3.14159 * min(age * 1.0, 1.0)) * (1.0 - 0.4 * age) * smoothstep(0.3, 1.2, dist);
  vDist = dist;
  vDir = -vdir;
  vSeed = aB.y;
  gl_Position = uViewProj * vec4(P, 1.0);
}`;

// Spray is lit from the sun and sky, and brighter against the sun (forward scattering).
const FS = SKY_LOOKUP_GLSL + `
centroid in vec2 vUv;
in float vAlpha;
in float vDist;
in float vSeed;
in vec3 vDir;
out vec4 oColor;
uniform vec3 uFlash;
float hsh(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hsh(i), hsh(i + vec2(1, 0)), f.x), mix(hsh(i + vec2(0, 1)), hsh(i + vec2(1, 1)), f.x), f.y); }
void main() {
  vec2 q = vUv * 2.0 - 1.0;
  float r2 = dot(q, q);
  // Spray is drops and torn sheets, not smoke: each billboard is broken into specks by thresholding
  // noise, with only a thin mist between them, so a mass of them reads as white water in the air.
  float n = vn(vUv * 7.0 + vSeed * 91.0) * 0.55 + vn(vUv * 17.0 + vSeed * 37.0) * 0.45;
  float a = smoothstep(1.0, 0.2, r2) * (0.12 + 1.5 * smoothstep(0.5, 0.72, n)) * vAlpha;
  if (a < 0.002) discard;
  a = min(a, 1.0);
  vec3 dir = normalize(vDir);
  // droplets scatter all wavelengths alike; against the sun they flare (forward scattering)
  float fw = pow(max(dot(dir, uSunDir), 0.0), 8.0);
  vec3 E = skyIrradiance() * 0.8 + sunIlluminance() * uHazeSun * max(uSunDir.y, 0.0) * (0.55 + 2.2 * fw) + uFlash * 0.3;
  vec3 Lc = vec3(dot(E, vec3(0.2126, 0.7152, 0.0722))) * (1.5 / 3.14159265);
  vec3 aL, aT;
  aerial(dir, vDist * 0.001, aL, aT);
  vec3 c = Lc * aT + aL;
  c = applyFog(c, dir, vDist);
  oColor = vec4(c * a, a);
}`;


// one boat's particles (struct of arrays; a ring buffer overwrites the oldest)
class Pool {
  constructor() {
    this.p = new Float32Array(MAX * 3); this.v = new Float32Array(MAX * 3);
    this.age = new Float32Array(MAX).fill(1e9); this.life = new Float32Array(MAX).fill(1);
    this.size = new Float32Array(MAX); this.seed = new Float32Array(MAX); this.kind = new Float32Array(MAX);
    this.dens = new Float32Array(MAX); this.floor = new Float32Array(MAX);
    this.head = 0;
    this.carry = [0, 0, 0];     // fractional emissions: bow, rooster
    this.prevAir = 0;
  }
  spawn(cap, x, y, z, vx, vy, vz, life, size, kind, dens, floor) {
    const i = this.head; this.head = (this.head + 1) % cap;
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
    this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
    this.age[i] = 0; this.life[i] = life; this.size[i] = size; this.seed[i] = Math.random(); this.kind[i] = kind;
    this.dens[i] = dens; this.floor[i] = floor;
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
    this.data = new Float32Array(MAX * 4 * 8);
    this.count = 0;
  }

  init() {
    const gl = this.gl;
    this.prog = new Program(gl, VS, FS, { label: 'boatspray' });
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    for (let k = 0; k < 2; k++) {
      gl.enableVertexAttribArray(k);
      gl.vertexAttribPointer(k, 4, gl.FLOAT, false, 32, k * 16);
      gl.vertexAttribDivisor(k, 1);
    }
    gl.bindVertexArray(null);
  }

  update(dt) {
    const level = clamp(this.game.app.fx?.spray ?? 1, 0, 1);
    this.count = 0;
    if (level <= 0 || dt <= 0) { this.pools.clear(); return; }
    const cap = Math.max(Math.floor(MAX * level), 8);
    const A = BOAT_ANCHORS;
    const seen = new Set();
    let n = 0;
    for (const b of this.game.renderBoats()) {
      if (b.ghost) continue;
      const pose = b.pose;
      const pool = this.pools.get(pose) || new Pool();
      this.pools.set(pose, pool);
      seen.add(pose);
      this.emit(pool, pose, dt, level, cap, A);
      n = this.step(pool, dt, n);
    }
    for (const k of this.pools.keys()) if (!seen.has(k)) this.pools.delete(k);
    this.count = n;
  }

  emit(pool, pose, dt, level, cap, A) {
    const { X, Y, Z } = pose.axes();
    const spd = pose.speed, q = clamp((spd - 6) / 30, 0, 1.2);
    const wet = pose.wet > 0.2;
    const at = (lx, ly, lz) => [pose.pos[0] + X[0] * lx + Y[0] * ly + Z[0] * lz, pose.pos[1] + X[1] * lx + Y[1] * ly + Z[1] * lz, pose.pos[2] + X[2] * lx + Y[2] * ly + Z[2] * lz];
    const vel = pose.vel, floor0 = pose.pos[1] - 0.45;
    const rnd = Math.random;
    // bow sheets: water thrown outward and up from both sides of the stem, left behind by the boat
    if (wet && q > 0) {
      pool.carry[0] += 2 * 380 * q * q * level * dt;
      for (; pool.carry[0] >= 1; pool.carry[0]--) {
        const side = rnd() < 0.5 ? -1 : 1;
        // (where the stem cuts the water: the forward part of the waterline, not the overhanging bow)
        const lx = A.bow[0] - 1.2 - rnd() * 2.6, lz = side * waterlineHalf(lx);
        const [px, py, pz] = at(lx, 0.1, lz);
        const out = (1.2 + 2.6 * rnd()) * (0.6 + 0.7 * q), up = (1.8 + 3.6 * rnd()) * (0.5 + 0.6 * q);
        pool.spawn(cap, px, py, pz,
          vel[0] * 0.4 + Z[0] * side * out + (rnd() - 0.5), vel[1] * 0.4 + up, vel[2] * 0.4 + Z[2] * side * out + (rnd() - 0.5),
          0.5 + 0.45 * rnd(), 0.45 + 0.45 * rnd(), 0, 0.55, floor0);
      }
    }
    // rooster tail: the props throw a plume up and aft
    const thr = clamp(pose.throttle, 0, 1);
    if (wet && spd > 10 && thr > 0.1) {
      const k = clamp((spd - 10) / 26, 0, 1.2) * (0.4 + 0.6 * thr);
      const props = A.props;
      pool.carry[1] += props.length * 330 * k * level * dt;
      for (; pool.carry[1] >= 1; pool.carry[1]--) {
        const pr = props[Math.floor(rnd() * props.length)];
        const [px, py, pz] = at(pr[0] - 0.3, 0.1, pr[2] + (rnd() - 0.5) * 0.3);
        const up = (4 + 4.5 * rnd()) * (0.55 + 0.5 * k);
        pool.spawn(cap, px, py, pz,
          vel[0] * 0.3 + (rnd() - 0.5) * 2.2, vel[1] * 0.3 + up, vel[2] * 0.3 + (rnd() - 0.5) * 2.2,
          0.8 + 0.6 * rnd(), 0.5 + 0.5 * rnd(), 1, 0.6, floor0);
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
        pool.spawn(cap, px, py, pz, vel[0] * 0.5 + dx * out, vel[1] * 0.2 + up, vel[2] * 0.5 + dz * out,
          0.7 + 0.6 * rnd(), 0.5 + 0.6 * rnd(), 2, 0.6, floor0);
      }
    }
    pool.prevAir = pose.airTime;
  }

  // integrate and pack the live particles into the upload buffer
  step(pool, dt, n) {
    const d = this.data, drag = Math.exp(-0.7 * dt);
    for (let i = 0; i < MAX; i++) {
      if (pool.age[i] >= pool.life[i]) continue;
      pool.age[i] += dt;
      const o = i * 3;
      pool.v[o] *= drag; pool.v[o + 2] *= drag; pool.v[o + 1] = pool.v[o + 1] * drag - G * dt;
      pool.p[o] += pool.v[o] * dt; pool.p[o + 1] += pool.v[o + 1] * dt; pool.p[o + 2] += pool.v[o + 2] * dt;
      if (pool.age[i] >= pool.life[i] || pool.p[o + 1] < pool.floor[i]) { pool.age[i] = 1e9; continue; }
      if (n >= MAX * WK.BOATS) break;
      const w = n * 8;
      d[w] = pool.p[o]; d[w + 1] = pool.p[o + 1]; d[w + 2] = pool.p[o + 2]; d[w + 3] = pool.size[i];
      d[w + 4] = pool.age[i] / pool.life[i]; d[w + 5] = pool.seed[i]; d[w + 6] = pool.kind[i]; d[w + 7] = pool.dens[i];
      n++;
    }
    return n;
  }

  drawTransparent(scene) {
    if (this.count <= 0) return;
    const gl = this.gl;
    if (!this.prog) this.init();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, this.count * 8);
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
