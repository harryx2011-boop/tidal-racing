// Boat-to-boat contact, PIT, slipstream, slingshot and bump drafting, in Node with no GL and no sea (a flat or
// sinusoidal sea stub): scripted rivals drive into the real Boat, and the rules in src/game/contact.js and
// draft.js run exactly as in game.js. Two-client symmetry at the end.
//   node tools/check-contact.mjs
// Exits non-zero on any failure.
import { execSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Boat } from '../src/game/boat.js';
import { Contact, closest, RR, PIT_IMMUNE } from '../src/game/contact.js';
import { Draft, strengthOf, DRAG_CUT } from '../src/game/draft.js';

const DT = 1 / 120;
let bad = 0;
const fail = (m) => { bad++; console.log('    FAIL', m); };
const ok = (c, m) => { if (!c) fail(m); return c; };
const ang = (a) => { a %= 2 * Math.PI; if (a > Math.PI) a -= 2 * Math.PI; if (a < -Math.PI) a += 2 * Math.PI; return a; };
const flat = () => ({ h: 0, sx: 0, sz: 0 });
const SEA = (i, x, z) => flat();
const ROUGH = (i, x, z) => { const t = ROUGH.t; return { h: 0.5 * Math.sin(0.4 * x + 0.9 * t) + 0.3 * Math.sin(0.7 * z - 0.5 * t), sx: 0.2 * Math.cos(0.4 * x + 0.9 * t), sz: 0.21 * Math.cos(0.7 * z - 0.5 * t) }; };
ROUGH.t = 0;

function mk(x, z, yaw, speed) {
  const b = new Boat(); b.reset(x, z, yaw); b.step(DT, { throttle: 0, steer: 0 }, SEA, false);
  b.vel = [Math.cos(yaw) * speed, 0, Math.sin(yaw) * speed]; return b;
}
// a scripted rival: moves in a straight line (or per a function) and ignores contact
function rival(x, z, yaw, speed) { const b = mk(x, z, yaw, speed); b.script = null; return b; }
function advance(r) { // constant velocity
  r.pos[0] += r.vel[0] * DT; r.pos[2] += r.vel[2] * DT;
}
function world(scripted = true) { const g = { rivals: [], hud: { flashes: [], flash(t) { this.flashes.push(t); } } }; g.contact = new Contact(g); g.draft = new Draft(g); if (scripted) { g.contact.lead = 0; g.contact.assume = false; } return g; }   // scripted rivals are current poses that ignore contact
// one physics step of the local boat, as in game.js
function own(g, boat, inp, sea = SEA, drive = true) { g.draft.step(boat, DT, drive); boat.step(DT, inp, sea, drive); g.contact.step(boat, DT, drive); }
const ctl = (yaw0, thr = 1, k = 2.5) => (b) => ({ throttle: thr, steer: Math.max(-1, Math.min(1, k * ang(yaw0 - b.yaw))), boost: false });

// ---------------------------------------------------------------- scenarios on one boat against scripted rivals
function runScenario(name, { me, rv, secs, inp, sea = SEA, on, pre }) {
  const g = world(); pre?.(g); g.rivals = rv.map((p) => ({ id: 1, name: 'r', pose: p, livery: {} }));
  let minD = 1e9, maxSpeed = 0, jit = 0, prev = [], first = -1;
  const n = Math.round(secs / DT), trace = [];
  for (let i = 0; i < n; i++) {
    ROUGH.t = i * DT;
    for (const p of rv) advance(p);
    own(g, me, inp(me, i * DT), sea);
    for (const p of rv) { const c = closest(me.pos, me.yaw, p.pos, p.yaw); minD = Math.min(minD, c.d); if (c.d < RR + 0.12 && first < 0) first = i * DT; }
    maxSpeed = Math.max(maxSpeed, me.speed);
    if (!isFinite(me.pos[0] + me.pos[2] + me.yaw + me.speed)) { fail(`${name}: NaN at ${(i * DT).toFixed(2)} s`); break; }
    trace.push([me.pos[0], me.pos[2], me.speed, me.yaw, me.spin]);
    on?.(i * DT, g, me);
  }
  ok(minD > RR - 0.06, `${name}: hulls overlap by ${(RR - minD).toFixed(3)} m`);
  ok(maxSpeed < 80, `${name}: speed blew up (${maxSpeed.toFixed(1)} m/s)`);
  return { g, me, minD, maxSpeed, trace, first };
}

