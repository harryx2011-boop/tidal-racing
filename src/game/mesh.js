// Procedural meshes (boat, buoys) and the lit mesh pass. Everything is generated in code and lit
// by the same sun, sky, haze and fog as the sea, so objects sit in the scene.
import { Program, makeMesh } from '../gl.js';
import { SKY_LOOKUP_GLSL } from '../sky/atmosphere.js';

// Triangle soup builder. Per vertex: position, normal, colour, material (gloss, tint weight, glow).
export class Geo {
  constructor() { this.p = []; this.n = []; this.c = []; this.m = []; }
  tri(a, b, c, na, nb, nc, col, mat) {
    this.p.push(...a, ...b, ...c);
    this.n.push(...na, ...nb, ...nc);
    for (let i = 0; i < 3; i++) { this.c.push(...col); this.m.push(...mat); }
  }
  quad(a, b, c, d, col, mat, n) {
    n = n || norm(cross(sub(b, a), sub(d, a)));
    this.tri(a, b, c, n, n, n, col, mat);
    this.tri(a, c, d, n, n, n, col, mat);
  }
  // rows x cols grid of points with smooth normals (pts[i][j]); out: a point the surface faces away from
  grid(pts, col, mat, out) {
    const R = pts.length, C = pts[0].length;
    const nrm = pts.map((row, i) => row.map((P, j) => {
      const du = sub(pts[Math.min(i + 1, R - 1)][j], pts[Math.max(i - 1, 0)][j]);
      const dv = sub(pts[i][Math.min(j + 1, C - 1)], pts[i][Math.max(j - 1, 0)]);
      let n = norm(cross(du, dv));
      if (out && dot(n, sub(P, out(P))) < 0) n = [-n[0], -n[1], -n[2]];
      return n;
    }));
    for (let i = 0; i < R - 1; i++)
      for (let j = 0; j < C - 1; j++) {
        this.tri(pts[i][j], pts[i + 1][j], pts[i + 1][j + 1], nrm[i][j], nrm[i + 1][j], nrm[i + 1][j + 1], col, mat);
        this.tri(pts[i][j], pts[i + 1][j + 1], pts[i][j + 1], nrm[i][j], nrm[i + 1][j + 1], nrm[i][j + 1], col, mat);
      }
  }
  // convex box from 4 bottom and 4 top corners (same winding order)
  hexa(b, t, col, mat) {
    const mid = b.concat(t).reduce((s, p) => add(s, p), [0, 0, 0]).map((x) => x / 8);
    const face = (a, c, d, e) => {
      let n = norm(cross(sub(c, a), sub(e, a)));
      if (dot(n, sub(a, mid)) < 0) n = [-n[0], -n[1], -n[2]];
      this.quad(a, c, d, e, col, mat, n);
    };
    face(b[0], b[1], b[2], b[3]); face(t[0], t[1], t[2], t[3]);
    for (let i = 0; i < 4; i++) face(b[i], b[(i + 1) % 4], t[(i + 1) % 4], t[i]);
  }
  box(x0, x1, y0, y1, z0, z1, col, mat) {
    this.hexa([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], col, mat);
  }
  // surface of revolution about the y axis through (cx, cz): profile [[r, y], ...]
  lathe(profile, col, mat, segs = 20, cx = 0, cz = 0) {
    const pts = profile.map(([r, y]) => Array.from({ length: segs + 1 }, (_, k) => {
      const a = (k / segs) * 2 * Math.PI;
      return [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r];
    }));
    this.grid(pts, col, mat, (P) => [cx, P[1], cz]);
  }
  build(gl) {
    const mesh = makeMesh(gl, [[new Float32Array(this.p), 3], [new Float32Array(this.n), 3], [new Float32Array(this.c), 3], [new Float32Array(this.m), 3]]);
    mesh.count = this.p.length / 3;
    return mesh;
  }
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// A 9 m planing powerboat. Local axes: x forward, y up, z starboard; y = 0 is the design waterline.
export function boatGeo() {
  const g = new Geo();
  const WHITE = [0.82, 0.83, 0.84], DECK = [0.62, 0.58, 0.5], GLASS = [0.02, 0.03, 0.04], BLACK = [0.03, 0.03, 0.035], TRIM = [0.75, 0.76, 0.78];
  const n = 32;
  const sec = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n, x = -4.2 + 9.0 * u;
    const tb = Math.max(0, (u - 0.42) / 0.58);
    const b = 1.3 * Math.pow(Math.max(1 - tb * tb, 0), 0.8) * (0.9 + 0.1 * Math.min(u / 0.25, 1));
    const sheer = 0.72 + 0.38 * u * u;
    const tk = Math.max(0, (u - 0.62) / 0.38);
    const keel = -0.42 + tk * tk * tk * (sheer + 0.4);
    const chine = keel + (sheer - keel) * 0.36;
    sec.push({ x, b, sheer, pts: [[-b, sheer], [-b * 0.88, chine], [0, keel], [b * 0.88, chine], [b, sheer]] });
  }
  const P = (i, j) => [sec[i].x, sec[i].pts[j][1], sec[i].pts[j][0]];
  const centre = (p) => [p[0], 0.25, 0];
  for (let j = 0; j < 4; j++) {
    const side = j === 0 || j === 3;
    // hard chines: each longitudinal strake is its own smooth strip
    g.grid(sec.map((_, i) => [P(i, j), P(i, j + 1)]), WHITE, side ? [0.75, 1, 0] : [0.5, 0, 0], centre);
  }
  // deck, slightly inset, and a rub rail
  g.grid(sec.map((s) => [[s.x, s.sheer, -s.b], [s.x, s.sheer + 0.02, 0], [s.x, s.sheer, s.b]]), DECK, [0.15, 0, 0], (p) => [p[0], -5, 0]);
  // transom
  const t = sec[0].pts.map(([z, y]) => [sec[0].x, y, z]);
  for (let j = 1; j < 4; j++) g.tri(t[0], t[j], t[j + 1], [-1, 0, 0], [-1, 0, 0], [-1, 0, 0], WHITE, [0.5, 1, 0]);
  // cabin: a raked wedge with dark glass
  const sh = (x) => 0.72 + 0.38 * Math.pow((x + 4.2) / 9, 2);
  g.hexa(
    [[-1.3, sh(-1.3), -0.95], [1.9, sh(1.9), -0.8], [1.9, sh(1.9), 0.8], [-1.3, sh(-1.3), 0.95]],
    [[-1.0, 1.72, -0.78], [0.7, 1.66, -0.66], [0.7, 1.66, 0.66], [-1.0, 1.72, 0.78]], GLASS, [1, 0, 0]);
  g.box(-1.15, 0.8, 1.7, 1.76, -0.84, 0.84, WHITE, [0.7, 1, 0]);
  // engine cowls and a low spoiler
  for (const z of [-0.5, 0.5]) {
    g.hexa([[-4.75, 0.05, z - 0.2], [-4.15, 0.05, z - 0.2], [-4.15, 0.05, z + 0.2], [-4.75, 0.05, z + 0.2]],
      [[-4.7, 1.12, z - 0.17], [-4.2, 1.2, z - 0.17], [-4.2, 1.2, z + 0.17], [-4.7, 1.12, z + 0.17]], BLACK, [0.8, 0, 0]);
    g.box(-4.6, -4.4, -0.75, 0.05, z - 0.05, z + 0.05, BLACK, [0.3, 0, 0]);
  }
  g.box(-3.7, -3.2, 1.25, 1.31, -1.05, 1.05, TRIM, [0.7, 1, 0]);
  for (const z of [-0.95, 0.95]) g.box(-3.55, -3.35, 0.75, 1.25, z - 0.04, z + 0.04, BLACK, [0.5, 0, 0]);
  return g;
}

