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
| Pace | Superseded on 20 November: finish through to release, builders in parallel. |

## Handover to a local session (20 November): read this first

The work moves from a cloud container (software rendering, minutes per still) to the owner's PC
(RTX 2070 Super, 1080p). Branch: `claude/beautiful-planck-m9jlwl`. Pull requests go into `main`.
`git pull` before starting: the cloud session may still push 3D work to this branch, and this file on
the branch is the latest word.

### Decisions (the owner's; do not re-ask)

- Finish everything through to release on GitHub Pages.
- Fable builders for 3D work (objects, sky, land, sea); Sonnet builders for everything else.
- Each 3D stream gets at most two judged rounds by an independent judge (rubric in
  `docs/BRIEF_DETAIL.md`: 1280x720, `q=medium&scale=1`, five scores of 1 to 10, pass is every score 7
  or more). Round 1 belongs to the cloud session; round 2 is yours.
- `main` exists (created from the old default branch). One pull request into `main` per milestone.
  The owner merges, sets `main` as the default branch and turns Pages on.
- The decisions table at the top of this file and the one in `docs/BRIEF_DETAIL.md` still bind.
- When the scope of something is unclear, ask the owner rather than guess.

### What is merged on the branch

| Area | State | Verified how |
| --- | --- | --- |
| Objects round 2, land and coast, sky (the saved builder branches) | Merged as they were | Both course checks "all clear"; headless stills only. Not yet judged. |
| Contact, PIT, slipstream, slingshot, bump draft (`contact.js`, `draft.js`) | Merged | `tools/check-contact.mjs` in Node. Never seen in a browser. `?rival=1` and `?rival=2` spawn a scripted rival. |
| Sound (`enginesound.js`, `sfx.js`) | Merged | 69 offline signal checks. **Nobody has heard it.** |
| Tests and fixes | Merged | `node tools/check-all.mjs`: 91 unit tests plus land, collide and contact checks. CI workflow added, not yet run on GitHub. |
| Multiplayer (`src/game/net/`, `lobby.js`, vendored PeerJS 1.5.5) | Merged | `tools/check-net.mjs` over the local transport and over WebRTC on loopback. **The public PeerJS broker was never reached.** |

Judge verdicts are kept in `docs/verdicts/`. **Objects round 2: FAIL** (`Q-objects-r2.md`; that was its
second and last judged round, so fix its five defects and report, without another judge unless the owner
asks). Possibly still to come from the cloud session (check `git log`): round 1 of sky, land and coast,
and sea and shore, each with one verdict. If a verdict is missing for a stream, run the judge yourself
before fixing. Storm stills need a few half-second frames first: auto-exposure adapts over time and a
storm still taken straight after `game.start` comes out almost black.

### What to do, in this order

1. **First real run.** `node tools/serve.mjs 5173`, open http://localhost:5173 in Chrome at 1080p.
   Nothing has ever run on a real GPU, so expect first-run faults: shader compile errors on a real
   driver, the "WebGL: too many errors" message the smoke test printed once (source unknown), and the
   sea-height readback (`probe.js`, `marks.js`, `scenery.js` now use `STREAM_COPY`; confirm the boat
   rides the waves normally). Fix what is broken before anything else.
2. **Measure.** Press `F3` on each course, drive 30 s along the coast, copy the readout (frame time,
   meshes versus sea, draws and triangles per system) and save the three readouts in this file.
3. **Make rendering fast for yourself.** `tools/drive.mjs` forces software rendering (the swiftshader
   flags) and loads Playwright from `/usr/lib/node_modules`. Add a switch that launches Chromium on
   the real GPU and resolves Playwright locally. Then stills take a moment and `T.sim` no longer
   starves (in the container the readback fence almost never signalled, so physics barely advanced;
   `tools/smoke.mjs` works round it with a blocking readback: check whether that is still needed).
