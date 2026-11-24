import * as THREE from '../lib/three.module.min.js';
import { clamp, lerp, rand, raySphereT } from './util.js';

// =====================================================================================
//  Giant sand worms. They live only inside a few "deep sand" territories of the desert and
//  hunt by vibration: walking, sprinting and gunfire fill a tremor meter, crouching or
//  standing still calms it. When it fills, a mound of sand tunnels toward the player; a
//  vortex marks the strike point and ~1.4 s later the worm bursts out in a huge arc and
//  dives back under. Get out of the vortex. The worm can be shot while it is above ground.
// =====================================================================================
export const WCFG = { segments: 34, radius: 4.6, hp: 5000, threshold: 30, devour: 95, body: 40, eruptT: 4.6, lockT: 1.4, tunnelSpeed: 12 };
const UPV = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _q = new THREE.Quaternion();

function ringTex() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#8a6e4c'; g.fillRect(0, 0, 64, 128);
  for (let y = 0; y < 128; y += 16) { const gr = g.createLinearGradient(0, y, 0, y + 16); gr.addColorStop(0, 'rgba(40,25,10,0.7)'); gr.addColorStop(0.3, 'rgba(0,0,0,0)'); gr.addColorStop(0.85, 'rgba(255,230,190,0.15)'); gr.addColorStop(1, 'rgba(40,25,10,0.6)'); g.fillStyle = gr; g.fillRect(0, y, 64, 16); }
  for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.18})`; g.fillRect(Math.random() * 64, Math.random() * 128, 2, 1); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

export class SandWorms {
  constructor(scene, world, audio, fx, zones) {
    this.scene = scene; this.world = world; this.audio = audio; this.fx = fx;
    this.zones = zones.map((z) => ({ ...z, meter: 0, state: 'idle', cool: 0, hp: WCFG.hp, dead: false }));
    this.active = null;                     // the zone whose worm is currently hunting
    this.onPlayerHit = null; this.onShake = null; this.onKill = null; this.onHunt = null;
    this.build();
  }

  build() {
    const mat = new THREE.MeshLambertMaterial({ map: ringTex(), color: 0xc8a880, flatShading: true });
    const segGeo = new THREE.CylinderGeometry(1, 1.08, 2.8, 14, 1, true);
    this.segs = [];
    const g = new THREE.Group(); g.visible = false; this.scene.add(g); this.group = g;
    for (let i = 0; i < WCFG.segments; i++) {
      const m = new THREE.Mesh(segGeo, mat), k = i / WCFG.segments, r = WCFG.radius * (1 - 0.45 * k * k);
      m.scale.set(r, 1, r); m.castShadow = true; m.userData.r = r; g.add(m); this.segs.push(m);
    }
    // the head: a wide maw with three huge petals and rings of teeth
    const head = new THREE.Group(); g.add(head); this.head = head;
    const R = WCFG.radius * 1.1;
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 0.95, 3, 16, 1, true), mat); collar.position.y = -0.5; head.add(collar);
    const throat = new THREE.Mesh(new THREE.CircleGeometry(R * 0.92, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x1a0504, side: THREE.DoubleSide })); throat.position.y = 0.2; head.add(throat);
    const petalMat = new THREE.MeshLambertMaterial({ map: mat.map, color: 0xb89a74, side: THREE.DoubleSide, flatShading: true });
    this.petals = [];
    for (let k = 0; k < 3; k++) {
      const pv = new THREE.Group(); pv.rotation.y = (k / 3) * Math.PI * 2; head.add(pv);
      const hinge = new THREE.Group(); hinge.position.set(0, 0.8, R * 0.85); pv.add(hinge);
      const petal = new THREE.Mesh(new THREE.ConeGeometry(R * 0.85, 9, 6, 1, true, 0, Math.PI * 0.66).translate(0, 4.5, 0), petalMat);
      petal.rotation.y = Math.PI - Math.PI * 0.33; hinge.add(petal);
      for (let t = 0; t < 5; t++) { const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.25, 1.4, 4), new THREE.MeshLambertMaterial({ color: 0xe8dcc0 })); tooth.position.set((t - 2) * 0.9, 1.5 + t % 2 * 2, -0.6); tooth.rotation.x = -1.2; hinge.add(tooth); }
      this.petals.push(hinge);
    }
    const teethMat = new THREE.MeshLambertMaterial({ color: 0xe0d4b4 });
    for (let ring = 0; ring < 2; ring++) for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2 + ring * 0.2, r = R * (0.8 - ring * 0.25);
      const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.5, 4), teethMat);
      tooth.position.set(Math.cos(a) * r, -0.3 - ring * 1.2, Math.sin(a) * r); tooth.lookAt(0, -2 - ring, 0); tooth.rotateX(Math.PI / 2);
      head.add(tooth);
    }
    // the sand mound that moves under the dunes while it hunts
    this.mound = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xa48e68, flatShading: true }));
    this.mound.scale.set(5, 1.4, 6); this.mound.visible = false; this.scene.add(this.mound);
    // the vortex marking the strike point
    this.vortex = new THREE.Mesh(new THREE.ConeGeometry(9, 2.5, 24, 1, true).rotateX(Math.PI), new THREE.MeshLambertMaterial({ color: 0x8a7050, transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
    this.vortex.visible = false; this.scene.add(this.vortex);
  }

  clear() {
    for (const z of this.zones) { z.meter = 0; z.state = 'idle'; z.cool = 0; }
    this.active = null; this.group.visible = false; this.mound.visible = false; this.vortex.visible = false;
    this.audio.setRumble(null, 0);
  }
  zoneAt(x, z) { return this.zones.find((o) => Math.hypot(o.x - x, o.z - z) < o.r); }
  /** gunshots carry through the sand */
  noise(x, z, amount) { for (const o of this.zones) if (!o.dead && Math.hypot(o.x - x, o.z - z) < o.r + 50) o.meter += amount; }

  pathPoint(W, u, out) {
    const s = lerp(-6, 64, u), T = W.T, gy = W.gy;
    return out.set(T.x + W.dir.x * s, gy + 30 * Math.sin(Math.PI * u) - 9, T.z + W.dir.z * s);
  }

  rayHit(o, d, maxT) {
    const z = this.active;
    if (!z || z.state !== 'erupt' || z.dead) return null;
    let best = -1;
    for (const m of this.segs) {
      if (!m.visible) continue;
      const t = raySphereT(o.x, o.y, o.z, d.x, d.y, d.z, m.position.x, m.position.y, m.position.z, m.userData.r);
      if (t >= 0 && t < maxT && (best < 0 || t < best)) best = t;
    }
    const th = raySphereT(o.x, o.y, o.z, d.x, d.y, d.z, this.head.position.x, this.head.position.y, this.head.position.z, WCFG.radius * 1.1);
    let zone = 'body';
    if (th >= 0 && th < maxT && (best < 0 || th < best)) { best = th; zone = 'head'; }
    if (best < 0) return null;
    return { t: best, zone, apply: (dmg) => this.damage(z, zone === 'head' ? dmg * 2 : dmg) };
  }
  damage(z, dmg) {
    if (z.dead) return { killed: false };
    z.hp -= dmg;
    if (z.hp <= 0) {
      z.dead = true; z.state = 'dying'; z.dieT = 0;
      this.audio.wormRoar(this.head.position, true);
      if (this.onKill) this.onKill(z, this.head.position.clone());
      return { killed: true, kind: 'worm' };
    }
    return { killed: false };
  }

  update(dt, t, player, alive, frozen = false) {
    const px = player.pos.x, pz = player.pos.z;
    // tremor meter of the territory the player is in
    for (const z of this.zones) {
      if (z.dead) continue;
      const inside = Math.hypot(z.x - px, z.z - pz) < z.r;
      if (z.state === 'cool') { z.cool -= dt; if (z.cool <= 0) z.state = 'idle'; }
      if (inside && alive && z.state === 'idle') {
        const mv = player.hspeed > 0.6 ? (player.sprinting ? 3.4 : player.hspeed / 2.4) * (player.crouching ? 0.4 : 1) : -2.5;
        z.meter = clamp(z.meter + mv * dt, 0, WCFG.threshold + 10);
        if (z.meter >= WCFG.threshold && !this.active) this.startHunt(z, player);
      } else if (z.state === 'idle') z.meter = Math.max(0, z.meter - dt * 2);
    }
    const z = this.active;
    if (!z) return;
    const W = z.w;
    if (z.state === 'hunt') {
      // tunnelling toward the player under the dunes
      const dx = px - W.mx, dz = pz - W.mz, d = Math.hypot(dx, dz);
      const sp = WCFG.tunnelSpeed * dt;
      W.mx += dx / (d || 1) * Math.min(sp, d); W.mz += dz / (d || 1) * Math.min(sp, d);
      const gy = this.world.hgt(W.mx, W.mz);
      this.mound.visible = true; this.mound.position.set(W.mx, gy - 0.6, W.mz); this.mound.rotation.y = Math.atan2(dx, dz);
      W.spray -= dt;
      if (W.spray <= 0) { W.spray = 0.08; _a.set(W.mx, gy + 0.6, W.mz); this.fx.emit(_a, 6, 0xb8a070, 3, 0.7, { x: 0, y: 1.2, z: 0 }, 7); }
      this.audio.setRumble(_a.set(W.mx, gy, W.mz), clamp(1 - d / 90, 0.2, 1));
      if (this.onShake) this.onShake(clamp(1 - d / 60, 0, 1) * 0.25);
      const out = Math.hypot(z.x - px, z.z - pz) > z.r + 70 || !alive;
      if (out) { this.endHunt(z, 10); return; }
      if (d < 9) { // lock on: the strike point is where the player stands now
        z.state = 'lock'; W.lockT = 0;
        W.T = new THREE.Vector3(px + player.vx * 0.35, 0, pz + player.vz * 0.35); W.gy = this.world.hgt(W.T.x, W.T.z);
        W.dir = new THREE.Vector3(px - W.sx, 0, pz - W.sz).normalize();
        this.vortex.visible = true;
      }
    } else if (z.state === 'lock') {
      W.lockT += dt;
      this.vortex.position.set(W.T.x, W.gy - 0.6, W.T.z); this.vortex.rotation.y += dt * 4;
      this.vortex.scale.setScalar(0.5 + W.lockT / WCFG.lockT * 0.6);
      this.mound.position.set(W.T.x, W.gy - 0.6, W.T.z);
      if (Math.random() < dt * 30) { const a = Math.random() * 6.28, r = rand(2, 9); _a.set(W.T.x + Math.cos(a) * r, W.gy + 0.3, W.T.z + Math.sin(a) * r); this.fx.emit(_a, 2, 0xb8a070, 2, 0.6, { x: -Math.cos(a), y: 0.5, z: -Math.sin(a) }, 5); }
      this.audio.setRumble(W.T, 1);
      if (this.onShake) this.onShake(0.45);
      if (W.lockT >= WCFG.lockT) { z.state = 'erupt'; W.u = 0; W.burst = false; W.hitBody = false; this.group.visible = true; this.mound.visible = false; this.vortex.visible = false; }
    } else if (z.state === 'erupt' || z.state === 'dying') {
      if (z.state === 'erupt') W.u += dt / WCFG.eruptT;
      else { z.dieT += dt; W.u += dt / (WCFG.eruptT * 3); W.sink = (W.sink || 0) + dt * 4; }
      const u = Math.min(W.u, 1);
      // place the head and every body segment along the arc (body lags behind the head)
      for (let i = -1; i < this.segs.length; i++) {
        const ui = u - (i + 1) * 0.022;
        const m = i < 0 ? this.head : this.segs[i];
        if (ui < 0) { m.visible = false; continue; }
        this.pathPoint(W, ui, _a); this.pathPoint(W, Math.max(0, ui - 0.01), _b);
        if (W.sink) _a.y -= W.sink;
        m.position.copy(_a);
        const tan = _b.sub(_a).multiplyScalar(-1).normalize();
        m.quaternion.setFromUnitVectors(UPV, tan);
        m.visible = _a.y > this.world.hgt(_a.x, _a.z) - 6;
      }
      // the moment the maw breaks the surface
      if (!W.burst && u > 0.09) {
        W.burst = true;
        for (let k = 0; k < 4; k++) { _a.set(W.T.x + rand(-4, 4), W.gy + 1, W.T.z + rand(-4, 4)); this.fx.emit(_a, 40, 0xc8a878, 12, 1.4, { x: 0, y: 1.5, z: 0 }, 9); }
        this.audio.wormRoar(W.T);
        if (this.onShake) this.onShake(1.2);
        if (alive && Math.hypot(px - W.T.x, pz - W.T.z) < 8.5 && this.onPlayerHit) this.onPlayerHit(WCFG.devour, 'worm');
      }
      this.petals.forEach((p, k) => { p.rotation.x = -0.25 - 0.6 * Math.abs(Math.sin(t * 2 + k)) * (z.state === 'erupt' ? 1 : 0.2); });
      // getting hit by the body as it crashes back down
      if (z.state === 'erupt' && alive && !W.hitBody && u > 0.5) {
        for (const m of this.segs) if (m.visible && m.position.distanceTo(_a.set(px, player.pos.y + 1, pz)) < m.userData.r + 1) { W.hitBody = true; if (this.onPlayerHit) this.onPlayerHit(WCFG.body, 'worm'); break; }
      }
      if (u > 0.85 && !W.diveFx) { W.diveFx = true; this.pathPoint(W, 0.91, _a); _a.y = this.world.hgt(_a.x, _a.z) + 1; this.fx.emit(_a, 40, 0xc8a878, 10, 1.2, { x: 0, y: 1.5, z: 0 }, 9); if (this.onShake) this.onShake(0.6); }
      this.audio.setRumble(this.head.position, z.state === 'erupt' ? 1 - u * 0.6 : 0.3);
      if (W.u >= 1 || (z.state === 'dying' && z.dieT > 5)) this.endHunt(z, z.state === 'dying' ? 0 : rand(25, 40));
    }
  }

  startHunt(z, player) {
    const a = Math.random() * 6.28, sx = player.pos.x + Math.cos(a) * 85, sz = player.pos.z + Math.sin(a) * 85;
    z.state = 'hunt';
    z.w = { mx: sx, mz: sz, sx, sz, spray: 0 };
    this.active = z;
    if (this.onHunt) this.onHunt(z);
  }
  endHunt(z, cool) {
    if (z.state !== 'dying' || z.dead) { z.state = z.dead ? 'dead' : 'cool'; }
    if (z.dead) z.state = 'dead';
    z.cool = cool; z.meter = 0;
    this.active = null; this.group.visible = false; this.mound.visible = false; this.vortex.visible = false;
    this.audio.setRumble(null, 0);
  }
}
