# Changelog

Notable changes to Lotus Engine. Newest entries first.

---

## 2026-06-14 — Waves 76–80: v4.19–v4.43 (indie swarm)

### Wave 76 (v4.19–v4.23) — AI navmesh agents
- `gridNavAgents.ts` — per-layer crowd on grid navmesh; `/gridnavagent`

### Wave 77 (v4.24–v4.28) — itch.io release notes
- `itchReleaseNotes.ts` — CHANGELOG slice; `RELEASE_NOTES.md` in itch zip

### Wave 78 (v4.29–v4.33) — MP killcam
- `mpKillcam.ts` — 5s replay seek on `player_killed`; 3s overlay

### Wave 79 (v4.34–v4.38) — Haptic profiles
- Desktop strong / mobile light haptics linked to input profiles

### Wave 80 (v4.39–v4.43) — Save slot UI
- `exportSaveMenu.ts` — Escape pause menu with Save/Load slots 1–3

### Fixed
- Wave 62 zip test — expect `RELEASE_NOTES.md` in itch pack
- Wave 73 relay — stable host + spectator role election

### Verification
```bash
cd "~/Vektra Industries/Software/lotus-engine"
npm run build && npm run test   # 344 passed
```

---

## 2026-06-14 — Waves 71–75: v3.94–v4.18 (indie swarm)

### Wave 71 (v3.94–v3.98) — Grid navmesh bake
- `gridNavmeshBake.ts` — Recast bake per grid layer mask; `/gridnavmesh`

### Wave 72 (v3.99–v4.03) — itch.io version channels
- Butler `:html` / `:beta` / `:demo` channel suffixes; `/butlerhint platformer beta`

### Wave 73 (v4.04–v4.08) — MP replay buffer
- 30s pose ring @ 10 Hz; spectator **R** rewind; `replay_sample` relay

### Wave 74 (v4.09–v4.13) — Adaptive haptics
- `adaptiveHaptics.ts` — scale by perf gate, battery saver, intensity slider

### Wave 75 (v4.14–v4.18) — Cross-level saves
- `__global__` save namespace; `migrateToLevel` on `changeScene`; `__LOTUS_CROSS_LEVEL_SAVES__`

### Verification
```bash
cd "~/Vektra Industries/Software/lotus-engine"
npm run build && npm run test   # 319 passed
```

---

## 2026-06-14 — Waves 66–70: v3.69–v3.93 (indie swarm)

### Wave 66 (v3.69–v3.73) — Tile collision layers
- `gridCollisionLayers.ts` — per-layer Rapier collision groups on grid tile colliders

### Wave 67 (v3.74–v3.78) — itch.io Butler CLI hint
- `itchButlerHint.ts` — `/butlerhint`, `butler push` command from pack meta

### Wave 68 (v3.79–v3.83) — MP spectator mode
- `mpSpectator.ts` — orbit camera, no pawn; `spectator_join` relay; `/mpspectator`

### Wave 69 (v3.84–v3.88) — Gamepad haptics
- `gamepadHaptics.ts` — `dual-rumble` on Fire/Interact when supported

### Wave 70 (v3.89–v3.93) — Cloud save stub
- `cloudSaveStub.ts` — IndexedDB backup of checkpoints; `__LOTUS_CLOUD_SAVES__`

### Verification
```bash
cd "~/Vektra Industries/Software/lotus-engine"
npm run build && npm run test   # 294 passed
```

---

## 2026-06-14 — Waves 61–65: v3.44–v3.68 (indie swarm)

### Wave 61 (v3.44–v3.48) — Custom autotile sheets
- `autotileSheetImport.ts` — PNG atlas import, 4×4 tile mapping UI in Details

### Wave 62 (v3.49–v3.53) — itch.io upload helper
- `itchUploadPack.ts` — client-side PK zip: `index.html` + `meta.json` + `icon.png`
- `/itchpack platformer|rpg|fps`

### Wave 63 (v3.54–v3.58) — MP dedicated server
- `scripts/dedicated-server.mjs`, `npm run dedicated` — headless host `000000`

### Wave 64 (v3.59–v3.63) — Touch haptics
- `touchHaptics.ts` — Vibration API on Fire/Interact/Jump; export + PIE

### Wave 65 (v3.64–v3.68) — Save system
- `saveSystem.ts` — localStorage checkpoints; `api.saveGame` / `__LOTUS_SAVES__`

### Verification
```bash
cd "~/Vektra Industries/Software/lotus-engine"
npm run build && npm run test   # 269 passed
```

---

## 2026-06-14 — Waves 56–60: v3.19–v3.43 (indie swarm)

### Wave 56 (v3.19–v3.23) — Autotile art
- `autotileAtlas.ts` — 16-tile UV atlas, per-instance shader UV rects
- `gridAutotileAtlas` toggle; Details atlas preview legend

### Wave 57 (v3.24–v3.28) — Export pack polish
- `exportPackMeta.ts` — itch.io sidecar (`__LOTUS_PACK_META__`)
- `captureExportScreenshot.ts`; `/exportpackmeta`

### Wave 58 (v3.29–v3.33) — MP matchmaking
- `mpMatchmaking.ts` — relay room list + ping; lobby HUD room browser

### Wave 59 (v3.34–v3.38) — Input profiles
- `inputProfiles.ts` — desktop/mobile presets; save/load custom profiles

### Wave 60 (v3.39–v3.43) — Level streaming UX
- `streamingProgress.ts` — export cell-load progress bar (`__LOTUS_STREAMING__`)

### Verification
```bash
cd "~/Vektra Industries/Software/lotus-engine"
npm run build && npm run test   # 244 passed
```

---

## 2026-06-14 — Waves 51–55: v2.94–v3.18 (indie swarm)

### Wave 51 (v2.94–v2.98) — TileMap autotile rules
- 8-neighbor masks, corner sprites, `resolveAutotileKind` majority vote
- `gridAutotileRules` toggle; per-cell kind in `rebuildFoliage`

### Wave 52 (v2.99–v3.03) — Mini-game export pack
- `miniGameExportPack.ts` — PWA pack HTML per genre
- `/exportpack platformer|rpg|fps`; `__LOTUS_MINIGAME_PACK__`

### Wave 53 (v3.04–v3.08) — MP lobby
- `mpLobby.ts` — ready-up state; relay `lobby_join`/`lobby_ready`/`lobby_start`
- `/mplobby`, deathmatch spawns after all ready; relay smoke test

### Wave 54 (v3.09–v3.13) — Input rebinding
- `inputBindings.ts` — gamepad button + touch slot overrides in localStorage
- World Settings rebinding UI; export `__LOTUS_INPUT_BINDINGS__`

### Wave 55 (v3.14–v3.18) — Scene transitions
- `sceneTransitions.ts` — fade/slide overlays on `selectLevel` and `changeScene`
- Export runtime + `indie.flow.transition` / `fadeToLevel`

### Verification
```bash
cd "~/Vektra Industries/Software/lotus-engine"
npm run build && npm run test   # 219 passed
```

---

## 2026-06-14 — Waves 46–50: v2.69–v2.93 (indie swarm)

