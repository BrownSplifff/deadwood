import * as THREE from '../lib/three.module.min.js';
import { clamp, damp } from './util.js';

export const PCFG = {
  walk: 4.2, sprint: 7.4, crouch: 2.0, ads: 2.6,
  gravity: 22, jump: 6.8, radius: 0.4,
  eyeStand: 1.7, eyeCrouch: 1.15, eyeSit: 0.5,
  maxStamina: 100, maxHealth: 100,
  staminaDrain: false,   // stamina depletion switched off for now (sprint, jump, infection, holding breath) - set true to re-enable
};

export class Player {
  constructor(camera, world, audio) {
    this.camera = camera; this.world = world; this.audio = audio;
    this.reset();
  }
  reset() {
    this.pos = new THREE.Vector3(CAMP_START.x, 0, CAMP_START.z);
    this.pos.y = this.world.hgt(this.pos.x, this.pos.z);
    this.vx = 0; this.vz = 0; this.vy = 0;
    this.yaw = -0.9; this.pitch = 0;
    this.eyeH = PCFG.eyeStand;
    this.sitting = false; this.crouching = false; this.sprinting = false;
    this.onGround = true; this.hspeed = 0;
    this.stamina = PCFG.maxStamina; this.exhausted = false;
    this.health = PCFG.maxHealth;
    this.bobPhase = 0; this.bobY = 0; this.bobX = 0; this.stepIdx = 0;
    this.recoil = 0; this.roll = 0;
  }
  toggleSit() { this.sitting = !this.sitting; }

  update(dt, keys, ctx) {
    const mount = ctx.mount;
    const sit = !mount && this.sitting;
    let fz = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0), rx = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
    if (sit || !ctx.canMove) { fz = 0; rx = 0; }
    const crouch = !mount && !sit && (keys.ControlLeft || keys.ControlRight || keys.KeyC);
    this.crouching = !!crouch;
    const moving = fz !== 0 || rx !== 0;
    const wantSprint = (keys.ShiftLeft || keys.ShiftRight) && fz > 0 && !crouch && !sit && !ctx.aiming && !ctx.firing;
    this.sprinting = wantSprint && moving && this.stamina > 0 && !this.exhausted && this.onGround;
    if (!this.sprinting && this.exhausted && this.stamina > 22) this.exhausted = false;

    let target = PCFG.walk;
    if (this.sprinting) target = PCFG.sprint; else if (crouch) target = PCFG.crouch; else if (ctx.aiming) target = PCFG.ads;
    target = mount ? (this.sprinting ? mount.run : mount.walk) * mount.bonus : target * (ctx.speedMul ?? 1);
    target *= ctx.weatherSpeed ?? 1;
    this.inWater = this.world.isWater(this.pos.x, this.pos.z);
    if (this.inWater) target *= 0.55;
    // wish direction
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    let wx = -sy * fz + cy * rx, wz = -cy * fz - sy * rx;
    const wl = Math.hypot(wx, wz);
    if (wl > 0) { wx /= wl; wz /= wl; }
    const tvx = wx * target, tvz = wz * target;
    const accel = this.onGround ? (moving ? 11 : 14) : 1.5;
    this.vx = damp(this.vx, tvx, accel, dt);
    this.vz = damp(this.vz, tvz, accel, dt);

    // stamina
    if (this.sprinting) {
      this.stamina -= 20 * (ctx.drainMul ?? 1) * dt;
      if (this.stamina <= 0) { this.stamina = 0; this.exhausted = true; }
    } else this.stamina = Math.min(PCFG.maxStamina, this.stamina + (moving ? 12 : 22) * (ctx.regenMul ?? 1) * dt);
    // infection gnaws at stamina even when standing still
    if (ctx.passiveDrain) this.stamina = Math.max(0, this.stamina - ctx.passiveDrain * dt);

    // jump + gravity
    if ((!mount || mount.jump) && keys.Space && this.onGround && !sit && ctx.canMove) { this.vy = PCFG.jump; this.onGround = false; this.audio.jump(); this.stamina = Math.max(0, this.stamina - 6); }
    if (!PCFG.staminaDrain) { this.stamina = PCFG.maxStamina; this.exhausted = false; }
    this.vy -= PCFG.gravity * dt;
    this.pos.x += this.vx * dt; this.pos.z += this.vz * dt; this.pos.y += this.vy * dt;
    this.world.resolve(this.pos, mount?.radius ?? PCFG.radius, this.pos.y);
    if (mount) {
      const length = Math.hypot(this.vx, this.vz);
      if (length > 0.1) for (const sign of [-1, 1]) {
        const dx = this.vx / length * sign * 0.65, dz = this.vz / length * sign * 0.65;
        const end = { x: this.pos.x + dx, z: this.pos.z + dz };
        this.world.resolve(end, mount.radius * 0.8, this.pos.y);
        this.pos.x = end.x - dx; this.pos.z = end.z - dz;
      }
    }

    const ceil = this.world.ceilingAt ? this.world.ceilingAt(this.pos.x, this.pos.z) : Infinity;
    const height = mount ? mount.eye + 0.35 : 1.95;
    if (this.pos.y + height > ceil) { this.pos.y = ceil - height; if (this.vy > 0) this.vy = 0; }
    const g = this.world.hgt(this.pos.x, this.pos.z);
    if (this.pos.y <= g) {
      if (!this.onGround && this.vy < -7) this.audio.land();
      this.pos.y = g; this.vy = 0; this.onGround = true;
    } else if (this.onGround && this.pos.y - g < 0.35 && this.vy <= 0) { this.pos.y = g; this.vy = 0; } // stick to downhill slopes
    else this.onGround = false;

    this.hspeed = Math.hypot(this.vx, this.vz);

    // eye height transitions
    const eyeT = mount ? mount.eye : sit ? PCFG.eyeSit : crouch ? PCFG.eyeCrouch : PCFG.eyeStand;
    this.eyeH = damp(this.eyeH, eyeT, 9, dt);

    // head bob + footsteps
    if (this.onGround && this.hspeed > 0.4) {
      this.bobPhase += this.hspeed * dt * 1.5;
      const amp = clamp(this.hspeed / PCFG.sprint, 0, 1);
      this.bobY = Math.sin(this.bobPhase * 2) * (mount ? 0.075 : 0.035) * (0.4 + amp);
      this.bobX = Math.cos(this.bobPhase) * 0.02 * (0.4 + amp);
      const idx = Math.floor(this.bobPhase / Math.PI);
      if (idx !== this.stepIdx) {
        this.stepIdx = idx;
        if (this.inWater) this.audio.splash(); else this.audio.step(this.sprinting ? 1 : crouch ? 0.25 : 0.6);
        ctx.onStep?.(this.sprinting);
      }
    } else { this.bobY = damp(this.bobY, 0, 8, dt); this.bobX = damp(this.bobX, 0, 8, dt); }
  }

  applyCamera(dt, extraPitch = 0, extraYaw = 0) {
    const cam = this.camera;
    cam.position.set(this.pos.x, this.pos.y + this.eyeH + this.bobY, this.pos.z);
    cam.rotation.order = 'YXZ';
    cam.rotation.set(this.pitch + extraPitch, this.yaw + extraYaw, this.roll);
    cam.position.x += Math.cos(this.yaw) * this.bobX;
    cam.position.z += -Math.sin(this.yaw) * this.bobX;
  }
}

export const CAMP_START = { x: 9, z: 14 };
