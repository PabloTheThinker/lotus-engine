# CHECKPOINT — 2026-06-13 (Lotus Engine — wave 18)

> Working doc: `docs/INDIE-GAME-ROADMAP.md` (primary) + `docs/GODOT-CENSUS.md`. UE gap list is reference only.

## State

- **Strategic focus: indie games like Godot** — web export moat, small node pack, `@export` scripting.
- **Project renamed: Vektra Engine → Lotus Engine** (`Software/lotus-engine`, `lotus-engine` npm package).
- **Last clean commit: v5.68 (waves 101–105).** v0.33–v5.68 shipped; **build clean**, **`npm run test` — 469 passed**.
- **Strategic expansion:** 3D RPG + Godot/Unreal-class workflows on three.js (camera, inventory, dialogue, quests, export pack) — see `docs/INDIE-GAME-ROADMAP.md`.
- Dev server `npm run dev`, relay :24690. Test harness: `@playwright/test` in-repo (`playwright.config.ts`) with `--enable-gpu --use-angle=gl-egl`.

## Shipped wave 3 (v0.44 → v0.48, commit `70c112b`)

| Ver | What |
|---|---|
| v0.44 | Material editor v2 — GPU `onBeforeCompile` nodes (UV, TextureSample, Fresnel, Noise), live preview sphere (`materialShader.ts`, `MaterialEditor`) |
| v0.45 | Quad viewport layouts — 2×2 scissor panes, maximize/restore, per-pane cameras (`viewportLayout.ts`, `Viewport.tsx`) |
| v0.46 | Keyboard shortcut editor — 25 rebindable bindings, localStorage overrides (`shortcuts.ts`, `ShortcutEditor`) |
| v0.47 | Content Drawer dock-pin, asset type stripes, Rename/Duplicate context menu (`ContentDrawer`, `ContentBrowser`) |
| v0.48 | Sequencer bezier interp + graphical `CurveEditor` with tangent handles (`sequencer.ts`, `CurveEditor.tsx`) |

## Shipped wave 4 (v0.49 → v0.54, commit `ee45f2c`)

| Ver | What |
|---|---|
| v0.49 | Path traced viewport mode — `WebGLPathTracer`, `r.PathTracer` cvar, progressive samples badge |
| v0.50 | 2D blend space — Delaunay triangulation canvas, `tickBlendSpace2D`, AnimStateEditor Blend 2D tab |
| v0.51 | Multiplayer property sync — host `@ 10 Hz`, Sync Spawn, Details Network checklist (`multiplayer.ts`) |
| v0.52 | HUD widget Sequencer tracks — opacity/left/top/width/color keys on DOM widgets |
| v0.53 | Grid-chunked world streaming — `streamCell`, `show streaming`, `api.loadCell`, export-by-cell (`streaming.ts`) |
| v0.54 | Playwright smoke tests — build, editor boot, vektra bridge, terminal spawn, viewport stats (`tests/smoke.spec.ts`) |

## Shipped wave 1 (v0.33 → v0.37, commit `5017d2c`)

| Ver | What |
|---|---|
| v0.33 | Blueprint completion: onConstruct (AddActorCommand + gizmo release), __bpPulse debugger, Level BP button |
| v0.34 | Material assets + instances (`materialAssets.ts`, Content Browser, Details overrides) |
| v0.35 | Prefab property overrides + revert (⟲) |
| v0.36 | Recast navmesh bake (worker WASM), show navmesh, World Settings Navigation |
| v0.37 | Live Tree debugger, per-actor tick profiler, `vektra.getLiveSnapshot()`, live Details during Play |

## Shipped wave 2 (v0.38 → v0.43, commit `4c288ee`)

| Ver | What |
|---|---|
| v0.38 | FSM animation editor + 1D blend space (`AnimStateEditor` tab, `animStateMachine.ts`) |
| v0.39 | MetaSounds-lite WebAudio graph (`MetaSoundEditor`), HRTF PannerNode spatialization, TriggerVolume reverb zones, SoundEmitter actor |
| v0.40 | Multi-level export (`__LOTUS_LEVELS__` + `api.loadLevel`), PWA export, mobile/desktop quality presets; BP function collapse/macros (`collapseToFunction`) |
| v0.41 | Plugin API — `registerNodeType`/`registerPanel`/importers/consoleCommands, Plugin Manager, drag-drop install |
| v0.42 | GAS-lite (attribute sets + abilities + `api.activateAbility`), piercing pick menu (Ctrl+RMB), particle ribbon renderer + 4-stop gradient + ground bounce |
| v0.43 | Wave 2 integration commit — gap-list doc sync, build verification |

## Shipped earlier (v0.20 → v0.32, committed + verified)

