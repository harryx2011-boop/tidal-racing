// Offline sound check. Renders the game's synthesized sound on an OfflineAudioContext in headless
// Chromium for scripted states, measures the result and exits non-zero on failure. Nobody listens
// here: this proves the signal is sane (not silent, finite, not clipping, no clicks, the spectrum
// and the stereo image move the right way), not that it sounds good. The clips are written as WAVs
// for the owner to listen to later.
//   PORT=5187 node tools/serve.mjs &
//   flock /tmp/tidal-shot-2.lock node tools/check-sound.mjs      (PORT=5187 by default)
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { EngineModel, spatial, TUNE } from '../src/game/enginesound.js';
const require = createRequire('/usr/lib/node_modules/');
let pw; try { pw = require('playwright'); } catch { pw = (await import('playwright')).default; }
const PORT = process.env.PORT || 5187;
const OUT = process.env.SOUND_OUT || '/tmp/claude-0/-home-user-tidal-racing/a31e5a31-6cd0-5b81-a9f4-b9e9d9bad626/scratchpad/review3/sound';
mkdirSync(OUT, { recursive: true });
const SR = 44100;

// ---- page side: build the graph on an OfflineAudioContext and render a scripted scenario ----------
async function pageRender([name, bare, sr]) {
  const withSea = !bare;
  const { AudioEngine } = await import('/src/audio/audio.js');
  const { PlayerEngine, RivalEngine } = await import('/src/game/enginesound.js');
  const { Sfx, WashVoice, makeBuses } = await import('/src/game/sfx.js');
  const S = (thr, speed, wet = 0.5, airTime = 0, boosting = false) => ({ throttle: thr, speed, wet, airTime, boosting });
  const sc = {
    idle: { dur: 4, p: () => S(0, 0, 1) },
    cruise: { dur: 4, p: () => S(0.5, 16, 0.5) },
    full: { dur: 4, p: () => S(1, 36, 0.5) },
    air: { dur: 5, p: (t) => (t >= 1.5 && t < 2.5 ? S(1, 36, 0, t - 1.5) : S(1, 36, 0.5)), fx: [[2.5, 'slap', 0.8]] },
    boost: { dur: 5, p: (t) => S(1, t >= 1.5 && t < 3.5 ? 42 : 36, 0.5, 0, t >= 1.5 && t < 3.5) },
    cues: { dur: 5, p: null, fx: [[0.2, 'beep'], [1.2, 'beep'], [2.2, 'beep'], [3.2, 'go'], [4.0, 'tick'], [4.5, 'warn'], [5.0, 'lap'], [5.8, 'finish'], [7.2, 'thud', 0.8], [7.7, 'thud', 0.2]], dur2: 9 },
    rival: { dur: 3.5, p: null, rival: (t) => ({ pos: [15, 0.3, -60 + 40 * t], vel: [0, 0, 40], speed: 40, throttle: 1, wet: 1, airTime: 0 }) },
    sea: { dur: 4, p: null },
    flare: { dur: 4, p: () => S(1, 36, 0, 3) },        // steady references for the click checks: props out of the water, and boosting
    boosted: { dur: 4, p: () => S(1, 42, 0.5, 0, true) },
    sweep: { dur: 8, p: (t) => { const k = t < 3 ? t / 3 : t < 5 ? 1 : Math.max(1 - (t - 5) / 2, 0); return S(k, 40 * k, 0.5 + 0.5 * (1 - k)); } },   // throttle up, hold, off
  }[name];
  const dur = sc.dur2 || sc.dur;
  const ctx = new OfflineAudioContext(2, Math.ceil(dur * sr), sr);
  const eng = new AudioEngine();
  eng.volume = 0.9;
  if (withSea) {
    eng.params = { wind: 10, rain: 0, foam: 0.02, hs: 2.5, tp: (2 * Math.PI * 10) / (0.855 * 9.81), flash: 0 };
    await eng.init(ctx);
    for (let t = 0; t < dur; t += 0.05) eng.apply(t, eng.params, 0.08);
  } else {
    // the real output chain without the sea: master gain and compressor
    const out = ctx.createDynamicsCompressor();
    out.threshold.value = -14; out.knee.value = 12; out.ratio.value = 3; out.attack.value = 0.01; out.release.value = 0.4;
    eng.master = ctx.createGain(); eng.master.gain.value = 0.9; eng.master.connect(out).connect(ctx.destination);
    eng.bus = ctx.createGain(); eng.bus.connect(eng.master);
  }
  const buses = makeBuses(ctx, eng.bus);
  const sfx = new Sfx(ctx, buses.sfxIn);
  if (sc.p) {
    const pe = new PlayerEngine(ctx, buses.engineIn), wash = new WashVoice(ctx, buses.sfxIn);
    for (let t = 0; t < dur; t += 1 / 60) { const s = sc.p(t); pe.update(t, s); if (!bare) wash.update(t, s.speed, s.wet); }
  }
  if (sc.rival) {
    const re = new RivalEngine(ctx, buses.engineIn), cam = { pos: [0, 1, 0], yaw: 0 };
    for (let t = 0; t < dur; t += 1 / 60) re.update(t, sc.rival(t), cam, [0, 0, 0], true);
  }
  if (!bare || name === 'cues') for (const [at, kind, v] of sc.fx || []) sfx[kind](at, v);
  const buf = await ctx.startRendering();
  const b64 = (a) => { const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); let s = ''; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); return btoa(s); };
  return { L: b64(buf.getChannelData(0)), R: b64(buf.getChannelData(1)), sr };
}

