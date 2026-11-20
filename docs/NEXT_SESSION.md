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
