# Lotus Engine

**A browser-first Three.js game engine and level editor** — play in the editor, export to itch.io, ship PWAs. Inspired by Godot and Unreal workflows, built entirely on Three.js, Rapier, and Recast.

> Formerly **Vektra Engine**. The project is now **Lotus Engine** (`lotus-engine` on npm).

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Quick start

```bash
git clone https://github.com/PabloTheThinker/lotus-engine.git
cd lotus-engine
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`). Press **▶ Play** to run your level in-editor with pointer-lock controls.

### Build & test

```bash
npm run build    # TypeScript + production bundle
npm run test     # Playwright smoke + regression (519 tests)
npm run preview  # Serve the production build locally
```

GPU-backed tests use Playwright with `--enable-gpu --use-angle=gl-egl` (see `playwright.config.ts`).

## Why Lotus?

| | Lotus Engine | Typical Three.js project |
|---|---|---|
| **Editor** | Full viewport, outliner, details, content browser, undo stack | Roll your own or none |
| **Gameplay** | `World` / `Actor` model, physics, scripting, AI, multiplayer | Ad-hoc scene graph |
| **Export** | itch.io packs, PWA, multi-level HTML games | Custom pipeline |
| **Runtime** | Zero install — share a link and play | Same, but you build everything |

Lotus targets **indie 3D games in the browser**: platformers, FPS templates, and an optional RPG module (`lotus.rpg.*`) — without sacrificing engine fundamentals.

## Features

### Editor

- **Viewport** — fly camera (RMB + WASD/QE), transform gizmos (Q/W/E/R), grid/angle snapping, F focus
- **World Outliner** — hierarchy, drag-reparent, visibility toggles
- **Details panel** — PBR materials, lights, cameras, behaviors, `@export` script variables
- **Content Browser** — drag assets into the scene, prefabs, material instances
- **Play In Editor** — spawn at `PlayerStart`, pointer-lock pawn, **F8** eject/re-possess, **Simulate** mode
- **Undo/redo** — every mutation is a `Command` (`Ctrl+Z` / `Ctrl+Y`)
- **Console** — live JS REPL with `world`, `api`, `THREE` in scope
- **Terminal** — slash commands (`/spawn`, `/snapshot`, `/engine`, …)
- **Plugin API** — register panels, node types, importers, console commands via `window.lotus`

### Engine core

- **World / Actor** — Unreal-style registry and component model on top of Three.js
- **Physics** — Rapier 3D (static/dynamic bodies, character controller, vehicles)
- **Navigation** — Recast navmesh bake, grid nav, crowd agents
- **Rendering** — WebGL + optional path tracing, post stack (bloom, ACES), buffer viz modes
- **Scripting** — per-actor `onBeginPlay` / `onTick` JavaScript with `actor`, `api`, `THREE`
- **Blueprints** — visual node graphs, sequencer, animation state machines
- **Streaming** — grid-chunked world streaming for large levels
- **Multiplayer** — host-authoritative relay sync
- **Export** — standalone HTML, PWA, itch.io packs, performance gates

### Engine API (`window.lotus`)

Recent engine waves expose runtime introspection and tooling:

```js
lotus.engine.captureScene()      // snapshot transforms + script vars
lotus.engine.setBufferViz('depth') // viewport buffer visualization
lotus.engine.getRuntimeSnapshot() // playing state, backend, streaming
lotus.resources.list()           // named config / scene presets
lotus.assets.listBlobs()         // IndexedDB asset pipeline
```

Optional RPG gameplay lives under `lotus.rpg.*` (inventory, quests, combat, shops) — same bridge pattern as core engine APIs.

## Architecture

```
src/
├── engine/          # World, Actor, physics, nav, rendering, RPG modules
├── editor/          # React UI, commands, viewport, plugins, terminal
└── App.tsx          # Editor shell
```

| Concept | Implementation |
|---|---|
| `UWorld` | `World` — actor registry, PIE lifecycle, scene graph |
| `AActor` | `Actor` — root `THREE.Group`, mesh/light/camera, tick |
| Level file | `.vlevel.json` — versioned serialization + autosave |
| Undo | Command stack in `src/editor/commands.ts` |
| Plugins | `src/editor/plugins.ts` — `registerPlugin()` |

The Three.js scene graph is the source of truth. React panels mirror it through a `sceneVersion` counter (Zustand). Editor helpers are tagged `isHelper` and excluded from picking, serialization, and Play mode.

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Vite dev server + HMR |
| `npm run build` | Production build |
| `npm run test` | Playwright test suite |
| `npm run lint` | ESLint |
| `npm run lotus` | CLI helpers (`scripts/lotus-cli.mjs`) |
| `npm run dedicated` | Dedicated multiplayer server |
| `npm run perf:gate` | Export performance gate |

## Documentation

- [`docs/INDIE-GAME-ROADMAP.md`](docs/INDIE-GAME-ROADMAP.md) — product direction and shipped waves
- [`docs/CHECKPOINT.md`](docs/CHECKPOINT.md) — current development checkpoint
- [`CHANGELOG.md`](CHANGELOG.md) — release history
- [`src/editor/plugins.ts`](src/editor/plugins.ts) — plugin API reference

## Tech stack

- **Runtime:** Three.js, Rapier 3D, Recast Navigation
- **UI:** React 19, Zustand, Immer
- **Build:** Vite 8, TypeScript 6
- **Tests:** Playwright

## Contributing

This repo is under active development. Issues and PRs are welcome. Run `npm run build && npm run test` before submitting changes.

## License

[MIT](LICENSE) — Copyright (c) 2026 PabloTheThinker / Vektra Industries