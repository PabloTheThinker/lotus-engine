import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { Sky } from 'three/addons/objects/Sky.js'
import { Actor } from './Actor'
import {
  applyMaterialProps,
  createCameraActor,
  createEmptyActor,
  createImportedMeshActor,
  createLightActor,
  createPlayerStartActor,
  createStaticMeshActor,
  createFolderActor,
  createParticleEmitterActor,
  createFoliageLayerActor,
  buildFoliageMesh,
  createPostProcessVolumeActor,
} from './factory'
import { createLandscapeActor, buildLandscapeMesh, sampleLandscapeHeight } from './landscape'
import { DEFAULT_PARTICLES } from './particles'
import { createWaterActor, buildWaterMesh, updateWater } from './water'
import { createPCGVolumeActor } from './pcg'
import { syncPropsFromGraph } from './pcgGraph'
import { activateAbility, initAllActorGAS, resetAbilities, setAbilityPlayClock, tickEffects } from './gameplayAbilities'
import { hud, resetGameplay, syncAuthoredHud, tickGameplay } from './gameplay'
import { resetBTs, tickBTs } from './behaviorTree'
import { resetNav } from './nav'
import { playMetaSound, registerSound, setReverbZone, setSoundAttenuationDefaults, stopAllSounds, type ReverbPreset } from './audio'
import {
  createTriggerVolumeActor,
  createSoundEmitterActor,
  createReflectionProbeActor,
  createCustomMeshActor,
  createLabel3DActor,
  rebuildLabel3D,
} from './factory'
import { createWidget3DActor, syncWidget3D } from './widget3d'
import { PhysicsSim } from './physics'
import { makeScriptApi, resetSignals, scriptLog, setDataStore } from './scripting'
import { cameraCutAt, emptySequence, eventsBetween, hasAudioTracks, sampleSequence, type Sequence } from './sequencer'
import { setViewCamera } from './gameplay'
import { applyActorMaterial, getEffectiveMaterialGraph, getEffectiveMaterialGraphMode } from './materialAssets'
import { applyMaterialGraph } from './materialGraph'
import {
  assignStreamCellOnSave,
  cellKey,
  splitLevelByCells,
} from './streaming'
import { applySerializedBakedAO } from './lightmapBake'
import type { CameraBookmark, EnvironmentSettings, HudWidget, LevelLink, SerializedActor, SerializedLevel, StreamingSettings } from './types'
import { DEFAULT_ENVIRONMENT, DEFAULT_STREAMING } from './types'
import { tickAnimSM, tickBlendSpace1D, tickBlendSpace2D } from './animStateMachine'
import { applyActorIK, hasActorSkeleton } from './ik'
import { clearActorTicks, recordActorTick } from './profiler'

/**
 * World — the Unreal UWorld analog. Owns the Three.js scene graph,
 * the actor registry, the asset registry, and the PIE lifecycle
 * (physics + behaviors only run between beginPlay and endPlay).
 */
export class World {
  scene = new THREE.Scene()
  actors = new Map<string, Actor>()
  levelName = 'Untitled'
  environment: EnvironmentSettings = { ...DEFAULT_ENVIRONMENT }
  streaming: StreamingSettings = { ...DEFAULT_STREAMING }
  playing = false
  physics = new PhysicsSim()

  // sky atmosphere (UE SkyAtmosphere analog)
  sky = new Sky()
  sunDirection = new THREE.Vector3(0, 1, 0)
  /** bumped on every applyEnvironment so the viewport knows to rebuild IBL */
  envVersion = 0

  // imported glTF assets: raw base64 for serialization + template scene for cloning
  assets = new Map<string, { name: string; data: string; template: THREE.Group; animations?: THREE.AnimationClip[] }>()

  /** master Sequencer timeline (UE Sequencer analog) */
  sequence: Sequence = emptySequence()

  /** data assets (UE DataTables) — name → JSON */
  dataTables: Record<string, unknown> = {}

  /** imported audio (base64) — registered with the audio engine on load */
  sounds: Record<string, string> = {}

  /** per-imported-sound attenuation defaults */
  soundAttenuation: Record<string, import('./types').AttenuationSettings> = {}

  /** authored HUD widgets (UMG designer) */
  hudWidgets: HudWidget[] = []

  /** HDRI environment (base64 .hdr) — overrides the sky when set */
  hdri: string | null = null

  /** linked levels for multi-level export + api.loadLevel during PIE */
  levelLinks: LevelLink[] = []

  /** per-cell actor lists for lazy streaming (rebuilt on serialize when exportByCell) */
  cellManifest: Record<string, SerializedActor[]> = {}

