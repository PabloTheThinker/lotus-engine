# Vektra Engine

A professional Three.js level editor built on Unreal Engine's framework — Vektra Software.

```bash
npm install
npm run dev
```

## The framework (Unreal → Vektra)

| Unreal | Vektra Engine |
|---|---|
| `UWorld` | `World` (`src/engine/World.ts`) — actor registry, scene graph, PIE lifecycle |
| `AActor` | `Actor` (`src/engine/Actor.ts`) — root component + typed components + tick |
| `USceneComponent` | `Actor.root` (`THREE.Group`) — transform hierarchy, attach/detach |
| `UStaticMeshComponent` | `Actor.mesh` + `GeometryKind` + PBR `MaterialProps` |
| `ULightComponent` | `Actor.light` — Point / Spot / Directional / Ambient + helpers |
| `UCameraComponent` | `Actor.camera` + frustum helper |
| Transaction system | Command stack (`src/editor/commands.ts`) — full undo/redo |
| `.umap` | `.vlevel.json` — versioned level serialization + autosave |
| Blueprint tick | Behaviors (rotator / bobber / orbiter) — run during Play |

## Editor tools

- **Viewport** — Unreal navigation: RMB mouselook + WASD/QE fly (scroll = fly speed), MMB/Alt+LMB pan, F focus selected. ACES tone mapping, PCF soft shadows.
- **Transform gizmos** — Q/W/E/R (select/move/rotate/scale) with grid/angle/scale snapping.
- **World Outliner** — hierarchy tree, drag-to-reparent, rename (double-click), visibility eyes.
- **Details panel** — transform, PBR material, light, camera, and behavior properties with commit-on-blur undo granularity.
- **Content Browser** — drag assets into the viewport (ground-plane projected spawn) or double-click to place.
- **Play In Editor** — ▶ runs behaviors and renders through the level camera; Esc stops and restores editor state.
- **Level I/O** — File → New/Open/Save (`Ctrl+S`), plus 5-second localStorage autosave with session restore.
- Ctrl+Z/Y undo/redo, Ctrl+D duplicate, Del delete.

## Architecture notes

The Three.js scene graph is the single source of truth; React panels mirror it
through a `sceneVersion` counter in the zustand store. Every world mutation is a
`Command`, so the undo stack survives anything the UI can do. Editor chrome
(grid, gizmos, selection box, light/camera helpers) is tagged `isHelper` and
excluded from picking, serialization, and Play mode.
