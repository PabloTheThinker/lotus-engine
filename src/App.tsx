import { useEffect } from 'react'
import { MenuBar } from './editor/MenuBar'
import { Toolbar } from './editor/Toolbar'
import { StatusBar } from './editor/StatusBar'
import { Viewport } from './editor/Viewport'
import { BottomDock } from './editor/panels/BottomDock'
import { FloatingContentDrawer } from './editor/panels/ContentDrawer'
import { PlaceActors } from './editor/panels/PlaceActors'
import { Details } from './editor/panels/Details'
import { Outliner } from './editor/panels/Outliner'
import { autosave, newLevel, restoreAutosave, saveLevelToFile } from './editor/levelIO'
import { bakeAO, bakeAOMapUV2 } from './engine/lightmapBake'
import { preloadPhysics } from './engine/physics'
import { world } from './engine/World'
import { getLiveSnapshot } from './engine/liveSnapshot'
import { executeAICommands, extractCommands } from './editor/ai'
import { buildPlayableHTML, exportMiniGamePreset } from './editor/exportPlayable'
import { captureExportScreenshot } from './editor/captureExportScreenshot'
import { buildExportPackMeta } from './editor/exportPackMeta'
import { buildButlerPushCommand } from './editor/itchButlerHint'
import { buildReleaseNotes } from './editor/itchReleaseNotes'
import { buildPackChangelogHtml, renderReleaseNotesHtml } from './editor/packChangelogHtml'
import {
  buildItchZipBlob,
  exportItchUploadPack,
  itchPackZipFilename,
  listZipStoreEntryNames,
  readZipStoreEntry,
} from './editor/itchUploadPack'
import {
  buildMiniGamePackHTML,
  exportMiniGamePack,
  MINIGAME_PACK_MODES,
  miniGamePackIconStub,
  miniGamePackTitle,
} from './editor/miniGameExportPack'
import {
  achievementsForPack,
  getAchievementPackId,
  isAchievementUnlocked,
  listUnlocked,
  setAchievementPackId,
  unlockAchievement,
} from './editor/exportAchievements'
import {
  enableMiniGameHud,
  hideMiniGameHud,
  showAchievementToast,
  showLoseOverlay,
  showWinOverlay,
} from './editor/miniGameHud'
import { useEditor } from './editor/store'
import { terminalExec, TERMINAL_HELP } from './editor/terminal'
import { connectTerminalBridge } from './editor/terminalBridge'
import { AddActorCommand, undo, redo, runCommand } from './editor/commands'
import { buildSerializedActor, type AssetPayload } from './editor/spawn'
import { CommandPalette, installPlugin, loadUserPlugins, registerPlugin } from './editor/palette'
import {
  registerConsoleCommand,
  registerImporter,
  registerNodeType,
  registerPanel,
  registerPanelCallback,
} from './editor/plugins'
import { PluginManagerModal } from './editor/PluginManager'
import { PreferencesModal } from './editor/Preferences'
import { ProjectSettingsModal } from './editor/ProjectSettingsModal'
import { loadProjectSettings, saveProjectSettings } from './editor/projectSettings'
import { samplePathAt } from './engine/path3d'
import { clampExportRange, makeScriptApi, parseExports } from './engine/scripting'
import {
  getPrefabByName,
  getPrefabOverrideDiff,
  instantiatePrefab,
  listPrefabSubtree,
  recordPrefabOverride,
  revertAllPrefabOverrides,
  savePrefab,
  summarizePrefabOverrides,
} from './editor/prefabs'
import {
  MP_SCORE_SCRIPT,
  MP_SCOREBOARD_SCRIPT,
  MP_TEAMS_SCORE_SCRIPT,
  MP_TEAMS_SCOREBOARD_SCRIPT,
  MP_TAG_TARGET,
  MP_SCORE_WIN,
  MP_TAG_RED,
  MP_TAG_BLUE,
  addMpScore,
  addMpTeamScore,
  applyMpScoreDelta,
  applyMpTeamScoreDelta,
  getMpScore,
  getMpPeerScores,
  getMpTeamScores,
  mirrorMpPeerScores,
  mirrorMpTeamScores,
  mpTeamsGet,
  MP_LOBBY_SCRIPT,
  MP_SPECTATOR_SCRIPT,
  MP_TAG_SPECTATOR,
  spawnIndieMpDeathmatch,
  spawnIndieMpLobby,
  spawnIndieMpSpectator,
  spawnIndieMpTeamsDeathmatch,
} from './editor/indieMpGameplay'
import { configureIndieMpSettings, MP_HOST_SCRIPT, MP_SYNC_SCRIPT, MP_TAG_HOST, MP_TAG_SYNC, spawnIndieMpTemplate } from './editor/indieMpTemplate'
import {
  attachMiniGameScripts,
  FPS_MINIGAME_SCRIPT,
  FPS_TARGET_TAG,
  GOAL_ZONE_NAME,
  MINIGAME_MANAGER_NAME,
  PLATFORMER_MINIGAME_SCRIPT,
  RPG_MINIGAME_SCRIPT,
  RPG_NPC_GOAL,
  spawnMiniGame,
} from './editor/starterMiniGames'
import {
  MAIN_MENU_MANAGER_NAME,
  MAIN_MENU_SCRIPT,
  MENU_ITEMS,
  linkStarterLevel,
  mainMenuBootEnabled,
  paintMainMenuHud,
  fadeToLevel,
  selectLevel,
  spawnMainMenu,
  type MainMenuLevelKind,
} from './editor/mainMenuFlow'
import { sceneTransition, type SceneTransitionKind, type SceneTransitionPhase } from './editor/sceneTransitions'
import { spawnCharacterStarter, spawnFpsStarter, spawnPlatformerStarter, spawnTopDownRpgStarter } from './editor/starterTemplates'
import { resolveAnimParams } from './engine/animStateMachine'
import {
  atlasIndexForCorner,
  atlasIndexForMask,
  atlasIndexForRule,
  atlasUvRect,
  AUTOTILE_ATLAS_SIZE,
} from './engine/autotileAtlas'
import {
  atlasSlotForMask,
  getTileMap,
  importAtlasSheet,
  listAtlasSheets,
  setTileMap,
} from './engine/autotileSheetImport'
import {
  activeGridLayerIndex,
  autotileExtendedMask,
  autotileNeighbors,
  autotileRuleForMask,
  eraseGridCell,
  eraseGridLayer,
  getGridCellCount,
  getLayerCellCount,
  gridCellKey,
  gridCellsInBrush,
  isGridLayerVisible,
  paintGridCell,
  paintGridLayer,
  previewAutotileCorner,
  previewAutotileExtendedMask,
  previewAutotileMask,
  resolveAutotileCorner,
  resolveAutotileKind,
  setGridLayerVisible,
  worldToGridCell,
} from './engine/gridMap'
import {
  foliageColliderGroups,
  getLayerCollisionGroup,
  maskFromRapierGroup,
  membershipFromRapierGroup,
  rapierGroupsFromLayerMask,
  rebuildFoliageColliders,
  setLayerCollisionGroup,
} from './engine/gridCollisionLayers'
import {
  bakeNavMeshForGridLayer,
  bakeNavMeshLayers,
  collectFoliageNavColliderMeshes,
  collectGridNavMeshes,
  getNavmeshLayerMask,
  setNavmeshLayerMask,
} from './engine/gridNavmeshBake'
import {
  clampGridNavLayer,
  getAgentBehavior,
  gridNavAgentCount,
  gridNavAgentGetPosition,
  gridNavAgentLayer,
  setAgentBehavior,
  spawnGridNavAgent,
  spawnGridNavChaseAgent,
  spawnGridNavPatrolAgent,
  tickGridNavAgents,
  type GridNavBehavior,
} from './engine/gridNavAgents'
import { getGamepadMoveAxis, pollGamepadInput, resetGamepadInput, shouldEnableGamepadControls } from './engine/gamepadInput'
import {
  batteryHapticScale,
  hapticIntensityFactor,
  hapticScale,
  perfFpsHapticScale,
  setBatteryChargingForTest,
} from './engine/adaptiveHaptics'
import {
  hapticsEnabled as gamepadHapticsEnabled,
  isGamepadHapticsSupported,
  pulseFire as pulseGamepadFire,
  pulseInteract as pulseGamepadInteract,
  setGamepadHapticsEnabled,
} from './engine/gamepadHaptics'
import { getActionAxis } from './engine/inputActions'
import {
  getBindings,
  resetBindings,
  setGamepadButton,
  setTouchSlot,
  type GamepadAction,
  type TouchAction,
  type TouchSlotId,
} from './engine/inputBindings'
import {
  activeProfile,
  applyInputProfile,
  hapticPresetForProfile,
  listInputProfiles,
  loadInputProfile,
  profiles,
  saveInputProfile,
} from './engine/inputProfiles'
import { createResource, getResource, listResources, saveResource } from './engine/resources'
import { listScriptVarPresets, loadScriptVarPreset, saveScriptVarPreset } from './engine/scriptVarPresets'
import { applyScriptVarPreset, keyableScriptExports, sampleSequence, setKey } from './engine/sequencer'
import {
  TOUCH_LAYOUT_PRESET_IDS,
  applyTouchLayoutPreset,
  getTouchLayoutVars,
  normalizeTouchLayoutPreset,
} from './engine/touchLayoutPresets'
import {
  endTouchInputFrame,
  getTouchMoveAxis,
  isTouchDevice,
  isTouchFireJustPressed,
  isTouchInteractJustPressed,
  resetTouchInput,
  shouldShowTouchControls,
  syncTouchInputState,
  VirtualJoystick,
} from './engine/touchInput'
import {
  hapticsEnabled,
  isVibrationSupported,
  setTouchHapticsEnabled,
  vibrateFire,
  vibrateInteract,
  vibrateJump,
} from './engine/touchHaptics'
import { DEFAULT_RAY_CAST, DEFAULT_TIMER } from './engine/types'
import { ShortcutEditor } from './editor/panels/ShortcutEditor'
import {
  collapseBTSubtree,
  compileBTGraph,
  compileBTGraphToScript,
  emptyBTGraph,
  expandBTSubtree,
  graphForBTCompile,
  resolveBTEditorHighlightNodeId,
  inferBlackboardTypes,
  summarizeBTTree,
  summarizeBTServices,
  diffBTScriptPreview,
  exportBTScriptDiffPatch,
  getBTScriptDiffGutterNodeIds,
  getBTScriptDiffLineTargets,
  resolveBTScriptDiffGutter,
  resolveBTScriptDiffGutterSelection,
  scrollRectForBTNode,
  getBTNodeServiceCompileHint,
  getBTBreakpointCondition,
  getBTServiceDecoratorHostId,
  getBTServiceHostNodeId,
  registerBTBreakpointStepInto,
  registerBTBreakpointStepOver,
  shouldBTBreakpointFire,
  shouldBTServiceStepInto,
  getBTSubtreeServiceNodeIds,
  validateBTGraph,
} from './engine/btGraph'
import { getActiveBTBlackboard, getActiveBTPaths, getActiveBTServiceNodeIds } from './engine/behaviorTree'
import { evaluateCurve, emptyCurve } from './engine/curveAssets'
import { getSSGISettings } from './engine/ssgiPreset'
import { getDOFSettings, resolveCameraDOFFocusDistance } from './engine/postStackDOF'
import {
  applyExposureToColorGrading,
  getACESExposure,
  getPresetACESEnabled,
  COLOR_GRADING_PRESET_THUMBNAILS,
  getACESPostEnabled,
  getColorGradingCompareT,
  getColorGradingPreset,
  getColorGradingSettings,
  blendColorGradingSettings,
} from './engine/postStackColorGrading'
import {
  createIdentityLUTTexture,
  decodeGradingLUTFile,
  decodePngLUTAtlas,
  getColorGradingLUTState,
  getExportGradingLUTPayload,
  getGradingLUTStub,
  parse3dlLUT,
  parseCubeLUT,
  persistDecodedLUTToEnvironment,
  restoreGradingLUTFromEnvironment,
  serializeGradingLUTForLevel,
} from './engine/postColorGradingLut'
import { isParticleGpuSubBurstReady } from './engine/particlesCompute'
import { probeExportPerfGate, scheduleExportPerfProbe } from './editor/exportPerfProbe'
import { getSSRSettings } from './engine/ssrPreset'
import { runWebGPUQAMatrix } from './engine/webgpuQA'
import { DEFAULT_PARTICLES } from './engine/particles'
import { createParticleSystem } from './engine/particlesGPU'
import { runParticleGPUQAMatrix } from './engine/particleGPUQA'
import { isTypingTarget, matchesShortcutId } from './editor/shortcuts'
import { bakeNavMesh, isRecastNavReady } from './engine/nav'
import { compileBlueprint, emptyGraph } from './engine/blueprint'
import {
  loadMPSettings,
  mpEnabled,
  mpConnected,
  mpIsHost,
  mpKnownPeerIds,
  mpLobbyAllReady,
  mpLobbyIsReady,
  mpLobbyPeerReadyCount,
  mpLobbyPeers,
  mpListRooms,
  mpLobbySetReady,
  mpLobbyTryStart,
  mpLocalId,
  mpPingMs,
  mpRefreshRooms,
  mpRoomPing,
  mpSpectatorEnable,
  mpSpectatorMode,
  mpIsSpectator,
  mpSpectatorPeers,
  mpReplayBufferLength,
  mpReplayGetSeekOffset,
  mpReplayRecordEnabled,
  mpReplaySampleAt,
  mpReplaySeek,
  mpReportPlayerKill,
  mpBroadcastTeamAssign,
  mpBroadcastTeamScores,
} from './engine/multiplayer'
import {
  MP_KILLCAM_DURATION_SEC,
  MP_KILLCAM_SEEK_SEC,
  mpKillcamActive,
  mpKillcamOnGameWon,
  mpKillcamOnPlayerKilled,
  mpKillcamRemainingSec,
  mpKillcamSeekOffset,
  mpKillcamSetLocalIdHook,
  mpKillcamTick,
  mpKillcamTrigger,
  mpKillcamTriggerReason,
} from './engine/mpKillcam'
import {
  mpReplayRecordPoses,
  mpReplayReset,
  mpReplaySetRecordEnabled,
  MP_REPLAY_BUFFER_SEC,
  MP_REPLAY_SAMPLE_HZ,
} from './engine/mpReplayBuffer'
import * as THREE from 'three'
import {
  characterIsOnFloor,
  isCharacterControllerReady,
  moveAndSlide as characterMoveAndSlide,
} from './engine/characterController'
import { crowdAddAgent, crowdAgentCount, crowdGetPosition, initCrowd } from './engine/navCrowd'
import {
  mpActorUsesClientPrediction,
  mpDedicatedServerMode,
  MP_DEDICATED_HOST_ID,
  mpIsDedicatedServer,
  mpLagCompensatedTransform,
  mpNetSettings,
} from './engine/multiplayer'
import { MP_REPLICATION_TIER_PRIORITY, mpReplicationTierForKey } from './engine/mpNet'
import { applyEffect, getActorEffectStacks, getEffect, initActorGAS, saveEffect } from './engine/gameplayAbilities'
import {
  compileMaterialGraphTSLNodes,
  compileMaterialGraphTSLSoloChannel,
  isTSLPreviewAvailableAsync,
  materialGraphTSLPreviewChannels,
  previewChannelForPort,
  serializeMaterialGraphTSL,
} from './engine/materialGraphTSL'
import { emptyMaterialGraph } from './engine/materialGraph'
import { bakeLightProbeGrid } from './engine/ssrProbeGI'
import {
  beginStreamingProgress,
  getCellsLoaded,
  getCellsTotal,
  getProgress,
  getStreamingProgress,
  noteStreamingCellLoaded,
  resetStreamingProgress,
  tickStreamProgressCell,
} from './engine/streamingProgress'
import {
  backupCheckpointToIndexedDB,
  listCloudSlots,
  restoreFromIndexedDB,
} from './engine/cloudSaveStub'
import { exportCloudSaveManifest } from './engine/cloudSaveSync'
import {
  getSaveLevelName,
  globalCheckpoint,
  globalLoad,
  isCloudBackupEnabled,
  isCrossLevelSavesEnabled,
  isSaveEnabled,
  loadCheckpoint,
  listSlots,
  migrateToLevel,
  saveCheckpoint,
  setSaveContext,
} from './engine/saveSystem'
import {
  hideSaveMenu,
  isSaveMenuPaused,
  showSaveMenu,
} from './editor/exportSaveMenu'

