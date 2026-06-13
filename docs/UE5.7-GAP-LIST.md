# UE 5.7 Documentation → Vektra Engine Gap List

> The complete worklist: every area of the official UE 5.7 documentation
> (dev.epicgames.com/documentation/unreal-engine/unreal-engine-5-7-documentation)
> mapped against what Vektra Engine has as of v0.54.
> Sourced from docs/UE5-TOOL-CENSUS.md + docs/UE5.7-EDITOR-UX-RESEARCH.md.
>
> Legend: ✅ shipped · ◐ partial (v1 shipped, upgrade listed) · ⏳ to do · 🚫 non-goal (infeasible in browser / wrong category — approximate or skip honestly)

---

## 1. Unreal Editor Interface

| UE 5.7 feature | Status | What needs to be done |
|---|---|---|
| Level Editor: viewport + gizmos + Q/W/E/R + Spacebar cycle | ✅ | — (v0.21) |
| World/local gizmo space toggle | ✅ | Ctrl+` alias shipped (v0.21) |
| Snap triplet: drag/rotation/scale toggles + preset dropdowns | ✅ | Add UE's 360-division rotation column (2.8125/5.625/11.25/22.5°) |
| Surface Snapping (rotate-to-normal) | ✅ | ⊥ Surf toolbar toggle (v0.24): translate-release sticks to the surface below + aligns to its normal. Live drag-slide + offset = polish |
| Camera speed 1–8 + scroll-during-fly sync | ✅ | Add "Speed Scalar" multiplier field |
| Orthographic views (Top/Front/Side) | ✅ | Alt+G/H/J/K shipped (v0.22): pseudo-ortho, pan-only nav, auto-wireframe, dark background. Bottom/Back/Left variants + zoom-to-cursor = polish |
| Viewport layouts (quad view, maximize/restore) | ✅ | v0.45: 2×2 scissor panes (Perspective/Top/Front/Side), maximize/restore, per-pane camera + gizmo focus (`viewportLayout.ts`) |
| F11 immersive viewport | ✅ | — (v0.21) |
| Game View (G) | ✅ | — |
| Camera bookmarks | ◐ | Shipped as Shift+0-9 set / 0-9 recall (Ctrl+digits is browser-reserved); persist bookmarks in the level file |
| Pilot Actor + eject banner | ✅ | Move banner top-left per UE; letterbox preview when piloting a Camera |
| Frame Selected (F) sets orbit pivot; Alt+LMB orbit / Alt+RMB dolly | ✅ | Alt+RMB dolly shipped (v0.21); Alt+MMB track = polish |
| Content Drawer (Ctrl+Space, auto-collapse, Dock in Layout) | ✅ | v0.47: 📌 Dock in Layout pin, color-coded type stripes, right-click Rename (F2) / Duplicate on materials, MetaSounds, prefabs, imports |
| Details: Search box + categories + reset-to-default arrows | ✅ | Arrows shipped on material fields (v0.23) — extend to light/physics fields; right-click Copy/Paste; multi-select "Multiple Values"; panel lock |
| Outliner: tree, Type column, eyes, search + operators, drag-attach, folders | ✅ | `-`/`+` operators shipped (v0.21); pin column + full right-click menu = polish |
| Main toolbar exact order (Save → Modes → Add → Blueprints → Cinematics → Play cluster → Platforms → Settings) | ◐ | Reorder ours to match; add **Modes dropdown** (Select/Landscape/Foliage/Paint as modes rather than toggle buttons); Quick Settings six-group dropdown |
| Bottom status bar: drawer button + Cmd console + save status | ◐ | Cmd field shipped; add Content Drawer button + autosave/save-status indicator |
| Place Actors panel (Recently Placed/Basic/Lights/Shapes/Cinematic/VFX/Volumes + search) | ✅ | Add "All Classes" category |
| Editor Preferences | ✅ | v0.30: Edit → Editor Preferences modal — invert look Y, camera speed, autosave interval (localStorage) |
| Keyboard shortcut editor (rebindable) | ✅ | v0.46: `ShortcutEditor` modal — 25 bindings, localStorage overrides, Edit → Editor Preferences → Keyboard Shortcuts… |
| Multiple Outliner/Details/Content instances (up to 4) | 🚫 | Single-instance panels are fine for web v1 |

## 2. Programming & Scripting (Blueprints)

| UE 5.7 feature | Status | What needs to be done |
|---|---|---|
| Blueprint exec-pin graph (Events/Actions/Flow) → runs in game | ✅ | — (compiles to the script slot) |
| **Data pins** (lazy-pulled through pure nodes) | ✅ | v0.26: pure Data nodes (Number/Get Variable/Time/Random/DistanceToPlayer/Add/Multiply/Sine) wire into ◦ data inputs on actions (MoveBy xyz, Delay, SetVariable); expressions inline at compile. Typed pins + auto-conversion = polish |
| Variables (get/set) | ✅ | v0.26: + Variable strip, Get Variable (pure) + Set Variable (action, data-wireable), Branch 'variable >' condition |
| Functions / Macros (subgraphs) | ✅ | v0.40: Collapse to Function (⊟), CallFunction inlined at compile; edit subgraphs in BP editor |
| Flow nodes: ForLoop, DoOnce, FlipFlop | ✅ | Shipped (v0.24, runtime-verified). Gate/MultiGate/Switch = next |
| Event Dispatchers / BP Interfaces | ◐ | Signals (api.emit/on) cover the runtime; add Bind/Call BP nodes |
| Construction Script (runs on edit-time placement) | ✅ | v0.33: onConstruct() via runConstructScript on AddActorCommand + gizmo release |
| Blueprint debugger (exec pulse visualization, breakpoints) | ✅ | v0.33: __bpPulse wire highlights during Play (breakpoints = polish) |
| Level Blueprint | ✅ | v0.33: Level BP button spawns LevelScript Empty actor convention |
| Per-actor JS scripting (our GDScript analog) | ✅ | — |
| @export vars → Details widgets | ✅ | Add @export_range slider / @export_enum dropdown variants |

## 3. Designing Visuals, Rendering & Graphics

| UE 5.7 feature | Status | What needs to be done |
|---|---|---|
| Material node editor | ◐ | v0.44: GPU `onBeforeCompile` mode — UV, TextureSample, Fresnel, Noise + live preview sphere; CPU graph + material assets/instances ✅ v0.34. WPO node = next |
| Material instances + parameters | ✅ | v0.34: MaterialAsset library + per-actor materialAssetId/overrides in Details |
| Post-process volumes (blend radius, priority) | ✅ | Add vignette, color grading (lift/gamma/gain), DOF to the override set |
| Sky atmosphere + sun binding | ✅ | Volumetric clouds 🚫 (billboard/raymarch-lite later) |
| Exponential height fog | ◐ | FogExp2 shipped; height-falloff variant via shader |
| Lumen (dynamic GI) | 🚫 | Approximate: SSAO pass + env probes (probes ✅); label honestly |
| Nanite | 🚫 | meshoptimizer LOD chains + BatchedMesh when three.js lands virtual geometry |
| Lightmass baking | ⏳ | Stretch: three-gpu-pathtracer AO/lightmap bake to second UV set |
| Reflection captures | ✅ | Add box projection + auto re-bake on Build |
| TSR / anti-aliasing | ◐ | r.ScreenPercentage wired to render targets (v0.21); FXAA pass = polish |
| View modes: Lit/Unlit/Wireframe/Detail | ✅ | Add Buffer Visualization (World Normal / Depth / Base Color) via MeshNormalMaterial & depth override |
| Light types | ✅ | RectLight shipped (v0.21) |
| Path tracer mode | ✅ | v0.49: `pathtraced` view mode + `r.PathTracer` cvar; `WebGLPathTracer` progressive samples (single-pane perspective) |
| HDRI backdrop | ✅ | v0.30: Import HDRI… tile — .hdr → PMREM environment + background, replaces sky, serialized in level |

## 4. Building Virtual Worlds

| UE 5.7 feature | Status | What needs to be done |
|---|---|---|
| Landscape sculpt (Raise/Lower/Smooth/Flatten) | ✅ | Add Ramp + Noise brushes; Erosion = stretch |
| Landscape paint layers | ✅ | Texture-based splat (vs vertex color) when texture import lands |
| Foliage painting | ✅ | Slope/height filters; multi-type painting in one stroke |
| Water system | ✅ | v0.32: Water actor — animated Gerstner-lite surface, size/color/wave props, serialized (verified vertex animation) |
| World Partition / streaming | ✅ | v0.53: grid-chunked `streamCell` load/unload around camera, `show streaming` overlay, `api.loadCell`, export-by-cell; cull-distance still per-actor |
| Level instances (nested prefabs) | ◐ | v0.35: prefabSource/prefabOverrides + per-field revert (⟲). Nested prefab-in-prefab = upgrade |
| PCG (sample→filter→spawn) | ✅ | v0.32: PCG Scatter volume — seeded jittered-grid sampling, surface raycast + slope filter, scale/rotation jitter + normal alignment, live regen, deterministic (verified 24 instances). Full node-graph editor = v2 |
| Modeling mode (CSG/booleans) | ◐ | Union/Subtract/Intersect shipped; add Mirror, Merge, meshopt Simplify; poly editing 🚫 v1 |
| Fracture mode | ◐ | Breakable shatter shipped (8 fragments); Voronoi pre-fracture = upgrade |
| GridMap blockout | ✅ | Mesh-library palettes (multiple tile types per layer) |
| Geometry brushes (BSP) | 🚫 | CSG covers the use case |

## 5. Creating Effects (Niagara)

| UE 5.7 feature | Status | What needs to be done |
|---|---|---|
| Emitter + params (rate/burst/shapes/velocity/gravity/drag/color & size over life) | ✅ | — |
| Module *stack* UI | ✅ | v0.27: Spawn/Shape/Velocity/Forces/ColorOverLife/SizeOverLife/Renderer cards with enable toggles, sim-respected (A/B verified: 4.0m vs 0.4m rise) |
| Curve-driven params (color ramp / size curve widgets) | ◐ | v0.42: 4-stop color gradient widget in Details; graphical size curve + Sequencer-shared widgets = polish |
| Ribbon / mesh renderers | ◐ | v0.42: ribbon trail strip renderer; InstancedMesh mesh renderer = next |
| GPU sim | 🚫 | WebGPU compute later; CPU ≤5k fine |
| Sub-emitters / events / collision | ◐ | v0.42: ground-bounce via heightfield lookup; sub-emitters/events = next |

## 6. Animating Characters & Objects

| UE 5.7 feature | Status | What needs to be done |
|---|---|---|
| Sequencer: transform tracks + keys + scrub + autoplay | ✅ | — |
| Property tracks (key ANY property) | ✅ | v0.25: visible/color/opacity/emissiveIntensity/intensity/fov + transform; + Property dropdown in toolbar |
| Curve editor / per-key interpolation | ✅ | v0.48: bezier interp (⌇) + `CurveEditor` with draggable in/out tangent handles; linear ◆ / smooth ● / step ■ shipped v0.25 |
| Camera Cut track | ✅ | v0.25: 🎬 Cut keys on the ruler, drives setViewCamera in PIE |
| Event/visibility tracks | ✅ | v0.25: ⚡ Event keys emit signals (scripts subscribe via api.on); visibility is a property track. Audio keys = wire signal → playSound in a script |
| glTF clip playback + crossfade | ✅ | — |
| Anim state machine editor (FSM graph) | ◐ | v0.38: AnimStateEditor tab — draggable states + transition arrows; full AnimGraph polish = next |
| Blend spaces 1D/2D | ✅ | v0.38: 1D lerp weights; v0.50: 2D Delaunay triangulation + barycentric blend in `AnimStateEditor` Blend 2D tab |
| Control Rig / IK | ⏳ | Two-bone IK + LookAt on glTF skeletons; rig graphs 🚫 |
| Retargeting / Motion Matching | 🚫 | — |
| Take Recorder | ✅ | v0.31: ⏺ Take arms 10Hz transform sampling of the selected actor during Play → sequencer keys (verified 15 keys) |
| Movie Render Queue | ✅ | v0.31: 🎥 Render plays the timeline once and exports a .webm of the viewport (verified 507KB capture) |

## 7. Gameplay Systems

| UE 5.7 feature | Status | What needs to be done |
|---|---|---|
| GameMode / pawn possession / PlayerStart | ✅ | GameMode asset (default pawn class picker) in World Settings |
| Pawn types: fly / first / third / vehicle | ✅ | Raycast-suspension vehicle = upgrade |
| Enhanced Input (actions, rebind, hold) | ✅ | v0.28: api.actionHeldTime (Hold trigger). Mapping-context stacks + gamepad = polish |
| Behavior Trees + Blackboard | ✅ | Graph editor UI + live execution highlight = upgrade |
| Navmesh + pathfinding | ✅ | v0.36: Recast WASM bake + show navmesh + api.findPath polygon paths; grid A* fallback; crowd avoidance = upgrade |
| EQS | ✅ | v0.28: api.queryBestPoint (ring generator, far/near-player + near-point scoring) |
| AI Perception (sight) | ✅ | v0.28: api.canSeePlayer (FOV cone + occlusion raycast) |
| Physics: rigid bodies, mobility gate, trimesh terrain | ✅ | Physics layers/masks matrix; joints as actor links |
| Collision layers/masks | ✅ | v0.28: per-actor Layer 0-7 + collides-with bitmask buttons → Rapier groups (verified: filtered ball fell through ground) |
| Destruction | ✅ (lite) | Voronoi fracture, strain propagation = upgrade |
| Gameplay Ability System | ◐ | v0.42: GAS-lite — attribute sets + abilities (cooldown/cost/tags) + api.activateAbility; effect stacks = next |
| Gameplay Tags (hierarchical) | ✅ | v0.28: 'Enemy.Boss' prefix-matches 'Enemy.Boss.Fire' in getActorsByTag |
| Data tables / curve assets | ◐ | JSON tables shipped; grid editor UI + curve assets |
| Networking / replication | ◐ | v0.51: host authority, property sync @ 10 Hz (Details Network checklist), Sync Spawn/despawn over relay; pawn co-presence ✅. Ownership + prediction = polish |

## 8. Audio

| UE 5.7 feature | Status | What needs to be done |
|---|---|---|
| Sound playback + distance attenuation + buses | ✅ | v0.39: HRTF PannerNode spatialization + bus mixer (replaces manual falloff) |
| MetaSounds (procedural node graph) | ✅ | v0.39: MetaSoundEditor — Osc/Gain/Filter/ADSR/Noise/Buffer → WebAudio; api.playMetaSound + SoundEmitter actor |
| Attenuation curve shapes / reverb zones | ◐ | v0.39: ConvolverNode reverb zones via TriggerVolume preset; falloff curve picker = polish |
| Sequencer audio scrubbing | ⏳ | After audio tracks land |

## 9. UI (UMG)

| UE 5.7 feature | Status | What needs to be done |
|---|---|---|
| HUD runtime (text/bars via api.hud) | ✅ | — |
| Widget designer (anchors, authored widgets) | ✅ | v0.29: HUD Widgets section — text/bar/button rows with anchor/color/signal, serialized in levels, rendered at Play. Drag-drop canvas layout = polish |
| Buttons/interaction routing into scripts | ✅ | v0.29: button widgets emit signals on click; scripts subscribe via api.on (verified) |
| Widget animations | ✅ | v0.52: Sequencer HUD tracks — opacity/left/top/width/color keys on authored widgets; `applyHudCssProperty` at scrub/play |
| 3D world-space widgets | ⏳ | CSS3DRenderer or render-to-texture plane |

## 10. Testing & Optimization

| UE 5.7 feature | Status | What needs to be done |
|---|---|---|
| Console (`, Cmd field, stat commands, cvars, autocomplete) | ✅ | v0.30: UE commands in Tab-completion; screen percentage scales targets (v0.21) |
| Profiler (FPS/tick/render graphs, draw calls) | ✅ | v0.37: per-actor tick breakdown bars in Debug Monitors during Play |
| PIE: pause / frame-step / eject / possess | ✅ | "Click for Mouse Control" + "Shift+F1 for cursor" overlay text; Alt+P play hotkey |
| Simulate / Play From Here / Keep Sim Changes | ✅ | — |
| Collision/navmesh debug draw (`show collision`) | ✅ | Wireframe outlines shipped (v0.21) |
| Automated smoke tests (Playwright) | ✅ | v0.54: `npm run test` — 5 specs (build, editor load, vektra bridge, terminal spawn, viewport WebGL + FPS stats) |

