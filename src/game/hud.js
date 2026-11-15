// Menus and the in-race HUD: DOM over the canvas, drawn as pixel art. Two tones and one accent;
// every shade between them is an ordered dither, all text is the bitmap font in pixel.js, and
// every length is in logical pixels (1em inside #ui, a whole number of device pixels).
import { COURSES, CONDITIONS, TIMES } from './courses.js';
import { settings, SWATCHES, STRIPES, TIERS } from './settings.js';
import { T, dither, unit, Bitmap, PAPER, INK, ACCENT } from './pixel.js';

const DITHER = 'background-size: 4em 4em; background-attachment: fixed; image-rendering: pixelated;';
export const HUD_CSS = `
#ui { position: fixed; inset: 0; pointer-events: none; user-select: none; line-height: 0; color: ${PAPER}; }
#ui .hide { display: none !important; }
/* (:where keeps the reset at zero specificity, so the classes below win) */
:where(#ui) button { appearance: none; -webkit-appearance: none; border: 0; margin: 0; padding: 0; background: none; font: inherit; color: inherit; cursor: pointer; pointer-events: auto; box-sizing: border-box; display: block; }
#ui button:focus-visible, #ui input:focus-visible { outline: 1em solid ${ACCENT}; outline-offset: 1em; }
#ui .col { display: flex; flex-direction: column; }
#ui .wrap { position: absolute; inset: 0; display: grid; place-items: center; }
#ui .wrap.left { justify-items: start; padding-left: 14em; }

/* race HUD: outlined text straight on the picture */
#tl { position: absolute; left: 8em; top: 7em; gap: 2em; align-items: flex-start; }
#tl .row { display: flex; gap: 9em; margin-top: 3em; }
#tl .row .col { gap: 1em; align-items: flex-start; }
#br { position: absolute; right: 8em; bottom: 8em; gap: 2em; align-items: flex-end; }
#boost { display: flex; gap: 1em; padding: 1em; background: ${INK}; border: 1em solid ${PAPER}; margin-top: 2em; }
#boost i { width: 5em; height: 5em; background-image: var(--dp4); ${DITHER} }
#boost i.on { background: ${ACCENT}; }
#boost.on i.on { background: ${PAPER}; }
#big { position: absolute; left: 0; right: 0; top: 64em; display: grid; place-items: center; }
#msg { position: absolute; left: 0; right: 0; top: 40em; display: grid; place-items: center; }
#mark { position: absolute; left: 0; top: 0; width: 0; height: 0; }
#mark .col { position: absolute; transform: translate(-50%, -100%); align-items: center; gap: 1em; }
#map { position: absolute; left: 8em; bottom: 8em; width: 66em; height: 66em; border: 1em solid ${PAPER}; outline: 1em solid ${INK}; background-image: var(--dk10); ${DITHER} }
#keys { position: absolute; left: 0; right: 0; bottom: 5em; display: grid; place-items: center; }

/* plates: dithered ink you can still see the sea through, hard double border, dithered drop shadow */
.plate { position: relative; pointer-events: auto; box-sizing: border-box; display: flex; flex-direction: column; gap: 4em; padding: 8em 9em; border: 1em solid ${PAPER}; outline: 1em solid ${INK}; background-image: var(--dk14); ${DITHER} }
.plate::before, .plate::after { content: ''; position: absolute; background-image: var(--dk8); ${DITHER} }
.plate::before { left: calc(100% + 2em); top: 3em; bottom: -5em; width: 4em; }
.plate::after { top: calc(100% + 2em); left: 3em; right: -2em; height: 4em; }
.lbl { margin-top: 3em; }
.btn { background: ${INK}; border: 1em solid ${PAPER}; padding: 3em 4em; display: grid; place-items: center; }
.btn:hover { background-image: var(--dp5); ${DITHER} }
.btn.sel { background: ${PAPER}; }
.btn.sel px-t { filter: invert(1); }
.btn.left { place-items: start; gap: 2em; padding: 4em 5em; }
.go { background: ${ACCENT}; border: 1em solid ${INK}; outline: 1em solid ${PAPER}; padding: 5em 4em; margin: 2em 1em; display: grid; place-items: center; }
.go:hover { background: ${PAPER}; }
.go:active { background-image: var(--dp8); ${DITHER} }
.seg { display: flex; gap: 2em; flex: 1; }
.seg .btn { flex: 1; padding: 2em 1em; }
#menu { width: 172em; }
#menu .title { display: flex; flex-direction: column; gap: 2em; align-items: flex-start; }
#menu { gap: 3em; padding: 6em 9em; }
#menu .lbl { margin-top: 2em; }
#menu .btn.left { padding: 3em 5em; }
#menu .go { padding: 4em; margin: 1em; }
#courses { gap: 2em; }
.centre { align-items: stretch; text-align: center; min-width: 120em; }
.centre > px-t { align-self: center; }
#results { min-width: 150em; }

/* settings */
#settings { width: 252em; gap: 2em; padding: 7em 9em; }
#settings .sec { display: flex; flex-direction: column; gap: 2em; padding-top: 4em; margin-top: 2em; border-top: 1em solid ${PAPER}; }
#settings .srow { display: flex; align-items: center; gap: 4em; min-height: 11em; }
#settings .nm { flex: 0 0 64em; }
#settings .val { flex: 0 0 22em; display: flex; justify-content: flex-end; }
#settings .sw { display: flex; gap: 4em; flex: 1; }
#settings .sw button { width: 12em; height: 12em; border: 1em solid ${INK}; outline: 1em solid ${PAPER}; }
#settings .sw button.sel { outline: 2em solid ${ACCENT}; }
#settings .step { width: 15em; padding: 2em 0; }
#settings .numv { flex: 0 0 30em; display: grid; place-items: center; }
#ui input[type=range] { -webkit-appearance: none; appearance: none; flex: 1; min-width: 0; height: 11em; margin: 0; padding: 0; background: transparent; font: inherit; cursor: pointer; pointer-events: auto; }
#ui input[type=range]::-webkit-slider-runnable-track { height: 3em; border: 1em solid ${PAPER}; background-image: var(--dp5); ${DITHER} }
#ui input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 5em; height: 9em; margin-top: -4em; border: 1em solid ${INK}; border-radius: 0; background: ${PAPER}; box-shadow: 0 0 0 1em ${PAPER}; }
#ui input[type=range]::-moz-range-track { height: 3em; border: 1em solid ${PAPER}; background-image: var(--dp5); ${DITHER} }
#ui input[type=range]::-moz-range-thumb { width: 3em; height: 7em; border: 1em solid ${INK}; border-radius: 0; background: ${PAPER}; }
#ui input[type=range]:disabled { cursor: default; }
#ui input[type=range]:disabled::-webkit-slider-thumb { background-image: var(--dp8); ${DITHER} box-shadow: none; }
#ui input[type=range]:disabled::-moz-range-thumb { background-image: var(--dp8); ${DITHER} }
`;

