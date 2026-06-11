# UE 5.7 Documentation → Vektra Engine Gap List

> The complete worklist: every area of the official UE 5.7 documentation
> (dev.epicgames.com/documentation/unreal-engine/unreal-engine-5-7-documentation)
> mapped against what Vektra Engine has as of v0.20.
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
| Viewport layouts (quad view, maximize/restore) | ⏳ | Fake with 4 cameras + scissor viewports on one canvas; lower priority |
| F11 immersive viewport | ✅ | — (v0.21) |
| Game View (G) | ✅ | — |
| Camera bookmarks | ◐ | Shipped as Shift+0-9 set / 0-9 recall (Ctrl+digits is browser-reserved); persist bookmarks in the level file |
| Pilot Actor + eject banner | ✅ | Move banner top-left per UE; letterbox preview when piloting a Camera |
| Frame Selected (F) sets orbit pivot; Alt+LMB orbit / Alt+RMB dolly | ✅ | Alt+RMB dolly shipped (v0.21); Alt+MMB track = polish |
| Content Drawer (Ctrl+Space, auto-collapse, Dock in Layout) | ◐ | Summon + auto-collapse shipped; **add "Dock in Layout" pin button**; color-coded type stripes on tiles; asset right-click menu (Rename F2, Duplicate) |
| Details: Search box + categories + reset-to-default arrows | ✅ | Arrows shipped on material fields (v0.23) — extend to light/physics fields; right-click Copy/Paste; multi-select "Multiple Values"; panel lock |
| Outliner: tree, Type column, eyes, search + operators, drag-attach, folders | ✅ | `-`/`+` operators shipped (v0.21); pin column + full right-click menu = polish |
| Main toolbar exact order (Save → Modes → Add → Blueprints → Cinematics → Play cluster → Platforms → Settings) | ◐ | Reorder ours to match; add **Modes dropdown** (Select/Landscape/Foliage/Paint as modes rather than toggle buttons); Quick Settings six-group dropdown |
| Bottom status bar: drawer button + Cmd console + save status | ◐ | Cmd field shipped; add Content Drawer button + autosave/save-status indicator |
| Place Actors panel (Recently Placed/Basic/Lights/Shapes/Cinematic/VFX/Volumes + search) | ✅ | Add "All Classes" category |
| Editor Preferences (camera speed/invert, autosave frequency + warning toast, snap preset arrays) | ⏳ | Single Preferences modal; persist in localStorage |
| Keyboard shortcut editor (rebindable) | ⏳ | Reuse Input Map UI pattern for editor hotkeys |
| Multiple Outliner/Details/Content instances (up to 4) | 🚫 | Single-instance panels are fine for web v1 |

## 2. Programming & Scripting (Blueprints)

| UE 5.7 feature | Status | What needs to be done |
|---|---|---|
| Blueprint exec-pin graph (Events/Actions/Flow) → runs in game | ✅ | — (compiles to the script slot) |
| **Data pins** (lazy-pulled through pure nodes) | ✅ | v0.26: pure Data nodes (Number/Get Variable/Time/Random/DistanceToPlayer/Add/Multiply/Sine) wire into ◦ data inputs on actions (MoveBy xyz, Delay, SetVariable); expressions inline at compile. Typed pins + auto-conversion = polish |
| Variables (get/set) | ✅ | v0.26: + Variable strip, Get Variable (pure) + Set Variable (action, data-wireable), Branch 'variable >' condition |
| Functions / Macros (subgraphs) | ⏳ | Collapse selection to subgraph; inline at compile |
| Flow nodes: ForLoop, DoOnce, FlipFlop | ✅ | Shipped (v0.24, runtime-verified). Gate/MultiGate/Switch = next |
| Event Dispatchers / BP Interfaces | ◐ | Signals (api.emit/on) cover the runtime; add Bind/Call BP nodes |
| Construction Script (runs on edit-time placement) | ⏳ | onConstruct hook evaluated in-editor when actor is placed/moved |
| Blueprint debugger (exec pulse visualization, breakpoints) | ⏳ | Animate wire highlights during play; huge perceived quality |
| Level Blueprint | ⏳ | One world-level blueprint (no actor) — trivially: a hidden Empty actor convention or world.blueprint slot |
| Per-actor JS scripting (our GDScript analog) | ✅ | — |
| @export vars → Details widgets | ✅ | Add @export_range slider / @export_enum dropdown variants |

## 3. Designing Visuals, Rendering & Graphics

| UE 5.7 feature | Status | What needs to be done |
|---|---|---|
| Material node editor | ◐ | CPU property-graph shipped (Color/Scalar/Time/Sine/Pulse/Mul/Add/Lerp). **Upgrade: per-pixel via TSL/onBeforeCompile** — TextureSample, UV, Fresnel, Noise, WPO; live preview sphere; material *assets* shared across actors with per-instance parameters |
| Material instances + parameters | ⏳ | Material as named asset; instances override scalar/vector params |
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
| Path tracer mode | ⏳ | three-gpu-pathtracer toggle; flagship screenshot feature |
| HDRI backdrop | ⏳ | Equirect HDR import → environment + background |

