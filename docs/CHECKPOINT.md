# CHECKPOINT — 2026-06-13 (agent swarm wave 4)

> Working doc: `docs/UE5.7-GAP-LIST.md` — update statuses as items ship.
> Research synthesis: prior session (UE5 + Unity + Godot completion roadmap).

## State

- **Last clean commit: `ee45f2c` — v0.54.** v0.33–v0.54 shipped across four agent swarms; **build clean** (`npm run build` exit 0), **tests green** (`npm run test` — 5 passed).
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
| v0.40 | Multi-level export (`__VEKTRA_LEVELS__` + `api.loadLevel`), PWA export, mobile/desktop quality presets; BP function collapse/macros (`collapseToFunction`) |
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

## Next up (v0.55+)

1. **Two-bone IK + LookAt** on glTF skeletons (Control Rig graphs 🚫)
2. **Particles P3 polish** — InstancedMesh renderer, graphical size curves, sub-emitters/events
3. **GAS effect stacks** — gameplay effects over tags (extend v0.42 GAS-lite)
4. **Material WPO** — world-position-offset node in GPU shader graph
5. **Toolbar Modes dropdown** — Select/Landscape/Foliage/Paint as UE mode switcher
6. **Camera bookmarks persist** — save Shift+0-9 sets in level file
7. **BP polish** — Gate/MultiGate/Switch flow nodes, Bind/Call dispatcher nodes, breakpoints
8. **3D world-space widgets** — CSS3DRenderer or render-to-texture plane
9. **Lightmass bake** (stretch) — pathtracer AO/lightmap to second UV set
10. **Expand Playwright coverage** — PIE play/stop, navmesh bake, multiplayer relay smoke

## Remaining gap-list queue

1. **Animation cluster**: two-bone IK + LookAt, Control Rig graphs 🚫, retargeting 🚫
2. **Particles cluster**: InstancedMesh renderer, graphical size curves, sub-emitters/events
3. **GAS**: effect stacks over gameplay tags (attributes/abilities/cooldown/cost ✅)
4. **Editor UX**: toolbar Modes dropdown, camera bookmarks persist, status-bar save indicator
5. **Material cluster**: WPO node (GPU nodes + preview sphere ✅ v0.44)
6. **Audio**: attenuation falloff curve picker, Sequencer audio scrubbing (after audio tracks)
7. **Networking**: ownership model + client prediction polish (property sync + spawner ✅ v0.51)
8. **Honest-skip notes**: Lightmass bake (stretch), Nanite/Lumen 🚫

## Gotchas carried forward

- Parallel Codex sprints modify files mid-session — use idempotent python patches with `in s` guards; Edit tool fails on externally-modified files.
- `python3 str.replace` silently no-ops when anchors drift — always grep-verify after patching (the v0.33 spawn.ts break came from this).
- SwiftShader renders the post stack black — always pass `--enable-gpu --use-angle=gl-egl`.
- Straight-down `lookAt` is singular — epsilon-tilt the direction vector.
- Stale autosaved levels make physics tests vacuous — spawn fresh actors in tests.
- Path tracer is single-pane perspective only — quad layout and ortho panes fall back to lit mode.