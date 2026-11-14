// Boat wakes and everything the sea shader needs to know about the boats.
//
// Each boat records its recent path (the stern, one sample every few metres, newest first). The
// wake is a pure function of that path and the age of its samples, so any client that has the
// boats' paths reproduces it exactly and no wake data needs to travel over a network:
//   S    arc length from the stern back along the path to the point nearest the sea point q
//   age  how long ago the boat was there
//   d    distance from q to the path
// A Kelvin-style V (arms at tan 19.5 degrees to the path, measured from the bow) lifts the water; a
// churned trail of foam spreads and fades behind the stern. The same formula is written twice, in
// GLSL (the sea vertex shader displaces with it and feeds the normals and foam) and in JS
// (`seaOffset`, so another boat crossing a wake is lifted by it). Keep the two in step.
//
// A boat does not feel its own wake: the wake starts at the stern and grows over the next 12 m
// (S < 0 behind the stern means "ahead of it": nothing there), while the hull points the physics
// samples are all ahead of the stern.
import { Texture } from '../gl.js';
import { clamp, smoothstep } from '../math.js';
import { BOAT_ANCHORS } from './models/boat.js';

export const WK = {
  N: 65,          // path samples per boat (64 segments)
  CH: 8,          // segments per culling chunk
  SPACING: 4,     // m between committed samples
  BOATS: 4,
  APEX: 4.5,      // bow ahead of the stern (m): the V starts there
  K: 0.36,        // tan of the half angle of the arms
  SMAX: 190,      // m of trail
  AGE: 12,        // s until the wake is gone
  REACH: 70,      // m from the path the arms are looked for
};

// The hull's half-width at the design waterline, resampled to 12 even stations from the transom to
// where the waterline ends forward (the model's own outline: the sea shader hides the sea inside it).
const WL = (() => {
  const o = BOAT_ANCHORS.outline.waterline, x0 = BOAT_ANCHORS.transom[0], end = o[o.length - 1][0];
  const at = (x) => {
    if (x <= o[0][0]) return o[0][1];
    for (let i = 1; i < o.length; i++) if (x <= o[i][0]) { const a = o[i - 1], b = o[i]; return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]); }
    return 0;
  };
  return { end, at, half: Array.from({ length: 12 }, (_, i) => at(x0 + (end - x0) * i / 11)) };
})();
export const waterlineHalf = (x) => (x > WL.end ? 0 : WL.at(x));

// Hull plan outline: half beam at x for a hull from the transom to the bow. Used by the sea shader
// (hiding the sea inside the hull, the foam line, the bow wash) and by the spray emitters.
export function hullHalfWidth(x, A = BOAT_ANCHORS) {
  const xt = A.transom[0], xb = A.bow[0];
  const u = (x - xt) / (xb - xt);
  if (u <= 0 || u >= 1) return 0;
  const tb = Math.max(0, (u - 0.42) / 0.58);
  return A.halfBeam * Math.pow(Math.max(1 - tb * tb, 0), 0.8) * (0.9 + 0.1 * Math.min(u / 0.25, 1));
}

// Radiance of the underwater lights in scene units: faint against a sunlit sea, plain at dusk.
// underwater lights against a white card in the same light: faint in sun, clear in the gloom
const GLOW_DAY = 0.25, GLOW_DARK = 2.0;

