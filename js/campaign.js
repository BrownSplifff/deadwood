import { button } from './companions.js';
import { GENERATION_VERSION, SAVE_VERSION, isValidSave, readSave, writeSave } from './save.js';
import { Waystones, safeBeside } from './waystones.js';

const limbNames = ['armL', 'armR', 'legL', 'legR'];

const stateKeys = ['survive', 'kills', 'wave', 'wavesCleared', 'waveState', 'prepT', 'toSpawn', 'spawnT',
  'flashOn', 'battery', 'infection', 'supplyT', 'ambientT', 'dogT', 'giantT', 'eventT'];
const pick = (target, keys) => Object.fromEntries(keys.map((k) => [k, target[k]]));
const fadeDelay = () => new Promise((resolve) => setTimeout(resolve, 220));

export class Campaign {
  constructor(context) {
    Object.assign(this, context);
    this.stones = new Waystones(this.scene, this.world, this.audio, this.camp, this.plan);
    this.minimap.waystones = this.stones;
    this.continueButton = document.getElementById('btn-continue');
    this.newGameButton = document.getElementById('btn-play');
    this.status = document.getElementById('save-status');
    this.fade = document.createElement('div');
    this.fade.id = 'travel-fade'; document.body.append(this.fade);
  }
  reset() {
    this.stones.active.clear(); this.partialLoot.clear();
    for (const p of this.stones.nodes) { p.pulse = 0; p.soundAt = 0; }
    this.panel.hidden = true;
  }
  valid(s) {
    return isValidSave(s, this.seed, this.items, this.species, this.weapon.guns) &&
      stateKeys.every((k) => (typeof s.state[k] === (k === 'waveState' ? 'string' : k === 'flashOn' ? 'boolean' : 'number')) &&
        (typeof s.state[k] !== 'number' || Number.isFinite(s.state[k]))) &&
      s.enemies.every((e) => Object.hasOwn(this.zombieTypes, e.type));
  }
  async refresh() {
    this.newGameButton.disabled = true;
    try {
      const s = await readSave();
      this.hasRecord = s !== undefined;
      this.continueButton.disabled = !this.valid(s);
      this.status.textContent = this.hasRecord && this.continueButton.disabled ? 'The saved campaign is incompatible or damaged.' : '';
    } catch {
      this.status.textContent = 'Local save storage is unavailable.';
    } finally { this.newGameButton.disabled = false; }
  }
  restricted(travel = false) {
    const { G, player, zombies, mummy, worms, world } = this;
    if (!['playing', 'world-panel'].includes(G.mode) || player.health <= 0 || G.transformT || G.grabbed ||
        ![player.pos.x, player.pos.y, player.pos.z].every(Number.isFinite) || !player.onGround) return 'You cannot use a waystone here.';
    if (G.survive - G.lastDamage < 5) return 'Wait five seconds after taking damage.';
    const boss = zombies.boss();
    if (mummy.active || (boss && boss.dist < 55 && ['chase', 'attack'].includes(boss.state))) return 'You cannot use a waystone during a boss fight.';
    if (travel && (zombies.list.some((e) => !e.dead && (e.state === 'attack' || (e.dist < 12 && e.state === 'chase'))) ||
        this.dogs.list.some((d) => !d.dead && d.state === 'chase' && Math.hypot(d.x - player.pos.x, d.z - player.pos.z) < 12) ||
        this.hanging.acid.some((a) => a.m.position.distanceTo(player.pos) < 16) ||
        [...this.npcs.camps.values()].some((c) => this.npcs.hostile.has(c.cp.id) && c.cultists.some((e) => !e.dead && Math.hypot(e.x - player.pos.x, e.z - player.pos.z) < 12)) ||
        (worms.active && ['hunt', 'lock', 'erupt'].includes(worms.active.state)) || world.isWater(player.pos.x, player.pos.z))) {
      return 'Leave combat before travelling.';
    }
    return '';
  }
  snapshot() {
    const { G, player, weapon, supplies, zombies } = this;
    return {
      version: SAVE_VERSION, generation: GENERATION_VERSION, seed: this.seed,
      player: { ...pick(player, ['health', 'stamina', 'yaw', 'pitch']), x: player.pos.x, y: player.pos.y, z: player.pos.z },
      state: pick(G, stateKeys), ammo: weapon.guns.map((g) => pick(g, ['mag', 'reserve'])), weapon: weapon.cur,
      slots: this.inventory.slots.map((s) => s && { ...s }), progress: { ...this.progress },
      taken: [...this.taken], partial: [...this.partialLoot], nests: [...this.clearedNests],
      hanging: [...this.hanging.killed], cultists: [...this.npcs.killed], hostile: [...this.npcs.hostile],
      villages: this.villages.flatMap((s, i) => s.v.bossDead ? [i] : []),
      worms: this.worms.zones.flatMap((z, i) => z.dead ? [i] : []),
      explored: [...this.minimap.revealed], stones: [...this.stones.active], animals: this.animals.snapshot(),
      blood: this.world.bloodStains(),
      supplies: supplies.filter((s) => !s.id).map((s) => pick(s, ['type', 'x', 'z', 'base', 'count', 'persist', 'fixed'])),
      enemies: zombies.list.filter((e) => !e.dead && e.tag === 'wave').map((e) => ({
        ...pick(e, ['type', 'x', 'z', 'hp', 'yaw', 'state', 'crawl', 'armsLost', 'speedMul']),
        broken: limbNames.filter((name) => e.parts[name].stump.visible),
      })),
    };
  }
  async save() {
    const data = this.snapshot();
    if (!this.valid(data)) throw new Error('The current state cannot be saved.');
    await writeSave(data);
    this.hasRecord = true; this.continueButton.disabled = false; this.status.textContent = '';
  }
  restore(s) {
    const { world, player, zombies, npcs, hanging, supplies, mummy, minimap } = this;
    this.resetGame();
    Object.assign(this.G, s.state);
    Object.assign(this.progress, s.progress);
    mummy.defeated = !!s.progress.desertBossDefeated;
    for (const mesh of supplies.splice(0)) this.scene.remove(mesh.mesh);
    hanging.clear(); npcs.clear(); mummy.unload();
    this.clearedNests.clear();
    const replace = (set, list) => { set.clear(); list.forEach((key) => set.add(key)); };
    replace(this.taken, s.taken); replace(this.hanging.killed, s.hanging); replace(npcs.killed, s.cultists);
    replace(npcs.hostile, s.hostile); replace(this.clearedNests, s.nests); replace(this.stones.active, s.stones);
    this.partialLoot.clear(); s.partial.forEach(([id, n]) => this.partialLoot.set(id, n));
    this.worms.zones.forEach((z, i) => { z.dead = s.worms.includes(i); });
    this.villages.forEach((v, i) => { v.v.bossDead = s.villages.includes(i); });
    minimap.reset(); s.explored.forEach((ci) => minimap.reveal(ci));
    world.forEachLoaded((ci) => hanging.onChunkUnload(ci));
    world.rebuildChunks(s.player.x, s.player.z);
    for (const st of world.desert.list) if (world.desert.built.has(st.id)) this.onStructLoad(st);
    world.desert.update(0, this.G.T, s.player.x, s.player.y, s.player.z);
    Object.assign(player, pick(s.player, ['health', 'stamina', 'yaw', 'pitch']));
    player.pos.set(s.player.x, s.player.y, s.player.z);
    world.resolve(player.pos, 0.4, player.pos.y);
    this.inventory.slots = s.slots.map((slot) => slot && { ...slot }); this.inventory.changed();
    this.weapon.cur = this.weapon.next = s.weapon;
    this.weapon.guns.forEach((g, i) => { Object.assign(g, s.ammo[i]); g.group.visible = i === s.weapon; });
    this.animals.restore(s.animals);
    for (const p of s.blood) world.addBlood(p.x, p.z, p.angle, p.s);
    for (const p of s.supplies) this.addSupply(p.type, p.x, p.z, p.base - 0.13, pick(p, ['count', 'fixed', 'persist']));
    zombies.hpMul = 1 + Math.max(0, this.G.wave - 5) * 0.06;
    zombies.spdMul = 1 + Math.min(0.25, Math.max(0, this.G.wave - 5) * 0.03);
    for (const e of s.enemies) {
      const z = zombies.spawn(e.type, e.x, e.z, 'wave', world.desertWeight(e.x, e.z) > 0.5);
      Object.assign(z, pick(e, ['hp', 'yaw', 'crawl', 'armsLost', 'speedMul']));
      for (const name of e.broken) {
        const limb = z.parts[name];
        (limb.el ?? limb.kn).visible = false; limb.stump.visible = true;
      }
      z.state = ['chase', 'attack', 'stalk'].includes(e.state) ? 'chase' : 'idle';
    }
  }
  async continue() {
    if (this.busy) return;
    this.busy = true;
    try {
      const s = await readSave();
      if (!this.valid(s)) throw new Error('The saved campaign is incompatible or damaged.');
      this.restore(s);
      this.G.mode = 'paused';
      this.audio.init();
      // Some browsers require a fresh user gesture after IndexedDB completes.
      this.panel.hidden = false; this.panel.replaceChildren();
      button(this.panel, 'Resume saved game', this.closeWorldPanel);
    } catch (error) { this.status.textContent = error.message || 'Unable to read local save.'; }
    finally { this.busy = false; }
  }
  async interact(origin) {
    if (this.busy) return;
    const reason = this.restricted();
    if (reason) { this.toast(reason); return; }
    this.openWorldPanel();
    if (this.stones.active.has(origin.id)) { this.menu(origin); return; }
    this.busy = true;
    this.panel.textContent = 'Awakening waystone…';
    this.stones.activate(origin);
    try {
      await this.save();
      this.menu(origin, 'Waystone awakened. Game saved.');
    } catch {
      this.stones.active.delete(origin.id);
      this.message('The waystone could not save your game.');
    } finally { this.busy = false; }
  }
  message(msg) {
    const text = document.createElement('p'); text.textContent = msg;
    this.panel.replaceChildren(text); button(this.panel, 'Return', this.closeWorldPanel);
  }
  menu(origin, message = '') {
    const title = document.createElement('h2'), text = document.createElement('p');
    title.textContent = origin.name; text.textContent = message || origin.biome;
    this.panel.replaceChildren(title, text);
    button(this.panel, 'Save Game', async () => {
      if (this.busy) return;
      const reason = this.restricted();
      if (reason) { this.menu(origin, reason); return; }
      this.busy = true;
      try { await this.save(); this.menu(origin, 'Game saved.'); }
      catch { this.menu(origin, 'Unable to save your game.'); }
      finally { this.busy = false; }
    });
    button(this.panel, 'Fast Travel', () => this.travelMenu(origin));
    button(this.panel, 'Return', () => { if (!this.busy) this.closeWorldPanel(); });
  }
  travelMenu(origin) {
    const reason = this.restricted(true);
    if (reason || this.busy) { if (reason) this.menu(origin, reason); return; }
    const title = document.createElement('h2');
    title.textContent = 'Fast travel from ' + origin.name;
    const map = document.createElement('canvas'); map.width = map.height = 210;
    const ctx = map.getContext('2d'); ctx.drawImage(this.minimap.bg, 0, 0, 210, 210);
    const legend = document.createElement('p'); legend.textContent = 'North is up. Gold marks your current location.';
    this.panel.replaceChildren(title, legend, map);
    const destinations = this.stones.nodes.filter((p) => this.stones.active.has(p.id));
    for (const p of destinations) {
      ctx.fillStyle = p === origin ? '#ffc353' : '#a5ffe1';
      ctx.beginPath(); ctx.arc((p.x + 2000) * 210 / 4000, (p.z + 2000) * 210 / 4000, 3.5, 0, Math.PI * 2); ctx.fill();
      if (p !== origin) button(this.panel, p.name + ' · ' + p.biome, () => this.travel(origin, p));
    }
    if (destinations.length < 2) legend.textContent = 'Awaken another waystone to unlock travel.';
    button(this.panel, 'Back', () => this.menu(origin));
  }
  async travel(origin, dest) {
    if (this.busy || origin === dest || !this.stones.active.has(origin.id) || !this.stones.active.has(dest.id) ||
        this.stones.near(this.player) !== origin) return;
    const reason = this.restricted(true);
    if (reason) { this.menu(origin, reason); return; }
    this.busy = true;
    const { player, world, animals, hanging, fx, zombies } = this;
    this.fade.classList.add('opaque');
    try {
      await fadeDelay();
      world.updateChunks(dest.x, dest.z, true);
      const a = animals.companion, spec = a && this.species[a.species];
      world.desert.update(0, this.G.T, dest.x, dest.y, dest.z);
      const spawn = safeBeside(world, dest.x, dest.z, 0.4);
      const companion = a && !a.dead ? safeBeside(world, dest.x, dest.z, spec.radius, 4.5, spec.eye + 0.4) : null;
      if (!spawn || (a && !a.dead && !companion)) {
        world.updateChunks(origin.x, origin.z, true);
        world.desert.update(0, this.G.T, origin.x, origin.y, origin.z);
        this.menu(origin, 'No safe arrival point is available.'); return;
      }
      player.pos.set(spawn.x, spawn.y, spawn.z);
      player.vx = player.vy = player.vz = 0;
      if (companion) Object.assign(a, companion, { speed: 0 });
      for (const p of hanging.acid.splice(0)) this.scene.remove(p.m);
      this.dogs.clear(); this.worms.clear(); this.npcs.clearSpells(); fx.clear();
      for (const e of [...zombies.list]) {
        if (e.tag === 'rail') continue;
        if (!e.dead && e.tag === 'wave') this.G.toSpawn++;
        if (!e.dead && e.nestId) continue;
        zombies.remove(e);
      }
      this.villages.forEach((v) => { v.populated = false; });
      try { await this.save(); this.toast('Arrival saved.'); }
      catch { this.toast('Arrived, but the game could not save.'); }
      this.closeWorldPanel();
    } catch {
      this.menu(origin, 'Travel could not be completed.');
    } finally { this.fade.classList.remove('opaque'); this.busy = false; }
  }
}
