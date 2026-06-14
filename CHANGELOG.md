# Changelog

Notable changes to Lotus Engine. Newest entries first.

---

## 2026-06-13 — Wave 13: v0.97–v1.02

### Added
- **v0.97** WebGPU QA matrix + `createLotusRenderer` — adapter/device checks gate WebGPU tier (`webgpuQA.ts`, `lotusRenderer.ts`)
- **v0.98** WebGPURenderer viewport swap — opt-in when `renderBackend: webgpu`; WebGL aux for composer/path tracer/probes
- **v0.99** GPU particle compute tier — `GPUParticleSystem` fixed-substep batch sim when `particleBackend: gpu`
- **v1.00** SSGI screen-space pass hook — `postStackSSGI.ts` bleed pass in WebGL composer when SSGI enabled
- **v1.01** BT editor v2 — edge delete (click wire), node property panel, blackboard sidebar
- **v1.02** Export playable E2E — `window.lotus.export.buildPlayableHTML` roundtrip test; `renderer.runQA` bridge

### Changed
- Viewport stats badge shows `WEBGPUR` when WebGPURenderer is active on canvas
- Particle emitters respect `World Settings → Niagara backend` via `createParticleSystem`
- `window.lotus` bridge: `renderer`, `particles`, `export`

### Verification
```bash
cd "~/Vektra Industries/Software/lotus-engine"
npm run build && npm run test   # 25 passed
```

---

## 2026-06-13 — Wave 12: v0.91–v0.96

### Added
- **v0.91** Behavior Tree editor — visual graph canvas, auto-wire on add, live PIE node highlight (`btGraph.ts`, `BTEditor.tsx`)
- **v0.92** Data table grid + curve assets — `DataTableEditor`, `curveAssets.ts`, `api.evaluateCurve`
- **v0.93** Project Settings modal — global render/physics/material defaults + export branding (`projectSettings.ts`, File menu)
- **v0.94** Nested prefab-in-prefab — `prefabRef` on save, `expandPrefabRefs` on instantiate (`prefabs.ts`)
- **v0.95** Voronoi fracture + strain — `buildVoronoiFragments`, Details **Fracture Strain** field (`voronoiFracture.ts`, `physics.ts`)
- **v0.96** SSGI quality preset (WebGPU opt-in) + command palette asset search — materials, prefabs, data, imports (`ssgiPreset.ts`, `palette.tsx`)

### Changed
- Viewport stats badge shows `SSGI(preset)` when enabled on WebGPU tier
- Playable export respects **Lotus branding on export** project setting
- `window.lotus` bridge: `bt`, `curve`, `ssgi`, `projectSettings`
- Scripts gain `api.runBTGraph(graph)` for visual BT graphs

### Verification
```bash
cd "~/Vektra Industries/Software/lotus-engine"
npm run build && npm run test   # 23 passed
```

---

## 2026-06-13 — Wave 11: v0.85–v0.90

### Added
- **v0.85** SSR + LightProbeGrid — `SSRPass` opt-in, `LightProbeGrid` interior GI approx (`ssrProbeGI.ts`)
- **v0.86** MP dedicated server mode + lag compensation history (`mpNet.ts`, `mpLagCompensatedTransform`)
- **v0.87** MP delta compression + interest-radius culling for sync @ 10 Hz
- **v0.88** Rapier impulse joints + raycast vehicle controller (`physicsJoints.ts`, `physicsVehicle.ts`)
- **v0.89** TSL material editor path — serialize/deserialize preview, Material Editor uses `materialBackend: tsl`
- **v0.90** DetourCrowd avoidance (`navCrowd.ts`, `api.crowdSpawn`) + landscape splat texture paint (`landscapeSplat.ts`)

### Changed
- Baked navmesh persists into PIE (crowd + `findPath` during play)
- WebGPU tier badge shows `+` when TSL post tier is active
- `window.lotus` bridge: `crowd`, `mpNet`, `materialTSL`, `bakeGIProbes`

