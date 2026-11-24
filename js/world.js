import * as THREE from '../lib/three.module.min.js';
import { clamp, lerp, smoothstep, hash2, mulberry32, mergeGeos, mergeUV, part, rayCircleT } from './util.js';
import { makeCorpse, makeHangedBody, BAKED_MAT } from './zombies.js';

// =====================================================================================
//  DEADWOOD world: 1 km x 1 km, streamed in 100 m chunks around the player.
// =====================================================================================
export const SIZE = 1000, HALF = 500;
export const CH = 100, NCH = SIZE / CH;           // chunk size / chunks per side
export const CABIN = { x: -38, z: -32 };
export const CAMP = { x: 14, z: 10 };
export const SPAWN = { x: 9, z: 14 };
export const VILLAGES = [
  { x: 270, z: -190, name: 'HOLLOW CREEK', boss: true },
  { x: -300, z: 230, name: 'MARROW' },
  { x: 160, z: 330, name: 'ASHGROVE' },
  { x: -360, z: -330, name: 'GRIMFIELD' },
];
export const PONDS = [
  { x: 95, z: -70, r: 13 }, { x: -210, z: -130, r: 18 }, { x: 240, z: 110, r: 15 }, { x: -60, z: 300, r: 20 }, { x: 350, z: -380, r: 16 },
];
// sectors that turn pitch black (only matter far from spawn)
export const DARK = [
  { x: 270, z: -190, r: 175 }, { x: -300, z: 230, r: 165 }, { x: 160, z: 340, r: 135 },
  { x: -360, z: -330, r: 160 }, { x: 390, z: 210, r: 120 }, { x: -140, z: -430, r: 110 },
];
const CLEARINGS = [[60, -50, 16], [-70, 60, 14], [90, -10, 12], [-20, -90, 15], [-95, -45, 12], [200, 40, 18], [-180, 40, 16], [60, 210, 15], [330, -40, 14]];
const PATHS = [
  [[14, 10], [2, -2], [-20, -12], [-38, -25]],
  [[14, 10], [60, -30], [140, -90], [210, -150], [252, -178]],
  [[-38, -25], [-90, 10], [-150, 90], [-230, 170], [-284, 218]],
  [[14, 10], [30, 80], [70, 170], [120, 260], [150, 312]],
  [[-38, -25], [-100, -120], [-200, -220], [-300, -290], [-342, -320]],
  [[14, 10], [80, 40], [150, 60], [240, 110]],
];
const SEGS = [];
for (const p of PATHS) for (let i = 0; i < p.length - 1; i++) SEGS.push([p[i][0], p[i][1], p[i + 1][0], p[i + 1][1]]);

// ---------------------------------------------------------------- analytic terrain
export const riverX = (z) => -170 + 110 * Math.sin(z * 0.0045 + 0.5) + 35 * Math.sin(z * 0.013 + 2);
const riverDX = (z) => 110 * 0.0045 * Math.cos(z * 0.0045 + 0.5) + 35 * 0.013 * Math.cos(z * 0.013 + 2);
export function riverDist(x, z) { return Math.abs(x - riverX(z)) / Math.sqrt(1 + riverDX(z) ** 2); }

function baseH(x, z) {
  let h = 7
    + 3.0 * Math.sin(x * 0.0042 + 0.7) * Math.cos(z * 0.0037 + 1.1)
    + 2.0 * Math.sin(x * 0.031 + 1.3) * Math.cos(z * 0.027 + 0.4)
    + 1.1 * Math.sin(x * 0.071 + z * 0.053 + 2.0)
    + 0.5 * Math.cos(x * 0.13 - z * 0.11);
  const e = Math.max(Math.abs(x), Math.abs(z));
  h += smoothstep(462, 500, e) * 14; // hills wall in the map
  return h;
}
const SITES = [
  { x: CABIN.x, z: CABIN.z, r0: 9, r1: 20 }, { x: CAMP.x, z: CAMP.z, r0: 7, r1: 16 },
  ...VILLAGES.map((v) => ({ x: v.x, z: v.z, r0: 30, r1: 48 })),
];
for (const s of SITES) s.h = Math.max(2, baseH(s.x, s.z));
export function hgt(x, z) {
  let h = baseH(x, z);
  for (const s of SITES) {
    const dx = x - s.x, dz = z - s.z;
    if (dx * dx + dz * dz < s.r1 * s.r1) h = lerp(s.h, h, smoothstep(s.r0, s.r1, Math.sqrt(dx * dx + dz * dz)));
  }
  const rd = riverDist(x, z);
  if (rd < 40) h = Math.min(h, lerp(-1.0, h, smoothstep(4.5, 10 + h * 1.1, rd)));
  for (const p of PONDS) {
    const d = Math.hypot(x - p.x, z - p.z);
    if (d < p.r + 14) h = Math.min(h, lerp(-1.2, h, smoothstep(p.r * 0.35, p.r + 6 + h * 0.6, d)));
  }
  return h;
}
const WATER_Y = 0;

