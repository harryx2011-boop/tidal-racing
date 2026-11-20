// Slipstream and slingshot. Inside a fast rival's wake cone my water drag is lower (boat.dragCut, read in boat.js)
// and my boost fills; the effect falls with the gap behind its transom and with the offset from its line. Time
// spent in the cone stores draft; leaving the cone with enough stored gives a short extra shove (the slingshot).
// Only my own boat is changed, from the rival's (delayed) pose: its wake really was there. Run once per physics
// step before boat.step. With no rivals it only clears boat.dragCut, so solo handling is untouched.
//
// Cone: from the rival's stern to LEN metres aft, half-width W0 + WK * gap, needs the rival at 14 m/s and up
// (full at 26) and my heading within about 50 degrees of its own. strength = speed * heading * (1 - gap/LEN)^1.3 *
// offset falloff (full inside 30% of the half-width, zero at the edge).
import { clamp, smoothstep } from '../math.js';
import { HALF } from './contact.js';

export const LEN = 25, W0 = 1.4, WK = 0.1, MIN_SPEED = 14, FULL_SPEED = 26;
export const DRAG_CUT = 0.22;        // share of drag removed at full strength (top speed 36 -> about 41.5 m/s)
export const BOOST_RATE = 0.22;      // boost meter per second at full strength (airtime gives 0.3)
export const CHARGE_S = 2.0;         // seconds at full strength to store a full draft
export const SLING_MIN = 0.4, SLING_ACC = 6.0, SLING_T = 1.1;   // stored needed; m/s^2 at full store; seconds
const IN = 0.15, OUT = 0.08;
const BOW = 3.3;                     // my bow ahead of my centre

export function strengthOf(boat, pose) {
  const rs = pose.speed !== undefined ? pose.speed : Math.hypot(pose.vel[0], pose.vel[2]);
  const sf = smoothstep(MIN_SPEED, FULL_SPEED, rs);
  if (sf <= 0) return 0;
  const gx = Math.cos(pose.yaw), gz = Math.sin(pose.yaw), cy = Math.cos(boat.yaw), sy = Math.sin(boat.yaw);
  const align = smoothstep(0.64, 0.9, cy * gx + sy * gz);
  if (align <= 0) return 0;
  const bx = boat.pos[0] + cy * BOW - (pose.pos[0] - gx * HALF), bz = boat.pos[2] + sy * BOW - (pose.pos[2] - gz * HALF);
  const along = bx * gx + bz * gz, side = Math.abs(-bx * gz + bz * gx);   // along the rival's keel from its stern (negative: behind it)
  const gap = -along;
  if (gap > LEN || gap < -2) return 0;
  const g = Math.max(gap, 0), fd = Math.pow(1 - g / LEN, 1.3);
  const w = W0 + WK * g, fo = 1 - smoothstep(0.3, 1, side / w);
  return sf * align * fd * fo;
}

export class Draft {
  constructor(game) {
    this.game = game;
    this.s = 0;          // strength this step, 0..1
    this.level = 0;      // smoothed, for the HUD
    this.stored = 0;     // 0..1
    this.inside = false;
    this.sling = 0; this.slingK = 0;   // slingshot time left, strength
    this.slings = 0;
    this.slingAcc = SLING_ACC;
  }

  step(boat, dt, drive = true) {
    const rivals = this.game.rivals;
    if (!drive || !rivals || !rivals.length) {
      boat.dragCut = 0;
      if (this.s || this.stored || this.sling || this.level) { this.s = 0; this.stored = 0; this.sling = 0; this.level = 0; this.inside = false; }
      return;
    }
    let s = 0;
    for (let i = 0; i < rivals.length; i++) s = Math.max(s, strengthOf(boat, rivals[i].pose));
    this.s = s;
    boat.dragCut = DRAG_CUT * s;
    if (s > 0) boat.boost = Math.min(boat.boost + BOOST_RATE * s * dt, 1);
    this.level += (s - this.level) * Math.min(dt * 10, 1);
    if (s > IN) this.inside = true;
    if (this.inside && s < OUT) {
      this.inside = false;
      if (this.stored >= SLING_MIN) { this.sling = SLING_T; this.slingK = this.stored; this.slings++; }
      this.stored = 0;
    }
    if (this.inside) this.stored = Math.min(this.stored + dt * s / CHARGE_S, 1);
    else this.stored = Math.max(this.stored - dt / 1.5, 0);
    if (this.sling > 0) {
      this.sling -= dt;
      const a = this.slingAcc * this.slingK * dt;
      boat.vel[0] += Math.cos(boat.yaw) * a; boat.vel[2] += Math.sin(boat.yaw) * a;
    }
  }
}