### Wave 46 (v2.69–v2.73) — TileMap polish
- `gridLayerVisibility`, `gridAutotilePreview` on FoliageProps
- Viewport per-layer visibility + autotile bitmask hover preview
- `setGridLayerVisible`, `previewAutotileMask`; Details layer visibility checkboxes

### Wave 47 (v2.74–v2.78) — Mini-game polish
- `miniGameHud.ts` — win/lose DOM overlays; `game_lost` timeout
- `/minigameexport platformer|rpg|fps`; export `__LOTUS_MINIGAME__`
- `indie.minigame.showHud` / `exportPreset`

### Wave 48 (v2.79–v2.83) — MP score sync
- Host broadcasts `peerScores` to clients; `getMpPeerScores` / `mirrorScores`
- Scoreboard lists all peers; `mp_game_won` relay smoke test

### Wave 49 (v2.84–v2.88) — Input polish
- `touchLayoutPresets.ts` — compact / wide / fps CSS vars
- Export overlay gamepad glyph hints; `indie.touch` layout preset APIs

### Wave 50 (v2.89–v2.93) — Scene flow
- `mainMenuFlow.ts` — `/mainmenu`, level picker (Platformer/RPG/FPS/MP)
- Export `__LOTUS_MAIN_MENU__`; `indie.flow.selectLevel`

### Verification
```bash
cd "~/Vektra Industries/Software/lotus-engine"
npm run build && npm run test   # 194 passed
```

---

## 2026-06-14 — Waves 41–45: v2.44–v2.68 (indie swarm)

### Wave 41 (v2.44–v2.48) — TileMap layers + autotile
- `gridMap.ts` — `paintGridLayer`, `eraseGridLayer`, `getLayerCellCount`, `autotileNeighbors`
- `FoliageProps` — `activeGridLayer`, `gridLayers`, `gridAutotile`
- Details layer picker; Viewport layer overlay; `window.lotus.gridMap` layer APIs

### Wave 42 (v2.49–v2.53) — Starter mini-games
- `starterMiniGames.ts` — platformer/RPG/FPS win scripts + goal zones
- `/minigame platformer|rpg|fps` terminal command; `game_won` signal
- `window.lotus.indie.minigame` bridge

### Wave 43 (v2.54–v2.58) — MP deathmatch + score
- `mpGameplay.ts`, `indieMpGameplay.ts` — scoreboard, target tag, first-to-3 wins
- `/mpdeathmatch`, `spawnIndieMpDeathmatch`, `api.getMpScore` / `addMpScore`
- Multiplayer relay smoke: host score authority

### Wave 44 (v2.59–v2.63) — Touch Fire/Interact + gamepad
- `touchInput.ts` — fire/interact just-pressed; `touchOverlay.ts` action buttons
- `gamepadInput.ts` — stick + A/B actions; export `__LOTUS_GAMEPAD__`
- `window.lotus.indie.touch` + `gamepad` bridges

### Wave 45 (v2.64–v2.68) — 2D blend ↔ @export
- `blendScriptVarLinkX` / `blendScriptVarLinkY` on actors
- AnimStateEditor 2D param link fields; `resolveAnimParams` reads linked script vars

### Fixed
- Export E2E overlay assertions — accept gamepad/touch boot copy (Wave 44)
- MP relay test — stable host election poll before score assert

### Verification
```bash
cd "~/Vektra Industries/Software/lotus-engine"
npm run build && npm run test   # 169 passed
```

---

## 2026-06-14 — Waves 36–40: v2.19–v2.43 (indie swarm)

### Wave 36 (v2.19–v2.23) — GridMap UX
- `gridMap.ts` — cell paint/erase/brush helpers
- Details tile palette + grid brush; Viewport grid overlay + hover coords
- `window.lotus.gridMap` bridge

### Wave 37 (v2.24–v2.28) — Starter packs
- `spawnTopDownRpgStarter(small|large)`, `spawnFpsStarter()`
- `/rpg`, `/fps` terminal commands

### Wave 38 (v2.29–v2.33) — MP indie template
- `indieMpTemplate.ts` — HostSpawn, ClientSpawn, sync crates
- `configureIndieMpSettings`, `/mpstarter`, `api.mpIsHost` etc.
- 2-tab relay smoke test

### Wave 39 (v2.34–v2.38) — Touch input PWA
- `touchInput.ts`, `touchOverlay.ts`, MoveForward/MoveRight actions
- World Settings touch toggle; export `__LOTUS_TOUCH__`
- `window.lotus.indie.touch` bridge

### Wave 40 (v2.39–v2.43) — Animation polish
- `scriptVarPresets.ts` — curve presets as .tres resources
- `applyScriptVarPreset`, blend ↔ `@export` link, Sequencer Apply Preset UI

### Verification
```bash
cd "~/Vektra Industries/Software/lotus-engine"
npm run build && npm run test   # 144 passed
```

---

## 2026-06-14 — Wave 35: v2.14–v2.18 (indie / Godot focus)

### Added
- **v2.14** Editable children UX — prefab subtree panel in Details, ≠ override diff gutter in Details + Outliner
- **v2.15** Sequencer ↔ `@export` — `scriptVar` tracks sample into `actor.scriptVars` during scrub/play
- **v2.16** Resource (.tres) lite — `resources.ts` with UUID JSON assets (material/curve/shape kinds)
- **v2.17** Platformer starter — `/platformer side|wide` greybox (floor + stepping platforms + PlayerStart)
- **v2.18** Docs sync + 5 smoke tests — 120 tests passed

### Changed
- `window.lotus.indie` bridge: `prefab.subtree`, `prefab.overrideDiff`, `sequencer`, `resources`, `spawnPlatformerStarter`

### Verification
```bash
cd "~/Vektra Industries/Software/lotus-engine"
npm run build && npm run test   # 120 passed
```

---

## 2026-06-14 — Wave 34: v2.09–v2.13 (indie / Godot focus)

### Added
- **v2.09** `@export_range` — `// @export_range speed 0 10 0.5 = 2` → clamped slider in Details
- **v2.10** `@export_enum` — `// @export_enum mode walk,run,fly = run` → dropdown in Details
- **v2.11** Area3D actor — overlap volume, `body_entered:` / `body_exited:` signals, optional group filter
- **v2.12** Prefab instance polish — override summary, Revert All, 📦 outliner badge on prefab children
- **v2.13** Character starter — `/starter thirdperson|firstperson|fly` greybox scene — 115 tests passed

### Changed
- `parseExports` returns `kind: plain|range|enum` with min/max/step/options metadata
- `window.lotus.indie` bridge: `exports`, `prefab`, `areaOverlaps`, `spawnCharacterStarter`

### Verification
```bash
cd "~/Vektra Industries/Software/lotus-engine"
npm run build && npm run test   # 115 passed
```

---

## 2026-06-14 — Wave 33: v2.04–v2.08 (indie / Godot focus)

### Added
- **v2.04** Timer actor — wait, oneShot, autostart, `timeout:${name}` signal during Play
- **v2.05** RayCast3D actor — per-frame ray, `hit:` / `clear:` signals, arrow gizmo
- **v2.06** Path3D + PathFollow3D — Catmull-Rom waypoints, progress/speed/loop along spline
- **v2.07** Godot groups (`groups[]`, `api.getActorsInGroup`), Project Settings autoload names + main scene key
- **v2.08** `api.changeScene` alias, export `__LOTUS_MAIN__` from main scene key, `docs/INDIE-GAME-ROADMAP.md` — 110 tests passed

