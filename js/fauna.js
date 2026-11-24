import * as THREE from '../lib/three.module.min.js';
import { clamp, rand } from './util.js';

// Crows circling overhead, bats in the dark, owls watching from branches and rooftops.
export class Fauna {
  constructor(scene, world, audio) {
    this.scene = scene; this.world = world; this.audio = audio;
    const crowMat = new THREE.MeshLambertMaterial({ color: 0x0c0c10, flatShading: true, side: THREE.DoubleSide });
    const batMat = new THREE.MeshLambertMaterial({ color: 0x1a1410, flatShading: true, side: THREE.DoubleSide });
    const wingGeo = (len, w, jag) => {
      const pts = jag
        ? [0, 0, 0.06, len, 0, 0.02, len * 0.7, 0, -w * 0.4, len * 0.45, 0, -w * 0.2, len * 0.25, 0, -w, 0, 0, -0.06]
        : [0, 0, 0.08, len, 0, 0, len * 0.6, 0, -w, 0, 0, -0.08];
      const idx = jag ? [0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 5] : [0, 1, 2, 0, 2, 3];
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); g.setIndex(idx); g.computeVertexNormals();
      return g;
    };
    const mkFlyer = (bodyGeo, mat, wing) => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(bodyGeo, mat));
      const wl = new THREE.Group(), wr = new THREE.Group();
      wl.add(new THREE.Mesh(wing, mat)); const m2 = new THREE.Mesh(wing, mat); m2.scale.x = -1; wr.add(m2);
      g.add(wl, wr); g.userData.wl = wl; g.userData.wr = wr;
      return g;
    };
    // crows
    this.crows = [];
    const crowBody = new THREE.ConeGeometry(0.09, 0.45, 5).rotateX(Math.PI / 2);
    const crowWing = wingGeo(0.5, 0.22, false);
    this.flockC = { x: 0, z: 0 };
    for (let i = 0; i < 11; i++) {
      const g = mkFlyer(crowBody, crowMat, crowWing);
      g.userData.o = { r: rand(18, 42), h: rand(24, 44), w: rand(0.18, 0.32) * (Math.random() < 0.5 ? 1 : -1), ph: rand(0, 6.28), flap: rand(0, 6) };
      g.scale.setScalar(1.4);
      scene.add(g); this.crows.push(g);
    }
    // bats
    this.bats = [];
    const batBody = new THREE.ConeGeometry(0.04, 0.16, 4).rotateX(Math.PI / 2);
    const batWing = wingGeo(0.22, 0.14, true);
    for (let i = 0; i < 16; i++) {
      const g = mkFlyer(batBody, batMat, batWing);
      g.userData.o = { a: rand(0, 6.28), r: rand(4, 14), h: rand(2, 7), w: rand(1.2, 2.4) * (Math.random() < 0.5 ? 1 : -1), ph: rand(0, 6.28), x: 0, y: -100, z: 0, active: false };
      g.visible = false; scene.add(g); this.bats.push(g);
    }
    // owls
    const owlMat = new THREE.MeshLambertMaterial({ color: 0x4a3a2a, flatShading: true });
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffc23a, fog: false });
    this.owlParts = {
      body: new THREE.CylinderGeometry(0.12, 0.17, 0.38, 7), head: new THREE.BoxGeometry(0.22, 0.18, 0.18), ear: new THREE.ConeGeometry(0.03, 0.08, 4),
      eye: new THREE.SphereGeometry(0.028, 6, 5), beak: new THREE.ConeGeometry(0.018, 0.05, 4), owlMat, eyeMat, wing: wingGeo(0.35, 0.18, false),
    };
    this.owls = new Map();
    this.cawT = rand(4, 10); this.batSq = 2;
  }

  makeOwl(spot) {
    const P = this.owlParts, g = new THREE.Group();
    const body = new THREE.Mesh(P.body, P.owlMat); body.position.y = 0.19; g.add(body);
    const head = new THREE.Group(); head.position.y = 0.45; g.add(head);
    head.add(new THREE.Mesh(P.head, P.owlMat));
    for (const s of [-1, 1]) {
      const e = new THREE.Mesh(P.eye, P.eyeMat); e.position.set(s * 0.05, 0.02, 0.09); head.add(e);
      const ear = new THREE.Mesh(P.ear, P.owlMat); ear.position.set(s * 0.08, 0.12, 0); head.add(ear);
    }
    const bk = new THREE.Mesh(P.beak, new THREE.MeshLambertMaterial({ color: 0x2a2418 })); bk.rotation.x = Math.PI; bk.position.set(0, -0.03, 0.1); head.add(bk);
    const wl = new THREE.Group(), wr = new THREE.Group();
    wl.add(new THREE.Mesh(P.wing, P.owlMat)); const m2 = new THREE.Mesh(P.wing, P.owlMat); m2.scale.x = -1; wr.add(m2);
    wl.position.set(0.1, 0.25, 0); wr.position.set(-0.1, 0.25, 0); wl.visible = wr.visible = false; g.add(wl, wr);
    g.position.set(spot.x, spot.y, spot.z); g.rotation.y = spot.yaw;
    g.userData = { head, wl, wr, spot, hootT: rand(3, 14), fleeT: 0, vx: 0, vz: 0 };
    this.scene.add(g);
    return g;
  }

  clear() {
    for (const o of this.owls.values()) this.scene.remove(o);
    this.owls.clear();
    for (const s of this.world.owlSpots) s.fled = false;
  }

  update(dt, t, px, py, pz, dark) {
    // ---- crows: flock drifts after the player high above the trees
    const fc = this.flockC;
    fc.x += (px - fc.x) * Math.min(1, dt * 0.05); fc.z += (pz - fc.z) * Math.min(1, dt * 0.05);
    const gy = this.world.hgt(fc.x, fc.z);
    for (const c of this.crows) {
      const o = c.userData.o;
      o.ph += o.w * dt;
      const x = fc.x + Math.cos(o.ph) * o.r, z = fc.z + Math.sin(o.ph) * o.r;
      c.position.set(x, gy + o.h + Math.sin(t * 0.5 + o.ph) * 2, z);
      c.rotation.y = Math.atan2(-Math.sin(o.ph) * Math.sign(o.w), Math.cos(o.ph) * Math.sign(o.w));
      c.rotation.z = -Math.sign(o.w) * 0.35;
      const glide = Math.sin(t * 0.4 + o.flap) > 0.3;
      const f = glide ? 0.15 : Math.sin(t * 11 + o.flap) * 0.8;
      c.userData.wl.rotation.z = f; c.userData.wr.rotation.z = -f;
    }
    this.cawT -= dt;
    if (this.cawT <= 0) { this.cawT = rand(6, 16); const c = this.crows[(Math.random() * this.crows.length) | 0]; this.audio.crow(c.position); }

    // ---- bats: more of them the darker it gets
    const want = Math.round(2 + dark * 14);
    let active = 0;
    for (const b of this.bats) {
      const o = b.userData.o;
      if (!o.active && active < want && Math.random() < dt * 0.8) { o.active = true; o.a = rand(0, 6.28); o.x = px + Math.cos(o.a) * 30; o.z = pz + Math.sin(o.a) * 30; o.y = py + 10; }
      if (o.active && active >= want + 2) o.active = false;
      if (!o.active) { b.visible = false; continue; }
      active++;
      o.a += o.w * dt + Math.sin(t * 3 + o.ph) * dt * 2;
      const tr = o.r + Math.sin(t * 1.7 + o.ph) * 3;
      const tx = px + Math.cos(o.a) * tr, tz = pz + Math.sin(o.a) * tr, ty = this.world.hgt(px, pz) + o.h + Math.sin(t * 2.3 + o.ph) * 1.5;
      const k = Math.min(1, dt * 3);
      const nx = o.x + (tx - o.x) * k, nz = o.z + (tz - o.z) * k;
      b.rotation.y = Math.atan2(nx - o.x, nz - o.z);
      o.x = nx; o.z = nz; o.y += (ty - o.y) * k;
      b.position.set(o.x, o.y, o.z); b.visible = true;
      const f = Math.sin(t * 32 + o.ph) * 1.0;
      b.userData.wl.rotation.z = f; b.userData.wr.rotation.z = -f;
    }
    this.batSq -= dt;
    if (this.batSq <= 0 && active > 0) { this.batSq = rand(1.5, 5) / (1 + dark * 2); const b = this.bats.find((x) => x.visible); if (b) this.audio.bat(b.position); }

    // ---- owls
    for (const s of this.world.owlSpots) {
      const d = Math.hypot(s.x - px, s.z - pz);
      let o = this.owls.get(s);
      if (!o && d < 75 && !s.fled) { o = this.makeOwl(s); this.owls.set(s, o); }
      if (!o) continue;
      if (d > 90) { this.scene.remove(o); this.owls.delete(s); continue; }
      const u = o.userData;
      if (u.fleeT > 0) { // flapping away
        u.fleeT += dt;
        o.position.x += u.vx * dt; o.position.z += u.vz * dt; o.position.y += 3 * dt;
        const f = Math.sin(t * 14) * 0.9; u.wl.rotation.z = f; u.wr.rotation.z = -f;
        if (u.fleeT > 5) { this.scene.remove(o); this.owls.delete(s); }
        continue;
      }
      if (d < 6) {
        u.fleeT = 0.001; s.fled = true; u.wl.visible = u.wr.visible = true;
        const a = Math.atan2(s.z - pz, s.x - px); u.vx = Math.cos(a) * 7; u.vz = Math.sin(a) * 7;
        o.rotation.y = Math.atan2(u.vx, u.vz);
        this.audio.flap(o.position); this.audio.owl(o.position, true);
        continue;
      }
      // the head slowly turns to follow the player
      const want = Math.atan2(px - s.x, pz - s.z) - o.rotation.y;
      let diff = Math.atan2(Math.sin(want), Math.cos(want));
      diff = clamp(diff, -2.4, 2.4);
      u.head.rotation.y += (diff - u.head.rotation.y) * Math.min(1, dt * 1.5);
      u.hootT -= dt;
      if (u.hootT <= 0) { u.hootT = rand(10, 26); if (d < 65) this.audio.owl(o.position); }
    }
  }
}