### Verification
```bash
cd "~/Vektra Industries/Software/lotus-engine"
npm run build && npm run test   # 20 passed
```

---

## 2026-06-13 — Wave 10: v0.79–v0.84

### Added
- **v0.79** WebGPU quality tier toggle — `World Settings → Rendering → Backend` (`renderBackend.ts`, capability probe + viewport badge)
- **v0.80** WebGL post stack v2 — optional SSAO + FXAA passes (`postStackWebGL.ts`); TSL post stub (`postStackTSL.ts`)
- **v0.81** Asset pipeline v2 — IndexedDB blob store (`assetStore.ts`), GLTF + DRACO + KTX2 loaders (`assetPipeline.ts`)
- **v0.82** Static mesh LOD chains — `THREE.LOD` builder (`lodMesh.ts`)
- **v0.83** BatchedMesh export merge — static mesh batching for playable export (`batchExport.ts`, `exportBatchStatic` env flag)
- **v0.84** Rapier `moveAndSlide` character controller — Godot-style kinematic pawn (`characterController.ts`, `api.moveAndSlide`, `window.lotus.character`)

### Changed
- `PlayController` uses Rapier character path when `useRapierCharacter` is enabled
- Playable export injects `window.__LOTUS_BATCHED__` when batch export is on
- Material instances gain TSL uniform stub (`applyMaterialInstanceTSL`)

### Verification
```bash
cd "~/Vektra Industries/Software/lotus-engine"
npm run build && npm run test   # 17 passed
```

---

## 2026-06-13 — Wave 9 + Lotus rename: v0.73–v0.78

### Added
- **Lotus Engine rebrand** — `lotus-engine` package, `Software/lotus-engine` folder, `window.lotus` bridge (`window.vektra` legacy alias), `__LOTUS_*` export globals with `__VEKTRA_*` fallback, `npm run lotus` CLI
- **v0.73** `docs/LOTUS-ENGINE-RESEARCH.md` — Three.js r184+ engine substrate roadmap (Waves 9–12)
- **v0.74** Fixed physics timestep — 60 Hz accumulator (`fixedPhysicsHz` in World Settings), `onPhysicsTick(dt)` script hook
- **v0.75** Particle bounds fix — dynamic bounding spheres, `frustumCulled` re-enabled; GPU particle backend stub (`particlesGPU.ts`)
- **v0.76** AO bake Web Worker — `lightmapBakeWorker.ts` off main thread; xatlas UV2 unwrap path (`xatlasUV2.ts`)
- **v0.77** Material graph TSL preview stub — `compileMaterialGraphTSL()` parallel to GLSL path
- **v0.78** Buffer viz AO + Emissive modes (`show bufferviz ao|emissive`)

### Changed
- Level files serialize `engine: 'lotus'` (still load `vektra` legacy levels)
- localStorage keys `lotus-engine.*` with read-time migration from `vektra-engine.*` (`storage.ts`)

### Verification
```bash
cd "~/Vektra Industries/Software/lotus-engine"
npm run build && npm run test   # 14 passed
npm run dev
npm run lotus
```

---

## 2026-06-13 — Wave 8: v0.68–v0.72

### Added
- **v0.68** Buffer visualization view modes — World Normal, Depth, Base Color, Roughness, Metallic (`show bufferviz`)
- **v0.69** Status bar save indicator — ● Unsaved / ✓ Saved / Saving… + autosave countdown toast
- **v0.70** Sequencer audio waveforms + loop regions (loopIn/loopOut brackets)
- **v0.71** Multiplayer 2-tab relay integration test (`tests/multiplayer.spec.ts`, `relay-fixture.ts`)
- **v0.72** AO Map bake to UV2 — `aoMap` texture via box-projection uv2, `build ao map`

### Changed
- Session master summary below now spans **v0.33 → v0.72** (8 waves, 40 version bumps)
- Playwright: **14 tests** (13 smoke + 1 live MP relay)

