// Headless smoke test: boots the game in Chromium and drives a lap of every course.
//   flock /tmp/tidal-shot-2.lock node tools/smoke.mjs        (the shared render queue: at most two browsers)
// By default a short segment of each course (start and the first gates); --full (or SMOKE_FULL=1) races a lap of
// each (a circuit's first lap), or every lap with SMOKE_FULL=1 and SMOKE_ALL=1. A wall-clock limit per course fails the run.
// For each course it starts a race with a fixed seed, runs the autopilot for a full lap with T.sim (the sea and
// the game, no drawing), then renders two frames, and checks:
//   - no page errors, no console errors, no shader compile or link failures, no failed requests, no GL errors
//   - the race reaches `finished` (a circuit: the first lap is counted, see SMOKE_FULL)
//   - no solid was hit hard, the hull never aground, the boat never leaves the water for land
//   - the frames are not blank
// The game is served from the sub-path /tidal-racing/ by a server this script starts itself (BASE in
// tools/serve.mjs), so absolute URLs that would break on GitHub Pages fail here. Exit status is non-zero on failure.
// Environment: SMOKE_URL (use a running server, e.g. http://localhost:5188/), SMOKE_COURSES=circuit,oval,
// SMOKE_FULL=1 (race every lap to the finish), SMOKE_Q=low|medium (default low), SMOKE_JSON=path (write results).
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const require = createRequire('/usr/lib/node_modules/');
let pw; try { pw = require('playwright'); } catch { pw = (await import('playwright')).default; }
const { chromium } = pw;

const root = join(fileURLToPath(import.meta.url), '..', '..');
const COURSES = (process.env.SMOKE_COURSES || 'circuit,sprint,oval').split(',');
const FULL = !!process.env.SMOKE_FULL || process.argv.includes('--full');
const WALL = Number(process.env.SMOKE_WALL || (FULL ? 1800 : 240)) * 1000;   // per course, wall clock: fail loudly rather than hang
const SEGMENT_GATES = 4;    // the default run: start, then pass gates 0 to 3 (about 20 to 30 s of racing)
const Q = process.env.SMOKE_Q || 'low';
const SEED = 20241120;
const HIT_SPEED = 8;        // m/s: a solid touched faster than this is a hard hit
const BASE = '/tidal-racing/';
const failures = [];
const fail = (m) => { failures.push(m); console.log('  FAIL', m); };

// ---- a server under the sub-path ----
let server = null, url = process.env.SMOKE_URL;
if (!url) {
  const port = await new Promise((res) => { const s = createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
  server = spawn(process.execPath, [join(root, 'tools/serve.mjs')], { env: { ...process.env, PORT: String(port), BASE }, stdio: 'ignore' });
  url = `http://localhost:${port}${BASE}`;
  for (let i = 0; i < 50; i++) { try { if ((await fetch(url)).ok) break; } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 100)); }
}
const stopServer = () => { if (server) server.kill(); };

