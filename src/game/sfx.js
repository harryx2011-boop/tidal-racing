// Race sound effects and the system that drives all the game's synthesized sound.
//   Sfx        one-shots: countdown beeps, start tone, gate tick, lap and finish fanfares, collision
//              thud, missed-gate warning, hull slap on landing. Each takes the audio time to start at.
//   WashVoice  the hiss and rush of water along the hull, rising with speed
//   GameSound  the game system (registered in game.js): reads the boat, the race and the rivals every
//              frame and drives PlayerEngine, RivalEngine, WashVoice and Sfx. It is built on the live
//              engine's graph the first time the audio context exists.
// Sfx, WashVoice and makeBuses work on any AudioContext, so tools/check-sound.mjs renders them offline.
import { settings } from './settings.js';
import { PlayerEngine, RivalEngine, noiseBuf } from './enginesound.js';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const LEVEL = { sfx: 0.5, wash: 0.5 };   // the owner's dials for effect loudness (before the effects volume setting)
const vgain = (v) => (v * v) / 0.64;            // volume slider (0..1) to gain: the default 0.8 is unity

// Two buses (engine, effects), each volume then a gate that closes when paused, hidden or in the menu.
export function makeBuses(ctx, dest) {
  const mk = (v) => { const vol = ctx.createGain(), gate = ctx.createGain(); vol.gain.value = v; gate.gain.value = 1; gate.connect(vol).connect(dest); return { vol, gate }; };
  const e = mk(1), s = mk(1);
  return { engineIn: e.gate, engineVol: e.vol, engineGate: e.gate, sfxIn: s.gate, sfxVol: s.vol, sfxGate: s.gate };
}

export class Sfx {
  constructor(ctx, dest) { this.ctx = ctx; this.dest = dest; this.noise = noiseBuf(ctx, 1.2, 77); this.last = {}; }

  // gain envelope that starts and ends at zero: no clicks
  env(g, at, peak, attack, dur) {
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + attack);
    g.gain.exponentialRampToValueAtTime(Math.max(peak * 0.001, 1e-5), at + dur);
    g.gain.linearRampToValueAtTime(0, at + dur + 0.02);
  }

  tone(at, freq, dur, vol, type = 'sine', { toFreq = 0, lp = 0, attack = 0.006, pan = 0 } = {}) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, at);
    if (toFreq) o.frequency.exponentialRampToValueAtTime(toFreq, at + dur);
    this.env(g, at, vol * LEVEL.sfx, attack, dur);
    let n = o.connect(g);
    if (lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; n = n.connect(f); }
    n.connect(this.dest);
    o.start(at); o.stop(at + dur + 0.05);
  }

  burst(at, dur, vol, f0, f1, type = 'lowpass', q = 0.7) {
    const ctx = this.ctx, s = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    s.buffer = this.noise; s.playbackRate.value = 0.9 + Math.random() * 0.2;
    f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, at); f.frequency.exponentialRampToValueAtTime(f1, at + dur);
    this.env(g, at, vol * LEVEL.sfx, 0.004, dur);
    s.connect(f).connect(g).connect(this.dest);
    s.start(at, Math.random() * 0.4); s.stop(at + dur + 0.05);
  }

  // not twice within `gap` seconds (contact fires every step while the hull scrapes)
  ok(name, at, gap) { if (at - (this.last[name] ?? -9) < gap) return false; this.last[name] = at; return true; }

  beep(at) { this.tone(at, 880, 0.16, 0.5, 'sine'); this.tone(at, 1760, 0.12, 0.08, 'sine'); }
  go(at) { this.tone(at, 1320, 0.55, 0.55, 'sine'); this.tone(at, 1320 * 2, 0.4, 0.1, 'triangle'); this.tone(at, 660, 0.5, 0.2, 'triangle', { lp: 1800 }); }
  tick(at) { this.tone(at, 1900, 0.07, 0.35, 'sine'); this.tone(at, 2850, 0.05, 0.12, 'sine'); }
  // short fanfares: a rising arpeggio, a bell-like voice (triangle plus a lowpassed square)
  lap(at) { [523.25, 659.25, 783.99].forEach((f, i) => this.note(at + i * 0.1, f, i === 2 ? 0.3 : 0.12)); }
  finish(at) { [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5].forEach((f, i) => this.note(at + i * 0.11, f, i === 5 ? 0.6 : 0.13)); }
  note(at, f, dur) { this.tone(at, f, dur + 0.1, 0.35, 'triangle'); this.tone(at, f * 2, dur + 0.05, 0.08, 'square', { lp: 2400 }); }
  warn(at) { this.tone(at, 392, 0.14, 0.22, 'sine'); this.tone(at + 0.16, 294, 0.22, 0.22, 'sine'); }
  // a hit on something solid. strength 0..1
  thud(at, strength = 0.5) {
    if (!this.ok('thud', at, 0.15)) return;
    const s = clamp(strength, 0, 1);
    this.tone(at, 140, 0.22, 0.25 + 0.7 * s, 'sine', { toFreq: 42 });
    this.burst(at, 0.14 + 0.12 * s, 0.15 + 0.5 * s, 900 + 900 * s, 160, 'lowpass');
  }
  // the hull coming down on the water after airtime. strength 0..1
  slap(at, strength = 0.5) {
    if (!this.ok('slap', at, 0.2)) return;
    const s = clamp(strength, 0, 1);
    this.burst(at, 0.2 + 0.25 * s, 0.12 + 0.65 * s, 1200 + 3800 * s, 250, 'lowpass', 0.8);
    this.tone(at, 120 + 30 * s, 0.2 + 0.15 * s, 0.1 + 0.55 * s, 'sine', { toFreq: 45 });
    this.burst(at + 0.03, 0.45 + 0.4 * s, (0.05 + 0.2 * s), 3000 + 2000 * s, 1200, 'bandpass', 0.6);   // the spray that follows
  }
}