### Verification
```bash
npm run build && npm run test   # 14 passed
```

---

## 2026-06-13 — Session master summary (v0.33 → v0.72)

Eight parallel agent swarms shipped **40 version bumps** in one research-and-build session. Starting point: broken v0.33 in-flight work (3 TS errors). End state: **build clean**, **14 Playwright tests passing** (incl. live MP relay).

### Starting baseline (pre-session)
- Last clean commit before session: `8bc3cc3` (v0.32 — Water + PCG Scatter)
- In-flight v0.33 Blueprint cluster broken (parseExports arity, spawn.ts wiring)
- Research completed: UE5.7 + Unity 6 + Godot 4.6 gap analysis → completion roadmap

### What was built (by domain)

**Editor shell & UX**
- Quad viewport layouts (4-pane scissor), rebindable keyboard shortcuts (26 bindings)
- Content Drawer dock-pin, type stripes, asset context menus
- Toolbar Modes dropdown (Select/Landscape/Foliage/Paint)
- Piercing pick menu (Ctrl+RMB), camera bookmarks persist in level
- Path traced viewport mode (`r.PathTracer`), buffer viz *(v0.68 planned)*

**Scripting & Blueprints**
- Construction scripts (`onConstruct`), exec pulse debugger, Level BP
- Data pins, variables, ForLoop/DoOnce/FlipFlop (prior), function collapse/macros
- Gate, MultiGate, SwitchInt, BindSignal, CallSignal nodes
- Exec breakpoints with F5 Continue

**Materials & rendering**
- Material assets + instances (shareable library, per-actor overrides)
- GPU material editor (UV, Fresnel, Noise, TextureSample) + WPO vertex displacement
- Baked AO (approx) — hemisphere raycast to vertex colors
- Reflection probes, post-process volumes, HDRI, sky atmosphere (prior)

**Animation & characters**
- FSM state machine editor, 1D + 2D blend spaces (Delaunay)
- Two-bone IK + LookAt on glTF skeletons
- glTF clip playback, crossfade, sequencer tracks

**World building**
- Landscape sculpt/paint, foliage, water, CSG booleans, GridMap
- Visual PCG graph editor (Sample→Filter→Transform→Spawn)
- Grid-chunked world streaming + `api.loadCell`
- Recast navmesh WASM bake + grid A* fallback

**Gameplay systems**
- GAS-lite: attributes, abilities, gameplay effects (duration modifiers)
- Behavior trees, EQS, AI perception, collision layers/masks
- Input map, signals/groups, triggers, timers, raycast API
- Prefab overrides (Godot editable-children pattern)

**Audio & VFX**
- MetaSounds-lite WebAudio graph editor
- HRTF spatialization, reverb zones, attenuation falloff curves
- Particle ribbon + mesh renderers, sub-emitters, size curves
- Sequencer audio tracks with scrubbing

**UI & cinematics**
- UMG-lite HUD designer, HUD widget Sequencer tracks
- Widget3D (CSS3D world-space HTML), Label3D billboards
- Sequencer bezier curve editor, Take Recorder, Movie Render Queue

**Multiplayer & export**
- WS relay, ghost pawns, 10Hz property sync, spawn/despawn replication
- Ownership + client prediction + `own` protocol
- Multi-level export, PWA option, quality presets
- One-click playable HTML (~22KB + CDN)

**Debugging & extensibility**
- Live Tree debugger, per-actor tick profiler, `getLiveSnapshot()`
- Plugin API (panels, node types, importers, console commands)
- Plugin Manager UI, command palette
- Playwright E2E: 5 → 9 → 13 tests

### Version table (all waves)

