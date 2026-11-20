// The multiplayer lobby and its panels, in the same pixel-art style as the menus (hud.js, pixel.js):
// host / join buttons on the main menu, the join-by-code panel, the lobby (room code, link, players, course
// and conditions), the results table, and the messages for the ways it can go wrong.
// It owns the connection flow; the session (net/session.js) owns the state. All lengths are in logical pixels (em).
import { COURSES, CONDITIONS, TIMES } from './courses.js';
import { settings, SWATCHES } from './settings.js';
import { T, PAPER, INK, ACCENT } from './pixel.js';
import { fmt } from './hud.js';
import { makeTransport } from './net/transport.js';
import { NetSession } from './net/session.js';
import { makeRoomCode, normalizeCode, roomFromSearch, roomLink, cleanName, MAX_PLAYERS, ORDINAL } from './net/protocol.js';

const NAME_KEY = 'tidal.name';
const MESSAGES = {
  broker: 'Cannot reach the PeerJS signalling server. Check your connection; a firewall or content blocker may be stopping it.',
  'not-found': 'No game with that room code. Check the code and try again.',
  timeout: 'The host did not answer. They may have closed the room.',
  full: 'That game is full: four players at most.',
  inrace: 'That race has already started. Ask the host to open a new lobby.',
  version: 'The host runs a different version of the game.',
  webrtc: 'Could not open a direct connection to the host. A strict firewall or NAT may be in the way.',
  taken: 'Could not reserve a room code. Try again.',
  unsupported: 'This browser cannot make peer-to-peer connections.',
  'host-left': 'The host left the game.',
  lost: 'The connection was lost.',
  badlink: 'That room link is not valid.',
};
const swatchCss = (i) => `#${SWATCHES[i % SWATCHES.length].hex.toString(16).padStart(6, '0')}`;

const CSS = `
#mp { position: absolute; inset: 0; display: grid; place-items: center; }
#mp .cols { display: flex; gap: 8em; align-items: flex-start; }
#mp .plate { gap: 3em; }
#mp .hd { display: flex; align-items: center; justify-content: space-between; gap: 6em; }
#mp .row { display: flex; gap: 2em; align-items: stretch; }
#mp .row .btn { flex: 1; }
/* text boxes: the wrapper is sized in logical pixels, the input's font size is set in px by fit() (an em on the input itself would be relative to its own font) */
#ui .inw { box-sizing: border-box; width: 100%; height: 14em; border: 1em solid ${PAPER}; background: ${INK}; pointer-events: auto; }
#ui .inw.code { height: 20em; }
#ui .inw input { appearance: none; -webkit-appearance: none; box-sizing: border-box; pointer-events: auto; user-select: text; display: block; width: 100%; height: 100%; padding: 0 3em; margin: 0; border: 0; border-radius: 0; background: transparent; color: ${PAPER}; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 9px; line-height: 1; letter-spacing: 0.1em; text-transform: uppercase; outline: none; }
#ui .inw.code input { text-align: center; letter-spacing: 0.2em; }
#ui .inw:focus-within { border-color: ${ACCENT}; }
#ui .inw input::placeholder { color: ${PAPER}; opacity: 0.35; }
.pl { display: flex; align-items: center; gap: 4em; height: 13em; padding: 0 3em; border: 1em solid ${PAPER}; background: ${INK}; }
.pl.empty { border-style: dotted; background: none; opacity: 0.6; }
.pl .no { width: 8em; display: flex; }
.pl .sw { width: 9em; height: 9em; border: 1em solid ${INK}; outline: 1em solid ${PAPER}; flex: none; }
.pl .nm { flex: 1; display: flex; }
.pl .tag { display: flex; }
#lb-sw { display: flex; gap: 4em; }
#lb-sw button { width: 11em; height: 11em; border: 1em solid ${INK}; outline: 1em solid ${PAPER}; }
#lb-sw button.sel { outline: 2em solid ${ACCENT}; }
.rr { display: grid; grid-template-columns: 16em 9em 62em 44em 36em; align-items: center; gap: 3em; height: 12em; padding: 0 3em; border: 1em solid ${PAPER}; background: ${INK}; }
.rr.me { border-color: ${ACCENT}; }
.rr .sw { width: 8em; height: 8em; border: 1em solid ${INK}; outline: 1em solid ${PAPER}; }
.rr > * { display: flex; }
.hint { max-width: 150em; }
`;

