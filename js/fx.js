import * as THREE from '../lib/three.module.min.js';

/** Small pooled particle system for bullet impacts / blood. One draw call. */
export class Particles {
  constructor(scene, max = 300) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.grav = new Float32Array(max);
    for (let i = 0; i < max; i++) this.pos[i * 3 + 1] = -1000;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.mesh = new THREE.Points(g, new THREE.PointsMaterial({
      size: 0.11, vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true,
    }));
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.next = 0;
    this.limit = max;
  }
  emit(p, n, color, speed, life, normal, grav = 9) {
    const c = new THREE.Color(color);
    n = Math.min(n, this.limit);
    for (let k = 0; k < n; k++) {
      const i = this.next; this.next = (this.next + 1) % this.limit;
      const i3 = i * 3;
      this.pos[i3] = p.x; this.pos[i3 + 1] = p.y; this.pos[i3 + 2] = p.z;
      const s = speed * (0.35 + Math.random() * 0.8);
      let vx = (Math.random() - 0.5) * 2, vy = Math.random() * 1.2, vz = (Math.random() - 0.5) * 2;
      if (normal) { vx += normal.x * 1.8; vy += normal.y * 1.8; vz += normal.z * 1.8; }
      this.vel[i3] = vx * s; this.vel[i3 + 1] = vy * s; this.vel[i3 + 2] = vz * s;
      const sh = 0.7 + Math.random() * 0.5;
      this.col[i3] = c.r * sh; this.col[i3 + 1] = c.g * sh; this.col[i3 + 2] = c.b * sh;
      this.life[i] = life * (0.6 + Math.random() * 0.6);
      this.grav[i] = grav;
    }
  }
  update(dt) {
    let any = false;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] -= dt;
      const i3 = i * 3;
      if (this.life[i] <= 0) { this.pos[i3 + 1] = -1000; continue; }
      this.vel[i3 + 1] -= this.grav[i] * dt;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
    }
    if (any || this.dirty) {
      this.mesh.geometry.attributes.position.needsUpdate = true;
      this.mesh.geometry.attributes.color.needsUpdate = true;
    }
    this.dirty = any;
  }
  clear() {
    this.life.fill(0);
    for (let i = 0; i < this.max; i++) this.pos[i * 3 + 1] = -1000;
    this.mesh.geometry.attributes.position.needsUpdate = true;
  }
}
