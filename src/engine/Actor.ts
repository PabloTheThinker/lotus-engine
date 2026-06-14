import * as THREE from 'three'
import type {
  ActorType,
  FoliageProps,
  LandscapeProps,
  Label3DProps,
  Widget3DProps,
  Behavior,
  CameraProps,
  GeometryKind,
  LightProps,
  MaterialProps,
  Mobility,
  PawnMode,
  PhysicsProps,
  PostProcessProps,
  SerializedActor,
  TransformSnapshot,
  IKTarget,
  LookAtTarget,
} from './types'
import { DEFAULT_MOBILITY } from './types'
import { disposeWidget3D } from './widget3d'
import { resetAnimRuntime } from './animStateMachine'
import { extractBakedAOMapMeshes, extractBakedAOMeshes } from './lightmapBake'
import { compileScript, scriptLog, type CompiledScript, type ScriptApi } from './scripting'

let actorCounter = 0
export function nextActorId(): string {
  actorCounter += 1
  return `actor_${Date.now().toString(36)}_${actorCounter}`
}

/**
 * Actor — the Unreal AActor analog. Owns a root Object3D (the RootComponent)
 * plus optional typed components (mesh / light / camera) attached to it.
 */
export class Actor {
  id: string
  name: string
  type: ActorType
  root: THREE.Object3D
  parentId: string | null = null
  visible = true
  behaviors: Behavior[] = []

  // typed components
  mesh?: THREE.Mesh
  light?: THREE.Light
  lightHelper?: THREE.Object3D
  camera?: THREE.PerspectiveCamera
  cameraHelper?: THREE.CameraHelper

  geometryKind?: GeometryKind
  materialProps?: MaterialProps
  /** reference to a shared material asset in localStorage */
  materialAssetId?: string
  /** per-instance material property overrides */
  materialOverrides?: Partial<MaterialProps>
  lightProps?: LightProps
  cameraProps?: CameraProps
  physicsProps?: PhysicsProps
  assetId?: string
  script?: string
  /** saved @export variable overrides */
  scriptVars?: Record<string, unknown>
  blueprint?: import('./blueprint').BlueprintGraph
  /** Visual behavior tree graph (Wave 12) */
  btGraph?: import('./btGraph').BTGraph
  btAutoRun?: boolean
  pawnMode?: PawnMode
  mobility: Mobility
  tags: string[]
  /** GAS-lite attribute set + assigned abilities */
  attributeSetId?: string
  abilityIds: string[] = []
  /** world streaming: hide when farther than this from the camera (0 = off) */
  cullDistance = 0
  /** grid cell [cx, cz] — auto-assigned from position on save */
  streamCell?: [number, number]
  postProcessProps?: PostProcessProps
  volumeHelper?: THREE.Object3D
  particleProps?: import('./particles').ParticleProps
  particleSystem?: import('./particles').ParticleSystem
  foliageProps?: FoliageProps
  foliageMesh?: THREE.InstancedMesh
  landscapeProps?: LandscapeProps
  probeProps?: { radius: number }
  waterProps?: import('./types').WaterProps
  pcgProps?: import('./types').PCGProps
  /** PCGVolume — sample→filter→transform→spawn node graph */
  pcgGraph?: import('./pcgGraph').PCGGraph
  label3DProps?: Label3DProps
  widget3DProps?: Widget3DProps
  /** CSS3DObject child — editor / PIE only */
  css3dObject?: import('three/addons/renderers/CSS3DRenderer.js').CSS3DObject
  pcgMesh?: THREE.InstancedMesh
  customGeometry?: { positions: number[]; normals: number[]; index?: number[] }
  /** material node graph — evaluated per frame onto the material */
  materialGraph?: import('./materialGraph').MaterialGraph
  /** cpu = fast per-object; gpu = per-pixel onBeforeCompile shader */
  materialGraphMode?: import('./materialGraph').MaterialGraphMode
  /** animation clips (from glTF or scripts) + play-time mixer state */
  animations?: THREE.AnimationClip[]
  mixer?: THREE.AnimationMixer
  currentAction?: THREE.AnimationAction
  /** clip to start playing at BeginPlay */
  autoPlayClip?: string
  animStateMachine?: import('./animStateMachine').AnimStateMachine
  blendSpace1D?: import('./animStateMachine').BlendSpace1D
  blendSpace2D?: import('./animStateMachine').BlendSpace2D
  animParams?: Record<string, number>
  /** prefab instance root: source prefab asset name */
  prefabSource?: string
  /** original prefab actor id — set on every actor in an instance subtree */
  prefabActorId?: string
  /** prefab instance root only: overrides keyed by original prefab actor id */
  prefabOverrides?: Record<string, Partial<SerializedActor>>
  /** TriggerVolume — reverb zone preset */
  triggerProps?: import('./types').TriggerProps
  /** SoundEmitter — procedural/imported sound playback */
  soundEmitterProps?: import('./types').SoundEmitterProps
  /** Godot MultiplayerSynchronizer-lite — replicated property checklist */
  syncProperties?: string[]
  /** Godot MultiplayerSpawner-lite — host replicates instantiation */
  syncSpawn = false
  /** Network owner peer id — empty = host-owned */
  netOwnerId?: string
  /** Client-side transform prediction for locally-owned actors */
  clientPredicted?: boolean
  /** two-bone IK targets (glTF skinned meshes) */
  ikTargets?: IKTarget[]
  /** head LookAt target */
  lookAtTarget?: LookAtTarget
  /** Baked AO (approx) applied to mesh vertex colors */
  bakedAO = false
  /** AO Map Bake (UV2, approx) applied as material.aoMap */
  bakedAOMap = false
  bakedAOMapSize = 256
  aoMapIntensity = 1
  private compiled: CompiledScript | null = null