### Changed
- Strategic focus documented in `docs/CHECKPOINT.md` — indie Godot parity over UE 5.7 gap chasing
- `window.lotus.indie` test bridge (`spawn`, `samplePath`, `isAutoload`, `scriptApi`)
- Place Actors palette: Timer, RayCast3D, Path3D, Path Follow

### Verification
```bash
cd "~/Vektra Industries/Software/lotus-engine"
npm run build && npm run test   # 110 passed
```

---

## 2026-06-14 — Wave 32: v1.99–v2.03

### Added
- **v1.99** PNG LUT atlas decode + level persist — `decodePngLUTAtlas`, `persistDecodedLUTToEnvironment`, `restoreGradingLUTFromEnvironment` on load
- **v2.00** GPU batched sub-burst kernel — `runParticleGPUSubEmitterBurstBatch`, `gpuSubBurstSpawnBatch` single-dispatch multi-death path
- **v2.01** Export LUT payload — `window.__LOTUS_LUT__`, `decodeExportLUTTexture` + TSL atlas sampling in playable runtime
- **v2.02** BT nested subtree step-into (`getBTSubtreeServiceNodeIds`) + live PIE blackboard watch panel (`.bt-bb-watch`)
- **v2.03** Material Shift+Tab reverse focus cycle + `.mat-wire-pin-preview` on canvas wires during legend drag — 105 tests passed

### Changed
- `colorGrading.decodePng` / `persistLut` / `restoreLut` / `exportLutPayload` bridges; `particles.gpuSubBurstBatchReady` bridge
- `bt.subtreeServiceIds` bridge; collapse decorator subtrees now stash attached service nodes

### Verification
```bash
cd "~/Vektra Industries/Software/lotus-engine"
npm run build && npm run test   # 105 passed
```

---

## 2026-06-14 — Wave 31: v1.94–v1.98

### Added
- **v1.94** `.cube`/`.3dl` LUT decode — `parseCubeLUT`, `parse3dlLUT`, `decodeGradingLUTFile`, 2D atlas UV sampling
- **v1.95** GPU sub-emitter burst kernel — `runParticleGPUSubEmitterBurst`, `gpuSubBurstSpawn` on GPU particle path
- **v1.96** Export `applyLutGrading` parity in playable runtime post stack
- **v1.97** BT `blackboard-equals` conditional breakpoint + step-into host → service break
- **v1.98** Material Tab node focus cycle + legend drag minimap pin preview — 100 tests passed

### Changed
- `colorGrading.parseCube` / `decodeLut` bridges; `bt.stepIntoBreakpoint` / `activeBlackboard` bridges
- World Settings LUT upload reads file text and decodes on import

### Verification
```bash
cd "~/Vektra Industries/Software/lotus-engine"
npm run build && npm run test   # 100 passed
```

---

## 2026-06-14 — Wave 30: v1.89–v1.93

### Added
- **v1.89** LUT apply in grading pass — `applyGradingLUTTSL`, WebGL `lutMap` uniforms, World Settings LUT strength slider
- **v1.90** GPU sub-emitter burst uniforms — `subEmitterCountU/SpeedU/LifeU/RateU` on integrate kernel; `getGPUSubEmitterUniforms()`
- **v1.91** Export grading preset thumbnails + `blendGradingCompare()` in playable runtime
- **v1.92** BT step-over breakpoint + conditional modes (`always`, `service-active`, `decorator-host`)
- **v1.93** Material legend↔pin bidirectional `syncChannelPin` + eased minimap focus pan — 95 tests passed

### Changed
- `colorGrading.lutApply()` bridge; `bt.stepOverBreakpoint` / `shouldBreakpointFire` / `breakpointCondition` bridges

### Verification
```bash
cd "~/Vektra Industries/Software/lotus-engine"
npm run build && npm run test   # 95 passed
```

---

## 2026-06-14 — Wave 29: v1.84–v1.88

### Added
- **v1.84** TSL post LUT upload stub + preset A/B compare — `postColorGradingLut.ts`, `blendColorGradingSettings`, World Settings LUT file input + compare slider
- **v1.85** GPU sub-emitter death bursts — `snapshotAliveForGPU`, `processGPUSubEmitterDeaths` on GPU integrate path
- **v1.86** Export grading preset ACES parity — `postPresetAces`, `postGradingCompareT` blend in playable runtime
- **v1.87** BT service decorator breakpoint polish — `getBTServiceHostNodeId` / `getBTServiceDecoratorHostId`, gutter host highlight + auto-scroll
- **v1.88** Material minimap click-to-focus + channel pin sync — `syncChannelPin`, focused node minimap stroke, pin z-index fix — 90 tests passed

### Changed
- `colorGrading.compareT` / `blend` / `lutStub` bridges on `window.lotus`
- `bt.serviceHost` / `bt.serviceDecoratorHost` bridges

### Fixed
- Material output channel pins no longer blocked by overlapping `.bp-port` elements (z-index)

### Verification
```bash
cd "~/Vektra Industries/Software/lotus-engine"
npm run build && npm run test   # 90 passed
```

---

## 2026-06-14 — Wave 28: v1.79–v1.83

### Added
- **v1.79** Color grading preset thumbnails + per-preset ACES — `postPresetAces`, `getPresetACESEnabled()`, World Settings thumbnail grid
- **v1.80** GPU particle ground bounce — `groundYU`/`groundBounceU` on integrate kernel; CPU `skipGroundBounce` when GPU handles terrain
- **v1.81** Export cinematic focus-pull — `resolveExportDofFocus()` + `findExportFocusPullCamera()` in playable runtime
- **v1.82** BT diff gutter multi-select (Shift/Ctrl+click) + `exportBTScriptDiffPatch` + `resolveBTScriptDiffGutterSelection`
- **v1.83** Material legend Shift+pin minimap channel + solo upstream graph flash — 85 tests passed

### Changed
- `colorGrading.presetAces()` / `presetThumbnails()` bridges
- `bt.exportDiffPatch()` / `resolveDiffGutterSelection()` bridges

### Verification
```bash
cd "~/Vektra Industries/Software/lotus-engine"
npm run build && npm run test   # 85 passed
```

---

## 2026-06-14 — Wave 27: v1.74–v1.78

### Added
- **v1.74** Color grading presets — `postColorGradingPreset` (neutral/cinematic/highContrast) + exposure-linked LGG scaling
- **v1.75** ACES exposure polish — `getACESExposure()` with highlight rolloff bias on TSL + export
- **v1.76** GPU particle collision — sphere bounce on integrate kernel (`collisionRadius`/`collisionBounce` uniforms)
- **v1.77** Export DOF sequencer parity — `dofFocusDistance`/`fov` scalar tracks + `setDofFocus()` on TSL pipeline
- **v1.78** BT gutter batch-resolve + PIE script resync; material minimap wheel zoom + legend drag-reorder — 80 tests passed

### Changed
- `world.resyncActorScript()` on BT compile-to-script during PIE
- `bt.resolveDiffGutter` + `colorGrading.preset` / `acesExposure` bridges

