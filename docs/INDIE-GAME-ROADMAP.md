# Indie Game Roadmap — Godot-style focus for Lotus Engine

> Strategic pivot (2026-06): ship a **web-first indie game engine** aligned with Godot's designer/programmer workflow — not UE 5.7 parity. Reference: `docs/GODOT-CENSUS.md`. UE gap list (`docs/UE5.7-GAP-LIST.md`) is background only.

## Moat

- **Playable HTML / PWA export** — one-file or offline-capable games in the browser
- **Zero install** — share a link, play immediately
- **JavaScript scripting** with `@export` → Details inspector bridge
- **3D RPG stack on three.js** — third-person camera, inventory, dialogue, quests, exportable RPG packs (Godot/Unreal workflows, web runtime)

## Parity target (honest)

Lotus will not clone every UE5/Godot editor feature. The goal is **the workflows indie 3D/RPG devs actually use**, remade on three.js + Rapier + Recast:

| Godot / Unreal | Lotus (three.js) | Status |
|---|---|---|
| CharacterBody3D + move_and_slide | Rapier kinematic + `api.moveAndSlide` | Shipped |
| SpringArm3D / camera boom | `cameraRig.ts` RPG spring arm | Wave 91 |
| Inventory + attributes | `rpgInventory.ts` + GAS-lite | Wave 92 |
| Dialogue / quest systems | `rpgDialogue.ts` + `rpgQuests.ts` | Waves 93–94 |
| Third-person 3D RPG template | `/rpg3d` + `/exportrpg` | Wave 95 |
| NavigationAgent3D | Grid navmesh + `gridNavAgents` AI | Waves 71–81 |
| Multiplayer | Relay host-authoritative MP | Waves 38–88 |
| Play-in-browser export | itch packs + PWA | Waves 52–87 |

## Shipped (Wave 33, v2.04–v2.08)

| Ver | Feature |
|---|---|
| v2.04 | **Timer** actor — wait, oneShot, autostart, `timeout:${name}` signal |
| v2.05 | **RayCast3D** actor — length/direction, per-frame hit, `hit:` / `clear:` signals |
| v2.06 | **Path3D** + **PathFollow3D** — Catmull-Rom waypoints, progress/speed along spline |
| v2.07 | **Groups** (`groups[]` + `api.getActorsInGroup`), **Project Settings** autoload names + main scene key |
| v2.08 | `api.changeScene` alias, export `__LOTUS_MAIN__` from main scene key, docs + tests |

## Shipped (Wave 34, v2.09–v2.13)

| Ver | Feature |
|---|---|
| v2.09 | **@export_range** — slider widgets in Details (`// @export_range speed 0 10 0.5 = 2`) |
| v2.10 | **@export_enum** — dropdown widgets (`// @export_enum mode walk,run,fly = run`) |
| v2.11 | **Area3D** actor — `body_entered:` / `body_exited:` for any overlapping actors |
| v2.12 | **Prefab instance polish** — override summary, Revert All, 📦 outliner badge on instance children |
| v2.13 | **Character starter** — `/starter thirdperson` greybox (floor + PlayerStart + sun) |

## Shipped (Wave 35, v2.14–v2.18)

| Ver | Feature |
|---|---|
| v2.14 | **Editable children UX** — prefab subtree panel, ≠ override diff gutter in Details + Outliner |
| v2.15 | **Sequencer ↔ @export** — script var tracks on timeline (`trackType: scriptVar`) |
| v2.16 | **Resource (.tres) lite** — JSON resources by UUID (`resources.ts`, localStorage) |
| v2.17 | **Platformer starter** — `/platformer side|wide` greybox (floor + stepping platforms) |
| v2.18 | Docs, smoke tests, CHECKPOINT — 120 tests passed |

## Shipped (Waves 36–40, v2.19–v2.43)

| Wave | Ver | Feature |
|---|---|---|
| 36 | v2.19–v2.23 | **GridMap UX** — `gridMap.ts`, tile palette, brush, overlay, `window.lotus.gridMap` |
| 37 | v2.24–v2.28 | **Starter packs** — `/rpg small\|large`, `/fps` top-down RPG + FPS greybox |
| 38 | v2.29–v2.33 | **MP indie template** — `/mpstarter`, `mp_host`/`mp_sync` tags, relay smoke |
| 39 | v2.34–v2.38 | **Touch input PWA** — virtual joystick, `touchControls`, `__LOTUS_TOUCH__` export |
| 40 | v2.39–v2.43 | **Anim polish** — script var curve presets, blend ↔ @export link, Apply Preset UI — **144 tests** |

## Shipped (Waves 41–45, v2.44–v2.68)

