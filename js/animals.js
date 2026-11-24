import * as THREE from '../lib/three.module.min.js';
import { hash2, clamp, rayCapsuleT } from './util.js';
import { buildCamel } from './npcs.js';

export const SPECIES = {
  horse: { hp: 120, walk: 8, run: 18, radius: 0.83, eye: 2.25, jump: true },
  camel: { hp: 80, walk: 7, run: 14, radius: 0.98, eye: 2.85, jump: false },
};
const INTERACT_RANGE = 3.4;
const FOLLOW_DISTANCE = 2.7;
export const MAX_TRUST = 100;
export const FEED_TRUST = 25;
export function stats(a) {
  const n = Math.min(a.flesh, 9);
  return { max: SPECIES[a.species].hp * (1 + 0.1 * n), speed: 1 + 0.05 * n, defence: 1 - 0.05 * n };
}

const shape = new THREE.SphereGeometry(1, 9, 6);
const dark = new THREE.MeshLambertMaterial({ color: 0x231913 });
const eye = new THREE.MeshBasicMaterial({ color: 0xb4ee83 });
const infection = new THREE.Color(0x334132);
const colors = [0x5b3b28, 0x392921, 0x9a6743, 0x94887e];
const start = new THREE.Vector3(), end = new THREE.Vector3();
function part(parent, mat, x, y, z, sx, sy, sz) {
  const mesh = new THREE.Mesh(shape, mat);
  mesh.position.set(x, y, z); mesh.scale.set(sx, sy, sz); parent.add(mesh);
  return mesh;
}
function horse(color) {
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body); body.position.y = 1.24;
  const coat = new THREE.MeshLambertMaterial({ color, flatShading: true });
  part(body, coat, 0, 0, 0, 0.39, 0.46, 1.03).castShadow = true;
  const neck = new THREE.Group(); neck.position.set(0, 0.2, 0.63); body.add(neck);
  part(neck, coat, 0, 0.31, 0.12, 0.23, 0.65, 0.32).rotation.x = 0.43;
  part(neck, dark, 0, 0.34, -0.14, 0.12, 0.58, 0.16).rotation.x = 0.43;
  const head = new THREE.Group(); head.position.set(0, 0.79, 0.23); neck.add(head);
  part(head, coat, 0, -0.1, 0.22, 0.19, 0.22, 0.42).rotation.x = 0.43;
  part(head, dark, 0, -0.19, 0.51, 0.16, 0.12, 0.13);
  for (const side of [-1, 1]) {
    part(head, coat, side * 0.12, 0.18, -0.04, 0.055, 0.17, 0.05);
    part(head, dark, side * 0.17, -0.02, 0.24, 0.04, 0.038, 0.045);
  }
  const tail = part(body, dark, 0, -0.32, -1.06, 0.12, 0.51, 0.13);
  tail.rotation.x = 0.36;
  const legs = [[-0.24, 0.63], [0.24, 0.63], [-0.25, -0.65], [0.25, -0.65]].map(([x, z]) => {
    const hp = new THREE.Group(), kn = new THREE.Group();
    hp.position.set(x, -0.15, z); body.add(hp);
    part(hp, coat, 0, -0.22, 0, 0.12, 0.31, 0.14);
    kn.position.y = -0.48; hp.add(kn);
    part(kn, coat, 0, -0.23, 0, 0.074, 0.28, 0.085);
    part(kn, dark, 0, -0.48, 0.03, 0.09, 0.11, 0.11);
    return { hp, kn };
  });
  return { root, body, neck, head, tail, legs, coat };
}
export class Animals {
  constructor(scene, world, audio, npcs, plan, camp) {
    Object.assign(this, { scene, world, audio, npcs });
    this.records = new Map();
    this.homes = [];
    this.steer = { x: 0, z: 0 };
    for (let i = 0; i < 19; i++) {
      const angle = i * 2.39996, r = i < 6 ? 110 + i * 23 : 390 + (i - 6) * 87;
      const x = camp.x + Math.cos(angle) * r, z = camp.z + Math.sin(angle) * r;
      if (world.desertWeight(x, z) < 0.2) this.homes.push({ id: 'horse-' + i, species: 'horse', x, z });
    }
    for (const p of plan.camps) for (const i of [0, 1]) {
      this.homes.push({ id: p.id + ':m' + i, camp: p.id, species: 'camel', x: p.x + (i ? 16 : -16), z: p.z + 8 });
    }
  }
  get companion() { return this.records.get(this.activeId); }
  befriend(a) {
    if (this.records.get(a.id) !== a || a.dead || a.trust < MAX_TRUST || this.mount) return false;
    const previous = this.companion;
    if (previous && previous !== a) {
      previous.follow = false;
      previous.homeX = previous.x; previous.homeZ = previous.z;
      previous.timer = 0;
    }
    this.activeId = a.id;
    a.follow = true;
    return true;
  }
  reset() {
    for (const a of this.records.values()) this.detach(a);
    this.records.clear(); this.activeId = null; this.mount = null; this.fell = false;
  }
  snapshot() { return { activeId: this.activeId, records: [...this.records.values()].map(({ model, ...a }) => a) }; }
  restore(data) {
    this.reset();
    for (const a of data.records) this.records.set(a.id, { ...a, speed: 0 });
    if (this.records.get(data.activeId)?.dead === false) this.activeId = data.activeId;
  }
  spawn(home) {
    const { x, z, species, id } = home;
    const a = { ...home, homeX: x, homeZ: z, y: this.world.hgt(x, z), hp: SPECIES[species].hp,
      name: species === 'horse' ? 'Horse' : 'Camel', trust: 0, flesh: 0, color: colors[Math.floor(hash2(x, z, 31) * colors.length)],
      yaw: hash2(x, z, 7) * 6.28, follow: false, dead: false, deadT: 0, ph: 0, speed: 0, sit: 0 };
    this.world.resolve(a, SPECIES[species].radius);
    a.y = this.world.hgt(a.x, a.z);
    this.records.set(id, a);
  }
  attach(a) {
    const p = a.species === 'horse' ? horse(a.color) : buildCamel();
    p.eyes = [-1, 1].map((side) => part(p.head, eye, side * 0.17, 0.02, 0.24, 0.045, 0.045, 0.045));
    p.patches = Array.from({ length: 9 }, (_, i) => part(p.body, dark, (i % 2 ? -1 : 1) * (a.species === 'camel' ? 0.5 : 0.35), 0.1 + (i % 3) * 0.07, Math.floor(i / 2) * 0.31 - 0.6, 0.04, 0.034, 0.18));
    p.root.position.set(a.x, a.y, a.z);
    this.scene.add(p.root); a.model = p;
  }
  detach(a) {
    if (!a.model) return;
    this.scene.remove(a.model.root); a.model.coat?.dispose(); delete a.model;
  }
  near(player) {
    return [...this.records.values()].filter((a) => !a.dead && a.model && Math.abs(player.pos.y - a.y) < 2.5)
      .map((a) => [a, Math.hypot(player.pos.x - a.x, player.pos.z - a.z)])
      .filter((row) => row[1] < INTERACT_RANGE).sort((a, b) => a[1] - b[1])[0]?.[0];
  }
  noise(x, z, range) {
    for (const a of this.records.values()) if (a.model && !a.dead && Math.hypot(a.x - x, a.z - z) < range) {
      a.flee = 3; a.fromX = x; a.fromZ = z;
    }
  }
  kill(a) {
    a.hp = 0; a.dead = true; a.deadT = 0; a.follow = false;
    if (this.activeId === a.id) this.activeId = null;
    if (this.mount === a) { this.mount = null; this.fell = true; }
    this.audio.growl({ x: a.x, y: a.y + 1, z: a.z }, { pitch: 0.48, gain: 0.6, dur: 1.5 });
  }
  damage(a, amount, shot = false) {
    if (!a || a.dead) return { killed: false };
    if (shot && a.camp) this.npcs.hostile.add(a.camp);
    a.hp = Math.max(0, a.hp - amount / stats(a).defence);
    a.hurt = 0.7;
    if (!a.hp) this.kill(a);
    return { killed: a.dead, kind: a.species };
  }
  rayHit(o, d, maxT) {
    let best;
    for (const a of this.records.values()) if (!a.dead && a.model?.root.visible) {
      const body = a.model.body;
      const t = rayCapsuleT(o, d, body.localToWorld(start.set(0, 0, -0.8)), body.localToWorld(end.set(0, 0, 0.8)), 0.52);
      if (t >= 0 && t < maxT) { maxT = t; best = { t, zone: 'body', apply: (n) => this.damage(a, n, true) }; }
    }
    return best;
  }
  ride(a, player) {
    const s = SPECIES[a.species];
    const clear = { x: a.x, z: a.z };
    this.world.resolve(clear, s.radius, a.y);
    if (a !== this.companion || a.dead || this.world.isWater(a.x, a.z) ||
        Math.hypot(clear.x - a.x, clear.z - a.z) > 0.24 ||
        this.world.ceilingAt(a.x, a.z) < a.y + s.eye + 0.35) return false;
    this.mount = a; player.sitting = false; player.pos.set(a.x, a.y, a.z);
    player.vx = player.vy = player.vz = 0;
    return true;
  }
  dismount(player) {
    const a = this.mount;
    this.mount = null;
    player.pos.x += Math.cos(a.yaw) * 1.65; player.pos.z -= Math.sin(a.yaw) * 1.65;
    this.world.resolve(player.pos, 0.4);
    player.pos.y = this.world.hgt(player.pos.x, player.pos.z);
    player.vx = player.vy = player.vz = 0;
  }
  update(dt, time, player, enemies) {
    const pos = player.pos;
    for (const home of this.homes) if (!this.records.has(home.id) && Math.hypot(pos.x - home.x, pos.z - home.z) < 100) this.spawn(home);
    for (const a of this.records.values()) {
      const d = Math.hypot(pos.x - a.x, pos.z - a.z), s = SPECIES[a.species];
      if ((a !== this.companion && d > 128) || a.deadT > 14) { this.detach(a); continue; }
      if (!a.model) this.attach(a);
      a.model.root.visible = d < this.world.viewDist + 12;
      if (a.dead) {
        a.deadT += dt;
        a.model.root.rotation.z = Math.min(1, a.deadT * 2) * 1.45 + (a.flesh === 10 ? Math.sin(a.deadT * 45) * Math.max(0, 1 - a.deadT) * 0.18 : 0);
        continue;
      }
      a.hurt = Math.max(0, (a.hurt || 0) - dt);
      a.fed = Math.max(0, (a.fed || 0) - dt);
      if (a === this.mount) {
        a.x = pos.x; a.z = pos.z; a.y = pos.y; a.speed = player.hspeed;
        if (a.speed > 0.5) a.yaw = Math.atan2(player.vx, player.vz);
      } else {
        const threat = a === this.companion ? null : enemies.find((e) => !e.dead && (e.state === 'chase' || e.state === 'attack') && Math.hypot(a.x - e.x, a.z - e.z) < 8);
        if (threat) { a.flee = 2; a.fromX = threat.x; a.fromZ = threat.z; }
        a.flee = Math.max(0, (a.flee || 0) - dt);
        let dx = 0, dz = 0, speed = 0;
        if (a === this.companion) {
          if (a.follow && d > FOLLOW_DISTANCE) {
            dx = pos.x - a.x; dz = pos.z - a.z;
            speed = d > 14 ? s.run : Math.min(s.walk, (d - FOLLOW_DISTANCE) * 3.5);
          }
        } else if (a.flee && a.trust < 100) {
          dx = a.x - a.fromX; dz = a.z - a.fromZ; speed = s.run * (1 - a.trust / 300);
        } else if (!a.fed) {
          a.timer = (a.timer || 0) - dt;
          if (a.timer <= 0) {
            a.timer = 4 + Math.random() * 8;
            a.behavior = ['graze', 'rest', 'wander'][Math.floor(Math.random() * 3)];
            a.tx = a.homeX + (Math.random() - 0.5) * 27; a.tz = a.homeZ + (Math.random() - 0.5) * 27;
          }
          if (a.behavior === 'wander' && d > 3) { dx = a.tx - a.x; dz = a.tz - a.z; speed = s.walk * 0.35; }
        }
        const len = Math.hypot(dx, dz);
        a.speed = speed && len > 0.75 ? speed * stats(a).speed : 0;
        if (a.speed) {
          dx /= len; dz /= len;
          this.world.steer(a.x, a.z, dx, dz, a.side ?? 1, this.steer);
          dx += this.steer.x * 1.65; dz += this.steer.z * 1.65;
          const norm = Math.hypot(dx, dz) || 1, oldX = a.x, oldZ = a.z;
          a.x += dx / norm * a.speed * dt; a.z += dz / norm * a.speed * dt;
          this.world.resolve(a, s.radius);
          a.blocked = Math.hypot(a.x - oldX, a.z - oldZ) < a.speed * dt * 0.2 ? (a.blocked || 0) + dt : 0;
          if (a.blocked > 0.5) { a.side = -(a.side ?? 1); a.blocked = 0; }
          a.yaw = Math.atan2(dx, dz);
        }
        a.y = this.world.hgt(a.x, a.z);
      }
      this.pose(a, dt, time, pos, d);
    }
  }
  pose(a, dt, time, player, distance) {
    const p = a.model;
    p.root.position.set(a.x, a.y, a.z); p.root.rotation.y = a.yaw;
    if (!p.root.visible) return;
    a.ph += dt * (2 + a.speed * 1.35);
    const rest = a.speed < 0.4 && a.behavior === 'rest' && !a.fed && a !== this.mount;
    const graze = a.speed < 0.4 && (a.fed || a.behavior === 'graze') && a !== this.mount;
    a.sit += ((rest ? 1 : 0) - a.sit) * Math.min(1, dt * 4);
    if (a.species === 'camel') {
      this.npcs.camelPose({ ...a, P: p }, time, a.speed);
      if (graze) p.neck.rotation.x += 0.65;
      if (distance < 42 && time >= (a.nextCall ?? 0)) {
        a.nextCall = time + 12 + Math.random() * 21;
        this.audio.camel({ x: a.x, y: a.y + 1.65, z: a.z });
      }
    } else {
      const gait = Math.min(a.speed / 4, 1);
      p.body.position.y = 1.24 - a.sit * 0.75 + Math.sin(a.ph * 2) * (0.012 + gait * 0.045);
      p.neck.rotation.x += ((graze ? 1.15 : 0) - p.neck.rotation.x) * Math.min(1, dt * 4);
      p.legs.forEach((leg, i) => {
        const swing = Math.sin(a.ph + (i === 0 || i === 3 ? Math.PI : 0)) * gait;
        leg.hp.rotation.x = swing * (0.58 + a.hurt * 0.22) + a.sit * (i < 2 ? -1.3 : 1.3);
        leg.kn.rotation.x = Math.max(0, -swing) * 0.7 + a.sit * (i < 2 ? 2.3 : -2.3);
      });
      p.tail.rotation.z = Math.sin(a.ph * 0.7) * 0.22;
      p.coat.color.setHex(a.color).lerp(infection, a.flesh * 0.075);
    }
    const look = Math.atan2(player.x - a.x, player.z - a.z) - a.yaw;
    p.head.rotation.y = distance < 9 && a.speed < 0.4 ? clamp(Math.atan2(Math.sin(look), Math.cos(look)), -0.7, 0.7) : 0;
    p.head.rotation.y += Math.sin(time * (a.flesh > 6 ? 8 : 2)) * (0.05 + a.flesh * 0.018);
    p.eyes.forEach((m) => { m.visible = a.flesh >= 4; });
    p.patches.forEach((m, i) => { m.visible = i < a.flesh; });
    if (distance < 19 && a.flesh >= 3 && Math.random() < dt * a.flesh * 0.05) this.audio.growl({ x: a.x, y: a.y + 1, z: a.z }, { pitch: 0.6 + a.flesh * 0.09, gain: 0.22, dur: 0.7 });
  }
}
