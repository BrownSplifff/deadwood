import * as THREE from '../lib/three.module.min.js';
import { clamp, lerp, smoothstep, hash2, mulberry32, mergeGeos, mergeUV, part, rayCircleT } from './util.js';
import { makeCorpse, makeHangedBody } from './zombies.js';
import { biomeWeights, desertWeight, ringWeight, trailDist, edgeDist, dominantBiome, atmosphereAt } from './biomes.js';
import { planDesert, createDesert } from './structures.js';

// =====================================================================================
//  DEADWOOD world: 4 km x 4 km, generated on demand in 100 m chunks around the player.
//  Only small "skeleton" data (rivers, ponds, village sites, roads, dark sectors) is made at
//  boot.  Every object in a chunk (trees, bushes, rocks, blood, corpses, collision circles,
//  loot) is generated deterministically from the chunk coordinates when the chunk is first
//  needed, and thrown away again when the player is far away.
// =====================================================================================
export const SIZE = 4000, HALF = 2000;
export const CH = 100, NCH = SIZE / CH;           // chunk size / chunks per side (40)
const CELL = 10, CPC = CH / CELL;                 // collision cell size / cells per chunk side
const GN = SIZE / CELL;
const REG = 500, NR = SIZE / REG;                 // regions used for village / pond placement
export const SEED = 1337;
const WATER_Y = 0;
export const CABIN = { x: -38, z: -32 };
export const CAMP = { x: 14, z: 10 };
export const SPAWN = { x: 9, z: 14 };

const seeded = (a, b, c = 0) => mulberry32(Math.floor(hash2(a, b, c + SEED) * 4294967296));
const chunkIdx = (x, z) => clamp(Math.floor((z + HALF) / CH), 0, NCH - 1) * NCH + clamp(Math.floor((x + HALF) / CH), 0, NCH - 1);

// ---------------------------------------------------------------- rivers (analytic)
export const RIVERS = [
  { base: -170, a: 110, b: 35, f1: 0.0045, p1: 0.5, f2: 0.013, p2: 2 },
  { base: 830, a: 150, b: 40, f1: 0.0036, p1: 2.2, f2: 0.011, p2: 0.7 },
  { base: -1050, a: 130, b: 45, f1: 0.004, p1: 4.1, f2: 0.012, p2: 1.3 },
  { base: 1650, a: 120, b: 35, f1: 0.0042, p1: 1.0, f2: 0.014, p2: 5.0 },
  { base: 1000, a: 140, b: 40, f1: 0.0039, p1: 3.3, f2: 0.012, p2: 0.2, h: true },
  { base: -1250, a: 120, b: 40, f1: 0.0044, p1: 0.9, f2: 0.011, p2: 2.6, h: true },
];
function riverDistOne(R, x, z) {
  const u = R.h ? z : x, v = R.h ? x : z;
  const f = R.base + R.a * Math.sin(R.f1 * v + R.p1) + R.b * Math.sin(R.f2 * v + R.p2);
  const df = R.a * R.f1 * Math.cos(R.f1 * v + R.p1) + R.b * R.f2 * Math.cos(R.f2 * v + R.p2);
  return Math.abs(u - f) / Math.sqrt(1 + df * df);
}
export function riverDist(x, z) {
  let m = 1e9;
  for (let i = 0; i < RIVERS.length; i++) { const d = riverDistOne(RIVERS[i], x, z); if (d < m) m = d; }
  return m;
}
export const riverX = (z) => RIVERS[0].base + RIVERS[0].a * Math.sin(RIVERS[0].f1 * z + RIVERS[0].p1) + RIVERS[0].b * Math.sin(RIVERS[0].f2 * z + RIVERS[0].p2);

// ---------------------------------------------------------------- ponds
export const PONDS = [{ x: 95, z: -70, r: 13 }];
for (let rz = 0; rz < NR; rz++) for (let rx = 0; rx < NR; rx++) {
  const rng = seeded(rx, rz, 11);
  if (rng() < 0.5) {
    const p = { x: -HALF + rx * REG + rng() * REG, z: -HALF + rz * REG + rng() * REG, r: 12 + rng() * 12 };
    if (Math.hypot(p.x - SPAWN.x, p.z - SPAWN.z) > 150 && Math.abs(p.x) < HALF - 80 && Math.abs(p.z) < HALF - 80 && desertWeight(p.x, p.z) < 0.02 && ringWeight(p.x, p.z) < 0.02) PONDS.push(p);
  }
}

// ---------------------------------------------------------------- villages (positions only)
const PRE = ['HOLLOW', 'MARROW', 'ASH', 'GRIM', 'RAVEN', 'BLACK', 'MOURN', 'DEAD', 'WITHER', 'BONE', 'GALLOW', 'CINDER', 'PALE', 'SORROW', 'CROW', 'THORN', 'WOLF', 'GRAVEL'];
const SUF = ['CREEK', 'FIELD', 'GROVE', 'WICK', 'MERE', 'FORD', 'STEAD', 'MOOR', 'HILL', 'HAM', 'DALE', 'BROOK', 'WOOD', 'FALL'];
export const VILLAGES = [];
{
  const used = new Set();
  const addV = (x, z, rng, small) => {
    let name = '';
    for (let k = 0; k < 30; k++) { name = PRE[(rng() * PRE.length) | 0] + SUF[(rng() * SUF.length) | 0]; if (!used.has(name)) break; }
    used.add(name);
    VILLAGES.push({
      x, z, name: name.replace(/^(\w+?)(CREEK|FIELD|GROVE|WICK|MERE|FORD|STEAD|MOOR|HILL|HAM|DALE|BROOK|WOOD|FALL)$/, '$1 $2'),
      boss: !small && Math.hypot(x - SPAWN.x, z - SPAWN.z) > 450 && rng() < 0.4, idx: VILLAGES.length, corpses: [], small,
      houseR: small ? [12, 15] : [17, 21], nh: small ? 3 : 5, r0: small ? 22 : 30, r1: small ? 36 : 48,
    });
  };
  const farFrom = (x, z, d) => VILLAGES.every((v) => Math.hypot(v.x - x, v.z - z) > d);
  // small villages scattered through the (now small) forest
  const fr = seeded(3, 3, 31);
  for (let k = 0, made = 0; k < 200 && made < 3; k++) {
    const a = (made / 3) * Math.PI * 2 + fr() * 1.8, r = 110 + fr() * 80, x = SPAWN.x + Math.cos(a) * r, z = SPAWN.z + Math.sin(a) * r;
    if (edgeDist(x, z) > -48 || Math.hypot(x - CABIN.x, z - CABIN.z) < 55 || Math.hypot(x - CAMP.x, z - CAMP.z) < 60 || riverDist(x, z) < 38 || !farFrom(x, z, 95)) continue;
    addV(x, z, fr, true); made++;
  }
  // many more villages across the outer forest-like sectors
  const REGV = 350, NV = Math.floor(SIZE / REGV);
  for (let rz = 0; rz < NV; rz++) for (let rx = 0; rx < NV; rx++) {
    const rng = seeded(rx, rz, 22);
    if (rng() > 0.62) continue;
    const x = -HALF + (rx + 0.5) * REGV + (rng() - 0.5) * 200, z = -HALF + (rz + 0.5) * REGV + (rng() - 0.5) * 200;
    if (Math.abs(x) > HALF - 160 || Math.abs(z) > HALF - 160 || riverDist(x, z) < 75 || desertWeight(x, z) > 0.01 || edgeDist(x, z) < 110 || !farFrom(x, z, 170)) continue;
    if (PONDS.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + 60)) continue;
    addV(x, z, rng, rng() < 0.35);
  }
}

// ---------------------------------------------------------------- dark sectors / clearings
export const DARK = [];
for (const v of VILLAGES) if (Math.hypot(v.x - SPAWN.x, v.z - SPAWN.z) > 260) DARK.push({ x: v.x, z: v.z, r: 150 + ((v.idx * 37) % 30) });
for (let rz = 0; rz < NR; rz++) for (let rx = 0; rx < NR; rx++) {
  const rng = seeded(rx, rz, 33);
  if (rng() < 0.3) {
    const d = { x: -HALF + rx * REG + rng() * REG, z: -HALF + rz * REG + rng() * REG, r: 90 + rng() * 60 };
    if (Math.hypot(d.x - SPAWN.x, d.z - SPAWN.z) > 350 && desertWeight(d.x, d.z) < 0.2) DARK.push(d);
  }
}
const CLEARINGS = [[60, -50, 16], [-70, 60, 14], [90, -10, 12], [-20, -90, 15], [-95, -45, 12]];
for (let rz = 0; rz < NR; rz++) for (let rx = 0; rx < NR; rx++) {
  const rng = seeded(rx, rz, 44);
  for (let k = 0; k < 2; k++) CLEARINGS.push([-HALF + rx * REG + rng() * REG, -HALF + rz * REG + rng() * REG, 12 + rng() * 7]);
}

// ---------------------------------------------------------------- terrain height
function forestBaseH(x, z) {
  let h = 7
    + 5.0 * Math.sin(x * 0.0012 + 1.3) * Math.cos(z * 0.0014 + 0.2)
    + 3.0 * Math.sin(x * 0.0042 + 0.7) * Math.cos(z * 0.0037 + 1.1)
    + 2.0 * Math.sin(x * 0.031 + 1.3) * Math.cos(z * 0.027 + 0.4)
    + 1.1 * Math.sin(x * 0.071 + z * 0.053 + 2.0)
    + 0.5 * Math.cos(x * 0.13 - z * 0.11);
  return h;
}
/** rolling sand dunes (gentle enough to walk over: max slope ~10 degrees) */
function desertBaseH(x, z) {
  return 9
    + 5.5 * Math.sin(x * 0.014 + 1.8 * Math.sin(z * 0.0052))
    + 2.6 * Math.sin(z * 0.021 + x * 0.006 + 2 * Math.sin(x * 0.004))
    + 4.0 * Math.sin(x * 0.0024 + 0.5) * Math.cos(z * 0.0031)
    + 0.5 * Math.sin(x * 0.07 + z * 0.05);
}
/** biome-blended base terrain (the blend happens inside the Hanging Woods belt) */
function baseH(x, z) {
  const dw = desertWeight(x, z);
  let h = dw < 1 ? forestBaseH(x, z) : 0;
  if (dw > 0) h = lerp(h, desertBaseH(x, z), dw);
  const e = Math.max(Math.abs(x), Math.abs(z));
  h += smoothstep(HALF - 38, HALF, e) * 14; // hills wall in the map
  return h;
}
export const DESERT_PLAN = planDesert(seeded, HALF);
const SITES = [
  { x: CABIN.x, z: CABIN.z, r0: 9, r1: 20 }, { x: CAMP.x, z: CAMP.z, r0: 7, r1: 16 },
  ...VILLAGES.map((v) => ({ x: v.x, z: v.z, r0: v.r0, r1: v.r1 })),
  ...DESERT_PLAN.sites,
];
for (const s of SITES) s.h = Math.max(2, baseH(s.x, s.z));
export function hgt(x, z) {
  let h = baseH(x, z);
  for (let i = 0; i < SITES.length; i++) {
    const s = SITES[i], dx = x - s.x, dz = z - s.z;
    if (Math.abs(dx) > s.r1 || Math.abs(dz) > s.r1) continue;
    const d = s.square ? Math.max(Math.abs(dx), Math.abs(dz)) : Math.sqrt(dx * dx + dz * dz);
    if (d < s.r1) h = lerp(s.h, h, smoothstep(s.r0, s.r1, d));
  }
  const rd = riverDist(x, z);
  if (rd < 40) {
    const dw = desertWeight(x, z);  // no rivers in the desert
    if (dw < 1) h = lerp(Math.min(h, lerp(-1.0, h, smoothstep(4.5, 10 + h * 1.1, rd))), h, dw);
  }
  for (let i = 0; i < PONDS.length; i++) {
    const p = PONDS[i], dx = x - p.x, dz = z - p.z, lim = p.r + 14;
    if (dx * dx + dz * dz < lim * lim) { const d = Math.sqrt(dx * dx + dz * dz); h = Math.min(h, lerp(-1.2, h, smoothstep(p.r * 0.35, p.r + 6 + h * 0.6, d))); }
  }
  return DESERT_PLAN.heightMod(x, z, h);
}

// ---------------------------------------------------------------- roads (polylines, bucketed per chunk)
const SEGS = [];
const segBuckets = new Map();
function addSeg(ax, az, bx, bz) {
  const s = [ax, az, bx, bz]; SEGS.push(s);
  const m = 8, x0 = Math.min(ax, bx) - m, x1 = Math.max(ax, bx) + m, z0 = Math.min(az, bz) - m, z1 = Math.max(az, bz) + m;
  const c0 = clamp(Math.floor((x0 + HALF) / CH), 0, NCH - 1), c1 = clamp(Math.floor((x1 + HALF) / CH), 0, NCH - 1);
  const r0 = clamp(Math.floor((z0 + HALF) / CH), 0, NCH - 1), r1 = clamp(Math.floor((z1 + HALF) / CH), 0, NCH - 1);
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) { const k = r * NCH + c; (segBuckets.get(k) || segBuckets.set(k, []).get(k)).push(s); }
}
function addPath(a, b, rng) {
  const len = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(2, Math.round(len / 55));
  const px = -(b.z - a.z) / len, pz = (b.x - a.x) / len, amp = Math.min(70, len * 0.12) * (rng() < 0.5 ? -1 : 1);
  let prev = { x: a.x, z: a.z };
  for (let i = 1; i <= n; i++) {
    const t = i / n, off = i === n ? 0 : Math.sin(t * Math.PI) * amp + (rng() - 0.5) * 16;
    const p = { x: lerp(a.x, b.x, t) + px * off, z: lerp(a.z, b.z, t) + pz * off };
    addSeg(prev.x, prev.z, p.x, p.z); prev = p;
  }
}
{
  const rng = seeded(5, 5, 55);
  // camp <-> cabin
  const cab = [[14, 10], [2, -2], [-20, -12], [-38, -25]];
  for (let i = 0; i < cab.length - 1; i++) addSeg(cab[i][0], cab[i][1], cab[i + 1][0], cab[i + 1][1]);
  const nodes = [{ x: CAMP.x, z: CAMP.z }, ...VILLAGES];
  const done = new Set();
  const link = (i, j) => { const k = Math.min(i, j) + '-' + Math.max(i, j); if (i === j || done.has(k)) return; done.add(k); addPath(nodes[i], nodes[j], rng); };
  const order = (i) => nodes.map((n, k) => ({ k, d: Math.hypot(n.x - nodes[i].x, n.z - nodes[i].z) })).filter((o) => o.k !== i).sort((a, b) => a.d - b.d);
  order(0).slice(0, 3).forEach((o) => link(0, o.k));
  for (let i = 1; i < nodes.length; i++) order(i).slice(0, 2).forEach((o) => link(i, o.k));
  for (const [a, b] of DESERT_PLAN.links) addPath(a, b, rng);
  // two roads cross the Hanging Woods from forest villages to the desert
  const forestV = VILLAGES.filter((v) => edgeDist(v.x, v.z) < 0);
  DESERT_PLAN.nodes.slice().sort((a, b) => edgeDist(a.x, a.z) - edgeDist(b.x, b.z)).slice(0, 2).forEach((n) => {
    const v = forestV.slice().sort((a, b) => Math.hypot(a.x - n.x, a.z - n.z) - Math.hypot(b.x - n.x, b.z - n.z))[0];
    if (v) addPath(v, n.kind === 'great' ? { x: n.x - n.A - 20, z: n.z } : n, rng);
  });
}
function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz), 0, 1);
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}
export function pathDist(x, z) {
  const list = segBuckets.get(chunkIdx(x, z));
  if (!list) return 1e9;
  let m = 1e9;
  for (let i = 0; i < list.length; i++) { const s = list[i], d = segDist(x, z, s[0], s[1], s[2], s[3]); if (d < m) m = d; }
  return m;
}
function clearingDist(x, z) {
  let m = 1e9;
  for (let i = 0; i < CLEARINGS.length; i++) { const c = CLEARINGS[i], dx = x - c[0], dz = z - c[1]; if (Math.abs(dx) > 120 || Math.abs(dz) > 120) continue; const d = Math.sqrt(dx * dx + dz * dz) - c[2]; if (d < m) m = d; }
  return m;
}
export function darkBlob(x, z) {
  let b = 0;
  for (let i = 0; i < DARK.length; i++) {
    const s = DARK[i], dx = x - s.x, dz = z - s.z, r2 = s.r * s.r;
    if (dx * dx + dz * dz >= r2) continue;
    const v = 1 - smoothstep(s.r * 0.5, s.r, Math.sqrt(dx * dx + dz * dz)); if (v > b) b = v;
  }
  return b;
}
/** 0..1 how pitch-black this place is (never near spawn) */
export function darkness(x, z) {
  return darkBlob(x, z) * smoothstep(120, 230, Math.hypot(x - SPAWN.x, z - SPAWN.z));
}
export function denseF(x, z) {
  const n = 0.5 + 0.5 * (Math.sin(x * 0.009 + 1.7) * Math.cos(z * 0.011 - 0.6) * 0.7 + Math.sin((x + z) * 0.004) * 0.3);
  return clamp(smoothstep(0.55, 0.78, n) + darkBlob(x, z) * 0.35, 0, 1);
}
function villageDist(x, z) {
  let m = 1e9;
  for (let i = 0; i < VILLAGES.length; i++) { const v = VILLAGES[i], dx = x - v.x, dz = z - v.z; if (Math.abs(dx) > 200 || Math.abs(dz) > 200) continue; const d = Math.hypot(dx, dz); if (d < m) m = d; }
  return m;
}
function waterNear(x, z, pad) {
  if (riverDist(x, z) < pad) return true;
  for (const p of PONDS) if (Math.hypot(p.x - x, p.z - z) < p.r + pad) return true;
  return false;
}
const wet = (x, z, pad = 0) => hgt(x, z) < 0.35 + pad;

