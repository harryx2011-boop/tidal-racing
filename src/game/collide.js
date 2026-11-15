// What stops the boat going through things, run once per physics step after the boat has moved.
//
// The ground. The hull is probed at seven points (bow, chines, stern). Where the water under a point is
// shallower than the hull needs (DRAFT_CLEAR, the keel plus a margin) the boat is grounded: its speed bleeds
// off hard, the speed toward the shore is taken off (a little bounce), and it is pushed back toward deeper
// water along the downhill of the height field, harder the shallower it is and hardest on dry land, so it
// slides off a beach instead of sticking. The depth is the still-water depth: waves die in shallows (see
// waveAtt) so the sea there is flat anyway. boat.ground (0..1) says how hard it is aground.
//
// The solids. Marks (buoys, pylons, gantry towers) and scenery (lighthouse, breakwater, beacons, platform, anchored
// boats) are circles { x, z, r } and, for the platform, a box { x, z, hx, hz, yaw }. The hull is three
// circles along its axis. A contact moves the boat out along the normal and takes the closing speed off with
// a little bounce. No damage.
//
// Cost per step: one distance test against every circle (about 100 on the busiest course: the marks, the
// breakwater's chain, boats and beacons), a capsule test (three circle tests) only for those within reach
// of the hull, and seven bilinear reads of the height field. No allocation.
const DRAFT_CLEAR = 0.6;
const PROBES = [[4.3, 0], [3.0, -0.8], [3.0, 0.8], [0, -1.2], [0, 1.2], [-3.2, -1.0], [-3.2, 1.0]];
const CAP = [[3.0, 1.25], [0, 1.35], [-3.0, 1.25]];     // the hull as three circles: x along the axis, radius
const REACH = 3.0 + 1.25 + 0.5;
const BOUNCE = 0.3;
const DIRS = 8;

export class Collisions {
  constructor(game) {
    this.game = game;
    this.s = { h: 0, gx: 0, gz: 0 };
    this.tests = 0;            // circle and box tests this step (for the report)
    this.hits = 0;
    this.lists = [];
  }

  step(boat, dt) {
    const g = this.game, land = g.land;
    this.tests = 0; this.hits = 0;
    const cy = Math.cos(boat.yaw), sy = Math.sin(boat.yaw);
    if (land && land.field) this.ground(boat, dt, land.field, cy, sy);
    const sy2 = g.systems;
    for (let i = 0; i < sy2.length; i++) if (sy2[i].colliders && sy2[i].colliders.length) this.solids(boat, sy2[i].colliders, cy, sy);
  }

  ground(boat, dt, field, cy, sy) {
    const s = this.s, pos = boat.pos, vel = boat.vel;
    let pen = 0, px = 0, pz = 0, worst = 0;
    for (let i = 0; i < PROBES.length; i++) {
      const lx = PROBES[i][0], lz = PROBES[i][1];
      const wx = pos[0] + cy * lx - sy * lz, wz = pos[2] + sy * lx + cy * lz;
      field.sample(wx, wz, s);
      this.tests++;
      const c = DRAFT_CLEAR + s.h;                // how far the keel is below the bottom (positive: aground)
      if (c <= 0) continue;
      const gl = Math.hypot(s.gx, s.gz);
      let nx, nz;
      if (gl > 2e-3) { nx = -s.gx / gl; nz = -s.gz / gl; } else { this.toWater(field, wx, wz, s); nx = s.gx; nz = s.gz; }
      const w = c > 3 ? 3 : c;
      pen += w; px += nx * w; pz += nz * w;
      if (c > worst) worst = c;
    }
    boat.ground = pen > 0 ? Math.min(worst, 1.2) / 1.2 : Math.max((boat.ground || 0) - dt * 4, 0);
    if (pen <= 0) return;
    const l = Math.hypot(px, pz) || 1, nx = px / l, nz = pz / l;
    const k = Math.min(worst, 1.2);
    const drag = Math.exp(-dt * (2 + 9 * k));
    vel[0] *= drag; vel[2] *= drag;
    const vn = vel[0] * nx + vel[2] * nz;
    if (vn < 0) { vel[0] -= (1 + BOUNCE) * vn * nx; vel[2] -= (1 + BOUNCE) * vn * nz; }
    const a = 4 + 14 * k + (worst > 1.5 ? 20 : 0);
    vel[0] += nx * a * dt; vel[2] += nz * a * dt;
    const shift = Math.min(0.02 + worst * 0.12, 0.35);
    pos[0] += nx * shift; pos[2] += nz * shift;
  }