  /** editor camera bookmarks — persisted in the level file (slots 0–9) */
  cameraBookmarks: (CameraBookmark | null)[] = Array.from({ length: 10 }, () => null)

  /** editor snapshot taken at PIE start — restored when play stops */
  pieSnapshot: SerializedLevel | null = null

  /** called after api.loadLevel swaps scenes (viewport re-possesses pawn) */
  onLevelSwitched: (() => void) | null = null

  /** probe ids awaiting a cubemap bake (processed by the viewport) */
  probeBakeQueue: string[] = []

  constructor() {
    this.sky.scale.setScalar(450000)
    this.sky.userData.isHelper = true
    this.applyEnvironment()
  }

  applyEnvironment() {
    const env = this.environment
    if (env.skyEnabled) {
      if (!this.sky.parent) this.scene.add(this.sky)
      const u = this.sky.material.uniforms
      u.turbidity.value = 4
      u.rayleigh.value = 1.1
      u.mieCoefficient.value = 0.004
      u.mieDirectionalG.value = 0.8
      const phi = THREE.MathUtils.degToRad(90 - env.sunElevation)
      const theta = THREE.MathUtils.degToRad(env.sunAzimuth)
      this.sunDirection.setFromSphericalCoords(1, phi, theta)
      u.sunPosition.value.copy(this.sunDirection)
      this.scene.background = null
      // UE5-style atmosphere sun binding: directional lights track the sky sun
      for (const a of this.actors.values()) {
        if (a.type === 'DirectionalLight' && a.parentId === null) {
          a.root.position.copy(this.sunDirection).multiplyScalar(30)
        }
      }
    } else {
      this.sky.removeFromParent()
      this.scene.background = new THREE.Color(env.background)
    }
    this.scene.fog = env.fogEnabled ? new THREE.FogExp2(env.fogColor, env.fogDensity) : null
    this.envVersion += 1
  }

  addActor(actor: Actor, parentId: string | null = null) {
    this.actors.set(actor.id, actor)
    actor.parentId = parentId
    const parent = parentId ? this.actors.get(parentId) : undefined
    ;(parent ? parent.root : this.scene).add(actor.root)
    if (actor.cameraHelper) this.scene.add(actor.cameraHelper)
  }

  removeActor(id: string) {
    const actor = this.actors.get(id)
    if (!actor) return
    for (const child of this.childrenOf(id)) {
      this.reparent(child.id, actor.parentId)
    }
    actor.root.removeFromParent()
    if (actor.pcgMesh) actor.pcgMesh.removeFromParent()
    if (actor.cameraHelper) actor.cameraHelper.removeFromParent()
    actor.dispose()
    this.actors.delete(id)
  }

  reparent(id: string, newParentId: string | null) {
    const actor = this.actors.get(id)
    if (!actor || id === newParentId) return
    let p = newParentId
    while (p) {
      if (p === id) return
      p = this.actors.get(p)?.parentId ?? null
    }
    actor.parentId = newParentId
    const parent = newParentId ? this.actors.get(newParentId) : undefined
    ;(parent ? parent.root : this.scene).attach(actor.root)
  }

  childrenOf(id: string | null): Actor[] {
    return [...this.actors.values()].filter((a) => a.parentId === id)
  }

  actorFromObject(obj: THREE.Object3D | null): Actor | null {
    let cur: THREE.Object3D | null = obj
    while (cur) {
      const id = cur.userData.actorId as string | undefined
      if (id && this.actors.has(id)) return this.actors.get(id)!
      cur = cur.parent
    }
    return null
  }

  firstCamera(): Actor | undefined {
    return [...this.actors.values()].find((a) => a.type === 'Camera')
  }

  playerStart(): Actor | undefined {
    return [...this.actors.values()].find((a) => a.type === 'PlayerStart')
  }

