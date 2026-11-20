import test from 'node:test';
import assert from 'node:assert/strict';
import { Wake, WK, hullHalfWidth, waterlineHalf, WATERLINE_END, WAKE_GLSL, WAKE_AMT_GLSL } from '../src/game/wake.js';
import { BOAT_ANCHORS } from '../src/game/models/boat.js';
import { Boat } from '../src/game/boat.js';

const smooth = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };

// a Wake without a GL context: only the JS side (record, update, seaOffset) is used
function makeWake(boats) {
  const w = Object.create(Wake.prototype);
  w.game = { renderBoats: () => boats.map((pose) => ({ pose, livery: { color: [1, 0, 0] }, ghost: false })) };
  w.trails = new Map(); w.list = []; w.t = 0;
  return w;
}
// a boat moving along +x at speed v from x = 0, on the water
function sail(wake, boat, v, seconds, dt = 1 / 60) {
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    boat.pos[0] += v * dt;
    boat.vel[0] = v;
    wake.update(dt);
  }
}
const mkBoat = (throttle = 1) => { const b = new Boat(); b.reset(0, 0, 0); b.wet = 1; b.throttle = throttle; b.vel = [0, 0, 0]; return b; };
const eval_ = (w, x, z) => { const s = { h: 0, sx: 0, sz: 0 }; w.seaOffset(x, z, s); return s; };

test('the wake of one boat is finite everywhere and zero far away', () => {
  const b = mkBoat(), w = makeWake([b]);
  sail(w, b, 30, 12);
  for (let x = -400; x <= 600; x += 13) for (let z = -120; z <= 120; z += 7) {
    const s = eval_(w, x, z);
    assert.ok(Number.isFinite(s.h) && Number.isFinite(s.sx) && Number.isFinite(s.sz), `${x},${z}`);
    assert.ok(Math.abs(s.h) < 2, `wake height ${s.h} at ${x},${z}`);
  }
  for (const [x, z] of [[0, 500], [0, -500], [2000, 0], [-3000, 100]]) assert.deepEqual(eval_(w, x, z), { h: 0, sx: 0, sz: 0 });
});

test('a boat does not feel its own wake: nothing ahead of the stern, nothing at the hull', () => {
  const b = mkBoat(), w = makeWake([b]);
  sail(w, b, 30, 10);
  const stern = b.pos[0] + BOAT_ANCHORS.transom[0];
  for (const dx of [1, 5, 20, 100]) assert.equal(eval_(w, stern + dx, 0).h, 0, `ahead by ${dx}`);
  // at the hull points the physics samples (all ahead of the stern)
  for (const [lx, lz] of [[2.9, -0.6], [2.9, 0.6], [-3.1, -1.0], [-3.1, 1.0]]) {
    const s = eval_(w, b.pos[0] + lx, lz);
    assert.ok(Math.abs(s.h) < 0.02, `the boat's own wake lifts its hull point (${lx}, ${lz}) by ${s.h}`);
  }
});

test('matches the documented formula on a straight run', () => {
  const v = 30, b = mkBoat(), w = makeWake([b]);
  sail(w, b, v, 14);
  const W = Math.min(v / 36, 1.3) * smooth(0.05, 0.5, 1);
  let checked = 0;
  for (const S of [15, 30, 60, 100, 150]) for (const lat of [0, 3, 9, 20, 40]) {
    // a point S metres behind the stern, lat metres to the side: on a straight path the nearest point is straight across
    const x = b.pos[0] + BOAT_ANCHORS.transom[0] - S, z = lat;
    const age = S / v;
    const wA = 1 + 0.07 * S, u = (lat - WK.K * (S + WK.APEX)) / wA;
    const E1 = Math.exp(-u * u), E2 = Math.exp(-(u + 1.4) * (u + 1.4));
    const amp = 0.8 * W * W * Math.exp(-S / 110) * smooth(2, 12, S) * (1 - smooth(7, 12, age));
    const want = amp * (E1 - 0.35 * E2);
    const got = eval_(w, x, z).h;
    assert.ok(Math.abs(got - want) < 2e-3, `S ${S} lat ${lat}: got ${got}, formula ${want}`);
    if (Math.abs(want) > 0.02) checked++;
  }
  assert.ok(checked >= 2, 'the test point set reaches the arms');
  // the slope is the gradient of the height: compare to a finite difference across the path
  const S = 20, x = b.pos[0] + BOAT_ANCHORS.transom[0] - S, z = WK.K * (S + WK.APEX), e = 0.01;
  const hp = eval_(w, x, z + e).h, hm = eval_(w, x, z - e).h, s = eval_(w, x, z);
  assert.ok(Math.abs(s.sz - (hp - hm) / (2 * e)) < 0.02, `slope ${s.sz} vs ${(hp - hm) / (2 * e)}`);
});

test('the arms lie at the Kelvin angle: the crest is where the formula puts it', () => {
  const b = mkBoat(), w = makeWake([b]);
  sail(w, b, 33, 12);
  const S = 25, x = b.pos[0] + BOAT_ANCHORS.transom[0] - S;
  let best = -1, at = 0;
  for (let z = 0; z < 30; z += 0.1) { const h = eval_(w, x, z).h; if (h > best) { best = h; at = z; } }
  const crest = WK.K * (S + WK.APEX);
  assert.ok(Math.abs(at - crest) < 1.2, `crest at ${at}, expected near ${crest}`);
  // mirror symmetric about the path
  assert.ok(Math.abs(eval_(w, x, at).h - eval_(w, x, -at).h) < 1e-5);
});

