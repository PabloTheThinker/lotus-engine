# Changelog

Notable changes to Vektra Engine. Newest entries first.

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