| Wave | Ver | Feature |
|---|---|---|
| 41 | v2.44–v2.48 | **TileMap layers + autotile** — multi-layer grid paint/erase, `autotileNeighbors`, Details layer picker |
| 42 | v2.49–v2.53 | **Starter mini-games** — platformer/RPG/FPS win scripts, `/minigame`, `game_won` signal |
| 43 | v2.54–v2.58 | **MP deathmatch** — scoreboard, target tag hits, `/mpdeathmatch`, host-authoritative `addMpScore` |
| 44 | v2.59–v2.63 | **Touch + gamepad** — Fire/Interact buttons, `gamepadInput.ts`, export `__LOTUS_GAMEPAD__` |
| 45 | v2.64–v2.68 | **2D blend ↔ @export** — `blendScriptVarLinkX/Y`, AnimStateEditor param links — **169 tests** |

## Shipped (Waves 46–50, v2.69–v2.93)

| Wave | Ver | Feature |
|---|---|---|
| 46 | v2.69–v2.73 | **TileMap polish** — per-layer visibility, autotile bitmask hover preview |
| 47 | v2.74–v2.78 | **Mini-game HUD** — win/lose overlays, `/minigameexport`, export `__LOTUS_MINIGAME__` |
| 48 | v2.79–v2.83 | **MP score sync** — client scoreboard mirror, `mp_game_won` relay |
| 49 | v2.84–v2.88 | **Input polish** — touch layout presets, gamepad glyph hints in export |
| 50 | v2.89–v2.93 | **Scene flow** — `/mainmenu`, starter level picker, `__LOTUS_MAIN_MENU__` — **194 tests** |

## Shipped (Waves 51–55, v2.94–v3.18)

| Wave | Ver | Feature |
|---|---|---|
| 51 | v2.94–v2.98 | **Autotile rules** — 8-neighbor corners, per-cell tile-kind rebuild |
| 52 | v2.99–v3.03 | **Mini-game export pack** — PWA `/exportpack`, genre presets |
| 53 | v3.04–v3.08 | **MP lobby** — ready-up, `/mplobby`, relay start |
| 54 | v3.09–v3.13 | **Input rebinding** — gamepad buttons + touch slot overrides |
| 55 | v3.14–v3.18 | **Scene transitions** — fade/slide on menu → level — **219 tests** |

## Shipped (Waves 56–60, v3.19–v3.43)

| Wave | Ver | Feature |
|---|---|---|
| 56 | v3.19–v3.23 | **Autotile atlas UV** — 16-tile sprite sheet, per-instance UV rects |
| 57 | v3.24–v3.28 | **Export pack polish** — itch.io meta, screenshot capture |
| 58 | v3.29–v3.33 | **MP matchmaking** — public room list + ping display |
| 59 | v3.34–v3.38 | **Input profiles** — desktop/mobile binding presets |
| 60 | v3.39–v3.43 | **Streaming UX** — cell load progress bar in export — **244 tests** |

## Shipped (Waves 61–65, v3.44–v3.68)

| Wave | Ver | Feature |
|---|---|---|
| 61 | v3.44–v3.48 | **Custom autotile sheets** — PNG atlas import + tile mapping UI |
| 62 | v3.49–v3.53 | **itch.io upload helper** — `/itchpack` zip with meta.json |
| 63 | v3.54–v3.58 | **MP dedicated server** — headless LAN host (`npm run dedicated`) |
| 64 | v3.59–v3.63 | **Touch haptics** — PWA Vibration API on actions |
| 65 | v3.64–v3.68 | **Save system** — localStorage checkpoints + export slots — **269 tests** |

## Shipped (Waves 66–70, v3.69–v3.93)

| Wave | Ver | Feature |
|---|---|---|
| 66 | v3.69–v3.73 | **Tile collision layers** — Rapier physics groups per grid layer |
| 67 | v3.74–v3.78 | **Butler CLI hint** — `/butlerhint` → `butler push` command |
| 68 | v3.79–v3.83 | **MP spectator** — orbit camera, no pawn spawn |
| 69 | v3.84–v3.88 | **Gamepad haptics** — dual-rumble on actions |
| 70 | v3.89–v3.93 | **Cloud save stub** — IndexedDB checkpoint backup — **294 tests** |

## Shipped (Waves 71–75, v3.94–v4.18)

| Wave | Ver | Feature |
|---|---|---|
| 71 | v3.94–v3.98 | **Grid navmesh bake** — Recast walkable mask per grid layer |
| 72 | v3.99–v4.03 | **itch.io channels** — Butler `:beta` / `:demo` push hints |
| 73 | v4.04–v4.08 | **MP replay buffer** — 30s pose ring, spectator rewind |
| 74 | v4.09–v4.13 | **Adaptive haptics** — perf gate + battery saver scaling |
| 75 | v4.14–v4.18 | **Cross-level saves** — global slots across `changeScene` — **319 tests** |

## Shipped (Waves 76–80, v4.19–v4.43)

