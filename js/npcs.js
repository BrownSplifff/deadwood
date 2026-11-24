import * as THREE from '../lib/three.module.min.js';
import { clamp, lerp, damp, rand, pick, mergeGeos, rayCapsuleT, raySphereT } from './util.js';

// =====================================================================================
//  Desert camp NPCs: hooded cultists performing synchronised rituals around the bonfire,
//  and camels wandering around the camp. Cultists are neutral (they watch the player)
//  until someone in their camp is attacked - then that camp turns hostile.
//  Distant NPCs swap to a single low-poly mesh and are animated less often.
// =====================================================================================
const RITUAL = [['raise', 6], ['bow', 4], ['pray', 7], ['sit', 9]];
const ROBES = [0x2a0d0d, 0x3a1410, 0x1a1414, 0x2e2418, 0x101018];
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const matCache = new Map();
const mat = (c) => matCache.get(c) || matCache.set(c, new THREE.MeshLambertMaterial({ color: c, flatShading: true })).get(c);
const faceMat = new THREE.MeshBasicMaterial({ color: 0x050403 });
const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff6a20, fog: false });

const G = {
  robe: new THREE.CylinderGeometry(0.24, 0.56, 1.0, 8).translate(0, 0.5, 0),
  upper: new THREE.CylinderGeometry(0.25, 0.3, 0.6, 8).translate(0, 0.3, 0),
  hood: new THREE.ConeGeometry(0.25, 0.55, 8).translate(0, 0.27, -0.02),
  face: new THREE.SphereGeometry(0.15, 8, 6).scale(1, 1.15, 0.7).translate(0, 0.12, 0.08),
  eye: new THREE.SphereGeometry(0.018, 5, 4),
  sleeve: new THREE.CylinderGeometry(0.07, 0.12, 0.62, 6).translate(0, -0.31, 0),
  hand: new THREE.BoxGeometry(0.07, 0.1, 0.05).translate(0, -0.66, 0),
  dagger: new THREE.BoxGeometry(0.03, 0.03, 0.32).translate(0, -0.68, 0.17),
};
const lowCultist = mergeGeos([{ geo: new THREE.CylinderGeometry(0.22, 0.55, 1.6, 6).translate(0, 0.8, 0), color: 0x2a0d0d }, { geo: new THREE.ConeGeometry(0.25, 0.6, 6).translate(0, 1.85, 0), color: 0x2a0d0d }]);
const vcMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

function buildCultist() {
  const robe = mat(pick(ROBES)), skin = mat(0x6a4a34);
  const root = new THREE.Group(), detail = new THREE.Group(); root.add(detail);
  const body = new THREE.Group(); detail.add(body);
  const skirt = new THREE.Mesh(G.robe, robe); skirt.castShadow = true; body.add(skirt);
  const torso = new THREE.Group(); torso.position.y = 1.0; body.add(torso);
  torso.add(new THREE.Mesh(G.upper, robe));
  const head = new THREE.Group(); head.position.y = 0.62; torso.add(head);
  head.add(new THREE.Mesh(G.hood, robe), new THREE.Mesh(G.face, faceMat));
  for (const s of [-1, 1]) { const e = new THREE.Mesh(G.eye, eyeMat); e.position.set(s * 0.05, 0.14, 0.17); head.add(e); }
  const arms = [-1, 1].map((s) => {
    const sh = new THREE.Group(); sh.position.set(s * 0.29, 0.52, 0); torso.add(sh);
    sh.add(new THREE.Mesh(G.sleeve, robe), new THREE.Mesh(G.hand, skin));
    return sh;
  });
  const dagger = new THREE.Mesh(G.dagger, mat(0x9aa0a8)); dagger.visible = false; arms[1].add(dagger);
  const low = new THREE.Mesh(lowCultist, vcMat); low.visible = false; root.add(low);
  return { root, detail, body, skirt, torso, head, armL: arms[0], armR: arms[1], dagger, low };
}

