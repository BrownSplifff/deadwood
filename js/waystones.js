import * as THREE from '../lib/three.module.min.js';

const column = new THREE.CylinderGeometry(0.43, 0.72, 3.6, 5).translate(0, 1.9, 0);
const base = new THREE.CylinderGeometry(1.34, 1.52, 0.24, 7);
const rune = new THREE.TorusGeometry(0.25, 0.026, 3, 4);
const mote = new THREE.OctahedronGeometry(0.045);
const rock = new THREE.MeshLambertMaterial({ color: 0x555752, flatShading: true });
const dormant = new THREE.MeshBasicMaterial({ color: 0x657360 });
const lit = new THREE.MeshBasicMaterial({ color: 0x9bffd9 });

export function safeBeside(world, x, z, radius, distance = 2.5, height = 2.1) {
  for (let i = 0; i < 24; i++) {
    const angle = i * Math.PI / 6, r = distance + (i >= 12 ? 1.8 : 0);
    const p = { x: x + Math.cos(angle) * r, z: z + Math.sin(angle) * r };
    const px = p.x, pz = p.z;
    world.resolve(p, radius);
    const y = world.hgt(p.x, p.z);
    if (Math.hypot(p.x - px, p.z - pz) < 0.2 && !world.isWater(p.x, p.z) && Math.abs(y - world.hgt(x, z)) < 1.7 &&
        world.ceilingAt(p.x, p.z) > y + height) return { ...p, y };
  }
  return null;
}

export class Waystones {
  constructor(scene, world, audio, camp, plan) {
    Object.assign(this, { scene, world, audio }); this.active = new Set(); this.nodes = [];
    this.add('camp', 'Campfire', camp.x + 7, camp.z - 5);
    ['Old Roots', 'Crow Glade', 'The Hollow', 'North Trail', 'Silent Crossing'].forEach((name, i) => {
      const a = i * 1.2566 + 0.37, r = i < 3 ? 148 + i * 32 : 371 + i * 9;
      this.add('woods-' + i, name, camp.x + Math.cos(a) * r, camp.z + Math.sin(a) * r);
    });
    plan.camps.forEach((p, i) => this.add(p.id, 'Ritual Camp ' + (i + 1), p.x - 26, p.z));
    plan.settlements.slice(0, 4).forEach((p, i) => this.add(p.id, 'Ruined Settlement ' + (i + 1), p.x - 29, p.z + 12));
    this.add('pyramid', 'Great Pyramid Gate', plan.great.x - 174, plan.great.z + 18);
  }
  add(id, name, x, z) {
    const w = this.world;
    for (let i = 0; i < 44; i++) {
      const a = i * 2.39996, r = i ? i * 0.67 + 2 : 0;
      const p = { x: x + Math.cos(a) * r, z: z + Math.sin(a) * r };
      const px = p.x, pz = p.z;
      w.resolve(p, 1.55);
      if (Math.hypot(p.x - px, p.z - pz) > 0.2 || w.isWater(p.x, p.z) || w.inBuilding(p.x, p.z, 2) ||
          !safeBeside(w, p.x, p.z, 1, 3, 3.3)) continue;
      const y = w.hgt(p.x, p.z);
      const biome = w.desertWeight(p.x, p.z) > 0.5 ? 'Ashen Desert' : w.ringWeight(p.x, p.z) > 0.5 ? 'Hanging Woods' : 'The Deadwood';
      this.nodes.push({ id, name, biome, ...p, y });
      w.addWaystoneCollider(p.x, p.z, y);
      return;
    }
  }
  near(player) { return this.nodes.find((p) => Math.hypot(p.x - player.pos.x, p.z - player.pos.z) < 3.2 && Math.abs(p.y - player.pos.y) < 2); }
  activate(p) { this.active.add(p.id); p.pulse = 1.6; this.audio.pickup(); }
  update(dt, time, player) {
    for (const p of this.nodes) {
      const d = Math.hypot(p.x - player.pos.x, p.z - player.pos.z);
      if (d > 130 && p.root) { this.scene.remove(p.root); delete p.root; }
      if (d > 108) continue;
      if (!p.root) {
        p.root = new THREE.Group(); p.root.position.set(p.x, p.y, p.z);
        p.root.add(new THREE.Mesh(base, rock), new THREE.Mesh(column, rock));
        p.runes = Array.from({ length: 6 }, (_, i) => {
          const m = new THREE.Mesh(rune, dormant);
          const a = Math.floor(i / 3) * Math.PI;
          m.rotation.set(0, a, Math.PI / 4);
          m.position.set(0, 1.18 + i % 3 * 0.55, Math.cos(a) * 0.56);
          p.root.add(m); return m;
        });
        p.particles = Array.from({ length: 10 }, () => { const m = new THREE.Mesh(mote, lit); p.root.add(m); return m; });
        this.scene.add(p.root);
      }
      p.pulse = Math.max(0, (p.pulse || 0) - dt);
      const active = this.active.has(p.id);
      p.runes.forEach((m) => { m.material = active ? lit : dormant; m.scale.setScalar(1 + p.pulse * 0.35); });
      p.particles.forEach((m, i) => {
        const a = time * 0.7 + i * 2.4, r = 0.65 + i % 3 * 0.23;
        m.visible = active || i < 3; m.scale.setScalar(1 + p.pulse);
        m.position.set(Math.cos(a) * r, 0.45 + (time * 0.35 + i * 0.31) % 3.4, Math.sin(a) * r);
      });
      if (d < 11 && (p.soundAt ?? 0) <= time) {
        p.soundAt = time + 8;
        this.audio.growl({ x: p.x, y: p.y + 2, z: p.z }, { pitch: 0.31, dur: 2.2, gain: active ? 0.17 : 0.09 });
      }
    }
  }
}
