# Brief: visual and performance upgrade

Five builders work in parallel, one workstream each. A reviewer integrates and reviews every
branch. Read the whole brief; your own workstream is one section, but the shared contracts
bind everyone.

## Goal

The boat is too simple. It should read as the reference photo: a long, open performance boat
with a white hull, a wraparound tinted windscreen, an open cockpit with white seats and sun
pads on a teak-coloured deck, three white outboards, purple underwater lights at the stern and
a heavy white wake and spray behind it. The photo is at
`/tmp/claude-0/-home-user-tidal-racing/004924be-ad0d-5479-9073-3ce39052a876/images/1.png`
(look at it; do not copy it into the repository).

The sea and sky come from the vendored open-water engine (`src/ocean`, `src/sky`, `src/fx`,
`src/audio`). The game is in `src/game`. `docs/NEXT_SESSION.md` describes the code as it stood
before this brief; `README.md` says how to run it.

## Decisions (the owner's answers; do not reopen)

| Topic | Decision |
| --- | --- |
| Boat source | Built in code, much more detailed. No model files for the boat. |
| Boat style | Match the photo: open performance boat, triple outboards. |
| Detail | Holds up from the chase camera (5 m and beyond). Not showroom close-ups. |
| Crew | Driver only: one ForgeGUI-generated seated figure (static pose), reused on every boat. |
| Materials | Procedural, in the shader: clear-coated gelcoat, teak planking with seams, matte upholstery, tinted glass, brushed metal, non-skid deck. No image files. |
| Shadows | Self-shadowing and ambient occlusion on the boat, and the boat's shadow on the water. |
| Reflections | Sky above, the actual sea colour below. No screen-space reflections. |
| Lights | Underwater transom glow in the player's colour, navigation lights, cockpit accent lighting. |
| Wake | Full: foam trail and prop wash, bow spray and rooster tail, and a real V wake that raises the water and that other boats can ride. |
| Spray | Medium: a few thousand particles per boat. |
| Water in hull | The sea is hidden inside the hull; a thin foam line where hull meets water. |
| Livery | Accent colour, one of a few stripe styles, and a race number. |
| Hardware | RTX 2070 Super, 1080p, 60 fps. |
| When slow | Give up effects first (spray, water shadow, boat shadows), resolution last. |
| Clouds | Sharper and more realistic. Four problems to fix: shape and variety, softness, lighting and colour, distance and horizon. |
| Screen effects | Speed effects only (shake, wider view, radial blur at speed and under boost). No lens drops, no motion blur. |

## What is not known

Nothing here has run on a real GPU. Development and testing use headless Chromium with software
rendering, where a 960x540 frame takes several seconds. Nobody knows the current frame time on
the target card. So: spend GPU time carefully, state the cost of what you add (triangles,
texture sizes, samples per pixel, passes), and make every effect scale down through `app.fx`.

Frame budget on the target: 16.6 ms for everything. Guides, not measurements: at most 60,000
triangles per boat (up to four boats and a ghost on screen); one 1024x1024 shadow map per frame;
at most 3,000 spray particles per boat; no new full-screen pass heavier than a bloom level.

## Shared contracts

**Boat space.** x forward, y up, z starboard; y = 0 is the design waterline. The physics
(`src/game/boat.js`) assumes a hull about 9 m long and 2.6 m wide with the transom near
x = -4.2; keep the hull within about 10% of that. Outboards may extend further aft.

**Vertex format** (`src/game/geo.js`): position (location 0), normal (1), colour (2), material
(3) = (material id, tint weight, glow), uv (4). The mesh shader also gets the untransformed
position and normal (`vObj`, `vObjN`), so procedural materials are laid out in object space.

**Material ids** (`MAT` in `geo.js`): `GELCOAT`, `PAINT` (takes the livery), `TEAK`,
`UPHOLSTERY`, `GLASS`, `METAL`, `NONSKID`, `RUBBER`, `LIGHT` (emissive), `TEXTURED` (samples the
`texture` draw option by uv). The model says which material a surface is; the shader says how
that material looks. Tint weight 1 means the surface takes the player's accent colour.

