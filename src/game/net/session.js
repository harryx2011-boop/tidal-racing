// A multiplayer session: roster, settings, start, clocks, pose sync, race authority. One per room; the game
// keeps it in `game.net` (null in solo). Talks to the world only through a Transport (transport.js).
//
// Wire messages ({ t: type, ... }; poses are binary, see protocol.js):
//   client -> host   hello {v,name,sw,stripe,number}   prof {name,sw,stripe,number}   ping {n,c}
//                    gate {n,time}   fin {time}   bye {}   app {k,d,to}
//   host -> client   welcome {id,slot,code}   reject {why: full|inrace|version}   roster {players,s,phase}
//                    start {course,cond,tod,seed,startAt,players}   st {o:[[id,next,fin,gone]]}
//                    results {rows}   lobby {}   left {id}   pong {n,c,h}   hostleft {}   app {k,d,f,to}
//   both             pose (binary, host relays a client's pose to the others)
// The host is player id 0, slot 0. Everyone else gets the lowest free id (1..) and slot (0..3 = grid slot).
import { Boat } from '../boat.js';
import { COURSES, grid } from '../courses.js';
import { SWATCHES } from '../settings.js';
import { NetClock } from './clock.js';
import { InterpBuffer } from './interp.js';
import { MAX_PLAYERS, PROTOCOL, ORDINAL, cleanName, decodePose, encodePose, isPoseData, rankPlayers, seqNewer } from './protocol.js';

export const SEA_T0 = 60;          // sea time at the start of the countdown (game.js uses the same)
const LEAD_MS = 3500;              // from pressing Start to the countdown's first tick, so every client is ready
const SEND_HZ = 20;
const INTERP_MS = 100;             // remote boats are drawn this far in the past
const SNAP_M = 12;                 // a correction bigger than this is not smoothed
const TELEPORT_M = 25;             // two consecutive poses further apart than this: a reset, do not interpolate
const FINISH_GRACE_MS = 60000;     // after the first finish the others have this long
const SILENCE_MS = 15000;

const liveryOf = (p) => ({ color: SWATCHES[(p.sw | 0) % SWATCHES.length].color.slice(), stripe: p.stripe | 0, number: p.number | 0 });
const wire = (p) => ({ id: p.id, slot: p.slot, name: p.name, sw: p.sw, stripe: p.stripe, number: p.number });

// One remote boat: its sample buffer and the Boat the renderer draws.
class Remote {
  constructor(p, game, slot) {
    this.id = p.id; this.name = p.name; this.slot = slot;
    this.buf = new InterpBuffer(); this.pose = new Boat();
    const g = grid(game.course, slot);
    this.pose.reset(g.x, g.z, g.yaw); this.pose.settle = false;
    this.livery = liveryOf(p);
    this.entry = { id: p.id, name: p.name, pose: this.pose, livery: this.livery };
    this.seq = -1; this.mode = 'none'; this.off = [0, 0, 0]; this.next = 0; this.has = false;
  }
  push(d) {
    if (this.seq >= 0 && !seqNewer(d.seq, this.seq)) return;
    this.seq = d.seq;
    const L = this.buf.last;
    if (L && Math.hypot(d.pos[0] - L.pos[0], d.pos[2] - L.pos[2]) > TELEPORT_M) { this.buf.s.length = 0; this.mode = 'none'; }
    this.buf.push(d);
    this.next = d.next;
  }
  update(now, dt) {
    const s = this.buf.sample(now);
    if (s.mode === 'none') return;
    const p = this.pose;
    if (this.has && (this.mode === 'extrap' || this.mode === 'hold') && s.mode === 'interp') {
      // fresh data after a gap: start from where the boat was drawn and ease onto the new path; snap if far
      const o = [p.pos[0] - s.pos[0], p.pos[1] - s.pos[1], p.pos[2] - s.pos[2]];
      this.off = Math.hypot(o[0], o[1], o[2]) > SNAP_M ? [0, 0, 0] : o;
    }
    const k = Math.exp(-dt * 8);
    for (let i = 0; i < 3; i++) { this.off[i] *= k; p.pos[i] = s.pos[i] + this.off[i]; p.vel[i] = s.vel[i]; }
    p.yaw = s.yaw; p.pitch = s.pitch; p.roll = s.roll;
    p.wet = s.wet; p.boosting = s.boosting; p.throttle = s.throttle; p.slam = 0; p.steer = 0;
    p.airTime = s.wet < 0.01 ? p.airTime + dt : 0;
    p.ground = 0; p.settle = false;
    this.mode = s.mode; this.has = true;
  }
}