### Verification
```bash
cd "~/Vektra Industries/Software/lotus-engine"
npm run build && npm run test   # 80 passed
```

---

## 2026-06-14 — Wave 26: v1.69–v1.73

### Added
- **v1.69** TSL post full LGG — `applyColorGradingTSL` lift/gamma/gain on WebGPU (replaces gain-only stub)
- **v1.70** ACES filmic tonemap stub — `postAces` env + `acesFilmicToneMapping` in editor/export TSL pipelines
- **v1.71** GPU particle wind/rotation — Niagara modules on integrate kernel (`windX/Y/Z`, `rotationSpeed` uniforms)
- **v1.72** Export TSL color grading parity — LGG + ACES block in `createExportTSLPipeline`
- **v1.73** BT diff scroll/jump + material minimap drag-pan + channel legend — 74 tests passed

### Changed
- `window.lotus.colorGrading.acesEnabled()` + `bt.diffLineTargets` + `bt.scrollRectForNode` bridges
- BT canvas scrollable with gutter `≠` scroll-into-view; compile diff lines click-to-jump

### Verification
```bash
cd "~/Vektra Industries/Software/lotus-engine"
npm run build && npm run test   # 74 passed
```

---

## 2026-06-14 — Wave 25: v1.64–v1.68

### Added
- **v1.64** DOF focus pull sequencer track — `dofFocusDistance` keyable on Camera actors; drives `cameraProps` during scrub/PIE
- **v1.65** Color grading LUT stub — `postStackColorGrading.ts` lift/gamma/gain WebGL pass + TSL gain; World Settings toggle
- **v1.66** Export sub-emitter parity — `spawnBurstAt` on death in playable `runtime.js`; `__LOTUS_EXPORT_SUB_EMITTER_QA__`
- **v1.67** Perf gate re-probe — `scheduleExportPerfProbe()` on save/autosave/export
- **v1.68** BT gutter click-to-jump + service compile hint; material minimap solo highlight + zoom hint — 69 tests passed

### Changed
- `window.lotus.colorGrading.settings()` + `bt.serviceCompileHint` + `export.schedulePerfProbe` bridges

### Verification
```bash
cd "~/Vektra Industries/Software/lotus-engine"
npm run build && npm run test   # 69 passed
```

---

## 2026-06-14 — Wave 24: v1.59–v1.63

### Added
- **v1.59** DOF per-camera override + cinematic focus pull — `CameraProps.dofOverride`, `dofFocusPull*`; `getDOFSettings(env, camera, focusPullT)`; CineCamera Details panel
- **v1.60** Export ribbon E2E — playable boot + `__LOTUS_EXPORT_RIBBON_QA__.trailTris` trail assert
- **v1.61** Export perf gate status bar badge — `probeExportPerfGate()` iframe probe, `exportPerfGate` store
- **v1.62** BT script diff gutter markers — `getBTScriptDiffGutterNodeIds`, inline `≠` on changed service/composite nodes
- **v1.63** Material minimap pan/zoom viewport sync — canvas layer transform, minimap viewport rect + click-to-pan — 64 tests passed

### Changed
- `window.lotus.dof.settings(camera, focusPullT)` + `dof.resolveFocusPull` bridges
- `window.lotus.bt.diffGutter` + `export.probePerfGate` bridges

### Verification
```bash
cd "~/Vektra Industries/Software/lotus-engine"
npm run build && npm run test   # 64 passed
```

---

## 2026-06-13 — Wave 23: v1.54–v1.58

### Added
- **v1.54** DOF env sliders — `postDofFocusDistance` / `postDofFocalLength` / `postDofBokehScale` + WebGL vignette focus/aperture; `getDOFSettings()` bridge
- **v1.55** Export ribbon particles — trail buffers, GPU `trailShift` kernel, ribbon mesh render in `runtime.js`
- **v1.56** GitHub Actions CI — `.github/workflows/ci.yml` with `npm run test` + `npm run perf:gate`
- **v1.57** BT script compile diff panel — `diffBTScriptPreview`, services line in diff output
- **v1.58** Material graph minimap + Alt+1–9 solo channel shortcut — 59 tests passed

### Changed
- TSL + export pipelines read DOF params from level environment
- `window.lotus.dof.settings()` + `bt.diffScript` bridges

### Verification
```bash
cd "~/Vektra Industries/Software/lotus-engine"
npm run build && npm run test   # 59 passed
npm run perf:gate
```

---

## 2026-06-13 — Wave 22: v1.49–v1.53

### Added
- **v1.49** TSL DOF bokeh — `DepthOfFieldNode` in editor + export TSL pipelines (replaces vignette stub on WebGPU)
- **v1.50** TSL SSR ground — `createTSLSSRGroundMesh` / `syncTSLSSRGround`; live WebGL ground sync on env toggle
- **v1.51** Export WebGPU particle E2E — playable boot test with `renderBackend: webgpu` + `particleBackend: gpu`
- **v1.52** CI perf gate — `npm run perf:gate` (`scripts/export-perf-gate.mjs`) headless `__LOTUS_EXPORT_PERF__` probe
- **v1.53** BT service breakpoint + compile preview; Material TSL solo channel isolate — 55 tests passed

### Changed
- `window.lotus.bt.summarizeServices` + `materialTSL.soloChannel` bridges
- Service nodes fire `__btBreakpoint` during PIE tick; BT Editor “Services compile” panel

### Verification
```bash
cd "~/Vektra Industries/Software/lotus-engine"
npm run build && npm run test   # 55 passed
npm run perf:gate               # headless export fps probe
```

---

## 2026-06-13 — Wave 21: v1.44–v1.48

### Added
- **v1.44** SSR ground reflector — `postSsrGround` + `ReflectorForSSRPass` in WebGL post stack; `groundReflect` on SSR settings
- **v1.45** DOF stub — `postStackDOF.ts` vignette pass; WebGL + TSL `dofOn` wiring; World Settings toggle
- **v1.46** GPU ribbon trail shift kernel — `bindParticleTrailKernel` / `runParticleGPUTrailShift`; `kernel.trail` QA check
- **v1.47** BT service PIE highlight + compile — `serviceNodeId` in compiled `__btServices`; `getActiveBTServiceNodeIds` bridge
- **v1.48** Material TSL live preview on wire connect — `previewChannelForPort`, flash badge; export `perfMinFps: 20`; Playwright wave 21 tests (51 passed)

### Changed
- `window.lotus.bt.activeServiceNodeIds` + `materialTSL.previewChannelForPort` bridges
- Export `__LOTUS_EXPORT__` embeds `perfMinFps` for runtime perf regression gate

### Verification
```bash
cd "~/Vektra Industries/Software/lotus-engine"
npm run build && npm run test   # 51 passed
```

---

## 2026-06-13 — Wave 20: v1.39–v1.43