// ---- analysis -----------------------------------------------------------------------------------
const f32 = (b64) => { const b = Buffer.from(b64, 'base64'); return new Float32Array(b.buffer, b.byteOffset, b.length / 4); };

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k], vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

// spectral centroid (Hz) of x over [t0, t1) s: mean of Hann-windowed 4096-point spectra
function centroid(x, sr, t0, t1) {
  const N = 4096, re = new Float64Array(N), im = new Float64Array(N);
  let num = 0, den = 0;
  for (let s = Math.floor(t0 * sr); s + N <= Math.floor(t1 * sr); s += N / 2) {
    for (let i = 0; i < N; i++) { re[i] = x[s + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N)); im[i] = 0; }
    fft(re, im);
    for (let k = 1; k < N / 2; k++) { const m = Math.hypot(re[k], im[k]); num += m * k * sr / N; den += m; }
  }
  return den > 0 ? num / den : 0;
}

const rmsOf = (x, sr, t0, t1) => { let s = 0, n = 0; for (let i = Math.floor(t0 * sr); i < Math.min(x.length, Math.floor(t1 * sr)); i++) { s += x[i] * x[i]; n++; } return Math.sqrt(s / Math.max(n, 1)); };

// clicks: the largest sample-to-sample step, absolute, and relative to the local step size (10 ms blocks around it).
// A gain jump or a parameter snap shows up as a step far above its neighbourhood.
function clicks(x, sr, t0 = 0, t1 = x.length / sr) {
  const B = Math.round(sr * 0.01), i0 = Math.floor(t0 * sr), i1 = Math.min(x.length, Math.floor(t1 * sr));
  const nb = Math.floor((i1 - i0) / B), br = new Float64Array(nb);
  let maxAbs = 0;
  for (let b = 0; b < nb; b++) { let s = 0; for (let i = i0 + b * B + 1; i < i0 + (b + 1) * B; i++) { const d = x[i] - x[i - 1]; s += d * d; if (Math.abs(d) > maxAbs) maxAbs = Math.abs(d); } br[b] = Math.sqrt(s / B); }
  let worst = 0;
  for (let b = 2; b < nb - 2; b++) {
    const local = (br[b - 2] + br[b - 1] + br[b + 1] + br[b + 2]) / 4 + 1e-6;
    let m = 0; for (let i = i0 + b * B + 1; i < i0 + (b + 1) * B; i++) m = Math.max(m, Math.abs(x[i] - x[i - 1]));
    worst = Math.max(worst, m / local);
  }
  return { maxAbs, ratio: worst };
}

function stats(c) {
  const { L, R, sr } = c;
  let peak = 0, bad = 0;
  for (const ch of [L, R]) for (let i = 0; i < ch.length; i++) { const v = ch[i]; if (!Number.isFinite(v)) bad++; else if (Math.abs(v) > peak) peak = Math.abs(v); }
  const mono = new Float32Array(L.length); for (let i = 0; i < L.length; i++) mono[i] = (L[i] + R[i]) / 2;
  return { peak, bad, mono, rms: rmsOf(mono, sr, 0, L.length / sr) };
}

