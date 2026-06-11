# UE5 Editor Tool Census

> Subagent research verified against dev.epicgames.com "Tools and Editors in
> Unreal Engine" + 5.6/5.7 release notes. Feasibility scoped to a Three.js
> browser editor. This census seeded the 34-task roadmap (see ROADMAP.md).
> Format: NAME | essence | feasibility | minimal-viable web remake.

## 1. Scripting — Blueprints

The model, precisely: a Blueprint graph has two pin systems. **Exec pins** (white triangles) define control flow — execution enters a node at its input exec pin, the node runs, then execution leaves via exactly one output exec pin; only "impure" nodes have them. **Data pins** (colored circles, typed: bool/int/float/string/vector/object/struct…) are pulled lazily — when an impure node executes, it evaluates its input data pins by walking *backwards* through connected pure nodes (no exec pins, e.g. math, getters), which re-evaluate on every pull. One output data pin fans out to many inputs; one input accepts only one connection; exec is the reverse (one out→one in, many in→one entry). Type-mismatched connections auto-insert conversion nodes. That dual-graph (eager control flow + lazy dataflow) is the thing to remake exactly.

- BLUEPRINT EVENT NODES | Entry points fired by engine/game (BeginPlay, Tick, OnOverlap, input events, custom events, timers) with exec-out only | TRIVIAL | dispatch JS event bus into graph interpreter entry nodes.
- FLOW CONTROL NODES | Branch, Sequence, ForLoop/ForEach, WhileLoop, Gate, DoOnce, DoN, FlipFlop, MultiGate, Switch-on-int/enum/string, Delay (latent) | FEASIBLE | interpreter with async continuation for Delay; rest is trivial branching.
- VARIABLE NODES | Typed get/set with instance-editable, replication, category metadata; struct break/make | TRIVIAL | typed variable store + auto-generated getter/setter nodes.
- FUNCTION NODES | Callable subgraphs with single exec path, local variables, pure-function option, inputs/outputs | FEASIBLE | subgraph call with own frame; pure = no exec pins, memoize per pull.
- MACRO NODES | Inline-expanded subgraphs allowing multiple exec inputs/outputs (how Gate/ForLoop are built) | FEASIBLE | graph inlining pass at compile time.
- EVENT DISPATCHERS / INTERFACES | Multicast delegates (Bind/Call) and blueprint interfaces for decoupled messaging | FEASIBLE | observer pattern + duck-typed interface table.
- BLUEPRINT CLASSES & COMPONENTS | Actor BP = component tree + graphs + construction script (runs on edit-time placement) | FEASIBLE | prefab system with attached script-graph and edit-time construction hook.
- BLUEPRINT DEBUGGER | Breakpoints, exec-flow pulse visualization, watch values | FEASIBLE | step interpreter + animate wire highlights; huge perceived-quality win.

## 2. Materials

- MATERIAL EDITOR NODE GRAPH | Pure dataflow graph (no exec pins) compiling to shader: expression nodes (Texture Sample, Multiply, Lerp, Fresnel, Time, UV, Noise) feeding fixed result pins (BaseColor, Metallic, Roughness, Normal, Emissive, Opacity, WPO) with live preview sphere | FEASIBLE | transpile node graph to GLSL injected into MeshStandardMaterial via onBeforeCompile or TSL node materials (three.js NodeMaterial is a near-1:1 target).
- MATERIAL INSTANCES & PARAMETERS | Scalar/Vector/Texture parameters overridable per-instance without recompile | TRIVIAL | uniforms exposed as editable instance fields.
- MATERIAL FUNCTIONS | Reusable subgraphs with inputs/outputs | FEASIBLE | subgraph inlining like BP macros.
- MATERIAL LAYERS / BLENDS | Stackable material layers blended by masks | HARD | skip initially; fake with a 2-layer lerp node.
- SUBSTRATE (next-gen material model) | Physically-layered slab-based shading | INFEASIBLE-IN-BROWSER | not worth it; standard PBR covers the look.

