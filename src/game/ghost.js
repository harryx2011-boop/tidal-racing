// Best times and the ghost, kept apart from game.js so that they can be tested in node (game.js pulls in the
// DOM and GL). A stored best is { time, ghost }: the race time in seconds and the pose of the run, six floats
// (x, y, z, yaw, pitch, roll) every 1 / GHOST_HZ seconds, packed as base64 of the Float32Array's bytes.
export const GHOST_HZ = 10;
export const GHOST_STRIDE = 6;

export const angDiff = (a, b) => { let d = (a - b) % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return d; };

export function encodeGhost(ghost) {
  const u8 = new Uint8Array(ghost.buffer, ghost.byteOffset, ghost.length * 4);
  let bin = '';
  for (let i = 0; i < u8.length; i += 8192) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 8192));
  return btoa(bin);
}

// null for anything that is not a well-formed ghost (storage is user-editable and versions come and go)
export function decodeGhost(text) {
  const bin = atob(text);
  if (bin.length % (4 * GHOST_STRIDE) !== 0 || bin.length === 0) return null;
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const g = new Float32Array(u8.buffer);
  for (let i = 0; i < g.length; i++) if (!Number.isFinite(g[i])) return null;
  return g;
}

export function ghostStore(getStorage = () => globalThis.localStorage) {
  return {
    key: (c, w) => `tidal.best3.${c}.${w}`,   // 3: the courses moved close to the coast, so older times and ghosts do not apply
    load(c, w) {
      try {
        const o = JSON.parse(getStorage().getItem(this.key(c, w)));
        if (!o || typeof o !== 'object' || !Number.isFinite(o.time) || o.time <= 0) return null;
        const ghost = decodeGhost(o.ghost);
        return ghost ? { time: o.time, ghost } : null;
      } catch { return null; }
    },
    save(c, w, time, ghost) {
      try { getStorage().setItem(this.key(c, w), JSON.stringify({ time, ghost: encodeGhost(ghost) })); } catch { /* storage full or blocked: the run still counts for this session */ }
    },
  };
}

// Pose of a recorded run at race time t, written into `out` (a Boat: pos, yaw, pitch, roll). False past the end.
export function ghostPose(g, t, out) {
  const n = g.length / GHOST_STRIDE, f = t * GHOST_HZ, i = Math.floor(f);
  if (!(f >= 0) || i >= n - 1) return false;
  const k = f - i, a = i * GHOST_STRIDE, b = a + GHOST_STRIDE;
  for (let j = 0; j < 3; j++) out.pos[j] = g[a + j] + (g[b + j] - g[a + j]) * k;
  out.yaw = g[a + 3] + angDiff(g[b + 3], g[a + 3]) * k;
  out.pitch = g[a + 4] + (g[b + 4] - g[a + 4]) * k;
  out.roll = g[a + 5] + (g[b + 5] - g[a + 5]) * k;
  return true;
}
