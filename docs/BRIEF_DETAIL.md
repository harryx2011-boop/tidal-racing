# Brief: detail everywhere

The third upgrade. `docs/BRIEF_VISUAL_UPGRADE.md` (shared contracts and rules for builders) and
`docs/BRIEF_WORLD.md` (working conditions) still apply in full. Read both first, then this.

## Why

The owner looked at stills of the finished world upgrade and said: "Everything needs more detail."
The world has the right things in it, but most of them are plain: houses are boxes, people are
blocks, breakwater stones are cubes, there are no trees, the storm sky is flat, and the land is
100 m or more from every racing line, so what detail there is is seen as a far band.

## Decisions (the owner's answers; do not reopen)

| Topic | Decision |
| --- | --- |
| Where | All four areas: land and coast; vessels, structures and people; sea and shore; sky and clouds. |
| Courses | Bring them close to the coast: race past piers, rocks, cliffs and moored boats at 20 to 40 m. Best times reset again. |
| Fidelity work | Built by the strongest model. Each fidelity stream is rebuilt in rounds against an independent judge until it passes. |
| Game code | Courses, collisions, optimisation, performance, bug fixes and testing are separate builders. |
| Target | RTX 2070 Super, 1080p, 60 fps. Still unmeasured: nothing has run on a real GPU. |

## Streams

| Wave | Stream | Kind | Work |
| --- | --- | --- | --- |
| A | O | game code | Courses close to the coast; coast features; collisions against the new layout |
| A | Q | fidelity | Vessels, structures, marks and people |
| A | S | fidelity | Sky and clouds |
| B | P | fidelity | Land and coast: trees, rocks, buildings, harbour, piers, cliffs |
| B | R | fidelity | Sea and shore: near-boat wave detail, surf, foam, far wake |
| B | U | game code | Optimisation, bug fixes, tests |

### Contract between O and P: coast features

`src/game/models/coast.js` gains, per course, a plain-data list that P's detail reads:

```js
features: [
  { kind: 'harbour', x, z, yaw, w, d },      // a quay front of width w facing yaw, depth d inland
  { kind: 'pier', x, z, yaw, len, w },       // from its root on the shore out along yaw
  { kind: 'moorings', x, z, r, n },          // n moored small craft within r
  { kind: 'rocks', x, z, r, n },             // a field of boulders and skerries breaking the surface
  { kind: 'stack', x, z, r, h },             // a sea stack
]
```

O places them (with colliders, and checked by `tools/check-land.mjs`) so the racing line passes
20 to 40 m from several per lap. Until P lands, O draws nothing for them beyond what exists; P
gives them their look and must not move them.

## What "detail" means here

Judge every surface at three distances: close (under 15 m), middle (15 to 150 m), far (beyond).

- **Shape.** No bare primitives. A house has a roof with eaves, a chimney, windows with frames
  and sills, a door, a base course; a stone is an irregular lump, not a cube; a person has a
  head, neck, shoulders, bent limbs, hands and feet, and a pose.
- **Breakup.** Large surfaces carry seams, panels, fittings, stains, wear, fixings: hull plates
  and rust streaks on the ship, weed and wet bands on piles, tyres and ladders on a quay.
- **Variety.** Repeated things differ: several house types and colours, several tree shapes,
  several stone shapes, crews in different poses and clothes.
- **Clutter.** The small things that make a place read as used: bollards, lamp posts, nets, pots,
  crates, railings, signs, dinghies on a beach, washing lines, fenders, coiled rope.
- **Integration.** Everything sits in the same light, haze and fog as the sea, casts or fakes
  a contact shadow, and meets the water with a wet band or foam.

Detail must survive distance: build levels of detail so the far version keeps the silhouette and
colour of the near one, and fade fine patterns out before they shimmer.

## Budgets (unmeasured guidance, not limits to hit)

- Repeat with instancing or one merged mesh per kind; never one draw per small object.
- Every model has levels of detail; every system culls by view and distance and honours `app.fx`.
- Whole world in view at the high tier: aim under 1.5 million triangles and 400 draws.
- State your cost in the report: triangles and draws in a typical view, textures and taps added.

## The judge loop (fidelity streams)

1. The builder builds, renders its own stills, commits to its branch and reports.
2. An independent judge, who has not seen the builder's reasoning, renders its own fixed shots
   from the builder's worktree (the builder is idle then, so still one browser per stream) and
   scores each shot 1 to 10 on shape, surface detail, variety, integration and artefacts, against
   what a photograph of the real thing would show. It returns the five worst defects, most
   important first, each tied to a shot.
3. Pass is every score at 7 or more and nothing that reads as a placeholder. Otherwise the
   builder gets the verdict and rebuilds. At most three rounds; what is left goes to the
   reviewer and is reported to the owner as unfinished.

Stills for judging are rendered at 1280x720 on the medium tier (`q=medium&scale=1`): a frame
takes a minute or more in software, so render few and one at a time. Cheap iteration stills can
stay at 800x450 low.

## Rules (in addition to the earlier briefs)

- Stay inside your files. If you need a hook in another stream's file, make it one line and
  list it in your report.
- Do not commit stills. Do not push. Do not open a pull request. Commit to your branch every
  time you reach a working state.
- Report honestly: what you rendered and looked at, what you did not, what still looks wrong.
