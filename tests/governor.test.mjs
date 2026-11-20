import test from 'node:test';
import assert from 'node:assert/strict';
import { Governor, levelsAt, MAX_RUNG } from '../src/perf.js';

const feed = (g, ms, seconds, opts) => { let moved = 0; for (let t = 0; t < seconds; t += ms / 1000) moved += g.tick(ms / 1000, opts); return moved; };

test('levelsAt gives up spray, then water shadow, then boat shadows, then resolution, never going back', () => {
  let prev = levelsAt(0);
  assert.deepEqual(prev, { spray: 1, waterShadow: 1, shadows: 1, scale: 1 });
  for (let r = 1; r <= MAX_RUNG + 3; r++) {
    const lv = levelsAt(r);
    for (const k of ['spray', 'waterShadow', 'shadows', 'scale']) { assert.ok(lv[k] <= prev[k] + 1e-12 && lv[k] >= 0 && lv[k] <= 1, `${k} at ${r}`); }
    if (lv.waterShadow < 1) assert.equal(lv.spray, 0);
    if (lv.shadows < 1) assert.equal(lv.waterShadow, 0);
    if (lv.scale < 1) assert.equal(lv.shadows, 0);
    prev = lv;
  }
  assert.ok(levelsAt(MAX_RUNG).scale >= 0.5);
});

test('slow frames step the quality down, then stop at the last rung', () => {
  const g = new Governor();
  feed(g, 33, 60);
  assert.equal(g.rung, MAX_RUNG);
  assert.equal(feed(g, 33, 10), 0);
});

test('steady 60 fps does nothing from rung 0', () => {
  const g = new Governor();
  assert.equal(feed(g, 16.6, 60), 0);
  assert.equal(g.rung, 0);
});

test('a single hitch does not step down', () => {
  const g = new Governor();
  feed(g, 16.6, 20);
  g.tick(0.4);
  assert.equal(feed(g, 16.6, 10), 0);
  assert.equal(g.rung, 0);
});

test('nothing is decided while paused or hidden', () => {
  const g = new Governor();
  assert.equal(feed(g, 100, 30, { active: false }), 0);
  assert.equal(g.rung, 0);
});

test('after trouble clears it takes a step back up, but only after holding 60 for a while', () => {
  const g = new Governor();
  feed(g, 33, 14);
  const down = g.rung;
  assert.ok(down > 0);
  assert.equal(feed(g, 16.6, 4), 0, 'not at once');
  feed(g, 16.6, 40);
  assert.ok(g.rung < down);
});

test('the rung is capped by maxRung (a fixed ?scale= pins the resolution)', () => {
  const g = new Governor({ maxRung: 4 });
  feed(g, 40, 60);
  assert.equal(g.rung, 4);
});
