import * as THREE from 'three'
import { Actor } from './Actor'
import {
  applyMaterialProps,
  createCameraActor,
  createEmptyActor,
  createLightActor,
  createStaticMeshActor,
} from './factory'
import type { SerializedActor, SerializedLevel } from './types'

export interface Environment {
  background: string
  fogEnabled: boolean
  fogColor: string
  fogDensity: number
}

/**
 * World — the Unreal UWorld analog. Owns the Three.js scene graph,
 * the actor registry, and the Play-In-Editor lifecycle.
 */
export class World {
  scene = new THREE.Scene()
  actors = new Map<string, Actor>()
  levelName = 'Untitled'
  environment: Environment = {
    background: '#15181d',
    fogEnabled: false,
    fogColor: '#15181d',
    fogDensity: 0.02,
  }
  playing = false

  constructor() {
    this.applyEnvironment()
  }

  applyEnvironment() {
    this.scene.background = new THREE.Color(this.environment.background)
    this.scene.fog = this.environment.fogEnabled
      ? new THREE.FogExp2(this.environment.fogColor, this.environment.fogDensity)
      : null
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
    // re-parent children to scene root rather than destroying them
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
    // refuse cycles: walk up from the new parent
    let p = newParentId
    while (p) {
      if (p === id) return
      p = this.actors.get(p)?.parentId ?? null
    }
    const worldPos = new THREE.Vector3()
    const worldQuat = new THREE.Quaternion()
    const worldScale = new THREE.Vector3()
    actor.root.getWorldPosition(worldPos)
    actor.root.getWorldQuaternion(worldQuat)
    actor.root.getWorldScale(worldScale)

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

  beginPlay() {
    this.playing = true
    for (const a of this.actors.values()) a.beginPlay()
  }

  endPlay() {
    this.playing = false
    for (const a of this.actors.values()) a.endPlay()
  }

  tick(dt: number) {
    if (!this.playing) return
    for (const a of this.actors.values()) a.tick(dt)
  }

  serialize(): SerializedLevel {
    return {
      engine: 'vektra',
      version: 1,
      name: this.levelName,
      environment: { ...this.environment },
      actors: [...this.actors.values()].map((a) => a.serialize()),
    }
  }

  clear() {
    for (const id of [...this.actors.keys()]) this.removeActor(id)
  }

  load(level: SerializedLevel) {
    this.clear()
    this.levelName = level.name
    this.environment = { ...level.environment }
    this.applyEnvironment()
    // two passes: create all actors, then wire hierarchy
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
      default:
        actor = createEmptyActor(sa.name, sa.id)
    }
    actor.setTransform(sa.transform)
    actor.setVisible(sa.visible)
    actor.behaviors = sa.behaviors.map((b) => ({ ...b }))
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
