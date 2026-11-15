// Course marks: lateral buoys on the gates (red can to port, green cone to starboard), turn
// pylons on the inside of sharp corners, and the start/finish gantry at gate 0 (a tower on a
// pontoon at each end, a truss with a banner between them on a narrow gate, a catenary line of flags
// on a wide one). Every float rides the sea at its own spot (float modes of mesh.js), so each mark
// heaves and leans with the waves under it; a span follows both of its ends.
//
// Lights: each lantern shows its side's colour. By day they burn steadily and dim; in low light and
// storms (the darkness level lights.js puts in meshes.lamp) they flash slowly, port and starboard
// out of step. The next gate to pass never flashes: its lanterns and top marks burn bright and
// steady under a large halo, so it reads against the rest at any speed and in any weather.
//
// Cost: a buoy is 8.3k triangles near, 1.2k beyond 260 m; a pylon 11k; a tower 3.9k; truss 0.6k +
// banner 0.4k, or a flag line 1.5k. One draw per mark (two for a gantry span), marks behind the
// camera or beyond 4 km are skipped, glows are one quad each. No per-frame allocation.
import { buoyGeo } from './models/buoy.js';
import { towerGeo, trussGeo, bannerGeo, flagLineGeo, pylonGeo, TOWER, PYLON, PORT, STBD, LENS_PORT, LENS_STBD } from './models/marks.js';
import { Texture, Target, Program, bindEmpty, fullscreen, FULLSCREEN_VS } from '../gl.js';
import { SKY_LOOKUP_GLSL } from '../sky/atmosphere.js';
import { smoothstep } from '../math.js';

const FAR = 4000;            // marks beyond this are not drawn
const NEAR_LOD = 260;        // buoys switch to the light model beyond this
const WIDE = 48;             // gates wider than this get a flag line, narrower ones a truss (metres)
const FLASH_PERIOD = 4, FLASH_ON = 0.8;
const ZERO = { dx: 0, dy: 0, dz: 0, sx: 0, sz: 0 };
const REL = 0.6;             // how far a float leans toward the slope of the sea (mesh.js)

// ---- textures ----
const FONT = 'bold 118px "Arial Black", "Helvetica Neue", Arial, "DejaVu Sans", sans-serif';
function canvasTexture(gl, w, h, paint, { mips = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  paint(x, w, h);
  const data = x.getImageData(0, 0, w, h).data;
  const t = new Texture(gl, { w, h, format: 'rgba8', filter: 'linear', mips, aniso: 4, data: new Uint8Array(data.buffer) });
  if (mips) t.genMips();
  return t;
}
const rgb = (c) => `rgb(${Math.round(Math.pow(c[0], 0.9) * 255)},${Math.round(Math.pow(c[1], 0.9) * 255)},${Math.round(Math.pow(c[2], 0.9) * 255)})`;
function rrectPath(x, X, Y, W, H, r) {
  x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + W, Y, X + W, Y + H, r); x.arcTo(X + W, Y + H, X, Y + H, r); x.arcTo(X, Y + H, X, Y, r); x.arcTo(X, Y, X + W, Y, r); x.closePath();
}
// a white plate with a bold number and a border in the mark's colour
function plateTexture(gl, label, col, w = 256, h = 164) {
  return canvasTexture(gl, w, h, (x) => {
    x.fillStyle = '#1a1c1e'; x.fillRect(0, 0, w, h);
    rrectPath(x, 7, 7, w - 14, h - 14, 14); x.fillStyle = rgb([0.86, 0.86, 0.83]); x.fill();
    x.lineWidth = 11; x.strokeStyle = rgb(col); rrectPath(x, 16, 16, w - 32, h - 32, 8); x.stroke();
    x.fillStyle = '#101214'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = label.length > 2 ? FONT.replace('118', '80') : FONT;
    x.fillText(label, w / 2, h / 2 + 6);
  });
}
function bannerTexture(gl) {
  const w = 2048, h = 128;
  return canvasTexture(gl, w, h, (x) => {
    x.fillStyle = '#e8e8e4'; x.fillRect(0, 0, w, h);
    // chequered ends, text between
    const s = h / 4;
    const chk = (x0, x1) => { for (let i = 0; x0 + i * s < x1; i++) for (let j = 0; j < 4; j++) { x.fillStyle = (i + j) % 2 ? '#101214' : '#ecece8'; x.fillRect(x0 + i * s, j * s, s, s); } };
    chk(0, 6 * s); chk(w - 6 * s, w);
    x.fillStyle = '#101214'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = 'bold 92px "Arial Black", Arial, "DejaVu Sans", sans-serif';
    x.fillText('START  •  FINISH', w / 2, h / 2 + 4);
  });
}

