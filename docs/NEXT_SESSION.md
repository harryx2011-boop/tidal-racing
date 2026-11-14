# Brief for the next session

Read this first. It records what was decided, what exists, and what to build next.

## Decisions already made (do not re-ask)

| Topic | Decision |
| --- | --- |
| Game | Powerboat racing. No survival, diving, loot or economy. |
| Engine | Extend the vendored open-water WebGL2 engine. Plain JS modules, no build step, no dependencies. |
| Hosting | GitHub Pages from a public repo. |
| Networking | WebRTC peer to peer, PeerJS public broker for signalling. |
| Players | Up to 4 per race. |
| Joining | Share link and short room code, both. |
| Contact | Solid collisions plus the PIT maneuver (a hit on a rival's stern quarter spins them). |
| Drafting | Slipstream and slingshot, and bump drafting (a square push from behind speeds both boats). |
| Boost | Skill based: airtime (built) and drafting (to build). No pickups. |
| Not wanted | Blowovers and wrecks, elimination mode, storm-run mode, kart pickups, AI opponents. |
| Handling | Arcade steering on real waves. |
| Formats | Circuit laps, point-to-point sprint, oval speedway. All three courses exist. |
| Weather | Random each race (seeded). Built for solo; the host must send the seed. |
| Solo | Time trial with ghost (built). |
| Art | Boats and marks built in code. |
| Camera | Chase and helm, `C` toggles (built). |
| Hardware | Gaming PC is the baseline. `?q=low` exists for laptops. |
| Controls | Keyboard and gamepad (built). |
| Pace | The owner wants usage kept light. Build one milestone, verify, stop. |

## What exists

Milestones 1 and 2 (solo time trial) and the visual upgrade in `docs/BRIEF_VISUAL_UPGRADE.md`.
That brief's contracts (boat space, vertex format, material ids, `BOAT_ANCHORS`,
`game.renderBoats()`, the systems hooks, `app.fx`) still hold; read it before touching visuals.

- `src/main.js`: the engine's frame, quality tiers, the frame loop and governor wiring.
- `src/game/game.js`: race state, camera and speed effects, ghost, best times, the systems list.
- `src/game/boat.js`: physics at a fixed 120 Hz. `step(dt, input, sea, drive)`.
- `src/game/probe.js`: sea height and slope under up to 8 points per frame, read back late.
- `src/game/courses.js`: three courses, gate and lap logic, grid slots, seeded conditions.
- `src/game/models/`: the boat (25,000 triangles, with `BOAT_ANCHORS`), a stand-in seated driver,
  the buoy. `src/game/geo.js` is the geometry builder.
- `src/game/mesh.js`: the lit mesh pass. Procedural materials by material id, livery stripes and
  race number, see-through glass, shadow and ambient-occlusion sampling.
- `src/game/shadow.js`, `src/game/lights.js`: the boats' sun shadow map; nav and cockpit glows.
- `src/game/wake.js`: each boat's path, the wake field (same formula in GLSL and JS, so the
  physics feels it through `seaOffset`), and the per-boat uniforms for `src/ocean/water.js`
  (sea hidden inside the hull, foam line, bow wash, shadow on the water, underwater glow).
- `src/game/boatspray.js`: spray particles.
- `src/game/hud.js`, `src/game/pixel.js`: the pixel-art interface. Text is a `<px-t>` element
  drawing bitmap fonts; shades are dither patterns; lengths are logical pixels (`em`).
- `src/game/settings.js`, `src/perf.js`: saved settings; the governor (gives up spray, water
  shadow, boat shadows, then resolution) and the F3 overlay.
- `src/sky/clouds.js`, `src/sky/sky.js`: sharper cloud history, reshaped cumulus, a cirrus layer.

Facts worth knowing:

- **Waves are a pure function of sea time and weather.** A race sets `app.time = 60` at the
  start of the countdown, so the same conditions always give the same waves. Multiplayer gets
  matching seas on every client by sharing the start instant and the conditions seed; no wave
  data is sent. Sea time wraps every 1000 s.
- Remote boats and the ghost are drawn from a pose (`pos, yaw, pitch, roll`). They need no
  probe points.
- Pausing stops the frame loop entirely. In multiplayer, pause must not stop the simulation.

## Milestone 3: multiplayer

1. Vendor PeerJS (one file, no build) under `src/vendor/`. Room code = host's peer id suffix;
   link = `?room=CODE`.
2. Lobby: host picks course; conditions are rolled from a seed the host sends. Up to 4 players,
   each with a colour and a grid slot.
3. Start: host sends `{ course, seed, startAt }` where `startAt` is a shared clock time; every
   client sets sea time from it so waves match. Sync clocks with a few ping round trips.
4. State: each client simulates its own boat and sends its pose and velocity about 20 times a
   second. Others are interpolated about 100 ms behind.
5. Host owns gate order and finishing positions; show position (1st to 4th) in the HUD and a
   results table.
6. Contact: boat-to-boat collision resolved locally against interpolated rivals, each client
   moving only its own boat. PIT: a hit on the rear quarter adds yaw spin to the boat that was
   hit (the victim's client applies it when it detects the contact).
7. Drafting: inside a rival's wake cone (about 25 m long) reduce drag and fill boost. Bump
   draft: a square push from behind adds forward speed to both.

## Milestone 4: polish and release

- Engine sound (synthesized, pitch from speed and throttle, cuts out when the stern is clear of
  the water). Audio engine is `src/audio/audio.js`.
- Enable GitHub Pages (Settings, Pages, deploy from the default branch root). `.nojekyll` is
  already in place.
- A generated driver model, if the owner's ForgeGUI plan allows 3D generation (it refused with
  `paid_generation_required`). `MAT.TEXTURED` and a `texture` draw option are ready; a GLB loader
  is not written.

## Known gaps

- **Not yet run on a real GPU.** Everything was built and checked in headless Chromium with
  software rendering, where a frame takes seconds. The owner's card is an RTX 2070 Super at
  1080p. The first real run should open the F3 overlay and copy its readout: that is the first
  measurement of frame time, of whether the medium tier is right, and of the governor's
  thresholds. Handling constants are at the top of `src/game/boat.js`.
- Clouds: improved and checked in calm conditions only. The storm deck is unchanged and still
  speckled at low resolution; the breeze and rough looks, the warm low-sun tint and the silver
  lining were not checked in stills. Cirrus is not in the reflection environment.
- Wake physics: the CPU and GPU wake fields agree numerically, but no second boat has ridden a
  wake yet. The wake uses the nearest path segment, so a boat crossing its own loop is approximate.
- True night is untuned (lights, glow); races run in daylight conditions.
- The driver casts no shadow. The gamepad Start button resumes the race while Settings is open.
- Chrome logs a "READ-usage buffer was written, then fenced" performance warning from the probe
  readback. Results are correct; the readback may be taking a slower path.
- The headless driver renders slowly and several at once can exhaust the container's memory.
  Run one render at a time.

## Testing without a GPU

```bash
node tools/serve.mjs 5173 &
node tools/drive.mjs out.png "q=low&scale=0.5" "await T.sim(30); app.game.start('circuit','breeze'); T.autopilot(); await T.sim(300, 1/30); await T.frames(8); return T.snap();" 960 540
```

`T.sim` steps the sea and the game without drawing (about 80 ms a step); `T.frames` renders
(seconds a frame). `PAGE=1` captures the HUD as well.
