// Where the land is, per course: closed polygons of land (metres, x east, z south) that landfield.js turns
// into a height field. A shape's `cliff` is how much of its coast is cliff rather than beach (0..1),
// `plateau` the height of the flat land behind the shore, `relief` the hills far inland, `cliffH` the
// height of a cliff top, `shelf` how fast the water deepens off a beach (1 the old shelving shore, more is
// steep-to). `pads` level a knoll for a structure (the lighthouse). Plain data: every player gets the same coast.
//
// The racing line hugs the coast: it runs 20 to 40 m from quays, cliffs, piers, rocks and moored boats.
// So every shore the line passes is steep-to (cliff near 1 or a high `shelf`): deep water right up to
// the land. The line itself keeps at least 5 m under it, checked by tools/check-land.mjs, which also reports how
// much of a lap runs close to land or a feature. A shape that must keep a straight edge (a quay) has round 0 and
// little warp.

// the mainland far beyond the race: huge polygons, so their coast is only ever a hazy line of hills
const BIG = 24000;
// a lump of rock as a polygon: n points round (x, z), radius r give or take a third
const ring = (x, z, r, n = 9, k = 0) => Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2, q = r * (0.86 + 0.28 * Math.abs(Math.sin(i * 2.3 + k))); return [x + Math.cos(a) * q, z + Math.sin(a) * q]; });
// a stack: a sheer pillar of rock standing in the sea, under the `stack` feature of the same place
const stackShape = (x, z, r, h, seed) => ({ cliff: 1, plateau: 0, relief: 0, cliffH: h, seed, round: 1, warp: 0.1, pts: ring(x, z, r, 10, seed) });
// a quay apron: land with a straight, near-vertical edge along z1 (the water side), flaring `flare` m at each end
// toward z0 where it joins the mainland, so it reads as made ground and not as a rectangle
const quayShape = (x0, z0, x1, z1, seed, plateau = 0, flare = 0) => ({ cliff: 1, plateau, relief: 0, cliffH: 2.4, seed, round: 0, warp: 0.05, pts: [[x0 - flare, z0], [x1 + flare, z0], [x1, z1], [x0, z1]] });

