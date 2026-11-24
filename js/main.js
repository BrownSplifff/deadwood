import * as THREE from '../lib/three.module.min.js';
import { clamp, lerp, damp, rand, pick, fmtTime } from './util.js';
import { createWorld, CAMP, CABIN, SPAWN, VILLAGES } from './world.js';
import { GameAudio } from './audio.js';
import { Particles } from './fx.js';
import { Player, PCFG } from './player.js';
import { Weapon, GUNS } from './weapon.js';
import { Zombies } from './zombies.js';
import { Fauna } from './fauna.js';
import { Minimap } from './minimap.js';

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

const CFG = { prepTime: 15, firstPrep: 10, supplyEvery: 22, maxSupplies: 140, pickupRange: 2.4, medHeal: 50, batteryLife: 300, maxSpares: 5 };

// ------------------------------------------------------------------ renderer / scene
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: settings.quality !== 'low', powerPreference: 'high-performance' });
renderer.autoClear = false;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.35;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, 1, 0.05, 420);
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

const flashlight = new THREE.SpotLight(0xfff1d2, 140, 50, 0.4, 0.55, 1.5);
flashlight.position.set(0.14, -0.12, 0.05);
flashlight.target.position.set(0.14, -0.12, -6);
camera.add(flashlight, flashlight.target);
const muzzleLight = new THREE.PointLight(0xffa24a, 0, 16, 2);
scene.add(muzzleLight);

const G = {
  mode: 'menu', noLock: false,
  survive: 0, kills: 0, wave: 1, wavesCleared: 0, waveState: 'prep', prepT: CFG.firstPrep, toSpawn: 0, spawnT: 0,
  flashOn: true, battery: 100, spares: 1, flickT: 0, dmgFlash: 0, hbT: 0, hitT: 0, deadT: 0, supplyT: CFG.supplyEvery, T: 0, bannerT: 0, areaT: 0,
  lookDX: 0, lookDY: 0, mouseDown: false, adsHeld: false, dark: 0, eventT: 20, ambientT: 2, lastArea: null, darkMsgT: 0,
};
const keys = {};
const supplies = [];
const vstate = VILLAGES.map((v) => ({ v, populated: false }));