export class NetSession {
  constructor(game, transport, { virtual = false, base = 0 } = {}) {
    this.game = game; this.t = transport; this.virtual = virtual;
    this.clock = new NetClock({ virtual, base });
    this.isHost = false; this.code = ''; this.phase = 'lobby'; this.closed = false;
    this.me = null; this.players = []; this.roster = new Map();
    this.settings = { course: COURSES[0].id, cond: 'random', tod: 'random' };
    this.listeners = new Set(); this.handlers = new Map();
    this.peerToId = new Map(); this.nextPing = 0; this.pings = new Map();
    this.startAt = null; this.remotes = new Map(); this.raceRoster = new Map(); this.prog = new Map();
    this.order = []; this.standing = []; this.results = null; this.firstFinAt = null;
    this.sendAcc = 0; this.stAcc = 0; this.seq = 0; this.lastHost = 0; this.timer = null;
    this.welcome = null;
  }

  // ---- public surface (game.net) ----
  on(type, fn) { if (!this.handlers.has(type)) this.handlers.set(type, new Set()); this.handlers.get(type).add(fn); return () => this.handlers.get(type).delete(fn); }
  // send an app message to everyone, or to the player `to` (an id); the receivers' on(type, fn(data, fromId)) run
  send(type, data, to = null) {
    if (this.closed) return;
    const m = { t: 'app', k: type, d: data, f: this.me ? this.me.id : -1, to };
    if (this.isHost) this.route(m, null); else this.t.send(m);
  }
  listen(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(ev, data) { for (const f of this.listeners) { try { f(ev, data); } catch (e) { console.error(e); } } }
  get link() { return this.code; }
  playerName(id) { const p = this.raceRoster.get(id) || this.roster.get(id); return p ? p.name : '?'; }

  // ---- opening ----
  async host(code, profile) {
    this.isHost = true; this.code = code;
    this.t.onPeerJoin = () => {}; this.hook();
    await this.t.host(code);
    this.me = { id: 0, slot: 0, ...this.clean(profile) };
    this.roster.set(0, this.me);
    this.nextId = 1;
    this.rebuild();
    this.timer = this.virtual ? null : setInterval(() => this.housekeeping(), 1000);
    this.lastHost = performance.now();
  }
  async join(code, profile) {
    this.code = code; this.hook();
    await this.t.join(code);
    this.lastHost = performance.now();
    const answer = new Promise((res, rej) => { this.welcome = { res, rej }; setTimeout(() => rej(Object.assign(new Error('timeout'), { code: 'timeout' })), 8000); });
    this.t.send({ t: 'hello', v: PROTOCOL, ...this.clean(profile) });
    try { await answer; } catch (e) { this.close(); throw e; }
    await this.resync(6);
    this.timer = this.virtual ? null : setInterval(() => this.housekeeping(), 1000);
  }
  clean(p) { return { name: cleanName(p.name), sw: (p.sw | 0) % SWATCHES.length, stripe: p.stripe | 0, number: p.number | 0 }; }
  hook() {
    this.t.onMessage = (from, m) => { try { this.onMessage(from, m); } catch (e) { console.error('net message', e); } };
    this.t.onPeerLeave = (peer) => this.dropPeer(peer);
    this.t.onClose = (why) => { if (!this.closed) this.shutdown(why === 'closed' ? 'closed' : why); };
  }

  // ---- clock ----
  // a few ping round trips to the host; resolves when the estimate is in (or after a timeout, keeping what it has)
  resync(n = 6) {
    if (this.isHost) return Promise.resolve();
    return new Promise((res) => {
      let left = n, done = false;
      const finish = () => { if (!done) { done = true; res(); } };
      const one = () => {
        const id = this.nextPing++;
        this.pings.set(id, () => { if (--left <= 0) finish(); });
        this.t.send({ t: 'ping', n: id, c: this.clock.local() });
        if (--n > 0) setTimeout(one, 70);
      };
      one();
      setTimeout(finish, 2500);
    });
  }

  // ---- host: roster ----
  freeSlot() { const used = new Set([...this.roster.values()].map((p) => p.slot)); for (let s = 0; s < MAX_PLAYERS; s++) if (!used.has(s)) return s; return -1; }
  // a swatch nobody else uses: two boats in one colour are hard to tell apart
  fixSwatch(p, ignoreId) {
    const used = new Set([...this.roster.values()].filter((q) => q.id !== ignoreId).map((q) => q.sw));
    if (used.has(p.sw)) for (let i = 0; i < SWATCHES.length; i++) if (!used.has(i)) { p.sw = i; break; }
  }
  rebuild() {
    this.players = [...this.roster.values()].sort((a, b) => a.slot - b.slot).map((p) => ({ id: p.id, slot: p.slot, name: p.name, livery: liveryOf(p), sw: p.sw, stripe: p.stripe, number: p.number, you: this.me && p.id === this.me.id, host: p.id === 0 }));
    const mine = this.me && this.roster.get(this.me.id);
    if (mine && this.me !== mine) this.me = mine;
    if (mine) this.game.livery = liveryOf(mine);
  }
  broadcastRoster() {
    this.rebuild();
    this.t.send({ t: 'roster', players: [...this.roster.values()].map(wire), s: this.settings, phase: this.phase });
    this.emit('roster');
  }
  setSettings(patch) {
    if (!this.isHost || this.phase !== 'lobby') return;
    Object.assign(this.settings, patch);
    this.broadcastRoster();
  }
  // the local player changed name or livery
  setProfile(profile) {
    const c = this.clean(profile);
    if (this.isHost) { Object.assign(this.me, c); this.fixSwatch(this.me, 0); this.broadcastRoster(); } else this.t.send({ t: 'prof', ...c });
  }

  // ---- messages ----
  onMessage(from, m) {
    this.lastHost = performance.now();
    if (isPoseData(m)) return this.onPose(from, m);
    if (!m || typeof m !== 'object') return;
    if (this.isHost) { const p = this.byPeer(from); if (p) p.seen = performance.now(); this.hostMsg(from, m); } else this.clientMsg(m);
  }
  byPeer(peer) { const id = this.peerToId.get(peer); return id == null ? null : this.roster.get(id); }

  hostMsg(peer, m) {
    const p = this.byPeer(peer);
    switch (m.t) {
      case 'hello': return this.onHello(peer, m);
      case 'ping': return this.t.sendTo(peer, { t: 'pong', n: m.n, c: m.c, h: this.clock.host() });
      case 'prof': if (p && this.phase === 'lobby') { Object.assign(p, this.clean(m)); this.fixSwatch(p, p.id); this.broadcastRoster(); } return;
      case 'gate': if (p) this.hostGate(p.id, m.n | 0, +m.time, false); return;
      case 'fin': if (p) this.hostGate(p.id, this.game.course.total, +m.time, true); return;
      case 'bye': return this.dropPeer(peer);
      case 'app': if (p) this.route({ t: 'app', k: String(m.k), d: m.d, f: p.id, to: m.to ?? null }, peer); return;
    }
  }
  onHello(peer, m) {
    if (this.byPeer(peer)) return;
    if (m.v !== PROTOCOL) return this.refuse(peer, 'version');
    if (this.phase !== 'lobby') return this.refuse(peer, 'inrace');
    const slot = this.freeSlot();
    if (slot < 0 || this.roster.size >= MAX_PLAYERS) return this.refuse(peer, 'full');
    const id = this.nextId++;
    const p = { id, slot, peer, seen: performance.now(), ...this.clean(m) };
    this.fixSwatch(p, id);
    this.roster.set(id, p); this.peerToId.set(peer, id);
    this.t.sendTo(peer, { t: 'welcome', id, slot, code: this.code });
    this.broadcastRoster();
  }
  refuse(peer, why) { this.t.sendTo(peer, { t: 'reject', why }); }
  // deliver an app message to its target(s), locally too; except = the peer it came from
  route(m, except) {
    const toMe = m.to == null || m.to === this.me.id;
    if (m.to == null) { for (const peer of this.peerToId.keys()) if (peer !== except) this.t.sendTo(peer, m); }
    else for (const [peer, id] of this.peerToId) if (id === m.to && peer !== except) this.t.sendTo(peer, m);
    if (toMe && m.f !== this.me.id) this.deliver(m);
  }
  deliver(m) { const hs = this.handlers.get(m.k); if (hs) for (const fn of hs) { try { fn(m.d, m.f); } catch (e) { console.error(e); } } }

  clientMsg(m) {
    switch (m.t) {
      case 'welcome': this.me = { id: m.id, slot: m.slot, ...this.clean({}) }; if (this.welcome) { this.welcome.res(); this.welcome = null; } return;
      case 'reject': if (this.welcome) { this.welcome.rej(Object.assign(new Error(m.why), { code: m.why })); this.welcome = null; } return;
      case 'pong': { const f = this.pings.get(m.n); this.pings.delete(m.n); this.clock.addSample(m.c, m.h, this.clock.local()); if (f) f(); return; }
      case 'roster': return this.applyRoster(m);
      case 'start': return this.applyStart(m);
      case 'st': this.applyStanding(m.o); return;
      case 'results': return this.applyResults(m.rows);
      case 'lobby': return this.applyLobby();
      case 'left': return this.playerLeft(m.id);
      case 'hostleft': return this.shutdown('host-left');
      case 'app': return this.deliver(m);
    }
  }
  applyRoster(m) {
    this.roster = new Map(m.players.map((p) => [p.id, { ...p }]));
    if (m.s) this.settings = { ...m.s };
    this.phase = m.phase === 'lobby' ? 'lobby' : this.phase;
    if (this.me && this.roster.has(this.me.id)) this.me = this.roster.get(this.me.id);
    this.rebuild();
    this.emit('roster');
  }

  // ---- departures ----
  dropPeer(peer) {
    const id = this.peerToId.get(peer);
    if (id == null) return;
    this.peerToId.delete(peer);
    this.roster.delete(id);
    if (this.phase !== 'lobby') { this.t.send({ t: 'left', id }); this.playerLeft(id); }
    this.broadcastRoster();
  }
  playerLeft(id) {
    const r = this.raceRoster.get(id);
    if (r) r.gone = true;
    this.removeRival(id);
    const pr = this.prog.get(id);
    if (pr) pr.gone = true;
    this.emit('left', id);
    if (this.isHost) { this.sendStanding(); this.checkEnd(); }
  }
  removeRival(id) {
    const r = this.remotes.get(id);
    if (!r) return;
    this.remotes.delete(id);
    const a = this.game.rivals, i = a.indexOf(r.entry);
    if (i >= 0) a.splice(i, 1);
  }
  housekeeping() {
    const now = performance.now();
    if (this.isHost) { for (const [peer, id] of [...this.peerToId]) { const p = this.roster.get(id); if (p && now - p.seen > SILENCE_MS) this.dropPeer(peer); } }
    else {
      if (now - this.lastHost > SILENCE_MS) return this.shutdown('lost');
      this.t.send({ t: 'ping', n: this.nextPing++, c: this.clock.local() });
    }
  }
  // end the session: why = 'closed' (we left) | 'host-left' | 'lost'
  shutdown(why) {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.timer);
    this.game.rivals.length = 0; this.remotes.clear();
    if (this.game.net === this) this.game.net = null;
    this.emit('closed', why);
  }
  // we leave (the lobby's Leave button, quit from the menu)
  leave() {
    if (this.closed) return;
    try { this.t.send(this.isHost ? { t: 'hostleft' } : { t: 'bye' }); } catch { /* */ }
    this.shutdown('closed');
    // let the goodbye leave before the channel goes
    setTimeout(() => this.t.close(), 100);
  }