  beginPlay() {
    this.playing = true
    if (!this.pieSnapshot) this.pieSnapshot = this.serialize()
    this.playClock = 0
    resetSignals()
    resetGameplay()
    resetAbilities()
    resetBTs()
    resetNav()
    this.lastCameraCut = null
    this.lastSeqTime = 0
    setDataStore(this.dataTables)
    this.triggerState.clear()
    this.activeReverb = ''
    setReverbZone('')
    const loadLevel = (name: string) => this.loadLevelDuringPlay(name)
    const loadCell = (cx: number, cz: number) => this.loadCellDuringPlay(cx, cz)
    this.playApi = makeScriptApi(this.actors, () => this.playClock, () => this.pawnPosition, loadLevel, undefined, loadCell)
    initAllActorGAS(this.actors.values())
    for (const a of this.actors.values()) {
      const api = makeScriptApi(this.actors, () => this.playClock, () => this.pawnPosition, loadLevel, a, loadCell)
      a.beginPlay(api)
      if (a.particleSystem && a.particleProps && a.particleProps.burst > 0) {
        a.particleSystem.burst(a.particleProps.burst)
      }
      if (a.type === 'SoundEmitter' && a.soundEmitterProps?.autoPlay && a.soundEmitterProps.metaSoundName) {
        const p = a.root.getWorldPosition(new THREE.Vector3())
        const sp = a.soundEmitterProps
        playMetaSound(sp.metaSoundName, {
          volume: sp.volume,
          loop: sp.loop,
          at: sp.spatial ? ([p.x, p.y, p.z] as [number, number, number]) : undefined,
          falloff: sp.falloff,
          minDistance: sp.minDistance,
          maxDistance: sp.maxDistance,
          customCurve: sp.customCurve,
        })
      }
    }
    this.physics.start(this.actors.values())
    // authored HUD widgets (UMG designer)
    syncAuthoredHud(this.hudWidgets, (signal) => this.playApi?.emit(signal))
  }

  playClock = 0
  /** updated by the viewport each frame while playing; null otherwise */
  pawnPosition: THREE.Vector3 | null = null
  playApi: ReturnType<typeof makeScriptApi> | null = null
  private lastCameraCut: string | null = null
  private lastSeqTime = 0
  private triggerState = new Map<string, boolean>()
  private activeReverb: ReverbPreset = ''

  endPlay() {
    this.playing = false
    stopAllSounds()
    this.physics.stop()
    for (const a of this.actors.values()) a.endPlay()
    clearActorTicks()
  }

  /** Restore the editor level after PIE (including mid-play loadLevel switches). */
  async restoreEditorAfterPIE() {
    const snap = this.pieSnapshot
    this.pieSnapshot = null
    if (snap) await this.load(snap)
  }

  /** Resolve a linked level name to serialized data (main = editor snapshot at PIE start). */
  resolveLinkedLevel(name: string): SerializedLevel | null {
    const key = name.trim().toLowerCase()
    if (key === 'main') return this.pieSnapshot
    const link = this.levelLinks.find(
      (l) => l.name === name || l.name.toLowerCase() === key || sanitizeLevelKey(l.name) === sanitizeLevelKey(name),
    )
    return link?.level ?? null
  }

  /** Switch to a linked level during PIE — preserves Autoload-tagged actors. */
  async loadLevelDuringPlay(name: string): Promise<boolean> {
    if (!this.playing) {
      scriptLog('error', `loadLevel('${name}'): not playing`)
      return false
    }
    const level = this.resolveLinkedLevel(name)
    if (!level) {
      scriptLog('error', `loadLevel('${name}'): level not linked (configure in World Settings)`)
      return false
    }

    const autoloadIds = new Set(
      [...this.actors.values()].filter((a) => a.tags.some((t) => t.toLowerCase() === 'autoload')).map((a) => a.id),
    )
    const autoloadRoots = [...autoloadIds].map((id) => this.actors.get(id)!.root)

    stopAllSounds()
    this.physics.stop()
    for (const a of this.actors.values()) a.endPlay()
    clearActorTicks()
    resetSignals()
    resetGameplay()
    resetAbilities()
    resetBTs()
    resetNav()
    this.triggerState.clear()
    hud.clear()

    for (const id of [...this.actors.keys()]) {
      if (!autoloadIds.has(id)) this.removeActor(id)
    }

    await this.ingestLevelContent(level, autoloadRoots)
    this.beginPlay()
    this.onLevelSwitched?.()
    scriptLog('log', `loadLevel('${name}')`)
    return true
  }

  /** Lazy-load actors for a grid cell during PIE (mirrors exported api.loadCell). */
  async loadCellDuringPlay(cx: number, cz: number): Promise<boolean> {
    if (!this.playing) {
      scriptLog('error', `loadCell(${cx},${cz}): not playing`)
      return false
    }
    if (!this.cellManifest || !Object.keys(this.cellManifest).length) {
      const snap = this.serialize()
      this.cellManifest = splitLevelByCells(snap).cells
    }
    const key = cellKey(cx, cz)
    const cellActors = this.cellManifest[key]
    if (!cellActors?.length) {
      scriptLog('error', `loadCell(${cx},${cz}): empty cell`)
      return false
    }
    const existing = new Set(this.actors.keys())
    const toAdd = cellActors.filter((sa) => !existing.has(sa.id))
    if (!toAdd.length) {
      scriptLog('log', `loadCell(${cx},${cz}): already loaded`)
      return true
    }
    for (const sa of toAdd) {
      const actor = this.instantiate(sa)
      const parentId = sa.parentId && this.actors.has(sa.parentId) ? sa.parentId : null
      this.addActor(actor, parentId)
    }
    const loadLevel = (name: string) => this.loadLevelDuringPlay(name)
    const loadCell = (cxi: number, czi: number) => this.loadCellDuringPlay(cxi, czi)
    for (const sa of toAdd) {
      const actor = this.actors.get(sa.id)!
      const api = makeScriptApi(this.actors, () => this.playClock, () => this.pawnPosition, loadLevel, actor, loadCell)
      actor.beginPlay(api)
    }
    scriptLog('log', `loadCell(${cx},${cz}): +${toAdd.length} actors`)
    return true
  }