console.log('collisions');
{ // head-on at 30 + 30 m/s
  const me = mk(-100, 0, 0, 30), r = rival(100, 0, Math.PI, 30);
  const o = runScenario('head-on', { me, rv: [r], secs: 6, inp: ctl(0) });
  console.log(`  head-on: closest gap ${(o.minD - RR).toFixed(3)} m, first touch ${o.first.toFixed(2)} s, my speed ${me.speed.toFixed(1)} m/s heading ${me.yaw.toFixed(2)}`);
  ok(o.first > 0, 'head-on: never touched');
}
{ // no tunnelling at the worst closing speed (80 m/s combined) with the rival scripted at 40 m/s each way
  const me = mk(-100, 0, 0, 40), r = rival(100, 0, Math.PI, 40);
  const o = runScenario('head-on 80 m/s', { me, rv: [r], secs: 5, inp: ctl(0) });
  console.log(`  head-on 80 m/s combined: closest gap ${(o.minD - RR).toFixed(3)} m, bounced to ${me.vel[0].toFixed(1)} m/s`);
  ok(me.pos[0] < r.pos[0], 'head-on 80: passed through the rival');
}
{ // T-bone: my bow into the side of a crossing rival
  const me = mk(-40, 0, 0, 20), r = rival(4, -30, Math.PI / 2, 15);
  const o = runScenario('T-bone', { me, rv: [r], secs: 5, inp: ctl(0) });
  console.log(`  T-bone: closest gap ${(o.minD - RR).toFixed(3)} m, first touch ${o.first.toFixed(2)} s, pits ${o.g.contact.pits}, my speed ${me.speed.toFixed(1)}`);
  ok(o.first > 0, 'T-bone: never touched');
  ok(o.g.contact.pits === 0, 'T-bone: the striker was PITted');
}
{ // side rub: 0.2 m of overlap, the rival drifting 0.3 m/s toward me
  const me = mk(0, 0, 0, 30), r = rival(2, 2.2, 0, 30);
  r.vel[2] = -0.3;
  const o = runScenario('side rub', { me, rv: [r], secs: 6, inp: ctl(0, 0.8), on: (t, g, m) => { } });
  // jitter: second difference of lateral position after the first second
  let j = 0; for (let i = 240; i < o.trace.length; i++) j = Math.max(j, Math.abs(o.trace[i][1] - 2 * o.trace[i - 1][1] + o.trace[i - 2][1]));
  const spun = Math.max(...o.trace.map((t) => Math.abs(t[4])));
  console.log(`  side rub: closest gap ${(o.minD - RR).toFixed(3)} m, max lateral second difference ${j.toFixed(4)} m, max spin ${spun.toFixed(2)} rad/s, speed ${me.speed.toFixed(1)}, pits ${o.g.contact.pits}`);
  ok(j < 0.02, `side rub: lateral jitter ${j.toFixed(4)} m per step^2`);
  ok(o.g.contact.pits === 0 && spun < 1.0, 'side rub: spun the boat');
  ok(me.speed > 25, 'side rub: stuck / slowed to a crawl');
}
{ // side rub on a rough sea, both boats heading wobbling, 10 s
  const me = mk(0, 0, 0, 25), r = rival(0, 2.3, 0, 25);
  const o = runScenario('side rub rough', { me, rv: [r], secs: 10, sea: ROUGH, inp: ctl(0, 0.7) , on: () => {} });
  console.log(`  side rub, rough sea: closest gap ${(o.minD - RR).toFixed(3)} m, speed ${me.speed.toFixed(1)} m/s`);
}