  // ---- start ----
  start() {
    if (!this.isHost || this.phase !== 'lobby') return false;
    const seed = (Math.random() * 4294967296) >>> 0;
    const m = { t: 'start', ...this.settings, seed, startAt: this.clock.host() + LEAD_MS, players: [...this.roster.values()].map(wire) };
    delete m.s;
    this.t.send(m);
    this.applyStart(m);
    return true;
  }
  applyStart(m) {
    const g = this.game;
    this.phase = 'race'; this.startAt = m.startAt; this.race = { course: m.course, cond: m.cond, tod: m.tod, seed: m.seed, startAt: m.startAt }; this.results = null; this.standing = []; this.firstFinAt = null;
    this.raceRoster = new Map(m.players.map((p) => [p.id, { ...p, gone: false }]));
    this.prog = new Map(m.players.map((p) => [p.id, { next: 0, fin: null, gone: false }]));
    this.seq = 0; this.sendAcc = 0; this.stAcc = 0;
    this.emit('start', m);
    g.start(m.course, m.cond, m.tod, m.seed);
    const slot = (this.raceRoster.get(this.me.id) || this.me).slot;
    g.place(grid(g.course, slot));
    g.progress.slot = slot;
    g.rivals.length = 0; this.remotes.clear();
    for (const p of m.players) {
      if (p.id === this.me.id) continue;
      const r = new Remote(p, g, p.slot);
      this.remotes.set(p.id, r); g.rivals.push(r.entry);
    }
    this.order = m.players.map((p) => p.id);
    if (this.isHost) this.sendStanding();
  }

