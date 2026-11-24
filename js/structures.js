import * as THREE from '../lib/three.module.min.js';
import { clamp, lerp, smoothstep, mulberry32, mergeGeos, mergeUV } from './util.js';
import { desertWeight } from './biomes.js';

// =====================================================================================
//  Desert structures: the Great Pyramid (maze dungeon + boss chamber), small pyramids,
//  ritual camps and abandoned settlements.  Every structure has a stable id; colliders are
//  registered once at boot, meshes are built lazily when the player is near and disposed
//  when far away.  Nothing here is tied to chunk boundaries, so nothing can duplicate.
// =====================================================================================

// ---------------------------------------------------------------- planning (pure, at boot)
export function planDesert(seeded, HALF) {
  const great = { kind: 'great', id: 'gp', x: 1560, z: 0, A: 150, H: 175, plinth: 2.4 };
  const rng = seeded(9, 9, 91);
  const placed = [great];
  const okAt = (x, z, minD) => placed.every((p) => Math.hypot(p.x - x, p.z - z) > minD + (p.kind === 'great' ? 210 : 0));
  const pick = (n, minD, kind, prefix) => {
    const out = [];
    let tries = 0;
    while (out.length < n && tries++ < 4000) {
      const a = (rng() * 2 - 1) * 0.95, r = 430 + rng() * 1480;
      const x = r * Math.cos(a), z = r * Math.sin(a);
      if (Math.abs(x) > HALF - 110 || Math.abs(z) > HALF - 110 || desertWeight(x, z) < 0.985 || !okAt(x, z, minD)) continue;
      const s = { kind, id: prefix + out.length, x, z, rot: Math.floor(rng() * 4), seed: Math.floor(rng() * 1e9), occupied: rng() < 0.6 };
      out.push(s); placed.push(s);
    }
    return out;
  };
  const smalls = pick(7, 150, 'small', 'sp');
  const camps = pick(8, 140, 'camp', 'camp');
  const settlements = pick(5, 160, 'settle', 'st');
  // sand worm territories: deep desert, away from everything else
  const zones = [];
  {
    const zr = seeded(7, 7, 71);
    let tries = 0;
    while (zones.length < 3 && tries++ < 3000) {
      const a = (zr() * 2 - 1) * 0.9, r = 700 + zr() * 1150, x = r * Math.cos(a), z = r * Math.sin(a), R = 150 + zr() * 40;
      if (Math.abs(x) > HALF - R - 40 || Math.abs(z) > HALF - R - 40 || desertWeight(x, z) < 0.995) continue;
      if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < R + (p.kind === 'great' ? 240 : 60))) continue;
      if (zones.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + R + 150)) continue;
      zones.push({ id: 'worm' + zones.length, x, z, r: R });
    }
  }
  const sites = [
    { x: great.x, z: great.z, square: true, r0: 178, r1: 245 },
    ...smalls.map((s) => ({ x: s.x, z: s.z, square: true, r0: 24, r1: 44 })),
    ...camps.map((s) => ({ x: s.x, z: s.z, r0: 16, r1: 30 })),
    ...settlements.map((s) => ({ x: s.x, z: s.z, r0: 26, r1: 42 })),
  ];
  // the Great Pyramid stands on a plinth with a flight of stairs up to the entrance (west)
  const heightMod = (x, z, h) => {
    const dx = x - great.x, dz = z - great.z;
    if (Math.abs(dx) > 175 || Math.abs(dz) > 175) return h;
    if (Math.max(Math.abs(dx), Math.abs(dz)) < great.A + 2) return h + great.plinth;
    if (dx > -great.A - 18 && dx <= -great.A + 2 && Math.abs(dz) < 14) {
      const t = (dx + great.A + 18) / 18;
      return h + great.plinth * Math.min(1, Math.floor(t * 6 + 1) / 6);
    }
    return h;
  };
  // desert roads: link structures to their nearest neighbours
  const nodes = [great, ...camps, ...smalls, ...settlements];
  const links = [];
  const done = new Set();
  nodes.forEach((n, i) => {
    nodes.map((m, k) => ({ k, d: Math.hypot(m.x - n.x, m.z - n.z) })).filter((o) => o.k !== i).sort((a, b) => a.d - b.d).slice(0, 2).forEach((o) => {
      const key = Math.min(i, o.k) + '-' + Math.max(i, o.k);
      if (done.has(key)) return; done.add(key);
      const a = nodes[i], b = nodes[o.k];
      // stop roads at the Great Pyramid stairs instead of the centre
      const pa = a === great ? { x: great.x - great.A - 20, z: great.z } : a, pb = b === great ? { x: great.x - great.A - 20, z: great.z } : b;
      links.push([pa, pb]);
    });
  });
  return { great, smalls, camps, settlements, zones, sites, heightMod, links, nodes };
}

