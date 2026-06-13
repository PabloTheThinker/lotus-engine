import * as THREE from 'three'
import type { Actor } from './Actor'
import type { IKChain, IKTarget, LookAtTarget } from './types'

/** Reusable math scratch — avoids per-frame allocations in the play loop. */
const _v0 = new THREE.Vector3()
const _v1 = new THREE.Vector3()
const _v2 = new THREE.Vector3()
const _v3 = new THREE.Vector3()
const _v4 = new THREE.Vector3()
const _v5 = new THREE.Vector3()
const _q0 = new THREE.Quaternion()
const _q1 = new THREE.Quaternion()
const _up = new THREE.Vector3(0, 1, 0)
const _targetScratch = new THREE.Vector3()

/** glTF humanoid + common Mixamo bone name patterns per limb chain. */
const CHAIN_BONE_PATTERNS: Record<
  IKChain,
  { hip: string[]; knee: string[]; ankle: string[] }
> = {
  leftLeg: {
    hip: ['LeftUpLeg', 'leftupleg', 'mixamorigLeftUpLeg', 'mixamorig:LeftUpLeg', 'LeftThigh'],
    knee: ['LeftLeg', 'leftleg', 'mixamorigLeftLeg', 'mixamorig:LeftLeg', 'LeftShin', 'LeftKnee'],
    ankle: ['LeftFoot', 'leftfoot', 'mixamorigLeftFoot', 'mixamorig:LeftFoot', 'LeftAnkle'],
  },
  rightLeg: {
    hip: ['RightUpLeg', 'rightupleg', 'mixamorigRightUpLeg', 'mixamorig:RightUpLeg', 'RightThigh'],
    knee: ['RightLeg', 'rightleg', 'mixamorigRightLeg', 'mixamorig:RightLeg', 'RightShin', 'RightKnee'],
    ankle: ['RightFoot', 'rightfoot', 'mixamorigRightFoot', 'mixamorig:RightFoot', 'RightAnkle'],
  },
  leftArm: {
    hip: ['LeftArm', 'leftarm', 'mixamorigLeftArm', 'mixamorig:LeftArm', 'LeftShoulder'],
    knee: ['LeftForeArm', 'leftforearm', 'mixamorigLeftForeArm', 'mixamorig:LeftForeArm', 'LeftElbow'],
    ankle: ['LeftHand', 'lefthand', 'mixamorigLeftHand', 'mixamorig:LeftHand', 'LeftWrist'],
  },
  rightArm: {
    hip: ['RightArm', 'rightarm', 'mixamorigRightArm', 'mixamorig:RightArm', 'RightShoulder'],
    knee: ['RightForeArm', 'rightforearm', 'mixamorigRightForeArm', 'mixamorig:RightForeArm', 'RightElbow'],
    ankle: ['RightHand', 'righthand', 'mixamorigRightHand', 'mixamorig:RightHand', 'RightWrist'],
  },
}

const HEAD_BONE_PATTERNS = ['Head', 'head', 'mixamorigHead', 'mixamorig:Head', 'Neck', 'neck', 'mixamorigNeck', 'mixamorig:Neck']

function boneNameMatches(boneName: string, pattern: string): boolean {
  const n = boneName.toLowerCase()
  const p = pattern.toLowerCase()
  return n === p || n.endsWith(p) || n.includes(p)
}

/** Find the first skeleton bone whose name matches any heuristic pattern. */
export function findBone(skeleton: THREE.Skeleton, patterns: string[]): THREE.Bone | null {
  for (const bone of skeleton.bones) {
    for (const pattern of patterns) {
      if (boneNameMatches(bone.name, pattern)) return bone
    }
  }
  return null
}

/** Return the first SkinnedMesh skeleton under an actor root, if any. */
export function getActorSkeleton(actor: Actor): THREE.Skeleton | null {
  let found: THREE.Skeleton | null = null
  actor.root.traverse((o) => {
    if (!found && o instanceof THREE.SkinnedMesh && o.skeleton) found = o.skeleton
  })
  return found
}

export function hasActorSkeleton(actor: Actor): boolean {
  return getActorSkeleton(actor) !== null
}

function setWorldQuaternion(obj: THREE.Object3D, worldQuat: THREE.Quaternion): void {
  if (obj.parent) {
    obj.parent.updateMatrixWorld(true)
    const parentWorldQuat = _q0
    obj.parent.getWorldQuaternion(parentWorldQuat)
    obj.quaternion.copy(parentWorldQuat.invert().multiply(worldQuat))
  } else {
    obj.quaternion.copy(worldQuat)
  }
}

function rotateBoneToward(bone: THREE.Object3D, child: THREE.Object3D, target: THREE.Vector3): void {
  const bonePos = _v0
  const childPos = _v1
  bone.getWorldPosition(bonePos)
  child.getWorldPosition(childPos)

  const curDir = _v2.copy(childPos).sub(bonePos)
  const wantDir = _v3.copy(target).sub(bonePos)
  if (curDir.lengthSq() < 1e-8 || wantDir.lengthSq() < 1e-8) return
  curDir.normalize()
  wantDir.normalize()

  const delta = _q0.setFromUnitVectors(curDir, wantDir)
  const worldQ = _q1
  bone.getWorldQuaternion(worldQ)
  worldQ.premultiply(delta)
  setWorldQuaternion(bone, worldQ)
}