4. **Finish the 3D streams** (Fable builders, one judge per stream, round 2 only): apply each
   verdict's five worst defects, re-judge once, report what is left. Known before judging: clouds read
   as hard-edged puffs; the lighthouse base was buried; objects round 1 failed on mannequin people,
   hovering hulls, dotted wires and bare surfaces (round 2 claims fixes, unverified); sea and shore
   had no foam rings round piers, stacks and boulders.
5. **Performance** (Sonnet), from the readouts only. Target 60 fps at 1080p on the medium tier, with
   the governor's thresholds set from real numbers. Prime suspects: 61,301 trees on the circuit and
   35,713 on the oval, about 120 buildings, 600 containers on the ship, 300 armour stones per
   breakwater chunk, 60 to 150 terrain chunk draws, one draw per lamp glow, the sea shader.
6. **Multiplayer for real** (Sonnet). Two tabs with `?transport=local` on both, then two browsers or
   two machines through the public PeerJS broker. Look at every screen nobody has seen: join by code,
   results table, place text in the HUD, the multiplayer pause menu. Race full laps (finishes were
   staged in the tests). Known faults: the lobby shows two different default names for one player; a
   background tab stops sending so its boat freezes for others; contacts can look 3 to 4 m early or
   late at speed (rivals are drawn 100 ms in the past, collisions use a pose extrapolated by
   `game.contact.lead`); one reliable ordered channel carries poses, so a lost packet stalls them.
7. **Feel and sound, with the owner.** Contact and drafting constants are at the top of
   `src/game/contact.js` and `draft.js` (`PIT_SPIN`, `DRAG_CUT`, `SLING_ACC`); sound constants in
   `TUNE` at the top of `src/game/enginesound.js` and `LEVEL` in `sfx.js`. Check the Settings panel
   layout (two new slider rows). Ask the owner to play and listen; tune from what they say.
8. **Smaller known faults.** Near and far height fields disagree by up to 14 m about 1 km beyond the
   last gate; a boat more than 60 m inland is pushed along +x; no "wrong gate" state or sound; the
   driver casts no shadow; true night is untuned; `tools/smoke.mjs --full` (a full lap) never ran.
9. **Release.** `node tools/check-all.mjs` and the smoke test green; README and this file updated;
   pull request into `main`; ask the owner to merge, set `main` as default and enable Pages (Settings,
   Pages, deploy from `main`, root). Then test the live URL, including a `?room=` link between two
   machines.

### Rules

- `node tools/check-all.mjs` must pass before every commit; run `tools/check-net.mjs` and
  `tools/check-sound.mjs` after touching net or sound.
- Commit often, push to `claude/beautiful-planck-m9jlwl`, never commit stills or audio clips.
- No build step, no runtime dependencies beyond the vendored PeerJS file, no art files.
- Solo handling must stay bit-for-bit unchanged when `game.rivals` is empty (best times and ghosts
  depend on it; `check-contact.mjs` asserts it).
- Report honestly: what was seen on screen, what was only checked by number, what was not checked.
- The container-only conventions in `docs/BRIEF_DETAIL.md` (`tools/shot.sh`, the `/tmp` lock files,
  the worktree paths, the scratchpad paths) do not apply on the owner's PC.

### On the PC so far (20 November)

- Cloned to `C:\tidal-racing` (Windows 11, Node 24.15). `node tools/check-all.mjs` passes: all 4 steps.
- `tools/check-contact.mjs` skipped its solo baseline on Windows (a URL pathname used as `cwd`). Fixed;
  it now reports "4800 steps compared on a rough sea, 0 differences".
- **Step 3 done.** `tools/pw.mjs` finds Playwright (the repo, `/usr/lib/node_modules`, then `npm root -g`)
  and picks the GL backend: the real GPU by default off Linux, `GPU=0` for software, `HEADED=1` for a
  window. `drive.mjs`, `smoke.mjs`, `check-net.mjs` and `check-sound.mjs` use it. `LIVE=1` on `drive.mjs`
  leaves the game's own frame loop running; `T.wait(s)` and `T.report()` (the F3 readout) are new helpers.
