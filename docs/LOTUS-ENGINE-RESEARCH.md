# Three.js r184+ as a Game Engine Foundation

> **Working title:** Lotus Engine (rename from Lotus Engine)  
> **Baseline:** `three@^0.184.0`, `WebGLRenderer` + `EffectComposer`, Actor/scene-graph runtime  
> **Synced against:** `docs/CHECKPOINT.md` (v0.72 / wave 8), `docs/UE5.7-GAP-LIST.md`, `docs/GODOT-CENSUS.md`, `docs/UE5-TOOL-CENSUS.md`  
> **Date:** 2026-06-13

This document treats Three.js r184+ as a **game engine substrate**, not a renderer wrapper. It maps what the library gives for free, what Lotus Engine must build on top, and a prioritized Wave 9–12 roadmap aligned with Three.js strengths and UE/Godot parity gaps.

---

## Executive summary

| Layer | Three.js r184 gives | Lotus must build |
|-------|---------------------|------------------|
| Scene | `Object3D` hierarchy, `InstancedMesh`, `BatchedMesh`, `LOD`, skinning/morphs | Actor registry, serialization, undo, editor reflection |
| Render | `WebGLRenderer` (stable), `WebGPURenderer` (maturing), TSL/NodeMaterial, `PostProcessing` | Dual-backend abstraction, material graph → TSL migration |
| Sim | None (by design) | Rapier physics, Recast nav (worker), CPU→GPU particles |
| Tools | Loaders, examples, Inspector | Full editor, Blueprints, Sequencer, export, multiplayer |

**Strategic bet:** Stay on **WebGL + EffectComposer** for editor/export compatibility through Wave 9. Introduce **WebGPU as an opt-in quality tier** (GPU particles, TSL materials, TAA/SSGI) in Wave 10–11. Never fork the gameplay layer — Actor + script slot remains the single runtime truth (Godot census lesson).

---

## 1. Core architecture

### 1.1 Scene graph vs ECS

Three.js is **scene-graph first**. Every renderable, light, camera, and bone is an `Object3D` in a parent/child tree. Updates propagate via `matrixWorld` dirty flags; the renderer walks the graph each frame and builds **render lists** (opaque → transmissive → transparent).

**ECS (Entity-Component-System)** — as in UE Mass Entity or Bevy — stores data in Structure-of-Arrays for cache-friendly iteration at millions of entities. Three.js has **no ECS**. You can bolt on `bitecs` or a custom SoA layer, but the renderer still expects `Object3D` handles.

**Lotus choice (current, correct):** Godot/UE **Actor model** over scene graph, not parallel ECS.

```
World (UWorld)
  └── Actor registry: Map<id, Actor>
        └── Actor.root: THREE.Object3D  ← sync point
              ├── mesh / light / camera components
              └── child Actor roots (parentId)
```

| Approach | Pros | Cons | Lotus fit |
|----------|------|------|-----------|
| Pure scene graph | Native Three.js, gizmos/picking free | Gameplay state scattered on `userData` | Too weak alone |
| Actor over graph | UE/Godot parity, serialization, Details panel | Extra indirection | **Current** (`Actor.ts`, `World.ts`) |
| Full ECS | 100k+ agent sims | Fights Three.js; editor UX hard | Defer; use SoA only inside subsystems (particles, crowd) |

**Action:** Keep Actor as the universal gameplay node. For hot loops (particles, PCG instances, future crowds), use **SoA buffers + InstancedMesh/BatchedMesh** without exposing ECS to designers.

### 1.2 Object3D hierarchy

Core mechanics Lotus already depends on:

- **Transform:** `position` / `rotation` / `scale` → `updateMatrixWorld()`. Physics writes back to `Actor.root` after Rapier step.
- **Visibility:** `visible` + per-actor `cullDistance` + streaming cell gate (`streaming.ts`).
- **Layers:** `Object3D.layers` for selective rendering (editor helpers vs game). Not yet wired to collision — physics uses Rapier groups instead.
- **Pivot (r184):** `Object3D.pivot` — local origin offset without extra Group nodes. **Use for foliage/PCG instance origins** and gizmo alignment.
- **Mobility gate:** Static actors skip per-frame matrix writes; only Movable dynamics sync from physics.

