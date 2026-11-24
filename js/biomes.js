import { clamp, lerp, smoothstep } from './util.js';

// =====================================================================================
//  Biome layout + configuration.
//
//  The 4 km world is split like this:
//    - FOREST: a disc (noisy edge, ~1 km radius) around the spawn.
//    - THE HANGING WOODS: a dense boundary belt on the forest edge (an overlay, not a sector).
//    - Outside the belt the land is cut into three 120-degree sectors:
//        east  = DESERT                       (implemented)
//        north-west / south-west = RESERVED   (space for the two future biomes; until they
//                                              exist they fall back to the forest generator)
//
//  Everything biome-specific lives in the BIOMES table: which content generator a chunk
//  uses, terrain resolution and the atmosphere (fog, light, sky, ambience). The engine only
//  asks "what are the biome weights here?" and blends configs, so a new biome is a new entry
//  plus a generator function.
// =====================================================================================

export const FOREST_R = 270;           // mean radius of the forest disc (~500 m across inside the belt)
export const RING_HALF = 45;           // half width of the Hanging Woods belt
const BLEND = 0.12;                    // angular blend between outer sectors (radians)

export const SECTORS = [
  { biome: 'desert', center: 0, half: Math.PI / 3 },
  { biome: 'reserved_a', center: (2 * Math.PI) / 3, half: Math.PI / 3 },
  { biome: 'reserved_b', center: (-2 * Math.PI) / 3, half: Math.PI / 3 },
];

const FOREST_ATMO = { fogFarMul: 1, fogNear: 3, fogColor: 0x0b1428, hemi: 2.1, moon: 2.0, exposure: 1.35, stars: 0.8, bigStars: 0, moonScale: 1, mist: 1, grass: 1, wind: 1, sand: 0, darkSectors: 1 };

export const BIOMES = {
  forest: { id: 'forest', name: 'THE DEADWOOD', generator: 'forest', terrainSeg: 40, atmosphere: FOREST_ATMO },
  desert: {
    id: 'desert', name: 'THE ASHEN DESERT', generator: 'desert', terrainSeg: 28,
    atmosphere: { fogFarMul: 3.2, fogNear: 30, fogColor: 0x0c1630, hemi: 1.55, moon: 2.7, exposure: 1.3, stars: 1, bigStars: 1, moonScale: 1.6, mist: 0, grass: 0, wind: 0.7, sand: 1, darkSectors: 0 },
  },
  // future biomes: space is reserved, content falls back to the forest generator for now
  reserved_a: { id: 'reserved_a', name: 'UNCHARTED LANDS', reserved: true, generator: 'forest', terrainSeg: 40, atmosphere: FOREST_ATMO },
  reserved_b: { id: 'reserved_b', name: 'UNCHARTED LANDS', reserved: true, generator: 'forest', terrainSeg: 40, atmosphere: FOREST_ATMO },
};
export const BOUNDARY = {
  id: 'hanging', name: 'THE HANGING WOODS', generator: 'hanging',
  atmosphere: { fogFarMul: 0.3, fogNear: 1, fogColor: 0x040507, hemi: 0.55, moon: 0.4, exposure: 1.25, stars: 0.15, bigStars: 0, moonScale: 1, mist: 2.2, grass: 0.3, wind: 0.6, sand: 0, darkSectors: 0 },
};
export const INDOOR = { fogFarMul: 0.75, fogNear: 2, fogColor: 0x0a0705, hemi: 0.22, moon: 0.0, exposure: 1.35, stars: 0, bigStars: 0, moonScale: 1, mist: 0, grass: 0, wind: 0.15, sand: 0, darkSectors: 0 };

// ---------------------------------------------------------------- geometry of the layout
export const forestEdgeR = (a) => FOREST_R + 18 * Math.sin(3 * a + 0.7) + 10 * Math.sin(7 * a + 2.1);
const angDiff = (a, b) => { let d = a - b; d = Math.atan2(Math.sin(d), Math.cos(d)); return Math.abs(d); };

