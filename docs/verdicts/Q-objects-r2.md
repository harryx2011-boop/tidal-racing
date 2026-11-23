# Stream Q (vessels, structures, marks, people): judge verdict, round 2

**Verdict: FAIL.** No shot reaches 7 on every criterion. Round 2 is a real step up: hulls float at their waterlines, the banner and lit windows are right, the lighthouse is seated. What still fails is close-range figures, missing cast shadows, hulls pasted onto calm water, a few placeholder primitives, and lamp discs in storms.

Worktree judged: `/home/user/wt/Q-objects` (not modified). All seven judged stills are 1280x720, `q=medium&scale=1`, course `circuit`, camera field of view 50 degrees (the game's resting value).

## Shots

All paths are under `/tmp/claude-0/-home-user-tidal-racing/a31e5a31-6cd0-5b81-a9f4-b9e9d9bad626/scratchpad/review3/Q-objects/`.

| # | File | Conditions | What it shows |
| --- | --- | --- | --- |
| 1 | `r2-1-people-committee.png` | calm | Committee boat aft deck from astern: three crew at 4 to 7 m, three more on the flybridge at 12 m, wheelhouse aft face, two inflatable marks, rails, mast stays |
| 2 | `r2-2-rib-waterline.png` | calm | Safety RIB at (20, 50) from its sunlit quarter at 7 m, camera 1.15 m up: waterline, outboard, console, helmsman |
| 3 | `r2-3-breakwater.png` | calm | Breakwater head from outside the harbour-side rail: crown wall back face, walkway fittings, a figure at 12 m, harbour-side armour, head tower |
| 4 | `r2-4-wires.png` | calm | Yacht at 39 m (shrouds, stays), committee boat at 95 m, start/finish gantry with banner at 100 to 113 m |
| 5 | `r2-5-lighthouse.png` | calm | Lighthouse from 60 m, camera 13 m up so the base and the ground round it show |
| 6 | `r2-6-cargo.png` | calm | Container ship under way, 175 m off |
| 7 | `r2-7-storm-gantry.png` | storm | RIB at 10 m, committee boat at 28 m, gantry and banner at 55 to 85 m, lanterns, lit windows, quay lamps |

Enlarged crops of each are in `crops/`. Framing tests (600x338, low tier, not judged) are in `judge2/t13-*.jpg`.

## Scores (1 to 10, against a photograph of the real thing)

| Shot | Shape | Surface detail | Variety | Integration | Artefacts |
| --- | --- | --- | --- | --- | --- |
| 1 people, committee deck | 6 | 6 | 8 | 5 | 7 |
| 2 RIB at waterline | 6 | 6 | 7 | 6 | 8 |
| 3 breakwater head | 8 | 7 | 8 | 6 | 6 |
| 4 wires, fleet, gantry | 8 | 7 | 8 | 7 | 6 |
| 5 lighthouse | 8 | 8 | 7 | 5 | 6 |
| 6 container ship | 8 | 7 | 8 | 5 | 8 |
| 7 storm gantry | 8 | 7 | 8 | 7 | 6 |

## The five round-1 defects

1. **People are mannequins: partly fixed** (shots 1, 3). Faces now have eyes or sunglasses, nose and mouth; there are caps, helmets, hair, zips, pockets, reflective bands, shoes, and six different poses and outfits on one boat. At 4 m they are still jointed dolls (defect 1 below). A figure's shadow shows on the breakwater deck (shot 3) but none on the boat deck (shot 1).
2. **RIB hovers, hulls ride high, no wet line or foam: partly fixed** (shots 2, 4, 7).
   - Hovering is fixed: the RIB's hull and outboard leg are cut by the water (the model draws 0.34 to 0.69 m), and the yacht, cruiser and committee boat sit at their boot lines.
   - There is still no wet band, foam or reflection at any hull in calm water (shots 2, 6). Foam does show round the pontoons and the committee boat in the storm (shot 7).
3. **Storm banner a white slab, round discs for windows and lamps, glows oversized by day: partly fixed** (shots 7, 4).
   - Banner: fixed. Chequers, both sponsor boards and the lettering read in the storm.
   - Windows: fixed. They are lit rectangular panes in their frames.
   - Day glows: fixed. The gantry lanterns in shot 4 are small.
   - Lamps in the storm are still round discs (defect 5 below).
4. **Thin wires render as dotted lines: partly fixed** (shots 1, 4, 7). Stays at 10 m are clean. The yacht's shrouds at 39 m are unbroken but stippled, alternating light and dark pixels. Tower bracing at 55 to 110 m breaks into a black-and-white speckle; truss lacing reads as a zigzag.
5. **Flat bare surfaces and no cast shadows on close assets: partly fixed** (shots 1, 3).
   - Crown wall: fixed. It has formwork joints, tie holes and mottling.
   - Committee wheelhouse: its aft face is still a near-blank grey box with one dark opening and a ladder.
   - Cruiser cabin: seen only in a low-tier test still (`judge2/t13-C1-cruiser.jpg`), where it has windows, a stripe, a flybridge and fenders. Not judged at medium.
   - Cast shadows: only the walkway figure and the life-ring post cast one. Nothing else does (defect 2 below).
- **Lighthouse buried: fixed** (shot 5). It is seated at +1.4 m on ground at 6.0 m; the plinth stands on a rock apron just proud of the turf. Leftovers are listed under "Smaller" below.

## The five worst remaining defects, most important first

1. **Figures at 4 to 6 m are still jointed dolls (shot 1, crops `1a-people.png`, `1c-deck-feet.png`).** On the committee boat's aft deck the clipboard man is the clearest case.
   - What it looks like:
     - Upper arms are straight cylinders butted against the side of a boxy torso, with a step at the shoulder and another at the elbow.
     - Forearms are separate, fatter cylinders with ring cuffs.
     - Legs are two straight tubes with ring creases at knee and ankle and an open gap at the crotch with a lump showing through.
     - Hands are tiny pale specks on the clipboard.
     - The stance is rigid and symmetric.
   - What it should look like:
     - Shoulders that slope into the sleeve, and sleeves and trouser legs that taper and bend as one surface through elbow and knee.
     - A pelvis that closes the crotch.
     - Hands about 18 cm long with a readable thumb and fingers round what they hold.
     - Weight on one leg, with the head turned.
2. **Nothing but walkway figures casts a shadow (shots 1, 2, 3, 5).**
   - Committee aft deck (shot 1): the figures, the two 2 m inflatable marks, the bollards, rails and wheelhouse leave the pale green deck evenly lit, so everything looks pasted on.
   - RIB (shot 2): the helmsman, console and A-frame cast nothing on the tubes.
   - Breakwater (shot 3): the rail, the head tower and the armour stones cast nothing.
   - Lighthouse (shot 5): a 37 m tower in 30 degree sun casts no shadow on its apron or the turf.
   - What it should look like: the flattened-shadow method already used for walkway figures, extended to boat decks at full length and clipped to the deck, to deck fittings and rails, to the breakwater tower, and to a long soft shadow from the lighthouse along the sun. Add a dark contact patch under anything standing on a deck.
3. **Hulls meet calm water with a hard clean line; the ship under way makes no wave (shots 2, 6; crops `2c-waterline.png`, `6b-bow.png`).**
   - RIB: its white hull strip ends at the sea in a razor edge, with no wet band, no ripple or foam line, and no darkening or reflection on the water beside it.
   - Container ship: it steams at 3.5 m/s with no bow wave, no wash along the hull and no wake. It reads as a cut-out laid on the sea.
   - What it should look like:
     - A darker wet band 5 to 10 cm above the waterline.
     - A thin moving ripple or foam line following the hull, like the rings the beacon and pylon already have.
     - A soft dark patch on the water on the side away from the sun.
     - For the ship: a white feather at the stem, wash along both sides and a pale turbulent wake a few hundred metres astern.
4. **Placeholder primitives and blank faces at close range (shots 1, 2, 3).**
   - Inflatable marks on the committee deck (shot 1): two plain capsules of about ten flat sides with a polygonal outline and nothing on them. They should be smooth (24 or more sides) with lifting strops, a valve, a printed band, lashings to the rail, and a flattened foot.
   - RIB outboard (shot 2, crop `2a-stern.png`): under a good cowling the motor is a white slab tray, a white box mid-section, a white box leg and a grey box bracket on a blank transom plate. It should have a tapered leg with an anti-ventilation plate, a clamp and tilt bracket, steering arm, fuel line and transom drain plugs.
   - RIB console and seat (shot 2): bare white and black boxes. They should have a grab rail, instruments, a seat cushion and a throttle.
   - Committee wheelhouse aft face (shot 1): one grey plane with a black rectangle. It should have a door with frame, handle and coaming, a vent, a cable run, a lamp, a fire-extinguisher box, and rust weeps at the fixings.
   - Fish boxes on the walkway (shot 3): three flat-coloured boxes with no rims, handles or contents.
5. **Lamps in a storm are flat round discs; fine lattice stipples at middle distance (shots 7, 4; crops `7a-committee.png`, `7b-gantry.png`, `7c-rib.png`, `4a-yacht.png`, `4b-gantry.png`).**
   - Lamps:
     - The picture is exposed as grey daylight, yet the RIB's all-round light at 10 m draws as an opaque white ball about 0.6 m across that hides its own post.
     - The committee boat carries three more: masthead, flybridge front-left over the life ring, and right of the sign.
     - The gantry lanterns are flat green and red discs 40 pixels wide.
     - What it should look like: a lamp-sized hot core with a faint halo whose size and strength follow the picture's actual exposure, not the storm's lamp level alone. Under a grey daylight storm the halo should be no more than about twice the lamp.
   - Wires and lattice:
     - Shrouds at 39 m alternate light and dark pixels along their length.
     - Tower bracing at 55 to 110 m turns into salt-and-pepper speckle that will crawl in motion.
     - What it should look like: keep a line at least a pixel wide and fade its opacity with distance rather than letting it drop pixels, or swap the tower bracing for an alpha-textured panel at the middle level of detail.

**Smaller (shot 3, crop `3d-core-ramp.png`):** between the harbour-side kerb and the first armour stones a bare, smooth, dark core slope 1.5 to 2 m wide shows, with one stone visibly hovering over it. It needs smaller stones packed up to the kerb.

**Smaller (shot 5, crop `5a-base.png`):** the lighthouse model was built for a sea rock and its landing is buried on land.
- The stores derrick's jib and tackle poke out of the turf as a floating dark stick about 20 m from the tower.
- The steps and handrail run down into the grass.
- The rock apron is a flat grey disc with a hard edge on the turf.
- When the lighthouse is seated on land, the landing, derrick, lower steps and ladder should be dropped and the apron edge broken into the ground.

## Not rendered or not checked

- **Low tier only (600x338 framing tests, not judged):** the cruiser, the platform, a piled beacon, the turn pylon and an ordinary gate buoy. Nothing there read as a placeholder: beacon and pylon have foam rings, the buoy has a lattice, plate and topmark.
- **Not seen at all:** the breakwater's seaward face and heavy armour; breeze and rough conditions; dusk or dawn and the lighthouse beam; the far levels of detail beyond 113 m (except the committee boat at 95 m); anything in motion (shimmer, level-of-detail pops, flag and wave animation).
- **No second framing pass.** The shared render queue was heavily contended (over two hours of waiting before the first slot), so I rendered one test batch and one judged batch.
- **Method.** All seven judged stills came from one queued `tools/shot.sh` run, with `game.camera` replaced per shot and the player's boat parked at (200, 250). Each cut got 4 sim steps, 2 half-second frames (8 for the storm) and 4 normal frames.
- **Storm exposure.** The half-second frames are needed: auto-exposure adapts over time, and a storm still taken straight after `game.start(..., 'storm')` with a few 1/60 s frames comes out almost black (`judge2/t13-D1-storm.jpg`). Other storm stills taken that way will be under-exposed.
