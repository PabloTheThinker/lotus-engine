# Changelog

Notable changes to Vektra Engine. Newest entries first.

---

## 2026-06-13 — v0.66 Baked AO (approx)

### Added
- **Lightmass-approx MVP:** hemisphere raycast AO bake to vertex colors (`src/engine/lightmapBake.ts`)
- **Build → Bake AO (approx)** + World Settings → Lighting (approx) with progress
- **Console:** `build ao` · **Devtools:** `vektra.BakeAO({ samples, radius })`
- **Serialization:** `bakedAO` flag + `bakedAOMeshes` color arrays; restored on load and in playable export

### Notes
- Labeled honestly as **Baked AO (approx)** — not Lightmass. Main-thread bake with chunked yields.

---

## 2026-06-13 — Agent swarm wave 7: v0.62–v0.67

### Added
- **v0.62 Audio:** attenuation falloff curves (linear/inverse/inverseSquare/custom), Sequencer audio tracks with scrubbing
- **v0.63 Blueprint:** exec breakpoints — pause PIE on node hit, F5 Continue, gutter toggle
- **v0.64 Widget3D:** CSS3DRenderer world-space HTML widgets (canvas fallback in export)
- **v0.65 Networking:** ownership (`netOwnerId`), client prediction + reconcile, `own` protocol message
- **v0.66 Lightmap:** Baked AO (approx) — hemisphere raycast via mesh-bvh, vertex colors, `build ao` console
- **v0.67 Tests:** Playwright expanded to **13 specs** — navmesh bake, material instance, blueprint compile, MP settings

### Verification
```bash
npm run build && npm run test   # 13 passed
```

---

## 2026-06-13 — Agent swarm wave 6: v0.59–v0.61 + expanded tests

### Added
- **v0.59 Particles P3:** mesh InstancedMesh renderer, sub-emitters on death/collision, 4-point size curve widget
- **v0.60 Material WPO:** GPU vertex displacement — WorldPosition, ObjectPosition, Noise → Output.wpo
- **v0.61 PCG graph editor:** visual node canvas (Sample→Filter→Transform→Spawn), 🎲 PCG bottom dock tab
- **Tests:** 9 Playwright specs — undo, play/stop, command palette, level save/load roundtrip

### Verification
```bash
npm run build && npm run test   # 9 passed
```

---

## 2026-06-13 — Agent swarm wave 5: v0.55–v0.58 (IK, BP flow, GAS effects, UX)

### Added
- **v0.55 IK:** two-bone IK + LookAt on glTF skeletons (`ik.ts`, Details IK section)
- **v0.56 Blueprint flow:** Gate, MultiGate, SwitchInt, BindSignal, CallSignal nodes
- **v0.57 GAS effects:** duration modifiers, tag grant/remove, `api.applyEffect` / `api.removeEffect`
- **v0.58 Editor UX:** camera bookmarks persist in level; Modes dropdown; Label3D billboard actor

---

## 2026-06-13 — Agent swarm wave 4: v0.49–v0.54 (path trace, blend2D, MP sync, widget anims, streaming, tests)

### Added
- **v0.49 Path tracer:** `pathtraced` view mode + `r.PathTracer 0|1` console cvar; `WebGLPathTracer` (three-gpu-pathtracer) progressive samples in single-pane perspective
- **v0.50 Blend space 2D:** `AnimStateEditor` Blend 2D tab — draggable samples, Delaunay triangulation, barycentric `tickBlendSpace2D` runtime
- **v0.51 Multiplayer sync:** host authority via lexicographic peer id; `sync` property deltas @ 10 Hz; `spawn`/`despawn` replication; Details Network section (Sync Spawn + per-property checklist)
- **v0.52 Widget animations:** Sequencer `+ HUD Track…` — opacity/left/top/width/color keys on authored HUD widgets; `applyHudCssProperty` at scrub/play
- **v0.53 Grid streaming:** World Settings → grid size (64m), load radius, export-by-cell; actors tagged `streamCell: [cx,cz]` (auto on save); camera-radius cell visibility in editor + play; `show streaming` console grid overlay; optional per-cell export manifest + `api.loadCell(cx,cz)` in playable runtime
- **v0.54 Playwright smoke tests:** `npm run test` — 5 specs (build, editor load, `window.vektra` bridge, terminal spawn, viewport WebGL + FPS stats); `@playwright/test` + `playwright.config.ts` with GPU flags

### Changed
- `exportPlayable` splits actors into per-cell JSON when `streaming.exportByCell` is enabled
- Multiplayer relay protocol extended with `sync` / `spawn` / `despawn` message types

### Verification
```bash
cd "~/Vektra Industries/Software/vektra-engine"
npm install
npm run build   # exit 0
npm run test    # 5 passed
```

---

## 2026-06-13 — Agent swarm wave 3: v0.44–v0.48 (material GPU, quad viewports, shortcuts, drawer, curves)