  /** Merge assets + actors from a level blob without clearing the whole world. */
  private async ingestLevelContent(level: SerializedLevel, preserveRoots: THREE.Object3D[] = []) {
    this.environment = { ...DEFAULT_ENVIRONMENT, ...level.environment }
    this.streaming = { ...DEFAULT_STREAMING, ...level.streaming }
    this.sequence = level.sequence ? JSON.parse(JSON.stringify(level.sequence)) : emptySequence()
    this.dataTables = level.data ? JSON.parse(JSON.stringify(level.data)) : {}
    this.sounds = level.sounds ? { ...level.sounds } : {}
    this.soundAttenuation = level.soundAttenuation ? JSON.parse(JSON.stringify(level.soundAttenuation)) : {}
    setSoundAttenuationDefaults(this.soundAttenuation)
    this.hudWidgets = level.hud ? JSON.parse(JSON.stringify(level.hud)) : []
    this.hdri = level.hdri ?? null
    for (const [n, b64] of Object.entries(this.sounds)) void registerSound(n, b64)
    this.applyEnvironment()

    for (const [id, asset] of Object.entries(level.assets ?? {})) {
      if (this.assets.has(id)) continue
      const bytes = Uint8Array.from(atob(asset.data), (c) => c.charCodeAt(0))
      const gltf = await new GLTFLoader().parseAsync(bytes.buffer, '')
      this.assets.set(id, { ...asset, template: gltf.scene, animations: gltf.animations })
    }

    const preserveSet = new Set(preserveRoots)
    for (const sa of level.actors) {
      const actor = this.instantiate(sa)
      this.actors.set(actor.id, actor)
      this.scene.add(actor.root)
      if (actor.cameraHelper) this.scene.add(actor.cameraHelper)
    }
    for (const sa of level.actors) {
      if (sa.parentId && this.actors.has(sa.parentId)) {
        const child = this.actors.get(sa.id)!
        child.parentId = sa.parentId
        this.actors.get(sa.parentId)!.root.add(child.root)
      }
    }
    for (const root of preserveSet) {
      if (root.parent !== this.scene) this.scene.add(root)
    }
  }

  /** advance all particle systems — editor preview AND play */
  updateParticles(dt: number) {
    this.editorClock += dt
    const t = this.playing ? this.playClock : this.editorClock
    for (const a of this.actors.values()) {
      if (a.particleSystem) {
        a.root.updateMatrixWorld()
        const terrainAt = (x: number, z: number) => sampleLandscapeHeight(this.actors.values(), x, z)
        a.particleSystem.update(dt, a.visible, a.root.matrixWorld, terrainAt)
      }
      const matGraph = getEffectiveMaterialGraph(a)
      if (matGraph) applyMaterialGraph(a, t, matGraph, getEffectiveMaterialGraphMode(a))
      if (a.waterProps) updateWater(a, t)
    }
  }

  editorClock = 0