function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz), 0, 1);
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}
export function pathDist(x, z) {
  let m = 1e9;
  for (const s of SEGS) { const d = segDist(x, z, s[0], s[1], s[2], s[3]); if (d < m) m = d; }
  return m;
}
function clearingDist(x, z) {
  let m = 1e9;
  for (const c of CLEARINGS) m = Math.min(m, Math.hypot(x - c[0], z - c[1]) - c[2]);
  return m;
}
export function darkBlob(x, z) {
  let b = 0;
  for (const s of DARK) b = Math.max(b, 1 - smoothstep(s.r * 0.5, s.r, Math.hypot(x - s.x, z - s.z)));
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
function villageDist(x, z) { let m = 1e9; for (const v of VILLAGES) m = Math.min(m, Math.hypot(x - v.x, z - v.z)); return m; }

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

/** BoxGeometry with UVs scaled to world size (planks keep their proportions). */
function boxUV(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv, dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) { const k = f * 4 + i; uv.setXY(k, uv.getX(k) * dims[f][0] * 0.5, uv.getY(k) * dims[f][1] * 0.5); }
  return g;
}

export function createWorld(scene) {
  const W = {};
  W.hgt = hgt; W.CABIN = CABIN; W.CAMP = CAMP; W.VILLAGES = VILLAGES; W.PONDS = PONDS; W.riverX = riverX;
  W.darkness = darkness; W.pathDist = pathDist; W.denseF = denseF; W.SEGS = SEGS;
  W.treeFrac = 1; W.viewDist = 90; W.time = 0;

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
    W.sky = new THREE.Group(); W.sky.add(dome, stars, moonSpr);
    scene.add(W.sky);
  }

  // water: one plane following the player; the terrain hides it except in the river / ponds
  // water meshes are built per chunk, only over cells where the river/ponds actually are
  const waterMat = new THREE.MeshPhongMaterial({ color: 0x0a1820, specular: 0x6a7a90, shininess: 90 });
  W.isWater = (x, z) => hgt(x, z) < WATER_Y - 0.15;

  // ------------------------------------------------------------ collision grid (circles + boxes)
  const CELL = 10, GN = SIZE / CELL;
  const gridC = Array.from({ length: GN * GN }, () => []);
  const gridB = Array.from({ length: GN * GN }, () => []);
  const cIdx = (v) => clamp(Math.floor((v + HALF) / CELL), 0, GN - 1);
  function addCircle(x, z, r, h, kind = 'rock', q) {
    const c = { x, z, r, y0: hgt(x, z), h, kind, q, stamp: 0 };
    gridC[cIdx(z) * GN + cIdx(x)].push(c);
    return c;
  }
  const buildings = [];
  function addBox(x0, x1, z0, z1, y0, y1, kind = 'wood') {
    const b = { x0, x1, z0, z1, y0, y1, kind, stamp: 0 };
    for (let gz = cIdx(z0 - 1); gz <= cIdx(z1 + 1); gz++) for (let gx = cIdx(x0 - 1); gx <= cIdx(x1 + 1); gx++) gridB[gz * GN + gx].push(b);
    return b;
  }
  const alive = (c) => c.q === undefined || c.q < W.treeFrac;
  let stampN = 0;

  W.resolve = (p, r, y = -1e9) => {
    const cx = cIdx(p.x), cz = cIdx(p.z);
    for (let gz = Math.max(0, cz - 1); gz <= Math.min(GN - 1, cz + 1); gz++)
      for (let gx = Math.max(0, cx - 1); gx <= Math.min(GN - 1, cx + 1); gx++) {
        const cell = gridC[gz * GN + gx];
        for (let i = 0; i < cell.length; i++) {
          const c = cell[i];
          if (!alive(c) || y > c.y0 + c.h) continue;
          const dx = p.x - c.x, dz = p.z - c.z, rr = r + c.r, d2 = dx * dx + dz * dz;
          if (d2 < rr * rr) { const d = Math.sqrt(d2) || 1e-4, push = rr - d; p.x += dx / d * push; p.z += dz / d * push; }
        }
      }
    const cell = gridB[cz * GN + cx];
    for (let i = 0; i < cell.length; i++) {
      const b = cell[i];
      if (y > b.y1) continue;
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
        for (const c of gridC[gz * GN + gx]) if (alive(c) && Math.hypot(x - c.x, z - c.z) < r + c.r) return true;
    for (const b of gridB[cz * GN + cx]) if (x > b.x0 - r && x < b.x1 + r && z > b.z0 - r && z < b.z1 + r) return true;
    return false;
  };
  W.inBuilding = (x, z, pad = 0) => buildings.some((b) => x > b.x0 - pad && x < b.x1 + pad && z > b.z0 - pad && z < b.z1 + pad);
  W.inCabin = (x, z) => W.inBuilding(x, z);

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
        for (const c of gridC[gz * GN + gx]) if (alive(c) && c.h > 0.6) apply(c.x, c.z, c.r);
    for (const b of gridB[cz * GN + cx]) {
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
          for (const c of gridC[gz * GN + gx]) {
            if (c.stamp === stampN || !alive(c)) continue;
            c.stamp = stampN;
            const tt = rayCircleT(ox, oz, dx, dz, c.x, c.z, c.r);
            if (tt >= 0 && tt < best) { const y = oy + dy * tt; if (y >= c.y0 - 0.5 && y <= c.y0 + c.h) { best = tt; kind = c.kind; } }
          }
          for (const b of gridB[gz * GN + gx]) {
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
    // water surface
    if (dy < 0 && oy > WATER_Y) {
      const tw = (WATER_Y - oy) / dy;
      if (tw < best && hgt(ox + dx * tw, oz + dz * tw) < WATER_Y) { best = tw; kind = 'water'; }
    }
    W.hitKind = kind || 'dirt';
    return kind ? best : Infinity;
  };

  // ------------------------------------------------------------ shared assets
  const rng = mulberry32(1337);
  const R = (a, b) => a + rng() * (b - a);
  const groundTex = canvasTex(128, 128, (ctx, w, h) => {
    const id = ctx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) { const v = 170 + Math.random() * 85; id.data[i * 4] = v; id.data[i * 4 + 1] = v; id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255; }
    ctx.putImageData(id, 0, 0);
  }, 1);
  const groundMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: groundTex });
  const vcMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
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
  const deadTreeGeo = (() => mergeGeos([
    { geo: new THREE.CylinderGeometry(0.16, 0.34, 7.5, 6).translate(0, 3.75, 0), color: 0x2e2620 },
    { geo: new THREE.CylinderGeometry(0.06, 0.13, 2.6, 5).rotateZ(-Math.PI / 2 + 0.12).translate(1.25, 5.05, 0), color: 0x2e2620 },
    { geo: new THREE.CylinderGeometry(0.04, 0.09, 1.8, 5).rotateZ(0.9).translate(-0.7, 5.9, 0.1), color: 0x2a221c },
    { geo: new THREE.CylinderGeometry(0.03, 0.07, 1.5, 5).rotateX(0.8).translate(0, 6.4, 0.55), color: 0x2a221c },
    { geo: new THREE.CylinderGeometry(0.03, 0.06, 1.2, 5).rotateZ(-0.7).translate(0.45, 7.0, 0), color: 0x2a221c },
    { geo: new THREE.CylinderGeometry(0.025, 0.05, 1.0, 5).rotateX(-0.9).translate(0.1, 3.8, -0.4), color: 0x2a221c },
  ]))();
  const bushGeo = mergeGeos([
    { geo: new THREE.IcosahedronGeometry(0.7, 0).translate(0, 0.5, 0), color: 0x1b3a1c },
    { geo: new THREE.IcosahedronGeometry(0.5, 0).translate(0.55, 0.38, 0.2), color: 0x234a24 },
    { geo: new THREE.IcosahedronGeometry(0.45, 0).translate(-0.45, 0.35, -0.25), color: 0x16301a },
  ]);
  const rockGeo = part(new THREE.DodecahedronGeometry(1, 0), null, 0x5b6068);
  const logGeo = mergeGeos([
    { geo: new THREE.CylinderGeometry(0.3, 0.34, 4.6, 7).rotateZ(Math.PI / 2), color: 0x4b3624 },
    { geo: new THREE.CylinderGeometry(0.06, 0.1, 0.9, 5).rotateZ(1.0).translate(0.8, 0.3, 0.1), color: 0x3a291b },
  ]);
  const reedGeo = mergeGeos(Array.from({ length: 6 }, (_, i) => ({ geo: new THREE.CylinderGeometry(0.01, 0.02, 1.1 + (i % 3) * 0.3, 3).translate(Math.cos(i * 2.1) * 0.15, 0.6, Math.sin(i * 1.7) * 0.15), color: 0x3a4a24 })));
  const decalGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const bloodMat = new THREE.MeshLambertMaterial({ map: bloodTex(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, color: 0x9a8080 });
  const wallMat = new THREE.MeshLambertMaterial({ map: woodTex([92, 70, 52]), color: 0x9a8c7c });
  const cabinMat = new THREE.MeshLambertMaterial({ map: woodTex([110, 75, 45]), color: 0xb0a090 });
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xffb35a });

  // ------------------------------------------------------------ world data (deterministic)
  const chunks = Array.from({ length: NCH * NCH }, () => ({ trees: [], bushes: [], rocks: [], logs: [], reeds: [], blood: [], props: [], mesh: null }));
  const chunkOf = (x, z) => chunks[clamp(Math.floor((z + HALF) / CH), 0, NCH - 1) * NCH + clamp(Math.floor((x + HALF) / CH), 0, NCH - 1)];
  const nearSite = (x, z, pad = 0) => Math.hypot(x - CABIN.x, z - CABIN.z) < 11 + pad || Math.hypot(x - CAMP.x, z - CAMP.z) < 10 + pad || villageDist(x, z) < 36 + pad;
  const wet = (x, z, pad = 0) => hgt(x, z) < 0.35 + pad;
  W.blood = (x, z, s, y) => chunkOf(x, z).blood.push({ x, z, s, a: R(0, 6.28), y });

  // houses ------------------------------------------------------
  W.houses = [];
  W.lootSpots = [];
  W.owlSpots = [];
  function addHouse(h) {
    // h: {x,z,ry (multiple of PI/2), w, d, ht, cabin?}
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
    buildings.push({ x0: h.x - ex, x1: h.x + ex, z0: h.z - ez, z1: h.z + ez });
    h.toW = toW;
    W.houses.push(h);
    chunkOf(h.x, h.z).props.push({ type: 'house', h });
    return h;
  }

  // cabin near spawn (with furniture + guaranteed supplies)
  const cabin = addHouse({ x: CABIN.x, z: CABIN.z, ry: 0, w: 7, d: 6, ht: 2.9, cabin: true });
  addBox(CABIN.x + 2.3, CABIN.x + 3.1, CABIN.z + 1.5, CABIN.z + 2.3, cabin.y, cabin.y + 0.8);
  addBox(CABIN.x - 2.95, CABIN.x - 1.85, CABIN.z - 2.75, CABIN.z - 0.65, cabin.y, cabin.y + 0.6);
  addBox(CABIN.x + 0.65, CABIN.x + 2.15, CABIN.z - 1.85, CABIN.z - 0.95, cabin.y, cabin.y + 0.9);
  addBox(CABIN.x + 3.45, CABIN.x + 4.35, CABIN.z - 0.95, CABIN.z - 0.05, cabin.y, cabin.y + 5, 'rock');
  W.cabinSpots = [
    { x: CABIN.x + 1.4, z: CABIN.z - 1.4, y: 0.95, type: 'ammo' },
    { x: CABIN.x - 2.4, z: CABIN.z + 1.2, y: 0.12, type: 'med' },
    { x: CABIN.x + 2.7, z: CABIN.z + 1.9, y: 0.76, type: 'battery' },
  ];

  // villages ----------------------------------------------------
  for (const v of VILLAGES) {
    const n = 5 + (rng() < 0.5 ? 1 : 0);
    v.y = hgt(v.x, v.z);
    const a0 = rng() * 6.28;
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * Math.PI * 2 + R(-0.15, 0.15), r = R(17, 21);
      const x = v.x + Math.cos(a) * r, z = v.z + Math.sin(a) * r;
      const ry = Math.round(Math.atan2(v.x - x, v.z - z) / (Math.PI / 2)) * (Math.PI / 2);
      const h = addHouse({ x, z, ry, w: R(6, 8), d: R(5, 6.2), ht: R(2.6, 3.1), broken: rng() < 0.35, village: v });
      const nl = 1 + (rng() < 0.6 ? 1 : 0);
      for (let k = 0; k < nl; k++) {
        const [lx, lz] = h.toW(R(-h.w / 2 + 1, h.w / 2 - 1), R(-h.d / 2 + 1, h.d / 2 - 1.6));
        const roll = rng();
        W.lootSpots.push({ x: lx, z: lz, y: h.y + 0.12, type: k === 0 || roll < 0.5 ? 'battery' : roll < 0.8 ? 'ammo' : 'med' });
      }
      const [bx, bz] = h.toW(R(-1, 1), R(-1, 1)); W.blood(bx, bz, R(1.2, 2.2), h.y + 0.1);
      if (rng() < 0.5) { const [cx, cz] = h.toW(R(-1.5, 1.5), R(-1, 0.5)); chunkOf(cx, cz).props.push({ type: 'corpse', x: cx, z: cz, y: h.y + 0.08, yaw: R(0, 6.28) }); }
      if (rng() < 0.4) W.owlSpots.push({ x, z, y: h.y + h.ht + 1.3, yaw: ry });
    }
    // well in the middle, stuffed with bodies
    chunkOf(v.x, v.z).props.push({ type: 'well', x: v.x, z: v.z, y: v.y });
    addCircle(v.x, v.z, 1.3, 1.0, 'rock');
    // corpses + blood everywhere
    v.corpses = [];
    for (let i = 0; i < 9; i++) {
      const a = rng() * 6.28, r = R(3, 14), x = v.x + Math.cos(a) * r, z = v.z + Math.sin(a) * r;
      if (W.inBuilding(x, z, 0.5)) continue;
      chunkOf(x, z).props.push({ type: 'corpse', x, z, y: hgt(x, z), yaw: R(0, 6.28) });
      W.blood(x, z, R(1.5, 3), undefined);
      v.corpses.push({ x, z });
    }
    for (let i = 0; i < 22; i++) { const a = rng() * 6.28, r = R(0, 26); W.blood(v.x + Math.cos(a) * r, v.z + Math.sin(a) * r, R(0.8, 2.6)); }
  }

  // hanging trees -------------------------------------------------
  W.hangSpots = [];
  {
    let n = 0, tries = 0;
    while (n < 32 && tries++ < 2000) {
      let x, z;
      const mode = rng();
      if (mode < 0.55) { const s = DARK[(rng() * DARK.length) | 0]; const a = rng() * 6.28, r = rng() * s.r * 0.9; x = s.x + Math.cos(a) * r; z = s.z + Math.sin(a) * r; }
      else if (mode < 0.85) { const sg = SEGS[(rng() * SEGS.length) | 0]; const t = rng(); x = lerp(sg[0], sg[2], t) + R(-9, 9); z = lerp(sg[1], sg[3], t) + R(-9, 9); }
      else { x = R(-450, 450); z = R(-450, 450); }
      if (Math.abs(x) > 470 || Math.abs(z) > 470 || nearSite(x, z, -6) || pathDist(x, z) < 3.5 || wet(x, z, 0.5) || Math.hypot(x - SPAWN.x, z - SPAWN.z) < 45) continue;
      const yaw = R(0, 6.28);
      chunkOf(x, z).props.push({ type: 'hang', x, z, y: hgt(x, z), yaw, ph: R(0, 6.28) });
      addCircle(x, z, 0.38, 8, 'wood');
      W.hangSpots.push({ x, z });
      for (let k = 0; k < 2; k++) W.blood(x + Math.cos(yaw) * 2 + R(-1, 1), z - Math.sin(yaw) * 2 + R(-1, 1), R(0.7, 1.6));
      if (rng() < 0.5) W.owlSpots.push({ x: x - Math.cos(yaw) * 0.5, z: z + Math.sin(yaw) * 0.5, y: hgt(x, z) + 6.1, yaw: R(0, 6) });
      n++;
    }
  }
  // random corpses, mostly in the dark sectors and along paths
  for (let i = 0, tries = 0; i < 60 && tries < 1500; tries++) {
    let x, z;
    if (rng() < 0.6) { const s = DARK[(rng() * DARK.length) | 0]; const a = rng() * 6.28, r = rng() * s.r; x = s.x + Math.cos(a) * r; z = s.z + Math.sin(a) * r; }
    else { const sg = SEGS[(rng() * SEGS.length) | 0]; const t = rng(); x = lerp(sg[0], sg[2], t) + R(-4, 4); z = lerp(sg[1], sg[3], t) + R(-4, 4); }
    if (Math.abs(x) > 470 || Math.abs(z) > 470 || wet(x, z, 0.3) || W.inBuilding(x, z, 1) || Math.hypot(x - SPAWN.x, z - SPAWN.z) < 35) continue;
    chunkOf(x, z).props.push({ type: 'corpse', x, z, y: hgt(x, z), yaw: R(0, 6.28) });
    W.blood(x, z, R(1.4, 2.8)); i++;
  }
  for (let i = 0; i < 650; i++) { // random blood splatter
    const x = R(-480, 480), z = R(-480, 480);
    if (wet(x, z) || W.inBuilding(x, z) || Math.hypot(x - SPAWN.x, z - SPAWN.z) < 25) continue;
    W.blood(x, z, R(0.5, 2.2));
    if (rng() < 0.4) W.blood(x + R(-2, 2), z + R(-2, 2), R(0.3, 0.9));
  }

  // trees: jittered grid, dense forest regions get more and bigger trees
  {
    const TC = 4.6;
    let count = 0;
    for (let gz = -HALF + 5; gz < HALF - 5; gz += TC)
      for (let gx = -HALF + 5; gx < HALF - 5; gx += TC) {
        const dn = denseF(gx, gz);
        const edge = smoothstep(440, 490, Math.max(Math.abs(gx), Math.abs(gz)));
        const tries = dn > 0.4 || edge > 0 ? 2 : 1;
        for (let k = 0; k < tries; k++) {
          const p = k === 0 ? 0.24 + dn * 0.6 + edge * 0.6 : dn * 0.75 + edge * 0.5;
          if (rng() > p) continue;
          const x = gx + rng() * TC, z = gz + rng() * TC;
          if (nearSite(x, z, 2) || pathDist(x, z) < 3 || clearingDist(x, z) < 0 || wet(x, z, 0.6)) continue;
          const s = R(0.75, 1.5) * (1 + dn * 0.25), q = rng();
          chunkOf(x, z).trees.push({ x, z, s, q, ry: R(0, 6.28), tx: R(-0.04, 0.04), tz: R(-0.04, 0.04), tint: R(0.7, 1.15) * (1 - dn * 0.25) });
          addCircle(x, z, 0.38 * s, 16 * s, 'wood', q);
          count++;
        }
      }
    W.totalTrees = count;
  }
  // bushes, rocks, logs, reeds
  for (let i = 0; i < 4200; i++) {
    const x = R(-488, 488), z = R(-488, 488);
    const dn = denseF(x, z);
    if (rng() > 0.45 + dn * 0.55 || W.inBuilding(x, z, 1) || Math.hypot(x - CAMP.x, z - CAMP.z) < 5 || pathDist(x, z) < 1.6 || wet(x, z, 0.2)) continue;
    chunkOf(x, z).bushes.push({ x, z, s: R(0.8, 1.9), a: R(0, 6.28), t: R(0.7, 1.2) * (1 - dn * 0.3) });
  }
  for (let i = 0; i < 750; i++) {
    const x = R(-485, 485), z = R(-485, 485);
    if (nearSite(x, z) || pathDist(x, z) < 2.5 || W.inBuilding(x, z, 2)) continue;
    const s = R(0.5, 1.8), sx = s * R(0.9, 1.6), sy = s * R(0.55, 1.1);
    chunkOf(x, z).rocks.push({ x, z, sx, sy, sz: sx * R(0.8, 1.2), e: [R(-0.3, 0.3), R(0, 6.28), R(-0.3, 0.3)], t: R(0.6, 1.2) });
    addCircle(x, z, sx * 0.82, sy * 1.2, 'rock');
  }
  for (let i = 0; i < 220; i++) {
    const x = R(-480, 480), z = R(-480, 480);
    if (nearSite(x, z) || pathDist(x, z) < 3 || wet(x, z, 0.3)) continue;
    const a = R(0, Math.PI);
    chunkOf(x, z).logs.push({ x, z, a });
    for (const o of [-1.5, 0, 1.5]) addCircle(x + Math.cos(a) * o, z - Math.sin(a) * o, 0.4, 0.7, 'wood');
  }
  for (let i = 0; i < 9000; i++) { // reeds along water edges
    const z = R(-490, 490), side = rng() < 0.5 ? -1 : 1;
    let x = riverX(z) + side * R(5, 11);
    if (rng() < 0.35) { const p = PONDS[(rng() * PONDS.length) | 0]; const a = rng() * 6.28, r = p.r * R(0.6, 1.25); x = p.x + Math.cos(a) * r; const zz = p.z + Math.sin(a) * r; const h = hgt(x, zz); if (h > -0.5 && h < 0.7) chunkOf(x, zz).reeds.push({ x, z: zz, s: R(0.7, 1.4), a: R(0, 6.28) }); continue; }
    const h = hgt(x, z);
    if (h > -0.4 && h < 0.8 && rng() < 0.25) chunkOf(x, z).reeds.push({ x, z, s: R(0.7, 1.4), a: R(0, 6.28) });
  }

  // ------------------------------------------------------------ terrain colouring
  const C = {
    g1: new THREE.Color(0x16240f), g2: new THREE.Color(0x26381a), dense: new THREE.Color(0x0c160a), dead: new THREE.Color(0x2a271c),
    dirt: new THREE.Color(0x4a3a2a), clr: new THREE.Color(0x2c3a1c), mud: new THREE.Color(0x2a2219), bed: new THREE.Color(0x15120d), vill: new THREE.Color(0x3a3024),
  };
  const tc = new THREE.Color();
  function groundColor(x, z, h, out) {
    const n = 0.5 + 0.5 * Math.sin(x * 0.21) * Math.sin(z * 0.17) + (hash2(x * 3, z * 3) - 0.5) * 0.35;
    out.copy(C.g1).lerp(C.g2, clamp(n, 0, 1));
    const dn = denseF(x, z); if (dn > 0) out.lerp(C.dense, dn * 0.55);
    const db = darkBlob(x, z); if (db > 0) out.lerp(C.dead, db * 0.55);
    const cd = clearingDist(x, z); if (cd < 0) out.lerp(C.clr, 0.6 * smoothstep(0, -6, cd));
    const vd = villageDist(x, z); if (vd < 34) out.lerp(C.vill, 0.85 * (1 - smoothstep(18, 34, vd + (hash2(x, z, 4) - 0.5) * 8)));
    const pd = pathDist(x, z);
    if (pd < 4) out.lerp(C.dirt, 0.95 * (1 - smoothstep(1.2, 3.0, pd + (hash2(x * 2, z * 2) - 0.5) * 1.2)));
    const dc = Math.hypot(x - CAMP.x, z - CAMP.z); if (dc < 9) out.lerp(C.dirt, 0.8 * (1 - smoothstep(3, 9, dc)));
    if (h < 0.9) out.lerp(C.mud, clamp((0.9 - h) / 0.9, 0, 1));
    if (h < 0) out.lerp(C.bed, clamp(-h, 0, 1));
    return out;
  }
  W.mapColor = (x, z) => {
    const h = hgt(x, z);
    if (h < -0.05) return [18, 38, 54];
    groundColor(x, z, h, tc);
    const k = 3.2; // brighten for the map
    return [Math.min(255, Math.pow(tc.r, 1 / 2.2) * 255 * k * 0.55), Math.min(255, Math.pow(tc.g, 1 / 2.2) * 255 * k * 0.55), Math.min(255, Math.pow(tc.b, 1 / 2.2) * 255 * k * 0.55)];
  };

  // ------------------------------------------------------------ chunk building
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
    const wm = new THREE.Mesh(mergeUV(walls), h.cabin ? cabinMat : wallMat);
    wm.castShadow = true; wm.receiveShadow = true; wm.userData.own = true; grp.add(wm);
    // roof, gables, boards, door (vertex coloured, one mesh)
    const parts = [];
    const hd = D / 2 + 0.5, ang = 0.55, slope = hd / Math.cos(ang), rise = hd * Math.tan(ang);
    for (const sgn of [1, -1]) {
      if (h.broken && sgn === -1) {
        for (let k = 0; k < 3; k++) parts.push({ geo: new THREE.BoxGeometry(0.25, 0.05, slope).applyMatrix4(new THREE.Matrix4().makeRotationX(sgn * ang)).translate(-Wd / 2 + 0.6 + k * 1.9, Ht + rise / 2, sgn * hd / 2), color: 0x2b1d16 });
        continue;
      }
      parts.push({ geo: new THREE.BoxGeometry(Wd + 1, 0.18, slope).applyMatrix4(new THREE.Matrix4().makeRotationX(sgn * ang)).translate(0, Ht + rise / 2, sgn * hd / 2), color: 0x2b1d16 });
    }
    for (const sgn of [1, -1]) {
      const v = new Float32Array([0, 0, -D / 2, 0, 0, D / 2, 0, rise - 0.25, 0, 0, 0, D / 2, 0, 0, -D / 2, 0, rise - 0.25, 0]);
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(v, 3)); g.computeVertexNormals();
      g.translate(sgn * (Wd / 2 - 0.05), Ht, 0);
      parts.push({ geo: g, color: 0x4a3828 });
    }
    // boarded windows
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
      parts.push({ geo: new THREE.BoxGeometry(1.2, 0.08, 0.7).translate(Wd / 2 - 1.2, 0.8, -D / 2 + 0.8), color: 0x3a2a1e }); // table
      parts.push({ geo: new THREE.BoxGeometry(0.5, 0.45, 0.5).applyMatrix4(new THREE.Matrix4().makeRotationZ(1.4)).translate(-Wd / 2 + 1.0, 0.25, -D / 2 + 1.2), color: 0x34261a }); // tipped chair
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
      // a dead arm reaching out of the bodies piled up inside
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
  W.lodNear = 30; W.lodFar = 90;
  let lodX = 1e9, lodZ = 1e9, lodF = 0;
  function refreshLOD(ch) {
    const L = ch.lod; if (!L) return;
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
    const cx = ci % NCH, cz = (ci / NCH) | 0, D = chunks[ci];
    const g = new THREE.Group();
    g.add(buildTerrain(cx, cz));
    const wm = buildWater(cx, cz); if (wm) g.add(wm);
    const frac = W.treeFrac;
    const add = (m) => { if (m) g.add(m); };
    // trees: matrices are stored, and split every few metres into a full-detail set (near),
    // a low-poly set (mid range) and nothing at all beyond the fog
    let lod = null;
    const T = D.trees.filter((t) => t.q < frac);
    if (T.length) {
      const n = T.length, mats = new Float32Array(n * 16), cols = new Float32Array(n * 3), xs = new Float32Array(n), zs = new Float32Array(n);
      T.forEach((t, i) => {
        p4.set(t.x, hgt(t.x, t.z) - 0.2, t.z); e4.set(t.tx, t.ry, t.tz); q4.setFromEuler(e4); s4.set(t.s, t.s, t.s);
        m4.compose(p4, q4, s4); m4.toArray(mats, i * 16);
        cols[i * 3] = t.tint; cols[i * 3 + 1] = t.tint; cols[i * 3 + 2] = t.tint; xs[i] = t.x; zs[i] = t.z;
      });
      const mk = (geo, shadow) => {
        const m = new THREE.InstancedMesh(geo, vcMat, n);
        m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        m.boundingSphere = new THREE.Sphere(new THREE.Vector3(-HALF + cx * CH + CH / 2, 8, -HALF + cz * CH + CH / 2), 82);
        m.castShadow = shadow; m.receiveShadow = true; m.count = 0;
        g.add(m); return m;
      };
      lod = { n, mats, cols, xs, zs, near: mk(treeGeo, true), far: mk(treeLowGeo, false) };
    }
    add(inst(bushGeo, vcMat, D.bushes, (b) => { p4.set(b.x, hgt(b.x, b.z) - 0.05, b.z); q4.setFromAxisAngle(UP, b.a); s4.set(b.s * 1.1, b.s * 0.85, b.s * 1.1); m4.compose(p4, q4, s4); c4.setScalar(b.t); b.__c = 1; return true; }));
    add(inst(rockGeo, vcMat, D.rocks, (r) => { p4.set(r.x, hgt(r.x, r.z) + r.sy * 0.25, r.z); e4.set(...r.e); q4.setFromEuler(e4); s4.set(r.sx, r.sy, r.sz); m4.compose(p4, q4, s4); c4.setScalar(r.t); r.__c = 1; return true; }));
    add(inst(logGeo, vcMat, D.logs, (l) => { p4.set(l.x, hgt(l.x, l.z) + 0.28, l.z); q4.setFromAxisAngle(UP, l.a); s4.set(1, 1, 1); m4.compose(p4, q4, s4); return true; }));
    add(inst(reedGeo, vcMat, D.reeds, (r) => { p4.set(r.x, hgt(r.x, r.z), r.z); q4.setFromAxisAngle(UP, r.a); s4.set(r.s, r.s, r.s); m4.compose(p4, q4, s4); return true; }, false));
    add(inst(decalGeo, bloodMat, D.blood, (b) => { p4.set(b.x, (b.y ?? hgt(b.x, b.z)) + 0.04, b.z); q4.setFromAxisAngle(UP, b.a); s4.set(b.s, 1, b.s); m4.compose(p4, q4, s4); return true; }, false));
    const swings = [];
    for (const pr of D.props) {
      if (pr.type === 'house') g.add(buildHouseMesh(pr.h));
      else if (pr.type === 'well') g.add(buildWell(pr));
      else if (pr.type === 'corpse') { const m = makeCorpse(); m.position.set(pr.x, pr.y, pr.z); m.rotation.y = pr.yaw; g.add(m); }
      else if (pr.type === 'hang') { const h = buildHang(pr); h.swing.userData.ph = pr.ph; g.add(h.grp); swings.push(h.swing); }
    }
    g.traverse((o) => { if (o.isMesh && !o.isInstancedMesh && o.castShadow && !W.shadows) o.castShadow = false; });
    scene.add(g);
    W.loaded.set(ci, { g, swings, lod });
    if (lod) refreshLOD(W.loaded.get(ci));
  }
  function disposeChunk(ci) {
    const ch = W.loaded.get(ci); if (!ch) return;
    scene.remove(ch.g);
    ch.g.traverse((o) => { if (o.isInstancedMesh) o.dispose(); else if (o.userData.own) o.geometry.dispose(); });
    W.loaded.delete(ci);
  }
  W.updateChunks = (px, pz, all = false) => {
    const loadR = W.viewDist + 25, unloadR = loadR + 60;
    let bestCi = -1, bestD = 1e9;
    for (let ci = 0; ci < NCH * NCH; ci++) {
      const cx = ci % NCH, cz = (ci / NCH) | 0;
      const x0 = -HALF + cx * CH, z0 = -HALF + cz * CH;
      const dx = Math.max(x0 - px, 0, px - (x0 + CH)), dz = Math.max(z0 - pz, 0, pz - (z0 + CH)), d = Math.hypot(dx, dz);
      const has = W.loaded.has(ci);
      if (!has && d < loadR) { if (all) buildChunk(ci); else if (d < bestD) { bestD = d; bestCi = ci; } }
      else if (has && d > unloadR) disposeChunk(ci);
    }
    if (bestCi >= 0) buildChunk(bestCi); // at most one chunk per frame to avoid hitches
  };
  W.rebuildChunks = (px, pz) => { for (const ci of [...W.loaded.keys()]) disposeChunk(ci); W.updateChunks(px, pz, true); };

  // dynamic blood (from shot limbs) near the player
  {
    const N = 60;
    const m = new THREE.InstancedMesh(decalGeo, bloodMat, N); m.count = 0; m.frustumCulled = false; scene.add(m);
    let next = 0;
    W.addBlood = (x, z) => {
      p4.set(x + (Math.random() - 0.5), hgt(x, z) + 0.05, z + (Math.random() - 0.5)); q4.setFromAxisAngle(UP, Math.random() * 6.28);
      const s = 0.8 + Math.random() * 1.2; s4.set(s, 1, s); m4.compose(p4, q4, s4);
      m.setMatrixAt(next, m4); next = (next + 1) % N; m.count = Math.max(m.count, next === 0 ? N : next);
      m.instanceMatrix.needsUpdate = true;
    };
    W.clearBlood = () => { m.count = 0; next = 0; };
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
    const g = new THREE.Group(); g.position.set(CAMP.x, H_CAMP, CAMP.z); scene.add(g);
    const stoneM = new THREE.MeshLambertMaterial({ color: 0x5c5f66, flatShading: true });
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2, s = R(0.18, 0.28);
      const st = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), stoneM);
      st.position.set(Math.cos(a) * 0.85, s * 0.5, Math.sin(a) * 0.85); st.rotation.set(R(0, 3), R(0, 3), 0); st.castShadow = true; g.add(st);
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
    addCircle(CAMP.x, CAMP.z, 1.0, 0.8, 'rock');
    addCircle(CAMP.x + 5.2, CAMP.z - 3.4, 1.7, 1.6, 'wood');
    addCircle(CAMP.x - 2.6, CAMP.z - 2.4, 0.5, 0.5, 'wood');
    const flameTex = radialTex([[0, 'rgba(255,240,170,1)'], [0.3, 'rgba(255,150,40,0.85)'], [0.7, 'rgba(255,70,10,0.25)'], [1, 'rgba(255,40,0,0)']]);
    W.flames = [];
    for (let i = 0; i < 4; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
      sp.position.set(R(-0.12, 0.12), 0.55 + i * 0.1, R(-0.12, 0.12)); sp.userData = { base: 0.8 - i * 0.12, ph: R(0, 6) };
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
  W.campSpots = [{ x: CAMP.x - 2.6, z: CAMP.z + 1.2, type: 'ammo' }, { x: CAMP.x + 2.4, z: CAMP.z + 2.4, type: 'med' }];

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
      if (W.blocked(x, z, 1.0) || W.inBuilding(x, z, 0.5) || hgt(x, z) < 0.3) continue;
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
    W.sky.position.set(px, 0, pz);
    moon.target.position.set(px, py, pz);
    moon.position.set(px + moonDir.x * 120, py + moonDir.y * 120, pz + moonDir.z * 120);
    W.updateChunks(px, pz);
    W.updateLOD(px, pz, scene.fog.far + 8);
    W.updateGrass(px, pz);
    for (const ch of W.loaded.values()) for (const s of ch.swings) {
      const ph = s.userData.ph;
      s.rotation.set(Math.cos(t * 0.5 + ph) * 0.05, Math.sin(t * 0.23 + ph) * 0.6, Math.sin(t * 0.7 + ph) * 0.07);
    }
    // mist banks drifting around the player
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
      const near = smoothstep(2, 9, d);
      s.material.opacity = u.base * u.a * near * (0.7 + dark * 0.6);
    }
    // campfire
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