const weapon = new Weapon({
  camera, world, zombies, fx, audio, player, muzzleLight,
  hooks: {
    onHit(res, zone) {
      G.hitT = 0.16;
      $('hitmarker').className = 'show' + (res.killed ? ' kill' : zone === 'head' ? ' head' : res.broke ? ' limb' : '');
      audio.hitmarker();
    },
    onShot(def, o) {
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
    flashOn: true, battery: 100, spares: 1, flickT: 0, dmgFlash: 0, hbT: 0, hitT: 0, deadT: 0, supplyT: CFG.supplyEvery, mouseDown: false, adsHeld: false,
    dark: 0, eventT: 25, ambientT: 2, lastArea: null, darkMsgT: 0 });
  for (const s of vstate) { s.populated = false; s.v.bossDead = false; }
  flashlight.visible = true;
  muzzleLight.intensity = 0;
  for (const s of supplies) scene.remove(s.mesh);
  supplies.length = 0;
  seedSupplies();
  if (minimap.big) minimap.toggle();
  $('banner').style.opacity = 0; $('area').style.opacity = 0;
  world.updateChunks(player.pos.x, player.pos.z, true);
}

// ------------------------------------------------------------------ input
addEventListener('keydown', (e) => {
  if (G.mode !== 'playing') return;
  if (e.code === 'Space' || e.code.startsWith('Control') || e.code === 'Tab' || e.code.startsWith('Arrow')) e.preventDefault();
  if (e.repeat) { keys[e.code] = true; return; }
  keys[e.code] = true;
  switch (e.code) {
    case 'KeyR': weapon.startReload(); break;
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
  if (G.spares <= 0) { showPromptFlash('No spare batteries — search village houses'); return; }
  if (G.battery >= 99) { showPromptFlash('Battery is full'); return; }
  G.spares--; G.battery = 100; G.flashOn = true; audio.battery();
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
function addSupply(type, x, z, y) {
  const S = SUP[type], g = new THREE.Group();
  if (type === 'battery') {
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
  const spr = new THREE.Sprite(glowMats[type]); spr.scale.set(1, 1, 1); spr.position.y = 0.25; g.add(spr);
  const base = (y ?? world.hgt(x, z)) + 0.13;
  g.position.set(x, base, z); g.rotation.y = Math.random() * 6.28;
  scene.add(g);
  supplies.push({ type, mesh: g, x, z, base, ph: Math.random() * 6 });
}
const randType = () => { const r = Math.random(); return r < 0.5 ? 'ammo' : r < 0.78 ? 'med' : 'battery'; };
function seedSupplies() {
  const hC = world.hgt(CABIN.x, CABIN.z), hP = world.hgt(CAMP.x, CAMP.z);
  for (const s of world.cabinSpots) addSupply(s.type, s.x, s.z, hC + s.y);
  for (const s of world.campSpots) addSupply(s.type, s.x, s.z, hP);
  for (const s of world.lootSpots) addSupply(s.type, s.x, s.z, s.y);
  let n = 0, tries = 0;
  while (n < 50 && tries++ < 600) {
    const x = rand(-460, 460), z = rand(-460, 460);
    if (world.blocked(x, z, 1) || world.inBuilding(x, z, 0.5) || world.hgt(x, z) < 0.4) continue;
    addSupply(randType(), x, z); n++;
  }
}
function spawnSupplyRespawn() {
  if (supplies.length >= CFG.maxSupplies) return;
  if (Math.random() < 0.3) {
    const spots = [...world.cabinSpots, ...world.campSpots, ...world.lootSpots].filter((s) => Math.hypot(s.x - player.pos.x, s.z - player.pos.z) > 25 && !supplies.some((u) => Math.hypot(u.x - s.x, u.z - s.z) < 1));
    if (spots.length) {
      const s = pick(spots), hC = world.hgt(CABIN.x, CABIN.z);
      addSupply(s.type, s.x, s.z, s.y !== undefined ? (s.y > 2 ? s.y : hC + s.y) : undefined); return;
    }
  }
  const sp = world.findSpot(player.pos.x, player.pos.z, 25, 85, player.yaw);
  if (sp) addSupply(randType(), sp.x, sp.z);
}
let nearSupply = null;
function interact() {
  if (!nearSupply) return;
  const s = nearSupply;
  if (s.type === 'med') {
    if (player.health >= PCFG.maxHealth) return;
    player.health = Math.min(PCFG.maxHealth, player.health + CFG.medHeal);
  } else if (s.type === 'battery') {
    if (G.spares >= CFG.maxSpares) { showPromptFlash('Cannot carry more batteries'); return; }
    G.spares++;
  } else weapon.addAmmoAll();
  audio.pickup();
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
  zombies.spawn(rollType(), sp.x, sp.z, 'wave');
  return true;
}
function updateWaves(dt) {
  if (G.waveState === 'prep') { G.prepT -= dt; if (G.prepT <= 0) startWave(); return; }
  const max = QUALITY[settings.quality].maxZ, alive = zombies.aliveCount();
  G.spawnT -= dt;
  if (G.toSpawn > 0 && alive < max && G.spawnT <= 0) { if (spawnOne()) { G.toSpawn--; G.spawnT = alive < 4 ? 0.5 : 1.2; } }
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
      for (let i = 0; i < 3 && i < spots.length; i++) { const e = zombies.spawnDormant(spots[i].x + rand(-1.5, 1.5), spots[i].z + rand(-1.5, 1.5), 'village'); e.village = v; }
      for (let i = 0; i < 3; i++) {
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
    if (sp) { const e = zombies.spawn(rollType(G.dark * 0.15), sp.x, sp.z, 'ambient'); e.state = 'wander'; zombies.pickWander(e); }
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
const DARKC = new THREE.Color(0x020306), BASEFOG = new THREE.Color(0x0b1428);
function updateAtmosphere(dt) {
  const q = QUALITY[settings.quality];
  const target = world.darkness(player.pos.x, player.pos.z);
  G.dark = damp(G.dark, target, 0.7, dt);
  const k = G.dark;
  world.hemi.intensity = lerp(2.1, 0.09, k);
  world.moon.intensity = lerp(2.0, 0.04, k);
  scene.fog.far = lerp(q.fog, 22, k);
  scene.fog.near = lerp(3, 0.5, k);
  scene.fog.color.copy(BASEFOG).lerp(DARKC, k);
  scene.background.copy(scene.fog.color);
  world.domeMat.color.setScalar(1 - 0.92 * k);
  world.starMat.opacity = 0.8 * (1 - k);
  world.moonMat.opacity = 1 - 0.9 * k;
  renderer.toneMappingExposure = lerp(1.35, 1.25, k);
  audio.setDark(k);
  G.darkMsgT -= dt;
  if (k > 0.45 && G.darkMsgT <= 0 && !G.lastArea) { showArea('', 'it is too dark here… stay close to your light'); G.darkMsgT = 90; }
}

// ------------------------------------------------------------------ player damage / death
function damagePlayer(dmg) {
  if (G.mode !== 'playing') return;
  player.health -= dmg;
  G.dmgFlash = Math.min(1.4, dmg / 14);
  audio.hurt();
  player.pitch += (Math.random() - 0.3) * 0.03 * (dmg / 14); player.yaw += (Math.random() - 0.5) * 0.04 * (dmg / 14);
  if (player.health <= 0) { player.health = 0; die(); }
}
function die() {
  G.mode = 'dead'; G.deadT = 0;
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
  setText('t-spares', String(G.spares));
  setText('a-mag', String(weapon.mag)); setText('a-res', String(weapon.reserve));
  setText('wname', weapon.gun.def.name);
  if (hudCache.slot !== weapon.cur) { hudCache.slot = weapon.cur; document.querySelectorAll('#slots span').forEach((s) => s.classList.toggle('on', +s.dataset.i === weapon.cur)); }
  $('ammo').classList.toggle('low', weapon.mag <= Math.ceil(weapon.gun.def.mag / 6));
  let h = '';
  if (weapon.reloading) h = 'RELOADING'; else if (weapon.mag === 0 && weapon.reserve === 0) h = 'NO AMMO'; else if (weapon.mag <= Math.ceil(weapon.gun.def.mag / 6) && weapon.reserve > 0) h = 'RELOAD [R]';
  setText('a-hint', h); $('a-hint').classList.toggle('show', !!h);
  setText('fl-state', G.battery <= 0 ? 'DEAD' : G.flashOn ? 'ON' : 'OFF');
  setText('posture', player.sitting ? 'SITTING' : player.crouching ? 'CROUCHING' : player.inWater ? 'WADING' : '');
  $('crosshair').classList.toggle('ads', weapon.ads > 0.6);
  $('scope').classList.toggle('on', !!weapon.scoped);
  setText('prepbar', G.waveState === 'prep' ? `WAVE ${G.wave} BEGINS IN ${Math.max(0, Math.ceil(G.prepT))}` : '');
  let p = '';
  if (nearSupply) {
    if (nearSupply.type === 'med') p = player.health >= PCFG.maxHealth ? 'Health is full' : `<kbd>E</kbd> Use medical kit (+${CFG.medHeal} HP)`;
    else if (nearSupply.type === 'battery') p = `<kbd>E</kbd> Take flashlight battery (${G.spares}/${CFG.maxSpares})`;
    else p = '<kbd>E</kbd> Collect ammunition (all guns)';
  } else if (promptFlashT > 0) p = promptFlash;
  else if (G.battery <= 0 && G.spares > 0) p = '<kbd>B</kbd> Replace dead battery';
  promptFlashT -= dt;
  const pe = $('prompt');
  if (hudCache.prompt !== p) { hudCache.prompt = p; pe.innerHTML = p; pe.classList.toggle('show', !!p); }
  // boss bar
  const boss = zombies.boss();
  const showBoss = boss && boss.dist < 55 && (boss.state === 'chase' || boss.state === 'attack' || boss.dist < 30);
  $('bossbar').style.display = showBoss ? 'block' : 'none';
  if (showBoss) $('b-boss').style.width = (boss.hp / boss.maxHp) * 100 + '%';
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
  player.update(dt, keys, { canMove: true, aiming, firing: G.mouseDown });
  // sniper scope sway; hold Shift to steady your breath
  let swP = 0, swY = 0;
  if (weapon.scoped) {
    const hold = (keys.ShiftLeft || keys.ShiftRight) && player.stamina > 1;
    if (hold) player.stamina = Math.max(0, player.stamina - 22 * dt);
    const amp = hold ? 0.0005 : 0.004 * (1 + clamp(player.hspeed / 3, 0, 1));
    swP = (Math.sin(G.T * 0.9) + Math.sin(G.T * 2.3) * 0.3) * amp;
    swY = Math.cos(G.T * 0.7) * amp * 1.2;
  }
  player.applyCamera(dt, weapon.recoil + swP, swY);
  camera.fov = lerp(72, weapon.gun.def.adsFov, weapon.ads);
  camera.updateProjectionMatrix();
  updateFlashlight(dt);
  weapon.update(dt, { firing: G.mouseDown, adsHeld: G.adsHeld, sprinting: player.sprinting, canAct: true, lookDX: G.lookDX, lookDY: G.lookDY, time: G.T });
  G.lookDX = G.lookDY = 0;
  updateAtmosphere(dt);
  world.update(dt, G.T, player.pos.x, player.pos.y, player.pos.z, G.dark);
  fauna.update(dt, G.T, player.pos.x, player.pos.y, player.pos.z, G.dark);
  updateZombies(dt, true);
  updateWaves(dt);
  updateVillages();
  updateAmbient(dt);
  updateSuspense(dt);
  nearSupply = null; let best = CFG.pickupRange;
  const vis = world.viewDist + 5;
  for (const s of supplies) {
    const d = Math.hypot(s.x - player.pos.x, s.z - player.pos.z);
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
  fx.update(dt);
  camera.updateMatrixWorld(); audio.setListener(camera); audio.update(dt);
  G.dmgFlash = Math.max(G.dmgFlash, 0.5);
  updateHud(dt);
  $('lowhp').style.opacity = 0;
  if (G.deadT > 2.2 && $('death').classList.contains('hidden')) {
    $('d-kills').textContent = G.kills; $('d-waves').textContent = G.wavesCleared; $('d-time').textContent = fmtTime(G.survive);
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

// ------------------------------------------------------------------ boot
syncSettingsUI();
applyQuality(settings.quality);
resize();
weapon.group.visible = false;
resetGame();
showScreen('menu'); showHud(false);
frame();

window.__dw = { G, player, weapon, zombies, world, camera, scene, supplies, keys, startGame, damagePlayer, startWave, renderer, pauseGame, resumeGame, toMenu, fauna, minimap, vstate, QUALITY };
if (DEBUG) {
  G.noLock = true;
  if (params.has('autostart')) startGame();
}
