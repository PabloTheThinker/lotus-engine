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
import { createLandscapeActor, buildLandscapeMesh } from './landscape'
import { resetGameplay, tickGameplay } from './gameplay'
import { createTriggerVolumeActor } from './factory'
import { PhysicsSim } from './physics'
import { makeScriptApi, resetSignals, scriptLog } from './scripting'
import { emptySequence, sampleSequence, type Sequence } from './sequencer'
import type { EnvironmentSettings, SerializedActor, SerializedLevel } from './types'
import { DEFAULT_ENVIRONMENT } from './types'

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
  playing = false
  physics = new PhysicsSim()

  // sky atmosphere (UE SkyAtmosphere analog)
  sky = new Sky()
  sunDirection = new THREE.Vector3(0, 1, 0)
  /** bumped on every applyEnvironment so the viewport knows to rebuild IBL */
  envVersion = 0

  // imported glTF assets: raw base64 for serialization + template scene for cloning
  assets = new Map<string, { name: string; data: string; template: THREE.Group }>()

  /** master Sequencer timeline (UE Sequencer analog) */
  sequence: Sequence = emptySequence()

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
    this.playClock = 0
    resetSignals()
    resetGameplay()
    this.triggerState.clear()
    this.playApi = makeScriptApi(this.actors, () => this.playClock, () => this.pawnPosition)
    const api = this.playApi ?? makeScriptApi(this.actors, () => this.playClock, () => this.pawnPosition)
    for (const a of this.actors.values()) {
      a.beginPlay(api)
      if (a.particleSystem && a.particleProps && a.particleProps.burst > 0) {
        a.particleSystem.burst(a.particleProps.burst)
      }
    }
    this.physics.start(this.actors.values())
  }

  playClock = 0
  /** updated by the viewport each frame while playing; null otherwise */
  pawnPosition: THREE.Vector3 | null = null
  playApi: ReturnType<typeof makeScriptApi> | null = null
  private triggerState = new Map<string, boolean>()

  endPlay() {
    this.playing = false
    this.physics.stop()
    for (const a of this.actors.values()) a.endPlay()
  }

  /** advance all particle systems — editor preview AND play */
  updateParticles(dt: number) {
    for (const a of this.actors.values()) {
      if (a.particleSystem) a.particleSystem.update(dt, a.visible)
    }
  }

  tick(dt: number) {
    if (!this.playing) return
    this.playClock += dt
    this.physics.step(dt)
    // Sequencer auto-play loops during PIE
    if (this.sequence.autoPlay && this.sequence.tracks.length > 0) {
      sampleSequence(this, this.sequence, this.playClock % this.sequence.duration)
    }
    for (const a of this.actors.values()) a.tick(dt)
    tickGameplay(dt, scriptLog)
    // trigger volumes: pawn enter/exit → signals "enter:Name" / "exit:Name"
    if (this.pawnPosition && this.playApi) {
      const p = this.pawnPosition
      const local = new THREE.Vector3()
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
      }
    }
  }

  // ---- assets ----

  async registerAsset(name: string, data: string): Promise<string> {
    const assetId = `asset_${Date.now().toString(36)}_${this.assets.size}`
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
    const gltf = await new GLTFLoader().parseAsync(bytes.buffer, '')
    const template = gltf.scene
    this.assets.set(assetId, { name, data, template })
    return assetId
  }

  instantiateAsset(assetId: string, name: string, id?: string): Actor | null {
    const asset = this.assets.get(assetId)
    if (!asset) return null
    return createImportedMeshActor(name, assetId, asset.template.clone(true), id)
  }

  // ---- serialization ----

  serialize(): SerializedLevel {
    const assets: Record<string, { name: string; data: string }> = {}
    // only persist assets still referenced by an actor
    const used = new Set([...this.actors.values()].map((a) => a.assetId).filter(Boolean))
    for (const [id, a] of this.assets) {
      if (used.has(id)) assets[id] = { name: a.name, data: a.data }
    }
    return {
      engine: 'vektra',
      version: 3,
      name: this.levelName,
      environment: { ...this.environment },
      assets,
      actors: [...this.actors.values()].map((a) => a.serialize()),
      sequence: JSON.parse(JSON.stringify(this.sequence)),
    }
  }

  clear() {
    for (const id of [...this.actors.keys()]) this.removeActor(id)
    this.assets.clear()
  }

  async load(level: SerializedLevel) {
    this.clear()
    this.levelName = level.name
    this.environment = { ...DEFAULT_ENVIRONMENT, ...level.environment }
    this.sequence = level.sequence ? JSON.parse(JSON.stringify(level.sequence)) : emptySequence()
    this.applyEnvironment()
    for (const [id, asset] of Object.entries(level.assets ?? {})) {
      const bytes = Uint8Array.from(atob(asset.data), (c) => c.charCodeAt(0))
      const gltf = await new GLTFLoader().parseAsync(bytes.buffer, '')
      this.assets.set(id, { ...asset, template: gltf.scene })
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
        if (sa.material) {
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
          actor.particleProps = { ...sa.particles }
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
      case 'TriggerVolume':
        actor = createTriggerVolumeActor(sa.name, sa.id)
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
      default:
        actor = createEmptyActor(sa.name, sa.id)
    }
    actor.setTransform(sa.transform)
    actor.setVisible(sa.visible)
    actor.behaviors = sa.behaviors.map((b) => ({ ...b }))
    if (sa.physics) actor.physicsProps = { ...sa.physics }
    if (sa.script) actor.script = sa.script
    if (sa.scriptVars) actor.scriptVars = { ...sa.scriptVars }
    if (sa.blueprint) actor.blueprint = JSON.parse(JSON.stringify(sa.blueprint))
    if (sa.mobility) actor.mobility = sa.mobility
    if (sa.tags?.length) actor.tags = [...sa.tags]
    if (sa.postProcess && actor.postProcessProps) Object.assign(actor.postProcessProps, sa.postProcess)
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
  if (actor.lightHelper && 'update' in actor.lightHelper) {
    ;(actor.lightHelper as THREE.PointLightHelper).update()
  }
}

// Singleton editor world — one runtime, one world.
export const world = new World()
