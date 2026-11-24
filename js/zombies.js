import * as THREE from '../lib/three.module.min.js';
import { clamp, lerp, damp, rand, pick, part, mergeGeos, bakeGroup, rayCapsuleT, raySphereT } from './util.js';

export const ZCFG = {
  detectRange: 26,        // metres at which an idle zombie notices the player
  meleeRange: 1.65,
  types: {
    walker:   { hp: 100,  speed: 1.5, dmg: 14, atkDur: 1.15, turn: 4.5, pitch: 1,    crawl: 0.45 },
    runner:   { hp: 70,   speed: 4.0, dmg: 9,  atkDur: 0.75, turn: 8,   pitch: 1.35, crawl: 0.8 },
    sprinter: { hp: 60,   speed: 6.3, dmg: 8,  atkDur: 0.6,  turn: 10,  pitch: 1.6,  crawl: 1.0 },
    brute:    { hp: 1000, speed: 1.1, dmg: 40, atkDur: 1.5,  turn: 3,   pitch: 0.45, crawl: 0, chase: 2.9, range: 2.7 },
  },
};

const SKIN = [0x7d8a68, 0x8a8c78, 0x6c7b62, 0x93907c, 0x74806a];
const PALE = [0xb8ab98, 0xa89c8a, 0xc2b4a0, 0x9c9282];
const SHIRT = [0x3a4a6a, 0x6a2f2f, 0x4a5a3a, 0x7a6a4a, 0x2f2f35, 0x5a3a5a, 0x805a2a, 0x8a8a8a, 0x2a4a4a, 0x703a1a];
const PANTS = [0x2a2f3f, 0x3a3226, 0x1f2a2a, 0x40402f, 0x2a2a2a, 0x2c3a52];
const HAIR = [0x1a1410, 0x3a2a1a, 0x6a5a3a, 0x8a8a84, 0x0e0e0e];

const matCache = new Map();
function mat(hex) {
  let m = matCache.get(hex);
  if (!m) { m = new THREE.MeshLambertMaterial({ color: hex, vertexColors: true, flatShading: true }); matCache.set(hex, m); }
  return m;
}
export const BAKED_MAT = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

// ---- shared geometries (pivot at the top of each limb segment) ----
let GEO = null;
function buildGeos() {
  const cyl = (rt, rb, h, seg = 6) => new THREE.CylinderGeometry(rt, rb, h, seg);
  GEO = {
    pelvis: part(cyl(0.175, 0.16, 0.22, 7)),
    torso: part(cyl(0.23, 0.17, 0.58, 7).translate(0, 0.29, 0).scale(1, 1, 0.68)),
    coat: part(cyl(0.2, 0.27, 0.32, 7).translate(0, -0.1, 0).scale(1, 1, 0.8)),
    belly: part(new THREE.IcosahedronGeometry(0.3, 1).scale(1.15, 1, 1).translate(0, 0.2, 0.16)),
    apron: mergeGeos([
      { geo: new THREE.BoxGeometry(0.46, 0.75, 0.03).translate(0, 0.05, 0.3), color: 0xffffff },
      { geo: new THREE.BoxGeometry(0.22, 0.2, 0.035).translate(0.08, 0.1, 0.302), color: 0x7a1010 },
      { geo: new THREE.BoxGeometry(0.15, 0.25, 0.035).translate(-0.1, -0.15, 0.302), color: 0x6a0c0c },
    ]),
    upperArm: part(cyl(0.065, 0.055, 0.32, 6).translate(0, -0.16, 0)),
    foreArm: mergeGeos([
      { geo: cyl(0.05, 0.04, 0.3, 6).translate(0, -0.15, 0), color: 0xffffff },
      { geo: new THREE.BoxGeometry(0.075, 0.11, 0.04).translate(0, -0.34, 0), color: 0xdddddd },
      { geo: new THREE.BoxGeometry(0.02, 0.07, 0.02).translate(0.03, -0.43, 0.005), color: 0xbbbbbb },
      { geo: new THREE.BoxGeometry(0.02, 0.07, 0.02).translate(-0.03, -0.43, 0.005), color: 0xbbbbbb },
    ]),
    stump: part(cyl(0.05, 0.05, 0.04, 6).translate(0, -0.02, 0), null, 0x6a0808),
    thigh: part(cyl(0.095, 0.07, 0.47, 6).translate(0, -0.235, 0)),
    shin: mergeGeos([
      { geo: cyl(0.07, 0.055, 0.45, 6).translate(0, -0.225, 0), color: 0xffffff },
      { geo: new THREE.BoxGeometry(0.1, 0.07, 0.22).translate(0, -0.47, 0.05), color: 0x151515 },
    ]),
    head: mergeGeos([
      { geo: cyl(0.135, 0.105, 0.27, 7).translate(0, 0.14, 0), color: 0xffffff },
      { geo: new THREE.BoxGeometry(0.045, 0.035, 0.03).translate(0.052, 0.17, 0.115), color: 0x0c0a08 },
      { geo: new THREE.BoxGeometry(0.045, 0.035, 0.03).translate(-0.052, 0.17, 0.115), color: 0x0c0a08 },
      { geo: new THREE.BoxGeometry(0.1, 0.03, 0.03).translate(0, 0.06, 0.1), color: 0x2a0808 },
      { geo: new THREE.BoxGeometry(0.035, 0.06, 0.04).translate(0, 0.115, 0.125), color: 0xcccccc },
    ]),
    sack: mergeGeos([
      { geo: cyl(0.16, 0.15, 0.34, 7).translate(0, 0.15, 0), color: 0xffffff },
      { geo: new THREE.ConeGeometry(0.16, 0.1, 7).translate(0, 0.37, 0), color: 0xeeeeee },
      { geo: new THREE.BoxGeometry(0.05, 0.04, 0.03).translate(0.06, 0.19, 0.145), color: 0x050505 },
      { geo: new THREE.BoxGeometry(0.05, 0.04, 0.03).translate(-0.06, 0.19, 0.145), color: 0x050505 },
      { geo: cyl(0.165, 0.165, 0.04, 7).translate(0, 0.03, 0), color: 0x4a3a20 },
    ]),
    hair: part(cyl(0.142, 0.14, 0.12, 7).translate(0, 0.25, -0.01)),
    hat: mergeGeos([
      { geo: cyl(0.15, 0.15, 0.13, 8).translate(0, 0.3, 0), color: 0xffffff },
      { geo: cyl(0.22, 0.22, 0.02, 8).translate(0, 0.24, 0), color: 0xdddddd },
    ]),
    patch: part(new THREE.BoxGeometry(0.2, 0.2, 0.02).translate(0, 0.3, 0.115), null, 0xffffff),
    machete: mergeGeos([
      { geo: new THREE.BoxGeometry(0.035, 0.035, 0.14).translate(0, -0.42, 0.03), color: 0x2a1a10 },
      { geo: new THREE.BoxGeometry(0.012, 0.075, 0.58).translate(0, -0.41, 0.38), color: 0x9aa0a8 },
      { geo: new THREE.BoxGeometry(0.013, 0.03, 0.2).translate(0, -0.39, 0.45), color: 0x6a1010 },
    ]),
  };
}

