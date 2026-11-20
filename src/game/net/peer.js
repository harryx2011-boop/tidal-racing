// PeerJS transport: WebRTC data channels, signalling through the PeerJS public broker (0.peerjs.com).
// The vendored bundle (src/vendor/peerjs.min.js) is loaded on first use, so solo play never fetches it.
// The room code is the host's peer id minus a fixed prefix: join(code) connects to PEER_PREFIX + code.
// One reliable, ordered channel per client carries everything. (A second unreliable channel for poses would
// avoid head-of-line blocking after a lost packet; PeerJS 1.5's unreliable mode is not dependable enough to
// build on blind. Poses are small and a newer one arrives 50 ms later, so a stall is brief.)
import { Transport, fail } from './transport.js';
import { PEER_PREFIX } from './protocol.js';

let loading = null;
function loadPeerJS() {
  if (window.Peer) return Promise.resolve(window.Peer);
  if (!loading) {
    loading = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = new URL('../../vendor/peerjs.min.js', import.meta.url).href;
      s.onload = () => (window.Peer ? res(window.Peer) : rej(fail('unsupported', 'peerjs did not load')));
      s.onerror = () => { loading = null; rej(fail('unsupported', 'peerjs script failed to load')); };
      document.head.appendChild(s);
    });
  }
  return loading;
}

// ?peerserver=host:port points PeerJS at another signalling server (a local `peer` server for testing)
// instead of the public broker.
function brokerOptions() {
  const v = new URLSearchParams(location.search).get('peerserver');
  if (!v) return {};
  const [host, port] = v.split(':');
  return { host, port: Number(port) || 9000, path: '/', secure: false };
}

// PeerJS error types -> our codes
function mapError(err) {
  const t = err && err.type;
  if (t === 'unavailable-id') return fail('taken', 'room code in use');
  if (t === 'peer-unavailable') return fail('not-found', 'no such room');
  if (t === 'webrtc') return fail('webrtc', String(err.message || err));
  if (t === 'browser-incompatible') return fail('unsupported', 'WebRTC is not available in this browser');
  return fail('broker', String((err && err.message) || err || 'signalling failed'));
}

export class PeerTransport extends Transport {
  constructor() { super(); this.peer = null; this.conns = new Map(); this.closed = false; }

  // open the peer on the broker (id = a given id, or the broker picks one)
  async openPeer(id) {
    const Peer = await loadPeerJS();
    return new Promise((res, rej) => {
      let done = false;
      const timer = setTimeout(() => { if (!done) { done = true; try { peer.destroy(); } catch { /* */ } rej(fail('broker', 'signalling server did not answer')); } }, 12000);
      const peer = id ? new Peer(id, brokerOptions()) : new Peer(brokerOptions());
      this.peer = peer;
      peer.on('open', (pid) => { if (done) return; done = true; clearTimeout(timer); this.id = pid; res(peer); });
      peer.on('error', (err) => {
        if (!done) { done = true; clearTimeout(timer); try { peer.destroy(); } catch { /* */ } rej(mapError(err)); return; }
        this.err(err);
      });
      peer.on('disconnected', () => { /* only the broker link dropped: open data channels still work */ });
    });
  }
  err(err) {
    // after setup: a client whose host vanished, or a failed link
    if (!this.isHost && !this.closed && err && err.type !== 'peer-unavailable') { this.closed = true; this.onClose('lost'); }
  }

  async host(code) {
    this.isHost = true;
    await this.openPeer(PEER_PREFIX + code);
    this.hostId = this.id;
    this.peer.on('connection', (conn) => {
      const id = conn.peer;
      conn.on('open', () => { this.conns.set(id, conn); this.onPeerJoin(id); });
      conn.on('data', (d) => this.onMessage(id, d));
      const gone = () => { if (this.conns.get(id) === conn) { this.conns.delete(id); this.onPeerLeave(id); } };
      conn.on('close', gone); conn.on('error', gone);
    });
  }

  async join(code) {
    await this.openPeer(null);
    const hostId = PEER_PREFIX + code;
    this.hostId = hostId;
    const conn = await new Promise((res, rej) => {
      const c = this.peer.connect(hostId, { reliable: true });
      let done = false;
      const timer = setTimeout(() => { if (!done) { done = true; try { c.close(); } catch { /* */ } rej(fail('timeout', 'host did not answer')); } }, 15000);
      c.on('open', () => { if (!done) { done = true; clearTimeout(timer); res(c); } });
      c.on('error', (e) => { if (!done) { done = true; clearTimeout(timer); rej(mapError(e)); } });
      // peer-unavailable is reported on the peer, not the connection
      this.peer.on('error', (e) => { if (!done && e && e.type === 'peer-unavailable') { done = true; clearTimeout(timer); rej(mapError(e)); } });
    }).catch((e) => { this.close(); throw e; });
    this.conn = conn;
    conn.on('data', (d) => this.onMessage(hostId, d));
    const lost = () => { if (!this.closed) { this.closed = true; this.onClose('host-left'); } };
    conn.on('close', lost); conn.on('error', lost);
  }

  send(msg) {
    try {
      if (this.isHost) for (const c of this.conns.values()) c.send(msg);
      else if (this.conn && this.conn.open) this.conn.send(msg);
    } catch { /* a closing channel: the close event follows */ }
  }
  sendTo(id, msg) { const c = this.conns.get(id); try { if (c && c.open) c.send(msg); } catch { /* */ } }
  close() {
    this.closed = true;
    try { this.peer && this.peer.destroy(); } catch { /* */ }
    this.conns.clear();
  }
}
