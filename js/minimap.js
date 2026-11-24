import { HALF, SIZE, CABIN, CAMP, DARK, darkness } from './world.js';

const RES = 400;               // background resolution (2.5 m per pixel)
const MINI_R = 75;             // metres shown from the centre of the minimap

export class Minimap {
  constructor(canvas, world) {
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.world = world; this.big = false;
    // pre-render the whole map once
    const bg = document.createElement('canvas'); bg.width = bg.height = RES;
    const g = bg.getContext('2d'), id = g.createImageData(RES, RES);
    for (let j = 0; j < RES; j++) for (let i = 0; i < RES; i++) {
      const x = -HALF + (i + 0.5) * SIZE / RES, z = -HALF + (j + 0.5) * SIZE / RES;
      const c = world.mapColor(x, z), dk = 1 - darkness(x, z) * 0.55, k = (j * RES + i) * 4;
      id.data[k] = c[0] * dk; id.data[k + 1] = c[1] * dk; id.data[k + 2] = c[2] * dk; id.data[k + 3] = 255;
    }
    g.putImageData(id, 0, 0);
    const s = RES / SIZE, P = (x) => (x + HALF) * s;
    // paths
    g.strokeStyle = 'rgba(150,120,85,0.85)'; g.lineWidth = 1.6;
    for (const sg of world.SEGS) { g.beginPath(); g.moveTo(P(sg[0]), P(sg[1])); g.lineTo(P(sg[2]), P(sg[3])); g.stroke(); }
    // buildings
    g.fillStyle = '#a08a6a';
    for (const h of world.houses) {
      const rot = Math.abs(Math.round(Math.sin(h.ry)));
      const w = (rot ? h.d : h.w) * s, d = (rot ? h.w : h.d) * s;
      g.fillRect(P(h.x) - w / 2, P(h.z) - d / 2, w, d);
    }
    this.bg = bg; this.s = s; this.P = P;
  }

  toggle() { this.big = !this.big; this.cv.classList.toggle('big', this.big); }

  draw(p, yaw, zombies, supplies) {
    const cv = this.cv, ctx = this.ctx;
    const size = this.big ? Math.min(innerWidth, innerHeight) * 0.78 : 190;
    const px = Math.round(size * devicePixelRatio);
    if (cv.width !== px) { cv.width = cv.height = px; cv.style.width = cv.style.height = size + 'px'; }
    const W = cv.width, s = this.s, P = this.P;
    ctx.save();
    ctx.clearRect(0, 0, W, W);
    if (this.big) {
      const k = W / RES;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.bg, 0, 0, W, W);
      ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(0, 0, W, W);
      ctx.font = `${Math.round(11 * devicePixelRatio)}px Segoe UI, sans-serif`; ctx.textAlign = 'center';
      for (const v of this.world.VILLAGES) {
        ctx.fillStyle = 'rgba(200,60,50,0.9)'; ctx.beginPath(); ctx.arc(P(v.x) * k, P(v.z) * k, 4 * devicePixelRatio, 0, 7); ctx.fill();
        ctx.fillStyle = '#e4d6c4'; ctx.fillText(v.name + (v.boss && !v.bossDead ? ' ☠' : ''), P(v.x) * k, P(v.z) * k - 10 * devicePixelRatio);
      }
      ctx.fillStyle = '#ffb35a'; ctx.beginPath(); ctx.arc(P(CAMP.x) * k, P(CAMP.z) * k, 4 * devicePixelRatio, 0, 7); ctx.fill();
      ctx.fillStyle = '#e4d6c4'; ctx.fillText('CAMP', P(CAMP.x) * k, P(CAMP.z) * k + 16 * devicePixelRatio);
      ctx.fillText('CABIN', P(CABIN.x) * k, P(CABIN.z) * k + 16 * devicePixelRatio);
      this.arrow(ctx, P(p.x) * k, P(p.z) * k, -yaw, 9 * devicePixelRatio);
      ctx.strokeStyle = 'rgba(220,225,235,0.6)'; ctx.lineWidth = 2; ctx.strokeRect(1, 1, W - 2, W - 2);
      ctx.restore();
      return;
    }
    // rotating minimap centred on the player (forward = up)
    const scale = (W / 2) / (MINI_R * s);
    ctx.beginPath(); ctx.arc(W / 2, W / 2, W / 2 - 2, 0, 7); ctx.clip();
    ctx.fillStyle = '#05070c'; ctx.fillRect(0, 0, W, W);
    ctx.translate(W / 2, W / 2);
    ctx.rotate(yaw);
    ctx.scale(scale, scale);
    ctx.translate(-P(p.x), -P(p.z));
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.bg, 0, 0);
    const dot = (x, z, r, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(P(x), P(z), r / scale, 0, 7); ctx.fill(); };
    for (const u of supplies) if (Math.hypot(u.x - p.x, u.z - p.z) < 35) dot(u.x, u.z, 2.6 * devicePixelRatio, u.type === 'med' ? '#ff5a5a' : u.type === 'battery' ? '#5ad8ff' : '#e6d35a');
    for (const z of zombies) {
      if (z.dead || z.state === 'dormant') continue;
      const d = Math.hypot(z.x - p.x, z.z - p.z);
      if (z.brute && d < 90) dot(z.x, z.z, 5 * devicePixelRatio, '#ff2020');
      else if (d < 30 || (z.state === 'chase' && d < 50)) dot(z.x, z.z, 2.8 * devicePixelRatio, '#d42a2a');
    }
    ctx.restore();
    ctx.save();
    this.arrow(ctx, W / 2, W / 2, 0, 7 * devicePixelRatio);
    ctx.strokeStyle = 'rgba(200,210,225,0.45)'; ctx.lineWidth = 2 * devicePixelRatio;
    ctx.beginPath(); ctx.arc(W / 2, W / 2, W / 2 - 2, 0, 7); ctx.stroke();
    ctx.fillStyle = 'rgba(220,225,235,0.8)'; ctx.font = `${Math.round(10 * devicePixelRatio)}px Segoe UI, sans-serif`; ctx.textAlign = 'center';
    const nx = W / 2 + Math.sin(yaw) * (W / 2 - 12 * devicePixelRatio), ny = W / 2 - Math.cos(yaw) * (W / 2 - 12 * devicePixelRatio);
    ctx.fillText('N', nx, ny + 4 * devicePixelRatio);
    ctx.restore();
  }

  arrow(ctx, x, y, rot, r) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
    ctx.fillStyle = '#f2f4f8'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(r * 0.65, r * 0.75); ctx.lineTo(0, r * 0.35); ctx.lineTo(-r * 0.65, r * 0.75); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
}