export class Lobby {
  constructor(hud) {
    this.hud = hud; this.game = hud.game;
    this.net = null; this.active = false; this.busy = false;
    const q = new URLSearchParams(location.search);
    this.local = q.get('transport') === 'local';
    this.virtual = q.has('manual');
    this.base = Number(q.get('netbase')) || 0;
    const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
    const root = hud.root;
    const mp = document.createElement('div'); mp.id = 'mp';
    const swBtns = SWATCHES.map((c, i) => `<button data-sw="${i}" title="${c.name}" aria-label="${c.name}" style="background:${swatchCss(i)}"></button>`).join('');
    mp.innerHTML = `
      <div id="mp-wait" class="plate centre hide">${T('Connecting', 's=2')}<px-t id="wait-t" f="t" w="140" a="center"></px-t><button class="btn" id="wait-cancel">${T('Cancel')}</button></div>
      <div id="mp-join" class="plate hide">
        ${T('Join game', 's=2')}
        ${T('Room code', 'f=t c=accent')}
        <div class="inw code"><input id="join-code" type="text" maxlength="7" placeholder="CODE" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="Room code"></div>
        ${T('Your name', 'f=t c=accent')}
        <div class="inw"><input id="join-name" type="text" maxlength="12" autocomplete="off" spellcheck="false" aria-label="Your name"></div>
        <button class="go" id="join-go">${T('Join', 's=2 c=ink')}</button>
        <button class="btn" id="join-back">${T('Back')}</button>
      </div>
      <div id="mp-lobby" class="cols hide">
        <div class="plate" style="width:178em">
          <div class="hd">${T('Lobby', 's=2')}<button class="btn" id="lb-leave" style="padding:3em 6em">${T('Leave')}</button></div>
          ${T('Room code', 'f=t c=accent')}
          <px-t id="lb-code" s="5"></px-t>
          <div class="row"><button class="btn" id="lb-copylink">${T('Copy link', 'f=t')}</button><button class="btn" id="lb-copycode">${T('Copy code', 'f=t')}</button></div>
          <px-t id="lb-note" f="t" w="160"></px-t>
          ${T('Players', 'f=t c=accent')}
          <div class="col" id="lb-players" style="gap:2em"></div>
          ${T('Your name and colour', 'f=t c=accent')}
          <div class="inw"><input id="lb-name" type="text" maxlength="12" autocomplete="off" spellcheck="false" aria-label="Your name"></div>
          <div id="lb-sw">${swBtns}</div>
        </div>
        <div class="plate" style="width:172em">
          ${T('The race', 's=2')}
          <div id="lb-host" class="col" style="gap:3em">
            ${T('Course', 'f=t c=accent')}
            <div class="col" id="lb-courses" style="gap:2em">${COURSES.map((c) => `<button class="btn left" data-lc="${c.id}">${T(c.name)}${T(c.blurb, 'f=t')}</button>`).join('')}</div>
            ${T('Conditions', 'f=t c=accent')}
            <div class="seg" id="lb-conds">${[['random', 'Random'], ...Object.entries(CONDITIONS).map(([k, v]) => [k, v.name])].map(([k, n]) => `<button class="btn" data-ln="${k}">${T(n, 'f=t')}</button>`).join('')}</div>
            ${T('Time of day', 'f=t c=accent')}
            <div class="seg" id="lb-tods">${[['day', 'Day'], ['sunrise', 'Sunrise'], ['sunset', 'Sunset'], ['random', 'Random']].map(([k, n]) => `<button class="btn" data-lt="${k}">${T(n, 'f=t')}</button>`).join('')}</div>
            <button class="go" id="lb-start">${T('Start race', 's=2 c=ink')}</button>
          </div>
          <div id="lb-guest" class="col" style="gap:3em">
            ${T('Chosen by the host', 'f=t c=accent')}
            <px-t id="lb-sum" w="140"></px-t>
            <px-t id="lb-wait" f="t" c="accent" w="140">Waiting for the host to start</px-t>
          </div>
          ${T('Weather comes from a seed the host sends, so every boat races on the same waves. Random picks the sea and sun from the seed.', 'f=t w=140')}
        </div>
      </div>
      <div id="mp-res" class="plate centre hide" style="min-width:196em; align-items:stretch">
        <px-t id="res-title" s="2" a="center"></px-t><px-t id="res-sub" f="t" a="center"></px-t>
        <div class="col" id="res-rows" style="gap:2em"></div>
        <px-t id="res-note" f="t" c="accent" a="center"></px-t>
        <button class="go" id="res-lobby">${T('Back to lobby', 'c=ink')}</button>
        <button class="btn" id="res-leave">${T('Leave')}</button>
      </div>
      <div id="mp-msg" class="plate centre hide" style="max-width:190em">${T('Cannot play together', 's=2')}<px-t id="msg-t" w="170" a="center"></px-t><button class="go" id="msg-ok">${T('OK', 'c=ink')}</button></div>`;
    root.appendChild(mp);
    this.fit = () => { for (const i of mp.querySelectorAll('input')) i.style.fontSize = `${(i.closest('.code') ? 14 : 9) * hud.u}px`; };
    this.fit(); window.addEventListener('resize', this.fit);
    const $ = (id) => mp.querySelector('#' + id);
    this.$ = $;
    this.panels = { wait: $('mp-wait'), join: $('mp-join'), lobby: $('mp-lobby'), res: $('mp-res'), msg: $('mp-msg') };
    // the two buttons on the main menu, under Start
    const start = root.querySelector('#start');
    const row = document.createElement('div'); row.className = 'seg'; row.id = 'mp-btns';
    row.innerHTML = `<button class="btn" id="host-btn">${T('Host game')}</button><button class="btn" id="join-btn">${T('Join game')}</button>`;
    start.after(row);
    row.querySelector('#host-btn').addEventListener('click', () => this.host());
    row.querySelector('#join-btn').addEventListener('click', () => { $('join-name').value = this.name(); this.show('join'); $('join-code').focus({ preventScroll: true }); });
    $('join-back').addEventListener('click', () => this.toMenu());
    $('join-go').addEventListener('click', () => this.tryJoin());
    $('join-code').addEventListener('keydown', (e) => { if (e.code === 'Enter') this.tryJoin(); });
    $('join-name').addEventListener('keydown', (e) => { if (e.code === 'Enter') this.tryJoin(); });
    $('wait-cancel').addEventListener('click', () => this.cancel());
    $('msg-ok').addEventListener('click', () => this.toMenu());
    $('lb-leave').addEventListener('click', () => this.leave());
    $('res-leave').addEventListener('click', () => this.leave());
    $('res-lobby').addEventListener('click', () => this.net && this.net.backToLobby());
    $('lb-start').addEventListener('click', () => this.net && this.net.start());
    $('lb-copylink').addEventListener('click', () => this.copy(this.link(), 'Link copied'));
    $('lb-copycode').addEventListener('click', () => this.copy(this.net.code, 'Code copied'));
    $('lb-courses').addEventListener('click', (e) => { const b = e.target.closest('[data-lc]'); if (b && this.net) this.net.setSettings({ course: b.dataset.lc }); });
    $('lb-conds').addEventListener('click', (e) => { const b = e.target.closest('[data-ln]'); if (b && this.net) this.net.setSettings({ cond: b.dataset.ln }); });
    $('lb-tods').addEventListener('click', (e) => { const b = e.target.closest('[data-lt]'); if (b && this.net) this.net.setSettings({ tod: b.dataset.lt }); });
    $('lb-sw').addEventListener('click', (e) => { const b = e.target.closest('[data-sw]'); if (b) { settings.update({ swatch: +b.dataset.sw }); this.profile(); } });
    const nm = $('lb-name');
    nm.addEventListener('input', () => { try { localStorage.setItem(NAME_KEY, nm.value); } catch { /* */ } clearTimeout(this.pt); this.pt = setTimeout(() => this.profile(), 250); });
    // a ?room=CODE link goes straight to joining
    const room = roomFromSearch(location.search);
    if (room) setTimeout(() => this.joinRoom(room), 0);
    else if (room === null) setTimeout(() => this.message(MESSAGES.badlink), 0);
  }