## 11. Sharing & Releasing

| UE 5.7 feature | Status | What needs to be done |
|---|---|---|
| Packaging/export | ✅ | v0.40: multi-level export (`__VEKTRA_LEVELS__` + api.loadLevel) + PWA manifest option + mobile/desktop quality presets |
| Platforms menu | 🚫 | Web is the platform |

## 12. Editor Extensibility

| UE 5.7 feature | Status | What needs to be done |
|---|---|---|
| Plugins | ✅ | v0.41: full Plugin API — registerNodeType/registerPanel/importers/consoleCommands + Plugin Manager + drag-drop install |
| Command palette | ✅ | (UE has Ctrl+P open-asset; ours is Ctrl+Shift+P commands — add asset search to it) |
| Project Settings | ◐ | World Settings covers level scope; add project-scope settings modal |
| AI copilot (no UE equivalent) | ✅ | Our differentiator — keep feeding it every new command |

---

## Priority queue (next 10, by recognition × effort)

1. ~~Blueprint completion~~ ✅ v0.33 (onConstruct, exec pulse, Level BP)
2. ~~Material assets + instances~~ ✅ v0.34
3. ~~Recast navmesh~~ ✅ v0.36
4. ~~Live debugger + tick profiler~~ ✅ v0.37
5. ~~FSM editor + 1D/2D blend space~~ ✅ v0.38 + v0.50
6. ~~MetaSounds-lite~~ ✅ v0.39
7. ~~Multi-level export + PWA~~ ✅ v0.40
8. ~~Plugin API + GAS-lite + BP functions~~ ✅ v0.40–v0.42
9. ~~Material editor v2~~ ◐ v0.44 (GPU nodes + preview sphere; WPO = next)
10. ~~Viewport quad layouts + shortcut editor + Content Drawer dock + bezier curves~~ ✅ v0.45–v0.48
11. ~~Path tracer + blend2D + MP sync + widget anims + streaming + Playwright~~ ✅ v0.49–v0.54
12. **Two-bone IK + LookAt** on glTF skeletons
13. **Particles P3** — InstancedMesh renderer, graphical size curves, sub-emitters
14. **GAS effect stacks** + toolbar Modes dropdown + camera bookmarks persist

*Update this file as items ship — it is the working successor to ROADMAP.md (which records the completed 34-task arc).*