// Water along the hull: broadband hiss and a low rush, both rising with speed, falling away in the air.
export class WashVoice {
  constructor(ctx, dest) {
    this.ctx = ctx; this.t = -1; this.level = 0;
    const mk = (seed, rate) => { const s = ctx.createBufferSource(); s.buffer = noiseBuf(ctx, 4, seed); s.loop = true; s.playbackRate.value = rate; s.start(0); return s; };
    const f = (type, hz, q = 0.7) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = hz; b.Q.value = q; return b; };
    this.hissBP = f('bandpass', 2500, 0.5);
    this.hiss = ctx.createGain(); this.hiss.gain.value = 0;
    mk(41, 1).connect(f('highpass', 900)).connect(this.hissBP).connect(this.hiss).connect(dest);
    this.rushLP = f('lowpass', 300, 0.5);
    this.rush = ctx.createGain(); this.rush.gain.value = 0;
    mk(43, 0.6).connect(this.rushLP).connect(this.rush).connect(dest);
  }

  update(t, speed, wet) {
    if (t - this.t < 1 / 30 && this.t >= 0) return;
    const dt = this.t < 0 ? 1 / 30 : t - this.t;
    this.t = t;
    const sp = clamp(speed / 40, 0, 1), w = clamp(wet, 0, 1);
    this.level += (Math.min(1, 0.2 + w * 1.2) * (wet > 0.01 ? 1 : 0) - this.level) * (1 - Math.exp(-dt / (wet > 0.01 ? 0.15 : 0.35)));
    const L = LEVEL.wash * this.level;
    this.hiss.gain.setTargetAtTime(0.14 * Math.pow(sp, 1.3) * L, t, 0.08);
    this.hissBP.frequency.setTargetAtTime(1800 + 3600 * sp, t, 0.08);
    this.rush.gain.setTargetAtTime(0.30 * Math.pow(sp, 1.1) * L, t, 0.1);
    this.rushLP.frequency.setTargetAtTime(220 + 500 * sp, t, 0.1);
  }
}

// ---- the game system ----------------------------------------------------------------------------

