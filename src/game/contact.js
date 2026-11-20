// Boat-to-boat contact, the PIT maneuver and bump drafting. Run once per physics step (after the boat has
// moved and collide.js has run) for the local boat only. Every rule is written so that two clients, each moving
// only its own boat against the other's interpolated (about 100 ms old) pose, reach the same outcome:
//
//  Hull. A capsule along the keel line: segment x = -HALF..HALF, radius R (about 8.8 m by 2.4 m). Two hulls
//  touch when the distance between their segments is under 2R.
//  Rival state. A rival's pose is about LEAD s old, so every test uses it moved forward by LEAD along its
//  velocity (my best guess of where it is now; both clients then see the same contact at the same moment, which
//  a stale pose cannot give for boats going the same way). The momentum I apply to myself is also assumed given
//  to the rival, opposite and equal, for HOLD + FADE seconds, until its own response shows up in its pose: without
//  that, a stale velocity makes each side apply the exchange again and again and both bounce off too hard.
//  Collision. Push my boat out along the contact normal (all of the overlap: the rival moves itself on its own
//  client) and exchange momentum as if the rival had equal mass, restitution E, my half only. A hard off-centre
//  hit adds a little spin (SPIN_K). Overlap is cleared to 1 cm of air so a side rub neither sinks nor jitters.
//  PIT. The VICTIM applies it. When the rival's bow (its segment's forward part) meets MY stern quarter (contact
//  aft of x = -1 m in my frame) and the closing speed along the contact normal has at least PIT_LAT m/s across
//  my hull, my boat gets a yaw spin away from the hit (boat.spin, decays at SPIN_DECAY in boat.js), a speed
//  scrub, and PIT_IMMUNE seconds in which it cannot be PITted again. The striker's client sees the mirror
//  contact (its bow on a stern) and only does the ordinary collision.
//  Bump draft. A square, slow push from behind: both hulls aligned within ~20 degrees, contact on the axis,
//  closing speed under BUMP_MAXCLOSE. The pusher (my bow on their stern) adds BUMP_PUSHER m/s to my forward
//  speed, the pushed (their bow on my stern) adds BUMP_PUSHED; each client adds only its own part, then waits
//  BUMP_CD seconds.
import { clamp, smoothstep } from '../math.js';

export const HALF = 3.2, R = 1.2, RR = 2 * R;
export const E = 0.3, MARGIN = 0.12;
export const LEAD = 0.1, HOLD = 0.1, FADE = 0.1;   // s: pose age compensated; assumed rival response kept, then faded out
export const SPIN_K = 0.012, SPIN_MAX = 2.5;
export const PIT_LAT = 2.2, PIT_SPIN = [5.0, 7.0], PIT_SCRUB = 0.8, PIT_IMMUNE = 3.0;
export const BUMP_MAXCLOSE = 4.0, BUMP_PUSHER = 1.4, BUMP_PUSHED = 1.8, BUMP_CD = 0.7, BUMP_MINSPEED = 10, BUMP_ALIGN = 0.94, BUMP_AXIAL = 0.88;

// closest points of two 2D segments (the hulls' keel lines): a0 + s*d1 and b0 + t*d2
const C = { d: 0, ax: 0, az: 0, bx: 0, bz: 0, sa: 0, sb: 0 };
export function closest(pa, ya, pb, yb) {
  const fx = Math.cos(ya), fz = Math.sin(ya), gx = Math.cos(yb), gz = Math.sin(yb);
  const a0x = pa[0] - fx * HALF, a0z = pa[2] - fz * HALF, b0x = pb[0] - gx * HALF, b0z = pb[2] - gz * HALF;
  const d1x = fx * 2 * HALF, d1z = fz * 2 * HALF, d2x = gx * 2 * HALF, d2z = gz * 2 * HALF;
  const rx = a0x - b0x, rz = a0z - b0z;
  const a = d1x * d1x + d1z * d1z, e = d2x * d2x + d2z * d2z, f = d2x * rx + d2z * rz, c = d1x * rx + d1z * rz, b = d1x * d2x + d1z * d2z;
  const den = a * e - b * b;
  let s = den > 1e-6 ? clamp((b * f - c * e) / den, 0, 1) : 0, t = (b * s + f) / e;
  if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); } else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
  C.ax = a0x + d1x * s; C.az = a0z + d1z * s; C.bx = b0x + d2x * t; C.bz = b0z + d2z * t;
  C.d = Math.hypot(C.ax - C.bx, C.az - C.bz);
  C.sa = (s - 0.5) * 2 * HALF; C.sb = (t - 0.5) * 2 * HALF;   // metres along each keel from its centre, + toward the bow
  return C;
}

export class Contact {
  constructor(game) {
    this.game = game;
    this.pitT = 0;        // PIT immunity left (s)
    this.bumpT = 0;       // bump-draft cooldown left (s)
    this.bump = 0;        // 0..1, fades: the HUD lights the draft indicator after a bump
    this.touching = 0;    // rivals in contact this step
    this.pits = 0; this.bumps = 0; this.hits = 0;   // counters (for the checks)
    this.lastPit = 0;     // sign of the last PIT's spin
    this.lead = LEAD;     // seconds of rival extrapolation (set to 0 if rivals are ever given as current poses)
    this.assume = true;   // keep the assumed response of the rival (see above)
    this.mem = new Map(); // per rival pose: the velocity change I assume it got from my impacts { x, z, t }
    this.pe = [0, 0, 0];
  }

