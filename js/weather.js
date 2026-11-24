import * as THREE from '../lib/three.module.min.js';
import { clamp, damp, rand } from './util.js';

export const WEATHER = {
  clear: [180, 480], rain: [60, 180], transition: 14, thunderChance: 0.12,
  desertClear: [190, 420], warning: [15, 30], approaching: [10, 20], storm: [60, 150], fading: [15, 30],
  lightningInterval: [16, 38], rainParticles: [340, 650, 1050],
};
const RAIN = { clear: 0, light: 0.28, moderate: 0.57, heavy: 0.88, thunderstorm: 1 };
const STORM = { clear: 0, warning: 0.2, approaching: 0.55, active: 1, fading: 0 };
const cycle = ['clear', 'warning', 'approaching', 'active', 'fading'];
const fog = new THREE.Color(0x553b25);
const rainFog = new THREE.Color(0x151d29);
const roll = (range) => rand(...range);

export class Weather {
  constructor(scene, world, audio, fx) {
    Object.assign(this, { scene, world, audio, fx });
    const n = Math.max(...WEATHER.rainParticles);
    this.drops = new Float32Array(n * 3);
    this.rainGeometry = new THREE.BufferGeometry();
    this.rainGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 6), 3).setUsage(THREE.DynamicDrawUsage));
    this.rainGeometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 6), 3).setUsage(THREE.DynamicDrawUsage));
    this.rainMaterial = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, depthWrite: false });
    this.rainMesh = new THREE.LineSegments(this.rainGeometry, this.rainMaterial);
    this.rainMesh.frustumCulled = false; this.rainMesh.visible = false; scene.add(this.rainMesh);
    this.splash = new THREE.Vector3();
    this.forward = new THREE.Vector3();
    const wallGeo = new THREE.PlaneGeometry(2, 1);
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(32, 32, 5, 32, 32, 32);
    gradient.addColorStop(0, '#d19b64'); gradient.addColorStop(0.45, '#ab794b80'); gradient.addColorStop(1, '#98694200');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 64, 64);
    this.wall = new THREE.Mesh(wallGeo, new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(canvas), transparent: true, opacity: 0, depthWrite: false, fog: false, side: THREE.DoubleSide,
    }));
    this.wall.visible = false; scene.add(this.wall);
    this.streaks = document.createElement('div'); this.streaks.id = 'rain-streaks'; document.body.append(this.streaks);
    this.reset();
  }
  reset() {
    this.rainState = 'clear'; this.sandState = 'clear';
    this.rainTime = roll(WEATHER.clear); this.sandTime = roll(WEATHER.desertClear);
    this.rainLevel = this.sandLevel = this.rain = this.sand = this.lightning = this.flash = 0;
    this.lightningTime = roll(WEATHER.lightningInterval); this.thunderDelay = null;
    this.ready = false; this.rainMesh.visible = this.wall.visible = false;
    this.streaks.style.opacity = 0;
  }
  force(kind, state) {
    if (kind === 'rain' && Object.hasOwn(RAIN, state)) {
      this.rainState = state; this.rainTime = roll(state === 'clear' ? WEATHER.clear : WEATHER.rain);
      if (state === 'thunderstorm') this.lightningTime = 3;
    } else if (kind === 'sand' && Object.hasOwn(STORM, state)) {
      this.sandState = state;
      this.sandTime = roll(state === 'clear' ? WEATHER.desertClear :
        state === 'active' ? WEATHER.storm : WEATHER[state]);
    }
  }
  get hearing() { return 1 - this.rain * 0.38 - this.sand * 0.27; }
  get visibility() { return 1 - this.sand * 0.51 - this.rain * 0.14; }
  get movement() { return 1 - this.sand * 0.15; }
  update(dt, t, player, camera, indoors, metal, quality, lightOn) {
    const p = player.pos, desert = this.world.desertWeight(p.x, p.z);
    if ((this.rainTime -= dt) <= 0) {
      if (this.rainState === 'clear') {
        const v = Math.random();
        this.force('rain', v < WEATHER.thunderChance ? 'thunderstorm' : v < 0.38 ? 'heavy' : v < 0.72 ? 'moderate' : 'light');
      } else this.force('rain', 'clear');
    }
    if ((this.sandTime -= dt) <= 0) this.force('sand', cycle[(cycle.indexOf(this.sandState) + 1) % cycle.length]);
    this.rainLevel = damp(this.rainLevel, RAIN[this.rainState], 3 / WEATHER.transition, dt);
    this.sandLevel = damp(this.sandLevel, STORM[this.sandState], 3 / WEATHER.transition, dt);
    const wet = this.rainLevel * (1 - desert), dusty = this.sandLevel * desert;
    this.rain = indoors ? 0 : wet * (1 - this.world.canopyCover(p.x, p.z) * 0.43);
    this.sand = indoors ? 0 : dusty;
    this.lightning = Math.max(0, this.lightning - dt * 4);
    if (this.rainState === 'thunderstorm' && (this.lightningTime -= dt) <= 0) {
      this.lightningTime = roll(WEATHER.lightningInterval);
      this.lightning = 1; this.thunderDelay = rand(0.85, 3.6);
      this.thunderPos = { x: p.x + rand(-42, 42), y: p.y + 15, z: p.z + rand(-42, 42) };
    }
    if (this.thunderDelay !== null && (this.thunderDelay -= dt) <= 0) {
      if (wet > 0.12) {
        this.audio.horror('thunder', this.thunderPos, indoors ? 0.38 : 1);
        if (!indoors && Math.random() < 0.27) this.audio.horror('branch', { x: p.x - 7, y: p.y + 6, z: p.z + 11 });
      }
      this.thunderDelay = null;
    }
    this.flash = indoors || desert > 0.7 ? 0 : this.lightning * (1 - desert);
    this.audio.setWeather(wet, dusty, indoors, metal);
    this.renderRain(dt, p, camera, quality, lightOn);
    this.wall.visible = this.sandState === 'approaching' && this.sand > 0.08;
    if (this.wall.visible) {
      const distance = 24 + this.sandTime * 2.5;
      this.wall.position.set(p.x + distance, p.y + 9, p.z - distance * 0.7);
      this.wall.lookAt(p.x, p.y + 9, p.z);
      this.wall.scale.set(65, 18, 1);
      this.wall.material.opacity = this.sand * 0.85;
    }
    this.streaks.style.opacity = Math.max(0, this.rain - 0.42) * 0.47;
  }
  renderRain(dt, p, camera, quality, lightOn) {
    const n = Math.ceil(WEATHER.rainParticles[quality] * this.rain);
    this.rainMesh.visible = n > 4;
    if (n <= 4) { this.ready = false; return; }
    const position = this.rainGeometry.attributes.position, color = this.rainGeometry.attributes.color;
    const a = position.array, c = color.array;
    camera.getWorldDirection(this.forward);
    const wind = 1.2 + this.rain * 3.5;
    for (let i = 0; i < n; i++) {
      const off = i * 3, j = i * 6;
      let x = this.drops[off], y = this.drops[off + 1], z = this.drops[off + 2];
      const ground = p.y - 0.45;
      const near = Math.abs(x - p.x) < 7 && Math.abs(z - p.z) < 7;
      if (!this.ready || y < ground || Math.abs(x - p.x) > 19 || Math.abs(z - p.z) > 19) {
        if (near && this.ready && y < ground && i % 17 === 0) {
          this.splash.set(x, this.world.hgt(x, z) + 0.06, z);
          this.fx.emit(this.splash, 2, 0x98b1c4, 0.6, 0.19, null, 0.3);
        }
        x = p.x + rand(-18, 18); z = p.z + rand(-18, 18); y = p.y + rand(this.ready ? 5 : 0, 14);
      }
      x += wind * dt; y -= dt * (16 + (i % 4)); z -= wind * dt * 0.23;
      this.drops[off] = a[j] = x; this.drops[off + 1] = a[j + 1] = y; this.drops[off + 2] = a[j + 2] = z;
      a[j + 3] = x - wind * 0.035; a[j + 4] = y + 0.52; a[j + 5] = z + wind * 0.007;
      const dx = x - p.x, dz = z - p.z, dy = y - camera.position.y, len = Math.hypot(dx, dy, dz) || 1;
      const facing = (dx * this.forward.x + dy * this.forward.y + dz * this.forward.z) / len;
      const coach = this.world.railway?.shelter(x, z);
      const roofed = coach ? y < coach.roof : y < p.y + 4 && this.world.inBuilding(x, z);
      const bright = roofed ? 0 : lightOn && len < 20 ?
        0.23 + 2.1 * clamp((facing - 0.8) * 5, 0, 1) * (1 - len / 20) : 0.23;
      if (roofed) { a[j + 3] = x; a[j + 4] = y; a[j + 5] = z; }
      c[j] = bright * 0.48; c[j + 1] = bright * 0.7; c[j + 2] = bright;
      c[j + 3] = c[j] * 0.34; c[j + 4] = c[j + 1] * 0.34; c[j + 5] = c[j + 2] * 0.34;
    }
    this.ready = true;
    this.rainGeometry.setDrawRange(0, n * 2);
    position.needsUpdate = color.needsUpdate = true;
    this.rainMaterial.opacity = 0.42 + this.rain * 0.27;
  }
  applyAtmosphere(scene, world, stars) {
    scene.fog.far = Math.min(scene.fog.far, THREE.MathUtils.lerp(330, 18, this.sand ** 0.48));
    scene.fog.far *= 1 - this.rain * 0.29;
    scene.fog.near = Math.min(scene.fog.near, scene.fog.far * 0.35);
    scene.fog.color.lerp(fog, this.sand * 0.93).lerp(rainFog, this.rain * 0.28);
    scene.background.copy(scene.fog.color);
    world.moon.intensity = world.moon.intensity * (1 - this.sand * 0.64 - this.rain * 0.33) + this.flash * 6;
    world.hemi.intensity += this.flash * 3;
    world.domeMat.color.lerp(rainFog, this.sand * 0.76);
    const sky = 1 - this.sand * 0.94 - this.rain * 0.35;
    world.starMat.opacity *= sky; stars.opacity *= sky;
    world.moonMat.opacity *= sky; world.redMoonMat.opacity *= sky;
    return scene.fog.far;
  }
}
