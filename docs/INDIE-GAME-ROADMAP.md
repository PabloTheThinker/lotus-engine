# Indie Game Roadmap — Godot-style focus for Lotus Engine

> Strategic pivot (2026-06): ship a **web-first indie game engine** aligned with Godot's designer/programmer workflow — not UE 5.7 parity. Reference: `docs/GODOT-CENSUS.md`. UE gap list (`docs/UE5.7-GAP-LIST.md`) is background only.

## Moat

- **Playable HTML / PWA export** — one-file or offline-capable games in the browser
- **Zero install** — share a link, play immediately
- **JavaScript scripting** with `@export` → Details inspector bridge

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

## Already in Lotus (indie-relevant)

- Playable export, input map, signals (`api.emit` / `api.on`), tags (`getActorsByTag`)
- `api.setTimer`, `api.raycast`, `move_and_slide`, prefabs, level links + `api.loadLevel`
- Autoload (tag or Project Settings names), TriggerVolume, sequencer, plugins, HUD widgets

## Next priority queue (Godot census order)

1. **Autotile art** — sprite sheet UV mapping per corner variant
2. **Export pack polish** — itch.io metadata + screenshot capture
3. **MP matchmaking** — public room list + ping display
4. **Input profiles** — save/load binding presets (desktop vs mobile)
5. **Level streaming UX** — cell load progress bar in export

## Non-goals (honest skip)

- Nanite, Lumen, MetaHuman, Control Rig graphs, full Lightmass
- Datasmith CAD import, VR editing toolchains
- Console / native desktop runtimes (web export is the product)

## Success metrics

- New indie dev ships a playable browser game in **under 2 hours** using Place Actors + scripts
- **219** automated smoke + relay tests; export perf gate green on mid-tier laptop GPU
- Documentation reads like Godot docs, not UE release notes