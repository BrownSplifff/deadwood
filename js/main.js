import * as THREE from '../lib/three.module.min.js';
import { clamp, lerp, damp, rand, pick, fmtTime } from './util.js';
import { createWorld, CAMP, CABIN, SPAWN, VILLAGES, DESERT_PLAN } from './world.js';
import { GameAudio } from './audio.js';
import { Particles } from './fx.js';
import { Player, PCFG } from './player.js';
import { Weapon, GUNS } from './weapon.js';
import { Zombies } from './zombies.js';
import { Fauna } from './fauna.js';
import { Minimap } from './minimap.js';
import { HangingDead } from './hazards.js';
import { NPCs } from './npcs.js';
import { Mummy } from './mummy.js';
import { Inventory, InventoryUI, ITEMS } from './inventory.js';
import { Dogs } from './dogs.js';
import { SandWorms } from './worms.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');

// ------------------------------------------------------------------ settings
const dpr = window.devicePixelRatio || 1;
const QUALITY = {
  low:    { pr: 0.75, shadows: 0,    treeFrac: 0.5,  lodNear: 22, grassDensity: 1, grassRadius: 22, fog: 62, maxZ: 12, ambient: 3, zShadow: false, particles: 150, mist: 8 },
  medium: { pr: 1,    shadows: 1024, treeFrac: 0.75, lodNear: 30, grassDensity: 2, grassRadius: 30, fog: 78, maxZ: 16, ambient: 5, zShadow: false, particles: 250, mist: 16 },
  high:   { pr: Math.min(dpr, 1.5), shadows: 2048, treeFrac: 1, lodNear: 40, grassDensity: 3, grassRadius: 38, fog: 92, maxZ: 22, ambient: 7, zShadow: true, particles: 320, mist: 26 },
};
const settings = { sens: 1, vol: 0.8, quality: 'medium' };
try { Object.assign(settings, JSON.parse(localStorage.getItem('deadwood-settings') || '{}')); } catch (e) { /* ignore */ }
if (!QUALITY[settings.quality]) settings.quality = 'medium';
const saveSettings = () => { try { localStorage.setItem('deadwood-settings', JSON.stringify(settings)); } catch (e) { /* ignore */ } };

const CFG = { prepTime: 15, firstPrep: 10, supplyEvery: 22, maxSupplies: 14, pickupRange: 2.4, medHeal: 50, batteryLife: 300, maxSpares: 5 };

// ------------------------------------------------------------------ renderer / scene
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: settings.quality !== 'low', powerPreference: 'high-performance' });
renderer.autoClear = false;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.35;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, 1, 0.05, 2600);
camera.rotation.order = 'YXZ';
scene.add(camera);

const audio = new GameAudio();
audio.setVolume(settings.vol);
const world = createWorld(scene);
audio.setFire(world.firePos);
const fx = new Particles(scene, 320);
const player = new Player(camera, world, audio);
const zombies = new Zombies(scene, world, audio, fx);
const fauna = new Fauna(scene, world, audio);
const minimap = new Minimap($('minimap'), world);
const hanging = new HangingDead(scene, world, audio, fx);
const npcs = new NPCs(scene, world, audio, fx);
const mummy = new Mummy(scene, world, audio, fx, zombies);
const dogs = new Dogs(scene, world, audio, fx);
const worms = new SandWorms(scene, world, audio, fx, DESERT_PLAN.zones);
const inventory = new Inventory(12);
const PROGRESS = { desertBossDefeated: false, biome3Unlocked: false };   // session progression flags

const flashlight = new THREE.SpotLight(0xfff1d2, 140, 50, 0.4, 0.55, 1.5);
flashlight.position.set(0.14, -0.12, 0.05);
flashlight.target.position.set(0.14, -0.12, -6);
camera.add(flashlight, flashlight.target);
const muzzleLight = new THREE.PointLight(0xffa24a, 0, 16, 2);
scene.add(muzzleLight);

const G = {
  mode: 'menu', noLock: false,
  survive: 0, kills: 0, wave: 1, wavesCleared: 0, waveState: 'prep', prepT: CFG.firstPrep, toSpawn: 0, spawnT: 0,
  flashOn: true, battery: 100, flickT: 0, dmgFlash: 0, hbT: 0, hitT: 0, deadT: 0, supplyT: CFG.supplyEvery, T: 0, bannerT: 0, areaT: 0,
  lookDX: 0, lookDY: 0, mouseDown: false, adsHeld: false, dark: 0, eventT: 20, ambientT: 2, lastArea: null, darkMsgT: 0,
  infection: 0, shake: 0, dogT: 15, giantT: 20, wormZone: null, transformT: 0, grabbed: null, cause: '', biome: 'forest', indoor: 0, nestT: 0, ringT: 0, breathT: 10, toastT: 0, infHbT: 5,
};
const keys = {};
const supplies = [];
const vstate = VILLAGES.map((v) => ({ v, populated: false }));

const weapon = new Weapon({
  camera, world, zombies, fx, audio, player, muzzleLight,
  hooks: {
    dmgMul: () => 1 + 0.3 * G.infection,
    extraRay: (o, d, maxT) => extraRay(o, d, maxT),
    onHit(res, zone) {
      G.hitT = 0.16;
      $('hitmarker').className = 'show' + (res.killed ? ' kill' : zone === 'head' ? ' head' : res.broke ? ' limb' : '');
      audio.hitmarker();
    },
    onShot(def, o) {
      worms.noise(o.x, o.z, def.loud / 4.5);
      dogs.alert(o.x, o.z, def.loud * 0.8);
      // sound-sensitive zombies out in the dark come for the noise
      if (def.loud >= 60 && Math.random() < def.loud / 450 && zombies.count('ambient') < QUALITY[settings.quality].ambient + 4) {
        const sp = world.findSpot(o.x, o.z, 55, 85, player.yaw);
        if (sp) { const e = zombies.spawn(rollType(0.2), sp.x, sp.z, 'ambient'); e.state = 'investigate'; e.tx = o.x + rand(-5, 5); e.tz = o.z + rand(-5, 5); e.invT = 20; }
      }
    },
  },
});

zombies.onKill = (e) => {
  G.kills++;
  if (e.nestId) { clearedNests.add(e.nestId); nests.delete(e.nestId); }
  // every ordinary zombie drops one piece of infected flesh (exactly once)
  if (!e.brute && !e.dropped) { e.dropped = true; dropItem('flesh', 1, e.x + rand(-0.6, 0.6), e.z + rand(-0.6, 0.6)); }
  if (e.brute) {
    const v = e.village; if (v) v.bossDead = true;
    showBanner('THE BUTCHER IS DEAD', 'he dropped his supplies');
    for (const t of ['ammo', 'ammo', 'med', 'battery']) addSupply(t, e.x + rand(-2, 2), e.z + rand(-2, 2));
  }
};

function rollType(extraSprint = 0) {
  const w = G.wave, r = Math.random();
  const sprint = (w >= 4 ? Math.min(0.25, 0.08 + 0.03 * (w - 4)) : 0) + extraSprint + G.dark * 0.15;
  const run = w >= 3 ? Math.min(0.5, 0.2 + 0.05 * (w - 3)) : 0.05;
  if (r < sprint) return 'sprinter';
  if (r < sprint + run) return 'runner';
  return 'walker';
}

// ------------------------------------------------------------------ quality / resize
function applyQuality(name) {
  settings.quality = name;
  const q = QUALITY[name];
  renderer.setPixelRatio(q.pr);
  renderer.setSize(innerWidth, innerHeight, false);
  world.setQuality(q, renderer, player.pos.x, player.pos.z);
  zombies.setShadows(q.zShadow);
  zombies.farDist = q.fog;
  fx.limit = q.particles;
  document.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('on', b.dataset.q === name));
  saveSettings();
}
function resize() {
  renderer.setPixelRatio(QUALITY[settings.quality].pr);
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  weapon.resize(camera.aspect);
}
addEventListener('resize', resize);

