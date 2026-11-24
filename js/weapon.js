import * as THREE from '../lib/three.module.min.js';
import { clamp, lerp, damp } from './util.js';

// gameplay stats for the three guns
export const GUNS = [
  { id: 'rifle', name: 'AK RIFLE', key: '1', mag: 30, reserve: 120, dmg: 35, rate: 0.1, auto: true, reload: 2.0, spreadHip: 0.014, spreadAds: 0.0025,
    recoil: 0.012, adsFov: 52, loud: 70, hip: [0.15, -0.17, -0.5], ads: [0, -0.071, -0.26], scale: 0.85, muzzle: -0.86, ammoBox: 30 },
  { id: 'glock', name: 'GLOCK 17', key: '2', mag: 17, reserve: 51, dmg: 26, rate: 0.12, auto: false, reload: 1.5, spreadHip: 0.011, spreadAds: 0.003,
    recoil: 0.02, adsFov: 60, loud: 40, hip: [0.13, -0.15, -0.36], ads: [0, -0.037, -0.3], scale: 1, muzzle: -0.16, ammoBox: 17 },
  { id: 'sniper', name: 'SNIPER', key: '3', mag: 5, reserve: 15, dmg: 140, rate: 1.25, auto: false, reload: 3.0, spreadHip: 0.05, spreadAds: 0,
    recoil: 0.05, adsFov: 13, loud: 120, hip: [0.16, -0.18, -0.48], ads: [0, -0.06, -0.22], scale: 0.9, muzzle: -0.86, scope: true, ammoBox: 5 },
];
export const RANGE = 220;