  // where there is no slope to follow (a flat plateau): the direction of the lowest ground within 60 m, in s.gx, s.gz
  toWater(field, x, z, s) {
    let best = 1e9, bx = 0, bz = 0;
    for (let k = 0; k < DIRS; k++) {
      const a = (k / DIRS) * 6.2831853, dx = Math.cos(a), dz = Math.sin(a);
      const h = field.heightAt(x + dx * 60, z + dz * 60);
      if (h < best) { best = h; bx = dx; bz = dz; }
    }
    s.gx = bx; s.gz = bz;
  }

  solids(boat, list, cy, sy) {
    const pos = boat.pos, vel = boat.vel;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const dx = pos[0] - c.x, dz = pos[2] - c.z;
      this.tests++;
      if (c.hx !== undefined) {
        const reach = Math.hypot(c.hx, c.hz) + REACH;
        if (dx * dx + dz * dz > reach * reach) continue;
        const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
        for (let k = 0; k < 3; k++) {
          const rx = pos[0] + cy * CAP[k][0] - c.x, rz = pos[2] + sy * CAP[k][0] - c.z, R = CAP[k][1];
          const lx = cs * rx + sn * rz, lz = -sn * rx + cs * rz;
          const qx = lx < -c.hx ? -c.hx : lx > c.hx ? c.hx : lx, qz = lz < -c.hz ? -c.hz : lz > c.hz ? c.hz : lz;
          const ex = lx - qx, ez = lz - qz, d2 = ex * ex + ez * ez;
          if (d2 >= R * R) continue;
          let nlx, nlz, pen;
          if (d2 > 1e-8) { const d = Math.sqrt(d2); nlx = ex / d; nlz = ez / d; pen = R - d; }
          else {   // the hull's centre is inside the box: leave by the nearest face
            const px = c.hx - Math.abs(lx), pz = c.hz - Math.abs(lz);
            if (px < pz) { nlx = lx < 0 ? -1 : 1; nlz = 0; pen = px + R; } else { nlx = 0; nlz = lz < 0 ? -1 : 1; pen = pz + R; }
          }
          this.push(boat, cs * nlx - sn * nlz, sn * nlx + cs * nlz, pen);
        }
        continue;
      }
      const reach = c.r + REACH;
      if (dx * dx + dz * dz > reach * reach) continue;
      for (let k = 0; k < 3; k++) {
        const ex = pos[0] + cy * CAP[k][0] - c.x, ez = pos[2] + sy * CAP[k][0] - c.z, R = c.r + CAP[k][1];
        const d2 = ex * ex + ez * ez;
        if (d2 >= R * R) continue;
        const d = Math.sqrt(d2) || 1e-4;
        this.push(boat, ex / d, ez / d, R - d);
      }
    }
  }

  // move the boat out along (nx, nz) by pen and take off the speed it was closing at, with a little bounce
  push(boat, nx, nz, pen) {
    this.hits++;
    boat.pos[0] += nx * pen; boat.pos[2] += nz * pen;
    const vn = boat.vel[0] * nx + boat.vel[2] * nz;
    if (vn < 0) { boat.vel[0] -= (1 + BOUNCE) * vn * nx; boat.vel[2] -= (1 + BOUNCE) * vn * nz; }
  }
}
