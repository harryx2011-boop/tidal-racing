// Boat lights: red port, green starboard and white stern navigation lights, and an accent-coloured
// LED strip round the cockpit. The model carries the emissive lenses and strip (MAT.LIGHT, which the
// mesh pass brightens as it gets dark, see MeshPass.lamp); this adds the soft additive glow round
// them, drawn after the particles. They are all but invisible in full sun and take
// over when the light fails: low sun, night, a storm.
import { BOAT_ANCHORS } from './models/boat.js';
import { Program, bindEmpty } from '../gl.js';
import { SKY_LOOKUP_GLSL } from '../sky/atmosphere.js';
import { smoothstep } from '../math.js';

const RED = [1, 0.06, 0.04], GREEN = [0.05, 1, 0.2], WHITE = [1, 0.95, 0.85];

const VS = `
uniform vec3 uPos;
uniform vec2 uHalf;     // half size on screen in NDC
uniform mat4 uViewProj;
out vec2 vQ;
void main() {
  vec2 c = vec2(float((gl_VertexID << 1) & 2) - 1.0, float(gl_VertexID & 2) - 1.0);
  // two triangles from a strip of four corners
  int k = gl_VertexID % 6;
  vec2 q = k == 0 ? vec2(-1, -1) : k == 1 ? vec2(1, -1) : k == 2 ? vec2(1, 1) : k == 3 ? vec2(-1, -1) : k == 4 ? vec2(1, 1) : vec2(-1, 1);
  vQ = q;
  vec4 p = uViewProj * vec4(uPos, 1.0);
  p.xy += q * uHalf * p.w;
  gl_Position = p;
}`;

const FS = SKY_LOOKUP_GLSL + `
in vec2 vQ;
out vec4 oColor;
uniform vec3 uPos;
uniform vec3 uCamPos;
uniform vec3 uColor;
uniform float uLevel;     // 0: day .. 1: dark
void main() {
  float r2 = dot(vQ, vQ);
  if (r2 >= 1.0) discard;
  // a hot core in a wide, soft halo
  float g = exp(-r2 * 7.0) * 0.55 + exp(-r2 * 45.0) * 1.4;
  g *= 1.0 - r2 * r2;
  vec3 toCam = uCamPos - uPos;
  float dist = length(toCam);
  vec3 skyE = skyIrradiance(), sunE = sunIlluminance();
  float amb = dot(skyE + sunE * max(uSunDir.y, 0.0), vec3(0.3333)) / 3.14159265;
  // relative to the light everything else gets, with a floor so that moonless nights still show it
  vec3 col = uColor * g * (amb * (0.1 + 2.2 * uLevel * uLevel) + 3e-4 * uLevel * uLevel);
  vec3 aL, aT;
  aerial(-toCam / dist, dist * 0.001, aL, aT);
  vec3 fogged = applyFog(col * aT, -toCam / dist, dist);
  // additive: keep only what the haze does not add (the haze is already in the picture)
  oColor = vec4(fogged - applyFog(vec3(0.0), -toCam / dist, dist), 1.0);
}`;

export class Lights {
  constructor(game) {
    this.game = game;
    this.gl = game.app.gl;
    this.level = 0.1;
    this.prog = null;
    this.mat = new Float32Array(16);
    // glow points in boat space: [position, colour]; cockpit ones take the accent colour (null)
    const A = BOAT_ANCHORS;
    const [cx0, cx1, chw] = A.cockpit;
    this.stripY = A.helm[1] - 0.12;   // the model's LED strip runs just under the coaming
    this.points = [
      [A.navPort, RED, 0.4], [A.navStbd, GREEN, 0.4], [A.sternLight, WHITE, 0.3],
      [[(cx0 + cx1) / 2, this.stripY, -chw + 0.05], null, 0.6], [[(cx0 + cx1) / 2, this.stripY, chw - 0.05], null, 0.6],
      [[cx0 + 0.35, this.stripY, 0], null, 0.5],
    ];
  }

  // how dark it is: low sun, night, and the gloom under storm cloud and rain
  prePass(light) {
    const app = this.game.app, L = app.local || {};
    const lowSun = light.night ? 1 : 1 - smoothstep(-0.02, 0.3, light.sunDir[1]);
    const storm = Math.max((L.dark || 0) * 0.95, (L.rain || 0) * 0.7);
    const dark = Math.max(lowSun, storm);
    this.level = 0.1 + 0.9 * dark;
    this.game.meshes.lamp = this.level;
  }

  drawTransparent(scene) {
    const gl = this.gl, app = this.game.app;
    if (!this.prog) this.prog = new Program(gl, VS, FS, { label: 'boat-lights' });
    const boats = this.game.renderBoats().filter((b) => !b.ghost);
    if (!boats.length) return;
    const cam = app.cam.pos;
    const tanHalf = Math.tan(app.cam.fov / 2), aspect = app.w / app.h;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.depthMask(false);
    this.prog.use(scene);
    this.prog.set('uLevel', this.level);
    bindEmpty(gl);
    for (const b of boats) {
      const m = b.pose.matrix(this.mat);
      for (const [p, col, size] of this.points) {
        const w = [
          m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
          m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
          m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
        ];
        const dx = cam[0] - w[0], dy = cam[1] - w[1], dz = cam[2] - w[2];
        const d = Math.hypot(dx, dy, dz);
        // toward the camera a little, so the housing it sits in does not cut the glow in half
        const k = 0.15 / d;
        const pos = [w[0] + dx * k, w[1] + dy * k, w[2] + dz * k];
        // at least a few pixels across, so a distant boat still shows its lights
        const sy = Math.max(size * (0.3 + 0.5 * this.level) / (d * tanHalf), 6 / app.h);
        this.prog.set('uPos', pos);
        this.prog.set("uHalf", [sy / aspect, sy]);
        this.prog.set('uColor', col || b.livery.color);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
    }
    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }
}