// ---- GLSL: the wake field (vertex shader). Declares its own uniforms. ----
export const WAKE_GLSL = `
uniform sampler2D uWake;          // rgba32f, N x 2 rows per boat: (x, z, S, age) and (wave, foam, width, 0)
uniform vec4 uWkHead[4];          // x: samples in the path
uniform vec4 uWkChunk[32];        // bounding circle (cx, cz, r) of each 8-segment chunk
uniform int uWkN;
const float WK_APEX = ${WK.APEX.toFixed(2)}, WK_K = ${WK.K.toFixed(3)}, WK_SMAX = ${WK.SMAX.toFixed(1)}, WK_AGE = ${WK.AGE.toFixed(1)}, WK_REACH = ${WK.REACH.toFixed(1)};
// hg = (height, d height / dx, d height / dz); fo = (fresh froth, residual foam, bubble plume)
void wakeField(vec2 q, float soft, out vec3 hg, out vec3 fo) {
  hg = vec3(0.0); fo = vec3(0.0);
  for (int b = 0; b < ${WK.BOATS}; b++) {
    if (b >= uWkN) break;
    int n = int(uWkHead[b].x);
    if (n < 2) continue;
    float bd2 = WK_REACH * WK_REACH;
    int bi = -1; float bt = 0.0;
    for (int c = 0; c < ${WK.N - 1} / ${WK.CH}; c++) {
      int i0 = c * ${WK.CH};
      if (i0 >= n - 1) break;
      vec4 ch = uWkChunk[b * 8 + c];
      float dc = max(length(q - ch.xy) - ch.z, 0.0);
      if (dc * dc >= bd2) continue;
      int i1 = min(i0 + ${WK.CH}, n - 1);
      vec2 p0 = texelFetch(uWake, ivec2(i0, b * 2), 0).xy;
      for (int i = i0; i < i1; i++) {
        vec2 p1 = texelFetch(uWake, ivec2(i + 1, b * 2), 0).xy;
        vec2 e = p1 - p0;
        float t = clamp(dot(q - p0, e) / max(dot(e, e), 1e-6), 0.0, 1.0);
        vec2 dv = q - p0 - e * t;
        float d2 = dot(dv, dv);
        if (d2 < bd2) { bd2 = d2; bi = i; bt = t; }
        p0 = p1;
      }
    }
    if (bi < 0) continue;
    vec4 a0 = texelFetch(uWake, ivec2(bi, b * 2), 0), a1 = texelFetch(uWake, ivec2(bi + 1, b * 2), 0);
    vec4 c0 = texelFetch(uWake, ivec2(bi, b * 2 + 1), 0), c1 = texelFetch(uWake, ivec2(bi + 1, b * 2 + 1), 0);
    float S = max(mix(a0.z, a1.z, bt), 0.0), age = mix(a0.w, a1.w, bt);
    if (S > WK_SMAX || age > WK_AGE) continue;
    vec2 e = a1.xy - a0.xy;
    float el = max(length(e), 1e-4);
    vec2 eb = e / el;
    vec2 dv = q - (a0.xy + e * bt);
    float dist = sqrt(bd2);
    vec2 nrm = dv / max(dist, 1e-3);
    float W = mix(c0.x, c1.x, bt), F = mix(c0.y, c1.y, bt), WS = mix(c0.z, c1.z, bt);
    // V arms: a crest with a trough on its inner side
    float wA = 1.0 + 0.07 * S + 0.3 * soft;
    float u = (dist - WK_K * (S + WK_APEX)) / wA;
    float E1 = exp(-u * u), E2 = exp(-(u + 1.4) * (u + 1.4));
    float amp = 0.8 * W * W * exp(-S / 110.0) * smoothstep(2.0, 12.0, S) * (1.0 - smoothstep(7.0, 12.0, age));
    float mf = 1.0 - smoothstep(0.35, 0.9, soft / wA);       // the mesh cannot carry arms narrower than its spacing
    amp *= mf;
    hg.x += amp * (E1 - 0.35 * E2);
    hg.yz += amp * (-2.0 * u * E1 + 0.7 * (u + 1.4) * E2) * (nrm - WK_K * eb) / wA;
    // churned trail: solid fresh froth and prop wash, then residual foam that thins and spreads
    float hw = (1.8 + 0.8 * sqrt(S)) * WS + 0.5 * soft;
    float lat = 1.0 - smoothstep(0.15 * hw, hw, dist);
    lat *= lat;
    float dens = F * lat * clamp(1.6 / hw, 0.35, 1.0) * smoothstep(0.0, 1.5, S);
    float fresh = exp(-age / 1.3);
    float old = exp(-age / 4.5) * (1.0 - smoothstep(7.0, 11.5, age));
    float near = 1.0 + 1.5 * exp(-S / 12.0);
    float arm = exp(-u * u * 0.8) * W * exp(-S / 45.0) * smoothstep(3.0, 10.0, S) * (1.0 - smoothstep(6.0, 11.0, age)) * mf;
    fo += vec3(dens * fresh * near * 3.0, dens * old * 4.0 + arm * 1.6, dens * exp(-age / 4.5) * 1.6 + arm * 0.5);
  }
}`;