// ------------------------------------------------------------------ UI plumbing
const screens = ['menu', 'controls', 'settings', 'pause', 'death'];
function showScreen(id) {
  for (const s of screens) $(s).classList.toggle('hidden', s !== id);
  $('screens').style.display = id ? '' : 'none';
}
function showHud(on) { $('hud').classList.toggle('hidden', !on); }
document.querySelectorAll('.settings-block').forEach((blk) => blk.appendChild(document.getElementById('tpl-settings').content.cloneNode(true)));
function syncSettingsUI() {
  document.querySelectorAll('.set-sens').forEach((i) => { i.value = settings.sens; i.nextElementSibling.textContent = (+settings.sens).toFixed(2); });
  document.querySelectorAll('.set-vol').forEach((i) => { i.value = settings.vol; i.nextElementSibling.textContent = Math.round(settings.vol * 100) + '%'; });
  document.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('on', b.dataset.q === settings.quality));
}
document.addEventListener('input', (e) => {
  if (e.target.classList.contains('set-sens')) { settings.sens = +e.target.value; syncSettingsUI(); saveSettings(); }
  if (e.target.classList.contains('set-vol')) { settings.vol = +e.target.value; audio.setVolume(settings.vol); syncSettingsUI(); saveSettings(); }
});
document.addEventListener('click', (e) => {
  const q = e.target.closest('.seg button');
  if (q) { applyQuality(q.dataset.q); syncSettingsUI(); }
  if (e.target.closest('.back')) showScreen(G.mode === 'paused' ? 'pause' : 'menu');
});
$('btn-controls').onclick = () => showScreen('controls');
$('btn-settings').onclick = () => showScreen('settings');
$('slots').innerHTML = GUNS.map((g, i) => `<span data-i="${i}">${g.key} ${g.name.split(' ')[0]}</span>`).join('');

// ------------------------------------------------------------------ game flow
function lockPointer() {
  if (G.noLock) { enterPlaying(); return; }
  const p = canvas.requestPointerLock && canvas.requestPointerLock();
  if (p && p.catch) p.catch(() => { /* handled by pointerlockerror */ });
}
function enterPlaying() {
  G.mode = 'playing';
  showScreen(null); showHud(true);
  audio.init(); audio.resume();
  weapon.group.visible = true;
}
function startGame() { audio.init(); resetGame(); G.mode = 'starting'; lockPointer(); }
function pauseGame() {
  if (G.mode !== 'playing') return;
  G.mode = 'paused';
  G.mouseDown = false; G.adsHeld = false;
  for (const k in keys) keys[k] = false;
  showScreen('pause');
  audio.suspend();
}
function resumeGame() { audio.resume(); G.mode = 'paused'; lockPointer(); }
function toMenu() {
  G.mode = 'menu';
  if (document.pointerLockElement) document.exitPointerLock();
  resetGame();
  weapon.group.visible = false;
  showHud(false); showScreen('menu');
  audio.resume();
}
$('btn-play').onclick = startGame;
$('btn-resume').onclick = resumeGame;
$('btn-restart').onclick = () => { resetGame(); G.mode = 'starting'; lockPointer(); };
$('btn-quit').onclick = toMenu;
$('btn-retry').onclick = () => { resetGame(); G.mode = 'starting'; lockPointer(); };
$('btn-death-menu').onclick = toMenu;

document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  if (locked) { if (G.mode === 'starting' || G.mode === 'paused') enterPlaying(); }
  else if (G.mode === 'playing') pauseGame();
  else if (G.mode === 'starting') { G.mode = 'menu'; showScreen('menu'); }
});
document.addEventListener('pointerlockerror', () => {
  if (G.mode === 'starting') { G.mode = 'menu'; showScreen('menu'); }
  else if (G.mode === 'paused') showScreen('pause');
});
addEventListener('blur', () => { if (G.mode === 'playing' && !G.noLock) pauseGame(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && G.mode === 'playing' && !G.noLock) pauseGame(); });

function resetGame() {
  player.reset(); weapon.reset(); zombies.clear(); fx.clear(); fauna.clear(); world.clearBlood();
  zombies.hpMul = 1; zombies.spdMul = 1;
  Object.assign(G, { survive: 0, kills: 0, wave: 1, wavesCleared: 0, waveState: 'prep', prepT: CFG.firstPrep, toSpawn: 0, spawnT: 0,
    flashOn: true, battery: 100, flickT: 0, dmgFlash: 0, hbT: 0, hitT: 0, deadT: 0, supplyT: CFG.supplyEvery, mouseDown: false, adsHeld: false,
    dark: 0, eventT: 25, ambientT: 2, lastArea: null, darkMsgT: 0 });
  for (const s of vstate) { s.populated = false; s.v.bossDead = false; }
  G.infection = 0; G.transformT = 0; G.grabbed = null; G.cause = ''; G.biome = ''; G.indoor = 0; G.acidFlash = 0;
  $('game').style.filter = '';
  inventory.clear(); inventory.add('battery', 1); inventory.add('ammo', 1); inventory.add('canned', 1); inventory.add('water', 1);
  if (invUI.isOpen) invUI.close();
  hanging.clear(); npcs.clear(); mummy.unload(); dogs.clear(); worms.clear();
  nests.clear(); clearedNests.clear();

  flashlight.visible = true;
  muzzleLight.intensity = 0;
  for (const s of supplies) scene.remove(s.mesh);
  supplies.length = 0; taken.clear();
  seedSupplies();
  minimap.reset();
  world.forEachLoaded((ci, cd) => { addChunkLoot(ci, cd); minimap.reveal(ci); hanging.onChunkLoad(ci, cd); registerChunkNests(ci, cd); });
  for (const st of world.desert.list) if (world.desert.built.has(st.id)) onStructLoad(st);
  if (minimap.big) minimap.toggle();
  $('banner').style.opacity = 0; $('area').style.opacity = 0;
  world.updateChunks(player.pos.x, player.pos.z, true);
}