export const COASTS = {
  // Breakwater Circuit: a harbour front and a pier on a northern shore, the breakwater running out to its head, a
  // cliffy headland and its lighthouse to the east, a rock and a skerry field to the west and a rocky island
  // to the south, with a narrow channel between them. Clockwise from the harbour front.
  circuit: {
    rect: [-1400, -1290, 1672, 1782],
    texel: 3,
    pads: [{ x: 700, z: 46, r: 24, h: 6 }],
    village: { x: 160, z: -262, w: 540, d: 80, n: 16, min: 3.4, max: 16 },
    shapes: [
      { // the northern, eastern and western mainland round the bay
        cliff: 0.3, plateau: 12, relief: 230, seed: 1,
        pts: [[-BIG, -BIG], [BIG, -BIG], [BIG, 9000], [3000, 5000], [1300, 2200], [960, 1500], [850, 900], [830, 500], [840, 200], [850, 60], [840, -80], [800, -150], [720, -185], [560, -200], [380, -190], [200, -180], [30, -190], [-150, -200], [-330, -215], [-470, -190], [-540, -90], [-565, 60], [-550, 300], [-590, 520], [-700, 720], [-900, 850], [-1500, 950], [-3000, 900], [-BIG, 1100]],
        round: 1,
      },
      quayShape(100, -215, 280, -46, 7, 0, 30),   // the harbour front
      { // the lighthouse headland, all cliff, its west foot 30 m from the line
        cliff: 0.95, plateau: 0, relief: 0, cliffH: 8, seed: 2, round: 2,
        pts: [[900, -70], [800, -82], [730, -62], [664, 0], [648, 52], [670, 104], [780, 124], [900, 150]],
      },
      { // the rock, hugging the west leg and the channel
        cliff: 0.95, plateau: 12, relief: 6, cliffH: 16, seed: 3, round: 2,
        pts: [[-190, 350], [-150, 300], [-70, 290], [0, 325], [20, 400], [-15, 480], [-90, 522], [-170, 495], [-215, 430]],
      },
      stackShape(-298, 330, 12, 15, 4),    // a stack off the west leg
      { cliff: 1, plateau: 0, relief: 0, cliffH: 3, seed: 41, round: 1, warp: 0.2, pts: ring(-306, 208, 9, 8, 1) },    // skerries
      { cliff: 1, plateau: 0, relief: 0, cliffH: 2.6, seed: 42, round: 1, warp: 0.2, pts: ring(-322, 440, 8, 8, 2) },
      { // the rocky island to the south, its north shore the other side of the channel
        cliff: 0.7, shelf: 3, plateau: 4, relief: 0, cliffH: 6, seed: 5, round: 2,
        pts: [[-480, 640], [-300, 612], [100, 608], [450, 628], [700, 670], [560, 715], [100, 700], [-350, 710], [-500, 690]],
      },
      { // the far south mainland
        cliff: 0.3, plateau: 14, relief: 160, seed: 6, round: 1,
        pts: [[-BIG, 1900], [-3000, 1800], [0, 1700], [3000, 1800], [BIG, 2100], [BIG, BIG], [-BIG, BIG]],
      },
    ],
    features: [
      { kind: 'harbour', x: 190, z: -46, yaw: Math.PI / 2, w: 180, d: 100 },
      { kind: 'pier', x: -112, z: -205, yaw: Math.PI / 2, len: 165, w: 6 },
      { kind: 'moorings', x: 332, z: -64, r: 14, n: 7 },
      { kind: 'rocks', x: 668, z: 330, r: 22, n: 8 },
      { kind: 'rocks', x: -330, z: 258, r: 22, n: 6 },
      { kind: 'rocks', x: -338, z: 470, r: 18, n: 5 },
      { kind: 'stack', x: -298, z: 330, r: 12, h: 15 },
    ],
  },

  // Long Reach: a passage between a cliffy northern mainland and a chain of islands, from a sheltered beach
  // in the west to a harbour and a lighthouse in the east. The line passes two cliffs, runs along the north
  // shores of the islands and finishes along a quay.
  sprint: {
    rect: [-1200, -1536, 5968, 1536],
    texel: 4,
    pads: [{ x: 4560, z: -300, r: 26, h: 6 }],
    village: { x: 5020, z: -170, w: 300, d: 120, n: 14, min: 3.4, max: 16 },
    shapes: [
      { // the northern mainland, with the beach at the start round to the west
        cliff: 0.45, shelf: 2.5, plateau: 12, relief: 260, seed: 11, round: 1,
        pts: [[-BIG, -BIG], [BIG, -BIG], [BIG, -1200], [6600, -1100], [5900, -800], [5500, -470], [5300, -300], [5200, -150], [5120, -66], [5000, -70], [4800, -70], [4650, -62], [4500, -250], [4150, -395], [3800, -430], [3500, -400], [3150, -520], [2800, -440], [2500, -420], [2200, -415], [1900, -390], [1700, -330], [1600, -330], [1480, -400], [1250, -470], [1000, -520], [700, -540], [430, -540], [200, -480], [60, -400], [-140, -330], [-380, -260], [-520, -120], [-570, 100], [-600, 330], [-720, 560], [-1000, 800], [-1500, 1300], [-BIG, 1500]],
      },
      { // the first cliff, a headland whose foot the line passes
        cliff: 1, plateau: 14, relief: 30, cliffH: 36, seed: 31, round: 1,
        pts: [[800, -600], [860, -300], [930, -185], [1020, -150], [1110, -200], [1160, -330], [1200, -600]],
      },
      { // the second cliff, near the harbour
        cliff: 1, plateau: 14, relief: 30, cliffH: 30, seed: 32, round: 1,
        pts: [[3900, -600], [3960, -250], [4030, -70], [4110, -5], [4200, -80], [4260, -600]],
      },
      quayShape(4700, -200, 5060, 26, 33, 0, 60),   // the harbour front at the finish
      { // the lighthouse headland by the harbour
        cliff: 0.9, plateau: 0, relief: 0, cliffH: 9, seed: 12, round: 2,
        pts: [[4650, -400], [4520, -300], [4510, -230], [4600, -190], [4720, -200], [4850, -380]],
      },
      { // the island chain, west to east; each is steep-to on the side the line passes
        cliff: 0.9, shelf: 2.5, plateau: 10, relief: 6, cliffH: 14, seed: 13, round: 2,
        pts: [[480, 470], [650, 400], [900, 395], [1080, 450], [1050, 540], [820, 580], [560, 560]],
      },
      {
        cliff: 0.95, shelf: 2.5, plateau: 12, relief: 10, cliffH: 18, seed: 14, round: 2,
        pts: [[1640, 360], [1900, 322], [2250, 326], [2420, 400], [2300, 520], [1950, 560], [1700, 500]],
      },
      {
        cliff: 0.95, shelf: 2.5, plateau: 10, relief: 8, cliffH: 16, seed: 15, round: 2,
        pts: [[2850, 470], [3050, 362], [3300, 360], [3560, 430], [3480, 540], [3200, 580], [2950, 560]],
      },
      stackShape(880, -70, 11, 22, 34),
      stackShape(3765, 92, 10, 18, 35),
      { // the south mainland, a long way off
        cliff: 0.3, plateau: 14, relief: 200, seed: 16, round: 1,
        pts: [[-BIG, 1600], [-2000, 1500], [0, 1350], [1500, 1280], [3000, 1300], [4500, 1250], [6000, 1400], [BIG, 1700], [BIG, BIG], [-BIG, BIG]],
      },
    ],
    features: [
      { kind: 'stack', x: 880, z: -70, r: 11, h: 22 },
      { kind: 'rocks', x: 1404, z: 62, r: 14, n: 7 },
      { kind: 'rocks', x: 2530, z: 370, r: 18, n: 6 },
      { kind: 'stack', x: 3765, z: 92, r: 10, h: 18 },
      { kind: 'rocks', x: 3500, z: 206, r: 16, n: 6 },
      { kind: 'pier', x: 4658, z: -84, yaw: 1.35, len: 120, w: 6 },
      { kind: 'moorings', x: 4590, z: 12, r: 14, n: 6 },
      { kind: 'harbour', x: 4880, z: 26, yaw: Math.PI / 2, w: 360, d: 140 },
    ],
  },

  // Tidal Speedway: a quay along the north straight, the south straight in a channel between a sandbar and
  // a steep barrier beach, a headland at the east turn and a stack at the west, dunes and hills to the north.
  oval: {
    rect: [-1536, -1376, 1536, 1696],
    texel: 3,
    pads: [],
    village: { x: 100, z: 420, w: 900, d: 40, n: 12, min: 2.0, max: 8 },
    shapes: [
      { // the northern shore and the headland at the east end
        cliff: 0.3, plateau: 10, relief: 200, seed: 21, round: 1,
        pts: [[-BIG, -BIG], [BIG, -BIG], [BIG, 3500], [2600, 1500], [1500, 700], [1180, 520], [1060, 330], [1090, 100], [1040, -120], [900, -290], [650, -380], [300, -400], [-100, -380], [-500, -400], [-850, -360], [-1050, -200], [-1150, 20], [-1180, 300], [-1300, 520], [-1700, 650], [-4000, 900], [-BIG, 1300]],
      },
      quayShape(-160, -400, 330, -36, 27, 7, 90),   // the quay along the north straight
      { // the eastern headland, cliff, at the east turn
        cliff: 0.95, plateau: 0, relief: 0, cliffH: 14, seed: 22, round: 2,
        pts: [[740, 420], [640, 330], [612, 220], [614, 90], [642, 20], [770, -10], [870, 120]],
      },
      { // the sandbar in the infield, beside the south straight
        cliff: 0.0, shelf: 8, warp: 0.4, plateau: 0, relief: 0, cliffH: 3, seed: 23, round: 2,
        pts: [[-290, 232], [-200, 210], [0, 204], [200, 212], [290, 234], [200, 258], [0, 264], [-200, 256]],
      },
      { // the barrier beach to the south, long and low, steep-to on its lagoon side
        cliff: 0.0, shelf: 8, warp: 0.3, plateau: 2, relief: 0, cliffH: 3, seed: 24, round: 2,
        pts: [[-2300, 380], [-1000, 352], [0, 346], [1000, 354], [2300, 392], [2300, 520], [1000, 480], [0, 470], [-1000, 490], [-2300, 520]],
      },
      stackShape(-622, 112, 11, 14, 28),
      { // the mainland far to the south
        cliff: 0.3, plateau: 12, relief: 180, seed: 25, round: 1,
        pts: [[-BIG, 2300], [-3000, 2100], [0, 1900], [3000, 2050], [BIG, 2400], [BIG, BIG], [-BIG, BIG]],
      },
    ],
    features: [
      { kind: 'harbour', x: 85, z: -36, yaw: Math.PI / 2, w: 490, d: 100 },
      { kind: 'pier', x: 220, z: -80, yaw: Math.PI / 2, len: 56, w: 6 },
      { kind: 'moorings', x: -232, z: -52, r: 14, n: 7 },
      { kind: 'pier', x: -210, z: 368, yaw: -Math.PI / 2, len: 40, w: 5 },
      { kind: 'stack', x: -622, z: 112, r: 11, h: 14 },
      { kind: 'rocks', x: -630, z: 215, r: 16, n: 6 },
    ],
  },
};