  name() {
    let n = '';
    try { n = localStorage.getItem(NAME_KEY) || ''; } catch { /* */ }
    return cleanName(n, 'Racer' + (10 + Math.floor(Math.random() * 90)));
  }
  profile() {
    const S = settings;
    const p = { name: cleanName(this.$('lb-name').value, 'Racer'), sw: S.swatch, stripe: S.stripe, number: S.number };
    if (this.net) this.net.setProfile(p);
  }
  link() {
    const base = roomLink(location.href, this.net.code);
    return base + (this.local ? '&transport=local' : '');
  }
  async copy(text, ok) {
    let done = false;
    try { await navigator.clipboard.writeText(text); done = true; } catch { /* no clipboard: fall back */ }
    if (!done) {
      try { const t = document.createElement('textarea'); t.value = text; t.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(t); t.select(); done = document.execCommand('copy'); t.remove(); } catch { /* */ }
    }
    this.note(done ? ok : 'Could not copy. Select the code and copy it by hand.');
  }
  note(text) { this.$('lb-note').textContent = text; clearTimeout(this.nt); this.nt = setTimeout(() => this.noteIdle(), 2500); }
  noteIdle() {
    const n = this.net;
    this.$('lb-note').textContent = !n ? '' : n.isHost ? 'Share the link or the code.' : 'Connected to the host.';
  }

