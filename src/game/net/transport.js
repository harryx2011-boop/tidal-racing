// The transport interface. All game code talks to this and never to PeerJS or BroadcastChannel.
//
// TOPOLOGY: a star. The host is connected to every client and relays; clients never talk to each other.
// Why not a full mesh: with up to four players a mesh would save one hop of latency (about 20 to 60 ms
// between two clients that are far apart) but needs N*(N-1)/2 WebRTC links to negotiate, each of which can
// fail separately (strict NATs), and a mesh has no single place that owns race order and the roster. The
// star needs one link per client, and the host is the authority for the roster, start and results anyway.
// Poses are 53 bytes at 20 Hz, so relaying costs the host under 10 KB/s upstream.
//
//   host(code)    open a room under `code`; resolves when it is reachable
//   join(code)    connect to the host of room `code`; resolves when the link is open
//   send(msg)     host: to every client.  client: to the host
//   sendTo(id,m)  host only: to one client (ids come from onPeerJoin)
//   close()       leave (a host closing ends the room)
// Callbacks (assign before host/join): onPeerJoin(id) onPeerLeave(id) onMessage(fromId, msg) onClose(reason)
// Failures reject with an Error whose .code is one of:
//   'broker'     the PeerJS signalling server cannot be reached
//   'not-found'  no host answers to that room code
//   'taken'      the code is already used by another host
//   'timeout'    connected to the broker but the host did not answer in time
//   'webrtc'     the browser could not set up a peer link
//   'unsupported'
// onClose reasons: 'host-left' (client side), 'lost' (the link dropped), 'closed' (we closed it).
export class Transport {
  constructor() {
    this.isHost = false; this.id = null; this.hostId = null;
    this.onPeerJoin = () => {}; this.onPeerLeave = () => {}; this.onMessage = () => {}; this.onClose = () => {};
  }
  async host(/* code */) { throw new Error('not implemented'); }
  async join(/* code */) { throw new Error('not implemented'); }
  send(/* msg */) {}
  sendTo(/* id, msg */) {}
  close() {}
}
export const fail = (code, message) => Object.assign(new Error(message || code), { code });

// ---- local transport: BroadcastChannel, for two tabs (or pages) of one browser and for tests ----
// Selected with ?transport=local. One channel per room code. Optional ?lag=ms adds that much delay (and a
// little jitter) to every received message, to see the interpolation work.
export class LocalTransport extends Transport {
  constructor({ lag = 0 } = {}) {
    super();
    this.lag = lag; this.ch = null; this.peers = new Set(); this.up = false;
    this.id = 'L' + Math.random().toString(36).slice(2, 8);
  }
  open(code) {
    this.ch = new BroadcastChannel('tidal-local-' + code);
    this.ch.onmessage = (e) => {
      const m = e.data;
      if (!this.lag) this.recv(m); else setTimeout(() => this.recv(m), this.lag * (0.8 + 0.4 * Math.random()));
    };
    this.up = true;
    this.page = () => this.close();
    if (typeof addEventListener === 'function') addEventListener('pagehide', this.page);
  }
  async host(code) {
    this.isHost = true; this.hostId = this.id; this.open(code);
    // is somebody already hosting this code? they answer a probe
    const taken = await new Promise((res) => {
      this.probe = res;
      this.ch.postMessage({ k: 'probe', from: this.id });
      setTimeout(() => res(false), 150);
    });
    this.probe = null;
    if (taken) { this.close(true); throw fail('taken', 'room code in use'); }
  }
  async join(code) {
    this.open(code);
    await new Promise((res, rej) => {
      this.ack = res;
      this.ch.postMessage({ k: 'hi', from: this.id });
      setTimeout(() => rej(fail('not-found', 'no host answered')), 1500);
    }).catch((e) => { this.close(true); throw e; });
    this.ack = null;
  }
  recv(m) {
    if (!m || m.from === this.id) return;
    if (this.isHost) {
      if (m.k === 'taken' && this.probe) this.probe(true);
      else if (m.k === 'probe' && !this.probe) this.ch.postMessage({ k: 'taken', from: this.id });
      else if (m.k === 'hi') { this.peers.add(m.from); this.ch.postMessage({ k: 'ack', from: this.id, to: m.from }); this.onPeerJoin(m.from); }
      else if (m.k === 'bye') { if (this.peers.delete(m.from)) this.onPeerLeave(m.from); }
      else if (m.k === 'd' && (m.to === this.id) && this.peers.has(m.from)) this.onMessage(m.from, m.d);
    } else {
      if (m.k === 'ack' && m.to === this.id && this.ack) { this.hostId = m.from; this.ack(); }
      else if (m.from !== this.hostId) return;
      else if (m.k === 'bye') { this.close(true); this.onClose('host-left'); }
      else if (m.k === 'd' && (m.to === '*' || m.to === this.id)) this.onMessage(m.from, m.d);
    }
  }
  send(msg) {
    if (!this.up) return;
    this.ch.postMessage({ k: 'd', from: this.id, to: this.isHost ? '*' : this.hostId, d: msg });
  }
  sendTo(id, msg) { if (this.up) this.ch.postMessage({ k: 'd', from: this.id, to: id, d: msg }); }
  close(quiet) {
    if (!this.up) return;
    this.up = false;
    if (typeof removeEventListener === 'function') removeEventListener('pagehide', this.page);
    try { if (!quiet) this.ch.postMessage({ k: 'bye', from: this.id }); this.ch.close(); } catch { /* closed already */ }
  }
}

// which transport this page uses: ?transport=local, else PeerJS
export async function makeTransport(search = location.search) {
  const q = new URLSearchParams(search);
  if (q.get('transport') === 'local') return new LocalTransport({ lag: Number(q.get('lag')) || 0 });
  const { PeerTransport } = await import('./peer.js');
  return new PeerTransport();
}