// ---- features ----
// Per course, `features` is plain data that the detail work reads and collide.js makes solid:
//   { kind: 'harbour', x, z, yaw, w, d }   the middle of a quay's water edge; yaw is the way it faces, toward the
//                                          water ((cos yaw, sin yaw) in x, z); w along the edge, d inland
//   { kind: 'pier', x, z, yaw, len, w }    root on the shore at (x, z), out along yaw for len metres, w wide
//   { kind: 'moorings', x, z, r, n }       n moored small craft inside r: spots from mooringSpots
//   { kind: 'rocks', x, z, r, n }          n boulders inside r: spots and sizes from rockSpots
//   { kind: 'stack', x, z, r, h }          a sea stack of radius r, h high (the land field has a pillar there)
// mooringSpots and rockSpots are the one place a mooring or a boulder is positioned, so a drawing of them and
// the colliders agree. Both are pure functions of the feature.
const fhash = (a, b, c) => { let h = Math.imul(Math.round(a) | 0, 374761393) ^ Math.imul(Math.round(b) | 0, 668265263) ^ Math.imul(c | 0, 1274126177); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
// n points spread evenly inside r (a sunflower spiral, turned and nudged by the feature's place)
function spread(f, nudge) {
  const out = [], a0 = fhash(f.x, f.z, 1) * Math.PI * 2;
  for (let i = 0; i < f.n; i++) {
    const rr = f.r * Math.sqrt((i + 0.5) / f.n), a = a0 + i * 2.39996;
    const j = 1 - nudge * 0.5 + nudge * fhash(f.x + i * 7, f.z - i * 3, 2);
    out.push([f.x + Math.cos(a) * rr * j, f.z + Math.sin(a) * rr * j, i]);
  }
  return out;
}
export const MOORING_R = 2.6;
export function mooringSpots(f) {
  return spread(f, 0.25).map(([x, z, i]) => ({ x, z, yaw: fhash(f.x, f.z, 3) * 0.6 + i * 0.07 - 0.3, r: MOORING_R }));
}
// boulders: radius 1.2 to 4.2 m, the larger toward the middle
export function rockSpots(f) {
  return spread(f, 0.5).map(([x, z, i]) => ({ x, z, r: 1.2 + 3 * fhash(f.x, f.z, 10 + i) * (1 - 0.5 * i / f.n) }));
}
const cache = new Map();
// the solids of a course's features, as collide.js reads them: circles { x, z, r, kind } and boxes { x, z, hx, hz, yaw, kind }
export function featureColliders(id) {
  let c = cache.get(id);
  if (c) return c;
  c = [];
  for (const f of (COASTS[id] && COASTS[id].features) || []) {
    if (f.kind === 'pier') { const cs = Math.cos(f.yaw), sn = Math.sin(f.yaw); c.push({ kind: 'pier', x: f.x + cs * f.len / 2, z: f.z + sn * f.len / 2, hx: f.len / 2, hz: f.w / 2, yaw: f.yaw }); }
    else if (f.kind === 'stack') c.push({ kind: 'stack', x: f.x, z: f.z, r: f.r });
    else if (f.kind === 'rocks') for (const s of rockSpots(f)) c.push({ kind: 'rock', x: s.x, z: s.z, r: s.r });
    else if (f.kind === 'moorings') for (const s of mooringSpots(f)) c.push({ kind: 'mooring', x: s.x, z: s.z, r: s.r });
  }
  cache.set(id, c);
  return c;
}