| Version | Wave | Highlights |
|---------|------|------------|
| v0.33 | 1 | onConstruct, BP pulse debugger, Level BP |
| v0.34 | 1 | Material assets + instances |
| v0.35 | 1 | Prefab property overrides |
| v0.36 | 1 | Recast navmesh bake |
| v0.37 | 1 | Live Tree debugger, tick profiler |
| v0.38 | 2 | FSM animation editor + blend 1D |
| v0.39 | 2 | MetaSounds + HRTF + reverb zones |
| v0.40 | 2 | Multi-level export, PWA, BP functions |
| v0.41 | 2 | Plugin API + Plugin Manager |
| v0.42 | 2 | GAS-lite, piercing pick, particle ribbon |
| v0.43 | 2 | Wave 2 integration |
| v0.44 | 3 | Material GPU shader nodes |
| v0.45 | 3 | Quad viewport layouts |
| v0.46 | 3 | Keyboard shortcut editor |
| v0.47 | 3 | Content Drawer dock-pin |
| v0.48 | 3 | Sequencer bezier curves |
| v0.49 | 4 | Path tracer viewport |
| v0.50 | 4 | Blend space 2D |
| v0.51 | 4 | Multiplayer property sync |
| v0.52 | 4 | HUD widget Sequencer tracks |
| v0.53 | 4 | Grid world streaming |
| v0.54 | 4 | Playwright smoke tests (5) |
| v0.55 | 5 | Two-bone IK + LookAt |
| v0.56 | 5 | BP Gate/MultiGate/Switch |
| v0.57 | 5 | GAS gameplay effects |
| v0.58 | 5 | Bookmarks persist, Modes dropdown, Label3D |
| v0.59 | 6 | Particle mesh + sub-emitters |
| v0.60 | 6 | Material WPO |
| v0.61 | 6 | PCG graph editor; 9 tests |
| v0.62 | 7 | Audio falloff + sequencer audio |
| v0.63 | 7 | Blueprint breakpoints |
| v0.64 | 7 | Widget3D CSS3D |
| v0.65 | 7 | MP ownership + prediction |
| v0.66 | 7 | Baked AO (approx) |
| v0.67 | 7 | 13 E2E tests |
| v0.68 | 8 | Buffer visualization view modes |
| v0.69 | 8 | Status bar save + autosave countdown |
| v0.70 | 8 | Sequencer audio waveforms + loops |
| v0.71 | 8 | MP 2-tab relay test |
| v0.72 | 8 | AO map bake (UV2) |

### New modules (files created this session)

`materialAssets.ts` · `materialShader.ts` · `materialCommands.ts` · `liveSnapshot.ts` · `navMeshWorker.ts` · `animStateMachine.ts` · `metaSounds.ts` · `metaSoundAssets.ts` · `gameplayAbilities.ts` · `ik.ts` · `pcgGraph.ts` · `streaming.ts` · `lightmapBake.ts` · `widget3d.ts` · `plugins.ts` · `shortcuts.ts` · `viewportLayout.ts` · `PluginManager.tsx` · `AnimStateEditor.tsx` · `MetaSoundEditor.tsx` · `PCGEditor.tsx` · `CurveEditor.tsx` · `ContentDrawer.tsx` · `ShortcutEditor.tsx` · `AttenuationFields.tsx` · `Widget3DLayer.tsx` · `PluginPanelView.tsx` · `playwright.config.ts` · `tests/smoke.spec.ts` · `tests/multiplayer.spec.ts` · `tests/relay-fixture.ts`

### Dependencies added

`recast-navigation` · `@recast-navigation/three` · `three-gpu-pathtracer` · `three-mesh-bvh` · `@playwright/test`

### Verification (current)

```bash
cd "~/Vektra Industries/Software/lotus-engine"
npm install
npm run build    # exit 0
npm run test     # 14 passed
npm run dev      # editor on :5173
node scripts/relay.mjs   # multiplayer relay :24690
```

### Explicit non-goals (honest skips)

Real Lumen, Nanite, Substrate, Motion Matching, Mass Entity, MetaHumans, full Control Rig graphs, true Lightmass — approximated or deferred.

---

## 2026-06-13 — Wave 8: v0.68+ (placeholder — append after swarm finishes)

