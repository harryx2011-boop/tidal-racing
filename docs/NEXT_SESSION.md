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

## Detail upgrade: where it stands (read this first)

The owner looked at stills and said "Everything needs more detail". Decisions (do not re-ask): all four
areas (land and coast; vessels, structures and people; sea and shore; sky and clouds); courses brought
close to the coast; **Fable builders for fidelity, each looped against an independent judge, up to three
rounds; Sonnet 5.5 builders for game code, optimisation, bug fixes and testing.** The brief for all of it
is `docs/BRIEF_DETAIL.md` (rubric, budgets, the judge loop, the O-to-P `features` contract). It stopped
because the Fable limit was reached (it resets at 06:00 UTC) and the owner asked to stop and save usage.

**Merged and pushed to `claude/gracious-curie-8x4a1z` (HEAD `10de871` plus this handoff):**
- Stream O, courses close to the coast: all three courses pass piers, quays, moorings, boulder fields,
  stacks, cliffs and the breakwater head at 20 to 40 m; per-course `features` in `models/coast.js`
  (with `mooringSpots`, `rockSpots`, `featureColliders`) and colliders in `collide.js`;
  `tools/check-land.mjs` reports close passes and `tools/check-collide.mjs` drives a boat into every
  solid (both end "all clear"); best-time key is now `tidal.best3.`. The container ship was routed through
  hills on every course; it now steams in open water (`buildLayout`). Autopilot laps: no hits.

**Unmerged work, saved in `handoff/builders.bundle` (the container is ephemeral and the branches were
never pushed). Restore with:**
```bash
git fetch handoff/builders.bundle 'refs/heads/*:refs/heads/*'
```
Each merges cleanly into the dev branch on its own (checked with `git merge-tree`); Q and P together
were not tested together (P was started from Q round 1 and Q has since done round 2). Squash-merge, fix,
verify with a headless render, commit, push. Delete `handoff/` once the branches are restored and merged.

| Branch | Stream | State |
| --- | --- | --- |
| `build/Q-objects` | Q, fidelity: vessels, structures, marks, people (`models/kit.js` is its building kit) | Round 1 judged **FAIL**; round 2 committed (`c9270e6`) but **never judged or reviewed**. |
| `build/S-sky` | S, fidelity: sky and clouds (`src/sky/clouds.js`, `sky.js`, a little in `main.js`) | Builder was stopped mid-work; last commit is an unreviewed WIP commit. **Never judged.** Its stills are in the old scratchpad only, so re-render. |
| `build/P-land` | P, fidelity: land and coast (terrain shading, `coastal.js`, trees, rocks, harbours, piers, moorings, buildings) | Builder stopped by the limit; 4 commits, the last a WIP commit. **Never judged or reviewed.** Needs one registration line in `game.js`. |

Not started: **R** (Fable, sea and shore: near-boat wave detail, breaking surf, foam, far wake, foam rings
round the new rocks and piles; `water.js`, `wake.js`, `boatspray.js`; `land.js` `fixedFor()` only reads
scenery colliders, so piers, stacks and boulders get no foam ring yet: a one-line hook with
`featureColliders`) and **U** (Sonnet: optimisation, bug fixes, tests; see the untried candidates below).

**Judge round 1 on Q: the five worst defects (round 2 claims to address these; verify, do not trust)**
1. People at 4 to 5 m are mannequins: tube limbs, mitten hands, no face features, one all-yellow figure,
   no shadows. 2. The safety RIB hovers above a calm sea, outboard leg in the air; other hulls ride high;
   no wet line or foam at hulls. 3. Storm: the tower banner becomes a white slab, round discs for lit
   windows and lamps, glows oversized by day. 4. Thin wires (shrouds, stays, guy wires, truss lacing)
   render as dotted lines. 5. Flat, bare surfaces (cruiser cabin, committee wheelhouse, course-side
   breakwater crown wall) and no cast shadows on close assets. Also the lighthouse stands at y = 0 on
   ground 6 to 9.6 m high, so its rock and base are buried (seat it on `heightAt`).

**To finish the upgrade, in this order (keep usage light; run one render at a time):**
1. Restore the branches. Run fresh Fable judges on Q round 2 and S (the rubric is in `BRIEF_DETAIL.md`:
   1280x720, `q=medium&scale=1`, scores 1 to 10, pass is all 7 or more, at most three rounds in total).
2. Review and merge Q, S, P (judge P and send its verdict back through the same loop), re-run
   `check-land.mjs` and `check-collide.mjs`, render combined views at 1280x720 medium on all three courses,
   commit, push.
3. Launch R (Fable) and U (Sonnet) from `BRIEF_DETAIL.md`; judge R; merge.
4. Optimise from a **real measurement**: the owner has not yet run the game on the RTX 2070 Super. Ask
   for the F3 readout (frame time, meshes versus sea, per-system draws and triangles) before spending
   effort. The detail added here (about 600 containers on the ship, 300 armour stones per breakwater chunk,
   trees, buildings) is large and its cost on a real GPU is unknown.
5. Update this file, `README.md`, and send the owner 1280x720 medium stills (the earlier ones were
   800x450 low, which is part of why the world looked plain).

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
