// A buffer of timestamped poses from one remote boat, read about 100 ms in the past.
//   between two samples: cubic Hermite on position (the velocities are the tangents), shortest-arc yaw
//   past the newest sample: dead reckoning on the last velocity for at most `extrapMs`, then hold
// sample(t) reports mode 'interp' | 'extrap' | 'hold' | 'none' so the caller can smooth the change of mode
// and snap when the error is large (see Remote in session.js).
const wrap = (d) => { d %= 2 * Math.PI; if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return d; };

export class InterpBuffer {
  constructor({ extrapMs = 250, max = 40 } = {}) { this.s = []; this.extrapMs = extrapMs; this.max = max; }
  // s: { t (ms), pos, vel, yaw, pitch, roll, ... any extra fields are carried on the newest sample }
  push(s) {
    const a = this.s;
    if (a.length && s.t <= a[a.length - 1].t) {
      // out of order: insert in place unless it is a duplicate
      let i = a.length - 1;
      while (i >= 0 && a[i].t > s.t) i--;
      if (i >= 0 && a[i].t === s.t) return false;
      a.splice(i + 1, 0, s);
    } else a.push(s);
    if (a.length > this.max) a.shift();
    return true;
  }
  get last() { return this.s[this.s.length - 1] || null; }
  sample(t) {
    const a = this.s, n = a.length;
    if (!n) return { mode: 'none' };
    if (t <= a[0].t) return { mode: n > 1 ? 'interp' : 'hold', ...copy(a[0]) };
    const L = a[n - 1];
    if (t >= L.t) {
      const dt = Math.min(t - L.t, this.extrapMs) / 1000;
      const o = copy(L);
      for (let i = 0; i < 3; i++) o.pos[i] += L.vel[i] * dt;
      return { mode: t - L.t <= this.extrapMs ? 'extrap' : 'hold', ...o };
    }
    let i = n - 2;
    while (i > 0 && a[i].t > t) i--;
    const p = a[i], q = a[i + 1], span = (q.t - p.t) / 1000, u = (t - p.t) / (q.t - p.t);
    const u2 = u * u, u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
    const o = copy(q);
    for (let k = 0; k < 3; k++) o.pos[k] = h00 * p.pos[k] + h10 * span * p.vel[k] + h01 * q.pos[k] + h11 * span * q.vel[k];
    for (let k = 0; k < 3; k++) o.vel[k] = p.vel[k] + (q.vel[k] - p.vel[k]) * u;
    o.yaw = p.yaw + wrap(q.yaw - p.yaw) * u;
    o.pitch = p.pitch + (q.pitch - p.pitch) * u;
    o.roll = p.roll + (q.roll - p.roll) * u;
    return { mode: 'interp', ...o };
  }
}
function copy(s) { return { ...s, pos: s.pos.slice(), vel: s.vel.slice() }; }
export { wrap as wrapAngle };