## 3. VFX — Niagara

- NIAGARA SYSTEM/EMITTER/MODULE MODEL | A System contains Emitters; each Emitter is a stack of stages (Emitter Spawn/Update, Particle Spawn/Update, Render) and each stage holds reorderable Modules (scripts) writing to a shared parameter namespace (Particles.Position, Particles.Lifetime…) | FEASIBLE | stacked-module editor over a GPU/CPU particle sim writing to instanced buffer attributes — this architecture is the remake, not any single effect.
- KEY MODULES/PARAMS | Spawn Rate & Spawn Burst (particles/sec, count), Initialize Particle (lifetime, initial size/color/mass), Add Velocity (linear/cone/from point), Gravity & Drag forces, Curl Noise force, Color over Life & Scale over Life (curve-driven), shape Location modules (sphere/box/mesh surface) | FEASIBLE | each module = JS function over particle SoA arrays; curves via editable Catmull-Rom curve widget.
- RENDERERS | Sprite, Ribbon, Mesh, Light renderers | FEASIBLE | instanced quads (sprite), MeshLine-style strips (ribbon), InstancedMesh (mesh); skip light renderer.
- GPU SIM & EVENTS/COLLISION | GPU compute emitters, particle events, scene-depth collision | HARD | WebGPU compute later; CPU sim for ≤50k particles first.

## 4. Cinematics — Sequencer

- SEQUENCER TIMELINE | Multi-track NLE: tracks bound to actors (Transform, property tracks, Animation, Camera Cut, Audio, Event, Visibility, Fade), keyframes with per-key interpolation (Cubic auto/user/break, Linear, Constant) edited in a Curve Editor with tangent handles | FEASIBLE | timeline UI + keyframe store evaluated per-frame onto scene properties; three.js AnimationMixer or custom evaluator; the curve editor with bezier tangents is the credibility core.
- CAMERA CUT TRACK | Switches active camera over time | TRIVIAL | track that swaps renderer camera.
- MOVIE RENDER QUEUE / QUICK RENDER | Offline high-quality render to frames/video | FEASIBLE | render loop → CCapture/WebCodecs to MP4/WebM.
- TAKE RECORDER | Records live actor motion/property changes into Sequencer takes | FEASIBLE | sample scene state per frame into auto-created tracks.
- SEQUENCER SUBSEQUENCES/SHOTS | Nested sequences and shot tracks | FEASIBLE | timeline-in-timeline composition.

## 5. World building

- LANDSCAPE SCULPT | Heightmap terrain with brushes: Sculpt (raise/lower), Smooth (box-blur heights under brush), Flatten (drive toward sampled/target height), Ramp, Noise, Erosion (hydro/thermal), Retopologize; brush size/falloff/strength | FEASIBLE | PlaneGeometry or clipmap with height texture; brushes = falloff-weighted kernel ops on a Float32 heightfield, raycast brush cursor — raise/lower/smooth/flatten are a weekend, erosion is the stretch goal.
- LANDSCAPE PAINT LAYERS | Weight-blended material layers (grass/rock/dirt) painted as per-layer weightmaps | FEASIBLE | RGBA splatmap texture painted via canvas, 4-way texture blend in shader.
- FOLIAGE MODE | Brush-paints instanced meshes onto surfaces with density, scale/rotation jitter, slope/height filters, erase/reapply | FEASIBLE | raycast scatter into THREE.InstancedMesh with per-type settings panel; one of the highest wow-per-effort tools.
- WATER SYSTEM | Spline-defined rivers/lakes/ocean with waves | HARD | single ocean plane with Gerstner waves; skip splines.
- WORLD PARTITION | Auto grid-based level streaming, one-file-per-actor, data layers, HLOD | HARD | chunk scene JSON by grid cell, load/unload around camera; MVP = manual streaming volumes.
- LEVEL INSTANCES / PACKED LEVEL ACTORS | Reusable level-as-prefab | FEASIBLE | nested-scene prefabs.
- PCG GRAPH | Node graph sampling points (surface/spline/volume), filtering (density, height, slope), transforming, and spawning meshes/actors, regenerating live in-editor | HARD | point-pipeline node graph (sample→filter→transform→spawn InstancedMesh) with live regen; a 10-node subset is FEASIBLE and extremely impressive.