**Gap vs UE:** No native **attachment sockets** on skeletons. Lotus has IK (`ik.ts`) but no socket editor. glTF extras or child Empty actors at bone paths are the MVP.

### 1.3 InstancedMesh vs BatchedMesh

| | `InstancedMesh` | `BatchedMesh` |
|--|-----------------|---------------|
| **Same geometry + same material** | ✅ One draw call | ✅ Batches *different* geometries with *multi-material* support |
| **Per-instance transform** | `setMatrixAt(i)` | `setMatrixAt(geometryId, instanceId)` |
| **Per-instance color** | `setColorAt(i)` (r184 fixes unset-color crash) | Per-geometry-instance color |
| **Lotus usage today** | Foliage (`foliageMesh`), PCG (`pcgMesh`), particle mesh mode | **Not used** |
| **Nanite analog** | No | Closest browser path to "many meshes, few draws" |

**InstancedMesh** is correct for foliage/PCG/particle mesh renderer (already shipped v0.59).

**BatchedMesh** (r167+, hardened r184) is the upgrade path for:
- GridMap tile batches with *different* tile meshes but shared atlas material
- Static world props merged at export time (Nanite-honest label: "batching", not virtualized geometry)
- WebGPU multi-draw indirect (r184 `WEBGL_multi_draw` fallback on WebGL path)

**Wave 10 action:** Add `Build → Merge Static Meshes (BatchedMesh)` for export-only batching; keep editor actors separate for undo.

### 1.4 Skinning and morph targets

**SkinnedMesh + Skeleton:**
- Bones are `Bone` nodes in the graph; `Skeleton` holds `boneInverses` + `boneMatrices`.
- `AnimationMixer` drives `AnimationClip` tracks on bones or morph influences.
- r184: `SkinnedMesh.applyBoneTransform()` accepts `Vector4` and direction vs position — useful for IK/debug gizmos.

**Lotus today:** glTF import → `AnimationMixer` + FSM (`animStateMachine.ts`) + 1D/2D blend spaces + two-bone IK/LookAt (`ik.ts`).

**Morph targets (`mesh.morphTargetInfluences`):**
- glTF loads morph dictionaries; Three.js `MorphNode` (TSL) can blend in shader.
- No editor for sculpting blendshapes (UE 5.6 feature) — honest skip.
- **Action:** Expose morph weights in Details panel for imported glTF; key in Sequencer as float tracks.

**TSL path:** `SkinningNode`, `MorphNode`, `InstancedMeshNode` unify skinned + instanced materials under NodeMaterial — target for material graph v3.

---

## 2. WebGPU path

### 2.1 WebGPURenderer status (r184)

`WebGPURenderer` extends the unified `Renderer` base class. Key r184 deltas:

| Feature | r184 state | Lotus implication |
|---------|------------|-------------------|
| `compileAsync()` | Truly non-blocking | Background shader compile on level load |
| NodeMaterial on WebGL | Compatibility layer (#32851) | Single material codebase for both backends |
| TSL compile perf | ~3× faster (#33120) | Material graph recompile acceptable in editor |
| Compute shaders | `ComputeNode`, `StorageBufferNode`, `StorageTextureNode` | **GPU particles**, GPU culling experiments |
| `ReadbackBuffer` | Partial GPU→CPU readback | Particle collision heightfield lookup |
| `LightProbeGrid` | Position-dependent diffuse GI | "Lumen-approx" tier for static interiors |
| Reversed depth buffer | `depth32float` on WebGPU | Z-fighting fix for large worlds |
| Shadow quality | Still regresses vs WebGL on some GPUs (community r182 reports) | **Do not default WebGPU** until QA matrix passes |

**Renderer selection pattern for Lotus:**

```typescript
// Proposed: src/engine/rendererBackend.ts
async function createRenderer(canvas: HTMLCanvasElement, tier: 'webgl' | 'webgpu') {
  if (tier === 'webgpu' && (await WebGPURenderer.hasWebGPUAsync())) {
    const r = new WebGPURenderer({ canvas, antialias: true })
    await r.init()
    return r
  }
  return new WebGLRenderer({ canvas, antialias: true })
}
```

Export runtime (`src/export/runtime.js`) stays WebGL-first until WebGPU export size and Safari coverage are acceptable.

### 2.2 TSL (Three Shading Language)

TSL is a JS node DSL compiling to **WGSL (WebGPU)** or **GLSL (WebGL)** via `NodeMaterial`. It replaces string-hacking `onBeforeCompile`.

**Current Lotus:** `materialShader.ts` injects GLSL from `MaterialGraph` nodes (UV, TextureSample, Fresnel, Noise, WPO). Works but:
- No automatic uniform packing
- WebGPU path requires rewrite
- Harder to serialize than TSL node graphs (`NodeObjectLoader` / `NodeMaterialLoader`)

**Migration plan:**

| Phase | Work | Wave |
|-------|------|------|
| A | Add `compileMaterialGraphTSL()` parallel to GLSL; preview sphere uses `MeshPhysicalNodeMaterial` | 9 |
| B | Feature-flag `r.MaterialBackend = tsl \| glsl` cvar | 9 |
| C | Port post passes to `PostProcessing` + `PassNode` (bloom, FXAA, SSAO) | 10 |
| D | Deprecate `onBeforeCompile` path when WebGPU tier ships | 11 |

**TSL primitives for Lotus material editor:**

```javascript
import { texture, uv, uniform, float, vec3, mix, positionWorld } from 'three/tsl'

const baseColor = mix(uniform('colorA'), texture(tex).rgb, float(0.5))
const wpo = positionWorld.add(vec3(0, sin(time).mul(0.1), 0))
```

Reference examples: `webgpu_materials`, `webgpu_postprocessing_dof`, `webgpu_compute_particles`.

### 2.3 Compute shaders (particles / physics)

WebGPU compute via TSL `ComputeNode`:

| Use case | Pattern | Lotus module |
|----------|---------|--------------|
| Particle spawn/update | SoA in `StorageBufferNode`, render with `InstancedMesh` | Replace `particles.ts` CPU loop |
| Frustum culling | Compute visibility flags → indirect draw | `streaming.ts` + BatchedMesh |
| Cloth/soft body | PBD in compute | Wave 12+ / honest skip |
| Navmesh bake | **Stay on worker WASM** (Recast) | `navMeshWorker.ts` — GPU nav bake not worth it |

**GPU particle architecture (Wave 9 flagship):**

```
ParticleEmitterActor
  └── ParticleSystemGPU
        ├── StorageBuffer: [pos, vel, life, color, size] × N
        ├── ComputeNode: spawn + integrate + kill
        ├── Optional: depth collision via ViewportDepthTextureNode
        └── InstancedMesh / PointsNodeMaterial render
```

Keep CPU backend as fallback when `!renderer.hasCompute()` (WebGL tier).

---

## 3. Physics integration

### 3.1 Browser physics comparison

| Engine | Binding | WASM size | Strengths | Weaknesses | Lotus |
|--------|---------|-----------|-----------|------------|-------|
| **Rapier** (`@dimforge/rapier3d-compat`) | Official Three.js addon `RapierHelper` | ~2 MB | Active (Dimforge 2025+), joints, CCD, heightfields, collision groups | No soft body, no vehicles built-in | **Current** (`physics.ts`) |
| **Jolt Physics.js** | `jolt-physics` WASM | ~3–4 MB | Console-proven (Horizon, Death Stranding 2), determinism options | Newer JS binding, smaller ecosystem | Evaluate for Wave 11 vehicles + destruction |
| **cannon-es** | Pure JS (+ optional WASM) | Small | Easy API, many tutorials | Stale maintenance, poor performance at scale | **Do not adopt** |
| **Ammo.js** | Bullet port | Large | Feature-rich | Unmaintained, slow load | Avoid |

### 3.2 Rapier — current integration audit

Lotus `PhysicsSim` correctly mirrors UE Chaos patterns:
- PIE-only simulation (no editor physics leak)
- Mobility gate: only `Movable` → dynamic bodies
- Collision layers → Rapier groups (`(1 << layer) << 16 | mask`)
- Landscape trimesh colliders from heightfield
- Destruction fragments as dynamic bodies

**Gaps (UE5.7-GAP-LIST):**
- Joints as actor components (Pin/Hinge) — Rapier supports, Lotus doesn't expose
- Raycast vehicle — Rapier `VehicleController` or Jolt `WheeledVehicle`
- Physics asset editor (ragdoll per bone) — auto-capsule from skeleton
- `characterController` / `moveAndSlide` — **Godot census #6 priority**; wrap Rapier kinematic character

**Recommendation:** Stay on Rapier through Wave 10. Prototype Jolt **only** for raycast vehicle + fracture if Rapier vehicle feels inadequate. Never ship two physics engines — one abstraction (`PhysicsSim` interface).

### 3.3 Physics timestep

Godot/UE use fixed `physics_process` decoupled from render. Lotus should add:

```typescript
const PHYSICS_HZ = 60
let physicsAccumulator = 0
// in tick(dt): while (accumulator >= 1/60) { physics.step(); accumulator -= 1/60 }
```

Scripts already have `onTick(dt)`; add `onPhysicsTick(fixedDt)` for determinism (multiplayer, replay).

---

## 4. Asset pipeline

### 4.1 GLTFLoader stack

Standard Lotus import chain:

```
.glb drop → GLTFLoader
  ├── DRACOLoader     (mesh compression)
  ├── KTX2Loader      (Basis Universal textures)
  └── MeshoptDecoder  (vertex/index buffer compression + LOD extensions)
```

**Current state:** glTF embedded as base64 in level JSON (`World.assets`). Works for small projects; doesn't scale.

**Target pipeline (Wave 10):**

| Stage | Tool | Action |
|-------|------|--------|
| Import | `GLTFLoader` + sidecar `.import.json` | Per-asset: generate collider from `-col` suffix mesh, split animations |
| Compress (CI) | `gltf-transform` CLI | Draco geometry + KTX2 UASTC textures + meshopt |
| LOD | `EXT_meshopt_compression` + `MSFT_lod` or custom LOD1/LOD2 glTF files | `meshoptimizer` simplify in editor Build menu |
| Runtime | Content-addressed blob store (IndexedDB / CDN) | Level files reference UUID, not base64 |

### 4.2 DRACO

- Decoder: `DRACOLoader.setDecoderPath()` — wasm decoder ~200 KB.
- **Editor:** decompress once at import, store raw `BufferGeometry` in IndexedDB.
- **Export:** re-encode with `DRACOExporter` for smaller HTML bundles.

### 4.3 KTX2 / Basis Universal

- `KTX2Loader` transcodes to GPU format (ASTC/BC/ETC2) via `ktx-parse` + web workers.
- **Mandatory for web:** JPEG/PNG textures in base64 levels explode file size.
- **Action:** On glTF import, detect `KHR_texture_basisu`; if missing, queue async KTX2 bake in asset processor.

### 4.4 meshoptimizer LOD

- `meshoptimizer` simplify: reduce triangle count per LOD level (50% / 25% / 10%).
- Three.js `LOD` object switches children by distance — wire to `Actor.cullDistance` and streaming.
- **Nanite-honest label:** "Mesh LOD chains" not "virtualized geometry."

**Wave 10 deliverable:** Static Mesh asset inspector tab — LOD0/1/2 preview, collision primitive picker, socket list.

### 4.5 xatlas UV2 (lightmaps)

`xatlas-web` is already in `package.json`. CHECKPOINT lists **xatlas uv2** as v0.73+ work.

Pipeline:
1. `Build → Unwrap UV2 (xatlas)` on selected static meshes
2. `lightmapBake.ts` writes AO into UV2 atlas (v0.72 vertex bake → UV2 texture upgrade)
3. Second UV channel in `MeshStandardMaterial.aoMap` + `lightMap`

---

## 5. Post-processing

### 5.1 EffectComposer (WebGL) vs PostProcessing (r180+)

| | `EffectComposer` (addons) | `PostProcessing` + TSL `PassNode` (core) |
|--|---------------------------|------------------------------------------|
| Backend | WebGL render targets | WebGPU-native; WebGL fallback emerging |
| Pass chain | `RenderPass` → `UnrealBloomPass` → `OutputPass` | `scenePass` → `bloom()` → `fxaa()` → `output` |
| MRT | Manual | `MRTNode` (color + normal + depth) |
| Lotus today | `Viewport.tsx` composer | Not used |

**Lotus current stack:** `EffectComposer` + `UnrealBloomPass` + `OutputPass`; exposure via tone mapping; post-process volumes blend bloom (`postProcess.ts`).

### 5.2 Target passes (honest UE parity)

| UE feature | Browser-feasible approach | Wave |
|------------|---------------------------|------|
| **TAA** | Velocity buffer + `TemporalAA` TSL node (three.js examples) | 10 |
| **SSR** | `ViewportDepthTextureNode` + ray march in TSL; quality cap on mobile | 10 |
| **SSAO** | `AONode` / `GTAONode` in TSL; already have vertex AO bake | 9 |
| **SSGI** | r184 `SSGI Ball Pool` example — expensive, Quality tier only | 11 |
| **Bloom** | ✅ `UnrealBloomPass` | shipped |
| **DOF** | `webgpu_postprocessing_dof` | 10 |
| **Motion blur** | Velocity-based; skip on WebGL tier | 12 |
| **Path tracer** | ✅ `WebGLPathTracer` view mode (v0.49) | shipped |

### 5.3 Buffer visualization (v0.68)

Shipped: worldNormal, depth, baseColor, roughness, metallic via material overrides.

**CHECKPOINT next:** AO, emissive, scene depth as **post pass** (not material swap) — requires MRT or depth prepass. Implement when migrating to `PostProcessing` in Wave 10.

---

## 6. Performance

### 6.1 Frustum culling

- Default: `Object3D.frustumCulled = true` — renderer tests bounding sphere vs camera frustum.
- Lotus disables culling for particles (`frustumCulled = false`) because particle bounds are wrong — **fix bounds** instead of disabling.
- **Action:** `ParticleSystem.updateBoundingSphere()` each frame; re-enable culling.

### 6.2 LOD

- Three.js `LOD` node with distance thresholds.
- Combine with `Actor.cullDistance` (already in serialization) and `streaming.ts` cell loading.
- **HLOD analog:** merge distant streaming cells into impostor billboards at export.

### 6.3 Occlusion

- No hardware occlusion culling in WebGL/WebGPU like UE.
- Approximations:
  - **Portal/cell-based:** don't load occluded streaming cells (already have grid streaming)
  - **GPU occlusion queries:** limited in WebGPU; experimental
  - **BatchedMesh + sorted draws:** reduces overdraw cost without true occlusion

### 6.4 Render lists

Three.js renderer sorts into opaque / transmissive / transparent buckets per scene. Lotus perf wins:

| Technique | Impact | Status |
|-----------|--------|--------|
| InstancedMesh for foliage/PCG | High | ✅ |
| Shared materials + `materialAssetId` | High | ✅ v0.34 |
| `renderer.info` draw call HUD | Medium | ✅ profiler |
| BatchedMesh static merge | High | ⏳ Wave 10 |
| Texture atlases / KTX2 | Load time | ⏳ Wave 10 |

### 6.5 Worker threads

| Task | Worker | Status |
|------|--------|--------|
| Navmesh bake | `navMeshWorker.ts` (Recast WASM) | ✅ v0.36 |
| AO bake | Main thread (`lightmapBake.ts`) | ◐ Move to worker Wave 9 |
| xatlas UV2 | Main thread | ⏳ Worker + transferable buffers |
| glTF decode + KTX2 transcode | — | ⏳ Wave 10 asset worker |
| Physics | Main thread (Rapier WASM sync) | OK for <500 bodies; SharedArrayBuffer physics only if dedicated workers justified |

**AO bake worker (Wave 9):** hemisphere raycast is embarrassingly parallel per vertex/texel.

---

## 7. What UE/Unity/Godot have that Three.js lacks — and how Lotus fills gaps

Three.js is a **rendering library**. It does not provide gameplay, editor, networking, or asset management. Lotus Engine's moat is building the **UE/Godot tool layer** on top while keeping web-native distribution.

| Capability | UE5 / Godot / Unity | Three.js native | Lotus strategy |
|------------|---------------------|-----------------|----------------|
| **Editor** | Full IDE | None | ✅ Viewport, Outliner, Details, Content Browser (v0.1–0.72) |
| **Serialization** | uasset / .tscn / YAML | `ObjectLoader` JSON only | ✅ Level JSON + prefabs; upgrade to binary glTF scenes + sidecars |
| **Scripting** | C++ / GDScript / C# | None | ✅ JS per-actor + Blueprint → script slot (design law #1) |
| **Reflection / Inspector** | UPROPERTY / @export | None | ✅ @export vars; extend `@export_range`, `@export_enum` |
| **Physics** | Chaos / Godot Physics | None | ✅ Rapier (PIE-gated) |
| **Animation FSM** | AnimGraph | `AnimationMixer` only | ✅ AnimStateEditor (v0.38–0.50) |
| **Particles** | Niagara / GPUParticles | None | ◐ CPU Niagara-lite; GPU Wave 9 |
| **Navigation** | Recast | None | ✅ Recast WASM worker (v0.36) |
| **Multiplayer** | Replication graph | None | ◐ WebSocket relay, 10 Hz sync (v0.51–0.71) |
| **Audio** | MetaSounds / buses | `Audio` | ✅ MetaSounds-lite + HRTF (v0.39–0.62) |
| **UI** | UMG / Control nodes | None | ✅ DOM HUD + Widget3D (v0.29–0.64) |
| **AI** | BT + EQS + Perception | None | ✅ behaviorTree, EQS, sight (v0.28) |
| **World building** | Landscape, PCG, World Partition | None | ✅ All shipped v0.8–0.61 |
| **GI / Lumen** | Real-time GI | Env map + probes | ◐ LightProbeGrid (WebGPU), AO bake, path trace preview — **label honestly** |
| **Nanite** | Virtualized geometry | `BatchedMesh` | ⏳ LOD + batching; never call it Nanite |
| **Sequencer** | Full NLE | None | ✅ v0.12–0.70 |
| **Plugins** | Editor modules | None | ✅ Plugin API (v0.41) |
| **One-click export** | Platform SDKs | None | ✅ 22 KB HTML + PWA (v0.40) — **structural web advantage** |
| **Live debugger** | Socket protocol | None | ✅ `vektra.getLiveSnapshot()` (v0.37) — easier than Godot on web |
| **ECS / DOTS** | Mass / DOTS | None | Skip; InstancedMesh + SoA subsystems when needed |

### Lotus differentiation (keep investing)

1. **Edit → URL in seconds** — Godot's weakest platform is Lotus's native platform.
2. **Single runtime** — Blueprints, scripts, AI copilot compile to one script slot.
3. **Everything is an Actor** — new features inherit serialization, undo, Details, export free (Godot uniformity law).
4. **Web-native plugins** — hot-loaded JS, no compile chain.
5. **In-browser live debugger** — iframe/postMessage tree mirror during PIE.

---

## 8. Wave 9–12 roadmap

Prioritized by: (a) Three.js r184 strengths unlocking new capability, (b) highest-impact UE/Godot gap-list items, (c) CHECKPOINT v0.73+ queue.

### Wave 9 — "WebGPU foundations + bake polish" (v0.73–v0.78)

**Theme:** Prepare dual renderer; ship CHECKPOINT queue items that don't require full WebGPU migration.

| # | Deliverable | Three.js anchor | Gap-list / CHECKPOINT ref |
|---|-------------|-----------------|---------------------------|
| 9.1 | **GPU particles (opt-in)** — compute spawn/update, CPU fallback | `ComputeNode`, `StorageBufferNode`, `InstancedMesh` | CHECKPOINT #1 GPU particles |
| 9.2 | **AO bake worker + xatlas UV2** — proper lightmap unwrap | `xatlas-web`, transferable buffers | CHECKPOINT #4 xatlas |
| 9.3 | **Buffer viz polish** — AO/emissive/depth as post overrides | Depth prepass / `MeshDepthMaterial` | UE Buffer Visualization ◐ |
| 9.4 | **Material graph TSL backend (preview only)** | `MeshPhysicalNodeMaterial`, TSL | UE Material Editor ◐ |
| 9.5 | **Fixed physics timestep + `onPhysicsTick`** | — | Godot `_physics_process` |
| 9.6 | **Toolbar reorder + status bar** (save indicator shipped v0.69 — finish toolbar) | — | UE Editor Interface ◐ |
| 9.7 | **E2E: PIE physics + export roundtrip** | Playwright + `--enable-gpu` | UE Testing ◐ |

**Wave 9 exit criteria:** GPU particles demo scene at 50k particles on WebGPU tier; AO bake doesn't freeze UI; 16+ Playwright tests.

### Wave 10 — "Rendering tier + asset pipeline" (v0.79–v0.84)

**Theme:** PostProcessing migration; assets scale beyond base64 JSON.

| # | Deliverable | Three.js anchor | Gap-list ref |
|---|-------------|-----------------|--------------|
| 10.1 | **WebGPU quality tier toggle** — `World Settings → Rendering → Backend` | `WebGPURenderer.hasWebGPUAsync()` | — |
| 10.2 | **TSL post stack** — bloom, FXAA, SSAO, DOF via `PostProcessing` | `PassNode`, `AONode` | TSR/SSAO/DOF ◐ |
| 10.3 | **TAA (WebGPU tier)** | Velocity + temporal accumulate | TSR ◐ |
| 10.4 | **Asset pipeline v2** — IndexedDB blobs, KTX2, DRACO, import sidecars | `KTX2Loader`, `DRACOLoader` | Content Browser upgrade |
| 10.5 | **Static mesh LOD chains** — meshoptimizer + `THREE.LOD` | `LOD`, meshoptimizer | Nanite ◐ honest |
| 10.6 | **BatchedMesh export merge** | `BatchedMesh` | Draw call reduction |
| 10.7 | **Material instances → TSL uniforms** | `uniform()`, `NodeMaterial` | Material instances ✅ → upgrade |
| 10.8 | **`moveAndSlide` character controller** | Rapier kinematic | Godot census #6 |

### Wave 11 — "World scale + multiplayer" (v0.85–v0.90)

**Theme:** SSR, advanced GI approx, networking parity with Godot High-Level API.

| # | Deliverable | Three.js anchor | Gap-list ref |
|---|-------------|-----------------|--------------|
| 11.1 | **SSR + LightProbeGrid** (interior GI approx) | `LightProbeGrid`, `ViewportDepthTextureNode` | Lumen 🚫 → approx |
| 11.2 | **MP: dedicated server mode + lag compensation** | — | CHECKPOINT #3 MP polish |
| 11.3 | **MP: delta compression + interest management** | — | Networking ◐ |
| 11.4 | **Rapier joints editor** + raycast vehicle | Rapier joints / Jolt eval | Chaos Vehicles ◐ |
| 11.5 | **Full material editor on TSL** — deprecate GLSL inject | `NodeMaterialLoader` serialize | Material Editor ◐ |
| 11.6 | **Crowd avoidance** — DetourCrowd in nav worker | recast-navigation | Navmesh ◐ |
| 11.7 | **Landscape splat textures** (replace vertex paint) | Shader splatmap | Landscape paint upgrade |

### Wave 12 — "Polish + parity closure" (v0.91–v0.96)

**Theme:** Close remaining ◐ items; no new 🚫 promises.

| # | Deliverable | Notes |
|---|-------------|-------|
| 12.1 | **Behavior Tree editor** — visual graph + live highlight | UE AI ◐ |
| 12.2 | **Data table grid editor + curve assets** | UE Gameplay ◐ |
| 12.3 | **Project Settings modal** (global, not just World Settings) | UE Editor ◐ |
| 12.4 | **Nested prefab-in-prefab** | Level instances ◐ |
| 12.5 | **Voronoi fracture + strain** | Chaos Destruction upgrade |
| 12.6 | **SSGI quality preset** (opt-in, desktop WebGPU only) | r184 example; honest "approx" |
| 12.7 | **Command palette asset search** | UE Extensibility ◐ |
| 12.8 | **Rename: Vektra → Lotus Engine** | Docs, package, CLI, export banner |

---

## Key recommendations for Wave 9 (immediate)

These are the **highest-leverage next commits** given r184 capabilities and current codebase state:

### 1. GPU particles behind a feature flag (9.1)

- Add `src/engine/particlesGPU.ts` using TSL `ComputeNode` + existing `ParticleProps` schema (Godot param-parity trick).
- `World Settings → Niagara Backend: cpu | gpu`.
- Keep CPU path for WebGL export and Playwright (`--enable-gpu` only enables WebGL ANGLE today).
- **Why now:** r184 compute bounds checks + `StorageTextureNode` fixes make this the first Three.js release where compute particles are production-viable.

### 2. Move AO bake to worker + wire xatlas UV2 (9.2)

- `lightmapBake.ts` → `lightmapBakeWorker.ts` with `Float32Array` positions transferable.
- Call `xatlas-web` before bake; write `uv2` attribute + `aoMap` texture.
- **Why now:** `xatlas-web` already in `package.json`; v0.72 shipped vertex AO — UV2 is the documented next step.

### 3. Dual material backend stub (9.4)

- `compileMaterialGraphTSL()` in parallel to `materialShader.ts`; Material Editor preview sphere uses it when `r.MaterialBackend=tsl`.
- No user-facing breaking change.
- **Why now:** r184 `WebGLRenderer` NodeMaterial compatibility layer means TSL preview works on editor's existing WebGL renderer.

### 4. Fixed physics timestep (9.5)

- 60 Hz accumulator in `World.tick`; expose `api.onPhysicsTick` in script API.
- Stabilizes multiplayer prediction (v0.65) before Wave 11 lag compensation.

### 5. Particle bounds fix (quick win)

- Update `ParticleSystem` bounding sphere each tick → re-enable `frustumCulled`.
- Free perf win without new dependencies.

### 6. Do NOT default WebGPU in Wave 9

- Shadow/regression reports persist through r184 on some GPUs.
- Ship GPU particles as opt-in tier; editor viewport stays `WebGLRenderer` + `EffectComposer` until Wave 10 QA matrix.

---

## Appendix A — File map (Lotus ↔ Three.js touchpoints)

| Lotus module | Three.js APIs | Upgrade target |
|--------------|---------------|----------------|
| `src/editor/Viewport.tsx` | `WebGLRenderer`, `EffectComposer` | `WebGPURenderer`, `PostProcessing` |
| `src/engine/Actor.ts` | `Object3D`, `InstancedMesh`, `SkinnedMesh` | `pivot`, sockets |
| `src/engine/materialShader.ts` | `onBeforeCompile` | TSL `NodeMaterial` |
| `src/engine/particles.ts` | `Points`, `InstancedMesh`, custom ShaderMaterial | `ComputeNode` |
| `src/engine/physics.ts` | — (Rapier WASM) | joints, character controller |
| `src/engine/factory.ts` | `InstancedMesh` foliage | `BatchedMesh` |
| `src/engine/lightmapBake.ts` | `MeshStandardMaterial.aoMap` | xatlas `uv2` |
| `src/engine/navMeshWorker.ts` | — (Recast WASM) | DetourCrowd worker |
| `src/export/runtime.js` | `WebGLRenderer` | match editor backend tier |

## Appendix B — Explicit non-goals (carry forward)

From `ROADMAP.md` design laws and UE5.7-GAP-LIST 🚫 markers:

- Real Lumen, Nanite, Substrate, Motion Matching, Mass Entity at UE scale
- Control Rig graphs (IK-lite is enough)
- Full Lightmass / path-traced runtime GI
- Visual scripting as a **parallel** system (Blueprints compile to script slot — keep this)
- Desktop/native export as primary target — **web is the moat**

## Appendix C — Migration risks (r184 → r185+)

- Watch `three.js` Migration Guide each bump (`183→184` broke nothing critical for Lotus).
- `BatchedMesh` API still evolving — pin integration tests, not just visual QA.
- TSL is **API-unstable** — serialize material graphs as Lotus JSON, compile to TSL at runtime; don't persist raw TSL node graphs until `NodeMaterialLoader` format stabilizes.
- WebGPU Safari/iOS lag behind Chrome — feature-detect, never assume.

---

*This document supersedes ad-hoc rendering notes. Update when waves ship; rename file to `LOTUS-ENGINE-RESEARCH.md` with the Wave 12 rebrand.*