console.log('PIT');
for (const side of [-1, 1]) {
  // the rival comes from behind on my port (side -1) or starboard (+1) quarter, 8 m/s faster, converging
  const me = mk(0, 0, 0, 30), r = rival(-20.2, 8.6 * side, 0.15 * -side, 46);
  const yaw0 = 0;
  let recoverAt = -1, pitAt = -1, maxRot = 0;
  const o = runScenario(`PIT ${side < 0 ? 'port' : 'starboard'} quarter`, {
    me, rv: [r], secs: 8, inp: (b, t) => {
      const pitted = o_g?.contact.pits > 0;
      return pitted ? ctl(yaw0, 1)(b) : { throttle: 1, steer: 0 };
    },
    on: (t, g, m) => { o_g = g; if (g.contact.pits === 1 && pitAt < 0) pitAt = t; if (pitAt >= 0) { maxRot = Math.max(maxRot, Math.abs(m.yaw)); if (recoverAt < 0 && t > pitAt + 0.3 && Math.abs(ang(m.yaw - yaw0)) < 0.25 && Math.abs(m.spin) < 0.3) recoverAt = t - pitAt; } },
  });
  var o_g;
  const g = o.g;
  const turned = Math.max(...o.trace.map((t) => Math.abs(t[3])));
  console.log(`  PIT ${side < 0 ? 'port' : 'starboard'}: pits ${g.contact.pits}, spin sign ${g.contact.lastPit}, max heading change ${turned.toFixed(2)} rad, back on course after ${recoverAt.toFixed(2)} s (steering), speed ${me.speed.toFixed(1)}, message ${g.hud.flashes.join(',')}`);
  ok(g.contact.pits === 1, `PIT: expected exactly one, got ${g.contact.pits} (immunity ${PIT_IMMUNE} s)`);
  // a hit on the port quarter pushes the stern to starboard: the bow swings to port (heading falls)
  ok(g.contact.lastPit === (side < 0 ? -1 : 1), 'PIT: wrong spin direction');
  const dir = o.trace.reduce((a, t) => Math.abs(t[3]) > Math.abs(a) ? t[3] : a, 0);
  ok(Math.sign(dir) === (side < 0 ? -1 : 1), 'PIT: the heading turned the wrong way');
  { // the same hit with the driver doing nothing: how far does it turn the boat?
    const m2 = mk(0, 0, 0, 30), r2 = rival(-20.2, 8.6 * side, 0.15 * -side, 46);
    const o2 = runScenario('PIT uncontrolled', { me: m2, rv: [r2], secs: 3, inp: () => ({ throttle: 1, steer: 0 }), on: (t, g) => { if (g.contact.pits && g.contact.pitT < PIT_IMMUNE - 0.05) r2.pos[2] = 500; } });   // the striker is gone a few frames after the hit
    const rot = Math.max(...o2.trace.map((t) => Math.abs(t[3])));
    console.log(`    uncontrolled: turns ${(rot * 57.3).toFixed(0)} degrees`);
    ok(rot > 1.5 && rot < 3.2, `PIT: an uncontrolled spin of ${rot.toFixed(2)} rad is not strong-but-recoverable`);
  }
  ok(recoverAt > 0 && recoverAt < 3.0, `PIT: did not recover in time (${recoverAt.toFixed(2)} s)`);
}
{ // a PIT from in front or from the side, not on the stern quarter, must not spin the boat
  const me = mk(0, 0, 0, 30), r = rival(10, -30, Math.PI / 2, 30);   // rival T-bones my bow side from the port side: my bow, not my stern
  const o = runScenario('side-on hit at the bow', { me, rv: [r], secs: 4, inp: ctl(0) });
  console.log(`  rival's bow into my bow quarter: pits ${o.g.contact.pits}`);
  ok(o.g.contact.pits === 0, 'PIT on a bow-quarter hit');
}
{ // chain: immunity holds for a second hit right after
  const me = mk(0, 0, 0, 30), r = rival(-20.2, -8.6, 0.15, 46);
  const r2 = rival(-34, -9, 0.15, 46);
  const o = runScenario('PIT chain', { me, rv: [r, r2], secs: 3, inp: (b) => ({ throttle: 1, steer: 0 }) });
  console.log(`  two rivals in succession: pits ${o.g.contact.pits}`);
  ok(o.g.contact.pits <= 1, 'PIT chained inside the immunity window');
}