// ------------------------------------------------------------------ input
addEventListener('keydown', (e) => {
  if (G.mode === 'inventory') {
    if (e.code === 'Tab' || e.code === 'Escape' || e.code === 'KeyI') { e.preventDefault(); closeInventory(); }
    else if (e.code === 'KeyG' && invUI.sel >= 0) dropFromInventory(invUI.sel, false);
    return;
  }
  if (G.mode !== 'playing') return;
  if (e.code === 'Tab') { e.preventDefault(); if (!e.repeat && !G.transformT) openInventory(); return; }
  if (e.code === 'Space' || e.code.startsWith('Control') || e.code === 'Tab' || e.code.startsWith('Arrow')) e.preventDefault();
  if (e.repeat) { keys[e.code] = true; return; }
  keys[e.code] = true;
  switch (e.code) {
    case 'KeyR':
      if (weapon.reserve === 0 && weapon.mag < weapon.gun.def.mag && inventory.remove('ammo', 1)) { weapon.addAmmoAll(); toast('Opened an ammo box'); }
      weapon.startReload(); break;
    case 'KeyH': useType('med'); break;
    case 'KeyF':
      if (G.battery <= 0) { audio.flashlight(); showPromptFlash('Battery dead — press B to replace'); break; }
      G.flashOn = !G.flashOn; audio.flashlight(); break;
    case 'KeyB': replaceBattery(); break;
    case 'KeyX': player.toggleSit(); break;
    case 'KeyE': interact(); break;
    case 'KeyM': minimap.toggle(); break;
    case 'Digit1': weapon.switchTo(0); break;
    case 'Digit2': weapon.switchTo(1); break;
    case 'Digit3': weapon.switchTo(2); break;
  }
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('mousedown', (e) => {
  if (G.mode !== 'playing') return;
  if (e.button === 0) G.mouseDown = true;
  if (e.button === 2) G.adsHeld = true;
});
addEventListener('mouseup', (e) => {
  if (e.button === 0) G.mouseDown = false;
  if (e.button === 2) G.adsHeld = false;
});
addEventListener('wheel', (e) => { if (G.mode === 'playing') weapon.cycle(e.deltaY > 0 ? 1 : -1); }, { passive: true });
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('mousemove', (e) => {
  if (G.mode !== 'playing') return;
  if (!G.noLock && document.pointerLockElement !== canvas) return;
  const dx = e.movementX || 0, dy = e.movementY || 0;
  if (Math.abs(dx) > 300 || Math.abs(dy) > 300) return;
  const zoom = camera.fov / 72;
  const s = 0.0022 * settings.sens * (weapon.scoped ? zoom * 1.2 : 1 - weapon.ads * 0.45);
  player.yaw -= dx * s;
  player.pitch = clamp(player.pitch - dy * s, -1.5, 1.5);
  G.lookDX += dx; G.lookDY += dy;
});

// ------------------------------------------------------------------ flashlight battery
let promptFlash = '', promptFlashT = 0;
function showPromptFlash(t) { promptFlash = t; promptFlashT = 2; }
function replaceBattery() {
  if (inventory.count('battery') <= 0) { showPromptFlash('No spare batteries — search houses and camps'); return false; }
  if (G.battery >= 99) { showPromptFlash('Battery is full'); return false; }
  inventory.remove('battery', 1); G.battery = 100; G.flashOn = true; audio.battery();
  return true;
}
const fd = new THREE.Vector3();
function updateFlashlight(dt) {
  if (G.flashOn && G.battery > 0) G.battery = Math.max(0, G.battery - (100 / CFG.batteryLife) * dt);
  if (G.battery <= 0 && G.flashOn) { G.flashOn = false; showPromptFlash('Battery dead — press B to replace'); }
  flashlight.visible = G.flashOn;
  if (!G.flashOn) return;
  camera.getWorldDirection(fd);
  const p = camera.position;
  let d = world.rayHit(p.x, p.y, p.z, fd.x, fd.y, fd.z, 30);
  const zh = zombies.rayHit(p, fd, Math.min(d, 30));
  if (zh) d = Math.min(d, zh.t);
  if (d === Infinity) d = 30;
  const k = clamp((d - 1.5) / 12.5, 0, 1);
  let target = 34 + 125 * k * k * (3 - 2 * k);
  // a dying battery dims and flickers
  if (G.battery < 20) {
    target *= 0.35 + 0.65 * G.battery / 20;
    if (G.flickT <= 0 && Math.random() < dt * (2 + (20 - G.battery) * 0.4)) G.flickT = rand(0.04, 0.35);
  }
  if (G.flickT > 0) { G.flickT -= dt; target *= Math.random() < 0.5 ? 0.05 : 0.3; flashlight.intensity = target; return; }
  flashlight.intensity = damp(flashlight.intensity, target, 10, dt);
}

// ------------------------------------------------------------------ supplies
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const cylGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);
const SUP = {
  ammo: { body: new THREE.MeshLambertMaterial({ color: 0x4c5a2c, flatShading: true }), trim: new THREE.MeshLambertMaterial({ color: 0xd8b230 }), glow: 0xcfe36a },
  med: { body: new THREE.MeshLambertMaterial({ color: 0xe6e6e0, flatShading: true }), trim: new THREE.MeshBasicMaterial({ color: 0xd32020 }), glow: 0xff5a5a },
  battery: { body: new THREE.MeshLambertMaterial({ color: 0x1a1a1a }), trim: new THREE.MeshLambertMaterial({ color: 0xe0b020 }), glow: 0x5ad8ff },
};
const glowTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
const glowMats = Object.fromEntries(Object.entries(SUP).map(([k, s]) => [k, new THREE.SpriteMaterial({ map: glowTex, color: s.glow, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending })]));
// meshes for the inventory item types that do not have a hand-built model above
const itemGeo = {
  flesh: new THREE.IcosahedronGeometry(0.13, 0), canned: new THREE.CylinderGeometry(0.06, 0.06, 0.14, 10), water: new THREE.CylinderGeometry(0.05, 0.05, 0.25, 8),
  coin: new THREE.CylinderGeometry(0.06, 0.06, 0.016, 12), relic: new THREE.ConeGeometry(0.07, 0.26, 4), cloth: new THREE.BoxGeometry(0.3, 0.06, 0.22),
  bandage: new THREE.CylinderGeometry(0.07, 0.07, 0.12, 10), eye: new THREE.OctahedronGeometry(0.12), seal: new THREE.CylinderGeometry(0.12, 0.12, 0.04, 6),
};
const itemMats = {};
function itemMesh(type, g) {
  const col = type === 'flesh' ? new THREE.Color(0x7a3028) : new THREE.Color(ITEMS[type].color);
  const m = itemMats[type] || (itemMats[type] = type === 'eye' ? new THREE.MeshBasicMaterial({ color: col }) : new THREE.MeshLambertMaterial({ color: col, flatShading: true, emissive: type === 'flesh' ? 0x1a3a08 : col.clone().multiplyScalar(0.06) }));
  if (type === 'coin') { for (let k = 0; k < 3; k++) { const c = new THREE.Mesh(itemGeo.coin, m); c.position.set(k * 0.03, k * 0.017, k * 0.02); g.add(c); } return; }
  if (type === 'flesh') { const a = new THREE.Mesh(itemGeo.flesh, m); a.scale.set(1.3, 0.7, 1); const b = new THREE.Mesh(itemGeo.flesh, m); b.scale.set(0.7, 0.6, 0.8); b.position.set(0.1, 0.02, 0.05); g.add(a, b); return; }
  const mesh = new THREE.Mesh(itemGeo[type] || itemGeo.relic, m);
  if (type === 'water' || type === 'canned') mesh.position.y = 0.04;
  if (type === 'bandage') mesh.rotation.z = Math.PI / 2;
  g.add(mesh);
}
const glowCache = {};
function glowFor(type) { return glowCache[type] || (glowCache[type] = new THREE.SpriteMaterial({ map: glowTex, color: ITEMS[type].color, transparent: true, opacity: type === 'eye' || type === 'seal' ? 0.7 : 0.35, depthWrite: false, blending: THREE.AdditiveBlending })); }
function addSupply(type, x, z, y, meta) {
  const S = SUP[type] || SUP.ammo, g = new THREE.Group();
  if (!SUP[type]) itemMesh(type, g);
  else if (type === 'battery') {
    const b = new THREE.Mesh(cylGeo, S.body); b.scale.set(0.07, 0.2, 0.07); b.rotation.z = Math.PI / 2; g.add(b);
    const t = new THREE.Mesh(cylGeo, S.trim); t.scale.set(0.071, 0.08, 0.071); t.rotation.z = Math.PI / 2; t.position.x = 0.07; g.add(t);
    const b2 = b.clone(); b2.position.z = 0.09; g.add(b2); const t2 = t.clone(); t2.position.z = 0.09; g.add(t2);
  } else {
    const body = new THREE.Mesh(boxGeo, S.body), trim = new THREE.Mesh(boxGeo, S.trim);
    if (type === 'ammo') {
      body.scale.set(0.4, 0.22, 0.26); trim.scale.set(0.41, 0.05, 0.1); trim.position.y = 0.04;
      const t2 = trim.clone(); t2.scale.set(0.08, 0.05, 0.27); t2.position.set(0.1, 0.04, 0); g.add(t2);
    } else {
      body.scale.set(0.36, 0.24, 0.2); trim.scale.set(0.06, 0.02, 0.16); trim.position.set(0, 0.12, 0);
      const t2 = trim.clone(); t2.scale.set(0.2, 0.02, 0.06); g.add(t2);
    }
    body.castShadow = true; g.add(body, trim);
  }
  const spr = new THREE.Sprite(glowMats[type] || glowFor(type)); spr.scale.set(1, 1, 1); spr.position.y = 0.25; g.add(spr);
  const base = (y ?? world.hgt(x, z)) + 0.13;
  g.position.set(x, base, z); g.rotation.y = Math.random() * 6.28;
  scene.add(g);
  supplies.push({ type, mesh: g, x, z, base, ph: Math.random() * 6, count: 1, ...meta });
}
const randType = () => { const r = Math.random(); return r < 0.5 ? 'ammo' : r < 0.78 ? 'med' : 'battery'; };
// Loot is owned by world chunks: it exists while its chunk is streamed in, and picked-up
// items stay gone (remembered by id) until the periodic respawn puts one back.
const taken = new Set();
function addChunkLoot(ci, cd) {
  cd.loot.forEach((s, k) => { const id = ci + ':' + k; if (!taken.has(id)) addSupply(s.type, s.x, s.z, s.y, { id, ci, k, count: s.count || 1 }); });
}
world.onChunkLoad = (ci, cd) => { addChunkLoot(ci, cd); minimap.reveal(ci); hanging.onChunkLoad(ci, cd); registerChunkNests(ci, cd); };
world.onChunkUnload = (ci) => {
  hanging.onChunkUnload(ci); unregisterNests(ci);
  for (let i = supplies.length - 1; i >= 0; i--) if (supplies[i].ci === ci) { scene.remove(supplies[i].mesh); supplies.splice(i, 1); }
};
function seedSupplies() {
  const hC = world.hgt(CABIN.x, CABIN.z), hP = world.hgt(CAMP.x, CAMP.z);
  for (const s of world.cabinSpots) addSupply(s.type, s.x, s.z, hC + s.y, { fixed: true });
  for (const s of world.campSpots) addSupply(s.type, s.x, s.z, hP, { fixed: true });
}
function spawnSupplyRespawn() {
  const r = Math.random();
  if (taken.size && r < 0.5) { // put a looted chunk item back
    const id = pick([...taken]); taken.delete(id);
    const [ci, k] = id.split(':').map(Number), rec = world.loaded.get(ci), sp = rec && rec.cd.loot[k];
    if (isNaN(ci) || (sp && !['ammo', 'med', 'battery', 'canned', 'water'].includes(sp.type))) { taken.add(id); return; } // rare loot never respawns
    if (sp && Math.hypot(sp.x - player.pos.x, sp.z - player.pos.z) > 25) addSupply(sp.type, sp.x, sp.z, sp.y, { id, ci, k });
    else if (sp) taken.add(id);
    return;
  }
  if (r < 0.65) { // restock cabin / camp
    const hC = world.hgt(CABIN.x, CABIN.z), spots = [...world.cabinSpots, ...world.campSpots].filter((s) => Math.hypot(s.x - player.pos.x, s.z - player.pos.z) > 25 && !supplies.some((u) => Math.hypot(u.x - s.x, u.z - s.z) < 1));
    if (spots.length) { const s = pick(spots); addSupply(s.type, s.x, s.z, s.y !== undefined ? hC + s.y : undefined, { fixed: true }); return; }
  }
  if (supplies.filter((u) => !u.ci && !u.fixed).length >= CFG.maxSupplies) return;
  const sp = world.findSpot(player.pos.x, player.pos.z, 25, 85, player.yaw);
  if (sp) addSupply(randType(), sp.x, sp.z);
}
let nearSupply = null;
function interact() {
  if (!nearSupply) return;
  const s = nearSupply, n = s.count || 1;
  const left = inventory.add(s.type, n);
  if (left === n) { toast('Inventory full'); audio.empty(); return; }
  audio.pickup();
  toast(`+${n - left} ${ITEMS[s.type].name}`);
  if (left > 0) { s.count = left; return; }
  if (s.id) taken.add(s.id);
  scene.remove(s.mesh);
  supplies.splice(supplies.indexOf(s), 1);
  nearSupply = null;
}

// ------------------------------------------------------------------ waves
const waveCount = (n) => (n <= 5 ? [5, 8, 12, 16, 20][n - 1] : 20 + (n - 5) * 4);
function showBanner(text, sub = '', ms = 2800) {
  const b = $('banner');
  b.innerHTML = text + (sub ? `<small>${sub}</small>` : '');
  b.style.opacity = 1; G.bannerT = ms / 1000;
}
function showArea(text, sub = '') {
  const a = $('area');
  a.innerHTML = text + (sub ? `<small>${sub}</small>` : '');
  a.style.opacity = 1; G.areaT = 3.5;
}
function startWave() {
  G.waveState = 'active';
  G.toSpawn = waveCount(G.wave);
  G.spawnT = 0;
  zombies.hpMul = 1 + Math.max(0, G.wave - 5) * 0.06;
  zombies.spdMul = 1 + Math.min(0.25, Math.max(0, G.wave - 5) * 0.03);
  showBanner('WAVE ' + G.wave, G.wave >= 4 ? 'sprinters among them' : G.wave >= 3 ? 'runners incoming' : 'they are coming');
  audio.waveStart();
}
function spawnOne() {
  const sp = world.findSpot(player.pos.x, player.pos.z, 45, 78, player.yaw);
  if (!sp) return false;
  if (world.desertWeight(sp.x, sp.z) > 0.5) { const e = zombies.spawnBuried(rollType(), sp.x, sp.z, 'wave', 999); zombies.emerge(e); }
  else zombies.spawn(rollType(), sp.x, sp.z, 'wave');
  return true;
}
function updateWaves(dt) {
  if (G.waveState === 'prep') { G.prepT -= dt; if (G.prepT <= 0) startWave(); return; }
  const max = QUALITY[settings.quality].maxZ, alive = zombies.aliveCount();
  G.spawnT -= dt;
  if (G.toSpawn > 0 && alive < max && G.spawnT <= 0 && G.indoor < 0.5) { if (spawnOne()) { G.toSpawn--; G.spawnT = alive < 4 ? 0.5 : 1.2; } }
  if (G.toSpawn === 0 && alive === 0) {
    G.wavesCleared++; G.wave++;
    G.waveState = 'prep'; G.prepT = CFG.prepTime;
    showBanner('WAVE CLEARED', 'catch your breath');
    const sp = world.findSpot(player.pos.x, player.pos.z, 8, 22);
    if (sp) { addSupply('ammo', sp.x, sp.z); const s2 = world.findSpot(player.pos.x, player.pos.z, 8, 22); if (s2) addSupply(Math.random() < 0.5 ? 'med' : 'battery', s2.x, s2.z); }
  }
}

// ------------------------------------------------------------------ villages, roamers, suspense
function updateVillages() {
  const px = player.pos.x, pz = player.pos.z;
  let inArea = null;
  for (const s of vstate) {
    const v = s.v, d = Math.hypot(px - v.x, pz - v.z);
    if (d < 45) inArea = v;
    if (!s.populated && d < 170) {
      s.populated = true;
      const spots = v.corpses.slice().sort(() => Math.random() - 0.5);
      for (let i = 0; i < (v.small ? 2 : 3) && i < spots.length; i++) { const e = zombies.spawnDormant(spots[i].x + rand(-1.5, 1.5), spots[i].z + rand(-1.5, 1.5), 'village'); e.village = v; }
      for (let i = 0; i < (v.small ? 2 : 3); i++) {
        const a = Math.random() * 6.28, r = rand(4, 24), e = zombies.spawn(Math.random() < 0.3 ? 'runner' : 'walker', v.x + Math.cos(a) * r, v.z + Math.sin(a) * r, 'village');
        e.village = v; e.home = v; e.homeR = 30;
      }
      if (v.boss && !v.bossDead) { const e = zombies.spawn('brute', v.x + 6, v.z + 4, 'boss'); e.village = v; e.home = v; e.homeR = 32; e.state = 'wander'; zombies.pickWander(e); }
    } else if (s.populated && d > 330) {
      s.populated = false;
      for (const e of zombies.list.slice()) if (e.village === v && !e.dead) zombies.remove(e);
    }
  }
  if (inArea && G.lastArea !== inArea) { showArea(inArea.name, inArea.boss && !inArea.bossDead ? 'something heavy is walking here' : 'abandoned village'); audio.scream({ x: inArea.x + 40, y: 5, z: inArea.z - 30 }); }
  G.lastArea = inArea;
}
function updateAmbient(dt) {
  G.ambientT -= dt;
  if (G.ambientT > 0) return;
  G.ambientT = 2;
  const px = player.pos.x, pz = player.pos.z;
  for (const e of zombies.list.slice()) if (e.tag === 'ambient' && !e.dead && e.dist > 180) zombies.remove(e);
  const want = Math.min(QUALITY[settings.quality].ambient, Math.round(1 + G.dark * 6 + Math.min(1, Math.hypot(px - SPAWN.x, pz - SPAWN.z) / 200) * 2));
  if (zombies.count('ambient') < want) {
    const sp = world.findSpot(px, pz, 60, 120, player.yaw);
    if (sp && G.indoor < 0.5) { const e = zombies.spawn(rollType(G.dark * 0.15), sp.x, sp.z, 'ambient', world.desertWeight(sp.x, sp.z) > 0.5); e.state = 'wander'; zombies.pickWander(e); }
  }
}
function updateSuspense(dt) {
  G.eventT -= dt * (1 + G.dark * 1.8);
  if (G.eventT > 0) return;
  G.eventT = rand(18, 40);
  const p = player.pos, r = Math.random();
  const behind = (dist) => ({ x: p.x + Math.sin(player.yaw) * dist + rand(-3, 3), y: p.y + 0.3, z: p.z + Math.cos(player.yaw) * dist + rand(-3, 3) });
  if (r < 0.4) audio.twig(behind(rand(7, 13)));
  else if (r < 0.65) { const a = Math.random() * 6.28; audio.scream({ x: p.x + Math.cos(a) * 120, y: p.y + 5, z: p.z + Math.sin(a) * 120 }); }
  else if (r < 0.85) { const q = behind(rand(15, 25)); audio.growl(q, { pitch: 0.7, dur: 1.6, gain: 0.5 }); }
  else { audio.twig(behind(9)); setTimeout(() => audio.twig(behind(7)), 450); }
}
const DARKC = new THREE.Color(0x020306);
const ATM = {};
let bigStars = null, sandFx = null;
function initDesertSky() {
  // a dense, cheap star field for the clear desert night (one Points draw call)
  const n = 3500, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const u = Math.random() * Math.PI * 2, v = Math.acos(Math.random() * 0.96 + 0.04), r = 350;
    pos[i * 3] = r * Math.sin(v) * Math.cos(u); pos[i * 3 + 1] = r * Math.cos(v); pos[i * 3 + 2] = r * Math.sin(v) * Math.sin(u);
    const b = 0.5 + Math.random() * 0.5, w = Math.random();
    col[i * 3] = b * (w > 0.9 ? 1 : 0.85); col[i * 3 + 1] = b * 0.9; col[i * 3 + 2] = b * (w < 0.2 ? 0.75 : 1);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  bigStars = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.15, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, fog: false, depthWrite: false }));
  world.sky.add(bigStars);
  // sand drifting on the wind
  const m = 260, sp = new Float32Array(m * 3);
  const g2 = new THREE.BufferGeometry(); g2.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  sandFx = new THREE.Points(g2, new THREE.PointsMaterial({ color: 0xd8c098, size: 0.05, transparent: true, opacity: 0, depthWrite: false }));
  sandFx.frustumCulled = false; sandFx.userData.n = m; sandFx.userData.init = false; scene.add(sandFx);
}
function updateSand(dt, k) {
  sandFx.material.opacity = k * 0.75;
  sandFx.visible = k > 0.03;
  if (!sandFx.visible) return;
  const a = sandFx.geometry.attributes.position, p = player.pos, n = sandFx.userData.n;
  for (let i = 0; i < n; i++) {
    let x = a.array[i * 3], y = a.array[i * 3 + 1], z = a.array[i * 3 + 2];
    if (!sandFx.userData.init || Math.abs(x - p.x) > 22 || Math.abs(z - p.z) > 22) { x = p.x + rand(-22, 22); z = p.z + rand(-22, 22); y = world.hgt(x, z) + rand(0, 2.5); }
    x += (5 + Math.sin(i) * 1.5) * dt; z += (1.5 + Math.cos(i * 1.3)) * dt; y += Math.sin(G.T * 2 + i) * 0.3 * dt;
    const gy = world.hgt(x, z); if (y < gy + 0.05) y = gy + 0.05;
    a.array[i * 3] = x; a.array[i * 3 + 1] = y; a.array[i * 3 + 2] = z;
  }
  sandFx.userData.init = true;
  a.needsUpdate = true;
}
function updateAtmosphere(dt) {
  if (!bigStars) initDesertSky();
  const q = QUALITY[settings.quality], px = player.pos.x, pz = player.pos.z;
  const inside = world.desert.inside;
  G.indoor = damp(G.indoor, inside ? inside.k : 0, 3, dt);
  const A = world.atmosphereAt(px, pz, G.indoor, ATM);   // blended biome atmosphere config
  G.ringW = A.weights.hanging; G.desertW = A.weights.desert;
  const target = world.darkness(px, pz) * A.darkSectors;
  G.dark = damp(G.dark, target, 0.7, dt);
  const k = G.dark;
  world.hemi.intensity = A.hemi * lerp(1, 0.045, k);
  world.moon.intensity = A.moon * lerp(1, 0.02, k);
  const far = Math.min(330, q.fog * A.fogFarMul);
  scene.fog.far = lerp(far, 22, k);
  scene.fog.near = lerp(A.fogNear, 0.5, k);
  scene.fog.color.set(A.fogColor).lerp(DARKC, k);
  scene.background.copy(scene.fog.color);
  world.domeMat.color.setScalar((1 - 0.92 * k) * (1 - G.indoor));
  world.starMat.opacity = A.stars * (1 - k) * (1 - G.indoor);
  bigStars.material.opacity = A.bigStars * (1 - k) * (1 - G.indoor);
  world.moonMat.opacity = (1 - 0.9 * k) * (1 - G.indoor);
  world.redMoonMat.opacity = world.moonMat.opacity;
  world.redMoon.intensity = 0.4 * (A.moon / 2) * (1 - k) * (1 - G.indoor);
  world.sky.children[2].scale.set(70 * A.moonScale, 70 * A.moonScale, 1);
  renderer.toneMappingExposure = A.exposure;
  world.viewDist = clamp(Math.round(scene.fog.far / 20) * 20, 40, 330);
  zombies.farDist = Math.max(40, scene.fog.far);
  world.mistCount = Math.min(30, Math.round(q.mist * A.mist));
  audio.setDark(k); audio.setWind(A.wind);
  updateSand(dt, A.sand * (1 - G.indoor));
  // announce biome changes
  const b = world.dominantBiome(px, pz);
  if (b.id !== G.biome) {
    if (G.biome) showArea(b.name, b.id === 'desert' ? 'the sand remembers every step' : b.id === 'hanging' ? 'do not look up' : b.reserved ? 'uncharted - nothing here yet' : 'the forest remembers');
    G.biome = b.id;
  }
  G.darkMsgT -= dt;
  if (k > 0.45 && G.darkMsgT <= 0 && !G.lastArea) { showArea('', 'it is too dark here… stay close to your light'); G.darkMsgT = 90; }
}