  step(boat, dt, drive = true) {
    this.pitT = Math.max(this.pitT - dt, 0); this.bumpT = Math.max(this.bumpT - dt, 0); this.bump = Math.max(this.bump - dt * 1.5, 0);
    this.touching = 0;
    for (const m of this.mem.values()) { m.t += dt; m.hard = Math.max(m.hard - dt, 0); }
    const rivals = this.game.rivals;
    if (!rivals || !rivals.length) return;
    for (let i = 0; i < rivals.length; i++) {
      const p = rivals[i].pose;
      if (Math.abs(boat.pos[1] - p.pos[1]) > 1.6) continue;       // one boat is flying over the other
      const dx = boat.pos[0] - p.pos[0], dz = boat.pos[2] - p.pos[2];
      if (dx * dx + dz * dz > 14 * 14) continue;
      this.one(boat, p, dt, drive);
    }
    if (!isFinite(boat.pos[0] + boat.pos[2] + boat.vel[0] + boat.vel[2])) throw new Error('contact: NaN');
  }

  one(boat, p, dt, drive) {
    let m = this.mem.get(p);
    if (!m) { m = { x: 0, z: 0, t: 1e9, hard: 0 }; this.mem.set(p, m); }
    const f = !this.assume ? 0 : m.t < HOLD ? 1 : Math.max(1 - (m.t - HOLD) / FADE, 0);
    const rvx = p.vel[0] + m.x * f, rvz = p.vel[2] + m.z * f;       // the rival's velocity as I best know it
    const pe = this.pe; pe[0] = p.pos[0] + rvx * this.lead; pe[1] = p.pos[1]; pe[2] = p.pos[2] + rvz * this.lead;
    const cl = closest(boat.pos, boat.yaw, pe, p.yaw);
    if (cl.d >= RR + MARGIN) return;
    this.touching++;
    const cy = Math.cos(boat.yaw), sy = Math.sin(boat.yaw), rtx = -sy, rtz = cy;   // my forward and right (xz)
    let nx, nz;
    if (cl.d > 1e-3) { nx = (cl.ax - cl.bx) / cl.d; nz = (cl.az - cl.bz) / cl.d; }
    else { const sgn = ((boat.pos[0] - p.pos[0]) * rtx + (boat.pos[2] - p.pos[2]) * rtz) >= 0 ? 1 : -1; nx = rtx * sgn; nz = rtz * sgn; }
    const vx = boat.vel[0] - rvx, vz = boat.vel[2] - rvz;
    const closing = -(vx * nx + vz * nz);                          // m/s the hulls approach along the normal
    const nlx = nx * cy + nz * sy, nlz = nx * rtx + nz * rtz;      // normal in my frame
    const mx = (cl.ax + cl.bx) / 2 - boat.pos[0], mz = (cl.az + cl.bz) / 2 - boat.pos[2];
    const lx = mx * cy + mz * sy;                                  // contact point along my keel
    const align = cy * Math.cos(p.yaw) + sy * Math.sin(p.yaw);     // cos of the angle between headings
    const mySpeed = boat.speed, theirSpeed = Math.hypot(rvx, rvz);

    // ---- classify before the impulse changes the velocity
    let pit = false, bumpGain = 0;
    if (drive) {
      if (this.pitT <= 0 && lx < -1.0 && cl.sb > 1.0 && closing * Math.abs(nlz) >= PIT_LAT && Math.abs(nlz) > 0.45) pit = true;
      else if (this.bumpT <= 0 && m.hard <= 0 && mySpeed > BUMP_MINSPEED && theirSpeed > BUMP_MINSPEED && align > BUMP_ALIGN && Math.abs(nlx) > BUMP_AXIAL && Math.abs(closing) < BUMP_MAXCLOSE) {
        if (lx > 1.0 && cl.sb < -1.0 && nlx < 0) bumpGain = BUMP_PUSHER;        // my bow on their transom
        else if (lx < -1.0 && cl.sb > 1.0 && nlx > 0) bumpGain = BUMP_PUSHED;   // their bow on my transom
      }
    }

    if (closing > BUMP_MAXCLOSE) m.hard = 0.6;                     // a hard hit is not a draft for a moment after it

    // ---- ordinary contact: out of the overlap, equal-mass exchange of my half
    if (cl.d < RR) {
      this.hits++;
      const pen = Math.min(RR - cl.d + 0.01, 1.5);
      boat.pos[0] += nx * pen; boat.pos[2] += nz * pen;
      if (closing > 0) {
        const dv = (1 + E) * closing * 0.5;
        boat.vel[0] += nx * dv; boat.vel[2] += nz * dv;
        if (m.t >= HOLD + FADE) { m.x = 0; m.z = 0; }
        m.x -= nx * dv; m.z -= nz * dv; m.t = 0;     // the rival is taken to have received the opposite change
        const torque = mx * nz * dv - mz * nx * dv;                // r x dv (x forward, z toward +yaw)
        boat.spin = clamp(boat.spin + SPIN_K * torque, -SPIN_MAX, SPIN_MAX);
      }
    }

    if (pit) {
      const lat = closing * Math.abs(nlz);
      const mag = PIT_SPIN[0] + (PIT_SPIN[1] - PIT_SPIN[0]) * clamp((lat - PIT_LAT) / 6, 0, 1);
      this.lastPit = nlz > 0 ? -1 : 1;                              // stern shoved to starboard: the bow swings to port
      boat.spin = this.lastPit * mag;
      boat.vel[0] *= PIT_SCRUB; boat.vel[2] *= PIT_SCRUB;
      this.pitT = PIT_IMMUNE; this.pits++;
      this.game.hud?.flash('PIT');
    } else if (bumpGain) {
      boat.vel[0] += cy * bumpGain; boat.vel[2] += sy * bumpGain;
      this.bumpT = BUMP_CD; this.bump = 1; this.bumps++;
    }
  }
}