function wav(c, path) {
  const n = c.L.length, o = Buffer.alloc(44 + n * 4);
  o.write('RIFF', 0); o.writeUInt32LE(36 + n * 4, 4); o.write('WAVEfmt ', 8); o.writeUInt32LE(16, 16); o.writeUInt16LE(1, 20); o.writeUInt16LE(2, 22);
  o.writeUInt32LE(c.sr, 24); o.writeUInt32LE(c.sr * 4, 28); o.writeUInt16LE(4, 32); o.writeUInt16LE(16, 34); o.write('data', 36); o.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) { o.writeInt16LE(Math.round(Math.max(-1, Math.min(1, c.L[i])) * 32767), 44 + i * 4); o.writeInt16LE(Math.round(Math.max(-1, Math.min(1, c.R[i])) * 32767), 46 + i * 4); }
  writeFileSync(path, o);
}

// ---- checks -------------------------------------------------------------------------------------
let failed = 0;
const check = (ok, msg, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}${detail ? '   ' + detail : ''}`); if (!ok) failed++; };
const n2 = (x) => (+x).toFixed(3);

// the model and the spatial maths need no browser
{
  const run = (script, dur) => { const m = new EngineModel(), out = []; for (let t = 0; t < dur; t += 1 / 60) { m.step(1 / 60, script(t)); out.push({ t, rev: m.rev }); } return out; };
  const at = (o, t) => o.find((x) => x.t >= t).rev;
  const air = run((t) => (t >= 2 && t < 3 ? { throttle: 1, speed: 36, wet: 0, airTime: t - 2, boosting: false } : { throttle: 1, speed: 36, wet: 0.5, airTime: 0, boosting: false }), 5);
  const before = at(air, 1.95), flare = at(air, 2.9), bog = at(air, 3.25), later = at(air, 4.8);
  check(flare > before + 0.04, 'model: revs flare when the props leave the water', `before ${n2(before)} air ${n2(flare)}`);
  check(bog < before - 0.02, 'model: revs bog briefly on re-entry', `before ${n2(before)} 0.25 s after landing ${n2(bog)}`);
  check(Math.abs(later - before) < 0.03, 'model: revs recover after the bog', `${n2(later)}`);
  const start = run(() => ({ throttle: 1, speed: 0, wet: 1, airTime: 0, boosting: false }), 1.5);
  check(at(start, 0.5) > 0.4 && at(start, 0.5) < 0.9, 'model: revs rise quickly with throttle but load holds them down at a standing start', `${n2(at(start, 0.5))}`);
  const rise = run((t) => ({ throttle: 1, speed: Math.min(t * 9, 36), wet: 0.5, airTime: 0, boosting: false }), 5);
  check(at(rise, 4.5) > at(rise, 0.7) + 0.1, 'model: revs climb as the hull gathers speed', `${n2(at(rise, 0.7))} -> ${n2(at(rise, 4.5))}`);
  const cam = { pos: [0, 1, 0], yaw: 0 };
  const a = spatial(cam, [15, 0, -60], [0, 0, 40]), b = spatial(cam, [15, 0, 60], [0, 0, 40]);
  check(a.pan < -0.5 && b.pan > 0.5, 'spatial: pan is left then right for a boat crossing left to right', `${n2(a.pan)} -> ${n2(b.pan)}`);
  check(a.doppler > 1 && b.doppler < 1, 'spatial: pitch up when approaching, down when receding', `${n2(a.doppler)} -> ${n2(b.doppler)}`);
  check(spatial(cam, [20, 0, 0], [0, 0, 0]).gain > spatial(cam, [200, 0, 0], [0, 0, 0]).gain * 3 && spatial(cam, [500, 0, 0], [0, 0, 0]).gain === 0, 'spatial: gain falls with distance and is zero beyond 400 m');
}

const browser = await pw.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
page.on('pageerror', (e) => { console.log('pageerror', e.message); failed++; });
await page.goto(`http://localhost:${PORT}/tools/check-sound.html`, { waitUntil: 'load' });
const clip = {};
const render = async (name, bare) => {
  const key = name + (bare ? '-engine' : '');
  const c = await page.evaluate(pageRender, [name, bare, SR]);
  clip[key] = { L: f32(c.L), R: f32(c.R), sr: c.sr };
  wav(clip[key], `${OUT}/${key}.wav`);
  return clip[key];
};
// mix: sea and wind + engine + water + effects, through the live output chain. bare: the engine voice alone.
for (const n of ['sea', 'idle', 'cruise', 'full', 'air', 'boost', 'cues']) await render(n, false);
for (const n of ['idle', 'cruise', 'full', 'air', 'boost', 'sweep', 'rival', 'flare', 'boosted']) await render(n, true);
await browser.close();