  // ---- per frame (called by Game.update) ----
  // before the simulation: advance the clock, lock the sea to it, place the rivals
  pre(dt) {
    this.clock.tick(dt);
    if (this.phase !== 'lobby' && this.startAt != null) this.game.app.time = SEA_T0 + (this.clock.host() - this.startAt) / 1000;
    const now = this.clock.host() - INTERP_MS;
    for (const r of this.remotes.values()) r.update(now, dt);
  }
  // after the simulation: send our pose, host sends standings
  post(dt) {
    if (this.phase === 'lobby') return;
    this.sendAcc += dt;
    if (this.sendAcc >= 1 / SEND_HZ - 1e-6) {
      this.sendAcc = Math.min(this.sendAcc - 1 / SEND_HZ, 1 / SEND_HZ);
      const b = this.game.boat;
      this.t.send(encodePose({ id: this.me.id, seq: this.seq++, t: this.clock.host(), pos: b.pos, vel: b.vel, yaw: b.yaw, pitch: b.pitch, roll: b.roll, wet: b.wet, throttle: b.throttle, boosting: b.boosting, next: this.game.progress.next }));
    }
    if (this.isHost && this.phase === 'race') {
      this.stAcc += dt;
      if (this.stAcc >= 0.5) { this.stAcc = 0; this.sendStanding(); this.checkEnd(); }
    }
  }
  onPose(from, buf) {
    const d = decodePose(buf);
    if (!d || d.id === this.me.id) return;
    if (this.isHost) {
      const p = this.byPeer(from);
      if (!p || p.id !== d.id) return;
      for (const peer of this.peerToId.keys()) if (peer !== from) this.t.sendTo(peer, buf);
    }
    const r = this.remotes.get(d.id);
    if (r) r.push(d);
  }

