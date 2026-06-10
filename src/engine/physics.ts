import * as THREE from 'three'
import type RAPIER_NS from '@dimforge/rapier3d-compat'
import type { Actor } from './Actor'

/**
 * Physics — the Chaos analog, backed by Rapier (WASM). The simulation only
 * exists while Play-In-Editor runs: beginPlay builds bodies from actor
 * colliders, tick steps the world and writes transforms back, endPlay drops
 * the whole simulation (actor transforms restore via Actor.endPlay()).
 */

let RAPIER: typeof RAPIER_NS | null = null
let initPromise: Promise<void> | null = null

export function preloadPhysics(): Promise<void> {
  if (!initPromise) {
    initPromise = import('@dimforge/rapier3d-compat').then(async (mod) => {
      const r = (mod.default ?? mod) as typeof RAPIER_NS
      await r.init()
      RAPIER = r
    })
  }
  return initPromise
}

export function physicsReady(): boolean {
  return RAPIER !== null
}

interface BodyBinding {
  actor: Actor
  body: RAPIER_NS.RigidBody
}

export class PhysicsSim {
  private world: RAPIER_NS.World | null = null
  private bindings: BodyBinding[] = []

  start(actors: Iterable<Actor>) {
    if (!RAPIER) return
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
    for (const actor of actors) {
      const props = actor.physicsProps
      if (!props || props.mode === 'none' || !actor.mesh) continue
      // UE: only Movable actors may simulate as dynamic bodies
      if (props.mode === 'dynamic' && !actor.canMoveAtRuntime()) continue

      const pos = new THREE.Vector3()
      const quat = new THREE.Quaternion()
      if (actor.type !== 'Landscape') {
        actor.root.getWorldPosition(pos)
        actor.root.getWorldQuaternion(quat)
      }

      const desc =
        props.mode === 'dynamic'
          ? RAPIER.RigidBodyDesc.dynamic().setAdditionalMass(props.mass)
          : RAPIER.RigidBodyDesc.fixed()
      desc.setTranslation(pos.x, pos.y, pos.z).setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w })
      const body = this.world.createRigidBody(desc)

      const collider = this.colliderFor(actor)
      if (!collider) {
        this.world.removeRigidBody(body)
        continue
      }
      collider.setFriction(props.friction).setRestitution(props.restitution)
      this.world.createCollider(collider, body)
      if (props.mode === 'dynamic') this.bindings.push({ actor, body })
    }
  }

  /** Build a collider matched to the actor's geometry kind and world scale. */
  private colliderFor(actor: Actor): RAPIER_NS.ColliderDesc | null {
    if (!RAPIER || !actor.mesh) return null
    // sculpted terrain — exact trimesh collider
    if (actor.type === 'Landscape') {
      const geo = actor.mesh.geometry
      const verts = new Float32Array(geo.attributes.position.array.length)
      const v = new THREE.Vector3()
      for (let i = 0; i < geo.attributes.position.count; i++) {
        v.fromBufferAttribute(geo.attributes.position, i)
        actor.mesh.localToWorld(v)
        verts[i * 3] = v.x
        verts[i * 3 + 1] = v.y
        verts[i * 3 + 2] = v.z
      }
      const idx = geo.index ? new Uint32Array(geo.index.array) : new Uint32Array(0)
      // trimesh is in world space — pair with a fixed body at origin
      return RAPIER.ColliderDesc.trimesh(verts, idx)
    }
    const scale = new THREE.Vector3()
    actor.root.getWorldScale(scale)

    switch (actor.geometryKind) {
      case 'sphere':
        return RAPIER.ColliderDesc.ball(0.5 * Math.max(scale.x, scale.y, scale.z))
      case 'capsule':
        return RAPIER.ColliderDesc.capsule(0.3 * scale.y, 0.3 * Math.max(scale.x, scale.z))
      case 'cylinder':
      case 'cone':
        return RAPIER.ColliderDesc.cylinder(0.5 * scale.y, 0.5 * Math.max(scale.x, scale.z))
      case 'plane':
        // ground slab — thin cuboid under the plane surface
        return RAPIER.ColliderDesc.cuboid(0.5 * scale.x, 0.02, 0.5 * scale.z).setTranslation(0, -0.02, 0)
      case 'box':
      case undefined:
      default: {
        // generic: use the mesh's bounding box (works for imported glTF too)
        const box = new THREE.Box3().setFromObject(actor.mesh)
        const size = new THREE.Vector3()
        box.getSize(size)
        if (size.lengthSq() === 0) size.setScalar(1)
        return RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2)
      }
    }
  }

  step(dt: number) {
    if (!this.world) return
    this.world.timestep = Math.min(dt, 1 / 30)
    this.world.step()
    for (const { actor, body } of this.bindings) {
      const t = body.translation()
      const r = body.rotation()
      // physics owns world transform during play; actors with physics are
      // expected to sit at scene root (the common case)
      actor.root.position.set(t.x, t.y, t.z)
      actor.root.quaternion.set(r.x, r.y, r.z, r.w)
    }
  }

  stop() {
    this.world?.free()
    this.world = null
    this.bindings = []
  }
}
