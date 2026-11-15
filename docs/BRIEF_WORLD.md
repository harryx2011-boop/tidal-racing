# Brief: picture and world

The second upgrade. `docs/BRIEF_VISUAL_UPGRADE.md` still applies in full: its shared contracts
(boat space, vertex format, material ids, `BOAT_ANCHORS`, `game.renderBoats()`, the systems
hooks, `app.fx`, determinism) and its rules for builders. Read it first, then this.

## Decisions (the owner's answers; do not reopen)

| Topic | Decision |
| --- | --- |
| Course marks | Realistic navigation buoys on the gates, a start/finish gantry on floats, and inflatable turn pylons at the sharpest corners. |
| Environment | Fixed structures, other vessels, land, and wildlife and small detail. All four. |
| Land | Full coastline: land the course runs along, shallows, beaches, surf on the shore, shallow-water colour. |
| Fix first | Lighting and colour, and the clouds in every condition; then the water around the boat, and the driver and boat close-ups. |
| Time of day | Add sunrise and sunset. No night. |
| Order | Picture first, then world. |
| Performance | Build now, optimise in one pass at the end. Nothing is measured yet. |
| How | Three builders in parallel per wave, a reviewer integrating. |

## Waves

| Wave | Stream | Work |
| --- | --- | --- |
| 1 | G | Lighting, colour grade, exposure; sunrise and sunset |
| 1 | H | Clouds in every condition |
| 1 | I | Navigation buoys, start/finish gantry, turn pylons |
| 2 | J | Water around the boat: wake foam, spray, wet hull |
| 2 | K | Boat close-up detail and the driver |
| 2 | L | Fixed structures and other vessels |
| 3 | M | Land and coastline; courses that use it |
| 3 | N | Wildlife and small detail |
| 4 | reviewer | Optimisation pass, then a real-hardware check by the owner |

Performance is deferred, not ignored: every new system still honours an `app.fx` level or a
distance cut-off, states its cost, and avoids per-frame allocation. The last wave tunes; it
should not have to rewrite.

## What is known to be weak (from the first upgrade)

- The storm cloud deck is speckled and flat. Breeze and rough skies were never compared before
  and after. The warm low-sun tint and silver linings were never rendered. Cirrus is missing
  from the reflection environment and may be too heavy in calm.
- The white hull and upholstery are very bright in full sun (exposure follows the dark sea), and
  some scenes look flat.
- Wake foam and spray look blocky up close.
- The driver is simple shapes. Gauges, cowls and hardware are plain.
- The sea is empty apart from the buoys.

## Working conditions

- Software rendering only. A 640x360 frame takes seconds; 960x540 at the medium tier can take
  half a minute. Three builders render at once, and the container has restarted under load
  before: run one browser at a time, keep stills small, and **commit to your branch every time
  you reach a working state**.
- Leave `PAGE` unset for canvas captures (`PAGE=0` is truthy). `PAGE=1` captures the HUD too.
- Review stills go under
  `/tmp/claude-0/-home-user-tidal-racing/004924be-ad0d-5479-9073-3ce39052a876/scratchpad/review2/<letter>/`.
- Stop your own server when you finish (`kill` the process id you started).