## 6. Modeling & geometry

- MODELING MODE | In-editor mesh toolset: primitives (Box/Sphere/Cyl), PolyEdit (extrude/inset/bevel/cut), Sculpt (vertex sculpting), Boolean, Merge, Mirror, Remesh/Simplify, UV editor, Bake maps | HARD overall, FEASIBLE subset | primitives + transform + CSG via three-bvh-csg + simplify via meshoptimizer; defer poly-editing and UV tools.
- GEOMETRY SCRIPT | Blueprint-callable runtime mesh generation API | FEASIBLE | expose BufferGeometry ops as script-graph nodes.
- FRACTURE MODE (Chaos) | Voronoi/cluster fracturing meshes into Geometry Collections for destruction | HARD | Voronoi-cell CSG pre-fracture + release pieces as rigid bodies on impact.
- STATIC MESH EDITOR | Per-asset viewer: LODs, collision primitives, sockets, UV inspect | FEASIBLE | asset inspector panel with LOD/collision/socket tabs.

## 7. Animation

- SKELETAL MESH / SKELETON EDITOR | Inspect bones, sockets, morph targets, physics asset binding | FEASIBLE | glTF SkinnedMesh inspector with bone tree + socket attach points.
- ANIMATION SEQUENCE EDITOR | Scrub clips, notifies (timed events), additive settings, root motion | FEASIBLE | clip viewer + notify track firing script events.
- BLEND SPACES | 1D/2D parameter space (e.g., speed×direction) interpolating between placed sample clips via triangulation | FEASIBLE | 2D canvas with draggable clip samples + barycentric blend of AnimationActions — small and very "UE5".
- ANIMATION BLUEPRINT / STATE MACHINES | AnimGraph with states (each playing/blending clips), transitions with boolean rules and crossfade durations, plus blend nodes (Layered blend per bone, Slot) | FEASIBLE | FSM editor driving AnimationMixer crossfades; per-bone layering is the hard 20%.
- CONTROL RIG | Node-based procedural rigging: rig graph drives bone transforms (IK chains, constraints), animatable in Sequencer | HARD | two-bone IK + LookAt nodes on glTF skeletons with viewport gizmo handles; full rig graphs later.
- IK RETARGETER / IK RIG | Map animations between different skeletons | HARD | chain-based retarget for mixamo↔glTF rigs; ship as importer feature not editor.
- MOTION MATCHING (Pose Search) | Database-driven animation selection from trajectory | INFEASIBLE-IN-BROWSER (practically) | skip; state machines cover it.
- MORPH TARGET SCULPTING (5.6) | Sculpt blendshapes in-editor | HARD | slider-driven morph target editing only.

## 8. Audio

- METASOUNDS | Sample-accurate procedural audio node graph (oscillators, wave players, envelopes, filters, math) replacing Sound Cues | FEASIBLE | node graph compiling to Web Audio API node topology — WebAudio is literally a node graph, near-1:1 mapping.
- SOUND ATTENUATION | Distance falloff curves, spatialization, inner/outer radius, occlusion, reverb send | TRIVIAL | THREE.PositionalAudio wraps WebAudio PannerNode (distance models built-in); add falloff-curve picker.
- SOUND CLASSES / SUBMIXES / MIXER | Bus routing, ducking, effects chains | FEASIBLE | GainNode bus tree + DynamicsCompressor ducking.
- AUDIO SCRUBBING IN SEQUENCER (5.6) | Hear audio while scrubbing timeline | FEASIBLE | granular playback of buffer at playhead.

