import { HALF, SIZE, CH, NCH, CABIN, CAMP, darkness } from './world.js';

const TILE = 32;                 // pixels per chunk in the map texture (3 m / pixel)
const MINI_R = 75;               // metres shown from the centre of the corner minimap
const S = TILE / CH;             // map pixels per metre

/** Fog-of-war map: each 100 m chunk is painted into the map texture the first time it streams in. */
export class Minimap {
  constructor(canvas, world) {
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.world = world; this.big = false;
    this.bg = document.createElement('canvas'); this.bg.width = this.bg.height = NCH * TILE;
    this.g = this.bg.getContext('2d');
    this.g.fillStyle = '#04060a'; this.g.fillRect(0, 0, this.bg.width, this.bg.height);
    this.revealed = new Set();
    this.id = this.g.createImageData(TILE, TILE);
    this.P = (v) => (v + HALF) * S;
  }

  reset() {
    this.revealed.clear();
    this.g.fillStyle = '#04060a'; this.g.fillRect(0, 0, this.bg.width, this.bg.height);
  }

  reveal(ci) {
    if (this.revealed.has(ci)) return;
    this.revealed.add(ci);
    const cx = ci % NCH, cz = (ci / NCH) | 0, x0 = -HALF + cx * CH, z0 = -HALF + cz * CH, w = this.world, g = this.g, d = this.id.data;
    for (let j = 0; j < TILE; j++) for (let i = 0; i < TILE; i++) {
      const x = x0 + (i + 0.5) * CH / TILE, z = z0 + (j + 0.5) * CH / TILE;
      const c = w.mapColor(x, z), dk = 1 - darkness(x, z) * 0.55, k = (j * TILE + i) * 4;
      d[k] = c[0] * dk; d[k + 1] = c[1] * dk; d[k + 2] = c[2] * dk; d[k + 3] = 255;
    }
    const tx = cx * TILE, tz = cz * TILE;
    g.putImageData(this.id, tx, tz);
    g.save();
    g.beginPath(); g.rect(tx, tz, TILE, TILE); g.clip();
    g.strokeStyle = 'rgba(150,120,85,0.9)'; g.lineWidth = 1.5;
    for (const sg of w.pathsInChunk(cx, cz)) { g.beginPath(); g.moveTo(this.P(sg[0]), this.P(sg[1])); g.lineTo(this.P(sg[2]), this.P(sg[3])); g.stroke(); }
    g.fillStyle = '#b09a78';
    for (const b of w.housesInChunk(cx, cz)) g.fillRect(this.P(b.x0), this.P(b.z0), (b.x1 - b.x0) * S, (b.z1 - b.z0) * S);
    for (const mk of (w.desert ? w.desert.mapMarks : [])) {
      if (mk.x + mk.w / 2 < x0 || mk.x - mk.w / 2 > x0 + CH || mk.z + mk.d / 2 < z0 || mk.z - mk.d / 2 > z0 + CH) continue;
      g.fillStyle = mk.color;
      if (mk.zone) { g.beginPath(); g.arc(this.P(mk.x), this.P(mk.z), (mk.w / 2) * S, 0, 7); g.fill(); continue; }
      if (mk.dot) { g.beginPath(); g.arc(this.P(mk.x), this.P(mk.z), 2.2, 0, 7); g.fill(); }
      else { g.fillRect(this.P(mk.x - mk.w / 2), this.P(mk.z - mk.d / 2), mk.w * S, mk.d * S); g.strokeStyle = 'rgba(60,40,20,0.8)'; g.beginPath(); g.moveTo(this.P(mk.x - mk.w / 2), this.P(mk.z - mk.d / 2)); g.lineTo(this.P(mk.x + mk.w / 2), this.P(mk.z + mk.d / 2)); g.moveTo(this.P(mk.x + mk.w / 2), this.P(mk.z - mk.d / 2)); g.lineTo(this.P(mk.x - mk.w / 2), this.P(mk.z + mk.d / 2)); g.stroke(); }
    }
    g.restore();
  }

  toggle() { this.big = !this.big; this.cv.classList.toggle('big', this.big); }

  isRevealed(x, z) {
    return this.revealed.has(Math.floor((z + HALF) / CH) * NCH + Math.floor((x + HALF) / CH));
  }