// ------------------------------------------------------------------ player damage / death
function damagePlayer(dmg, kind = 'zombie') {
  if (G.mode !== 'playing' || G.transformT) return;
  G.cause = { worm: 'Devoured by a sand worm', dog: 'Mauled by infected dogs', acid: 'Dissolved by acid', mummy: 'Torn apart by the Ancient Mummy', slam: 'Crushed by the Ancient Mummy', grab: 'Strangled by bandages', bandage: 'Lashed by the Ancient Mummy', cultist: 'Sacrificed by cultists' }[kind] || 'Killed by the dead';
  if (kind === 'acid') G.acidFlash = 1;
  player.health -= dmg;
  G.dmgFlash = Math.min(1.4, dmg / 14);
  audio.hurt();
  player.pitch += (Math.random() - 0.3) * 0.03 * (dmg / 14); player.yaw += (Math.random() - 0.5) * 0.04 * (dmg / 14);
  if (player.health <= 0) { player.health = 0; die(); }
}
function die(cause) {
  if (cause) G.cause = cause;
  G.mode = 'dead'; G.deadT = 0; G.grabbed = null;
  if (invUI.isOpen) invUI.close();
  G.mouseDown = false; G.adsHeld = false;
  audio.playerDie();
  if (document.pointerLockElement) document.exitPointerLock();
}

