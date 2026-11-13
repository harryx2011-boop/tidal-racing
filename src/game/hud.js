// Menus and the in-race HUD (plain DOM over the canvas).
import { COURSES, CONDITIONS } from './courses.js';

export const HUD_CSS = `
#ui { position: fixed; inset: 0; pointer-events: none; color: #f2f6f8; font: 500 14px/1.3 ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif; user-select: none; text-shadow: 0 1px 3px rgba(0,0,0,.55); }
#ui .hide { display: none !important; }
#ui button { font: inherit; color: inherit; cursor: pointer; pointer-events: auto; }
.num { font-variant-numeric: tabular-nums; font-style: italic; font-weight: 800; letter-spacing: -.01em; }
.lbl { font-size: 11px; letter-spacing: .14em; text-transform: uppercase; opacity: .72; font-weight: 700; }
#tl { position: absolute; left: 28px; top: 22px; }
#tl .time { font-size: 40px; line-height: 1; }
#tl .row { margin-top: 6px; display: flex; gap: 18px; align-items: baseline; }
#tl .row b { font-size: 20px; }
#br { position: absolute; right: 30px; bottom: 26px; text-align: right; }
#br .spd { font-size: 76px; line-height: .9; }
#boost { width: 230px; height: 10px; margin-top: 10px; background: rgba(8,14,20,.5); border-radius: 5px; overflow: hidden; transform: skewX(-14deg); }
#boost i { display: block; height: 100%; width: 0; background: linear-gradient(90deg, #ffb020, #ff5a1f); }
#boost.on i { background: linear-gradient(90deg, #fff3c2, #ffd23f); }
#big { position: absolute; left: 0; right: 0; top: 22%; text-align: center; font-size: 120px; opacity: 0; transition: opacity .25s; }
#msg { position: absolute; left: 0; right: 0; top: 13%; text-align: center; font-size: 20px; letter-spacing: .12em; font-weight: 800; color: #ffd23f; }
#mark { position: absolute; left: 0; top: 0; width: 0; height: 0; }
#mark div { position: absolute; transform: translate(-50%, -100%); text-align: center; white-space: nowrap; }
#mark .arrow { width: 0; height: 0; margin: 0 auto 2px; border: 9px solid transparent; border-top-color: #ffd23f; border-bottom: 0; filter: drop-shadow(0 1px 2px rgba(0,0,0,.6)); }
#map { position: absolute; left: 24px; bottom: 22px; width: 190px; height: 190px; opacity: .92; }
#keys { position: absolute; left: 0; right: 0; bottom: 14px; text-align: center; font-size: 12px; opacity: .6; }
.panel { position: absolute; pointer-events: auto; background: rgba(8,14,20,.62); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); border: 1px solid rgba(255,255,255,.12); border-radius: 14px; padding: 26px 28px; text-shadow: none; }
#menu { left: 44px; top: 50%; transform: translateY(-50%); width: 400px; max-height: 92vh; overflow: auto; box-sizing: border-box; }
#menu h1 { margin: 0; font-size: 44px; font-style: italic; font-weight: 900; letter-spacing: -.02em; line-height: .95; }
#menu h1 span { color: #ff8a2a; }
#menu p.tag { margin: 6px 0 20px; opacity: .7; }
.opts { display: grid; gap: 8px; margin: 8px 0 18px; }
.opts.row { grid-template-columns: repeat(5, 1fr); }
.opt { text-align: left; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.12); border-radius: 9px; padding: 10px 12px; }
.opt:hover { background: rgba(255,255,255,.12); }
.opt.sel { border-color: #ff8a2a; background: rgba(255,138,42,.18); }
.opt b { display: block; font-size: 15px; }
.opt small { opacity: .68; }
.opts.row .opt { text-align: center; padding: 8px 2px; font-size: 13px; }
.go { width: 100%; padding: 14px; border: 0; border-radius: 10px; background: #ff8a2a; color: #14100a !important; font-size: 17px !important; font-weight: 900 !important; font-style: italic; letter-spacing: .04em; }
.go:hover { background: #ffa24f; }
.ghost { width: 100%; margin-top: 8px; padding: 11px; border-radius: 10px; background: transparent; border: 1px solid rgba(255,255,255,.22); font-weight: 700 !important; }
.ghost:hover { background: rgba(255,255,255,.1); }
.help { margin-top: 16px; font-size: 12px; opacity: .68; line-height: 1.6; }
.help kbd { font: inherit; font-weight: 700; padding: 1px 5px; border-radius: 4px; background: rgba(255,255,255,.14); }
#best { margin: -8px 0 16px; font-size: 13px; opacity: .85; }
.centre { left: 50%; top: 50%; transform: translate(-50%, -50%); width: 340px; text-align: center; }
.centre h2 { margin: 0 0 4px; font-size: 30px; font-style: italic; font-weight: 900; }
.centre .t { font-size: 56px; line-height: 1.05; }
.centre .laps { margin: 10px 0 18px; opacity: .8; font-variant-numeric: tabular-nums; }
.nb { color: #ffd23f; font-weight: 800; letter-spacing: .1em; }
@media (max-height: 820px) { #menu { padding: 16px 20px; width: 360px; } #menu h1 { font-size: 30px; } #menu h1 br { display: none; } #menu p.tag { margin: 2px 0 10px; } .opts { gap: 5px; margin: 5px 0 10px; } .opt { padding: 6px 10px; } #best { margin: -4px 0 10px; font-size: 12px; } .go { padding: 10px; } .help { margin-top: 10px; font-size: 11px; line-height: 1.45; } }
@media (max-height: 600px) { .help { display: none; } }
`;