const camelMat = mat(0x9a7a50), camelDark = mat(0x6a5236);
const CG = {
  body: new THREE.SphereGeometry(1, 10, 8).scale(1.05, 0.55, 0.5),
  hump: new THREE.SphereGeometry(1, 8, 6).scale(0.45, 0.45, 0.38),
  neck: new THREE.CylinderGeometry(0.14, 0.22, 1.1, 7).translate(0, 0.55, 0),
  head: new THREE.BoxGeometry(0.24, 0.26, 0.6).translate(0, 0.05, 0.22),
  ear: new THREE.ConeGeometry(0.04, 0.12, 4),
  thigh: new THREE.CylinderGeometry(0.11, 0.08, 0.8, 6).translate(0, -0.4, 0),
  shin: new THREE.CylinderGeometry(0.07, 0.06, 0.75, 6).translate(0, -0.375, 0),
  foot: new THREE.BoxGeometry(0.16, 0.06, 0.22).translate(0, -0.76, 0.03),
  tail: new THREE.CylinderGeometry(0.03, 0.015, 0.5, 4).translate(0, -0.25, 0),
};
const lowCamel = mergeGeos([
  { geo: new THREE.BoxGeometry(0.9, 0.9, 2.0).translate(0, 1.75, 0), color: 0x9a7a50 }, { geo: new THREE.BoxGeometry(0.6, 0.6, 0.7).translate(0, 2.4, 0), color: 0x9a7a50 },
  { geo: new THREE.BoxGeometry(0.25, 1.2, 0.25).translate(0, 2.2, 1.1), color: 0x9a7a50 }, { geo: new THREE.BoxGeometry(0.3, 0.3, 0.6).translate(0, 2.8, 1.35), color: 0x9a7a50 },
  ...[[-0.3, -0.7], [0.3, -0.7], [-0.3, 0.7], [0.3, 0.7]].map(([x, z]) => ({ geo: new THREE.BoxGeometry(0.15, 1.5, 0.15).translate(x, 0.75, z), color: 0x8a6a44 })),
]);
function buildCamel() {
  const root = new THREE.Group(), detail = new THREE.Group(); root.add(detail);
  const body = new THREE.Group(); body.position.y = 1.75; detail.add(body);
  const b = new THREE.Mesh(CG.body, camelMat); b.castShadow = true; body.add(b);
  const hump = new THREE.Mesh(CG.hump, camelMat); hump.position.set(0, 0.55, -0.05); body.add(hump);
  const neck = new THREE.Group(); neck.position.set(0, 0.15, 0.85); neck.rotation.x = 0.55; body.add(neck);
  neck.add(new THREE.Mesh(CG.neck, camelMat));
  const head = new THREE.Group(); head.position.y = 1.1; neck.add(head);
  head.add(new THREE.Mesh(CG.head, camelMat));
  for (const s of [-1, 1]) { const e = new THREE.Mesh(CG.ear, camelDark); e.position.set(s * 0.09, 0.2, 0.02); head.add(e); }
  const legs = [[-0.32, 0.65], [0.32, 0.65], [-0.32, -0.7], [0.32, -0.7]].map(([x, z]) => {
    const hp = new THREE.Group(); hp.position.set(x, -0.1, z); body.add(hp);
    hp.add(new THREE.Mesh(CG.thigh, camelMat));
    const kn = new THREE.Group(); kn.position.y = -0.8; hp.add(kn);
    kn.add(new THREE.Mesh(CG.shin, camelMat), new THREE.Mesh(CG.foot, camelDark));
    return { hp, kn };
  });
  const tail = new THREE.Mesh(CG.tail, camelDark); tail.position.set(0, 0.1, -1.0); tail.rotation.x = 0.4; body.add(tail);
  const low = new THREE.Mesh(lowCamel, vcMat); low.visible = false; root.add(low);
  return { root, detail, body, neck, head, legs, tail, low };
}