console.log('bump draft');
{ // I push a slower rival square from behind
  const me = mk(-30, 0, 0, 31), r = rival(-15, 0, 0, 29);
  let before = null, after = null;
  const o = runScenario('bump, pusher', { me, rv: [r], secs: 4, inp: ctl(0), on: (t, g) => { } });
  console.log(`  pusher: bumps ${o.g.contact.bumps}, pits ${o.g.contact.pits}, speed ${me.speed.toFixed(1)} m/s`);
  ok(o.g.contact.bumps >= 1 && o.g.contact.pits === 0, 'bump (pusher): no bump or a PIT');
}
{ // a faster scripted rival pushes me square from behind
  const me = mk(0, 0, 0, 28), r = rival(-20, 0, 0, 31);
  let v0 = null;
  const o = runScenario('bump, pushed', { me, rv: [r], secs: 8, inp: ctl(0, 0.4), on: (t, g, m) => { if (g.contact.bumps === 1 && v0 === null) v0 = m.speed; } });
  console.log(`  pushed: bumps ${o.g.contact.bumps}, pits ${o.g.contact.pits}, my speed at the bump ${v0?.toFixed(2)} m/s, now ${me.speed.toFixed(1)}`);
  ok(o.g.contact.bumps >= 1 && o.g.contact.pits === 0, 'bump (pushed): no bump or a PIT');
}
{ // a slow, square nudge still bumps; a fast hit does not count as a draft
  const me = mk(0, 0, 0, 20), r = rival(-12, 0, 0, 36);
  let firstBump = null;
  const o = runScenario('hard rear-end', { me, rv: [r], secs: 2, inp: ctl(0, 0), on: (t, g) => { if (g.contact.bumps === 1 && firstBump === null) firstBump = t; } });
  console.log(`  16 m/s rear-end: first bump at ${firstBump?.toFixed(2)} s (first touch ${o.first.toFixed(2)} s)`);
  ok(firstBump === null || firstBump > o.first + 0.05, 'bump on the first, hard, rear-end contact (only the sustained push after it may count)');
}

console.log('slipstream');
{ // strength by gap and offset, static, rival at 30 m/s
  const r = rival(0, 0, 0, 30), row = [];
  let prev = 2;
  for (const gap of [0.5, 3, 6, 10, 15, 20, 24, 26]) {
    const b = mk(-(gap + 3.2 + 3.3), 0, 0, 30), s = strengthOfExport(b, r);
    row.push(`${gap}m:${s.toFixed(2)}`); ok(s <= prev + 1e-9, `strength rises with gap at ${gap} m`); prev = s;
  }
  console.log('  in line, by gap     ', row.join('  '));
  ok(strengthOfExport(mk(-(26 + 6.5), 0, 0, 30), r) === 0, 'strength outside the cone is not zero');
  ok(strengthOfExport(mk(-(3 + 6.5), 0, 0, 30), r) > 0.8, 'strength right behind is too weak');
  row.length = 0; prev = 2;
  for (const off of [0, 0.5, 1, 1.5, 2, 3, 4]) { const s = strengthOfExport(mk(-(8 + 6.5), off, 0, 30), r); row.push(`${off}m:${s.toFixed(2)}`); ok(s <= prev + 1e-9, 'strength rises with offset'); prev = s; }
  console.log('  at 8 m, by offset   ', row.join('  '));
  ok(strengthOfExport(mk(-(8 + 6.5), 4, 0, 30), r) === 0, 'strength outside the cone sideways is not zero');
  const slow = rival(0, 0, 0, 10);
  ok(strengthOfExport(mk(-12, 0, 0, 30), slow) === 0, 'a slow rival gives a draft');
  const across = rival(0, 0, Math.PI / 2, 30);
  ok(strengthOfExport(mk(-12, 0, 0, 30), across) === 0, 'a crossing rival gives a draft');
}
{ // follow in the cone for 8 s versus alone: speed and boost
  const solo = mk(0, 0, 0, 30); const gs = world();
  for (let i = 0; i < 960; i++) own(gs, solo, { throttle: 1, steer: 0 });
  const me = mk(-14, 0, 0, 30), r = rival(0, 0, 0, 34);
  const sp = [];
  const o = runScenario('follow', { me, rv: [r], secs: 8, inp: ctl(0), on: (t, g, m) => { if (Math.round(t / DT) % 240 === 0) sp.push(`${t.toFixed(0)}s: ${m.speed.toFixed(1)} (draft ${g.draft.s.toFixed(2)}, boost ${m.boost.toFixed(2)}, gap ${(r.pos[0] - m.pos[0] - 6.5).toFixed(1)} m)`); } });
  console.log(`  alone after 8 s ${solo.speed.toFixed(1)} m/s; following a 34 m/s rival: ${sp.join('; ')}`);
  console.log(`  boost ${me.boost.toFixed(2)}, drag cut at the end ${me.dragCut.toFixed(2)}`);
  ok(me.dragCut >= 0 && me.dragCut <= DRAG_CUT + 1e-9, 'drag cut out of range');
  ok(me.boost > 0.3 && me.boost <= 1, `boost fill out of range (${me.boost.toFixed(2)})`);
  ok(o.g.draft.s > 0.3, 'following closely gave little draft');
}
{ // a boat that has the rival 30 m ahead gets nothing
  const me = mk(-40, 0, 0, 30), r = rival(0, 0, 0, 30);
  const o = runScenario('follow far', { me, rv: [r], secs: 1, inp: ctl(0) });
  ok(o.g.draft.s === 0 && me.dragCut === 0 && me.boost === 0, 'draft far outside the cone');
}