// ---------------------------------------------------------------- textures
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}
function sandstone(ctx, w, h, carve) {
  ctx.fillStyle = '#c4a878'; ctx.fillRect(0, 0, w, h);
  const id = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < w * h; i++) { const v = (Math.random() - 0.5) * 26; id.data[i * 4] += v; id.data[i * 4 + 1] += v; id.data[i * 4 + 2] += v * 0.8; }
  ctx.putImageData(id, 0, 0);
  const rows = 8, bh = h / rows;
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * 32;
    ctx.fillStyle = 'rgba(60,40,20,0.55)'; ctx.fillRect(0, r * bh, w, 2);
    for (let x = -off; x < w; x += 64) ctx.fillRect(x + off, r * bh, 2, bh);
    for (let k = 0; k < 3; k++) { ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`; ctx.fillRect(Math.random() * w, r * bh + Math.random() * bh, 10 + Math.random() * 30, 3 + Math.random() * 6); }
  }
  if (carve) { // hieroglyph-like carvings
    ctx.strokeStyle = 'rgba(70,45,20,0.75)'; ctx.lineWidth = 2.5;
    for (let r = 1; r < rows - 1; r += 2) for (let c = 0; c < 6; c++) {
      const x = 14 + c * 40, y = r * bh + 6, k = Math.floor(Math.random() * 6);
      ctx.beginPath();
      if (k === 0) { ctx.ellipse(x + 10, y + 10, 10, 6, 0, 0, 7); ctx.moveTo(x + 13, y + 10); ctx.arc(x + 10, y + 10, 3, 0, 7); }
      else if (k === 1) { ctx.arc(x + 10, y + 6, 5, 0, 7); ctx.moveTo(x + 10, y + 11); ctx.lineTo(x + 10, y + 24); ctx.moveTo(x + 3, y + 14); ctx.lineTo(x + 17, y + 14); }
      else if (k === 2) { for (let q = 0; q < 3; q++) { ctx.moveTo(x, y + 6 + q * 6); for (let s = 0; s < 4; s++) ctx.lineTo(x + 5 + s * 5, y + 6 + q * 6 + (s % 2 ? -3 : 3)); } }
      else if (k === 3) { ctx.moveTo(x + 2, y + 20); ctx.lineTo(x + 8, y + 4); ctx.lineTo(x + 16, y + 8); ctx.lineTo(x + 12, y + 20); ctx.moveTo(x + 8, y + 4); ctx.lineTo(x + 4, y + 2); }
      else if (k === 4) { ctx.rect(x, y, 20, 24); ctx.moveTo(x + 4, y + 8); ctx.lineTo(x + 16, y + 8); ctx.moveTo(x + 4, y + 16); ctx.lineTo(x + 16, y + 16); }
      else { ctx.moveTo(x, y + 20); ctx.quadraticCurveTo(x + 10, y - 4, x + 20, y + 20); ctx.moveTo(x + 10, y + 10); ctx.lineTo(x + 10, y + 22); }
      ctx.stroke();
    }
  }
}
function shellTexDraw(ctx, w, h) {
  ctx.fillStyle = '#b89c70'; ctx.fillRect(0, 0, w, h);
  const id = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < w * h; i++) { const v = (Math.random() - 0.5) * 22; id.data[i * 4] += v; id.data[i * 4 + 1] += v; id.data[i * 4 + 2] += v * 0.8; }
  ctx.putImageData(id, 0, 0);
  const bands = 4;
  for (let b = 0; b < bands; b++) {
    const y = (b * h) / bands, gr = ctx.createLinearGradient(0, y, 0, y + h / bands);
    gr.addColorStop(0, 'rgba(255,240,210,0.12)'); gr.addColorStop(0.85, 'rgba(0,0,0,0.05)'); gr.addColorStop(1, 'rgba(30,20,10,0.55)');
    ctx.fillStyle = gr; ctx.fillRect(0, y, w, h / bands);
    for (let x = (b % 2) * 24; x < w; x += 48) { ctx.fillStyle = 'rgba(40,25,10,0.35)'; ctx.fillRect(x, y, 2, h / bands); }
  }
}

// box with world-scaled UVs (texture repeats every `s` metres)
function boxUV(w, h, d, s = 6) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv, dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) { const k = f * 4 + i; uv.setXY(k, uv.getX(k) * dims[f][0] / s, uv.getY(k) * dims[f][1] / s); }
  return g;
}
function cylUV(r, h, seg = 10, s = 6) {
  const g = new THREE.CylinderGeometry(r, r * 1.08, h, seg);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (Math.PI * 2 * r) / s, uv.getY(i) * h / s);
  return g;
}

/** pyramid shell: 4 triangular faces, with an optional doorway notch cut into the west (-x) face */
function shellGeometry(A, H, notch) {
  const geos = [];
  for (let k = 0; k < 4; k++) {
    const sh = new THREE.Shape();
    if (k === 0 && notch) {
      sh.moveTo(-A, 0); sh.lineTo(notch.z0, 0); sh.lineTo(notch.z0, notch.h); sh.lineTo(notch.z1, notch.h); sh.lineTo(notch.z1, 0); sh.lineTo(A, 0); sh.lineTo(0, H); sh.closePath();
    } else { sh.moveTo(-A, 0); sh.lineTo(A, 0); sh.lineTo(0, H); sh.closePath(); }
    const g = new THREE.ShapeGeometry(sh).toNonIndexed();
    const p = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      const s = p.getX(i), y = p.getY(i);
      // west face: x = -A(1 - y/H), z = s ; rotate the other faces around Y
      const lx = -A * (1 - y / H), lz = s, ang = (k * Math.PI) / 2;
      p.setXYZ(i, lx * Math.cos(ang) - lz * Math.sin(ang), y, lx * Math.sin(ang) + lz * Math.cos(ang));
      uv.setXY(i, s / 14, y / 5);
    }
    // make sure the face points outward
    const a = new THREE.Vector3().fromBufferAttribute(p, 0), b = new THREE.Vector3().fromBufferAttribute(p, 1), c = new THREE.Vector3().fromBufferAttribute(p, 2);
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    const mid = a.clone().add(b).add(c).multiplyScalar(1 / 3); mid.y = 0;
    if (n.dot(mid) < 0) for (let i = 0; i < p.count; i += 3) {
      for (const attr of [p, uv]) { const sz = attr.itemSize; for (let q = 0; q < sz; q++) { const t = attr.array[(i + 1) * sz + q]; attr.array[(i + 1) * sz + q] = attr.array[(i + 2) * sz + q]; attr.array[(i + 2) * sz + q] = t; } }
    }
    g.computeVertexNormals();
    geos.push(g);
  }
  return mergeUV(geos);
}

// ---------------------------------------------------------------- maze
function genMaze(rng, N, boss) {
  const V = new Uint8Array((N + 1) * N).fill(1);   // vertical wall on x-line i at row j: V[i*N+j]
  const Hw = new Uint8Array((N + 1) * N).fill(1);  // horizontal wall on z-line j at column i: Hw[j*N+i]
  const vis = new Uint8Array(N * N);
  const stack = [[0, (N - 1) / 2]];
  vis[((N - 1) / 2) * N] = 1;
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (stack.length) {
    const [i, j] = stack[stack.length - 1];
    const opts = dirs.filter(([dx, dz]) => { const a = i + dx, b = j + dz; return a >= 0 && b >= 0 && a < N && b < N && !vis[b * N + a]; });
    if (!opts.length) { stack.pop(); continue; }
    const [dx, dz] = opts[Math.floor(rng() * opts.length)], a = i + dx, b = j + dz;
    if (dx === 1) V[(i + 1) * N + j] = 0; else if (dx === -1) V[i * N + j] = 0; else if (dz === 1) Hw[(j + 1) * N + i] = 0; else Hw[j * N + i] = 0;
    vis[b * N + a] = 1; stack.push([a, b]);
  }
  // rooms
  const rooms = [boss];
  let tries = 0;
  while (rooms.length < 8 && tries++ < 300) {
    const w = 3 + Math.floor(rng() * 2), h = 3, i0 = 2 + Math.floor(rng() * (N - w - 3)), j0 = 1 + Math.floor(rng() * (N - h - 2));
    const r = { i0, j0, i1: i0 + w - 1, j1: j0 + h - 1 };
    if (rooms.some((o) => r.i0 <= o.i1 + 1 && r.i1 >= o.i0 - 1 && r.j0 <= o.j1 + 1 && r.j1 >= o.j0 - 1)) continue;
    rooms.push(r);
  }
  for (const r of rooms) {
    for (let i = r.i0 + 1; i <= r.i1; i++) for (let j = r.j0; j <= r.j1; j++) V[i * N + j] = 0;
    for (let j = r.j0 + 1; j <= r.j1; j++) for (let i = r.i0; i <= r.i1; i++) Hw[j * N + i] = 0;
  }
  // extra loops so there are several routes
  for (let k = 0; k < N * N * 0.12; k++) {
    if (rng() < 0.5) { const i = 1 + Math.floor(rng() * (N - 1)), j = Math.floor(rng() * N); V[i * N + j] = 0; }
    else { const j = 1 + Math.floor(rng() * (N - 1)), i = Math.floor(rng() * N); Hw[j * N + i] = 0; }
  }
  // the boss chamber is entered from the middle of each side
  const mid = Math.floor((boss.i0 + boss.i1) / 2);
  V[boss.i0 * N + mid] = 0; V[(boss.i1 + 1) * N + mid] = 0; Hw[boss.j0 * N + mid] = 0; Hw[(boss.j1 + 1) * N + mid] = 0;
  V[(N - 1) / 2] = 0; // entrance on the west edge
  return { V, Hw, rooms };
}

// =====================================================================================
export function createDesert(ctx) {
  const { scene, plan, hgt, addBox, addStaticCircle, S, chunkIdx } = ctx;
  const D = { list: [], built: new Map(), onLoad: null, onUnload: null, mapMarks: [] };
  const tex = {
    stone: canvasTex(256, 256, (c, w, h) => sandstone(c, w, h, false)),
    carved: canvasTex(256, 256, (c, w, h) => sandstone(c, w, h, true)),
    shell: canvasTex(256, 256, shellTexDraw),
    floor: canvasTex(128, 128, (c, w, h) => { c.fillStyle = '#9a8462'; c.fillRect(0, 0, w, h); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { c.fillStyle = `rgba(0,0,0,${0.05 + Math.random() * 0.12})`; c.fillRect(i * 32 + 1, j * 32 + 1, 30, 30); } c.strokeStyle = 'rgba(40,25,10,0.6)'; for (let i = 0; i <= 4; i++) { c.beginPath(); c.moveTo(i * 32, 0); c.lineTo(i * 32, h); c.moveTo(0, i * 32); c.lineTo(w, i * 32); c.stroke(); } }),
  };
  const M = {
    stone: new THREE.MeshLambertMaterial({ map: tex.stone, color: 0xd8c4a0 }),
    carved: new THREE.MeshLambertMaterial({ map: tex.carved, color: 0xd8c4a0 }),
    ceil: new THREE.MeshLambertMaterial({ map: tex.stone, color: 0x6e5c46 }),
    floor: new THREE.MeshLambertMaterial({ map: tex.floor, color: 0xb8a07a }),
    shell: new THREE.MeshLambertMaterial({ map: tex.shell, color: 0xd0b88e, fog: false }),
    vc: new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
    shaft: new THREE.MeshBasicMaterial({ color: 0x9fb4e0, transparent: true, opacity: 0.045, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  };
  const flameTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,240,180,1)'); gr.addColorStop(0.35, 'rgba(255,150,40,0.85)'); gr.addColorStop(1, 'rgba(255,60,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const flameMat = new THREE.SpriteMaterial({ map: flameTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  const glowMat = new THREE.SpriteMaterial({ map: flameTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false, opacity: 0.75 });
  // torch / bonfire lights: a small fixed pool moved to whatever is nearest (light count never changes)
  const torchLights = [0, 1].map(() => { const l = new THREE.PointLight(0xff9a40, 0, 20, 1.8); scene.add(l); return l; });
  const fireLight = new THREE.PointLight(0xff8a35, 0, 40, 1.5); scene.add(fireLight);
  D.fireLight = fireLight;

  // helpers --------------------------------------------------------------
  const rotXZ = (lx, lz, k) => { const a = (k * Math.PI) / 2, c = Math.round(Math.cos(a)), s = Math.round(Math.sin(a)); return [lx * c + lz * s, -lx * s + lz * c]; };
  function worldBox(st, lx0, lx1, lz0, lz1, y0, y1, kind = 'rock') {
    const [ax, az] = rotXZ(lx0, lz0, st.rot || 0), [bx, bz] = rotXZ(lx1, lz1, st.rot || 0);
    return addBox(st.x + Math.min(ax, bx), st.x + Math.max(ax, bx), st.z + Math.min(az, bz), st.z + Math.max(az, bz), y0, y1, kind);
  }
  const statueGeo = () => mergeGeos([
    { geo: new THREE.BoxGeometry(2.4, 1.2, 3.2).translate(0, 0.6, 0), color: 0xb8a078 },
    { geo: new THREE.BoxGeometry(1.8, 1.4, 1.6).translate(0, 1.9, -0.6), color: 0xc4ac84 },
    { geo: new THREE.BoxGeometry(1.6, 0.5, 1.6).translate(0, 1.45, 0.5), color: 0xc4ac84 },
    { geo: new THREE.BoxGeometry(0.5, 1.2, 0.5).translate(0.55, 0.85, 1.2), color: 0xb8a078 },
    { geo: new THREE.BoxGeometry(0.5, 1.2, 0.5).translate(-0.55, 0.85, 1.2), color: 0xb8a078 },
    { geo: new THREE.BoxGeometry(1.0, 1.0, 1.0).translate(0, 3.1, -0.5), color: 0xc8b088 },
    { geo: new THREE.BoxGeometry(1.5, 1.3, 0.3).translate(0, 3.05, -0.85), color: 0x3a4a6a },
    { geo: new THREE.BoxGeometry(0.3, 0.6, 0.3).translate(0, 3.8, -0.5), color: 0xc8a040 },
  ]);
  const sarcGeo = () => mergeGeos([
    { geo: new THREE.BoxGeometry(1.1, 0.9, 2.5).translate(0, 0.45, 0), color: 0x8a7254 },
    { geo: new THREE.BoxGeometry(1.2, 0.25, 2.6).translate(0, 1.02, 0), color: 0xb08a4a },
    { geo: new THREE.BoxGeometry(0.6, 0.12, 0.7).translate(0, 1.2, -0.85), color: 0xd0a040 },
    { geo: new THREE.BoxGeometry(0.15, 0.1, 1.2).translate(0, 1.18, 0.3), color: 0x2a3a7a },
  ]);
  const torchBracket = mergeGeos([
    { geo: new THREE.BoxGeometry(0.12, 0.5, 0.12), color: 0x2a2018 },
    { geo: new THREE.CylinderGeometry(0.12, 0.06, 0.25, 6).translate(0, 0.3, 0), color: 0x3a2a1a },
  ]);

  for (const z of plan.zones) D.mapMarks.push({ x: z.x, z: z.z, w: z.r * 2, d: z.r * 2, color: 'rgba(150,40,25,0.35)', label: 'DEEP SANDS', id: z.id, zone: true });
  D.plan = plan;
  // ======================================================================== GREAT PYRAMID
  const G = plan.great;
  {
    const N = 31, CS = 8, EXT = (N * CS) / 2;   // 248 m interior, +-124
    const rng = mulberry32(4242);
    const boss = { i0: 12, i1: 18, j0: 12, j1: 18 };
    const { V, Hw, rooms } = genMaze(rng, N, boss);
    G.N = N; G.CS = CS; G.EXT = EXT; G.rooms = rooms; G.boss = boss;
    G.F = hgt(G.x, G.z);
    const cellOf = (i, j) => { for (let r = 0; r < rooms.length; r++) { const o = rooms[r]; if (i >= o.i0 && i <= o.i1 && j >= o.j0 && j <= o.j1) return r; } return -1; };
    const ceil = (i, j) => { const r = cellOf(i, j); return r === 0 ? 20 : r > 0 ? 16 : 12; };
    const cx = (i) => -EXT + i * CS;              // local line coordinate
    // walls -> merged runs, split at section boundaries
    const SEC = [0, 8, 16, 24, N];
    const secOf = (c) => (c < 8 ? 0 : c < 16 ? 1 : c < 24 ? 2 : 3);
    const walls = [];
    const flush = (run) => { if (run) walls.push(run); };
    for (let i = 0; i <= N; i++) { // vertical walls (x = const)
      let run = null;
      for (let j = 0; j < N; j++) {
        const on = V[i * N + j], h = Math.max(i > 0 ? ceil(i - 1, j) : 0, i < N ? ceil(i, j) : 0);
        if (on && run && run.h === h && SEC.indexOf(j) < 0) { run.z1 = cx(j + 1); continue; }
        flush(run); run = null;
        if (on) run = { x0: cx(i) - 0.6, x1: cx(i) + 0.6, z0: cx(j), z1: cx(j + 1), h, si: secOf(Math.min(i, N - 1)), sj: secOf(j), carved: rng() < 0.3 };
      }
      flush(run);
    }
    for (let j = 0; j <= N; j++) { // horizontal walls (z = const)
      let run = null;
      for (let i = 0; i < N; i++) {
        const on = Hw[j * N + i], h = Math.max(j > 0 ? ceil(i, j - 1) : 0, j < N ? ceil(i, j) : 0);
        if (on && run && run.h === h && SEC.indexOf(i) < 0) { run.x1 = cx(i + 1); continue; }
        flush(run); run = null;
        if (on) run = { x0: cx(i), x1: cx(i + 1), z0: cx(j) - 0.6, z1: cx(j) + 0.6, h, si: secOf(i), sj: secOf(Math.min(j, N - 1)), carved: rng() < 0.3 };
      }
      flush(run);
    }
    // entrance corridor through the 26 m between the maze and the outer shell (z in [-4,4])
    const entSec = { si: 0, sj: secOf((N - 1) / 2) };
    walls.push({ x0: -G.A - 2, x1: -EXT, z0: -4.6, z1: -3.4, h: 12, ...entSec, carved: true });
    walls.push({ x0: -G.A - 2, x1: -EXT, z0: 3.4, z1: 4.6, h: 12, ...entSec, carved: true });
    for (const w of walls) addBox(G.x + w.x0, G.x + w.x1, G.z + w.z0, G.z + w.z1, G.F - 1, G.F + w.h, 'rock');
    G.wallRuns = walls; G.V = V; G.Hw = Hw;
    // outer perimeter (keeps the player out of the space between shell and maze)
    const A = G.A, P = 2;
    addBox(G.x - A - P, G.x - A, G.z - A - P, G.z - 4.6, G.F - 3, G.F + 40, 'rock');
    addBox(G.x - A - P, G.x - A, G.z + 4.6, G.z + A + P, G.F - 3, G.F + 40, 'rock');
    addBox(G.x + A, G.x + A + P, G.z - A - P, G.z + A + P, G.F - 3, G.F + 40, 'rock');
    addBox(G.x - A - P, G.x + A + P, G.z - A - P, G.z - A, G.F - 3, G.F + 40, 'rock');
    addBox(G.x - A - P, G.x + A + P, G.z + A, G.z + A + P, G.F - 3, G.F + 40, 'rock');
    // entrance gate pillars + lintel
    addBox(G.x - A - 5, G.x - A + 1, G.z - 8.5, G.z - 4.6, G.F - 3, G.F + 16, 'rock');
    addBox(G.x - A - 5, G.x - A + 1, G.z + 4.6, G.z + 8.5, G.F - 3, G.F + 16, 'rock');

    // cells: open sides, dead ends
    const openSides = (i, j) => [!V[(i + 1) * N + j] && i < N - 1, !V[i * N + j] && i > 0, !Hw[(j + 1) * N + i] && j < N - 1, !Hw[j * N + i] && j > 0];
    G.loot = []; G.nests = []; G.torches = []; G.props = []; G.shafts = [];
    const centerOf = (i, j) => [cx(i) + CS / 2, cx(j) + CS / 2];
    let deadEnds = 0;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const r = cellOf(i, j);
      const o = openSides(i, j), n = o.filter(Boolean).length;
      const [lx, lz] = centerOf(i, j);
      if (r < 0 && n === 1 && !(i === 0 && j === (N - 1) / 2)) { // dead end: optional loot
        deadEnds++;
        const roll = rng();
        if (roll < 0.45) G.loot.push({ lx, lz, type: roll < 0.18 ? 'ammo' : roll < 0.32 ? 'med' : 'coin', count: roll < 0.32 ? 1 : 2 + Math.floor(rng() * 4) });
        else if (roll < 0.62) G.nests.push({ lx, lz });
      }
      // torches on corridor walls
      if (r < 0 && (i * 7 + j * 3) % 5 === 0) {
        const sides = [[!o[0], 1, 0], [!o[1], -1, 0], [!o[2], 0, 1], [!o[3], 0, -1]].filter((s) => s[0]);
        if (sides.length) { const [, dx, dz] = sides[0]; G.torches.push({ lx: lx + dx * (CS / 2 - 1.0), lz: lz + dz * (CS / 2 - 1.0), y: 3.6, si: secOf(i), sj: secOf(j) }); }
      }
    }
    G.deadEnds = deadEnds;
    // rooms: pillars, statues, sarcophagi, loot, nests, moonlight shafts
    rooms.forEach((r, k) => {
      const x0 = cx(r.i0), x1 = cx(r.i1 + 1), z0 = cx(r.j0), z1 = cx(r.j1 + 1), mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      const si = secOf(Math.floor((r.i0 + r.i1) / 2)), sj = secOf(Math.floor((r.j0 + r.j1) / 2));
      if (k === 0) return; // boss chamber handled below
      const hgtC = 16;
      for (const [fx, fz] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) G.props.push({ type: 'pillar', lx: lerp(x0, x1, fx), lz: lerp(z0, z1, fz), r: 0.9, h: hgtC, si, sj });
      G.props.push({ type: 'statue', lx: x0 + 2.2, lz: mz, ry: -Math.PI / 2, si, sj });
      G.props.push({ type: 'sarc', lx: mx, lz: mz, ry: rng() < 0.5 ? 0 : Math.PI / 2, si, sj });
      G.loot.push({ lx: mx + 3, lz: mz + 2, type: k % 3 === 0 ? 'relic' : rng() < 0.5 ? 'ammo' : 'med', count: 1 });
      G.loot.push({ lx: mx - 3, lz: mz - 2, type: 'coin', count: 3 + Math.floor(rng() * 5) });
      if (k % 2) G.nests.push({ lx: mx + 4, lz: mz - 3 }, { lx: mx - 4, lz: mz + 3 });
      if (k <= 3) G.shafts.push({ lx: mx, lz: mz, h: hgtC, r: 2.6, si, sj });
      for (const [dx, dz] of [[x0 + 0.9, mz], [x1 - 0.9, mz]]) G.torches.push({ lx: dx, lz: dz, y: 4, si, sj });
    });
    // boss chamber
    {
      const x0 = cx(boss.i0), x1 = cx(boss.i1 + 1), z0 = cx(boss.j0), z1 = cx(boss.j1 + 1);
      G.chamber = { x0: G.x + x0, x1: G.x + x1, z0: G.z + z0, z1: G.z + z1 };
      const si = 1, sj = 1, h = 20;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2 + Math.PI / 8, rr = 17;
        G.props.push({ type: 'pillar', lx: Math.cos(a) * rr, lz: Math.sin(a) * rr, r: 1.6, h, si: secOf(Math.floor((Math.cos(a) * rr + EXT) / CS)), sj: secOf(Math.floor((Math.sin(a) * rr + EXT) / CS)) });
      }
      G.throne = { lx: x1 - 16, lz: 0 }; G.throneScale = 2.2;
      G.props.push({ type: 'throne', lx: G.throne.lx, lz: 0, si: 2, sj });
      G.props.push({ type: 'statue', lx: x1 - 8, lz: -20, ry: -Math.PI / 2, s: 2.2, si: 2, sj });
      G.props.push({ type: 'statue', lx: x1 - 8, lz: 20, ry: -Math.PI / 2, s: 2.2, si: 2, sj });
      for (let k = 0; k < 6; k++) G.props.push({ type: 'sarc', lx: x0 + 6 + (k % 3) * 9, lz: (k < 3 ? -1 : 1) * 23, ry: Math.PI / 2, si: k % 3 === 2 ? 1 : 1, sj: secOf(Math.floor(((k < 3 ? -1 : 1) * 23 + EXT) / CS)) });
      for (let k = 0; k < 12; k++) {
        const t = k / 12; let lx, lz;
        if (k < 3) { lx = lerp(x0, x1, (k + 1) / 4); lz = z0 + 0.9; } else if (k < 6) { lx = lerp(x0, x1, (k - 2) / 4); lz = z1 - 0.9; }
        else if (k < 9) { lx = x0 + 0.9; lz = lerp(z0, z1, (k - 5) / 4); } else { lx = x1 - 0.9; lz = lerp(z0, z1, (k - 8) / 4); }
        G.torches.push({ lx, lz, y: 4.5, si: secOf(Math.floor((lx + EXT) / CS)), sj: secOf(Math.floor((lz + EXT) / CS)), boss: true });
        void t;
      }
      G.shafts.push({ lx: -6, lz: 0, h: 20, r: 6, si: 1, sj: 1, big: true });
      G.bossTorches = G.torches.filter((t) => t.boss);
    }
    // assign every interior object to the section it sits in
    const secAt = (v) => secOf(clamp(Math.floor((v + EXT) / CS), 0, N - 1));
    for (const o of [...G.props, ...G.shafts, ...G.torches.filter((t) => !t.outside)]) { o.si = secAt(o.lx); o.sj = secAt(o.lz); }
    // collision for props
    for (const p of G.props) {
      const X = G.x + p.lx, Z = G.z + p.lz;
      if (p.type === 'pillar') addBox(X - p.r, X + p.r, Z - p.r, Z + p.r, G.F - 1, G.F + p.h, 'rock');
      else if (p.type === 'statue') { const s = p.s || 1; addBox(X - 1.6 * s, X + 1.6 * s, Z - 1.8 * s, Z + 1.8 * s, G.F - 1, G.F + 4 * s, 'rock'); }
      else if (p.type === 'sarc') addBox(X - 1.3, X + 1.3, Z - 1.3, Z + 1.3, G.F - 1, G.F + 1.2, 'rock');
      else if (p.type === 'throne') { const k = G.throneScale; addBox(X - 6 * k, X + 6 * k, Z - 6 * k, Z + 6 * k, G.F - 1, G.F + 1.0 * k, 'rock'); addBox(X - 4 * k, X + 4 * k, Z - 4 * k, Z + 4 * k, G.F - 1, G.F + 2.0 * k, 'rock'); }
    }
    // exterior: statues flanking the stairs, broken pillars, torches
    G.ext = [];
    for (const s of [-1, 1]) { G.ext.push({ type: 'statue', lx: -A - 30, lz: s * 20, ry: Math.PI / 2, s: 2.6 }); addBox(G.x - A - 30 - 4.2, G.x - A - 30 + 4.2, G.z + s * 20 - 4.7, G.z + s * 20 + 4.7, G.F - 4, G.F + 10, 'rock'); }
    for (let k = 0; k < 8; k++) { const lz = (k < 4 ? -1 : 1) * (26 + (k % 4) * 14), lx = -A - 12 - (k % 2) * 8, h = 2 + (k * 37) % 7; G.ext.push({ type: 'pillar', lx, lz, r: 1.1, h }); addBox(G.x + lx - 1.1, G.x + lx + 1.1, G.z + lz - 1.1, G.z + lz + 1.1, G.F - 6, G.F + h, 'rock'); }
    for (const z of [-11, 11, -24, 24]) G.torches.push({ lx: -A - 6, lz: z, y: 3.2, outside: true, si: 0, sj: entSec.sj });
    D.list.push(G);
    D.mapMarks.push({ x: G.x, z: G.z, w: 300, d: 300, color: '#c8aa78', label: 'GREAT PYRAMID', id: G.id });
  }

  // ======================================================================== SMALL PYRAMIDS
  for (const sp of plan.smalls) {
    sp.A = 18; sp.H = 24; sp.F = hgt(sp.x, sp.z);
    // interior rooms (local, entrance on the -x face)
    sp.rects = [
      { x0: -18, x1: -7, z0: -2, z1: 2, c: 4.5 },     // corridor
      { x0: -7, x1: 7, z0: -7, z1: 7, c: 8 },         // chamber
      { x0: -3, x1: 3, z0: 7, z1: 13, c: 5 },         // north room
      { x0: -3, x1: 3, z0: -13, z1: -7, c: 5 },       // south room
    ];
    const T = 0.8, wl = [];
    const wall = (x0, x1, z0, z1, h) => wl.push({ x0, x1, z0, z1, h });
    wall(-18, -7, -2 - T, -2, 4.5); wall(-18, -7, 2, 2 + T, 4.5);                         // corridor sides
    wall(-7 - T, -7, -7, -2, 8); wall(-7 - T, -7, 2, 7, 8);                                  // chamber west (door)
    wall(7, 7 + T, -7, 7, 8);                                                                // chamber east
    wall(-7, -1.5, 7, 7 + T, 8); wall(1.5, 7, 7, 7 + T, 8);                                  // chamber north (door)
    wall(-7, -1.5, -7 - T, -7, 8); wall(1.5, 7, -7 - T, -7, 8);                              // chamber south (door)
    wall(-3 - T, -3, 7, 13, 5); wall(3, 3 + T, 7, 13, 5); wall(-3 - T, 3 + T, 13, 13 + T, 5); // north room
    wall(-3 - T, -3, -13, -7, 5); wall(3, 3 + T, -13, -7, 5); wall(-3 - T, 3 + T, -13 - T, -13, 5);
    sp.walls = wl;
    for (const w of wl) worldBox(sp, w.x0, w.x1, w.z0, w.z1, sp.F - 1, sp.F + w.h);
    // perimeter with the doorway gap
    worldBox(sp, -sp.A - 1, -sp.A, -sp.A - 1, -2, sp.F - 2, sp.F + 9); worldBox(sp, -sp.A - 1, -sp.A, 2, sp.A + 1, sp.F - 2, sp.F + 9);
    worldBox(sp, sp.A, sp.A + 1, -sp.A - 1, sp.A + 1, sp.F - 2, sp.F + 9);
    worldBox(sp, -sp.A - 1, sp.A + 1, -sp.A - 1, -sp.A, sp.F - 2, sp.F + 9); worldBox(sp, -sp.A - 1, sp.A + 1, sp.A, sp.A + 1, sp.F - 2, sp.F + 9);
    // contents
    const R = mulberry32(sp.seed);
    sp.props = [{ type: 'sarc', lx: 2, lz: 0, ry: 0 }];
    for (const [a, b] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) sp.props.push({ type: 'pillar', lx: a, lz: b, r: 0.6, h: 8 });
    worldBox(sp, 0.7, 3.3, -1.3, 1.3, sp.F - 1, sp.F + 1.2);
    for (const [a, b] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) worldBox(sp, a - 0.6, a + 0.6, b - 0.6, b + 0.6, sp.F - 1, sp.F + 8);
    sp.torches = [{ lx: -6.3, lz: -5, y: 3.2 }, { lx: -6.3, lz: 5, y: 3.2 }, { lx: 6.3, lz: -4, y: 3.2 }, { lx: 6.3, lz: 4, y: 3.2 }, { lx: 0, lz: 12.3, y: 2.6 }, { lx: 0, lz: -12.3, y: 2.6 }, { lx: -19.5, lz: -3.2, y: 2.6, outside: true }, { lx: -19.5, lz: 3.2, y: 2.6, outside: true }];
    const pool = ['ammo', 'med', 'coin', 'coin', 'ammo'];
    sp.loot = [{ lx: -4.5, lz: 0, type: pool[Math.floor(R() * pool.length)] }, { lx: 5, lz: 5, type: 'coin', count: 2 + Math.floor(R() * 4) }, { lx: 0, lz: 10, type: pool[Math.floor(R() * pool.length)] }, { lx: 0, lz: -10, type: 'coin', count: 1 + Math.floor(R() * 3) }];
    sp.nests = sp.occupied ? [{ lx: 5, lz: -5 }, { lx: -5, lz: 5 }, { lx: 0, lz: 11 }, { lx: 0, lz: -11 }].slice(0, 2 + Math.floor(R() * 3)) : [];
    D.list.push(sp);
    D.mapMarks.push({ x: sp.x, z: sp.z, w: 36, d: 36, color: '#b89a6c', label: 'PYRAMID', id: sp.id });
  }

  // ======================================================================== CAMPS
  for (const cp of plan.camps) {
    cp.F = hgt(cp.x, cp.z);
    const R = mulberry32(cp.seed);
    addStaticCircle(cp.x, cp.z, 1.6, 1.0, 'rock');
    cp.tents = [];
    for (let k = 0; k < 3; k++) { const a = R() * 6.28 * 0 + (k / 3) * Math.PI * 2 + 0.4, r = 12; const t = { x: cp.x + Math.cos(a) * r, z: cp.z + Math.sin(a) * r, a, col: [0x5a1a14, 0x6a4a24, 0x3a2a3a][k] }; cp.tents.push(t); addStaticCircle(t.x, t.z, 1.7, 2, 'wood'); }
    cp.stones = [];
    for (let k = 0; k < 7; k++) { const a = (k / 7) * Math.PI * 2 + 0.2, r = 8.5; const s = { x: cp.x + Math.cos(a) * r, z: cp.z + Math.sin(a) * r, h: 2.2 + R() * 1.4 }; cp.stones.push(s); addStaticCircle(s.x, s.z, 0.55, s.h, 'rock'); }
    cp.crates = [];
    for (let k = 0; k < 3; k++) { const a = cp.tents[k].a + 0.45, r = 10.5; const c = { x: cp.x + Math.cos(a) * r, z: cp.z + Math.sin(a) * r }; cp.crates.push(c); addStaticCircle(c.x, c.z, 0.55, 0.8, 'wood'); }
    const types = [['canned', 'water', 'cloth', 'ammo'], ['water', 'canned', 'ammo', 'cloth'], ['cloth', 'water', 'canned', 'med']][Math.floor(R() * 3)];
    cp.loot = cp.crates.map((c, k) => ({ wx: c.x + 0.9, wz: c.z, type: types[k], count: types[k] === 'cloth' ? 2 : 1 })).concat([{ wx: cp.x + 3, wz: cp.z + 5.5, type: types[3], count: 1 }]);
    cp.seats = Array.from({ length: 6 }, (_, k) => { const a = (k / 6) * Math.PI * 2; return { x: cp.x + Math.cos(a) * 4.3, z: cp.z + Math.sin(a) * 4.3, yaw: Math.atan2(-Math.cos(a), -Math.sin(a)) }; });
    // a bright glow that is visible across the desert (navigation landmark)
    const glow = new THREE.Sprite(glowMat); glow.scale.set(16, 16, 1); glow.position.set(cp.x, cp.F + 3.5, cp.z); glow.renderOrder = 2; scene.add(glow);
    cp.glow = glow;
    D.list.push(cp);
    D.mapMarks.push({ x: cp.x, z: cp.z, w: 6, d: 6, color: '#ff9a40', label: 'CAMP', id: cp.id, dot: true });
  }

  // ======================================================================== SETTLEMENTS (adobe houses through the world's house system)
  for (const st of plan.settlements) {
    const R = mulberry32(st.seed);
    const n = 3 + Math.floor(R() * 3), a0 = R() * 6.28;
    st.F = hgt(st.x, st.z);
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * Math.PI * 2 + (R() - 0.5) * 0.3, r = 12 + R() * 4;
      const x = st.x + Math.cos(a) * r, z = st.z + Math.sin(a) * r;
      const ry = Math.round(Math.atan2(st.x - x, st.z - z) / (Math.PI / 2)) * (Math.PI / 2);
      const h = ctx.addHouse({ x, z, ry, w: 5 + R() * 2.5, d: 4.5 + R() * 1.5, ht: 2.6 + R() * 0.4, adobe: true });
      const [lx, lz] = h.toW((R() - 0.5) * (h.w - 2), (R() - 0.5) * (h.d - 2.5));
      const pool = ['canned', 'water', 'ammo', 'coin', 'med'], t = pool[Math.floor(R() * pool.length)];
      S(chunkIdx(lx, lz)).loot.push({ x: lx, z: lz, y: h.y + 0.12, type: t, count: t === 'coin' ? 2 + Math.floor(R() * 3) : 1 });
    }
    S(chunkIdx(st.x, st.z)).props.push({ type: 'well', x: st.x, z: st.z, y: st.F });
    for (let k = 0; k < 5; k++) { const a = R() * 6.28, r = 3 + R() * 9, x = st.x + Math.cos(a) * r, z = st.z + Math.sin(a) * r; S(chunkIdx(x, z)).props.push({ type: 'bonepile', x, z, y: hgt(x, z), yaw: R() * 6.28 }); }
    for (let k = 0; k < 3; k++) { const a = R() * 6.28, r = 6 + R() * 10; S(chunkIdx(st.x + Math.cos(a) * r, st.z + Math.sin(a) * r)).nests.push({ x: st.x + Math.cos(a) * r, z: st.z + Math.sin(a) * r }); }
    D.mapMarks.push({ x: st.x, z: st.z, w: 4, d: 4, color: '#a08060', label: 'RUINED SETTLEMENT', id: st.id, dot: true });
  }

  // ======================================================================== mesh builders
  function torchSprite(group, x, y, z) {
    const b = new THREE.Mesh(torchBracket, M.vc); b.position.set(x, y - 0.35, z); group.add(b);
    const f = new THREE.Sprite(flameMat); f.position.set(x, y + 0.05, z); f.scale.set(0.7, 1.0, 1); f.userData.ph = Math.random() * 6; group.add(f);
    return f;
  }
  function propMesh(p, F) {
    if (p.type === 'pillar') { const m = new THREE.Mesh(cylUV(p.r, p.h, 12, 5), M.carved); m.position.set(p.lx, F + p.h / 2, p.lz); m.castShadow = true; m.userData.own = true; return m; }
    if (p.type === 'statue') { const m = new THREE.Mesh(statueGeo(), M.vc); m.position.set(p.lx, F, p.lz); m.rotation.y = p.ry || 0; m.scale.setScalar(p.s || 1.25); m.castShadow = true; m.userData.own = true; return m; }
    if (p.type === 'sarc') { const m = new THREE.Mesh(sarcGeo(), M.vc); m.position.set(p.lx, F, p.lz); m.rotation.y = p.ry || 0; m.userData.own = true; return m; }
    if (p.type === 'throne') {
      const m = new THREE.Mesh(mergeUV([boxUV(12, 1, 12, 4).translate(0, 0.5, 0), boxUV(8, 1, 8, 4).translate(0, 1.5, 0), boxUV(3.6, 0.8, 3, 3).translate(0, 2.4, 0), boxUV(3.6, 5.5, 0.8, 3).translate(0, 4.75, 1.4), boxUV(0.6, 1.6, 3, 3).translate(1.6, 3.2, 0), boxUV(0.6, 1.6, 3, 3).translate(-1.6, 3.2, 0)]), M.carved);
      m.rotation.y = Math.PI / 2; m.scale.setScalar(2.2); m.position.set(p.lx, F, p.lz); m.userData.own = true; return m;
    }
    return null;
  }
  function shaft(group, s, F) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(s.r * 0.8, s.r * 1.15, s.h, 16, 1, true), M.shaft); m.position.set(s.lx, F + s.h / 2, s.lz); m.userData.own = true; group.add(m);
    const n = s.big ? 120 : 40, pts = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const a = Math.random() * 6.28, r = Math.random() * s.r; pts[i * 3] = s.lx + Math.cos(a) * r; pts[i * 3 + 1] = F + Math.random() * s.h; pts[i * 3 + 2] = s.lz + Math.sin(a) * r; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    const d = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xd8e0f0, size: 0.06, transparent: true, opacity: 0.6, depthWrite: false })); d.userData = { own: true, dust: true, s, F, base: pts.slice() };
    group.add(d);
  }

  // Great Pyramid: shell (always while near), plus 16 interior sections built one per frame
  function buildGreatShell() {
    const g = new THREE.Group(); g.position.set(G.x, G.F, G.z);
    const shell = new THREE.Mesh(shellGeometry(G.A, G.H, { z0: -4.6, z1: 4.6, h: 12 }), M.shell); shell.userData.own = true; shell.castShadow = false; shell.receiveShadow = false;
    g.add(shell);
    // plinth, stairs, gateway, exterior statues / pillars / torches
    const ex = [boxUV(G.A * 2 + 4, 3.4, G.A * 2 + 4, 6).translate(0, -1.7 + 0.02, 0)];
    for (let k = 0; k < 6; k++) { const t0 = k / 6, d = 18 / 6; ex.push(boxUV(d, G.plinth * (k + 1) / 6 + 1, 28, 4).translate(-G.A - 18 + (k + 0.5) * d, -G.plinth + (G.plinth * (k + 1) / 6 + 1) / 2 - 1, 0)); void t0; }
    ex.push(boxUV(6, 19, 3.9, 6).translate(-G.A - 2, 9.5 - 3, -6.55), boxUV(6, 19, 3.9, 6).translate(-G.A - 2, 9.5 - 3, 6.55), boxUV(7, 4, 18, 6).translate(-G.A - 2, 14, 0));
    const exm = new THREE.Mesh(mergeUV(ex), M.carved); exm.userData.own = true; exm.castShadow = true; exm.receiveShadow = true; g.add(exm);
    const flames = [];
    for (const p of G.ext) { const m = propMesh(p, 0); if (m) g.add(m); }
    for (const t of G.torches) if (t.outside) flames.push(torchSprite(g, t.lx, t.y, t.lz));
    // sand drifts against the foundations
    const drifts = [];
    for (let k = 0; k < 40; k++) { const side = k % 4, s = ((k * 53) % 100) / 100 * 2 - 1; let lx = side === 0 ? -G.A - 3 : side === 1 ? G.A + 3 : s * G.A, lz = side >= 2 ? (side === 2 ? -G.A - 3 : G.A + 3) : s * G.A; if (side === 0 && Math.abs(lz) < 32) continue; drifts.push({ geo: new THREE.SphereGeometry(1, 8, 5).scale(9, 2.4, 6).rotateY(side < 2 ? Math.PI / 2 : 0).translate(lx, -0.6, lz), color: 0xb39d77 }); }
    const dm = new THREE.Mesh(mergeGeos(drifts), M.vc); dm.userData.own = true; dm.receiveShadow = true; g.add(dm);
    scene.add(g);
    return { g, shell, flames };
  }
  function buildGreatSection(si, sj) {
    const { CS, N, EXT } = G;
    const g = new THREE.Group(); g.position.set(G.x, G.F, G.z);
    const SEC = [0, 8, 16, 24, N];
    const sx0 = -EXT + SEC[si] * CS, sx1 = -EXT + SEC[si + 1] * CS, sz0 = -EXT + SEC[sj] * CS, sz1 = -EXT + SEC[sj + 1] * CS;
    const plain = [], carved = [], ceil = [];
    // (walls are stored in world colliders; rebuild visuals from the same runs)
    for (const w of G.wallRuns) if (w.si === si && w.sj === sj) (w.carved ? carved : plain).push(boxUV(w.x1 - w.x0, w.h, w.z1 - w.z0).translate((w.x0 + w.x1) / 2, w.h / 2, (w.z0 + w.z1) / 2));
    // ceilings per cell (holes where moonlight shafts come in), fascias between ceiling heights
    const rooms = G.rooms;
    const roomOf = (i, j) => { for (let r = 0; r < rooms.length; r++) { const o = rooms[r]; if (i >= o.i0 && i <= o.i1 && j >= o.j0 && j <= o.j1) return r; } return -1; };
    const ch = (i, j) => { const r = roomOf(i, j); return r === 0 ? 20 : r > 0 ? 16 : 12; };
    const shaftCells = new Set(G.shafts.map((s) => Math.floor((s.lx + EXT) / CS) + ',' + Math.floor((s.lz + EXT) / CS)));
    for (const s of G.shafts.filter((s) => s.big)) for (let a = -1; a <= 0; a++) for (let b = -1; b <= 0; b++) shaftCells.add((Math.floor((s.lx + EXT) / CS) + a) + ',' + (Math.floor((s.lz + EXT) / CS) + b + 1));
    for (let i = SEC[si]; i < SEC[si + 1]; i++) for (let j = SEC[sj]; j < SEC[sj + 1]; j++) {
      const h = ch(i, j), x = -EXT + i * CS, z = -EXT + j * CS;
      if (!shaftCells.has(i + ',' + j)) ceil.push(boxUV(CS, 1, CS).translate(x + CS / 2, h + 0.5, z + CS / 2));
      if (i + 1 < N && !G.V[(i + 1) * N + j]) { const h2 = ch(i + 1, j); if (h2 !== h) ceil.push(boxUV(0.6, Math.abs(h2 - h), CS).translate(x + CS, Math.min(h, h2) + Math.abs(h2 - h) / 2, z + CS / 2)); }
      if (j + 1 < N && !G.Hw[(j + 1) * N + i]) { const h2 = ch(i, j + 1); if (h2 !== h) ceil.push(boxUV(CS, Math.abs(h2 - h), 0.6).translate(x + CS / 2, Math.min(h, h2) + Math.abs(h2 - h) / 2, z + CS)); }
    }
    if (si === 0 && sj === 1) { ceil.push(boxUV(G.A - EXT + 2, 1, 9.2).translate(-(G.A + EXT) / 2 - 1, 12.5, 0)); }
    const add = (geos, mat, shadow = false) => { if (!geos.length) return; const m = new THREE.Mesh(mergeUV(geos), mat); m.userData.own = true; m.castShadow = shadow; m.receiveShadow = true; g.add(m); };
    add(plain, M.stone); add(carved, M.carved); add(ceil, M.ceil);
    const fl = new THREE.Mesh(boxUV(sx1 - sx0, 0.1, sz1 - sz0, 8), M.floor); fl.position.set((sx0 + sx1) / 2, 0.0, (sz0 + sz1) / 2); fl.userData.own = true; fl.receiveShadow = true; g.add(fl);
    if (si === 0 && sj === 1) { const f2 = new THREE.Mesh(boxUV(G.A - EXT + 2, 0.1, 9.2, 8), M.floor); f2.position.set(-(G.A + EXT) / 2 - 1, 0, 0); f2.userData.own = true; g.add(f2); }
    for (const p of G.props) if (p.si === si && p.sj === sj) { const m = propMesh(p, 0); if (m) g.add(m); }
    const flames = [];
    for (const t of G.torches) if (!t.outside && t.si === si && t.sj === sj) flames.push(torchSprite(g, t.lx, t.y, t.lz));
    for (const s of G.shafts) if (s.si === si && s.sj === sj) shaft(g, s, 0);
    g.visible = false;
    scene.add(g);
    return { g, si, sj, flames, cx: G.x + (sx0 + sx1) / 2, cz: G.z + (sz0 + sz1) / 2, hw: (sx1 - sx0) / 2, hd: (sz1 - sz0) / 2 };
  }

  // small pyramid --------------------------------------------------------
  function buildSmall(sp) {
    const g = new THREE.Group(); g.position.set(sp.x, sp.F, sp.z); g.rotation.y = ((sp.rot || 0) * Math.PI) / 2;
    const shell = new THREE.Mesh(shellGeometry(sp.A, sp.H, { z0: -2, z1: 2, h: 4.5 }), M.shell); shell.userData.own = true; g.add(shell);
    const walls = sp.walls.map((w) => boxUV(w.x1 - w.x0, w.h, w.z1 - w.z0, 4).translate((w.x0 + w.x1) / 2, w.h / 2, (w.z0 + w.z1) / 2));
    const wm = new THREE.Mesh(mergeUV(walls), M.carved); wm.userData.own = true; wm.receiveShadow = true; g.add(wm);
    const ceil = sp.rects.map((r) => boxUV(r.x1 - r.x0 + 1.6, 0.8, r.z1 - r.z0 + 1.6, 4).translate((r.x0 + r.x1) / 2, r.c + 0.4, (r.z0 + r.z1) / 2));
    ceil.push(boxUV(0.6, 3.5, 4, 4).translate(-7, 6.25, 0), boxUV(3, 3, 0.6, 4).translate(0, 6.5, 7), boxUV(3, 3, 0.6, 4).translate(0, 6.5, -7));
    const cm = new THREE.Mesh(mergeUV(ceil), M.ceil); cm.userData.own = true; g.add(cm);
    const fl = new THREE.Mesh(mergeUV(sp.rects.map((r) => boxUV(r.x1 - r.x0, 0.1, r.z1 - r.z0, 6).translate((r.x0 + r.x1) / 2, 0.02, (r.z0 + r.z1) / 2))), M.floor); fl.userData.own = true; g.add(fl);
    for (const p of sp.props) { const m = propMesh(p, 0); if (m) g.add(m); }
    const flames = sp.torches.map((t) => torchSprite(g, t.lx, t.y, t.lz));
    scene.add(g);
    return { g, flames, shell };
  }

  // camp -----------------------------------------------------------------
  const potGeo = (() => { const pts = [[0, 0], [0.22, 0.02], [0.32, 0.25], [0.28, 0.5], [0.14, 0.62], [0.16, 0.7]].map(([a, b]) => new THREE.Vector2(a, b)); return new THREE.LatheGeometry(pts, 8); })();
  function buildCamp(cp) {
    const g = new THREE.Group(); g.position.set(cp.x, cp.F, cp.z);
    const parts = [];
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; parts.push({ geo: new THREE.CylinderGeometry(0.12, 0.15, 1.8, 6).rotateZ(Math.PI / 2 - 0.5).rotateY(a).translate(Math.cos(a) * 0.4, 0.45, Math.sin(a) * 0.4), color: 0x3a2618 }); }
    for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2; parts.push({ geo: new THREE.DodecahedronGeometry(0.3, 0).translate(Math.cos(a) * 1.3, 0.15, Math.sin(a) * 1.3), color: 0x5c564e }); }
    for (const t of cp.tents) parts.push({ geo: new THREE.ConeGeometry(2.0, 2.4, 6).translate(0, 1.2, 0).scale(1, 1, 1.25).rotateY(t.a).translate(t.x - cp.x, 0, t.z - cp.z), color: t.col });
    for (const s of cp.stones) parts.push({ geo: new THREE.BoxGeometry(0.9, s.h, 0.6).translate(s.x - cp.x, s.h / 2 - 0.1, s.z - cp.z), color: 0x6a6258 });
    for (const c of cp.crates) parts.push({ geo: new THREE.BoxGeometry(0.9, 0.7, 0.7).translate(c.x - cp.x, 0.35, c.z - cp.z), color: 0x5a4428 });
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2 + 0.5; parts.push({ geo: new THREE.BoxGeometry(1.4, 0.03, 2.2).rotateY(-a).translate(Math.cos(a) * 4.3, 0.02, Math.sin(a) * 4.3), color: [0x6a1a1a, 0x4a2a10, 0x2a2a4a][k % 3] }); }
    for (let k = 0; k < 7; k++) { const a = (k / 7) * Math.PI * 2 + 0.9, r = 13.5 + (k % 2); parts.push({ geo: potGeo.clone().scale(1 + (k % 3) * 0.4, 1 + (k % 3) * 0.4, 1 + (k % 3) * 0.4).translate(Math.cos(a) * r, 0, Math.sin(a) * r), color: 0x8a4a2a }); }
    // ritual stone slab with a skull
    parts.push({ geo: new THREE.BoxGeometry(2.2, 0.7, 1.1).translate(0, 0.35, -6.4), color: 0x5a5248 }, { geo: new THREE.SphereGeometry(0.2, 7, 5).translate(0, 0.85, -6.4), color: 0xd8d0b8 });
    const m = new THREE.Mesh(mergeGeos(parts), M.vc); m.userData.own = true; m.castShadow = true; m.receiveShadow = true; g.add(m);
    const flames = [];
    for (let k = 0; k < 5; k++) { const f = new THREE.Sprite(flameMat); f.position.set((Math.random() - 0.5) * 0.5, 1.0 + k * 0.25, (Math.random() - 0.5) * 0.5); f.userData = { ph: Math.random() * 6, base: 2.4 - k * 0.3, bonfire: true }; g.add(f); flames.push(f); }
    scene.add(g);
    return { g, flames };
  }

  // ======================================================================== runtime
  D.great = G;
  const near = (st, px, pz) => Math.hypot(st.x - px, st.z - pz);
  let secQueue = [];
  D.indoorAmount = 0;
  D.insideOf = (x, z) => {
    // returns the structure the point is inside (or null) and how "deep" (0..1)
    {
      const lx = x - G.x, lz = z - G.z;
      if (Math.abs(lx) < G.EXT && Math.abs(lz) < G.EXT) return { st: G, k: 1 };
      if (lx > -G.A - 2 && lx < -G.EXT && Math.abs(lz) < 4.6) return { st: G, k: clamp((lx + G.A + 2) / 10, 0, 1) };
    }
    for (const sp of plan.smalls) {
      const dx = x - sp.x, dz = z - sp.z;
      if (Math.abs(dx) > sp.A + 1 || Math.abs(dz) > sp.A + 1) continue;
      const [lx, lz] = rotXZ(dx, dz, (4 - (sp.rot || 0)) % 4);
      for (const r of sp.rects) if (lx >= r.x0 - 0.5 && lx <= r.x1 + 0.5 && lz >= r.z0 - 0.5 && lz <= r.z1 + 0.5) return { st: sp, k: r === sp.rects[0] ? clamp((lx + 18) / 6, 0, 1) : 1, ceil: sp.F + r.c };
    }
    return null;
  };
  D.blocksSpawn = (x, z) => {
    if (Math.max(Math.abs(x - G.x), Math.abs(z - G.z)) < G.A + 6) return true;
    for (const sp of plan.smalls) if (Math.max(Math.abs(x - sp.x), Math.abs(z - sp.z)) < sp.A + 4) return true;
    return false;
  };
  D.ceilingAt = (x, z) => {
    const r = D.insideOf(x, z);
    if (!r) return Infinity;
    if (r.ceil) return r.ceil;
    return G.F + 12;
  };
  const tmp = new THREE.Vector3();
  D.update = (dt, t, px, py, pz) => {
    // --- lazy build / dispose by distance
    for (const st of D.list) {
      const d = near(st, px, pz), b = D.built.get(st.id);
      const buildR = st.kind === 'great' ? 900 : 330, freeR = st.kind === 'great' ? 1200 : 480;
      if (!b && d < buildR) {
        let rec;
        if (st.kind === 'great') { rec = buildGreatShell(); rec.sections = []; secQueue = []; for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) secQueue.push([i, j]); }
        else if (st.kind === 'small') rec = buildSmall(st);
        else rec = buildCamp(st);
        D.built.set(st.id, rec);
        if (D.onLoad) D.onLoad(st);
      } else if (b && d > freeR) {
        const dispose = (g) => { scene.remove(g); g.traverse((o) => { if (o.userData.own) { o.geometry.dispose(); } }); };
        dispose(b.g); if (b.sections) for (const s of b.sections) dispose(s.g);
        D.built.delete(st.id);
        if (D.onUnload) D.onUnload(st);
      }
    }
    // Great Pyramid sections: one per frame (avoids a hitch)
    const gb = D.built.get('gp');
    if (gb && secQueue.length) { const [i, j] = secQueue.shift(); gb.sections.push(buildGreatSection(i, j)); }
    // --- interior culling: inside -> sections near the player; outside -> only the entrance section
    const inside = D.insideOf(px, pz);
    D.inside = inside;
    if (gb) {
      const inGP = inside && inside.st === G;
      for (const s of gb.sections) {
        const dx = Math.max(Math.abs(px - s.cx) - s.hw, 0), dz = Math.max(Math.abs(pz - s.cz) - s.hd, 0);
        s.g.visible = inGP ? Math.hypot(dx, dz) < 70 : (s.si === 0 && s.sj === 1 && near(G, px, pz) < 400);
      }
      // the shell fades to a dark silhouette with distance (it is visible from very far away)
      const d = near(G, px, pz), k = smoothstep(350, 1100, d);
      M.shell.color.setRGB(lerp(0.82, 0.09, k), lerp(0.72, 0.1, k), lerp(0.56, 0.15, k));
      gb.shell.visible = !inGP;
    }
    // --- flames flicker; torch light pool follows the nearest visible torches
    const cands = [];
    for (const [id, b] of D.built) {
      const all = [...(b.flames || []), ...(b.sections ? b.sections.filter((s) => s.g.visible).flatMap((s) => s.flames) : [])];
      for (const f of all) {
        const u = f.userData, k = 0.85 + Math.sin(t * 13 + u.ph) * 0.1 + Math.random() * 0.08;
        if (u.bonfire) { f.scale.set(u.base * k * 1.2, u.base * k * 1.8, 1); f.position.y = 0.6 + u.base * 0.5 * k; }
        else f.scale.set(0.7 * k, 1.0 * k, 1);
        if (!u.bonfire) { f.getWorldPosition(tmp); const dd = Math.hypot(tmp.x - px, tmp.z - pz); if (dd < 45) cands.push([dd, tmp.x, tmp.y, tmp.z]); }
      }
      void id;
    }
    if (D.extraFlames) for (const f of D.extraFlames()) {
      const k = 0.8 + Math.sin(t * 9 + f.userData.ph) * 0.12 + Math.random() * 0.08;
      f.scale.set(1.5 * k, 1.5 * k, 1);
      const dd = Math.hypot(f.position.x - px, f.position.z - pz);
      if (dd < 40) cands.push([dd, f.position.x, f.position.y, f.position.z]);
    }
    cands.sort((a, b) => a[0] - b[0]);
    torchLights.forEach((l, i) => {
      const c = cands[i];
      if (c) { l.position.set(c[1], c[2], c[3]); l.intensity = 14 * (0.85 + Math.random() * 0.15); } else l.intensity = 0;
    });
    // bonfire light: nearest camp
    let best = null, bd = 160;
    for (const cp of plan.camps) { const d = near(cp, px, pz); if (d < bd) { bd = d; best = cp; } cp.glow.visible = d > 18 && d < 2200; }
    if (best) { fireLight.position.set(best.x, best.F + 1.6, best.z); fireLight.intensity = 70 * (0.85 + Math.sin(t * 15) * 0.08 + Math.random() * 0.1); } else fireLight.intensity = 0;
    // dust floating in moonlight shafts
    if (gb) for (const s of gb.sections) if (s.g.visible) s.g.children.forEach((o) => {
      if (!o.userData.dust) return;
      const a = o.geometry.attributes.position, base = o.userData.base, sh = o.userData.s;
      for (let i = 0; i < a.count; i++) { let y = a.array[i * 3 + 1] + dt * 0.15; if (y > sh.h) y = 0; a.array[i * 3 + 1] = y; a.array[i * 3] = base[i * 3] + Math.sin(t * 0.3 + i) * 0.4; }
      a.needsUpdate = true;
    });
  };
  // structure-relative helpers for main (loot / nests in world coordinates)
  D.worldPos = (st, lx, lz) => { const [dx, dz] = rotXZ(lx, lz, st.rot || 0); return [st.x + dx, st.z + dz]; };
  return D;
}
