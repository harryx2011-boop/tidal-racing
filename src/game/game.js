// The race: boat, camera, gates, laps, ghost and best times. The engine (App) owns the frame;
// it calls update() once the sea has advanced and draw() inside the main pass, after the water.
import { clamp, smoothstep } from '../math.js';
import { MeshPass, boatGeo, buoyGeo } from './mesh.js';
import { MultiProbe } from './probe.js';
import { Boat } from './boat.js';
import { Input } from './input.js';
import { COURSES, CONDITIONS, Progress, grid, rollConditions } from './courses.js';
import { HUD } from './hud.js';

const STEP = 1 / 120;          // physics step (s)
const COUNTDOWN = 3.6;         // seconds from the start of the count to GO
const SEA_T0 = 60;             // every race starts at the same sea time: identical waves, fair ghosts
const GHOST_HZ = 10;
const PORT = [0.9, 0.06, 0.04], STBD = [0.05, 0.75, 0.16];
const angDiff = (a, b) => { let d = (a - b) % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return d; };

const store = {
  key: (c, w) => `tidal.best.${c}.${w}`,
  load(c, w) {
    try {
      const o = JSON.parse(localStorage.getItem(this.key(c, w)));
      if (!o) return null;
      const bin = atob(o.ghost);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      return { time: o.time, ghost: new Float32Array(u8.buffer) };
    } catch { return null; }
  },
  save(c, w, time, ghost) {
    try {
      const u8 = new Uint8Array(ghost.buffer, 0, ghost.length * 4);
      let bin = '';
      for (let i = 0; i < u8.length; i += 8192) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 8192));
      localStorage.setItem(this.key(c, w), JSON.stringify({ time, ghost: btoa(bin) }));
    } catch { /* storage full or blocked: the run still counts for this session */ }
  },
};

export class Game {
  constructor(app, audio) {
    this.app = app;
    this.audio = audio;
    const gl = app.gl;
    this.meshes = new MeshPass(gl);
    this.boatMesh = boatGeo().build(gl);
    this.buoyMesh = buoyGeo().build(gl);
    this.probe = new MultiProbe(gl);
    this.boat = new Boat();
    this.ghostBoat = new Boat();
    this.input = new Input();
    this.color = [0.95, 0.42, 0.05];
    this.state = 'menu';        // menu | countdown | racing | finished
    this.paused = false;
    this.camMode = 'chase';
    this.camYaw = 0; this.camY = 4; this.fov = 0.9;
    this.acc = 0;
    this.model = new Float32Array(16);
    this.sample = { h: 0, sx: 0, sz: 0 };
    this.sea = (i, x, z) => {
      const r = this.probe.result[i], s = this.sample;
      s.h = this.probe.heightAt(i, x, z); s.sx = r.sx; s.sz = r.sz;
      return s;
    };
    this.setCourse(COURSES[0]);
    this.hud = new HUD(this);
  }

  setCourse(course) {
    this.course = course;
    this.progress = new Progress(course);
    this.place(grid(course));
  }

  place({ x, z, yaw }) {
    this.boat.reset(x, z, yaw);
    this.camYaw = yaw;
    this.probe.fresh = false;
    this.app.clouds.reset = true;
  }

  // Start a time trial. cond: a CONDITIONS key or 'random'.
  start(courseId, cond, seed = (Math.random() * 4294967296) >>> 0) {
    const app = this.app;
    this.audio.enable(true).catch(() => {});
    let sun;
    if (cond === 'random') ({ id: cond, sun } = rollConditions(seed));
    const C = CONDITIONS[cond];
    sun = sun || C.sun;
    const W = app.weather;
    W.setPreset(C.preset);
    for (const k in C.set) W.set(k, C.set[k]);
    W.set('sunElev', sun[0]); W.set('sunAz', sun[1]);
    W.snap();
    this.cond = cond;
    this.setCourse(COURSES.find((c) => c.id === courseId) || COURSES[0]);
    app.time = SEA_T0;
    this.t0 = SEA_T0 + COUNTDOWN;
    this.best = store.load(this.course.id, cond);
    this.rec = new Float32Array(GHOST_HZ * 60 * 12 * 6); // twelve minutes
    this.recN = 0;
    this.laps = []; this.lapStart = 0; this.finishTime = 0; this.newBest = false;
    this.state = 'countdown';
    this.paused = false;
    app.fade = 0;
    this.hud.show(this.state);
  }