- **Step 1, first real run** (headless Chromium, new headless mode, ANGLE Direct3D 11 on the RTX 2070
  Super, 1920x1080, `q=medium`). Seen in stills: the menu and a race on each course render correctly.
  No page error, no console error or warning, no shader compile or link failure, `gl.getError()` 0 after
  38 s of racing on each course. The "WebGL: too many errors" message and the READ-usage warning did not
  appear. The sea probe answers every frame (`probe.fresh` true in every sample) and the boat pitches and
  rolls with the waves at 33 to 37 m/s. Not yet seen: a headed Chrome window, and anything by the owner.

- **First-run fault found: a cold load freezes the tab for 78 s.** 72 s of it is shader compile and link
  on Direct3D (46 programs, one after another; five take about 10 s each). A warm profile loads in about
  3 s, so `tools/drive.mjs` now keeps its browser profile (`PW_PROFILE`). The fix (parallel compile, a
  loading screen with real progress) is in work on `local/load`.
- **Checks on the PC:** `check-sound.mjs` passes; `check-net.mjs` passes over the local transport
  (3 players, 37 checks). The public PeerJS broker answers from here (`0.peerjs.com`, 0.17 s) but no race
  has run through it yet.
- **The repo is public and Pages is on** (the owner's choice, 20 November), built from this branch:
  https://harryx2011-boop.github.io/tidal-racing/ . At release Pages moves to `main`.

### Shipped as it stands (20 November, the owner's call: "ship the game as it is")

The owner stopped the agents to save usage and asked for the game to ship as it is. It is live at
https://harryx2011-boop.github.io/tidal-racing/ from this branch, with a pull request into `main` open.
Not done, in the order it would be picked up again:

1. The 78 s cold-load freeze (no fix merged; partial, uncommitted work in the `local/load` worktree).
2. Real recorded sound (not started beyond sourcing; the game still plays the synthesized sound).
3. The music player (not started; see the NCS licence note below).
4. Two-machine multiplayer through the public broker, and the known multiplayer faults (step 6).
5. 3D: land and coast was judged **FAIL** (`docs/verdicts/P-land-r1.md`; lowest score 3, trees and ground
   up close). Sky and sea were not judged. Objects' five defects (`Q-objects-r2.md`) are not fixed.
6. Performance (clouds cost 6.8 to 7.4 ms of 16.7), feel and sound tuning with the owner, steps 7 and 8.

The answers below still bind when the work resumes.

### The owner's answers on 20 November (PC session; do not re-ask)

| Topic | Answer |
| --- | --- |
| Sound | Real recordings, chosen and checked with earshot: outboard engine loops by rev level, hull wash, slaps, impacts, a start signal. CC0 and CC BY only, credited. The synth stays as the fallback. This replaces "no art files" for audio. Why: earshot read all 16 synth clips as code-made (full throttle "a vacuum cleaner", p_real 0.02). |
| Music | A music player in the game. The owner asked for NCS tracks; NCS's usage policy (ncs.io/usage-policy, read 20 November) says a game needs a licence from NCS and that "music players" are not free use. So NCS files are not bundled until the owner holds a licence; the player takes its tracks from a manifest. |
| 3D polish | One judged round per area, a builder only where a score is under 7. Sea and shore gets a builder either way (it never had one). Objects: fix the five defects of `docs/verdicts/Q-objects-r2.md`, no further judge. |
| Publishing | Repo public and Pages on now, from the work branch, so multiplayer can be tested on the real address. |
| The owner's view | "the game quality is amazing"; sound, multiplayer and finishing come first. |

### Step 2: the three readouts (20 November, autopilot, breeze, day, seed 12345, 38 s from the start)

Frame rate is capped at the display's 60 Hz, so read the GPU times: the frame costs 15.6 to 16.3 ms of
a 16.7 ms budget, and **the clouds are 6.8 to 7.4 ms of it**. Meshes are 1.6 to 3.8 ms and the sea 2.5 to
3.0 ms. The 1% low is 16 to 18 fps (single frames of 55 to 67 ms): hitches, cause not yet found.
The governor gave up one step of spray on the sprint.

```
circuit                                              sprint                                               oval
56.9 fps   17.6 ms avg                               52.7 fps   19.0 ms avg                               54.4 fps   18.4 ms avg
1% low 18.0 fps (55.6 ms)  worst 58.2 ms             1% low 16.3 fps (61.2 ms)  worst 66.7 ms             1% low 17.1 fps (58.4 ms)  worst 58.5 ms
fx spray 1.00 water-shadow 1.00 shadows 1.00         fx spray 0.67 water-shadow 1.00 shadows 1.00         fx spray 1.00 water-shadow 1.00 shadows 1.00
governor auto rung 0/14 mean 16.8 ms                 governor auto rung 1/14 mean 17.0 ms                 governor auto rung 0/14 mean 17.4 ms
ocean 1.7 clouds 7.3 sky 1.3 water 2.7 meshes 2.1    ocean 1.7 clouds 7.4 sky 1.3 water 3.0 meshes 1.6    ocean 1.6 clouds 6.8 sky 1.1 water 2.5 meshes 3.8
env 0.1 rain 0.2 post 0.4  gpu total 15.8 ms         env 0.1 rain 0.1 post 0.4  gpu total 15.6 ms         env 0.1 rain 0.1 post 0.4  gpu total 16.3 ms
land 42/129k scenery 4/18k                           land 139/191k scenery 9/19k                          land 58/187k scenery 11/20k
wildlife 5/18k coastal 27/84k                        wildlife 1/5k coastal 45/33k                         wildlife 13/13k coastal 39/106k
```

All three: `render 1.00x 1920x1080 msaa 4 dpr 1.00`, tier medium, speed fx on, renderer
`ANGLE (NVIDIA GeForce RTX 2070 SUPER, Direct3D11)`. The menu (circuit backdrop): 52.9 fps, clouds 7.4,
meshes 3.4, gpu total 16.2 ms, land 62/184k, coastal 44/143k. To repeat:
`LIVE=1 PAGE=1 node tools/drive.mjs out.png "q=medium&stats" "app.game.start('circuit','breeze','day',12345); T.autopilot(); await T.wait(38); return T.report();" 1920 1080`.

## What exists

Milestones 1 and 2 (solo time trial), the visual upgrade in `docs/BRIEF_VISUAL_UPGRADE.md` and
the picture-and-world upgrade in `docs/BRIEF_WORLD.md` (all eight streams, G to N, are merged).
The first brief's contracts (boat space, vertex format, material ids, `BOAT_ANCHORS`,
`game.renderBoats()`, the systems hooks, `app.fx`) still hold; read it before touching visuals.