console.log('slingshot');
{
  const run = (stay, z0 = 0, acc) => {
    const me = mk(-9, z0, 0, 30), r = rival(0, 0, 0, 30);
    let trigT = -1, vTrig = 0, vEnd = 0, v1 = 0;
    const o = runScenario(`slingshot (${stay} s in the cone)`, {
      me, rv: [r], secs: stay + 4, pre: (g) => { if (acc !== undefined) g.draft.slingAcc = acc; }, inp: (b, t) => t < stay ? ctl(0)(b) : { throttle: 1, steer: 0.45, boost: false },
      on: (t, g, m) => { if (g.draft.slings === 1 && trigT < 0) { trigT = t; vTrig = m.speed; } if (trigT >= 0 && t > trigT + 1.0 && !v1) v1 = m.speed; },
    });
    return { o, trigT, vTrig, v1, me, r };
  };
  const a = run(4), b = run(0, 3.5), c = run(4, 0, 0);
  console.log(`  4 s in the cone: slingshots ${a.o.g.draft.slings}, at ${a.trigT.toFixed(2)} s, speed ${a.vTrig.toFixed(1)} -> ${a.v1.toFixed(1)} one second later (stored ${a.o.g.draft.stored.toFixed(2)})`);
  console.log(`  never in the cone: slingshots ${b.o.g.draft.slings}`);
  ok(a.o.g.draft.slings === 1, `slingshot did not fire (${a.o.g.draft.slings})`);
  ok(b.o.g.draft.slings === 0, 'slingshot fired with nothing stored');
  const gain = a.v1 - c.v1;
  console.log(`  the shove alone (same run with the shove off): +${gain.toFixed(1)} m/s one second after leaving the cone`);
  ok(gain > 2 && gain < 8, `slingshot gain ${gain.toFixed(1)} m/s is out of the intended 2 to 8 m/s`);
}

console.log('fuzz: 300 random encounters, 1 to 3 scripted rivals each');
{
  let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  let worstMulti = 0, worstOverlap = 0, worstSpeed = 0, hits = 0, pits = 0, bumps = 0, bad1 = 0;
  for (let k = 0; k < 300; k++) {
    const me = mk(0, 0, 0, 15 + rnd() * 25), rv = [];
    const nr = 1 + Math.floor(rnd() * 3);
    for (let j = 0; j < nr; j++) { const a = rnd() * 6.283, d = 20 + rnd() * 40, y = rnd() * 6.283; rv.push(rival(Math.cos(a) * d, Math.sin(a) * d, y, 10 + rnd() * 35)); }
    // aim each rival roughly at where I will be in 1 to 2.5 s
    for (const r of rv) { const t = 1 + rnd() * 1.5, tx = me.vel[0] * t + (rnd() - 0.5) * 6, tz = (rnd() - 0.5) * 6, sp = Math.hypot(r.vel[0], r.vel[2]); const y = Math.atan2(tz - r.pos[2], tx - r.pos[0]); r.yaw = y; r.vel = [Math.cos(y) * sp, 0, Math.sin(y) * sp]; }
    const g = world(); g.rivals = rv.map((p) => ({ pose: p }));
    let minD = 1e9, mx = 0;
    for (let i = 0; i < 480; i++) {
      for (const r of rv) advance(r);
      own(g, me, { throttle: 1, steer: Math.sin(i * 0.02 + k) * 0.4 });
      for (const r of rv) minD = Math.min(minD, closest(me.pos, me.yaw, r.pos, r.yaw).d);
      mx = Math.max(mx, me.speed);
      if (!isFinite(me.pos[0] + me.pos[2] + me.yaw + me.speed + me.spin)) { bad1++; break; }
    }
    if (nr === 1) worstOverlap = Math.max(worstOverlap, RR - minD); else worstMulti = Math.max(worstMulti, RR - minD); worstSpeed = Math.max(worstSpeed, mx);
    hits += g.contact.hits > 0; pits += g.contact.pits; bumps += g.contact.bumps;
  }
  console.log(`  ${hits} encounters made contact, ${pits} PITs, ${bumps} bumps; worst overlap ${worstOverlap.toFixed(3)} m with one rival and ${worstMulti.toFixed(3)} m when squeezed between several, highest speed ${worstSpeed.toFixed(1)} m/s, ${bad1} NaN`);
  ok(bad1 === 0, 'fuzz: NaN');
  ok(worstOverlap < 0.1, `fuzz: a hull stayed overlapped by ${worstOverlap.toFixed(2)} m`);
  ok(worstMulti < 0.6, `fuzz: squeezed hull overlapped by ${worstMulti.toFixed(2)} m`);
  ok(worstSpeed < 70, `fuzz: speed ran away (${worstSpeed.toFixed(1)} m/s)`);
  ok(hits > 100, 'fuzz: too few encounters made contact to mean anything');
}

