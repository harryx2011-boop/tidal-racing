# Tidal Racing

Powerboat racing on a physically simulated ocean, in the browser. No build step, no runtime
dependencies, no art files: the sea, sky, land, boat and everything on the water are computed.

Status: **solo time trial is playable** on three courses that run along a coast, with a detailed
code-built boat and driver, wake and spray, navigation buoys and a start gantry, lighthouses,
breakwaters and other vessels, seabirds and dolphins, sunrise and sunset, and a pixel-art
interface. Multiplayer is next; see [`docs/NEXT_SESSION.md`](docs/NEXT_SESSION.md). It has not
yet been run on a real GPU.

## Run

```bash
node tools/serve.mjs 5173
```

Then open http://localhost:5173. Needs a desktop browser with WebGL2 and a dedicated GPU for the
default quality. Quality, sound, livery and performance options are in Settings; `?q=low`,
`?q=medium` or `?q=high` in the address overrides the saved quality.

## Play

| | |
| --- | --- |
| `W` `S` / arrows | throttle, brake and reverse |
| `A` `D` / arrows | steer |
| `Shift` or `Space` | boost (filled by airtime off wave crests) |
| `C` | chase / helm camera |
| `R` | reset to the last gate passed |
| `Esc` | pause |
| `M` | sound on / off |
| `F3` | performance overlay (frame rate, GPU pass times, a copy button) |
| Gamepad | triggers, left stick, A boost, Y camera, X reset, Start pause |

Pass between each pair of marks (red to port, green to starboard) in order. Three courses, four
sea states, and day, sunrise or sunset. Every race in the same conditions runs on the same waves,
so your best run races beside you as a ghost. Land, marks and anchored boats are solid.

## Layout

```
src/game/          the game: boat physics, courses, race logic, camera
src/game/models/   boat, driver, marks, structures, vessels, wildlife and coasts, built in code
src/game/mesh.js   lit mesh pass: procedural materials, livery, shadows       (shadow.js, lights.js)
src/game/wake.js   boat wakes on the sea and in the physics; boatspray.js: spray particles
src/game/marks.js  navigation buoys, start/finish gantry, turn pylons
src/game/scenery.js    lighthouses, breakwaters, beacons, platforms, anchored and passing vessels
src/game/land.js   coastline terrain from a baked height field (landfield.js); collide.js: collisions
src/game/wildlife.js   seabirds, dolphins, fish, flotsam, people and flags
src/game/hud.js    menus and HUD as pixel art (pixel.js: bitmap fonts, dither patterns)
src/game/settings.js, src/perf.js   saved settings, frame-rate governor, performance overlay
src/ocean/         FFT wave cascades, foam, sea surface shading               (open-water)
src/sky/           atmosphere, volumetric clouds, cirrus                      (open-water)
src/fx/            rain, wind spray, lightning, post-processing               (open-water)
src/audio/         synthesized sea and wind, recorded rain and thunder        (open-water)
tools/             dev server, headless test driver, course clearance check (check-land.mjs)
```

## Credits

The ocean, sky, weather and audio engine is [Open Water](https://github.com/Leonxlnx/open-water)
by Leonxlnx, MIT licensed (see `LICENSE-open-water`). The audio recordings keep their Creative
Commons licenses; see `assets/audio/CREDITS.md`.
