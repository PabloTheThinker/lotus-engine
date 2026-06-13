# Lotus Engine — Roadmap

Mission: the leading Three.js game engine — the tools and features of Unreal Engine 5 and Godot, native to the web.

Built from a full census of both engines' documentation (78 UE5 tools, 60+ Godot tools), clustered into 34 build tasks. **ALL 34 COMPLETE** (v0.19, 2026-06-11). The next-up section below records each task's shipped v1 scope; noted upgrades (recast navmesh, FSM graph editor, raycast vehicles, property replication, meshoptimizer LODs) are the v2 backlog.

## ✅ Shipped

| # | Task | Source | Version |
|---|------|--------|---------|
| 1 | **Level Editor core** — viewport, Q/W/E/R gizmos + snapping, World Outliner (folders, search, drag-reparent), Details panel, undo/redo transactions, multi-select, camera bookmarks, game view (G), floor snap (End), Alt+drag duplicate | UE | v0.1–0.4 |
| 2 | **Play-In-Editor** — pawn possession at PlayerStart, Simulate, Eject (F8), Play From Here, Keep Simulation Changes (K), fly / first-person / third-person controllers with gravity, jump, sprint, wall-slide | UE + Godot `move_and_slide` | v0.2–0.4 |
| 3 | **Content Browser** — asset tiles, drag-spawn, glTF import (embedded in level files), prefab save/instance with id remap | UE Content Drawer + Godot scene instancing | v0.2–0.3 |
| 4 | **Physics** — Rapier rigid bodies (static/dynamic), mass/friction/restitution, mobility gate, landscape trimesh colliders | UE Chaos | v0.2+ |
| 5 | **Rendering** — sky atmosphere with sun-bound lights + PMREM IBL, UnrealBloom + ACES post stack, Lit/Detail/Unlit/Wireframe view modes, post-process volumes with blend radius/priority, exposure | UE | v0.2 + sprint |
| 6 | **Scripting** — per-actor JS (onBeginPlay/onTick with actor/api/THREE), script editor, JS console terminal with history, 6-template gallery | Godot GDScript | v0.3–0.4 |
| 7 | **AI copilot** — Ollama/Anthropic chatbar; sees the scene + console, edits through the undo stack via command blocks | (web-native) | v0.3–0.4 |
| 8 | **Blueprint visual scripting** — exec-pin node canvas (Events/Actions/Flow incl. Branch/Delay/Sequence), wire dragging, compiles to JS in the script slot | UE Blueprints | v0.5 |
| 9 | **Particle system** — emitter actor, CPU sim over custom point shader, spawn rate/burst, 4 emission shapes, gravity/drag, color & size over life, additive glow, live editor preview | UE Niagara / Godot CPUParticles3D | v0.6 |
| 10 | **Landscape sculpt** — heightfield terrain, Raise/Lower/Smooth/Flatten brushes with falloff + ring cursor, per-stroke undo, exact trimesh physics | UE Landscape | v0.8 |
| 11 | **Landscape paint** — 4 weight-blended color layers (editable swatches) painted per-vertex, renders via vertex colors, works in exports | UE Landscape layers | v0.10 |
| 12 | **Foliage painting** — InstancedMesh scatter brush onto any surface, per-instance drop raycast + jitter, Shift-erase, per-stroke undo | UE Foliage / Godot MultiMesh | v0.7 |
| 13 | **Sequencer** — master timeline, pos/rot/scale tracks, linear keys, scrub + transport, ◆ Key Selected, Auto Play in PIE and exports | UE Sequencer / Godot AnimationPlayer | v0.12 |
| 15 | **Input Map** — named actions bound to keys, rebind-by-keypress UI, `api.isAction('Jump')` in scripts/blueprints | UE Enhanced Input / Godot Input Map | v0.11 |
| 20 | **Signals + Groups** — `api.emit`/`api.on` bus (reset per play session), actor tags + `api.getActorsByTag` | Godot signals/groups | v0.13 |
| 25 | **Playable HTML export** — one-click standalone .html (22 KB + CDN) running the full level: physics, scripts, particles, foliage, terrain, sequencer, all pawn modes | Godot export templates — but web-native | v0.9 |
| — | *Parallel sprint extras:* outliner folders + search, post-process volumes with camera blending, UE mobility, actor tags, CLI bridge | UE | sprint |

