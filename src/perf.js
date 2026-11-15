// Frame-rate governor and the performance overlay (F3, or ?stats).
//
// The governor is plain arithmetic on frame times so it can be run with synthetic numbers
// (see the decision trace in the build report); the overlay is the only part that touches the DOM.

export const BUDGET_MS = 1000 / 60;
const STEPS = 3;                                   // levels per effect between 1 and 0
const SCALE_MULS = [1, 0.88, 0.77, 0.68, 0.6, 0.5]; // render scale as a fraction of the start scale
// Rungs, in the order effects are given up: spray, water shadow, boat shadows, then resolution.
// Rung 0 is everything on; going back up retraces them in reverse (resolution first).
export const MAX_RUNG = 3 * STEPS + SCALE_MULS.length - 1;

const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

export function levelsAt(rung) {
  const lv = (r0) => clamp(1 - (rung - r0) / STEPS, 0, 1);
  return { spray: lv(0), waterShadow: lv(STEPS), shadows: lv(2 * STEPS), scale: SCALE_MULS[clamp(rung - 3 * STEPS, 0, SCALE_MULS.length - 1)] };
}

// Why these numbers:
//  - Decisions use the mean frame time of the last two seconds with the slowest 2% of frames left
//    out, so one shader compile or GC pause cannot trigger a step down; the overlay's 1% low is
//    where such hitches show.
//  - "Slow" is under ~52 fps (19 ms). It must hold for a second, so a step down takes 2-3 s.
//  - Headroom cannot be read from the frame time alone: on a 60 Hz display a frame is 16.7 ms
//    whether the GPU needed 5 ms or 16 ms. So a step up is a trial: after `raiseAfter` seconds of
//    holding 60 it tries one rung; if that rung is given up again within 12 s the wait doubles
//    (up to two minutes), so a card that cannot afford the next rung is probed rarely. Where GPU
//    timers exist they also have to show real slack (under 12.5 ms of 16.7).
//  - A display above 60 Hz reports shorter frames when the GPU keeps up (headroom) and
//    multiples of its refresh interval when it does not (slow), so the same thresholds apply.
//  - Nothing is decided during the first seconds after load or a race start (shader compiles,
//    first-use allocations), while the tab is hidden or the game is paused, nor for 1.5 s after.
export class Governor {
  constructor({ warm = 8, maxRung = MAX_RUNG } = {}) {
    this.maxRung = maxRung;
    this.rung = 0;
    this.warm = warm;
    this.raiseAfter = this.baseRaise = 8;
    this.mean = BUDGET_MS;
    this.t = 0;
    this.clear();
    this.slowT = this.fastT = this.calm = 0;
    this.lastRaise = -1e9;
    this.trial = false;
  }

  clear() { this.win = []; this.span = 0; this.evalT = 0; }

  // a hard restart of the measurement: the race began, or the player switched the governor on
  restart(warm = 5) { this.warm = Math.max(this.warm, warm); this.clear(); this.slowT = this.fastT = 0; }

  // Returns the change in rung this frame: +n gave up quality, -1 took a step back, 0 nothing.
  tick(dt, { active = true, gpuMs = null } = {}) {
    if (!active) { this.warm = Math.max(this.warm, 1.5); this.clear(); return 0; }
    if (this.warm > 0) { this.warm -= dt; this.clear(); return 0; }
    this.t += dt; this.calm += dt;
    const ms = Math.min(dt * 1000, 250);
    this.win.push(ms); this.span += ms / 1000;
    while (this.span > 2 && this.win.length > 1) this.span -= this.win.shift() / 1000;
    this.evalT += dt;
    if (this.evalT < 0.25) return 0;
    this.evalT = 0;
    if (this.span < 1.5) return 0;
    const s = this.win.slice().sort((a, b) => a - b);
    const keep = Math.max(1, s.length - Math.ceil(s.length * 0.02));
    let sum = 0;
    for (let i = 0; i < keep; i++) sum += s[i];
    const m = (this.mean = sum / keep);

    if (m > 19) this.slowT += 0.25; else this.slowT = 0;
    if (m < 17.6 && (gpuMs == null || gpuMs < 12.5)) this.fastT += 0.25; else this.fastT = 0;
    // a trial step that survived 12 s was affordable: shorten the wait again (and slowly forget old failures)
    if (this.trial && this.calm >= 12) { this.trial = false; this.raiseAfter = Math.max(this.baseRaise, this.raiseAfter / 2); }
    if (this.calm >= 60 && this.raiseAfter > this.baseRaise) { this.raiseAfter = Math.max(this.baseRaise, this.raiseAfter / 2); this.calm = 0; }

    if (this.slowT >= (m > 26 ? 0.5 : 1) && this.rung < this.maxRung) {
      const step = Math.min(m > 34 ? 2 : 1, this.maxRung - this.rung);
      // given up again soon after a step up: that rung does not fit, so wait longer before the next try
      if (this.t - this.lastRaise < 12) this.raiseAfter = Math.min(this.raiseAfter * 2, 120);
      return this.move(step);
    }
    if (this.fastT >= this.raiseAfter && this.rung > 0) { this.lastRaise = this.t; this.trial = true; return this.move(-1); }
    return 0;
  }