/** signed distance (metres) from the forest edge: negative = inside the forest */
export function edgeDist(x, z) { return Math.hypot(x, z) - forestEdgeR(Math.atan2(z, x)); }
/** 0..1 how much this point belongs to the Hanging Woods belt */
export function ringWeight(x, z) { return 1 - smoothstep(RING_HALF - 12, RING_HALF + 8, Math.abs(edgeDist(x, z))); }
/** 0..1 outside the forest (the transition happens inside the belt) */
export function outsideWeight(x, z) { return smoothstep(-RING_HALF * 0.2, RING_HALF * 0.9, edgeDist(x, z)); }
function sectorMask(a, s) { return smoothstep(s.half + BLEND, s.half - BLEND, angDiff(a, s.center)); }
/** fast path used by the height function */
export function desertWeight(x, z) {
  const o = outsideWeight(x, z);
  return o <= 0 ? 0 : o * sectorMask(Math.atan2(z, x), SECTORS[0]);
}

/** weights of every biome at a point (sum of sector biomes = 1, hanging is an overlay) */
export function biomeWeights(x, z, out = {}) {
  const o = outsideWeight(x, z), a = Math.atan2(z, x);
  out.forest = 1 - o;
  let rest = o;
  for (let i = 0; i < SECTORS.length; i++) {
    const s = SECTORS[i], m = i === SECTORS.length - 1 ? rest : Math.min(rest, o * sectorMask(a, s));
    out[s.biome] = m; rest -= m;
  }
  out.hanging = ringWeight(x, z);
  return out;
}
export function dominantBiome(x, z) {
  const w = biomeWeights(x, z);
  if (w.hanging > 0.5) return BOUNDARY;
  let best = 'forest', bv = -1;
  for (const k of Object.keys(BIOMES)) if ((w[k] || 0) > bv) { bv = w[k]; best = k; }
  return BIOMES[best];
}

// ---------------------------------------------------------------- Hanging Woods trails
// winding gaps through the belt so crossing is hard but never impossible
const TRAIL_N = 14;
export function trailDist(x, z) {
  const r = Math.hypot(x, z), a = Math.atan2(z, x);
  let m = 1e9;
  for (let k = 0; k < TRAIL_N; k++) {
    const ta = (k / TRAIL_N) * Math.PI * 2 + 0.2 + 0.035 * Math.sin(r * 0.045 + k * 1.7);
    const d = angDiff(a, ta) * r;
    if (d < m) m = d;
  }
  return m;
}

// ---------------------------------------------------------------- atmosphere blending
const _w = {};
const lerpColor = (a, b, t) => {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255, br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(lerp(ar, br, t)) << 16) | (Math.round(lerp(ag, bg, t)) << 8) | Math.round(lerp(ab, bb, t));
};
function mix(acc, atmo, w) {
  for (const k in atmo) {
    if (k === 'fogColor') { acc._col.r += ((atmo[k] >> 16) & 255) * w; acc._col.g += ((atmo[k] >> 8) & 255) * w; acc._col.b += (atmo[k] & 255) * w; }
    else acc[k] = (acc[k] || 0) + atmo[k] * w;
  }
}
/** blended atmosphere parameters for a position (indoor 0..1 overrides everything) */
export function atmosphereAt(x, z, indoor = 0, out = {}) {
  biomeWeights(x, z, _w);
  for (const k in out) delete out[k];
  out._col = { r: 0, g: 0, b: 0 };
  for (const k of Object.keys(BIOMES)) if (_w[k] > 0) mix(out, BIOMES[k].atmosphere, _w[k]);
  let col = (Math.round(out._col.r) << 16) | (Math.round(out._col.g) << 8) | Math.round(out._col.b);
  delete out._col;
  const h = _w.hanging;
  if (h > 0) {
    const A = BOUNDARY.atmosphere;
    for (const k in A) if (k !== 'fogColor') out[k] = lerp(out[k], A[k], h);
    col = lerpColor(col, A.fogColor, h);
  }
  if (indoor > 0) {
    for (const k in INDOOR) if (k !== 'fogColor') out[k] = lerp(out[k], INDOOR[k], indoor);
    col = lerpColor(col, INDOOR.fogColor, indoor);
  }
  out.fogColor = col;
  out.weights = _w;
  return out;
}
export { clamp };
