import * as THREE from '../lib/three.module.min.js';
import { clamp, lerp, damp, rand, pick, rayCapsuleT, raySphereT } from './util.js';

// =====================================================================================
//  Infected zombie dogs: desert packs. Fast, low health. They circle the player and dart in
//  to bite. Headshots kill; every dog drops a piece of infected flesh.
// =====================================================================================
const CFG = { hp: 45, speed: 7.2, roam: 2.2, detect: 38, bite: 8, biteRange: 1.5, biteCool: 0.85 };
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const matCache = new Map();
const mat = (c, e = 0) => matCache.get(c + ':' + e) || matCache.set(c + ':' + e, new THREE.MeshLambertMaterial({ color: c, emissive: e, flatShading: true })).get(c + ':' + e);
const FUR = [0x5a4a3a, 0x4a3e34, 0x6a5848, 0x3a322c];
const G = {
  body: new THREE.CylinderGeometry(0.2, 0.17, 0.85, 7).rotateX(Math.PI / 2),
  chest: new THREE.SphereGeometry(0.24, 7, 5).scale(1, 1.05, 1.1),
  head: new THREE.BoxGeometry(0.22, 0.2, 0.26),
  snout: new THREE.BoxGeometry(0.12, 0.11, 0.2).translate(0, -0.03, 0.2),
  jaw: new THREE.BoxGeometry(0.11, 0.04, 0.18).translate(0, -0.03, 0.09),
  ear: new THREE.ConeGeometry(0.05, 0.13, 4),
  eye: new THREE.SphereGeometry(0.025, 5, 4),
  upper: new THREE.CylinderGeometry(0.06, 0.045, 0.3, 5).translate(0, -0.15, 0),
  lower: new THREE.CylinderGeometry(0.04, 0.035, 0.28, 5).translate(0, -0.14, 0),
  tail: new THREE.CylinderGeometry(0.035, 0.012, 0.42, 4).translate(0, -0.21, 0),
  rot: new THREE.SphereGeometry(0.1, 5, 4),
};
const eyeMat = new THREE.MeshBasicMaterial({ color: 0xc8ff40 });
const sore = mat(0x4a6a1a, 0x0a2000), raw = mat(0x6a1a14);

function buildDog() {
  const fur = mat(pick(FUR));
  const root = new THREE.Group(), body = new THREE.Group(); body.position.y = 0.62; root.add(body);
  const b = new THREE.Mesh(G.body, fur); b.position.z = -0.15; b.castShadow = true; body.add(b);
  const chest = new THREE.Mesh(G.chest, fur); chest.position.z = 0.22; body.add(chest);
  // infected sores and exposed ribs
  for (let k = 0; k < 3; k++) { const r = new THREE.Mesh(G.rot, k ? sore : raw); r.position.set((Math.random() - 0.5) * 0.3, 0.1 + Math.random() * 0.08, -0.4 + Math.random() * 0.5); r.scale.setScalar(0.6 + Math.random() * 0.6); body.add(r); }
  const neck = new THREE.Group(); neck.position.set(0, 0.12, 0.38); body.add(neck);
  const head = new THREE.Group(); head.position.set(0, 0.06, 0.12); neck.add(head);
  head.add(new THREE.Mesh(G.head, fur), new THREE.Mesh(G.snout, fur));
  const jaw = new THREE.Group(); jaw.position.set(0, -0.08, 0.1); head.add(jaw); jaw.add(new THREE.Mesh(G.jaw, raw));
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(G.ear, fur); e.position.set(s * 0.08, 0.15, -0.05); e.rotation.z = -s * 0.3; head.add(e);
    const ey = new THREE.Mesh(G.eye, eyeMat); ey.position.set(s * 0.06, 0.04, 0.13); head.add(ey);
  }
  const legs = [[0.13, 0.25], [-0.13, 0.25], [0.12, -0.45], [-0.12, -0.45]].map(([x, z]) => {
    const hp = new THREE.Group(); hp.position.set(x, -0.05, z); body.add(hp);
    hp.add(new THREE.Mesh(G.upper, fur));
    const kn = new THREE.Group(); kn.position.y = -0.3; hp.add(kn);
    kn.add(new THREE.Mesh(G.lower, fur));
    return { hp, kn };
  });
  const tail = new THREE.Group(); tail.position.set(0, 0.08, -0.58); body.add(tail); tail.add(new THREE.Mesh(G.tail, fur)); tail.rotation.x = -2.2;
  return { root, body, neck, head, jaw, legs, tail };
}

