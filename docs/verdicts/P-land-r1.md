# Stream P (land and coast): judge verdict, round 1

**Verdict: FAIL.** One shot of ten (the chase camera on the racing line) reaches 7 on every criterion. The lowest score is 3, for surface detail on the close tree shot. What works: the village houses, the quay clutter, the pier structure and the shape of the far hills. What fails: boulders that are low-poly shards, cliff and stack faces covered in zigzag and stair-step patterns, moored boats that pass through each other, a shore foam that reads as a sheet of snow, and ground, sand and foliage that fall apart inside about 40 m.

Tree judged: `C:\tidal-racing` as served at `http://localhost:5173` on 2026-11-20 (not modified). All ten judged stills are 1280x720, `q=medium&scale=1`, rendered on the RTX 2070 Super through `tools/drive.mjs`. Fixed shots use a field of view of 50 degrees; the chase shot uses the game's own camera. I did not read the land source; camera positions came from the feature list in `src/game/models/coast.js` and from `land.field.heightAt`.

## Shots

All paths are under `C:\Users\harry\AppData\Local\Temp\tidal\judge\land\`.

| # | File | Course, conditions | What it shows |
| --- | --- | --- | --- |
| 1 | `1-quay-close.png` | circuit, calm, day | Harbour quay wall from 12 to 60 m, camera 3.6 m up at (150, -36) looking north-east: wall, fender piles, tyres, ladder, quay-top clutter, four house types |
| 2 | `2-village-storm.png` | circuit, storm, day | Whole harbour front square-on from 60 to 140 m, camera 6 m up at (175, 15): quay, village, lamps, lit windows, hills behind |
| 3 | `3-pier-close.png` | circuit, calm, day | Pier from 9 to 15 m off its west side at (-123, -58), camera 4.2 m up: piles, bracing, deck, rails, lamp; shore village and hills beyond |
| 4 | `4-boulders-close.png` | circuit, calm, day | West boulder field from inside it at (-339, 247), camera 2.2 m up: nearest boulder at about 10 m, others to 45 m, the stack at 90 m, the rock's cliff and trees at 120 m and more |
| 5 | `5-stack-cliff.png` | sprint, calm, day | Sea stack (880, -70) at 26 m, the first cliff headland at 100 to 150 m behind it, hills beyond |
| 6 | `6-trees-close.png` | circuit, calm, day | On land behind the west beach at (-332, -264), eye 1.8 m: broadleaf trees at 12 to 40 m, conifers at 30 to 60 m, the ground |
| 7 | `7-beach-pier-oval.png` | oval, calm, day | Barrier beach from the lagoon at (-172, 336), camera 2.6 m up: swash, wet sand, the small pier at 30 to 50 m, beach houses at 60 to 150 m |
| 8 | `8-far-hills.png` | sprint, calm, day | Northern mainland from mid-channel at (2600, -100): shore at 350 m, hills from 0.5 to 3 km |
| 9 | `9-moorings.png` | circuit, calm, day | Moorings (332, -64) from 12 to 40 m, camera 2.2 m up: seven moored craft, mooring buoys; beach houses and breakwater behind |
| 10 | `10-chase.png` | circuit, breeze, day | The game's chase camera, autopilot, 33 m/s, boat at (122, -13): quay 25 to 150 m to port, hills ahead |

Enlarged crops of each are in `crops\`. Framing tests (same size and tier, not scored) are in `tests\`; three are cited below as supporting evidence: `tests\b1-village-mid.png` (the village in calm weather at 110 to 270 m), `tests\h2-far-sunset.png` (shot 8 at sunset) and `tests\f5-trees-back.png` (a conifer at 3 m).

## Scores (1 to 10, against a photograph of the real thing)

| Shot | Shape | Surface detail | Variety | Integration | Artefacts |
| --- | --- | --- | --- | --- | --- |
| 1 quay and village, close | 8 | 6 | 8 | 5 | 6 |
| 2 village in a storm, middle | 8 | 7 | 8 | 6 | 6 |
| 3 pier, close | 8 | 6 | 6 | 6 | 6 |
| 4 boulders, close | 4 | 4 | 5 | 4 | 6 |
| 5 stack and cliff | 6 | 5 | 7 | 6 | 4 |
| 6 trees and ground, close | 5 | 3 | 7 | 5 | 4 |
| 7 beach, small pier, houses | 7 | 4 | 7 | 6 | 5 |
| 8 far hills | 8 | 7 | 8 | 6 | 7 |
| 9 moorings | 6 | 6 | 5 | 4 | 4 |
| 10 chase camera at speed | 8 | 7 | 8 | 7 | 7 |

Reads as a placeholder: the boulders (shot 4), the conifers and the ground inside 15 m (shot 6, `crops\6d-conifer-3m.png`), the white launch and the mooring buoys (shot 9), the sand (shot 7).

## What already holds up

- **Houses** (shots 1, 2, 7, 10). Terraces, a gabled stone house, tall black net lofts, a red-roofed shed, a warehouse and a pub with a sign. They have eaves, chimneys with pots, framed windows with sills, doors, gutters and downpipes, and they differ in colour.
- **Quay clutter** (shots 1, 2). Lobster pots with floats, barrels, bins, bollards, boats on trailers, a crane, ladders, hanging tyres, mooring rings, berth numbers, lamp posts, people.
- **Pier structure** (shot 3). Round piles, cross bracing, a planked deck with a kerb, a three-rail handrail, a life ring and lamps.
- **Hill shapes** (shots 3, 8). Ridges, peaks, rock bands, fields, hedgerows and forest give a believable coast at 0.5 km and more.
- **Shallow water colour off the beach** (shot 7) and the wet-sand band above the swash.

## The five worst defects, most important first

1. **Boulders are low-poly shards with nothing at the waterline (shot 4, crops `4a-boulder.png`, `4b-stack.png`).** The racing line passes these at 20 to 40 m.
   - What it looks like:
     - The nearest boulder is a wedge of about twenty flat facets with knife edges and a pointed top. Every facet is a visibly separate plane.
     - The texture is a soft blur of tan stripes stretched across the facets; one stripe ends in a stair-stepped line.
     - The rock meets the sea in a razor line: no dark wet band, no weed or barnacle zone, no foam, no swell washing up it.
     - All the boulders are the same tan and the same shard shape, while the stack and cliff 90 m behind them are pale cream and grey. They do not look like the same rock.
   - What it should look like:
     - Rounded, wave-worn lumps with enough faces (or smooth normals) that no single plane shows, with cracks, ledges and a few broken corners.
     - A dark wet band up to the reach of the swell, with a green-brown weed line and paler barnacle zone above it.
     - A foam ring that moves with the sea, like the one the stack has.
     - The same rock colour and bedding as the nearest cliff, in three or four shapes and sizes.

2. **Cliff and stack faces are covered in zigzag bands, stair-stepped black blocks and loose triangles of light (shot 5, crops `5a-stack-face.png`, `5b-cliff-left.png`, `5c-cliff-right-base.png`).**
   - What it looks like:
     - The headland cliff at 100 to 150 m carries its strata as regular sawtooth chevrons, like a knitted pattern, from end to end.
     - Black notches run down the cliff as columns of stacked rectangles with stepped edges, like blocks in a voxel game. The same stepped terraces show on the hill behind and on the cliffs to the right.
     - On the stack at 26 m the sunlight breaks into separate light and dark triangles, so the face looks like crumpled foil. Its bedding lines are stepped pixel by pixel.
     - The stack's surface is a blur at this distance; there is no crack, pebble band or lichen at a scale under about half a metre.
   - What it should look like:
     - Bedding that runs in long, slightly tilted, uneven layers with breaks and faults, not a repeating zigzag.
     - Gullies and overhangs with soft, irregular outlines; no axis-aligned steps at the size of a height-map cell.
     - Smooth shading across the stack with shadow only where a ledge really overhangs.
     - A second, finer layer of detail (cracks, joints, staining, guano on ledges) that holds inside 30 m.

3. **Moored boats pass through each other and float wrong (shot 9, crops `9a.png`, `9b.png`).** The line passes the moorings at 20 to 40 m.
   - What it looks like:
     - Seven craft 6 to 9 m long are packed into a circle 28 m across. The grey "MARSHAL" RIB cuts through the white launch and the RIB behind it; hulls overlap in three places.
     - The grey RIB rides so high that the underside of its hull shows above the water along its whole length.
     - The white launch is a slab-sided box with a box cabin and sits with its deck almost awash.
     - The mooring buoys are plain white and cream balls with no pick-up ring, no strop and, for most, no line to a boat.
     - There are only two kinds of boat (RIBs and one launch), all power craft. No hull has a wet line, a ripple or a reflection.
   - What it should look like:
     - One boat per buoy with at least a boat length of clear water round each, all lying head to wind.
     - Each hull at its waterline with a wet band and a small moving ripple line.
     - A mix a harbour really has: rowing dinghies, a small yacht or two with bare masts, an open fishing boat, a RIB.
     - Buoys with a ring or a pick-up float and a mooring line to each bow.

4. **Shore foam is a flat white sheet, and built structures meet the water with no wet band (shots 1, 2, 7, 3; crops `1c-wall-foam.png`, `2a-left.png`, `7b-beach-swash.png`, `3a-deck-piles.png`).**
   - What it looks like:
     - In calm weather a smooth, opaque white band 4 to 6 m wide lies along the whole quay wall. It has no bubbles, streaks or holes and reads as a shelf of snow or ice.
     - In the storm the same band is wider and has a straight dark seam across it (shot 2).
     - On the beach the swash is the same featureless white with a ruler-straight seaward edge.
     - The quay wall in calm weather is one flat blue-grey from the water to the coping: no tide mark, no weed, no stain under the ladder or the rings. (In the storm the lower wall does darken.)
     - The pier piles show only a thin dark foot and no weed, barnacles or foam ring.
   - What it should look like:
     - Against a wall in calm water: no foam, or a thin broken line a hand wide. In a breeze or storm: lacy, broken foam with holes, streaked along the wall, that thins out to nothing.
     - On a beach: a thin leading edge, a lace of foam behind it and a wet shine on the sand.
     - On the wall and piles: a dark wet zone, a green weed band at the tide line and rust weeps under the fittings.

5. **Ground, sand and foliage have no detail inside about 40 m (shots 6, 7; crops `6a-broadleaf.png`, `6b-conifers.png`, `6c-ground.png`, `6d-conifer-3m.png`, `7a-houses.png`).** A player cannot stand where shot 6 was taken, so this matters most on the beaches and shore slopes the line passes.
   - What it looks like:
     - The ground under the trees is an out-of-focus wash of green and ochre with dark smears. There is no grass, stone, path edge or leaf litter at any scale.
     - The beach sand is the same: a smooth gradient with long dark smears. There is no ripple, pebble line, wrack line or footprint, and nothing stands on it: no dinghy, net, post or groyne.
     - The beach houses on the oval stand straight on bare sand with no garden wall, road, dune grass or step.
     - Broadleaf crowns are a few large flat cards with straight edges, a blurred mottle and a speckle of missing pixels along every edge. Trunks are plain black forked tubes with no bark or root flare.
     - Conifers are stacked flat sheets with blob-shaped holes; at 3 m a sheet is one green plane.
   - What it should look like:
     - A fine detail layer on turf and sand that holds to within 2 m, with tufts, stones and a strand line on the beach.
     - A few beach objects: pulled-up dinghies, a groyne, a slipway, lobster pots.
     - Crowns built from many small leaf clusters with a broken outline and visible boughs; brown or grey bark; a shadow patch on the ground under each tree.

**Smaller:**

- **Roof shimmer** (shots 1, 10; crops `1a-houses-left.png`, `10a-quay.png`). Lit roof slopes show striped triangles and, further off, a checkerboard speckle. It will crawl in motion.
- **Storm lamps and windows** (shot 2). Every quay lamp is an opaque white disc about 2 m across that hides its lantern, and every lit window is the same blank white rectangle.
- **Pier** (shots 3, 7; crops `3a-deck-piles.png`, `7c-pier.png`). The timber is one flat tan with no grain, bolts or weathering; the middle rails break into dashes; the pier's shadow on the sand has a stair-stepped edge.
- **Far hills** (shot 8; crops `8a-left.png`, `8b-right.png`). Trees stay bright lime balls at 1 km and more, and hills 2 km away are nearly as saturated as those at 500 m, so the coast looks like a model. Trees on ridge lines show as specks floating above the crest (also shot 2).
- **Sun direction.** On the circuit the day sun sits roughly to the north-west (read from the stills, not measured), so the harbour front, which faces south, is in shade from every point on the water (`tests\a1-quay-close.png`).

## Not rendered or not checked

- **Conditions:** rough was not rendered. Breeze appears only in the chase shot and storm only in shot 2. Sunset appears only as a test still (`tests\h2-far-sunset.png`, hills in silhouette, nothing wrong seen); sunrise not at all.
- **Places not seen:** the sprint harbour, pier and moorings; the oval quay, its north pier and moorings; the sprint island chain and second stack; the circuit's south island, skerries and lighthouse headland cliff; the oval sandbar and stack; village buildings from under 15 m on land.
- **Motion:** nothing was judged moving, so shimmer, level-of-detail pops and tree or foam animation are unchecked. The roof and rail patterns above are the likeliest to crawl.
- **Tiers:** medium only.
- **Close trees and ground:** shot 6 is from a spot a player cannot reach. From the water the nearest trees seen were 60 to 120 m away (`tests\f2-trees-close.png`, `tests\f1-trees-mid.png`), where they read as acceptable.
- **Method.** One `tools/drive.mjs` run per still with the profile `%TEMP%\tidal\prof-judge-land`. For fixed shots `game.camera` was replaced and the player's boat parked at (9000, 9000); each still had 34 rendered frames before capture, and the storm had eight half-second frames first. The chase shot ran the autopilot for 300 steps of 1/30 s, then 30 frames.
- **Console.** No `[error]`, `[warning]` or `[pageerror]` line appeared in any run. The first load in the new profile took 111 s.