// ---- helpers that run in the page (installed before the game boots) ----
function install() {
  window.__glErrors = [];
  const proto = WebGL2RenderingContext.prototype;
  const gs = proto.getShaderParameter, gp = proto.getProgramParameter;
  proto.getShaderParameter = function (s, p) { const v = gs.call(this, s, p); if (p === this.COMPILE_STATUS && !v) window.__glErrors.push('shader compile: ' + this.getShaderInfoLog(s)); return v; };
  proto.getProgramParameter = function (s, p) { const v = gp.call(this, s, p); if (p === this.LINK_STATUS && !v) window.__glErrors.push('program link: ' + this.getProgramInfoLog(s)); return v; };
  window.T = {
    autopilot() {
      const g = app.game;
      g.input.poll = () => {
        const b = g.boat, q = g.progress.gate;
        const tx = q.c[0] + q.dir[0] * 12 - b.pos[0], tz = q.c[1] + q.dir[1] * 12 - b.pos[2];
        let d = (Math.atan2(tz, tx) - b.yaw) % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI;
        return { throttle: Math.abs(d) > 0.9 ? 0.5 : 1, steer: Math.max(-1, Math.min(1, d * 2.5)), boost: false, pressed: new Set() };
      };
    },
    // one step of the sea and the game, without drawing (the same as tools/drive.mjs T.sim)
    step(dt) {
      const W = app.weather;
      app.time += dt; W.update(dt);
      const S = W.state;
      app.ocean.lambda = Math.max(S.choppy, W.choppyFor(S.wind));
      app.ocean.setSpectrum(W.spectrum());
      app.ocean.update(app.time, dt, W.foam());
      app.game.update(dt, app.ocean.textures());
      // Wait for the GPU, as a fast card would have by the next frame: the sea probe's answer (read back late, see
      // probe.js) is then one step old every time. Without this a slow software GPU answers many steps late, the
      // boat waits for it, and a lap takes ten times as long and is not repeatable.
      app.gl.finish();
    },
    async frames(n) { for (let i = 0; i < n; i++) { app.frame(1 / 60); await new Promise((r) => setTimeout(r, 0)); } app.gl.finish(); },
    // race one lap and report what happened
    async lap({ id, seed, maxSteps, full, dt, wall, gates, all }) {
      const g = app.game, col = g.collisions;
      for (let i = 0; i < 30 / dt; i++) { T.step(dt); if (i % 20 === 0) await new Promise((r) => setTimeout(r, 0)); }
      g.start(id, 'breeze', 'day', seed);
      T.autopilot();
      const hits = [], t0 = performance.now(), r = { id, steps: 0, physSteps: 0, timedOut: false, simSeconds: 0, hardHits: 0, maxImpact: 0, hits: 0, maxGround: 0, onLand: 0, worstHeight: -1e9, nan: false, lapTimes: null };
      const orig = col.step;
      col.step = function (b, d) {
        r.physSteps++;
        const v0 = Math.hypot(b.vel[0], b.vel[2]);
        orig.call(this, b, d);
        if (this.hits > 0) { r.hits++; if (v0 > r.maxImpact) r.maxImpact = v0; if (v0 > 8) { r.hardHits++; if (hits.length < 5) hits.push({ t: +g.raceTime.toFixed(1), v0: +v0.toFixed(1), x: Math.round(b.pos[0]), z: Math.round(b.pos[2]) }); } }
        if (b.ground > r.maxGround) r.maxGround = b.ground;
      };
      const loop = g.course.loop;
      const done = () => g.state === 'finished' || (full ? loop && !all && g.laps.length >= 1 : g.progress.next >= gates);
      for (let i = 0; i < maxSteps && !done(); i++) {
        if (performance.now() - t0 > wall) { r.timedOut = true; break; }
        T.step(dt);
        r.steps++; r.simSeconds += dt;
        const b = g.boat, h = g.land.field.heightAt(b.pos[0], b.pos[2]);
        if (h > r.worstHeight) r.worstHeight = h;
        if (h > 0) r.onLand++;
        if (![...b.pos, ...b.vel, b.yaw].every(Number.isFinite)) { r.nan = true; break; }
        if (i % 15 === 0) await new Promise((x) => setTimeout(x, 0));
      }
      col.step = orig;
      Object.assign(r, { physRatio: +(r.physSteps / Math.max(r.simSeconds * 120, 1)).toFixed(2), state: g.state, next: g.progress.next, total: g.course.total, raceTime: +g.raceTime.toFixed(2), laps: g.laps.map((t) => +t.toFixed(2)), lapsDone: g.laps.length, hitList: hits, maxGround: +r.maxGround.toFixed(2), maxImpact: +r.maxImpact.toFixed(1), worstHeight: +r.worstHeight.toFixed(2), finishTime: +g.finishTime.toFixed(2) });
      return r;
    },
    // is the canvas more than one flat colour? returns statistics of a 48x27 reduction
    async blank() {
      const c = document.getElementById('c');
      const img = new Image(); img.src = c.toDataURL('image/png'); await img.decode();
      const s = document.createElement('canvas'); s.width = 48; s.height = 27;
      const x = s.getContext('2d'); x.drawImage(img, 0, 0, 48, 27);
      const d = x.getImageData(0, 0, 48, 27).data, n = d.length / 4;
      let m = [0, 0, 0]; const seen = new Set();
      for (let i = 0; i < d.length; i += 4) { for (let k = 0; k < 3; k++) m[k] += d[i + k] / n; seen.add((d[i] >> 3) << 10 | (d[i + 1] >> 3) << 5 | (d[i + 2] >> 3)); }
      let v = 0; for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) v += (d[i + k] - m[k]) ** 2 / (n * 3);
      return { mean: m.map((q) => +q.toFixed(1)), std: +Math.sqrt(v).toFixed(1), colours: seen.size };
    },
  };
}

