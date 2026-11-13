# Tidal Racing

Powerboat racing on a physically simulated ocean, in the browser. No build step, no runtime
dependencies, no art files: the sea, sky, boat and marks are all computed.

Status: **solo time trial is playable** (milestones 1 and 2). Multiplayer is next; see
[`docs/NEXT_SESSION.md`](docs/NEXT_SESSION.md).

## Run

```bash
node tools/serve.mjs 5173
```

Then open http://localhost:5173. Needs a desktop browser with WebGL2 and a dedicated GPU for the
default quality. Add `?q=low` for integrated graphics or `?q=high` for the reference quality.

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
| Gamepad | triggers, left stick, A boost, Y camera, X reset, Start pause |

Pass between each pair of marks (red to port, green to starboard) in order. Three courses, four
sea states. Every race in the same conditions runs on the same waves, so your best run races
beside you as a ghost.

## Layout

```
src/game/    the game: boat physics, courses, race logic, HUD, mesh pass, sea probe
src/ocean/   FFT wave cascades, foam, sea surface shading      (open-water)
src/sky/     atmosphere, volumetric clouds                      (open-water)
src/fx/      rain, spray, lightning, post-processing            (open-water)
src/audio/   synthesized sea and wind, recorded rain and thunder (open-water)
tools/       dev server, headless test driver
```

## Credits

The ocean, sky, weather and audio engine is [Open Water](https://github.com/Leonxlnx/open-water)
by Leonxlnx, MIT licensed (see `LICENSE-open-water`). The audio recordings keep their Creative
Commons licenses; see `assets/audio/CREDITS.md`.
