import * as THREE from 'three'
import type RAPIER_NS from '@dimforge/rapier3d-compat'
import { physicsReady } from './physics'

/**
 * Godot move_and_slide analog — Rapier KinematicCharacterController wrapper.
 */

export interface MoveAndSlideResult {
  position: THREE.Vector3
  velocity: THREE.Vector3
  onFloor: boolean
}

export interface MoveAndSlideOptions {
  /** Feet world position in, updated world position out */
  position: THREE.Vector3
  /** Desired velocity (m/s) */
  velocity: THREE.Vector3
  dt: number
  /** Capsule half-height (excluding hemispheres) */
  halfHeight?: number
  radius?: number
}

let RAPIER: typeof RAPIER_NS | null = null
let world: RAPIER_NS.World | null = null
let controller: RAPIER_NS.KinematicCharacterController | null = null
let collider: RAPIER_NS.Collider | null = null
let body: RAPIER_NS.RigidBody | null = null
let lastOnFloor = false

const _desired = { x: 0, y: 0, z: 0 }
const _out = new THREE.Vector3()

export function initCharacterController(rapier: typeof RAPIER_NS, simWorld: RAPIER_NS.World): boolean {
  RAPIER = rapier
  world = simWorld
  if (controller) {
    world.removeCharacterController(controller)
    controller.free()
  }
  if (collider && body) {
    world.removeCollider(collider, true)
    world.removeRigidBody(body)
  }
  controller = world.createCharacterController(0.02)
  controller.setUp({ x: 0, y: 1, z: 0 })
  controller.enableAutostep(0.35, 0.15, true)
  controller.enableSnapToGround(0.25)
  controller.setSlideEnabled(true)

  const desc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 1, 0)
  body = world.createRigidBody(desc)
  const cDesc = RAPIER.ColliderDesc.capsule(0.55, 0.32)
  collider = world.createCollider(cDesc, body)
  return true
}

export function disposeCharacterController() {
  if (world && controller) {
    world.removeCharacterController(controller)
    controller.free()
  }
  if (world && collider) world.removeCollider(collider, true)
  if (world && body) world.removeRigidBody(body)
  controller = null
  collider = null
  body = null
  world = null
  RAPIER = null
}

/** Rapier-backed character move with floor detection. */
export function moveAndSlide(opts: MoveAndSlideOptions): MoveAndSlideResult | null {
  if (!physicsReady() || !RAPIER || !world || !controller || !collider || !body) return null

  _desired.x = opts.velocity.x * opts.dt
  _desired.y = opts.velocity.y * opts.dt
  _desired.z = opts.velocity.z * opts.dt

  controller.computeColliderMovement(collider, _desired)
  const moved = controller.computedMovement()
  const t = body.translation()
  _out.set(t.x + moved.x, t.y + moved.y, t.z + moved.z)
  body.setNextKinematicTranslation({ x: _out.x, y: _out.y, z: _out.z })
  opts.position.copy(_out)

  lastOnFloor = controller.computedGrounded()
  return {
    position: _out,
    velocity: opts.velocity.clone(),
    onFloor: lastOnFloor,
  }
}

export function isCharacterControllerReady(): boolean {
  return !!(controller && collider && body)
}

export function characterIsOnFloor(): boolean {
  return lastOnFloor
}