**Anchors** (`BOAT_ANCHORS` in `src/game/models/boat.js`): named points in boat space (bow,
transom, props, helm, nav lights, cockpit box). Everything that attaches to the boat uses these.
Workstream A keeps them true to the model and may add more; nobody else hard-codes positions.

**Boats to draw**: `game.renderBoats()` returns `{ pose, livery, ghost }` for every boat this
frame. `pose` is a `Boat` (`pos`, `vel`, `yaw`, `pitch`, `roll`, `axes()`, `matrix()`, `speed`,
`wet`, `airTime`, `boosting`, `throttle`). Loop over this; never reach for `game.boat`, so that
rival boats work everywhere when multiplayer arrives. Ghost boats leave no wake and no shadow.

**Livery**: `{ color: [r, g, b], stripe: 0..3, number: 0..99 }`, passed to `MeshPass.draw` as
`livery`. Stripe 0 is plain.

**Systems.** A visual system is a class in its own file, registered with one line in the `Game`
constructor (`this.systems.push(new Wake(this))`). It may implement any of:

| Method | Called |
| --- | --- |
| `update(dt, ot)` | every frame after physics; `ot` is `ocean.textures()` |
| `prePass(light)` | before the main pass; `light` is `{ sunDir, night }` (shadow maps) |
| `waterUniforms()` | returns extra uniforms merged into the sea surface shader's set |
| `draw(scene, meshes)` | in the main pass after the water and the boats, depth test on |
| `drawTransparent(scene)` | in the main pass after rain and spray (blended particles, glows) |
| `seaOffset(x, z, s)` | from the physics: add to `s.h`, `s.sx`, `s.sz` (height, slope) at a point |

`scene` is the frame's shared uniform set (sun, sky, fog, view-projection, camera position,
environment map, wave textures). `SKY_LOOKUP_GLSL` in `src/sky/atmosphere.js` gives a shader the
sun and sky irradiance, aerial perspective and fog; anything drawn in the main pass must apply
aerial perspective and fog as `src/game/mesh.js` does.

**Effect levels**: `app.fx = { spray, shadows, waterShadow }`, each 0..1, written by the
governor (workstream E). Read them every frame and scale your cost with them; at 0 the effect
must cost nothing.

**Determinism.** Waves are a pure function of sea time and weather, and multiplayer will rely
on that. Anything that changes what a boat feels (the wake) must be a pure function of the
boats' recent paths, so every client reproduces it without extra network data.

## Workstreams and file ownership

Edit only the files you own. If you need a change elsewhere, make the smallest possible edit,
and name it in your report; for `src/game/game.js` that means your one registration line.

### A. Boat model
Owns `src/game/models/boat.js`, `src/game/models/buoy.js`, `src/game/geo.js`.

Rebuild `boatGeo()` to match the photo at chase-camera detail: a fair, smooth hull with flared
bow, chines, spray strakes and a rub rail; foredeck and bow sun pad; wraparound windscreen with
a frame; helm console with wheel; helm seats; rear bench and aft sun pads; swim platform; three
outboards with cowls, midsections and lower units; grab rails and cleats. Smooth normals where
the surface is smooth, hard edges where it is not. Assign material ids and tint weights (which
surfaces take the livery). Leave a clear seat at `BOAT_ANCHORS.helm` for a seated adult driver
facing forward. Update `BOAT_ANCHORS` (three `props`). Extend `Geo` with what you need (sweeps,
tubes, lofts). At most 60,000 triangles; report the count.

### B. Materials, lighting, boat shadows, lights
Owns `src/game/mesh.js`; new files `src/game/shadow.js`, `src/game/lights.js`.

In the mesh shader: a procedural look per material id (gelcoat with a clear-coat highlight, teak
planks and seams running fore and aft, soft matte upholstery with piping, tinted glass, brushed
metal, non-skid stipple, rubber); reflections that show the sky above and the sea's colour
below the horizon; livery (accent colour, stripe styles laid out along the hull in object space,
a race number on each side); `MAT.TEXTURED` sampling the `texture` draw option. A sun shadow map
of the boats sampled in the mesh pass, plus ambient occlusion so the cockpit and creases darken
(a top-down depth map of the boat is one cheap way). Navigation lights (red port, green
starboard, white stern) and cockpit accent lighting as emissive surfaces with soft glows that
show in low light. Honour `app.fx.shadows`.