console.log('solo is unchanged (no rivals): bit for bit against the boat before this change');
{
  let base = null;
  try {
    const dir = mkdtempSync(join(tmpdir(), 'tidal-base-'));
    const src = execSync('git show 5bae82a:src/game/boat.js', { cwd: new URL('..', import.meta.url).pathname }).toString()
      .replace("from '../math.js'", `from '${pathToFileURL(new URL('../src/math.js', import.meta.url).pathname).href}'`);
    writeFileSync(join(dir, 'boat0.mjs'), src);
    base = (await import(pathToFileURL(join(dir, 'boat0.mjs')).href)).Boat;
  } catch (e) { console.log('  (baseline not available: ' + e.message.split('\n')[0] + ')'); }
  if (base) {
    const A = new base(), B = new Boat(), g = world();
    A.reset(10, 20, 0.3); B.reset(10, 20, 0.3);
    let diff = 0, n = 120 * 40;
    for (let i = 0; i < n; i++) {
      ROUGH.t = i * DT;
      const t = i * DT, inp = { throttle: t < 1 ? 0 : Math.sin(t * 0.7) > -0.6 ? 1 : -0.5, steer: Math.sin(t * 0.9) * 0.9, boost: t > 5 && t < 12 || t > 20 };
      A.step(DT, inp, ROUGH, true);
      own(g, B, inp, ROUGH, true);
      for (const k of ['yaw', 'pitch', 'roll', 'wYaw', 'wPitch', 'wRoll', 'boost', 'wet', 'airTime', 'slam']) if (!Object.is(A[k], B[k])) diff++;
      for (let j = 0; j < 3; j++) if (!Object.is(A.pos[j], B.pos[j]) || !Object.is(A.vel[j], B.vel[j])) diff++;
    }
    console.log(`  ${n} steps compared on a rough sea, ${diff} differences`);
    ok(diff === 0, `solo run differs from before the change (${diff} fields)`);
  }
}