  quit() {
    this.state = 'menu';
    this.paused = false;
    this.setCourse(this.course);
    this.hud.show('menu');
  }

  get raceTime() { return this.state === 'finished' ? this.finishTime : Math.max(this.app.time - this.t0, 0); }

  update(dt, ot) {
    const app = this.app, boat = this.boat;
    const inp = this.input.poll(dt);
    if (inp.pressed.has('mute')) this.hud.toggleSound();
    if (inp.pressed.has('camera')) this.camMode = this.camMode === 'chase' ? 'helm' : 'chase';
    if (this.state !== 'menu') {
      if (inp.pressed.has('pause')) { this.paused = !this.paused; this.hud.pause(this.paused); }
      if (inp.pressed.has('reset') && this.state === 'racing') this.place(this.progress.respawn());
    }
    if (this.paused || !ot) return;
    if (app.fade < 1) app.fade = Math.min((app.fade ?? 1) + dt * 1.6, 1);

    // sea under the hull (and under the camera), a little ahead in time
    const pts = boat.probePoints();
    pts.push(app.cam.pos[0], app.cam.pos[2]);
    const res = this.probe.run(ot, pts, 2.5);
    const ready = this.probe.fresh && Math.hypot(res[0].x - pts[0], res[0].z - pts[1]) < 10;

    if (this.state === 'countdown' && app.time >= this.t0) { this.state = 'racing'; this.hud.show('racing'); }
    const drive = this.state === 'racing';
    if (ready) {
      const p0 = [boat.pos[0], boat.pos[2]];
      this.acc = Math.min(this.acc + dt, 0.1);
      while (this.acc >= STEP) { boat.step(STEP, inp, this.sea, drive); this.acc -= STEP; }
      if (drive) this.track(p0, dt);
    }
    this.camera(dt, res[4]);
    this.hud.update(dt);
  }

  // gates, laps, the ghost recording
  track(p0, dt) {
    const boat = this.boat, t = this.raceTime;
    const ev = this.progress.advance(p0, [boat.pos[0], boat.pos[2]], dt);
    if (ev === 'lap' || ev === 'finish') {
      if (this.course.loop) { this.laps.push(t - this.lapStart); this.lapStart = t; }
      this.hud.flash(ev === 'finish' ? 'FINISH' : `LAP ${this.progress.lap}`);
    }
    const f = Math.floor(t * GHOST_HZ);
    while (this.recN <= f && this.recN * 6 + 6 <= this.rec.length) {
      this.rec.set([boat.pos[0], boat.pos[1], boat.pos[2], boat.yaw, boat.pitch, boat.roll], this.recN * 6);
      this.recN++;
    }
    if (ev === 'finish') {
      this.finishTime = t;
      this.state = 'finished';
      this.newBest = !this.best || t < this.best.time;
      this.prevBest = this.best ? this.best.time : null;
      if (this.newBest) {
        const ghost = this.rec.slice(0, this.recN * 6);
        store.save(this.course.id, this.cond, t, ghost);
      }
      this.hud.show('finished');
    }
  }

  // pose of the best run at race time t, written into ghostBoat; false when there is none
  ghostAt(t) {
    const g = this.best && this.best.ghost;
    if (!g || this.state === 'menu') return false;
    const n = g.length / 6, f = t * GHOST_HZ, i = Math.floor(f);
    if (i >= n - 1) return false;
    const k = f - i, a = i * 6, b = a + 6, gb = this.ghostBoat;
    for (let j = 0; j < 3; j++) gb.pos[j] = g[a + j] + (g[b + j] - g[a + j]) * k;
    gb.yaw = g[a + 3] + angDiff(g[b + 3], g[a + 3]) * k;
    gb.pitch = g[a + 4] + (g[b + 4] - g[a + 4]) * k;
    gb.roll = g[a + 5] + (g[b + 5] - g[a + 5]) * k;
    return true;
  }