### Added
- **v1.39** SSR quality presets — `postSsrPreset` (low/medium/high); `getSSRSettings` + WebGL/TSL/export compositor parity
- **v1.40** GPU ribbon trail buffers — `simBuffers().trail`, `shiftAllRibbonTrails()` on GPU integrate path
- **v1.41** Export perf regression gate — `__LOTUS_EXPORT_PERF__.perfPass` vs `perfMinFps` (default 24)
- **v1.42** BT collapsed subtree script compile — `compileBTGraphToScript` merges stashes; breakpoint hits stashed nodes
- **v1.43** Material Editor wire drag + live Output channel pins; Playwright wave 20 tests (46 passed)

### Changed
- `window.lotus.ssr.settings()` bridge; viewport stats show `SSR(preset)`
- Material input ports highlight when wired; Substrate nodes in add menu
- `particles.qaMatrix` adds `ribbon.trail` check

### Verification
```bash
cd "~/Vektra Industries/Software/lotus-engine"
npm run build && npm run test   # 46 passed
```

---

## 2026-06-13 — Wave 19: v1.33–v1.38 (UE-inspired parity)

### Added
- **v1.33** BT services + decorators — `TimeLimit`, `BlackboardDecorator`, `SvcPlayerNear`, `SvcSetBB`; service edges on composites; runtime `tickService` while host path active
- **v1.34** Niagara modules — `wind`, `rotation`, `collision` particle modules (CPU sim + Details toggles)
- **v1.35** Substrate-lite materials — `ClearCoat` / `Sheen` graph nodes; Output channels `clearCoat`, `clearCoatRoughness`, `sheen`, `sheenRoughness` (CPU + TSL)
- **v1.36** GAS stacking — `stackPolicy` / `maxStacks` on `GameplayEffect`; `getActorEffectStacks`; per-stack modifier tick
- **v1.37** MP GAS replication — `replicateGAS` actor flag; `ga:` / `ga` delta sync; `mpReplicationTierForKey` + tier priority in `mpNet`
- **v1.38** Playwright wave 19 tests — BT services, particle modules, substrate channels, GAS stacks (42 passed)

### Changed
- `window.lotus.gas` bridge — `getStacks`, `saveEffect`, `initActor`
- `window.lotus.mpNet` adds `replicationTier`, `tierPriority`
- BT editor dashed service wires; `compileBTGraphToScript` emits `__btServices`
- `api.runBTWithPaths` accepts optional services array

### Verification
```bash
cd "~/Vektra Industries/Software/lotus-engine"
npm run build && npm run test   # 42 passed
```

---

## 2026-06-13 — Wave 18: v1.27–v1.32

### Added
- **v1.27** TSL post SSR temporal denoise chain — velocity MRT when SSR on, TRAA on SSR + DenoiseNode (editor + export)
- **v1.28** GPU particle life/color/size buffers — integrate kernel owns life decay + color/size lerp; `skipLifeColor` CPU path
- **v1.29** Export particle GPU QA + playable perf badge — `__LOTUS_EXPORT_PERF__`, fps HUD, particle tier in overlay
- **v1.30** BT collapsed subtree PIE compile — `graphForBTCompile` merges stashes; `resolveBTEditorHighlightNodeId` for live tick
- **v1.31** Material Editor live TSL node-graph preview badge — `materialGraphTSLPreviewChannels`, channel overlay in preview panel
- **v1.32** Playwright wave 18 tests — BT collapsed compile, GPU life buffers + QA matrix, TSL preview channels (38 tests)

### Changed
- `window.lotus.particles.qaMatrix` — particle GPU tier QA probe (`particleGPUQA.ts`)
- `window.lotus.bt` adds `graphForCompile`, `resolveHighlight`; double-click collapsed decorator expands in-place
- `window.lotus.materialTSL.previewChannels` for live node-graph channel list
- `simBuffers()` exposes `life`, `maxLife`, `colors`, `sizes` for GPU tier

### Verification
```bash
cd "~/Vektra Industries/Software/lotus-engine"
npm run build && npm run test   # 38 passed
```

---

## 2026-06-13 — Wave 17: v1.21–v1.26

### Added
- **v1.21** TSL post TRAA temporal filter + denoise for SSGI stability — velocity MRT, `traa`/`denoise` in `postStackTSLPipeline.ts`; editor + export honor `fx.taa`
- **v1.22** GPU particle alive mask + emit kernel — `aliveF` buffer, `syncAliveMask`/`applyGPUAliveMask`, `runParticleGPUEmit` in compute tier
- **v1.23** Export WebGPU particle tier — `bindExportParticleCompute()` in playable `runtime.js`; CPU loop skips forces when `gpuTier`
- **v1.24** BT decorator compile (no Repeat unroll) + subtree collapse/expand — `collapseBTSubtree`/`expandBTSubtree`, dashed wrap rects in `BTEditor`
- **v1.25** Material TSL per-node graph compile — `compileMaterialGraphTSLNodes` (Color, Scalar, UV, Sine, Fresnel, Noise, …); serialize `version: 2`, `nodeGraph` flag
- **v1.26** Playwright wave 17 tests — BT collapse, material TSL nodes, GPU `aliveF` bridge (35 tests)

### Changed
- `window.lotus.bt` adds `collapseSubtree`, `expandSubtree`; Repeat/Cooldown compile as `{ repeat: { count, child } }` decorators
- `window.lotus.materialTSL.compileNodes` for live TSL node graph evaluation
- Viewport binds `bindWorldGPUParticles` when WebGPU active; stats badge reports `fx.taa`

### Verification
```bash
cd "~/Vektra Industries/Software/lotus-engine"
npm run build && npm run test   # 35 passed
```

---

## 2026-06-13 — Wave 16: v1.15–v1.20

### Added
- **v1.15** TSL post stack SSGI + SSR on WebGPURenderer — MRT metalness/roughness, `applyPostFx` SSGI settings (`postStackTSLPipeline.ts`)
- **v1.16** GPU particle TSL compute kernel — `storage()` + `bindParticleIntegrateKernel` / `runParticleGPUIntegrate` wired in `GPUParticleSystem`
- **v1.17** Export runtime TSL GTAO + FXAA + SSGI + SSR when `renderBackend: webgpu` (`createExportTSLPipeline`)
- **v1.18** BT `compileBTGraphToScript`, `inferBlackboardTypes`, PIE breakpoints (`__btBreakpoint`, editor gutter + To Script)
- **v1.19** Material Editor WebGPU TSL live preview sphere when `materialBackend: 'tsl'`
- **v1.20** Playwright wave 16 tests — BT script compile, particle compute bind, TSL preview probe (32 tests)

### Changed
- `getTSLPostState` notes SSGI/SSR on full TSL tier; `window.lotus.bt` adds `compileScript`, `inferBBTypes`
- `api.runBTWithPaths` for compiled BT script attach with live path index
- Viewport TSL pipeline passes `ssr` + `ssgi` settings; WebGPU single-pane path avoids WebGL composer aux

### Verification
```bash
cd "~/Vektra Industries/Software/lotus-engine"
npm run build && npm run test   # 32 passed
```

---

## 2026-06-13 — Wave 15: v1.09–v1.14

