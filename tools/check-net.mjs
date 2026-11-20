// Multiplayer check: one Chromium, several pages on ?transport=local&manual (BroadcastChannel, no network),
// one hosts, the others join (one by ?room= link, one through the join panel by typing the code), a race is
// run with autopilots in lockstep, and the pages are compared. Exits non-zero on any failure.
//
//   node tools/serve.mjs 5185 &
//   flock /tmp/tidal-shot-2.lock node tools/check-net.mjs          (PORT=5185 PLAYERS=3 by default)
//
// What is asserted: everyone reaches the lobby and sees the same players (names, slots, distinct colours);
// the room-full and no-such-room messages; clock offsets are found; the same course, seed and conditions and
// the same sea time on every page; each page sees the others' boats where they were (about 100 ms ago);
// the places agree; every page ends with the same results table; a player who leaves mid-race disappears
// and is marked DNF; the host leaving ends the game with a message.
//
// The pages' clocks are virtual (?manual): they advance only when stepped, and each page starts at a
// different base (?netbase=), so the clock offset estimate has real work to do. The course is cut short
// (course.total) so a race takes a minute, not twenty.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
let pw;
for (const dir of ['/usr/lib/node_modules/', (() => { try { return execSync('npm root -g').toString().trim() + '/'; } catch { return '/'; } })()]) {
  try { pw = createRequire(dir)('playwright'); break; } catch { /* next */ }
}
if (!pw) { console.error('playwright not found'); process.exit(2); }
const { chromium } = pw;

const PORT = process.env.PORT || 5185;
const N = Math.min(Math.max(Number(process.env.PLAYERS) || 3, 2), 4);
const DT = 1 / 30, BATCH = 5, SHORT1 = 4, SHORT2 = 2;
const URL0 = `http://localhost:${PORT}/?manual&preserve&q=low&scale=0.25&transport=local`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.error('[net]', ...a);

const failures = [];
const check = (name, ok, detail = '') => {
  if (ok) log('ok  ', name);
  else { failures.push(name); log('FAIL', name, detail); }
};

const HELPERS = `window.T = {
  async sim(n, dt = 1 / 60) {
    const W = app.weather;
    for (let i = 0; i < n; i++) {
      app.time += dt; W.update(dt);
      const S = W.state;
      app.ocean.lambda = Math.max(S.choppy, W.choppyFor(S.wind));
      app.ocean.setSpectrum(W.spectrum());
      app.ocean.update(app.time, dt, W.foam());
      app.game.update(dt, app.ocean.textures());
      app.gl.flush();
      await new Promise((r) => setTimeout(r, 0));
    }
  },
  // drive toward the next gate at a fraction of full throttle (so the finishing order is not just the grid order)
  auto(scale) {
    const g = app.game;
    g.input.poll = () => {
      const b = g.boat, q = g.progress.gate;
      const tx = q.c[0] + q.dir[0] * 12 - b.pos[0], tz = q.c[1] + q.dir[1] * 12 - b.pos[2];
      let d = (Math.atan2(tz, tx) - b.yaw) % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI;
      return { throttle: (Math.abs(d) > 0.9 ? 0.5 : 1) * scale, steer: Math.max(-1, Math.min(1, d * 2.5)), boost: false, pressed: new Set() };
    };
  },
  // remember where this boat was, in host-clock time, after each update
  record() {
    const net = app.game.net, post = net.post.bind(net);
    T.hist = [];
    net.post = (dt) => { post(dt); const b = app.game.boat; T.hist.push([net.clock.host(), b.pos[0], b.pos[1], b.pos[2]]); if (T.hist.length > 600) T.hist.shift(); };
  },
};`;

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
let abort = false;
const pages = [];