  tick(dt: number) {
    if (!this.playing) return
    this.playClock += dt
    setAbilityPlayClock(this.playClock)
    tickEffects(this.actors.values(), dt)
    this.physics.step(dt)
    // Sequencer auto-play loops during PIE (tracks + camera cuts + events)
    if (this.sequence.autoPlay && (this.sequence.tracks.length > 0 || this.sequence.cameraCuts?.length || this.sequence.events?.length)) {
      const st = this.playClock % this.sequence.duration
      sampleSequence(this, this.sequence, st, hasAudioTracks(this.sequence))
      const cut = cameraCutAt(this.sequence, st)
      if (cut !== this.lastCameraCut) {
        this.lastCameraCut = cut
        setViewCamera(cut)
      }
      if (this.playApi) {
        for (const ev of eventsBetween(this.sequence, this.lastSeqTime, st)) {
          this.playApi.emit(ev.signal)
        }
      }
      this.lastSeqTime = st
    }
    for (const a of this.actors.values()) {
      const t0 = performance.now()
      a.tick(dt)
      const params = a.animParams ?? {}
      if (a.blendSpace2D?.samples.length) {
        tickBlendSpace2D(a, params[a.blendSpace2D.paramX] ?? 0, params[a.blendSpace2D.paramY] ?? 0)
      } else if (a.blendSpace1D?.samples.length) {
        tickBlendSpace1D(a, params[a.blendSpace1D.param] ?? 0)
      } else if (a.animStateMachine) {
        tickAnimSM(a, dt, params)
      }
      a.mixer?.update(dt)
      if (hasActorSkeleton(a) && ((a.ikTargets?.length ?? 0) > 0 || a.lookAtTarget)) {
        applyActorIK(a, this.actors)
      }
      recordActorTick(a.id, a.name, performance.now() - t0)
    }
    tickGameplay(dt, scriptLog)
    if (this.playApi) {
      tickBTs(
        dt,
        () => this.pawnPosition,
        this.playApi.emit,
        (m) => scriptLog('log', m),
        (actor, abilityId) =>
          activateAbility(
            actor,
            abilityId,
            makeScriptApi(
              this.actors,
              () => this.playClock,
              () => this.pawnPosition,
              (n) => this.loadLevelDuringPlay(n),
              actor,
              (cx, cz) => this.loadCellDuringPlay(cx, cz),
            ),
          ),
      )
    }
    // trigger volumes: pawn enter/exit → signals + reverb zones
    if (this.pawnPosition && this.playApi) {
      const p = this.pawnPosition
      const local = new THREE.Vector3()
      let reverb: ReverbPreset = ''
      for (const a of this.actors.values()) {
        if (a.type !== 'TriggerVolume') continue
        local.copy(p)
        a.root.worldToLocal(local)
        const inside = Math.abs(local.x) <= 0.5 && Math.abs(local.y) <= 0.5 && Math.abs(local.z) <= 0.5
        const was = this.triggerState.get(a.id) ?? false
        if (inside !== was) {
          this.triggerState.set(a.id, inside)
          this.playApi.emit(`${inside ? 'enter' : 'exit'}:${a.name}`, a.name)
        }
        if (inside && a.triggerProps?.reverbPreset) reverb = a.triggerProps.reverbPreset
      }
      if (reverb !== this.activeReverb) {
        this.activeReverb = reverb
        setReverbZone(reverb)
      }
    }
  }

  // ---- assets ----

  async registerAsset(name: string, data: string): Promise<string> {
    const assetId = `asset_${Date.now().toString(36)}_${this.assets.size}`
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
    const gltf = await new GLTFLoader().parseAsync(bytes.buffer, '')
    const template = gltf.scene
    this.assets.set(assetId, { name, data, template, animations: gltf.animations })
    return assetId
  }

  instantiateAsset(assetId: string, name: string, id?: string): Actor | null {
    const asset = this.assets.get(assetId)
    if (!asset) return null
    const actor = createImportedMeshActor(name, assetId, asset.template.clone(true), id)
    if (asset.animations?.length) actor.animations = asset.animations
    return actor
  }

  // ---- serialization ----

  serialize(): SerializedLevel {
    const assets: Record<string, { name: string; data: string }> = {}
    // only persist assets still referenced by an actor
    const used = new Set([...this.actors.values()].map((a) => a.assetId).filter(Boolean))
    for (const [id, a] of this.assets) {
      if (used.has(id)) assets[id] = { name: a.name, data: a.data }
    }
    const streaming = { ...this.streaming }
    const actors = [...this.actors.values()].map((a) =>
      assignStreamCellOnSave(a.serialize(), streaming.gridSize, streaming.enabled),
    )
    const split = splitLevelByCells({
      engine: 'vektra',
      version: 4,
      name: this.levelName,
      environment: { ...this.environment },
      streaming,
      actors,
    })
    this.cellManifest = split.cells
    return {
      engine: 'vektra',
      version: 4,
      name: this.levelName,
      environment: { ...this.environment },
      streaming,
      assets,
      actors,
      sequence: JSON.parse(JSON.stringify(this.sequence)),
      data: JSON.parse(JSON.stringify(this.dataTables)),
      sounds: { ...this.sounds },
      soundAttenuation: Object.keys(this.soundAttenuation).length
        ? JSON.parse(JSON.stringify(this.soundAttenuation))
        : undefined,
      hud: JSON.parse(JSON.stringify(this.hudWidgets)),
      hdri: this.hdri ?? undefined,
      levelLinks: this.levelLinks.length
        ? this.levelLinks.map((l) => ({ name: l.name, level: JSON.parse(JSON.stringify(l.level)) }))
        : undefined,
      cameraBookmarks: this.cameraBookmarks.some((b) => b !== null)
        ? this.cameraBookmarks.map((b) => (b ? { position: [...b.position], quaternion: [...b.quaternion] } : null))
        : undefined,
    }
  }