> **Do not finalize until wave 8 agents land.** Fill in version bumps, commit hash, and test count below.

### Planned (from CHECKPOINT + gap list)

- **v0.68** Buffer visualization view modes (World Normal, Depth, Base Color)
- **v0.69** Sequencer audio polish — waveform display, loop regions
- **v0.70** Status bar — save indicator, autosave countdown
- *(stretch)* Second UV lightmaps; optional 2-tab MP relay CI test

### Added

- *(pending)*

### Changed

- *(pending)*

### Verification target

```bash
npm run build    # exit 0
npm run test     # TBD passed
```

---

## 2026-06-13 — Wave 7: v0.62–v0.67

### Added
- **v0.62** Attenuation falloff curves + Sequencer audio tracks with scrubbing (`AttenuationFields.tsx`)
- **v0.63** Blueprint exec breakpoints — gutter toggle, pause PIE, F5 Continue
- **v0.64** Widget3D — CSS3DRenderer world-space HTML (`widget3d.ts`, `Widget3DLayer.tsx`)
- **v0.65** MP ownership (`netOwnerId`), client prediction, `own` protocol
- **v0.66** Baked AO (approx) — `lightmapBake.ts`, `build ao`, Build menu
- **v0.67** Playwright **13 tests** — navmesh, materials, blueprint, MP mock

---

## 2026-06-13 — Wave 6: v0.59–v0.61

### Added
- **v0.59** Particle mesh renderer, sub-emitters, 4-point size curve
- **v0.60** Material GPU WPO vertex displacement
- **v0.61** Visual PCG graph editor (🎲 PCG tab); tests expanded to 9

---

## 2026-06-13 — Wave 5: v0.55–v0.58

### Added
- **v0.55** Two-bone IK + LookAt (`ik.ts`)
- **v0.56** BP Gate, MultiGate, SwitchInt, BindSignal, CallSignal
- **v0.57** GAS gameplay effects — `api.applyEffect` / `api.removeEffect`
- **v0.58** Camera bookmarks in level file; Modes dropdown; Label3D actor

---

## 2026-06-13 — Wave 4: v0.49–v0.54

### Added
- **v0.49** Path tracer view mode + `r.PathTracer` cvar
- **v0.50** 2D blend space (Delaunay triangulation)
- **v0.51** Multiplayer sync @ 10Hz + spawn/despawn
- **v0.52** HUD widget Sequencer tracks
- **v0.53** Grid streaming + `api.loadCell`
- **v0.54** Playwright smoke tests (5)

---

## 2026-06-13 — Wave 3: v0.44–v0.48

### Added
- **v0.44** Material GPU `onBeforeCompile` shader graph
- **v0.45** Quad viewport scissor layouts
- **v0.46** Rebindable keyboard shortcuts (26)
- **v0.47** Content Drawer dock-pin + asset stripes
- **v0.48** Sequencer bezier curve editor

---

## 2026-06-13 — Wave 2: v0.38–v0.43

### Added
- **v0.38** FSM + 1D blend space animation editor
- **v0.39** MetaSounds + HRTF + reverb zones + SoundEmitter
- **v0.40** Multi-level export, PWA, BP function macros
- **v0.41** Plugin API + Plugin Manager
- **v0.42** GAS-lite, piercing pick, particle ribbon/gradient/bounce
- **v0.43** Integration + gap-list sync

---

## 2026-06-13 — Wave 1: v0.33–v0.37

### Added
- **v0.33** Construction scripts, BP pulse debugger, Level BP
- **v0.34** Material assets + instances
- **v0.35** Prefab property overrides
- **v0.36** Recast navmesh WASM bake
- **v0.37** Live Tree debugger + tick profiler

### Fixed
- v0.33 in-flight TS errors (`scripting.ts`, `spawn.ts`)

### Changed
- `AddActorCommand` runs `onConstruct` on all spawns
- Property commands skip undo during Play