// ---- the same formula in JS ----
class Trail {
  constructor() {
    const N = WK.N;
    this.n = 0;
    this.x = new Float32Array(N); this.z = new Float32Array(N); this.s = new Float32Array(N); this.age = new Float32Array(N);
    this.wv = new Float32Array(N); this.ft = new Float32Array(N); this.ws = new Float32Array(N);
    this.st = new Float64Array(N);                 // stamps (own clock, s)
    this.cx = 0; this.cz = 0; this.cr = 0;         // bounding circle of the whole trail
    this.chunks = new Float32Array(8 * 4);
  }
  shift() {
    const n = Math.min(this.n + 1, WK.N);
    for (const k of ['x', 'z', 's', 'age', 'wv', 'ft', 'ws', 'st']) this[k].copyWithin(1, 0, n - 1);
    this.n = n;
  }
  // sea point (x, z): add the wake's height and slope into out = { h, sx, sz }
  eval(x, z, out) {
    const n = this.n;
    if (n < 2) return;
    if (Math.hypot(x - this.cx, z - this.cz) > this.cr + WK.REACH) return;
    const X = this.x, Z = this.z;
    let bd2 = WK.REACH * WK.REACH, bi = -1, bt = 0;
    let px = X[0], pz = Z[0];
    for (let i = 0; i < n - 1; i++) {
      const qx = X[i + 1], qz = Z[i + 1];
      const ex = qx - px, ez = qz - pz;
      const t = clamp(((x - px) * ex + (z - pz) * ez) / Math.max(ex * ex + ez * ez, 1e-6), 0, 1);
      const dx = x - px - ex * t, dz = z - pz - ez * t, d2 = dx * dx + dz * dz;
      if (d2 < bd2) { bd2 = d2; bi = i; bt = t; }
      px = qx; pz = qz;
    }
    if (bi < 0) return;
    const j = bi + 1, mix = (a) => a[bi] + (a[j] - a[bi]) * bt;
    const S = Math.max(mix(this.s), 0), age = mix(this.age);
    if (S > WK.SMAX || age > WK.AGE) return;
    const ex = X[j] - X[bi], ez = Z[j] - Z[bi], el = Math.max(Math.hypot(ex, ez), 1e-4);
    const ebx = ex / el, ebz = ez / el;
    const dvx = x - (X[bi] + ex * bt), dvz = z - (Z[bi] + ez * bt);
    const dist = Math.sqrt(bd2), nx = dvx / Math.max(dist, 1e-3), nz = dvz / Math.max(dist, 1e-3);
    const W = mix(this.wv);
    const wA = 1 + 0.07 * S;
    const u = (dist - WK.K * (S + WK.APEX)) / wA;
    const E1 = Math.exp(-u * u), E2 = Math.exp(-(u + 1.4) * (u + 1.4));
    const amp = 0.8 * W * W * Math.exp(-S / 110) * smoothstep(2, 12, S) * (1 - smoothstep(7, 12, age));
    out.h += amp * (E1 - 0.35 * E2);
    const dg = amp * (-2 * u * E1 + 0.7 * (u + 1.4) * E2) / wA;
    out.sx += dg * (nx - WK.K * ebx);
    out.sz += dg * (nz - WK.K * ebz);
  }
}

// ---- the system ----
export class Wake {
  constructor(game) {
    this.game = game;
    const gl = game.app.gl;
    this.gl = gl;
    this.trails = new Map();       // pose -> Trail
    this.list = [];                // [{ pose, livery, trail }] drawn this frame, ghosts excluded
    this.t = 0;
    this.tex = new Texture(gl, { w: WK.N, h: WK.BOATS * 2, format: 'rgba32f', filter: 'nearest' });
    this.texData = new Float32Array(WK.N * WK.BOATS * 2 * 4);
    this.head = new Float32Array(WK.BOATS * 4);
    this.chunk = new Float32Array(WK.BOATS * 8 * 4);
  }

  update(dt) {
    this.t += dt;
    const A = BOAT_ANCHORS;
    const seen = new Set();
    this.list.length = 0;
    for (const b of this.game.renderBoats()) {
      if (b.ghost) continue;
      const tr = this.trails.get(b.pose) || new Trail();
      this.trails.set(b.pose, tr);
      seen.add(b.pose);
      this.record(tr, b.pose, A);
      this.list.push({ pose: b.pose, livery: b.livery, trail: tr });
      if (this.list.length >= WK.BOATS) break;
    }
    for (const k of this.trails.keys()) if (!seen.has(k)) this.trails.delete(k);
  }