| Ver | What |
|---|---|
| v0.20 | Pause/frame-step, Pilot Actor, Ctrl+Space Content Drawer, snap dropdowns, camera speed 1-8, drag-ghost, Place Actors panel |
| v0.21 | Hotkey-order fix (Spacebar cycle, Alt+2/3/4/5), F11, Alt+P, Ctrl+`, Alt+RMB dolly, `show collision`, r.ScreenPercentage→render scale, RectLight, outliner `-`/`+` search ops |
| v0.22 | Ortho views Alt+G/H/J/K (narrow-FOV pseudo-ortho, auto-wireframe, dark bg, pose restore) |
| v0.23 | Details reset-to-default arrows (⟲, undo-stack) |
| v0.24 | BP ForLoop/DoOnce/FlipFlop + Surface Snapping (⊥ Surf, release-path align-to-normal) |
| v0.25 | Sequencer P2: property tracks, per-key interp (◆●■), 🎬 camera cuts, ⚡ event keys |
| v0.26 | BP data pins + variables (pure Data nodes, cyan wires, __vars, Branch 'variable >') |
| v0.27 | Niagara module-stack UI (7 modules, enable toggles, sim-respected) |
| v0.28 | EQS (queryBestPoint), AI perception (canSeePlayer), collision layers/masks→Rapier groups, hierarchical tags, actionHeldTime |
| v0.29 | UMG HUD designer (text/bar/button widgets, button→signal, serialized) |
| v0.30 | HDRI backdrop import, Editor Preferences modal, UE console autocomplete |
| v0.31 | Movie Render Queue (🎥 .webm export) + Take Recorder (⏺ 10Hz sampling) |
| v0.32 | Water actor (Gerstner-lite) + PCG Scatter volume (sample→filter→spawn, seeded) |

## Shipped wave 5 (v0.55 → v0.58, commit `1fdcac6`)

| Ver | What |
|---|---|
| v0.55 | Two-bone IK + LookAt on glTF skeletons (`ik.ts`, Details IK section) |
| v0.56 | BP Gate, MultiGate, SwitchInt, BindSignal, CallSignal nodes |
| v0.57 | GAS gameplay effects — duration modifiers, `api.applyEffect` / `api.removeEffect` |
| v0.58 | Camera bookmarks persist in level; Modes dropdown; Label3D billboard actor |

## Shipped wave 6 (v0.59 → v0.61, commit `d3f163e`)

| Ver | What |
|---|---|
| v0.59 | Particle mesh renderer, sub-emitters, 4-point size curve |
| v0.60 | Material GPU WPO — WorldPosition, ObjectPosition → vertex displacement |
| v0.61 | Visual PCG graph editor (`pcgGraph.ts`, 🎲 PCG tab); Playwright **9 tests** |

## Shipped wave 7 (v0.62 → v0.67)

| Ver | What |
|---|---|
| v0.62 | Audio falloff curves + Sequencer audio tracks with scrubbing |
| v0.63 | Blueprint exec breakpoints (gutter toggle, F5 Continue) |
| v0.64 | Widget3D — CSS3DRenderer world-space HTML (export canvas fallback) |
| v0.65 | MP ownership + client prediction + `own` protocol |
| v0.66 | Baked AO (approx) — `lightmapBake.ts`, Build → Bake AO |
| v0.67 | Playwright **13 tests** — navmesh, materials, blueprint, MP mock |

### Wave 7 gap-list marks (v0.67 sync)

| Item | Status |
|---|---|
| Audio falloff curves | ✅ v0.62 |
| Sequencer audio scrubbing | ✅ v0.62 |
| Blueprint exec breakpoints | ✅ v0.63 |
| Widget3D (world-space HTML) | ✅ v0.64 |
| MP ownership + prediction | ◐ v0.65 |
| Baked AO (approx) | ◐ v0.66 |

## Shipped wave 8 (v0.68 → v0.72)

| Ver | What |
|---|---|
| v0.68 | Buffer visualization (worldNormal, depth, baseColor, roughness, metallic) |
| v0.69 | Status bar save indicator + autosave countdown |
| v0.70 | Sequencer audio waveforms + loop regions |
| v0.71 | MP 2-tab relay integration test (14 tests total) |
| v0.72 | AO map bake to UV2 (`build ao map`) |

## Shipped wave 9 (v0.73 → v0.78, Lotus rename)

| Ver | What |
|---|---|
| v0.73 | Lotus Engine rebrand + `LOTUS-ENGINE-RESEARCH.md` |
| v0.74 | Fixed physics timestep + `onPhysicsTick` |
| v0.75 | Particle bounds + GPU backend stub |
| v0.76 | AO bake worker + xatlas UV2 path |
| v0.77 | TSL material preview stub |
| v0.78 | Buffer viz AO + emissive |

## Shipped wave 10 (v0.79 → v0.84)

| Ver | What |
|---|---|
| v0.79 | WebGPU quality tier toggle + render backend badge |
| v0.80 | WebGL post stack SSAO/FXAA + TSL post stub |
| v0.81 | Asset pipeline v2 — IndexedDB blobs, DRACO, KTX2 |
| v0.82 | Static mesh LOD chains (`THREE.LOD`) |
| v0.83 | BatchedMesh export merge for playable HTML |
| v0.84 | Rapier `moveAndSlide` character controller + script API |

## Shipped wave 11 (v0.85 → v0.90)

| Ver | What |
|---|---|
| v0.85 | SSR + LightProbeGrid interior GI approx |
| v0.86 | MP dedicated server + lag compensation |
| v0.87 | MP delta compression + interest management |
| v0.88 | Rapier joints + raycast vehicle |
| v0.89 | TSL material editor serialize path |
| v0.90 | DetourCrowd + landscape splat textures |

## Shipped wave 12 (v0.91 → v0.96)

| Ver | What |
|---|---|
| v0.91 | Behavior Tree editor — visual graph + live PIE highlight |
| v0.92 | Data table grid + curve assets (`DataTableEditor`, `evaluateCurve`) |
| v0.93 | Project Settings modal — global defaults + export branding |
| v0.94 | Nested prefab-in-prefab (`prefabRef`, `expandPrefabRefs`) |
| v0.95 | Voronoi fracture + strain multiplier on breakable physics |
| v0.96 | SSGI quality preset (WebGPU) + command palette asset search |

## Shipped wave 13 (v0.97 → v1.02)

| Ver | What |
|---|---|
| v0.97 | WebGPU QA matrix + `createLotusRenderer` factory |
| v0.98 | WebGPURenderer viewport swap (opt-in tier, WebGL aux) |
| v0.99 | GPU particle compute-tier batch sim (`GPUParticleSystem`) |
| v1.00 | SSGI screen-space pass in WebGL composer |
| v1.01 | BT editor v2 — wire delete, node props, blackboard panel |
| v1.02 | Export playable E2E + `window.lotus.renderer` bridge |

## Shipped wave 14 (v1.03 → v1.08)

| Ver | What |
|---|---|
| v1.03 | TSL RenderPipeline bloom on WebGPURenderer (`postStackTSLPipeline.ts`) |
| v1.04 | GPU particle `ComputeNode` probe + `usesComputeNode` flag |
| v1.05 | Export playable Playwright boot test (canvas + overlay) |
| v1.06 | WebGPU export runtime — async `createPlayRenderer`, `renderBackend` in export JSON |
| v1.07 | BT editor drag-to-connect wires + Repeat/Cooldown decorator nodes |
| v1.08 | Export runtime boot fixes — deferred pawn input, guarded env apply, `loadSounds` skip |

## Shipped wave 15 (v1.09 → v1.14)

| Ver | What |
|---|---|
| v1.09 | TSL GTAO + FXAA + bloom RenderPipeline (`postStackTSLPipeline.ts`, stats `F` badge) |
| v1.10 | Particle `simBuffers()` + compute-tier `integrateParticleBuffers` / `skipForces` |
| v1.11 | Export runtime TSL bloom pipeline (`createExportTSLPipeline` in `runtime.js`) |
| v1.12 | BT `validateBTGraph` + editor validation/compile preview panels |
| v1.13 | Material TSL dynamic `three/webgpu` import (no build warnings) |
| v1.14 | Playwright wave 15 tests — 29 passed |

## Shipped wave 16 (v1.15 → v1.20)

| Ver | What |
|---|---|
| v1.15 | TSL post stack SSGI + SSR on WebGPURenderer (`postStackTSLPipeline.ts`, Viewport `applyPostFx`) |
| v1.16 | GPU particle TSL compute kernel — `bindParticleIntegrateKernel` / `runParticleGPUIntegrate` |
| v1.17 | Export runtime TSL GTAO + FXAA + SSGI + SSR (`createExportTSLPipeline` in `runtime.js`) |
| v1.18 | BT compile-to-script, `inferBlackboardTypes`, PIE breakpoints (`__btBreakpoint`, BTEditor) |
| v1.19 | Material Editor WebGPU TSL live preview sphere (`MaterialEditor.tsx`) |
| v1.20 | Playwright wave 16 tests — 32 passed |

## Shipped wave 17 (v1.21 → v1.26)

| Ver | What |
|---|---|
| v1.21 | TSL post TRAA + denoise for SSGI — velocity MRT, `fx.taa` in editor + export (`postStackTSLPipeline.ts`, `runtime.js`) |
| v1.22 | GPU particle alive mask + emit kernel — `aliveF`, `runParticleGPUEmit`, `bindWorldGPUParticles` |
| v1.23 | Export WebGPU particle tier — `bindExportParticleCompute`, `gpuTier` CPU skip in playable runtime |
| v1.24 | BT decorator compile (Repeat/Cooldown wrap, no unroll) + subtree collapse/expand + visual wrap (`btGraph.ts`, `BTEditor.tsx`) |
| v1.25 | Material TSL per-node graph compile — `compileMaterialGraphTSLNodes`, serialize v2 + `nodeGraph` |
| v1.26 | Playwright wave 17 tests — 35 passed |

## Shipped wave 18 (v1.27 → v1.32)

| Ver | What |
|---|---|
| v1.27 | TSL post SSR temporal denoise — velocity MRT + TRAA/denoise on SSR pass (editor + export) |
| v1.28 | GPU particle life/color/size buffers — integrate kernel + `skipLifeColor` reduces CPU sync |
| v1.29 | Export particle GPU QA + perf badge — `particles.qaMatrix`, fps HUD, `__LOTUS_EXPORT_PERF__` |
| v1.30 | BT collapsed subtree PIE — `graphForBTCompile`, highlight maps to collapsed decorator |
| v1.31 | Material Editor TSL node-graph preview badge — `previewChannels`, live channel overlay |
| v1.32 | Playwright wave 18 tests — 38 passed |

## Shipped (v1.33–v1.38, Wave 19)

| Ver | What |
|---|---|
| v1.33 | BT services + decorators — `TimeLimit`, `BlackboardGate`, `SvcPlayerNear`/`SvcSetBB`, service edge compile + runtime tick |
| v1.34 | Niagara modules — wind / rotation / collision CPU modules + Details module stack |
| v1.35 | Substrate-lite — `ClearCoat` + `Sheen` material nodes; TSL substrate channel bind |
| v1.36 | GAS stacking — `stackPolicy`, `maxStacks`, `getActorEffectStacks` |
| v1.37 | MP GAS replication — `replicateGAS`, `ga:` deltas, replication tier priority |
| v1.38 | Playwright wave 19 tests — 42 passed |

## Shipped (v1.39–v1.43, Wave 20)

| Ver | What |
|---|---|
| v1.39 | SSR quality presets — `ssrPreset.ts`, WebGL + TSL + export parity |
| v1.40 | GPU ribbon trail — `trail` in `simBuffers`, `shiftAllRibbonTrails` on GPU path |
| v1.41 | Export perf gate — `__LOTUS_EXPORT_PERF__.perfPass` / `perfMinFps` |
| v1.42 | BT collapsed script compile + stashed-node breakpoints |
| v1.43 | Material Editor wire drag + channel pins — 46 tests passed |

## Shipped (v1.44–v1.48, Wave 21)

| Ver | What |
|---|---|
| v1.44 | SSR ground reflector — `postSsrGround`, `ReflectorForSSRPass`, `ssrGround.ts` |
| v1.45 | DOF stub — `postStackDOF.ts`, WebGL + TSL dof wiring, World Settings |
| v1.46 | GPU trail shift kernel — `bindParticleTrailKernel`, `kernel.trail` QA |
| v1.47 | BT services compile + PIE — `serviceNodeId`, `getActiveBTServiceNodeIds` |
| v1.48 | Material wire preview flash + export `perfMinFps: 20` — 51 tests passed |

## Shipped (v1.49–v1.53, Wave 22)

| Ver | What |
|---|---|
| v1.49 | TSL DOF bokeh — `DepthOfFieldNode` editor + export TSL pipelines |
| v1.50 | TSL SSR ground — `syncTSLSSRGround`; WebGL ground live env sync |
| v1.51 | Export WebGPU particle E2E boot test |
| v1.52 | CI perf gate — `npm run perf:gate` headless fps probe |
| v1.53 | BT service breakpoint + services compile panel; Material solo channel — 55 tests passed |

## Shipped (v1.54–v1.58, Wave 23)

| Ver | What |
|---|---|
| v1.54 | DOF env sliders — focus/focal/bokeh + WebGL vignette; `getDOFSettings` |
| v1.55 | Export ribbon — trail GPU kernel + ribbon mesh in playable runtime |
| v1.56 | GitHub Actions CI — test + perf-gate workflow |
| v1.57 | BT script compile diff panel + `diffBTScriptPreview` |
| v1.58 | Material minimap + Alt+1–9 solo channel — 59 tests passed |

## Shipped (v1.59–v1.63, Wave 24)

| Ver | What |
|---|---|
| v1.59 | DOF per-camera override + cinematic focus pull — CineCamera Details, `getDOFSettings(env, camera)` |
| v1.60 | Export ribbon E2E boot — `__LOTUS_EXPORT_RIBBON_QA__` trail tri assert |
| v1.61 | Export perf gate badge — status bar iframe probe via `probeExportPerfGate()` |
| v1.62 | BT script diff gutter markers — `getBTScriptDiffGutterNodeIds`, `≠` gutter on changed nodes |
| v1.63 | Material minimap pan/zoom viewport sync — layer transform + minimap viewport rect — 64 tests passed |

## Shipped (v1.64–v1.68, Wave 25)

| Ver | What |
|---|---|
| v1.64 | DOF focus pull sequencer track — `dofFocusDistance` on Camera actors |
| v1.65 | Color grading LUT stub — lift/gamma/gain WebGL + TSL gain pass |
| v1.66 | Export sub-emitter parity — `spawnBurstAt` + `__LOTUS_EXPORT_SUB_EMITTER_QA__` |
| v1.67 | Perf gate re-probe — `scheduleExportPerfProbe` on save/export |
| v1.68 | BT gutter click-to-jump; material minimap solo highlight + zoom hint — 69 tests passed |

## Shipped (v1.69–v1.73, Wave 26)

| Ver | What |
|---|---|
| v1.69 | TSL post full LGG — `applyColorGradingTSL` lift/gamma/gain on WebGPU |
| v1.70 | ACES filmic tonemap stub — `postAces` env + TSL `acesFilmicToneMapping` |
| v1.71 | GPU particle wind/rotation — integrate kernel uniforms + `particlesGPU` module pass |
| v1.72 | Export TSL color grading parity — LGG + ACES in `createExportTSLPipeline` |
| v1.73 | BT diff scroll/jump; material minimap drag-pan + channel legend — 74 tests passed |

## Shipped (v1.74–v1.78, Wave 27)

| Ver | What |
|---|---|
| v1.74 | Color grading presets — `postColorGradingPreset` + exposure-linked LGG |
| v1.75 | ACES exposure polish — `getACESExposure()` editor + export |
| v1.76 | GPU particle collision — sphere bounce on integrate kernel |
| v1.77 | Export DOF sequencer — `dofFocusDistance` track + `setDofFocus()` |
| v1.78 | BT gutter batch-resolve + PIE resync; minimap zoom + legend reorder — 80 tests passed |

## Shipped (v1.79–v1.83, Wave 28)

| Ver | What |
|---|---|
| v1.79 | TSL post preset thumbnails + per-preset ACES toggle — `postPresetAces`, `grading-preset-grid` |
| v1.80 | GPU particle ground bounce — terrain `groundYU` on integrate kernel |
| v1.81 | Export cinematic focus-pull — `resolveExportDofFocus` in playable runtime |
| v1.82 | BT diff gutter multi-select + `exportBTScriptDiffPatch` clipboard export |
| v1.83 | Material legend Shift+pin minimap + solo upstream graph flash — 85 tests passed |

## Shipped (v1.84–v1.88, Wave 29)

| Ver | What |
|---|---|
| v1.84 | TSL post LUT upload stub + preset A/B compare slider — `postColorGradingLut.ts`, `blendColorGradingSettings`, World Settings compare row |
| v1.85 | GPU particle sub-emitter spawn on death — `snapshotAliveForGPU`, `processGPUSubEmitterDeaths` on integrate path |
| v1.86 | Export color grading preset parity + per-preset ACES — `postPresetAces`, `postGradingCompareT` blend in runtime |
| v1.87 | BT service decorator PIE breakpoint polish — `getBTServiceHostNodeId`, gutter host highlight + auto-scroll |
| v1.88 | Material minimap click-to-focus + wire channel pin sync — `syncChannelPin`, focused node stroke, pin z-index — 90 tests passed |

## Shipped (v1.89–v1.93, Wave 30)

| Ver | What |
|---|---|
| v1.89 | TSL post LUT apply in grading pass — WebGL shader + TSL `applyGradingLUTTSL`, `postGradingLutStrength` |
| v1.90 | GPU sub-emitter burst uniforms — `subEmitterCountU/SpeedU/LifeU/RateU` on integrate kernel + CPU death bursts |
| v1.91 | Export grading preset thumbnails + `blendGradingCompare` in playable runtime |
| v1.92 | BT step-over (F10) + conditional breakpoints (`service-active`, `decorator-host`) |
| v1.93 | Material legend↔pin bidirectional sync + eased minimap focus pan — 95 tests passed |

## Shipped (v1.94–v1.98, Wave 31)

| Ver | What |
|---|---|
| v1.94 | `.cube`/`.3dl` LUT decode — `parseCubeLUT`, `parse3dlLUT`, texture cache, 2D atlas sampling |
| v1.95 | GPU sub-emitter burst spawn kernel — `runParticleGPUSubEmitterBurst` on death origin |
| v1.96 | Export LUT apply parity — `applyLutGrading` in playable runtime TSL path |
| v1.97 | BT blackboard-equals breakpoint + service step-into (`registerBTBreakpointStepInto`) |
| v1.98 | Material Tab focus cycle + legend drag pin preview on minimap — 100 tests passed |

## Shipped (v1.99–v2.03, Wave 32)

| Ver | What |
|---|---|
| v1.99 | PNG LUT atlas import + persisted decode in level save — `decodePngLUTAtlas`, `persistDecodedLUTToEnvironment`, `restoreGradingLUTFromEnvironment` |
| v2.00 | GPU batched multi-death sub-burst — `runParticleGPUSubEmitterBurstBatch`, `gpuSubBurstSpawnBatch` |
| v2.01 | Export embeds decoded LUT bytes — `window.__LOTUS_LUT__`, `decodeExportLUTTexture` in playable runtime |
| v2.02 | BT step-into nested collapsed decorator subtrees + PIE blackboard watch panel |
| v2.03 | Material Shift+Tab reverse focus cycle + legend drag wire pin preview — 105 tests passed |

## Shipped (v2.04–v2.08, Wave 33 — indie focus)

| Ver | What |
|---|---|
| v2.04 | Timer actor — wait/oneShot/autostart, `timeout:` signal (`Timer`, `tickIndieNodes`) |
| v2.05 | RayCast3D actor — per-frame hit/clear signals, arrow gizmo (`RayCast3D`) |
| v2.06 | Path3D + PathFollow3D — Catmull-Rom waypoints, progress/speed/loop (`path3d.ts`) |
| v2.07 | Godot groups (`groups[]`, `api.getActorsInGroup`), Project Settings autoload + main scene key |
| v2.08 | `api.changeScene`, export `__LOTUS_MAIN__`, `docs/INDIE-GAME-ROADMAP.md` — 110 tests passed |

## Shipped (v2.09–v2.13, Wave 34 — indie focus)

| Ver | What |
|---|---|
| v2.09 | `@export_range` — clamped slider widgets in Details from script annotations |
| v2.10 | `@export_enum` — dropdown widgets for enumerated script vars |
| v2.11 | Area3D actor — `body_entered:` / `body_exited:` overlap signals (group filter optional) |
| v2.12 | Prefab polish — override summary panel, Revert All, 📦 outliner badge on instance children |
| v2.13 | Character starter template — `/starter thirdperson|firstperson|fly` — 115 tests passed |

## Shipped (v2.14–v2.18, Wave 35 — indie focus)

| Ver | What |
|---|---|
| v2.14 | Editable children UX — prefab subtree panel, ≠ override diff gutter (Details + Outliner) |
| v2.15 | Sequencer script var tracks — key any `@export` field on timeline |
| v2.16 | Resource (.tres) lite — `resources.ts` JSON assets by UUID in localStorage |
| v2.17 | Platformer starter — `/platformer side|wide` greybox scene |
| v2.18 | Docs + smoke tests — 120 tests passed |

## Shipped (v2.19–v2.43, Waves 36–40 — indie focus)

| Wave | Ver | What |
|---|---|---|
| 36 | v2.19–v2.23 | GridMap UX — `gridMap.ts`, tile palette, brush, overlay, `lotus.gridMap` bridge |
| 37 | v2.24–v2.28 | Starter packs — `/rpg`, `/fps` top-down RPG + FPS greybox |
| 38 | v2.29–v2.33 | MP indie template — `/mpstarter`, sync crates, relay 2-tab smoke |
| 39 | v2.34–v2.38 | Touch input PWA — virtual joystick, export `__LOTUS_TOUCH__` |
| 40 | v2.39–v2.43 | Anim polish — script var presets, blend ↔ @export, Sequencer Apply Preset — 144 tests |

## Shipped (v2.44–v2.68, Waves 41–45 — indie swarm)

| Wave | Ver | What |
|---|---|---|
| 41 | v2.44–v2.48 | TileMap layers + autotile — `gridMap` layer paint/erase, `autotileNeighbors`, Details layer UI |
| 42 | v2.49–v2.53 | Starter mini-games — `starterMiniGames.ts`, `/minigame platformer\|rpg\|fps`, `game_won` signal |
| 43 | v2.54–v2.58 | MP deathmatch — `mpGameplay.ts`, scoreboard, `/mpdeathmatch`, relay host-score smoke |
| 44 | v2.59–v2.63 | Touch Fire/Interact + gamepad — `touchInput`, `gamepadInput`, export `__LOTUS_GAMEPAD__` |
| 45 | v2.64–v2.68 | 2D blend ↔ @export — `blendScriptVarLinkX/Y`, AnimStateEditor links, `resolveAnimParams` — 169 tests |

## Shipped (v2.69–v2.93, Waves 46–50 — indie swarm)

| Wave | Ver | What |
|---|---|---|
| 46 | v2.69–v2.73 | TileMap polish — layer visibility, autotile preview in viewport |
| 47 | v2.74–v2.78 | Mini-game HUD — win/lose overlays, `/minigameexport`, export preset |
| 48 | v2.79–v2.83 | MP score sync — client mirror, `mp_game_won` relay smoke |
| 49 | v2.84–v2.88 | Input polish — touch layout presets, gamepad glyph hints |
| 50 | v2.89–v2.93 | Scene flow — `/mainmenu`, level select, `__LOTUS_MAIN_MENU__` — 194 tests |

## Shipped (v2.94–v3.18, Waves 51–55 — indie swarm)

| Wave | Ver | What |
|---|---|---|
| 51 | v2.94–v2.98 | Autotile rules — 8-neighbor corners, per-cell kind rebuild |
| 52 | v2.99–v3.03 | Mini-game export pack — PWA `/exportpack`, `__LOTUS_MINIGAME_PACK__` |
| 53 | v3.04–v3.08 | MP lobby — ready-up, `/mplobby`, relay start smoke |
| 54 | v3.09–v3.13 | Input rebinding — gamepad + touch slot overrides |
| 55 | v3.14–v3.18 | Scene transitions — fade/slide on level select — 219 tests |

## Shipped (v3.19–v3.43, Waves 56–60 — indie swarm)

| Wave | Ver | What |
|---|---|---|
| 56 | v3.19–v3.23 | Autotile atlas UV — 16-tile sprite sheet per corner variant |
| 57 | v3.24–v3.28 | Export pack polish — itch.io meta, screenshot capture |
| 58 | v3.29–v3.33 | MP matchmaking — room list + relay ping in lobby HUD |
| 59 | v3.34–v3.38 | Input profiles — desktop/mobile presets, save/load custom |
| 60 | v3.39–v3.43 | Streaming UX — cell load progress bar in export — 244 tests |

## Shipped (v3.44–v3.68, Waves 61–65 — indie swarm)

| Wave | Ver | What |
|---|---|---|
| 61 | v3.44–v3.48 | Custom autotile sheets — PNG import + 4×4 tile mapping |
| 62 | v3.49–v3.53 | itch.io upload helper — `/itchpack` zip export |
| 63 | v3.54–v3.58 | MP dedicated server — `npm run dedicated`, host `000000` |
| 64 | v3.59–v3.63 | Touch haptics — Vibration API on Fire/Interact/Jump |
| 65 | v3.64–v3.68 | Save system — localStorage checkpoints + export slots — 269 tests |

## Shipped (v3.69–v3.93, Waves 66–70 — indie swarm)

| Wave | Ver | What |
|---|---|---|
| 66 | v3.69–v3.73 | Tile collision layers — per-layer Rapier groups on grid colliders |
| 67 | v3.74–v3.78 | Butler CLI hint — `/butlerhint` generates `butler push` command |
| 68 | v3.79–v3.83 | MP spectator — orbit cam, `spectator_join`, `/mpspectator` |
| 69 | v3.84–v3.88 | Gamepad haptics — `dual-rumble` on Fire/Interact |
| 70 | v3.89–v3.93 | Cloud save stub — IndexedDB checkpoint backup — 294 tests |

## Shipped (v3.94–v4.18, Waves 71–75 — indie swarm)

| Wave | Ver | What |
|---|---|---|
| 71 | v3.94–v3.98 | Grid navmesh bake — per-layer walkable mask, `/gridnavmesh` |
| 72 | v3.99–v4.03 | itch.io channels — Butler `:beta` / `:demo` hints |
| 73 | v4.04–v4.08 | MP replay buffer — 30s pose ring, spectator R rewind |
| 74 | v4.09–v4.13 | Adaptive haptics — perf/battery/intensity scaling |
| 75 | v4.14–v4.18 | Cross-level saves — `__global__` namespace — 319 tests |

## Shipped (v4.19–v4.43, Waves 76–80 — indie swarm)

| Wave | Ver | What |
|---|---|---|
| 76 | v4.19–v4.23 | Grid nav agents — per-layer crowd on grid navmesh |
| 77 | v4.24–v4.28 | itch.io release notes — CHANGELOG slice in pack zip |
| 78 | v4.29–v4.33 | MP killcam — replay on `player_killed` |
| 79 | v4.34–v4.38 | Haptic profiles — desktop/mobile intensity presets |
| 80 | v4.39–v4.43 | Save slot UI — Escape pause menu in export — 344 tests |

## Shipped (v4.44–v4.68, Waves 81–85 — indie swarm)

| Wave | Ver | What |
|---|---|---|
| 81 | v4.44–v4.48 | Grid agent AI — patrol / chase / idle on navmesh; `/gridnavai` |
| 82 | v4.49–v4.53 | Pack changelog HTML — `CHANGELOG.html` in itch zip + boot overlay |
| 83 | v4.54–v4.58 | MP team deathmatch — red/blue teams, friendly fire off; `/mpteams` |
| 84 | v4.59–v4.63 | Cloud save sync stub — manifest + cross-device hint |
| 85 | v4.64–v4.68 | Export achievements — localStorage trophies + HUD toasts — 369 tests |

## Shipped (v4.69–v4.93, Waves 86–90 — indie swarm)

| Wave | Ver | What |
|---|---|---|
| 86 | v4.69–v4.73 | Grid nav path debug — pathfind polyline; `/gridnavpath` |
| 87 | v4.74–v4.78 | itch.io embed widget — `embed-widget.html` in zip; `/itchembed` |
| 88 | v4.79–v4.83 | MP CTF — flag pickup/capture; `/mpctf` |
| 89 | v4.84–v4.88 | Cloud save import/export — JSON download/upload |
| 90 | v4.89–v4.93 | Achievement progress — partial unlock + HUD ring — 394 tests |

## Shipped (v4.94–v5.18, Waves 91–95 — 3D RPG swarm)

| Wave | Ver | What |
|---|---|---|
| 91 | v4.94–v4.98 | 3D RPG camera rig — spring arm; `/rpg3d` greybox |
| 92 | v4.99–v5.03 | RPG inventory + stats — slots, gold, GAS; `/inventory` |
| 93 | v5.04–v5.08 | RPG dialogue — trees, overlay, NPC interact |
| 94 | v5.09–v5.13 | RPG quests — objectives, tracker; `/quest start` |
| 95 | v5.14–v5.18 | 3D RPG export pack — HUD + elder + herbs quest; `/exportrpg` — 419 tests |

## Shipped (v5.19–v5.43, Waves 96–100 — 3D RPG combat swarm)

| Wave | Ver | What |
|---|---|---|
| 96 | v5.19–v5.23 | Combat lite — melee/ranged, enemy nav chase; `/combat` |
| 97 | v5.24–v5.28 | Equipment — paper-doll HUD + GAS modifiers; `/equip` |
| 98 | v5.29–v5.33 | Overworld streaming — 2×2 cells + portals; `/rpgoverworld` |
| 99 | v5.34–v5.38 | Combat anim oneshot — `/combatanim` + melee montage |
| 100 | v5.39–v5.43 | Crafting + loot — `/craft`, goblin drops — 444 tests |

## Shipped (v5.44–v5.68, Waves 101–105 — 3D RPG polish swarm)

| Wave | Ver | What |
|---|---|---|
| 101 | v5.44–v5.48 | Combat polish — i-frames, hit flash, damage numbers; `/combatpolish` |
| 102 | v5.49–v5.53 | Equipment visuals — weapon socket mesh; `/equipvisual` |
| 103 | v5.54–v5.58 | Portal transitions — loading overlay; `/portaltrans` |
| 104 | v5.59–v5.63 | Root motion stub — Attack oneshot forward nudge; `/rootmotion` |
| 105 | v5.64–v5.68 | Economy / shops — village_vendor buy/sell; `/shop` — 469 tests |

## Shipped (v5.69–v5.93, Waves 106–110 — 3D RPG UX swarm)

| Wave | Ver | What |
|---|---|---|
| 106 | v5.69–v5.73 | Damage numbers HUD — screen-space floaters; `/damagehud` |
| 107 | v5.74–v5.78 | Vendor NPC — Vendor tag + shop panel; `/vendor` |
| 108 | v5.79–v5.83 | Armor visuals — head/chest sockets; `/armorvisual` |
| 109 | v5.84–v5.88 | Portal cinematic — slide + preload ring; `/portalcine` |
| 110 | v5.89–v5.93 | Quest economy — find_herbs herb discount; `/shopprice` — 494 tests |

## Next up (3D RPG + engine parity)

1. **Shop buy UX** — click-to-buy rows in shop panel + sell tab
2. **Vendor dialogue tree** — greet line before shop opens (VN-style branch)
3. **Damage crit pipeline** — `dealDamage` crit flag → gold floater styling
4. **Overworld cell preload** — real `loadCellDuringPlay` progress on portal ring
5. **Reputation quests** — unlock shop listings when quests complete

## Gotchas carried forward

- Parallel Codex sprints modify files mid-session — use idempotent python patches with `in s` guards; Edit tool fails on externally-modified files.
- `python3 str.replace` silently no-ops when anchors drift — always grep-verify after patching (the v0.33 spawn.ts break came from this).
- SwiftShader renders the post stack black — always pass `--enable-gpu --use-angle=gl-egl`.
- Straight-down `lookAt` is singular — epsilon-tilt the direction vector.
- Stale autosaved levels make physics tests vacuous — spawn fresh actors in tests.
- Path tracer is single-pane perspective only — quad layout and ortho panes fall back to lit mode.