export class NPCs {
  constructor(scene, world, audio, fx) {
    this.scene = scene; this.world = world; this.audio = audio; this.fx = fx;
    this.camps = new Map();          // camp id -> { cp, cultists, camels }
    this.killed = new Set();
    this.hostile = new Set();
    this.onPlayerHit = null;
    this.frame = 0;
    this.out = { x: 0, z: 0 };
  }
  clear() { for (const id of [...this.camps.keys()]) this.unloadCamp(id); this.killed.clear(); this.hostile.clear(); }

  loadCamp(cp) {
    if (this.camps.has(cp.id)) return;
    const rec = { cp, cultists: [], camels: [], t: 0 };
    cp.seats.forEach((s, k) => {
      const id = cp.id + ':c' + k; if (this.killed.has(id)) return;
      const P = buildCultist(); this.scene.add(P.root);
      rec.cultists.push({ id, P, seat: s, x: s.x, z: s.z, yaw: s.yaw, hp: 60, dead: false, deadT: 0, phase: Math.random() * 0.4, watch: 0, headYaw: 0, attackT: 0, pose: {}, walker: false });
    });
    { // one cultist walks a slow circle around the camp
      const id = cp.id + ':cw';
      if (!this.killed.has(id)) { const P = buildCultist(); this.scene.add(P.root); rec.cultists.push({ id, P, x: cp.x + 10, z: cp.z, yaw: 0, hp: 60, dead: false, deadT: 0, phase: 0, watch: 0, headYaw: 0, attackT: 0, pose: {}, walker: true, ang: Math.random() * 6.28 }); }
    }
    for (let k = 0; k < 2; k++) {
      const id = cp.id + ':m' + k; if (this.killed.has(id)) continue;
      const P = buildCamel(); this.scene.add(P.root);
      const a = Math.random() * 6.28;
      rec.camels.push({ id, P, x: cp.x + Math.cos(a) * 16, z: cp.z + Math.sin(a) * 16, yaw: Math.random() * 6.28, hp: 80, dead: false, deadT: 0, state: 'idle', t: rand(2, 6), tx: 0, tz: 0, sit: 0, ph: Math.random() * 6, speed: 0, groanT: rand(5, 20) });
    }
    this.camps.set(cp.id, rec);
  }
  unloadCamp(id) {
    const rec = this.camps.get(id); if (!rec) return;
    for (const c of [...rec.cultists, ...rec.camels]) this.scene.remove(c.P.root);
    this.camps.delete(id);
  }

  rayHit(o, d, maxT) {
    let best = null;
    for (const rec of this.camps.values()) {
      for (const c of rec.cultists) {
        if (c.dead || !c.P.detail.visible) continue;
        const cx = c.x - o.x, cz = c.z - o.z; if (cx * d.x + cz * d.z < -2 || Math.hypot(cx, cz) > maxT + 2) continue;
        c.P.head.localToWorld(_a.set(0, 0.15, 0));
        let t = raySphereT(o.x, o.y, o.z, d.x, d.y, d.z, _a.x, _a.y, _a.z, 0.2), zone = 'head';
        c.P.root.localToWorld(_b.set(0, 0.1, 0)); c.P.torso.localToWorld(_c.set(0, 0.55, 0));
        const tb = rayCapsuleT(o, d, _b, _c, 0.35);
        if (tb >= 0 && (t < 0 || tb < t - 0.05)) { t = tb; zone = 'body'; }
        if (t >= 0 && t < maxT && (!best || t < best.t)) best = { t, zone, who: c, rec, kind: 'cultist' };
      }
      for (const m of rec.camels) {
        if (m.dead || !m.P.detail.visible) continue;
        const cx = m.x - o.x, cz = m.z - o.z; if (cx * d.x + cz * d.z < -3 || Math.hypot(cx, cz) > maxT + 3) continue;
        m.P.body.localToWorld(_b.set(0, 0, -1)); m.P.body.localToWorld(_c.set(0, 0.2, 1.1));
        const t = rayCapsuleT(o, d, _b, _c, 0.7);
        if (t >= 0 && t < maxT && (!best || t < best.t)) best = { t, zone: 'body', who: m, rec, kind: 'camel' };
      }
    }
    if (!best) return null;
    return { t: best.t, zone: best.zone, apply: (dmg) => this.damage(best.rec, best.who, best.kind, best.zone === 'head' && best.kind === 'cultist' ? 1e6 : dmg) };
  }