console.log('--- levels');
const seaRms = stats(clip.sea).rms;
const bands = { idle: [1, 7], cruise: [2, 9], full: [3, 11], air: [2, 11], boost: [3, 12], cues: [0.8, 10] };   // mix RMS relative to the sea alone
console.log(`sea alone: rms ${n2(seaRms)}`);
for (const [n, [lo, hi]] of Object.entries(bands)) {
  const s = stats(clip[n]);
  check(s.bad === 0, `${n}: every sample finite`);
  check(s.peak > 0.02, `${n}: not silent`, `peak ${n2(s.peak)}`);
  check(s.peak < 0.98, `${n}: peak below clipping`, `peak ${n2(s.peak)}`);
  const ratio = s.rms / seaRms;
  check(ratio >= lo && ratio <= hi, `${n}: rms within ${lo}..${hi} x the sea`, `rms ${n2(s.rms)} = ${n2(ratio)} x sea`);
}
for (const n of ['idle', 'cruise', 'full', 'air', 'boost', 'sweep', 'rival']) {
  const s = stats(clip[n + '-engine']);
  check(s.bad === 0 && s.peak > 0.02 && s.peak < 0.98, `${n} (engine only): finite, audible, below clipping`, `peak ${n2(s.peak)} rms ${n2(s.rms)}`);
}
{
  const e = (n) => stats(clip[n + '-engine']).rms;
  check(e('full') > e('idle') * 1.5, 'engine is louder at full throttle than at idle', `${n2(e('idle'))} -> ${n2(e('full'))}`);
  check(stats(clip.full).rms > seaRms * 1.5, 'at full throttle the engine stands clear of the sea and wind', `${n2(stats(clip.full).rms / seaRms)} x`);
}

console.log('--- spectrum');
{
  const c = (n) => centroid(stats(clip[n + '-engine']).mono, SR, 2, 4);
  const ci = c('idle'), cc = c('cruise'), cf = c('full');
  check(ci < cc && cc < cf, 'spectral centroid rises with revs (idle < cruise < full)', `${ci.toFixed(0)} < ${cc.toFixed(0)} < ${cf.toFixed(0)} Hz`);
  check(cf > ci * 1.6, 'and by a clear margin', `x${(cf / ci).toFixed(2)}`);
  const air = stats(clip['air-engine']).mono, pre = centroid(air, SR, 1.0, 1.45), inAir = centroid(air, SR, 2.1, 2.45), bog = centroid(air, SR, 2.62, 2.9);
  check(inAir > pre * 1.03, 'centroid rises while the props are out of the water (flare)', `${pre.toFixed(0)} -> ${inAir.toFixed(0)} Hz`);
  check(bog < inAir, 'and falls again in the bog after landing', `${inAir.toFixed(0)} -> ${bog.toFixed(0)} Hz`);
  const bo = stats(clip['boost-engine']).mono, b0 = rmsOf(bo, SR, 1.0, 1.4), b1 = rmsOf(bo, SR, 2.5, 3.0);
  check(b1 > b0 * 1.25, 'the boost layer raises the level', `${n2(b0)} -> ${n2(b1)}`);
  check(centroid(bo, SR, 2.5, 3.0) !== centroid(bo, SR, 1.0, 1.4), 'and changes the spectrum', `${centroid(bo, SR, 1.0, 1.4).toFixed(0)} -> ${centroid(bo, SR, 2.5, 3.0).toFixed(0)} Hz`);
}

console.log('--- stereo and doppler');
{
  const c = clip['rival-engine'], bal = (t0, t1) => { const l = rmsOf(c.L, SR, t0, t1), r = rmsOf(c.R, SR, t0, t1); return (r - l) / (r + l + 1e-9); };
  const early = bal(0.2, 0.8), late = bal(2.4, 3.2);
  check(early < -0.3 && late > 0.3, 'a rival passing left to right moves from the left channel to the right', `balance ${n2(early)} -> ${n2(late)}`);
  const lv = (t0, t1) => rmsOf(c.L, SR, t0, t1) + rmsOf(c.R, SR, t0, t1);
  check(lv(1.3, 1.7) > lv(0.2, 0.6) * 1.5 && lv(1.3, 1.7) > lv(2.9, 3.4) * 1.5, 'it is loudest as it passes and quiet at both ends');
  const m = stats(c).mono, ce = centroid(m, SR, 0.7, 1.1), cl = centroid(m, SR, 1.9, 2.3);
  check(ce > cl * 1.08, 'doppler: the pitch is higher approaching than receding', `${ce.toFixed(0)} -> ${cl.toFixed(0)} Hz`);
}