## 9. AI

- BEHAVIOR TREE EDITOR | Tree graph of Composites (Selector/Sequence/Parallel), Tasks (leaves), Decorators (conditionals/aborts), Services (ticking), reading a Blackboard key-value store | FEASIBLE | BT interpreter + tree-layout graph editor + blackboard panel; visual execution highlighting sells it.
- BLACKBOARD | Typed shared key-value memory per agent | TRIVIAL | typed object with change notifications.
- NAVMESH (Recast) | Auto-generated walkable mesh + pathfinding, nav modifiers, nav links | FEASIBLE | recast-navigation-js (official Recast WASM port) gives bake + A* + crowd out of the box; debug-draw the navmesh.
- EQS (Environment Query System) | Generates points (grid/ring/donut), scores/filters by tests (distance, trace, dot) to pick best position | FEASIBLE | point generator + scoring pipeline with colored debug spheres.
- AI PERCEPTION | Sight/hearing stimulus system | FEASIBLE | cone + raycast sight checks, event-based hearing.
- SMART OBJECTS / STATE TREE | Newer interaction & hierarchical-FSM systems | HARD | defer; BT covers the category.
- MASS ENTITY (ECS crowds) | Data-oriented massive crowd sim | INFEASIBLE-IN-BROWSER at UE scale | boids-style InstancedMesh crowd demo if ever.

## 10. Physics — Chaos

- RIGID BODY PHYSICS | Simulation, constraints, physical materials (friction/restitution) | FEASIBLE | Rapier (WASM) or Jolt-js; physical material asset type.
- PHYSICS ASSET EDITOR | Authoring ragdoll bodies/constraints per bone | HARD | auto-generate capsules per bone + constraint tweaking panel.
- CHAOS DESTRUCTION | Geometry collections fracture hierarchically with strain thresholds and fields | HARD | pre-fractured pieces swapped in on impact, simulated as rigid bodies — convincing, not accurate.
- CHAOS CLOTH | Painted-weight cloth sim on skeletal meshes | HARD | position-based-dynamics cloth on flags/capes with paintable pin weights; skip character clothing.
- CHAOS VEHICLES | Wheeled vehicle component (engine curve, gears, suspension per wheel) | FEASIBLE | Rapier raycast-vehicle controller + tuning panel (torque curve, suspension travel).
- COLLISION SETTINGS / TRACING | Object channels, presets (Block/Overlap/Ignore matrix), line/sphere/box traces by channel | FEASIBLE | collision-groups matrix UI mapping to physics-engine groups + raycast API in script graph; unglamorous but load-bearing for "feels like UE".

## 11. Rendering & lighting

- LUMEN | Real-time dynamic GI + reflections | INFEASIBLE-IN-BROWSER (true Lumen) | approximate: three-gpu-pathtracer for "bake preview", SSAO+SSR+env-probe IBL at runtime; label it "dynamic GI (approx)".
- NANITE | Virtualized micropolygon geometry, no LODs needed | INFEASIBLE-IN-BROWSER (today) | meshoptimizer LOD chains + (WebGPU) two-pass occlusion culling; watch three.js BatchedMesh/virtual-geometry experiments.
- TSR / ANTI-ALIASING | Temporal super resolution upscaling | HARD | TAA pass + render-scale slider; FXAA/MSAA fallback.
- LIGHT TYPES & MOBILITY | Directional/Point/Spot/Rect lights, Static/Stationary/Movable | TRIVIAL | three.js lights + RectAreaLight, mobility flag gates baking.
- LIGHTMASS / GPU LIGHTMASS (light baking) | Offline bake of lightmaps for static lighting | HARD | bake AO/lightmaps in-browser via three-gpu-pathtracer to a second UV set — slow but real, and a flagship feature if shipped.
- REFLECTION CAPTURES | Sphere/box probes capturing local cubemaps, blended at runtime | FEASIBLE | CubeCamera probes baked on demand, assigned by proximity/box projection.
- POST-PROCESS VOLUMES | Box volumes (with blend radius/priority) overriding bloom, exposure, color grading, vignette, DOF, AO | FEASIBLE | EffectComposer + volume-triggered setting lerp; cheap and extremely visible.
- SKY ATMOSPHERE / VOLUMETRIC CLOUDS / FOG | Physical sky, exponential height fog, volumetrics | HARD | three.js Sky + height-fog shader + billboard/raymarched-lite clouds; full volumetrics no.
- VIRTUAL TEXTURING | Streaming megatextures | INFEASIBLE-IN-BROWSER mostly | KTX2/basis compressed streaming instead.
- HARDWARE RAY TRACING / PATH TRACER | Reference offline path-traced viewport | FEASIBLE (ironically) | three-gpu-pathtracer "Path Tracer mode" toggle.