## 🔨 Next up (impact-ordered)

| # | Task | Essence |
|---|------|---------|
| 14 | **Material node editor** | Dataflow graph (TextureSample, Multiply, Lerp, Fresnel, Time, Noise) → BaseColor/Metallic/Roughness/Emissive pins; live preview; material instances with parameter overrides |
| 16 | **Animation: clips + state machines** | Play imported glTF animations, FSM editor with crossfade transitions, 1D blend space (idle/walk/run), notifies |
| 17 | **Behavior Trees + Blackboard** | Selector/Sequence composites, task leaves, decorators, per-agent blackboard, live execution highlight |
| 21 | **Small-node pack** | Timer, RayCast helper, Area/trigger volumes (enter/exit → signals), Path3D spline + PathFollow — Godot's secret sauce |
| 22 | **@export script vars → Details** | `// @export speed = 5` annotations become typed editor widgets, serialized per-actor — the designer/programmer bridge |
| 23 | **UMG-lite HUD designer** | DOM-overlay widgets (text, button, bar) anchored CSS-style, visible in Play, scriptable via `api.hud` |
| 24 | **CineCamera + shakes + rails** | Focal length/DOF bokeh, noise-driven camera shake assets, spline rail mounts keyed in Sequencer |
| 18 | **Navmesh + agents** | recast-navigation-js bake + debug overlay, `api.findPath`, agent steering with avoidance |
| 19 | **Audio** | Positional sound actors (file import embedded), `api.playSound`, bus mixer; MetaSounds-lite WebAudio graph later |
| 26 | **Data assets** | JSON tables with grid editor, reusable float-curve + gradient widgets, hierarchical gameplay tags |
| 27 | **Modeling-lite** | CSG booleans (three-bvh-csg), mirror/merge, meshoptimizer LOD chains |
| 28 | **GridMap 3D tile painting** | Paint mesh-library cells on a grid — level blockout workflow |
| 29 | **Reflection probes + bake (approx)** | CubeCamera probes on demand; stretch: path-traced AO/lightmap bake ("Lumen-approx", never promised as Lumen) |
| 32 | **Remote debugger** | Live tree + property editing during play (partially covered by Eject/Simulate), per-frame profiler, FPS/draw-call monitors |
| 33 | **Plugin system + command palette** | Hot-loaded JS plugin API ({nodeTypes, panels, importers}), Ctrl+Shift+P palette, project settings — the web-native distribution moat |
| 30 | **World streaming + level instances** | Grid-chunked actor loading around the camera, streaming volumes, nested level prefabs |
| 31 | **Destruction + vehicles (Chaos-lite)** | Pre-fractured piece swap released as rigid bodies; Rapier raycast-vehicle with tuning panel |
| 34 | **Multiplayer sync** | WebRTC/WebSocket transport, per-actor property-sync checklist, spawner replication — last tier |

## Design laws (learned from the censuses)

1. **One runtime.** Blueprints, scripts, and the AI copilot all compile into the same per-actor script slot. Godot killed VisualScript at 0.5% adoption because it was a *parallel* system; UE Blueprints won because they're *the* gameplay layer.
2. **Everything is an actor; the editor is reflection over it.** Every new actor type inherits serialization, undo, the Details panel, prefabs, and export for free (Godot's uniformity law).
3. **Every mutation is a command.** Undo isn't a feature, it's a constraint — it's why the AI copilot's work is Ctrl+Z-able.
4. **The web is the moat.** Godot ships megabytes of WASM to reach the browser; our export is a 22 KB HTML file because the editor and the game share the same three.js. Edit → URL in seconds.

## Explicit non-goals

Real Lumen / Nanite / Substrate / Motion Matching / Mass Entity — approximate or label honestly, never promise. Virtual production (nDisplay, MetaHumans, mocap) — wrong product category for a web editor.
