// The lit mesh pass. Objects are lit by the same sun, sky, haze and fog as the sea, so they sit
// in the scene. Vertex format and material ids: see geo.js.
import { Program } from '../gl.js';
import { SKY_LOOKUP_GLSL } from '../sky/atmosphere.js';

const VS = `
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aN;
layout(location = 2) in vec3 aCol;
layout(location = 3) in vec3 aMat;
layout(location = 4) in vec2 aUV;
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
out vec3 vObj;   // model-space position
out vec3 vObjN;  // model-space normal
out vec2 vUV;
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
  vWorld = P; vN = N; vCol = aCol; vMat = aMat; vObj = aPos; vObjN = aN; vUV = aUV;
  gl_Position = uViewProj * vec4(P, 1.0);
}`;

const FS = SKY_LOOKUP_GLSL + `
in vec3 vWorld;
in vec3 vN;
in vec3 vCol;
in vec3 vMat;
in vec3 vObj;
in vec3 vObjN;
in vec2 vUV;
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
  // placeholder look per material id: one gloss value each (gelcoat, paint, teak, upholstery,
  // glass, metal, non-skid, rubber, light, textured)
  const float GLOSS[10] = float[10](0.6, 0.75, 0.2, 0.1, 1.0, 0.7, 0.15, 0.4, 0.3, 0.1);
  float gloss = GLOSS[clamp(int(vMat.x + 0.5), 0, 9)];
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
  // livery: { color, stripe, number } (boats); texture: base colour for MAT.TEXTURED surfaces
  draw(mesh, model, { tint = [1, 1, 1], glow = 0, alpha = 1, float = 0, livery = null, texture = null } = {}) {
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
