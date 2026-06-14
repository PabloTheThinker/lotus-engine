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

## Already in Lotus (indie-relevant)

- Playable export, input map, signals (`api.emit` / `api.on`), tags (`getActorsByTag`)
- `api.setTimer`, `api.raycast`, `move_and_slide`, prefabs, level links + `api.loadLevel`
- Autoload (tag or Project Settings names), TriggerVolume, sequencer, plugins, HUD widgets

## Next priority queue (Godot census order)

1. **Scene instancing polish** — editable children, property override UX (prefab deltas)
2. **@export range/enum** — slider and dropdown widgets in Details from script annotations
3. **Area3D** — overlap signals beyond pawn-only TriggerVolume (physics layers)
4. **CharacterBody3D template** — first-person / third-person starter scenes
5. **AnimationPlayer tracks** — expand sequencer ↔ property keying for any `@export` field
6. **Resource (.tres) files** — shared JSON materials, curves, shapes by UUID
7. **TileMap / GridMap UX** — grid paint improvements (GridMap foliage exists)
8. **Multiplayer indie template** — host + 2 clients relay smoke game
9. **Mobile touch input map** — on-screen sticks for exported PWA
10. **Starter game templates** — platformer, top-down RPG, FPS greybox

## Non-goals (honest skip)

- Nanite, Lumen, MetaHuman, Control Rig graphs, full Lightmass
- Datasmith CAD import, VR editing toolchains
- Console / native desktop runtimes (web export is the product)

## Success metrics

- New indie dev ships a playable browser game in **under 2 hours** using Place Actors + scripts
- **110+** automated smoke tests; export perf gate green on mid-tier laptop GPU
- Documentation reads like Godot docs, not UE release notes