// A race mark: floating drum, mast and a glowing top mark. Tinted per side (port red, starboard green).
export function buoyGeo() {
  const g = new Geo();
  g.lathe([[0.0, -0.9], [0.95, -0.7], [1.05, 0.0], [0.95, 0.55], [0.35, 0.8], [0.0, 0.8]], [1, 1, 1], [0.45, 1, 0], 18);
  g.lathe([[0.09, 0.7], [0.07, 7.0]], [0.7, 0.7, 0.7], [0.5, 0, 0], 8);
  const ball = [];
  for (let i = 0; i <= 8; i++) { const a = (i / 8) * Math.PI; ball.push([Math.sin(a) * 0.6, 7.3 - Math.cos(a) * 0.6]); }
  g.lathe(ball, [1, 1, 1], [0.3, 1, 1], 14);
  return g;
}

const VS = `
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aN;
layout(location = 2) in vec3 aCol;
layout(location = 3) in vec3 aMat;
uniform mat4 uModel;
uniform mat4 uViewProj;
uniform vec3 uCamPos;
uniform float uFloat;        // 1: ride the waves at the model origin (buoys); 0: the model matrix is the pose
uniform sampler2D uDisp[3];
uniform float uSize[4];
uniform float uTexel[4];
out vec3 vWorld;
out vec3 vN;
out vec3 vCol;
out vec3 vMat;
vec3 dispAt(vec2 xz) {
  // (waves shorter than ~2 m do not move a 2 m drum)
  vec3 D = textureLod(uDisp[0], xz / uSize[0], max(1.0 - log2(uTexel[0]), 0.0)).xyz;
  D += textureLod(uDisp[1], xz / uSize[1], max(1.0 - log2(uTexel[1]), 0.0)).xyz;
  D += textureLod(uDisp[2], xz / uSize[2], max(1.0 - log2(uTexel[2]), 0.0)).xyz;
  return D;
}
void main() {
  vec3 P = (uModel * vec4(aPos, 1.0)).xyz;
  vec3 N = mat3(uModel) * aN;
  if (uFloat > 0.5) {
    vec2 a = uModel[3].xz;
    vec3 D = dispAt(a);
    const float e = 1.5;
    float hx = dispAt(a + vec2(e, 0.0)).y - dispAt(a - vec2(e, 0.0)).y;
    float hz = dispAt(a + vec2(0.0, e)).y - dispAt(a - vec2(0.0, e)).y;
    vec3 up = normalize(vec3(-hx / (2.0 * e) * 0.6, 1.0, -hz / (2.0 * e) * 0.6));
    vec3 X = normalize(cross(up, vec3(0.0, 0.0, 1.0)));
    vec3 Z = cross(X, up);
    vec3 l = P - uModel[3].xyz;
    P = vec3(a.x, uModel[3].y, a.y) + D + l.x * X + l.y * up + l.z * Z;
    N = N.x * X + N.y * up + N.z * Z;
  }
  float dr = length(P.xz - uCamPos.xz);
  P.y -= dr * dr / (2.0 * 6360000.0);
  vWorld = P; vN = N; vCol = aCol; vMat = aMat;
  gl_Position = uViewProj * vec4(P, 1.0);
}`;