async function open(extra = '', netbase = 0) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { failures.push('pageerror: ' + e.message.slice(0, 300)); log('PAGEERROR', e.message.slice(0, 500)); });
  page.on('console', (m) => { if (m.type() === 'error') log('console error:', m.text().slice(0, 300)); });
  await page.goto(`${URL0}&netbase=${netbase}${extra}`, { waitUntil: 'load', timeout: 240000 });
  await page.waitForFunction('window.app && window.app.game', null, { timeout: 240000 });
  await page.evaluate(HELPERS);
  return page;
}
const ev = (p, code) => p.evaluate(code);
async function waitAll(ps, code, what, timeout = 20000) {
  const t0 = Date.now();
  for (;;) {
    const r = await Promise.all(ps.map((p) => p.evaluate(`(() => { try { return !!(${code}); } catch { return false; } })()`)));
    if (r.every(Boolean)) return true;
    if (Date.now() - t0 > timeout) { check('wait: ' + what, false, JSON.stringify(r)); return false; }
    await sleep(50);
  }
}
// advance the given pages in lockstep by n steps, then give the messages a moment to arrive
async function step(ps, n) {
  for (let i = 0; i < n; i += BATCH) {
    const k = Math.min(BATCH, n - i);
    await Promise.all(ps.map((p) => p.evaluate(`T.sim(${k}, ${DT})`)));
    await sleep(20);
  }
}
const state = (p) => p.evaluate(`(() => { const g = app.game, n = g.net; return { state: g.state, t: app.time, next: g.progress.next, fin: g.state === 'finished' ? g.finishTime : null, place: n ? n.placeText() : null, order: n ? n.order.slice() : null, results: n ? n.results : null, phase: n ? n.phase : null }; })()`);
const states = (ps) => Promise.all(ps.map(state));