  damage(rec, who, kind, dmg) {
    if (who.dead) return { killed: false };
    who.hp -= dmg;
    who.P.root.getWorldPosition(_a); _a.y += 1.2;
    this.fx.emit(_a, 8, 0x7a0c0c, 2.5, 0.5, null, 8);
    if (kind === 'cultist' || kind === 'camel') {
      // any violence in the camp turns the cultists against the player
      if (!this.hostile.has(rec.cp.id)) { this.hostile.add(rec.cp.id); this.audio.cultistShout(_a); }
    }
    if (who.hp <= 0) {
      who.dead = true; who.deadT = 0; this.killed.add(who.id);
      if (kind === 'camel') this.audio.camel(_a, true); else this.audio.zHurt(_a);
      return { killed: true, kind };
    }
    if (kind === 'camel') this.audio.camel(_a, true);
    return { killed: false };
  }

  update(dt, t, player, alive) {
    this.frame++;
    const px = player.pos.x, pz = player.pos.z;
    for (const rec of this.camps.values()) {
      const cp = rec.cp, hostile = this.hostile.has(cp.id) && alive;
      rec.t += dt;
      // synchronised ritual: everyone in the circle performs the same step
      let tt = rec.t % RITUAL.reduce((a, r) => a + r[1], 0), step = RITUAL[0][0];
      for (const [n, d] of RITUAL) { if (tt < d) { step = n; break; } tt -= d; }
      rec.step = step;
      const dCamp = Math.hypot(px - cp.x, pz - cp.z);
      for (const c of rec.cultists) this.updateCultist(c, rec, dt, t, px, pz, player, step, hostile, dCamp);
      for (const m of rec.camels) this.updateCamel(m, rec, dt, t, px, pz);
    }
  }

  lod(P, d) {
    const far = d > 70;
    P.root.visible = d < 260; P.detail.visible = !far; P.low.visible = far && d < 260;
    return !far && (d < 35 || this.frame % 3 === 0);
  }

  updateCultist(c, rec, dt, t, px, pz, player, step, hostile, dCamp) {
    const P = c.P, cp = rec.cp, W = this.world;
    const d = Math.hypot(px - c.x, pz - c.z);
    if (c.dead) {
      c.deadT += dt;
      const k = clamp(c.deadT / 0.8, 0, 1);
      P.root.rotation.set(-k * k * Math.PI / 2 * 0.95, c.yaw, 0, 'YXZ');
      P.root.position.set(c.x, W.hgt(c.x, c.z) + 0.15 * k, c.z);
      P.dagger.visible = false;
      this.lod(P, d);
      return;
    }
    let pose = step, speed = 0, faceYaw = c.yaw;
    if (hostile && dCamp < 70) {
      // defend the camp: run at the player with a dagger
      P.dagger.visible = true;
      const dx = px - c.x, dz = pz - c.z;
      faceYaw = Math.atan2(dx, dz);
      if (d > 1.4) { speed = 3.4; pose = 'run'; }
      else {
        pose = 'stab'; c.attackT += dt;
        if (c.attackT > 1.5) { c.attackT = 0; if (this.onPlayerHit) this.onPlayerHit(7, 'cultist'); P.root.getWorldPosition(_a); this.audio.zAttack(_a); }
      }
    } else if (c.walker) {
      c.ang += dt * 0.11; speed = 1.1; pose = 'walk';
      const tx = cp.x + Math.cos(c.ang) * 10.5, tz = cp.z + Math.sin(c.ang) * 10.5;
      faceYaw = Math.atan2(tx - c.x, tz - c.z);
      P.dagger.visible = false;
    } else {
      // return to the seat if displaced
      const ds = Math.hypot(c.seat.x - c.x, c.seat.z - c.z);
      if (ds > 0.6) { speed = 1.4; pose = 'walk'; faceYaw = Math.atan2(c.seat.x - c.x, c.seat.z - c.z); }
      else faceYaw = c.seat.yaw;
      P.dagger.visible = false;
    }
    if (speed > 0) {
      let dx = Math.sin(faceYaw), dz = Math.cos(faceYaw);
      W.steer(c.x, c.z, dx, dz, 1, this.out); dx += this.out.x; dz += this.out.z;
      const l = Math.hypot(dx, dz) || 1;
      c.x += dx / l * speed * dt; c.z += dz / l * speed * dt;
      W.resolve(c, 0.35);
    }
    let diff = faceYaw - c.yaw; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    c.yaw += clamp(diff, -4 * dt, 4 * dt);
    P.root.position.set(c.x, W.hgt(c.x, c.z), c.z);
    P.root.rotation.set(0, c.yaw, 0);
    if (!this.lod(P, d)) return;
    // observe the player for a moment, then go back to the ritual
    c.watch -= dt;
    if (!hostile && d < 26 && c.watch < -3 && Math.random() < dt * 0.25) c.watch = rand(2.5, 5);
    let wantHead = 0;
    if (hostile || c.watch > 0) { let a = Math.atan2(px - c.x, pz - c.z) - c.yaw; a = Math.atan2(Math.sin(a), Math.cos(a)); wantHead = clamp(a, -1.4, 1.4); }
    c.headYaw = damp(c.headYaw, wantHead, 4, dt);
    this.pose(c, pose, dt, t + c.phase);
    P.head.rotation.y = c.headYaw;
  }