// ------------------------------------------------------------------ HUD
const hudCache = {};
function setText(id, v) { if (hudCache[id] !== v) { hudCache[id] = v; $(id).textContent = v; } }
function updateHud(dt) {
  setText('h-wave', String(G.wave));
  setText('h-left', String(G.waveState === 'active' ? G.toSpawn + zombies.aliveCount() : 0));
  setText('h-kills', String(G.kills));
  setText('h-time', fmtTime(G.survive));
  $('b-health').style.width = player.health + '%';
  setText('t-health', String(Math.ceil(player.health)));
  $('b-stam').style.width = player.stamina + '%';
  $('b-stam').style.opacity = player.exhausted ? 0.45 : 1;
  $('b-batt').style.width = G.battery + '%';
  $('b-batt').classList.toggle('low', G.battery < 20);
  setText('t-batt', String(Math.ceil(G.battery)));
  setText('t-spares', String(inventory.count('battery'))); setText('t-meds', String(inventory.count('med')));
  {
    const inf = G.infection;
    if (hudCache.inf !== inf) {
      hudCache.inf = inf;
      document.querySelectorAll('#infect .seg').forEach((el, i) => { el.className = 'seg' + (i < inf ? ' on s' + inf : ''); });
      $('infect').classList.toggle('show', inf > 0);
      $('infect-tip').textContent = inf ? `+${inf * 30}% speed · +${inf * 30}% damage · stamina drain x${(1 + 0.35 * inf).toFixed(2)}${inf >= 2 ? ' · passive drain' : ''}` + (inf >= 5 ? ' · CRITICAL: one more piece is fatal' : '') : '';
    }
    $('infectvig').style.opacity = G.transformT ? $('infectvig').style.opacity : inf >= 4 ? (inf === 4 ? 0.35 : 0.6) + Math.sin(G.T * 2) * 0.1 : 0;
    if (G.toastT > 0) { G.toastT -= dt; if (G.toastT <= 0) $('toast').classList.remove('show'); }
    G.acidFlash = Math.max(0, (G.acidFlash || 0) - dt * 1.2);
    $('acidvig').style.opacity = G.acidFlash;
  }

  setText('a-mag', String(weapon.mag)); setText('a-res', String(weapon.reserve));
  setText('wname', weapon.gun.def.name);
  if (hudCache.slot !== weapon.cur) { hudCache.slot = weapon.cur; document.querySelectorAll('#slots span').forEach((s) => s.classList.toggle('on', +s.dataset.i === weapon.cur)); }
  $('ammo').classList.toggle('low', weapon.mag <= Math.ceil(weapon.gun.def.mag / 6));
  let h = '';
  if (weapon.reloading) h = 'RELOADING'; else if (weapon.mag === 0 && weapon.reserve === 0) h = 'NO AMMO'; else if (weapon.mag <= Math.ceil(weapon.gun.def.mag / 6) && weapon.reserve > 0) h = 'RELOAD [R]';
  setText('a-hint', h); $('a-hint').classList.toggle('show', !!h);
  setText('fl-state', G.battery <= 0 ? 'DEAD' : G.flashOn ? 'ON' : 'OFF');
  const wz = worms.zoneAt(player.pos.x, player.pos.z);
  setText('posture', (wz && !wz.dead ? 'TREMOR ' + Math.min(100, Math.round((wz.meter / 30) * 100)) + '%  ' : '') + (player.sitting ? 'SITTING' : player.crouching ? 'CROUCHING' : player.inWater ? 'WADING' : ''));
  $('crosshair').classList.toggle('ads', weapon.ads > 0.6);
  $('scope').classList.toggle('on', !!weapon.scoped);
  setText('prepbar', G.waveState === 'prep' ? `WAVE ${G.wave} BEGINS IN ${Math.max(0, Math.ceil(G.prepT))}` : '');
  let p = '';
  if (nearSupply) {
    p = `<kbd>E</kbd> Pick up ${ITEMS[nearSupply.type].name}${nearSupply.count > 1 ? ' x' + nearSupply.count : ''}`;
  } else if (promptFlashT > 0) p = promptFlash;
  else if (G.battery <= 0 && inventory.count('battery') > 0) p = '<kbd>B</kbd> Replace dead battery';
  else if (G.grabbed) p = 'GRABBED!';
  promptFlashT -= dt;
  const pe = $('prompt');
  if (hudCache.prompt !== p) { hudCache.prompt = p; pe.innerHTML = p; pe.classList.toggle('show', !!p); }
  // boss bar
  const boss = zombies.boss();
  const showBoss = boss && boss.dist < 55 && (boss.state === 'chase' || boss.state === 'attack' || boss.dist < 30);
  const showMummy = mummy.active && Math.hypot(mummy.m.x - player.pos.x, mummy.m.z - player.pos.z) < 70;
  $('bossbar').style.display = showBoss || showMummy ? 'block' : 'none';
  setText('bossname', showMummy ? 'THE ANCIENT MUMMY' : 'THE BUTCHER');
  if (showMummy) $('b-boss').style.width = mummy.hpFrac * 100 + '%';
  else if (showBoss) $('b-boss').style.width = (boss.hp / boss.maxHp) * 100 + '%';
  if (G.hitT > 0) { G.hitT -= dt; if (G.hitT <= 0) $('hitmarker').className = ''; }
  if (G.bannerT > 0) { G.bannerT -= dt; if (G.bannerT <= 0) $('banner').style.opacity = 0; }
  if (G.areaT > 0) { G.areaT -= dt; if (G.areaT <= 0) $('area').style.opacity = 0; }
  G.dmgFlash = Math.max(0, G.dmgFlash - dt * 1.5);
  $('vignette').style.opacity = Math.min(1, G.dmgFlash);
  const low = player.health < 35 && G.mode === 'playing' ? (1 - player.health / 35) : 0;
  $('lowhp').style.opacity = low ? (0.35 + 0.35 * Math.sin(G.T * (4 + low * 4))) * low + low * 0.25 : 0;
  if (low > 0) { G.hbT -= dt; if (G.hbT <= 0) { audio.heartbeat(); G.hbT = lerp(0.45, 1.0, 1 - low); } }
  minimap.draw(player.pos, player.yaw, zombies.list, supplies);
}