### Added
- **v1.09** TSL post stack GTAO + FXAA on WebGPURenderer — `postStackTSLPipeline.ts` MRT + `applyPostFx`; stats `F` badge when full stack active
- **v1.10** GPU particle `simBuffers()` accessors + `skipForces` update path; `integrateParticleBuffers` wired when `usesComputeNode`
- **v1.11** Export runtime TSL bloom `RenderPipeline` when `renderBackend: webgpu` — overlay shows `WebGPU TSL ·`
- **v1.12** BT `validateBTGraph` — cycle/multi-parent/decorator depth checks; editor validation + compile preview panels
- **v1.13** Material TSL dynamic `three/webgpu` import — removes static `MeshPhysicalNodeMaterial` build warnings
- **v1.14** Playwright wave 15 tests — BT validate bridge, `simBuffers`, material TSL serialize (29 tests)

### Changed
- `getTSLPostState` adds `full` tier for GTAO + bloom + FXAA pipeline
- `window.lotus.bt` bridge: `validate`, `summarize`
- BT wire connect rejects invalid decorator nesting before commit

### Verification
```bash
cd "~/Vektra Industries/Software/lotus-engine"
npm run build && npm run test   # 29 passed
```

---

## 2026-06-13 — Wave 14: v1.03–v1.08

### Added
- **v1.03** TSL RenderPipeline bloom on WebGPURenderer canvas (`postStackTSLPipeline.ts`, wired in `Viewport.tsx`)
- **v1.04** GPU particle `ComputeNode` probe + tier flag (`particlesCompute.ts`, `GPUParticleSystem.bindComputeRenderer`)
- **v1.05** Export playable E2E — serve exported HTML via preview, assert canvas + “Click to play” overlay
- **v1.06** WebGPU export runtime — `createPlayRenderer()` async boot, `renderBackend` in `__LOTUS_EXPORT__`, CDN import map for `three/webgpu` + `three/tsl`
- **v1.07** BT editor wire drag-to-connect — in/out ports, pending wire line, Repeat/Cooldown decorator nodes + props
- **v1.08** Wave 14 integration — export runtime boot fixes (deferred pawn input, guarded `applyEnvironment`, non-blocking `loadSounds`)

### Changed
- Viewport stats badge shows `P` when TSL RenderPipeline bloom is active on WebGPU tier
- `getTSLPostState` adds `pipeline` tier when RenderPipeline is live
- Playable export `runtime.js` no longer touches `renderer` before async `boot()` completes

### Verification
```bash
cd "~/Vektra Industries/Software/lotus-engine"
npm run build && npm run test   # 27 passed
```

---

## 2026-06-13 — Wave 13: v0.97–v1.02

### Added
- **v0.97** WebGPU QA matrix + `createLotusRenderer` — adapter/device checks gate WebGPU tier (`webgpuQA.ts`, `lotusRenderer.ts`)
- **v0.98** WebGPURenderer viewport swap — opt-in when `renderBackend: webgpu`; WebGL aux for composer/path tracer/probes
- **v0.99** GPU particle compute tier — `GPUParticleSystem` fixed-substep batch sim when `particleBackend: gpu`
- **v1.00** SSGI screen-space pass hook — `postStackSSGI.ts` bleed pass in WebGL composer when SSGI enabled
- **v1.01** BT editor v2 — edge delete (click wire), node property panel, blackboard sidebar
- **v1.02** Export playable E2E — `window.lotus.export.buildPlayableHTML` roundtrip test; `renderer.runQA` bridge

### Changed
- Viewport stats badge shows `WEBGPUR` when WebGPURenderer is active on canvas
- Particle emitters respect `World Settings → Niagara backend` via `createParticleSystem`
- `window.lotus` bridge: `renderer`, `particles`, `export`

### Verification
```bash
cd "~/Vektra Industries/Software/lotus-engine"
npm run build && npm run test   # 25 passed
```

---

## 2026-06-13 — Wave 12: v0.91–v0.96

### Added
- **v0.91** Behavior Tree editor — visual graph canvas, auto-wire on add, live PIE node highlight (`btGraph.ts`, `BTEditor.tsx`)
- **v0.92** Data table grid + curve assets — `DataTableEditor`, `curveAssets.ts`, `api.evaluateCurve`
- **v0.93** Project Settings modal — global render/physics/material defaults + export branding (`projectSettings.ts`, File menu)
- **v0.94** Nested prefab-in-prefab — `prefabRef` on save, `expandPrefabRefs` on instantiate (`prefabs.ts`)
- **v0.95** Voronoi fracture + strain — `buildVoronoiFragments`, Details **Fracture Strain** field (`voronoiFracture.ts`, `physics.ts`)
- **v0.96** SSGI quality preset (WebGPU opt-in) + command palette asset search — materials, prefabs, data, imports (`ssgiPreset.ts`, `palette.tsx`)

### Changed
- Viewport stats badge shows `SSGI(preset)` when enabled on WebGPU tier
- Playable export respects **Lotus branding on export** project setting
- `window.lotus` bridge: `bt`, `curve`, `ssgi`, `projectSettings`
- Scripts gain `api.runBTGraph(graph)` for visual BT graphs

### Verification
```bash
cd "~/Vektra Industries/Software/lotus-engine"
npm run build && npm run test   # 23 passed
```

---

## 2026-06-13 — Wave 11: v0.85–v0.90

### Added
- **v0.85** SSR + LightProbeGrid — `SSRPass` opt-in, `LightProbeGrid` interior GI approx (`ssrProbeGI.ts`)
- **v0.86** MP dedicated server mode + lag compensation history (`mpNet.ts`, `mpLagCompensatedTransform`)
- **v0.87** MP delta compression + interest-radius culling for sync @ 10 Hz
- **v0.88** Rapier impulse joints + raycast vehicle controller (`physicsJoints.ts`, `physicsVehicle.ts`)
- **v0.89** TSL material editor path — serialize/deserialize preview, Material Editor uses `materialBackend: tsl`
- **v0.90** DetourCrowd avoidance (`navCrowd.ts`, `api.crowdSpawn`) + landscape splat texture paint (`landscapeSplat.ts`)

### Changed
- Baked navmesh persists into PIE (crowd + `findPath` during play)
- WebGPU tier badge shows `+` when TSL post tier is active
- `window.lotus` bridge: `crowd`, `mpNet`, `materialTSL`, `bakeGIProbes`

### Verification
```bash
cd "~/Vektra Industries/Software/lotus-engine"
npm run build && npm run test   # 20 passed
```

---

## 2026-06-13 — Wave 10: v0.79–v0.84

### Added
- **v0.79** WebGPU quality tier toggle — `World Settings → Rendering → Backend` (`renderBackend.ts`, capability probe + viewport badge)
- **v0.80** WebGL post stack v2 — optional SSAO + FXAA passes (`postStackWebGL.ts`); TSL post stub (`postStackTSL.ts`)
- **v0.81** Asset pipeline v2 — IndexedDB blob store (`assetStore.ts`), GLTF + DRACO + KTX2 loaders (`assetPipeline.ts`)
- **v0.82** Static mesh LOD chains — `THREE.LOD` builder (`lodMesh.ts`)
- **v0.83** BatchedMesh export merge — static mesh batching for playable export (`batchExport.ts`, `exportBatchStatic` env flag)
- **v0.84** Rapier `moveAndSlide` character controller — Godot-style kinematic pawn (`characterController.ts`, `api.moveAndSlide`, `window.lotus.character`)

