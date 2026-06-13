# Changelog

Notable changes to Vektra Engine. Newest entries first.

---

## 2026-06-13 — Agent swarm: v0.33–v0.37 (functional completeness wave)

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