### Added
- **v0.44 Material editor v2:** GPU mode via `onBeforeCompile` (`materialShader.ts`) — UV, TextureSample, Fresnel, Noise nodes; CPU/GPU toggle; live preview sphere in `MaterialEditor`
- **v0.45 Quad viewports:** `viewportLayout.ts` — single/quad 2×2 scissor panes (Perspective/Top/Front/Side), pane maximize/restore, per-pane camera + gizmo focus; prefs in localStorage
- **v0.46 Keyboard shortcuts:** `ShortcutEditor` modal (Edit → Editor Preferences → Keyboard Shortcuts…); 25 rebindable bindings in `SHORTCUT_REGISTRY`; overrides in `vektra-engine.shortcuts`
- **v0.47 Content Drawer polish:** 📌 Dock in Layout pin (`contentDrawerDocked`); color-coded `asset-type-stripe` on tiles; right-click Rename (F2) / Duplicate on materials, MetaSounds, prefabs, imports
- **v0.48 Bezier curves:** Sequencer `bezier` interp (⌇) + `CurveEditor` panel with draggable in/out tangent handles; cubic evaluation in `sequencer.ts`

### Changed
- `App.tsx` routes editor hotkeys through `matchesShortcutId` (respects user rebinding)
- Status bar shows drawer dock state; Content Drawer floating vs docked layout

### Verification
```bash
cd "~/Vektra Industries/Software/vektra-engine"
npm run build   # exit 0
```

---

## 2026-06-13 — Agent swarm wave 2: v0.38–v0.43 (animation, audio, export, plugins, GAS)

### Added
- **v0.38 FSM + blend space:** `AnimStateEditor` bottom-dock tab — draggable state nodes, transition arrows, 1D blend space lerp; `tickAnimSM` / `tickBlendSpace1D` runtime
- **v0.39 MetaSounds-lite:** `MetaSoundEditor` — Oscillator/Gain/Filter/ADSR/Noise/Buffer → WebAudio topology; `MetaSoundAsset` library; `SoundEmitter` actor; HRTF `PannerNode` spatialization; TriggerVolume reverb zones (`ConvolverNode`)
- **v0.40 Multi-level export:** World Settings linked levels → `window.__VEKTRA_LEVELS__` in playable HTML; `api.loadLevel('key')` during PIE; PWA manifest + service-worker stub; mobile/desktop export quality presets
- **v0.40 BP functions/macros:** `collapseToFunction` + `CallFunction` nodes inlined at compile; function subgraph editor in Blueprint panel
- **v0.41 Plugin API:** `registerNodeType` / `registerPanel` / `registerImporter` / `registerConsoleCommand`; Plugin Manager modal; drag-drop `.js` install; example-hello plugin
- **v0.42 GAS-lite:** attribute sets + ability assets (localStorage); per-actor assignment in Details; `api.activateAbility` / `api.getAttribute` / `api.setAttribute`; BT `activateAbility` task
- **v0.42 Viewport + particles:** piercing pick menu (Ctrl+RMB / select mode); ribbon trail renderer; 4-stop color gradient widget; ground-bounce via heightfield lookup

### Changed
- `exportPlayable` bundles linked levels + optional PWA head/boot script
- `audio.ts` routes playback through bus mixer + HRTF panner (replaces manual distance falloff)
- Behavior trees can invoke assigned abilities via `activateAbility` task node

### Verification
```bash
cd "~/Vektra Industries/Software/vektra-engine"
npm install
npm run build   # exit 0
npm run dev     # :5173 default
```

---

## 2026-06-13 — Agent swarm wave 1: v0.33–v0.37 (functional completeness wave)

### Added
- **v0.33 Blueprint completion:** `onConstruct` construction scripts (spawn + gizmo move), Blueprint exec pulse debugger (`__bpPulse`), Level BP button (`LevelScript` actor)
- **v0.34 Material assets:** shareable `MaterialAsset` library (localStorage), per-actor instances with overrides, Content Browser Materials tab, Details Material Instance section
- **v0.35 Prefab overrides:** Godot-style `prefabSource` / `prefabOverrides` with per-field revert (⟲) in Details
- **v0.36 Recast navmesh:** `recast-navigation` WASM bake (worker), `show navmesh` console command, World Settings Bake + Show toggle, grid A* fallback
- **v0.37 Live debugger:** Debug panel Live Tree + Monitors tabs, live Details during Play, `window.vektra.getLiveSnapshot()`, per-actor tick profiler bars

### Changed
- `AddActorCommand` runs construction scripts on every actor spawn
- `api.findPath` uses Recast polygon paths when navmesh is baked
- Property commands skip undo stack during Play (live edit without pollution)

### Fixed
- Build-breaking TS errors in `scripting.ts` / `spawn.ts` (v0.33 in-flight cluster)

### Verification
```bash
cd "~/Vektra Industries/Software/vektra-engine"
npm install
npm run build   # exit 0
npm run dev     # :5173 default
```