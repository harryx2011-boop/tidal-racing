// Wire formats and small pure helpers for multiplayer (no DOM, no game imports: tested in node).
//
// Messages are either a plain object { t: 'type', ... } (lobby, start, race results, app messages) or a
// binary pose packet (POSE_BYTES long, see encodePose). Both survive PeerJS and BroadcastChannel as they are.

export const MAX_PLAYERS = 4;
export const PROTOCOL = 1;
export const PEER_PREFIX = 'tidalrace-';

// Room codes: five characters from an alphabet with no 0/O/1/I, easy to read out and type.
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LEN = 5;

export function makeRoomCode(rand = Math.random) {
  let s = '';
  for (let i = 0; i < CODE_LEN; i++) s += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length) % CODE_ALPHABET.length];
  return s;
}
// what a person typed -> a code in canonical form, or '' when it cannot be one
export function normalizeCode(s) {
  const c = String(s ?? '').toUpperCase().replace(/[\s-]+/g, '');
  return c.length === CODE_LEN && [...c].every((ch) => CODE_ALPHABET.includes(ch)) ? c : '';
}
export const isValidCode = (s) => normalizeCode(s) !== '';
// the room in a page address (?room=CODE): '' when absent, null when present but malformed
export function roomFromSearch(search) {
  const v = new URLSearchParams(search).get('room');
  if (v == null) return '';
  return normalizeCode(v) || null;
}
export function roomLink(href, code) {
  const u = new URL(href);
  u.search = ''; u.hash = '';
  u.searchParams.set('room', code);
  // keep the transport choice so a local test link opens on the same transport
  return u.toString();
}
// player names: short, plain, safe for the bitmap font
export function cleanName(s, fallback = 'Racer') {
  const n = String(s ?? '').replace(/[^A-Za-z0-9 _.\-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 12);
  return n || fallback;
}

// ---- pose packet: 53 bytes, little endian ----
//  0 u8 kind (1)   1 u8 player id   2 u16 sequence   4 f64 host-clock ms   12 f32x3 pos   24 f32x3 vel
// 36 f32 yaw  40 f32 pitch  44 f32 roll  48 u8 wet (0..255)  49 i8 throttle (x127)  50 u8 flags (1 boosting)
// 51 u16 next gate (progress.next)
export const POSE_KIND = 1;
export const POSE_BYTES = 53;

export function encodePose(p) {
  const b = new ArrayBuffer(POSE_BYTES), v = new DataView(b);
  v.setUint8(0, POSE_KIND); v.setUint8(1, p.id & 255); v.setUint16(2, p.seq & 65535, true); v.setFloat64(4, p.t, true);
  for (let i = 0; i < 3; i++) { v.setFloat32(12 + 4 * i, p.pos[i], true); v.setFloat32(24 + 4 * i, p.vel[i], true); }
  v.setFloat32(36, p.yaw, true); v.setFloat32(40, p.pitch, true); v.setFloat32(44, p.roll, true);
  v.setUint8(48, Math.round(Math.min(Math.max(p.wet, 0), 1) * 255));
  v.setInt8(49, Math.round(Math.min(Math.max(p.throttle, -1), 1) * 127));
  v.setUint8(50, p.boosting ? 1 : 0);
  v.setUint16(51, Math.min(p.next | 0, 65535), true);
  return b;
}
// accepts an ArrayBuffer or any typed-array view of one (a transport may hand back either); null if it is not a pose
export function decodePose(buf) {
  let ab = buf;
  if (ArrayBuffer.isView(buf)) ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  if (!(ab instanceof ArrayBuffer) || ab.byteLength !== POSE_BYTES) return null;
  const v = new DataView(ab);
  if (v.getUint8(0) !== POSE_KIND) return null;
  const f = (o) => v.getFloat32(o, true);
  return {
    id: v.getUint8(1), seq: v.getUint16(2, true), t: v.getFloat64(4, true),
    pos: [f(12), f(16), f(20)], vel: [f(24), f(28), f(32)], yaw: f(36), pitch: f(40), roll: f(44),
    wet: v.getUint8(48) / 255, throttle: v.getInt8(49) / 127, boosting: (v.getUint8(50) & 1) === 1, next: v.getUint16(51, true),
  };
}
export const isPoseData = (d) => d instanceof ArrayBuffer || ArrayBuffer.isView(d);

// 16-bit sequence numbers: is a newer than b (with wrap-around)
export const seqNewer = (a, b) => ((a - b) & 65535) < 32768 && a !== b;

// ---- race standings ----
// players: [{ id, next, dist (m to the next gate), fin (finish time s or null), gone }]
// Order: finished by time, then more gates passed, then nearer the next gate; players who left come last.
export function rankPlayers(players) {
  return players.slice().sort((a, b) => {
    if (a.gone !== b.gone) return a.gone ? 1 : -1;
    const af = a.fin != null, bf = b.fin != null;
    if (af !== bf) return af ? -1 : 1;
    if (af && bf) return a.fin - b.fin || a.id - b.id;
    if (a.next !== b.next) return b.next - a.next;
    return (a.dist ?? 1e9) - (b.dist ?? 1e9) || a.id - b.id;
  });
}
export const ORDINAL = ['1ST', '2ND', '3RD', '4TH'];