  draw(p, yaw, zombies, supplies) {
    const cv = this.cv, ctx = this.ctx, dp = devicePixelRatio;
    const size = this.big ? Math.min(innerWidth, innerHeight) * 0.78 : 190;
    const px = Math.round(size * dp);
    if (cv.width !== px) { cv.width = cv.height = px; cv.style.width = cv.style.height = size + 'px'; }
    const W = cv.width, P = this.P;
    ctx.save();
    ctx.clearRect(0, 0, W, W);
    if (this.big) {
      const k = W / this.bg.width;       // texture pixels -> canvas pixels
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.bg, 0, 0, W, W);
      ctx.font = `${Math.round(11 * dp)}px Segoe UI, sans-serif`; ctx.textAlign = 'center';
      for (const v of this.world.VILLAGES) {
        if (!this.isRevealed(v.x, v.z)) continue;
        ctx.fillStyle = 'rgba(200,60,50,0.95)'; ctx.beginPath(); ctx.arc(P(v.x) * k, P(v.z) * k, 3.5 * dp, 0, 7); ctx.fill();
        ctx.fillStyle = '#e4d6c4'; ctx.fillText(v.name + (v.boss && !v.bossDead ? ' ☠' : ''), P(v.x) * k, P(v.z) * k - 8 * dp);
      }
      for (const mk of (this.world.desert ? this.world.desert.mapMarks : [])) {
        if (!this.isRevealed(mk.x, mk.z)) continue;
        ctx.fillStyle = '#e8d4a8'; ctx.fillText(mk.label, P(mk.x) * k, P(mk.z) * k - (mk.dot ? 6 * dp : (mk.d * S * k) / 2 + 4));
      }
      for (const stone of this.waystones?.nodes ?? []) if (this.waystones.active.has(stone.id)) {
        const x = P(stone.x) * k, z = P(stone.z) * k;
        ctx.fillStyle = '#a5ffe1'; ctx.fillRect(x - 3 * dp, z - 3 * dp, 6 * dp, 6 * dp);
        if (stone.id !== 'camp') ctx.fillText(stone.name, x, z + 13 * dp);
      }
      ctx.fillStyle = '#ffb35a'; ctx.beginPath(); ctx.arc(P(CAMP.x) * k, P(CAMP.z) * k, 3.5 * dp, 0, 7); ctx.fill();
      ctx.fillStyle = '#e4d6c4'; ctx.fillText('CAMP', P(CAMP.x) * k, P(CAMP.z) * k + 14 * dp);
      this.arrow(ctx, P(p.x) * k, P(p.z) * k, -yaw, 8 * dp);
      ctx.fillStyle = 'rgba(220,225,235,0.7)'; ctx.fillText('N', W / 2, 14 * dp);
      ctx.strokeStyle = 'rgba(220,225,235,0.6)'; ctx.lineWidth = 2; ctx.strokeRect(1, 1, W - 2, W - 2);
      ctx.restore();
      return;
    }
    // rotating minimap centred on the player (forward = up)
    const scale = (W / 2) / (MINI_R * S);
    ctx.beginPath(); ctx.arc(W / 2, W / 2, W / 2 - 2, 0, 7); ctx.clip();
    ctx.fillStyle = '#05070c'; ctx.fillRect(0, 0, W, W);
    ctx.translate(W / 2, W / 2);
    ctx.rotate(yaw);
    ctx.scale(scale, scale);
    ctx.translate(-P(p.x), -P(p.z));
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.bg, 0, 0);
    const dot = (x, z, r, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(P(x), P(z), r / scale, 0, 7); ctx.fill(); };
    for (const u of supplies) if (Math.hypot(u.x - p.x, u.z - p.z) < 35) dot(u.x, u.z, 2.6 * dp, u.type === 'med' ? '#ff5a5a' : u.type === 'battery' ? '#5ad8ff' : '#e6d35a');
    for (const z of zombies) {
      if (z.dead || z.state === 'dormant') continue;
      const d = Math.hypot(z.x - p.x, z.z - p.z);
      if (z.heavy && d < 90) dot(z.x, z.z, 5 * dp, '#ff2020');
      else if (d < 30 || (z.state === 'chase' && d < 50)) dot(z.x, z.z, 2.8 * dp, '#d42a2a');
    }
    ctx.restore();
    ctx.save();
    this.arrow(ctx, W / 2, W / 2, 0, 7 * dp);
    ctx.strokeStyle = 'rgba(200,210,225,0.45)'; ctx.lineWidth = 2 * dp;
    ctx.beginPath(); ctx.arc(W / 2, W / 2, W / 2 - 2, 0, 7); ctx.stroke();
    ctx.fillStyle = 'rgba(220,225,235,0.8)'; ctx.font = `${Math.round(10 * dp)}px Segoe UI, sans-serif`; ctx.textAlign = 'center';
    const nx = W / 2 + Math.sin(yaw) * (W / 2 - 12 * dp), ny = W / 2 - Math.cos(yaw) * (W / 2 - 12 * dp);
    ctx.fillText('N', nx, ny + 4 * dp);
    ctx.restore();
  }

  arrow(ctx, x, y, rot, r) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
    ctx.fillStyle = '#f2f4f8'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(r * 0.65, r * 0.75); ctx.lineTo(0, r * 0.35); ctx.lineTo(-r * 0.65, r * 0.75); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
}