export class GameSound {
  constructor(game) {
    this.game = game;
    game.sound = this;
    this.ready = false;
    this.maxRivals = 3;
    this.prev = { count: 0, state: game.state, next: 0, laps: 0, lastAir: 0, missed: 0, progress: null };
    // paused or a hidden tab: close the gates. (update() is not called while paused, so this runs on its own clock.)
    this.quiet = false;
    this.watch = () => this.applyGates();
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.watch);
      setInterval(this.watch, 150);
    }
  }

  // build on the live engine's graph once it exists (the first user gesture)
  build() {
    const a = this.game.audio, e = a && a.engine;
    if (!e || !e.ctx || !e.bus) return false;
    const ctx = this.ctx = e.ctx;
    this.buses = makeBuses(ctx, e.bus);
    this.engine = new PlayerEngine(ctx, this.buses.engineIn);
    this.wash = new WashVoice(ctx, this.buses.sfxIn);
    this.sfx = new Sfx(ctx, this.buses.sfxIn);
    this.rivalBus = ctx.createGain(); this.rivalBus.connect(this.buses.engineIn);
    this.rivals = Array.from({ length: this.maxRivals }, () => new RivalEngine(ctx, this.rivalBus));
    this.ready = true;
    this.applyGates();
    return true;
  }

  applyGates() {
    if (!this.ready) return;
    const g = this.game, t = this.ctx.currentTime;
    const quiet = (typeof document !== 'undefined' && document.hidden) || g.paused;
    const menu = g.state === 'menu';
    this.buses.sfxGate.gain.setTargetAtTime(quiet ? 0 : 1, t, 0.04);
    this.buses.engineGate.gain.setTargetAtTime(quiet || menu ? 0 : 1, t, menu ? 0.25 : 0.04);
    this.buses.engineVol.gain.setTargetAtTime(vgain(settings.engineVol), t, 0.05);
    this.buses.sfxVol.gain.setTargetAtTime(vgain(settings.sfxVol), t, 0.05);
  }

  // the collision code calls this with the closing speed scaled to 0..1
  hit(strength = 0.5) {
    if (!this.ready || this.ctx.state !== 'running') return;
    this.sfx.thud(this.ctx.currentTime + 0.005, strength);
  }

  update(dt, ot) {
    if (!this.ready && !this.build()) return;
    const ctx = this.ctx, g = this.game, boat = g.boat, p = this.prev;
    if (ctx.state !== 'running') { p.state = g.state; return; }   // muted: nothing is queued for later
    this.applyGates();
    const t = ctx.currentTime, at = t + 0.01;
    const P = g.progress;

    // race cues
    if (g.state === 'countdown') {
      const left = g.t0 - g.app.time, c = left > 3 ? 0 : Math.ceil(left);
      if (c !== p.count && c >= 1) this.sfx.beep(at);
      p.count = c;
    } else p.count = 0;
    if (g.state === 'racing' && p.state === 'countdown') this.sfx.go(at);
    if (P !== p.progress) { p.progress = P; p.next = P.next; p.laps = g.laps ? g.laps.length : 0; p.missed = 0; }
    if (P.next > p.next && g.state !== 'menu') {
      if (g.state === 'finished') this.sfx.finish(at);
      else if (g.laps && g.laps.length > p.laps) this.sfx.lap(at);
      else this.sfx.tick(at);
    }
    p.next = P.next; p.laps = g.laps ? g.laps.length : 0;
    if (P.missed > 3.5 && p.missed <= 3.5 && g.state === 'racing') this.sfx.warn(at);
    p.missed = P.missed; p.state = g.state;

    // landing: boat.lastAir changes when the hull comes down after more than a quarter second in the air
    if (boat.lastAir !== p.lastAir) {
      if (boat.lastAir > 0.25) this.sfx.slap(at, clamp(0.2 + boat.slam / 0.12 * 0.6 + boat.lastAir * 0.25, 0, 1));
      p.lastAir = boat.lastAir;
    }

    // the player's engine and water
    const menu = g.state === 'menu';
    this.engine.update(t, { throttle: boat.throttle, speed: menu ? 0 : boat.speed, wet: boat.wet, airTime: boat.airTime, boosting: boat.boosting });
    this.wash.update(t, menu ? 0 : boat.speed, boat.wet);

    // rivals (the ghost is never in this list)
    const cam = g.app.cam, lvel = boat.vel, list = g.rivals || [];
    for (let i = 0; i < this.rivals.length; i++) {
      if (list[i] && !menu) this.rivals[i].update(t, list[i].pose, cam, lvel, true); else this.rivals[i].silence(t);
    }
  }
}
