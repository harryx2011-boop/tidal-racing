// Reads the sea surface under several points at once (height and slope), without stalling the
// GPU (PBO + fence). Results arrive one to three frames late and carry the positions they were
// sampled at, so callers can extrapolate along the slope to where the point is now.
import { Program, Texture, Target, fullscreen, FULLSCREEN_VS } from '../gl.js';

export const MAX_POINTS = 8;

const FS = `
uniform sampler2D uDisp[3];
uniform sampler2D uSlope[3];
uniform float uSize[4];
uniform float uTexel[4];
uniform vec2 uPts[${MAX_POINTS}];
uniform float uFootprint;   // metres: waves shorter than this barely move a hull
out vec4 o;
vec3 disp(vec2 xz) {
  float l = log2(uFootprint);
  vec3 D = textureLod(uDisp[0], xz / uSize[0], max(l - log2(uTexel[0]), 0.0)).xyz;
  D += textureLod(uDisp[1], xz / uSize[1], max(l - log2(uTexel[1]), 0.0)).xyz;
  D += textureLod(uDisp[2], xz / uSize[2], max(l - log2(uTexel[2]), 0.0)).xyz;
  return D;
}
void main() {
  int i = int(gl_FragCoord.x);
  vec2 p = uPts[i];
  // invert the horizontal (choppy) displacement: find x0 with x0 + D(x0) = p
  vec2 x0 = p;
  for (int k = 0; k < 4; k++) x0 = p - disp(x0).xz;
  float h = disp(x0).y;
  float l = log2(uFootprint * 1.5);
  vec2 s = textureLod(uSlope[0], x0 / uSize[0], max(l - log2(uTexel[0]), 0.0)).xy;
  s += textureLod(uSlope[1], x0 / uSize[1], max(l - log2(uTexel[1]), 0.0)).xy;
  s += textureLod(uSlope[2], x0 / uSize[2], max(l - log2(uTexel[2]), 0.0)).xy;
  o = vec4(h, s, 1.0);
}`;

export class MultiProbe {
  constructor(gl) {
    this.gl = gl;
    this.prog = new Program(gl, FULLSCREEN_VS, FS, { label: 'multiprobe' });
    this.tex = new Texture(gl, { w: MAX_POINTS, h: 1, format: 'rgba32f', filter: 'nearest' });
    this.target = new Target(gl, [this.tex]);
    this.pbo = gl.createBuffer();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
    // STREAM_COPY, not STREAM_READ: Chrome treats a READ-usage buffer that the GPU writes and the page then fences as
    // one to keep a shadow copy of, and logs a performance warning ("READ-usage buffer was written, then fenced, but
    // written again before being read back") on every readback. The readback itself is the same (measured in
    // Chromium: same latency, same data, no warning).
    gl.bufferData(gl.PIXEL_PACK_BUFFER, MAX_POINTS * 16, gl.STREAM_COPY);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    this.data = new Float32Array(MAX_POINTS * 4);
    this.pending = null;
    this.fence = null;
    // per point: sample position, height, slope
    this.result = Array.from({ length: MAX_POINTS }, () => ({ x: 0, z: 0, h: 0, sx: 0, sz: 0 }));
    this.fresh = false;
  }

  // pts: flat [x0, z0, x1, z1, ...]. sync: blocking readback (tests, first frame).
  run(ot, pts, footprint = 2.5, sync = false) {
    const gl = this.gl;
    if (this.fence) {
      const st = gl.clientWaitSync(this.fence, 0, 0);
      if (st === gl.TIMEOUT_EXPIRED && !sync) return this.result;
      gl.deleteSync(this.fence);
      this.fence = null;
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this.data);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      this.decode(this.pending);
    }
    const flat = new Float32Array(MAX_POINTS * 2);
    flat.set(pts.slice(0, MAX_POINTS * 2));
    fullscreen(gl, this.prog, {
      uDisp: ot.disp.slice(0, 3), uSlope: ot.slope.slice(0, 3), uSize: ot.sizes, uTexel: ot.texels, uFootprint: footprint, uPts: flat,
    }, this.target);
    if (sync) {
      gl.readPixels(0, 0, MAX_POINTS, 1, gl.RGBA, gl.FLOAT, this.data);
      this.decode(flat);
      return this.result;
    }
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
    gl.readPixels(0, 0, MAX_POINTS, 1, gl.RGBA, gl.FLOAT, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    this.pending = flat;
    this.fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    return this.result;
  }

  decode(pts) {
    const d = this.data;
    for (let i = 0; i < MAX_POINTS; i++) {
      const r = this.result[i];
      r.x = pts[i * 2]; r.z = pts[i * 2 + 1];
      r.h = d[i * 4]; r.sx = d[i * 4 + 1]; r.sz = d[i * 4 + 2];
    }
    this.fresh = true;
  }

  // sea height at (x, z), extrapolated from sample i along its slope
  heightAt(i, x, z) {
    const r = this.result[i];
    const dx = Math.max(-4, Math.min(4, x - r.x)), dz = Math.max(-4, Math.min(4, z - r.z));
    return r.h + r.sx * dx + r.sz * dz;
  }
}
