# DEADWOOD — 3D Zombie Survival

First-person zombie survival shooter in a procedurally generated night forest.
Three.js (r160, bundled in `lib/`), plain JS/HTML/CSS, no build step, no external assets —
all models, terrain, textures and audio are generated in code.

## Run it

Browsers block ES modules from `file://`, so serve the folder locally:

```
node serve.mjs          # opens http://localhost:8080
# or: python -m http.server 8080   then open http://localhost:8080
# or: double-click start.bat (Windows)
```

Use a desktop Chrome / Edge / Firefox. Click **Play Game** (this captures the mouse).
Esc, or switching tabs/windows, pauses. Headphones recommended.

## Controls

| Key | Action | Key | Action |
|---|---|---|---|
| W A S D | Move | F | Flashlight |
| Mouse | Look / aim | E | Collect supplies |
| Left click | Shoot (hold = auto) | Space | Jump |
| Right click | Aim down sights | Shift | Sprint (uses stamina) |
| R | Reload | Ctrl / **C** | Crouch (hold) |
| X | Sit / stand | Esc | Pause |
| 1 2 3 / wheel | Rifle / Glock / Sniper | B | Replace flashlight battery |
| M | Expand map | Shift (scoped) | Hold breath |

Browsers reserve **Ctrl+W** (close tab) — if you crouch while walking forward, use **C** instead.

## Gameplay

- **World:** 1 km x 1 km, streamed in 100 m chunks around you (only nearby chunks exist; trees use near/far LOD and are culled past the fog). River, ponds, dense forest, four abandoned villages (5-6 houses, a well stuffed with bodies, corpses everywhere), blood trails, people hanged from dead trees, crows, bats and owls.
- **Darkness:** the further you go from the camp, some sectors (around the villages and a few deep-forest areas) turn pitch black with thick fog. The flashlight is all you have there.
- **Flashlight battery:** about 5 minutes per battery; it dims and flickers when low and dies at 0. Spare batteries are in village houses (and occasionally in the forest). Press **B** to swap.
- **Guns:** AK rifle (30/120, auto), Glock 17 (17/51, semi), Sniper (5/15, bolt action, 5x scope with breath sway - hold Shift to steady). Ammo boxes refill all three.
- **Damage:** headshot = instant kill; body = normal damage; arm/leg shots deal less damage but break the limb - arms are severed (weaker attacks), a broken leg drops the zombie into a crawl.
- **Zombies:** walkers, runners, and very fast sprinters (wave 4+ and in the dark). Gunshots are heard (sniper > rifle > pistol): zombies investigate and more come out of the dark. Some "corpses" in villages get up when you come close.
- **The Butcher:** a huge sack-hooded zombie with a machete roams Hollow Creek. Headshots only do x3 damage on him. Killing him drops supplies.
- **Waves:** 5, 8, 12, 16, 20, then +4 per wave; 15 s break between waves. Waves follow you wherever you are.
- **Supplies:** ammo boxes, medkits (+50 HP), batteries - press **E**. They respawn over time.

## Settings

Mouse sensitivity, volume and graphics quality (Low / Medium / High) are in the main-menu Settings and the pause menu, and are remembered in the browser. Low: no shadows, half the trees, shorter view, lower resolution, 12 zombies max - use it on weak laptops. High: 2048 shadow map, full forest, 22 zombies max.

## Files

```
index.html  style.css  serve.mjs  start.bat
lib/three.module.min.js     Three.js r160
js/main.js      game loop, input, HUD, menus, waves, supplies
js/world.js     1 km streamed world: terrain chunks, forest LOD, river/ponds, villages, props, collisions, darkness sectors
js/fauna.js     crows, bats, owls
js/minimap.js   minimap + full map (M)
js/player.js    first-person controller
js/weapon.js    rifle, Glock, sniper (models, firing, scope, reload, switching)
js/zombies.js   zombie types, boss, limb damage, crawling, AI, corpses / hanged bodies
js/audio.js     procedural Web Audio (spatial)   fx.js: particles   util.js: helpers
```