console.log('--- clicks');
{
  // The engine's own waveform has large sample steps (a harsh exhaust pulse, bigger when the revs and the filter
  // are high), so a click is judged against steady renders of the states either side of a change: the largest
  // sample-to-sample step in a window with parameters moving must not exceed the largest step of the steady
  // states by more than 25 %.
  const step = (x, t0, t1) => { let m = 0; for (let i = Math.floor(t0 * SR) + 1; i < Math.floor(t1 * SR); i++) m = Math.max(m, Math.abs(x[i] - x[i - 1])); return m; };
  const E = (n) => stats(clip[n + '-engine']).mono;
  const ref = step(E('full'), 1.5, 4), refFlare = step(E('flare'), 1.5, 4), refBoost = step(E('boosted'), 1.5, 4), LIM = 1.25;
  console.log(`steady references: loaded ${n2(ref)}, props out ${n2(refFlare)}, boosting ${n2(refBoost)}`);
  const hurt = E('full').slice(); for (let i = Math.floor(2.5 * SR); i < Math.floor(2.5 * SR) + 400; i++) hurt[i] += 0.25;
  check(step(hurt, 1.5, 4) > ref * LIM, 'self-test: the detector flags an injected step of 0.25', `${n2(step(hurt, 1.5, 4))} vs limit ${n2(ref * LIM)}`);
  const air = E('air'), bo = E('boost'), sw = E('sweep'), ri = E('rival');
  const lA = Math.max(ref, refFlare) * LIM;
  check(step(air, 1.4, 3.4) < lA, 'air: no click at take-off, in the flare or on re-entry', `${n2(step(air, 1.4, 3.4))} (limit ${n2(lA)})`);
  const lB = Math.max(ref, refBoost) * LIM;
  check(step(bo, 1.3, 4.2) < lB, 'boost: no click as the layer comes in and goes out', `${n2(step(bo, 1.3, 4.2))} (limit ${n2(lB)})`);
  check(step(sw, 0.2, 8) < Math.max(ref, refFlare) * LIM, 'throttle sweep idle -> full -> off: no zipper in pitch or filter', `${n2(step(sw, 0.2, 8))} (limit ${n2(ref * LIM)})`);
  check(step(E('idle'), 0.5, 4) < ref * LIM, 'idle burble: no clicks', `${n2(step(E('idle'), 0.5, 4))}`);
  check(step(ri, 0.2, 3.3) < ref * LIM, 'rival pass: no clicks (pan, doppler and gain are smoothed)', `${n2(step(ri, 0.2, 3.3))}`);
  const cu = stats(clip.cues).mono;
  check(step(cu, 0, 9) < 0.6, 'cues: no step above 0.6 anywhere (beeps and fanfares start and end at zero)', `${n2(step(cu, 0, 9))}`);
}

console.log('--- event sounds');
{
  const a = stats(clip.air).mono;
  check(rmsOf(a, SR, 2.5, 2.6) > rmsOf(a, SR, 1.0, 1.1) * 1.3, 'the hull slap is audible over the engine on landing', `${n2(rmsOf(a, SR, 1.0, 1.1))} -> ${n2(rmsOf(a, SR, 2.5, 2.6))}`);
  const cu = stats(clip.cues).mono;
  const ev = [[0.2, 'beep'], [1.2, 'beep'], [2.2, 'beep'], [3.2, 'go'], [4.0, 'tick'], [4.5, 'warn'], [5.0, 'lap'], [5.8, 'finish'], [7.2, 'thud'], [7.7, 'thud']];
  for (const [t, k] of ev) check(rmsOf(cu, SR, t + 0.01, t + 0.11) > 0.01, `cue "${k}" at ${t} s is audible`, `rms ${n2(rmsOf(cu, SR, t + 0.01, t + 0.11))}`);
  check(rmsOf(cu, SR, 7.2, 7.3) > rmsOf(cu, SR, 7.7, 7.8) * 1.5, 'a hard collision is louder than a soft one');
}

console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed');
console.log(`clips written to ${OUT}`);
process.exit(failed ? 1 : 0);