  show(name) {
    for (const [k, el] of Object.entries(this.panels)) el.classList.toggle('hide', k !== name);
    this.active = name === 'lobby' || name === 'join' || name === 'wait' || name === 'msg';
    const menu = this.hud.el.menu;
    if (name) menu.classList.add('hide');
  }
  toMenu() {
    this.show(null); this.active = false;
    this.hud.show('menu');
  }
  message(text) {
    this.$('msg-t').textContent = text;
    this.show('msg');
  }

  // ---- connecting ----
  async prepare(text) {
    if (this.busy) return false;
    this.busy = true; this.cancelled = false;
    this.$('wait-t').textContent = text;
    this.show('wait');
    return true;
  }
  profileNow(name) {
    const S = settings;
    return { name: cleanName(name, 'Racer'), sw: S.swatch, stripe: S.stripe, number: S.number };
  }
  async host() {
    if (!(await this.prepare('Opening a room through the signalling server'))) return;
    let session = null;
    try {
      const transport = await makeTransport();
      for (let tries = 0; ; tries++) {
        session = new NetSession(this.game, transport, { virtual: this.virtual, base: this.base });
        try { await session.host(makeRoomCode(), this.profileNow(this.name())); break; } catch (e) { if (e.code === 'taken' && tries < 4) continue; throw e; }
      }
      this.open(session);
    } catch (e) { this.fail(e, session); }
  }
  tryJoin() {
    const code = normalizeCode(this.$('join-code').value);
    if (!code) { const w = this.$('join-code').parentNode; this.$('join-code').focus(); w.style.borderColor = ACCENT; setTimeout(() => (w.style.borderColor = ''), 700); return; }
    try { localStorage.setItem(NAME_KEY, cleanName(this.$('join-name').value, 'Racer')); } catch { /* */ }
    this.joinRoom(code);
  }
  async joinRoom(code) {
    if (!(await this.prepare(`Joining room ${code}`))) return;
    let session = null;
    try {
      const transport = await makeTransport();
      session = new NetSession(this.game, transport, { virtual: this.virtual, base: this.base });
      await session.join(code, this.profileNow(this.name()));
      this.open(session);
    } catch (e) { this.fail(e, session); }
  }
  cancel() { this.cancelled = true; this.busy = false; this.toMenu(); }
  fail(e, session) {
    this.busy = false;
    if (session) { try { session.t.close(); } catch { /* */ } }
    if (this.cancelled) return;
    console.warn('multiplayer:', e);
    this.message(MESSAGES[e && e.code] || `Could not connect (${(e && e.message) || e}).`);
  }
  open(session) {
    this.busy = false;
    if (this.cancelled) { session.leave(); return; }
    this.net = session; this.game.net = session;
    session.listen((ev, data) => this.onEvent(session, ev, data));
    this.$('lb-code').textContent = session.code;
    this.$('lb-name').value = this.name();
    this.hud.show('menu');
    this.render();
    this.show('lobby');
    this.noteIdle();
  }
  leave() {
    const n = this.net;
    if (!n) return this.toMenu();
    n.leave();                    // the session's 'closed' event does the rest
  }

  // ---- session events ----
  onEvent(session, ev, data) {
    if (session !== this.net) return;
    const g = this.game;
    if (ev === 'roster') { this.render(); if (session.phase === 'lobby') this.syncCourse(); }
    else if (ev === 'start') { this.show(null); this.active = false; }
    else if (ev === 'standing' || ev === 'results') { if (!this.panels.res.classList.contains('hide')) this.results(); }
    else if (ev === 'lobby') { this.render(); this.syncCourse(); this.show('lobby'); this.noteIdle(); }
    else if (ev === 'left') { const h = this.hud; h.big(`${session.playerName(data)} left`.toUpperCase(), 3); h.flashT = 2.5; if (!this.panels.res.classList.contains('hide')) this.results(); }
    else if (ev === 'closed') {
      this.net = null;
      this.show(null); this.active = false;
      if (g.state !== 'menu') g.quit();      // (the session is already detached: no second leave)
      else this.hud.show('menu');
      if (data !== 'closed') this.message(MESSAGES[data] || 'The game ended.');
    }
  }
  syncCourse() {
    const n = this.net, g = this.game, id = n.settings.course;
    if (g.state === 'menu' && g.course.id !== id) g.setCourse(COURSES.find((c) => c.id === id) || COURSES[0]);
  }