## 12. UI — UMG

- UMG WIDGET DESIGNER | Drag-drop widget hierarchy (Canvas/Horizontal/Vertical/Grid/Overlay panels; Button/Text/Image/Slider/ProgressBar), anchors & alignment, with a graph for events and property bindings | FEASIBLE | DOM/HTML overlay designer — the browser IS a UI engine; anchors map to CSS, events route into the script graph; arguably easier than UE's.
- WIDGET ANIMATIONS | Timeline-keyed widget property animation | FEASIBLE | reuse Sequencer engine on CSS/DOM properties.
- 3D WIDGETS (Widget Component) | UI rendered in world space | FEASIBLE | render to texture or CSS3DRenderer plane.
- SLATE/EDITOR UTILITY WIDGETS | Build custom editor tool panels with UMG | FEASIBLE | user-defined editor panels from same designer — power-user catnip.

## 13. Gameplay frameworks

- GAMEPLAY ABILITY SYSTEM | Abilities (activation/cost/cooldown), Gameplay Attributes, Gameplay Effects (modifiers over duration), Gameplay Tags (hierarchical), cues | HARD | simplified: tag system + attribute set + ability assets with cooldown/cost + effect stacks; skip prediction/replication.
- ENHANCED INPUT | Input Actions (typed values) + Mapping Contexts (prioritized, swappable) + Modifiers (deadzone, negate, swizzle) + Triggers (pressed, hold, tap, chord) | FEASIBLE | action-map asset over KeyboardEvent/Gamepad API with modifier/trigger pipeline — direct port, high credibility.
- GAMEPLAY TAGS | Hierarchical dot-notation tag registry with queries | TRIVIAL | trie + match queries.
- DATA TABLES / DATA ASSETS / CURVE ASSETS | Struct-typed spreadsheet rows, typed config assets, float curves | TRIVIAL | JSON-schema asset types + table grid editor + curve editor reuse.
- STRUCTS / ENUMS (user-defined) | Custom value types usable as BP pins | FEASIBLE | schema editor feeding pin-type registry.

## 14. Cameras & cinematic capture

- CINECAMERA | Physical camera: filmback, focal length, aperture/DOF, focus tracking | FEASIBLE | PerspectiveCamera + bokeh DOF pass + focal-length↔FOV math + focus-actor picker.
- CAMERA RIGS (crane/rail) | Spline rail and crane mounts for camera moves | FEASIBLE | CatmullRom spline mount with Sequencer-keyed position.
- CAMERA SHAKES | Procedural perlin/oscillating shake assets | TRIVIAL | noise-driven camera offset asset.
- VARIANT MANAGER | Named configuration sets (swap visibility/materials/transforms) for product configurators | FEASIBLE | variant asset = property-override snapshots with thumbnail switcher.

## 15. Editor infrastructure

