// GLSL both the terrain and the sea shader need: reading the height field, how far waves get into shallow
// water, and the swash that runs up a beach. One formula each, so the sand goes wet exactly where the
// foam laps. (The JS twins are waveAtt in landfield.js; the constants come from there.)
import { WAVE_ATT } from './landfield.js';

// The shared formulas. uLandOn says whether a height field is bound at all.
export const LAND_COMMON_GLSL = `
uniform float uLandOn;
float waveAtt(float depth) { return smoothstep(${WAVE_ATT[0].toFixed(2)}, ${WAVE_ATT[1].toFixed(2)}, depth); }
// How high up the beach the last wave has run, in metres above the still waterline, at world point xz and time t:
// swell trains of about 70 m arrive every 8 s, break up along the shore, and run higher in a bigger sea.
float swashRun(vec2 xz, float t, float hs, vec2 wdir) {
  float ph = t / 8.0 - dot(xz, wdir) / 70.0 + 0.35 * sin(xz.x * 0.045 + xz.y * 0.031);
  float s = 0.5 + 0.5 * sin(6.2831853 * ph);
  return 0.08 + (0.12 + 0.3 * min(hs, 3.0)) * s * s;
}
`;

// Reading the near height field (the sea's vertex stage only: the fragment stage of the sea is at the
// sixteen texture units every WebGL2 implementation must offer, so it gets the depth as a varying).
export const LAND_TEX_GLSL = `
uniform sampler2D uLandTex;   // the near height field: metres above the still sea, bilinear
uniform vec4 uLandRect;       // its world rectangle: x0, z0, 1 / width, 1 / depth
float landH(vec2 xz) { return textureLod(uLandTex, (xz - uLandRect.xy) * uLandRect.zw, 0.0).r; }
`;