// ------------------------------------------------------------------ phase 2: loot, targets, nests, structures
function toast(t) { const el = $('toast'); el.textContent = t; el.classList.add('show'); G.toastT = 2.2; }
/** persistent world loot (zombie drops, player drops, boss loot): survives chunk unloading */
function dropItem(type, n, x, z, y) {
  addSupply(type, x, z, y, { persist: true, count: n });
  const pers = supplies.filter((s) => s.persist);
  if (pers.length > 150) { const s = pers[0]; scene.remove(s.mesh); supplies.splice(supplies.indexOf(s), 1); }
}
function extraRay(o, d, maxT) {
  let best = null, src = null;
  for (const s of [hanging, npcs, mummy, dogs, worms]) { const h = s.rayHit(o, d, best ? best.t : maxT); if (h && h.t < (best ? best.t : maxT)) { best = h; src = s; } }
  if (!best) return null;
  best.color = src === hanging || src === dogs ? 0x3a5a10 : src === mummy || src === worms ? 0xc8b890 : 0x7a0c0c;
  const apply = best.apply;
  best.apply = (dmg, hp) => {
    const r = apply(dmg);
    if (r.killed && r.kind === 'cultist') { G.kills++; if (Math.random() < 0.6) dropItem(Math.random() < 0.5 ? 'cloth' : 'coin', 1 + Math.floor(Math.random() * 2), hp.x, hp.z); }
    return r;
  };
  return best;
}
hanging.onPlayerHit = (dmg, kind) => damagePlayer(dmg, kind);
hanging.onKill = (e) => { G.kills++; if (Math.random() < 0.35) dropItem('ammo', 1, e.x + 2.3 * Math.cos(e.g.rotation.y), e.z - 2.3 * Math.sin(e.g.rotation.y)); };
npcs.onPlayerHit = (dmg, kind) => damagePlayer(dmg, kind);
mummy.onPlayerHit = (dmg, kind) => damagePlayer(dmg, kind);
dogs.onPlayerHit = (dmg, kind) => damagePlayer(dmg, kind);
dogs.onKill = (d) => { G.kills++; dropItem('flesh', 1, d.x, d.z); };
worms.onPlayerHit = (dmg, kind) => damagePlayer(dmg, kind);
worms.onShake = (k) => { G.shake = Math.max(G.shake, k); };
worms.onHunt = () => { toast('The ground trembles…'); showArea('', 'something huge is moving under the sand — get out'); };
worms.onKill = (z, p) => {
  G.kills++;
  showBanner('THE WORM IS DEAD', 'the deep sands fall silent', 5000);
  const gy = world.hgt(p.x, p.z);
  [['relic', 2], ['coin', 15], ['ammo', 2]].forEach(([t, n], k) => dropItem(t, n, p.x + Math.cos(k * 2) * 3, p.z + Math.sin(k * 2) * 3, gy));
};
mummy.onGrab = (p) => { G.grabbed = p; };
mummy.onDefeat = (x, z) => {
  PROGRESS.desertBossDefeated = true; PROGRESS.biome3Unlocked = true;   // progression flag for the next biome
  G.kills++;
  showBanner('THE ANCIENT MUMMY HAS FALLEN', 'something stirs beyond the desert…', 6000);
  const F = world.desert.great.F;
  const items = [['eye', 1], ['seal', 1], ['bandage', 5], ['relic', 2], ['coin', 12], ['ammo', 2], ['med', 1]];
  items.forEach(([t, n], k) => { const a = (k / items.length) * Math.PI * 2; dropItem(t, n, x + Math.cos(a) * 2.4, z + Math.sin(a) * 2.4, F); });
};

// sand zombie nests: hidden zombies under the sand, cleared ones never come back this session
const nests = new Map(), clearedNests = new Set();
function regNest(id, x, z, owner) { if (!clearedNests.has(id) && !nests.has(id)) nests.set(id, { id, x, z, owner, e: null }); }
function registerChunkNests(ci, cd) { cd.nests.forEach((n, k) => regNest(ci + ':n' + k, n.x, n.z, ci)); }
function unregisterNests(owner) { for (const [id, n] of nests) if (n.owner === owner) { if (n.e && n.e.state === 'buried') zombies.remove(n.e); nests.delete(id); } }
function updateNests(dt) {
  G.nestT -= dt; if (G.nestT > 0) return; G.nestT = 0.5;
  const px = player.pos.x, pz = player.pos.z;
  for (const e of zombies.list.slice()) if (e.tag === 'sand' && !e.dead && e.dist > 220) { const n = nests.get(e.nestId); if (n) n.e = null; zombies.remove(e); }
  let sand = zombies.count('sand');
  for (const n of nests.values()) {
    if (n.e) { if (!zombies.list.includes(n.e)) n.e = null; continue; }
    if (sand >= 12) break;
    if (Math.hypot(n.x - px, n.z - pz) < 55) { n.e = zombies.spawnBuried(rollType(0.1), n.x, n.z, 'sand', rand(10, 15)); n.e.nestId = n.id; sand++; }
  }
}
// desert structures stream their loot / nests / NPCs / boss in and out
function onStructLoad(st) {
  const D = world.desert;
  const add = (list, toW) => list.forEach((l, k) => { const id = 's:' + st.id + ':' + k; if (taken.has(id)) return; const [x, z, y] = toW(l); addSupply(l.type, x, z, y, { id, sid: st.id, count: l.count || 1 }); });
  if (st.kind === 'great') {
    add(st.loot, (l) => [st.x + l.lx, st.z + l.lz, st.F]);
    st.nests.forEach((n, k) => regNest('s:' + st.id + ':n' + k, st.x + n.lx, st.z + n.lz, st.id));
    mummy.build(st);
  } else if (st.kind === 'small') {
    add(st.loot, (l) => { const [x, z] = D.worldPos(st, l.lx, l.lz); return [x, z, st.F]; });
    st.nests.forEach((n, k) => { const [x, z] = D.worldPos(st, n.lx, n.lz); regNest('s:' + st.id + ':n' + k, x, z, st.id); });
  } else if (st.kind === 'camp') {
    add(st.loot, (l) => [l.wx, l.wz, world.hgt(l.wx, l.wz)]);
    npcs.loadCamp(st);
  }
}
function onStructUnload(st) {
  for (let i = supplies.length - 1; i >= 0; i--) if (supplies[i].sid === st.id) { scene.remove(supplies[i].mesh); supplies.splice(i, 1); }
  unregisterNests(st.id);
  if (st.kind === 'camp') npcs.unloadCamp(st.id);
  if (st.kind === 'great') mummy.unload();
}
world.desert.onLoad = onStructLoad; world.desert.onUnload = onStructUnload;

