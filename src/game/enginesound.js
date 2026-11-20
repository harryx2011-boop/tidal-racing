// Engine sound, synthesized: the player's triple outboards (PlayerEngine) and one cheaper voice
// per rival (RivalEngine). Nothing here touches the DOM or the game: a voice takes an AudioContext
// (live or Offline) and a destination node, and update(t, state) says what the boat is doing, so
// tools/check-sound.mjs renders the same graph offline and measures it.
//
// Engine speed model (EngineModel): revs follow a target from throttle and boat speed. A standing
// start lugs (load pulls the revs down) and they climb as the hull planes; when the props leave
// the water they flare toward the limiter, and on re-entry they bog for a moment.
//
// Every parameter change goes through setTargetAtTime (a smoothing time constant, never a jump),
// and update() is rate-limited, so the engine does not zipper or click.

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ---- tuning constants (the owner's first dials) -------------------------------------------------
export const TUNE = {
  idleRev: 0.1,            // revs at rest, 0..1 (1 = limiter)
  fBase: 30, fSpan: 175,   // firing frequency of one engine (Hz): fBase + fSpan * rev (about 47 Hz idle, 210 Hz at the limiter)
  detune: [0.988, 1.0, 1.013],   // the three engines' pitch ratios: sets how fast they beat (about 1 to 3 Hz at 100 Hz)
  cutoffLo: 380, cutoffHi: 3300, // exhaust lowpass at idle and at the limiter (Hz)
  revUp: 5.5, revFlare: 10, revDown: 2.8, revBog: 9,   // how fast the revs chase their target (1/s)
  flareRev: 0.42,          // extra revs when the props are out of the water (at full throttle)
  bogDepth: 0.35, bogDecay: 3,   // dip on re-entry and its decay rate (1/s)
  lug: 0.2,                // revs lost to load from a standing start
  gain: 0.22,              // player engine level before the engine volume setting (the sea and wind alone sit near 0.02 rms)
  whineGain: 0.02, intakeGain: 0.025, boostGain: 0.14,   // whine and intake ride on the engine gain; the boost layer is added after it
  rivalGain: 0.3,
};

export function noiseBuf(ctx, seconds, seed = 1) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) { s = (s * 1664525 + 1013904223) >>> 0; d[i] = s / 4294967296 * 2 - 1; }
  return buf;
}

export class EngineModel {
  constructor() { this.rev = TUNE.idleRev; this.bog = 0; this.air = false; this.airT = 0; this.load = 0; }

  // s: { throttle, speed, wet (0..1), airTime (s), boosting }
  step(dt, s) {
    const T = TUNE;
    dt = clamp(dt, 0, 0.1);
    const thr = clamp(s.throttle, 0, 1), rev0 = T.idleRev;
    const speedK = clamp(s.speed / 30, 0, 1);
    this.load = thr * (1 - speedK);
    let target = rev0 + (1 - rev0) * thr * (0.66 + 0.2 * speedK) - T.lug * this.load;   // loaded revs top out near 0.87: the limiter is only reached unloaded
    if (s.throttle < 0) target = rev0 + 0.25 * -s.throttle;
    if (s.boosting) target += 0.05;
    const air = s.wet <= 0.01 || s.airTime > 0.04;
    if (this.air && !air) this.bog = 1;                 // re-entry: the props bite and the engines bog
    this.air = air;
    this.bog *= Math.exp(-T.bogDecay * dt);
    if (air) target += (0.1 + T.flareRev * thr) * 1;    // unloaded: flare
    target -= T.bogDepth * this.bog * (0.4 + 0.6 * thr);
    target = clamp(target, 0.05, 1.08);
    const d = target - this.rev;
    const rate = d > 0 ? (air ? T.revFlare : T.revUp) : (this.bog > 0.05 ? T.revBog : T.revDown);
    this.rev += d * (1 - Math.exp(-rate * dt));
    return this;
  }
}

// a sawtooth-like exhaust pulse as a PeriodicWave: rich in harmonics, the even ones strong,
// phases differ per engine so the three do not peak together
function exhaustWave(ctx, k) {
  const N = 28, re = new Float32Array(N + 1), im = new Float32Array(N + 1);
  for (let h = 1; h <= N; h++) {
    const a = (1 / Math.pow(h, 1.15)) * (h % 2 === 0 ? 1.25 : 0.8) * (h === 1 ? 0.5 : 1);
    const ph = k * 0.9 + h * h * 0.37 * (k + 1);
    re[h] = a * Math.cos(ph); im[h] = a * Math.sin(ph);
  }
  return ctx.createPeriodicWave(re, im);
}

const mkGain = (ctx, v = 0) => { const g = ctx.createGain(); g.gain.value = v; return g; };
const mkFilter = (ctx, type, f, q = 0.7) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
const sat = (ctx) => {
  const sh = ctx.createWaveShaper(), n = 1024, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(1.8 * x) / Math.tanh(1.8); }
  sh.curve = c; return sh;
};
const to = (param, v, t, k) => param.setTargetAtTime(v, t, k);