export const fmt = (t) => {
  if (t == null || !isFinite(t)) return '--:--.--';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
};

export class HUD {
  constructor(game) {
    this.game = game;
    this.sel = { course: COURSES[0].id, cond: 'random' };
    const root = (this.root = document.createElement('div'));
    root.id = 'ui';
    const conds = [['random', 'Random'], ...Object.entries(CONDITIONS).map(([k, v]) => [k, v.name])];
    root.innerHTML = `
      <div id="race" class="hide">
        <div id="tl"><div class="lbl">Time</div><div class="time num" id="time">0:00.00</div>
          <div class="row"><span><span class="lbl">Lap</span> <b class="num" id="lap">1/3</b></span><span><span class="lbl">Gate</span> <b class="num" id="gate">0/0</b></span><span><span class="lbl">Best</span> <b class="num" id="pb">--</b></span></div></div>
        <div id="msg"></div>
        <div id="big" class="num"></div>
        <div id="mark"><div><div class="arrow"></div><span class="num" id="dist"></span></div></div>
        <canvas id="map" width="380" height="380"></canvas>
        <div id="br"><div class="spd num" id="spd">0</div><div class="lbl">knots</div><div id="boost"><i></i></div><div class="lbl" style="margin-top:5px">Boost</div></div>
        <div id="keys">W/S throttle · A/D steer · Shift boost · C camera · R reset to last gate · Esc pause</div>
      </div>
      <div id="menu" class="panel">
        <h1>TIDAL<br><span>RACING</span></h1>
        <p class="tag">Powerboats on a living sea. Time trial.</p>
        <div class="lbl">Course</div>
        <div class="opts" id="courses">${COURSES.map((c) => `<button class="opt" data-course="${c.id}"><b>${c.name}</b><small>${c.blurb}</small></button>`).join('')}</div>
        <div class="lbl">Conditions</div>
        <div class="opts row" id="conds">${conds.map(([k, n]) => `<button class="opt" data-cond="${k}">${n}</button>`).join('')}</div>
        <div id="best"></div>
        <button class="go" id="start">START</button>
        <div class="help"><kbd>W</kbd><kbd>S</kbd> throttle · <kbd>A</kbd><kbd>D</kbd> steer · <kbd>Shift</kbd> boost<br><kbd>C</kbd> camera · <kbd>R</kbd> reset · <kbd>Esc</kbd> pause · <kbd>M</kbd> sound<br>Gamepad: triggers, left stick, A to boost.<br>Airtime off wave crests fills your boost.</div>
      </div>
      <div id="pause" class="panel centre hide"><h2>PAUSED</h2><button class="go" id="resume">RESUME</button><button class="ghost" id="restart">Restart</button><button class="ghost" id="quit">Quit to menu</button></div>
      <div id="results" class="panel centre hide"><h2 id="rtitle">FINISH</h2><div class="t num" id="rtime"></div><div id="rbest"></div><div class="laps" id="rlaps"></div><button class="go" id="again">RACE AGAIN</button><button class="ghost" id="rquit">Menu</button></div>`;
    document.body.appendChild(root);
    const $ = (id) => root.querySelector('#' + id);
    this.el = Object.fromEntries(['race', 'menu', 'pause', 'results', 'time', 'lap', 'gate', 'pb', 'msg', 'big', 'mark', 'dist', 'map', 'spd', 'boost', 'best', 'rtitle', 'rtime', 'rbest', 'rlaps', 'keys'].map((k) => [k, $(k)]));
    this.ctx = this.el.map.getContext('2d');
    root.querySelector('#courses').addEventListener('click', (e) => { const b = e.target.closest('[data-course]'); if (b) { this.sel.course = b.dataset.course; game.setCourse(COURSES.find((c) => c.id === this.sel.course)); this.sync(); } });
    root.querySelector('#conds').addEventListener('click', (e) => { const b = e.target.closest('[data-cond]'); if (b) { this.sel.cond = b.dataset.cond; this.sync(); } });
    const go = () => game.start(this.sel.course, this.sel.cond);
    $('start').addEventListener('click', go);
    $('again').addEventListener('click', go);
    $('restart').addEventListener('click', go);
    $('resume').addEventListener('click', () => { game.paused = false; this.pause(false); });
    $('quit').addEventListener('click', () => game.quit());
    $('rquit').addEventListener('click', () => game.quit());
    this.flashT = 0; this.lastCount = '';
    this.sync();
  }

