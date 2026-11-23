import test from 'node:test';
import assert from 'node:assert/strict';
import { pauseAction } from '../src/game/pause.js';

// a minimal window for Input (it listens for key events on window and reads navigator.getGamepads)
class Win extends EventTarget {}
globalThis.window = new Win();
globalThis.HTMLInputElement = class {};
const { Input } = await import('../src/game/input.js');
let pads = [];
Object.defineProperty(globalThis.navigator, 'getGamepads', { value: () => pads, configurable: true, writable: true });

const key = (code, down = true, extra = {}) => { const e = new Event(down ? 'keydown' : 'keyup'); Object.assign(e, { code, repeat: false, preventDefault() {} }, extra); window.dispatchEvent(e); };
const pad = (buttons = {}, axes = [0, 0]) => ({ connected: true, axes, buttons: Array.from({ length: 17 }, (_, i) => ({ value: buttons[i] || 0 })) });

test('keyboard maps to throttle, steer, boost and one-shot actions', () => {
  pads = [];
  const inp = new Input();
  key('KeyW');
  let s = inp.poll(1 / 60);
  assert.equal(s.throttle, 1);
  key('KeyS'); s = inp.poll(1 / 60);
  assert.equal(s.throttle, 0, 'both pedals');
  key('KeyW', false); s = inp.poll(1 / 60);
  assert.equal(s.throttle, -1);
  key('KeyS', false);
  key('Space'); assert.equal(inp.poll(1 / 60).boost, true);
  key('Space', false); assert.equal(inp.poll(1 / 60).boost, false);
  key('Escape'); key('KeyC'); key('KeyR');
  s = inp.poll(1 / 60);
  assert.deepEqual([...s.pressed].sort(), ['camera', 'pause', 'reset']);
  assert.equal(inp.poll(1 / 60).pressed.size, 0, 'edges are consumed');
  key('KeyP', true, { repeat: true });
  assert.equal(inp.poll(1 / 60).pressed.size, 0, 'a held key does not repeat the action');
});

test('steering eases toward the key instead of jumping', () => {
  pads = [];
  const inp = new Input();
  key('KeyD');
  const s1 = inp.poll(1 / 60).steer;
  assert.ok(s1 > 0 && s1 < 0.1);
  for (let i = 0; i < 60; i++) inp.poll(1 / 60);
  assert.equal(inp.poll(1 / 60).steer, 1);
  key('KeyD', false);
  for (let i = 0; i < 60; i++) inp.poll(1 / 60);
  assert.equal(inp.poll(1 / 60).steer, 0);
});

test('gamepad: triggers, stick with dead zone, buttons', () => {
  const inp = new Input();
  pads = [pad({ 7: 0.8 }, [0.05, 0])];
  let s = inp.poll(1 / 60);
  assert.ok(Math.abs(s.throttle - 0.8) < 1e-9); assert.equal(s.steer, 0, 'inside the dead zone');
  pads = [pad({ 6: 1 }, [1, 0])];
  s = inp.poll(1 / 60);
  assert.equal(s.throttle, -1); assert.ok(Math.abs(s.steer - 1) < 1e-9);
  pads = [pad({ 0: 1 })];
  s = inp.poll(1 / 60);
  assert.equal(s.boost, true);
  assert.ok(s.pressed.has('confirm'));
  pads = [{ connected: false, axes: [], buttons: [] }, null];
  assert.doesNotThrow(() => inp.poll(1 / 60));
  pads = [];
});

test('gamepad Start is a pause press, once per press', () => {
  const inp = new Input();
  pads = [pad({ 9: 1 })];
  assert.ok(inp.poll(1 / 60).pressed.has('pause'));
  assert.ok(!inp.poll(1 / 60).pressed.has('pause'), 'held');
  pads = [pad()];
  inp.poll(1 / 60);
  pads = [pad({ 9: 1 })];
  assert.ok(inp.poll(1 / 60).pressed.has('pause'));
  pads = [];
});

test('a pause press with Settings open closes Settings; it never resumes the race', () => {
  assert.equal(pauseAction({ state: 'racing', settingsOpen: true }), 'closeSettings');
  assert.equal(pauseAction({ state: 'countdown', settingsOpen: true }), 'closeSettings');
  assert.equal(pauseAction({ state: 'racing', settingsOpen: false }), 'toggle');
  assert.equal(pauseAction({ state: 'finished', settingsOpen: false }), 'toggle');
  assert.equal(pauseAction({ state: 'menu', settingsOpen: false }), 'none');
  assert.equal(pauseAction({ state: 'menu', settingsOpen: true }), 'none');
});
