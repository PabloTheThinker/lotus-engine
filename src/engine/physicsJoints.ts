import type RAPIER_NS from '@dimforge/rapier3d-compat'
import type { PhysicsJointDef } from './types'

/** Wave 11 — Rapier impulse joints editor runtime. */

export function createPhysicsJoints(
  RAPIER: typeof RAPIER_NS,
  world: RAPIER_NS.World,
  joints: PhysicsJointDef[],
  bodyByActor: Map<string, RAPIER_NS.RigidBody>,
): RAPIER_NS.ImpulseJoint[] {
  const created: RAPIER_NS.ImpulseJoint[] = []
  for (const j of joints) {
    const a = bodyByActor.get(j.bodyA)
    const b = bodyByActor.get(j.bodyB)
    if (!a || !b) continue
    const anchorA = { x: j.anchorA[0], y: j.anchorA[1], z: j.anchorA[2] }
    const anchorB = { x: j.anchorB[0], y: j.anchorB[1], z: j.anchorB[2] }
    let data: RAPIER_NS.JointData
    switch (j.type) {
      case 'revolute':
        data = RAPIER.JointData.revolute(anchorA, anchorB, {
          x: j.axis?.[0] ?? 0,
          y: j.axis?.[1] ?? 1,
          z: j.axis?.[2] ?? 0,
        })
        break
      case 'prismatic':
        data = RAPIER.JointData.prismatic(anchorA, anchorB, {
          x: j.axis?.[0] ?? 0,
          y: j.axis?.[1] ?? 1,
          z: j.axis?.[2] ?? 0,
        })
        break
      case 'spherical':
        data = RAPIER.JointData.spherical(anchorA, anchorB)
        break
      case 'fixed':
      default:
        data = RAPIER.JointData.fixed(anchorA, { w: 1, x: 0, y: 0, z: 0 }, anchorB, { w: 1, x: 0, y: 0, z: 0 })
        break
    }
    created.push(world.createImpulseJoint(data, a, b, true))
  }
  return created
}