function mesh(g, m, shadow) {
  const o = new THREE.Mesh(g, m);
  o.castShadow = shadow;
  return o;
}

/** Build an articulated humanoid. type: walker|runner|sprinter|brute|civil */
export function buildModel(type, shadow) {
  if (!GEO) buildGeos();
  const brute = type === 'brute', civil = type === 'civil';
  const skin = mat(brute ? 0x8c8a7a : civil ? pick(PALE) : pick(SKIN));
  const shirt = mat(brute ? 0x3a3530 : pick(SHIRT)), pants = mat(brute ? 0x2a2620 : pick(PANTS));
  const root = new THREE.Group();
  const model = new THREE.Group();
  root.add(model);
  const hips = new THREE.Group(); hips.position.y = 0.96; model.add(hips);
  hips.add(mesh(GEO.pelvis, pants, shadow));
  const torso = new THREE.Group(); torso.position.y = 0.08; hips.add(torso);
  const tm = mesh(GEO.torso, shirt, shadow); torso.add(tm);
  if (brute) {
    tm.scale.set(1.55, 1.08, 1.7);
    torso.add(mesh(GEO.belly, skin, shadow));
    torso.add(mesh(GEO.apron, mat(0x8f8676), shadow));
  } else {
    if (Math.random() < 0.3) hips.add(mesh(GEO.coat, shirt, shadow));
    if (Math.random() < 0.4) torso.add(mesh(GEO.patch, mat(0x5a0d0d), false));
  }
  const headP = new THREE.Group(); headP.position.y = brute ? 0.62 : 0.6; torso.add(headP);
  if (brute) headP.add(mesh(GEO.sack, mat(0x7a6a4a), shadow));
  else {
    headP.add(mesh(GEO.head, skin, shadow));
    const r = Math.random();
    if (r < 0.45) headP.add(mesh(GEO.hair, mat(pick(HAIR)), false));
    else if (r < 0.6) headP.add(mesh(GEO.hat, mat(pick(SHIRT)), false));
  }
  const limbS = brute ? 1.6 : 1;
  const mkArm = (side) => {
    const sh = new THREE.Group(); sh.position.set(side * (brute ? 0.4 : 0.285), 0.5, 0); torso.add(sh);
    const ua = mesh(GEO.upperArm, shirt, shadow); ua.scale.set(limbS, 1, limbS); sh.add(ua);
    const el = new THREE.Group(); el.position.y = -0.32; sh.add(el);
    const fa = mesh(GEO.foreArm, skin, shadow); fa.scale.set(limbS, 1, limbS); el.add(fa);
    const stump = mesh(GEO.stump, mat(0xffffff), false); stump.position.y = -0.32; stump.visible = false; sh.add(stump);
    return { sh, el, stump };
  };
  const mkLeg = (side) => {
    const hp = new THREE.Group(); hp.position.set(side * (brute ? 0.15 : 0.105), -0.05, 0); hips.add(hp);
    const th = mesh(GEO.thigh, pants, shadow); th.scale.set(limbS * 0.95, 1, limbS * 0.95); hp.add(th);
    const kn = new THREE.Group(); kn.position.y = -0.47; hp.add(kn);
    const sm = mesh(GEO.shin, pants, shadow); sm.scale.set(limbS * 0.9, 1, limbS * 0.9); kn.add(sm);
    const stump = mesh(GEO.stump, mat(0xffffff), false); stump.position.y = -0.47; stump.scale.set(1.6, 1, 1.6); stump.visible = false; hp.add(stump);
    return { hp, kn, stump };
  };
  const armL = mkArm(-1), armR = mkArm(1), legL = mkLeg(-1), legR = mkLeg(1);
  if (brute) armR.el.add(mesh(GEO.machete, mat(0xffffff), shadow));
  let s;
  if (brute) { s = 1.5; root.scale.setScalar(s); }
  else if (type === 'runner' || type === 'sprinter') { s = rand(0.93, 1.0); root.scale.set(s * (type === 'sprinter' ? 0.86 : 0.93), s, s * 0.95); }
  else { s = rand(0.97, 1.1); root.scale.set(s * rand(0.95, 1.12), s, s); }
  return { root, model, hips, torso, headP, armL, armR, legL, legR, s };
}