### Changed
- `PlayController` uses Rapier character path when `useRapierCharacter` is enabled
- Playable export injects `window.__LOTUS_BATCHED__` when batch export is on
- Material instances gain TSL uniform stub (`applyMaterialInstanceTSL`)

### Verification
```bash
cd "~/Vektra Industries/Software/lotus-engine"
npm run build && npm run test   # 17 passed
```

---

## 2026-06-13 — Wave 9 + Lotus rename: v0.73–v0.78

### Added
- **Lotus Engine rebrand** — `lotus-engine` package, `Software/lotus-engine` folder, `window.lotus` bridge (`window.vektra` legacy alias), `__LOTUS_*` export globals with `__VEKTRA_*` fallback, `npm run lotus` CLI
- **v0.73** `docs/LOTUS-ENGINE-RESEARCH.md` — Three.js r184+ engine substrate roadmap (Waves 9–12)
- **v0.74** Fixed physics timestep — 60 Hz accumulator (`fixedPhysicsHz` in World Settings), `onPhysicsTick(dt)` script hook
- **v0.75** Particle bounds fix — dynamic bounding spheres, `frustumCulled` re-enabled; GPU particle backend stub (`particlesGPU.ts`)
- **v0.76** AO bake Web Worker — `lightmapBakeWorker.ts` off main thread; xatlas UV2 unwrap path (`xatlasUV2.ts`)
- **v0.77** Material graph TSL preview stub — `compileMaterialGraphTSL()` parallel to GLSL path
- **v0.78** Buffer viz AO + Emissive modes (`show bufferviz ao|emissive`)

### Changed
- Level files serialize `engine: 'lotus'` (still load `vektra` legacy levels)
- localStorage keys `lotus-engine.*` with read-time migration from `vektra-engine.*` (`storage.ts`)

### Verification
```bash
cd "~/Vektra Industries/Software/lotus-engine"
npm run build && npm run test   # 14 passed
npm run dev
npm run lotus
```

---

## 2026-06-13 — Wave 8: v0.68–v0.72

### Added
- **v0.68** Buffer visualization view modes — World Normal, Depth, Base Color, Roughness, Metallic (`show bufferviz`)
- **v0.69** Status bar save indicator — ● Unsaved / ✓ Saved / Saving… + autosave countdown toast
- **v0.70** Sequencer audio waveforms + loop regions (loopIn/loopOut brackets)
- **v0.71** Multiplayer 2-tab relay integration test (`tests/multiplayer.spec.ts`, `relay-fixture.ts`)
- **v0.72** AO Map bake to UV2 — `aoMap` texture via box-projection uv2, `build ao map`

### Changed
- Session master summary below now spans **v0.33 → v0.72** (8 waves, 40 version bumps)
- Playwright: **14 tests** (13 smoke + 1 live MP relay)

### Verification
```bash
npm run build && npm run test   # 14 passed
```

---

## 2026-06-13 — Session master summary (v0.33 → v0.72)

Eight parallel agent swarms shipped **40 version bumps** in one research-and-build session. Starting point: broken v0.33 in-flight work (3 TS errors). End state: **build clean**, **14 Playwright tests passing** (incl. live MP relay).

### Starting baseline (pre-session)
- Last clean commit before session: `8bc3cc3` (v0.32 — Water + PCG Scatter)
- In-flight v0.33 Blueprint cluster broken (parseExports arity, spawn.ts wiring)
- Research completed: UE5.7 + Unity 6 + Godot 4.6 gap analysis → completion roadmap

### What was built (by domain)

**Editor shell & UX**
- Quad viewport layouts (4-pane scissor), rebindable keyboard shortcuts (26 bindings)
- Content Drawer dock-pin, type stripes, asset context menus
- Toolbar Modes dropdown (Select/Landscape/Foliage/Paint)
- Piercing pick menu (Ctrl+RMB), camera bookmarks persist in level
- Path traced viewport mode (`r.PathTracer`), buffer viz *(v0.68 planned)*

**Scripting & Blueprints**
- Construction scripts (`onConstruct`), exec pulse debugger, Level BP
- Data pins, variables, ForLoop/DoOnce/FlipFlop (prior), function collapse/macros
- Gate, MultiGate, SwitchInt, BindSignal, CallSignal nodes
- Exec breakpoints with F5 Continue

**Materials & rendering**
- Material assets + instances (shareable library, per-actor overrides)
- GPU material editor (UV, Fresnel, Noise, TextureSample) + WPO vertex displacement
- Baked AO (approx) — hemisphere raycast to vertex colors
- Reflection probes, post-process volumes, HDRI, sky atmosphere (prior)

**Animation & characters**
- FSM state machine editor, 1D + 2D blend spaces (Delaunay)
- Two-bone IK + LookAt on glTF skeletons
- glTF clip playback, crossfade, sequencer tracks

**World building**
- Landscape sculpt/paint, foliage, water, CSG booleans, GridMap
- Visual PCG graph editor (Sample→Filter→Transform→Spawn)
- Grid-chunked world streaming + `api.loadCell`
- Recast navmesh WASM bake + grid A* fallback

**Gameplay systems**
- GAS-lite: attributes, abilities, gameplay effects (duration modifiers)
- Behavior trees, EQS, AI perception, collision layers/masks
- Input map, signals/groups, triggers, timers, raycast API
- Prefab overrides (Godot editable-children pattern)

**Audio & VFX**
- MetaSounds-lite WebAudio graph editor
- HRTF spatialization, reverb zones, attenuation falloff curves
- Particle ribbon + mesh renderers, sub-emitters, size curves
- Sequencer audio tracks with scrubbing

**UI & cinematics**
- UMG-lite HUD designer, HUD widget Sequencer tracks
- Widget3D (CSS3D world-space HTML), Label3D billboards
- Sequencer bezier curve editor, Take Recorder, Movie Render Queue

**Multiplayer & export**
- WS relay, ghost pawns, 10Hz property sync, spawn/despawn replication
- Ownership + client prediction + `own` protocol
- Multi-level export, PWA option, quality presets
- One-click playable HTML (~22KB + CDN)

**Debugging & extensibility**
- Live Tree debugger, per-actor tick profiler, `getLiveSnapshot()`
- Plugin API (panels, node types, importers, console commands)
- Plugin Manager UI, command palette
- Playwright E2E: 5 → 9 → 13 tests

### Version table (all waves)

