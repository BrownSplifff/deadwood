# DEADWOOD — 3D Zombie Survival

A first-person survival horror shooter set in a procedurally generated 4 km × 4 km night world:
a small haunted forest, a belt of hanging woods, and a vast desert with pyramids, cults, giant
worms and an ancient mummy.

Everything — terrain, trees, buildings, characters, animals, textures and sound — is generated in
code. Built with Three.js (r160, bundled in `lib/`), plain JavaScript/HTML/CSS, no build step and
no downloaded assets.

---

## Contents

1. [Running the game](#1-running-the-game)
2. [Controls](#2-controls)
3. [Goal and core loop](#3-goal-and-core-loop)
4. [The player](#4-the-player)
5. [Flashlight and batteries](#5-flashlight-and-batteries)
6. [Weapons and shooting](#6-weapons-and-shooting)
7. [Damage model](#7-damage-model)
8. [Enemies and creatures](#8-enemies-and-creatures)
9. [Bosses](#9-bosses)
10. [How enemies spawn](#10-how-enemies-spawn)
11. [Noise, stealth and detection](#11-noise-stealth-and-detection)
12. [The world](#12-the-world)
13. [Structures](#13-structures)
14. [Atmosphere, lighting and weather](#14-atmosphere-lighting-and-weather)
15. [Items, loot and inventory](#15-items-loot-and-inventory)
16. [Infected flesh and infection](#16-infected-flesh-and-infection)
17. [Death, restart and progression](#17-death-restart-and-progression)
18. [HUD, map and menus](#18-hud-map-and-menus)
19. [Audio](#19-audio)
20. [Graphics settings and performance](#20-graphics-settings-and-performance)
21. [Code architecture](#21-code-architecture)
22. [Tuning guide](#22-tuning-guide)
23. [Debugging](#23-debugging)

---

## 1. Running the game

Browsers do not load ES modules from `file://`, so serve the folder locally:

```
node serve.mjs                      # opens http://localhost:8080
python -m http.server 8080          # then open http://localhost:8080
start.bat                           # Windows: double-click
```

Use desktop Chrome, Edge or Firefox. Click **Play Game** — the game captures the mouse (pointer
lock). Headphones are recommended: most enemies are positional sounds before you see them.

---

## 2. Controls

| Key | Action |
|---|---|
| W A S D | Move |
| Mouse | Look / aim |
| Left click | Shoot (hold for automatic fire on the rifle) |
| Right click | Aim down sights (sniper: scope) |
| R | Reload (opens an ammo box from the inventory if your reserve is empty) |
| 1 / 2 / 3, mouse wheel | Rifle / Glock / Sniper |
| Shift | Sprint · while scoped: hold breath (steadies the scope) |
| Space | Jump |
| Ctrl or C (hold) | Crouch |
| X | Sit down / stand up |
| F | Flashlight on/off |
| B | Replace flashlight battery (uses a battery from the inventory) |
| H | Use a medical kit |
| E | Pick up the item in front of you |
| Tab | Open/close the inventory (pauses the game) |
| G | Drop the selected item (inventory open) |
| M | Expand / shrink the map |
| Esc | Pause |

**Inventory mouse controls:** left-click selects a slot, right-click opens its actions
(Use / Eat / Drink / Load / Swap, Drop one, Drop stack), drag a slot onto another to move it or
merge stacks.

Browsers reserve **Ctrl+W** (close tab); if you crouch while walking forward, use **C**.

---

## 3. Goal and core loop

There is no ending: **survive as long as you can**. The score shown on death is total kills,
waves survived and survival time.

- **Waves** of zombies hunt you wherever you are, getting larger and faster.
- Between waves you **explore** for ammunition, medicine, batteries, food and treasure.
- Every area is more dangerous than the last: the forest is dark, the Hanging Woods are worse,
  the desert hides worms, dogs and an army of the dead beneath the sand.
- **Bosses** — the Butcher in outer villages and the Ancient Mummy in the Great Pyramid — guard
  the best rewards.
- **Infected flesh** lets you trade your life expectancy for raw power.

You start at the campfire in the middle of the forest with:
- AK rifle 30/120, Glock 17 17/51, Sniper 5/15
- inventory: 1 battery, 1 ammo box, 1 canned food, 1 water bottle
- 100 health, 100% flashlight battery

---

## 4. The player

### Movement
| State | Speed |
|---|---|
| Walk | 4.2 m/s |
| Sprint (forward only) | 7.4 m/s |
| Crouch | 2.0 m/s |
| Aiming down sights | 2.6 m/s |
| Sitting | cannot move (can look and shoot) |
| In water (river/pond) | ×0.55 |
| Infection bonus | ×(1 + 0.3 per piece eaten) |

- Movement accelerates smoothly (no instant stops), with gravity 22 m/s² and jump speed 6.8 m/s
  (≈1 m jump). You stick to the ground on downhill slopes and step up stairs.
- Camera eye height: 1.7 m standing, 1.15 m crouched, 0.5 m sitting (smooth transitions).
- Head bob, weapon sway and footstep sounds follow your speed; wading makes splashing steps.
- Collision radius 0.4 m against trees, rocks, logs, walls, buildings, pyramids and NPCs.
  Interiors have ceilings.
- You cannot leave the map: a ring of hills rises at the 4 km border.

### Health
- 100 health. It does not regenerate on its own.
- Healing: medical kit +50, canned food +10.
- Taking damage gives a red screen flash. Below 35 health the edges pulse red and you hear your
  heartbeat (faster as health drops). Acid hits flash the screen green.

### Stamina
> **Currently disabled.** `staminaDrain: false` in `js/player.js` keeps stamina full: sprinting,
> jumping, holding breath and infection do not drain it. Set it to `true` to restore the rules below.

When enabled: sprinting drains 20/s (more when infected), jumping costs 6, holding breath while
scoped drains 22/s. Stamina regenerates at 12/s while moving and 22/s while still. If it hits 0
you are **exhausted** and cannot sprint until it recovers to 22.

---

## 5. Flashlight and batteries

- A spotlight on your gun, following your view. It reaches about 50 m and adapts its
  brightness: dimmer when the surface in front of you is close (no white-out), full power at range.
- One battery lasts **5 minutes** of light (it only drains while switched on).
- Below **20%** the light dims and flickers more and more; at 0 it dies.
- **B** swaps in a spare battery from your inventory. Batteries are found in houses, settlements,
  forest loot and camps; they stack 5 per slot.
- Having the flashlight on makes you a little easier to spot (detection ×1.15; ×0.9 when off).

---

## 6. Weapons and shooting

| | AK Rifle | Glock 17 | Sniper |
|---|---|---|---|
| Magazine / starting reserve | 30 / 120 | 17 / 51 | 5 / 15 |
| Damage per hit | 35 | 26 | 140 |
| Fire mode | full auto, 600 rpm | semi-auto | bolt action (1.25 s between shots) |
| Reload | 2.0 s | 1.5 s | 3.0 s |
| Hip spread / ADS spread | 0.014 / 0.0025 rad | 0.011 / 0.003 | 0.05 / 0 (scoped) |
| ADS field of view | 52° | 60° | 13° (≈5× scope) |
| Loudness (hearing radius) | 70 m | 40 m | 120 m |
| Ammo per ammo box | +30 | +17 | +5 |

- **Hitscan** rays (220 m range). Bullets stop on trees, rocks, logs, walls, pillars, terrain and
  water (with matching impact particles and sounds).
- **Spread** grows when moving (more for the sniper) and when airborne, and shrinks by 40% when
  crouching or sitting.
- **Recoil** kicks the view up and slightly sideways; it recovers by itself. ADS reduces recoil by 45%.
- **Sniper scope:** a full-screen scope overlay, mouse sensitivity scaled to the zoom, and a slow
  breathing sway — hold **Shift** to steady it.
- **Switching** weapons takes ~0.5 s (lower, swap, raise) and cancels a reload.
- **Semi-auto click buffering:** a click made within 0.35 s before the gun is ready is fired as
  soon as it is ready (no lost shots between bolt cycles).
- An empty magazine clicks; HUD shows `RELOAD [R]` when low and `NO AMMO` when everything is empty.
- **Ammo boxes** add ammo to all three guns at once (use from the inventory, or R with an empty reserve).
- **Damage bonus:** every piece of infected flesh eaten adds +30% damage to all weapons.

---

## 7. Damage model

Every humanoid enemy is hit-tested per body part (head sphere, torso capsule, upper/lower arm and
leg capsules), using the pose it is actually in.

| Hit zone | Ordinary zombies | Heavy enemies (Butcher, giant dead) |
|---|---|---|
| Head | **instant kill** | ×3 damage |
| Torso | full damage | full damage |
| Arm | 60% damage + **arm severed** | 60%, no break |
| Leg | 60% damage + **leg severed → crawls** | 60%, no break |

- **Severed arm:** that forearm is gone (blood stump); attacks do 75% damage with one arm,
  50% with none.
- **Severed leg:** the zombie falls and **crawls** (0.45–1.0 m/s), still dangerous at reduced
  damage.
- Other targets: Hanging Dead, dogs and cultists die to headshots; the Mummy takes ×3 to the head;
  a sand worm takes ×2 into its maw.
- A hit marker confirms hits: white (body), orange (limb broken), red (headshot or kill).

---

## 8. Enemies and creatures

### Zombies (forest and everywhere)
| Type | Health | Speed | Bite | Notes |
|---|---|---|---|---|
| Walker | 100 | 1.5 m/s | 14 | arms outstretched, slow shamble |
| Runner | 70 | 4.0 m/s | 9 | from wave 3 |
| Sprinter | 60 | 6.3 m/s | 8 | from wave 4 and in dark sectors |
| Giant dead | 900 | 1.3 wander / 2.7 chase | 30 (3.9 m reach) | 15 ft (~4.6 m), forest only |

**Behaviour (state machine):** idle → wander (random points) → *investigate* (a noise) →
*chase* → *attack*. They notice you within ~26 m (see §11), chase until you are more than
2.2× their detection range away for 5 s, attack within ~1.65 m with a wind-up (you can step
out of range to avoid the hit), steer around trees and walls with a persistent side-slip so they
never get stuck, and push apart so they never overlap.

**Special states**
- **Dormant:** some "corpses" in villages are zombies lying among the dead. They rise when you
  come within 8.5 m or shoot nearby.
- **Buried (sand zombies):** desert zombies wait under the sand. When you come within 10–15 m
  (but never right on top of you) the sand churns, a burst of sand erupts and they claw their way
  out over ~2.3 s, then chase.
- **Crawling:** after losing a leg.

Ordinary zombies always drop **one piece of infected flesh** when killed (only once each). Dead
bodies collapse and are removed after ~14 s (or sooner if far away).

### The Hanging Dead (Hanging Woods)
Corpses hanging from dead trees near the trails. They sway until you come within 26 m and have
line of sight, then turn their heads to follow you, gurgle (0.45 s warning) and spit a **glob of
green acid** every 2.8–4.4 s. The acid flies at 15 m/s with a slight arc, aimed a little ahead of
you — strafe to dodge it. Hit = 12 damage. They have 60 health (headshot kills); when killed the
rope snaps and the body drops, and it stays dead for the session. 35% drop an ammo box.

### Cultists (desert camps)
Hooded figures with glowing eyes. Six sit in a circle around the bonfire and one walks a slow
circle around the camp. They perform a **synchronised ritual** — raise arms (6 s), bow (4 s),
kneel and pray (7 s), sit (9 s) — while chanting. When you come within 26 m some turn their heads
and watch you for a few seconds, then return to the ritual.

They are **neutral**. If anything in the camp is hurt (a cultist or a camel), **that camp turns
hostile**: every cultist within 70 m of the camp draws a dagger, runs at you (3.4 m/s) and stabs
for 7 damage every 1.5 s. Cultists have 60 health (headshot kills) and may drop cloth or coins.

### Camels (desert camps)
Two per camp. They wander slowly around the camp (pacing gait), stand and look around, and walk
to the bonfire to sit down for a while. They groan now and then. Passive — they never attack;
shooting one (80 health) angers the camp.

### Infected dogs (desert)
Packs of 3–5 mangy dogs with infected sores and glowing eyes. They roam until you come within
38 m or fire nearby, then **circle you and dart in** to bite (8 damage, every 0.85 s within
1.5 m) at 7.2 m/s. 45 health, headshots kill. Each drops one piece of infected flesh.

### Sand worms (desert "DEEP SANDS" territories only)
Three territories of 150–190 m radius, marked in red on the map. A worm hunts by **vibration**:

| Your action inside a territory | Tremor meter |
|---|---|
| Sprinting | +3.4 per second |
| Walking | +~1.75 per second (scales with speed) |
| Crouch-walking | ×0.4 |
| Standing still | −2.5 per second |
| Gunshot (within territory + 50 m) | + loudness/4.5 (rifle ≈ +16, sniper ≈ +27) |

The HUD shows `TREMOR %`. At 100% (meter 30):
1. **Hunt:** a mound of sand surfaces 85 m away and tunnels toward you at 12 m/s with a growing
   rumble and ground shake. Leave the territory (by more than 70 m) and it gives up.
2. **Lock:** within 9 m it fixes the strike point (where you are, slightly ahead of where you are
   heading). A sand **vortex** opens there.
3. **Eruption (1.4 s later):** a 50+ m worm with a petal-jawed, tooth-ringed maw bursts out and
   arcs overhead for 4.6 s before diving back under. Anyone within 8.5 m of the vortex is
   **devoured** (95 damage); being crushed by the body costs 40.
4. It then rests for 25–40 s.

While above the sand the worm can be shot (5000 health, ×2 in the maw). Killing it silences that
territory for the session and drops 2 relics, 15 coins and 2 ammo boxes.

### Wildlife (ambient, harmless)
Crows circling overhead (cawing), bats that gather around you in dark areas (up to ~16, squeaking),
and owls on branches and rooftops whose heads turn to follow you — they hoot, and fly off if you get
within 6 m.

---

## 9. Bosses

### The Butcher (outer villages)
A sack-hooded, apron-wearing giant with a machete. Found in ~40% of outer villages more than
450 m from spawn (skull ☠ on the map). 1000 health, walks 1.1 m/s and charges at 2.9 m/s,
**40-damage machete chops** (1.5 s swing, 2.7 m reach). He never leaves his village (he gives up
the chase if you get far enough away). Headshots ×3. Killing him drops 2 ammo boxes, a medkit and a battery.

### The Ancient Mummy (heart of the Great Pyramid)
A ~7.5 m bandaged pharaoh with a striped nemes headdress, gold collar and loose trailing bandages.
**3600 health**, headshots ×3.

**Encounter.** It sits slumped on a giant throne. When you enter the central chamber it slowly
raises its head, its eyes ignite, it rises and steps down, and its health bar appears.

| Phase | Health | Movement | Attack interval | Attacks |
|---|---|---|---|---|
| 1 | 100–60% | 2.4 m/s | ~2.0 s | bandage projectile, melee |
| 2 | 60–25% | 3.3 m/s | ~1.4 s | + bandage grab, + summon the dead |
| 3 | < 25% | 4.2 m/s | ~0.9 s | + ground slam, double bandage volleys |

It roars and staggers briefly when it changes phase.

| Attack | Warning | Effect |
|---|---|---|
| **Bandage projectile** | arm draws back (0.5 s) | a strip of cloth lashes out at 30 m/s, aimed ahead of you, up to 60 m. Pillars and walls block it. 14 damage. |
| **Bandage grab** | both arms (0.7 s) | a thicker bandage at 34 m/s (up to 45 m). If it hits, you are **held** (can't move) for 1.7 s, dragged toward it at 6 m/s and take 18 damage. |
| **Summon the dead** | arms raised, chant (1.1 s) | 2 sand zombies (3 in phase 3) claw out of the floor 6–14 m from you. Max 5 at a time, every 14 s at most. |
| **Ground slam** (phase 3, when you are close) | arms raised (0.8 s) | a sand shockwave ring expands at 20 m/s out to 24 m: 30 damage when it reaches you, unless you are **in the air** (jump it) or out of range. |
| **Melee swipe** | 0.42 s | 16 damage within reach. |

**Defeat.** It drops to its knees and topples in a cloud of sand; all projectiles vanish and a
banner announces its fall. It drops: **Eye of the Pharaoh** (unique relic), **Desert Seal**
(completion item), 5 mummy bandages, 2 relics, 12 coins, 2 ammo boxes and a medkit. The defeat is
permanent for the session (see §17).

---

## 10. How enemies spawn

### Waves
- Wave sizes: **5, 8, 12, 16, 20**, then +4 per wave.
- First wave after 10 s, then **15 s** of preparation between waves (countdown on the HUD).
- Zombies appear 45–78 m away, **outside your field of view**, never inside buildings, water or
  pyramids. In the desert they **burrow up out of the sand**.
- At most 12 / 16 / 22 wave zombies at once (Low / Medium / High quality); the rest queue.
  They arrive every 0.5 s while fewer than 4 are alive, otherwise every 1.2 s.
- **Composition:** runners from wave 3 (20% + 5% per wave, max 50%); sprinters from wave 4
  (8% + 3% per wave, max 25%), plus up to +15% in dark sectors.
- **Scaling after wave 5:** +6% health and +3% speed per wave (speed capped at +25%).
- Clearing a wave drops an ammo box and a medkit or battery near you.
- Waves pause while you are inside a pyramid and resume when you come out.

### Other spawns
| Source | Rule |
|---|---|
| **Roamers** | Up to 3/5/7 (by quality) wandering zombies, more in dark sectors and far from spawn; appear 60–120 m away, removed beyond 180 m. Desert roamers wear desert rags. |
| **Drawn by gunfire** | each shot from a gun louder than 60 m (rifle, sniper) has a loudness/450 chance (rifle 16%, sniper 27%) to bring a zombie from 55–85 m away that investigates the shot. |
| **Villages** | when you come within 170 m: 3 dormant + 3 wandering zombies (2 + 2 in small villages), plus the Butcher if the village has one. Removed again beyond 330 m. |
| **Sand nests** | buried zombies placed near ruins, settlements, pyramid rooms and dead ends; they spawn when you are within 55 m (max 12 buried/emerged at once). A nest whose zombie you kill never refills this session. |
| **Dog packs** | in the desert, every 18–32 s (75% chance) a pack of 3–5 appears 70–110 m away out of view, up to 8 dogs alive. |
| **Giant dead** | in the forest, every 20 s (60% chance) if none is around, 70–110 m away. One at a time; removed beyond 260 m. |
| **Hanging Dead** | fixed spots along the Hanging Woods trails (1–3 per 100 m chunk of belt). |
| **Mummy summons** | see §9. |

---

## 11. Noise, stealth and detection

**Being seen.** An unaware zombie notices you within its detection range:

```
range = 26 m × (runner 1.15 | heavy 1.2) × stance × sprint × flashlight
stance: sitting 0.45, crouching 0.6, standing 1      sprinting ×1.5
flashlight: on ×1.15, off ×0.9
```

**Being heard.** Every gunshot is heard within the gun's loudness radius (Glock 40 m,
rifle 70 m, sniper 120 m):
- zombies within min(18 m, 30% of the radius) charge you immediately;
- others walk to investigate the spot for up to 14 s;
- dormant corpses rise and buried sand zombies erupt if within 35% of the radius;
- dogs within 80% of the radius start chasing;
- sand worms add tremor (§8).

---

## 12. The world

### Layout (4 km × 4 km)

```
        reserved sector                        border hills all around
     (future biome, forest for now)
               \                    /
                \  HANGING WOODS   /
                 ( THE DEADWOOD ) ------  THE ASHEN DESERT (east, 120°)
                /  (500 m forest)  \
               /                    \
        reserved sector
```

- **The Deadwood** — a ~500 m forest around the spawn (forest edge ≈ 270 m from the campfire).
- **The Hanging Woods** — a ~90 m belt surrounding the forest; you must cross it to leave.
- **Outside the belt** the land is split into three 120° sectors: the **desert** (east) and two
  **reserved sectors** (north-west, south-west) kept for future biomes. Until those exist they use
  the forest generator, so they look like forest with villages.
- Transitions are seamless: biome weights blend terrain height, ground colour, objects and
  atmosphere across the belt and sector edges.

### The forest (and reserved sectors)
- Sparse pine forest with denser patches, bushes, rocks, fallen logs, grass that follows you,
  clearings, dirt roads between villages, rivers with reeds and ponds.
- **Spawn camp:** campfire with embers, tent, seat logs, crates; the cabin nearby (table, bed,
  crate, lantern) — both hold supplies.
- **Villages:** 31 in total — 3 small ones inside the forest, the rest scattered across the outer
  sectors. Each has 3–6 boarded-up houses (some with broken roofs) around a **well stuffed with
  bodies**, corpses, blood, owls on roofs, lanterns around the well and supplies inside the houses.
- **Lanterns** on posts line the roads (one every ~34 m, alternating sides) and stand around wells
  and in odd spots in the woods. 75% are lit; lit lanterns glow and really light the ground near you.
- **Hanged people** swing from dead trees, more of them in dark areas; blood stains everywhere.
- **Dark sectors:** areas around outer villages and some deep-forest spots turn pitch black
  (see §14).

### The Hanging Woods
Extremely dense pines and twisted dead trees, a near-black ground and thick fog (visibility about
25 m), creaking ropes and whispers, many hanged corpses and the **Hanging Dead**. Fourteen winding
trails and two roads cross the belt, so it is hard to cross but never impossible.

### The Ashen Desert
- Large rolling dunes (gentle enough to walk over everywhere), dry bushes, bones, rock formations,
  ancient ruins with broken walls and pillars, sand-covered roads linking every structure.
- **Ritual camps** (8), **small pyramids** (7), **ruined settlements** (5) of flat-roofed adobe
  houses, the **Great Pyramid**, and three **DEEP SANDS** worm territories.
- Infected dog packs, sand zombies, cultists, camels.
- No rivers or ponds: water is masked out of the desert.

### World generation
- Deterministic from one seed: the same world every time.
- At boot only a small skeleton is generated: rivers, ponds, village sites, desert structures,
  roads, dark sectors and worm territories.
- The world is split into **100 m chunks**. A chunk's content is generated the first time you get
  near and removed again when you leave:
  - trees, bushes, rocks, logs, reeds, blood, corpses, hanged bodies, lanterns, ruins, bones,
    loot spots, sand-zombie nests, Hanging Dead spots, and its collision data.
- Each chunk asks the biome system which **content generators** apply (`forest`, `hanging`,
  `desert`) and how strongly at each point.

---

## 13. Structures

Structures have stable ids, their colliders are registered once, and their meshes are built when
you are near and freed when you are far. They never duplicate across chunk boundaries.

### Small pyramids (7)
36 m wide, 24 m tall, with an entrance cut into one face. Inside:
- a 4 m wide corridor;
- a 14 × 14 m pillared chamber with a sarcophagus;
- two side rooms;
- carved walls, torches, loot (ammo, medkits, coins).

About 60% hide 2–4 buried zombies.

### The Great Pyramid
- **Exterior:** 300 × 300 m base, 175 m tall. A landmark visible from very far — it fades to a dark
  silhouette with distance. It stands on a plinth reached by a flight of stairs. The entrance gate
  is flanked by two giant seated statues, broken pillars and burning torches, with sand drifts
  against the foundations.
- **Maze:** a 248 × 248 m sandstone maze generated with a randomised depth-first search, then
  extra walls are removed for loops.
  - 8 m corridors with 12 m ceilings and carved walls.
  - 7 rooms of 24–32 m with 16 m ceilings, pillars, statues and sarcophagi.
  - Moonlight shafts with floating dust.
  - Torches every few cells; the nearest ones cast real light.
  - About 70 dead ends: 45% hold loot, some hide buried zombies.
- **Boss chamber:** 56 × 56 m with a 20 m ceiling at the centre, entered from the middle of each
  side, so there are several routes. It has 8 massive pillars (good cover against bandages), a
  two-tier throne, two giant statues, six sarcophagi, a ring of torches and a great moonlight shaft.
- **Navigation:** every route connects (the maze is one connected graph), so the boss chamber is
  always reachable.
- **Rendering:** the interior is split into 16 sections; only sections near you are drawn inside,
  and only the entrance section from outside.
- **Indoors:** sky, moon and outdoor light fade out, the fog turns warm and close, and waves pause.

### Ritual camps (8)
- A large bonfire that lights the camp and glows as a landmark visible across the desert.
- Three tents, a ring of standing stones, a ritual slab with a skull, rugs, clay pots and crates.
- Loot: food, water, cloth, ammo or a medkit.
- Seven cultists and two camels.
- Their chanting carries over the dunes.

### Ruined settlements (5)
3–5 flat-roofed adobe houses around a well, bone piles, sand-zombie nests and loot (food, water,
ammo, coins, medkits).

---

## 14. Atmosphere, lighting and weather

Each biome has an **atmosphere config**, and the game blends them by where you stand:

| | Forest | Hanging Woods | Desert | Inside a pyramid |
|---|---|---|---|---|
| Fog distance | quality fog (62/78/92 m) | ×0.3 (~25 m) | ×3.2 (up to 330 m) | ×0.75, warm brown |
| Sky light / moonlight | 2.1 / 2.0 | 0.55 / 0.4 | 1.55 / 2.7 | 0.22 / 0 |
| Stars | normal | almost none | **3500-star field** | none |
| Moon size | normal | normal | ×1.6 | hidden |
| Ground mist | yes | thick | none | none |
| Drifting sand | — | — | yes | — |
| Wind | full | soft | gentle | faint |

- **Two moons:** a white moon (casts shadows) and a smaller **red moon** that adds faint red light.
- **Dark sectors:** within them, and only away from spawn, light falls to ~5% and fog closes to
  22 m. A low drone starts and the stars and moons vanish. "It is too dark here…"
- **Lights:**
  - your flashlight;
  - the muzzle flash;
  - the spawn campfire;
  - one bonfire light, which follows the nearest camp;
  - two torch/lantern lights, which follow the nearest burning torches or lit lanterns;
  - the two moons.

  The number of lights never changes, so shaders never recompile.
- **Suspense events** every 18–40 s (more often in the dark): twigs snapping behind you, distant
  screams, growls from the trees.

---

## 15. Items, loot and inventory

### Items
| Item | Stack | Use | Effect |
|---|---|---|---|
| Ammo Box | 10 | Load (or R with empty reserve) | +30 rifle, +17 Glock, +5 sniper |
| Medical Kit | 5 | Use (or H) | +50 health |
| Battery | 5 | Swap (or B) | flashlight back to 100% |
| Infected Flesh | 6 | Eat | see §16 |
| Canned Food | 5 | Eat | +10 health, +25 stamina |
| Water Bottle | 5 | Drink | stamina to full |
| Ancient Coin | 50 | — | treasure |
| Mummy Bandage | 10 | — | boss material |
| Ancient Relic | 3 | — | treasure |
| Cloth | 10 | — | camp material |
| Eye of the Pharaoh | 1 | — | unique relic from the Mummy |
| Desert Seal | 1 | — | proof the Mummy has fallen |

(Coins, bandages, relics and cloth are kept for future crafting and trading.)

### Inventory rules
- **12 slots** (4 × 3). Identical items stack up to their maximum.
- **Picking up (E)** adds as much as fits; anything left stays on the ground; if nothing fits you
  see "Inventory full".
- **Tab** opens the inventory, releases the mouse and **pauses the game**. Tab or Esc closes it
  and resumes.
- **Drop (G or right-click)** places the item on the ground in front of you; it stays in the world.
- **Drag and drop** moves an item to another slot, swaps two items, or merges two stacks of the same item.

### Where loot comes from
| Place | Loot |
|---|---|
| Spawn camp / cabin | ammo, medkit / ammo, medkit, battery (restocked over time) |
| Village houses | 1–2 per house: a battery, then battery / ammo / medkit |
| Forest chunks | 30% chance of one item: ammo 50%, medkit 28%, battery 22% |
| Ritual camps | canned food, water, cloth, ammo or medkit |
| Settlements | canned food, water, ammo, coins, medkits |
| Small pyramids | ammo, medkits, coins |
| Great Pyramid | dead ends (45%): ammo, medkits, coins · rooms: relics, ammo, medkits, coins |
| Zombies, dogs | 1 infected flesh each |
| Hanging Dead | 35% ammo box |
| Cultists | 60% cloth or coins |
| Butcher | 2 ammo, medkit, battery |
| Sand worm | 2 relics, 15 coins, 2 ammo |
| Ancient Mummy | Eye of the Pharaoh, Desert Seal, 5 bandages, 2 relics, 12 coins, 2 ammo, medkit |
| End of a wave | ammo box + medkit or battery |

### Persistence and respawning
- Every loot spot has an id. Once picked up it **stays gone**, even when its chunk or structure
  unloads and reloads.
- Every 22 s a supply event happens:
  - 50% chance to put back one basic item (ammo, medkit, battery, food, water) you took from a
    forest or village spot more than 25 m away;
  - otherwise it restocks the cabin/camp, or drops a random supply 25–85 m away (max 14 of those).
- **Pyramid, camp, boss and worm loot never respawns.**
- Dropped items and creature drops persist in the world for the session (up to 150 of them).

---

## 16. Infected flesh and infection

Eating infected flesh is a deliberate risk-reward choice. Every piece **adds** +30% movement speed
and +30% weapon damage, and the infection **can never be cured** in this life.

| Pieces | Speed / Damage | Stamina (when drain is enabled) | Symptoms |
|---|---|---|---|
| 0 | normal | normal | — |
| 1 | +30% / +30% | drain ×1.35, −3/s passive, regen ×0.75 | — |
| 2 | +60% / +60% | ×1.7, −6/s, regen ×0.55 | occasional heartbeat |
| 3 | +90% / +90% | ×2.05, −10/s, regen ×0.4 | subtle colour distortion, view breathing |
| 4 | +120% / +120% | ×2.4, −15/s, regen ×0.3 | green infection vignette, zombie-like breathing |
| 5 | +150% / +150% | ×2.75, −22/s, regen ×0.2 | strong distortion and blur, frequent heartbeat, **critical warning** |
| 6 | — | — | **you turn** |

- The HUD shows a 6-segment infection meter (green → yellow → orange → flashing red) with a
  tooltip of the current bonuses and penalties.
- Eating the sixth piece first shows a **warning dialog** ("You will turn. This cannot be
  undone."). If you confirm:
  - your controls lock and your weapons stop working;
  - your vision blurs and shifts hue, the camera reels, and you hear yourself breathing like one of them;
  - after 4.5 s you die — **Cause of death: Succumbed to Infection** — whatever your health.
- Stamina effects only apply when stamina drain is enabled (see §4).

---

## 17. Death, restart and progression

- At 0 health the camera collapses to the ground and the **GAME OVER** screen shows kills, waves
  survived, survival time and the cause of death, for example:
  - Killed by the dead
  - Dissolved by acid
  - Mauled by infected dogs
  - Devoured by a sand worm
  - Torn apart by / Crushed by / Lashed by the Ancient Mummy
  - Strangled by bandages
  - Sacrificed by cultists
  - Succumbed to Infection
- **Restart** begins a new life at the campfire. Inventory, ammo, infection, waves, enemies,
  collected-loot memory and the explored map are all reset.
- **Session progression** (kept across restarts until the page is reloaded):
  - `PROGRESS.desertBossDefeated` — the Ancient Mummy stays dead (empty throne).
  - `PROGRESS.biome3Unlocked` — the flag the next biome will check.

---

## 18. HUD, map and menus

**HUD**
- **Top left:** wave, zombies remaining in the wave, kills, survival time.
- **Bottom left:**
  - health, stamina and battery bars;
  - flashlight state, spare batteries [B], medkits [H] and [TAB];
  - the infection meter and its tooltip.
- **Bottom right:** weapon slots, weapon name, magazine / reserve, reload hint, and posture
  (CROUCHING / SITTING / WADING), plus TREMOR % in worm territory.
- **Centre:**
  - crosshair, hidden when aiming;
  - hit markers;
  - pickup prompts ("E Pick up Ammo Box x2") and short toasts ("+1 Infected Flesh", "Inventory full");
  - wave and area banners (village names, biome names, DEEP SANDS warnings).
- **Top centre:** wave countdown and the boss health bar (the Butcher or the Ancient Mummy, shown
  when you are near them).
- **Damage feedback:** red damage vignette, pulsing low-health border, green acid flash, green
  infection vignette.

**Map**
- **Minimap (top right):** rotates with you, north marker, 75 m radius. It shows nearby supplies
  (yellow ammo, red medkits, blue batteries), zombies within 30 m or chasing you, and bosses and
  giants as big red dots.
- **Full map (M):** fog of war — only chunks you have visited are drawn. It shows roads, rivers,
  buildings, villages (☠ if a Butcher lives there), camps, pyramids, settlements, DEEP SANDS
  territories, the camp and your position.

**Menus**
- **Main menu:** Play Game, Controls, Settings; the camera slowly circles the campfire.
- **Pause (Esc, or when the window loses focus):** Resume, Restart, sensitivity, volume, graphics
  quality, Return to Main Menu.
- **Settings** are saved in the browser.

---

## 19. Audio

All sound is synthesised with the Web Audio API (no audio files) and positioned in 3D (stereo
panning and distance falloff), with a shared reverb. Nearby enemies get louder as they approach.

| Category | Sounds |
|---|---|
| Weapons | separate gunshot recipes for rifle, Glock and sniper, reloads, bolt cycling, empty clicks, weapon switching |
| Player | footsteps, splashes, jumps and landings, pain, heartbeat, eating, drinking, zombie-like breathing when infected, death |
| Environment | wind (per biome), campfire crackle, crickets, a dark-sector drone, creaking ropes and whispers in the Hanging Woods, cultist chanting from the nearest camp, a sand-worm rumble |
| Enemies | zombie growls, footsteps, attacks, hurt and death, the Butcher's machete, the Mummy's roars and chant, bandage whips, the slam boom, acid spit and gurgle, dog barks and yelps, worm roars, sand eruptions, rope snaps |
| Wildlife | crows, owls, bats, wing flaps |

No music plays during gameplay.

---

## 20. Graphics settings and performance

| | Low | Medium | High |
|---|---|---|---|
| Resolution scale | 0.75 | 1.0 | device (max 1.5) |
| Moon shadows | off | 1024 | 2048 |
| Trees drawn | 50% | 75% | 100% |
| Full-detail tree radius | 22 m | 30 m | 40 m |
| Base fog / view distance | 62 m | 78 m | 92 m |
| Grass | sparse, 22 m | 30 m | dense, 38 m |
| Max wave zombies / roamers | 12 / 3 | 16 / 5 | 22 / 7 |
| Mist sprites / particles | 8 / 150 | 16 / 250 | 26 / 320 |
| Zombie shadows | off | off | on |

**How it stays fast**
- **Chunk streaming:**
  - only chunks within the current view distance (plus 25 m) exist;
  - at most one chunk is built per frame;
  - far chunk data is forgotten.
- **Trees and dead trees use LOD:** full detail near you, low-poly further out, and nothing past
  the fog.
- **Instancing:** all repeated objects (trees, bushes, rocks, logs, reeds, blood, ruins, bones,
  lanterns, dry bushes) are instanced meshes with shared geometry and materials; corpses and
  hanged bodies are baked into single meshes.
- **Fixed light pool:** a small pool of lights follows the nearest torches, lanterns and bonfires.
- **Pyramid interiors** are split into sections and culled.
- **NPCs** swap to single low-poly meshes beyond 70 m and animate less often when far away.
  Enemies are hidden beyond the fog, and simulated only near you.
- GPU resources are disposed when chunks and structures unload.

Use **Low** on weak integrated graphics.

---

## 21. Code architecture

```
index.html, style.css        UI: HUD, menus, inventory, overlays
serve.mjs, start.bat         tiny local web server
lib/three.module.min.js      Three.js r160

js/main.js        game loop, input, modes (menu/playing/paused/inventory/dead), waves, all spawners,
                  loot & supplies, inventory actions, infection, atmosphere blending, HUD
js/biomes.js      biome layout and weights, BIOMES config table, Hanging Woods trails,
                  atmosphere blending (the place to add new biomes)
js/world.js       terrain height function, rivers/ponds/villages/roads skeleton, chunk generation
                  with per-biome generators (forest / hanging / desert), chunk meshes, LOD,
                  collision (circles per chunk, boxes for buildings), bullet raycast, grass, mist,
                  campfire, sky and moons
js/structures.js  desert planning, Great Pyramid maze + boss chamber, small pyramids,
                  ritual camps, settlements; lazy build/dispose, interior culling, torch light pool
js/zombies.js     humanoid model builder, zombie types (walker/runner/sprinter/giant/Butcher),
                  AI, steering, per-limb hit tests, limb breaking, crawling, dormant & buried states
js/hazards.js     the Hanging Dead and acid projectiles
js/npcs.js        cultists (ritual, watching, hostility) and camels
js/dogs.js        infected dog packs
js/worms.js       sand worms (tremor meter, tunnelling, eruption)
js/mummy.js       the Ancient Mummy boss
js/inventory.js   inventory data (items, stacking, moving) and its UI
js/weapon.js      gun models, firing, spread, recoil, reload, switching, scope
js/player.js      first-person controller
js/fauna.js       crows, bats, owls
js/minimap.js     minimap and fog-of-war map
js/audio.js       procedural, positional Web Audio
js/fx.js          pooled particles          js/util.js   math/geometry helpers
```

**Frame order (while playing):**
1. Player movement.
2. Camera, scope sway and shake.
3. Flashlight.
4. Weapon (firing hits zombies, then the other enemies through a shared targeting hook).
5. Atmosphere blending.
6. World: chunks, LOD, structures, torches.
7. Wildlife.
8. Zombies.
9. Waves, villages and roamers.
10. Suspense events.
11. Hanging Dead, NPCs, Mummy, dogs and worms.
12. Desert life, nests and infection.
13. Supplies.
14. Particles, audio listener.
15. HUD and minimap.

Rendering is two passes: the world, then the gun on top.

**Adding a biome:**
1. Add an entry to `BIOMES` in `js/biomes.js` with its atmosphere and generator name.
2. Point a sector at it in `SECTORS`.
3. Write a generator in `GEN` inside `js/world.js`.
4. Optionally blend its height and ground colour in `baseH` / `groundColor`.

---

## 22. Tuning guide

| What | Where |
|---|---|
| Walk/sprint speeds, jump, stamina on/off | `PCFG` in `js/player.js` |
| Guns (damage, magazines, fire rate, loudness, ammo per box) | `GUNS` in `js/weapon.js` |
| Zombie types, detection, melee range | `ZCFG` in `js/zombies.js` |
| Waves, supplies, medkit heal, battery life | `CFG`, `waveCount`, `rollType` in `js/main.js` |
| Quality presets | `QUALITY` in `js/main.js` |
| Infection balancing | `INF` (stamina) and `1 + 0.3 * inf` (speed/damage) in `js/main.js` |
| Mummy health/size/throne | `MCFG` in `js/mummy.js`; phase speeds and cooldowns in `update`/`choose` |
| Hanging Dead | `CFG` in `js/hazards.js` |
| Dogs | `CFG` in `js/dogs.js` |
| Sand worms | `WCFG` in `js/worms.js` |
| Items and stack sizes | `ITEMS` in `js/inventory.js` |
| Forest size, belt width, sectors | `FOREST_R`, `RING_HALF`, `SECTORS` in `js/biomes.js` |
| Atmosphere per biome | `BIOMES[...].atmosphere`, `BOUNDARY`, `INDOOR` in `js/biomes.js` |
| World size | `SIZE` / `HALF` in `js/world.js` |
| Desert structure counts and worm territories | `planDesert` in `js/structures.js` |

---

## 23. Debugging

- `index.html?debug` runs without pointer lock (handy for automated testing).
  `?debug&autostart` starts immediately.
- `window.__dw` exposes the live game objects in the browser console:
  - `G`, `player`, `weapon`, `zombies`, `world`, `inventory`;
  - `mummy`, `dogs`, `worms`, `hanging`, `npcs`, `PROGRESS`;
  - helpers such as `useType('med')`, `eatFlesh()`, `dropItem()`, `startWave()`, `damagePlayer()`.