  camera(dt, seaAtCam) {
    const c = this.app.cam, boat = this.boat, sp = boat.speed;
    const k = (r) => 1 - Math.exp(-dt * r);
    const { X, Y } = boat.axes();
    const fovT = (50 + 16 * smoothstep(8, 46, sp) + (boat.boosting ? 5 : 0)) * Math.PI / 180;
    this.fov += (fovT - this.fov) * k(3);
    c.fov = this.fov;
    c.tilt = 0;
    if (this.state !== 'menu' && this.camMode === 'helm') {
      c.pos = [boat.pos[0] + X[0] * 1.3 + Y[0] * 2.05, boat.pos[1] + X[1] * 1.3 + Y[1] * 2.05, boat.pos[2] + X[2] * 1.3 + Y[2] * 2.05];
      c.yaw = boat.yaw; c.pitch = boat.pitch * 0.6 - 0.05; c.roll = -boat.roll * 0.7;
      this.camYaw = boat.yaw; this.camY = boat.pos[1];
    } else {
      const menu = this.state === 'menu';
      if (menu) this.camYaw += dt * 0.1;
      else this.camYaw += angDiff(boat.yaw, this.camYaw) * k(4.5);
      const dist = menu ? 15 : 10.5 + sp * 0.06, height = menu ? 3.2 : 3.7;
      // the camera's height follows the boat lazily: a jump lifts the boat in the frame
      this.camY += (boat.pos[1] - this.camY) * k(2.5);
      const px = boat.pos[0] - Math.cos(this.camYaw) * dist, pz = boat.pos[2] - Math.sin(this.camYaw) * dist;
      const py = Math.max(this.camY + height, (seaAtCam ? seaAtCam.h : 0) + 1.3);
      // racing: look a little ahead of the bow. menu: aim left of the boat so it sits clear of the panel
      const ax = menu ? Math.sin(this.camYaw) * 5 : Math.cos(boat.yaw) * 6, az = menu ? -Math.cos(this.camYaw) * 5 : Math.sin(boat.yaw) * 6;
      const tx = boat.pos[0] + ax - px, ty = this.camY + 1.5 - py, tz = boat.pos[2] + az - pz;
      c.pos = [px, py, pz];
      c.yaw = Math.atan2(tz, tx);
      c.pitch = Math.atan2(ty, Math.hypot(tx, tz));
      c.roll = -boat.roll * 0.12;
    }
    c.base = [c.pos[0], c.pos[2]];
  }

  // inside the main HDR pass, depth test on, after the water
  draw(scene) {
    const m = this.meshes, t = this.app.time;
    m.begin(scene);
    const cam = this.app.cam.pos, gates = this.course.gates;
    const nextI = this.progress.done ? -1 : this.progress.next % gates.length;
    const mat = this.model;
    gates.forEach((g, i) => {
      if (Math.hypot(g.c[0] - cam[0], g.c[1] - cam[2]) > 5000) return;
      const glow = i === nextI ? 1.0 + 0.4 * Math.sin(t * 6) : 0.25;
      for (const [p, tint] of [[g.port, PORT], [g.stbd, STBD]]) {
        mat.set([1.5, 0, 0, 0, 0, 1.5, 0, 0, 0, 0, 1.5, 0, p[0], 0, p[1], 1]);
        m.draw(this.buoyMesh, mat, { tint, glow, float: 1 });
      }
    });
    m.draw(this.boatMesh, this.boat.matrix(mat), { tint: this.color });
    if (this.ghostAt(this.raceTime)) m.draw(this.boatMesh, this.ghostBoat.matrix(mat), { tint: [0.6, 0.8, 1], alpha: 0.4 });
  }
}