// infected dog packs in the desert, giant dead in the forest, worm territory warnings
function updateDesertLife(dt) {
  const px = player.pos.x, pz = player.pos.z;
  G.dogT -= dt;
  if (G.dogT <= 0) {
    G.dogT = rand(18, 32);
    if ((G.desertW || 0) > 0.6 && G.indoor < 0.5 && dogs.count() < 8 && Math.random() < 0.75) {
      const sp = world.findSpot(px, pz, 70, 110, player.yaw);
      if (sp) dogs.spawnPack(sp.x, sp.z, 3 + Math.floor(Math.random() * 3));
    }
  }
  G.giantT -= dt;
  if (G.giantT <= 0) {
    G.giantT = 20;
    for (const e of zombies.list.slice()) if (e.tag === 'giant' && !e.dead && e.dist > 260) zombies.remove(e);
    if ((G.desertW || 0) < 0.2 && (G.ringW || 0) < 0.3 && G.indoor < 0.5 && zombies.count('giant') < 1 && Math.random() < 0.6) {
      const sp = world.findSpot(px, pz, 70, 110, player.yaw);
      if (sp) { const e = zombies.spawn('giant', sp.x, sp.z, 'giant'); e.state = 'wander'; zombies.pickWander(e); }
    }
  }
  // the ground shakes under the giants' feet
  for (const e of zombies.list) if (e.giant && !e.dead && e.dist < 30 && e.curSpeed > 0.3) G.shake = Math.max(G.shake, 0.18 * (1 - e.dist / 30));
  const wz = worms.zoneAt(px, pz);
  if (wz !== G.wormZone) { if (wz && !wz.dead) showArea('DEEP SANDS', 'they hunt by vibration — keep low, keep still, keep quiet'); G.wormZone = wz; }
}

// ------------------------------------------------------------------ inventory actions
function useAt(i) { const s = inventory.slots[i]; if (s) useType(s.type, i); }
function useType(type, idx) {
  const i = idx ?? inventory.indexOf(type);
  if (i < 0) { toast('No ' + ITEMS[type].name); return; }
  switch (type) {
    case 'med':
      if (player.health >= PCFG.maxHealth) { toast('Health is full'); return; }
      player.health = Math.min(PCFG.maxHealth, player.health + CFG.medHeal); audio.pickup(); toast('+50 health'); break;
    case 'ammo': weapon.addAmmoAll(); audio.switchGun(); toast('Ammunition loaded into all guns'); break;
    case 'battery': replaceBattery(); return;
    case 'canned': player.health = Math.min(PCFG.maxHealth, player.health + 10); player.stamina = Math.min(100, player.stamina + 25); audio.eat(); toast('You ate the canned food'); break;
    case 'water': player.stamina = 100; player.exhausted = false; audio.drink(); toast('Stamina restored'); break;
    case 'flesh':
      if (G.infection >= 5) { confirmFatal(i); return; }
      inventory.removeAt(i, 1); eatFlesh(); return;
    default: toast("You can't use that"); return;
  }
  inventory.removeAt(i, 1);
}
// infection balancing (per stage 0..5): passive stamina drain per second and stamina regen multiplier
const INF = { drain: [0, 3, 6, 10, 15, 22], regen: [1, 0.75, 0.55, 0.4, 0.3, 0.2] };
const INF_MSG = ['', 'Your blood burns. You feel fast.', 'Your heart pounds in your ears.', 'The world swims at the edges.', 'You can hear them breathing… it is you.', 'CRITICAL INFECTION — one more piece will turn you', ''];
function eatFlesh() {
  G.infection = Math.min(6, G.infection + 1);
  audio.eat();
  if (G.infection >= 6) { startTransformation(); return; }
  toast(INF_MSG[G.infection]);
  showArea('INFECTION ' + G.infection + ' / 6', INF_MSG[G.infection]);
}
function startTransformation() {
  // the sixth piece always kills: irreversible transformation
  G.transformT = 0.001; G.mouseDown = false; G.adsHeld = false; G.breathT = 0;
  if (invUI.isOpen) invUI.close();
  $('inv-confirm').classList.add('hidden');
  if (G.mode === 'inventory') { G.mode = 'playing'; showScreen(null); showHud(true); }
  showBanner('YOU ARE TURNING', '', 4500);
}
function updateInfection(dt) {
  const inf = G.infection, cv = $('game');
  if (G.transformT) {
    G.transformT += dt;
    const k = clamp(G.transformT / 4.5, 0, 1);
    cv.style.filter = `blur(${(k * 3).toFixed(2)}px) hue-rotate(${Math.round(60 + k * 90)}deg) saturate(${(1.5 + k * 2).toFixed(2)}) contrast(${(1.2 + k * 0.6).toFixed(2)})`;
    player.roll = Math.sin(G.T * 3) * 0.3 * k;
    $('infectvig').style.opacity = String(0.6 + k * 0.4);
    G.breathT -= dt; if (G.breathT <= 0) { G.breathT = 1.3; audio.zombieBreath(1 + k); }
    if (G.transformT > 4.5) { cv.style.filter = ''; die('Succumbed to Infection'); }
    return;
  }
  if (inf >= 3) {
    const w = inf === 3 ? 0.4 : inf === 4 ? 0.8 : 1.4;
    cv.style.filter = `saturate(${(1 + 0.12 * w).toFixed(2)}) contrast(${(1 + 0.05 * w).toFixed(2)}) hue-rotate(${(Math.sin(G.T * 0.7) * 6 * w).toFixed(1)}deg)` + (inf >= 5 ? ` blur(${(Math.max(0, Math.sin(G.T * 1.3)) * 0.9).toFixed(2)}px)` : '');
    camera.fov += Math.sin(G.T * 1.1) * 0.6 * w; camera.updateProjectionMatrix();
  } else if (cv.style.filter) cv.style.filter = '';
  if (inf >= 2) { G.infHbT -= dt; if (G.infHbT <= 0) { audio.heartbeat(); G.infHbT = inf >= 5 ? 0.9 : inf >= 4 ? 3 : rand(6, 10); } }
  if (inf >= 4) { G.breathT -= dt; if (G.breathT <= 0) { audio.zombieBreath(inf >= 5 ? 1 : 0.6); G.breathT = rand(8, 16) / (inf - 2); } }
}
function openInventory() {
  if (G.mode !== 'playing') return;
  G.mode = 'inventory'; G.mouseDown = false; G.adsHeld = false;
  for (const k in keys) keys[k] = false;
  invUI.open(); audio.invClick();
  if (document.pointerLockElement) document.exitPointerLock();
}
function closeInventory() {
  if (G.mode !== 'inventory') return;
  invUI.close(); $('inv-confirm').classList.add('hidden'); audio.invClick();
  G.mode = 'paused'; lockPointer();
}
function dropFromInventory(i, all) {
  const s = inventory.slots[i]; if (!s) return;
  const n = all ? s.n : 1, type = s.type;
  inventory.removeAt(i, n);
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
  dropItem(type, n, player.pos.x + fx * 1.4 + rand(-0.3, 0.3), player.pos.z + fz * 1.4 + rand(-0.3, 0.3));
  audio.invClick();
}
function updateRingAmbience(dt) {
  const rw = G.ringW || 0;
  if (rw > 0.3) {
    G.ringT -= dt;
    if (G.ringT <= 0) {
      G.ringT = rand(2, 6) / rw;
      const a = Math.random() * 6.28, r = rand(8, 22), pos = { x: player.pos.x + Math.cos(a) * r, y: player.pos.y + 4, z: player.pos.z + Math.sin(a) * r };
      if (Math.random() < 0.65) audio.creak(pos); else audio.whisper(pos);
    }
  }
  // chanting drifts over the dunes from the nearest peaceful camp
  let best = null, bd = 170;
  for (const cp of world.desert.list) if (cp.kind === 'camp') { const d = Math.hypot(cp.x - player.pos.x, cp.z - player.pos.z); if (d < bd && !npcs.hostile.has(cp.id)) { bd = d; best = cp; } }
  audio.setChant(best ? { x: best.x, y: best.F + 1.5, z: best.z } : null, best ? clamp(1 - bd / 170, 0, 1) * (1 - G.indoor) : 0);
}

// ------------------------------------------------------------------ main loop
const clock = new THREE.Clock();
const zctx = { px: 0, pz: 0, playerAlive: true, detectMul: 1, onHit: damagePlayer };
const menuTarget = new THREE.Vector3(CAMP.x, world.hgt(CAMP.x, CAMP.z) + 1.4, CAMP.z);