// ---- glow sprite ----
const GVS = `
uniform vec3 uPos;
uniform vec2 uHalf;     // half size on screen in NDC
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
uniform float uGain;      // brightness relative to the light everything else gets
void main() {
  float r2 = dot(vQ, vQ);
  if (r2 >= 1.0) discard;
  // a hot core in a wide soft halo, with a faint ring
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

// ---- where the floats are ----
// Reads, for up to eight marks, exactly what the vertex shader's float mode computes for them:
// the sea's displacement at the mark (heave and drift) and the slope it leans with. The glows use
// it to sit on the lanterns. Results arrive one to three frames late (PBO and fence).
const PN = 8;
const PROBE_FS = `
uniform sampler2D uDisp[3];
uniform float uSize[4];
uniform float uTexel[4];
uniform vec2 uPts[${PN}];
out vec4 o;
vec3 dispAt(vec2 xz) {
  vec3 D = textureLod(uDisp[0], xz / uSize[0], max(1.0 - log2(uTexel[0]), 0.0)).xyz;
  D += textureLod(uDisp[1], xz / uSize[1], max(1.0 - log2(uTexel[1]), 0.0)).xyz;
  D += textureLod(uDisp[2], xz / uSize[2], max(1.0 - log2(uTexel[2]), 0.0)).xyz;
  return D;
}
void main() {
  int k = int(gl_FragCoord.x);
  vec2 a = uPts[k >> 1];
  if ((k & 1) == 0) { o = vec4(dispAt(a), 1.0); return; }
  const float e = 1.5;
  float hx = dispAt(a + vec2(e, 0.0)).y - dispAt(a - vec2(e, 0.0)).y;
  float hz = dispAt(a + vec2(0.0, e)).y - dispAt(a - vec2(0.0, e)).y;
  o = vec4(hx / (2.0 * e), hz / (2.0 * e), 0.0, 1.0);
}`;
class MarkProbe {
  constructor(gl) {
    this.gl = gl;
    this.prog = new Program(gl, FULLSCREEN_VS, PROBE_FS, { label: 'mark-probe' });
    this.tex = new Texture(gl, { w: PN * 2, h: 1, format: 'rgba32f', filter: 'nearest' });
    this.target = new Target(gl, [this.tex]);
    this.pbo = gl.createBuffer();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, PN * 32, gl.STREAM_READ);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    this.data = new Float32Array(PN * 8);
    this.flat = new Float32Array(PN * 2);
    this.keys = []; this.pending = [];
    this.fence = null;
    this.res = new Map();      // mark -> { dx, dy, dz, sx, sz }
  }
  // marks: up to PN items with x, z
  run(ot, marks) {
    const gl = this.gl;
    if (this.fence) {
      if (gl.clientWaitSync(this.fence, 0, 0) === gl.TIMEOUT_EXPIRED) return;
      gl.deleteSync(this.fence); this.fence = null;
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this.data);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      const d = this.data;
      this.pending.forEach((it, i) => {
        const r = this.res.get(it) || {};
        r.dx = d[i * 8]; r.dy = d[i * 8 + 1]; r.dz = d[i * 8 + 2]; r.sx = d[i * 8 + 4]; r.sz = d[i * 8 + 5];
        this.res.set(it, r);
      });
    }
    const n = Math.min(marks.length, PN);
    this.pending = marks.slice(0, n);
    for (let i = 0; i < n; i++) { this.flat[i * 2] = marks[i].x; this.flat[i * 2 + 1] = marks[i].z; }
    fullscreen(gl, this.prog, { uDisp: ot.disp.slice(0, 3), uSize: ot.sizes, uTexel: ot.texels, uPts: this.flat }, this.target);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
    gl.readPixels(0, 0, PN * 2, 1, gl.RGBA, gl.FLOAT, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    this.fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
  }
}

const rotY = (m, a, x, z) => {
  const c = Math.cos(a), s = Math.sin(a);
  m.set([c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, x, 0, z, 1]);
  return m;
};

export class Marks {
  constructor(game) {
    this.game = game;
    this.gl = game.app.gl;
    this.course = null;
    this.items = [];          // everything floating: { kind, side, x, z, yaw, ... }
    this.spans = [];          // gantry spans between two towers
    this.colliders = [];      // { x, z, r, kind, gate, side }: where the marks are, for collisions later
    this.meshes = null;       // built lazily: models keyed by kind
    this.tex = {};
    this.probe = new MarkProbe(this.gl);
    this.prog = null;
    this.mat = new Float32Array(16);
    this.lamps = [];          // lanterns this frame: { x, z, h, side, glow }
    this.lampN = 0;
    this.next = -1;
  }

  // ---- layout ----
  layout(course) {
    this.course = course;
    this.items = []; this.spans = []; this.colliders = [];
    const n = course.gates.length;
    course.gates.forEach((g, i) => {
      const yaw = Math.atan2(g.dir[1], g.dir[0]);
      for (const side of ['port', 'stbd']) {
        const p = side === 'port' ? g.port : g.stbd;
        let kind = 'buoy';
        if (i === 0) kind = 'tower';
        else if (g.pylon === (side === 'port' ? -1 : 1)) kind = 'pylon';
        const it = { kind, side, gate: i, x: p[0], z: p[1], yaw, number: i, variant: (i + (side === 'port' ? 0 : 1)) & 1, lamp: 0 };
        this.items.push(it);
        this.colliders.push({ x: p[0], z: p[1], r: kind === 'buoy' ? 1.5 : kind === 'pylon' ? PYLON.radius : TOWER.radius, kind, gate: i, side });
      }
      if (i === 0) {
        const width = 2 * g.hw;
        const nx = g.nrm[0], nz = g.nrm[1];
        this.spans.push({ gate: 0, A: g.port, L: width, kind: width > WIDE ? 'flags' : 'truss', nx, nz, mid: g.c });
      }
    });
    void n;
  }

  // models and textures are built outside the draw pass (making a texture rebinds units)
  ensure() {
    const gl = this.gl;
    const M = this.meshes || (this.meshes = { buoy: {}, tower: {}, pylon: {}, truss: {}, banner: {}, flags: {} });
    const buoy = (side, variant, lod) => {
      const k = side + variant + lod;
      if (!M.buoy[k]) { const g = buoyGeo(side, { seed: 1 + variant * 2.3 + (side === 'port' ? 0 : 5), lod }); M.buoy[k] = { mesh: g.build(gl), lamp: g.lamp, tris: g.p.length / 9 }; }
      return M.buoy[k];
    };
    for (const it of this.items) {
      if (it.kind === 'buoy') { it.lamp = buoy(it.side, it.variant, 0).lamp; }
      else if (it.kind === 'tower') {
        if (!M.tower[it.side]) { const g = towerGeo(it.side); M.tower[it.side] = { mesh: g.build(gl), lamp: g.lamp, tris: g.p.length / 9 }; }
        it.lamp = M.tower[it.side].lamp;
      } else if (it.kind === 'pylon') {
        if (!M.pylon[it.side]) { const g = pylonGeo(it.side); M.pylon[it.side] = { mesh: g.build(gl), lamp: g.lamp, tris: g.p.length / 9 }; }
        it.lamp = M.pylon[it.side].lamp;
      }
      const key = it.kind + (it.kind === 'tower' ? '' : it.number) + it.side;
      if (!this.tex[key]) {
        const col = it.side === 'port' ? PORT : STBD;
        this.tex[key] = it.kind === 'pylon' ? plateTexture(gl, String(it.number), col, 256, 208)
          : plateTexture(gl, it.kind === 'tower' ? 'S/F' : String(it.number), col);
      }
      it.tex = this.tex[key];
    }
    // lod 1 buoys
    for (const it of this.items) if (it.kind === 'buoy') it.near = buoy(it.side, it.variant, 0), it.far = buoy(it.side, it.variant, 1);
    for (const s of this.spans) {
      if (s.kind === 'truss') {
        const k = s.L.toFixed(1);
        if (!M.truss[k]) { M.truss[k] = { mesh: trussGeo(s.L).build(gl) }; M.banner[k] = { mesh: bannerGeo(s.L).build(gl) }; }
        s.mesh = M.truss[k].mesh; s.banner = M.banner[k].mesh;
        if (!this.tex.banner) this.tex.banner = bannerTexture(gl);
      } else {
        const k = s.L.toFixed(1);
        if (!M.flags[k]) M.flags[k] = { mesh: flagLineGeo(s.L).build(gl) };
        s.mesh = M.flags[k].mesh;
      }
    }
    this.ready = this.course;
  }

  // ---- per frame ----
  update(dt, ot) {
    const g = this.game;
    if (this.course !== g.course) { this.layout(g.course); this.ready = null; }
    if (this.ready !== this.course) this.ensure();
    this.next = g.progress.done ? -1 : g.progress.next % g.course.gates.length;
    if (!ot) return;
    // the sea under the lanterns nearest the camera, so the glows follow the heave and lean
    const cam = this.game.app.cam.pos;
    const near = this.items.filter((it) => Math.hypot(it.x - cam[0], it.z - cam[2]) < 700);
    near.sort((a, b) => Math.hypot(a.x - cam[0], a.z - cam[2]) - Math.hypot(b.x - cam[0], b.z - cam[2]));
    if (near.length) this.probe.run(ot, near.slice(0, PN));
  }

  // how the lantern of mark `it` is lit this frame: shader glow and halo gain
  lit(it, t, dark, out) {
    const next = it.gate === this.next;
    if (next) {
      const p = 0.5 + 0.5 * Math.sin(t * 5);
      out.glow = 1.6 + 0.5 * p; out.gain = 3.2 + 1.2 * p; out.size = 0.062;
      return out;
    }
    const ph = ((t + it.gate * 0.7 + (it.side === 'port' ? 0 : FLASH_PERIOD / 2)) % FLASH_PERIOD + FLASH_PERIOD) % FLASH_PERIOD;
    const on = smoothstep(0.0, 0.1, ph) * (1 - smoothstep(FLASH_ON, FLASH_ON + 0.2, ph));
    out.glow = 0.3 + dark * (on * 2.0 - 0.2);
    out.gain = 0.16 + dark * on * 7;
    out.size = 0.016 + 0.01 * dark * on;
    return out;
  }

  visible(x, y, z, r) {
    const app = this.game.app, c = app.cam;
    const dx = x - c.pos[0], dy = y - c.pos[1], dz = z - c.pos[2];
    const d = Math.hypot(dx, dy, dz);
    if (d > FAR) return false;
    if (d < r + 1) return true;
    const cp = Math.cos(c.pitch);
    const dot = (dx * Math.cos(c.yaw) * cp + dy * Math.sin(c.pitch) + dz * Math.sin(c.yaw) * cp) / d;
    const half = Math.atan(Math.tan(c.fov / 2) * Math.hypot(1, app.w / app.h)) + Math.asin(Math.min(r / d, 1));
    return dot > Math.cos(Math.min(half, 3.1));
  }

  draw(scene, m) {
    if (this.ready !== this.course) { this.ensure(); m.begin(scene); }
    const t = this.game.app.time, cam = this.game.app.cam.pos;
    const dark = smoothstep(0.35, 0.7, m.lamp);
    const lit = this._lit || (this._lit = { glow: 0, gain: 0, size: 0 });
    const mat = this.mat;
    this.lampN = 0;
    for (const it of this.items) {
      const M = this.meshes[it.kind];
      const r = it.kind === 'pylon' ? PYLON.height * 0.6 : 5;
      if (!this.visible(it.x, 3, it.z, 8)) continue;
      void r;
      this.lit(it, t, dark, lit);
      rotY(mat, it.yaw, it.x, it.z);
      const d = Math.hypot(it.x - cam[0], it.z - cam[2]);
      let mesh, tex = null;
      if (it.kind === 'buoy') { const lod = d < NEAR_LOD ? it.near : it.far; mesh = lod.mesh; if (lod === it.near) tex = it.tex; }
      else { mesh = M[it.side].mesh; tex = it.tex; }
      m.draw(mesh, mat, { glow: lit.glow, float: 1, texture: tex });
      const L = this.lamps[this.lampN] || (this.lamps[this.lampN] = { x: 0, z: 0, h: 0, side: 0, gain: 0, size: 0, sx: 0, sz: 0, it: null });
      L.it = it; L.gain = lit.gain; L.size = lit.size;
      this.lampN++;
    }
    for (const s of this.spans) {
      const nx = s.nx, nz = s.nz;
      // x along the gate (port to starboard), y up, z = x cross y
      mat.set([nx, 0, nz, 0, 0, 1, 0, 0, -nz, 0, nx, 0, s.A[0], 0, s.A[1], 1]);
      if (!this.visible(s.mid[0], 8, s.mid[1], s.L / 2 + 4)) continue;
      m.draw(s.mesh, mat, { float: 2, span: s.L, glow: 0.2 });
      if (s.banner) m.draw(s.banner, mat, { float: 2, span: s.L, texture: this.tex.banner });
    }
  }

  // glows round the lanterns, additive, after the particles
  drawTransparent(scene) {
    if (!this.lampN) return;
    const gl = this.gl, app = this.game.app;
    if (!this.prog) this.prog = new Program(gl, GVS, GFS, { label: 'mark-glow' });
    const cam = app.cam.pos;
    const tanHalf = Math.tan(app.cam.fov / 2), aspect = app.w / app.h;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.depthMask(false);
    this.prog.use(scene);
    bindEmpty(gl);
    const pos = this._pos || (this._pos = [0, 0, 0]), half = this._half || (this._half = [0, 0]);
    for (let i = 0; i < this.lampN; i++) {
      const L = this.lamps[i], it = L.it;
      if (L.gain < 0.01) continue;
      // where the lantern is now: it stands H above the sea on a stalk that leans with the surface
      const r = this.probe.res.get(it) || ZERO;
      const H = it.lamp;
      const ux = -r.sx * REL, uz = -r.sz * REL, ul = Math.hypot(ux, 1, uz);
      const wx = it.x + r.dx + (H * ux) / ul, wy = r.dy + H / ul, wz = it.z + r.dz + (H * uz) / ul;
      const dx = cam[0] - wx, dy = cam[1] - wy, dz = cam[2] - wz;
      const d = Math.hypot(dx, dy, dz);
      if (d > FAR || !this.visible(wx, wy, wz, 2)) continue;
      const k = 0.2 / d;
      pos[0] = wx + dx * k; pos[1] = wy + dy * k; pos[2] = wz + dz * k;
      const sy = Math.max(0.9 * (0.4 + L.size * 12) / (d * tanHalf), L.size);
      half[0] = sy / aspect; half[1] = sy;
      this.prog.set('uPos', pos);
      this.prog.set('uHalf', half);
      this.prog.set('uColor', it.side === 'port' ? LENS_PORT : LENS_STBD);
      this.prog.set('uGain', L.gain);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }
}