export class Dogs {
  constructor(scene, world, audio, fx) {
    this.scene = scene; this.world = world; this.audio = audio; this.fx = fx;
    this.list = []; this.onPlayerHit = null; this.onKill = null; this.out = { x: 0, z: 0 }; this.farDist = 200;
  }
  count() { return this.list.filter((d) => !d.dead).length; }
  clear() { for (const d of this.list) this.scene.remove(d.P.root); this.list.length = 0; }

  spawnPack(x, z, n) {
    const pack = { tx: x, tz: z, t: 0 };
    for (let i = 0; i < n; i++) {
      const P = buildDog(), a = Math.random() * 6.28, r = rand(1, 4);
      const d = { P, pack, x: x + Math.cos(a) * r, z: z + Math.sin(a) * r, y: 0, yaw: Math.random() * 6.28, hp: CFG.hp, dead: false, deadT: 0, state: 'roam',
        speed: 0, ph: Math.random() * 6, biteT: rand(0, 0.5), lunge: 0, orbit: Math.random() < 0.5 ? 1 : -1, orbitT: rand(0.5, 2.5), barkT: rand(1, 5), dist: 999 };
      d.y = this.world.hgt(d.x, d.z);
      this.scene.add(P.root); this.list.push(d);
    }
  }
  alert(x, z, r) { for (const d of this.list) if (!d.dead && Math.hypot(d.x - x, d.z - z) < r) d.state = 'chase'; }

  rayHit(o, dir, maxT) {
    let best = null;
    for (const d of this.list) {
      if (d.dead || !d.P.root.visible) continue;
      const cx = d.x - o.x, cz = d.z - o.z; if (cx * dir.x + cz * dir.z < -2 || Math.hypot(cx, cz) > maxT + 2) continue;
      d.P.head.localToWorld(_a.set(0, 0.02, 0.05));
      let t = raySphereT(o.x, o.y, o.z, dir.x, dir.y, dir.z, _a.x, _a.y, _a.z, 0.17), zone = 'head';
      d.P.body.localToWorld(_b.set(0, 0, -0.55)); d.P.body.localToWorld(_c.set(0, 0.05, 0.35));
      const tb = rayCapsuleT(o, dir, _b, _c, 0.24);
      if (tb >= 0 && (t < 0 || tb < t - 0.03)) { t = tb; zone = 'body'; }
      if (t >= 0 && t < maxT && (!best || t < best.t)) best = { t, zone, d };
    }
    if (!best) return null;
    return { t: best.t, zone: best.zone, apply: (dmg) => this.damage(best.d, best.zone === 'head' ? 1e6 : dmg) };
  }
  damage(d, dmg) {
    if (d.dead) return { killed: false };
    d.hp -= dmg; d.state = 'chase';
    for (const o of this.list) if (o.pack === d.pack) o.state = 'chase';
    _a.set(d.x, d.y + 0.6, d.z);
    if (d.hp <= 0) { d.dead = true; d.deadT = 0; this.audio.dogYelp(_a, true); if (this.onKill) this.onKill(d); return { killed: true, kind: 'dog' }; }
    this.audio.dogYelp(_a); return { killed: false };
  }