function updateZombies(dt, alive) {
  zctx.px = player.pos.x; zctx.pz = player.pos.z; zctx.playerAlive = alive;
  zctx.detectMul = (player.sitting ? 0.45 : player.crouching ? 0.6 : 1) * (player.sprinting ? 1.5 : 1) * (G.flashOn ? 1.15 : 0.9);
  zombies.update(dt, zctx, G.T);
}

function updatePlaying(dt) {
  G.survive += dt;
  const aiming = G.adsHeld && !weapon.reloading;
  const inf = G.infection;
  player.update(dt, keys, {
    canMove: !G.grabbed && !G.transformT, aiming, firing: G.mouseDown,
    speedMul: 1 + 0.3 * inf, drainMul: 1 + 0.35 * inf, passiveDrain: INF.drain[inf] || 0, regenMul: INF.regen[inf] ?? 1,
  });
  if (G.grabbed && mummy.m) { // a bandage is wrapped round the player: dragged toward the mummy
    const m = mummy.m, dx = m.x - player.pos.x, dz = m.z - player.pos.z, d = Math.hypot(dx, dz);
    if (d > 7) { player.pos.x += dx / d * 6 * dt; player.pos.z += dz / d * 4 * dt; world.resolve(player.pos, 0.4, player.pos.y); }
  }

  // sniper scope sway; hold Shift to steady your breath
  let swP = 0, swY = 0;
  if (weapon.scoped) {
    const hold = (keys.ShiftLeft || keys.ShiftRight) && player.stamina > 1;
    if (hold && PCFG.staminaDrain) player.stamina = Math.max(0, player.stamina - 22 * dt);
    const amp = hold ? 0.0005 : 0.004 * (1 + clamp(player.hspeed / 3, 0, 1));
    swP = (Math.sin(G.T * 0.9) + Math.sin(G.T * 2.3) * 0.3) * amp;
    swY = Math.cos(G.T * 0.7) * amp * 1.2;
  }
  player.applyCamera(dt, weapon.recoil + swP, swY);
  if (G.shake > 0.01) {
    camera.position.x += (Math.random() - 0.5) * 0.25 * G.shake; camera.position.y += (Math.random() - 0.5) * 0.2 * G.shake; camera.position.z += (Math.random() - 0.5) * 0.25 * G.shake;
    camera.rotation.z += (Math.random() - 0.5) * 0.03 * G.shake;
  }
  G.shake = Math.max(0, G.shake - dt * 1.5);
  camera.fov = lerp(72, weapon.gun.def.adsFov, weapon.ads);
  camera.updateProjectionMatrix();
  updateFlashlight(dt);
  weapon.update(dt, { firing: G.mouseDown, adsHeld: G.adsHeld, sprinting: player.sprinting, canAct: !G.transformT, lookDX: G.lookDX, lookDY: G.lookDY, time: G.T });
  G.lookDX = G.lookDY = 0;
  updateAtmosphere(dt);
  world.update(dt, G.T, player.pos.x, player.pos.y, player.pos.z, G.dark);
  fauna.update(dt, G.T, player.pos.x, player.pos.y, player.pos.z, G.dark);
  updateZombies(dt, true);
  updateWaves(dt);
  updateVillages();
  updateAmbient(dt);
  hanging.update(dt, G.T, player, true);
  npcs.update(dt, G.T, player, true);
  mummy.update(dt, G.T, player, true);
  dogs.farDist = Math.max(60, scene.fog.far + 10);
  dogs.update(dt, G.T, player, true);
  worms.update(dt, G.T, player, true);
  updateDesertLife(dt);
  updateNests(dt);
  updateInfection(dt);
  updateRingAmbience(dt);
  nearSupply = null; let best = CFG.pickupRange;
  const vis = world.viewDist + 5;
  for (let i = supplies.length - 1; i >= 0; i--) {
    const s = supplies[i], d = Math.hypot(s.x - player.pos.x, s.z - player.pos.z);
    if (!s.ci && !s.fixed && !s.persist && !s.sid && d > 260) { scene.remove(s.mesh); supplies.splice(i, 1); continue; }
    s.mesh.visible = d < vis;
    if (!s.mesh.visible) continue;
    s.mesh.rotation.y += dt * 0.8;
    s.mesh.position.y = s.base + Math.sin(G.T * 2 + s.ph) * 0.03;
    if (d < best && Math.abs(s.base - player.pos.y) < 2.2) { best = d; nearSupply = s; }
  }
  G.supplyT -= dt;
  if (G.supplyT <= 0) { G.supplyT = CFG.supplyEvery; spawnSupplyRespawn(); }
  fx.update(dt);
  camera.updateMatrixWorld();
  audio.setListener(camera); audio.update(dt);
  updateHud(dt);
}

function updateDead(dt) {
  G.deadT += dt;
  player.eyeH = damp(player.eyeH, 0.22, 3.5, dt);
  player.roll = damp(player.roll, 1.1, 2.2, dt);
  player.pitch = damp(player.pitch, -0.2, 2, dt);
  player.applyCamera(dt, 0);
  camera.fov = 72; camera.updateProjectionMatrix();
  $('scope').classList.remove('on');
  weapon.group.visible = G.deadT < 0.4;
  world.update(dt, G.T, player.pos.x, player.pos.y, player.pos.z, G.dark);
  updateZombies(dt, false);
  hanging.update(dt, G.T, player, false); npcs.update(dt, G.T, player, false); mummy.update(dt, G.T, player, false); dogs.update(dt, G.T, player, false); worms.update(dt, G.T, player, false);
  fx.update(dt);
  camera.updateMatrixWorld(); audio.setListener(camera); audio.update(dt);
  G.dmgFlash = Math.max(G.dmgFlash, 0.5);
  updateHud(dt);
  $('lowhp').style.opacity = 0;
  if (G.deadT > 2.2 && $('death').classList.contains('hidden')) {
    $('d-kills').textContent = G.kills; $('d-waves').textContent = G.wavesCleared; $('d-time').textContent = fmtTime(G.survive); $('d-cause').textContent = 'Cause of death: ' + (G.cause || 'Killed by the dead');
    showScreen('death'); showHud(false);
  }
}

function updateMenu(dt) {
  const a = G.T * 0.07 + 1.2, r = 11;
  camera.position.set(CAMP.x + Math.cos(a) * r, world.hgt(CAMP.x, CAMP.z) + 2.6 + Math.sin(G.T * 0.2) * 0.3, CAMP.z + Math.sin(a) * r);
  camera.lookAt(menuTarget);
  camera.fov = 62; camera.updateProjectionMatrix();
  world.update(dt, G.T, camera.position.x, camera.position.y, camera.position.z, 0);
  fauna.update(dt, G.T, camera.position.x, camera.position.y, camera.position.z, 0);
  camera.updateMatrixWorld();
  audio.setListener(camera); audio.update(dt);
}

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  G.T += dt;
  switch (G.mode) {
    case 'playing': updatePlaying(dt); break;
    case 'dead': updateDead(dt); break;
    case 'menu': updateMenu(dt); break;
    default: break;
  }
  renderer.clear();
  renderer.render(scene, camera);
  if (G.mode !== 'menu' && weapon.group.visible) weapon.render(renderer);
}

const invUI = new InventoryUI(inventory, $('inventory'), {
  use: (i) => useAt(i),
  drop: (i, all) => dropFromInventory(i, all),
  fatal: () => G.infection >= 5,
  extraInfo: (s) => (s.type === 'flesh' ? `<p class="warn">Infection: ${G.infection} / 6${G.infection >= 5 ? ' — the next piece is FATAL' : ''}</p>` : ''),
});
$('inv-close').onclick = () => closeInventory();
$('inv-yes').onclick = () => { $('inv-confirm').classList.add('hidden'); const i = +$('inv-confirm').dataset.i; if (inventory.slots[i] && inventory.slots[i].type === 'flesh') { inventory.removeAt(i, 1); eatFlesh(); } };
$('inv-no').onclick = () => $('inv-confirm').classList.add('hidden');
function confirmFatal(i) { $('inv-confirm').dataset.i = i; $('inv-confirm').classList.remove('hidden'); }

// ------------------------------------------------------------------ boot
syncSettingsUI();
applyQuality(settings.quality);
resize();
weapon.group.visible = false;
resetGame();
showScreen('menu'); showHud(false);
frame();

window.__dw = { dogs, worms, hanging, npcs, mummy, inventory, invUI, PROGRESS, nests, eatFlesh, useType, openInventory, closeInventory, dropItem, G, player, weapon, zombies, world, camera, scene, supplies, keys, startGame, damagePlayer, startWave, renderer, pauseGame, resumeGame, toMenu, fauna, minimap, vstate, QUALITY };
if (DEBUG) {
  G.noLock = true;
  if (params.has('autostart')) startGame();
}