- `src/main.js`: the engine's frame, quality tiers, the frame loop and governor wiring.
- `src/game/game.js`: race state, camera and speed effects, ghost, best times, the systems list.
- `src/game/boat.js`: physics at a fixed 120 Hz. `step(dt, input, sea, drive)`.
- `src/game/probe.js`: sea height and slope under up to 8 points per frame, read back late.
- `src/game/courses.js`: three courses, gate and lap logic, grid slots, seeded conditions.
- `src/game/models/`: the boat (37,500 triangles, with `BOAT_ANCHORS`), the driver (5,900, plus an
  arms-only mesh for the helm camera), marks, structures, vessels, wildlife, per-course coast
  definitions and village houses. `src/game/geo.js` is the geometry builder.
- `src/game/mesh.js`: the lit mesh pass. Procedural materials by material id, livery stripes and
  race number, see-through glass, shadow and ambient-occlusion sampling.
- `src/game/shadow.js`, `src/game/lights.js`: the boats' sun shadow map; nav and cockpit glows.
- `src/game/wake.js`: each boat's path, the wake field (same formula in GLSL and JS, so the
  physics feels it through `seaOffset`), and the per-boat uniforms for `src/ocean/water.js`
  (sea hidden inside the hull, foam line, bow wash, shadow on the water, underwater glow).