  setCameraBookmark(slot: number, bookmark: CameraBookmark | null) {
    if (slot < 0 || slot > 9) return
    this.cameraBookmarks[slot] = bookmark
  }

  clear() {
    for (const id of [...this.actors.keys()]) this.removeActor(id)
    this.assets.clear()
    this.cameraBookmarks = Array.from({ length: 10 }, () => null)
  }

  async load(level: SerializedLevel) {
    this.clear()
    this.levelName = level.name
    this.environment = { ...DEFAULT_ENVIRONMENT, ...level.environment }
    this.streaming = { ...DEFAULT_STREAMING, ...level.streaming }
    this.sequence = level.sequence ? JSON.parse(JSON.stringify(level.sequence)) : emptySequence()
    this.dataTables = level.data ? JSON.parse(JSON.stringify(level.data)) : {}
    this.sounds = level.sounds ? { ...level.sounds } : {}
    this.soundAttenuation = level.soundAttenuation ? JSON.parse(JSON.stringify(level.soundAttenuation)) : {}
    setSoundAttenuationDefaults(this.soundAttenuation)
    this.hudWidgets = level.hud ? JSON.parse(JSON.stringify(level.hud)) : []
    this.hdri = level.hdri ?? null
    this.levelLinks = level.levelLinks ? JSON.parse(JSON.stringify(level.levelLinks)) : []
    if (level.cameraBookmarks?.length) {
      this.cameraBookmarks = level.cameraBookmarks.map((b) =>
        b ? { position: [...b.position], quaternion: [...b.quaternion] } : null,
      )
      while (this.cameraBookmarks.length < 10) this.cameraBookmarks.push(null)
      this.cameraBookmarks.length = 10
    } else {
      this.cameraBookmarks = Array.from({ length: 10 }, () => null)
    }
    for (const [n, b64] of Object.entries(this.sounds)) void registerSound(n, b64)
    this.applyEnvironment()
    for (const [id, asset] of Object.entries(level.assets ?? {})) {
      const bytes = Uint8Array.from(atob(asset.data), (c) => c.charCodeAt(0))
      const gltf = await new GLTFLoader().parseAsync(bytes.buffer, '')
      this.assets.set(id, { ...asset, template: gltf.scene, animations: gltf.animations })
    }
    for (const sa of level.actors) {
      const actor = this.instantiate(sa)
      this.actors.set(actor.id, actor)
      this.scene.add(actor.root)
      if (actor.cameraHelper) this.scene.add(actor.cameraHelper)
    }
    for (const sa of level.actors) {
      if (sa.parentId && this.actors.has(sa.parentId)) {
        const child = this.actors.get(sa.id)!
        child.parentId = sa.parentId
        this.actors.get(sa.parentId)!.root.add(child.root)
      }
    }
  }

