// DEBUG AID, not part of the game: `?rival=1` puts one scripted rival on the course so contact, the PIT, drafting
// and the draft indicator can be tried with no second player. It starts 16 m ahead of the grid slot, drives
// the gates at about 31 m/s (a little under the boat's top speed, so you catch it and can draft, bump and pass) and
// fills game.rivals exactly as the networking will: { id, name, pose (a Boat), livery }. It ignores contact, so
// it does not react to being bumped or hit: the real rival will, by moving its own boat. `?rival=2` puts it
// beside you instead of ahead.
import { Boat } from './boat.js';
import { grid } from './courses.js';

const SPEED = 31, ACCEL = 6;
export class DebugRival {
  constructor(game, mode) {
    this.game = game; this.mode = mode;
    this.pose = new Boat();
    this.entry = { id: 'debug', name: 'DEBUG', pose: this.pose, livery: { color: [0.15, 0.55, 0.95], stripe: 1, number: 99 } };
    this.course = null; this.next = 1; this.speed = 0;
  }
  reset() {
    const g = this.game, c = g.course, s = grid(c, 0), p = this.pose;
    const cy = Math.cos(s.yaw), sy = Math.sin(s.yaw);
    const ahead = this.mode === 2 ? 0 : 16, side = this.mode === 2 ? 7 : 0;
    p.reset(s.x + cy * ahead - sy * side, s.z + sy * ahead + cy * side, s.yaw);
    p.pos[1] = g.boat.pos[1]; p.settle = false;
    this.course = c; this.next = 1; this.speed = 0;
  }
  update(dt) {
    const g = this.game;
    if (g.state === 'menu') { g.rivals = []; return; }
    g.rivals = [this.entry];
    if (this.course !== g.course || g.state === 'countdown') this.reset();
    if (g.state !== 'racing' || g.paused) return;
    const p = this.pose, gates = g.course.gates, q = gates[this.next % gates.length];
    const tx = q.c[0] + q.dir[0] * 12 - p.pos[0], tz = q.c[1] + q.dir[1] * 12 - p.pos[2];
    let d = Math.atan2(tz, tx) - p.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    p.yaw += Math.max(-1, Math.min(1, d * 2.5)) * 0.9 * dt;
    const want = Math.abs(d) > 0.9 ? SPEED * 0.6 : SPEED;
    this.speed += Math.max(-ACCEL * dt * 2, Math.min(ACCEL * dt, want - this.speed));
    p.vel = [Math.cos(p.yaw) * this.speed, 0, Math.sin(p.yaw) * this.speed];
    p.pos[0] += p.vel[0] * dt; p.pos[2] += p.vel[2] * dt;
    p.pos[1] = g.boat.pos[1];
    const s = (p.pos[0] - q.c[0]) * q.dir[0] + (p.pos[2] - q.c[1]) * q.dir[1];
    if (s > 0 && Math.hypot(p.pos[0] - q.c[0], p.pos[2] - q.c[1]) < 60) this.next++;
  }
}
