import * as THREE from '../lib/three.module.min.js';
import { CH, HALF, NCH, VILLAGES, CAMP } from './world.js';
import { bakeGroup, hash2, lerp, clamp } from './util.js';
import { BAKED_MAT, makeCorpse } from './zombies.js';

export const RAIL = { minX: -202, maxX: 182, interval: 1.2, horde: 18, wakeRadius: 22 };
const boxGeo = new THREE.BoxGeometry();
const colors = { rust: 0x543023, wood: 0x30231b, gravel: 0x48473d, green: 0x343d32,
  red: 0x57312d, roof: 0x282e2c, inside: 0x393027, seat: 0x503331, moss: 0x3c4d28, blood: 0x351512,
  glass: 0x374951, cloth: 0x44342e, bone: 0x8e8162 };
const materials = Object.fromEntries(Object.entries(colors).map(([name, color]) => [name,
  new THREE.MeshLambertMaterial({ color, flatShading: true })]));
materials.glass.transparent = true; materials.glass.opacity = 0.33; materials.glass.depthWrite = false;
const doors = [-6, 6];
const chute = 1.42;
const escapeWindow = -0.13;
const intactRoof = [[0, 18]];
const brokenRoof = [[-5.1, 7.8], [4.2, 9.6]];
const key = (x, z) => Math.floor((x + HALF) / CH) + Math.floor((z + HALF) / CH) * NCH;
const dummy = new THREE.Object3D();
const tint = new THREE.Color();

function batch(group, name, pieces) {
  if (!pieces.length) return;
  const mesh = new THREE.InstancedMesh(boxGeo, materials[name], pieces.length);
  pieces.forEach(([x, y, z, dx, dy, dz, yaw = 0, tilt = 0], i) => {
    dummy.position.set(x, y, z); dummy.scale.set(dx, dy, dz);
    dummy.rotation.set(0, yaw, tilt); dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    tint.setScalar(0.67 + hash2(x, z, i) * 0.43); mesh.setColorAt(i, tint);
  });
  mesh.receiveShadow = true;
  group.add(mesh);
}
function box(group, name, x, y, z, dx, dy, dz, yaw = 0) {
  const m = new THREE.Mesh(boxGeo, materials[name]);
  m.position.set(x, y, z); m.scale.set(dx, dy, dz); m.rotation.y = yaw;
  group.add(m); return m;
}

