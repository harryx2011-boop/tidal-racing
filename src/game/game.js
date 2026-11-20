// The race: boat, camera, gates, laps, ghost and best times. The engine (App) owns the frame;
// it calls update() once the sea has advanced and draw() inside the main pass, after the water.
import { clamp, smoothstep } from '../math.js';
import { MeshPass } from './mesh.js';
import { boatGeo, BOAT_ANCHORS } from './models/boat.js';
import { driverGeo } from './models/driver.js';
import { MultiProbe } from './probe.js';
import { Boat } from './boat.js';
import { Input } from './input.js';
import { COURSES, CONDITIONS, Progress, grid, rollConditions, sunFor, TIMES } from './courses.js';
import { HUD } from './hud.js';
import { BoatShadow } from './shadow.js';
import { Lights } from './lights.js';
import { settings } from './settings.js';
import { Wake } from './wake.js';
import { BoatSpray } from './boatspray.js';
import { Marks } from './marks.js';
import { Scenery } from './scenery.js';
import { Wildlife } from './wildlife.js';
import { Land } from './land.js';
import { Collisions } from './collide.js';
import { Coastal } from './coastal.js';

const STEP = 1 / 120;          // physics step (s)
const COUNTDOWN = 3.6;         // seconds from the start of the count to GO
const SEA_T0 = 60;             // every race starts at the same sea time: identical waves, fair ghosts
const GHOST_HZ = 10;
const GHOST_LIVERY = { color: [0.6, 0.8, 1], stripe: 0, number: 0 };
// move a model matrix's origin to a point given in the model's own space (in place)
function attach(m, p) {
  for (let i = 0; i < 3; i++) m[12 + i] += m[i] * p[0] + m[4 + i] * p[1] + m[8 + i] * p[2];
  return m;
}
const angDiff = (a, b) => { let d = (a - b) % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return d; };

