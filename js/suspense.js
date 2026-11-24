import { pick, rand } from './util.js';

const EVENTS = {
  forest: ['branch', 'rustle', 'twig', 'steps', 'scream', 'whisper', 'cough'],
  deep: ['groan', 'thud', 'twisted', 'clicks', 'rustle', 'silence', 'whisper'],
  hanging: ['chain', 'groan', 'whisper', 'scream', 'twig'],
  railway: ['metal', 'door', 'chain', 'scratch', 'whistle', 'steps'],
  desert: ['sand', 'groan', 'whisper', 'thud', 'cough'],
  storm: ['sand', 'whisper', 'thud', 'groan'],
  sheltered: ['metal', 'chain', 'whisper', 'thud'],
};
export const SUSPENSE = { forest: [25, 60], deep: [15, 40], hanging: [10, 30], railway: [15, 40] };

export class Suspense {
  constructor(audio, world, camp) {
    Object.assign(this, { audio, world, camp });
    this.source = { x: 0, y: 0, z: 0 };
    this.reset();
  }
  reset() {
    this.timer = 28; this.silence = 0; this.last = null; this.echo = 0;
    this.audio.setSuspenseSilence(false);
  }
  update(dt, player, weather, nearbyCoach, indoors, combat, enemies) {
    this.silence = Math.max(0, this.silence - dt);
    if (combat) this.silence = 0;
    this.audio.setSuspenseSilence(this.silence > 0);
    const moving = player.hspeed > 1.2;
    if (this.echo > 0 && (!moving || combat)) this.echo = 0;
    if (this.echo > 0 && (this.echo -= dt) <= 0) this.audio.horror('steps', this.source, 0.58);
    this.timer -= dt;
    if (this.timer > 0) return;
    if (combat) { this.timer = rand(6, 11); return; }
    const p = player.pos, distance = Math.hypot(p.x - this.camp.x, p.z - this.camp.z);
    const desert = this.world.desertWeight(p.x, p.z), ring = this.world.ringWeight(p.x, p.z);
    const profile = indoors ? 'sheltered' : desert > 0.55 ? (weather.sand > 0.52 ? 'storm' : 'desert') :
      nearbyCoach ? 'railway' : ring > 0.55 ? 'hanging' : this.world.canopyCover(p.x, p.z) > 0.55 ? 'deep' : 'forest';
    const pace = (player.health < 30 ? 1.25 : 1) * (enemies ? 1.15 : 1);
    this.timer = rand(...(SUSPENSE[profile] ?? SUSPENSE.forest)) * pace * (distance < 45 ? 1.5 : 1);
    const event = pick(EVENTS[profile].filter((e) => e !== this.last && (e !== 'steps' || moving)));
    this.last = event;
    if (event === 'silence') { this.silence = rand(4, 8); return; }
    const angle = player.yaw + rand(-1.15, 1.15), r = rand(7, 17) * (event === 'scream' || event === 'whistle' ? 4 : 1);
    const fixed = nearbyCoach && ['metal', 'scratch', 'door', 'chain'].includes(event);
    const out = this.source;
    out.x = fixed ? nearbyCoach.x : p.x + Math.sin(angle) * r;
    out.y = fixed ? nearbyCoach.y + 1.1 : p.y + (event === 'groan' ? 7 : 0.4);
    out.z = fixed ? nearbyCoach.z : p.z + Math.cos(angle) * r;
    this.audio.horror(event, out, rand(0.72, 1.12));
    if (event === 'steps' && moving) this.echo = 0.68;
  }
}
