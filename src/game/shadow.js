// The sun's shadow of the boats on themselves (and on each other): one depth map per frame, an
// orthographic view down the sun's rays fitted tightly around the boats near the camera. The mesh
// pass samples it with a soft filter (see mesh.js). The boat's shadow on the water is not here:
// the wake system computes that analytically.
import { Program } from '../gl.js';

const VS = `
layout(location = 0) in vec3 aPos;
uniform mat4 uModel;
uniform mat4 uLightVP;
void main() { gl_Position = uLightVP * (uModel * vec4(aPos, 1.0)); }`;
const FS = `
out vec4 oColor;
void main() { oColor = vec4(0.0); }`;

const SIZE = 1024;
const RADIUS = 6.2;        // a boat fits in this sphere about its origin (9 m hull, outboards, pitch and roll)
const NEAR = 90;           // boats further than this from the camera are too small to matter
const SPAN = 60;           // the map covers at most this much: beyond it, the nearest boats only

const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export class BoatShadow {
  constructor(game) {
    this.game = game;
    this.gl = game.app.gl;
    this.prog = null;
    this.tex = null;
    this.fbo = null;
    this.vp = new Float32Array(16);
    this.model = new Float32Array(16);
    this.info = [0, 1, 1 / SIZE, 8];
    this.depthScale = 0.1;
    this.size = SIZE;
  }

  alloc() {
    const gl = this.gl;
    this.prog = new Program(gl, VS, FS, { label: 'boat-shadow' });
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, SIZE, SIZE);
    // plain depth values, compared in the shader: the filter is done there
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.tex, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (st !== gl.FRAMEBUFFER_COMPLETE) { this.failed = true; console.warn('boat shadow map: framebuffer incomplete 0x' + st.toString(16)); }
  }

  prePass(light) {
    this.info[0] = 0;
    const app = this.game.app, gl = this.gl;
    const level = app.fx ? app.fx.shadows : 1;
    if (!(level > 0) || this.failed) return;           // at 0 nothing is allocated, drawn or sampled
    const sun = norm([light.sunDir[0], light.sunDir[1], light.sunDir[2]]);
    if (sun[1] < 0.03) return;                          // sun below the horizon: no direct light to shadow
    const cam = app.cam.pos;
    const boats = this.game.renderBoats().filter((b) => !b.ghost && Math.hypot(b.pose.pos[0] - cam[0], b.pose.pos[2] - cam[2]) < NEAR);
    if (!boats.length) return;
    if (!this.tex) this.alloc();
    if (this.failed) return;

    // light basis: u, v span the map, sun points toward the light
    const u = norm(cross([0, 1, 0], sun)), v = cross(sun, u);
    boats.sort((a, b) => Math.hypot(a.pose.pos[0] - cam[0], a.pose.pos[2] - cam[2]) - Math.hypot(b.pose.pos[0] - cam[0], b.pose.pos[2] - cam[2]));
    let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9, w0 = 1e9, w1 = -1e9, n = 0;
    for (const b of boats) {
      const p = b.pose.pos;
      const pu = dot(p, u), pv = dot(p, v), pw = dot(p, sun);
      const nu0 = Math.min(u0, pu - RADIUS), nu1 = Math.max(u1, pu + RADIUS), nv0 = Math.min(v0, pv - RADIUS), nv1 = Math.max(v1, pv + RADIUS);
      if (n > 0 && Math.max(nu1 - nu0, nv1 - nv0) > SPAN) break;
      u0 = nu0; u1 = nu1; v0 = nv0; v1 = nv1;
      w0 = Math.min(w0, pw - RADIUS); w1 = Math.max(w1, pw + RADIUS);
      n++;
    }
    // a square window, snapped to whole texels so the shadow does not shimmer as the boat moves
    const ext = Math.max(u1 - u0, v1 - v0);
    const half = ext / 2, texel = ext / SIZE;
    const cu = Math.round((u0 + u1) / 2 / texel) * texel, cv = Math.round((v0 + v1) / 2 / texel) * texel;
    const cw = (w0 + w1) / 2, hw = (w1 - w0) / 2 + 0.5;
    // world -> clip: x = u/half, y = v/half, z = -w/hw (smaller toward the sun)
    const m = this.vp;
    const row = (a, k, off) => [a[0] / k, a[1] / k, a[2] / k, -off / k];
    const r0 = row(u, half, cu), r1 = row(v, half, cv), r2 = row(sun, -hw, cw);
    for (let c = 0; c < 4; c++) { m[c * 4] = r0[c]; m[c * 4 + 1] = r1[c]; m[c * 4 + 2] = r2[c]; m[c * 4 + 3] = c === 3 ? 1 : 0; }

    // a lower level shrinks the used part of the map and the filter
    const size = level > 0.5 ? SIZE : SIZE / 2;
    this.info[1] = size / SIZE; this.info[2] = 1 / size; this.info[3] = level > 0.5 ? 8 : 4;
    this.depthScale = 0.5 / hw;

    const prevFbo = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    const vp = gl.getParameter(gl.VIEWPORT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, size, size);
    gl.depthMask(true);
    gl.colorMask(false, false, false, false);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS);
    gl.disable(gl.BLEND);
    gl.clearDepth(1);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    // a polygon offset keeps a lit surface from shadowing itself at grazing angles
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(2, 4);
    this.prog.use({ uLightVP: this.vp });
    gl.bindVertexArray(this.game.boatMesh.vao);
    for (let i = 0; i < n; i++) {
      this.prog.set('uModel', boats[i].pose.matrix(this.model));
      gl.drawArrays(gl.TRIANGLES, 0, this.game.boatMesh.count);
    }
    gl.bindVertexArray(null);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.colorMask(true, true, true, true);
    gl.bindFramebuffer(gl.FRAMEBUFFER, prevFbo);
    gl.viewport(vp[0], vp[1], vp[2], vp[3]);
    this.info[0] = 1;
  }

  // sampled by the mesh pass through the shared scene uniforms
  waterUniforms() {
    return {
      uBoatShadow: this.tex || undefined, uBoatShadowVP: this.vp, uBoatShadowInfo: this.info,
      uBoatShadowDepth: this.depthScale,
    };
  }
}
