# Godot Engine Census — remake targets for a Three.js web editor

> Subagent research against docs.godotengine.org/en/stable. Godot is MIT
> open source, so its designs can be freely remade. This census seeded the
> 34-task roadmap (ROADMAP.md) together with the UE5 census.
> Format: NAME | essence | feasibility | minimal-viable remake.

## A. Scripting

- GDScript | Python-like engine-native language, hot-reloads, `_ready`/`_process` lifecycle hooks, tight node binding (`$NodePath`) | FEASIBLE | use JS/TS as the "native" language: editable script per node with `ready()`/`update(dt)` hooks, hot-swap on save
- VisualScript (REMOVED in Godot 4) | node-graph scripting; killed because only 0.5% of 5,000+ polled users used it — GDScript was already easy enough, no high-level prefab components shipped with it, and docs never taught it | (lesson, don't remake) | skip parallel graph scripting; spend the effort making text scripting + Inspector exports frictionless instead
- Expression / per-property scripting | evaluate small expressions safely | TRIVIAL | sandboxed `new Function` evaluator for property bindings

## B. Node / scene system core

- Node tree + Scene | everything is a node in one tree; a scene is a saved subtree; composition over ECS/prefab dichotomy | FEASIBLE | JSON scene format wrapping a typed node class hierarchy over `THREE.Object3D`, tree panel with drag-reparent
- Scene instancing | a saved scene used as a node inside another scene (prefab-equivalent), recursive | FEASIBLE | store instance refs, expand at load, lock children by default
- Editable Children + property overrides | open an instance in-place, override only changed properties (delta over source scene) | HARD | per-node diff map applied after instancing; the diffing/merge UX is the hard part
- Scene inheritance | new scene extends existing scene | HARD | same delta mechanism with "extends" root pointer; ship after overrides work
- Signals | nodes declare events, connect to any node's method via editor dialog; the decoupling backbone | FEASIBLE | typed EventEmitter per node + a "Node" inspector tab listing signals with connect-dialog, connections serialized in scene file
- Groups | string-tag many nodes, fetch all by tag (`get_nodes_in_group`) | TRIVIAL | tag set per node + `scene.getGroup("enemies")` + editor Groups tab
- Node unique names (%Name) | scene-scoped node lookup immune to reparenting | TRIVIAL | per-scene name registry
- Notifications/lifecycle | `_ready`, `_process`, `_physics_process`, `_input`, enter/exit tree | FEASIBLE | fixed-timestep loop calling lifecycle methods in tree order

## C. Node3D catalog (each = one node class to remake)

- Node3D | base spatial: transform, visibility, gizmo | TRIVIAL | thin wrapper on Object3D
- MeshInstance3D | renders one mesh resource + material overrides per surface | TRIVIAL | wraps THREE.Mesh
- Camera3D | perspective/ortho cam, "current" flag, preview-in-editor picture-in-picture | TRIVIAL | THREE camera + editor PiP viewport render
- Light3D variants (Directional/Omni/Spot) | lights with shadow params, range/attenuation gizmos | TRIVIAL | maps 1:1 to THREE lights + gizmo handles
- WorldEnvironment | single node holding Environment resource: sky, ambient, fog, tonemap, glow, SSAO, adjustments | FEASIBLE | scene-level env resource driving Scene.environment/fog + postprocessing
- StaticBody3D | immovable collider | TRIVIAL | Rapier fixed body
- RigidBody3D | physics-driven body with mass/forces/sleep | FEASIBLE | Rapier dynamic body syncing transform back to node
- CharacterBody3D + move_and_slide | kinematic controller that slides along collisions, `is_on_floor()`, snap | FEASIBLE | one helper `moveAndSlide(velocity)` — this single helper is one of Godot's biggest UX wins
- CollisionShape3D | child node holding a shape resource with editor handles | FEASIBLE | shape child node with drag-handle gizmos feeding parent body
- Area3D | non-solid overlap volume emitting body_entered/exited, also gravity/audio zones | FEASIBLE | sensor collider + entered/exited signals
- RayCast3D | persistent per-frame ray node: is_colliding, point, normal, exclusions | TRIVIAL | raycast each frame, dashed-line gizmo
- Timer | countdown node emitting `timeout`, one-shot/loop, editable in Inspector | TRIVIAL | ~30-line node class; absurdly high value-per-effort
- Path3D + PathFollow3D | editable 3D curve + child that slides along it by `progress` | FEASIBLE | CatmullRom curve with draggable control-point gizmos
- AudioStreamPlayer3D | positional audio node with attenuation | FEASIBLE | THREE.PositionalAudio wrapped as node
- GPUParticles3D | GPU-simulated particles driven by a ProcessMaterial resource | HARD | GPGPU sim later
- CPUParticles3D | same params, CPU sim | FEASIBLE | instanced-mesh CPU loop with identical param schema as GPU version (Godot's param-parity trick)
- MultiMeshInstance3D | thousands of instances of one mesh, editor scatter tool ("populate surface") | FEASIBLE | THREE.InstancedMesh + paint/scatter-on-surface tool
- Decal | projected albedo/normal/emission box onto geometry | HARD | DecalGeometry bake as MVP
- GridMap | 3D tilemap: paint MeshLibrary cells on a grid | FEASIBLE | grid paint tool writing cell→meshIndex map as InstancedMesh per tile type
- NavigationRegion3D | bakes navmesh from geometry | HARD | recast-navigation-js bake + debug mesh overlay
- NavigationAgent3D | per-actor path query + steering + avoidance (RVO) | HARD | Detour crowd; expose `setTargetPosition()` + `getNextPathPosition()`
- ReflectionProbe | local cubemap reflections, box projection | HARD | render cubemap on bake; MVP = manual bake button
- VoxelGI / LightmapGI | global illumination bake | INFEASIBLE (near-term) | skip; env lighting + AO baked offline
- Skeleton3D + BoneAttachment3D | skeletal rig node, attach items to bones | FEASIBLE | wraps THREE.Skeleton from glTF
- CSGShapes (CSGBox3D etc.) | boolean blockout geometry for prototyping | FEASIBLE | three-bvh-csg union/subtract/intersect node chain
- Sprite3D / Label3D | billboard image/text in 3D | TRIVIAL | textured plane with billboard flag / troika-three-text
- VehicleBody3D + wheels | raycast car physics | HARD | Rapier raycast suspension; defer

## D. Animation

- AnimationPlayer + keyframe editor | dockable timeline: property tracks (key ANY Inspector property), pos/rot/scale tracks, bezier curve editor per track, call-method tracks, audio tracks | HARD | timeline panel keying serialized properties with linear/cubic interp; bezier editor and method tracks phase 2 — single highest-effort, highest-payoff editor tool
- Call Method tracks | keyframes that invoke node methods at a time | FEASIBLE | track storing `{t, nodePath, method, args}`
- AnimationTree: StateMachine | visual graph of states + transitions (xfade time, auto-advance, travel()) | HARD | node-graph UI over crossfading AnimationActions
- AnimationTree: BlendSpace1D/2D | place clips at points; blend by position (Delaunay in 2D) | HARD | 1D trivial (lerp weights), 2D needs triangulation weight solve
- BlendTree nodes (Blend2/3, OneShot, TimeScale, TimeSeek, Transition) | composable blend ops | HARD | small graph evaluating to per-clip weights; OneShot is the must-have
- Root motion | extract hip motion to move CharacterBody | HARD | strip root track delta per frame; phase 3
- Tween (code-side) | one-line property interpolation chains | TRIVIAL | tween lib exposed as `node.tween()`

## E. Inspector / resources / import

- Inspector | reflection-driven property panel: categories, revert-to-default arrows, sub-resource drilldown, pin, copy/paste | FEASIBLE | schema-driven property grid from class metadata
- @export annotations → Inspector | script variables become editor widgets: @export, @export_range (slider), @export_enum (dropdown), @export_file, @export_multiline, @export_color, @export_flags, @export_node_path, @export_tool_button | FEASIBLE | decorator syntax in user scripts parsed to widget schema — THE killer designer/programmer bridge, prioritize first
- Resource (.tres) system | every data blob (material, curve, shape, animation) is a savable, shareable, refcounted file; resources nest; edit inline in Inspector | FEASIBLE | JSON resource files with UUIDs, shared-by-reference, inline sub-inspector
- Curve / Gradient resources | editable curve and color-ramp widgets used by particles, falloffs | FEASIBLE | bezier curve widget + gradient stop widget
- Import pipeline | drop file in project → auto-import with per-file .import settings, Advanced Import dialog for glTF (retarget, split animations, `-col` suffix colliders) | FEASIBLE | per-asset import settings sidecar, glTF animation-split + name-suffix collider generation
- FileSystem dock | project file browser with drag-into-scene/Inspector | FEASIBLE | asset panel with drag-drop instantiation
- Unique scene/asset UIDs | refs survive file moves | TRIVIAL | UUID layer over paths

## F. Materials / shaders / particles

- StandardMaterial3D | uber-material: ~all PBR features as Inspector checkboxes (rim, clearcoat, refraction, billboard, triplanar, proximity fade) | FEASIBLE | MeshPhysicalMaterial schema + onBeforeCompile snippets
- ShaderMaterial + Shader editor | custom GLSL-like shaders with live-edit bottom panel, uniforms auto-appear in Inspector | FEASIBLE | GLSL editor for ShaderMaterial; parse `uniform` lines → Inspector widgets
- VisualShader editor | node graph compiling to shader code (survived where VisualScript died — shaders are genuinely better as graphs) | HARD | node graph → GLSL/TSL codegen; visual SHADERS earn their keep, visual SCRIPTS don't
- ParticleProcessMaterial | the resource holding emission shape, spread, initial velocity, gravity, damping, scale curve, color ramp, turbulence, sub-emitters | FEASIBLE | one param schema driving both CPU and GPU particle backends
- Next-pass / render priority | material stacking & transparency sort control | TRIVIAL | renderOrder + second draw

## G. Physics / navigation (system-level)

- Physics layers & masks | named 32-bit layer/mask matrix in project settings, checkbox grid in Inspector | TRIVIAL | Rapier collision groups + named-layer settings UI
- Physics process tick | fixed-step `_physics_process(delta)` separate from render frame | TRIVIAL | fixed accumulator loop
- Joints (Pin/Hinge/Slider/6DOF) | constraint nodes between bodies | FEASIBLE | Rapier joints as nodes; defer past MVP
- Navigation system | regions, agents, links, obstacles, debug visualization | HARD | recast-navigation-js end-to-end; bake in a worker

## H. Debugger / tooling (the underrated crown jewels)

- Remote scene tree | while the game RUNS, editor shows the live tree; click any node → live Inspector | HARD | iframe + postMessage bridge mirroring tree+properties — in-browser this is EASIER than Godot's socket protocol and a massive differentiator
- Live property editing | edit Inspector values on the running game instantly | HARD | same bridge, write-back channel
- Profiler | per-function frame time, physics/render breakdown, frame scrubbing | FEASIBLE | wrap lifecycle calls with performance.now(), flame list per frame
- Monitors | graphs of FPS, draw calls, video RAM, object/node counts over time | TRIVIAL | renderer.info + node counts charted
- Output panel + rich errors | print/push_error routed to dock with node-path links | TRIVIAL | console intercept → bottom panel
- Breakpoints/stepping in script editor | step through GDScript | HARD | defer; rely on browser devtools + source maps (honest web answer)
- Video RAM / orphan node debugger | leak hunting | FEASIBLE | renderer.info.memory + undisposed-geometry tracker

## I. Editor extensibility

- EditorPlugin / addons system | plugins written in the engine's own language, add docks, gizmos, import plugins, custom nodes; live in `addons/`, toggle in settings | FEASIBLE | plugin API = JS module exporting `{docks, nodeTypes, gizmos, importers}`; trivially hot-loadable on the web
- @tool scripts | game scripts that also run inside the editor | HARD | editor sandbox with guard flag; powerful but dangerous, phase 2
- Custom node types via script | register script as a new node class with icon | FEASIBLE | `registerNodeType()` in plugin API
- Asset Library | in-editor browser of community addons, one-click install | FEASIBLE | registry-backed addon browser; web-native install is instant — differentiator
- Editor themes/settings, command palette | Ctrl+Shift+P everything-search | TRIVIAL | command registry + palette

## J. Project systems

- Input Map | named actions ("jump") bound to N keys/buttons/axes in Project Settings; code asks `Input.is_action_pressed("jump")`; deadzone per action | FEASIBLE | actions table UI + runtime mapping — small effort, huge architecture win, do early
- Autoload singletons | scripts/scenes registered to load before everything, accessible globally (GameState, AudioManager) | TRIVIAL | ordered list instantiated into a persistent root
- Project Settings | searchable tree of every engine setting with revert arrows | FEASIBLE | settings schema + same property-grid as Inspector
- Export presets + templates (HTML5!) | one dialog → ship to platform; web export with PWA option | FEASIBLE→TRIVIAL for web | "Export" = bundle scenes+assets+runtime into static site / single shareable URL — a Three.js editor exports to its OWN platform natively; your structural advantage over Godot, whose web export (WASM size, SharedArrayBuffer headers) is its weak point
- Main scene + scene switching | `change_scene_to_file()` | TRIVIAL | scene manager with main-scene setting
- Internationalization, feature tags | per-platform config | FEASIBLE | defer

## K. UI / multiplayer / audio

- Control nodes + anchors/containers | full retained-mode GUI toolkit built from the same node tree; Godot's editor is built in it (dogfooding by construction) | HARD | don't rebuild a GUI toolkit in WebGL — map Control nodes to real DOM/CSS overlay nodes; anchors→CSS; uniquely BETTER on web
- Theme resource | stylebox/font/color overrides cascading down Control tree | FEASIBLE | CSS-variable-backed theme resource
- Multiplayer high-level API | `multiplayer.is_server()`, @rpc annotations, MultiplayerSpawner (replicates instantiations), MultiplayerSynchronizer (checkbox list of properties to sync) | HARD | WebRTC/WebSocket transport + property-sync node with Inspector checklist; Spawner/Synchronizer-as-nodes is the right abstraction to copy
- Audio buses + effects | mixer panel: buses, volume, effect stacks (reverb, EQ), routed per player node | FEASIBLE | WebAudio graph: bus = GainNode chain with effect inserts, mixer bottom panel
- Bottom panel system | Output / Debugger / Audio / Animation / Shader Editor as contextual bottom drawer tabs (animation panel appears when AnimationPlayer selected) | FEASIBLE | context-sensitive bottom drawer; the contextual summon pattern is the key design idea

---

## TOP-10 ideas that most differentiate a web engine (impact × feasibility)

1. **@export script→Inspector pipeline** — decorator in user code instantly becomes a typed editor widget; cheapest path to "designers tweak, coders code."
2. **One-click web export / share URL** — Godot's weakest platform is your native one; "edit → URL in 5 seconds" beats every desktop engine.
3. **Remote scene tree + live property editing** — iframe+postMessage makes Godot's hardest debug feature almost easy on web; nobody in three.js-land has it.
4. **Scene instancing with property overrides** — prefab composition is the structural backbone everything else hangs on.
5. **Signals + editor connect dialog** — decoupled wiring without code, serialized in the scene; tiny runtime, huge architecture payoff.
6. **CharacterBody3D + move_and_slide** — one method that makes character controllers trivial converts more hobbyists than any rendering feature.
7. **Timer / RayCast3D / Area3D / Path3D "small node" pack** — days of work total, removes 80% of gameplay boilerplate; Godot's secret sauce is many tiny nodes.
8. **AnimationPlayer keyframe editor (key any property)** — highest-effort item on the list but the line between "renderer wrapper" and "game editor."
9. **Control-nodes-as-DOM UI layer** — anchors/containers mapped to CSS gives a GUI toolkit Godot spends megabytes reimplementing, for free.
10. **Web-native addon system + asset library** — JS hot-loaded plugins + registry install; the web's distribution model is your moat.

## The lesson

Godot's deepest design lesson for a small engine is **uniformity of abstraction relentlessly applied: everything is a node in one tree, everything else is a resource, and the editor is just reflection over both**. Because every feature — a timer, a particle system, a multiplayer synchronizer — is "just another node" with serialized properties, every feature automatically inherits the scene format, the Inspector, undo/redo, animation keying, instancing, and the plugin API for free; the engine's surface area grows linearly while its capability grows multiplicatively. The VisualScript failure is the same lesson inverted: it was a second, parallel abstraction built on what maintainers imagined non-programmers wanted rather than what users actually asked for, and it died at 0.5% usage while boring, uniform GDScript-with-@export thrived — so a small engine should never build a parallel system when it can make the one universal abstraction (node + resource + reflected inspector) reach further, and should let real user friction, not theoretical audiences, decide what gets built.
