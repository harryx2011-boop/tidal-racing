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

## What exists (milestones 1 and 2)

- `src/main.js`: the engine's frame. Calls `game.update(dt, oceanTextures)` after the sea
  advances and `game.draw(sceneUniforms)` inside the main pass, after the water.
- `src/game/game.js`: race state (`menu`, `countdown`, `racing`, `finished`), camera, ghost
  recording and playback, best times in `localStorage`.
- `src/game/boat.js`: physics at a fixed 120 Hz. Four hull points give buoyancy, trim and
  launch; thrust, drag, grip and steering sit on top. `step(dt, input, sea, drive)`.
- `src/game/probe.js`: reads sea height and slope under up to 8 points per frame from the GPU,
  one to three frames late; callers extrapolate along the slope.
- `src/game/courses.js`: three courses, gate and lap logic (`Progress`), start grid slots
  (`grid(course, slot)` already takes a slot for multiplayer), seeded conditions.
- `src/game/mesh.js`: code-built boat and buoy meshes and the lit mesh pass. Buoys ride the
  waves in the vertex shader, so they need no probe points.
- `src/game/hud.js`, `src/game/input.js`: DOM HUD and menus; keyboard and gamepad.

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

- Wake and bow spray. This is the most visible gap: the boat leaves no mark on the water.
  The foam fields are in `src/ocean/` and the water shader in `src/ocean/water.js`.
- Engine sound (synthesized, pitch from speed and throttle, cuts out when the stern is clear of
  the water). Audio engine is `src/audio/audio.js`.
- A settings panel for quality and sound instead of the `?q=` parameter.
- Enable GitHub Pages (Settings, Pages, deploy from the default branch root). `.nojekyll` is
  already in place.

## Known gaps

- **Not yet run on a real GPU.** It was built and checked in headless Chromium with software
  rendering, where a frame takes seconds. Frame rate, the feel of the handling and the dynamic
  resolution thresholds all need a pass on real hardware. Handling constants are at the top of
  `src/game/boat.js`.
- Chrome logs a "READ-usage buffer was written, then fenced" performance warning from the probe
  readback. Results are correct; the readback may be taking a slower path.
- There is no rival boat yet, so slipstream and contact do not exist and are untested.

## Testing without a GPU

```bash
node tools/serve.mjs 5173 &
node tools/drive.mjs out.png "q=low&scale=0.5" "await T.sim(30); app.game.start('circuit','breeze'); T.autopilot(); await T.sim(300, 1/30); await T.frames(8); return T.snap();" 960 540
```

`T.sim` steps the sea and the game without drawing (about 80 ms a step); `T.frames` renders
(seconds a frame). `PAGE=1` captures the HUD as well.