  move(d) {
    this.rung += d;
    if (d > 0) this.trial = false;
    this.clear(); this.slowT = this.fastT = this.calm = 0;
    return d;
  }

  levels() { return levelsAt(this.rung); }
}

// ---------------------------------------------------------------------------------------------

export const PERF_CSS = `
#perf { position: fixed; top: 8px; right: 8px; z-index: 30; padding: 7px 9px 6px; border-radius: 6px; background: rgba(5,9,13,.78); color: #e9f3f4; font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; text-shadow: none; pointer-events: none; user-select: text; }
#perf pre { margin: 0; font: inherit; white-space: pre; }
#perf .bar { display: flex; gap: 6px; margin-top: 5px; pointer-events: auto; }
#perf button { font: inherit; color: inherit; cursor: pointer; padding: 1px 8px; border-radius: 4px; background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.25); }
#perf button:hover { background: rgba(255,255,255,.22); }
#perf .ok { color: #9be58a; } #perf .warn { color: #ffd23f; } #perf .bad { color: #ff7a6a; }
`;

const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : '--');

export class PerfOverlay {
  // app: the App; gov: Governor; settings: Settings; opts.open: start open
  constructor(app, gov, settings, { open = false } = {}) {
    this.app = app; this.gov = gov; this.settings = settings;
    this.ms = []; this.t = [];     // recent frame times (ms) and their timestamps (s), last 5 s
    this.clock = 0; this.refresh = 0;
    this.text = '';
    this.el = document.createElement('div');
    this.el.id = 'perf';
    this.el.hidden = true;
    this.pre = document.createElement('pre');
    const bar = document.createElement('div');
    bar.className = 'bar';
    this.copyBtn = document.createElement('button');
    this.copyBtn.textContent = 'copy';
    this.copyBtn.title = 'Copy this readout as text';
    this.copyBtn.addEventListener('click', () => this.copy());
    const close = document.createElement('button');
    close.textContent = 'close (F3)';
    close.addEventListener('click', () => this.toggle(false));
    bar.append(this.copyBtn, close);
    this.el.append(this.pre, bar);
    document.body.appendChild(this.el);
    window.addEventListener('keydown', (e) => { if (e.code === 'F3') { e.preventDefault(); if (!e.repeat) this.toggle(); } });
    if (open) this.toggle(true);
  }

  get open() { return !this.el.hidden; }

  toggle(on = !this.open) {
    this.el.hidden = !on;
    // the GPU timer queries cost a little every frame: they exist only while the overlay is open
    this.app.prof.enable(on);
    this.ms.length = this.t.length = 0;
    this.refresh = 0;
    if (on) this.render();
  }

  // call once per presented frame with the real (unclamped) frame time in seconds
  frame(dt) {
    if (!this.open) return;
    this.clock += dt;
    this.ms.push(dt * 1000); this.t.push(this.clock);
    while (this.t.length > 1 && this.clock - this.t[0] > 5) { this.t.shift(); this.ms.shift(); }
    if ((this.refresh -= dt) <= 0) { this.refresh = 0.25; this.render(); }
  }