  record(tr, pose, A) {
    const fwdx = Math.cos(pose.yaw), fwdz = Math.sin(pose.yaw);
    const sx = pose.pos[0] + fwdx * A.transom[0], sz = pose.pos[2] + fwdz * A.transom[0];
    // a teleport (respawn, restart) starts a new trail
    if (tr.n && Math.hypot(sx - tr.x[0], sz - tr.z[0]) > 40) tr.n = 0;
    const gate = smoothstep(0.05, 0.5, pose.wet), spd = pose.speed;
    const W = clamp(spd / 36, 0, 1.3) * gate;
    const thr = clamp(pose.throttle, 0, 1);
    const set = (i) => {
      tr.x[i] = sx; tr.z[i] = sz; tr.st[i] = this.t;
      tr.wv[i] = W;
      tr.ft[i] = gate * smoothstep(1, 9, spd) * (0.35 + 0.65 * thr) * (1 + (pose.boosting ? 0.3 : 0));
      tr.ws[i] = 0.6 + 0.6 * Math.min(W, 1);
    };
    if (tr.n === 0) { tr.n = 2; set(0); set(1); }
    set(0);
    if (Math.hypot(tr.x[0] - tr.x[1], tr.z[0] - tr.z[1]) >= WK.SPACING) { tr.shift(); set(0); }
    while (tr.n > 2 && this.t - tr.st[tr.n - 1] > WK.AGE + 1) tr.n--;
    // arc length, age and bounds
    tr.s[0] = 0; tr.age[0] = this.t - tr.st[0];
    let x0 = 1e30, x1 = -1e30, z0 = 1e30, z1 = -1e30;
    for (let i = 0; i < tr.n; i++) {
      if (i) tr.s[i] = tr.s[i - 1] + Math.hypot(tr.x[i] - tr.x[i - 1], tr.z[i] - tr.z[i - 1]);
      tr.age[i] = this.t - tr.st[i];
      x0 = Math.min(x0, tr.x[i]); x1 = Math.max(x1, tr.x[i]); z0 = Math.min(z0, tr.z[i]); z1 = Math.max(z1, tr.z[i]);
    }
    tr.cx = (x0 + x1) / 2; tr.cz = (z0 + z1) / 2; tr.cr = Math.hypot(x1 - x0, z1 - z0) / 2;
    for (let c = 0; c < 8; c++) {
      const i0 = c * WK.CH, o = c * 4;
      if (i0 >= tr.n - 1) { tr.chunks[o] = tr.chunks[o + 1] = 0; tr.chunks[o + 2] = -1e5; continue; }
      const i1 = Math.min(i0 + WK.CH, tr.n - 1);
      let a0 = 1e30, a1 = -1e30, b0 = 1e30, b1 = -1e30;
      for (let i = i0; i <= i1; i++) { a0 = Math.min(a0, tr.x[i]); a1 = Math.max(a1, tr.x[i]); b0 = Math.min(b0, tr.z[i]); b1 = Math.max(b1, tr.z[i]); }
      tr.chunks[o] = (a0 + a1) / 2; tr.chunks[o + 1] = (b0 + b1) / 2; tr.chunks[o + 2] = Math.hypot(a1 - a0, b1 - b0) / 2 + 0.01;
    }
  }

  // the physics: another boat's wake lifts (and tilts) the sea under this one
  seaOffset(x, z, s) {
    const o = this._o || (this._o = { h: 0, sx: 0, sz: 0 });
    o.h = o.sx = o.sz = 0;
    for (const tr of this.trails.values()) tr.eval(x, z, o);
    s.h += o.h; s.sx += o.sx; s.sz += o.sz;
  }

  // per-boat data for the sea shader: the wake texture, hull pose, accent colour
  waterUniforms() {
    const fx = this.game.app.fx || { waterShadow: 1 };
    const A = BOAT_ANCHORS;
    const n = this.list.length;
    const d = this.texData, N = WK.N;
    d.fill(0);
    const pos = new Float32Array(16), X = new Float32Array(16), Y = new Float32Array(16), Z = new Float32Array(16), col = new Float32Array(16), bfx = new Float32Array(16);
    this.list.forEach(({ pose, livery, trail: tr }, b) => {
      const rowA = b * 2 * N * 4, rowB = (b * 2 + 1) * N * 4;
      for (let i = 0; i < N; i++) {
        const j = Math.min(i, tr.n - 1);
        d.set([tr.x[j], tr.z[j], tr.s[j], tr.age[j]], rowA + i * 4);
        d.set([tr.wv[j], tr.ft[j], tr.ws[j], 0], rowB + i * 4);
      }
      this.head[b * 4] = tr.n;
      this.chunk.set(tr.chunks, b * 32);
      const ax = pose.axes();
      pos.set([pose.pos[0], pose.pos[1], pose.pos[2], 0], b * 4);
      X.set([...ax.X, 0], b * 4); Y.set([...ax.Y, 0], b * 4); Z.set([...ax.Z, 0], b * 4);
      col.set([...livery.color, clamp(pose.speed / 36, 0, 1.3)], b * 4);
      bfx.set([smoothstep(0.05, 0.5, pose.wet), clamp(pose.throttle, 0, 1), pose.boosting ? 1 : 0, 0], b * 4);
    });
    this.head.fill(0, n * 4);
    this.tex.upload(d);
    const pr = A.props.slice(0, 3);
    while (pr.length < 3) pr.push(pr[pr.length - 1]);
    return {
      uWake: this.tex, uWkHead: this.head, uWkChunk: this.chunk, uWkN: n,
      uBoatN: n, uBoatPos: pos, uBoatX: X, uBoatY: Y, uBoatZ: Z, uBoatCol: col, uBoatFx: bfx,
      uHull: [A.transom[0], A.bow[0], A.halfBeam, 1.0],
      uWl: WL.half, uWlEnd: WL.end,
      uProps: pr.flat(),
      uWaterShadow: clamp(fx.waterShadow ?? 1, 0, 1),
      uGlow: GLOW_DAY + (GLOW_DARK - GLOW_DAY) * Math.min(Math.max(((this.game.meshes.lamp ?? 0.1) - 0.1) / 0.9, 0), 1),
    };
  }
}
