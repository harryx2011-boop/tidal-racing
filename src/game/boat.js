// Arcade powerboat on real waves. Four points under the hull feel the sea: buoyancy lifts and
// trims the boat, slopes push it, and a crest taken fast enough throws it clear of the water.
// Steering and grip are forgiving; the sea is not scripted.
import { clamp } from '../math.js';

const G = 9.81;
// hull sample points (local x forward, z starboard), at the keel
export const HULL = [[2.9, -0.6], [2.9, 0.6], [-3.1, -1.0], [-3.1, 1.0]];
const DRAFT = 0.36;
const KB = G / DRAFT;         // buoyancy per metre of immersion, summed over the points: floats at DRAFT
const TOP = 36, THRUST = 9.0; // m/s, m/s^2
const C1 = 0.05, C2 = (THRUST - C1 * TOP) / (TOP * TOP);
export const SPIN_DECAY = 2.5; // 1/s: a spin imparted by contact dies away with this rate
export const BOOST_THRUST = 1.6, BOOST_SECONDS = 3.5;

export class Boat {
  constructor() { this.reset(0, 0, 0); }

  reset(x, z, yaw) {
    this.pos = [x, 0.2, z];
    this.vel = [0, 0, 0];
    this.yaw = yaw; this.pitch = 0; this.roll = 0;
    this.wYaw = 0; this.wPitch = 0; this.wRoll = 0;
    this.boost = 0; this.boosting = false;
    this.wet = 1; this.airTime = 0; this.lastAir = 0; this.slam = 0;
    this.ground = 0;   // 0..1: how hard the hull is aground (collide.js)
    this.spin = 0;     // extra yaw rate (rad/s) from a PIT or a hard hit (contact.js); decays on its own
    this.dragCut = 0;  // 0..1: share of the water drag taken off by a rival's slipstream (draft.js)
    this.throttle = 0; this.steer = 0;
    this.settle = true; // drop onto the sea surface on the next step
  }

