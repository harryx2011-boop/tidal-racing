import test from 'node:test';
import assert from 'node:assert/strict';
import { COURSES } from '../src/game/courses.js';
import { Boat } from '../src/game/boat.js';
import { Draft } from '../src/game/draft.js';
import { metres, cutFor, gapToLeader, MIN, FULL, CATCH_CUT } from '../src/game/catchup.js';

const circuit = COURSES.find((c) => c.id === 'circuit');
// a point d metres past gate i's centre along its direction of travel (negative: before it)
const at = (course, i, d) => { const g = course.gates[i % course.gates.length]; return [g.c[0] + g.dir[0] * d, 0, g.c[1] + g.dir[1] * d]; };
// a game as draft.js sees it in a room: me, rivals and the host's standing
function room(course, me, others) {
  const boat = new Boat();
  const mine = at(course, me.next, me.d);
  boat.reset(mine[0], mine[2], 0);
  const rivals = others.map((o, i) => { const p = at(course, o.next, o.d); return { id: i + 1, pose: { pos: p, vel: [0, 0, 0], yaw: 0, speed: 0 } }; });
  const standing = [{ id: 0, next: me.next, fin: null, gone: false }, ...others.map((o, i) => ({ id: i + 1, next: o.next, fin: o.fin ?? null, gone: !!o.gone }))];
  return { boat, rivals, course, progress: { next: me.next }, net: { standing } };
}

test('metres raced grows steadily through a gate and from gate to gate', () => {
  const xz = (p) => [p[0], p[2]];
  const before = metres(circuit, 3, xz(at(circuit, 3, -20))), on = metres(circuit, 3, xz(at(circuit, 3, 0)));
  const pastOld = metres(circuit, 3, xz(at(circuit, 3, 15))), pastNew = metres(circuit, 4, xz(at(circuit, 3, 15)));
  assert.ok(Math.abs(on - before - 20) < 1e-6, 'approaching a gate head-on counts metre for metre');
  assert.ok(Math.abs(pastOld - on - 15) < 1e-6, 'a boat just past a gate the host has not counted yet keeps gaining');
  assert.ok(pastNew > on && Math.abs(pastNew - pastOld) < 30, 'counting the gate does not make the boat jump far');
  const lap = metres(circuit, circuit.gates.length, xz(at(circuit, 0, 0))) - metres(circuit, 0, xz(at(circuit, 0, 0)));
  assert.ok(lap > 1000, `a lap of the circuit is long (${lap.toFixed(0)} m)`);
});

test('the help starts beyond the slipstream and is whole far behind', () => {
  assert.equal(cutFor(0), 0);
  assert.equal(cutFor(MIN), 0);
  assert.ok(cutFor((MIN + FULL) / 2) > 0 && cutFor((MIN + FULL) / 2) < CATCH_CUT);
  assert.equal(cutFor(FULL), CATCH_CUT);
  assert.equal(cutFor(5000), CATCH_CUT);
  for (let g = 0; g < 600; g += 10) assert.ok(cutFor(g + 10) >= cutFor(g), 'more help the further behind');
});

test('the gap is measured to the leader, and the leader has none', () => {
  const behind = room(circuit, { next: 2, d: -30 }, [{ next: 4, d: -10 }, { next: 2, d: -5 }]);
  assert.ok(gapToLeader(behind) > 100, 'two gates behind is a real gap');
  const leading = room(circuit, { next: 5, d: -10 }, [{ next: 4, d: -10 }, { next: 2, d: -5 }]);
  assert.equal(gapToLeader(leading), 0);
  const leaderDone = room(circuit, { next: 2, d: -30 }, [{ next: 9, d: 0, fin: 61.2 }, { next: 9, d: 0, gone: true }]);
  assert.equal(gapToLeader(leaderDone), 0, 'finished and departed boats are not chased');
  assert.equal(gapToLeader({ ...behind, net: null }), 0, 'no session, no catch-up');
});

test('a boat far behind loses drag; the leader, a solo boat and a boat on the grid do not', () => {
  const far = room(circuit, { next: 1, d: -30 }, [{ next: 6, d: -10 }]);
  const d1 = new Draft(far);
  d1.step(far.boat, 1 / 120, true);
  assert.ok(far.boat.dragCut > 0.1 && far.boat.dragCut <= 0.3, `far behind: drag cut ${far.boat.dragCut}`);
  assert.ok(d1.catch > 0.9);
  d1.step(far.boat, 1 / 120, false);
  assert.equal(far.boat.dragCut, 0, 'no help before the start');
  assert.equal(d1.catch, 0);

  const lead = room(circuit, { next: 6, d: -10 }, [{ next: 1, d: -30 }]);
  const d2 = new Draft(lead);
  d2.step(lead.boat, 1 / 120, true);
  assert.equal(lead.boat.dragCut, 0);

  const solo = room(circuit, { next: 1, d: -30 }, []);
  const d3 = new Draft(solo);
  d3.step(solo.boat, 1 / 120, true);
  assert.equal(solo.boat.dragCut, 0);
});