// ---------------------------------------------------------------- canvas textures
function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (repeat) t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  return t;
}
function radialTex(stops) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (const [o, col] of stops) gr.addColorStop(o, col);
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const woodTex = (base = [110, 75, 45]) => canvasTex(128, 128, (ctx, w, h) => {
  ctx.fillStyle = `rgb(${base})`; ctx.fillRect(0, 0, w, h);
  const rows = 6;
  for (let i = 0; i < rows; i++) {
    const y = (i * h) / rows, v = Math.random() * 40 - 20;
    ctx.fillStyle = `rgb(${base[0] + v},${base[1] + v * 0.8},${base[2] + v * 0.6})`; ctx.fillRect(0, y, w, h / rows - 2);
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, y + h / rows - 2, w, 2);
    for (let k = 0; k < 14; k++) { ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.2})`; ctx.fillRect(Math.random() * w, y + Math.random() * (h / rows), 20 + Math.random() * 40, 1); }
  }
});
function bloodTex() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const blob = (x, y, r, a) => { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(120,6,6,${a})`); gr.addColorStop(0.7, `rgba(90,4,4,${a * 0.8})`); gr.addColorStop(1, 'rgba(60,0,0,0)'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); };
  blob(64, 64, 34, 0.95);
  for (let i = 0; i < 18; i++) { const a = Math.random() * 6.28, d = 20 + Math.random() * 38; blob(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 3 + Math.random() * 9, 0.9); }
  for (let i = 0; i < 5; i++) { const a = Math.random() * 6.28; g.strokeStyle = 'rgba(100,5,5,0.85)'; g.lineWidth = 2 + Math.random() * 3; g.beginPath(); g.moveTo(64, 64); g.lineTo(64 + Math.cos(a) * 60, 64 + Math.sin(a) * 60); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function boxUV(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv, dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) { const k = f * 4 + i; uv.setXY(k, uv.getX(k) * dims[f][0] * 0.5, uv.getY(k) * dims[f][1] * 0.5); }
  return g;
}