### C. Wake, spray and everything drawn on the sea
Owns `src/ocean/water.js`; new files `src/game/wake.js`, `src/game/boatspray.js`.

A foam trail and prop wash behind each boat; bow spray sheets, a rooster tail at speed and a
burst on landing (medium density, honour `app.fx.spray`); a V wake that displaces the sea
surface and is returned to the physics through `seaOffset`, as a pure function of each boat's
recent path; the sea hidden inside the hull (see `BOAT_ANCHORS.cockpit` and the hull outline)
with a thin foam line at the hull; the boat's shadow on the water, computed analytically from
each boat's pose and the sun direction (no dependence on B's shadow map; honour
`app.fx.waterShadow`); an underwater glow behind each transom in the boat's accent colour.
Support four boats. Keep the open-water foam and shading intact where no boat is near.

### D. Clouds
Owns `src/sky/clouds.js`, `src/sky/sky.js`.

Fix the four problems, in this order of value. Softness: the image smears when the camera turns
or moves fast (a racing chase camera does both constantly); improve reprojection, history
rejection and upsampling so clouds stay crisp at the half-resolution tier. Shape and variety:
crisp cauliflower tops and flat bases on cumulus, a thin high cirrus layer, and distinct looks
for the calm, breeze, rough and storm conditions. Lighting and colour: stronger contrast between
sunlit sides and shaded bases, silver linings toward the sun, warm colour at low sun. Distance
and horizon: clouds stacking toward the horizon with convincing haze. Do it by better
reconstruction and better noise, not by more samples: the half-resolution tier may cost at most
a quarter more per pixel than it does now; say what it costs. Keep the weather presets'
meaning. Before-and-after stills of the same scene are the deliverable that proves it.

### E. Performance, settings, speed effects
Owns `src/main.js` (quality tiers, the frame loop), `src/fx/post.js`, `src/game/hud.js`,
`camera()` in `src/game/game.js`; new file `src/game/settings.js`.

A performance overlay (toggle with F3 or `?stats`): frame rate, frame time, 1% low, render
scale, effect levels, and the GPU pass timings the engine's `Profiler` already collects. A
governor that holds 60 fps by lowering `app.fx.spray`, then `waterShadow`, then `shadows`, and
only then resolution, with hysteresis so it does not oscillate. A settings panel reachable from
the menu and the pause screen: quality tier, sound, speed effects on or off, and the livery
picker (accent colour, stripe style, race number), all saved in `localStorage` and applied to
`game.livery`. Speed effects: camera shake and radial blur that grow with speed and boost,
subtle, off-switchable. Default tier for the target card at 1080p.

### F. Driver (the reviewer does this one)
A ForgeGUI-generated seated driver, a small GLB loader (`src/game/glb.js`), drawn at
`BOAT_ANCHORS.helm` with `MAT.TEXTURED`.

## Rules for builders

- Plain JavaScript ES modules. No dependencies, no build step, no image or model files.
- WebGL2 only. Shaders go through `Program` in `src/gl.js`, which reports compile errors with
  source context.
- Match the existing comment style: say why, and the physical reasoning; no change-log comments.
- Work in your own worktree and commit there on a branch named `build/<letter>-<topic>`. Do not
  push and do not open a pull request.
- Test with the headless driver on your own port:
  `node tools/serve.mjs <port> &` then `PORT=<port> node tools/drive.mjs <out.png> "q=low&scale=0.5" "<script>" 640 360`.
  `T.sim(n, dt)` steps sea and game without drawing (fast); `T.frames(n)` renders (seconds per
  frame, and slower while other builders are running). Shader errors appear as `[pageerror]`.
  Stop your server when you finish.
- Save review screenshots under
  `/tmp/claude-0/-home-user-tidal-racing/004924be-ad0d-5479-9073-3ce39052a876/scratchpad/review/<letter>/`
  and look at them yourself before you report.
- Report: branch name; files changed; what you verified and how, with screenshot paths; what you
  could not verify; known problems; the cost of what you added. Say plainly if something is
  unfinished.