  update(dt, t, player, alive) {
    const px = player.pos.x, pz = player.pos.z, W = this.world;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const d = this.list[i], P = d.P;
      d.dist = Math.hypot(px - d.x, pz - d.z);
      P.root.visible = d.dist < this.farDist;
      if (d.dead) {
        d.deadT += dt;
        const k = clamp(d.deadT / 0.5, 0, 1);
        P.body.rotation.set(0, 0, k * 1.45); P.body.position.y = lerp(0.62, 0.22, k);
        if (d.deadT > 15 || (d.deadT > 3 && d.dist > 80)) { this.scene.remove(P.root); this.list.splice(i, 1); }
        continue;
      }
      if (d.dist > 260) { this.scene.remove(P.root); this.list.splice(i, 1); continue; }
      // ---- AI
      let speed = 0, tx = d.x, tz = d.z;
      if (alive && (d.dist < CFG.detect * (this.detectMul ?? 1) || d.state === 'chase')) d.state = 'chase';
      if (!alive) d.state = 'roam';
      if (d.state === 'roam') {
        const pk = d.pack; pk.t -= dt;
        if (pk.t <= 0) { pk.t = rand(4, 9); pk.tx = d.x + rand(-30, 30); pk.tz = d.z + rand(-30, 30); }
        tx = pk.tx + Math.cos(d.ph) * 3; tz = pk.tz + Math.sin(d.ph) * 3;
        if (Math.hypot(tx - d.x, tz - d.z) > 2) speed = CFG.roam;
      } else {
        // circle the prey, then dart in to bite
        d.orbitT -= dt;
        if (d.orbitT <= 0) { d.orbitT = rand(1.5, 3.5); d.orbit = -d.orbit; d.dash = Math.random() < 0.6; }
        if (d.dash || d.dist < 3) { tx = px; tz = pz; speed = d.dist > CFG.biteRange * 0.8 ? CFG.speed : 0; }
        else {
          const a = Math.atan2(d.z - pz, d.x - px) + d.orbit * 0.9;
          tx = px + Math.cos(a) * 5; tz = pz + Math.sin(a) * 5; speed = CFG.speed * 0.8;
        }
        d.biteT -= dt;
        if (d.dist < CFG.biteRange && d.biteT <= 0) {
          d.biteT = CFG.biteCool; d.lunge = 0.35; d.dash = false;
          if (this.onPlayerHit) this.onPlayerHit(CFG.bite, 'dog');
          _a.set(d.x, d.y + 0.6, d.z); this.audio.dogBark(_a, true);
        }
        d.barkT -= dt;
        if (d.barkT <= 0) { d.barkT = rand(1.5, 4); if (d.dist < 60) { _a.set(d.x, d.y + 0.6, d.z); this.audio.dogBark(_a); } }
      }
      let dx = tx - d.x, dz = tz - d.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      if (speed > 0) { W.steer(d.x, d.z, dx, dz, d.orbit, this.out); dx += this.out.x; dz += this.out.z; const l2 = Math.hypot(dx, dz) || 1; dx /= l2; dz /= l2; }
      d.x += dx * speed * dt; d.z += dz * speed * dt;
      for (const o of this.list) { if (o === d || o.dead) continue; const ox = d.x - o.x, oz = d.z - o.z, dd = Math.hypot(ox, oz); if (dd < 0.8 && dd > 1e-4) { d.x += ox / dd * (0.8 - dd) * 0.5; d.z += oz / dd * (0.8 - dd) * 0.5; } }
      if (alive && d.dist < 0.9) { const ox = d.x - px, oz = d.z - pz, dd = Math.hypot(ox, oz) || 1; d.x += ox / dd * (0.9 - d.dist); d.z += oz / dd * (0.9 - d.dist); }
      W.resolve(d, 0.35);
      d.y = W.hgt(d.x, d.z);
      d.speed = damp(d.speed, speed, 6, dt);
      const face = d.state === 'chase' && d.dist < 4 ? Math.atan2(px - d.x, pz - d.z) : speed > 0 ? Math.atan2(dx, dz) : d.yaw;
      let df = Math.atan2(Math.sin(face - d.yaw), Math.cos(face - d.yaw)); d.yaw += clamp(df, -8 * dt, 8 * dt);
      P.root.position.set(d.x, d.y, d.z); P.root.rotation.y = d.yaw;
      if (!P.root.visible || (d.dist > 50 && Math.floor(t * 30) % 2)) continue;
      // ---- gallop animation
      const A = clamp(d.speed / CFG.speed, 0, 1), gal = A > 0.45;
      d.ph += dt * (2 + d.speed * 2.2);
      const ph = d.ph;
      P.legs.forEach((L, k) => {
        const off = gal ? (k < 2 ? 0 : Math.PI * 0.9) + (k % 2) * 0.3 : (k === 0 || k === 3 ? 0 : Math.PI);
        const sw = Math.sin(ph + off) * (0.25 + 0.6 * A);
        L.hp.rotation.x = sw; L.kn.rotation.x = Math.max(0, -Math.cos(ph + off)) * 0.9 * A * (k < 2 ? -1 : 1);
      });
      P.body.position.y = 0.62 + Math.abs(Math.sin(ph)) * 0.06 * A;
      P.body.rotation.x = gal ? Math.sin(ph) * 0.12 : 0;
      d.lunge = Math.max(0, d.lunge - dt);
      P.neck.rotation.x = d.lunge > 0 ? -0.5 : 0.25 + Math.sin(ph * 0.5) * 0.08;
      P.jaw.rotation.x = d.lunge > 0 || d.state === 'chase' ? 0.35 + Math.sin(t * 20) * 0.15 : 0.05;
      P.tail.rotation.set(-2.2 + Math.sin(ph) * 0.2, 0, Math.sin(t * 6 + ph) * 0.4);
    }
  }
}