// Global bridge — browser devtools + external tooling can drive the live editor
const lotusBridge = {
  world,
  useEditor,
  runCommand,
  undo,
  redo,
  terminal: {
    exec: terminalExec,
    help: () => TERMINAL_HELP,
    open: () => useEditor.getState().openConsole(),
    port: import.meta.env.VITE_LOTUS_TERMINAL_PORT ?? '24679',
  },
  ai: { executeAICommands, extractCommands },
  buildPlayableHTML,
  registerPlugin,
  installPlugin,
  registerNodeType,
  registerPanel,
  registerImporter,
  registerConsoleCommand,
  registerPanelCallback,
  getLiveSnapshot: () => {
    const s = useEditor.getState()
    return getLiveSnapshot(world, s)
  },
  /** Baked AO (approx) — hemisphere raycast, not Lightmass */
  BakeAO: (opts?: { samples?: number; radius?: number }) =>
    bakeAO(world.actors, {
      samples: opts?.samples ?? 16,
      radius: opts?.radius ?? 1,
      onProgress: (_done, _total, label) => useEditor.getState().setStatus(label),
    }).then((res) => {
      useEditor.getState().setStatus(
        res.ok
          ? `Baked AO (approx): ${res.actorsBaked} actors, ${res.verticesProcessed} verts`
          : `Bake AO failed: ${res.error ?? 'unknown'}`,
      )
      useEditor.getState().touch()
      return res
    }),
  /** AO Map Bake (UV2, approx) — texture aoMap, not Lightmass */
  BakeAOMapUV2: (opts?: { samples?: number; radius?: number; mapSize?: number; aoMapIntensity?: number }) =>
    bakeAOMapUV2(world.actors, {
      samples: opts?.samples ?? 16,
      radius: opts?.radius ?? 1,
      mapSize: opts?.mapSize ?? 256,
      aoMapIntensity: opts?.aoMapIntensity ?? 1,
      onProgress: (_done, _total, label) => useEditor.getState().setStatus(label),
    }).then((res) => {
      const warn = res.warnings?.length && res.ok ? ` · ${res.uv2AutoGenerated} uv2 auto-generated` : ''
      useEditor.getState().setStatus(
        res.ok
          ? `AO Map Bake (UV2, approx): ${res.meshesBaked} meshes, ${res.verticesProcessed} verts${warn}`
          : `AO map bake failed: ${res.error ?? 'unknown'}`,
      )
      useEditor.getState().touch()
      return res
    }),
  /** E2E / devtools — bake Recast navmesh from current static + landscape geometry */
  bakeNavMesh: () => bakeNavMesh(world.actors),
  isNavMeshReady: isRecastNavReady,
  compileBlueprint,
  emptyGraph,
  multiplayer: {
    loadSettings: loadMPSettings,
    enabled: mpEnabled,
    connected: mpConnected,
    isHost: mpIsHost,
    isDedicatedServer: mpIsDedicatedServer,
    dedicatedServerMode: mpDedicatedServerMode,
    localId: mpLocalId,
    peerCount: () => mpKnownPeerIds().length,
    listRooms: mpListRooms,
    pingMs: mpPingMs,
    roomPing: mpRoomPing,
    refreshRooms: mpRefreshRooms,
    spectatorMode: mpSpectatorMode,
    spectatorEnable: mpSpectatorEnable,
    isSpectator: mpIsSpectator,
    spectatorPeers: mpSpectatorPeers,
    replay: {
      sampleAt: mpReplaySampleAt,
      seek: mpReplaySeek,
      bufferLength: mpReplayBufferLength,
      recordEnabled: mpReplayRecordEnabled,
      seekOffset: mpReplayGetSeekOffset,
      /** E2E — host ring buffer round-trip */
      reset: mpReplayReset,
      setRecordEnabled: mpReplaySetRecordEnabled,
      recordPoses: (
        entries: Array<{
          peerId: string
          position: { x: number; y: number; z: number }
          rotation: { x: number; y: number; z: number }
        }>,
        now?: number,
      ) =>
        mpReplayRecordPoses(
          entries.map((e) => ({
            peerId: e.peerId,
            position: new THREE.Vector3(e.position.x, e.position.y, e.position.z),
            rotation: new THREE.Euler(e.rotation.x, e.rotation.y, e.rotation.z),
          })),
          now,
        ),
      bufferSec: MP_REPLAY_BUFFER_SEC,
      sampleHz: MP_REPLAY_SAMPLE_HZ,
    },
  },
  /** Rapier kinematic character — E2E + devtools (Wave 10) */
  crowd: {
    init: initCrowd,
    addAgent: (id: string, pos: [number, number, number], target?: [number, number, number]) =>
      crowdAddAgent(id, pos, target),
    getPosition: (id: string) => crowdGetPosition(id),
    count: crowdAgentCount,
  },
  mpNet: {
    settings: mpNetSettings,
    isDedicatedServer: mpIsDedicatedServer,
    dedicatedServerMode: mpDedicatedServerMode,
    dedicatedHostId: MP_DEDICATED_HOST_ID,
    actorUsesClientPrediction: mpActorUsesClientPrediction,
    lagCompensatedTransform: mpLagCompensatedTransform,
    replicationTier: mpReplicationTierForKey,
    tierPriority: MP_REPLICATION_TIER_PRIORITY,
  },
  gas: {
    getStacks: getActorEffectStacks,
    applyEffect,
    getEffect,
    saveEffect,
    initActor: initActorGAS,
  },
  materialTSL: {
    serialize: (graph = emptyMaterialGraph()) => serializeMaterialGraphTSL(graph, 0),
    previewAvailable: () => isTSLPreviewAvailableAsync(),
    compileNodes: (graph = emptyMaterialGraph()) => compileMaterialGraphTSLNodes(graph),
    previewChannels: (graph = emptyMaterialGraph()) => materialGraphTSLPreviewChannels(graph),
    previewChannelForPort: (
      graph = emptyMaterialGraph(),
      toNodeId: string,
      toPort: string,
    ) => previewChannelForPort(graph, toNodeId, toPort),
    soloChannel: (graph = emptyMaterialGraph(), channel: string) =>
      compileMaterialGraphTSLSoloChannel(graph, channel),
  },
  bakeGIProbes: async () => {
    const gfx = (window as unknown as { lotusGfx?: { renderer?: THREE.WebGLRenderer } }).lotusGfx
    if (!gfx?.renderer) return { ok: false, error: 'renderer unavailable (dev viewport only)' }
    const ok = await bakeLightProbeGrid(gfx.renderer, world.scene, world.environment)
    useEditor.getState().setStatus(ok ? 'LightProbeGrid baked (approx)' : 'GI probe bake failed')
    return { ok }
  },
  character: {
    ready: isCharacterControllerReady,
    isOnFloor: characterIsOnFloor,
    moveAndSlide: (
      position: [number, number, number],
      velocity: [number, number, number],
      dt: number,
    ) => {
      const pos = new THREE.Vector3(...position)
      const vel = new THREE.Vector3(...velocity)
      const res = characterMoveAndSlide({ position: pos, velocity: vel, dt })
      if (!res) return null
      return {
        position: [res.position.x, res.position.y, res.position.z] as [number, number, number],
        onFloor: res.onFloor,
      }
    },
  },
  /** Wave 12 — behavior tree editor + live paths */
  bt: {
    emptyGraph: emptyBTGraph,
    compile: compileBTGraph,
    compileScript: compileBTGraphToScript,
    collapseSubtree: collapseBTSubtree,
    expandSubtree: expandBTSubtree,
    graphForCompile: graphForBTCompile,
    resolveHighlight: resolveBTEditorHighlightNodeId,
    validate: validateBTGraph,
    summarize: summarizeBTTree,
    summarizeServices: summarizeBTServices,
    diffScript: (graph = emptyBTGraph(), script = '') => diffBTScriptPreview(script, graph),
    diffGutter: (graph = emptyBTGraph(), script = '') => getBTScriptDiffGutterNodeIds(script, graph),
    diffLineTargets: (graph = emptyBTGraph(), script = '') => getBTScriptDiffLineTargets(script, graph),
    scrollRectForNode: (node: { x: number; y: number }, wrapW: number, wrapH: number) =>
      scrollRectForBTNode(node, wrapW, wrapH),
    resolveDiffGutter: (graph = emptyBTGraph(), script = '', wrapW = 400, wrapH = 280) =>
      resolveBTScriptDiffGutter(script, graph, wrapW, wrapH),
    resolveDiffGutterSelection: (
      graph = emptyBTGraph(),
      nodeIds: string[] = [],
      wrapW = 400,
      wrapH = 280,
    ) => resolveBTScriptDiffGutterSelection(graph, nodeIds, wrapW, wrapH),
    exportDiffPatch: (graph = emptyBTGraph(), script = '') => exportBTScriptDiffPatch(script, graph),
    serviceHost: (graph = emptyBTGraph(), serviceNodeId = '') =>
      getBTServiceHostNodeId(graph, serviceNodeId),
    serviceDecoratorHost: (graph = emptyBTGraph(), serviceNodeId = '') =>
      getBTServiceDecoratorHostId(graph, serviceNodeId),
    breakpointCondition: (graph = emptyBTGraph(), nodeId = '') => {
      const n = graph.nodes.find((x) => x.id === nodeId)
      return n ? getBTBreakpointCondition(n) : 'always'
    },
    shouldBreakpointFire: (
      graph = emptyBTGraph(),
      nodeId = '',
      activeServices: string[] = [],
      blackboard: Record<string, unknown> = {},
    ) => shouldBTBreakpointFire(graph, nodeId, activeServices, blackboard),
    stepOverBreakpoint: (nodeId = '') => registerBTBreakpointStepOver(nodeId),
    stepIntoBreakpoint: (hostId = '') => registerBTBreakpointStepInto(hostId),
    shouldServiceStepInto: (graph = emptyBTGraph(), serviceNodeId = '') =>
      shouldBTServiceStepInto(graph, serviceNodeId),
    subtreeServiceIds: (graph = emptyBTGraph(), decoratorId = '') =>
      getBTSubtreeServiceNodeIds(graph, decoratorId),
    activeBlackboard: (actorId = '') => getActiveBTBlackboard(actorId),
    serviceCompileHint: (graph = emptyBTGraph(), nodeId = '') => getBTNodeServiceCompileHint(graph, nodeId),
    inferBBTypes: inferBlackboardTypes,
    activePaths: getActiveBTPaths,
    activeServiceNodeIds: getActiveBTServiceNodeIds,
  },
  curve: {
    evaluate: evaluateCurve,
    sample: () => evaluateCurve(emptyCurve('e2e'), 0.5),
  },
  ssgi: {
    settings: () => getSSGISettings(world.environment),
  },
  ssr: {
    settings: () => getSSRSettings(world.environment),
  },
  dof: {
    settings: (camera = null as import('./engine/types').CameraProps | null, focusPullT?: number) =>
      getDOFSettings(world.environment, camera, focusPullT),
    resolveFocusPull: (
      camera: import('./engine/types').CameraProps,
      focusPullT: number,
    ) => resolveCameraDOFFocusDistance(camera, world.environment.postDofFocusDistance ?? 5, focusPullT),
  },
  colorGrading: {
    settings: () => getColorGradingSettings(world.environment),
    preset: () => getColorGradingPreset(world.environment),
    exposureScale: (
      lift: [number, number, number] = [0, 0, 0],
      gamma: [number, number, number] = [1, 1, 1],
      gain: [number, number, number] = [1, 1, 1],
    ) => applyExposureToColorGrading({ lift, gamma, gain }, world.environment.exposure ?? 0.75),
    acesEnabled: () => getACESPostEnabled(world.environment),
    acesExposure: () => getACESExposure(world.environment),
    presetAces: (preset?: import('./engine/postStackColorGrading').ColorGradingPreset) =>
      getPresetACESEnabled(world.environment, preset ?? getColorGradingPreset(world.environment)),
    presetThumbnails: () => COLOR_GRADING_PRESET_THUMBNAILS,
    compareT: () => getColorGradingCompareT(world.environment),
    blend: (
      a: import('./engine/postStackColorGrading').ColorGradingSettings,
      b: import('./engine/postStackColorGrading').ColorGradingSettings,
      t: number,
    ) => blendColorGradingSettings(a, b, t),
    lutStub: () => getGradingLUTStub(world.environment),
    lutApply: () => getColorGradingLUTState(world.environment),
    parseCube: (text = '') => parseCubeLUT(text),
    parse3dl: (text = '') => parse3dlLUT(text),
    decodeLut: (name = '', text = '') => decodeGradingLUTFile(name, text),
    decodePng: (rgba: Uint8Array | Uint8ClampedArray, w: number, h: number) =>
      decodePngLUTAtlas(rgba, w, h),
    persistLut: (fileName: string, decoded: NonNullable<ReturnType<typeof decodePngLUTAtlas>>) => {
      persistDecodedLUTToEnvironment(world.environment, fileName, decoded)
      return serializeGradingLUTForLevel(world.environment)
    },
    restoreLut: () => restoreGradingLUTFromEnvironment(world.environment),
    exportLutPayload: () => getExportGradingLUTPayload(world.environment),
    identityLut: () => !!createIdentityLUTTexture(),
  },
  projectSettings: {
    load: loadProjectSettings,
    save: saveProjectSettings,
  },
  /** Wave 33 — Godot-style indie node pack (Timer, RayCast3D, Path3D, groups) */
  indie: {
    samplePath: (
      waypoints: [number, number, number][],
      closed: boolean,
      t: number,
    ): [number, number, number] | null => {
      const p = samplePathAt(waypoints, closed, t)
      return p ? [p.x, p.y, p.z] : null
    },
    defaultTimer: () => ({ ...DEFAULT_TIMER }),
    defaultRayCast: () => ({ ...DEFAULT_RAY_CAST }),
    isAutoload: (actorName: string) => {
      const a = [...world.actors.values()].find((x) => x.name === actorName)
      return a ? world.isAutoloadActor(a) : false
    },
    scriptApi: () => makeScriptApi(world.actors, () => 0, () => null),
    spawn: (payload: AssetPayload, position: [number, number, number] = [0, 1, 0]) => {
      const sa = buildSerializedActor(payload, position)
      runCommand(new AddActorCommand(sa))
      return world.actors.get(sa.id) ?? null
    },
    timerActive: (actorId: string) => world.isTimerActive(actorId),
    rayCastHitId: (rayActorId: string) => world.getRayCastHitId(rayActorId),
    areaOverlaps: (areaId: string) => world.getArea3DOverlaps(areaId),
    exports: {
      parse: parseExports,
      clampRange: clampExportRange,
    },
    prefab: {
      summarizeOverrides: summarizePrefabOverrides,
      revertAllOverrides: revertAllPrefabOverrides,
      save: (rootId: string) => savePrefab(rootId),
      instantiate: (name: string, position: [number, number, number] = [0, 0.5, 0]) => {
        const prefab = getPrefabByName(name)
        if (prefab) instantiatePrefab(prefab, position)
      },
      recordOverride: (actorId: string, fieldPath: string) => recordPrefabOverride(actorId, fieldPath),
      subtree: listPrefabSubtree,
      overrideDiff: getPrefabOverrideDiff,
    },
    sequencer: {
      keyableScriptExports,
      applyScriptVarPreset: (actorId: string, varName: string, presetId: string) =>
        applyScriptVarPreset(world.sequence, actorId, varName, presetId),
      sampleScriptVar: (actorId: string, varName: string, t: number, keys: { t: number; v: number }[]) => {
        const seq = { duration: 10, autoPlay: false, tracks: [], cameraCuts: [], events: [] }
        for (const k of keys) setKey(seq, actorId, varName, k.t, k.v, 'scriptVar')
        sampleSequence(world, seq, t)
        return world.actors.get(actorId)?.scriptVars?.[varName]
      },
    },
    resources: {
      create: createResource,
      get: getResource,
      list: listResources,
      save: saveResource,
      scriptVarPresets: {
        list: listScriptVarPresets,
        load: loadScriptVarPreset,
        save: (name: string, keys: { t: number; v: number }[], varName?: string) =>
          saveScriptVarPreset(name, keys, varName),
      },
    },
    anim: {
      resolveParams: (actorId: string) => {
        const actor = world.actors.get(actorId)
        return actor ? resolveAnimParams(actor) : {}
      },
      setBlendScriptVarLink: (actorId: string, varName?: string) => {
        const actor = world.actors.get(actorId)
        if (!actor) return false
        actor.blendScriptVarLink = varName?.trim() || undefined
        useEditor.getState().touch()
        return true
      },
      getBlendScriptVarLink: (actorId: string) => world.actors.get(actorId)?.blendScriptVarLink,
      setBlendScriptVarLinkX: (actorId: string, varName?: string) => {
        const actor = world.actors.get(actorId)
        if (!actor) return false
        actor.blendScriptVarLinkX = varName?.trim() || undefined
        useEditor.getState().touch()
        return true
      },
      getBlendScriptVarLinkX: (actorId: string) => world.actors.get(actorId)?.blendScriptVarLinkX,
      setBlendScriptVarLinkY: (actorId: string, varName?: string) => {
        const actor = world.actors.get(actorId)
        if (!actor) return false
        actor.blendScriptVarLinkY = varName?.trim() || undefined
        useEditor.getState().touch()
        return true
      },
      getBlendScriptVarLinkY: (actorId: string) => world.actors.get(actorId)?.blendScriptVarLinkY,
      setBlend2DScriptVarLinks: (actorId: string, linkX?: string, linkY?: string) => {
        const actor = world.actors.get(actorId)
        if (!actor) return false
        actor.blendScriptVarLinkX = linkX?.trim() || undefined
        actor.blendScriptVarLinkY = linkY?.trim() || undefined
        useEditor.getState().touch()
        return true
      },
    },
    touch: {
      isTouchDevice: () => isTouchDevice(),
      getMoveAxis: () => getTouchMoveAxis(),
      getActionAxis: (name: string) => getActionAxis(name),
      layoutPresets: [...TOUCH_LAYOUT_PRESET_IDS],
      getLayoutPreset: () => normalizeTouchLayoutPreset(world.environment.touchLayoutPreset),
      setLayoutPreset: (preset: 'compact' | 'wide' | 'fps') => {
        world.environment.touchLayoutPreset = preset
        useEditor.getState().touch()
        const hud = document.getElementById('lotus-touch-hud')
        if (hud) applyTouchLayoutPreset(hud, preset)
        return preset
      },
      getLayoutVars: (preset?: 'compact' | 'wide' | 'fps') => getTouchLayoutVars(preset),
      applyLayoutPreset: (el: HTMLElement, preset?: 'compact' | 'wide' | 'fps') =>
        applyTouchLayoutPreset(el, preset),
      controlsEnabled: () => shouldShowTouchControls(world.environment.touchControls),
      setControlsEnabled: (on: boolean) => {
        world.environment.touchControls = on
        useEditor.getState().touch()
        return on
      },
      reset: () => {
        resetTouchInput()
        return true
      },
      createJoystick: (parent: HTMLElement, radius = 48) => new VirtualJoystick(parent, { radius }),
      fireJustPressed: () => isTouchFireJustPressed(),
      interactJustPressed: () => isTouchInteractJustPressed(),
      simulate: (opts: { fireJust?: boolean; interactJust?: boolean; jumpJust?: boolean }) => {
        syncTouchInputState(
          { x: 0, y: 0 },
          false,
          !!opts.jumpJust,
          false,
          !!opts.fireJust,
          false,
          !!opts.interactJust,
          world.environment.touchHaptics,
          world.environment,
        )
        return true
      },
      endFrame: () => {
        endTouchInputFrame()
        return true
      },
      hapticsSupported: () => isVibrationSupported(),
      hapticsEnabled: () => hapticsEnabled(world.environment.touchHaptics),
      setHapticsEnabled: (on: boolean) => {
        world.environment.touchHaptics = on
        setTouchHapticsEnabled(on)
        useEditor.getState().touch()
        return on
      },
      vibrateFire: () => vibrateFire(world.environment.touchHaptics, hapticScale(world.environment)),
      vibrateInteract: () => vibrateInteract(world.environment.touchHaptics, hapticScale(world.environment)),
      vibrateJump: () => vibrateJump(world.environment.touchHaptics, hapticScale(world.environment)),
    },
    haptics: {
      scale: () => hapticScale(world.environment),
      intensity: () => hapticIntensityFactor(world.environment.hapticIntensity),
      setIntensity: (pct: number) => {
        const v = Math.max(0, Math.min(100, pct)) / 100
        world.environment.hapticIntensity = v
        useEditor.getState().touch()
        return v
      },
      batterySaver: () => world.environment.hapticBatterySaver !== false,
      applyFromProfile: (name: string) => {
        const preset = hapticPresetForProfile(name)
        if (!preset) return null
        world.environment.hapticIntensity = preset.hapticIntensity
        world.environment.hapticBatterySaver = preset.hapticBatterySaver
        world.applyEnvironment()
        useEditor.getState().touch()
        return preset
      },
    },
    gamepad: {
      poll: () => pollGamepadInput(world.environment.gamepadHaptics, world.environment),
      getMoveAxis: () => getGamepadMoveAxis(),
      controlsEnabled: () => shouldEnableGamepadControls(world.environment.gamepadControls),
      setControlsEnabled: (on: boolean) => {
        world.environment.gamepadControls = on
        useEditor.getState().touch()
        return on
      },
      hapticsSupported: () => isGamepadHapticsSupported(),
      hapticsEnabled: () => gamepadHapticsEnabled(world.environment.gamepadHaptics),
      setHapticsEnabled: (on: boolean) => {
        world.environment.gamepadHaptics = on
        setGamepadHapticsEnabled(on)
        useEditor.getState().touch()
        return on
      },
      pulseFire: () => pulseGamepadFire(world.environment.gamepadHaptics, hapticScale(world.environment)),
      pulseInteract: () =>
        pulseGamepadInteract(world.environment.gamepadHaptics, hapticScale(world.environment)),
      reset: () => {
        resetGamepadInput()
        return true
      },
    },
    input: {
      getBindings: () => getBindings(),
      setGamepadButton: (action: GamepadAction, button: number) => setGamepadButton(action, button),
      setTouchSlot: (action: TouchAction, slot: TouchSlotId) => setTouchSlot(action, slot),
      resetBindings: () => {
        resetBindings()
        return getBindings()
      },
      profiles: () => profiles(),
      listProfiles: () => listInputProfiles(),
      activeProfile: () => activeProfile(),
      hapticPresetForProfile: (name: string) => hapticPresetForProfile(name),
      applyProfile: (name: string) => {
        const applied = applyInputProfile(name)
        if (applied) {
          const hud = document.getElementById('lotus-touch-hud')
          if (hud) applyTouchLayoutPreset(hud, applied.touchLayoutPreset)
          useEditor.getState().touch()
        }
        return applied
      },
      saveProfile: (name: string) => saveInputProfile(name),
      loadProfile: (name: string) => {
        const applied = loadInputProfile(name)
        if (applied) {
          const hud = document.getElementById('lotus-touch-hud')
          if (hud) applyTouchLayoutPreset(hud, applied.touchLayoutPreset)
          useEditor.getState().touch()
        }
        return applied
      },
    },
    minigame: {
      managerName: MINIGAME_MANAGER_NAME,
      goalZoneName: GOAL_ZONE_NAME,
      fpsTargetTag: FPS_TARGET_TAG,
      rpgNpcGoal: RPG_NPC_GOAL,
      platformerScript: PLATFORMER_MINIGAME_SCRIPT,
      rpgScript: RPG_MINIGAME_SCRIPT,
      fpsScript: FPS_MINIGAME_SCRIPT,
      attachMiniGameScripts,
      spawnMiniGame,
      showHud: () => {
        enableMiniGameHud()
        return true
      },
      hideHud: () => {
        hideMiniGameHud()
        return true
      },
      showWinOverlay,
      showLoseOverlay,
      exportPreset: (mode: 'platformer' | 'rpg' | 'fps') => exportMiniGamePreset(mode),
      packModes: [...MINIGAME_PACK_MODES],
      packTitle: (mode: 'platformer' | 'rpg' | 'fps') => miniGamePackTitle(mode),
      packIconStub: () => miniGamePackIconStub(),
      buildPackHTML: (mode: 'platformer' | 'rpg' | 'fps') => buildMiniGamePackHTML(mode),
      exportPack: (mode: 'platformer' | 'rpg' | 'fps') => exportMiniGamePack(mode),
      itchPack: (mode: 'platformer' | 'rpg' | 'fps') => exportItchUploadPack(mode),
      butlerHint: (
        mode: 'platformer' | 'rpg' | 'fps',
        user?: string,
        game?: string,
        channel?: 'html' | 'beta' | 'demo',
      ) =>
        buildButlerPushCommand(buildExportPackMeta(mode, channel), itchPackZipFilename(mode), user, game, channel),
      packMeta: (mode: 'platformer' | 'rpg' | 'fps', channel?: 'html' | 'beta' | 'demo') =>
        buildExportPackMeta(mode, channel),
      releaseNotes: (mode: 'platformer' | 'rpg' | 'fps') => buildReleaseNotes(mode),
      captureScreenshot: () => captureExportScreenshot(),
    },
    achievements: {
      list: (packId?: string) => achievementsForPack(packId),
      unlock: (id: string, packId?: string) => unlockAchievement(id, packId).newlyUnlocked,
      unlocked: (id?: string, packId?: string) =>
        id ? isAchievementUnlocked(id, packId) : listUnlocked(packId),
      packId: (packId?: string) =>
        packId !== undefined ? setAchievementPackId(packId) : getAchievementPackId(),
      showToast: (title: string, subtitle?: string, icon?: string) => showAchievementToast(title, subtitle, icon),
    },
    mp: {
      tagHost: MP_TAG_HOST,
      tagSync: MP_TAG_SYNC,
      tagTarget: MP_TAG_TARGET,
      hostScript: MP_HOST_SCRIPT,
      syncScript: MP_SYNC_SCRIPT,
      scoreScript: MP_SCORE_SCRIPT,
      scoreboardScript: MP_SCOREBOARD_SCRIPT,
      teamsScoreScript: MP_TEAMS_SCORE_SCRIPT,
      teamsScoreboardScript: MP_TEAMS_SCOREBOARD_SCRIPT,
      winScore: MP_SCORE_WIN,
      getScore: (peerId?: string) => getMpScore(world.actors, peerId),
      getPeerScores: () => getMpPeerScores(world.actors),
      mirrorScores: (scores: Record<string, number>) => mirrorMpPeerScores(world.actors, scores),
      addScore: (delta: number, peerId?: string) => addMpScore(world.actors, delta, peerId),
      applyMpScoreDelta: (
        peerId: string,
        delta: number,
        emit?: (signal: string, ...args: unknown[]) => void,
      ) => applyMpScoreDelta(world.actors, peerId, delta, emit),
      getTeamScores: () => getMpTeamScores(world.actors),
      mirrorTeamScores: (scores: { red: number; blue: number }) => mirrorMpTeamScores(world.actors, scores),
      addTeamScore: (delta: number, peerId?: string) => addMpTeamScore(world.actors, delta, peerId),
      applyMpTeamScoreDelta: (
        team: 'red' | 'blue',
        delta: number,
        emit?: (signal: string, ...args: unknown[]) => void,
      ) => applyMpTeamScoreDelta(world.actors, team, delta, emit, mpBroadcastTeamScores),
      teams: {
        redTag: MP_TAG_RED,
        blueTag: MP_TAG_BLUE,
        assign: (peerId: string) => mpBroadcastTeamAssign(peerId),
        getTeam: (peerId?: string) => mpTeamsGet(peerId ?? mpLocalId()),
        getTeamScores: () => getMpTeamScores(world.actors),
      },
      lobbyScript: MP_LOBBY_SCRIPT,
      lobby: {
        setReady: (ready: boolean) => mpLobbySetReady(ready),
        isReady: (peerId?: string) => mpLobbyIsReady(peerId ?? (mpLocalId() || '__local__')),
        allReady: () => mpLobbyAllReady(),
        peerReadyCount: () => mpLobbyPeerReadyCount(),
        peers: () => mpLobbyPeers(),
        tryStart: () => mpLobbyTryStart(),
      },
      matchmaking: {
        listRooms: () => mpListRooms(),
        pingMs: () => mpPingMs(),
        refreshRooms: () => mpRefreshRooms(),
      },
      spectator: {
        tag: MP_TAG_SPECTATOR,
        script: MP_SPECTATOR_SCRIPT,
        enable: (on: boolean) => {
          mpSpectatorEnable(on)
          return on
        },
        isSpectator: () => mpIsSpectator(),
        spawnSpectator: () => spawnIndieMpSpectator(),
      },
      replay: {
        sampleAt: (offsetSec: number) => mpReplaySampleAt(offsetSec),
        seek: (offsetSec: number) => mpReplaySeek(offsetSec),
        bufferLength: () => mpReplayBufferLength(),
        recordEnabled: () => mpReplayRecordEnabled(),
      },
      killcam: {
        trigger: (reason?: string) => {
          mpKillcamTrigger(reason)
          return true
        },
        active: () => mpKillcamActive(),
        durationSec: () => MP_KILLCAM_DURATION_SEC,
        seekSec: () => MP_KILLCAM_SEEK_SEC,
        remainingSec: () => mpKillcamRemainingSec(),
        triggerReason: () => mpKillcamTriggerReason(),
        onPlayerKilled: (killerId: string, victimId: string) => mpKillcamOnPlayerKilled(killerId, victimId),
        onGameWon: (winnerId: string) => mpKillcamOnGameWon(winnerId),
        reportKill: (victimId: string, killerId?: string) => mpReportPlayerKill(victimId, killerId),
        seekOffset: () => mpKillcamSeekOffset(),
        tick: (dt: number) => mpKillcamTick(dt),
        /** E2E — pin local peer id for victim killcam checks */
        setLocalId: (peerId: string) => {
          mpKillcamSetLocalIdHook(() => peerId)
          return peerId
        },
      },
    },
    spawnCharacterStarter,
    spawnPlatformerStarter,
    spawnTopDownRpgStarter,
    spawnFpsStarter,
    spawnIndieMpTemplate,
    spawnIndieMpDeathmatch,
    spawnIndieMpTeamsDeathmatch,
    spawnIndieMpLobby,
    spawnIndieMpSpectator,
    configureIndieMpSettings,
    spawnMiniGame,
    flow: {
      managerName: MAIN_MENU_MANAGER_NAME,
      menuScript: MAIN_MENU_SCRIPT,
      menuItems: MENU_ITEMS,
      spawnMainMenu,
      selectLevel: (
        kind: MainMenuLevelKind,
        opts?: { play?: boolean; link?: boolean; transition?: boolean | SceneTransitionKind; transitionMs?: number },
      ) => selectLevel(kind, opts),
      fadeToLevel: (kind: MainMenuLevelKind, ms = 400) => fadeToLevel(kind, ms),
      transition: (kind: SceneTransitionKind, ms = 400, phase: SceneTransitionPhase = 'out') =>
        sceneTransition(kind, ms, phase),
      linkStarterLevel,
      paintMainMenuHud,
      mainMenuBootEnabled,
    },
  },
  /** Wave 36–41 — GridMap cell helpers (foliage snap mode) */
  gridMap: {
    worldToGridCell: (x: number, y: number, z: number) => worldToGridCell(x, y, z),
    gridCellKey: (cx: number, cy: number, cz: number) => gridCellKey(cx, cy, cz),
    paintCell: (props: import('./engine/types').FoliageProps, cx: number, cy: number, cz: number) =>
      paintGridCell(props, cx, cy, cz),
    eraseCell: (props: import('./engine/types').FoliageProps, cx: number, cy: number, cz: number) =>
      eraseGridCell(props, cx, cy, cz),
    getCellCount: (props: import('./engine/types').FoliageProps) => getGridCellCount(props),
    cellsInBrush: (cx: number, cy: number, cz: number, brushSize: number) =>
      gridCellsInBrush(cx, cy, cz, brushSize),
    tileKinds: ['box', 'sphere', 'plane'] as const,
    activeLayer: (props: import('./engine/types').FoliageProps) => activeGridLayerIndex(props),
    paintLayer: (props: import('./engine/types').FoliageProps, layer: number, cx: number, cy: number, cz: number) =>
      paintGridLayer(props, layer, cx, cy, cz),
    eraseLayer: (props: import('./engine/types').FoliageProps, layer: number, cx: number, cy: number, cz: number) =>
      eraseGridLayer(props, layer, cx, cy, cz),
    getLayerCellCount: (props: import('./engine/types').FoliageProps, layer: number) => getLayerCellCount(props, layer),
    autotileNeighbors: (hasN: boolean, hasE: boolean, hasS: boolean, hasW: boolean) =>
      autotileNeighbors(hasN, hasE, hasS, hasW),
    autotileExtendedMask: (
      hasN: boolean,
      hasE: boolean,
      hasS: boolean,
      hasW: boolean,
      hasNE: boolean,
      hasSE: boolean,
      hasSW: boolean,
      hasNW: boolean,
    ) => autotileExtendedMask(hasN, hasE, hasS, hasW, hasNE, hasSE, hasSW, hasNW),
    resolveAutotileKind: (
      mask: number,
      neighborKinds: ('box' | 'sphere' | 'plane' | null)[],
      baseKind: 'box' | 'sphere' | 'plane',
    ) => resolveAutotileKind(mask, neighborKinds, baseKind),
    autotileRuleForMask: (
      mask: number,
      tileKind: 'box' | 'sphere' | 'plane',
      extendedMask?: number,
      neighborKinds?: ('box' | 'sphere' | 'plane' | null)[],
    ) => autotileRuleForMask(mask, tileKind, extendedMask, neighborKinds),
    resolveAutotileCorner: (cardinalMask: number, extendedMask: number) =>
      resolveAutotileCorner(cardinalMask, extendedMask),
    setLayerVisible: (props: import('./engine/types').FoliageProps, layer: number, visible: boolean) =>
      setGridLayerVisible(props, layer, visible),
    isLayerVisible: (props: import('./engine/types').FoliageProps, layer: number) => isGridLayerVisible(props, layer),
    previewAutotileMask: (props: import('./engine/types').FoliageProps, layer: number, cx: number, cy: number, cz: number) =>
      previewAutotileMask(props, layer, cx, cy, cz),
    previewAutotileExtendedMask: (
      props: import('./engine/types').FoliageProps,
      layer: number,
      cx: number,
      cy: number,
      cz: number,
    ) => previewAutotileExtendedMask(props, layer, cx, cy, cz),
    previewAutotileCorner: (
      props: import('./engine/types').FoliageProps,
      layer: number,
      cx: number,
      cy: number,
      cz: number,
    ) => previewAutotileCorner(props, layer, cx, cy, cz),
    AUTOTILE_ATLAS_SIZE,
    atlasIndexForMask: (mask: number) => atlasIndexForMask(mask),
    atlasIndexForCorner: (corner: import('./engine/gridMap').AutotileCorner) => atlasIndexForCorner(corner),
    atlasIndexForRule: (rule: import('./engine/gridMap').AutotileRule) => atlasIndexForRule(rule),
    atlasUvRect: (index: number, cols?: number, rows?: number) => atlasUvRect(index, cols, rows),
    /** Wave 61 — custom autotile sheet import + manual tile mapping */
    importAtlasSheet: (dataUrl: string, name?: string) => importAtlasSheet(dataUrl, name),
    listAtlasSheets: () => listAtlasSheets(),
    setTileMap: (props: import('./engine/types').FoliageProps, tileMap: Record<number, number>) =>
      setTileMap(props, tileMap),
    getTileMap: (props: import('./engine/types').FoliageProps) => getTileMap(props),
    atlasSlotForMask: (mask: number, tileMap?: Record<number, number>) => atlasSlotForMask(mask, tileMap),
    /** Wave 66 — per-grid-layer Rapier collision groups for tile colliders */
    getLayerCollisionGroup: (props: import('./engine/types').FoliageProps, layer: number) =>
      getLayerCollisionGroup(props, layer),
    setLayerCollisionGroup: (props: import('./engine/types').FoliageProps, layer: number, group: number) =>
      setLayerCollisionGroup(props, layer, group),
    rapierGroupsFromLayerMask: (membership: number, mask: number) => rapierGroupsFromLayerMask(membership, mask),
    membershipFromRapierGroup: (group: number) => membershipFromRapierGroup(group),
    maskFromRapierGroup: (group: number) => maskFromRapierGroup(group),
    rebuildFoliageColliders: (actor: import('./engine/Actor').Actor) => rebuildFoliageColliders(actor),
    foliageColliderGroups: (actor: import('./engine/Actor').Actor) => foliageColliderGroups(actor),
    /** Wave 71 — Recast navmesh bake per grid layer mask */
    getNavmeshLayerMask: (props: import('./engine/types').FoliageProps) => getNavmeshLayerMask(props),
    setNavmeshLayerMask: (props: import('./engine/types').FoliageProps, mask: number) =>
      setNavmeshLayerMask(props, mask),
    bakeNavMeshLayers: (mask: number) => bakeNavMeshLayers(world.actors, mask),
    bakeNavMeshForGridLayer: (layer: number) => bakeNavMeshForGridLayer(world.actors, layer),
    collectGridNavMeshes: (mask: number) => collectGridNavMeshes(world.actors, mask).length,
    collectFoliageNavColliderMeshes: (mask: number) =>
      collectFoliageNavColliderMeshes(world.actors, mask).length,
    /** Wave 76 — DetourCrowd agents on per-layer grid navmesh bakes
     *  Wave 81 — patrol / chase AI behaviors */
    navAgents: {
      spawn: (
        id: string,
        layer: number,
        pos: [number, number, number],
        target?: [number, number, number],
      ) => spawnGridNavAgent(world.actors, id, layer, pos, target),
      spawnPatrol: (
        id: string,
        layer: number,
        pos: [number, number, number],
        waypoints?: [number, number, number][],
      ) => spawnGridNavPatrolAgent(world.actors, id, layer, pos, waypoints),
      spawnChase: (
        id: string,
        layer: number,
        pos: [number, number, number],
        chaseTag?: string,
      ) => spawnGridNavChaseAgent(world.actors, id, layer, pos, chaseTag),
      setBehavior: (id: string, behavior: GridNavBehavior, opts?: {
        waypoints?: [number, number, number][]
        chaseTag?: string
        chaseRange?: number
      }) => setAgentBehavior(id, behavior, opts),
      getBehavior: (id: string) => getAgentBehavior(id),
      tick: (dt: number) => tickGridNavAgents(dt, world.actors),
      count: (layer?: number) => gridNavAgentCount(layer),
      layer: (id: string) => gridNavAgentLayer(id),
      getPosition: (id: string) => gridNavAgentGetPosition(id),
      clampLayer: (layer: number) => clampGridNavLayer(layer),
    },
  },
  /** Wave 74 — adaptive haptics scale (perf gate + battery + intensity) */
  adaptiveHaptics: {
    hapticScale: (env: import('./engine/adaptiveHaptics').HapticScaleEnv, perfGate?: import('./engine/adaptiveHaptics').HapticPerfGate | null, charging?: boolean) =>
      hapticScale(env, perfGate, charging),
    perfFpsHapticScale,
    batteryHapticScale: (env: import('./engine/adaptiveHaptics').HapticScaleEnv, charging?: boolean) =>
      batteryHapticScale(env, charging),
    hapticIntensityFactor,
    setBatteryChargingForTest,
  },
  renderer: {
    runQA: runWebGPUQAMatrix,
    ssgi: () => getSSGISettings(world.environment),
  },
  particles: {
    create: (backend: 'cpu' | 'gpu' = 'cpu') => createParticleSystem({ ...DEFAULT_PARTICLES, maxParticles: 32 }, backend),
    qaMatrix: runParticleGPUQAMatrix,
    gpuSubBurstReady: () => isParticleGpuSubBurstReady(),
    gpuSubBurstBatchReady: () => {
      const ps = createParticleSystem({ ...DEFAULT_PARTICLES, maxParticles: 32 }, 'gpu')
      return typeof ps.gpuSubBurstSpawnBatch === 'function'
    },
  },
  export: {
    buildPlayableHTML,
    buildMiniGamePackHTML,
    buildItchZip: (mode: 'platformer' | 'rpg' | 'fps') => buildItchZipBlob(mode),
    itchZipFilename: (mode: 'platformer' | 'rpg' | 'fps') => itchPackZipFilename(mode),
    butlerPushCommand: (
      mode: 'platformer' | 'rpg' | 'fps',
      user?: string,
      game?: string,
      channel?: 'html' | 'beta' | 'demo',
    ) =>
      buildButlerPushCommand(buildExportPackMeta(mode, channel), itchPackZipFilename(mode), user, game, channel),
    listItchZipEntries: async (blob: Blob) => listZipStoreEntryNames(new Uint8Array(await blob.arrayBuffer())),
    readItchZipEntry: async (blob: Blob, name: string) => {
      const body = readZipStoreEntry(new Uint8Array(await blob.arrayBuffer()), name)
      return body ? new TextDecoder().decode(body) : null
    },
    captureScreenshot: () => captureExportScreenshot(),
    buildReleaseNotes: (mode: 'platformer' | 'rpg' | 'fps') => buildReleaseNotes(mode),
    renderPackChangelogHtml: (mode: 'platformer' | 'rpg' | 'fps') => buildPackChangelogHtml(mode),
    renderReleaseNotesHtml: (markdown: string) => renderReleaseNotesHtml(markdown),
    probePerfGate: probeExportPerfGate,
    schedulePerfProbe: scheduleExportPerfProbe,
  },
  /** Wave 65 — localStorage save slots (PIE + export); Wave 70 — IndexedDB cloud backup; Wave 75 — cross-level; Wave 80 — pause menu; Wave 84 — cloud manifest */
  save: {
    checkpoint: (slot: string, data: unknown) => {
      setSaveContext({
        levelName: world.levelName,
        enabled: world.environment.saveSlotsEnabled === true,
        cloudBackup: world.environment.cloudSaveBackup === true,
        crossLevelSaves: world.environment.crossLevelSaves === true,
      })
      return saveCheckpoint(slot, data)
    },
    load: (slot: string) => {
      setSaveContext({
        levelName: world.levelName,
        enabled: world.environment.saveSlotsEnabled === true,
        cloudBackup: world.environment.cloudSaveBackup === true,
        crossLevelSaves: world.environment.crossLevelSaves === true,
      })
      return loadCheckpoint(slot)
    },
    listSlots: () => {
      setSaveContext({
        levelName: world.levelName,
        enabled: world.environment.saveSlotsEnabled === true,
        cloudBackup: world.environment.cloudSaveBackup === true,
        crossLevelSaves: world.environment.crossLevelSaves === true,
      })
      return listSlots()
    },
    enabled: () => world.environment.saveSlotsEnabled === true,
    crossLevel: () => world.environment.crossLevelSaves === true,
    cloudBackup: () => world.environment.cloudSaveBackup === true,
    migrateToLevel: (name: string) => {
      setSaveContext({
        levelName: world.levelName,
        enabled: world.environment.saveSlotsEnabled === true,
        cloudBackup: world.environment.cloudSaveBackup === true,
        crossLevelSaves: world.environment.crossLevelSaves === true,
      })
      const migrated = migrateToLevel(name)
      world.levelName = name
      return migrated
    },
    globalCheckpoint: (slot: string, data: unknown) => {
      setSaveContext({
        levelName: world.levelName,
        enabled: world.environment.saveSlotsEnabled === true,
        cloudBackup: world.environment.cloudSaveBackup === true,
        crossLevelSaves: world.environment.crossLevelSaves === true,
      })
      return globalCheckpoint(slot, data)
    },
    globalLoad: (slot: string) => {
      setSaveContext({
        levelName: world.levelName,
        enabled: world.environment.saveSlotsEnabled === true,
        cloudBackup: world.environment.cloudSaveBackup === true,
        crossLevelSaves: world.environment.crossLevelSaves === true,
      })
      return globalLoad(slot)
    },
    backupToCloud: async (slot: string, data: unknown) => {
      setSaveContext({
        levelName: world.levelName,
        enabled: world.environment.saveSlotsEnabled === true,
        cloudBackup: world.environment.cloudSaveBackup === true,
        crossLevelSaves: world.environment.crossLevelSaves === true,
      })
      return backupCheckpointToIndexedDB(slot, data)
    },
    restoreFromCloud: async (slot: string) => {
      setSaveContext({
        levelName: world.levelName,
        enabled: world.environment.saveSlotsEnabled === true,
        cloudBackup: world.environment.cloudSaveBackup === true,
        crossLevelSaves: world.environment.crossLevelSaves === true,
      })
      return restoreFromIndexedDB(slot)
    },
    listCloudSlots: async () => {
      setSaveContext({
        levelName: world.levelName,
        enabled: world.environment.saveSlotsEnabled === true,
        cloudBackup: world.environment.cloudSaveBackup === true,
        crossLevelSaves: world.environment.crossLevelSaves === true,
      })
      return listCloudSlots()
    },
    cloudManifest: async () => {
      setSaveContext({
        levelName: world.levelName,
        enabled: world.environment.saveSlotsEnabled === true,
        cloudBackup: world.environment.cloudSaveBackup === true,
        crossLevelSaves: world.environment.crossLevelSaves === true,
      })
      return exportCloudSaveManifest()
    },
    crossDeviceHint: async () => {
      setSaveContext({
        levelName: world.levelName,
        enabled: world.environment.saveSlotsEnabled === true,
        cloudBackup: world.environment.cloudSaveBackup === true,
        crossLevelSaves: world.environment.crossLevelSaves === true,
      })
      const manifest = await exportCloudSaveManifest()
      return manifest.crossDeviceHint
    },
    syncEnabled: () =>
      world.environment.saveSlotsEnabled === true && world.environment.cloudSaveBackup === true,
    levelName: () => getSaveLevelName(),
    isActive: () => isSaveEnabled(),
    isCrossLevelActive: () => isCrossLevelSavesEnabled(),
    isCloudBackupActive: () => isCloudBackupEnabled(),
    showMenu: () => showSaveMenu(),
    hideMenu: () => hideSaveMenu(),
    isPaused: () => isSaveMenuPaused(),
  },
  /** Wave 60 — cell load progress (export UX + devtools) */
  streaming: {
    getProgress: () => getProgress(),
    cellsLoaded: () => getCellsLoaded(),
    cellsTotal: () => getCellsTotal(),
    getState: () => getStreamingProgress(),
    reset: () => {
      resetStreamingProgress()
      return getStreamingProgress()
    },
    begin: (total: number) => {
      beginStreamingProgress(total)
      return getStreamingProgress()
    },
    noteCellLoaded: () => {
      noteStreamingCellLoaded()
      return getStreamingProgress()
    },
    tickCell: () => tickStreamProgressCell(),
  },
}
const win = window as unknown as Record<string, unknown>
win.lotus = lotusBridge
win.vektra = lotusBridge // legacy alias — plugins/tests may still use window.vektra