export const fmt = (t) => {
  if (t == null || !isFinite(t)) return '--:--.--';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
};

const BOOST_CELLS = 12, MAP = 64;

export class HUD {
  constructor(game) {
    this.game = game;
    this.sel = { course: COURSES[0].id, cond: 'random', tod: 'random' };
    const root = (this.root = document.createElement('div'));
    root.id = 'ui';
    // dither patterns: ink over the picture (k), paper over ink (p); the number is how many of 16 pixels are set
    for (const n of [8, 10, 14]) root.style.setProperty(`--dk${n}`, dither(n, INK));
    for (const n of [4, 5, 8]) root.style.setProperty(`--dp${n}`, dither(n, PAPER, INK));
    const fit = () => { this.u = unit(); root.style.fontSize = `${this.u}px`; };
    fit();
    window.addEventListener('resize', fit);
    const conds = [['random', 'Random'], ...Object.entries(CONDITIONS).map(([k, v]) => [k, v.name])];
    const times = [['day', 'Day'], ['sunrise', 'Sunrise'], ['sunset', 'Sunset'], ['random', 'Random']];
    const stat = (label, id) => `<div class="col">${T(label, 'f=t o')}<px-t id="${id}" o></px-t></div>`;
    const row = (name, body, title = '') => `<div class="srow"><span class="nm"${title ? ` title="${title}"` : ''}>${T(name, 'f=t')}</span>${body}</div>`;
    const onoff = (key) => `<div class="seg"><button class="btn" data-${key}="1">${T('On', 'f=t')}</button><button class="btn" data-${key}="0">${T('Off', 'f=t')}</button></div>`;
    root.innerHTML = `
      <div id="race" class="hide">
        <div id="tl" class="col">${T('Time', 'f=t o')}<px-t id="time" s="2" o>0:00.00</px-t>
          <div class="row">${stat('Lap', 'lap')}${stat('Gate', 'gate')}${stat('Best', 'pb')}</div></div>
        <div id="msg"><px-t id="msgt" c="accent" o></px-t></div>
        <div id="big"><px-t id="bigt" s="8" o></px-t></div>
        <div id="mark"><div class="col">${T('▼', 'c=accent o')}<px-t id="dist" f="t" o></px-t></div></div>
        <canvas id="map"></canvas>
        <div id="br" class="col"><px-t id="spd" s="4" o>0</px-t>${T('Knots', 'f=t o')}<div id="boost">${'<i></i>'.repeat(BOOST_CELLS)}</div>${T('Boost', 'f=t o')}</div>
        <div id="keys">${T('W/S throttle · A/D steer · Shift boost · C camera · R reset · Esc pause', 'f=t o')}</div>
      </div>
      <div class="wrap left"><div id="menu" class="plate">
        <div class="title">${T('Tidal', 's=3')}${T('Racing', 's=3 c=accent')}</div>
        ${T('Powerboats on a living sea · Time trial', 'f=t')}
        <div class="lbl">${T('Course', 'f=t c=accent')}</div>
        <div class="col" id="courses">${COURSES.map((c) => `<button class="btn left" data-course="${c.id}">${T(c.name)}${T(c.blurb, 'f=t')}</button>`).join('')}</div>
        <div class="lbl">${T('Conditions', 'f=t c=accent')}</div>
        <div class="seg" id="conds">${conds.map(([k, n]) => `<button class="btn" data-cond="${k}">${T(n, 'f=t')}</button>`).join('')}</div>
        <div class="lbl">${T('Time of day', 'f=t c=accent')}</div>
        <div class="seg" id="tods">${times.map(([k, n]) => `<button class="btn" data-tod="${k}">${T(n, 'f=t')}</button>`).join('')}</div>
        <px-t id="best" f="t" w="152"></px-t>
        <button class="go" id="start">${T('Start', 's=2 c=ink')}</button>
        <button class="btn" id="settings-btn">${T('Settings')}</button>
        <div class="lbl">${T('W/S throttle · A/D steer · Shift boost\nC camera · R reset · Esc pause · F3 stats\nAirtime off wave crests fills your boost', 'f=t')}</div>
      </div></div>
      <div class="wrap">
        <div id="pause" class="plate centre hide">${T('Paused', 's=2')}<button class="go" id="resume">${T('Resume', 'c=ink')}</button><button class="btn" id="pause-settings">${T('Settings')}</button><button class="btn" id="restart">${T('Restart')}</button><button class="btn" id="quit">${T('Quit to menu')}</button></div>
        <div id="settings" class="plate hide" role="dialog" aria-label="Settings">
          ${T('Settings', 's=2')}
          <div class="sec">${T('Graphics quality', 'f=t c=accent')}
            <div class="srow"><div class="seg" id="set-q">${TIERS.map((t) => `<button class="btn" data-q="${t}">${T(t)}</button>`).join('')}</div></div>
            <div class="srow"><px-t id="set-qnote" f="t" w="176"></px-t><button class="btn hide" id="set-reload">${T('Reload now', 'f=t')}</button></div></div>
          <div class="sec">${T('Sound and effects', 'f=t c=accent')}
            ${row('Volume', `<input type="range" id="set-vol" min="0" max="100" step="1" aria-label="Master volume"><span class="val"><px-t id="set-volv" f="t"></px-t></span><button class="btn" id="set-mute" style="padding:2em 4em"><px-t id="set-mutet" f="t">Mute</px-t></button>`)}
            ${row('Speed effects', onoff('sfx'), 'Camera shake and edge blur that grow with speed and boost')}</div>
          <div class="sec">${T('Performance', 'f=t c=accent')}
            ${row('Automatic', onoff('auto'))}
            <px-t id="set-anote" f="t" w="232"></px-t>
            ${[['spray', 'Spray'], ['waterShadow', 'Water shadow'], ['shadows', 'Boat shadows']].map(([k, n]) => row(n, `<input type="range" data-fx="${k}" min="0" max="100" step="5" aria-label="${n} level"><span class="val"><px-t data-fxv="${k}" f="t"></px-t></span>`)).join('')}</div>
          <div class="sec">${T('Livery', 'f=t c=accent')}
            ${row('Colour', `<div class="sw" id="set-sw">${SWATCHES.map((c, i) => `<button data-sw="${i}" title="${c.name}" aria-label="${c.name}" style="background:#${c.hex.toString(16).padStart(6, '0')}"></button>`).join('')}</div>`)}
            ${row('Stripe', `<div class="seg" id="set-stripe">${STRIPES.map((n, i) => `<button class="btn" data-stripe="${i}" title="${n}">${T(i === 0 ? 'None' : String(i), 'f=t')}</button>`).join('')}</div>`)}
            ${row('Race number', `<button class="btn step" id="set-nm" aria-label="Number down">${T('-')}</button><span class="numv"><px-t id="set-num" s="2"></px-t></span><button class="btn step" id="set-np" aria-label="Number up">${T('+')}</button>`)}</div>
          <button class="go" id="set-back" style="margin-top:5em;padding:3em">${T('Done', 'c=ink')}</button>
        </div>
        <div id="results" class="plate centre hide"><px-t id="rtitle" f="t"></px-t><px-t id="rtime" s="3"></px-t><px-t id="rbest"></px-t><px-t id="rlaps" f="t" a="center"></px-t><button class="go" id="again">${T('Race again', 'c=ink')}</button><button class="btn" id="rquit">${T('Menu')}</button></div>
      </div>`;
    document.body.appendChild(root);
    const $ = (id) => root.querySelector('#' + id);
    this.el = Object.fromEntries(['race', 'menu', 'pause', 'results', 'time', 'lap', 'gate', 'pb', 'msgt', 'bigt', 'mark', 'dist', 'map', 'spd', 'boost', 'best', 'rtitle', 'rtime', 'rbest', 'rlaps', 'keys'].map((k) => [k, $(k)]));
    this.map = new Bitmap(this.el.map, MAP, MAP);
    this.cells = Array.from(this.el.boost.children);
    this.cellsOn = -1;
    root.querySelector('#courses').addEventListener('click', (e) => { const b = e.target.closest('[data-course]'); if (b) { this.sel.course = b.dataset.course; game.setCourse(COURSES.find((c) => c.id === this.sel.course)); this.sync(); } });
    root.querySelector('#conds').addEventListener('click', (e) => { const b = e.target.closest('[data-cond]'); if (b) { this.sel.cond = b.dataset.cond; this.sync(); } });
    root.querySelector('#tods').addEventListener('click', (e) => { const b = e.target.closest('[data-tod]'); if (b) { this.sel.tod = b.dataset.tod; this.sync(); } });
    const go = () => game.start(this.sel.course, this.sel.cond, this.sel.tod);
    $('start').addEventListener('click', go);
    $('again').addEventListener('click', go);
    $('restart').addEventListener('click', go);
    $('resume').addEventListener('click', () => { game.paused = false; this.pause(false); });
    $('quit').addEventListener('click', () => game.quit());
    $('rquit').addEventListener('click', () => game.quit());
    this.flashT = 0; this.lastCount = '';
    this.sync();
    this.initSettings();
  }