function poseDead(p, k, fallDir, sp) {
  p.model.rotation.set(fallDir * (Math.PI / 2) * 0.96 * k, 0, 0);
  p.model.position.y = 0.14 * k;
  p.model.position.z = -fallDir * 0.3 * k;
  p.armL.sh.rotation.set(lerp(-1.2, sp[0] - 0.2, k), 0, lerp(0.08, 0.9, k));
  p.armR.sh.rotation.set(lerp(-1.2, sp[1] - 0.2, k), 0, lerp(-0.08, -0.9, k));
  p.armL.el.rotation.x = -0.3 * (1 - k); p.armR.el.rotation.x = -0.3 * (1 - k);
  p.legL.hp.rotation.set(sp[0] * 0.4, 0, 0.12 * k); p.legR.hp.rotation.set(sp[1] * 0.4, 0, -0.12 * k);
  p.legL.kn.rotation.x = 0.1; p.legR.kn.rotation.x = 0.1;
  p.torso.rotation.set(0.05, 0, 0);
  p.headP.rotation.set(-0.3 * k, 0, sp[2] * k);
}

/** Static corpse baked into a single mesh (1 draw call). */
export function makeCorpse() {
  const p = buildModel(Math.random() < 0.2 ? 'civil' : 'walker', false);
  poseDead(p, 1, Math.random() < 0.6 ? -1 : 1, [rand(-0.8, 0.8), rand(-0.8, 0.8), rand(-0.6, 0.6)]);
  if (Math.random() < 0.3) p.armL.el.visible = false;
  if (Math.random() < 0.2) p.legR.kn.visible = false;
  p.root.scale.setScalar(1);
  const m = new THREE.Mesh(bakeGroup(p.root), BAKED_MAT);
  m.castShadow = false; m.receiveShadow = true; m.userData.own = true;
  return m;
}

