import * as THREE from '../lib/three.module.min.js';
import { clamp, lerp, damp, rand, rayCapsuleT, raySphereT } from './util.js';

// =====================================================================================
//  THE ANCIENT MUMMY - desert boss, sitting on its throne in the heart of the Great Pyramid.
//  Phases: 1 (100-60%) slow, bandage projectiles, melee
//          2 (60-25%)  faster, + bandage grab, + summon sand zombies
//          3 (<25%)    aggressive, short cooldowns, + ground slam shockwave
// =====================================================================================
// 2.5x the original size (~7.5 m tall), +50% health, faster
export const MCFG = { hp: 3600, scale: 4.1, headMul: 3, throne: 2.2 };
const S = MCFG.scale / 1.65;   // distance scale relative to the original design
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();

function clothTex() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#b4a482'; g.fillRect(0, 0, 64, 128);
  for (let y = 0; y < 128; y += 6 + Math.random() * 5) { g.fillStyle = `rgba(60,45,25,${0.25 + Math.random() * 0.35})`; g.save(); g.translate(0, y); g.rotate((Math.random() - 0.5) * 0.25); g.fillRect(-10, 0, 90, 1.5 + Math.random() * 1.5); g.restore(); }
  for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(90,70,40,${Math.random() * 0.3})`; g.fillRect(Math.random() * 64, Math.random() * 128, 4 + Math.random() * 10, 2); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

export class Mummy {
  constructor(scene, world, audio, fx, zombies) {
    this.scene = scene; this.world = world; this.audio = audio; this.fx = fx; this.zombies = zombies;
    this.defeated = false;
    this.m = null;
    this.projs = [];
    this.onPlayerHit = null; this.onDefeat = null; this.onGrab = null;
    this.clothMat = new THREE.MeshLambertMaterial({ map: clothTex(), color: 0xd8c8a4 });
    this.stripMat = new THREE.MeshLambertMaterial({ map: this.clothMat.map, color: 0xe0d0aa, side: THREE.DoubleSide });
    this.goldMat = new THREE.MeshLambertMaterial({ color: 0xd8a030, emissive: 0x2a1800 });
    this.blueMat = new THREE.MeshLambertMaterial({ color: 0x1a2a6a });
    this.eyeMat = new THREE.MeshBasicMaterial({ color: 0x000000, fog: false });
    this.stripGeo = new THREE.BoxGeometry(0.16, 0.025, 1).translate(0, 0, 0.5);
    this.ringGeo = new THREE.RingGeometry(0.85, 1, 48).rotateX(-Math.PI / 2);
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xd8b878, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false });
  }

  // ---------------------------------------------------------------- model
  build(G) {
    const s = MCFG.scale, root = new THREE.Group(), model = new THREE.Group(); root.add(model);
    const C = this.clothMat, cyl = (rt, rb, h, seg = 8) => new THREE.CylinderGeometry(rt, rb, h, seg);
    const hips = new THREE.Group(); hips.position.y = 0.95; model.add(hips);
    hips.add(new THREE.Mesh(cyl(0.2, 0.19, 0.25), C));
    const torso = new THREE.Group(); torso.position.y = 0.1; hips.add(torso);
    const tm = new THREE.Mesh(cyl(0.27, 0.2, 0.62).translate(0, 0.31, 0), C); tm.scale.z = 0.72; torso.add(tm);
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.06, 6, 16).rotateX(Math.PI / 2), this.goldMat); collar.position.y = 0.6; collar.scale.z = 0.8; torso.add(collar);
    const scarab = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, 0.04), this.blueMat); scarab.position.set(0, 0.48, 0.16); torso.add(scarab);
    const head = new THREE.Group(); head.position.y = 0.66; torso.add(head);
    head.add(new THREE.Mesh(cyl(0.14, 0.12, 0.3).translate(0, 0.15, 0), C));
    // nemes headdress (blue and gold stripes) and a cobra on the brow
    const nemes = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.32, 0.36).translate(0, 0.2, -0.04), this.blueMat); head.add(nemes);
    for (let k = 0; k < 3; k++) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.43, 0.035, 0.37), this.goldMat); st.position.set(0, 0.1 + k * 0.1, -0.04); head.add(st); }
    for (const sd of [-1, 1]) { const lap = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.4, 0.12).translate(0, -0.1, 0), this.blueMat); lap.position.set(sd * 0.2, 0.05, 0.08); head.add(lap); }
    const cobra = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.12, 5), this.goldMat); cobra.position.set(0, 0.36, 0.15); head.add(cobra);
    const eyes = [];
    for (const sd of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 5), this.eyeMat); e.position.set(sd * 0.055, 0.17, 0.13); head.add(e); eyes.push(e); }
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x40ffd0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    glow.position.set(0, 0.17, 0.16); glow.scale.set(0.35, 0.18, 1); head.add(glow);
    const arm = (side) => {
      const sh = new THREE.Group(); sh.position.set(side * 0.33, 0.52, 0); torso.add(sh);
      sh.add(new THREE.Mesh(cyl(0.08, 0.07, 0.36).translate(0, -0.18, 0), C));
      const el = new THREE.Group(); el.position.y = -0.36; sh.add(el);
      el.add(new THREE.Mesh(cyl(0.07, 0.055, 0.34).translate(0, -0.17, 0), C));
      el.add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 0.06).translate(0, -0.41, 0), C));
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.02, 4, 10).rotateX(Math.PI / 2), this.goldMat); band.position.y = -0.25; el.add(band);
      // loose bandages dangling from the arm
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.6).translate(0, -0.3, 0), this.stripMat); strip.position.set(side * 0.04, -0.2, 0.03); el.add(strip);
      return { sh, el, strip };
    };
    const leg = (side) => {
      const hp = new THREE.Group(); hp.position.set(side * 0.12, -0.06, 0); hips.add(hp);
      hp.add(new THREE.Mesh(cyl(0.1, 0.08, 0.47).translate(0, -0.235, 0), C));
      const kn = new THREE.Group(); kn.position.y = -0.47; hp.add(kn);
      kn.add(new THREE.Mesh(cyl(0.075, 0.06, 0.45).translate(0, -0.225, 0), C));
      kn.add(new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.07, 0.22).translate(0, -0.47, 0.05), C));
      return { hp, kn };
    };
    const armL = arm(-1), armR = arm(1), legL = leg(-1), legR = leg(1);
    const waist = [];
    for (let k = 0; k < 5; k++) { const st = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.5 + k * 0.08).translate(0, -0.25 - k * 0.04, 0), this.stripMat); const a = (k / 5) * Math.PI * 2; st.position.set(Math.cos(a) * 0.2, 0, Math.sin(a) * 0.15); st.rotation.y = -a; hips.add(st); waist.push(st); }
    root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    root.scale.setScalar(s);
    this.scene.add(root);
    const th = G.throne;
    this.G = G;
    this.m = {
      root, model, hips, torso, head, armL, armR, legL, legR, eyes, glow, waist,
      x: G.x + th.lx - 0.2, z: G.z + th.lz, y: G.F + 2.8 * MCFG.throne - 0.37 * MCFG.scale, yaw: -Math.PI / 2,
      state: this.defeated ? 'gone' : 'dormant', t: 0, hp: MCFG.hp, phase: 1, cool: 3, act: null, actT: 0, eye: 0, speed: 0, walk: 0,
      summonCool: 6, hurtT: 0, deadT: 0, grab: null, slams: [],
    };
    if (this.defeated) root.visible = false;
    this.pose(0, true);
  }
  unload() {
    if (!this.m) return;
    this.scene.remove(this.m.root);
    this.clearProjectiles();
    this.m = null;
  }
  reset() { // new game: the boss sleeps on its throne again unless defeated this session
    if (this.m && this.G) { const G = this.G; this.unload(); this.build(G); }
  }

  get active() { return this.m && (this.m.state === 'fight' || this.m.state === 'waking'); }
  get hpFrac() { return this.m ? this.m.hp / MCFG.hp : 0; }

  // ---------------------------------------------------------------- damage
  rayHit(o, d, maxT) {
    const m = this.m;
    if (!m || m.state === 'gone' || m.state === 'dying' || m.state === 'dead') return null;
    const S = MCFG.scale;
    m.head.localToWorld(_a.set(0, 0.15, 0.02));
    let t = raySphereT(o.x, o.y, o.z, d.x, d.y, d.z, _a.x, _a.y, _a.z, 0.24 * S), zone = 'head';
    m.root.localToWorld(_b.set(0, 0.15, 0)); m.torso.localToWorld(_c.set(0, 0.6, 0));
    const tb = rayCapsuleT(o, d, _b, _c, 0.36 * S);
    if (tb >= 0 && (t < 0 || tb < t - 0.05)) { t = tb; zone = 'body'; }
    if (t < 0 || t > maxT) return null;
    return { t, zone, apply: (dmg) => this.damage(zone === 'head' ? dmg * MCFG.headMul : dmg) };
  }
  damage(dmg) {
    const m = this.m;
    if (m.state === 'dormant') this.wake();
    m.hp -= dmg; m.hurtT = 0.12;
    m.head.getWorldPosition(_a); this.fx.emit(_a, 8, 0xc8b890, 2.2, 0.6, null, 6);
    if (m.hp <= 0) { this.die(); return { killed: true }; }
    const ph = m.hp / MCFG.hp > 0.6 ? 1 : m.hp / MCFG.hp > 0.25 ? 2 : 3;
    if (ph !== m.phase) { m.phase = ph; m.act = { type: 'roar', dur: 1.4 }; m.actT = 0; this.audio.mummyRoar(_a); }
    return { killed: false };
  }
  wake() {
    const m = this.m;
    if (!m || m.state !== 'dormant') return;
    m.state = 'waking'; m.t = 0;
    m.head.getWorldPosition(_a); this.audio.mummyRoar(_a, true);
  }
  die() {
    const m = this.m;
    m.state = 'dying'; m.deadT = 0; m.act = null;
    this.clearProjectiles();
    if (m.grab && this.onGrab) this.onGrab(null);
    m.grab = null;
    m.head.getWorldPosition(_a); this.audio.mummyRoar(_a, false, true);
    this.defeated = true;
    if (this.onDefeat) this.onDefeat(m.x, m.z, m.y);
  }
  clearProjectiles() {
    for (const p of this.projs) this.scene.remove(p.mesh);
    this.projs.length = 0;
    if (this.m) { for (const s of this.m.slams) this.scene.remove(s.mesh); this.m.slams.length = 0; }
  }

  // ---------------------------------------------------------------- update
  update(dt, t, player, alive) {
    const m = this.m;
    if (!m || m.state === 'gone') return;
    const G = this.G, ch = G.chamber;
    const px = player.pos.x, pz = player.pos.z;
    const inChamber = px > ch.x0 && px < ch.x1 && pz > ch.z0 && pz < ch.z1;
    const d = Math.hypot(px - m.x, pz - m.z);
    m.hurtT = Math.max(0, m.hurtT - dt);
    if (m.state === 'dormant') {
      if (inChamber && alive) this.wake();
      this.pose(dt, true, t);
      return;
    }
    if (m.state === 'waking') {
      // slowly raises its head, eyes ignite, rises and steps down from the throne
      m.t += dt;
      m.eye = clamp((m.t - 1.0) / 1.0, 0, 1);
      const k = clamp((m.t - 2.0) / 2.2, 0, 1);
      m.x = G.x + G.throne.lx - 0.2 - k * 16; m.y = lerp(G.F + 2.8 * MCFG.throne - 0.37 * MCFG.scale, G.F, smoothK(k));
      this.pose(dt, k < 0.35, t, clamp(m.t / 1.6, 0, 1));
      if (m.t > 4.4) { m.state = 'fight'; m.y = G.F; m.cool = 1.5; }
      this.place();
      return;
    }
    if (m.state === 'dying') {
      m.deadT += dt;
      const k = clamp(m.deadT / 3, 0, 1);
      m.eye = 1 - k;
      // drops to its knees, then topples forward
      m.model.position.y = -0.45 * clamp(k * 2, 0, 1);
      m.model.rotation.x = k > 0.5 ? (k - 0.5) * 2 * 1.45 : 0;
      m.armL.sh.rotation.x = lerp(m.armL.sh.rotation.x, 0.3, dt * 2); m.armR.sh.rotation.x = lerp(m.armR.sh.rotation.x, 0.3, dt * 2);
      m.legL.hp.rotation.x = lerp(0, -1.5, clamp(k * 2, 0, 1)); m.legL.kn.rotation.x = lerp(0, 1.5, clamp(k * 2, 0, 1));
      m.legR.hp.rotation.x = m.legL.hp.rotation.x; m.legR.kn.rotation.x = m.legL.kn.rotation.x;
      if (k > 0.5 && !m.dustDone) { m.dustDone = true; _a.set(m.x, m.y + 0.3, m.z); this.fx.emit(_a, 40, 0xb8a070, 4, 1.2, { x: 0, y: 1, z: 0 }, 5); this.audio.slam(_a); }
      this.applyEyes();
      if (k >= 1) m.state = 'dead';
      return;
    }
    if (m.state === 'dead') return;

    // ---------------- fight
    const P = [null, { speed: 2.4, cool: 2.0 }, { speed: 3.3, cool: 1.4 }, { speed: 4.2, cool: 0.9 }][m.phase];
    const toYaw = Math.atan2(px - m.x, pz - m.z);
    m.eye = 1;
    m.summonCool -= dt;
    if (!alive) { m.act = null; this.pose(dt, false, t); this.place(); this.updateProjectiles(dt, player, false); return; }
    if (m.act) this.runAction(dt, t, player, d, toYaw);
    else {
      m.cool -= dt;
      // walk toward the player (stays inside the chamber)
      let speed = d > 4 * S ? P.speed : 0;
      if (m.hurtT > 0) speed *= 0.4;
      m.yaw = turn(m.yaw, toYaw, 3.2 * dt);
      if (speed > 0) {
        m.x += Math.sin(m.yaw) * speed * dt; m.z += Math.cos(m.yaw) * speed * dt;
        this.world.resolve(m, 2.6);
        m.x = clamp(m.x, ch.x0 + 5, ch.x1 - 5); m.z = clamp(m.z, ch.z0 + 5, ch.z1 - 5);
      }
      m.speed = damp(m.speed, speed, 6, dt);
      if (m.cool <= 0) this.choose(d, player);
    }
    this.pose(dt, false, t);
    this.place();
    this.updateProjectiles(dt, player, alive);
    this.updateSlams(dt, player);
  }

  choose(d) {
    const m = this.m, ph = m.phase, r = Math.random();
    const P = [0, 2.0, 1.4, 0.9][ph];
    let type;
    if (ph === 3 && d < 7 * S) type = 'slam';
    else if (d < 3.4 * S) type = 'melee';
    else if (ph >= 2 && m.summonCool <= 0 && r < (ph === 2 ? 0.25 : 0.18) && this.zombies.count('summon') < 5) type = 'summon';
    else if (ph >= 2 && r < (ph === 2 ? 0.6 : 0.42) && d < 40) type = 'grab';
    else type = 'bandage';
    const dur = { bandage: 0.5, grab: 0.7, summon: 1.1, slam: 0.8, melee: 0.42 }[type];
    m.act = { type, dur, done: false, volley: ph === 3 && type === 'bandage' ? 2 : 1 };
    m.actT = 0;
    m.cool = P * rand(0.8, 1.2);
    m.head.getWorldPosition(_a);
    if (type === 'summon') { m.summonCool = 14; this.audio.mummyChant(_a); }
    else if (type === 'slam') this.audio.mummyRoar(_a);
  }

  runAction(dt, t, player, d, toYaw) {
    const m = this.m, a = m.act;
    m.actT += dt;
    m.speed = damp(m.speed, 0, 8, dt);
    if (a.type !== 'roar' && a.type !== 'grabhold') m.yaw = turn(m.yaw, toYaw, 3 * dt);
    if (a.type === 'roar') { if (m.actT > a.dur) m.act = null; return; }
    if (!a.done && m.actT >= a.dur) {
      a.done = true;
      if (a.type === 'bandage' || a.type === 'grab') this.launch(a.type, player);
      else if (a.type === 'summon') this.summon(player);
      else if (a.type === 'slam') this.slam();
      else if (a.type === 'melee' && d < 3.8 * S && this.onPlayerHit) { this.onPlayerHit(16, 'mummy'); m.head.getWorldPosition(_a); this.audio.zAttack(_a); }
    }
    if (a.done && a.type === 'bandage' && a.volley > 1 && m.actT > a.dur + 0.25) { a.volley--; this.launch('bandage', player); m.actT = a.dur; }
    const wait = a.type === 'grab' ? 0.15 : 0.3;
    if (a.done && m.actT > a.dur + wait && !(a.type === 'grab' && m.grab)) m.act = null;
  }

  handPos(out, side = 1) { (side > 0 ? this.m.armR : this.m.armL).el.localToWorld(out.set(0, -0.42, 0.05)); return out; }

  launch(type, player) {
    const m = this.m, hand = this.handPos(new THREE.Vector3(), 1);
    const tgt = _b.set(player.pos.x, player.pos.y + player.eyeH - 0.5, player.pos.z);
    const dist = hand.distanceTo(tgt), speed = type === 'grab' ? 34 : 30;
    tgt.x += player.vx * (dist / speed) * 0.6; tgt.z += player.vz * (dist / speed) * 0.6;
    const dir = new THREE.Vector3().subVectors(tgt, hand).normalize();
    const mesh = new THREE.Mesh(this.stripGeo, this.stripMat); mesh.scale.set(type === 'grab' ? 3.6 : 2.4, type === 'grab' ? 3.6 : 2.4, 0.1);
    this.scene.add(mesh);
    this.projs.push({ type, start: hand, dir, len: 0, speed, max: type === 'grab' ? 45 : 60, state: 'fly', mesh, t: 0 });
    this.audio.bandageWhip(hand);
  }
  summon(player) {
    const G = this.G, ch = G.chamber, n = 2 + (this.m.phase === 3 ? 1 : 0);
    for (let k = 0; k < n; k++) {
      for (let att = 0; att < 12; att++) {
        const a = Math.random() * 6.28, r = rand(6, 14), x = clamp(player.pos.x + Math.cos(a) * r, ch.x0 + 3, ch.x1 - 3), z = clamp(player.pos.z + Math.sin(a) * r, ch.z0 + 3, ch.z1 - 3);
        if (Math.hypot(x - player.pos.x, z - player.pos.z) < 4 || this.world.blocked(x, z, 0.8)) continue;
        const e = this.zombies.spawnBuried(Math.random() < 0.3 ? 'runner' : 'walker', x, z, 'summon', 99);
        this.zombies.emerge(e);
        break;
      }
    }
  }
  slam() {
    const m = this.m;
    const mesh = new THREE.Mesh(this.ringGeo, this.ringMat.clone()); mesh.position.set(m.x, m.y + 0.15, m.z); this.scene.add(mesh);
    m.slams.push({ mesh, r: 0.5, hit: false });
    _a.set(m.x, m.y + 0.2, m.z); this.fx.emit(_a, 50, 0xc8a870, 9, 1.0, { x: 0, y: 0.8, z: 0 }, 6); this.audio.slam(_a);
  }

  updateSlams(dt, player) {
    const m = this.m;
    for (let i = m.slams.length - 1; i >= 0; i--) {
      const s = m.slams[i];
      s.r += 20 * dt;
      s.mesh.scale.set(s.r, 1, s.r); s.mesh.material.opacity = clamp(1 - s.r / 24, 0, 0.8);
      const d = Math.hypot(player.pos.x - m.x, player.pos.z - m.z);
      const airborne = player.pos.y - this.world.hgt(player.pos.x, player.pos.z) > 0.45;
      if (!s.hit && Math.abs(d - s.r) < 1.3 && !airborne) { s.hit = true; if (this.onPlayerHit) this.onPlayerHit(30, 'slam'); }
      if (s.r > 24) { this.scene.remove(s.mesh); m.slams.splice(i, 1); }
    }
  }

  updateProjectiles(dt, player, alive) {
    const m = this.m;
    for (let i = this.projs.length - 1; i >= 0; i--) {
      const p = this.projs[i];
      p.t += dt;
      if (p.state === 'fly') {
        const step = p.speed * dt;
        const tip = _a.copy(p.start).addScaledVector(p.dir, p.len);
        const wallT = this.world.rayHit(tip.x, tip.y, tip.z, p.dir.x, p.dir.y, p.dir.z, step);
        let hit = false;
        if (alive) {
          _b.set(player.pos.x, player.pos.y + 0.2, player.pos.z); _c.set(player.pos.x, player.pos.y + player.eyeH, player.pos.z);
          const tp = rayCapsuleT(tip, p.dir, _b, _c, p.type === 'grab' ? 0.75 : 0.55);
          if (tp >= 0 && tp <= step && tp < wallT) hit = true;
        }
        if (hit) {
          p.len += step; p.state = p.type === 'grab' ? 'hold' : 'retract';
          if (p.type === 'grab') { m.grab = p; p.holdT = 1.7; if (this.onGrab) this.onGrab(p); if (this.onPlayerHit) this.onPlayerHit(18, 'grab'); m.act = { type: 'grabhold', dur: 99, done: true }; }
          else if (this.onPlayerHit) this.onPlayerHit(14, 'bandage');
          this.audio.impact(tip, 'flesh');
        } else if (wallT !== Infinity || p.len > p.max) { p.len += Math.min(step, wallT === Infinity ? step : wallT); p.state = 'retract'; this.fx.emit(_a.copy(p.start).addScaledVector(p.dir, p.len), 6, 0xc8b890, 1.5, 0.4, null, 5); }
        else p.len += step;
      } else if (p.state === 'hold') {
        // the bandage stays wrapped round the player, dragging them in
        this.handPos(p.start, 1);
        const tgt = _b.set(player.pos.x, player.pos.y + 1.1, player.pos.z);
        p.dir.subVectors(tgt, p.start); p.len = p.dir.length(); p.dir.normalize();
        p.holdT -= dt;
        if (p.holdT <= 0 || !alive) { p.state = 'retract'; m.grab = null; if (this.onGrab) this.onGrab(null); if (m.act && m.act.type === 'grabhold') m.act = null; }
      } else {
        p.len -= 40 * dt;
        if (p.len <= 0) { this.scene.remove(p.mesh); this.projs.splice(i, 1); continue; }
      }
      // keep the strip stretched from its start to the tip
      p.mesh.position.copy(p.start);
      p.mesh.lookAt(_d.copy(p.start).add(p.dir));
      p.mesh.scale.z = Math.max(0.05, p.len);
    }
  }

  // ---------------------------------------------------------------- animation
  place() {
    const m = this.m;
    m.root.position.set(m.x, m.y, m.z);
    m.root.rotation.y = m.yaw;
  }
  applyEyes() {
    const m = this.m;
    m.eyes.forEach((e) => e.material.color.setRGB(m.eye * 0.3, m.eye * 1.0, m.eye * 0.85));
    m.glow.material.opacity = m.eye * 0.9;
  }
  pose(dt, seated, t = 0, headUp = 0) {
    const m = this.m;
    this.applyEyes();
    if (seated) { // slumped on the throne
      m.model.position.y = -0.48; m.hips.rotation.x = 0;
      m.legL.hp.rotation.set(-1.5, 0, 0.08); m.legR.hp.rotation.set(-1.5, 0, -0.08); m.legL.kn.rotation.x = 1.5; m.legR.kn.rotation.x = 1.5;
      m.armL.sh.rotation.set(-1.25, 0, 0.1); m.armR.sh.rotation.set(-1.25, 0, -0.1); m.armL.el.rotation.x = -0.2; m.armR.el.rotation.x = -0.2;
      m.torso.rotation.set(0.25 - headUp * 0.25, 0, 0);
      m.head.rotation.set(0.75 * (1 - headUp) + Math.sin(t * 0.4) * 0.03, Math.sin(t * 0.25) * 0.05 * headUp, 0);
      this.place();
      return;
    }
    m.model.position.y = damp(m.model.position.y, 0, 4, dt);
    m.walk += dt * (1 + m.speed * 2.2);
    const A = clamp(m.speed / 1.6, 0, 1), ph = m.walk;
    // a slow, unsettling stagger
    m.legL.hp.rotation.set(Math.sin(ph) * 0.45 * A, 0, 0.04); m.legR.hp.rotation.set(-Math.sin(ph) * 0.45 * A, 0, -0.04);
    m.legL.kn.rotation.x = Math.max(0, -Math.cos(ph)) * 0.5 * A + 0.05; m.legR.kn.rotation.x = Math.max(0, Math.cos(ph)) * 0.5 * A + 0.05;
    let aL = -0.25 + Math.sin(ph) * 0.15 * A, aR = -0.25 - Math.sin(ph) * 0.15 * A, eL = -0.3, eR = -0.3, lean = 0.12, zL = 0.12, zR = -0.12;
    let headX = -0.05 + Math.sin(t * 0.9) * 0.05, headZ = Math.sin(t * 0.6) * 0.12;
    const a = m.act;
    if (a) {
      const k = clamp(m.actT / a.dur, 0, 1);
      if (a.type === 'bandage' || a.type === 'grab') { aR = lerp(-0.3, -2.0, k); eR = lerp(-0.3, -1.6, k); if (a.done) { aR = -1.4; eR = 0; } if (a.type === 'grab') { aL = aR; eL = eR; } }
      if (a.type === 'grabhold') { aR = -1.3; eR = -0.6; lean = -0.1; }
      if (a.type === 'summon') { aL = aR = lerp(-0.3, -2.9, k); zL = 0.4; zR = -0.4; headX = -0.4; }
      if (a.type === 'slam') { aL = aR = a.done ? -0.3 : lerp(-0.3, -3.0, k); lean = a.done ? 0.7 : -0.15; eL = eR = 0; }
      if (a.type === 'melee') { aR = a.done ? -0.6 : lerp(-0.4, -2.6, k); lean = a.done ? 0.4 : 0; }
      if (a.type === 'roar') { aL = aR = -1.0; zL = 0.8; zR = -0.8; headX = -0.45; lean = -0.2; }
    }
    if (m.hurtT > 0) lean -= 0.15;
    m.armL.sh.rotation.set(aL, 0, zL); m.armR.sh.rotation.set(aR, 0, zR);
    m.armL.el.rotation.x = eL; m.armR.el.rotation.x = eR;
    m.torso.rotation.set(lean, Math.sin(ph * 0.5) * 0.08 * A, 0);
    m.head.rotation.set(headX, 0, headZ);
    m.armL.strip.rotation.x = Math.sin(t * 3) * 0.3; m.armR.strip.rotation.x = Math.sin(t * 3 + 1) * 0.3;
    m.waist.forEach((s, i) => { s.rotation.x = Math.sin(t * 2.4 + i) * 0.25 * (0.4 + A); });
  }
}
function turn(a, b, max) { let d = Math.atan2(Math.sin(b - a), Math.cos(b - a)); return a + clamp(d, -max, max); }
function smoothK(k) { return k * k * (3 - 2 * k); }