  instantiate(sa: SerializedActor): Actor {
    let actor: Actor
    switch (sa.type) {
      case 'StaticMesh':
        actor = createStaticMeshActor(sa.geometry ?? 'box', sa.name, sa.id)
        if (sa.materialAssetId) actor.materialAssetId = sa.materialAssetId
        if (sa.materialOverrides) actor.materialOverrides = { ...sa.materialOverrides }
        if (sa.materialGraph) actor.materialGraph = JSON.parse(JSON.stringify(sa.materialGraph))
        if (sa.materialGraphMode) actor.materialGraphMode = sa.materialGraphMode
        if (sa.materialAssetId) applyActorMaterial(actor)
        else if (sa.material) {
          actor.materialProps = { ...sa.material }
          applyMaterialProps(actor.mesh!.material as THREE.MeshStandardMaterial, sa.material)
        }
        if (sa.castShadow !== undefined) actor.mesh!.castShadow = sa.castShadow
        if (sa.receiveShadow !== undefined) actor.mesh!.receiveShadow = sa.receiveShadow
        break
      case 'ImportedMesh': {
        const fromAsset = sa.assetId ? this.instantiateAsset(sa.assetId, sa.name, sa.id) : null
        actor = fromAsset ?? createEmptyActor(sa.name, sa.id)
        break
      }
      case 'PointLight':
      case 'SpotLight':
      case 'DirectionalLight':
      case 'AmbientLight':
      case 'RectLight':
        actor = createLightActor(sa.type, sa.name, sa.id)
        if (sa.light) {
          actor.lightProps = { ...sa.light }
          applyLightProps(actor, sa.light)
        }
        break
      case 'Camera':
        actor = createCameraActor(sa.name, sa.id)
        if (sa.camera) {
          actor.cameraProps = { ...sa.camera }
          actor.camera!.fov = sa.camera.fov
          actor.camera!.near = sa.camera.near
          actor.camera!.far = sa.camera.far
          actor.camera!.updateProjectionMatrix()
        }
        break
      case 'ParticleEmitter':
        actor = createParticleEmitterActor(sa.name, sa.id)
        if (sa.particles) {
          actor.particleProps = { ...DEFAULT_PARTICLES, ...sa.particles }
          actor.particleSystem!.props = actor.particleProps
          actor.particleSystem!.refresh()
        }
        break
      case 'FoliageLayer':
        actor = createFoliageLayerActor(sa.name, sa.id)
        if (sa.foliage) {
          actor.foliageProps = { ...sa.foliage, instances: sa.foliage.instances.map((i) => [...i]) }
          buildFoliageMesh(actor)
        }
        break
      case 'Landscape':
        actor = createLandscapeActor(sa.name, sa.id)
        if (sa.landscape) {
          actor.landscapeProps = { ...sa.landscape, heights: [...sa.landscape.heights] }
          buildLandscapeMesh(actor)
        }
        break
      case 'ReflectionProbe':
        actor = createReflectionProbeActor(sa.name, sa.id)
        if (sa.probe) actor.probeProps = { ...sa.probe }
        break
      case 'CustomMesh':
        actor = createCustomMeshActor(sa.name, sa.customGeometry ?? { positions: [], normals: [] }, sa.id)
        if (sa.materialAssetId) actor.materialAssetId = sa.materialAssetId
        if (sa.materialOverrides) actor.materialOverrides = { ...sa.materialOverrides }
        if (sa.materialGraph) actor.materialGraph = JSON.parse(JSON.stringify(sa.materialGraph))
        if (sa.materialGraphMode) actor.materialGraphMode = sa.materialGraphMode
        if (sa.materialAssetId) applyActorMaterial(actor)
        else if (sa.material && actor.mesh) {
          actor.materialProps = { ...sa.material }
          applyMaterialProps(actor.mesh.material as THREE.MeshStandardMaterial, sa.material)
        }
        break
      case 'Water':
        actor = createWaterActor(sa.name, sa.id)
        if (sa.water) {
          actor.waterProps = { ...sa.water }
          buildWaterMesh(actor)
        }
        break
      case 'PCGVolume': {
        actor = createPCGVolumeActor(sa.name, sa.id)
        if (sa.pcgGraph) {
          const graph = JSON.parse(JSON.stringify(sa.pcgGraph))
          actor.pcgGraph = graph
          actor.pcgProps = syncPropsFromGraph(graph)
        } else if (sa.pcg) {
          actor.pcgGraph = undefined
          actor.pcgProps = { ...sa.pcg }
        }
        break
      }
      case 'TriggerVolume':
        actor = createTriggerVolumeActor(sa.name, sa.id)
        if (sa.trigger) actor.triggerProps = { ...sa.trigger }
        break
      case 'SoundEmitter':
        actor = createSoundEmitterActor(sa.name, sa.id)
        if (sa.soundEmitter) actor.soundEmitterProps = { ...sa.soundEmitter }
        break
      case 'PlayerStart':
        actor = createPlayerStartActor(sa.name, sa.id)
        actor.pawnMode = sa.pawnMode ?? 'fly'
        break
      case 'Folder':
        actor = createFolderActor(sa.name, sa.id)
        break
      case 'PostProcessVolume':
        actor = createPostProcessVolumeActor(sa.name, sa.id)
        break
      case 'Label3D':
        actor = createLabel3DActor(sa.name, sa.id)
        if (sa.label3D) {
          actor.label3DProps = { ...sa.label3D }
          rebuildLabel3D(actor)
        }
        break
      case 'Widget3D':
        actor = createWidget3DActor(sa.name, sa.id)
        if (sa.widget3D) {
          actor.widget3DProps = { ...sa.widget3D }
          syncWidget3D(actor, this.hudWidgets)
        }
        break
      default:
        actor = createEmptyActor(sa.name, sa.id)
    }
    actor.setTransform(sa.transform)
    actor.setVisible(sa.visible)
    actor.behaviors = sa.behaviors.map((b) => ({ ...b }))
    if (sa.physics) actor.physicsProps = { ...sa.physics }
    if (sa.script) actor.script = sa.script
    if (sa.scriptVars) actor.scriptVars = { ...sa.scriptVars }
    if (sa.cullDistance) actor.cullDistance = sa.cullDistance
    if (sa.streamCell) actor.streamCell = [sa.streamCell[0], sa.streamCell[1]]
    if (sa.autoPlayClip) actor.autoPlayClip = sa.autoPlayClip
    if (sa.animStateMachine) actor.animStateMachine = JSON.parse(JSON.stringify(sa.animStateMachine))
    if (sa.blendSpace1D) actor.blendSpace1D = JSON.parse(JSON.stringify(sa.blendSpace1D))
    if (sa.blendSpace2D) actor.blendSpace2D = JSON.parse(JSON.stringify(sa.blendSpace2D))
    if (sa.animParams) actor.animParams = { ...sa.animParams }
    if (sa.materialGraph && sa.type !== 'StaticMesh' && sa.type !== 'CustomMesh') {
      actor.materialGraph = JSON.parse(JSON.stringify(sa.materialGraph))
    }
    if (sa.materialGraphMode && sa.type !== 'StaticMesh' && sa.type !== 'CustomMesh') {
      actor.materialGraphMode = sa.materialGraphMode
    }
    if (sa.materialAssetId && sa.type !== 'StaticMesh' && sa.type !== 'CustomMesh') {
      actor.materialAssetId = sa.materialAssetId
      if (sa.materialOverrides) actor.materialOverrides = { ...sa.materialOverrides }
      applyActorMaterial(actor)
    }
    if (sa.blueprint) actor.blueprint = JSON.parse(JSON.stringify(sa.blueprint))
    if (sa.mobility) actor.mobility = sa.mobility
    if (sa.tags?.length) actor.tags = [...sa.tags]
    if (sa.attributeSetId) actor.attributeSetId = sa.attributeSetId
    if (sa.abilityIds?.length) actor.abilityIds = [...sa.abilityIds]
    if (sa.postProcess && actor.postProcessProps) Object.assign(actor.postProcessProps, sa.postProcess)
    if (sa.prefabSource) actor.prefabSource = sa.prefabSource
    if (sa.prefabActorId) actor.prefabActorId = sa.prefabActorId
    if (sa.prefabOverrides) {
      actor.prefabOverrides = Object.fromEntries(
        Object.entries(sa.prefabOverrides).map(([k, v]) => [k, { ...v }]),
      )
    }
    if (sa.syncProperties?.length) actor.syncProperties = [...sa.syncProperties]
    if (sa.syncSpawn) actor.syncSpawn = true
    if (sa.netOwnerId) actor.netOwnerId = sa.netOwnerId
    if (sa.clientPredicted) actor.clientPredicted = true
    if (sa.ikTargets?.length) {
      actor.ikTargets = sa.ikTargets.map((t) => ({
        chain: t.chain,
        targetActorId: t.targetActorId,
        targetPosition: t.targetPosition ? [...t.targetPosition] as [number, number, number] : undefined,
      }))
    }
    if (sa.lookAtTarget) {
      actor.lookAtTarget = {
        targetActorId: sa.lookAtTarget.targetActorId,
        targetPosition: sa.lookAtTarget.targetPosition
          ? ([...sa.lookAtTarget.targetPosition] as [number, number, number])
          : undefined,
      }
    }
    applySerializedBakedAO(actor, sa)
    return actor
  }
}