export class PlayerEngine {
  constructor(ctx, dest) {
    this.ctx = ctx;
    this.model = new EngineModel();
    this.boostEnv = 0;
    this.t = -1;
    const T = TUNE, out = this.out = mkGain(ctx, 0);
    out.connect(dest);
    // exhaust: three detuned engines -> lowpass -> soft saturation -> burble AM
    this.mix = mkGain(ctx, 1);
    this.oscs = T.detune.map((r, k) => {
      const o = ctx.createOscillator();
      o.setPeriodicWave(exhaustWave(ctx, k));
      o.frequency.value = (T.fBase + T.fSpan * T.idleRev) * r;
      const g = mkGain(ctx, 0.34);
      o.connect(g).connect(this.mix);
      o.start(0);
      return o;
    });
    this.lp = mkFilter(ctx, 'lowpass', T.cutoffLo, 0.9);
    this.am = mkGain(ctx, 1);
    this.mix.connect(this.lp).connect(sat(ctx)).connect(this.am).connect(out);
    // idle burble: slow irregular amplitude modulation, deepest at rest
    this.mod = mkGain(ctx, 0);
    [5.3, 8.1, 3.1].forEach((f, i) => { const o = ctx.createOscillator(); o.frequency.value = f; const g = mkGain(ctx, [0.5, 0.35, 0.3][i]); o.connect(g).connect(this.mod); o.start(0); });
    this.mod.connect(this.am.gain);
    // intake rush
    const noise = noiseBuf(ctx, 4, 17);
    const src = (rate = 1, seed) => { const s = ctx.createBufferSource(); s.buffer = seed ? noiseBuf(ctx, 4, seed) : noise; s.loop = true; s.playbackRate.value = rate; s.start(0); return s; };
    this.intakeBP = mkFilter(ctx, 'bandpass', 1200, 0.7);
    this.intake = mkGain(ctx, 0);
    src(1).connect(this.intakeBP).connect(this.intake).connect(out);
    // whine at high revs
    this.whineOsc = ctx.createOscillator(); this.whineOsc.type = 'triangle'; this.whineOsc.frequency.value = 900;
    this.whineBP = mkFilter(ctx, 'bandpass', 1800, 2);
    this.whine = mkGain(ctx, 0);
    this.whineOsc.connect(this.whineBP).connect(this.whine).connect(out);
    this.whineOsc.start(0);
    // boost: a blower whistle that climbs and a broad roar
    this.boostOsc = ctx.createOscillator(); this.boostOsc.type = 'sawtooth'; this.boostOsc.frequency.value = 800;
    this.boostLP = mkFilter(ctx, 'lowpass', 2600, 0.6);
    this.boostTone = mkGain(ctx, 0);
    this.boostOut = mkGain(ctx, 1); this.boostOut.connect(dest);   // after the engine gain: boost is its own layer
    this.boostOsc.connect(this.boostLP).connect(this.boostTone).connect(this.boostOut);
    this.boostOsc.start(0);
    this.roarBP = mkFilter(ctx, 'bandpass', 700, 0.6);
    this.roar = mkGain(ctx, 0);
    src(0.8, 29).connect(this.roarBP).connect(this.roar).connect(this.boostOut);
  }

  // t: audio time (s). s: { throttle, speed, wet, airTime, boosting }
  update(t, s) {
    if (t - this.t < 1 / 60 && this.t >= 0) return;
    const dt = this.t < 0 ? 1 / 60 : t - this.t;
    this.t = t;
    const T = TUNE, m = this.model.step(dt, s), rev = m.rev, k = 0.035;
    const be = s.boosting ? 1 : 0;
    this.boostEnv += (be - this.boostEnv) * (1 - Math.exp(-dt / (be ? 0.12 : 0.4)));
    const bo = this.boostEnv;
    const f0 = T.fBase + T.fSpan * rev;
    this.oscs.forEach((o, i) => to(o.frequency, f0 * T.detune[i], t, k));
    to(this.lp.frequency, (T.cutoffLo + (T.cutoffHi - T.cutoffLo) * Math.pow(clamp(rev, 0, 1.1), 1.4)) * (1 - 0.18 * m.load) * (1 + 0.15 * bo), t, k);
    const depth = 0.6 * (1 - smooth(0.1, 0.34, rev)) + 0.12 * m.load;       // burble at rest, a little lugging growl
    to(this.am.gain, 1 - depth * 0.5, t, k);
    to(this.mod.gain, depth * 0.5, t, k);
    to(this.out.gain, T.gain * (0.5 + 0.5 * clamp(rev, 0, 1)) * (1 + 0.15 * bo), t, k);
    to(this.intakeBP.frequency, 900 + 3200 * rev, t, k);
    to(this.intake.gain, T.intakeGain * rev * rev * (m.air ? 1.3 : 1), t, k);
    to(this.whineOsc.frequency, 700 + 2800 * rev, t, k);
    to(this.whineBP.frequency, 900 + 2800 * rev, t, k);
    to(this.whine.gain, T.whineGain * smooth(0.55, 1, rev), t, k);
    to(this.boostOsc.frequency, 700 + 1500 * bo + 600 * rev, t, 0.05);
    to(this.boostTone.gain, T.boostGain * bo * 0.5, t, 0.04);
    to(this.roarBP.frequency, 380 + 1200 * bo, t, 0.05);
    to(this.roar.gain, T.boostGain * bo * 0.9, t, 0.04);
    this.rev = rev;
  }
}