  // orthonormal body axes in world space: X forward, Y up, Z starboard
  axes() {
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw), cp = Math.cos(this.pitch), sp = Math.sin(this.pitch), cr = Math.cos(this.roll), sr = Math.sin(this.roll);
    const X = [cy * cp, sp, sy * cp];
    const Y1 = [-cy * sp, cp, -sy * sp];
    const Z1 = [-sy, 0, cy];
    const Z = [Z1[0] * cr - Y1[0] * sr, -Y1[1] * sr, Z1[2] * cr - Y1[2] * sr];
    const Y = [Y1[0] * cr + Z1[0] * sr, Y1[1] * cr, Y1[2] * cr + Z1[2] * sr];
    return { X, Y, Z };
  }

  matrix(out = new Float32Array(16)) {
    const { X, Y, Z } = this.axes();
    out.set([X[0], X[1], X[2], 0, Y[0], Y[1], Y[2], 0, Z[0], Z[1], Z[2], 0, this.pos[0], this.pos[1], this.pos[2], 1]);
    return out;
  }

  // world xz of the hull points a little ahead in time (the probe answers late)
  probePoints(lead = 0.03) {
    const { X, Z } = this.axes();
    const out = [];
    for (const [lx, lz] of HULL) {
      out.push(this.pos[0] + X[0] * lx + Z[0] * lz + this.vel[0] * lead, this.pos[2] + X[2] * lx + Z[2] * lz + this.vel[2] * lead);
    }
    return out;
  }

  get speed() { return Math.hypot(this.vel[0], this.vel[2]); }

  // input: { throttle -1..1, steer -1..1, boost bool }; sea(i, x, z) -> { h, sx, sz } under hull point i
  step(dt, input, sea, drive = true) {
    const { X, Y, Z } = this.axes();
    const fwd = [Math.cos(this.yaw), Math.sin(this.yaw)], right = [-fwd[1], fwd[0]];
    let vf = this.vel[0] * fwd[0] + this.vel[2] * fwd[1];
    let vl = this.vel[0] * right[0] + this.vel[2] * right[1];
    // a planing hull rides higher as it speeds up
    const keel = DRAFT + 0.1 * clamp(Math.abs(vf) / 30, 0, 1);

    if (this.settle) {
      // place the boat on the sea: mean height and trim of the four points
      const h = HULL.map(([lx, lz], i) => sea(i, this.pos[0] + fwd[0] * lx + right[0] * lz, this.pos[2] + fwd[1] * lx + right[1] * lz).h);
      this.pos[1] = (h[0] + h[1] + h[2] + h[3]) / 4;
      this.pitch = Math.atan2((h[0] + h[1] - h[2] - h[3]) / 2, 6.0);
      this.roll = 0;
      this.settle = false;
      return;
    }

    let ay = -G, aPitch = 0, aRoll = 0, wet = 0, sternWet = 0, sx = 0, sz = 0;
    for (let i = 0; i < 4; i++) {
      const [lx, lz] = HULL[i];
      const px = this.pos[0] + X[0] * lx + Z[0] * lz, pz = this.pos[2] + X[2] * lx + Z[2] * lz;
      const py = this.pos[1] + X[1] * lx + Z[1] * lz - keel;
      const w = sea(i, px, pz);
      const depth = w.h - py;
      if (depth <= 0) continue;
      wet += 0.25;
      if (lx < 0) sternWet += 0.5;
      sx += w.sx * 0.25; sz += w.sz * 0.25;
      // the hull point's vertical speed relative to the surface it is crossing
      const vRel = this.vel[1] + this.wPitch * lx - this.wRoll * lz - (w.sx * this.vel[0] + w.sz * this.vel[2]);
      // (water pushes, it never pulls: no suction holding the hull down over a crest)
      const a = Math.max(KB * Math.min(depth, 1.4) - 3.4 * vRel, 0) * 0.25;
      ay += a;
      aPitch += a * lx / 6.0;   // radius of gyration^2 in pitch ~6 m2
      aRoll -= a * lz / 1.1;
    }

    const inWater = wet > 0;
    // touchdown: a flat, hard landing scrubs speed; landing on a downslope keeps it
    if (inWater && this.airTime > 0.25) {
      const hit = clamp((-this.vel[1] - 3.5) * 0.035, 0, 0.3);
      this.vel[0] *= 1 - hit; this.vel[2] *= 1 - hit;
      vf *= 1 - hit; vl *= 1 - hit;
      this.slam = hit;
      this.lastAir = this.airTime;
    }
    this.airTime = inWater ? 0 : this.airTime + dt;
    this.wet = wet;

    // engine, boost, drag
    const thr = drive ? clamp(input.throttle, -1, 1) : 0;
    this.boosting = drive && !!input.boost && this.boost > 0 && thr > 0;
    if (this.boosting) this.boost = Math.max(this.boost - dt / BOOST_SECONDS, 0);
    let af = (thr >= 0 ? thr * THRUST * (this.boosting ? BOOST_THRUST : 1) : thr * THRUST * 0.45) * sternWet;
    const dragK = 0.04 + 0.96 * wet;
    af -= (C1 * vf + C2 * vf * Math.abs(vf)) * dragK * (this.dragCut > 0 ? 1 - this.dragCut : 1);
    if (Math.abs(thr) < 0.02) af -= 0.12 * vf * wet;
    // sideslip bleeds away in the water; in the air the boat keeps its heading and its motion
    const al = -vl * 3.2 * wet;
    // gravity along the wave face: climbing a wave costs speed, running down one gives it back
    const gx = -G * sx * 0.55 * wet, gz = -G * sz * 0.55 * wet;
    this.vel[0] += (fwd[0] * af + right[0] * al + gx) * dt;
    this.vel[2] += (fwd[1] * af + right[1] * al + gz) * dt;
    this.vel[1] += ay * dt;

    // steering: the outdrives bite only while the stern is in the water
    const st = drive ? clamp(input.steer, -1, 1) : 0;
    const authority = clamp(Math.abs(vf) / 7, 0, 1) * (1 - 0.5 * clamp(Math.abs(vf) / 46, 0, 1)) * Math.sign(vf || 1);
    const target = st * 1.05 * authority;
    this.wYaw += (target - this.wYaw) * (1 - Math.exp(-dt * 5.5)) * Math.max(sternWet, 0.08);
    this.yaw += this.wYaw * dt;
    if (this.spin !== 0) { this.yaw += this.spin * dt; this.spin *= Math.exp(-dt * SPIN_DECAY); if (Math.abs(this.spin) < 1e-3) this.spin = 0; }

    // trim: thrust lifts the bow, a turn banks the hull into it, the air levels it gently
    aPitch += thr * 0.9 * sternWet * (1 - clamp(Math.abs(vf) / 40, 0, 0.8));
    aRoll += this.wYaw * vf * 0.22 * wet;
    const damp = inWater ? 3.2 : 0.5;
    aPitch -= this.wPitch * damp + (inWater ? 0 : this.pitch * 2.2);
    aRoll -= this.wRoll * (inWater ? 4.0 : 0.6) + (inWater ? this.roll * 2.0 : this.roll * 3.0);
    this.wPitch += aPitch * dt; this.wRoll += aRoll * dt;
    this.pitch = clamp(this.pitch + this.wPitch * dt, -1.1, 1.1);
    this.roll = clamp(this.roll + this.wRoll * dt, -1.0, 1.0);

    this.pos[0] += this.vel[0] * dt; this.pos[1] += this.vel[1] * dt; this.pos[2] += this.vel[2] * dt;

    // airtime at racing speed fills the boost meter
    if (!inWater && this.speed > 12) this.boost = Math.min(this.boost + dt * 0.3, 1);
    this.slam = Math.max(this.slam - dt * 0.6, 0);
    this.throttle = thr; this.steer = st;
  }
}
