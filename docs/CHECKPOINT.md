# CHECKPOINT — 2026-06-13 (agent swarm)

> Working doc: `docs/UE5.7-GAP-LIST.md` — update statuses as items ship.
> Research synthesis: prior session (UE5 + Unity + Godot completion roadmap).

## State

- **Last clean commit: `8bc3cc3` — v0.32.** v0.33–v0.37 landed in working tree via parallel agent swarm; **build clean** (`npm run build` exit 0), **not yet committed**.
- Dev server `npm run dev`, relay :24690. Test harness: headless Chromium via `/home/pablothethinker/raven-origin/node_modules/playwright` with `--enable-gpu --use-angle=gl-egl`.

## Shipped this swarm (v0.33 → v0.37, working tree)

| Ver | What |
|---|---|
| v0.33 | Blueprint completion: onConstruct (AddActorCommand + gizmo release), __bpPulse debugger, Level BP button |
| v0.34 | Material assets + instances (`materialAssets.ts`, Content Browser, Details overrides) |
| v0.35 | Prefab property overrides + revert (⟲) |
| v0.36 | Recast navmesh bake (worker WASM), show navmesh, World Settings Navigation |
| v0.37 | Live Tree debugger, per-actor tick profiler, `vektra.getLiveSnapshot()` |

## Shipped this run (v0.20 → v0.32, all committed + verified)

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

## Next up (Phase 2–3 from completion research)

1. **FSM animation editor** — graph UI over crossfade primitive; 1D blend space
2. **MetaSounds-lite** — WebAudio node graph editor
3. **Material editor v2** — TSL per-pixel (TextureSample, UV, Fresnel)
4. **Blueprint functions/macros** — subgraph collapse at compile
5. **Multi-level export** — `api.loadLevel` + bundled HTML manifest
6. **Plugin API surface** — `registerNodeType` / `registerPanel` for user plugins
7. **Viewport quad layouts** + piercing pick menu (Unity Ctrl+RMB)
8. **Particles P3** — ribbon renderer, curve widgets
9. **GAS-lite** — attributes + abilities over gameplay tags
10. Playwright verify v0.33–v0.37, commit stack, update `UE5.7-GAP-LIST.md` §2–§10 statuses

## Remaining gap-list queue

1. **Audio cluster**: PannerNode true spatialization, reverb zones (ConvolverNode), MetaSounds-lite graph (Osc/Gain/Filter/Out → WebAudio chain; reuse material-graph canvas pattern)
2. **Particles P3**: ribbon + mesh renderers, curve/gradient widgets, ground-collision bounce
3. **Animation tools**: FSM state-machine editor (graph UI over existing crossfade), blend spaces 1D, two-bone IK + LookAt
4. **Per-actor tick profiler** (flame list in Debug panel)
5. **Plugin API surface**: registerNodeType/registerPanel for user plugins
6. **Export extras**: PWA manifest option, multi-level export + scene switching
7. **Material instances** (named material assets, per-actor param overrides) + **path tracer mode** (three-gpu-pathtracer toggle — check dep size first)
8. **§1 leftovers**: viewport quad layouts (scissor), keyboard shortcut editor, Content Drawer dock-pin, toolbar Modes dropdown reorder
9. **Widget anims** (Sequencer on DOM) + 3D widgets (CSS3DRenderer)
10. **GAS-lite** (attributes + abilities with cooldown/cost over tags)
11. Honest-skip notes: Lightmass bake (stretch), audio scrubbing (after audio tracks), graphical bezier curve editor (interp modes shipped)

## Gotchas carried forward

- Parallel Codex sprints modify files mid-session — use idempotent python patches with `in s` guards; Edit tool fails on externally-modified files.
- `python3 str.replace` silently no-ops when anchors drift — always grep-verify after patching (the v0.33 spawn.ts break came from this).
- SwiftShader renders the post stack black — always pass `--enable-gpu --use-angle=gl-egl`.
- Straight-down `lookAt` is singular — epsilon-tilt the direction vector.
- Stale autosaved levels make physics tests vacuous — spawn fresh actors in tests.
