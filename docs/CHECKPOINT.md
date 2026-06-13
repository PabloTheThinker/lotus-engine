# CHECKPOINT — 2026-06-13 (agent swarm wave 2)

> Working doc: `docs/UE5.7-GAP-LIST.md` — update statuses as items ship.
> Research synthesis: prior session (UE5 + Unity + Godot completion roadmap).

## State

- **Last clean commit: `4c288ee` — v0.43.** v0.33–v0.43 shipped across two agent swarms; **build clean** (`npm run build` exit 0).
- Dev server `npm run dev`, relay :24690. Test harness: headless Chromium via `/home/pablothethinker/raven-origin/node_modules/playwright` with `--enable-gpu --use-angle=gl-egl`.

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

## Next up (v0.44+)

1. **Material editor v2** — per-pixel TSL (TextureSample, UV, Fresnel, Noise) + live preview sphere
2. **Viewport quad layouts** — scissor viewports on one canvas
3. **Blend space 2D** + two-bone IK + LookAt on glTF skeletons
4. **Particles P3 polish** — InstancedMesh renderer, graphical size curves, sub-emitters
5. **GAS effect stacks** — gameplay effects over tags (extend v0.42 GAS-lite)
6. **Keyboard shortcut editor** — rebindable editor hotkeys
7. **Path tracer mode** — three-gpu-pathtracer toggle (check dep size first)
8. **Widget anims** (Sequencer on DOM) + 3D widgets (CSS3DRenderer)
9. **§1 leftovers**: Content Drawer dock-pin, toolbar Modes dropdown reorder, camera bookmarks persist
10. **BP polish**: Gate/MultiGate/Switch flow nodes, Bind/Call dispatcher nodes, breakpoints

## Remaining gap-list queue

1. **Material cluster**: TSL per-pixel nodes, material preview sphere, WPO
2. **Animation cluster**: 2D blend space triangulation, Control Rig graphs 🚫, retargeting 🚫
3. **Particles cluster**: mesh renderer, graphical curve widgets (shared with Sequencer), sub-emitters/events
4. **Editor UX**: quad viewport layouts, shortcut editor, Content Drawer dock-pin, Modes dropdown
5. **GAS**: effect stacks over gameplay tags (attributes/abilities/cooldown/cost ✅)
6. **Audio**: attenuation falloff curve picker, Sequencer audio scrubbing (after audio tracks)
7. **Honest-skip notes**: Lightmass bake (stretch), Nanite/Lumen 🚫, graphical bezier tangent editor (interp modes shipped)

## Gotchas carried forward

- Parallel Codex sprints modify files mid-session — use idempotent python patches with `in s` guards; Edit tool fails on externally-modified files.
- `python3 str.replace` silently no-ops when anchors drift — always grep-verify after patching (the v0.33 spawn.ts break came from this).
- SwiftShader renders the post stack black — always pass `--enable-gpu --use-angle=gl-egl`.
- Straight-down `lookAt` is singular — epsilon-tilt the direction vector.
- Stale autosaved levels make physics tests vacuous — spawn fresh actors in tests.