// ---- boot ----
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 480, height: 270 }, deviceScaleFactor: 1 });
const warnings = [];
page.on('pageerror', (e) => fail('page error: ' + e.message.slice(0, 500)));
page.on('crash', () => fail('the page crashed'));
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error') fail('console error: ' + t.slice(0, 500));
  else if (m.type() === 'warning') {
    if (/shader|compile|link|GL_INVALID|CONTEXT_LOST|GLSL/i.test(t) && !/GPU stall/.test(t)) fail('console warning: ' + t.slice(0, 500));
    else warnings.push(t.slice(0, 200));
  }
});
page.on('requestfailed', (r) => fail(`request failed: ${r.url()} ${r.failure()?.errorText}`));
page.on('response', (r) => { if (r.status() >= 400) fail(`HTTP ${r.status()} for ${r.url()}`); });
await page.addInitScript(install);

const results = [];
let exit = 0;
try {
  console.log(`smoke: ${url} (${Q}), courses ${COURSES.join(', ')}${FULL ? ', first laps' : `, first ${SEGMENT_GATES} gates`}`);
  await page.goto(`${url}?manual&preserve&q=${Q}&scale=0.5`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction('window.app && window.app.game', null, { timeout: 180000 });
  for (const id of COURSES) {
    const t0 = Date.now();
    console.log(`${id}:`);
    const maxSteps = FULL ? (id === 'sprint' ? 9000 : 6000) * (process.env.SMOKE_ALL ? 2 : 1) : 1500;
    const r = await page.evaluate((a) => window.T.lap(a), { id, seed: SEED, maxSteps, full: FULL, dt: 1 / 30, wall: WALL, gates: SEGMENT_GATES, all: !!process.env.SMOKE_ALL });
    await page.evaluate(() => window.T.frames(2));
    const blank = await page.evaluate(() => window.T.blank());
    const glerr = await page.evaluate(() => { const e = window.__glErrors.slice(), gl = app.gl; const codes = []; for (let i = 0; i < 8; i++) { const c = gl.getError(); if (!c) break; codes.push(c); } return { shader: e, codes }; });
    Object.assign(r, { blank, wallSeconds: Math.round((Date.now() - t0) / 1000) });
    results.push(r);
    console.log(`  ${r.state}, race time ${r.raceTime} s in ${r.steps} steps, gates ${r.next}/${r.total}, laps ${JSON.stringify(r.laps)}, physics ${r.physRatio}x real time, ${r.hits} contacts (fastest ${r.maxImpact} m/s), most aground ${r.maxGround}, highest ground under the hull ${r.worstHeight} m, frame std ${blank.std} (${blank.colours} colours), ${r.wallSeconds} s`);
    if (r.nan) fail(`${id}: the boat's state went non-finite`);
    const finished = r.state === 'finished' || (FULL ? r.lapsDone >= 1 : r.next >= SEGMENT_GATES);
    if (r.timedOut) fail(`${id}: wall-clock limit (${WALL / 1000} s) hit after ${r.steps} steps`);
    if (r.physRatio < 0.8) fail(`${id}: the physics advanced only ${r.physRatio} of the simulated time (the sea probe lagged the harness)`);
    if (!finished) fail(`${id}: the race did not finish (state ${r.state}, gate ${r.next}/${r.total} after ${r.steps} steps)`);
    if (r.hardHits) fail(`${id}: ${r.hardHits} hard hits ${JSON.stringify(r.hitList)}`);
    if (r.maxGround > 0.25) fail(`${id}: the hull ran aground (${r.maxGround})`);
    if (r.onLand) fail(`${id}: the boat's centre was over land for ${r.onLand} steps (up to ${r.worstHeight} m)`);
    if (blank.std < 4 || blank.colours < 12) fail(`${id}: the frame is blank (std ${blank.std}, ${blank.colours} colours)`);
    for (const e of glerr.shader) fail(`${id}: ${e.slice(0, 300)}`);
    if (glerr.codes.length) fail(`${id}: gl.getError after the frames: ${glerr.codes.join(', ')}`);
  }
} catch (e) {
  fail('smoke run aborted: ' + e.message.slice(0, 800));
}

// ---- private mode: localStorage that throws on every access must not stop the game ----
try {
  console.log('storage blocked:');
  const p2 = await browser.newPage({ viewport: { width: 320, height: 180 }, deviceScaleFactor: 1 });
  const errs = [];
  p2.on('pageerror', (e) => errs.push(e.message));
  p2.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p2.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('The operation is insecure.', 'SecurityError'); } });
    Object.defineProperty(window, 'sessionStorage', { get() { throw new DOMException('The operation is insecure.', 'SecurityError'); } });
  });
  await p2.addInitScript(install);
  await p2.goto(`${url}?manual&preserve&q=low&scale=0.25`, { waitUntil: 'load', timeout: 180000 });
  await p2.waitForFunction('window.app && window.app.game', null, { timeout: 180000 });
  const ok = await p2.evaluate(async () => {
    const g = app.game;
    for (let i = 0; i < 20; i++) T.step(1 / 30);
    g.start('oval', 'calm', 'day', 5);
    for (let i = 0; i < 40; i++) T.step(1 / 30);
    g.hud.sync();
    g.hud.toggleSound();
    return g.state;
  });
  if (!['countdown', 'racing'].includes(ok)) fail(`blocked storage: the race did not start (${ok})`);
  if (errs.length) fail('blocked storage: ' + errs[0].slice(0, 300));
  console.log(`  race state ${ok}, ${errs.length} errors`);
  await p2.close();
} catch (e) { fail('storage check aborted: ' + e.message.slice(0, 500)); }
await browser.close();