## 4. Building Virtual Worlds

| UE 5.7 feature | Status | What needs to be done |
|---|---|---|
| Landscape sculpt (Raise/Lower/Smooth/Flatten) | ✅ | Add Ramp + Noise brushes; Erosion = stretch |
| Landscape paint layers | ✅ | Texture-based splat (vs vertex color) when texture import lands |
| Foliage painting | ✅ | Slope/height filters; multi-type painting in one stroke |
| Water system | ⏳ | Single ocean/lake plane with Gerstner waves actor |
| World Partition / streaming | ◐ | Cull-distance streaming shipped; grid-chunked auto load/unload around camera = upgrade |
| Level instances (nested prefabs) | ◐ | Prefabs ✅; nested prefab-in-prefab + per-instance overrides (Godot editable children) = upgrade |
| PCG graph | ⏳ | 10-node subset: sample surface → filter density/slope → transform → spawn InstancedMesh, live regen |
| Modeling mode (CSG/booleans) | ◐ | Union/Subtract/Intersect shipped; add Mirror, Merge, meshopt Simplify; poly editing 🚫 v1 |
| Fracture mode | ◐ | Breakable shatter shipped (8 fragments); Voronoi pre-fracture = upgrade |
| GridMap blockout | ✅ | Mesh-library palettes (multiple tile types per layer) |
| Geometry brushes (BSP) | 🚫 | CSG covers the use case |

## 5. Creating Effects (Niagara)

| UE 5.7 feature | Status | What needs to be done |
|---|---|---|
| Emitter + params (rate/burst/shapes/velocity/gravity/drag/color & size over life) | ✅ | — |
| Module *stack* UI | ✅ | v0.27: Spawn/Shape/Velocity/Forces/ColorOverLife/SizeOverLife/Renderer cards with enable toggles, sim-respected (A/B verified: 4.0m vs 0.4m rise) |
| Curve-driven params (color ramp / size curve widgets) | ⏳ | Reusable gradient + curve widgets (shared with Sequencer) |
| Ribbon / mesh renderers | ⏳ | Trail ribbons (Line2/strip), InstancedMesh renderer |
| GPU sim | 🚫 | WebGPU compute later; CPU ≤5k fine |
| Sub-emitters / events / collision | ⏳ | Particle ground-bounce via heightfield lookup = cheap win |

## 6. Animating Characters & Objects

| UE 5.7 feature | Status | What needs to be done |
|---|---|---|
| Sequencer: transform tracks + keys + scrub + autoplay | ✅ | — |
| Property tracks (key ANY property) | ✅ | v0.25: visible/color/opacity/emissiveIntensity/intensity/fov + transform; + Property dropdown in toolbar |
| Curve editor / per-key interpolation | ◐ | Per-key interp shipped v0.25 (linear ◆ / smooth ● / step ■, Shift+click cycles). Graphical bezier-tangent editor = remaining polish |
| Camera Cut track | ✅ | v0.25: 🎬 Cut keys on the ruler, drives setViewCamera in PIE |
| Event/visibility tracks | ✅ | v0.25: ⚡ Event keys emit signals (scripts subscribe via api.on); visibility is a property track. Audio keys = wire signal → playSound in a script |
| glTF clip playback + crossfade | ✅ | — |
| Anim state machine editor (FSM graph) | ⏳ | Graph UI over the existing crossfade primitive |
| Blend spaces 1D/2D | ⏳ | 1D lerp weights (easy); 2D triangulation |
| Control Rig / IK | ⏳ | Two-bone IK + LookAt on glTF skeletons; rig graphs 🚫 |
| Retargeting / Motion Matching | 🚫 | — |
| Take Recorder | ⏳ | Record live actor motion into Sequencer tracks while playing |
| Movie Render Queue | ⏳ | WebCodecs MP4/WebM capture of Sequencer playback — very web-friendly win |

## 7. Gameplay Systems