- `src/game/boatspray.js`: spray particles.
- `src/game/marks.js`: navigation buoys on the gates, the start/finish gantry on floats, inflatable
  pylons at sharp corners, lantern glows.
- `src/game/scenery.js`: a seeded layout per course (lighthouse, breakwater, beacons, platform,
  committee boat, spectators, a cargo ship) with levels of detail, culling and `colliders`.
- `src/game/landfield.js`, `src/game/land.js`, `src/game/models/coast.js`: each course's land as
  a height field baked once from polygons (`land.heightAt(x, z)`, negative under water), drawn
  as chunks at four levels of detail plus far hills. `src/ocean/water.js` reads the same field:
  waves die in the shallows (`waveAtt`, shared with the physics through the `sea` closure),
  shallow water takes the bottom's colour, surf and foam run along the shore.
  `node tools/check-land.mjs` checks every gate, leg and scenery item for water under it; run it
  after moving a course or a coast.
- `src/game/collide.js`: grounding against the height field and push-out from marks and scenery,
  once per physics step.
- `src/game/wildlife.js`: seabird flocks, perched birds and rafts that react to boats, dolphin
  pods, fish, flotsam, people and flags. Placement is a pure function of the course and sea time.
- `src/game/hud.js`, `src/game/pixel.js`: the pixel-art interface. Text is a `<px-t>` element
  drawing bitmap fonts; shades are dither patterns; lengths are logical pixels (`em`).
- `src/game/settings.js`, `src/perf.js`: saved settings; the governor (gives up spray, water
  shadow, boat shadows, then resolution) and the F3 overlay.
- `src/sky/clouds.js`, `src/sky/sky.js`: sharper cloud history, reshaped cumulus, a smooth storm
  deck, broken cloud in rough weather, warm low-sun tint, a cirrus layer (also in reflections).
- Frame order in `src/main.js`: sky, then the opaque meshes (`game.draw`), then the sea, then
  windscreens and the ghost (`game.drawBlended`), then rain, spray and glows. The sea is the
  dearest shader, so it is drawn after everything that can hide it. The sky tables are rebuilt
  only when the sun, haze or camera height changes.

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
  The overlay now times the meshes apart from the sea and lists draw calls and triangles per
  world system. Optimise from that readout, not from guesses: nothing here has been measured.
  Untried candidates: one instanced draw for the lamp glows (scenery and marks draw one quad
  each), one draw per level of detail for the terrain chunks (60 to 150 draws a frame), a
  smaller vertex format, and rebuilding the reflection environment every other frame.
- Best times and ghosts from before the courses moved close to the coast are ignored (the key is `tidal.best3.`).
- Land: no trees (scrub is shading only); terrain shadows do not fall on the sea; the shore foam
  line is only as sharp as the sea mesh far from the camera. The racing lines now pass the coast at
  20 to 40 m (see the detail upgrade above); piers, moorings and boulders are solid but undrawn on
  main until `build/P-land` is merged. Motion shimmer on terrain is unchecked (stills only).
- Scenery: breakwater armour stones are plain blocks; people are blocky; the lighthouse beam is
  short, faint and off in storms because side-on it read as a pale band along the far shore.
- Wildlife: in the chase view birds are specks unless a flock is close; the flock scatter, landing
  on perches and take-off from boats were checked by number, not in stills.
- Clouds: the storm deck is smooth but flat underneath, and distant horizon clouds are unchanged.
- Water: the far wake is a pale veil beyond about 40 m; crossing wakes are untested.
- Boat: outboard cowls carry a blank white badge; the driver's gloves look like mittens up close.
- Wake physics: the CPU and GPU wake fields agree numerically, but no second boat has ridden a
  wake yet. The wake uses the nearest path segment, so a boat crossing its own loop is approximate.
- True night is untuned (lights, glow); races run in daylight conditions.
- The driver casts no shadow.
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