  pose(c, pose, dt, t) {
    const P = c.P, p = c.pose;
    const target = { y: 0, skirt: 1, torso: 0, aL: 0, aR: 0, zL: 0.1, zR: -0.1, head: 0 };
    const chant = Math.sin(t * 2.2) * 0.1;
    switch (pose) {
      case 'raise': target.aL = -2.85 + chant; target.aR = -2.85 - chant; target.zL = 0.35; target.zR = -0.35; target.head = -0.35; break;
      case 'bow': target.torso = 0.85 + Math.sin(t * 1.5) * 0.1; target.aL = target.aR = -0.5; target.head = 0.3; break;
      case 'pray': target.y = -0.5; target.skirt = 0.6; target.torso = 0.25 + Math.sin(t * 1.8) * 0.05; target.aL = -1.25; target.aR = -1.25; target.zL = -0.35; target.zR = 0.35; target.head = 0.35; break;
      case 'sit': target.y = -0.72; target.skirt = 0.45; target.torso = 0.05; target.aL = -0.6; target.aR = -0.6; target.head = Math.sin(t * 0.5) * 0.1; break;
      case 'walk': target.aL = Math.sin(t * 5) * 0.3; target.aR = -Math.sin(t * 5) * 0.3; target.torso = 0.08; target.y = Math.abs(Math.sin(t * 5)) * 0.04; break;
      case 'run': target.aL = Math.sin(t * 9) * 0.7; target.aR = -1.2; target.torso = 0.3; target.y = Math.abs(Math.sin(t * 9)) * 0.08; break;
      case 'stab': { const k = (c.attackT / 1.5); target.aR = k < 0.5 ? lerp(-0.5, -2.8, k * 2) : lerp(-2.8, -1.0, (k - 0.5) * 4); target.torso = k > 0.5 ? 0.4 : 0.1; target.aL = -0.4; break; }
      default: target.head = Math.sin(t * 0.4) * 0.1;
    }
    for (const k in target) p[k] = p[k] === undefined ? target[k] : damp(p[k], target[k], 5, dt);
    P.body.position.y = p.y; P.skirt.scale.y = p.skirt; P.torso.position.y = 1.0 * p.skirt;
    P.torso.rotation.x = p.torso;
    P.armL.rotation.set(p.aL, 0, p.zL); P.armR.rotation.set(p.aR, 0, p.zR);
    P.head.rotation.x = p.head;
  }

