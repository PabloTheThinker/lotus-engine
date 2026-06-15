import * as THREE from 'three'

/** Godot SpringArm3D / UE spring arm analog — boom, shoulder offset, collision pull-in, smoothed orbit. */
export interface CameraRigState {
  position: THREE.Vector3
  lookAt: THREE.Vector3
  boomLength: number
  smoothedYaw: number
  smoothedPitch: number
}

export interface CameraRigUpdateInput {
  head: THREE.Vector3
  yaw: number
  pitch: number
  collidables: THREE.Object3D[]
  dt: number
}

const DEFAULT_SHOULDER: [number, number, number] = [0.42, 0.18, 0]
const COLLISION_MARGIN = 0.18
const BOOM_SMOOTH = 14

export class CameraRig {
  boomLength = 4.5
  shoulderOffset = new THREE.Vector3(...DEFAULT_SHOULDER)
  collisionEnabled = true
  minPitch = -Math.PI / 3
  maxPitch = Math.PI / 6
  yawSmooth = 12
  pitchSmooth = 12

  private currentBoom = 4.5
  private smoothedYaw = 0
  private smoothedPitch = -0.25
  private readonly ray = new THREE.Raycaster()
  private readonly pivot = new THREE.Vector3()
  private readonly desired = new THREE.Vector3()
  private readonly offset = new THREE.Vector3()
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ')
  private readonly state: CameraRigState = {
    position: new THREE.Vector3(),
    lookAt: new THREE.Vector3(),
    boomLength: 4.5,
    smoothedYaw: 0,
    smoothedPitch: -0.25,
  }

  reset(yaw = 0, pitch = -0.25) {
    this.smoothedYaw = yaw
    this.smoothedPitch = THREE.MathUtils.clamp(pitch, this.minPitch, this.maxPitch)
    this.currentBoom = this.boomLength
  }

  /** Raycast from pivot toward desired camera position; shorten boom on hit. */
  private collisionBoom(pivot: THREE.Vector3, desiredPos: THREE.Vector3, collidables: THREE.Object3D[]): number {
    if (!this.collisionEnabled || collidables.length === 0) return this.boomLength
    const dir = desiredPos.clone().sub(pivot)
    const len = dir.length()
    if (len < 0.05) return this.boomLength
    dir.normalize()
    this.ray.set(pivot, dir)
    this.ray.far = len
    const hits = this.ray.intersectObjects(collidables, false)
    for (const hit of hits) {
      let editorOnly = false
      let cur: THREE.Object3D | null = hit.object
      while (cur) {
        if (cur.userData.isEditorOnly) editorOnly = true
        cur = cur.parent
      }
      if (editorOnly) continue
      return Math.max(0.6, hit.distance - COLLISION_MARGIN)
    }
    return this.boomLength
  }

  update(input: CameraRigUpdateInput): CameraRigState {
    const { head, yaw, pitch, collidables, dt } = input
    const targetPitch = THREE.MathUtils.clamp(pitch, this.minPitch, this.maxPitch)
    const yawT = 1 - Math.exp(-this.yawSmooth * dt)
    const pitchT = 1 - Math.exp(-this.pitchSmooth * dt)
    this.smoothedYaw = THREE.MathUtils.lerp(this.smoothedYaw, yaw, yawT)
    this.smoothedPitch = THREE.MathUtils.lerp(this.smoothedPitch, targetPitch, pitchT)

    this.euler.set(this.smoothedPitch, this.smoothedYaw, 0)
    this.pivot.copy(head)
    this.offset.copy(this.shoulderOffset).applyEuler(new THREE.Euler(0, this.smoothedYaw, 0))
    this.pivot.add(this.offset)

    const back = new THREE.Vector3(0, 0, 1).applyEuler(this.euler).multiplyScalar(this.boomLength)
    this.desired.copy(this.pivot).add(back)

    const hitBoom = this.collisionBoom(this.pivot, this.desired, collidables)
    const boomT = 1 - Math.exp(-BOOM_SMOOTH * dt)
    this.currentBoom = THREE.MathUtils.lerp(this.currentBoom, hitBoom, boomT)

    back.set(0, 0, 1).applyEuler(this.euler).multiplyScalar(this.currentBoom)
    this.state.position.copy(this.pivot).add(back)
    this.state.lookAt.copy(head)
    this.state.boomLength = this.currentBoom
    this.state.smoothedYaw = this.smoothedYaw
    this.state.smoothedPitch = this.smoothedPitch
    return this.state
  }
}

/** Shared rig instance used by PlayController and window.lotus.cameraRig. */
export const playCameraRig = new CameraRig()

export const cameraRigBridge = {
  getBoomLength: () => playCameraRig.boomLength,
  setBoomLength: (len: number) => {
    const v = Math.max(0.6, Math.min(24, len))
    playCameraRig.boomLength = v
    return v
  },
  collisionEnabled: () => playCameraRig.collisionEnabled,
  setCollisionEnabled: (on: boolean) => {
    playCameraRig.collisionEnabled = on
    return on
  },
  shoulderOffset: (): [number, number, number] => [
    playCameraRig.shoulderOffset.x,
    playCameraRig.shoulderOffset.y,
    playCameraRig.shoulderOffset.z,
  ],
  setShoulderOffset: (x: number, y: number, z: number) => {
    playCameraRig.shoulderOffset.set(x, y, z)
    return [x, y, z] as [number, number, number]
  },
}