  // ---- race authority ----
  // the local boat passed a gate (or finished)
  onProgress(next, t, fin) {
    if (this.phase === 'lobby') return;
    if (this.isHost) this.hostGate(0, next, t, fin);
    else this.t.send(fin ? { t: 'fin', time: t } : { t: 'gate', n: next, time: t });
  }
  hostGate(id, n, time, fin) {
    const p = this.prog.get(id);
    if (!p || p.gone || p.fin != null || this.phase !== 'race' || !(n > p.next) || !isFinite(time)) return;
    p.next = n; p.time = time;
    if (fin || n >= this.game.course.total) { p.fin = time; if (this.firstFinAt == null) this.firstFinAt = this.clock.host(); }
    this.sendStanding();
    this.checkEnd();
  }
  standingRows() {
    const g = this.game, gates = g.course.gates, rows = [];
    for (const [id, r] of this.raceRoster) {
      const p = this.prog.get(id) || { next: 0, fin: null };
      const pos = id === this.me.id ? g.boat.pos : this.remotes.get(id)?.pose.pos;
      const gate = gates[p.next % gates.length];
      rows.push({ id, next: p.next, fin: p.fin, gone: !!r.gone, dist: pos ? Math.hypot(gate.c[0] - pos[0], gate.c[1] - pos[2]) : 1e9 });
    }
    return rankPlayers(rows);
  }
  sendStanding() {
    const rows = this.standingRows();
    const o = rows.map((r) => [r.id, r.next, r.fin, r.gone ? 1 : 0]);
    this.t.send({ t: 'st', o });
    this.applyStanding(o);
  }
  applyStanding(o) {
    this.standing = o.map(([id, next, fin, gone]) => ({ id, next, fin, gone: !!gone }));
    this.order = this.standing.map((r) => r.id);
    this.emit('standing');
  }
  // my place as text ('1ST'), '' when not in a race
  placeText() {
    if (this.phase === 'lobby' || !this.me) return '';
    const i = this.order.indexOf(this.me.id);
    return i < 0 ? '' : `${ORDINAL[i] || i + 1 + 'TH'}`;
  }
  checkEnd() {
    if (!this.isHost || this.phase !== 'race') return;
    const live = [...this.prog.values()].filter((p) => !p.gone);
    const allDone = live.length > 0 && live.every((p) => p.fin != null);
    const late = this.firstFinAt != null && this.clock.host() - this.firstFinAt > FINISH_GRACE_MS;
    if (allDone || late) this.finalize();
  }
  finalize() {
    const rows = this.standingRows().map((r) => {
      const p = this.raceRoster.get(r.id);
      return { id: r.id, name: p.name, slot: p.slot, sw: p.sw, time: r.fin, dnf: r.fin == null };
    });
    this.t.send({ t: 'results', rows });
    this.applyResults(rows);
  }
  applyResults(rows) {
    this.results = rows; this.phase = 'done';
    const g = this.game;
    // a boat still racing when the host closes the results is out of it
    if (g.state === 'racing' || g.state === 'countdown') { g.state = 'finished'; g.hud.show('finished'); }
    this.emit('results', rows);
  }

  // ---- rematch ----
  backToLobby() {
    if (!this.isHost || this.phase === 'lobby') return;
    this.t.send({ t: 'lobby' });
    this.applyLobby();
  }
  applyLobby() {
    const g = this.game;
    this.phase = 'lobby'; this.startAt = null; this.results = null; this.standing = [];
    g.rivals.length = 0; this.remotes.clear();
    g.state = 'menu'; g.paused = false;
    g.setCourse(g.course);
    g.hud.show('menu');
    this.rebuild();
    this.emit('lobby');
    if (this.isHost) this.broadcastRoster();
  }
}
