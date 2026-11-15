// Courses are buoy gates on open sea. A gate is a pair of marks (port red, starboard green);
// boats pass between them in order.
const unit = (x, z) => { const l = Math.hypot(x, z) || 1; return [x / l, z / l]; };

// turns sharper than this (radians, about 52 degrees) put a pylon on the inside of the corner
const PYLON_TURN = 0.9;

function build({ id, name, blurb, laps, width, loop, pts }) {
  const n = pts.length;
  const gates = pts.map((c, i) => {
    const a = loop ? pts[(i - 1 + n) % n] : pts[Math.max(i - 1, 0)];
    const b = loop ? pts[(i + 1) % n] : pts[Math.min(i + 1, n - 1)];
    const dir = unit(b[0] - a[0], b[1] - a[1]);
    const nrm = [-dir[1], dir[0]]; // to starboard of the direction of travel
    const hw = width / 2;
    // The turn at this gate: the angle between the legs that meet here, and which side the course
    // bends toward (+1 starboard, -1 port). The mark on the inside of a sharp corner is a turn pylon.
    const d1 = unit(c[0] - a[0], c[1] - a[1]), d2 = unit(b[0] - c[0], b[1] - c[1]);
    const end = !loop && (i === 0 || i === n - 1);   // a point-to-point course has no corner at its ends
    const turn = end ? 0 : Math.acos(Math.min(Math.max(d1[0] * d2[0] + d1[1] * d2[1], -1), 1));
    const bend = d1[0] * d2[1] - d1[1] * d2[0] >= 0 ? 1 : -1;
    const pylon = i > 0 && turn > PYLON_TURN ? bend : 0;   // 0: none, -1: the port mark, +1: the starboard mark
    return { c, dir, nrm, hw, number: i, turn, bend, pylon, port: [c[0] - nrm[0] * hw, c[1] - nrm[1] * hw], stbd: [c[0] + nrm[0] * hw, c[1] + nrm[1] * hw] };
  });
  let length = 0;
  for (let i = 0; i < (loop ? n : n - 1); i++) { const a = pts[i], b = pts[(i + 1) % n]; length += Math.hypot(b[0] - a[0], b[1] - a[1]); }
  // gates to pass: a circuit starts and ends on gate 0
  const total = loop ? laps * n + 1 : n;
  return { id, name, blurb, laps: loop ? laps : 1, loop, gates, length: length * (loop ? laps : 1), total };
}

const sprint = [];
for (let i = 0; i < 13; i++) sprint.push([330 * i, 170 * Math.sin(i * 0.85) + 60 * Math.sin(i * 2.1 + 1)]);

export const COURSES = [
  build({
    id: 'circuit', name: 'Breakwater Circuit', blurb: 'Technical loop, 3 laps', laps: 3, width: 34, loop: true,
    pts: [[0, 0], [240, 0], [448, 72], [560, 256], [480, 448], [272, 480], [128, 368], [-64, 416], [-240, 320], [-264, 120], [-160, 0]],
  }),
  build({ id: 'sprint', name: 'Long Reach', blurb: 'Point to point, 4 km', laps: 1, width: 38, loop: false, pts: sprint }),
  build({
    id: 'oval', name: 'Tidal Speedway', blurb: 'Flat-out oval, 3 laps', laps: 3, width: 70, loop: true,
    pts: [[0, 0], [400, 0], [560, 160], [400, 320], [0, 320], [-400, 320], [-560, 160], [-400, 0]],
  }),
];

// Which gate comes next, lap counting and line crossing.
export class Progress {
  constructor(course) { this.course = course; this.next = 0; this.missed = 0; }
  get gate() { return this.course.gates[this.next % this.course.gates.length]; }
  get lap() { return this.course.loop ? Math.min(Math.floor(Math.max(this.next - 1, 0) / this.course.gates.length) + 1, this.course.laps) : 1; }
  get done() { return this.next >= this.course.total; }
  // p0 -> p1: the boat's xz over one step. Returns 'gate', 'lap', 'finish' or null.
  advance(p0, p1, dt) {
    this.missed = Math.max(this.missed - dt, 0);
    if (this.done) return null;
    const g = this.gate;
    const s0 = (p0[0] - g.c[0]) * g.dir[0] + (p0[1] - g.c[1]) * g.dir[1];
    const s1 = (p1[0] - g.c[0]) * g.dir[0] + (p1[1] - g.c[1]) * g.dir[1];
    if (!(s0 < 0 && s1 >= 0)) return null;
    const t = s0 / (s0 - s1);
    const qx = p0[0] + (p1[0] - p0[0]) * t, qz = p0[1] + (p1[1] - p0[1]) * t;
    const lat = (qx - g.c[0]) * g.nrm[0] + (qz - g.c[1]) * g.nrm[1];
    if (Math.abs(lat) > g.hw + 1.5) { if (Math.abs(lat) < g.hw + 120) this.missed = 4; return null; }
    this.next++;
    if (this.done) return 'finish';
    const n = this.course.gates.length;
    return this.course.loop && this.next > 1 && (this.next - 1) % n === 0 ? 'lap' : 'gate';
  }
  // where a reset puts the boat: the last gate passed (or the grid)
  respawn() {
    const gs = this.course.gates;
    if (this.next === 0) return grid(this.course);
    const g = gs[(this.next - 1) % gs.length];
    return { x: g.c[0], z: g.c[1], yaw: Math.atan2(g.dir[1], g.dir[0]) };
  }
}

// start position: behind gate 0, offset sideways by grid slot (slot 0 is the solo slot)
export function grid(course, slot = 0) {
  const g = course.gates[0];
  const back = 28 + 12 * Math.floor(slot / 2), side = slot === 0 ? 0 : (slot % 2 ? -7 : 7);
  return { x: g.c[0] - g.dir[0] * back + g.nrm[0] * side, z: g.c[1] - g.dir[1] * back + g.nrm[1] * side, yaw: Math.atan2(g.dir[1], g.dir[0]) };
}

// Conditions a race can be run in. 'random' picks one of these and a sun position from a seed.
export const CONDITIONS = {
  calm: { name: 'Calm', preset: 'calm', set: {}, sun: [30, 215] },
  breeze: { name: 'Breeze', preset: 'breeze', set: {}, sun: [18, 200] },
  rough: { name: 'Rough', preset: 'rain', set: { wind: 13, rain: 0.03, clouds: 0.82, cloudDark: 0.4, swellHs: 1.6 }, sun: [24, 230] },
  storm: { name: 'Storm', preset: 'storm', set: { wind: 16.5, swellHs: 2.2, rain: 0.06, lightning: 0.5 }, sun: [20, 190] },
};
export function rollConditions(seed) {
  let a = seed >>> 0;
  const r = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const id = ['calm', 'breeze', 'breeze', 'rough', 'rough', 'storm'][Math.floor(r() * 6)];
  return { id, sun: [[9, 16, 28, 44][Math.floor(r() * 4)], Math.floor(r() * 360)] };
}