  sync() {
    for (const b of this.root.querySelectorAll('[data-course]')) b.classList.toggle('sel', b.dataset.course === this.sel.course);
    for (const b of this.root.querySelectorAll('[data-cond]')) b.classList.toggle('sel', b.dataset.cond === this.sel.cond);
    let best = null;
    if (this.sel.cond !== 'random') { try { best = JSON.parse(localStorage.getItem(`tidal.best.${this.sel.course}.${this.sel.cond}`)); } catch { /* none */ } }
    this.el.best.textContent = this.sel.cond === 'random' ? 'Random rolls the sea and the sun for each race. Best times are kept per condition.' : best ? `Your best: ${fmt(best.time)} (you race its ghost)` : 'No time set in these conditions yet.';
  }

  show(state) {
    const g = this.game, e = this.el;
    e.menu.classList.toggle('hide', state !== 'menu');
    e.race.classList.toggle('hide', state === 'menu');
    e.results.classList.toggle('hide', state !== 'finished');
    e.pause.classList.add('hide');
    if (state === 'menu') this.sync();
    if (state === 'countdown') { e.pb.textContent = g.best ? fmt(g.best.time) : '--'; this.lastCount = ''; e.keys.style.opacity = ''; }
    if (state === 'finished') {
      e.rtitle.textContent = `${g.course.name} · ${CONDITIONS[g.cond].name}`;
      e.rtime.textContent = fmt(g.finishTime);
      e.rbest.innerHTML = g.newBest ? `<span class="nb">NEW BEST</span>${g.prevBest ? ` &nbsp;−${(g.prevBest - g.finishTime).toFixed(2)}s` : ''}` : `Best ${fmt(g.prevBest)} &nbsp;+${(g.finishTime - g.prevBest).toFixed(2)}s`;
      e.rlaps.innerHTML = g.laps.map((t, i) => `Lap ${i + 1} &nbsp; ${fmt(t)}`).join('<br>');
    }
  }

  pause(on) { this.el.pause.classList.toggle('hide', !on); }
  flash(text) { this.el.big.textContent = text; this.el.big.style.fontSize = '84px'; this.el.big.style.opacity = 1; this.flashT = 1.3; }
  toggleSound() { const a = this.game.audio; a.muted = !a.muted; a.enable(!a.muted).catch(() => {}); }

  update(dt) {
    const g = this.game, e = this.el, boat = g.boat;
    if (g.state === 'menu') return;
    const t = g.raceTime;
    this.text(e.time, fmt(t));
    this.text(e.spd, String(Math.round(boat.speed * 1.944)));
    const P = g.progress, n = g.course.gates.length;
    this.text(e.lap, g.course.loop ? `${P.lap}/${g.course.laps}` : '1/1');
    this.text(e.gate, `${Math.min(P.next, g.course.total)}/${g.course.total}`);
    e.boost.firstElementChild.style.width = `${boat.boost * 100}%`;
    e.boost.classList.toggle('on', boat.boosting);
    // countdown and flashes
    if (g.state === 'countdown') {
      const left = g.t0 - g.app.time;
      const c = left > 3 ? '' : String(Math.ceil(left));
      if (c !== this.lastCount) { this.lastCount = c; e.big.textContent = c; e.big.style.fontSize = '120px'; e.big.style.opacity = c ? 1 : 0; }
    } else if (this.lastCount) { this.lastCount = ''; this.flash('GO'); }
    else if (this.flashT > 0 && (this.flashT -= dt) <= 0) e.big.style.opacity = 0;
    if (t > 12) e.keys.style.opacity = 0;
    this.text(e.msg, g.state === 'racing' && P.missed > 0 ? 'MISSED GATE · TURN BACK OR PRESS R' : '');
    this.marker();
    this.minimap();
  }
  text(el, s) { if (el.textContent !== s) el.textContent = s; }

