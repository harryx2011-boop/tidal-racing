import test from 'node:test';
import assert from 'node:assert/strict';
import { Settings, SWATCHES, STRIPES, TIERS } from '../src/game/settings.js';

const KEY = 'tidal.settings';
const mem = (init) => { const m = new Map(init ? [[KEY, init]] : []); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); } }; };

test('defaults with no storage at all (private mode, node)', () => {
  const s = new Settings(null);
  assert.equal(s.quality, null); assert.equal(s.volume, 0.9); assert.equal(s.muted, false); assert.equal(s.auto, true);
  assert.deepEqual(s.livery().color.length, 3);
  s.update({ volume: 0.5 });          // saving into nothing must not throw
  assert.equal(s.volume, 0.5);
});

test('importing the module in a page without localStorage does not throw (the singleton)', async () => {
  const m = await import('../src/game/settings.js');
  assert.ok(m.settings instanceof Settings);
});

test('storage that throws on read or write is survived', () => {
  const bad = { getItem() { throw new DOMException('denied', 'SecurityError'); }, setItem() { throw new Error('QuotaExceededError'); } };
  const s = new Settings(bad);
  assert.equal(s.volume, 0.9);
  assert.doesNotThrow(() => s.update({ swatch: 3, number: 42 }));
  assert.equal(s.swatch, 3); assert.equal(s.number, 42);
});

test('corrupt stored text gives the defaults', () => {
  for (const raw of ['{not json', '', 'null', '5', '"str"', '[1,2]', 'true', '{"volume":', '\u0000\u0001']) {
    const s = new Settings(mem(raw));
    assert.equal(s.volume, 0.9, raw); assert.equal(s.swatch, 0); assert.equal(s.number, 7); assert.equal(s.quality, null);
  }
});

test('every stored field is validated', () => {
  const s = new Settings(mem(JSON.stringify({
    quality: 'ultra', volume: 7, muted: 'yes', speedFx: 0, auto: null, fx: { spray: 'x', waterShadow: -3, shadows: 0.5, other: 1 },
    swatch: 99, stripe: -4, number: 1234.6,
  })));
  assert.equal(s.quality, null);                 // not a tier
  assert.equal(s.volume, 1);                     // clamped
  assert.equal(s.muted, true); assert.equal(s.speedFx, false); assert.equal(s.auto, false);
  assert.deepEqual(s.fx, { spray: 1, waterShadow: 0, shadows: 0.5 });
  assert.equal(s.swatch, SWATCHES.length - 1); assert.equal(s.stripe, 0); assert.equal(s.number, 99);
  const t = new Settings(mem(JSON.stringify({ volume: 'loud', fx: 'bad', swatch: {}, number: [] })));
  assert.equal(t.volume, 0.9);                   // non-numbers fall back to the default
  assert.deepEqual(t.fx, { spray: 1, waterShadow: 1, shadows: 1 });
  assert.equal(t.swatch, 0);
});

test('an unknown field is ignored and does not leak into the saved object', () => {
  const st = mem(JSON.stringify({ volume: 0.3, evil: 1, __proto__: { x: 1 } }));
  const s = new Settings(st);
  s.save();
  const o = JSON.parse(st.m.get(KEY));
  assert.equal(o.volume, 0.3); assert.ok(!('evil' in o));
  assert.equal({}.x, undefined);
});

test('settings round trip through storage', () => {
  const st = mem();
  const a = new Settings(st);
  a.update({ quality: 'high', volume: 0.25, muted: true, speedFx: false, auto: false, fx: { spray: 0.4, waterShadow: 0, shadows: 1 }, swatch: 5, stripe: 2, number: 23 });
  const b = new Settings(st);
  for (const k of ['quality', 'volume', 'muted', 'speedFx', 'auto', 'swatch', 'stripe', 'number']) assert.equal(b[k], a[k], k);
  assert.deepEqual(b.fx, a.fx);
  assert.deepEqual(b.livery(), a.livery());
});

test('listeners are told what changed', () => {
  const s = new Settings(mem()), seen = [];
  s.onChange((S, patch) => seen.push(patch));
  s.update({ volume: 0.1 }); s.update({ muted: true });
  assert.deepEqual(seen, [{ volume: 0.1 }, { muted: true }]);
});

test('tier: the address wins over the saved choice, which wins over the default', () => {
  const s = new Settings(mem(JSON.stringify({ quality: 'low' })));
  assert.equal(s.tier('high', 'medium'), 'high');
  assert.equal(s.tier(null, 'medium'), 'low');
  assert.equal(s.tier('bogus', 'medium'), 'low');
  assert.equal(new Settings(null).tier(null, 'medium'), 'medium');
  assert.deepEqual(TIERS, ['low', 'medium', 'high']);
});

test('livery returns a copy of the colour', () => {
  const s = new Settings(null);
  const l = s.livery(); l.color[0] = 99;
  assert.notEqual(s.livery().color[0], 99);
  assert.equal(STRIPES.length, 4);
  for (const sw of SWATCHES) assert.ok(sw.color.every((c) => c >= 0 && c <= 1));
});
