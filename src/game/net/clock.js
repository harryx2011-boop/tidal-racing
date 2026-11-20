// Clock agreement. The host's clock is the reference ("host time", ms). A client estimates
//   host = local + offset
// from ping round trips: for a ping sent at local c0, answered with host time h, received at c1, the
// offset is h - (c0 + c1) / 2 with an error of at most (c1 - c0) / 2. The samples with the smallest
// round trips are the most trustworthy (queueing delay is one-sided), so the estimate is the median of
// the best half.

export class ClockSync {
  constructor(max = 24) { this.max = max; this.samples = []; }
  add(c0, h, c1) {
    const rtt = c1 - c0;
    if (!(rtt >= 0) || !isFinite(h)) return;
    this.samples.push({ rtt, offset: h - (c0 + c1) / 2 });
    if (this.samples.length > this.max) this.samples.shift();
  }
  get count() { return this.samples.length; }
  // { offset, rtt, error } or null with fewer than `min` samples; error is the half round trip of the best samples
  estimate(min = 3) {
    if (this.samples.length < min) return null;
    const best = this.samples.slice().sort((a, b) => a.rtt - b.rtt).slice(0, Math.max(min, Math.ceil(this.samples.length / 2)));
    const off = best.map((s) => s.offset).sort((a, b) => a - b);
    const m = off.length >> 1;
    const offset = off.length % 2 ? off[m] : (off[m - 1] + off[m]) / 2;
    return { offset, rtt: best[0].rtt, error: best[best.length - 1].rtt / 2 };
  }
}

// The game's net clock. Real time uses performance.now(); with `virtual` (the ?manual test pages) the
// clock only moves when tick(dt) is called, so stepped tests are exact and repeatable.
export class NetClock {
  constructor({ virtual = false, base = 0, now = () => performance.now() } = {}) {
    this.virtual = virtual; this.v = base; this.src = now; this.offset = 0; this.sync = new ClockSync(); this.synced = false;
  }
  local() { return this.virtual ? this.v : this.src(); }
  tick(dt) { if (this.virtual) this.v += dt * 1000; }
  host() { return this.local() + this.offset; }
  // fold in a pong; the first estimate is taken whole, later ones slew so the sea does not jump
  addSample(c0, h, c1) {
    this.sync.add(c0, h, c1);
    const e = this.sync.estimate(this.synced ? 1 : 3);
    if (!e) return false;
    this.offset = this.synced ? this.offset + (e.offset - this.offset) * 0.3 : e.offset;
    this.synced = true; this.error = e.error; this.rtt = e.rtt;
    return true;
  }
  reset() { this.sync = new ClockSync(); this.synced = false; this.offset = 0; }
}