  // PIE state restore
  private editorTransform: TransformSnapshot | null = null
  private elapsed = 0
  private baseY = 0

  constructor(id: string, name: string, type: ActorType) {
    this.id = id
    this.name = name
    this.type = type
    this.mobility = DEFAULT_MOBILITY[type]
    this.tags = []
    this.root = new THREE.Group()
    this.root.name = name
    this.root.userData.actorId = id
  }

  /** Whether transform-modifying gameplay may run at runtime (UE mobility gate). */
  canMoveAtRuntime(): boolean {
    return this.mobility === 'movable'
  }

  get transform(): TransformSnapshot {
    return {
      position: this.root.position.toArray() as [number, number, number],
      rotation: [this.root.rotation.x, this.root.rotation.y, this.root.rotation.z],
      scale: this.root.scale.toArray() as [number, number, number],
    }
  }

  setTransform(t: TransformSnapshot) {
    this.root.position.fromArray(t.position)
    this.root.rotation.set(t.rotation[0], t.rotation[1], t.rotation[2])
    this.root.scale.fromArray(t.scale)
  }

  setVisible(v: boolean) {
    this.visible = v
    this.root.visible = v
  }

  /** crossfade to a named clip (UE play-montage / Godot AnimationPlayer.play) */
  playAnimation(clipName: string, opts: { loop?: boolean; fadeIn?: number; speed?: number } = {}): boolean {
    const clip = this.animations?.find((c) => c.name === clipName)
    if (!clip) return false
    if (!this.mixer) this.mixer = new THREE.AnimationMixer(this.root)
    const action = this.mixer.clipAction(clip)
    action.reset()
    action.loop = opts.loop === false ? THREE.LoopOnce : THREE.LoopRepeat
    action.clampWhenFinished = true
    action.timeScale = opts.speed ?? 1
    const fade = opts.fadeIn ?? 0.25
    if (this.currentAction && this.currentAction !== action) {
      action.crossFadeFrom(this.currentAction, fade, true)
    }
    action.play()
    this.currentAction = action
    return true
  }