export class Railway {
  constructor(world, scene, zombies, audio, taken, addSupply, stones) {
    Object.assign(this, { world, scene, zombies, audio, taken, addSupply });
    this.terrain = world.hgt;
    this.chunks = new Map(); this.meshes = new Map(); this.active = new Map();
    this.trackBodies = new Map();
    this.dormantGeos = [];
    this.coaches = [];
    const sites = [CAMP, ...VILLAGES, ...stones];
    const line = (x, offset) => offset + 10 * Math.sin(x * 0.022) + 6 * Math.sin(x * 0.039 + 1);
    const cost = (offset) => {
      let score = 0;
      for (let x = RAIL.minX; x <= RAIL.maxX; x += 3) {
        const z = line(x, offset);
        for (const p of sites) score += Math.max(0, (VILLAGES.includes(p) ? 31 : 10) - Math.hypot(x - p.x, z - p.z)) ** 2;
      }
      return score;
    };
    const choices = Array.from({ length: 25 }, (_, i) => (i % 2 ? -1 : 1) * (89 + Math.floor(i / 2) * 6));
    const offset = choices.map((z) => [cost(z), z]).sort((a, b) => a[0] - b[0])[0][1];
    const centerline = (x) => line(x, offset);
    this.line = centerline;
    this.placeCoaches(sites);
    this.line = (x) => {
      const z = centerline(x);
      for (const c of this.coaches) if (c.kind !== 3 && Math.abs(x - c.x) < 15) {
        return lerp(c.z, z, clamp((Math.abs(x - c.x) - 9) / 6, 0, 1));
      }
      return z;
    };
    this.route(sites);
    world.railway = this;
    const ceiling = world.ceilingAt;
    const isWater = world.isWater;
    world.hgt = (x, z) => this.floorAt(x, z, this.terrain(x, z));
    world.isWater = (x, z) => isWater(x, z) && world.hgt(x, z) < 0;
    world.ceilingAt = (x, z) => this.shelter(x, z)?.roof ?? ceiling(x, z);
  }
  section(x) { return x >= RAIL.minX && x <= RAIL.maxX; }
  near(x, z, limit) { return this.coaches.find((c) => Math.hypot(c.x - x, c.z - z) < limit); }
  exit(e, x, z) { return railExit(e, x, z); }
  treeClear(x, z) {
    if (this.coaches.some((c) => Math.abs(x - c.x) < 11.5 && Math.abs(z - c.z) < 4.5)) return true;
    return this.section(x) && Math.abs(z - this.line(x)) < 2.55;
  }
  inside(x, z) {
    return this.coaches.find((c) => Math.abs(x - c.x) < 8.85 && Math.abs(z - c.z) < chute);
  }
  shelter(x, z) {
    const c = this.inside(x, z);
    return c && this.roofPieces(c).some(([mid, width]) => Math.abs(x - c.x - mid) < width / 2) ? c : null;
  }
  roofPieces(c) { return c.infested ? intactRoof : brokenRoof; }
  floorAt(x, z, ground) {
    for (const c of this.coaches) {
      const dx = x - c.x, dz = Math.abs(z - c.z);
      if (Math.abs(dx) < 9 && dz <= chute) return Math.max(ground, c.y);
      if (dz <= 3.4 && doors.some((d) => Math.abs(dx - d) < 0.97)) {
        return Math.max(ground, lerp(c.y, ground, clamp((dz - chute) / (3.4 - chute), 0, 1)));
      }
    }
    if (this.section(x) && ground < -0.05 && Math.abs(z - this.line(x)) < 1.4) return 0.14;
    return ground;
  }
  route(sites) {
    const height = (x) => Math.max(0.14, this.terrain(x, this.line(x)) + 0.028);
    for (let i = 0, x = RAIL.minX; x + RAIL.interval <= RAIL.maxX; i++, x += RAIL.interval) {
      const nx = x + RAIL.interval, z = this.line(x), nz = this.line(nx);
      if (sites.some((p) => Math.hypot(x - p.x, z - p.z) < (VILLAGES.includes(p) ? 23 : 5))) continue;
      const y = height(x), ny = height(nx), midX = (x + nx) / 2, midZ = (z + nz) / 2;
      const id = key(midX, midZ);
      if (!this.chunks.has(id)) this.chunks.set(id, { wood: [], rust: [], gravel: [], green: [], moss: [], blood: [], cloth: [] });
      const data = this.chunks.get(id);
      const yaw = Math.atan2(z - nz, nx - x), tilt = Math.atan2(ny - y, Math.hypot(nx - x, nz - z));
      const length = Math.hypot(nx - x, nz - z, ny - y);
      const broken = hash2(i, 17) < 0.055 || (i > 260 && hash2(i, 27) < 0.37);
      const bridge = this.terrain(x, z) < 0;
      if (!bridge) data.gravel.push([midX, (y + ny) / 2 - 0.075, midZ, length + 0.035, 0.14, 2.02, yaw, tilt]);
      if (bridge || hash2(i, 9) > 0.13) data.wood.push([x, y + 0.031, z, bridge ? 1.25 : 0.24, 0.105, bridge ? 2.8 : 2.05, yaw]);
      if (!broken) for (const side of [-1, 1]) {
        data.rust.push([midX + Math.sin(yaw) * side * 0.69, (y + ny) / 2 + 0.123, midZ + Math.cos(yaw) * side * 0.69,
          length + 0.034, 0.12, 0.082, yaw, tilt]);
      }
      if (bridge && i % 5 === 0) for (const side of [-1, 1]) {
        data.wood.push([x, -0.9, z + side * 0.96, 0.23, 2.2, 0.24, yaw]);
      }
      if (bridge) this.world.addRailCollider(x, nx, Math.min(z, nz) - 1.1, Math.max(z, nz) + 1.1,
        0.06, 0.14, 'wood', true);
      if (!bridge && i % 27 === 4) {
        data.wood.push([x, y + 0.22, z + 0.28, 0.48, 0.48, 4.8, yaw + 0.46]);
        data.wood.push([x + 0.24, y + 0.42, z - 0.67, 0.12, 0.15, 1.8, yaw - 0.3, 0.3]);
      }
      if (!bridge && i % 31 === 5) {
        data.wood.push([x, y + 1.06, z + 2.8, 0.09, 2.14, 0.09]);
        data.green.push([x, y + 1.88, z + 2.8, 0.07, 0.45, 0.8]);
        data.rust.push([x, y + 1.21, z + 2.73, 0.16, 0.22, 0.16]);
        data.cloth.push([x - 0.85, this.terrain(x - 0.85, z + 2.8) + 0.15, z + 2.8, 0.35, 0.28, 0.32, 0.65]);
        if (i % 62 === 5) {
          const bodies = this.trackBodies.get(id) ?? [];
          bodies.push({ x: x - 0.43, z: z + 2.65, yaw });
          this.trackBodies.set(id, bodies);
        }
      }
      if (!bridge && i % 37 === 7) {
        for (let k = 0; k < 5; k++) {
          const dx = x + k * 0.14, dz = z + 1.9 + k * 0.44;
          data.blood.push([dx, this.terrain(dx, dz) + 0.025, dz, 0.24 - k * 0.024, 0.022, 0.51, -0.25]);
        }
        data.wood.push([x + 0.7, y + 0.43, z + 2.2, 0.13, 0.92, 0.13]);
        data.wood.push([x + 2.3, y + 0.43, z + 2.2, 0.13, 0.92, 0.13]);
        data.wood.push([x + 1.5, y + 0.62, z + 2.2, 1.76, 0.18, 0.09, 0, 0.2]);
      }
      if (!bridge && hash2(i, 13) < 0.28) data.moss.push([x, y + 0.07, z + (hash2(i, 8) - 0.5) * 2.4, 0.62, 0.11, 0.53, yaw]);
    }
  }
  placeCoaches(sites) {
    for (const [i, desired] of [-153, -63, 43, 132].entries()) {
      let best;
      for (let dx = -22; dx <= 22; dx += 1) {
        const x = desired + dx, z = this.line(x) + (i === 3 ? 3.8 : 0);
        if (sites.some((p) => Math.hypot(x - p.x, z - p.z) < (VILLAGES.includes(p) ? 40 : 21))) continue;
        const heights = [-9, -4.5, 0, 4.5, 9].flatMap((u) =>
          [-2, 0, 2].map((v) => this.terrain(x + u, z + v)));
        const max = Math.max(...heights), min = Math.min(...heights);
        if (min < 0.18) continue;
        const score = (max - min) * 5 + Math.abs(dx) * 0.09;
        if (!best || score < best.score) best = { x, z, y: max + 0.24, score };
      }
      if (!best) continue;
      const c = { ...best, id: 'rail-coach-' + i, kind: i, roof: best.y + 2.63, infested: false };
      this.coaches.push(c);
    }
    const infested = this.coaches[Math.floor(this.coaches.length / 2)];
    if (infested) infested.infested = true;
    this.coaches.forEach((c) => this.colliders(c));
  }
  colliders(c) {
    const add = (x0, x1, z0, z1, y0, y1, walkable = false) =>
      this.world.addRailCollider(c.x + x0, c.x + x1, c.z + z0, c.z + z1, c.y + y0, c.y + y1, 'rock', walkable);
    add(-9, 9, -chute, chute, -0.13, 0, true);
    for (const [mid, width] of this.roofPieces(c)) add(mid - width / 2, mid + width / 2, -chute, chute, 2.63, 2.8, true);
    for (const side of [-1, 1]) {
      add(side * 8.92 - 0.08, side * 8.92 + 0.08, -chute, chute, 0, 2.63);
      const edge = side * chute;
      for (const [a, b] of [[-9, -6.9], [-5.1, 5.1], [6.9, 9]]) {
        add(a, b, edge - 0.08, edge + 0.08, 0, 1.1);
        add(a, b, edge - 0.08, edge + 0.08, 2.1, 2.63);
        for (let x = a + 0.22; x < b; x += 1.38) add(x - 0.07, x + 0.07, edge - 0.08, edge + 0.08, 1.1, 2.1);
      }
    }
  }
  loadChunk(ci) {
    const data = this.chunks.get(ci);
    if (!data || this.meshes.has(ci)) return;
    const group = new THREE.Group();
    for (const [material, meshes] of Object.entries(data)) batch(group, material, meshes);
    for (const p of this.trackBodies.get(ci) ?? []) {
      const body = makeCorpse();
      body.position.set(p.x, this.terrain(p.x, p.z) + 0.08, p.z);
      body.rotation.set(-0.32, p.yaw, 0.53, 'YXZ');
      group.add(body);
    }
    this.scene.add(group); this.meshes.set(ci, group);
  }
  unloadChunk(ci) {
    const model = this.meshes.get(ci);
    if (!model) return;
    this.scene.remove(model);
    for (const m of model.children) {
      if (m.isInstancedMesh) m.dispose();
      else if (m.userData.own) m.geometry.dispose();
    }
    this.meshes.delete(ci);
  }
  build(c) {
    const root = new THREE.Group(); root.position.set(c.x, c.y, c.z);
    const shell = c.kind % 2 ? 'green' : 'red';
    box(root, 'inside', 0, -0.06, 0, 18, 0.17, 2.91);
    for (const [x, width] of this.roofPieces(c)) box(root, 'roof', x, 2.69, 0, width, 0.19, 2.96).castShadow = true;
    const doorsToOpen = [], windowsToBreak = [];
    for (const side of [-1, 1]) {
      box(root, shell, side * 8.94, 1.31, 0, 0.14, 2.63, 2.9);
      for (const [a, b] of [[-9, -6.9], [-5.1, 5.1], [6.9, 9]]) {
        box(root, shell, (a + b) / 2, 0.54, side * chute, b - a, 1.1, 0.15);
        box(root, shell, (a + b) / 2, 2.37, side * chute, b - a, 0.54, 0.15);
        for (let x = a + 0.22; x < b; x += 1.38) {
          box(root, 'rust', x, 1.59, side * chute, 0.14, 1.18, 0.14);
          if ((c.infested || hash2(x, side, c.kind) < 0.25) && x + 1.1 < b) {
            const pane = box(root, 'glass', x + 0.61, 1.59, side * chute, 1.1, 1.1, 0.036);
            if (Math.abs(pane.position.x - escapeWindow) < 0.06) windowsToBreak.push(pane);
          }
        }
      }
      for (const x of doors) {
        box(root, 'rust', x, 2.52, side * chute, 1.82, 0.19, 0.17);
        if (c.infested) doorsToOpen.push(box(root, shell, x + 0.57, 1.1, side * 1.52, 0.48, 2.2, 0.12));
        const ground = this.terrain(c.x + x, c.z + side * 3.4) - c.y;
        for (let i = 0; i < 4; i++) {
          box(root, 'wood', x, lerp(-0.15, ground - 0.04, (i + 0.5) / 4), side * (1.67 + 0.49 * i), 1.85, 0.11, 0.51);
        }
      }
    }
    const decor = { seat: [], rust: [], moss: [], cloth: [], blood: [], glass: [], wood: [], bone: [] };
    const contents = c.infested ? [] : [-7.4, -3.4, 2.5, 7.5];
    for (const x of contents) {
      const body = makeCorpse();
      body.position.set(x, 0.08, hash2(x, c.x) * 1.1 - 0.55);
      body.rotation.y = hash2(x, c.z) * 6.28;
      body.userData.railOwned = true; root.add(body);
    }
    for (const side of [-1, 1]) for (let i = 0; i < 10; i++) {
      const x = -8.2 + i * 1.81;
      decor.rust.push([x, -0.39, side * 0.76, 0.61, 0.55, 0.27, 0, c.kind % 2 ? 0.18 : 0]);
      decor.moss.push([x, -0.09, side * 1.53, 0.62, 0.18, 0.25]);
      if ((i + c.kind) % 3 === 0) {
        decor.moss.push([x, 0.37, side * 1.51, 0.49, 0.15, 0.04, 0, 0.2]);
        decor.moss.push([x + 0.28, 0.06, side * 1.05, 0.33, 0.14, 0.3, 0.43]);
      }
      if (doors.some((d) => Math.abs(x - d) < 1.13)) continue;
      decor.seat.push([x, 0.37, side * 1.01, 0.58, 0.13, 0.65]);
      decor.seat.push([x - 0.29, 0.66, side * 1.01, 0.11, 0.59, 0.65, 0, -0.19]);
      if (i % 2 === 0) {
        decor.rust.push([x, 2.06, side * 1.18, 1.24, 0.047, 0.34, 0, i % 4 ? 0.3 : 0]);
        decor.cloth.push([x + 0.22, 1.89, side * 1.37, 0.28, 0.58, 0.043, 0.25]);
        decor.glass.push([x + 0.12, 0.02, side * 0.8, 0.19, 0.016, 0.12, i * 0.7]);
        decor.blood.push([x + 0.5, 0.015, side * 0.62, 0.7, 0.014, 0.24, i]);
      }
      if (i % 3 === 0) decor.wood.push([x + 0.36, 0.12, side * 1.06, 0.32, 0.24, 0.32, 0.45]);
    }
    const boneY = this.terrain(c.x - 2.7, c.z - 0.9) - c.y;
    decor.bone.push([-2.7, boneY + 0.145, -0.9, 0.205, 0.24, 0.19, 0.42]);
    decor.bone.push([-3.28, boneY + 0.09, -0.95, 0.76, 0.08, 0.09, 0.12]);
    for (let i = 0; i < 5; i++) decor.bone.push([-2.96 - i * 0.12, boneY + 0.095, -0.96, 0.04, 0.07, 0.34 - i * 0.025, 0.2]);
    for (const side of [-1, 1]) {
      decor.bone.push([-4.08, boneY + 0.068, -0.95 + side * 0.19, 0.58, 0.065, 0.071, side * 0.19]);
      decor.bone.push([-3.27, boneY + 0.067, -0.95 + side * 0.52, 0.47, 0.07, 0.06, side * 0.25]);
    }
    if (c.kind === 3) {
      decor.rust.push([-8.05, 2.85, 0.95, 2.29, 0.16, 1.08, 0.15, 0.58]);
      decor.rust.push([8.32, 0.57, 1.64, 1.26, 0.16, 0.89, 0.35, -0.43]);
    }
    for (const [name, values] of Object.entries(decor)) batch(root, name, values);
    const passenger = makeCorpse();
    passenger.position.set(c.x + 6, this.terrain(c.x + 6, c.z + 4), c.z + 4);
    passenger.rotation.y = 0.85; passenger.userData.railOwned = true;
    const container = new THREE.Group(); container.add(root, passenger);
    container.userData.doorsToOpen = doorsToOpen;
    container.userData.windowsToBreak = windowsToBreak;
    this.scene.add(container);
    return container;
  }
  load(c) {
    const model = this.build(c), rec = { model, enemies: [], nextSound: 0, woke: false };
    this.active.set(c.id, rec);
    this.addSupply(c, c.infested ? [
      ['ammo', -7.25, 0.92, 3], ['med', -4.1, -0.86, 2], ['battery', -1.2, 0.87, 2],
      ['canned', 1.4, -0.9, 2], ['water', 4.5, 0.9, 2], ['relic', 7.4, -0.87, 1],
    ] : [['ammo', -4.05, 0.78, 1], ['battery', 3.15, -0.95, 1]]);
    const count = c.infested ? RAIL.horde : 2;
    for (let i = 0; i < count; i++) {
      const id = 'rail:enemy:' + c.id + ':' + i;
      if (this.taken.has(id)) continue;
      const x = c.infested ? c.x - 7.4 + (i % 9) * 1.82 : c.x + (i ? 7.5 : -6.5);
      const z = c.infested ? c.z + (i < 9 ? -0.58 : 0.58) : c.z + (i ? 5.3 : -5.8);
      const e = this.zombies.spawnDormant(x, z, 'rail');
      e.railId = id;
      if (c.infested) {
        e.railLocked = true; e.railCoach = c; e.railLane = i < 9 ? -1 : 1;
        e.railWindow = [3, 5, 12, 14].includes(i);
        e.parts.model.rotation.x = 0; e.parts.model.position.set(0, 0, 0);
        e.parts.model.rotation.z = (i % 3 - 1) * 0.06;
        const pose = i % 3;
        if (!this.dormantGeos[pose]) this.dormantGeos[pose] = bakeGroup(e.parts.root);
        e.railDormantMesh = new THREE.Mesh(this.dormantGeos[pose], BAKED_MAT);
        e.parts.model.visible = false; e.parts.root.add(e.railDormantMesh);
      }
      rec.enemies.push(e);
    }
    if (this.taken.has('rail:woke:' + c.id)) this.wake(c, false);
  }
  unload(c) {
    const rec = this.active.get(c.id);
    if (!rec) return;
    this.scene.remove(rec.model);
    this.addSupply(c, null);
    rec.model.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
      if (o.userData.railOwned) o.geometry?.dispose();
    });
    for (const e of rec.enemies) this.zombies.remove(e);
    this.active.delete(c.id);
  }
  reset() { for (const c of this.coaches) this.unload(c); }
  wake(c, sound = true) {
    const rec = this.active.get(c.id);
    if (!rec || rec.woke || !rec.enemies.some((e) => !e.dead)) return;
    rec.woke = true; this.taken.add('rail:woke:' + c.id);
    for (const panel of rec.model.userData.doorsToOpen) panel.position.x += 0.55;
    for (const pane of rec.model.userData.windowsToBreak) pane.visible = false;
    for (const e of rec.enemies) if (!e.dead) {
      if (e.railDormantMesh) e.parts.root.remove(e.railDormantMesh);
      e.parts.model.visible = true;
      e.railLocked = false; e.parts.model.rotation.z = 0;
      e.parts.model.position.set(0, 0, 0); e.state = 'idle'; this.zombies.aggro(e);
    }
    if (sound) this.audio.horror('horde', { x: c.x, y: c.y + 1, z: c.z });
  }
  shot(o) {
    for (const c of this.coaches) if (c.infested && Math.hypot(c.x - o.x, c.z - o.z) < RAIL.wakeRadius) this.wake(c);
  }
  doorNear(p) {
    return this.coaches.find((c) => c.infested && !this.active.get(c.id)?.woke &&
      this.active.get(c.id)?.enemies.some((e) => !e.dead) && Math.abs(Math.abs(p.z - c.z) - chute) < 1.55 &&
      doors.some((d) => Math.abs(c.x + d - p.x) < 1.35));
  }
  update(px, pz, t) {
    for (const c of this.coaches) {
      const d = Math.hypot(c.x - px, c.z - pz);
      if (d < 103 && !this.active.has(c.id)) this.load(c);
      else if (d > 145) this.unload(c);
      const rec = this.active.get(c.id);
      if (!rec || !c.infested || rec.woke || !rec.enemies.some((e) => !e.dead)) continue;
      if (this.inside(px, pz) === c) this.wake(c);
      else if (d < 33 && t >= rec.nextSound) {
        rec.nextSound = t + 5 + Math.random() * 9;
        this.audio.horror(Math.random() < 0.5 ? 'scratch' : 'metal', { x: c.x, y: c.y + 1, z: c.z });
      }
    }
  }

  updateVault(e, dt) {
    const c = e.railCoach, vault = e.railVault;
    vault.progress = Math.min(1, vault.progress + dt * 1.6);
    e.z = lerp(vault.fromZ, c.z + e.railLane * 2.7, vault.progress);
    const base = lerp(c.y, this.terrain(e.x, e.z), vault.progress);
    e.y = base + Math.sin(vault.progress * Math.PI) * 1.12;
    e.parts.root.position.set(e.x, e.y, e.z);
    e.parts.root.rotation.y = e.yaw = e.railLane > 0 ? 0 : Math.PI;
    e.parts.model.rotation.x = -Math.sin(vault.progress * Math.PI) * 0.75;
    if (vault.progress === 1) { e.railVault = null; e.railWindow = false; }
  }
}

export function railExit(e, targetX, targetZ) {
  const c = e.railCoach;
  if (!c || (Math.abs(targetX - c.x) < 9 && Math.abs(targetZ - c.z) < chute) ||
      Math.abs(e.x - c.x) > 9 || Math.abs(e.z - c.z) > 2.4) return null;
  if (e.railWindow && Math.abs(e.z - c.z) < 1.28) {
    const x = c.x + escapeWindow;
    if (Math.abs(e.x - x) < 0.34) e.railVault = { progress: 0, fromZ: e.z };
    return { x, z: c.z + e.railLane * 0.83 };
  }
  const doorX = c.x + (e.x < c.x ? -6 : 6);
  if (Math.abs(e.x - doorX) > 0.35 && Math.abs(e.z - c.z) < 1.27) {
    return { x: doorX, z: c.z + e.railLane * 0.65 };
  }
  return { x: doorX, z: c.z + e.railLane * 3.4 };
}