  initSettings() {
    const root = this.root, game = this.game, S = settings, q = (sel) => root.querySelector(sel);
    this.setEl = q('#settings');
    this.setFrom = 'menu';
    const open = (from) => {
      this.setFrom = from;
      this.el[from === 'pause' ? 'pause' : 'menu'].classList.add('hide');
      this.setEl.classList.remove('hide');
      this.syncSettings(true);
      q('#set-back').focus({ preventScroll: true });
    };
    q('#settings-btn').addEventListener('click', () => open('menu'));
    q('#pause-settings').addEventListener('click', () => open('pause'));
    q('#set-back').addEventListener('click', () => this.closeSettings(true));
    // Escape closes the panel instead of resuming the race behind it (capture: before Input sees it)
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && !this.setEl.classList.contains('hide')) { e.stopImmediatePropagation(); e.preventDefault(); this.closeSettings(true); }
    }, true);
    q('#set-q').addEventListener('click', (e) => { const b = e.target.closest('[data-q]'); if (b) { S.update({ quality: b.dataset.q }); this.syncSettings(); } });
    q('#set-vol').addEventListener('input', (e) => { S.update({ volume: e.target.value / 100 }); this.syncSettings(); });
    q('#set-mute').addEventListener('click', () => { S.update({ muted: !S.muted }); this.syncSettings(); });
    for (const b of root.querySelectorAll('[data-sfx]')) b.addEventListener('click', () => { S.update({ speedFx: b.dataset.sfx === '1' }); this.syncSettings(); });
    for (const b of root.querySelectorAll('[data-auto]')) b.addEventListener('click', () => {
      const auto = b.dataset.auto === '1';
      if (auto === S.auto) return;
      // switching it off keeps the levels the governor had reached as the starting point
      S.update(auto ? { auto } : { auto, fx: { spray: game.app.fx.spray, waterShadow: game.app.fx.waterShadow, shadows: game.app.fx.shadows } });
      this.syncSettings(true);
    });
    for (const r of root.querySelectorAll('[data-fx]')) r.addEventListener('input', () => { S.update({ fx: { ...S.fx, [r.dataset.fx]: r.value / 100 } }); this.syncSettings(); });
    q('#set-sw').addEventListener('click', (e) => { const b = e.target.closest('[data-sw]'); if (b) { S.update({ swatch: +b.dataset.sw }); this.syncSettings(); } });
    q('#set-stripe').addEventListener('click', (e) => { const b = e.target.closest('[data-stripe]'); if (b) { S.update({ stripe: +b.dataset.stripe }); this.syncSettings(); } });
    q('#set-reload').addEventListener('click', () => location.reload());
    q('#set-nm').addEventListener('click', () => { S.update({ number: (S.number + 99) % 100 }); this.syncSettings(true); });
    q('#set-np').addEventListener('click', () => { S.update({ number: (S.number + 1) % 100 }); this.syncSettings(true); });
    this.syncSettings(true);
  }

  // refresh controls from the settings; all = also the slider positions and the number box
  syncSettings(all) {
    const S = settings, q = (sel) => this.root.querySelector(sel), fx = this.game.app.fx;
    const tier = S.quality || S.active;
    for (const b of this.root.querySelectorAll('[data-q]')) b.classList.toggle('sel', b.dataset.q === tier);
    const urlQ = new URLSearchParams(location.search).has('q');
    q('#set-reload').classList.toggle('hide', tier === S.active);
    q('#set-qnote').textContent = tier !== S.active
      ? `${tier} needs a reload: the sea and cloud buffers are sized at start.${urlQ ? ' A ?q= in the address overrides the saved choice.' : ''}`
      : `Running ${S.active}. A change applies after a reload.`;
    q('#set-vol').value = Math.round(S.volume * 100);
    q('#set-volv').textContent = `${Math.round(S.volume * 100)}%`;
    q('#set-mute').classList.toggle('sel', S.muted);
    q('#set-mutet').textContent = S.muted ? 'Muted' : 'Mute';
    for (const b of this.root.querySelectorAll('[data-sfx]')) b.classList.toggle('sel', (b.dataset.sfx === '1') === S.speedFx);
    for (const b of this.root.querySelectorAll('[data-auto]')) b.classList.toggle('sel', (b.dataset.auto === '1') === S.auto);
    q('#set-anote').textContent = S.auto ? 'Gives up spray, then water shadow, then boat shadows, then resolution, to hold 60 fps.' : 'Fixed levels at full resolution. 0 turns an effect off.';
    for (const r of this.root.querySelectorAll('[data-fx]')) {
      const v = S.auto ? fx[r.dataset.fx] : S.fx[r.dataset.fx];
      r.disabled = S.auto;
      if (all || !r.matches(':active')) r.value = Math.round(v * 100);
      this.root.querySelector(`[data-fxv="${r.dataset.fx}"]`).textContent = `${Math.round(v * 100)}%`;
    }
    for (const b of this.root.querySelectorAll('[data-sw]')) b.classList.toggle('sel', +b.dataset.sw === S.swatch);
    for (const b of this.root.querySelectorAll('[data-stripe]')) b.classList.toggle('sel', +b.dataset.stripe === S.stripe);
    q('#set-num').textContent = String(S.number).padStart(2, '0');
  }

  closeSettings(restore) {
    if (this.setEl.classList.contains('hide')) return;
    this.setEl.classList.add('hide');
    if (restore) this.el[this.setFrom === 'pause' ? 'pause' : 'menu'].classList.remove('hide');
  }

  sync() {
    for (const b of this.root.querySelectorAll('[data-course]')) b.classList.toggle('sel', b.dataset.course === this.sel.course);
    for (const b of this.root.querySelectorAll('[data-cond]')) b.classList.toggle('sel', b.dataset.cond === this.sel.cond);
    for (const b of this.root.querySelectorAll('[data-tod]')) b.classList.toggle('sel', b.dataset.tod === this.sel.tod);
    let best = null;
    if (this.sel.cond !== 'random') { try { best = JSON.parse(localStorage.getItem(`tidal.best.${this.sel.course}.${this.sel.cond}`)); } catch { /* none */ } }
    this.el.best.textContent = this.sel.cond === 'random' ? 'Random rolls the sea for each race. Best times are kept per sea condition, whatever the time of day.' : best ? `Your best: ${fmt(best.time)} (you race its ghost)` : 'No time set in these conditions yet.';
  }

  show(state) {
    const g = this.game, e = this.el;
    this.closeSettings(false);
    e.menu.classList.toggle('hide', state !== 'menu');
    e.race.classList.toggle('hide', state === 'menu');
    e.results.classList.toggle('hide', state !== 'finished');
    e.pause.classList.add('hide');
    if (state === 'menu') this.sync();
    if (state === 'countdown') { e.pb.textContent = g.best ? fmt(g.best.time) : '--'; this.lastCount = ''; e.keys.style.visibility = ''; }
    if (state === 'finished') {
      e.rtitle.textContent = `${g.course.name} · ${CONDITIONS[g.cond].name}${g.tod && g.tod !== 'day' ? ` · ${TIMES[g.tod].name}` : ''}`;
      e.rtime.textContent = fmt(g.finishTime);
      e.rbest.setAttribute('c', g.newBest ? 'accent' : 'paper');
      e.rbest.textContent = g.newBest ? `New best${g.prevBest ? `  -${(g.prevBest - g.finishTime).toFixed(2)}s` : ''}` : `Best ${fmt(g.prevBest)}  +${(g.finishTime - g.prevBest).toFixed(2)}s`;
      e.rlaps.textContent = g.laps.map((t, i) => `Lap ${i + 1}  ${fmt(t)}`).join('\n');
    }
  }

  pause(on) { if (!on) this.closeSettings(false); this.el.pause.classList.toggle('hide', !on || !this.setEl.classList.contains('hide')); }
  flash(text) { this.big(text, 6); this.flashT = 1.3; }
  big(text, scale) { const b = this.el.bigt; b.setAttribute('s', scale); b.textContent = text; }
  toggleSound() { const a = this.game.audio; a.muted = !a.muted; a.enable(!a.muted).catch(() => {}); settings.update({ muted: a.muted }); if (this.setEl) this.syncSettings(); }

  update(dt) {
    const g = this.game, e = this.el, boat = g.boat;
    if (g.state === 'menu') return;
    const t = g.raceTime;
    this.text(e.time, fmt(t));
    this.text(e.spd, String(Math.round(boat.speed * 1.944)));
    const P = g.progress, n = g.course.gates.length;
    this.text(e.lap, g.course.loop ? `${P.lap}/${g.course.laps}` : '1/1');
    this.text(e.gate, `${Math.min(P.next, g.course.total)}/${g.course.total}`);
    const on = Math.round(boat.boost * BOOST_CELLS);
    if (on !== this.cellsOn) { this.cellsOn = on; this.cells.forEach((c, i) => c.classList.toggle('on', i < on)); }
    e.boost.classList.toggle('on', boat.boosting);
    // countdown and flashes
    if (g.state === 'countdown') {
      const left = g.t0 - g.app.time;
      const c = left > 3 ? '' : String(Math.ceil(left));
      if (c !== this.lastCount) { this.lastCount = c; this.big(c, 8); }
    } else if (this.lastCount) { this.lastCount = ''; this.flash('GO'); }
    else if (this.flashT > 0 && (this.flashT -= dt) <= 0) this.big('', 6);
    if (t > 12) e.keys.style.visibility = 'hidden';
    this.text(e.msgt, g.state === 'racing' && P.missed > 0 ? 'Missed gate \u00b7 turn back or press R' : '');
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
    const u = this.u, snap = (v) => Math.round(v / u) * u;
    e.mark.style.transform = `translate(${snap((nx * 0.5 + 0.5) * innerWidth)}px, ${snap((0.5 - ny * 0.5) * innerHeight)}px)`;
    this.text(e.dist, `${Math.round(Math.hypot(x - g.boat.pos[0], z - g.boat.pos[2]))} m`);
  }

  minimap() {
    const g = this.game, m = this.map, gates = g.course.gates;
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const q of gates) { x0 = Math.min(x0, q.c[0]); x1 = Math.max(x1, q.c[0]); z0 = Math.min(z0, q.c[1]); z1 = Math.max(z1, q.c[1]); }
    const sc = (MAP - 14) / Math.max(x1 - x0, z1 - z0, 1), ox = (MAP - (x1 - x0) * sc) / 2, oz = (MAP - (z1 - z0) * sc) / 2;
    const X = (x) => ox + (x - x0) * sc, Z = (z) => oz + (z - z0) * sc;
    m.clear();
    const n = gates.length, last = g.course.loop ? n : n - 1;
    // the course: an ink line three pixels wide with a paper line down its middle
    for (const [r, col] of [[1, INK], [0, PAPER]])
      for (let i = 0; i < last; i++) { const a = gates[i].c, b = gates[(i + 1) % n].c; m.line(X(a[0]), Z(a[1]), X(b[0]), Z(b[1]), r, col); }
    const nextI = g.progress.done ? -1 : g.progress.next % n;
    if (nextI >= 0) { const q = gates[nextI]; m.block(X(q.c[0]), Z(q.c[1]), 2, INK); m.block(X(q.c[0]), Z(q.c[1]), 1, ACCENT); }
    if (g.ghostAt(g.raceTime)) { const p = g.ghostBoat.pos; m.block(X(p[0]), Z(p[2]), 1, INK); m.block(X(p[0]), Z(p[2]), 0, PAPER); }
    // the boat: a block with one pixel showing which way it points
    const b = g.boat, bx = X(b.pos[0]), bz = Z(b.pos[2]);
    m.block(bx, bz, 2, INK); m.block(bx, bz, 1, PAPER);
    m.block(bx + Math.cos(b.yaw) * 3, bz + Math.sin(b.yaw) * 3, 0, PAPER);
  }
}