  /** Capture editor-time state before Play-In-Editor starts. */
  beginPlay(api?: ScriptApi) {
    this.editorTransform = this.transform
    this.mixer?.stopAllAction()
    this.mixer = undefined
    this.currentAction = undefined
    resetAnimRuntime(this)
    if (
      !this.animStateMachine &&
      !this.blendSpace2D?.samples.length &&
      !this.blendSpace1D?.samples.length &&
      this.autoPlayClip
    ) {
      this.playAnimation(this.autoPlayClip)
    }
    this.elapsed = 0
    this.baseY = this.root.position.y
    this.compiled = null
    if (this.script?.trim() && api) {
      this.compiled = compileScript(this, this.script, api)
      try {
        this.compiled?.onBeginPlay?.()
      } catch (err) {
        scriptLog('error', `[${this.name}] onBeginPlay: ${(err as Error).message}`)
        this.compiled = null
      }
    }
  }

  /** Restore editor-time state when PIE stops. */
  endPlay() {
    this.mixer?.stopAllAction()
    this.mixer = undefined
    this.currentAction = undefined
    resetAnimRuntime(this)
    if (this.editorTransform) this.setTransform(this.editorTransform)
    this.editorTransform = null
    this.compiled = null
  }

  /** UE "Keep Simulation Changes" (K) — adopt the current play-time transform. */
  keepSimulationChanges() {
    if (this.editorTransform) this.editorTransform = this.transform
  }

  /** Per-frame gameplay tick — only runs while the editor is in Play mode. */
  /** Fixed-rate physics script hook (Godot _physics_process). */
  physicsTick(dt: number) {
    if (this.compiled?.onPhysicsTick) {
      try {
        this.compiled.onPhysicsTick(dt)
      } catch (err) {
        scriptLog('error', `[${this.name}] onPhysicsTick: ${(err as Error).message}`)
        this.compiled = null
      }
    }
  }

  tick(dt: number) {
    this.elapsed += dt
    if (this.compiled?.onTick) {
      try {
        this.compiled.onTick(dt)
      } catch (err) {
        scriptLog('error', `[${this.name}] onTick: ${(err as Error).message}`)
        this.compiled = null
      }
    }
    if (!this.canMoveAtRuntime()) return
    for (const b of this.behaviors) {
      switch (b.type) {
        case 'rotator':
          this.root.rotation.x += b.speedX * dt
          this.root.rotation.y += b.speedY * dt
          this.root.rotation.z += b.speedZ * dt
          break
        case 'bobber':
          this.root.position.y = this.baseY + Math.sin(this.elapsed * b.frequency * Math.PI * 2) * b.amplitude
          break
        case 'orbiter': {
          const a = this.elapsed * b.speed
          this.root.position.x = Math.cos(a) * b.radius
          this.root.position.z = Math.sin(a) * b.radius
          break
        }
      }
    }
  }