  // on-screen pointer to the next gate, pinned to the screen edge when it is out of view
  marker() {
    const g = this.game, e = this.el, P = g.progress;
    if (P.done || g.state === 'finished' || !g.app.vp) { e.mark.style.display = 'none'; return; }
    const gate = P.gate, vp = g.app.vp, x = gate.c[0], y = 9, z = gate.c[1];
    const cx = vp[0] * x + vp[4] * y + vp[8] * z + vp[12], cy = vp[1] * x + vp[5] * y + vp[9] * z + vp[13], cw = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
    let nx = cx / Math.abs(cw || 1e-6), ny = cy / Math.abs(cw || 1e-6);
    // behind the camera: pin to the side it lies on
    if (cw < 0) { nx = cx < 0 ? -1 : 1; ny = -0.2; }
    nx = Math.max(-0.92, Math.min(0.92, nx)); ny = Math.max(-0.8, Math.min(0.78, ny));
    e.mark.style.display = '';
    e.mark.style.transform = `translate(${((nx * 0.5 + 0.5) * innerWidth).toFixed(1)}px, ${((0.5 - ny * 0.5) * innerHeight).toFixed(1)}px)`;
    this.text(e.dist, `${Math.round(Math.hypot(x - g.boat.pos[0], z - g.boat.pos[2]))} m`);
  }

  minimap() {
    const g = this.game, c = this.ctx, S = 380, gates = g.course.gates;
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const q of gates) { x0 = Math.min(x0, q.c[0]); x1 = Math.max(x1, q.c[0]); z0 = Math.min(z0, q.c[1]); z1 = Math.max(z1, q.c[1]); }
    const sc = (S - 60) / Math.max(x1 - x0, z1 - z0, 1), ox = (S - (x1 - x0) * sc) / 2, oz = (S - (z1 - z0) * sc) / 2;
    const X = (x) => ox + (x - x0) * sc, Z = (z) => oz + (z - z0) * sc;
    c.clearRect(0, 0, S, S);
    c.lineJoin = 'round'; c.lineCap = 'round';
    c.beginPath();
    gates.forEach((q, i) => (i ? c.lineTo(X(q.c[0]), Z(q.c[1])) : c.moveTo(X(q.c[0]), Z(q.c[1]))));
    if (g.course.loop) c.closePath();
    c.strokeStyle = 'rgba(8,14,20,.55)'; c.lineWidth = 16; c.stroke();
    c.strokeStyle = 'rgba(255,255,255,.75)'; c.lineWidth = 4; c.stroke();
    const nextI = g.progress.done ? -1 : g.progress.next % gates.length;
    gates.forEach((q, i) => {
      c.beginPath(); c.moveTo(X(q.port[0]), Z(q.port[1])); c.lineTo(X(q.stbd[0]), Z(q.stbd[1]));
      c.strokeStyle = i === nextI ? '#ffd23f' : 'rgba(255,255,255,.5)'; c.lineWidth = i === nextI ? 7 : 3; c.stroke();
    });
    const dot = (b, col, r) => { c.beginPath(); c.arc(X(b.pos[0]), Z(b.pos[2]), r, 0, 6.3); c.fillStyle = col; c.fill(); };
    if (g.ghostAt(g.raceTime)) dot(g.ghostBoat, 'rgba(160,210,255,.9)', 7);
    const b = g.boat;
    c.save(); c.translate(X(b.pos[0]), Z(b.pos[2])); c.rotate(b.yaw);
    c.beginPath(); c.moveTo(15, 0); c.lineTo(-10, -9); c.lineTo(-5, 0); c.lineTo(-10, 9); c.closePath();
    c.fillStyle = '#ff8a2a'; c.strokeStyle = '#14100a'; c.lineWidth = 2.5; c.fill(); c.stroke(); c.restore();
  }
}