test('a faster boat makes a bigger wake, a boat on the spot makes none', () => {
  const peak = (v) => {
    const b = mkBoat(), w = makeWake([b]);
    sail(w, b, v, 12);
    let m = 0; const x0 = b.pos[0] + BOAT_ANCHORS.transom[0];
    for (let S = 5; S < 120; S += 2) for (let z = 0; z < 30; z += 0.5) m = Math.max(m, Math.abs(eval_(w, x0 - S, z).h));
    return m;
  };
  const slow = peak(10), fast = peak(34);
  assert.ok(fast > slow * 3, `${fast} vs ${slow}`);
  assert.ok(peak(0.01) < 1e-3);
});

test('the wake decays: after the boat stops it is gone within the documented age', () => {
  const b = mkBoat(), w = makeWake([b]);
  sail(w, b, 30, 10);
  const x0 = b.pos[0] + BOAT_ANCHORS.transom[0];
  const sample = () => { let m = 0; for (let S = 3; S < 150; S += 1.5) for (let z = -30; z < 30; z += 0.7) m = Math.max(m, Math.abs(eval_(w, x0 - S, z).h)); return m; };
  const t0 = sample();
  assert.ok(t0 > 0.05, `a wake to decay: ${t0}`);
  // the boat stops dead (hull position and speed): time passes
  b.vel[0] = 0;
  const marks = [];
  for (let s = 0; s < 14; s++) { for (let i = 0; i < 60; i++) w.update(1 / 60); marks.push(sample()); }
  assert.ok(marks[9] < t0 * 0.7, 'much smaller after nine seconds (the height fades with age from 7 s to 12 s)');
  for (let i = 1; i < marks.length; i++) assert.ok(marks[i] <= marks[i - 1] + 0.02, `monotone decay: ${marks.join(' ')}`);
  assert.ok(marks[marks.length - 1] < 1e-3, `gone after ${WK.AGE + 2} s: ${marks[marks.length - 1]}`);
});

test('a teleport (reset) starts a new trail instead of drawing a line across the sea', () => {
  const b = mkBoat(), w = makeWake([b]);
  sail(w, b, 30, 5);
  b.pos[0] = 3000; b.pos[2] = 800;
  w.update(1 / 60);
  const tr = w.trails.get(b);
  assert.equal(tr.n, 2);
  assert.equal(eval_(w, 1500, 400).h, 0);
});

test('trail memory is bounded, and a boat that leaves the list loses its trail', () => {
  const b = mkBoat(), w = makeWake([b]);
  sail(w, b, 36, 60);
  const tr = w.trails.get(b);
  assert.ok(tr.n <= WK.N);
  assert.ok(tr.s[tr.n - 1] < 36 * (WK.AGE + 2) + 10);
  w.game.renderBoats = () => [];
  w.update(1 / 60);
  assert.equal(w.trails.size, 0);
});

test('at most four boats are tracked', () => {
  const boats = Array.from({ length: 6 }, (_, i) => { const b = mkBoat(); b.pos[2] = i * 30; return b; });
  const w = makeWake(boats);
  w.update(1 / 60);
  assert.equal(w.list.length, WK.BOATS);
});

test('two boats: the second is lifted by the first one\'s wake', () => {
  const lead = mkBoat(), chase = mkBoat();
  chase.pos[0] = -60; chase.pos[2] = 0;
  const w = makeWake([lead, chase]);
  sail(w, lead, 30, 0.01);   // just to register
  for (let i = 0; i < 720; i++) { lead.pos[0] += 0.5; chase.pos[0] += 0.5; lead.vel[0] = chase.vel[0] = 30; w.update(1 / 60); }
  // a point on the lead's wake arm, beside the chaser's own path: the sea there is lifted by the lead only
  const S = 40, x = lead.pos[0] + BOAT_ANCHORS.transom[0] - S, z = WK.K * (S + WK.APEX);
  const total = eval_(w, x, z).h;
  assert.ok(Math.abs(total) > 0.02, `the lead's arm is felt: ${total}`);
  assert.ok(Number.isFinite(total));
});

test('hull outline helpers are sane', () => {
  assert.equal(hullHalfWidth(BOAT_ANCHORS.transom[0] - 1), 0);
  assert.equal(hullHalfWidth(BOAT_ANCHORS.bow[0] + 1), 0);
  const mid = hullHalfWidth((BOAT_ANCHORS.transom[0] + BOAT_ANCHORS.bow[0]) / 2);
  assert.ok(mid > 0.3 && mid <= BOAT_ANCHORS.halfBeam + 1e-9);
  assert.equal(waterlineHalf(WATERLINE_END + 1), 0);
  assert.ok(waterlineHalf(BOAT_ANCHORS.transom[0] + 0.5) > 0);
});

test('the GLSL carries the same constants as the JS (the two fields must agree)', () => {
  // the shader's amplitude, decay and arm lines are the ones written in JS; if one side is edited, this fails
  for (const frag of ['0.8 * W * W * exp(-S / 110.0) * smoothstep(2.0, 12.0, S) * (1.0 - smoothstep(7.0, 12.0, age))', 'exp(-u * u), E2 = exp(-(u + 1.4) * (u + 1.4))', 'float wA = 1.0 + 0.07 * S']) assert.ok(WAKE_GLSL.includes(frag), frag);
  assert.ok(WAKE_GLSL.includes(`WK_K = ${WK.K.toFixed(3)}`) && WAKE_GLSL.includes(`WK_APEX = ${WK.APEX.toFixed(2)}`));
  assert.ok(WAKE_AMT_GLSL.includes('wakeAmounts'));
});
