// Where the land is, per course: closed polygons of land (metres, x east, z south) that landfield.js turns
// into a height field. A shape's `cliff` is how much of its coast is cliff rather than beach (0..1),
// `plateau` the height of the flat land behind the shore, `relief` the hills far inland, `cliffH` the
// height of a cliff top. `pads` level a knoll for a structure (the lighthouse). Plain data: every player
// gets the same coast.
//
// Everything the racing line touches is kept in deep water by the layouts below and checked by
// tools/check-land (see the report): gates in at least 6 m of water with 25 m clear either side of the
// racing width, legs and start positions likewise.

// the mainland far beyond the race: huge polygons, so their coast is only ever a hazy line of hills
const BIG = 24000;

export const COASTS = {
  // Breakwater Circuit: a harbour bay on a northern shore with the wall running out from the beach, a
  // cliffy headland and its lighthouse to the east, a rock in the middle of the loop, open sea to the west.
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
      { // the lighthouse headland, all cliff
        cliff: 0.95, plateau: 0, relief: 0, cliffH: 8, seed: 2, round: 2,
        pts: [[900, -70], [800, -82], [730, -62], [662, 0], [650, 52], [685, 100], [780, 124], [900, 150]],
      },
      { // a rock in the middle of the loop
        cliff: 0.6, plateau: 12, relief: 6, cliffH: 16, seed: 3, round: 2,
        pts: [[30, 200], [80, 150], [160, 140], [230, 175], [250, 250], [215, 330], [140, 372], [60, 345], [20, 280]],
      },
      { // a stack and skerries off the west shore
        cliff: 0.9, plateau: 4, relief: 0, cliffH: 14, seed: 4, round: 2,
        pts: [[-470, 330], [-440, 310], [-400, 325], [-392, 370], [-420, 395], [-465, 375]],
      },
      { // a long shingle island to the south
        cliff: 0.1, plateau: 4, relief: 0, cliffH: 6, seed: 5, round: 2,
        pts: [[-480, 690], [-300, 662], [100, 672], [450, 685], [700, 720], [560, 765], [100, 748], [-350, 755], [-500, 730]],
      },
      { // the far south mainland
        cliff: 0.3, plateau: 14, relief: 160, seed: 6, round: 1,
        pts: [[-BIG, 1900], [-3000, 1800], [0, 1700], [3000, 1800], [BIG, 2100], [BIG, BIG], [-BIG, BIG]],
      },
    ],
  },

  // Long Reach: a passage between a cliffy northern mainland and a chain of islands, from a sheltered beach
  // in the west to a harbour and a lighthouse in the east.
  sprint: {
    rect: [-1200, -1536, 5968, 1536],
    texel: 4,
    pads: [{ x: 4560, z: -300, r: 26, h: 6 }],
    village: { x: 5020, z: -110, w: 300, d: 120, n: 14, min: 3.4, max: 16 },
    shapes: [
      { // the northern mainland, with the beach at the start round to the west
        cliff: 0.45, plateau: 12, relief: 260, seed: 11, round: 1,
        pts: [[-BIG, -BIG], [BIG, -BIG], [BIG, -1200], [6600, -1100], [5900, -800], [5500, -470], [5300, -300], [5200, -150], [5120, -60], [5000, 20], [4800, 20], [4650, -50], [4500, -250], [4150, -395], [3800, -430], [3500, -400], [3150, -520], [2800, -440], [2500, -420], [2200, -415], [1900, -390], [1700, -330], [1600, -330], [1480, -400], [1250, -470], [1000, -520], [700, -540], [430, -540], [200, -480], [60, -400], [-140, -330], [-380, -260], [-520, -120], [-570, 100], [-600, 330], [-720, 560], [-1000, 800], [-1500, 1300], [-BIG, 1500]],
      },
      { // the lighthouse headland by the harbour
        cliff: 0.9, plateau: 0, relief: 0, cliffH: 9, seed: 12, round: 2,
        pts: [[4650, -400], [4520, -300], [4510, -230], [4600, -190], [4720, -200], [4850, -380]],
      },
      { // the island chain, west to east
        cliff: 0.55, plateau: 10, relief: 6, cliffH: 14, seed: 13, round: 2,
        pts: [[480, 470], [650, 400], [900, 395], [1080, 450], [1050, 540], [820, 580], [560, 560]],
      },
      {
        cliff: 0.7, plateau: 12, relief: 10, cliffH: 18, seed: 14, round: 2,
        pts: [[1640, 380], [1900, 330], [2250, 340], [2420, 410], [2300, 520], [1950, 560], [1700, 500]],
      },
      {
        cliff: 0.7, plateau: 10, relief: 8, cliffH: 16, seed: 15, round: 2,
        pts: [[2850, 470], [3050, 360], [3300, 360], [3560, 430], [3480, 540], [3200, 580], [2950, 560]],
      },
      { // the south mainland, a long way off
        cliff: 0.3, plateau: 14, relief: 200, seed: 16, round: 1,
        pts: [[-BIG, 1600], [-2000, 1500], [0, 1350], [1500, 1280], [3000, 1300], [4500, 1250], [6000, 1400], [BIG, 1700], [BIG, BIG], [-BIG, BIG]],
      },
    ],
  },

  // Tidal Speedway: a wide lagoon behind a barrier beach, a sandbar in the infield, dunes and hills to the
  // north, a headland to the east, a beach and village to the west.
  oval: {
    rect: [-1536, -1376, 1536, 1696],
    texel: 3,
    pads: [],
    village: { x: 100, z: 612, w: 900, d: 40, n: 12, min: 2.0, max: 8 },
    shapes: [
      { // the northern shore and the headland at the east end
        cliff: 0.3, plateau: 10, relief: 200, seed: 21, round: 1,
        pts: [[-BIG, -BIG], [BIG, -BIG], [BIG, 3500], [2600, 1500], [1500, 700], [1180, 520], [1060, 330], [1090, 100], [1040, -120], [900, -290], [650, -380], [300, -400], [-100, -380], [-500, -400], [-850, -360], [-1050, -200], [-1150, 20], [-1180, 300], [-1300, 520], [-1700, 650], [-4000, 900], [-BIG, 1300]],
      },
      { // the eastern headland, cliff
        cliff: 0.9, plateau: 0, relief: 0, cliffH: 14, seed: 22, round: 2,
        pts: [[1100, 380], [1040, 330], [1010, 200], [1030, 60], [1090, 0], [1200, 50], [1250, 300]],
      },
      { // the sandbar in the infield
        cliff: 0.0, plateau: 0, relief: 0, cliffH: 3, seed: 23, round: 2,
        pts: [[-290, 160], [-200, 136], [0, 130], [200, 138], [290, 160], [200, 184], [0, 190], [-200, 182]],
      },
      { // the barrier beach to the south, long and low
        cliff: 0.0, plateau: 2, relief: 0, cliffH: 3, seed: 24, round: 2,
        pts: [[-2300, 620], [-1000, 560], [0, 540], [1000, 570], [2300, 640], [2300, 740], [1000, 690], [0, 670], [-1000, 700], [-2300, 760]],
      },
      { // the mainland far to the south
        cliff: 0.3, plateau: 12, relief: 180, seed: 25, round: 1,
        pts: [[-BIG, 2300], [-3000, 2100], [0, 1900], [3000, 2050], [BIG, 2400], [BIG, BIG], [-BIG, BIG]],
      },
    ],
  },
};