  updateCamel(m, rec, dt, t, px, pz) {
    const P = m.P, cp = rec.cp, W = this.world;
    const d = Math.hypot(px - m.x, pz - m.z);
    if (m.dead) {
      m.deadT += dt; const k = clamp(m.deadT / 1.2, 0, 1);
      m.sit = damp(m.sit, 1, 4, dt); this.camelPose(m, t, 0);
      P.root.rotation.set(0, m.yaw, k * 1.35, 'YXZ');
      this.lod(P, d); return;
    }
    m.t -= dt;
    m.groanT -= dt;
    if (m.groanT <= 0) { m.groanT = rand(12, 30); if (d < 60) { P.root.getWorldPosition(_a); _a.y += 2; this.audio.camel(_a); } }
    if (m.t <= 0) {
      const r = Math.random();
      if (r < 0.45) { m.state = 'wander'; const a = Math.random() * 6.28, rr = rand(14, 24); m.tx = cp.x + Math.cos(a) * rr; m.tz = cp.z + Math.sin(a) * rr; m.t = 20; }
      else if (r < 0.75) { m.state = 'idle'; m.t = rand(4, 10); }
      else { // walk over to the bonfire and sit down
        m.state = 'gotoSit'; const a = Math.random() * 6.28; m.tx = cp.x + Math.cos(a) * 6.5; m.tz = cp.z + Math.sin(a) * 6.5; m.t = 30;
      }
    }
    let speed = 0;
    if (m.state === 'wander' || m.state === 'gotoSit') {
      const dx = m.tx - m.x, dz = m.tz - m.z, dd = Math.hypot(dx, dz);
      if (dd < 1.2) { if (m.state === 'gotoSit') { m.state = 'sit'; m.t = rand(10, 20); } else { m.state = 'idle'; m.t = rand(3, 8); } }
      else {
        speed = 0.9;
        let ty = Math.atan2(dx, dz), diff = Math.atan2(Math.sin(ty - m.yaw), Math.cos(ty - m.yaw));
        m.yaw += clamp(diff, -1.2 * dt, 1.2 * dt);
        if (Math.abs(diff) < 0.6) { m.x += Math.sin(m.yaw) * speed * dt; m.z += Math.cos(m.yaw) * speed * dt; W.resolve(m, 0.9); }
      }
    }
    m.speed = damp(m.speed, speed, 3, dt);
    m.sit = damp(m.sit, m.state === 'sit' ? 1 : 0, 1.5, dt);
    P.root.position.set(m.x, W.hgt(m.x, m.z), m.z);
    P.root.rotation.set(0, m.yaw, 0);
    if (!this.lod(P, d)) return;
    m.ph += dt * (0.5 + m.speed * 2.6);
    this.camelPose(m, t, m.speed);
  }

  camelPose(m, t, speed) {
    const P = m.P, s = m.sit, A = clamp(speed / 0.9, 0, 1);
    P.body.position.y = lerp(1.75, 0.72, s) + Math.abs(Math.sin(m.ph)) * 0.04 * A;
    P.body.rotation.x = Math.sin(m.ph * 2) * 0.02 * A;
    P.legs.forEach((L, i) => {
      // pacing gait: both legs on one side move together
      const sw = Math.sin(m.ph + (i % 2 ? Math.PI : 0)) * 0.45 * A;
      L.hp.rotation.x = lerp(sw, i < 2 ? -1.45 : 1.45, s);
      L.kn.rotation.x = lerp(Math.max(0, -sw) * 0.6, i < 2 ? 2.7 : -2.7, s);
    });
    P.neck.rotation.x = 0.55 + Math.sin(m.ph) * 0.06 * A - s * 0.15;
    P.head.rotation.set(-0.5 + Math.sin(t * 0.7 + m.ph) * 0.08, Math.sin(t * 0.3 + m.ph) * 0.5, 0);
    P.tail.rotation.z = Math.sin(t * 2 + m.ph) * 0.2;
  }
}