// ---- rivals -------------------------------------------------------------------------------------

const SPEED_OF_SOUND = 343;

// What the listener (the camera) hears of a boat at pos moving with vel. cam: { pos, yaw };
// lvel: the listener's own velocity. Returns { gain, pan (-1 left .. 1 right), doppler, cutoff, dist }.
// The camera looks along (cos yaw, sin yaw) in (x, z); its right is (-sin yaw, cos yaw).
export function spatial(cam, pos, vel, lvel = [0, 0, 0]) {
  const dx = pos[0] - cam.pos[0], dy = pos[1] - cam.pos[1], dz = pos[2] - cam.pos[2];
  const d = Math.max(Math.hypot(dx, dy, dz), 1e-3), dh = Math.hypot(dx, dz);
  const lat = dh > 1e-3 ? (-Math.sin(cam.yaw) * dx + Math.cos(cam.yaw) * dz) / dh : 0;
  const pan = clamp(lat, -1, 1) * 0.92 * smooth(0, 10, dh);
  const vr = ((vel[0] - lvel[0]) * dx + (vel[1] - lvel[1]) * dy + (vel[2] - lvel[2]) * dz) / d;   // > 0: moving apart
  const doppler = clamp(SPEED_OF_SOUND / (SPEED_OF_SOUND + vr), 0.85, 1.2);
  const gain = (1 / (1 + Math.pow(d / 14, 1.5))) * (1 - smooth(250, 400, d));
  return { gain, pan, doppler, cutoff: clamp(7000 / (1 + d / 40), 700, 7000), dist: d };
}

// One cheaper voice for another player's boat: two detuned oscillators, a lowpass, a panner.
export class RivalEngine {
  constructor(ctx, dest) {
    this.ctx = ctx; this.model = new EngineModel(); this.t = -1; this.sp = null;
    const wave = exhaustWave(ctx, 1);
    this.oscs = [1, 1.011].map((r) => { const o = ctx.createOscillator(); o.setPeriodicWave(wave); o.frequency.value = 50 * r; o.start(0); return o; });
    this.lp = mkFilter(ctx, 'lowpass', 1500, 0.8);
    this.g = mkGain(ctx, 0);
    const mix = mkGain(ctx, 0.5);
    this.oscs.forEach((o) => o.connect(mix));
    this.pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    let n = mix.connect(this.lp).connect(sat(ctx)).connect(this.g);
    if (this.pan) n = n.connect(this.pan);
    n.connect(dest);
  }

  silence(t) { if (this.on !== false) { this.g.gain.setTargetAtTime(0, t, 0.06); this.on = false; } }

  // pose: a Boat (pos, vel, throttle, wet, airTime, speed). cam and lvel as for spatial(); present: false silences it.
  update(t, pose, cam, lvel, present = true) {
    if (t - this.t < 1 / 40 && this.t >= 0) return;
    const dt = this.t < 0 ? 1 / 40 : t - this.t;
    this.t = t;
    const speed = pose.speed ?? Math.hypot(pose.vel[0], pose.vel[2]);
    const m = this.model.step(dt, { throttle: Math.max(pose.throttle || 0, clamp(speed / 34, 0, 1)), speed, wet: pose.wet ?? 1, airTime: pose.airTime || 0, boosting: pose.boosting });
    const sp = spatial(cam, pose.pos, pose.vel, lvel), k = 0.05;
    const f0 = (TUNE.fBase + TUNE.fSpan * m.rev) * sp.doppler;
    this.oscs[0].frequency.setTargetAtTime(f0, t, k);
    this.oscs[1].frequency.setTargetAtTime(f0 * 1.011, t, k);
    to(this.lp.frequency, Math.min(sp.cutoff, TUNE.cutoffLo + 3000 * m.rev) , t, k);
    to(this.g.gain, present ? TUNE.rivalGain * sp.gain * (0.5 + 0.5 * m.rev) : 0, t, 0.06);
    if (this.pan) to(this.pan.pan, sp.pan, t, 0.06);
    this.sp = sp; this.rev = m.rev; this.on = present;
  }
}