  stats() {
    const n = this.ms.length;
    if (!n) return null;
    const s = this.ms.slice().sort((a, b) => a - b);
    const avg = this.ms.reduce((a, b) => a + b, 0) / n;
    // 1% low: the frame rate of the slowest 1% of frames (at least the single slowest)
    const k = Math.max(1, Math.round(n * 0.01));
    const low = s.slice(n - k).reduce((a, b) => a + b, 0) / k;
    return { avg, low, fps: 1000 / avg, lowFps: 1000 / low, worst: s[n - 1] };
  }

  // total of the GPU pass timings, or null when there are none
  gpuTotal() {
    const P = this.app.prof;
    if (!P.ext) return null;
    let sum = 0, n = 0;
    for (const k in P.stats) { sum += P.stats[k].ema ?? 0; n++; }
    return n ? sum : null;
  }

  lines() {
    const a = this.app, g = this.gov, S = this.settings, st = this.stats(), P = a.prof;
    const L = [];
    if (st) { L.push(`${f1(st.fps)} fps   ${f1(st.avg)} ms avg`); L.push(`1% low ${f1(st.lowFps)} fps  (${f1(st.low)} ms)  worst ${f1(st.worst)} ms`); }
    else L.push('collecting frames...');
    L.push(`render ${a.scale.toFixed(2)}x  ${a.w}x${a.h}  msaa ${a.msaa}  dpr ${(window.devicePixelRatio || 1).toFixed(2)}`);
    L.push(`fx spray ${a.fx.spray.toFixed(2)}  water-shadow ${a.fx.waterShadow.toFixed(2)}  shadows ${a.fx.shadows.toFixed(2)}`);
    L.push(`tier ${S.active}${S.quality && S.quality !== S.active ? ` (saved ${S.quality}, after reload)` : ''}  speed fx ${S.speedFx ? 'on' : 'off'}`);
    if (S.auto && !a.fixedGovernor) L.push(`governor auto  rung ${g.rung}/${g.maxRung}  ${g.warm > 0 ? `warm-up ${g.warm.toFixed(1)}s` : `mean ${f1(g.mean)} ms, next try ${Math.max(g.raiseAfter - g.fastT, 0).toFixed(0)}s`}`);
    else L.push(`governor ${S.auto ? 'fixed scale' : 'off (manual levels)'}`);
    if (P.ext) {
      const names = Object.keys(P.stats);
      if (names.length) {
        L.push('gpu ms  ' + names.map((k) => `${k} ${f1(P.stats[k].ema)}`).join('  '));
        L.push(`gpu total ${f1(this.gpuTotal())} ms`);
      } else L.push('gpu ms  waiting for timer results...');
    } else L.push('gpu timers unavailable (no EXT_disjoint_timer_query_webgl2)');
    // what the world systems drew last frame (draw calls and triangles), where they keep count
    const sys = a.game?.systems;
    if (sys) {
      const parts = [];
      for (const s of sys) { const q = s.stats, n = q && (q.drawn ?? q.draws); if (n !== undefined) parts.push(`${s.constructor.name.toLowerCase()} ${n}${q.tris ? `/${Math.round((q.tris + (q.birdTris || 0)) / 1000)}k` : ''}`); }
      if (parts.length) L.push('draws/tris  ' + parts.join('  '));
    }
    return L;
  }

  rendererInfo() {
    if (this._r) return this._r;
    const gl = this.app.gl;
    const x = gl.getExtension('WEBGL_debug_renderer_info');
    return (this._r = x ? gl.getParameter(x.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  }

  render() {
    const L = this.lines();
    this.text = L.join('\n');
    const st = this.stats();
    this.pre.textContent = this.text;
    this.pre.className = st ? (st.fps >= 57 ? 'ok' : st.fps >= 45 ? 'warn' : 'bad') : '';
  }

  // the readout plus what a reader needs to interpret it
  report() {
    this.render();
    return `${this.text}\n--\nrenderer ${this.rendererInfo()}\nscreen ${screen.width}x${screen.height}  window ${innerWidth}x${innerHeight}\nurl ${location.search || '(no query)'}\n${new Date().toISOString()}`;
  }

  async copy() {
    const text = this.report();
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch { /* fall through */ }
    if (!ok) {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { ok = document.execCommand('copy'); } catch { /* none */ }
      ta.remove();
    }
    this.copyBtn.textContent = ok ? 'copied' : 'copy failed';
    setTimeout(() => { this.copyBtn.textContent = 'copy'; }, 1400);
  }
}