console.log('two clients, each owning one boat, each seeing the other 100 ms late');
function twoClients(name, setup, secs, lat = 0.1, tol = 0.5) {
  const [A, B, ctlA, ctlB] = setup();
  const gA = world(false), gB = world(false);
  const hist = { A: [], B: [] };
  const L = Math.round(lat / DT);
  const snap = (b) => ({ pos: b.pos.slice(), vel: b.vel.slice(), yaw: b.yaw });
  const poseA = new Boat(), poseB = new Boat();   // what B sees of A, what A sees of B
  gA.rivals = [{ pose: poseB }]; gB.rivals = [{ pose: poseA }];
  const put = (p, s) => { p.pos = s.pos.slice(); p.vel = s.vel.slice(); p.yaw = s.yaw; p.pitch = 0; p.roll = 0; };
  let minSeen = 1e9, minTrue = 1e9; const spinMax = [0, 0];
  const out = { gA, gB, A, B, rec: [] };
  for (let i = 0; i < Math.round(secs / DT); i++) {
    hist.A.push(snap(A)); hist.B.push(snap(B));
    const k = Math.max(hist.A.length - 1 - L, 0);
    put(poseA, hist.A[k]); put(poseB, hist.B[k]);
    own(gA, A, ctlA(A, i * DT)); own(gB, B, ctlB(B, i * DT));
    minSeen = Math.min(minSeen, closest(A.pos, A.yaw, poseB.pos, poseB.yaw).d, closest(B.pos, B.yaw, poseA.pos, poseA.yaw).d);
    if (i * DT > 0.3) minTrue = Math.min(minTrue, closest(A.pos, A.yaw, B.pos, B.yaw).d);
    spinMax[0] = Math.max(spinMax[0], Math.abs(A.spin)); spinMax[1] = Math.max(spinMax[1], Math.abs(B.spin));
    if (![A.pos[0], A.pos[2], B.pos[0], B.pos[2], A.yaw, B.yaw].every(isFinite)) { fail(`${name}: NaN`); break; }
  }
  out.minSeen = minSeen; out.minTrue = minTrue; out.spinMax = spinMax;
  out.endGap = closest(A.pos, A.yaw, B.pos, B.yaw).d;
  console.log(`  ${name}: overlap on a screen (stale rival) ${(Math.max(RR - minSeen, 0)).toFixed(2)} m, true overlap ${(Math.max(RR - minTrue, 0)).toFixed(2)} m, end distance ${(out.endGap - RR).toFixed(2)} m, speeds ${A.speed.toFixed(1)} / ${B.speed.toFixed(1)}, bumps ${gA.contact.bumps}/${gB.contact.bumps}, pits ${gA.contact.pits}/${gB.contact.pits}, max spin ${spinMax[0].toFixed(1)}/${spinMax[1].toFixed(1)}`);
  ok(minTrue > RR - tol, `${name}: the true hulls overlap by ${(RR - minTrue).toFixed(2)} m`);
  return out;
}
const sym = {};
sym.head = twoClients('head-on 30+30', () => [mk(-60, 0, 0, 30), mk(60, 0, Math.PI, 30), ctl(0), ctl(Math.PI)], 5);
ok(Math.abs(sym.head.A.speed - sym.head.B.speed) < 0.15 * Math.max(sym.head.A.speed, sym.head.B.speed), 'head-on: the two boats end at different speeds');
ok(sym.head.endGap > RR - 0.5 && sym.head.A.pos[0] < sym.head.B.pos[0], 'head-on: they passed through each other');
{ // reference with no latency, sequential
  const ref = twoClients('head-on 30+30, no latency', () => [mk(-60, 0, 0, 30), mk(60, 0, Math.PI, 30), ctl(0), ctl(Math.PI)], 5, 0);
  const d = Math.hypot(ref.A.pos[0] - sym.head.A.pos[0], ref.A.pos[2] - sym.head.A.pos[2]);
  console.log(`    final position of boat A, 100 ms lag versus none: ${d.toFixed(2)} m apart`);
  ok(d < 12, 'head-on: lag changes the outcome too much');
}
sym.bump = twoClients('bump draft 34 behind 31', () => [mk(-30, 0, 0, 34), mk(-12, 0, 0, 31), ctl(0), ctl(0)], 6);
ok(sym.bump.gA.contact.bumps >= 1 && sym.bump.gB.contact.bumps >= 1, 'bump draft: only one side got the gain');
ok(sym.bump.gA.contact.pits + sym.bump.gB.contact.pits === 0, 'bump draft: a PIT');
sym.pit = twoClients('PIT: B hits A on the quarter', () => [mk(0, 0, 0, 30), (() => { const b = mk(-20.2, -8.6, 0.15, 44); b.boost = 1; return b; })(), (b, t) => ({ throttle: 1, steer: 0 }), (b, t) => ({ ...ctl(0.15)(b), boost: true })], 5, 0.1, 1.6);
ok(sym.pit.gA.contact.pits === 1 && sym.pit.gB.contact.pits === 0, 'PIT: not exactly the victim');
ok(sym.pit.spinMax[0] > 3 && sym.pit.spinMax[1] < 1.0, 'PIT: only the victim should spin');
sym.rub = twoClients('side rub', () => [mk(0, 0, 0, 30), mk(0, 2.3, 0, 30), ctl(0, 0.8), ctl(0, 0.8)], 6);
ok(sym.rub.spinMax[0] < 1 && sym.rub.spinMax[1] < 1, 'side rub: spun');
ok(Math.abs(sym.rub.A.speed - sym.rub.B.speed) < 3, 'side rub: speeds diverge');

console.log(bad ? `${bad} problems` : 'all clear');
process.exit(bad ? 1 : 0);

function strengthOfExport(b, r) { return strengthOf(b, r); }