  render() {
    const n = this.net, $ = this.$;
    if (!n) return;
    const you = n.me && n.me.id;
    let rows = '';
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const p = n.players.find((q) => q.slot === i);
      rows += p
        ? `<div class="pl"><span class="no">${T(String(i + 1), 'f=t c=accent')}</span><span class="sw" style="background:${swatchCss(p.sw)}"></span><span class="nm">${T(p.name)}</span><span class="tag">${T(p.host ? 'Host' : '', 'f=t c=accent')}${p.id === you ? T(p.host ? ' · You' : 'You', 'f=t c=accent') : ''}</span></div>`
        : `<div class="pl empty"><span class="no">${T(String(i + 1), 'f=t')}</span><span class="nm">${T('Open slot', 'f=t')}</span></div>`;
    }
    $('lb-players').innerHTML = rows;
    for (const b of $('lb-sw').children) b.classList.toggle('sel', +b.dataset.sw === (n.me ? n.me.sw : settings.swatch));
    const s = n.settings;
    $('lb-host').classList.toggle('hide', !n.isHost);
    $('lb-guest').classList.toggle('hide', n.isHost);
    for (const b of $('lb-courses').children) b.classList.toggle('sel', b.dataset.lc === s.course);
    for (const b of $('lb-conds').children) b.classList.toggle('sel', b.dataset.ln === s.cond);
    for (const b of $('lb-tods').children) b.classList.toggle('sel', b.dataset.lt === s.tod);
    const course = COURSES.find((c) => c.id === s.course) || COURSES[0];
    $('lb-sum').textContent = `${course.name}\n${s.cond === 'random' ? 'Random sea' : CONDITIONS[s.cond].name}\n${s.tod === 'random' ? 'Random time of day' : TIMES[s.tod].name}`;
    $('lb-start').firstChild && ($('lb-start').firstChild.textContent = n.players.length > 1 ? 'Start race' : 'Start alone');
  }

  // ---- results ----
  // Called when this player finishes (hud.show('finished')): the table fills in as the others finish.
  showResults() { if (this.net) { this.results(); this.show('res'); this.active = false; } }
  results() {
    const n = this.net, g = this.game;
    if (!n) return;
    const done = !!n.results;
    const rows = done ? n.results.map((r) => ({ id: r.id, name: r.name, sw: r.sw, time: r.time, dnf: r.dnf, gone: r.dnf }))
      : n.standing.map((r) => { const p = n.raceRoster.get(r.id) || {}; return { id: r.id, name: p.name || '?', sw: p.sw || 0, time: r.fin, dnf: r.gone, gone: r.gone, next: r.next }; });
    const win = rows.find((r) => r.time != null);
    const total = g.course.total;
    this.$('res-title').textContent = done ? 'Results' : 'Finished';
    this.$('res-sub').textContent = `${g.course.name} · ${(CONDITIONS[g.cond] || {}).name || ''}${g.tod && g.tod !== 'day' ? ` · ${TIMES[g.tod].name}` : ''}`;
    this.$('res-rows').innerHTML = rows.map((r, i) => {
      const t = r.time != null ? fmt(r.time) : r.dnf ? 'DNF' : `Gate ${Math.min(r.next || 0, total)}/${total}`;
      const gap = r.time != null && win && r !== win ? `+${(r.time - win.time).toFixed(2)}` : '';
      return `<div class="rr${r.id === (n.me && n.me.id) ? ' me' : ''}"><span>${T(r.time != null || done ? (ORDINAL[i] || String(i + 1)) : '', 'f=t c=accent')}</span><span class="sw" style="background:${swatchCss(r.sw)}"></span><span>${T(r.name)}</span><span>${T(t, r.time != null ? '' : 'f=t')}</span><span>${T(gap, 'f=t')}</span></div>`;
    }).join('');
    this.$('res-note').textContent = done ? (n.isHost ? '' : 'Waiting for the host to open the lobby') : 'Waiting for the others to finish';
    this.$('res-lobby').classList.toggle('hide', !(n.isHost && done));
  }

  // the pause menu in multiplayer: the race goes on behind it, so there is no restart
  onPause() { const r = this.hud.root.querySelector('#restart'); if (r) r.classList.toggle('hide', !!this.game.net); }
}