export function createWorld(scene) {
  const W = {};
  W.hgt = hgt; W.CABIN = CABIN; W.CAMP = CAMP; W.VILLAGES = VILLAGES; W.PONDS = PONDS; W.riverX = riverX; W.HALF = HALF; W.SIZE = SIZE;
  W.darkness = darkness; W.pathDist = pathDist; W.denseF = denseF;
  W.treeFrac = 1; W.viewDist = 90; W.time = 0;
  W.onChunkLoad = null; W.onChunkUnload = null;

  // ------------------------------------------------------------ lights / sky
  const hemi = new THREE.HemisphereLight(0x7a9ae0, 0x232c3e, 2.1);
  scene.add(hemi);
  const moonDir = new THREE.Vector3(-0.32, 0.5, -0.8).normalize();
  const moon = new THREE.DirectionalLight(0xb4caff, 2.0);
  moon.castShadow = true;
  moon.shadow.camera.left = -45; moon.shadow.camera.right = 45; moon.shadow.camera.top = 45; moon.shadow.camera.bottom = -45;
  moon.shadow.camera.near = 1; moon.shadow.camera.far = 260;
  moon.shadow.bias = -0.0008; moon.shadow.normalBias = 0.05;
  scene.add(moon); scene.add(moon.target);
  // the second moon is red, and casts a faint red light (no shadows)
  const redDir = new THREE.Vector3(0.62, 0.34, 0.7).normalize();
  const redMoon = new THREE.DirectionalLight(0xff4a30, 0.35);
  scene.add(redMoon); scene.add(redMoon.target);
  W.redMoon = redMoon;
  W.moon = moon; W.hemi = hemi;
  W.FOG = new THREE.Color(0x0b1428);
  scene.background = W.FOG.clone();
  scene.fog = new THREE.Fog(0x0b1428, 4, 90);
  {
    const g = new THREE.SphereGeometry(380, 24, 16);
    const p = g.attributes.position, cols = new Float32Array(p.count * 3);
    const top = new THREE.Color(0x03060f), mid = new THREE.Color(0x0c1830), hor = new THREE.Color(0x0b1428), c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const h = clamp(p.getY(i) / 380, 0, 1);
      if (h < 0.25) c.copy(hor).lerp(mid, h / 0.25); else c.copy(mid).lerp(top, (h - 0.25) / 0.75);
      cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    W.domeMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false });
    const dome = new THREE.Mesh(g, W.domeMat); dome.renderOrder = -10;
    const n = 450, sp = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * Math.PI * 2, v = Math.acos(Math.random() * 0.92 + 0.08);
      sp[i * 3] = 360 * Math.sin(v) * Math.cos(u); sp[i * 3 + 1] = 360 * Math.cos(v); sp[i * 3 + 2] = 360 * Math.sin(v) * Math.sin(u);
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    W.starMat = new THREE.PointsMaterial({ color: 0xcfdcff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.8, depthWrite: false });
    const stars = new THREE.Points(sg, W.starMat);
    W.moonMat = new THREE.SpriteMaterial({
      map: radialTex([[0, '#ffffff'], [0.18, '#eef3ff'], [0.22, '#b9c9f0'], [0.5, 'rgba(120,150,230,0.25)'], [1, 'rgba(60,80,140,0)']]),
      fog: false, depthWrite: false, transparent: true,
    });
    const moonSpr = new THREE.Sprite(W.moonMat);
    moonSpr.scale.set(70, 70, 1); moonSpr.position.copy(moonDir).multiplyScalar(340);
    const moonGlow = radialTex([[0, '#e45439'], [0.62, '#981d13'], [0.70, 'rgba(160,22,12,0.22)'], [1, 'rgba(90,0,0,0)']]);
    const ctx = moonGlow.image.getContext('2d');
    const radius = ctx.canvas.width * 0.31;
    const center = ctx.canvas.width / 2;
    ctx.save();
    ctx.beginPath();
    ctx.arc(center, center, radius, 0, Math.PI * 2);
    ctx.clip();
    for (let i = 0; i < 180; i++) {
      const x = center + (hash2(i, 13) * 2 - 1) * radius;
      const y = center + (hash2(i, 19) * 2 - 1) * radius;
      const r = radius * (0.01 + 0.18 * hash2(i, 31) ** 3);
      const crater = ctx.createRadialGradient(x, y, 0, x, y, r);
      crater.addColorStop(0, 'rgba(66,3,9,0.55)');
      crater.addColorStop(0.72, 'rgba(92,8,12,0.30)');
      crater.addColorStop(0.87, 'rgba(253,116,74,0.32)');
      crater.addColorStop(1, 'rgba(253,116,74,0)');
      ctx.fillStyle = crater;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.restore();
    moonGlow.needsUpdate = true;
    W.redMoonMat = new THREE.SpriteMaterial({
      map: moonGlow,
      fog: false, depthWrite: false, transparent: true,
    });
    const redSpr = new THREE.Sprite(W.redMoonMat);
    redSpr.scale.set(210, 210, 1); redSpr.position.copy(redDir).multiplyScalar(335);
    redSpr.renderOrder = -1;
    W.sky = new THREE.Group(); W.sky.add(dome, stars, moonSpr, redSpr);
    scene.add(W.sky);
  }
  const waterMat = new THREE.MeshPhongMaterial({ color: 0x0a1820, specular: 0x6a7a90, shininess: 90 });
  W.isWater = (x, z) => hgt(x, z) < WATER_Y - 0.15;

  // ------------------------------------------------------------ collision: circles live in chunk data, boxes (houses) are global
  const cdata = new Array(NCH * NCH);          // chunk data, generated on demand
  const boxCells = new Map();                  // houses: 10 m cell -> boxes
  const houseByChunk = new Map();              // chunk index -> houses overlapping that chunk
  const statics = new Map();                   // village content bucketed by chunk index
  const S = (ci) => statics.get(ci) || statics.set(ci, { props: [], blood: [], loot: [], owl: [], nests: [], lanterns: [] }).get(ci);
  const cIdx = (v) => clamp(Math.floor((v + HALF) / CELL), 0, GN - 1);
  const EMPTY = [];
  function cellCircles(gx, gz) {
    const cx = Math.floor(gx / CPC), cz = Math.floor(gz / CPC);
    if (cx < 0 || cz < 0 || cx >= NCH || cz >= NCH) return EMPTY;
    return getCD(cx, cz).cells[(gz - cz * CPC) * CPC + (gx - cx * CPC)];
  }
  const cellBoxes = (gx, gz) => boxCells.get(gz * GN + gx) || EMPTY;
  function addCircle(cd, x, z, r, h, kind = 'rock', q) {
    const gx = cIdx(x), gz = cIdx(z), c = { x, z, r, y0: hgt(x, z), h, kind, q, stamp: 0 };
    cd.cells[(gz - cd.cz * CPC) * CPC + (gx - cd.cx * CPC)].push(c);
    return c;
  }
  function addBox(x0, x1, z0, z1, y0, y1, kind = 'wood', walkable = false) {
    const b = { x0, x1, z0, z1, y0, y1, kind, walkable, stamp: 0 };
    for (let gz = cIdx(z0 - 1); gz <= cIdx(z1 + 1); gz++) for (let gx = cIdx(x0 - 1); gx <= cIdx(x1 + 1); gx++) {
      const k = gz * GN + gx; (boxCells.get(k) || boxCells.set(k, []).get(k)).push(b);
    }
    return b;
  }
  W.addWaystoneCollider = (x, z, y) => addBox(x - 0.51, x + 0.51, z - 0.51, z + 0.51, y, y + 3.7, 'rock');
  W.addRailCollider = addBox;
  const alive = (c) => c.q === undefined || c.q < W.treeFrac;
  let stampN = 0;

  W.resolve = (p, r, y = -1e9) => {
    const cx = cIdx(p.x), cz = cIdx(p.z);
    for (let gz = Math.max(0, cz - 1); gz <= Math.min(GN - 1, cz + 1); gz++)
      for (let gx = Math.max(0, cx - 1); gx <= Math.min(GN - 1, cx + 1); gx++) {
        const cell = cellCircles(gx, gz);
        for (let i = 0; i < cell.length; i++) {
          const c = cell[i];
          if (!alive(c) || y > c.y0 + c.h) continue;
          const dx = p.x - c.x, dz = p.z - c.z, rr = r + c.r, d2 = dx * dx + dz * dz;
          if (d2 < rr * rr) { const d = Math.sqrt(d2) || 1e-4, push = rr - d; p.x += dx / d * push; p.z += dz / d * push; }
        }
      }
    const boxes = cellBoxes(cx, cz);
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.walkable || y > b.y1) continue;
      const qx = clamp(p.x, b.x0, b.x1), qz = clamp(p.z, b.z0, b.z1);
      const dx = p.x - qx, dz = p.z - qz, d2 = dx * dx + dz * dz;
      if (d2 < r * r && d2 > 1e-8) { const d = Math.sqrt(d2), push = r - d; p.x += dx / d * push; p.z += dz / d * push; }
      else if (d2 <= 1e-8) {
        const l = p.x - b.x0, rt = b.x1 - p.x, f = p.z - b.z0, bk = b.z1 - p.z, m = Math.min(l, rt, f, bk);
        if (m === l) p.x = b.x0 - r; else if (m === rt) p.x = b.x1 + r; else if (m === f) p.z = b.z0 - r; else p.z = b.z1 + r;
      }
    }
    const lim = HALF - 6;
    p.x = clamp(p.x, -lim, lim); p.z = clamp(p.z, -lim, lim);
  };
  W.blocked = (x, z, r) => {
    const cx = cIdx(x), cz = cIdx(z);
    for (let gz = Math.max(0, cz - 1); gz <= Math.min(GN - 1, cz + 1); gz++)
      for (let gx = Math.max(0, cx - 1); gx <= Math.min(GN - 1, cx + 1); gx++)
        for (const c of cellCircles(gx, gz)) if (alive(c) && Math.hypot(x - c.x, z - c.z) < r + c.r) return true;
    for (const b of cellBoxes(cx, cz)) if (!b.walkable && x > b.x0 - r && x < b.x1 + r && z > b.z0 - r && z < b.z1 + r) return true;
    return false;
  };
  W.inBuilding = (x, z, pad = 0) => {
    const list = houseByChunk.get(chunkIdx(x, z));
    if (!list) return false;
    for (const b of list) if (x > b.x0 - pad && x < b.x1 + pad && z > b.z0 - pad && z < b.z1 + pad) return true;
    return false;
  };
  W.inCabin = (x, z) => W.inBuilding(x, z);
  W.housesInChunk = (cx, cz) => houseByChunk.get(cz * NCH + cx) || EMPTY;
  W.pathsInChunk = (cx, cz) => segBuckets.get(cz * NCH + cx) || EMPTY;

  W.steer = (px, pz, dx, dz, side, out) => {
    out.x = 0; out.z = 0;
    const cx = cIdx(px), cz = cIdx(pz), look = 3.2;
    const apply = (ox, oz, r) => {
      const ex = px - ox, ez = pz - oz, d = Math.hypot(ex, ez) || 1e-4, range = r + 1.3;
      if (d > range + look) return;
      const fwd = (-ex * dx - ez * dz) / d;
      if (fwd < -0.2 && d > range) return;
      const s = clamp((range + 0.8 - d) / (range + 0.8 - r), 0, 1.4);
      out.x += ex / d * s; out.z += ez / d * s;
      out.x += -dz * side * s * 1.3 * Math.max(fwd, 0.2); out.z += dx * side * s * 1.3 * Math.max(fwd, 0.2);
    };
    for (let gz = Math.max(0, cz - 1); gz <= Math.min(GN - 1, cz + 1); gz++)
      for (let gx = Math.max(0, cx - 1); gx <= Math.min(GN - 1, cx + 1); gx++)
        for (const c of cellCircles(gx, gz)) if (alive(c) && c.h > 0.6) apply(c.x, c.z, c.r);
    for (const b of cellBoxes(cx, cz)) {
      if (b.walkable) continue;
      const qx = clamp(px, b.x0, b.x1), qz = clamp(pz, b.z0, b.z1);
      if (Math.abs(px - qx) < 3 && Math.abs(pz - qz) < 3) apply(qx, qz, 0.2);
    }
  };

  W.hitKind = 'dirt';
  W.rayHit = (ox, oy, oz, dx, dy, dz, maxT) => {
    let best = maxT, kind = null;
    stampN++;
    const step = 6;
    for (let t = 0; t <= maxT + step; t += step) {
      const cx = cIdx(ox + dx * t), cz = cIdx(oz + dz * t);
      for (let gz = Math.max(0, cz - 1); gz <= Math.min(GN - 1, cz + 1); gz++)
        for (let gx = Math.max(0, cx - 1); gx <= Math.min(GN - 1, cx + 1); gx++) {
          for (const c of cellCircles(gx, gz)) {
            if (c.stamp === stampN || !alive(c)) continue;
            c.stamp = stampN;
            const tt = rayCircleT(ox, oz, dx, dz, c.x, c.z, c.r);
            if (tt >= 0 && tt < best) { const y = oy + dy * tt; if (y >= c.y0 - 0.5 && y <= c.y0 + c.h) { best = tt; kind = c.kind; } }
          }
          for (const b of cellBoxes(gx, gz)) {
            if (b.stamp === stampN) continue;
            b.stamp = stampN;
            let t0 = 0, t1 = best;
            const sl = (o, d, a, bb) => {
              if (Math.abs(d) < 1e-9) return o >= a && o <= bb;
              let ta = (a - o) / d, tb = (bb - o) / d;
              if (ta > tb) { const q = ta; ta = tb; tb = q; }
              if (ta > t0) t0 = ta; if (tb < t1) t1 = tb;
              return t0 <= t1;
            };
            if (sl(ox, dx, b.x0, b.x1) && sl(oy, dy, b.y0, b.y1) && sl(oz, dz, b.z0, b.z1) && t0 < best) { best = t0; kind = b.kind; }
          }
        }
    }
    let prev = 0;
    for (let t = 1.5; t <= best + 1.5; t += 1.5) {
      const tt = Math.min(t, best);
      if (oy + dy * tt < hgt(ox + dx * tt, oz + dz * tt)) {
        let a = prev, b = tt;
        for (let i = 0; i < 6; i++) { const m = (a + b) / 2; if (oy + dy * m < hgt(ox + dx * m, oz + dz * m)) b = m; else a = m; }
        if (b < best) { best = b; kind = 'dirt'; }
        break;
      }
      prev = tt;
      if (tt >= best) break;
    }
    if (dy < 0 && oy > WATER_Y) {
      const tw = (WATER_Y - oy) / dy;
      if (tw < best && hgt(ox + dx * tw, oz + dz * tw) < WATER_Y) { best = tw; kind = 'water'; }
    }
    W.hitKind = kind || 'dirt';
    return kind ? best : Infinity;
  };

  // ------------------------------------------------------------ shared assets
  const groundTex = canvasTex(128, 128, (ctx, w, h) => {
    const id = ctx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) { const v = 170 + Math.random() * 85; id.data[i * 4] = v; id.data[i * 4 + 1] = v; id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255; }
    ctx.putImageData(id, 0, 0);
  }, 1);
  const groundMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: groundTex });
  const vcMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  W.setRainTint = (wet) => {
    groundMat.color.setScalar(1 - wet * 0.32);
    vcMat.color.setScalar(1 - wet * 0.17);
  };
  const treeGeo = (() => {
    const parts = [{ geo: new THREE.CylinderGeometry(0.17, 0.32, 3.2, 6).translate(0, 1.6, 0), color: 0x3a281a }];
    [[2.5, 3.2, 1.7], [2.1, 3.0, 3.5], [1.7, 2.8, 5.3], [1.25, 2.6, 7.0], [0.8, 2.4, 8.7]].forEach(([r, h, y], i) => {
      parts.push({ geo: new THREE.ConeGeometry(r, h, 7).translate(0, y + h / 2, 0), color: new THREE.Color(0x0f2c1a).lerp(new THREE.Color(0x1d4a2a), i / 4).getHex() });
    });
    return mergeGeos(parts);
  })();
  const treeLowGeo = mergeGeos([
    { geo: new THREE.CylinderGeometry(0.2, 0.32, 3.2, 4, 1, true).translate(0, 1.6, 0), color: 0x3a281a },
    { geo: new THREE.ConeGeometry(2.4, 5.8, 5, 1, true).translate(0, 1.7 + 2.9, 0), color: 0x12321d },
    { geo: new THREE.ConeGeometry(1.6, 5.0, 5, 1, true).translate(0, 5.4 + 2.5, 0), color: 0x1a4426 },
  ]);
  const deepForest = (x, z) => smoothstep(100, 190, Math.hypot(x - CAMP.x, z - CAMP.z))
    * (1 - ringWeight(x, z)) * (1 - desertWeight(x, z));
  const ancientTree = (detail) => {
    const parts = [
      { geo: new THREE.CylinderGeometry(0.24, 1, 0.94, detail ? 9 : 5).translate(0, 0.46, 0), color: 0x392b24 },
      { geo: new THREE.IcosahedronGeometry(1, detail ? 1 : 0).scale(4.2, 0.18, 4.2).translate(0, 0.81, 0), color: 0x142720 },
    ];
    for (let i = 0; i < (detail ? 6 : 3); i++) {
      const a = i * 2.39996;
      const x = Math.cos(a), z = Math.sin(a);
      const y = 0.33 + i * 0.07;
      const from = new THREE.Vector3(0, y, 0), to = new THREE.Vector3(x * 3, y + 0.1, z * 3);
      const axis = to.clone().sub(from);
      const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.clone().normalize());
      const branch = new THREE.CylinderGeometry(0.08, 0.32, axis.length(), detail ? 6 : 4);
      branch.applyQuaternion(rotation).translate(x * 1.5, y + 0.05, z * 1.5);
      parts.push({ geo: branch, color: 0x30251d });
      parts.push({ geo: new THREE.IcosahedronGeometry(1, 0).scale(2.9, 0.09, 2.9).translate(x * 2.7, y + 0.12, z * 2.7), color: 0x172d21 });
      if (detail) {
        const root = new THREE.IcosahedronGeometry(1, 0).scale(2, 0.024, 0.36).rotateY(-a);
        parts.push({ geo: root.translate(x * 1.4, 0.004, z * 1.4), color: 0x3a3225 });
      }
    }
    return mergeGeos(parts);
  };
  const ancientGeo = ancientTree(true), ancientLowGeo = ancientTree(false);
  const deadTreeGeo = mergeGeos([
    { geo: new THREE.CylinderGeometry(0.16, 0.34, 7.5, 6).translate(0, 3.75, 0), color: 0x2e2620 },
    { geo: new THREE.CylinderGeometry(0.06, 0.13, 2.6, 5).rotateZ(-Math.PI / 2 + 0.12).translate(1.25, 5.05, 0), color: 0x2e2620 },
    { geo: new THREE.CylinderGeometry(0.04, 0.09, 1.8, 5).rotateZ(0.9).translate(-0.7, 5.9, 0.1), color: 0x2a221c },
    { geo: new THREE.CylinderGeometry(0.03, 0.07, 1.5, 5).rotateX(0.8).translate(0, 6.4, 0.55), color: 0x2a221c },
    { geo: new THREE.CylinderGeometry(0.03, 0.06, 1.2, 5).rotateZ(-0.7).translate(0.45, 7.0, 0), color: 0x2a221c },
    { geo: new THREE.CylinderGeometry(0.025, 0.05, 1.0, 5).rotateX(-0.9).translate(0.1, 3.8, -0.4), color: 0x2a221c },
  ]);
  const deadTreeLowGeo = mergeGeos([
    { geo: new THREE.CylinderGeometry(0.16, 0.34, 7.5, 4, 1, true).translate(0, 3.75, 0), color: 0x2e2620 },
    { geo: new THREE.CylinderGeometry(0.06, 0.13, 2.6, 3, 1, true).rotateZ(-Math.PI / 2 + 0.12).translate(1.25, 5.05, 0), color: 0x2e2620 },
  ]);
  const lanternGeo = mergeGeos([
    { geo: new THREE.BoxGeometry(0.09, 1.95, 0.09).translate(0, 0.97, 0), color: 0x2a2018 },
    { geo: new THREE.BoxGeometry(0.42, 0.05, 0.05).translate(0.2, 1.88, 0), color: 0x2a2018 },
    { geo: new THREE.BoxGeometry(0.2, 0.28, 0.2).translate(0.38, 1.6, 0), color: 0xffffff },
    { geo: new THREE.ConeGeometry(0.15, 0.1, 4).rotateY(Math.PI / 4).translate(0.38, 1.79, 0), color: 0x2a2420 },
  ]);
  const lanternGlowMat = new THREE.SpriteMaterial({ map: radialTex([[0, 'rgba(255,230,160,1)'], [0.25, 'rgba(255,170,60,0.7)'], [1, 'rgba(255,120,20,0)']]), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  const hangingCase = new THREE.CylinderGeometry(0.15, 0.22, 0.42, 6);
  const hangingChain = new THREE.CylinderGeometry(0.018, 0.018, 1, 4);
  const hangingMetal = new THREE.MeshLambertMaterial({ color: 0x43332b });
  W.lanternSprites = [];
  const bushGeo = mergeGeos([
    { geo: new THREE.IcosahedronGeometry(0.7, 0).translate(0, 0.5, 0), color: 0x1b3a1c },
    { geo: new THREE.IcosahedronGeometry(0.5, 0).translate(0.55, 0.38, 0.2), color: 0x234a24 },
    { geo: new THREE.IcosahedronGeometry(0.45, 0).translate(-0.45, 0.35, -0.25), color: 0x16301a },
  ]);
  const fernGeo = mergeGeos(Array.from({ length: 7 }, (_, i) => {
    const a = i * 2.39996;
    return { geo: new THREE.PlaneGeometry(0.7, 1.8, 1, 3).rotateX(-0.56).translate(0, 0.55, 0.63).rotateY(a),
      color: i % 2 ? 0x375b31 : 0x25452c };
  }));
  const rockGeo = part(new THREE.DodecahedronGeometry(1, 0), null, 0x5b6068);
  const mossGeo = part(new THREE.IcosahedronGeometry(1, 0), null, 0x53633b);
  const logGeo = mergeGeos([
    { geo: new THREE.CylinderGeometry(0.3, 0.34, 4.6, 7).rotateZ(Math.PI / 2), color: 0x4b3624 },
    { geo: new THREE.CylinderGeometry(0.06, 0.1, 0.9, 5).rotateZ(1.0).translate(0.8, 0.3, 0.1), color: 0x3a291b },
  ]);
  const reedGeo = mergeGeos(Array.from({ length: 6 }, (_, i) => ({ geo: new THREE.CylinderGeometry(0.01, 0.02, 1.1 + (i % 3) * 0.3, 3).translate(Math.cos(i * 2.1) * 0.15, 0.6, Math.sin(i * 1.7) * 0.15), color: 0x3a4a24 })));
  const decalGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const bloodMat = new THREE.MeshLambertMaterial({ map: bloodTex(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, color: 0x9a8080 });
  const wallMat = new THREE.MeshLambertMaterial({ map: woodTex([92, 70, 52]), color: 0x9a8c7c });
  const adobeMat = new THREE.MeshLambertMaterial({ map: canvasTex(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#a88a62'; ctx.fillRect(0, 0, w, h);
    const id = ctx.getImageData(0, 0, w, h); for (let i = 0; i < w * h; i++) { const v = (Math.random() - 0.5) * 30; id.data[i * 4] += v; id.data[i * 4 + 1] += v; id.data[i * 4 + 2] += v; } ctx.putImageData(id, 0, 0);
    ctx.strokeStyle = 'rgba(50,35,20,0.5)'; for (let k = 0; k < 6; k++) { ctx.beginPath(); let x = Math.random() * w, y = Math.random() * h; ctx.moveTo(x, y); for (let q = 0; q < 5; q++) { x += (Math.random() - 0.5) * 30; y += Math.random() * 20; ctx.lineTo(x, y); } ctx.stroke(); }
  }), color: 0xc8b090 });
  const dryBushGeo = mergeGeos(Array.from({ length: 7 }, (_, i) => ({ geo: new THREE.CylinderGeometry(0.012, 0.03, 0.9 + (i % 3) * 0.25, 3).translate(0, 0.45, 0).rotateZ(0.5 + (i % 2) * 0.3).rotateY(i * 0.9), color: 0x6a5536 })));
  const boneGeo = mergeGeos([
    { geo: new THREE.SphereGeometry(0.12, 6, 5).scale(1, 0.85, 1.2).translate(0, 0.08, 0), color: 0xd8d0bc },
    ...Array.from({ length: 5 }, (_, i) => ({ geo: new THREE.TorusGeometry(0.16, 0.015, 3, 8, Math.PI).rotateY(Math.PI / 2).translate(0, 0.02, 0.35 + i * 0.07), color: 0xcfc6b0 })),
    { geo: new THREE.CylinderGeometry(0.025, 0.025, 0.6, 4).rotateZ(Math.PI / 2).translate(0.25, 0.02, 0.6), color: 0xd8d0bc },
    { geo: new THREE.CylinderGeometry(0.025, 0.025, 0.5, 4).rotateX(Math.PI / 2).rotateY(0.6).translate(-0.2, 0.02, 0.8), color: 0xd8d0bc },
  ]);
  const whiteRockGeo = part(new THREE.DodecahedronGeometry(1, 0), null, 0xffffff);
  const pillarGeo = mergeGeos([{ geo: new THREE.CylinderGeometry(0.9, 1, 1, 9).translate(0, 0.5, 0), color: 0xffffff }, { geo: new THREE.BoxGeometry(2.2, 0.12, 2.2).translate(0, 0.06, 0), color: 0xe8e0d0 }]);
  const ruinGeo = part(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), null, 0xffffff);

  const cabinMat = new THREE.MeshLambertMaterial({ map: woodTex([110, 75, 45]), color: 0xb0a090 });
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xffb35a });

  // ------------------------------------------------------------ houses + villages (global skeleton content)
  W.cabinSpots = [
    { x: CABIN.x + 1.4, z: CABIN.z - 1.4, y: 0.95, type: 'ammo' },
    { x: CABIN.x - 2.4, z: CABIN.z + 1.2, y: 0.12, type: 'med' },
    { x: CABIN.x + 2.7, z: CABIN.z + 1.9, y: 0.76, type: 'battery' },
  ];
  W.campSpots = [{ x: CAMP.x - 2.6, z: CAMP.z + 1.2, type: 'ammo' }, { x: CAMP.x + 2.4, z: CAMP.z + 2.4, type: 'med' }];

  function addHouse(h) {
    h.y = hgt(h.x, h.z);
    const c = Math.round(Math.cos(h.ry)), s = Math.round(Math.sin(h.ry));
    const toW = (lx, lz) => [h.x + lx * c + lz * s, h.z - lx * s + lz * c];
    const t = 0.3, dw = 1.7, sw = (h.w - dw) / 2;
    h.walls = [[0, -h.d / 2 + t / 2, h.w, t], [-h.w / 2 + t / 2, 0, t, h.d], [h.w / 2 - t / 2, 0, t, h.d], [-(dw / 2 + sw / 2), h.d / 2 - t / 2, sw, t], [dw / 2 + sw / 2, h.d / 2 - t / 2, sw, t]];
    for (const [lx, lz, ww, dd] of h.walls) {
      const [wx, wz] = toW(lx, lz);
      const ex = Math.abs(c) ? ww / 2 : dd / 2, ez = Math.abs(c) ? dd / 2 : ww / 2;
      addBox(wx - ex, wx + ex, wz - ez, wz + ez, h.y - 0.5, h.y + h.ht);
    }
    const ex = Math.abs(c) ? h.w / 2 : h.d / 2, ez = Math.abs(c) ? h.d / 2 : h.w / 2;
    const bb = { x0: h.x - ex, x1: h.x + ex, z0: h.z - ez, z1: h.z + ez, h };
    h.bb = bb; h.toW = toW;
    const c0 = clamp(Math.floor((bb.x0 - 3 + HALF) / CH), 0, NCH - 1), c1 = clamp(Math.floor((bb.x1 + 3 + HALF) / CH), 0, NCH - 1);
    const r0 = clamp(Math.floor((bb.z0 - 3 + HALF) / CH), 0, NCH - 1), r1 = clamp(Math.floor((bb.z1 + 3 + HALF) / CH), 0, NCH - 1);
    for (let r = r0; r <= r1; r++) for (let q = c0; q <= c1; q++) { const k = r * NCH + q; (houseByChunk.get(k) || houseByChunk.set(k, []).get(k)).push(bb); }
    S(chunkIdx(h.x, h.z)).props.push({ type: 'house', h });
    return h;
  }
  const cabin = addHouse({ x: CABIN.x, z: CABIN.z, ry: 0, w: 7, d: 6, ht: 2.9, cabin: true });
  addBox(CABIN.x + 2.3, CABIN.x + 3.1, CABIN.z + 1.5, CABIN.z + 2.3, cabin.y, cabin.y + 0.8);
  addBox(CABIN.x - 2.95, CABIN.x - 1.85, CABIN.z - 2.75, CABIN.z - 0.65, cabin.y, cabin.y + 0.6);
  addBox(CABIN.x + 0.65, CABIN.x + 2.15, CABIN.z - 1.85, CABIN.z - 0.95, cabin.y, cabin.y + 0.9);
  addBox(CABIN.x + 3.45, CABIN.x + 4.35, CABIN.z - 0.95, CABIN.z - 0.05, cabin.y, cabin.y + 5, 'rock');

  for (const v of VILLAGES) {
    const rng = seeded(v.idx, 77, 5), R = (a, b) => a + rng() * (b - a);
    v.y = hgt(v.x, v.z);
    const n = v.nh + (rng() < 0.5 ? 1 : 0), a0 = rng() * 6.28;
    for (let i = 0; i < n; i++) {
      let x = 0, z = 0, a = 0;
      for (let att = 0; att < 6; att++) {
        a = a0 + (i / n) * Math.PI * 2 + R(-0.15, 0.15) + att * 0.22;
        const r = R(v.houseR[0], v.houseR[1]); x = v.x + Math.cos(a) * r; z = v.z + Math.sin(a) * r;
        if (pathDist(x, z) > 7) break;
      }
      const ry = Math.round(Math.atan2(v.x - x, v.z - z) / (Math.PI / 2)) * (Math.PI / 2);
      const h = addHouse({ x, z, ry, w: R(6, 8), d: R(5, 6.2), ht: R(2.6, 3.1), broken: rng() < 0.35, village: v });
      const nl = 1 + (rng() < 0.6 ? 1 : 0);
      for (let k = 0; k < nl; k++) {
        const [lx, lz] = h.toW(R(-h.w / 2 + 1, h.w / 2 - 1), R(-h.d / 2 + 1, h.d / 2 - 1.6));
        const roll = rng();
        S(chunkIdx(lx, lz)).loot.push({ x: lx, z: lz, y: h.y + 0.12, type: k === 0 || roll < 0.5 ? 'battery' : roll < 0.8 ? 'ammo' : 'med' });
      }
      const [bx, bz] = h.toW(R(-1, 1), R(-1, 1)); S(chunkIdx(bx, bz)).blood.push({ x: bx, z: bz, s: R(1.2, 2.2), a: R(0, 6.28), y: h.y + 0.1 });
      if (rng() < 0.5) { const [cx2, cz2] = h.toW(R(-1.5, 1.5), R(-1, 0.5)); S(chunkIdx(cx2, cz2)).props.push({ type: 'corpse', x: cx2, z: cz2, y: h.y + 0.08, yaw: R(0, 6.28) }); }
      if (rng() < 0.4) S(chunkIdx(x, z)).owl.push({ x, z, y: h.y + h.ht + 1.3, yaw: ry });
    }
    S(chunkIdx(v.x, v.z)).props.push({ type: 'well', x: v.x, z: v.z, y: v.y });
    for (let i = 0; i < 9; i++) {
      const a = rng() * 6.28, r = R(3, v.small ? 9 : 14), x = v.x + Math.cos(a) * r, z = v.z + Math.sin(a) * r;
      if (W.inBuilding(x, z, 0.5)) continue;
      S(chunkIdx(x, z)).props.push({ type: 'corpse', x, z, y: hgt(x, z), yaw: R(0, 6.28) });
      S(chunkIdx(x, z)).blood.push({ x, z, s: R(1.5, 3), a: R(0, 6.28) });
      v.corpses.push({ x, z });
    }
    // lanterns around the well
    for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI * 2 + 0.5, x = v.x + Math.cos(a) * 5.5, z = v.z + Math.sin(a) * 5.5; S(chunkIdx(x, z)).lanterns.push({ x, z, a: a + Math.PI, lit: rng() < 0.85 }); }
    for (let i = 0; i < 22; i++) { const a = rng() * 6.28, r = R(0, v.small ? 18 : 26), x = v.x + Math.cos(a) * r, z = v.z + Math.sin(a) * r; S(chunkIdx(x, z)).blood.push({ x, z, s: R(0.8, 2.6), a: R(0, 6.28) }); }
  }

  // ------------------------------------------------------------ per-chunk procedural content
  const nearSite = (x, z, pad = 0) => Math.hypot(x - CABIN.x, z - CABIN.z) < 11 + pad || Math.hypot(x - CAMP.x, z - CAMP.z) < 10 + pad || villageDist(x, z) < 36 + pad;
  const genList = new Set();
  const extraCircles = [];                     // fixed-position colliders (campsite) re-applied whenever a chunk is regenerated
  const BW = {};
  const fw = (x, z) => 1 - desertWeight(x, z);
  const nearStructure = (x, z, pad = 0) => {
    const G = DESERT_PLAN.great;
    if (Math.max(Math.abs(x - G.x), Math.abs(z - G.z)) < G.A + 40 + pad) return true;
    for (const s of DESERT_PLAN.smalls) if (Math.max(Math.abs(x - s.x), Math.abs(z - s.z)) < 30 + pad) return true;
    for (const s of DESERT_PLAN.camps) if (Math.hypot(x - s.x, z - s.z) < 24 + pad) return true;
    for (const s of DESERT_PLAN.settlements) if (Math.hypot(x - s.x, z - s.z) < 32 + pad) return true;
    return false;
  };
  function genChunk(cx, cz) {
    const ci = cz * NCH + cx, x0 = -HALF + cx * CH, z0 = -HALF + cz * CH, st = statics.get(ci);
    const rng = seeded(cx, cz, 1), R = (a, b) => a + rng() * (b - a);
    const cd = {
      cx, cz, ci, trees: [], bushes: [], rocks: [], logs: [], reeds: [], deadTrees: [], dryBushes: [], bones: [], pillars: [], ruins: [], drocks: [], hangers: [],
      blood: st ? st.blood.slice() : [], props: st ? st.props.slice() : [], loot: st ? st.loot.slice() : [], owl: st ? st.owl.slice() : [], nests: st ? st.nests.slice() : [], lanterns: st ? st.lanterns.slice() : [],
      cells: Array.from({ length: CPC * CPC }, () => []),
    };
    const inX = (x) => Math.min(Math.max(x, x0), x0 + CH - 0.01), inZ = (z) => Math.min(Math.max(z, z0), z0 + CH - 0.01);
    const midX = x0 + CH / 2, midZ = z0 + CH / 2, db = darkBlob(midX, midZ);
    for (const p of cd.props) if (p.type === 'well') addCircle(cd, p.x, p.z, 1.3, 1.0, 'rock');
    for (const e of extraCircles) if (e.x >= x0 && e.x < x0 + CH && e.z >= z0 && e.z < z0 + CH) addCircle(cd, e.x, e.z, e.r, e.h, e.kind);
    // which biome generators touch this chunk?
    let maxF = 0, maxD = 0, maxR = 0;
    for (const [sx, sz] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.5]]) {
      biomeWeights(x0 + sx * CH, z0 + sz * CH, BW);
      maxD = Math.max(maxD, BW.desert); maxF = Math.max(maxF, 1 - BW.desert); maxR = Math.max(maxR, BW.hanging);
    }
    cd.biome = dominantBiome(midX, midZ).id;
    if (maxF > 0.001) GEN.forest(cd, rng, R, x0, z0, inX, inZ, midX, midZ, db);
    if (maxR > 0.001) GEN.hanging(cd, rng, R, x0, z0, inX, inZ);
    if (maxD > 0.001) GEN.desert(cd, rng, R, x0, z0, inX, inZ);
    genList.add(ci);
    return cd;
  }
  // biome content generators (looked up by the biome config's `generator` name)
  const GEN = {
    forest(cd, rng, R, x0, z0, inX, inZ, midX, midZ, db) {
      // trees: jittered grid; dense forest regions get more trees
      const TC = 4.6;
      for (let gz = z0; gz < z0 + CH; gz += TC) for (let gx = x0; gx < x0 + CH; gx += TC) {
        const dn = denseF(gx, gz), edge = smoothstep(HALF - 60, HALF - 10, Math.max(Math.abs(gx), Math.abs(gz)));
        const tries = dn > 0.4 || edge > 0 ? 2 : 1;
        for (let k = 0; k < tries; k++) {
          const p = k === 0 ? 0.14 + dn * 0.38 + edge * 0.6 : dn * 0.4 + edge * 0.5;
          if (rng() > p) continue;
          const x = inX(gx + rng() * TC), z = inZ(gz + rng() * TC);
          if (rng() > fw(x, z) * (1 - ringWeight(x, z))) continue;
          if (nearSite(x, z, 2) || pathDist(x, z) < 3 || clearingDist(x, z) < 0 || wet(x, z, 0.6)) continue;
          const s = R(0.75, 1.5) * (1 + dn * 0.25), q = rng();
          const tree = { x, z, s, q, ry: R(0, 6.28), tx: R(-0.04, 0.04), tz: R(-0.04, 0.04), tint: R(0.7, 1.15) * (1 - dn * 0.25) };
          const deep = deepForest(x, z);
          if (deep > hash2(x, z, 211)) {
            if (Math.sin(x * 0.084) * Math.cos(z * 0.076) > 0.78) continue;
            if (k !== 0 || hash2(x, z, 241) > 0.32 || pathDist(x, z) < 5) continue;
            tree.radius = 1 + hash2(x, z, 251) * 1.5;
            tree.height = 25 + hash2(x, z, 281) * 35;
            tree.tx *= 0.3;
            tree.tz *= 0.3;
          }
          if (W.railway?.treeClear(x, z)) continue;
          cd.trees.push(tree);
          addCircle(cd, x, z, tree.radius ?? 0.38 * s, tree.height ?? 16 * s, 'wood', q);
          if (tree.radius) for (let i = 0; i < 3; i++) {
            const a = i * 2.39996 - tree.ry;
            const rx = x + Math.cos(a) * tree.radius * 1.8, rz = z + Math.sin(a) * tree.radius * 1.8;
            if (rx >= x0 && rx < x0 + CH && rz >= z0 && rz < z0 + CH && pathDist(rx, rz) > 2.5) {
              addCircle(cd, rx, rz, tree.radius * 0.45, Math.min(0.6, tree.height * 0.019), 'wood', q);
            }
          }
        }
      }
      // bushes
      for (let i = 0; i < 72; i++) {
        const x = R(x0, x0 + CH - 0.01), z = R(z0, z0 + CH - 0.01), dn = denseF(x, z);
        if (rng() > (0.45 + dn * 0.55) * fw(x, z) || W.inBuilding(x, z, 1) || Math.hypot(x - CAMP.x, z - CAMP.z) < 5 || pathDist(x, z) < 1.6 || wet(x, z, 0.2)) continue;
        cd.bushes.push({ x, z, s: R(0.8, 1.9) * (1 + deepForest(x, z) * 0.8), a: R(0, 6.28), t: R(0.7, 1.2) * (1 - dn * 0.3) });
      }
      // rocks
      for (let i = 0; i < 9; i++) {
        const x = R(x0 + 2, x0 + CH - 2), z = R(z0 + 2, z0 + CH - 2);
        if (nearSite(x, z) || pathDist(x, z) < 2.5 || W.inBuilding(x, z, 2) || fw(x, z) < 0.5) continue;
        const s = R(0.5, 1.8), sx = s * R(0.9, 1.6), sy = s * R(0.55, 1.1);
        const rock = { x, z, sx, sy, sz: sx * R(0.8, 1.2), e: [R(-0.3, 0.3), R(0, 6.28), R(-0.3, 0.3)], t: R(0.6, 1.2) };
        if (W.railway?.treeClear(x, z)) continue;
        cd.rocks.push(rock);
        addCircle(cd, x, z, sx * 0.82, sy * 1.2, 'rock');
      }
      // fallen logs
      for (let i = 0; i < 3; i++) {
        const x = R(x0 + 4, x0 + CH - 4), z = R(z0 + 4, z0 + CH - 4);
        if (rng() < 0.3 || nearSite(x, z) || pathDist(x, z) < 3 || wet(x, z, 0.3) || fw(x, z) < 0.5) continue;
        const a = R(0, Math.PI);
        const scale = deepForest(x, z) > 0.55 && pathDist(x, z) > 11 &&
          Math.min(x - x0, x0 + CH - x, z - z0, z0 + CH - z) > 9 ? 3.2 : 1;
        const along = scale > 1 ? [-6.4, -4.8, -3.2, -1.6, 0, 1.6, 3.2, 4.8, 6.4] : [-1.5, 0, 1.5];
        const clear = along.every((o) => pathDist(x + Math.cos(a) * o, z - Math.sin(a) * o) > 2.8);
        const size = clear ? scale : 1;
        if (W.railway?.treeClear(x, z)) continue;
        cd.logs.push({ x, z, a, size });
        for (const o of size > 1 ? along : [-1.5, 0, 1.5]) {
          const lx = x + Math.cos(a) * o, lz = z - Math.sin(a) * o;
          if (lx >= x0 && lx < x0 + CH && lz >= z0 && lz < z0 + CH) addCircle(cd, lx, lz, 0.4 * size, 0.7 * size, 'wood');
        }
      }
      // reeds around water
      if (waterNear(midX, midZ, 110)) {
        for (let i = 0; i < 500; i++) {
          const x = R(x0, x0 + CH - 0.01), z = R(z0, z0 + CH - 0.01), h = hgt(x, z);
          if (h > -0.4 && h < 0.8 && rng() < 0.3) cd.reeds.push({ x, z, s: R(0.7, 1.4), a: R(0, 6.28) });
        }
      }
      // hanged people on dead trees (more in dark sectors)
      const nh = (rng() < 0.03 + db * 0.3 ? 1 : 0) + (rng() < db * 0.25 ? 1 : 0);
      for (let i = 0; i < nh; i++) for (let att = 0; att < 10; att++) {
        const x = R(x0 + 6, x0 + CH - 6), z = R(z0 + 6, z0 + CH - 6);
        if (nearSite(x, z, -6) || pathDist(x, z) < 3.5 || wet(x, z, 0.5) || Math.hypot(x - SPAWN.x, z - SPAWN.z) < 45 || fw(x, z) < 0.6) continue;
        const yaw = R(0, 6.28);
        cd.props.push({ type: 'hang', x, z, y: hgt(x, z), yaw, ph: R(0, 6.28) });
        addCircle(cd, x, z, 0.38, 8, 'wood');
        for (let k = 0; k < 2; k++) cd.blood.push({ x: inX(x + Math.cos(yaw) * 2 + R(-1, 1)), z: inZ(z - Math.sin(yaw) * 2 + R(-1, 1)), s: R(0.7, 1.6), a: R(0, 6.28) });
        if (rng() < 0.5) cd.owl.push({ x, z, y: hgt(x, z) + 6.1, yaw: R(0, 6) });
        break;
      }
      // scattered corpses
      const nc = Math.floor(rng() * (0.5 + db * 3.2));
      for (let i = 0; i < nc; i++) {
        const x = R(x0 + 3, x0 + CH - 3), z = R(z0 + 3, z0 + CH - 3);
        if (wet(x, z, 0.3) || W.inBuilding(x, z, 1) || Math.hypot(x - SPAWN.x, z - SPAWN.z) < 35 || fw(x, z) < 0.6) continue;
        cd.props.push({ type: 'corpse', x, z, y: hgt(x, z), yaw: R(0, 6.28) });
        cd.blood.push({ x, z, s: R(1.4, 2.8), a: R(0, 6.28) });
      }
      // random blood
      const nb = 9 + Math.floor(rng() * 8 + db * 10);
      for (let i = 0; i < nb; i++) {
        const x = R(x0, x0 + CH - 0.01), z = R(z0, z0 + CH - 0.01);
        if (wet(x, z) || W.inBuilding(x, z) || Math.hypot(x - SPAWN.x, z - SPAWN.z) < 25 || rng() > fw(x, z)) continue;
        cd.blood.push({ x, z, s: R(0.5, 2.2), a: R(0, 6.28) });
      }
      // old lanterns along the roads (and a few lost in the trees)
      for (const sg of W.pathsInChunk(cd.cx, cd.cz)) {
        const len = Math.hypot(sg[2] - sg[0], sg[3] - sg[1]), dx = (sg[2] - sg[0]) / len, dz = (sg[3] - sg[1]) / len;
        for (let t = 16; t < len; t += 34) {
          const side = ((t / 34) | 0) % 2 ? 1 : -1, x = sg[0] + dx * t - dz * 2.8 * side, z = sg[1] + dz * t + dx * 2.8 * side;
          if (x < x0 || x >= x0 + CH || z < z0 || z >= z0 + CH || fw(x, z) < 0.7 || ringWeight(x, z) > 0.2 || wet(x, z, 0.3) || W.inBuilding(x, z, 1)) continue;
          cd.lanterns.push({ x, z, a: Math.atan2(dz * side, -dx * side) + Math.PI / 2, lit: rng() < 0.75 });
        }
      }
      if (rng() < 0.2) { const x = R(x0 + 4, x0 + CH - 4), z = R(z0 + 4, z0 + CH - 4); if (fw(x, z) > 0.8 && ringWeight(x, z) < 0.1 && !wet(x, z, 0.3)) cd.lanterns.push({ x, z, a: R(0, 6.28), lit: rng() < 0.5 }); }
      // forest loot (ammo / medkit / battery)
      if (rng() < 0.3) {
        for (let att = 0; att < 8; att++) {
          const x = R(x0 + 3, x0 + CH - 3), z = R(z0 + 3, z0 + CH - 3);
          if (wet(x, z, 0.4) || W.inBuilding(x, z, 1) || fw(x, z) < 0.6) continue;
          const r = rng();
          cd.loot.push({ x, z, y: hgt(x, z), type: r < 0.5 ? 'ammo' : r < 0.78 ? 'med' : 'battery' });
          break;
        }
      }
    },
    hanging(cd, rng, R, x0, z0, inX, inZ) {
      // THE HANGING WOODS: very dense pines and twisted dead trees, with winding trails through
      const TC = 3.0;
      for (let gz = z0; gz < z0 + CH; gz += TC) for (let gx = x0; gx < x0 + CH; gx += TC) {
        const rw = ringWeight(gx, gz);
        if (rw < 0.05 || rng() > 0.8 * rw) continue;
        const x = inX(gx + rng() * TC), z = inZ(gz + rng() * TC);
        if (trailDist(x, z) < 3.2 || pathDist(x, z) < 3.5 || wet(x, z, 0.3) || nearSite(x, z, 2)) continue;
        if (rng() < 0.38) { const s = R(0.8, 1.3); cd.deadTrees.push({ x, z, s, ry: R(0, 6.28), tx: R(-0.12, 0.12), tz: R(-0.12, 0.12), tint: R(0.5, 0.9) }); addCircle(cd, x, z, 0.33 * s, 9 * s, 'wood'); }
        else { const s = R(0.9, 1.6), q = rng() * 0.5; cd.trees.push({ x, z, s, q, ry: R(0, 6.28), tx: R(-0.05, 0.05), tz: R(-0.05, 0.05), tint: R(0.4, 0.65) }); addCircle(cd, x, z, 0.38 * s, 16 * s, 'wood', q); }
      }
      const rwc = ringWeight(x0 + CH / 2, z0 + CH / 2);
      // hanged corpses swinging from dead trees
      const nh = Math.round(rwc * (2 + rng() * 3));
      for (let i = 0; i < nh; i++) for (let att = 0; att < 8; att++) {
        const x = R(x0 + 5, x0 + CH - 5), z = R(z0 + 5, z0 + CH - 5);
        if (ringWeight(x, z) < 0.4 || trailDist(x, z) < 4 || pathDist(x, z) < 4 || wet(x, z, 0.5)) continue;
        cd.props.push({ type: 'hang', x, z, y: hgt(x, z), yaw: R(0, 6.28), ph: R(0, 6.28) });
        addCircle(cd, x, z, 0.38, 8, 'wood');
        cd.blood.push({ x: inX(x + R(-2, 2)), z: inZ(z + R(-2, 2)), s: R(0.7, 1.6), a: R(0, 6.28) });
        break;
      }
      // the Hanging Dead: hostile, guarding the trails
      const nd = Math.round(rwc * (1 + rng() * 2.4));
      for (let k = 0; k < nd; k++) for (let att = 0; att < 10; att++) {
        const x = R(x0 + 4, x0 + CH - 4), z = R(z0 + 4, z0 + CH - 4), td = trailDist(x, z);
        if (ringWeight(x, z) < 0.5 || td < 5 || td > 22 || pathDist(x, z) < 4 || wet(x, z, 0.5)) continue;
        cd.hangers.push({ id: cd.ci + ':h' + k, x, z, y: hgt(x, z), yaw: R(0, 6.28) });
        addCircle(cd, x, z, 0.38, 8, 'wood');
        break;
      }
      for (let i = 0; i < 10 * rwc; i++) { const x = R(x0, x0 + CH - 0.01), z = R(z0, z0 + CH - 0.01); if (!wet(x, z)) cd.blood.push({ x, z, s: R(0.5, 2), a: R(0, 6.28) }); }
    },
    desert(cd, rng, R, x0, z0, inX, inZ) {
      const ok = (x, z, pad = 0) => desertWeight(x, z) > rng() && !nearStructure(x, z, pad) && !W.inBuilding(x, z, 2) && !wet(x, z, 0.3) && ringWeight(x, z) < 0.3;
      const sand = () => { const k = R(0.85, 1.1); return [0.62 * k, 0.5 * k, 0.35 * k]; };
      for (let i = 0; i < 26; i++) { const x = R(x0, x0 + CH - 0.01), z = R(z0, z0 + CH - 0.01); if (ok(x, z)) cd.dryBushes.push({ x, z, s: R(0.6, 1.4), a: R(0, 6.28) }); }
      for (let i = 0; i < 6; i++) {
        const x = R(x0 + 2, x0 + CH - 2), z = R(z0 + 2, z0 + CH - 2);
        if (!ok(x, z, 2)) continue;
        const s = R(0.5, 1.6), sx = s * R(1, 1.7), sy = s * R(0.5, 1.0);
        cd.drocks.push({ x, z, sx, sy, sz: sx * R(0.7, 1.2), e: [R(-0.3, 0.3), R(0, 6.28), R(-0.3, 0.3)], col: sand() });
        addCircle(cd, x, z, sx * 0.8, sy * 1.2, 'rock');
      }
      if (rng() < 0.2) { // rock formation
        const fx = R(x0 + 15, x0 + CH - 15), fz = R(z0 + 15, z0 + CH - 15);
        if (ok(fx, fz, 10)) for (let k = 0; k < 5; k++) {
          const x = inX(fx + R(-6, 6)), z = inZ(fz + R(-6, 6)), s = R(2, 4.5), sy = s * R(0.8, 1.8);
          cd.drocks.push({ x, z, sx: s, sy, sz: s * R(0.7, 1.2), e: [R(-0.2, 0.2), R(0, 6.28), R(-0.2, 0.2)], col: sand() });
          addCircle(cd, x, z, s * 0.8, sy * 1.2, 'rock');
        }
      }
      for (let i = 0; i < 5; i++) { const x = R(x0, x0 + CH - 0.01), z = R(z0, z0 + CH - 0.01); if (ok(x, z)) cd.bones.push({ x, z, a: R(0, 6.28), s: R(0.8, 1.3) }); }
      if (rng() < 0.25) { const x = R(x0 + 3, x0 + CH - 3), z = R(z0 + 3, z0 + CH - 3); if (ok(x, z, 2)) { const s = R(0.7, 1.1); cd.deadTrees.push({ x, z, s, ry: R(0, 6.28), tx: 0, tz: 0, tint: 0.9 }); addCircle(cd, x, z, 0.3 * s, 8 * s, 'wood'); } }
      // ancient ruins: broken walls + pillars (sand zombies hide near them)
      if (rng() < 0.14) {
        const rx = R(x0 + 20, x0 + CH - 20), rz = R(z0 + 20, z0 + CH - 20);
        if (ok(rx, rz, 15) && pathDist(rx, rz) > 8) {
          const a0 = R(0, Math.PI), nw = 3 + Math.floor(rng() * 4);
          for (let k = 0; k < nw; k++) {
            const a = a0 + (k % 2) * Math.PI / 2, x = rx + R(-9, 9), z = rz + R(-9, 9), w = R(2.5, 6), h = R(1, 3.6);
            cd.ruins.push({ x, z, a, w, h, d: 0.8 });
            for (let o = -w / 2 + 0.6; o <= w / 2 - 0.6; o += 1.2) { const px = inX(x + Math.cos(a) * o), pz = inZ(z - Math.sin(a) * o); addCircle(cd, px, pz, 0.6, h, 'rock'); }
          }
          for (let k = 0; k < 2 + Math.floor(rng() * 4); k++) {
            const x = inX(rx + R(-10, 10)), z = inZ(rz + R(-10, 10)), r = R(0.45, 0.75), h = R(1.2, 5.5);
            cd.pillars.push({ x, z, r, h, tilt: rng() < 0.3 ? R(-0.25, 0.25) : 0, a: R(0, 6.28) });
            addCircle(cd, x, z, r, h, 'rock');
          }
          for (let k = 0; k < 1 + Math.floor(rng() * 2); k++) cd.nests.push({ x: rx + R(-8, 8), z: rz + R(-8, 8) });
        }
      }
      if (rng() < 0.22) { const x = R(x0 + 5, x0 + CH - 5), z = R(z0 + 5, z0 + CH - 5); if (ok(x, z, 6)) cd.nests.push({ x, z }); }
    },
  };

  function getCD(cx, cz) { const ci = cz * NCH + cx; return cdata[ci] || (cdata[ci] = genChunk(cx, cz)); }
  W.getChunkData = getCD;
  const desert = createDesert({ scene, plan: DESERT_PLAN, hgt, addBox, addStaticCircle: (x, z, r, h, kind) => extraCircles.push({ x, z, r, h, kind }), S, chunkIdx, addHouse });
  W.desert = desert;
  desert.extraFlames = () => W.lanternSprites;
  W.shared = { deadTreeGeo, vcMat };
  W.biomeWeights = biomeWeights; W.desertWeight = desertWeight; W.ringWeight = ringWeight; W.dominantBiome = dominantBiome; W.atmosphereAt = atmosphereAt; W.edgeDist = edgeDist;
  W.ceilingAt = desert.ceilingAt;

  // ------------------------------------------------------------ terrain colouring
  const C = {
    g1: new THREE.Color(0x16240f), g2: new THREE.Color(0x26381a), dense: new THREE.Color(0x0c160a), dead: new THREE.Color(0x2a271c),
    dirt: new THREE.Color(0x4a3a2a), sandLow: new THREE.Color(0x8a6c46), sandHigh: new THREE.Color(0xc4a272), sandPath: new THREE.Color(0x6e5638), ring: new THREE.Color(0x0d0f0a), clr: new THREE.Color(0x2c3a1c), mud: new THREE.Color(0x2a2219), bed: new THREE.Color(0x15120d), vill: new THREE.Color(0x3a3024),
  };
  const tc = new THREE.Color(), tc2 = new THREE.Color();
  W.canopyCover = deepForest;
  function groundColor(x, z, h, out) {
    const n = 0.5 + 0.5 * Math.sin(x * 0.21) * Math.sin(z * 0.17) + (hash2(x * 3, z * 3) - 0.5) * 0.35;
    out.copy(C.g1).lerp(C.g2, clamp(n, 0, 1));
    const dn = denseF(x, z); if (dn > 0) out.lerp(C.dense, dn * 0.55);
    out.multiplyScalar(1 - deepForest(x, z) * 0.28);
    const db = darkBlob(x, z); if (db > 0) out.lerp(C.dead, db * 0.55);
    const cd = clearingDist(x, z); if (cd < 0) out.lerp(C.clr, 0.6 * smoothstep(0, -6, cd));
    const vd = villageDist(x, z); if (vd < 34) out.lerp(C.vill, 0.85 * (1 - smoothstep(18, 34, vd + (hash2(x, z, 4) - 0.5) * 8)));
    const pd = pathDist(x, z);
    if (pd < 4) out.lerp(C.dirt, 0.95 * (1 - smoothstep(1.2, 3.0, pd + (hash2(x * 2, z * 2) - 0.5) * 1.2)));
    const dc = Math.hypot(x - CAMP.x, z - CAMP.z); if (dc < 9) out.lerp(C.dirt, 0.8 * (1 - smoothstep(3, 9, dc)));
    if (h < 0.9) out.lerp(C.mud, clamp((0.9 - h) / 0.9, 0, 1));
    if (h < 0) out.lerp(C.bed, clamp(-h, 0, 1));
    const dw = desertWeight(x, z);
    if (dw > 0) {
      tc2.copy(C.sandLow).lerp(C.sandHigh, clamp((h - 3) / 14 + (hash2(x * 1.7, z * 1.7) - 0.5) * 0.18, 0, 1));
      if (pd < 3.5) tc2.lerp(C.sandPath, 0.75 * (1 - smoothstep(1.5, 3.5, pd)));
      out.lerp(tc2, dw);
    }
    const rw = ringWeight(x, z); if (rw > 0) out.lerp(C.ring, rw * 0.8);
    return out;
  }
  W.mapColor = (x, z) => {
    const h = hgt(x, z);
    if (h < -0.05) return [18, 38, 54];
    groundColor(x, z, h, tc);
    const k = 1.75;
    return [Math.min(255, Math.pow(tc.r, 1 / 2.2) * 255 * k), Math.min(255, Math.pow(tc.g, 1 / 2.2) * 255 * k), Math.min(255, Math.pow(tc.b, 1 / 2.2) * 255 * k)];
  };

  // ------------------------------------------------------------ chunk meshes
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), e4 = new THREE.Euler(), p4 = new THREE.Vector3(), s4 = new THREE.Vector3(), c4 = new THREE.Color(), UP = new THREE.Vector3(0, 1, 0);
  W.shadows = true;
  function inst(geo, mat, list, fill, shadow = true) {
    if (!list.length) return null;
    const m = new THREE.InstancedMesh(geo, mat, list.length);
    let n = 0;
    for (const it of list) if (fill(it, n)) { m.setMatrixAt(n, m4); if (m.instanceColor || it.__c) m.setColorAt(n, c4); n++; }
    m.count = n;
    if (!n) { m.dispose(); return null; }
    m.castShadow = shadow; m.receiveShadow = true;
    m.computeBoundingSphere();
    return m;
  }
  function buildTerrain(cx, cz) {
    const seg = 40, x0 = -HALF + cx * CH, z0 = -HALF + cz * CH;
    const g = new THREE.PlaneGeometry(CH, CH, seg, seg); g.rotateX(-Math.PI / 2); g.translate(x0 + CH / 2, 0, z0 + CH / 2);
    const p = g.attributes.position, nrm = g.attributes.normal, uv = g.attributes.uv, cols = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), h = hgt(x, z);
      p.setY(i, h);
      const e = 1.0, nx = hgt(x - e, z) - hgt(x + e, z), nz = hgt(x, z - e) - hgt(x, z + e), l = Math.hypot(nx, 2 * e, nz);
      nrm.setXYZ(i, nx / l, 2 * e / l, nz / l);
      uv.setXY(i, x * 0.8, z * 0.8);
      groundColor(x, z, h, tc);
      cols[i * 3] = tc.r; cols[i * 3 + 1] = tc.g; cols[i * 3 + 2] = tc.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, groundMat); m.receiveShadow = true; m.userData.own = true;
    return m;
  }
  function buildWater(cx, cz) {
    const cs = 4, n = CH / cs, x0 = -HALF + cx * CH, z0 = -HALF + cz * CH, pos = [];
    if (!waterNear(x0 + CH / 2, z0 + CH / 2, 90)) return null;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const xa = x0 + i * cs, za = z0 + j * cs, xb = xa + cs, zb = za + cs;
      if (Math.min(hgt(xa, za), hgt(xb, za), hgt(xa, zb), hgt(xb, zb), hgt(xa + cs / 2, za + cs / 2)) > WATER_Y + 0.05) continue;
      pos.push(xa, WATER_Y, za, xa, WATER_Y, zb, xb, WATER_Y, zb, xa, WATER_Y, za, xb, WATER_Y, zb, xb, WATER_Y, za);
    }
    if (!pos.length) return null;
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const nr = new Float32Array(pos.length); for (let i = 1; i < nr.length; i += 3) nr[i] = 1; g.setAttribute('normal', new THREE.BufferAttribute(nr, 3));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, waterMat); m.userData.own = true;
    return m;
  }
  function buildHouseMesh(h) {
    const grp = new THREE.Group(); grp.position.set(h.x, h.y, h.z); grp.rotation.y = h.ry;
    const t = 0.3, dw = 1.7, sw = (h.w - dw) / 2, Ht = h.ht, Wd = h.w, D = h.d;
    const walls = [];
    const wb = (w, hh, d, x, y, z) => { const g = boxUV(w, hh, d); g.translate(x, y, z); walls.push(g); };
    wb(Wd, Ht, t, 0, Ht / 2, -D / 2 + t / 2); wb(t, Ht, D, -Wd / 2 + t / 2, Ht / 2, 0); wb(t, Ht, D, Wd / 2 - t / 2, Ht / 2, 0);
    wb(sw, Ht, t, -(dw / 2 + sw / 2), Ht / 2, D / 2 - t / 2); wb(sw, Ht, t, dw / 2 + sw / 2, Ht / 2, D / 2 - t / 2);
    wb(dw, Ht - 2.15, t, 0, 2.15 + (Ht - 2.15) / 2, D / 2 - t / 2);
    wb(Wd - 0.2, 0.08, D - 0.2, 0, 0.04, 0);
    const wm = new THREE.Mesh(mergeUV(walls), h.cabin ? cabinMat : h.adobe ? adobeMat : wallMat);
    wm.castShadow = true; wm.receiveShadow = true; wm.userData.own = true; grp.add(wm);
    const parts = [];
    const hd = D / 2 + 0.5, ang = 0.55, slope = hd / Math.cos(ang), rise = hd * Math.tan(ang);
    if (h.adobe) { // flat mud-brick roof with a low parapet
      parts.push({ geo: new THREE.BoxGeometry(Wd + 0.3, 0.3, D + 0.3).translate(0, Ht + 0.15, 0), color: 0x7a6448 });
      for (const [px, pz, pw, pd2] of [[0, D / 2, Wd + 0.3, 0.25], [0, -D / 2, Wd + 0.3, 0.25], [Wd / 2, 0, 0.25, D], [-Wd / 2, 0, 0.25, D]]) parts.push({ geo: new THREE.BoxGeometry(pw, 0.5, pd2).translate(px, Ht + 0.5, pz), color: 0x8a7254 });
    }
    for (const sgn of h.adobe ? [] : [1, -1]) {
      if (h.broken && sgn === -1) {
        for (let k = 0; k < 3; k++) parts.push({ geo: new THREE.BoxGeometry(0.25, 0.05, slope).applyMatrix4(new THREE.Matrix4().makeRotationX(sgn * ang)).translate(-Wd / 2 + 0.6 + k * 1.9, Ht + rise / 2, sgn * hd / 2), color: 0x2b1d16 });
        continue;
      }
      parts.push({ geo: new THREE.BoxGeometry(Wd + 1, 0.18, slope).applyMatrix4(new THREE.Matrix4().makeRotationX(sgn * ang)).translate(0, Ht + rise / 2, sgn * hd / 2), color: 0x2b1d16 });
    }
    for (const sgn of h.adobe ? [] : [1, -1]) {
      const v = new Float32Array([0, 0, -D / 2, 0, 0, D / 2, 0, rise - 0.25, 0, 0, 0, D / 2, 0, 0, -D / 2, 0, rise - 0.25, 0]);
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(v, 3)); g.computeVertexNormals();
      g.translate(sgn * (Wd / 2 - 0.05), Ht, 0);
      parts.push({ geo: g, color: 0x4a3828 });
    }
    const win = [[0, -D / 2 - 0.03, 0], [-Wd / 2 - 0.03, 0.4, 1], [Wd / 2 + 0.03, -0.6, 1]];
    for (const [x, z, side] of win) {
      parts.push({ geo: new THREE.BoxGeometry(side ? 0.04 : 1.0, 0.85, side ? 1.0 : 0.04).translate(x, 1.5, z), color: 0x050608 });
      for (let k = 0; k < 2; k++) parts.push({ geo: new THREE.BoxGeometry(side ? 0.05 : 1.2, 0.12, side ? 1.2 : 0.05).applyMatrix4(new THREE.Matrix4().makeRotationAxis(side ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1), (k ? -0.35 : 0.3))).translate(x * 1.01, 1.35 + k * 0.32, z * 1.01), color: 0x3a2c1e });
    }
    const door = new THREE.BoxGeometry(0.85, 2.05, 0.07).translate(0.42, 1.03, 0).applyMatrix4(new THREE.Matrix4().makeRotationY(-1.25)).translate(-dw / 2, 0.05, D / 2 - 0.1);
    parts.push({ geo: door, color: 0x3e3226 });
    if (h.cabin) {
      parts.push({ geo: new THREE.BoxGeometry(0.9, 5.2, 0.9).translate(Wd / 2 + 0.4, 2.6, -0.5), color: 0x5b5a58 });
      parts.push({ geo: new THREE.BoxGeometry(1.5, 0.08, 0.9).translate(1.4, 0.85, -1.4), color: 0x3a2a1e });
      for (const [lx, lz] of [[-0.65, -0.35], [0.65, -0.35], [-0.65, 0.35], [0.65, 0.35]]) parts.push({ geo: new THREE.BoxGeometry(0.08, 0.82, 0.08).translate(1.4 + lx, 0.42, -1.4 + lz), color: 0x3a2a1e });
      parts.push({ geo: new THREE.BoxGeometry(1.1, 0.35, 2.1).translate(-2.4, 0.22, -1.7), color: 0x3a2a1e });
      parts.push({ geo: new THREE.BoxGeometry(1.0, 0.14, 1.9).translate(-2.4, 0.46, -1.7), color: 0x5a4a4a });
      parts.push({ geo: new THREE.BoxGeometry(0.7, 0.7, 0.7).translate(2.7, 0.38, 1.9), color: 0x3a2a1e });
    } else {
      parts.push({ geo: new THREE.BoxGeometry(1.2, 0.08, 0.7).translate(Wd / 2 - 1.2, 0.8, -D / 2 + 0.8), color: 0x3a2a1e });
      parts.push({ geo: new THREE.BoxGeometry(0.5, 0.45, 0.5).applyMatrix4(new THREE.Matrix4().makeRotationZ(1.4)).translate(-Wd / 2 + 1.0, 0.25, -D / 2 + 1.2), color: 0x34261a });
    }
    const dm = new THREE.Mesh(mergeGeos(parts), vcMat); dm.castShadow = true; dm.receiveShadow = true; dm.userData.own = true; grp.add(dm);
    if (h.cabin) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.2, 0.14), glowMat); l.position.set(1.4, 0.99, -1.4); grp.add(l); }
    return grp;
  }
  function buildWell(p) {
    const grp = new THREE.Group(); grp.position.set(p.x, p.y, p.z);
    const parts = [
      { geo: new THREE.CylinderGeometry(1.15, 1.25, 0.9, 10, 1, true).translate(0, 0.45, 0), color: 0x5c5f66 },
      { geo: new THREE.CylinderGeometry(0.95, 0.95, 0.9, 10, 1, true).scale(-1, 1, 1).translate(0, 0.45, 0), color: 0x2a2c30 },
      { geo: new THREE.TorusGeometry(1.08, 0.13, 4, 10).rotateX(Math.PI / 2).translate(0, 0.9, 0), color: 0x6a6d74 },
      { geo: new THREE.CircleGeometry(0.95, 10).rotateX(-Math.PI / 2).translate(0, 0.55, 0), color: 0x1a0505 },
      { geo: new THREE.BoxGeometry(0.12, 2.2, 0.12).translate(-1.05, 1.1, 0), color: 0x3a2a1e },
      { geo: new THREE.BoxGeometry(0.12, 2.2, 0.12).translate(1.05, 1.1, 0), color: 0x3a2a1e },
      { geo: new THREE.ConeGeometry(1.6, 0.8, 4).rotateY(Math.PI / 4).scale(1, 1, 0.7).translate(0, 2.55, 0), color: 0x2b1d16 },
      { geo: new THREE.CylinderGeometry(0.06, 0.06, 2.2, 6).rotateZ(Math.PI / 2).translate(0, 1.85, 0), color: 0x3a2a1e },
      { geo: new THREE.CylinderGeometry(0.01, 0.01, 1.2, 3).translate(0.2, 1.25, 0), color: 0x5a4a30 },
      { geo: new THREE.CylinderGeometry(0.05, 0.045, 0.6, 6).rotateZ(0.5).translate(0.25, 0.85, 0.2), color: 0x6c7b62 },
      { geo: new THREE.BoxGeometry(0.08, 0.1, 0.04).rotateZ(0.5).translate(0.4, 1.12, 0.2), color: 0x6c7b62 },
      { geo: new THREE.CylinderGeometry(0.13, 0.1, 0.25, 7).rotateX(1.2).translate(-0.3, 0.6, -0.2), color: 0x7a8068 },
      { geo: new THREE.BoxGeometry(0.4, 0.35, 0.02).translate(0.5, 0.55, 1.13), color: 0x6a0808 },
    ];
    const m = new THREE.Mesh(mergeGeos(parts), vcMat); m.castShadow = true; m.receiveShadow = true; m.userData.own = true;
    grp.add(m);
    return grp;
  }
  function buildHang(p) {
    const grp = new THREE.Group(); grp.position.set(p.x, p.y - 0.15, p.z); grp.rotation.y = p.yaw;
    const tree = new THREE.Mesh(deadTreeGeo, vcMat); tree.castShadow = true; grp.add(tree);
    const sw = makeHangedBody(1.0); sw.position.set(2.3, 5.1, 0); grp.add(sw);
    return { grp, swing: sw };
  }

  W.loaded = new Map();
  W.owlSpots = [];
  W.lodNear = 30; W.lodFar = 90;
  let lodX = 1e9, lodZ = 1e9, lodF = 0;
  function refreshLOD(ch) { for (const L of ch.lods) refreshOne(L); }
  function refreshOne(L) {
    const nr2 = W.lodNear * W.lodNear, fr2 = W.lodFar * W.lodFar;
    const na = L.near.instanceMatrix.array, fa = L.far.instanceMatrix.array, nc = L.near.instanceColor.array, fc = L.far.instanceColor.array;
    let a = 0, b = 0;
    for (let i = 0; i < L.n; i++) {
      const dx = L.xs[i] - lodX, dz = L.zs[i] - lodZ, d2 = dx * dx + dz * dz;
      if (d2 > fr2) continue;
      const src = i * 16;
      if (d2 < nr2) { const o = a * 16; for (let k = 0; k < 16; k++) na[o + k] = L.mats[src + k]; nc[a * 3] = L.cols[i * 3]; nc[a * 3 + 1] = L.cols[i * 3 + 1]; nc[a * 3 + 2] = L.cols[i * 3 + 2]; a++; }
      else { const o = b * 16; for (let k = 0; k < 16; k++) fa[o + k] = L.mats[src + k]; fc[b * 3] = L.cols[i * 3]; fc[b * 3 + 1] = L.cols[i * 3 + 1]; fc[b * 3 + 2] = L.cols[i * 3 + 2]; b++; }
    }
    L.near.count = a; L.far.count = b;
    L.near.instanceMatrix.needsUpdate = true; L.far.instanceMatrix.needsUpdate = true;
    L.near.instanceColor.needsUpdate = true; L.far.instanceColor.needsUpdate = true;
  }
  W.updateLOD = (px, pz, far, force) => {
    if (!force && Math.hypot(px - lodX, pz - lodZ) < 3 && Math.abs(far - lodF) < 3) return;
    lodX = px; lodZ = pz; lodF = far; W.lodFar = far;
    for (const ch of W.loaded.values()) refreshLOD(ch);
  };

  function buildChunk(ci) {
    const cx = ci % NCH, cz = (ci / NCH) | 0, D = getCD(cx, cz);
    const g = new THREE.Group();
    g.add(buildTerrain(cx, cz));
    const wm = buildWater(cx, cz); if (wm) g.add(wm);
    const frac = W.treeFrac;
    const add = (m) => { if (m) g.add(m); };
    // trees and dead trees: matrices are stored, and re-split every few metres into a full-detail
    // set (near), a low-poly set (mid range) and nothing at all beyond the fog
    const lods = [];
    const makeLod = (T, nearGeo, farGeo, yOff) => {
      if (!T.length) return;
      const n = T.length, mats = new Float32Array(n * 16), cols = new Float32Array(n * 3), xs = new Float32Array(n), zs = new Float32Array(n);
      T.forEach((t, i) => {
        p4.set(t.x, hgt(t.x, t.z) + yOff, t.z); e4.set(t.tx || 0, t.ry, t.tz || 0); q4.setFromEuler(e4); s4.set(t.radius ?? t.s, t.height ?? t.s, t.radius ?? t.s);
        m4.compose(p4, q4, s4); m4.toArray(mats, i * 16);
        const tint = t.tint || 1; cols[i * 3] = tint; cols[i * 3 + 1] = tint; cols[i * 3 + 2] = tint; xs[i] = t.x; zs[i] = t.z;
      });
      const mk = (geo, shadow) => {
        const m = new THREE.InstancedMesh(geo, vcMat, n);
        m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        m.boundingSphere = new THREE.Sphere(new THREE.Vector3(-HALF + cx * CH + CH / 2, 8, -HALF + cz * CH + CH / 2), nearGeo === ancientGeo ? 105 : 82);
        m.castShadow = shadow; m.receiveShadow = true; m.count = 0;
        g.add(m); return m;
      };
      lods.push({ n, mats, cols, xs, zs, near: mk(nearGeo, true), far: mk(farGeo, false) });
    };
    makeLod(D.trees.filter((t) => t.q < frac && !t.radius), treeGeo, treeLowGeo, -0.2);
    makeLod(D.trees.filter((t) => t.q < frac && t.radius), ancientGeo, ancientLowGeo, -0.1);
    makeLod(D.deadTrees, deadTreeGeo, deadTreeLowGeo, -0.15);
    add(inst(bushGeo, vcMat, D.bushes, (b) => { p4.set(b.x, hgt(b.x, b.z) - 0.05, b.z); q4.setFromAxisAngle(UP, b.a); s4.set(b.s * 1.1, b.s * 0.85, b.s * 1.1); m4.compose(p4, q4, s4); c4.setScalar(b.t); b.__c = 1; return true; }));
    add(inst(dryBushGeo, vcMat, D.dryBushes, (b) => { p4.set(b.x, hgt(b.x, b.z) - 0.05, b.z); q4.setFromAxisAngle(UP, b.a); s4.set(b.s, b.s, b.s); m4.compose(p4, q4, s4); return true; }, false));
    add(inst(boneGeo, vcMat, D.bones, (b) => { p4.set(b.x, hgt(b.x, b.z), b.z); q4.setFromAxisAngle(UP, b.a); s4.set(b.s, b.s, b.s); m4.compose(p4, q4, s4); return true; }, false));
    add(inst(whiteRockGeo, vcMat, D.drocks, (r) => { p4.set(r.x, hgt(r.x, r.z) + r.sy * 0.2, r.z); e4.set(...r.e); q4.setFromEuler(e4); s4.set(r.sx, r.sy, r.sz); m4.compose(p4, q4, s4); c4.setRGB(...r.col); r.__c = 1; return true; }));
    add(inst(pillarGeo, vcMat, D.pillars, (p) => { p4.set(p.x, hgt(p.x, p.z) - 0.2, p.z); e4.set(p.tilt, p.a, 0); q4.setFromEuler(e4); s4.set(p.r, p.h, p.r); m4.compose(p4, q4, s4); c4.setRGB(0.66, 0.55, 0.4); p.__c = 1; return true; }));
    add(inst(ruinGeo, vcMat, D.ruins, (r) => { p4.set(r.x, hgt(r.x, r.z) - 0.3, r.z); q4.setFromAxisAngle(UP, r.a); s4.set(r.w, r.h + 0.3, r.d); m4.compose(p4, q4, s4); c4.setRGB(0.6, 0.5, 0.36); r.__c = 1; return true; }));
    add(inst(rockGeo, vcMat, D.rocks, (r) => { p4.set(r.x, hgt(r.x, r.z) + r.sy * 0.25, r.z); e4.set(...r.e); q4.setFromEuler(e4); s4.set(r.sx, r.sy, r.sz); m4.compose(p4, q4, s4); c4.setScalar(r.t); r.__c = 1; return true; }));
    const mossyRocks = D.rocks.filter((r) => deepForest(r.x, r.z) > 0.6 && hash2(r.x, r.z, 428) < 0.7);
    add(inst(mossGeo, vcMat, mossyRocks, (r) => {
      p4.set(r.x - r.sx * 0.1, hgt(r.x, r.z) + r.sy * 0.96, r.z + r.sz * 0.08);
      q4.setFromAxisAngle(UP, r.e[1]); s4.set(r.sx * 0.63, r.sy * 0.28, r.sz * 0.62);
      m4.compose(p4, q4, s4); return true;
    }, false));
    const ferns = D.bushes.filter((b) => deepForest(b.x, b.z) > 0.5 && hash2(b.x, b.z, 423) < 0.38);
    add(inst(fernGeo, vcMat, ferns, (b) => {
      p4.set(b.x + 0.45, hgt(b.x + 0.45, b.z), b.z);
      q4.setFromAxisAngle(UP, b.a); s4.setScalar(b.s * 0.78); m4.compose(p4, q4, s4); return true;
    }, false));
    add(inst(logGeo, vcMat, D.logs, (l) => { p4.set(l.x, hgt(l.x, l.z) + 0.28 * (l.size ?? 1), l.z); q4.setFromAxisAngle(UP, l.a); s4.setScalar(l.size ?? 1); m4.compose(p4, q4, s4); return true; }));
    add(inst(reedGeo, vcMat, D.reeds, (r) => { p4.set(r.x, hgt(r.x, r.z), r.z); q4.setFromAxisAngle(UP, r.a); s4.set(r.s, r.s, r.s); m4.compose(p4, q4, s4); return true; }, false));
    add(inst(decalGeo, bloodMat, D.blood, (b) => { p4.set(b.x, (b.y ?? hgt(b.x, b.z)) + 0.04, b.z); q4.setFromAxisAngle(UP, b.a); s4.set(b.s, 1, b.s); m4.compose(p4, q4, s4); return true; }, false));
    add(inst(lanternGeo, vcMat, D.lanterns, (l) => { p4.set(l.x, hgt(l.x, l.z) - 0.05, l.z); q4.setFromAxisAngle(UP, l.a); s4.set(1, 1, 1); m4.compose(p4, q4, s4); if (l.lit) c4.setRGB(1.6, 1.15, 0.55); else c4.setRGB(0.25, 0.22, 0.2); l.__c = 1; return true; }, false));
    for (const l of D.lanterns) if (l.lit) {
      const sp = new THREE.Sprite(lanternGlowMat); sp.scale.set(1.5, 1.5, 1);
      sp.position.set(l.x + Math.cos(l.a) * 0.38, hgt(l.x, l.z) + 1.55, l.z - Math.sin(l.a) * 0.38);
      sp.userData = { ph: Math.random() * 6, lantern: true, ci }; g.add(sp); W.lanternSprites.push(sp);
    }
    const swings = [];
    const hangingLanterns = [];
    for (const tree of D.trees) {
      if (!tree.radius || tree.q >= frac || hash2(tree.x, tree.z, 324) > 0.19) continue;
      const x = tree.x + Math.cos(tree.ry) * tree.radius * 2.4;
      const z = tree.z - Math.sin(tree.ry) * tree.radius * 2.4;
      const ground = hgt(x, z);
      const anchor = hgt(tree.x, tree.z) + tree.height * 0.4;
      const y = Math.min(anchor - 0.6, ground + 3 + 7 * hash2(x, z, 342));
      if (y < ground + 3) continue;
      const pivot = new THREE.Group();
      pivot.position.set(x, anchor, z);
      const chain = new THREE.Mesh(hangingChain, hangingMetal);
      chain.scale.y = anchor - y;
      chain.position.y = -chain.scale.y / 2;
      const lantern = new THREE.Mesh(hangingCase, hangingMetal);
      lantern.position.y = y - anchor;
      pivot.add(chain, lantern);
      if (hash2(x, z, 375) < 0.76) {
        const glow = new THREE.Sprite(lanternGlowMat);
        glow.scale.set(1.8, 1.8, 1);
        glow.position.y = lantern.position.y;
        glow.userData = { ci, ph: hash2(x, z, 395) * 6, lantern: true };
        pivot.add(glow);
        W.lanternSprites.push(glow);
      }
      pivot.userData.ph = hash2(x, z, 401) * 6;
      g.add(pivot);
      hangingLanterns.push(pivot);
    }
    for (const pr of D.props) {
      if (pr.type === 'house') g.add(buildHouseMesh(pr.h));
      else if (pr.type === 'well') g.add(buildWell(pr));
      else if (pr.type === 'corpse') { const m = makeCorpse(); m.position.set(pr.x, pr.y, pr.z); m.rotation.y = pr.yaw; g.add(m); }
      else if (pr.type === 'bonepile') { const m = new THREE.Mesh(boneGeo, vcMat); m.position.set(pr.x, pr.y, pr.z); m.rotation.y = pr.yaw; m.scale.setScalar(1.3); g.add(m); }
      else if (pr.type === 'hang') { const h = buildHang(pr); h.swing.userData.ph = pr.ph; g.add(h.grp); swings.push(h.swing); }
    }
    g.traverse((o) => { if (o.isMesh && !o.isInstancedMesh && o.castShadow && !W.shadows) o.castShadow = false; });
    scene.add(g);
    const rec = { g, swings, hangingLanterns, lods, cd: D };
    W.loaded.set(ci, rec);
    refreshLOD(rec);
    for (const o of D.owl) { o.ci = ci; W.owlSpots.push(o); }
    if (W.onChunkLoad) W.onChunkLoad(ci, D);
  }
  function disposeChunk(ci) {
    const ch = W.loaded.get(ci); if (!ch) return;
    scene.remove(ch.g);
    ch.g.traverse((o) => { if (o.isInstancedMesh) o.dispose(); else if (o.userData.own) o.geometry.dispose(); });
    W.loaded.delete(ci);
    W.owlSpots = W.owlSpots.filter((o) => o.ci !== ci);
    W.lanternSprites = W.lanternSprites.filter((sp) => sp.userData.ci !== ci);
    if (W.onChunkUnload) W.onChunkUnload(ci);
  }
  let evictT = 0;
  W.updateChunks = (px, pz, all = false) => {
    const loadR = W.viewDist + 25, unloadR = loadR + 60;
    const c0 = Math.max(0, Math.floor((px - loadR + HALF) / CH)), c1 = Math.min(NCH - 1, Math.floor((px + loadR + HALF) / CH));
    const r0 = Math.max(0, Math.floor((pz - loadR + HALF) / CH)), r1 = Math.min(NCH - 1, Math.floor((pz + loadR + HALF) / CH));
    let bestCi = -1, bestD = 1e9;
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const ci = r * NCH + c;
      if (W.loaded.has(ci)) continue;
      const x0 = -HALF + c * CH, z0 = -HALF + r * CH;
      const d = Math.hypot(Math.max(x0 - px, 0, px - (x0 + CH)), Math.max(z0 - pz, 0, pz - (z0 + CH)));
      if (d >= loadR) continue;
      if (all) buildChunk(ci); else if (d < bestD) { bestD = d; bestCi = ci; }
    }
    for (const [ci] of W.loaded) {
      const cx = ci % NCH, cz = (ci / NCH) | 0, x0 = -HALF + cx * CH, z0 = -HALF + cz * CH;
      if (Math.hypot(Math.max(x0 - px, 0, px - (x0 + CH)), Math.max(z0 - pz, 0, pz - (z0 + CH))) > unloadR) disposeChunk(ci);
    }
    if (bestCi >= 0) buildChunk(bestCi);
    // forget generated (but not displayed) chunk data far from the player
    evictT += 1;
    if (evictT > 120) {
      evictT = 0;
      for (const ci of [...genList]) {
        if (W.loaded.has(ci)) continue;
        const cx = ci % NCH, cz = (ci / NCH) | 0;
        if (Math.hypot(-HALF + cx * CH + CH / 2 - px, -HALF + cz * CH + CH / 2 - pz) > unloadR + 250) { cdata[ci] = undefined; genList.delete(ci); }
      }
    }
  };
  W.rebuildChunks = (px, pz) => { for (const ci of [...W.loaded.keys()]) disposeChunk(ci); W.updateChunks(px, pz, true); };
  W.invalidateChunkData = () => { cdata.fill(undefined); genList.clear(); };
  W.forEachLoaded = (cb) => { for (const [ci, rec] of W.loaded) cb(ci, rec.cd); };
  W.stats = () => ({ loaded: W.loaded.size, generated: genList.size });

  // dynamic blood (from shot limbs) near the player
  {
    const N = 60;
    const m = new THREE.InstancedMesh(decalGeo, bloodMat, N); m.count = 0; m.frustumCulled = false; scene.add(m);
    let next = 0;
    const stains = [];
    W.bloodStains = () => stains.slice();
    W.addBlood = (x, z, angle = Math.random() * 6.28, s = 0.8 + Math.random() * 1.2) => {
      stains[next] = { x, z, angle, s };
      p4.set(x, hgt(x, z) + 0.05, z); q4.setFromAxisAngle(UP, angle); s4.set(s, 1, s); m4.compose(p4, q4, s4);
      m.setMatrixAt(next, m4); next = (next + 1) % N; m.count = Math.max(m.count, next === 0 ? N : next);
      m.instanceMatrix.needsUpdate = true;
    };
    W.clearBlood = () => { m.count = 0; next = 0; stains.length = 0; };
  }

  // grass follows the player (stateless hash, never pops oddly)
  {
    const parts = [];
    for (let b = 0; b < 5; b++) {
      const a = (b / 5) * Math.PI * 2 + b, ox = Math.cos(a * 2.3) * 0.18, oz = Math.sin(a * 1.7) * 0.18, h = 0.28 + (b % 3) * 0.1, w = 0.045;
      const v = new Float32Array([-w, 0, 0, w, 0, 0, 0.03, h, 0, -w, 0, 0, 0.03, h, 0, w, 0, 0]);
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(v, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]), 3));
      g.rotateX(0.25 * Math.sin(b * 2)); g.rotateY(a); g.translate(ox, 0, oz);
      parts.push({ geo: g, color: 0x2f4a1e });
    }
    const geo = mergeGeos(parts);
    const pa = geo.attributes.position, ca = geo.attributes.color;
    for (let i = 0; i < pa.count; i++) { const k = 0.75 + pa.getY(i) * 1.6; ca.setXYZ(i, ca.getX(i) * k, ca.getY(i) * k, ca.getZ(i) * k); }
    const MAXG = 4200;
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }), MAXG);
    mesh.frustumCulled = false; mesh.count = 0;
    scene.add(mesh);
    W.grass = { mesh, cx: 1e9, cz: 1e9, max: MAXG, radius: 32 };
  }
  W.updateGrass = (px, pz, force) => {
    const G = W.grass;
    if (!force && Math.hypot(px - G.cx, pz - G.cz) < 4) return;
    G.cx = px; G.cz = pz;
    const cs = 2.4, R0 = G.radius, x0 = Math.floor((px - R0) / cs), x1 = Math.floor((px + R0) / cs), z0 = Math.floor((pz - R0) / cs), z1 = Math.floor((pz + R0) / cs);
    let n = 0;
    const density = G.density ?? 2;
    for (let cz = z0; cz <= z1 && n < G.max - 4; cz++)
      for (let cx = x0; cx <= x1; cx++) {
        if (Math.hypot((cx + 0.5) * cs - px, (cz + 0.5) * cs - pz) > R0) continue;
        for (let k = 0; k < density; k++) {
          const x = (cx + hash2(cx, cz, k * 7 + 1)) * cs, z = (cz + hash2(cx, cz, k * 7 + 2)) * cs;
          if (Math.abs(x) > HALF - 3 || Math.abs(z) > HALF - 3) continue;
          if (hash2(cx, cz, k * 7 + 3) < 0.25 || W.inBuilding(x, z) || Math.hypot(x - CAMP.x, z - CAMP.z) < 3.5) continue;
          const h = hgt(x, z);
          if (desertWeight(x, z) > 0.3 || ringWeight(x, z) > hash2(cx, cz, 11) + 0.3) continue;
          if (h < 0.5 || pathDist(x, z) < 1.8 || villageDist(x, z) < 14 || (clearingDist(x, z) < -4 && hash2(cx, cz, 9) < 0.5)) continue;
          const s = 0.7 + hash2(cx, cz, k * 7 + 4) * 1.1;
          p4.set(x, h - 0.02, z); q4.setFromAxisAngle(UP, hash2(cx, cz, k * 7 + 5) * 6.28);
          s4.set(s, s * (0.7 + hash2(cx, cz, k * 7 + 6) * 0.6), s);
          m4.compose(p4, q4, s4); G.mesh.setMatrixAt(n, m4);
          c4.setScalar((0.65 + hash2(cx, cz, k * 7 + 8) * 0.7) * (1 - darkBlob(x, z) * 0.4)); G.mesh.setColorAt(n, c4);
          n++;
        }
      }
    G.mesh.count = n;
    G.mesh.instanceMatrix.needsUpdate = true;
    if (G.mesh.instanceColor) G.mesh.instanceColor.needsUpdate = true;
  };

  // ------------------------------------------------------------ campsite (always present: it lights the spawn)
  const H_CAMP = hgt(CAMP.x, CAMP.z);
  {
    const R = mulberry32(99), RR = (a, b) => a + R() * (b - a);
    const g = new THREE.Group(); g.position.set(CAMP.x, H_CAMP, CAMP.z); scene.add(g);
    const stoneM = new THREE.MeshLambertMaterial({ color: 0x5c5f66, flatShading: true });
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2, s = RR(0.18, 0.28);
      const st = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), stoneM);
      st.position.set(Math.cos(a) * 0.85, s * 0.5, Math.sin(a) * 0.85); st.rotation.set(RR(0, 3), RR(0, 3), 0); st.castShadow = true; g.add(st);
    }
    const logM = new THREE.MeshLambertMaterial({ color: 0x3a2618, flatShading: true });
    for (let i = 0; i < 4; i++) {
      const l = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 1.1, 6), logM);
      l.rotation.order = 'YXZ'; l.position.set(0, 0.22, 0); l.rotation.set(Math.PI / 2 - 0.45, (i / 4) * Math.PI * 2, 0); g.add(l);
    }
    const ash = new THREE.Mesh(new THREE.CircleGeometry(0.8, 10), new THREE.MeshBasicMaterial({ color: 0x0a0806 })); ash.rotation.x = -Math.PI / 2; ash.position.y = 0.03; g.add(ash);
    for (let i = 0; i < 3; i++) {
      const a = 0.6 + i * 2.2, l = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.24, 1.7, 7), new THREE.MeshLambertMaterial({ color: 0x4a3524, flatShading: true }));
      l.position.set(Math.cos(a) * 2.7, 0.24, Math.sin(a) * 2.7); l.rotation.set(0, -a, Math.PI / 2); l.castShadow = true; l.receiveShadow = true; g.add(l);
    }
    const tent = new THREE.Mesh(new THREE.ConeGeometry(2.3, 1.9, 4).rotateY(Math.PI / 4).translate(0, 0.95, 0), new THREE.MeshLambertMaterial({ color: 0x4a5236, flatShading: true }));
    tent.position.set(5.2, 0, -3.4); tent.rotation.y = 0.5; tent.scale.set(1, 1, 1.35); tent.castShadow = true; tent.receiveShadow = true; g.add(tent);
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.65, 0.3), new THREE.MeshLambertMaterial({ color: 0x6a3a2a, flatShading: true })); pack.position.set(2.2, 0.33, -2.3); pack.rotation.y = 0.8; pack.castShadow = true; g.add(pack);
    const crate = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 0.6), new THREE.MeshLambertMaterial({ color: 0x4a3f2a, flatShading: true })); crate.position.set(-2.6, 0.25, -2.4); crate.rotation.y = 0.3; crate.castShadow = true; g.add(crate);
    extraCircles.push({ x: CAMP.x, z: CAMP.z, r: 1.0, h: 0.8, kind: 'rock' }, { x: CAMP.x + 5.2, z: CAMP.z - 3.4, r: 1.7, h: 1.6, kind: 'wood' }, { x: CAMP.x - 2.6, z: CAMP.z - 2.4, r: 0.5, h: 0.5, kind: 'wood' });
    cdata[Math.floor((CAMP.z + HALF) / CH) * NCH + Math.floor((CAMP.x + HALF) / CH)] = undefined;
    const flameTex = radialTex([[0, 'rgba(255,240,170,1)'], [0.3, 'rgba(255,150,40,0.85)'], [0.7, 'rgba(255,70,10,0.25)'], [1, 'rgba(255,40,0,0)']]);
    W.flames = [];
    for (let i = 0; i < 4; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
      sp.position.set(RR(-0.12, 0.12), 0.55 + i * 0.1, RR(-0.12, 0.12)); sp.userData = { base: 0.8 - i * 0.12, ph: RR(0, 6) };
      g.add(sp); W.flames.push(sp);
    }
    W.flameCones = [];
    for (let i = 0; i < 3; i++) {
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.22 - i * 0.04, 0.95 - i * 0.2, 6, 1, true), new THREE.MeshBasicMaterial({ color: i ? 0xffd070 : 0xff7a20, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
      c.position.y = 0.5 + i * 0.05; c.position.x = (i - 1) * 0.08; g.add(c); W.flameCones.push(c);
    }
    const fire = new THREE.PointLight(0xff8a35, 60, 34, 1.6); fire.position.set(0, 1.0, 0); g.add(fire);
    W.fireLight = fire;
    W.firePos = new THREE.Vector3(CAMP.x, H_CAMP + 0.8, CAMP.z);
    const NE = 45, ep = new Float32Array(NE * 3), ev = new Float32Array(NE * 3), el = new Float32Array(NE);
    const eg = new THREE.BufferGeometry(); eg.setAttribute('position', new THREE.BufferAttribute(ep, 3));
    const embers = new THREE.Points(eg, new THREE.PointsMaterial({ color: 0xff9a40, size: 0.09, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
    embers.frustumCulled = false; scene.add(embers);
    W.embers = { ep, ev, el, NE, geo: eg };
    for (let i = 0; i < NE; i++) el[i] = Math.random() * 2;
  }

  // ------------------------------------------------------------ ground mist
  {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    for (let i = 0; i < 26; i++) {
      const x = 24 + Math.random() * 80, y = 34 + Math.random() * 60, r = 18 + Math.random() * 30;
      const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(200,210,230,0.22)'); gr.addColorStop(1, 'rgba(200,210,230,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    }
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    W.mist = [];
    for (let i = 0; i < 30; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0, color: 0x8a98b8 }));
      s.scale.set(16, 7, 1); s.userData = { x: 0, z: 0, born: false, a: 0, drift: Math.random() * 6.28, base: 0.25 + Math.random() * 0.3 };
      scene.add(s); W.mist.push(s);
    }
    W.mistCount = 18;
  }

  // ------------------------------------------------------------ helpers
  W.findSpot = (px, pz, minD, maxD, camYaw = null) => {
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2, d = minD + Math.random() * (maxD - minD);
      const x = px + Math.cos(a) * d, z = pz + Math.sin(a) * d;
      if (Math.abs(x) > HALF - 10 || Math.abs(z) > HALF - 10) continue;
      if (W.blocked(x, z, 1.0) || W.inBuilding(x, z, 0.5) || W.railway?.inside(x, z) || hgt(x, z) < 0.3 || desert.blocksSpawn(x, z)) continue;
      if (camYaw !== null) {
        const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
        if ((Math.cos(a) * fx + Math.sin(a) * fz) > 0.35 && d < 75) continue;
      }
      return { x, z };
    }
    return null;
  };
  W.setQuality = (q, renderer, px = SPAWN.x, pz = SPAWN.z) => {
    W.treeFrac = q.treeFrac;
    W.viewDist = q.fog;
    W.lodNear = q.lodNear;
    W.shadows = q.shadows > 0;
    W.grass.density = q.grassDensity; W.grass.radius = q.grassRadius;
    W.mistCount = q.mist;
    W.updateGrass(px, pz, true);
    moon.castShadow = q.shadows > 0;
    if (q.shadows > 0 && moon.shadow.mapSize.x !== q.shadows) {
      if (moon.shadow.map) { moon.shadow.map.dispose(); moon.shadow.map = null; }
      moon.shadow.mapSize.set(q.shadows, q.shadows);
    }
    renderer.shadowMap.enabled = q.shadows > 0;
    W.rebuildChunks(px, pz);
  };

  // ------------------------------------------------------------ per-frame
  W.update = (dt, t, px, py, pz, dark = 0) => {
    W.time = t;
    W.sky.position.set(px, py, pz);
    moon.target.position.set(px, py, pz);
    moon.position.set(px + moonDir.x * 120, py + moonDir.y * 120, pz + moonDir.z * 120);
    redMoon.target.position.set(px, py, pz); redMoon.position.set(px + redDir.x * 120, py + redDir.y * 120, pz + redDir.z * 120);
    W.updateChunks(px, pz);
    W.updateLOD(px, pz, scene.fog.far + 8);
    W.updateGrass(px, pz);
    for (const ch of W.loaded.values()) for (const lantern of ch.hangingLanterns) {
      lantern.rotation.z = Math.sin(t * 0.65 + lantern.userData.ph) * 0.035;
    }
    desert.update(dt, t, px, py, pz);
    for (const ch of W.loaded.values()) for (const s of ch.swings) {
      const ph = s.userData.ph;
      s.rotation.set(Math.cos(t * 0.5 + ph) * 0.05, Math.sin(t * 0.23 + ph) * 0.6, Math.sin(t * 0.7 + ph) * 0.07);
    }
    for (let i = 0; i < W.mist.length; i++) {
      const s = W.mist[i], u = s.userData;
      if (i >= W.mistCount) { s.visible = false; continue; }
      s.visible = true;
      const d = Math.hypot(u.x - px, u.z - pz);
      if (!u.born || d > 55) {
        const a = Math.random() * 6.28, r = u.born ? 40 + Math.random() * 12 : 6 + Math.random() * 45;
        u.x = px + Math.cos(a) * r; u.z = pz + Math.sin(a) * r; u.born = true; u.a = 0;
        u.y = Math.max(hgt(u.x, u.z), WATER_Y) + 0.6 + Math.random() * 1.4;
      }
      u.x += Math.cos(u.drift) * 0.5 * dt; u.z += Math.sin(u.drift) * 0.5 * dt;
      u.a = Math.min(1, u.a + dt * 0.25);
      s.position.set(u.x, u.y, u.z);
      s.material.opacity = u.base * u.a * smoothstep(2, 9, d) * (0.7 + dark * 0.6);
    }
    const fl = 0.85 + Math.sin(t * 17) * 0.08 + Math.sin(t * 7.3) * 0.1 + (Math.random() - 0.5) * 0.12;
    W.fireLight.intensity = 55 * fl;
    for (const s of W.flames) {
      const u = s.userData, k = u.base * (0.8 + 0.35 * Math.sin(t * 9 + u.ph) + Math.random() * 0.1);
      s.scale.set(k * 1.1, k * 1.6, 1); s.position.y = 0.5 + k * 0.45;
    }
    W.flameCones.forEach((c, i) => {
      c.scale.set(1 + Math.sin(t * 11 + i * 2) * 0.15, 0.85 + Math.sin(t * 13 + i) * 0.2 + Math.random() * 0.1, 1 + Math.cos(t * 9 + i) * 0.15);
      c.rotation.y += dt * (2 + i);
    });
    const E = W.embers;
    if (Math.hypot(px - CAMP.x, pz - CAMP.z) < 120) {
      for (let i = 0; i < E.NE; i++) {
        E.el[i] -= dt;
        const i3 = i * 3;
        if (E.el[i] <= 0) {
          E.ep[i3] = CAMP.x + (Math.random() - 0.5) * 0.5; E.ep[i3 + 1] = H_CAMP + 0.5; E.ep[i3 + 2] = CAMP.z + (Math.random() - 0.5) * 0.5;
          E.ev[i3] = (Math.random() - 0.5) * 0.5; E.ev[i3 + 1] = 0.8 + Math.random() * 1.4; E.ev[i3 + 2] = (Math.random() - 0.5) * 0.5;
          E.el[i] = 1.5 + Math.random() * 2.2;
        }
        E.ev[i3] += Math.sin(t * 1.5 + i) * 0.4 * dt; E.ev[i3 + 2] += Math.cos(t * 1.3 + i) * 0.4 * dt;
        E.ep[i3] += E.ev[i3] * dt; E.ep[i3 + 1] += E.ev[i3 + 1] * dt; E.ep[i3 + 2] += E.ev[i3 + 2] * dt;
      }
      E.geo.attributes.position.needsUpdate = true;
    }
  };

  return W;
}