/** Hanged body: origin at the rope's top, hanging downward. */
export function makeHangedBody(ropeLen) {
  const p = buildModel('civil', false);
  p.armL.sh.rotation.set(0.08, 0, 0.06); p.armR.sh.rotation.set(0.05, 0, -0.06);
  p.armL.el.rotation.x = -0.1; p.armR.el.rotation.x = -0.05;
  p.legL.hp.rotation.set(0.05, 0, 0.03); p.legR.hp.rotation.set(-0.03, 0, -0.04);
  p.legL.kn.rotation.x = 0.08; p.legR.kn.rotation.x = 0.04;
  p.headP.rotation.set(0.35, 0, 0.55);
  p.root.scale.setScalar(1);
  const geo = bakeGroup(p.root);
  geo.translate(0, -1.78 - ropeLen, 0);
  const rope = mergeGeos([{ geo: new THREE.CylinderGeometry(0.012, 0.012, ropeLen, 4).translate(0, -ropeLen / 2, 0), color: 0x5a4a30 },
    { geo: new THREE.TorusGeometry(0.075, 0.015, 4, 8).rotateX(Math.PI / 2).translate(0, -ropeLen - 0.12, 0.0), color: 0x5a4a30 }]);
  const g = new THREE.Group();
  const body = new THREE.Mesh(geo, BAKED_MAT); body.userData.own = true; body.castShadow = true;
  const r = new THREE.Mesh(rope, BAKED_MAT); r.userData.own = true;
  g.add(body, r);
  return g;
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

export class Zombies {
  constructor(scene, world, audio, fx) {
    this.scene = scene; this.world = world; this.audio = audio; this.fx = fx;
    this.list = [];
    this.shadows = false;
    this.farDist = 110;
    this.onKill = null;
    this.out = { x: 0, z: 0 };
    this.hpMul = 1; this.spdMul = 1;
  }

  setShadows(on) {
    this.shadows = on;
    for (const z of this.list) z.parts.root.traverse((o) => { if (o.isMesh) o.castShadow = on; });
  }

  count(tag) { let n = 0; for (const z of this.list) if (!z.dead && (!tag || z.tag === tag)) n++; return n; }
  aliveCount() { return this.count('wave'); }
  boss() { return this.list.find((z) => z.type === 'brute' && !z.dead); }

  spawn(type, x, z, tag = 'wave') {
    if (type === true) type = 'runner'; else if (type === false) type = 'walker';
    const cfg = ZCFG.types[type];
    const parts = buildModel(type, this.shadows && type !== 'brute' ? this.shadows : type === 'brute');
    const mul = type === 'brute' ? 1 : this.hpMul;
    const e = {
      type, cfg, tag, runner: type === 'runner' || type === 'sprinter', brute: type === 'brute', parts, x, z, y: this.world.hgt(x, z), yaw: Math.random() * 6.28,
      hp: cfg.hp * mul, maxHp: cfg.hp * mul,
      speedMul: (type === 'brute' ? 1 : this.spdMul) * rand(0.9, 1.1),
      state: 'idle', idleT: rand(0.5, 3), aiT: Math.random() * 0.3, growlT: rand(1, 6),
      tx: x, tz: z, wanderT: 0, invT: 0, loseT: 0,
      phase: Math.random() * 6, curSpeed: 0, attackT: 0, hitDone: false,
      hurtT: 0, deadT: 0, dead: false, fallDir: Math.random() < 0.75 ? -1 : 1, removeAfter: 14,
      lastX: x, lastZ: z, stuck: 0, strafeT: 0, strafeDir: 1, avoidSide: Math.random() < 0.5 ? -1 : 1,
      armBias: rand(-0.2, 0.2), headTilt: rand(-0.25, 0.25),
      crawl: false, armsLost: 0, home: null, homeR: 0, riseT: 0,
      splay: [rand(-0.6, 0.6), rand(-0.6, 0.6), rand(-0.5, 0.5)],
      pos: new THREE.Vector3(x, 1, z),
    };
    e.parts.root.position.set(x, e.y, z);
    this.scene.add(e.parts.root);
    this.list.push(e);
    return e;
  }

  /** a zombie lying among the corpses that gets up when the player comes close */
  spawnDormant(x, z, tag) {
    const e = this.spawn(Math.random() < 0.3 ? 'runner' : 'walker', x, z, tag);
    e.state = 'dormant'; e.fallDir = -1;
    poseDead(e.parts, 1, -1, e.splay);
    e.parts.root.rotation.y = e.yaw;
    return e;
  }

  remove(e) { this.scene.remove(e.parts.root); const i = this.list.indexOf(e); if (i >= 0) this.list.splice(i, 1); }
  clear() { for (const z of this.list) this.scene.remove(z.parts.root); this.list.length = 0; }

  /** a loud noise: zombies within radius come to investigate (closer ones charge) */
  alert(x, z, radius) {
    for (const e of this.list) {
      if (e.dead || e.state === 'chase' || e.state === 'attack' || e.state === 'rising') continue;
      const d = Math.hypot(e.x - x, e.z - z);
      if (d > radius) continue;
      if (e.state === 'dormant') { if (d < radius * 0.35) this.rise(e); continue; }
      if (d < Math.min(18, radius * 0.3)) { this.aggro(e); continue; }
      e.state = 'investigate'; e.tx = x + rand(-4, 4); e.tz = z + rand(-4, 4); e.invT = 14;
    }
  }
  aggro(e) {
    if (e.state === 'chase' || e.state === 'attack') return;
    if (e.state === 'dormant') { this.rise(e); return; }
    if (e.state === 'rising') return;
    e.state = 'chase'; e.loseT = 0;
    e.growlT = Math.min(e.growlT, rand(0.1, 0.7));
  }
  rise(e) {
    if (e.state !== 'dormant') return;
    e.state = 'rising'; e.riseT = 0;
    e.pos.set(e.x, e.y + 0.5, e.z); this.audio.growl(e.pos, { pitch: 0.8, dur: 1.4, gain: 0.6 });
  }

  /** returns {killed, broke} ; zone: head|body|armL|armR|legL|legR */
  damage(e, amount, zone = 'body') {
    if (e.dead) return { killed: false };
    let broke = null;
    if (zone === 'head') amount = e.brute ? amount * 3 : 1e6;   // headshot = instant kill (boss takes x3)
    else if (zone !== 'body') {
      amount *= 0.6;
      if (!e.brute) {
        const limb = e.parts[zone];
        if (zone.startsWith('arm') && limb.el.visible) { limb.el.visible = false; limb.stump.visible = true; e.armsLost++; broke = zone; }
        if (zone.startsWith('leg') && limb.kn.visible) { limb.kn.visible = false; limb.stump.visible = true; e.crawl = true; broke = zone; }
        if (broke) { _a.set(e.x, e.y + 0.8, e.z); this.fx.emit(_a, 22, 0x7a0c0c, 3.5, 0.7, null, 9); this.world.addBlood(e.x, e.z); }
      }
    }
    e.hp -= amount;
    if (e.state === 'dormant') this.rise(e); else this.aggro(e);
    if (e.hp <= 0) {
      e.dead = true; e.state = 'dead'; e.deadT = 0;
      e.removeAfter = 12 + Math.random() * 4;
      e.pos.set(e.x, e.y + 0.3, e.z);
      if (e.crawl) e.fallDir = 1;
      this.audio.zDie(e.pos, e.brute);
      if (this.onKill) this.onKill(e, zone);
      const corpses = this.list.filter((z) => z.dead);
      if (corpses.length > 10) corpses[0].removeAfter = 0;
      return { killed: true, broke };
    }
    e.hurtT = e.brute ? 0.15 : 0.35;
    e.pos.set(e.x, e.y + 1.4, e.z);
    if (Math.random() < 0.5) this.audio.zHurt(e.pos);
    if (e.state === 'attack' && !e.brute) { e.attackT = 0; e.hitDone = false; }
    return { killed: false, broke };
  }

  /** nearest zombie hit by ray (o,d Vector3s, d unit). returns {z,t,zone} or null */
  rayHit(o, d, maxT) {
    let best = null;
    for (const e of this.list) {
      if (e.dead || !e.parts.root.visible) continue;
      const S = e.parts.root.scale.y;
      // broad phase
      const cx = e.x - o.x, cy = e.y + 0.9 * S - o.y, cz = e.z - o.z;
      const tp = cx * d.x + cy * d.y + cz * d.z;
      if (tp < -2.5 || tp > maxT + 2.5) continue;
      if (cx * cx + cy * cy + cz * cz - tp * tp > (2.3 * S) * (2.3 * S)) continue;
      const P = e.parts;
      let bt = Infinity, zone = null;
      const test = (t, z) => { if (t >= 0 && t < bt) { bt = t; zone = z; } };
      P.headP.localToWorld(_a.set(0, 0.15, 0));
      test(raySphereT(o.x, o.y, o.z, d.x, d.y, d.z, _a.x, _a.y, _a.z, (e.brute ? 0.2 : 0.165) * S), 'head');
      P.hips.localToWorld(_a.set(0, 0, 0)); P.torso.localToWorld(_b.set(0, 0.52, 0));
      test(rayCapsuleT(o, d, _a, _b, (e.brute ? 0.4 : 0.21) * S), 'body');
      for (const side of ['armL', 'armR']) {
        const L = P[side];
        L.sh.localToWorld(_a.set(0, 0, 0)); L.el.localToWorld(_b.set(0, 0, 0));
        test(rayCapsuleT(o, d, _a, _b, 0.075 * S * (e.brute ? 1.5 : 1)), side);
        if (L.el.visible) { L.el.localToWorld(_c.set(0, -0.42, 0)); test(rayCapsuleT(o, d, _b, _c, 0.07 * S * (e.brute ? 1.5 : 1)), side); }
      }
      for (const side of ['legL', 'legR']) {
        const L = P[side];
        L.hp.localToWorld(_a.set(0, 0, 0)); L.kn.localToWorld(_b.set(0, 0, 0));
        test(rayCapsuleT(o, d, _a, _b, 0.095 * S * (e.brute ? 1.4 : 1)), side);
        if (L.kn.visible) { L.kn.localToWorld(_c.set(0, -0.47, 0)); test(rayCapsuleT(o, d, _b, _c, 0.08 * S * (e.brute ? 1.4 : 1)), side); }
      }
      if (zone && bt < maxT && (!best || bt < best.t)) best = { z: e, t: bt, zone };
    }
    return best;
  }

  // -------------------------------------------------------------- update
  update(dt, ctx, time) {
    const { px, pz } = ctx;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      const dx = px - e.x, dz = pz - e.z, d = Math.hypot(dx, dz);
      e.dist = d;
      const vis = d < this.farDist + 10;
      e.parts.root.visible = vis;
      if (e.dead) {
        e.deadT += dt;
        if (e.deadT > e.removeAfter || (e.deadT > 3 && d > 70)) { this.scene.remove(e.parts.root); this.list.splice(i, 1); continue; }
        if (vis) poseDead(e.parts, clamp(e.deadT / 0.9, 0, 1) ** 2, e.fallDir, e.splay);
        continue;
      }
      if (e.state === 'dormant') {
        if (ctx.playerAlive && d < 8.5) this.rise(e);
        continue;
      }
      if (e.state === 'rising') {
        e.riseT += dt;
        const k = 1 - clamp(e.riseT / 1.6, 0, 1);
        poseDead(e.parts, k * k, -1, e.splay);
        e.yaw = damp(e.yaw, Math.atan2(dx, dz), 3, dt); e.parts.root.rotation.y = e.yaw;
        if (e.riseT > 1.6) { e.state = 'chase'; e.parts.model.position.set(0, 0, 0); }
        continue;
      }
      e.aiT -= dt;
      if (e.aiT <= 0) { e.aiT = 0.22 + Math.random() * 0.12; this.think(e, ctx, d); }
      this.move(e, dt, ctx, d);
      if (vis) this.animate(e, dt, time);
      e.growlT -= dt;
      if (e.growlT <= 0) {
        e.growlT = e.state === 'chase' || e.state === 'attack' ? rand(2.5, 5) : rand(6, 13);
        if (d < 65) {
          e.pos.set(e.x, e.y + 1.5, e.z);
          this.audio.growl(e.pos, { pitch: e.cfg.pitch, gain: e.brute ? 0.8 : e.state === 'chase' ? 0.55 : 0.4, dur: e.brute ? 1.9 : e.runner ? 0.8 : 1.2 });
        }
      }
    }
  }

  think(e, ctx, d) {
    const alive = ctx.playerAlive;
    const detect = ZCFG.detectRange * (e.runner ? 1.15 : e.brute ? 1.2 : 1) * ctx.detectMul;
    if (!alive) { if (e.state === 'chase' || e.state === 'attack') { e.state = 'idle'; e.idleT = 2; } return; }
    switch (e.state) {
      case 'idle': case 'wander': case 'investigate':
        if (d < detect) this.aggro(e);
        break;
      case 'chase':
        if (d > detect * 2.2) { e.loseT += 0.25; if (e.loseT > 5) { e.state = 'wander'; this.pickWander(e); } } else e.loseT = 0;
        // the butcher does not stray far from his village
        if (e.home && Math.hypot(ctx.px - e.home.x, ctx.pz - e.home.z) > e.homeR * 2.2) { e.state = 'wander'; this.pickWander(e); }
        break;
    }
    if (e.state === 'investigate') { e.invT -= 0.25; if (e.invT <= 0) { e.state = 'wander'; this.pickWander(e); } }
    if (e.state === 'chase' || e.state === 'wander' || e.state === 'investigate') {
      const moved = Math.hypot(e.x - e.lastX, e.z - e.lastZ);
      if (moved < 0.12 * e.cfg.speed * 0.5 && e.curSpeed > 0.2) {
        if (++e.stuck >= 3) { e.avoidSide *= -1; e.strafeT = 1.0 + Math.random(); e.strafeDir = Math.random() < 0.5 ? -1 : 1; e.stuck = 0; if (e.state === 'wander') this.pickWander(e); }
      } else e.stuck = 0;
    }
    e.lastX = e.x; e.lastZ = e.z;
  }

  pickWander(e) {
    const lim = 480;
    if (e.home) {
      const a = Math.random() * 6.28, r = Math.random() * e.homeR;
      e.tx = e.home.x + Math.cos(a) * r; e.tz = e.home.z + Math.sin(a) * r;
    } else {
      const a = Math.random() * 6.28, r = rand(6, 18);
      e.tx = clamp(e.x + Math.cos(a) * r, -lim, lim); e.tz = clamp(e.z + Math.sin(a) * r, -lim, lim);
    }
    e.wanderT = rand(6, 12);
  }

  move(e, dt, ctx, d) {
    const W = this.world;
    let base = e.cfg.speed * e.speedMul;
    if (e.crawl) base = e.cfg.crawl * e.speedMul;
    const range = (e.cfg.range || ZCFG.meleeRange) + (e.crawl ? 0.5 : 0);
    let tx = e.tx, tz = e.tz, speed = 0, faceP = false;
    switch (e.state) {
      case 'idle':
        e.idleT -= dt;
        if (e.idleT <= 0) { e.state = 'wander'; this.pickWander(e); }
        break;
      case 'wander':
        speed = base * 0.45; e.wanderT -= dt;
        if (Math.hypot(tx - e.x, tz - e.z) < 1.5 || e.wanderT <= 0) { e.state = 'idle'; e.idleT = rand(1.5, 5); }
        break;
      case 'investigate':
        speed = base * (e.runner ? 0.65 : 0.85);
        if (Math.hypot(tx - e.x, tz - e.z) < 2.5) { e.state = 'idle'; e.idleT = rand(2, 4); }
        break;
      case 'chase':
        tx = ctx.px; tz = ctx.pz; speed = d > range - 0.5 ? (e.brute ? e.cfg.chase : base) : 0; faceP = d < 6;
        if (d < range && ctx.playerAlive) { e.state = 'attack'; e.attackT = 0; e.hitDone = false; e.cry = false; }
        break;
      case 'attack': {
        faceP = true;
        if (!ctx.playerAlive || d > range + 0.55) { e.state = ctx.playerAlive ? 'chase' : 'idle'; e.idleT = 2; e.attackT = 0; break; }
        const dur = e.cfg.atkDur;
        e.attackT += dt;
        if (!e.cry && e.attackT > dur * 0.2) {
          e.cry = true; e.pos.set(e.x, e.y + 1.4, e.z);
          if (e.brute) this.audio.machete(e.pos); else this.audio.zAttack(e.pos);
        }
        if (!e.hitDone && e.attackT > dur * 0.6) {
          e.hitDone = true;
          let dmg = e.cfg.dmg * (e.brute ? 1 : 1 + (this.hpMul - 1) * 0.5);
          if (e.crawl) dmg *= 0.6;
          if (e.armsLost >= 2) dmg *= 0.5; else if (e.armsLost === 1) dmg *= 0.75;
          if (d < range + 0.4 && ctx.onHit) ctx.onHit(dmg, e);
        }
        if (e.attackT >= dur + 0.25) { e.attackT = 0; e.hitDone = false; e.cry = false; }
        break;
      }
    }
    let dirx = 0, dirz = 0;
    if (speed > 0) {
      dirx = tx - e.x; dirz = tz - e.z;
      const l = Math.hypot(dirx, dirz) || 1; dirx /= l; dirz /= l;
      W.steer(e.x, e.z, dirx, dirz, e.avoidSide, this.out);
      dirx += this.out.x * 1.5; dirz += this.out.z * 1.5;
      if (e.strafeT > 0) { e.strafeT -= dt; const c = Math.cos(1.2 * e.strafeDir), s = Math.sin(1.2 * e.strafeDir); const rx = dirx * c - dirz * s, rz = dirx * s + dirz * c; dirx = rx; dirz = rz; }
      const l2 = Math.hypot(dirx, dirz) || 1; dirx /= l2; dirz /= l2;
    }
    const slow = (e.hurtT > 0 ? 0.3 : 1) * (e.y < -0.3 ? 0.6 : 1);
    const step = speed * slow * dt;
    e.x += dirx * step; e.z += dirz * step;
    const rad = e.brute ? 0.7 : 0.45;
    for (const o of this.list) {
      if (o === e || o.dead || o.state === 'dormant') continue;
      const rr = rad + (o.brute ? 0.7 : 0.45);
      const ox = e.x - o.x, oz = e.z - o.z, dd = ox * ox + oz * oz;
      if (dd < rr * rr && dd > 1e-6) { const dl = Math.sqrt(dd), push = (rr - dl) * 0.5; e.x += ox / dl * push; e.z += oz / dl * push; }
    }
    const keep = e.brute ? 1.3 : 0.85;
    if (ctx.playerAlive && d < keep) { const px = e.x - ctx.px, pz = e.z - ctx.pz, l = Math.hypot(px, pz) || 1; e.x += px / l * (keep - d); e.z += pz / l * (keep - d); }
    W.resolve(e, e.brute ? 0.6 : 0.38);
    e.y = W.hgt(e.x, e.z);
    e.curSpeed = damp(e.curSpeed, speed * slow, 8, dt);
    let target = e.yaw;
    if (faceP) target = Math.atan2(ctx.px - e.x, ctx.pz - e.z);
    else if (speed > 0) target = Math.atan2(dirx, dirz);
    let diff = target - e.yaw; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    e.yaw += clamp(diff, -e.cfg.turn * dt, e.cfg.turn * dt);
    const root = e.parts.root;
    root.position.set(e.x, e.y, e.z);
    root.rotation.y = e.yaw;
    if (e.hurtT > 0) e.hurtT -= dt;
  }

  // -------------------------------------------------------------- animation
  animate(e, dt, time) {
    const p = e.parts, ref = e.crawl ? e.cfg.crawl : e.cfg.speed * 0.9;
    const A = clamp(e.curSpeed / Math.max(0.1, ref), 0, 1.15);
    const prev = e.phase;
    e.phase += dt * (e.curSpeed > 0.1 ? 2.4 + e.curSpeed * (e.crawl ? 4 : e.runner ? 1.9 : 2.6) : 1.1);
    if (e.curSpeed > 0.3 && e.dist < 32 && Math.floor(e.phase / Math.PI) !== Math.floor(prev / Math.PI)) {
      e.pos.set(e.x, e.y + 0.1, e.z); this.audio.zStep(e.pos, e.brute);
    }
    const ph = e.phase;
    if (e.crawl) { // dragging itself along the ground
      p.model.rotation.set(1.38, 0, Math.sin(ph) * 0.06);
      p.model.position.set(0, 0.22, -0.9);
      p.armL.sh.rotation.set(-2.7 + Math.sin(ph) * 0.55 * A, 0, 0.25); p.armR.sh.rotation.set(-2.7 - Math.sin(ph) * 0.55 * A, 0, -0.25);
      p.armL.el.rotation.x = -0.4 - Math.max(0, Math.cos(ph)) * 0.6 * A; p.armR.el.rotation.x = -0.4 - Math.max(0, -Math.cos(ph)) * 0.6 * A;
      p.legL.hp.rotation.set(0.1, 0, 0.15); p.legR.hp.rotation.set(0.05, 0, -0.15);
      p.legL.kn.rotation.x = 0.2; p.legR.kn.rotation.x = 0.3;
      p.torso.rotation.set(0, Math.sin(ph) * 0.12, 0);
      p.headP.rotation.set(-0.9, 0, e.headTilt);
      p.hips.position.y = 0.96;
      return;
    }
    const legAmp = (e.runner ? (e.type === 'sprinter' ? 1.1 : 0.95) : 0.55) * A;
    p.legL.hp.rotation.x = Math.sin(ph) * legAmp;
    p.legR.hp.rotation.x = -Math.sin(ph) * legAmp;
    p.legL.hp.rotation.z = 0; p.legR.hp.rotation.z = 0;
    p.legL.kn.rotation.x = Math.max(0, -Math.cos(ph)) * legAmp * 1.15 + 0.04;
    p.legR.kn.rotation.x = Math.max(0, Math.cos(ph)) * legAmp * 1.15 + 0.04;
    p.hips.position.y = 0.96 + Math.abs(Math.cos(ph)) * (e.runner ? 0.06 : 0.03) * A - (e.runner ? 0.05 : 0);

    let aL, aR, eL, eR, lean;
    const idle = A < 0.05;
    if (e.brute) {
      aL = -0.15 + Math.sin(ph) * 0.25 * A; aR = -0.35 - Math.sin(ph) * 0.2 * A; eL = -0.2; eR = -0.5;
      lean = 0.12;
    } else if (e.runner) {
      aL = -0.65 + Math.sin(ph) * 0.95 * A; aR = -0.65 - Math.sin(ph) * 0.95 * A; eL = -1.0; eR = -1.0;
      lean = 0.1 + (e.type === 'sprinter' ? 0.5 : 0.38) * A;
    } else {
      const sway = Math.sin(time * 1.3 + e.armBias * 9) * 0.06;
      aL = -1.35 + e.armBias + Math.sin(ph) * 0.1 * A + sway; aR = -1.2 - e.armBias - Math.sin(ph) * 0.1 * A - sway;
      eL = -0.3; eR = -0.45;
      lean = 0.1 + 0.08 * A;
      if (idle) { aL = -0.45 + sway; aR = -0.35 - sway; eL = -0.2; eR = -0.25; }
    }
    let torsoY = Math.sin(ph) * 0.14 * A, torsoZ = Math.sin(ph * 0.5) * (e.runner ? 0.03 : 0.07) * (0.4 + A);
    if (e.state === 'attack') {
      const pr = clamp(e.attackT / e.cfg.atkDur, 0, 1.2);
      let a;
      if (pr < 0.45) a = lerp(-1.4, -2.7, pr / 0.45); else if (pr < 0.65) a = lerp(-2.7, -0.4, (pr - 0.45) / 0.2); else a = lerp(-0.4, -1.2, clamp((pr - 0.65) / 0.4, 0, 1));
      if (e.brute) { aR = a; eR = -0.2; } else { aL = aR = a; eL = eR = -0.3; }
      lean = pr < 0.45 ? lerp(0.1, -0.15, pr / 0.45) : (pr < 0.65 ? 0.55 : 0.2);
      torsoY = e.brute ? -0.3 * Math.sin(pr * Math.PI) : 0;
    }
    if (e.hurtT > 0) lean -= (e.hurtT / 0.35) * (e.brute ? 0.15 : 0.55);
    p.armL.sh.rotation.set(aL, 0, 0.08); p.armR.sh.rotation.set(aR, 0, -0.08);
    p.armL.el.rotation.x = eL; p.armR.el.rotation.x = eR;
    p.torso.rotation.set(lean, torsoY, torsoZ);
    p.headP.rotation.set(-0.12 - (e.hurtT > 0 ? e.hurtT * 0.8 : 0), -torsoY * 0.6, e.headTilt + Math.sin(time * 0.7 + e.armBias * 5) * 0.06);
    p.model.position.set(0, 0, 0); p.model.rotation.set(0, 0, 0);
  }
}
