import * as THREE from 'three'
import type RAPIER_NS from '@dimforge/rapier3d-compat'
import { physicsReady } from './physics'

/** Wave 11 — Rapier DynamicRayCastVehicleController (Chaos Vehicles ◐ honest). */

let vehicle: RAPIER_NS.DynamicRayCastVehicleController | null = null
let chassisBody: RAPIER_NS.RigidBody | null = null

export function initRaycastVehicle(
  _rapier: typeof RAPIER_NS,
  world: RAPIER_NS.World,
  chassis: RAPIER_NS.RigidBody,
): boolean {
  disposeRaycastVehicle()
  chassisBody = chassis
  vehicle = world.createVehicleController(chassis)
  vehicle.indexUpAxis = 1
  vehicle.setIndexForwardAxis = 2
  const wheelY = -0.35
  const wheelZ = 0.85
  const susp = 0.35
  const radius = 0.32
  for (const [x, z] of [
    [-0.75, wheelZ],
    [0.75, wheelZ],
    [-0.75, -wheelZ],
    [0.75, -wheelZ],
  ] as const) {
    vehicle.addWheel(
      { x, y: wheelY, z },
      { x: 0, y: -1, z: 0 },
      { x: -1, y: 0, z: 0 },
      susp,
      radius,
    )
  }
  return true
}

export function updateRaycastVehicle(dt: number, throttle: number, steer: number, brake: number) {
  if (!vehicle || !chassisBody) return null
  const n = vehicle.numWheels()
  const engine = throttle * 180
  const brakeF = brake * 8
  for (let i = 0; i < n; i++) {
    vehicle.setWheelEngineForce(i, engine)
    vehicle.setWheelBrake(i, brakeF)
    vehicle.setWheelSteering(i, steer * 0.45)
  }
  vehicle.updateVehicle(dt)
  const t = chassisBody.translation()
  const r = chassisBody.rotation()
  const speed = vehicle.currentVehicleSpeed()
  return {
    position: new THREE.Vector3(t.x, t.y, t.z),
    quaternion: new THREE.Quaternion(r.x, r.y, r.z, r.w),
    speed,
  }
}

export function isRaycastVehicleReady(): boolean {
  return physicsReady() && vehicle !== null && chassisBody !== null
}

export function disposeRaycastVehicle() {
  if (vehicle && chassisBody) {
    // vehicle removed when world frees
  }
  vehicle?.free()
  vehicle = null
  chassisBody = null
}

/** Spawn a play-session vehicle chassis at the pawn feet (PIE vehicle mode). */
export function ensurePlayVehicle(
  rapier: typeof RAPIER_NS,
  world: RAPIER_NS.World,
  position: THREE.Vector3,
): boolean {
  if (vehicle && chassisBody) return true
  const desc = rapier.RigidBodyDesc.dynamic()
    .setTranslation(position.x, position.y + 0.5, position.z)
    .setAdditionalMass(900)
  const body = world.createRigidBody(desc)
  world.createCollider(rapier.ColliderDesc.cuboid(0.9, 0.35, 1.6), body)
  return initRaycastVehicle(rapier, world, body)
}