- LEVEL EDITOR (viewport, gizmos, outliner, details panel) | Place/transform actors, W/E/R gizmos, snapping, multi-select, play-in-editor | FEASIBLE | TransformControls + scene-tree + reflected property inspector + PIE button — table stakes and priority zero.
- CONTENT BROWSER | Asset registry: thumbnails, folders, search, drag-to-viewport, references | FEASIBLE | IndexedDB/OPFS asset store with thumbnail renderer and drag-drop.
- DETAILS PANEL / PROPERTY REFLECTION | Auto-generated editors for any object's typed properties | FEASIBLE | schema-driven inspector — multiplies every other feature.
- WORLD OUTLINER | Hierarchical actor list with folders, visibility, pinning | TRIVIAL | scene-graph tree view.
- LOD TOOLS | Auto-decimated LOD chains with screen-size thresholds | FEASIBLE | meshoptimizer-wasm simplification + THREE.LOD distances.
- LOCALIZATION DASHBOARD | Gather text, translate, count words, compile locale data | FEASIBLE | key-based string tables + locale JSON export, i18n picker.
- HLOD | Merged proxy meshes for distant clusters | HARD | merge+atlas distant chunks offline-in-browser.
- PLAY-IN-EDITOR / SIMULATE | Run game in viewport, eject, pause, possess | FEASIBLE | serialize scene → sandboxed runtime, restore on stop.
- UNDO/TRANSACTION SYSTEM | Everything undoable | FEASIBLE | command pattern everywhere from day one — retrofit is agony.
- FONT EDITOR | Import/preview font assets | TRIVIAL | FontFace upload + preview.
- MEDIA PLAYER | Video textures from files/URLs | TRIVIAL | VideoTexture asset type.
- NICHE (nDisplay, DMX, MetaHuman, Mocap Manager, VCam) | Virtual production stack | INFEASIBLE / out of scope | skip — wrong product category for a web editor.

Census: ~78 entries.

## TOP-12 priority (user-visible impact × web feasibility)

1. **Level Editor core** — viewport gizmos + outliner + details panel + undo; nothing reads "editor" without it.
2. **Blueprint graph + interpreter** — exec/data dual-pin model with Branch/Loop/Delay and live debug pulses; THE signature UE feature.
3. **Play-In-Editor** — edit→play→stop-restores-state loop makes it a game editor, not a scene viewer.
4. **Material node editor** — graph→GLSL/TSL with live preview sphere; second most iconic UE surface.
5. **Sequencer** — tracks/keyframes/curve editor with bezier tangents + camera cuts.
6. **Landscape sculpt + paint** — raise/lower/smooth/flatten brushes + 4-layer splat painting; massive demo value, modest code.
7. **Foliage painting** — InstancedMesh scatter brush; cheapest "whoa" per line of code.
8. **Niagara-style particle stack** — emitter/module stack UI with spawn rate, lifetime, velocity, gravity/drag, color&size-over-life curves, sprite renderer.
9. **Content Browser + asset system** — typed assets, thumbnails, drag-drop; the spine everything hangs on.
10. **Animation state machines + blend spaces** — FSM crossfades + 2D blend canvas over glTF clips.
11. **Enhanced Input clone** — Input Actions/Mapping Contexts/Triggers; small, direct port, instantly familiar to UE refugees.
12. **Post-process volumes + CineCamera** — bloom/grade/DOF volumes and physical camera; cheapest path to "looks like UE5" screenshots.

Honorable 13–15: UMG-style DOM UI designer, Behavior Trees + recast-navigation-js navmesh, MetaSounds→WebAudio graph (all FEASIBLE and differentiating in round two). Explicit non-goals: real Lumen/Nanite/Substrate/Motion Matching/Mass — approximate or label, never promise.

## Sources

- [Tools and Editors in Unreal Engine](https://dev.epicgames.com/documentation/en-us/unreal-engine/tools-and-editors-in-unreal-engine)
- [Unreal Engine 5.6 release](https://www.unrealengine.com/news/unreal-engine-5-6-is-now-available)
- [UE 5.7 release notes](https://dev.epicgames.com/documentation/unreal-engine/unreal-engine-5-7-release-notes?lang=en-US)
