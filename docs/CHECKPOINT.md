# CHECKPOINT — 2026-06-10 (session end)

> Where the UE5.7 gap-list run stopped. Resume from here.
> Working doc: `docs/UE5.7-GAP-LIST.md` (statuses current through v0.32).

## State

- **Last clean commit: `8bc3cc3` — v0.32 (Water + PCG Scatter).** Everything through v0.32 is committed, built, and Playwright-verified.
- **Working tree: IN-FLIGHT v0.33 (Blueprint completion cluster), partially applied, 3 TS errors.** Do NOT discard — the engine half is done; only the editor wiring is broken.
- Dev server :5199, relay :24690. Test harness: headless Chromium via `/home/pablothethinker/raven-origin/node_modules/playwright` with `--enable-gpu --use-angle=gl-egl`.

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

## IN-FLIGHT: v0.33 Blueprint completion cluster

**Already applied (engine side — compiles clean):**
- `src/engine/blueprint.ts`: `EventSignal` (On Signal → beginChains as `api.on(...)`), `EmitSignal`, `RunJS` escape-hatch node; exec-pulse injection (`__pulse('<nodeId>')` before every exec node body, `__pulse` calls `globalThis.__bpPulse(actorId, nodeId)`).
- `src/engine/scripting.ts`: `runConstructScript(actor, actors, log)` added — runs `onConstruct()` in-editor.

**Broken (3 TS errors to fix on resume):**
1. `src/engine/scripting.ts(214)`: `parseExports(actor.script, actor.scriptVars)` — wrong arity, check parseExports signature (takes 1 arg; merge scriptVars separately like compileScript does).
2. `src/editor/spawn.ts(181)`: `useEditor` not imported — add `import { useEditor } from './store'`.
3. `src/editor/spawn.ts(180)`: `runConstruct` unused — the insertion anchor regex for `spawnAsset` body didn't match (`spawn anchor: False` in output). Find the actual instantiate/addActor lines in `spawnAsset` and insert `runConstruct(actor)` after them.

**Still to do for v0.33:**
- Viewport: call `runConstructScript` after gizmo translate-release (next to the surface-snap block).
- BlueprintEditor: pulse visualization — install `globalThis.__bpPulse` hook while the panel is open; throttled state map; `.pulsing` class on node headers (<300ms old), CSS glow.
- BlueprintEditor toolbar: "Level BP" button → find-or-create Empty actor named `LevelScript`, select it (UE Level Blueprint equivalent).
- Test: OnSignal/EmitSignal round-trip between two actors, onConstruct fires on spawn, pulse hook receives ids during play. Commit as v0.33, update gap list (§2: dispatchers ✅, construction ✅, debugger ✅, level BP ✅, functions/macros ◐ via RunJS).

## Remaining gap-list queue (after v0.33)

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
