// Shared helpers for the unit tests: deterministic seas and a fake game for the collision code.
import { Boat } from '../src/game/boat.js';

// a flat sea at height 0
export const flatSea = () => { const s = { h: 0, sx: 0, sz: 0 }; return () => s; };

// a deterministic wavy sea: two crossing sinusoids (height and exact slope), amplitude a metres
export function waveSea(a = 0.5, t = { v: 0 }) {
  const s = { h: 0, sx: 0, sz: 0 };
  return (i, x, z) => {
    const k1 = 0.21, k2 = 0.13, w1 = 1.4, w2 = 1.1;
    const p1 = k1 * x + 0.4 * k1 * z - w1 * t.v, p2 = 0.3 * k2 * x - k2 * z - w2 * t.v;
    s.h = a * (Math.sin(p1) + 0.6 * Math.sin(p2));
    s.sx = a * (k1 * Math.cos(p1) + 0.6 * 0.3 * k2 * Math.cos(p2));
    s.sz = a * (0.4 * k1 * Math.cos(p1) - 0.6 * k2 * Math.cos(p2));
    return s;
  };
}

// run a boat for `seconds` of physics at 120 Hz; inputFn(t) -> { throttle, steer, boost }; onStep(boat, t) optional
export function run(boat, sea, inputFn, seconds, onStep) {
  const dt = 1 / 120, n = Math.round(seconds * 120);
  for (let i = 0; i < n; i++) {
    const t = i * dt;
    boat.step(dt, inputFn(t), sea, true);
    if (onStep) onStep(boat, t);
  }
  return boat;
}

export const stateOf = (b) => new Float64Array([...b.pos, ...b.vel, b.yaw, b.pitch, b.roll, b.wYaw, b.wPitch, b.wRoll, b.boost, b.wet, b.airTime, b.slam]);
export const sameBits = (a, b) => Buffer.from(a.buffer).equals(Buffer.from(b.buffer));
export const allFinite = (b) => [...stateOf(b)].every(Number.isFinite);
export function makeBoat(x = 0, z = 0, yaw = 0) { const b = new Boat(); b.reset(x, z, yaw); return b; }

// a fake game for Collisions: a height field and a list of solids
export function fakeGame(field, colliders = [], course = null) {
  return { land: { field }, systems: colliders.length ? [{ colliders }] : [], course };
}
