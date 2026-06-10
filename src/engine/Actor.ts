import * as THREE from 'three'
import type {
  ActorType,
  FoliageProps,
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
} from './types'
import { DEFAULT_MOBILITY } from './types'
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
  lightProps?: LightProps
  cameraProps?: CameraProps
  physicsProps?: PhysicsProps
  assetId?: string
  script?: string
  blueprint?: import('./blueprint').BlueprintGraph
  pawnMode?: PawnMode
  mobility: Mobility
  tags: string[]
  postProcessProps?: PostProcessProps
  volumeHelper?: THREE.Object3D
  particleProps?: import('./particles').ParticleProps
  particleSystem?: import('./particles').ParticleSystem
  foliageProps?: FoliageProps
  foliageMesh?: THREE.InstancedMesh
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

  /** Capture editor-time state before Play-In-Editor starts. */
  beginPlay(api?: ScriptApi) {
    this.editorTransform = this.transform
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
    if (this.editorTransform) this.setTransform(this.editorTransform)
    this.editorTransform = null
    this.compiled = null
  }

  /** UE "Keep Simulation Changes" (K) — adopt the current play-time transform. */
  keepSimulationChanges() {
    if (this.editorTransform) this.editorTransform = this.transform
  }

  /** Per-frame gameplay tick — only runs while the editor is in Play mode. */
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
      material: this.materialProps ? { ...this.materialProps } : undefined,
      light: this.lightProps ? { ...this.lightProps } : undefined,
      camera: this.cameraProps ? { ...this.cameraProps } : undefined,
      physics: this.physicsProps ? { ...this.physicsProps } : undefined,
      assetId: this.assetId,
      script: this.script,
      blueprint: this.blueprint ? JSON.parse(JSON.stringify(this.blueprint)) : undefined,
      pawnMode: this.pawnMode,
      mobility: this.mobility,
      tags: [...this.tags],
      postProcess: this.postProcessProps ? { ...this.postProcessProps } : undefined,
      particles: this.particleProps ? { ...this.particleProps } : undefined,
      foliage: this.foliageProps ? { ...this.foliageProps, instances: this.foliageProps.instances.map((i) => [...i]) } : undefined,
      behaviors: this.behaviors.map((b) => ({ ...b })),
      castShadow: this.mesh?.castShadow,
      receiveShadow: this.mesh?.receiveShadow,
    }
  }

  dispose() {
    this.particleSystem?.dispose()
    this.mesh?.geometry.dispose()
    if (this.mesh && this.mesh.material instanceof THREE.Material) this.mesh.material.dispose()
    this.cameraHelper?.dispose()
  }
}
