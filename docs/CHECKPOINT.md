# CHECKPOINT — 2026-06-13 (Lotus Engine — wave 14)

> Working doc: `docs/LOTUS-ENGINE-RESEARCH.md` + `docs/UE5.7-GAP-LIST.md` — synced through v1.08.

## State

- **Project renamed: Vektra Engine → Lotus Engine** (`Software/lotus-engine`, `lotus-engine` npm package).
- **Last clean commit: v1.08 (wave 14).** v0.33–v1.08 shipped; **build clean**, **`npm run test` — 27 passed**.
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

## Next up (v1.09+, Wave 15)

1. **TSL post stack** — SSAO/FXAA migration off EffectComposer (full WebGPU path)
2. **GPU particles** — wire `ComputeNode` sim into position buffers (protected accessors)
3. **Export runtime** — TSL bloom pipeline in standalone HTML when `renderBackend: webgpu`
4. **BT editor** — wire validation UI, decorator nesting limits, compile preview
5. **Material TSL** — fix `MeshPhysicalNodeMaterial` import warnings in build

## Remaining gap-list queue (post–wave 7)

1. **Editor UX**: buffer visualization view modes, status-bar save indicator + autosave countdown
2. **Sequencer audio**: waveform display, loop regions (scrubbing ✅ v0.62)
3. **Networking**: 2-tab live relay test; ownership/prediction polish (base ✅ v0.65)
4. **Rendering**: second UV lightmaps (vertex-color AO ✅ v0.66)
5. **Honest-skip**: full Lightmass, Nanite, Lumen, Control Rig graphs 🚫

## Gotchas carried forward

- Parallel Codex sprints modify files mid-session — use idempotent python patches with `in s` guards; Edit tool fails on externally-modified files.
- `python3 str.replace` silently no-ops when anchors drift — always grep-verify after patching (the v0.33 spawn.ts break came from this).
- SwiftShader renders the post stack black — always pass `--enable-gpu --use-angle=gl-egl`.
- Straight-down `lookAt` is singular — epsilon-tilt the direction vector.
- Stale autosaved levels make physics tests vacuous — spawn fresh actors in tests.
- Path tracer is single-pane perspective only — quad layout and ortho panes fall back to lit mode.