export function applyLightProps(actor: Actor, props: NonNullable<Actor['lightProps']>) {
  const light = actor.light
  if (!light) return
  light.color.set(props.color)
  light.intensity = props.intensity
  if (light instanceof THREE.PointLight || light instanceof THREE.SpotLight) {
    light.distance = props.distance ?? 0
    light.decay = props.decay ?? 2
    light.castShadow = !!props.castShadow
  }
  if (light instanceof THREE.SpotLight) {
    light.angle = props.angle ?? 0.5
    light.penumbra = props.penumbra ?? 0
  }
  if (light instanceof THREE.DirectionalLight) {
    light.castShadow = !!props.castShadow
  }
  if (light instanceof THREE.RectAreaLight) {
    light.width = props.width ?? 3
    light.height = props.height ?? 2
  }
  if (actor.lightHelper && 'update' in actor.lightHelper) {
    ;(actor.lightHelper as THREE.PointLightHelper).update()
  }
}

/** Sanitize a level name for manifest keys (dungeon_level → dungeon_level). */
export function sanitizeLevelKey(name: string): string {
  const k = name.trim().replace(/[^\w-]+/g, '_').replace(/^_|_$/g, '').toLowerCase()
  return k || 'level'
}

// Singleton editor world — one runtime, one world.
export const world = new World()