const FS = SKY_LOOKUP_GLSL + `
in vec3 vWorld;
in vec3 vN;
in vec3 vCol;
in vec3 vMat;
out vec4 oColor;
uniform vec3 uCamPos;
uniform sampler2D uEnv;
uniform vec3 uTint;
uniform float uGlow;
uniform float uAlpha;
uniform vec3 uFlash;
const float M_PI = 3.14159265359;
vec2 equirectUv(vec3 d) { return vec2(atan(d.z, d.x) / (2.0 * M_PI) + 0.5, acos(clamp(d.y, -1.0, 1.0)) / M_PI); }
void main() {
  vec3 toCam = uCamPos - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  vec3 N = normalize(vN);
  if (dot(N, V) < 0.0) N = -N;
  vec3 albedo = mix(vCol, vCol * uTint, vMat.y);
  float gloss = vMat.x;
  vec3 sunE = sunIlluminance(), skyE = skyIrradiance();
  vec2 suv = (vWorld.xz - uShaftRect.xy) * uShaftRect.zw;
  float sunVis = mix(uHazeSun, texture(uShaftShadow, suv).r, smoothstep(0.0, 0.04, min(min(suv.x, suv.y), min(1.0 - suv.x, 1.0 - suv.y))));
  vec3 L = uSunDir;
  // sky from above, the dark sea from below
  vec3 E = sunE * sunVis * max(dot(N, L), 0.0) + skyE * max(0.42 + 0.58 * N.y, 0.1) + uFlash * 0.3;
  float nv = clamp(dot(N, V), 0.0, 1.0);
  float F = (0.04 + 0.96 * pow(1.0 - nv, 5.0)) * gloss;
  vec3 R = reflect(-V, N);
  // a reflection that points down sees the sea: darker than the sky at the horizon
  float sea = smoothstep(0.0, -0.25, R.y);
  R.y = abs(R.y);
  vec3 env = textureLod(uEnv, equirectUv(normalize(R)), (1.0 - gloss) * 6.0 + 0.5).rgb * mix(1.0, 0.25, sea);
  vec3 H = normalize(L + V);
  float sp = 20.0 + 380.0 * gloss * gloss;
  vec3 spec = sunE * sunVis * pow(max(dot(N, H), 0.0), sp) * (sp + 8.0) / (8.0 * M_PI) * F * max(dot(N, L), 0.0);
  vec3 col = albedo * E / M_PI * (1.0 - F) + env * F + spec;
  // marks glow a few times brighter than a white card in the same light, so they read through haze
  float amb = dot(skyE + sunE * max(L.y, 0.0), vec3(0.3333)) / M_PI;
  col += albedo * vMat.z * uGlow * (amb * 3.0 + 2e-4);
  vec3 aL, aT;
  aerial(-V, dist * 0.001, aL, aT);
  col = col * aT + aL;
  col = applyFog(col, -V, dist);
  oColor = vec4(col, uAlpha);
}`;

export class MeshPass {
  constructor(gl) {
    this.gl = gl;
    this.prog = new Program(gl, VS, FS, { label: 'mesh' });
  }
  // scene: the frame's shared lighting uniforms (the water pass's uniform set)
  begin(scene) {
    this.prog.use(scene);
  }
  draw(mesh, model, { tint = [1, 1, 1], glow = 0, alpha = 1, float = 0 } = {}) {
    const gl = this.gl;
    const p = this.prog;
    p.set('uModel', model); p.set('uTint', tint); p.set('uGlow', glow); p.set('uAlpha', alpha); p.set('uFloat', float);
    if (alpha < 1) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); }
    gl.bindVertexArray(mesh.vao);
    gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    gl.bindVertexArray(null);
    if (alpha < 1) gl.disable(gl.BLEND);
  }
}