/**
 * Analytical two-bone IK (hip → knee → ankle) toward a world-space target.
 * Runs after the animation mixer so animation poses become the IK base.
 */
export function twoBoneIK(
  hip: THREE.Bone,
  knee: THREE.Bone,
  ankle: THREE.Bone,
  target: THREE.Vector3,
  poleHint?: THREE.Vector3,
): void {
  hip.updateMatrixWorld(true)
  knee.updateMatrixWorld(true)
  ankle.updateMatrixWorld(true)

  const hipPos = _v0
  const kneePos = _v1
  const anklePos = _v2
  hip.getWorldPosition(hipPos)
  knee.getWorldPosition(kneePos)
  ankle.getWorldPosition(anklePos)

  const lenUpper = hipPos.distanceTo(kneePos)
  const lenLower = kneePos.distanceTo(anklePos)
  if (lenUpper < 1e-5 || lenLower < 1e-5) return

  const toTarget = _v3.copy(target).sub(hipPos)
  let reach = toTarget.length()
  if (reach < 1e-5) return
  toTarget.normalize()

  reach = THREE.MathUtils.clamp(
    reach,
    Math.abs(lenUpper - lenLower) + 1e-4,
    lenUpper + lenLower - 1e-4,
  )

  const cosHip = THREE.MathUtils.clamp(
    (lenUpper * lenUpper + reach * reach - lenLower * lenLower) / (2 * lenUpper * reach),
    -1,
    1,
  )
  const hipAngle = Math.acos(cosHip)

  const bendAxis = _v4
  if (poleHint) {
    bendAxis.copy(poleHint).sub(hipPos)
    bendAxis.addScaledVector(toTarget, -bendAxis.dot(toTarget))
  } else {
    bendAxis.copy(kneePos).sub(hipPos)
    bendAxis.addScaledVector(toTarget, -bendAxis.dot(toTarget))
  }
  if (bendAxis.lengthSq() < 1e-8) {
    bendAxis.crossVectors(_up, toTarget)
    if (bendAxis.lengthSq() < 1e-8) bendAxis.set(1, 0, 0)
  }
  bendAxis.normalize()

  const newKnee = _v5
    .copy(hipPos)
    .addScaledVector(toTarget, Math.cos(hipAngle) * lenUpper)
    .addScaledVector(bendAxis, Math.sin(hipAngle) * lenUpper)

  rotateBoneToward(hip, knee, newKnee)

  hip.updateMatrixWorld(true)
  rotateBoneToward(knee, ankle, target)
}

/** Rotate a bone so it looks at a world target (Godot SkeletonIK3D / LookAt analog). */
export function lookAt(head: THREE.Object3D, target: THREE.Vector3, up: THREE.Vector3 = _up): void {
  const pos = _v0
  head.getWorldPosition(pos)
  if (pos.distanceToSquared(target) < 1e-8) return

  const m = new THREE.Matrix4()
  m.lookAt(pos, target, up)
  const worldQuat = _q0.setFromRotationMatrix(m)
  setWorldQuaternion(head, worldQuat)
}

function resolveWorldTarget(
  spec: { targetActorId?: string; targetPosition?: [number, number, number] },
  actors: Map<string, Actor>,
  out: THREE.Vector3,
): THREE.Vector3 | null {
  if (spec.targetActorId) {
    const ta = actors.get(spec.targetActorId)
    if (!ta) return null
    return ta.root.getWorldPosition(out)
  }
  if (spec.targetPosition) {
    return out.set(spec.targetPosition[0], spec.targetPosition[1], spec.targetPosition[2])
  }
  return null
}

/** Apply configured IK + LookAt targets on a skinned glTF actor. */
export function applyActorIK(actor: Actor, actors: Map<string, Actor>): void {
  const skeleton = getActorSkeleton(actor)
  if (!skeleton) return

  for (const ik of actor.ikTargets ?? []) {
    const patterns = CHAIN_BONE_PATTERNS[ik.chain]
    const hip = findBone(skeleton, patterns.hip)
    const knee = findBone(skeleton, patterns.knee)
    const ankle = findBone(skeleton, patterns.ankle)
    if (!hip || !knee || !ankle) continue

    const target = resolveWorldTarget(ik, actors, _targetScratch)
    if (!target) continue

    twoBoneIK(hip, knee, ankle, target)
  }

  if (actor.lookAtTarget) {
    const head = findBone(skeleton, HEAD_BONE_PATTERNS)
    const target = resolveWorldTarget(actor.lookAtTarget, actors, _targetScratch)
    if (head && target) lookAt(head, target)
  }

  skeleton.update()
}

export function getChainBoneLabels(chain: IKChain): { hip: string; knee: string; ankle: string } {
  const p = CHAIN_BONE_PATTERNS[chain]
  return { hip: p.hip[0], knee: p.knee[0], ankle: p.ankle[0] }
}

export type { IKChain, IKTarget, LookAtTarget }