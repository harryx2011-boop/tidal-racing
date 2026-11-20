// Everything the coastal system puts on a course, as a plan: plain data, a pure function of the course, with no
// GL in it (tools/check-land.mjs reads the same plan to check that nothing stands in the water or on a pier).
//   quays, piers, slips   measured from the height field (models/harbour.js)
//   buildings             the harbour rows, the village, boathouses, farms (models/village.js), in groups
//   rocks, cliffs         loose blocks under steep ground near the line, and the tiles of cliff that are rebuilt
//                         as bedded rock (models/rocks.js)
//   trees                 every tree and bush (models/trees.js)
//   moorings              a small craft and its buoy at each mooring spot of the course's features
import { COASTS, mooringSpots, rockSpots } from './coast.js';
import { landFor } from '../landfield.js';
import { planQuay, planPier, findSlip } from './harbour.js';
import { placeBuildings } from './village.js';
import { placeRocks, placeCliffs } from './rocks.js';
import { plantTrees } from './trees.js';
import { hash1 } from './kit.js';

const cache = new Map();
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
export function planCoast(course) {
  let P = cache.get(course.id);
  if (P) return P;
  const t0 = now(), field = landFor(course.id), def = COASTS[course.id], feats = def.features || [];
  const seed = course.id.length * 7 + course.id.charCodeAt(0);
  // the racing line, as segments
  const gs = course.gates, segs = [];
  for (let i = 0; i < (course.loop ? gs.length : gs.length - 1); i++) { const a = gs[i].c, b = gs[(i + 1) % gs.length].c; segs.push([a[0], a[1], b[0], b[1]]); }
  const quays = feats.filter((f) => f.kind === 'harbour').map((f) => planQuay(field, def, f, course.id));
  const piers = feats.filter((f) => f.kind === 'pier').map((f) => planPier(field, f, quays));
  const slips = quays.map((q) => findSlip(field, q)).filter(Boolean);
  const buildings = placeBuildings(field, def, quays, piers, slips, segs, seed);
  const t1 = now();
  const rocks = placeRocks(field, segs), cliffs = placeCliffs(field, segs);
  const t2 = now();
  const avoid = buildings.map((b) => ({ x: b.x, z: b.z, r: b.r * 0.92, house: b.type !== 'barn' && b.type !== 'shed' }));
  for (const s of slips) for (let t = -8; t <= s.len; t += 4) avoid.push({ x: s.x + s.dx * t, z: s.z + s.dz * t, r: 6 });
  const trees = plantTrees(field, segs, avoid, quays, piers);
  const t3 = now();
  // moored craft: a kind and a seed for each spot; the buoy lies ahead of the bow
  const moorings = [];
  for (const f of feats) if (f.kind === 'moorings') mooringSpots(f).forEach((s, i) => {
    // (a mixed mooring: mostly open boats and day boats, a rib or two)
    const h = hash1(Math.round(s.x * 3), Math.round(s.z * 3) + i), kind = ['open', 'day', 'open', 'rib', 'day', 'open', 'day', 'open', 'rib'][(i + Math.floor(hash1(Math.round(f.x), Math.round(f.z)) * 9)) % 9], len = kind === 'open' ? 4.4 : kind === 'day' ? 5.7 : 6.8;
    moorings.push({ x: s.x, z: s.z, yaw: s.yaw, kind, seed: 1 + Math.floor(h * 97) + i, crew: h > 0.3 && h < 0.4 ? 1 : 0, buoy: { x: s.x + Math.cos(s.yaw) * (len / 2 + 1.4), z: s.z + Math.sin(s.yaw) * (len / 2 + 1.4), seed: i } });
  });
  P = {
    id: course.id, field, def, segs, quays, piers, slips, buildings, rocks, cliffs, trees, moorings,
    stacks: feats.filter((f) => f.kind === 'stack'), rockFields: feats.filter((f) => f.kind === 'rocks').map((f) => ({ f, spots: rockSpots(f) })),
    ms: { layout: t1 - t0, rocks: t2 - t1, trees: t3 - t2, total: t3 - t0 },
  };
  cache.set(course.id, P);
  return P;
}
