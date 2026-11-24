import * as THREE from '../lib/three.module.min.js';
import { clamp, lerp, damp, rand, rayCapsuleT, raySphereT } from './util.js';
import { buildModel } from './zombies.js';

// =====================================================================================
//  The Hanging Dead: corpses hanging from dead trees in the Hanging Woods. They stay still
//  until the player is near, turn their heads to follow, and spit globs of acid that fly
//  through the world (and can be dodged). Shoot them down: they drop from the rope and the
//  kill is remembered for the session.
// =====================================================================================
const CFG = { hp: 60, range: 26, cooldown: [2.8, 4.4], speed: 15, gravity: 4.5, damage: 12, telegraph: 0.45 };

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _v = new THREE.Vector3();

export class HangingDead {
  constructor(scene, world, audio, fx) {
    this.scene = scene; this.world = world; this.audio = audio; this.fx = fx;
    this.ents = new Map();
    this.killed = new Set();
    this.acid = [];
    this.onPlayerHit = null;
    this.onKill = null;
    const sh = world.shared;
    this.treeGeo = sh.deadTreeGeo; this.treeMat = sh.vcMat;
    this.ropeGeo = new THREE.CylinderGeometry(0.012, 0.012, 1, 4).translate(0, -0.5, 0);
    this.ropeMat = new THREE.MeshLambertMaterial({ color: 0x5a4a30 });
    this.acidGeo = new THREE.SphereGeometry(0.15, 8, 6);
    this.acidMat = new THREE.MeshBasicMaterial({ color: 0x8dff3a });
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(200,255,120,1)'); gr.addColorStop(0.4, 'rgba(110,255,40,0.6)'); gr.addColorStop(1, 'rgba(40,160,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    this.glowMat = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  }

  onChunkLoad(ci, cd) { for (const h of cd.hangers) if (!this.killed.has(h.id) && !this.ents.has(h.id)) this.spawn(h, ci); }
  onChunkUnload(ci) { for (const [id, e] of this.ents) if (e.ci === ci) { this.scene.remove(e.g); this.ents.delete(id); } }
  clear() { for (const e of this.ents.values()) this.scene.remove(e.g); this.ents.clear(); this.killed.clear(); for (const a of this.acid) this.scene.remove(a.m); this.acid.length = 0; }

  spawn(h, ci) {
    const g = new THREE.Group(); g.position.set(h.x, h.y - 0.15, h.z); g.rotation.y = h.yaw;
    const tree = new THREE.Mesh(this.treeGeo, this.treeMat); tree.castShadow = true; g.add(tree);
    const swing = new THREE.Group(); swing.position.set(2.3, 5.1, 0); g.add(swing);
    const rope = new THREE.Mesh(this.ropeGeo, this.ropeMat); rope.scale.y = 1.0; swing.add(rope);
    const P = buildModel('civil', false);
    P.root.position.set(0, -1.0 - 1.78, 0);
    swing.add(P.root);
    // dangling pose
    P.armL.sh.rotation.set(0.1, 0, 0.08); P.armR.sh.rotation.set(0.05, 0, -0.08);
    P.legL.hp.rotation.set(0.05, 0, 0.03); P.legR.hp.rotation.set(-0.04, 0, -0.03);
    P.headP.rotation.set(0.5, 0, 0.4);
    this.scene.add(g);
    const e = { id: h.id, ci, g, swing, rope, P, x: h.x, z: h.z, hp: CFG.hp, dead: false, cool: rand(1, 3), tele: 0, alert: 0, ph: Math.random() * 6, fallV: 0, fallen: false, headYaw: 0, headPitch: 0.5 };
    this.ents.set(h.id, e);
  }

  /** nearest hit along a ray, for the weapon system */
  rayHit(o, d, maxT) {
    let best = null;
    for (const e of this.ents.values()) {
      if (e.dead) continue;
      const P = e.P;
      P.headP.localToWorld(_a.set(0, 0.15, 0));
      const cx = _a.x - o.x, cz = _a.z - o.z;
      if (cx * d.x + cz * d.z < -3 || Math.hypot(cx, cz) > maxT + 3) continue;
      let t = raySphereT(o.x, o.y, o.z, d.x, d.y, d.z, _a.x, _a.y, _a.z, 0.18), zone = 'head';
      P.hips.localToWorld(_b.set(0, -0.8, 0)); P.torso.localToWorld(_c.set(0, 0.5, 0));
      const tb = rayCapsuleT(o, d, _b, _c, 0.26);
      if (tb >= 0 && (t < 0 || tb < t - 0.05)) { t = tb; zone = 'body'; }
      if (t >= 0 && t < maxT && (!best || t < best.t)) best = { t, zone, e };
    }
    if (!best) return null;
    const e = best.e;
    return { t: best.t, zone: best.zone, apply: (dmg) => this.damage(e, best.zone === 'head' ? 1e6 : dmg) };
  }

  damage(e, dmg) {
    if (e.dead) return { killed: false };
    e.hp -= dmg; e.alert = 6;
    e.P.headP.getWorldPosition(_v); this.fx.emit(_v, 10, 0x3a5a10, 2.5, 0.6, null, 8);
    if (e.hp <= 0) {
      e.dead = true; this.killed.add(e.id);
      this.audio.ropeSnap(_v);
      this.audio.zDie(_v);
      if (this.onKill) this.onKill(e);
      return { killed: true };
    }
    this.audio.zHurt(_v);
    return { killed: false };
  }

  update(dt, t, player, alive) {
    const px = player.pos.x, pz = player.pos.z, eyeY = player.pos.y + player.eyeH;
    for (const e of this.ents.values()) {
      const d = Math.hypot(px - e.x, pz - e.z);
      if (d > 120) { e.g.visible = false; continue; }
      e.g.visible = true;
      if (e.dead) {
        if (!e.fallen) { // the rope snaps and the body drops
          e.rope.visible = false;
          e.fallV += 18 * dt;
          e.P.root.position.y -= e.fallV * dt;
          const groundLocal = -5.1 + 0.25;
          if (e.P.root.position.y <= groundLocal) { e.P.root.position.y = groundLocal; e.fallen = true; e.P.root.rotation.x = -Math.PI / 2 * 0.95; e.P.root.position.z = -0.9; }
          else e.P.root.rotation.x = -clamp(e.fallV / 18, 0, 1) * 0.8;
          e.swing.rotation.set(0, 0, 0);
        }
        continue;
      }
      // gentle swing; twitching when the player is close
      const near = d < CFG.range;
      e.alert = Math.max(0, e.alert - dt);
      const agit = near || e.alert > 0 ? 1 : 0;
      e.swing.rotation.set(Math.cos(t * 0.6 + e.ph) * (0.04 + agit * 0.05), Math.sin(t * 0.3 + e.ph) * 0.5, Math.sin(t * 0.8 + e.ph) * (0.05 + agit * 0.06));
      if (agit) { e.P.legL.hp.rotation.x = Math.sin(t * 5 + e.ph) * 0.25; e.P.legR.hp.rotation.x = -Math.sin(t * 5.3 + e.ph) * 0.2; e.P.armL.sh.rotation.x = 0.1 + Math.sin(t * 3 + e.ph) * 0.15; }
      // head turns toward the player (in the head's parent space)
      const head = e.P.headP;
      let wantYaw = 0, wantPitch = 0.5;
      if (near && alive) {
        head.parent.getWorldPosition(_a);
        head.parent.getWorldQuaternion(_c.q || (_c.q = new THREE.Quaternion()));
        _v.set(px - _a.x, eyeY - _a.y, pz - _a.z).applyQuaternion(_c.q.invert());
        wantYaw = clamp(Math.atan2(_v.x, _v.z), -1.4, 1.4);
        wantPitch = clamp(-Math.atan2(_v.y, Math.hypot(_v.x, _v.z)), -0.6, 0.6);
      }
      e.headYaw = damp(e.headYaw, wantYaw, 3, dt); e.headPitch = damp(e.headPitch, wantPitch, 3, dt);
      head.rotation.set(e.headPitch - (e.tele > 0 ? 0.5 : 0), e.headYaw, near ? 0.1 : 0.4);
      // spit acid
      if (!near || !alive) { e.tele = 0; continue; }
      e.cool -= dt;
      if (e.tele > 0) {
        e.tele -= dt;
        if (e.tele <= 0) this.spit(e, player);
      } else if (e.cool <= 0) {
        head.getWorldPosition(_a);
        const dx = px - _a.x, dy = eyeY - 0.4 - _a.y, dz = pz - _a.z, len = Math.hypot(dx, dy, dz);
        const blocked = this.world.rayHit(_a.x, _a.y, _a.z, dx / len, dy / len, dz / len, len) < len - 0.6;
        if (blocked) { e.cool = 0.7; continue; }
        e.tele = CFG.telegraph; e.cool = rand(...CFG.cooldown);
        this.audio.gurgle(_a);
      }
    }
    this.updateAcid(dt, player, alive);
  }

  spit(e, player) {
    const head = e.P.headP;
    head.localToWorld(_a.set(0, 0.06, 0.16));
    const target = _b.set(player.pos.x, player.pos.y + player.eyeH - 0.45, player.pos.z);
    const dist = target.distanceTo(_a), tt = dist / CFG.speed;
    target.x += player.vx * tt * 0.5; target.z += player.vz * tt * 0.5;   // aim a little ahead
    const v = _c.subVectors(target, _a).normalize().multiplyScalar(CFG.speed);
    v.y += CFG.gravity * tt * 0.5;                                       // compensate the arc
    const m = new THREE.Mesh(this.acidGeo, this.acidMat); m.position.copy(_a);
    const glow = new THREE.Sprite(this.glowMat); glow.scale.set(0.9, 0.9, 1); m.add(glow);
    this.scene.add(m);
    this.acid.push({ m, v: v.clone(), life: 4, trail: 0 });
    this.audio.acidSpit(_a);
  }

  updateAcid(dt, player, alive) {
    for (let i = this.acid.length - 1; i >= 0; i--) {
      const a = this.acid[i];
      a.life -= dt;
      a.v.y -= CFG.gravity * dt;
      const p0 = a.m.position, step = a.v.length() * dt;
      const dir = _a.copy(a.v).normalize();
      const hitT = this.world.rayHit(p0.x, p0.y, p0.z, dir.x, dir.y, dir.z, step);
      // player capsule
      let hitPlayer = false;
      if (alive) {
        _b.set(player.pos.x, player.pos.y + 0.2, player.pos.z); _c.set(player.pos.x, player.pos.y + player.eyeH, player.pos.z);
        const tp = rayCapsuleT(p0, dir, _b, _c, 0.5);
        if (tp >= 0 && tp <= step && tp < hitT) hitPlayer = true;
      }
      if (hitPlayer || hitT !== Infinity || a.life <= 0) {
        if (hitPlayer) { this.fx.emit(p0, 16, 0x8dff3a, 2.5, 0.6, null, 8); this.audio.acidHit(p0); if (this.onPlayerHit) this.onPlayerHit(CFG.damage, 'acid'); }
        else if (hitT !== Infinity) { p0.addScaledVector(dir, hitT); this.fx.emit(p0, 14, 0x6adf2a, 2, 0.7, { x: 0, y: 1, z: 0 }, 8); this.audio.acidHit(p0); }
        this.scene.remove(a.m); this.acid.splice(i, 1);
        continue;
      }
      p0.addScaledVector(a.v, dt);
      a.trail -= dt;
      if (a.trail <= 0) { a.trail = 0.04; this.fx.emit(p0, 1, 0x7aef30, 0.3, 0.35, null, 1); }
    }
  }
}