| UE 5.7 feature | Status | What needs to be done |
|---|---|---|
| GameMode / pawn possession / PlayerStart | ✅ | GameMode asset (default pawn class picker) in World Settings |
| Pawn types: fly / first / third / vehicle | ✅ | Raycast-suspension vehicle = upgrade |
| Enhanced Input (actions, rebind) | ◐ | Actions + rebind shipped; add mapping contexts (priority stacks), hold/tap triggers, gamepad axes |
| Behavior Trees + Blackboard | ✅ | Graph editor UI + live execution highlight = upgrade |
| Navmesh + pathfinding | ◐ | Grid A* shipped; recast-navigation-js polygon navmesh + crowd avoidance = upgrade |
| EQS | ⏳ | Point generator + scoring with debug spheres |
| AI Perception (sight cones) | ⏳ | Cone + raycast sight check helper in api |
| Physics: rigid bodies, mobility gate, trimesh terrain | ✅ | Physics layers/masks matrix; joints as actor links |
| Collision presets (Block/Overlap/Ignore matrix) | ⏳ | Rapier collision groups + named-layer settings UI |
| Destruction | ✅ (lite) | Voronoi fracture, strain propagation = upgrade |
| Gameplay Ability System | ⏳ | Simplified: attributes + abilities with cooldown/cost + effect stacks over tags (tags ✅) |
| Gameplay Tags (hierarchical) | ◐ | Flat tags shipped; dot-notation hierarchy + match queries |
| Data tables / curve assets | ◐ | JSON tables shipped; grid editor UI + curve assets |
| Networking / replication | ◐ | Pawn co-presence relay shipped; per-actor property replication checklist (Synchronizer), spawner replication, ownership |

## 8. Audio

| UE 5.7 feature | Status | What needs to be done |
|---|---|---|
| Sound playback + distance attenuation + buses | ✅ | True PannerNode spatialization (THREE.PositionalAudio) instead of manual falloff |
| MetaSounds (procedural node graph) | ⏳ | WebAudio IS a node graph — node editor → AudioNode topology; near-1:1 |
| Attenuation curve shapes / reverb zones | ⏳ | Falloff picker; ConvolverNode reverb send per TriggerVolume |
| Sequencer audio scrubbing | ⏳ | After audio tracks land |

## 9. UI (UMG)

| UE 5.7 feature | Status | What needs to be done |
|---|---|---|
| HUD runtime (text/bars via api.hud) | ✅ | — |
| Widget *designer* (drag-drop hierarchy, anchors) | ⏳ | Visual editor over DOM widgets; anchors→CSS — the browser is the UI engine |
| Buttons/interaction routing into scripts | ⏳ | api.hud.button(id, label, onClick) + pointer-unlock interplay |
| Widget animations | ⏳ | Reuse Sequencer on DOM properties |
| 3D world-space widgets | ⏳ | CSS3DRenderer or render-to-texture plane |

## 10. Testing & Optimization

| UE 5.7 feature | Status | What needs to be done |
|---|---|---|
| Console (`, Cmd field, stat fps/unit, slomo, t.MaxFPS, r.ScreenPercentage) | ✅ | Autocomplete popup with arrow-key navigation; `cvar ?` help; r.ScreenPercentage → actually scale render targets |
| Profiler (FPS/tick/render graphs, draw calls) | ✅ | Per-actor tick timings (flame list) = upgrade |
| PIE: pause / frame-step / eject / possess | ✅ | "Click for Mouse Control" + "Shift+F1 for cursor" overlay text; Alt+P play hotkey |
| Simulate / Play From Here / Keep Sim Changes | ✅ | — |
| Collision/navmesh debug draw (`show collision`) | ✅ | Wireframe outlines shipped (v0.21) |

## 11. Sharing & Releasing

| UE 5.7 feature | Status | What needs to be done |
|---|---|---|
| Packaging/export | ✅ | 22 KB playable HTML beats UE here. Add: PWA manifest option, share-to-URL host integration, multi-level export (scene switching) |
| Platforms menu | 🚫 | Web is the platform |

## 12. Editor Extensibility

| UE 5.7 feature | Status | What needs to be done |
|---|---|---|
| Plugins | ✅ | Plugin API surface: register nodeTypes/panels/importers (commands shipped) |
| Command palette | ✅ | (UE has Ctrl+P open-asset; ours is Ctrl+Shift+P commands — add asset search to it) |
| Project Settings | ◐ | World Settings covers level scope; add project-scope settings modal |
| AI copilot (no UE equivalent) | ✅ | Our differentiator — keep feeding it every new command |

---

## Priority queue (next 10, by recognition × effort)

1. ~~Fix hotkey order~~ ✅ v0.21
2. ~~Ortho views~~ ✅ v0.22
3. ~~Details reset-to-default arrows~~ ✅ v0.23 (right-click property menu remains)
4. **Material editor v2** — per-pixel TSL nodes (TextureSample/UV/Fresnel/Noise) + material assets with instances
5. **Sequencer phase 2** — property tracks + camera-cut track + curve editor
6. **Niagara module-stack UI** + curve/gradient widgets (shared with Sequencer)
7. **Blueprint data pins** + variables + ForLoop/Gate/FlipFlow nodes + exec pulse debugging
8. **Surface snapping** (rotate-to-normal placement) + outliner search operators + full right-click menu
9. **UMG widget designer** over the DOM HUD
10. **Movie Render Queue** — WebCodecs video export of Sequencer playback (web-native flex)

*Update this file as items ship — it is the working successor to ROADMAP.md (which records the completed 34-task arc).*