  serialize(): SerializedActor {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      parentId: this.parentId,
      visible: this.visible,
      transform: this.transform,
      geometry: this.geometryKind,
      material: this.materialAssetId ? undefined : this.materialProps ? { ...this.materialProps } : undefined,
      materialAssetId: this.materialAssetId,
      materialOverrides:
        this.materialOverrides && Object.keys(this.materialOverrides).length
          ? { ...this.materialOverrides }
          : undefined,
      light: this.lightProps ? { ...this.lightProps } : undefined,
      camera: this.cameraProps ? { ...this.cameraProps } : undefined,
      physics: this.physicsProps ? { ...this.physicsProps } : undefined,
      assetId: this.assetId,
      script: this.script,
      scriptVars: this.scriptVars ? { ...this.scriptVars } : undefined,
      blueprint: this.blueprint ? JSON.parse(JSON.stringify(this.blueprint)) : undefined,
      btGraph: this.btGraph ? JSON.parse(JSON.stringify(this.btGraph)) : undefined,
      btAutoRun: this.btAutoRun || undefined,
      pawnMode: this.pawnMode,
      mobility: this.mobility,
      tags: [...this.tags],
      attributeSetId: this.attributeSetId,
      abilityIds: this.abilityIds.length ? [...this.abilityIds] : undefined,
      cullDistance: this.cullDistance || undefined,
      streamCell: this.streamCell ? [this.streamCell[0], this.streamCell[1]] : undefined,
      postProcess: this.postProcessProps ? { ...this.postProcessProps } : undefined,
      particles: this.particleProps ? { ...this.particleProps } : undefined,
      foliage: this.foliageProps ? { ...this.foliageProps, instances: this.foliageProps.instances.map((i) => [...i]) } : undefined,
      autoPlayClip: this.autoPlayClip,
      animStateMachine: this.animStateMachine
        ? JSON.parse(JSON.stringify(this.animStateMachine))
        : undefined,
      blendSpace1D: this.blendSpace1D ? JSON.parse(JSON.stringify(this.blendSpace1D)) : undefined,
      blendSpace2D: this.blendSpace2D ? JSON.parse(JSON.stringify(this.blendSpace2D)) : undefined,
      animParams:
        this.animParams && Object.keys(this.animParams).length
          ? { ...this.animParams }
          : undefined,
      materialGraph: this.materialGraph ? JSON.parse(JSON.stringify(this.materialGraph)) : undefined,
      materialGraphMode: this.materialGraphMode,
      probe: this.probeProps ? { ...this.probeProps } : undefined,
      water: this.waterProps ? { ...this.waterProps } : undefined,
      pcg: this.pcgProps ? { ...this.pcgProps } : undefined,
      pcgGraph: this.pcgGraph ? JSON.parse(JSON.stringify(this.pcgGraph)) : undefined,
      customGeometry: this.customGeometry,
      landscape: this.landscapeProps ? { ...this.landscapeProps, heights: [...this.landscapeProps.heights], weights: this.landscapeProps.weights ? [...this.landscapeProps.weights] : undefined } : undefined,
      behaviors: this.behaviors.map((b) => ({ ...b })),
      castShadow: this.mesh?.castShadow,
      receiveShadow: this.mesh?.receiveShadow,
      prefabSource: this.prefabSource,
      prefabActorId: this.prefabActorId,
      prefabOverrides: this.prefabOverrides
        ? Object.fromEntries(
            Object.entries(this.prefabOverrides).map(([k, v]) => [k, { ...v }]),
          )
        : undefined,
      trigger: this.triggerProps ? { ...this.triggerProps } : undefined,
      soundEmitter: this.soundEmitterProps ? { ...this.soundEmitterProps } : undefined,
      label3D: this.label3DProps ? { ...this.label3DProps } : undefined,
      widget3D: this.widget3DProps ? { ...this.widget3DProps } : undefined,
      syncProperties: this.syncProperties?.length ? [...this.syncProperties] : undefined,
      syncSpawn: this.syncSpawn || undefined,
      netOwnerId: this.netOwnerId || undefined,
      clientPredicted: this.clientPredicted || undefined,
      ikTargets: this.ikTargets?.length
        ? this.ikTargets.map((t) => ({
            chain: t.chain,
            targetActorId: t.targetActorId,
            targetPosition: t.targetPosition ? [...t.targetPosition] as [number, number, number] : undefined,
          }))
        : undefined,
      lookAtTarget: this.lookAtTarget
        ? {
            targetActorId: this.lookAtTarget.targetActorId,
            targetPosition: this.lookAtTarget.targetPosition
              ? ([...this.lookAtTarget.targetPosition] as [number, number, number])
              : undefined,
          }
        : undefined,
      bakedAO: this.bakedAO || undefined,
      bakedAOMeshes: extractBakedAOMeshes(this),
      bakedAOMap: this.bakedAOMap || undefined,
      bakedAOMapSize: this.bakedAOMap ? this.bakedAOMapSize : undefined,
      bakedAOMapMeshes: extractBakedAOMapMeshes(this),
      aoMapIntensity: this.bakedAOMap ? this.aoMapIntensity : undefined,
    }
  }

  dispose() {
    disposeWidget3D(this)
    this.particleSystem?.dispose()
    if (this.mesh && !this.mesh.userData.isWidget3DPick) {
      this.mesh.geometry.dispose()
      if (this.mesh.material instanceof THREE.Material) this.mesh.material.dispose()
    }
    this.cameraHelper?.dispose()
  }
}