try {
  // ---------- lobby ----------
  log(`opening ${N} pages`);
  const host = await open('', 0);
  pages.push(host);
  await ev(host, `document.getElementById('host-btn').click()`);
  await waitAll([host], 'app.game.net && app.game.net.code', 'host opens a room');
  const code = await ev(host, 'app.game.net.code');
  check('host got a valid room code', /^[A-HJ-NP-Z2-9]{5}$/.test(code), code);
  check('lobby panel shows on the host', await ev(host, `!document.getElementById('mp-lobby').classList.contains('hide') && document.querySelector('#lb-code').textContent === '${code}'`));

  // second player: by link
  pages.push(await open(`&room=${code}`, 7919));
  // third (and fourth): through the join panel, typing the code
  for (let i = 2; i < N; i++) {
    const p = await open('', 15013 * i);
    await ev(p, `document.getElementById('join-btn').click()`);
    await ev(p, `(() => { const c = document.getElementById('join-code'); c.value = ${JSON.stringify(code.toLowerCase().replace(/^(.{2})/, '$1 '))}; document.getElementById('join-name').value = 'Typed' + ${i}; document.getElementById('join-go').click(); })()`);
    pages.push(p);
  }
  const names = ['Ann', 'Bob', 'Cy', 'Dee'];
  await waitAll(pages, `app.game.net && app.game.net.players.length === ${N}`, 'everyone is in the lobby', 30000);
  for (let i = 0; i < N; i++) await ev(pages[i], `app.game.net.setProfile({ name: ${JSON.stringify(names[i])}, sw: ${(i * 3) % 8}, stripe: 0, number: ${10 + i} })`);
  await sleep(300);
  const rosters = await Promise.all(pages.map((p) => ev(p, `JSON.stringify(app.game.net.players.map((q) => [q.id, q.slot, q.name, q.sw]))`)));
  check('every page sees the same player list', rosters.every((r) => r === rosters[0]), rosters.join(' | '));
  const roster = JSON.parse(rosters[0]);
  check('names and slots are right', roster.length === N && roster.every((r, i) => r[2] === names[i] && r[1] === i), rosters[0]);
  check('colours are distinct', new Set(roster.map((r) => r[3])).size === N);
  const domRows = await Promise.all(pages.map((p) => ev(p, `document.querySelectorAll('#lb-players .pl:not(.empty)').length`)));
  check('the lobby list shows every player', domRows.every((n) => n === N), String(domRows));
  check('host sees Start, guests see the wait line', await ev(pages[0], `!document.getElementById('lb-host').classList.contains('hide')`) && await ev(pages[1], `document.getElementById('lb-host').classList.contains('hide') && !document.getElementById('lb-guest').classList.contains('hide')`));

  // clock offsets: pages start at different virtual bases, so the host-minus-local difference is what they must find
  const clocks = await Promise.all(pages.map((p) => ev(p, `({ off: app.game.net.clock.offset, local: app.game.net.clock.local(), synced: app.game.net.clock.synced })`)));
  check('clock offsets estimated', clocks.every((c, i) => c.synced || i === 0), JSON.stringify(clocks));
  check('clock offsets match the true base difference', clocks.every((c, i) => Math.abs(c.off - (clocks[0].local - c.local)) < 2), JSON.stringify(clocks));

  // room full and no such room: extra pages that are never stepped
  const extras = [];
  for (let k = N; k < 4; k++) {
    const x = await open(`&room=${code}`, 90 + k);
    await waitAll([x], `app.game.net && app.game.net.players.length === ${k + 1}`, 'an extra player joins');
    extras.push(x);
  }
  {
    const x = await open(`&room=${code}`, 99);
    await waitAll([x], `!document.getElementById('mp-msg').classList.contains('hide')`, 'full message');
    const t = await ev(x, `document.getElementById('msg-t').textContent`);
    check('a fifth player is told the room is full', t.toLowerCase().includes('full'), t);
    await x.close();
  }
  for (const x of extras) { await ev(x, `app.game.net && app.game.net.leave()`); await x.close(); }
  if (extras.length) await waitAll(pages, `app.game.net.players.length === ${N}`, 'extras leave the lobby');
  {
    const x = await open(`&room=ZZZZZ`, 5);
    await waitAll([x], `!document.getElementById('mp-msg').classList.contains('hide')`, 'no-such-room message', 10000);
    check('a wrong code gives a clear message', (await ev(x, `document.getElementById('msg-t').textContent`)).toLowerCase().includes('no game'));
    await x.close();
  }

  // ---------- race 1 ----------
  await ev(pages[0], `document.querySelector('[data-lc="sprint"]').click()`);
  await waitAll(pages, `app.game.net.settings.course === 'sprint' && app.game.course.id === 'sprint'`, 'course choice reaches everyone');
  for (const p of pages) await ev(p, `app.game.course.total = ${SHORT1}`);   // test hook: cut the course short (same on every page)
  await ev(pages[0], `document.getElementById('lb-start').click()`);
  await waitAll(pages, `app.game.state === 'countdown'`, 'everyone is counting down');
  const info = await Promise.all(pages.map((p) => ev(p, `JSON.stringify(app.game.net.race)`)));
  check('same course, conditions, seed and start instant everywhere', info.every((i) => i === info[0]), info.join(' | '));
  const race = JSON.parse(info[0]);
  check('the conditions were rolled from the seed (random sea)', race.cond === 'random' && race.tod === 'random' && Number.isInteger(race.seed));
  for (let i = 0; i < N; i++) { await ev(pages[i], `T.record()`); await ev(pages[i], `T.auto(${0.8 + 0.1 * i})`); }

  let maxDt = 0;
  const timeSkew = async () => { const s = await states(pages); const ts = s.map((x) => x.t); maxDt = Math.max(maxDt, Math.max(...ts) - Math.min(...ts)); return s; };
  await step(pages, 60);
  let s = await timeSkew();
  check('sea time is equal on every page during the lead-in', maxDt < 0.002, `skew ${maxDt}`);
  const w1 = await Promise.all(pages.map((p) => ev(p, `JSON.stringify(['wind','swellHs','rain','clouds'].map((k) => +(app.weather.state[k] ?? 0).toFixed(3)))`)));
  check('the same seed gives the same weather', w1.every((w) => w === w1[0]), w1.join(' | '));
  // the countdown: all pages must be 'racing' within one step of each other
  let racingAt = [];
  for (let k = 0; k < 120; k++) {
    await step(pages, BATCH);
    s = await timeSkew();
    if (s.every((x) => x.state === 'racing')) break;
    if (s.some((x) => x.state === 'racing')) racingAt.push(s.map((x) => x.state));
  }
  check('the race starts on every page together', s.every((x) => x.state === 'racing') && racingAt.length <= 1, JSON.stringify(racingAt));
  check('sea time at GO is the same on every page', maxDt < 0.002, `skew ${maxDt}`);

  // run 12 s of racing, then compare
  await step(pages, 360);
  await timeSkew();
  const compareBoats = async (label) => {
    const snap = await Promise.all(pages.map((p) => ev(p, `(() => { const n = app.game.net; return { id: n.me.id, now: n.clock.host(), hist: T.hist, rivals: app.game.rivals.map((r) => ({ id: r.id, pos: r.pose.pos.slice(), speed: r.pose.speed, mode: n.remotes.get(r.id).mode })), drawn: app.game.renderBoats().length }; })()`)));
    let worst = 0, detail = '';
    const where = (owner, t) => {
      const h = snap.find((x) => x.id === owner).hist;
      for (let i = h.length - 1; i > 0; i--) if (h[i - 1][0] <= t && t <= h[i][0]) { const k = (t - h[i - 1][0]) / (h[i][0] - h[i - 1][0] || 1); return [0, 1, 2].map((a) => h[i - 1][1 + a] + (h[i][1 + a] - h[i - 1][1 + a]) * k); }
      return null;
    };
    for (const me of snap) for (const r of me.rivals) {
      const truth = where(r.id, me.now - 100);
      if (!truth) { detail += ` no history for ${r.id} at ${me.id};`; worst = 1e9; continue; }
      const e = Math.hypot(r.pos[0] - truth[0], r.pos[1] - truth[1], r.pos[2] - truth[2]);
      if (e > worst) worst = e;
    }
    check(`${label}: every page draws every boat`, snap.every((x) => x.rivals.length === N - 1 && x.drawn === N), JSON.stringify(snap.map((x) => [x.rivals.length, x.drawn])));
    check(`${label}: rival boats within 1.5 m of the true position 100 ms ago (worst ${worst.toFixed(2)} m)${detail}`, worst < 1.5);
    const speeds = snap.flatMap((x) => x.rivals.map((r) => r.speed));
    check(`${label}: rival velocity is real (speeds ${speeds.map((v) => v.toFixed(0)).join(' ')} m/s)`, speeds.every((v) => v > 3));
    check(`${label}: rivals are interpolated, not guessed`, snap.every((x) => x.rivals.every((r) => r.mode === 'interp')), JSON.stringify(snap.map((x) => x.rivals.map((r) => r.mode))));
  };
  await compareBoats('mid-race');

  // keep going; at a point mid-race the places must agree
  await step(pages, 90);
  await sleep(100);
  s = await states(pages);
  check('places agree on every page', s.every((x) => JSON.stringify(x.order) === JSON.stringify(s[0].order)), JSON.stringify(s.map((x) => x.order)));
  check('every page shows a place in the HUD', s.every((x) => /^[1-4](ST|ND|RD|TH)$/.test(x.place)) && (await ev(pages[1], `document.getElementById('place').textContent`)).length > 0, JSON.stringify(s.map((x) => x.place)));
  // the places should follow the throttles (the last page is the quickest): compare with the truth once the leader is clear
  const prog = await Promise.all(pages.map((p) => ev(p, `(() => { const g = app.game, b = g.boat, q = g.progress.gate; return { id: g.net.me.id, next: g.progress.next, d: Math.hypot(q.c[0] - b.pos[0], q.c[1] - b.pos[2]) }; })()`)));
  const truthOrder = prog.slice().sort((a, b) => b.next - a.next || a.d - b.d).map((x) => x.id);
  check('the host orders the places like the true gate progress', JSON.stringify(truthOrder) === JSON.stringify(s[0].order) || prog.some((a, i) => prog.some((b, j) => i < j && a.next === b.next && Math.abs(a.d - b.d) < 30)), `truth ${truthOrder} host ${s[0].order} ${JSON.stringify(prog)}`);

  // finish
  let guard = 0;
  while (guard++ < 400) {
    await step(pages, 30);
    s = await states(pages);
    if (s.every((x) => x.results)) break;
  }
  await sleep(100);
  s = await states(pages);
  check('every page has a results table', s.every((x) => x.results), JSON.stringify(s.map((x) => x.phase)));
  const tabs = s.map((x) => JSON.stringify(x.results));
  check('the results table is the same on every page', tabs.every((t) => t === tabs[0]), tabs.join(' | '));
  const res = s[0].results || [];
  check('results are ordered by time, nobody is DNF', res.length === N && res.every((r, i) => !r.dnf && (i === 0 || r.time >= res[i - 1].time)), JSON.stringify(res));
  check('each finish time matches what the boat itself measured', s.every((x, i) => { const r = res.find((q) => q.id === i); return r && Math.abs(r.time - x.fin) < 0.05; }), JSON.stringify(s.map((x) => x.fin)) + JSON.stringify(res));
  check('the quickest throttle won (last page)', res[0] && res[0].id === N - 1, JSON.stringify(res));
  check('results panel is visible and lists every player', (await Promise.all(pages.map((p) => ev(p, `!document.getElementById('mp-res').classList.contains('hide') && document.querySelectorAll('#res-rows .rr').length`)))).every((n) => n === N));
  check('only the host gets the rematch button', await ev(pages[0], `!document.getElementById('res-lobby').classList.contains('hide')`) && await ev(pages[1], `document.getElementById('res-lobby').classList.contains('hide')`));

  // ---------- rematch, then a leaver ----------
  await ev(pages[0], `document.getElementById('res-lobby').click()`);
  await waitAll(pages, `app.game.net.phase === 'lobby' && app.game.state === 'menu' && !document.getElementById('mp-lobby').classList.contains('hide')`, 'everyone is back in the lobby');
  check('the rematch keeps everyone and clears the rivals', (await Promise.all(pages.map((p) => ev(p, `app.game.net.players.length === ${N} && app.game.rivals.length === 0`)))).every(Boolean));
  for (const p of pages) await ev(p, `app.game.course.total = ${SHORT2}`);
  await ev(pages[0], `document.getElementById('lb-start').click()`);
  await waitAll(pages, `app.game.state === 'countdown'`, 'second race counts down');
  for (let i = 0; i < N; i++) { await ev(pages[i], `T.record()`); await ev(pages[i], `T.auto(${0.8 + 0.1 * i})`); }
  for (let k = 0; k < 120; k++) { await step(pages, BATCH); if ((await states(pages)).every((x) => x.state === 'racing')) break; }
  await step(pages, 60);
  const leaver = 1, rest = pages.filter((_, i) => i !== leaver);
  await ev(pages[leaver], `app.game.net.leave()`);
  await sleep(300);
  await step(rest, 20);
  await sleep(100);
  const after = await Promise.all(rest.map((p) => ev(p, `({ rivals: app.game.rivals.map((r) => r.id), players: app.game.net.players.length })`)));
  check('a leaver disappears from the other boats', after.every((a) => a.rivals.length === N - 2 && !a.rivals.includes(leaver) && a.players === N - 1), JSON.stringify(after));
  check('the leaver is back at the menu', await ev(pages[leaver], `app.game.net === null && app.game.state === 'menu'`));
  guard = 0;
  while (guard++ < 400) {
    await step(rest, 30);
    s = await states(rest);
    if (s.every((x) => x.results)) break;
  }
  await sleep(100);
  s = await states(rest);
  const res2 = s[0].results || [];
  check('race 2 finished for the others', s.every((x) => x.results && JSON.stringify(x.results) === JSON.stringify(s[0].results)), JSON.stringify(s.map((x) => x.results)));
  check('the leaver is marked DNF and placed last', res2.length === N && res2[res2.length - 1].id === leaver && res2[res2.length - 1].dnf && res2.slice(0, -1).every((r) => !r.dnf), JSON.stringify(res2));

  // ---------- the host leaves ----------
  await ev(rest[0], `document.getElementById('res-lobby').click()`);
  await waitAll(rest, `app.game.net.phase === 'lobby'`, 'back in the lobby again');
  await ev(rest[0], `app.game.net.leave()`);
  await waitAll(rest.slice(1), `app.game.net === null && !document.getElementById('mp-msg').classList.contains('hide')`, 'host-left message');
  const msgs = await Promise.all(rest.slice(1).map((p) => ev(p, `document.getElementById('msg-t').textContent`)));
  check('the host leaving ends the game with a message', msgs.every((m) => m.toLowerCase().includes('host left')), msgs.join(' | '));
} catch (e) {
  failures.push('exception: ' + e.message);
  log('EXCEPTION', e.stack || e.message);
}
await browser.close();
if (failures.length) { log(`${failures.length} FAILED:\n  ` + failures.join('\n  ')); process.exit(1); }
log('all checks passed');