| Wave | Ver | Feature |
|---|---|---|
| 76 | v4.19–v4.23 | **Grid nav agents** — per-layer crowd on grid navmesh |
| 77 | v4.24–v4.28 | **itch.io release notes** — CHANGELOG slice in pack |
| 78 | v4.29–v4.33 | **MP killcam** — replay on death |
| 79 | v4.34–v4.38 | **Haptic profiles** — desktop/mobile rumble presets |
| 80 | v4.39–v4.43 | **Save slot UI** — Escape pause menu in export — **344 tests** |

## Shipped (Waves 81–85, v4.44–v4.68)

| Wave | Ver | Feature |
|---|---|---|
| 81 | v4.44–v4.48 | **Grid agent AI** — patrol / chase / idle on navmesh; `/gridnavai` |
| 82 | v4.49–v4.53 | **Pack changelog HTML** — `CHANGELOG.html` in itch zip + boot overlay |
| 83 | v4.54–v4.58 | **MP team deathmatch** — red/blue teams, friendly fire off; `/mpteams` |
| 84 | v4.59–v4.63 | **Cloud save sync stub** — manifest + cross-device hint |
| 85 | v4.64–v4.68 | **Export achievements** — localStorage trophies + HUD toasts — **369 tests** |

## Shipped (Waves 86–90, v4.69–v4.93)

| Wave | Ver | Feature |
|---|---|---|
| 86 | v4.69–v4.73 | **Grid nav path debug** — pathfind polyline; `/gridnavpath` |
| 87 | v4.74–v4.78 | **itch.io embed widget** — `embed-widget.html` in zip; `/itchembed` |
| 88 | v4.79–v4.83 | **MP CTF** — flag pickup/capture; `/mpctf` |
| 89 | v4.84–v4.88 | **Cloud save import/export** — JSON download/upload |
| 90 | v4.89–v4.93 | **Achievement progress** — partial unlock + HUD ring — **394 tests** |

## Shipped (Waves 91–95, v4.94–v5.18) — 3D RPG focus

| Wave | Ver | Feature |
|---|---|---|
| 91 | v4.94–v4.98 | **3D RPG camera rig** — spring arm collision; `/rpg3d` |
| 92 | v4.99–v5.03 | **RPG inventory + stats** — slots, gold, GAS Health/Mana |
| 93 | v5.04–v5.08 | **RPG dialogue** — trees, overlay, NPC Interact |
| 94 | v5.09–v5.13 | **RPG quests** — objectives, HUD tracker |
| 95 | v5.14–v5.18 | **3D RPG export pack** — full HUD template; `/exportrpg` — **419 tests** |

## Shipped (Waves 96–100, v5.19–v5.43) — 3D RPG combat

| Wave | Ver | Feature |
|---|---|---|
| 96 | v5.19–v5.23 | **Combat lite** — melee/ranged + nav chase AI; `/combat` |
| 97 | v5.24–v5.28 | **Equipment** — weapon/armor slots + stat modifiers |
| 98 | v5.29–v5.33 | **Overworld streaming** — 2×2 cells + interior portals |
| 99 | v5.34–v5.38 | **Combat anim** — Attack oneshot FSM; `/combatanim` |
| 100 | v5.39–v5.43 | **Crafting + loot** — recipes + goblin drops — **444 tests** |

## Already in Lotus (indie-relevant)

- Playable export, input map, signals (`api.emit` / `api.on`), tags (`getActorsByTag`)
- `api.setTimer`, `api.raycast`, `move_and_slide`, prefabs, level links + `api.loadLevel`
- Autoload (tag or Project Settings names), TriggerVolume, sequencer, plugins, HUD widgets

## Shipped (Waves 101–105, v5.44–v5.68) — 3D RPG polish

| Wave | Ver | Feature |
|---|---|---|
| 101 | v5.44–v5.48 | **Combat polish** — i-frames, hit flash, damage numbers |
| 102 | v5.49–v5.53 | **Equipment visuals** — weapon socket mesh |
| 103 | v5.54–v5.58 | **Portal transitions** — loading label overlay |
| 104 | v5.59–v5.63 | **Root motion** — Attack oneshot forward nudge |
| 105 | v5.64–v5.68 | **Shops** — village_vendor buy/sell — **469 tests** |

## Next priority queue (3D RPG + parity)

1. **Damage numbers HUD** — rpg3dHud screen-space floaters during Play
2. **Vendor NPC** — Interact-tagged shopkeeper + dialogue hook
3. **Armor visuals** — head/chest socket meshes on paper-doll
4. **Portal cinematic** — slide variant + streaming preload UX
5. **Quest economy** — shop prices vs quest stage / rep stub

## Non-goals (honest skip)

- Nanite, Lumen, MetaHuman, Control Rig graphs, full Lightmass
- Datasmith CAD import, VR editing toolchains
- Console / native desktop runtimes (web export is the product)

## Success metrics

- New indie dev ships a playable browser game in **under 2 hours** using Place Actors + scripts
- **469** automated smoke + relay tests; export perf gate green on mid-tier laptop GPU
- Documentation reads like Godot docs, not UE release notes