| Version | Wave | Highlights |
|---------|------|------------|
| v0.33 | 1 | onConstruct, BP pulse debugger, Level BP |
| v0.34 | 1 | Material assets + instances |
| v0.35 | 1 | Prefab property overrides |
| v0.36 | 1 | Recast navmesh bake |
| v0.37 | 1 | Live Tree debugger, tick profiler |
| v0.38 | 2 | FSM animation editor + blend 1D |
| v0.39 | 2 | MetaSounds + HRTF + reverb zones |
| v0.40 | 2 | Multi-level export, PWA, BP functions |
| v0.41 | 2 | Plugin API + Plugin Manager |
| v0.42 | 2 | GAS-lite, piercing pick, particle ribbon |
| v0.43 | 2 | Wave 2 integration |
| v0.44 | 3 | Material GPU shader nodes |
| v0.45 | 3 | Quad viewport layouts |
| v0.46 | 3 | Keyboard shortcut editor |
| v0.47 | 3 | Content Drawer dock-pin |
| v0.48 | 3 | Sequencer bezier curves |
| v0.49 | 4 | Path tracer viewport |
| v0.50 | 4 | Blend space 2D |
| v0.51 | 4 | Multiplayer property sync |
| v0.52 | 4 | HUD widget Sequencer tracks |
| v0.53 | 4 | Grid world streaming |
| v0.54 | 4 | Playwright smoke tests (5) |
| v0.55 | 5 | Two-bone IK + LookAt |
| v0.56 | 5 | BP Gate/MultiGate/Switch |
| v0.57 | 5 | GAS gameplay effects |
| v0.58 | 5 | Bookmarks persist, Modes dropdown, Label3D |
| v0.59 | 6 | Particle mesh + sub-emitters |
| v0.60 | 6 | Material WPO |
| v0.61 | 6 | PCG graph editor; 9 tests |
| v0.62 | 7 | Audio falloff + sequencer audio |
| v0.63 | 7 | Blueprint breakpoints |
| v0.64 | 7 | Widget3D CSS3D |
| v0.65 | 7 | MP ownership + prediction |
| v0.66 | 7 | Baked AO (approx) |
| v0.67 | 7 | 13 E2E tests |
| v0.68 | 8 | Buffer visualization view modes |
| v0.69 | 8 | Status bar save + autosave countdown |
| v0.70 | 8 | Sequencer audio waveforms + loops |
| v0.71 | 8 | MP 2-tab relay test |
| v0.72 | 8 | AO map bake (UV2) |

### New modules (files created this session)

`materialAssets.ts` · `materialShader.ts` · `materialCommands.ts` · `liveSnapshot.ts` · `navMeshWorker.ts` · `animStateMachine.ts` · `metaSounds.ts` · `metaSoundAssets.ts` · `gameplayAbilities.ts` · `ik.ts` · `pcgGraph.ts` · `streaming.ts` · `lightmapBake.ts` · `widget3d.ts` · `plugins.ts` · `shortcuts.ts` · `viewportLayout.ts` · `PluginManager.tsx` · `AnimStateEditor.tsx` · `MetaSoundEditor.tsx` · `PCGEditor.tsx` · `CurveEditor.tsx` · `ContentDrawer.tsx` · `ShortcutEditor.tsx` · `AttenuationFields.tsx` · `Widget3DLayer.tsx` · `PluginPanelView.tsx` · `playwright.config.ts` · `tests/smoke.spec.ts` · `tests/multiplayer.spec.ts` · `tests/relay-fixture.ts`

### Dependencies added

`recast-navigation` · `@recast-navigation/three` · `three-gpu-pathtracer` · `three-mesh-bvh` · `@playwright/test`

### Verification (current)

```bash
cd "~/Vektra Industries/Software/lotus-engine"
npm install
npm run build    # exit 0
npm run test     # 14 passed
npm run dev      # editor on :5173
node scripts/relay.mjs   # multiplayer relay :24690
```

### Explicit non-goals (honest skips)

Real Lumen, Nanite, Substrate, Motion Matching, Mass Entity, MetaHumans, full Control Rig graphs, true Lightmass — approximated or deferred.

---

## 2026-06-13 — Wave 8: v0.68+ (placeholder — append after swarm finishes)

> **Do not finalize until wave 8 agents land.** Fill in version bumps, commit hash, and test count below.

### Planned (from CHECKPOINT + gap list)

- **v0.68** Buffer visualization view modes (World Normal, Depth, Base Color)
- **v0.69** Sequencer audio polish — waveform display, loop regions
- **v0.70** Status bar — save indicator, autosave countdown
- *(stretch)* Second UV lightmaps; optional 2-tab MP relay CI test

### Added

- *(pending)*

### Changed

- *(pending)*

### Verification target

```bash
npm run build    # exit 0
npm run test     # TBD passed
```

---

## 2026-06-13 — Wave 7: v0.62–v0.67

### Added
- **v0.62** Attenuation falloff curves + Sequencer audio tracks with scrubbing (`AttenuationFields.tsx`)
- **v0.63** Blueprint exec breakpoints — gutter toggle, pause PIE, F5 Continue
- **v0.64** Widget3D — CSS3DRenderer world-space HTML (`widget3d.ts`, `Widget3DLayer.tsx`)
- **v0.65** MP ownership (`netOwnerId`), client prediction, `own` protocol
- **v0.66** Baked AO (approx) — `lightmapBake.ts`, `build ao`, Build menu
- **v0.67** Playwright **13 tests** — navmesh, materials, blueprint, MP mock

---

## 2026-06-13 — Wave 6: v0.59–v0.61

### Added
- **v0.59** Particle mesh renderer, sub-emitters, 4-point size curve
- **v0.60** Material GPU WPO vertex displacement
- **v0.61** Visual PCG graph editor (🎲 PCG tab); tests expanded to 9

---

## 2026-06-13 — Wave 5: v0.55–v0.58

### Added
- **v0.55** Two-bone IK + LookAt (`ik.ts`)
- **v0.56** BP Gate, MultiGate, SwitchInt, BindSignal, CallSignal
- **v0.57** GAS gameplay effects — `api.applyEffect` / `api.removeEffect`
- **v0.58** Camera bookmarks in level file; Modes dropdown; Label3D actor

---

## 2026-06-13 — Wave 4: v0.49–v0.54

### Added
- **v0.49** Path tracer view mode + `r.PathTracer` cvar
- **v0.50** 2D blend space (Delaunay triangulation)
- **v0.51** Multiplayer sync @ 10Hz + spawn/despawn
- **v0.52** HUD widget Sequencer tracks
- **v0.53** Grid streaming + `api.loadCell`
- **v0.54** Playwright smoke tests (5)

---

## 2026-06-13 — Wave 3: v0.44–v0.48

### Added
- **v0.44** Material GPU `onBeforeCompile` shader graph
- **v0.45** Quad viewport scissor layouts
- **v0.46** Rebindable keyboard shortcuts (26)
- **v0.47** Content Drawer dock-pin + asset stripes
- **v0.48** Sequencer bezier curve editor

---

## 2026-06-13 — Wave 2: v0.38–v0.43

### Added
- **v0.38** FSM + 1D blend space animation editor
- **v0.39** MetaSounds + HRTF + reverb zones + SoundEmitter
- **v0.40** Multi-level export, PWA, BP function macros
- **v0.41** Plugin API + Plugin Manager
- **v0.42** GAS-lite, piercing pick, particle ribbon/gradient/bounce
- **v0.43** Integration + gap-list sync

---

## 2026-06-13 — Wave 1: v0.33–v0.37

### Added
- **v0.33** Construction scripts, BP pulse debugger, Level BP
- **v0.34** Material assets + instances
- **v0.35** Prefab property overrides
- **v0.36** Recast navmesh WASM bake
- **v0.37** Live Tree debugger + tick profiler

### Fixed
- v0.33 in-flight TS errors (`scripting.ts`, `spawn.ts`)

### Changed
- `AddActorCommand` runs `onConstruct` on all spawns
- Property commands skip undo during Play