// ---- no WebGL2: a message, not a blank page ----
try {
  console.log('no WebGL2:');
  const b2 = await chromium.launch({ args: ['--disable-gpu', '--disable-3d-apis', '--disable-webgl', '--disable-webgl2'] });
  const p3 = await b2.newPage({ viewport: { width: 480, height: 270 } });
  await p3.goto(`${url}?manual&q=low`, { waitUntil: 'load', timeout: 60000 });
  await p3.waitForSelector('.fatal', { timeout: 20000 });
  const text = await p3.evaluate(() => document.querySelector('.fatal').innerText);
  console.log('  ' + text.replace(/\s+/g, ' ').slice(0, 160));
  if (!/WebGL2/i.test(text)) fail('no WebGL2: the message does not say what is missing: ' + text.slice(0, 200));
  await b2.close();
} catch (e) { fail('no-WebGL2 page shows no message: ' + e.message.slice(0, 300)); }

stopServer();
const w = [...new Set(warnings)];
if (w.length) console.log(`console warnings (not failures): ${w.length} distinct\n  ` + w.slice(0, 6).join('\n  '));
if (process.env.SMOKE_JSON) writeFileSync(process.env.SMOKE_JSON, JSON.stringify({ results, failures, warnings: w }, null, 1));
console.log(failures.length ? `SMOKE FAILED: ${failures.length} problem${failures.length > 1 ? 's' : ''}` : 'smoke ok');
process.exit(failures.length ? 1 : 0);