let booted = false

export default function App() {
  useEffect(() => {
    // boot once — restore the autosaved level, or build the starter level
    if (!booted) {
      booted = true
      preloadPhysics()
      loadUserPlugins()
      restoreAutosave().then((ok) => {
        if (!ok) newLevel()
        window.setTimeout(() => probeExportPerfGate(), 4000)
      })
    }
    useEditor.getState().resetAutosaveCountdown()
    const countdownTimer = setInterval(() => {
      const st = useEditor.getState()
      const next = st.autosaveCountdownSec - 1
      if (next <= 0) {
        if (st.saveStatus === 'dirty') autosave()
        else st.resetAutosaveCountdown()
      } else {
        st.setAutosaveCountdown(next)
      }
    }, 1000)
    // UE Content Drawer: Ctrl+Space summons floating drawer; click-outside auto-collapse when unpinned
    const onDrawerKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return
      if (!matchesShortcutId(e, 'panels.contentDrawer')) return
      e.preventDefault()
      useEditor.getState().toggleContentDrawer()
    }
    const onDrawerCollapse = (e: MouseEvent) => {
      const st = useEditor.getState()
      if (st.contentDrawerDocked || !st.contentDrawerOpen) return
      const el = e.target as HTMLElement
      if (
        el.closest('.content-drawer-overlay') ||
        el.closest('.asset-ctx') ||
        el.closest('.status-drawer-btn')
      ) {
        return
      }
      st.closeContentDrawer()
    }
    window.addEventListener('keydown', onDrawerKey)
    window.addEventListener('mousedown', onDrawerCollapse)

    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return
      if (matchesShortcutId(e, 'tools.save')) {
        e.preventDefault()
        saveLevelToFile()
        return
      }
      if (matchesShortcutId(e, 'gizmo.spaceCtrl')) {
        e.preventDefault()
        useEditor.getState().toggleGizmoSpace()
        return
      }
      if (matchesShortcutId(e, 'panels.console')) {
        e.preventDefault()
        useEditor.getState().openConsole()
      }
    }
    window.addEventListener('keydown', onKey)
    const disconnectBridge = connectTerminalBridge()
    return () => {
      clearInterval(countdownTimer)
      window.removeEventListener('keydown', onDrawerKey)
      window.removeEventListener('mousedown', onDrawerCollapse)
      window.removeEventListener('keydown', onKey)
      disconnectBridge()
    }
  }, [])

  return (
    <div className="editor-root">
      <MenuBar />
      <Toolbar />
      <div className="editor-main">
        <PlaceActors />
        <div className="editor-center">
          <Viewport />
          <BottomDock />
        </div>
        <div className="editor-right">
          <Outliner />
          <Details />
        </div>
      </div>
      <StatusBar />
      <FloatingContentDrawer />
      <CommandPalette />
      <PrefsHost />
      <ShortcutEditorHost />
      <PluginManagerHost />
      <ProjectSettingsHost />
    </div>
  )
}

function PrefsHost() {
  const show = useEditor((s) => s.showPrefs)
  const setShow = useEditor((s) => s.setShowPrefs)
  if (!show) return null
  return <PreferencesModal onClose={() => setShow(false)} />
}

function ShortcutEditorHost() {
  const show = useEditor((s) => s.showShortcutEditor)
  const setShow = useEditor((s) => s.setShowShortcutEditor)
  if (!show) return null
  return <ShortcutEditor onClose={() => setShow(false)} />
}

function PluginManagerHost() {
  const show = useEditor((s) => s.showPluginManager)
  const setShow = useEditor((s) => s.setShowPluginManager)
  if (!show) return null
  return <PluginManagerModal onClose={() => setShow(false)} />
}

function ProjectSettingsHost() {
  const show = useEditor((s) => s.showProjectSettings)
  const setShow = useEditor((s) => s.setShowProjectSettings)
  if (!show) return null
  return <ProjectSettingsModal onClose={() => setShow(false)} />
}