const store = {
  key: (c, w) => `tidal.best3.${c}.${w}`,   // 3: the courses moved close to the coast, so older times and ghosts do not apply
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
    this.driverMesh = driverGeo().build(gl);
    this.driverArmsMesh = driverGeo('arms').build(gl);   // what the helm camera sees of the driver: sleeves and gloves on the wheel
    this.probe = new MultiProbe(gl);
    this.boat = new Boat();
    this.ghostBoat = new Boat();
    // Other players' boats this frame (multiplayer). Each: { id, name, pose (a Boat), livery }. The net code
    // fills it; contact, drafting and every visual system read it (through renderBoats()).
    this.rivals = [];
    this.net = null;            // the multiplayer session (src/game/net/session.js), null in solo
    this.input = new Input();
    this.livery = { color: [0.95, 0.42, 0.05], stripe: 0, number: 7 };
    // Visual systems (wake, shadows, lights, ...). Each may implement any of:
    //   update(dt, ot)  prePass(light)  waterUniforms()  draw(scene, meshes)  drawTransparent(scene)
    //   seaOffset(x, z, s)
    // See docs/BRIEF_VISUAL_UPGRADE.md. Register one per line so merges stay trivial.
    this.systems = [];
    this.land = new Land(this);
    this.systems.push(this.land);
    this.systems.push(new BoatShadow(this));
    this.systems.push(new Lights(this));
    this.systems.push(new Wake(this));
    this.systems.push(new BoatSpray(this));
    this.systems.push(new Marks(this));
    this.systems.push(new Scenery(this));
    this.systems.push(new Wildlife(this));
    this.systems.push(new Coastal(this));
    this.state = 'menu';        // menu | countdown | racing | finished
    this.paused = false;
    this.camMode = 'chase';
    this.camYaw = 0; this.camY = 4; this.fov = 0.9;
    this.acc = 0;
    this.model = new Float32Array(16);
    this.collisions = new Collisions(this);
    this.sample = { h: 0, sx: 0, sz: 0 };
    this.sea = (i, x, z) => {
      const r = this.probe.result[i], s = this.sample;
      s.h = this.probe.heightAt(i, x, z); s.sx = r.sx; s.sz = r.sz;
      // waves die in shallow water (the sea shader does the same): the hull does not ride waves that are not drawn
      const a = this.land.wave(x, z);
      if (a < 1) { s.h *= a; s.sx *= a; s.sz *= a; }
      // systems may add to the sea the hull feels (boat wakes): seaOffset(x, z, s) adds to s.h, s.sx, s.sz
      for (const sy of this.systems) sy.seaOffset?.(x, z, s);
      return s;
    };
    this.setCourse(COURSES[0]);
    this.hud = new HUD(this);
  }

  setCourse(course) {
    this.course = course;
    this.land.setCourse(course);
    this.progress = new Progress(course);
    this.place(grid(course));
  }

  place({ x, z, yaw }) {
    this.boat.reset(x, z, yaw);
    this.camYaw = yaw;
    this.probe.fresh = false;
    this.app.clouds.reset = true;
  }

  // Start a time trial. cond: a CONDITIONS key or 'random'; tod: a TIMES key or 'random'. The seed decides
  // everything that is random. Best times are kept per course and sea condition: the sun does not
  // change the waves.
  start(courseId, cond, tod = 'day', seed = (Math.random() * 4294967296) >>> 0) {
    const app = this.app;
    this.audio.enable(true).catch(() => {});
    const rolled = rollConditions(seed);
    const randomSea = cond === 'random';
    if (randomSea) cond = rolled.id;
    if (tod === 'random') tod = rolled.tod;
    if (!TIMES[tod]) tod = 'day';
    const course = COURSES.find((c) => c.id === courseId) || COURSES[0];
    const C = CONDITIONS[cond];
    const sun = sunFor(course, cond, tod, seed, randomSea);
    const W = app.weather;
    W.setPreset(C.preset);
    for (const k in C.set) W.set(k, C.set[k]);
    W.set('sunElev', sun[0]); W.set('sunAz', sun[1]);
    W.snap();
    this.cond = cond;
    this.tod = tod;
    this.setCourse(course);
    app.time = SEA_T0;
    this.t0 = SEA_T0 + COUNTDOWN;
    this.best = this.net ? null : store.load(this.course.id, cond);   // the ghost and best times are solo only
    this.rec = new Float32Array(GHOST_HZ * 60 * 12 * 6); // twelve minutes
    this.recN = 0;
    this.laps = []; this.lapStart = 0; this.finishTime = 0; this.newBest = false;
    this.state = 'countdown';
    this.paused = false;
    app.fade = 0;
    this.hud.show(this.state);
  }

  quit() {
    if (this.net) this.net.leave();
    this.state = 'menu';
    this.paused = false;
    this.setCourse(this.course);
    this.hud.show('menu');
  }

  get raceTime() { return this.state === 'finished' ? this.finishTime : Math.max(this.app.time - this.t0, 0); }

  update(dt, ot) {
    const app = this.app, boat = this.boat;
    let inp = this.input.poll(dt);
    // multiplayer: the pause menu does not stop the world; the boat just gets no input
    if (this.paused && this.net) inp = { ...inp, throttle: 0, steer: 0, boost: false };
    if (inp.pressed.has('mute')) this.hud.toggleSound();
    if (inp.pressed.has('camera')) this.camMode = this.camMode === 'chase' ? 'helm' : 'chase';
    if (this.state !== 'menu') {
      if (inp.pressed.has('pause')) { this.paused = !this.paused; this.hud.pause(this.paused); }
      if (inp.pressed.has('reset') && this.state === 'racing') this.place(this.progress.respawn());
    }
    this.net?.pre(dt);
    if ((this.paused && !this.net) || !ot) return;
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
      while (this.acc >= STEP) { boat.step(STEP, inp, this.sea, drive); this.collisions.step(boat, STEP); this.acc -= STEP; }
      if (drive) this.track(p0, dt);
    }
    this.net?.post(dt);
    for (const s of this.systems) s.update?.(dt, ot);
    this.camera(dt, res[4]);
    this.hud.update(dt);
  }

  // gates, laps, the ghost recording
  track(p0, dt) {
    const boat = this.boat, t = this.raceTime;
    const ev = this.progress.advance(p0, [boat.pos[0], boat.pos[2]], dt);
    if (ev && this.net) this.net.onProgress(this.progress.next, t, ev === 'finish');
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
      this.newBest = !this.net && (!this.best || t < this.best.time);
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
      // the driver's eye, raised a hand so the view clears the top of the windscreen
      const { Z } = boat.axes(), e = BOAT_ANCHORS.eye, ex = e[0] + 0.1, ey = e[1] + 0.2, ez = e[2];
      c.pos = [0, 1, 2].map((i) => boat.pos[i] + X[i] * ex + Y[i] * ey + Z[i] * ez);
      c.yaw = boat.yaw; c.pitch = boat.pitch * 0.6 - 0.12; c.roll = -boat.roll * 0.7;
      this.camYaw = boat.yaw; this.camY = boat.pos[1];
    } else {
      const menu = this.state === 'menu';
      if (menu) this.camYaw += dt * 0.1;
      else this.camYaw += angDiff(boat.yaw, this.camYaw) * k(4.5);
      const dist = menu ? 15 : 10.5 + sp * 0.06, height = menu ? 3.2 : 3.7;
      // the camera's height follows the boat lazily: a jump lifts the boat in the frame
      this.camY += (boat.pos[1] - this.camY) * k(2.5);
      const px = boat.pos[0] - Math.cos(this.camYaw) * dist, pz = boat.pos[2] - Math.sin(this.camYaw) * dist;
      // (and above the ground, where the boat has turned along a shore or a cliff)
      const py = Math.max(this.camY + height, (seaAtCam ? seaAtCam.h : 0) + 1.3, this.land.field.heightAt(px, pz) + 1.5);
      // racing: look a little ahead of the bow. menu: aim left of the boat so it sits clear of the panel
      const ax = menu ? Math.sin(this.camYaw) * 5 : Math.cos(boat.yaw) * 6, az = menu ? -Math.cos(this.camYaw) * 5 : Math.sin(boat.yaw) * 6;
      const tx = boat.pos[0] + ax - px, ty = this.camY + 1.5 - py, tz = boat.pos[2] + az - pz;
      c.pos = [px, py, pz];
      c.yaw = Math.atan2(tz, tx);
      c.pitch = Math.atan2(ty, Math.hypot(tx, tz));
      c.roll = -boat.roll * 0.12;
    }
    c.base = [c.pos[0], c.pos[2]];
    this.speedEffects(dt, c, boat);
  }

  // Speed effects (setting "speed effects"): a little camera shake and the radial blur strength
  // that post.js reads as this.blur. Both are smooth functions of speed, boost and the last
  // landing; the shake is a sum of incommensurate sines of sea time, so it does not depend on
  // the frame rate and is not white noise. Amplitudes stay under a quarter of a degree (about 0.2 degrees at full boost).
  speedEffects(dt, c, boat) {
    const on = settings.speedFx && this.state !== 'menu';
    const sp = boat.speed, k = (r) => 1 - Math.exp(-dt * r);
    this.boostFx = (this.boostFx || 0) + ((boat.boosting ? 1 : 0) - (this.boostFx || 0)) * k(boat.boosting ? 6 : 2.5);
    // a landing (boat.slam peaks near 0.3) kicks the camera, then it settles over ~0.4 s
    this.kick = Math.max((this.kick || 0) - dt * 2.5, Math.min(boat.slam / 0.15, 1));
    const fast = smoothstep(14, 44, sp);
    const target = on ? Math.min(fast * 0.45 + this.boostFx * 0.55, 1) * (boat.wet > 0.3 ? 1 : 0.6) : 0;
    this.blur = (this.blur || 0) + (target - (this.blur || 0)) * k(4);
    if (this.blur < 0.003) this.blur = 0;
    const amp = on ? fast * 0.35 + this.boostFx * 0.45 : 0;
    const kick = on ? this.kick : 0;
    if (amp < 1e-3 && kick < 1e-3) return;
    const t = this.app.time, n = (f, s) => Math.sin(t * f + s) * 0.6 + Math.sin(t * f * 2.31 + s * 1.7) * 0.4;
    c.pos[0] += (n(31, 0.3) * 0.012) * amp;
    c.pos[1] += n(37, 1.9) * 0.035 * amp - kick * 0.07;
    c.pos[2] += (n(29, 4.1) * 0.012) * amp;
    c.yaw += n(23, 2.2) * 0.004 * amp;
    c.pitch += n(27, 5.3) * 0.005 * amp + kick * 0.012;
    c.roll += n(19, 0.7) * 0.006 * amp;
  }

  // inside the main HDR pass, depth test on, BEFORE the sea: everything opaque. The sea is the dearest surface to
  // shade, and drawn after the hulls, the land and the scenery it is only shaded where it shows.
  draw(scene) {
    const m = this.meshes;
    m.begin(scene);
    const mat = this.model;
    for (const b of this.renderBoats()) {
      if (b.ghost) continue;
      m.draw(this.boatMesh, b.pose.matrix(mat), { tint: b.livery.color, livery: b.livery, speed: b.pose.speed, pass: 1 });
      // the driver sits at the helm; from the helm camera only the arms on the wheel are drawn (the head would be around the lens)
      if (b.pose === this.boat && this.camMode === 'helm' && this.state !== 'menu') { m.draw(this.driverArmsMesh, attach(mat, BOAT_ANCHORS.helm), { tint: b.livery.color }); continue; }
      m.draw(this.driverMesh, attach(mat, BOAT_ANCHORS.helm), { tint: b.livery.color });
    }
    for (const s of this.systems) s.draw?.(scene, m);
  }

  // straight after the sea: what blends over it and over the boats (windscreens, then the ghost)
  drawBlended(scene) {
    const m = this.meshes;
    m.begin(scene);
    const mat = this.model;
    for (const b of this.renderBoats()) if (!b.ghost) m.draw(this.boatMesh, b.pose.matrix(mat), { tint: b.livery.color, livery: b.livery, speed: b.pose.speed, pass: 2 });
    for (const b of this.renderBoats()) if (b.ghost) m.draw(this.boatMesh, b.pose.matrix(mat), { tint: b.livery.color, livery: b.livery, alpha: 0.4 });
  }

  // Every boat to draw this frame: { pose (a Boat: pos, yaw, pitch, roll, vel, axes(), matrix()), livery, ghost }.
  // Systems loop over this instead of reaching for game.boat, so rivals appear everywhere at once.
  renderBoats() {
    const list = [{ pose: this.boat, livery: this.livery, ghost: false }];
    for (const r of this.rivals) list.push({ pose: r.pose, livery: r.livery, ghost: false, rival: r });
    if (this.ghostAt(this.raceTime)) list.push({ pose: this.ghostBoat, livery: GHOST_LIVERY, ghost: true });
    return list;
  }

  // before the main pass (shadow maps and the like). light: { sunDir, night }
  prePass(light) { for (const s of this.systems) s.prePass?.(light); }
  // extra uniforms for the sea surface shader
  waterUniforms() { const u = {}; for (const s of this.systems) Object.assign(u, s.waterUniforms?.()); return u; }
  // inside the main pass after rain and spray: blended particles and glows
  drawTransparent(scene) { for (const s of this.systems) s.drawTransparent?.(scene); }
}