function flashTex() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 2, 64, 64, 60);
  gr.addColorStop(0, 'rgba(255,255,230,1)'); gr.addColorStop(0.25, 'rgba(255,210,110,0.9)'); gr.addColorStop(1, 'rgba(255,120,20,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  g.translate(64, 64); g.fillStyle = 'rgba(255,230,160,0.85)';
  for (let i = 0; i < 6; i++) { g.rotate(Math.PI / 3); g.beginPath(); g.moveTo(0, -3); g.lineTo(62, 0); g.lineTo(0, 3); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

const M = (c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
const MAT = { dark: M(0x34383e), darker: M(0x1c1e21), wood: M(0x8a5a30), glove: M(0x1f1f20), sleeve: M(0x4a5238), poly: M(0x222427), olive: M(0x3a4430), magw: M(0x3b2f25), glass: new THREE.MeshBasicMaterial({ color: 0x0a1a2a }) };
const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const C = (r, l, s = 8, r2 = r) => new THREE.CylinderGeometry(r, r2, l, s);
function adder(g) {
  return (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0, parent = g) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); parent.add(m); return m;
  };
}

function buildRifle() {
  const g = new THREE.Group(), add = adder(g), { dark, darker, wood, glove, sleeve, magw } = MAT;
  add(B(0.052, 0.078, 0.36), dark, 0, 0, -0.03);
  add(B(0.046, 0.022, 0.32), darker, 0, 0.045, -0.04);
  add(B(0.058, 0.05, 0.24), wood, 0, -0.012, -0.32);
  add(B(0.05, 0.03, 0.22), wood, 0, 0.032, -0.33);
  add(C(0.009, 0.26), darker, 0, 0.056, -0.42, Math.PI / 2);
  add(C(0.012, 0.46), darker, 0, 0, -0.56, Math.PI / 2);
  add(C(0.017, 0.06), darker, 0, 0, -0.8, Math.PI / 2);
  add(B(0.014, 0.034, 0.018), darker, 0, 0.065, -0.72);
  add(B(0.004, 0.022, 0.004), darker, 0, 0.083, -0.72);
  add(B(0.03, 0.016, 0.05), darker, 0, 0.062, -0.13);
  add(B(0.004, 0.02, 0.004), darker, 0.008, 0.078, -0.13);
  add(B(0.004, 0.02, 0.004), darker, -0.008, 0.078, -0.13);
  add(B(0.042, 0.105, 0.05), wood, 0, -0.09, 0.12, -0.35);
  add(B(0.046, 0.09, 0.27), wood, 0, -0.03, 0.31, 0.07);
  add(B(0.05, 0.11, 0.02), darker, 0, -0.04, 0.45, 0.07);
  add(B(0.046, 0.03, 0.1), dark, 0, -0.055, 0);
  const mag = new THREE.Group(); mag.position.set(0, -0.04, -0.08); g.add(mag);
  add(B(0.04, 0.19, 0.06), magw, 0, -0.095, 0, 0.22, 0, 0, mag);
  add(B(0.042, 0.02, 0.062), darker, 0, -0.005, 0, 0, 0, 0, mag);
  add(B(0.062, 0.07, 0.1), glove, 0, -0.105, 0.1);
  add(B(0.058, 0.058, 0.32), sleeve, 0.06, -0.15, 0.28, 0.05, -0.18, 0);
  add(B(0.075, 0.06, 0.12), glove, 0, -0.068, -0.32);
  add(B(0.06, 0.06, 0.4), sleeve, -0.075, -0.1, -0.1, 0, -0.3, 0);
  return { group: g, magMesh: mag, magY: -0.04 };
}
function buildGlock() {
  const g = new THREE.Group(), add = adder(g), { darker, glove, sleeve, poly } = MAT;
  add(B(0.028, 0.03, 0.185), darker, 0, 0.016, -0.055);        // slide
  for (let i = 0; i < 5; i++) add(B(0.029, 0.022, 0.004), MAT.dark, 0, 0.016, 0.0 + i * 0.008); // serrations
  add(B(0.026, 0.022, 0.16), poly, 0, -0.009, -0.045);          // frame
  add(C(0.006, 0.012), darker, 0, 0.016, -0.15, Math.PI / 2);    // barrel tip
  add(B(0.027, 0.105, 0.046), poly, 0, -0.065, 0.03, -0.25);    // grip
  add(B(0.006, 0.006, 0.045), poly, 0, -0.032, -0.03);           // trigger guard bottom
  add(B(0.004, 0.022, 0.006), poly, 0, -0.024, -0.05);
  add(B(0.004, 0.009, 0.005), darker, 0, 0.035, -0.135);         // front sight
  add(B(0.004, 0.009, 0.006), darker, 0.006, 0.035, 0.025);      // rear sight
  add(B(0.004, 0.009, 0.006), darker, -0.006, 0.035, 0.025);
  const mag = new THREE.Group(); mag.position.set(0, 0, 0); g.add(mag);
  add(B(0.024, 0.1, 0.036), poly, 0, -0.072, 0.034, -0.25, 0, 0, mag);
  add(B(0.03, 0.012, 0.05), darker, 0, -0.123, 0.047, -0.25, 0, 0, mag);
  add(B(0.05, 0.075, 0.07), glove, 0.004, -0.065, 0.04, -0.25);   // right hand
  add(B(0.045, 0.065, 0.075), glove, -0.024, -0.07, 0.035, -0.25); // support hand
  add(B(0.055, 0.055, 0.32), sleeve, 0.055, -0.13, 0.21, 0, -0.25, 0);
  add(B(0.055, 0.055, 0.32), sleeve, -0.07, -0.13, 0.21, 0, 0.3, 0);
  return { group: g, magMesh: mag, magY: 0 };
}
function buildSniper() {
  const g = new THREE.Group(), add = adder(g), { darker, glove, sleeve, olive, glass } = MAT;
  add(B(0.05, 0.062, 0.32), olive, 0, 0, 0);
  add(C(0.011, 0.64), darker, 0, 0.005, -0.47, Math.PI / 2);
  add(C(0.017, 0.06), darker, 0, 0.005, -0.8, Math.PI / 2);
  add(B(0.054, 0.05, 0.3), olive, 0, -0.012, -0.27);              // forend
  add(B(0.046, 0.095, 0.33), olive, 0, -0.032, 0.31, 0.05);       // stock
  add(B(0.046, 0.035, 0.16), olive, 0, 0.027, 0.27);              // cheek rest
  add(B(0.05, 0.11, 0.02), darker, 0, -0.04, 0.475, 0.05);
  add(B(0.04, 0.1, 0.046), olive, 0, -0.08, 0.13, -0.4);          // grip
  add(B(0.036, 0.06, 0.07), darker, 0, -0.06, -0.03);              // mag well
  const bolt = new THREE.Group(); bolt.position.set(0.035, 0.012, 0.08); g.add(bolt);
  add(C(0.005, 0.06), darker, 0.02, 0, 0, 0, 0, Math.PI / 2, bolt);
  add(new THREE.SphereGeometry(0.011, 6, 5), darker, 0.05, 0, 0, 0, 0, 0, bolt);
  // scope
  add(C(0.019, 0.3), darker, 0, 0.065, -0.02, Math.PI / 2);
  add(C(0.028, 0.07, 10, 0.02), darker, 0, 0.065, -0.2, Math.PI / 2);
  add(C(0.02, 0.05, 10, 0.025), darker, 0, 0.065, 0.15, Math.PI / 2);
  add(new THREE.CircleGeometry(0.026, 12), glass, 0, 0.065, -0.236, 0, Math.PI, 0);
  add(B(0.02, 0.03, 0.022), darker, 0, 0.04, -0.09); add(B(0.02, 0.03, 0.022), darker, 0, 0.04, 0.06);
  add(C(0.011, 0.03), darker, 0, 0.09, -0.02); add(C(0.011, 0.03), darker, 0.027, 0.065, -0.02, 0, 0, Math.PI / 2);
  add(C(0.005, 0.18), darker, 0.012, -0.03, -0.45, Math.PI / 2 - 0.1); add(C(0.005, 0.18), darker, -0.012, -0.03, -0.45, Math.PI / 2 - 0.1);
  const mag = new THREE.Group(); mag.position.set(0, -0.02, -0.03); g.add(mag);
  add(B(0.032, 0.06, 0.064), darker, 0, -0.06, 0, 0, 0, 0, mag);
  add(B(0.062, 0.07, 0.1), glove, 0, -0.105, 0.11);
  add(B(0.058, 0.058, 0.32), sleeve, 0.06, -0.15, 0.29, 0.05, -0.18, 0);
  add(B(0.075, 0.06, 0.12), glove, 0, -0.06, -0.3);
  add(B(0.06, 0.06, 0.4), sleeve, -0.075, -0.1, -0.09, 0, -0.3, 0);
  return { group: g, magMesh: mag, magY: -0.02, bolt };
}

export class Weapon {
  constructor(o) {
    Object.assign(this, o); // camera, world, zombies, fx, audio, player, muzzleLight, hooks
    this.scene = new THREE.Scene();
    this.cam = new THREE.PerspectiveCamera(58, 1, 0.01, 5);
    this.scene.add(new THREE.AmbientLight(0x9aa8d0, 2.6));
    const dl = new THREE.DirectionalLight(0xbfd0ff, 1.8); dl.position.set(-1, 2, 1); this.scene.add(dl);
    this.flashLight = new THREE.PointLight(0xffa850, 0, 3, 2); this.scene.add(this.flashLight);
    this.root = new THREE.Group(); this.scene.add(this.root);
    this.group = this.root; // visibility toggle used by main
    const builders = [buildRifle, buildGlock, buildSniper];
    const tex = flashTex();
    this.guns = GUNS.map((def, i) => {
      const m = builders[i]();
      m.group.scale.setScalar(def.scale);
      const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      flash.position.set(0, def.id === 'glock' ? 0.016 : 0, def.muzzle); flash.visible = false; m.group.add(flash);
      m.group.visible = false; this.root.add(m.group);
      return { def, ...m, flash, mag: def.mag, reserve: def.reserve };
    });
    this.dir = new THREE.Vector3(); this.right = new THREE.Vector3(); this.up = new THREE.Vector3(); this.org = new THREE.Vector3(); this.hp = new THREE.Vector3();
    this.reset();
  }

  get gun() { return this.guns[this.cur]; }
  get mag() { return this.gun.mag; }
  get reserve() { return this.gun.reserve; }
  get scoped() { return !!this.gun.def.scope && this.ads > 0.82 && !this.switchT; }

  reset() {
    for (const g of this.guns) { g.mag = g.def.mag; g.reserve = g.def.reserve; }
    this.cur = 0; this.next = 0; this.switchT = 0;
    this.reloading = false; this.reloadT = 0; this.cool = 0; this.ads = 0; this.kick = 0; this.recoil = 0;
    this.flashT = 0; this.dry = false; this.sprintB = 0; this.swayX = 0; this.swayY = 0; this.shots = 0; this.boltT = 0; this.trigger = false; this.queued = false;
    this.guns.forEach((g, i) => (g.group.visible = i === 0));
  }
  addAmmoAll() { for (const g of this.guns) g.reserve += g.def.ammoBox; }

  switchTo(i) {
    if (i === this.cur || i < 0 || i >= this.guns.length || this.switchT) return;
    this.next = i; this.switchT = 0.0001; this.reloading = false; this.boltT = 0;
    this.audio.switchGun();
  }
  cycle(dir) { this.switchTo((this.cur + dir + this.guns.length) % this.guns.length); }

  resize(aspect) { this.cam.aspect = aspect; this.cam.updateProjectionMatrix(); }
  startReload() {
    const g = this.gun;
    if (this.reloading || this.switchT || g.mag >= g.def.mag || g.reserve <= 0) return;
    this.reloading = true; this.reloadT = 0; this.audio.reload(g.def.id);
  }

  fire() {
    const cam = this.camera, P = this.player, gun = this.gun, def = gun.def;
    gun.mag--; this.shots++;
    this.cool = def.rate;
    this.kick = Math.min(1, this.kick + (def.id === 'sniper' ? 1 : 0.6));
    this.flashT = 0.05; gun.flash.visible = true;
    gun.flash.material.rotation = Math.random() * 6.28;
    const fs = (def.id === 'glock' ? 0.16 : 0.3) + Math.random() * 0.12; gun.flash.scale.set(fs, fs, 1);
    this.flashLight.intensity = 6;
    this.audio.gun(def.id);
    if (def.id === 'sniper') this.boltT = 0.0001;
    const adsK = 1 - this.ads * 0.45;
    this.recoil += (def.recoil + Math.random() * def.recoil * 0.5) * adsK;
    P.yaw += (Math.random() - 0.5) * def.recoil * 0.35 * adsK;
    P.pitch += def.recoil * 0.12 * adsK;
    cam.updateMatrixWorld();
    cam.getWorldDirection(this.dir);
    this.right.setFromMatrixColumn(cam.matrixWorld, 0); this.up.setFromMatrixColumn(cam.matrixWorld, 1);
    const moveK = def.id === 'sniper' ? 0.04 : 0.012;
    let spread = lerp(def.spreadHip, def.spreadAds, this.ads) + clamp(P.hspeed / 8, 0, 1) * moveK + (P.onGround ? 0 : 0.02);
    if (P.crouching || P.sitting) spread *= 0.6;
    const a = Math.random() * 6.28, r = Math.sqrt(Math.random()) * spread;
    this.dir.addScaledVector(this.right, Math.cos(a) * r).addScaledVector(this.up, Math.sin(a) * r).normalize();
    const o = this.org.copy(cam.position), d = this.dir;
    this.muzzleLight.position.copy(o).addScaledVector(d, 0.9); this.muzzleLight.intensity = def.id === 'glock' ? 4 : 7; this.muzzleT = 0.05;
    this.zombies.alert(o.x, o.z, def.loud);
    this.hooks.onShot && this.hooks.onShot(def, o);
    const tw = this.world.rayHit(o.x, o.y, o.z, d.x, d.y, d.z, RANGE);
    const maxT = Math.min(tw, RANGE);
    const zh = this.zombies.rayHit(o, d, maxT);
    if (zh) {
      const hp = this.hp.copy(o).addScaledVector(d, zh.t);
      this.fx.emit(hp, zh.zone === 'head' ? 18 : 8, 0x7a0c0c, 3.2, 0.5, { x: -d.x, y: -d.y, z: -d.z }, 8);
      this.audio.impact(hp, 'flesh');
      const res = this.zombies.damage(zh.z, def.dmg, zh.zone);
      this.hooks.onHit(res, zh.zone, zh.z);
    } else if (tw !== Infinity) {
      const hp = this.hp.copy(o).addScaledVector(d, tw);
      const k = this.world.hitKind;
      if (k === 'water') this.fx.emit(hp, 14, 0x8aa8c0, 2.4, 0.6, { x: 0, y: 2, z: 0 }, 9);
      else {
        const n = k === 'dirt' ? { x: 0, y: 1, z: 0 } : { x: -d.x, y: -d.y * 0.3 + 0.2, z: -d.z };
        this.fx.emit(hp, 9, k === 'dirt' ? 0x5a4630 : k === 'wood' ? 0x7a5a3a : 0x9a9a9a, 2.6, 0.45, n, 9);
      }
      this.audio.impact(hp, k);
    }
  }

  update(dt, inp) {
    const P = this.player, gun = this.gun, def = gun.def;
    this.cool -= dt;
    // weapon switching: lower, swap, raise
    let swapLower = 0;
    if (this.switchT) {
      this.switchT += dt;
      if (this.switchT >= 0.22 && this.cur !== this.next) {
        gun.group.visible = false; this.cur = this.next; this.gun.group.visible = true; gun.flash.visible = false;
      }
      swapLower = this.switchT < 0.22 ? this.switchT / 0.22 : 1 - (this.switchT - 0.22) / 0.25;
      if (this.switchT >= 0.47) { this.switchT = 0; swapLower = 0; }
    }
    const busy = !!this.switchT;
    const wantAds = inp.adsHeld && !this.reloading && !inp.sprinting && inp.canAct && !busy;
    this.ads = damp(this.ads, wantAds ? 1 : 0, def.scope ? 10 : 14, dt);
    this.sprintB = damp(this.sprintB, inp.sprinting ? 1 : 0, 9, dt);
    if (this.reloading) {
      this.reloadT += dt;
      if (this.reloadT >= def.reload) {
        this.reloading = false;
        const take = Math.min(def.mag - gun.mag, gun.reserve);
        gun.mag += take; gun.reserve -= take;
      }
    }
    if (this.boltT) { this.boltT += dt; if (this.boltT > def.rate) this.boltT = 0; else if (this.boltT > 0.25 && !this.boltSnd) { this.boltSnd = true; this.audio.bolt(); } }
    if (!this.boltT) this.boltSnd = false;
    // shooting
    const pressed = inp.firing && !this.trigger;
    this.trigger = inp.firing;
    // a semi-auto click made shortly before the gun is ready is buffered, not lost
    if (pressed && this.cool < 0.35) this.queued = true;
    if (!inp.canAct || busy || this.reloading) this.queued = false;
    if ((inp.firing || this.queued) && inp.canAct && !busy) {
      if (gun.mag > 0) {
        if (this.cool <= 0 && !this.reloading && !inp.sprinting && (def.auto ? inp.firing : this.queued)) { this.queued = false; this.fire(); }
      } else if (!this.dry && !this.reloading && pressed) { this.audio.empty(); this.dry = true; this.cool = 0.25; this.queued = false; }
    }
    if (!inp.firing) this.dry = false;
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) { for (const g of this.guns) g.flash.visible = false; this.flashLight.intensity = 0; } }
    if (this.muzzleT > 0) { this.muzzleT -= dt; if (this.muzzleT <= 0) this.muzzleLight.intensity = 0; }
    this.kick = damp(this.kick, 0, def.id === 'sniper' ? 8 : 16, dt);
    this.recoil = damp(this.recoil, 0, def.id === 'sniper' ? 4 : 7, dt);

    // pose
    const g = this.gun.group, dd = this.gun.def, ads = this.ads, sb = this.sprintB;
    const lookX = clamp(inp.lookDX, -60, 60), lookY = clamp(inp.lookDY, -60, 60);
    this.swayX = damp(this.swayX, -lookX * 0.0009, 9, dt);
    this.swayY = damp(this.swayY, lookY * 0.0009, 9, dt);
    const move = clamp(P.hspeed / 6, 0, 1) * (P.onGround ? 1 : 0.2);
    const bx = Math.cos(P.bobPhase) * 0.008 * move * (1 - ads * 0.85), by = Math.sin(P.bobPhase * 2) * 0.006 * move * (1 - ads * 0.85);
    const idle = Math.sin(inp.time * 1.4) * 0.0015 * (1 - ads);
    let px = lerp(dd.hip[0], dd.ads[0], ads) + bx + this.swayX * (1 - ads * 0.7) - sb * 0.06;
    let py = lerp(dd.hip[1], dd.ads[1], ads) + by + idle + this.swayY * (1 - ads * 0.7) - sb * 0.07 - swapLower * 0.25;
    let pz = lerp(dd.hip[2], dd.ads[2], ads) + this.kick * (dd.id === 'glock' ? 0.03 : 0.045);
    let rx = this.kick * (dd.id === 'glock' ? 0.25 : 0.06) - sb * 0.25 + this.swayY * 2 - swapLower * 0.6, ry = this.swayX * 2 + sb * 0.7, rz = -this.swayX * 1.5 + sb * 0.1;
    const gun2 = this.gun;
    if (this.reloading) {
      const p = this.reloadT / dd.reload;
      const env = clamp(Math.min(p / 0.18, (1 - p) / 0.18), 0, 1), e = env * env * (3 - 2 * env);
      py -= e * 0.09; px -= e * 0.03; rz += e * 0.55; rx += e * 0.3; ry += e * 0.2;
      let my = gun2.magY;
      if (p > 0.2 && p < 0.42) my -= ((p - 0.2) / 0.22) * 0.3;
      else if (p >= 0.42 && p < 0.58) my -= 0.3;
      else if (p >= 0.58 && p < 0.78) my -= 0.3 * (1 - (p - 0.58) / 0.2);
      gun2.magMesh.position.y = my; gun2.magMesh.visible = my > gun2.magY - 0.26;
      if (p > 0.84 && p < 0.92) pz += Math.sin((p - 0.84) / 0.08 * Math.PI) * 0.03;
    } else if (gun2.magMesh.position) { gun2.magMesh.position.y = gun2.magY; gun2.magMesh.visible = true; }
    if (this.boltT && gun2.bolt) { // bolt action cycle
      const p = this.boltT / dd.rate;
      const k = p > 0.2 && p < 0.75 ? Math.sin((p - 0.2) / 0.55 * Math.PI) : 0;
      gun2.bolt.rotation.z = k * 1.2; gun2.bolt.position.z = 0.08 + k * 0.06;
      rz += k * 0.12 * (1 - ads); py -= k * 0.01;
    }
    g.position.set(px, py, pz);
    g.rotation.set(rx, ry, rz);
    g.visible = !this.scoped;
  }

  render(renderer) {
    if (this.scoped) return;
    renderer.clearDepth();
    renderer.render(this.scene, this.cam);
  }
}
