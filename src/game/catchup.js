// Catch-up: a boat well behind the leader loses part of its water drag, so a gap closes on the straights.
// It is the long-range cousin of the slipstream, which only reaches 25 m (draft.js adds the two together).
// Only my own boat is changed, from what every client already has: the gates each player has passed (the
// host's standing) and where their boats are. Nothing is given inside MIN metres of the leader, the leader
// is never slowed, and with no session (solo, the scripted rival) there is no catch-up at all.
import { smoothstep } from '../math.js';

export const MIN = 40, FULL = 400;   // metres behind the leader: where the help starts, and where it is whole
export const CATCH_CUT = 0.14;       // share of drag removed when whole (top speed 36 -> about 39 m/s)

const chains = new WeakMap();        // course -> metres from gate 0 to each gate, and round a lap
function chain(course) {
  let k = chains.get(course);
  if (k) return k;
  const gs = course.gates, to = [0];
  for (let i = 1; i < gs.length; i++) to.push(to[i - 1] + Math.hypot(gs[i].c[0] - gs[i - 1].c[0], gs[i].c[1] - gs[i - 1].c[1]));
  const last = gs[gs.length - 1].c;
  k = { to, lap: to[gs.length - 1] + Math.hypot(gs[0].c[0] - last[0], gs[0].c[1] - last[1]) };
  chains.set(course, k);
  return k;
}

// Metres raced: the gate centres joined up as far as gate `next`, less what is left to it. Past that gate
// (the host counts a rival's gate a moment after it is crossed) the distance beyond it is added instead,
// so the figure never runs backwards at a gate.
export function metres(course, next, xz) {
  const gs = course.gates, k = chain(course), g = gs[next % gs.length];
  const dx = xz[0] - g.c[0], dz = xz[1] - g.c[1], s = dx * g.dir[0] + dz * g.dir[1];
  return Math.floor(next / gs.length) * k.lap + k.to[next % gs.length] + (s >= 0 ? s : -Math.hypot(dx, dz));
}

export const cutFor = (gap) => CATCH_CUT * smoothstep(MIN, FULL, gap);

// how far the leader is ahead of me along the course, in metres (0 when I lead, or outside a room)
export function gapToLeader(game) {
  const st = game.net && game.net.standing;
  if (!st || !game.course) return 0;
  const b = game.boat.pos, mine = metres(game.course, game.progress.next, [b[0], b[2]]);
  let lead = mine;
  for (const r of game.rivals) {
    const row = st.find((x) => x.id === r.id);
    if (!row || row.fin != null || row.gone) continue;   // finished or left: nobody to chase
    lead = Math.max(lead, metres(game.course, row.next, [r.pose.pos[0], r.pose.pos[2]]));
  }
  return lead - mine;
}
