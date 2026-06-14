import * as THREE from 'three'
import type { Actor } from '../engine/Actor'
import type { PawnMode } from '../engine/types'
import { isCharacterControllerReady, moveAndSlide } from '../engine/characterController'
import { getRapier, physicsReady } from '../engine/physics'
import { world } from '../engine/World'
import { ensurePlayVehicle, isRaycastVehicleReady, updateRaycastVehicle } from '../engine/physicsVehicle'
import { getGamepadMoveAxis, isGamepadJumpDown, pollGamepadInput, shouldEnableGamepadControls } from '../engine/gamepadInput'
import { getTouchMoveAxis, isTouchJumpDown } from '../engine/touchInput'
import type { EnvironmentSettings } from '../engine/types'

/**
 * PlayController — the pawn possessed during Play-In-Editor.
 * Three modes (set on the PlayerStart actor):
 *  - fly:          spectator pawn, WASD + Space/C vertical, no gravity
 *  - firstperson:  gravity, ground collision, jump, eye-height camera
 *  - thirdperson:  same character physics + visible body and a camera boom
 */
export type SpectatorHostPose = () => { position: THREE.Vector3; yaw: number } | null
export type SpectatorReplaySeek = (offsetSec: number) => number
export type SpectatorReplayOffset = () => number

export class PlayController {
  camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 5000)
  active = false
  mode: PawnMode = 'fly'
  /** Wave 68 — MP spectator: orbit/fly camera, no pawn body or gameplay input */
  spectator = false
  spectatorFollowHost = true

  /** supplies the meshes the character can stand on */
  collidables: () => THREE.Object3D[] = () => []

  private dom: HTMLElement
  private keys = new Set<string>()
  private yaw = 0
  private pitch = 0
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ')
  private flySpeed = 6
  private walkSpeed = 5

  // character state (first/third person)
  private feet = new THREE.Vector3()
  // vehicle state
  private carSpeed = 0
  private carHeading = 0
  private vy = 0
  private grounded = false
  /** When true, use Rapier move_and_slide instead of raycast character (World Settings). */
  useRapierCharacter = true
  useRaycastVehicle = false
  /** Wave 44 — poll Gamepad API each frame when enabled. */
  gamepadControls = true
  /** Wave 69 — dual-rumble env flag (default on when unset). */
  private gamepadHapticsEnv?: boolean
  /** Wave 74 — adaptive haptic scale env slice. */
  private hapticScaleEnv?: import('../engine/adaptiveHaptics').HapticScaleEnv
  private spawnPoint = new THREE.Vector3()
  private readonly eyeHeight = 1.65
  private readonly boomLength = 4.5
  private ray = new THREE.Raycaster()
  private orbitRadius = 10
  private orbitTarget = new THREE.Vector3()
  private hostPose: SpectatorHostPose | null = null
  private replaySeek: SpectatorReplaySeek | null = null
  private replayOffset: SpectatorReplayOffset | null = null

  /** visible body for third person */
  body: THREE.Group

  private onMouseMove = (e: MouseEvent) => {
    if (!this.active || document.pointerLockElement !== this.dom) return
    this.yaw -= e.movementX * 0.0023
    this.pitch -= e.movementY * 0.0023
    const limit = this.mode === 'thirdperson' || this.mode === 'vehicle' ? Math.PI / 3 : Math.PI / 2 - 0.01
    this.pitch = Math.max(-limit, Math.min(limit, this.pitch))
  }
  private onKeyDown = (e: KeyboardEvent) => this.keys.add(e.code)
  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code)
  private onClick = () => {
    if (this.active && document.pointerLockElement !== this.dom) this.dom.requestPointerLock?.()
  }

  constructor(dom: HTMLElement) {
    this.dom = dom
    this.body = PlayController.buildBody()
    this.body.visible = false
    window.addEventListener('mousemove', this.onMouseMove)
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    dom.addEventListener('click', this.onClick)
  }

  private static buildBody(): THREE.Group {
    const g = new THREE.Group()
    const mat = new THREE.MeshStandardMaterial({ color: 0x2f80ed, roughness: 0.55, metalness: 0.15 })
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.85, 6, 14), mat)
    torso.position.y = 0.95
    torso.castShadow = true
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 18, 12), mat)
    head.position.y = 1.72
    head.castShadow = true
    const visor = new THREE.Mesh(
      new THREE.BoxGeometry(0.26, 0.08, 0.08),
      new THREE.MeshStandardMaterial({ color: 0x10131a, roughness: 0.2, emissive: 0x2fd0ed, emissiveIntensity: 0.7 }),
    )
    visor.position.set(0, 1.74, -0.16)
    g.add(torso, head, visor)
    g.traverse((o) => (o.userData.isEditorOnly = true))
    return g
  }

  /** MP spectator — free-fly or orbit around host pose; no pawn spawn. */
  enterSpectator(
    spawn: THREE.Vector3,
    hostPose?: SpectatorHostPose,
    replay?: { seek: SpectatorReplaySeek; offset: SpectatorReplayOffset },
  ) {
    this.spectator = true
    this.active = true
    this.mode = 'fly'
    this.hostPose = hostPose ?? null
    this.replaySeek = replay?.seek ?? null
    this.replayOffset = replay?.offset ?? null
    this.body.visible = false
    this.keys.clear()
    this.yaw = 0
    this.pitch = -0.3
    this.orbitRadius = 10
    this.orbitTarget.copy(spawn)
    this.camera.position.copy(spawn)
    this.syncSpectatorCamera()
    this.dom.requestPointerLock?.()
  }

  exitSpectator() {
    this.spectator = false
    this.hostPose = null
    this.replaySeek = null
    this.replayOffset = null
  }

  possess(start: Actor | undefined, spawnOverride?: [number, number, number]) {
    this.spectator = false
    this.hostPose = null
    this.replaySeek = null
    this.replayOffset = null
    this.active = true
    this.mode = start?.pawnMode ?? 'fly'
    const pos = new THREE.Vector3()
    if (spawnOverride) {
      pos.set(spawnOverride[0], spawnOverride[1], spawnOverride[2])
      this.yaw = 0
    } else if (start) {
      start.root.getWorldPosition(pos)
      const q = new THREE.Quaternion()
      start.root.getWorldQuaternion(q)
      this.euler.setFromQuaternion(q)
      this.yaw = this.euler.y
    } else {
      pos.set(0, 0, 0) // UE fallback: world origin
      this.yaw = 0
    }
    this.pitch = this.mode === 'thirdperson' || this.mode === 'vehicle' ? -0.25 : 0
    this.carSpeed = 0
    this.carHeading = this.yaw
    this.spawnPoint.copy(pos)
    this.feet.copy(pos)
    this.vy = 0
    this.grounded = false

    if (this.mode === 'fly') {
      this.camera.position.copy(pos).add(new THREE.Vector3(0, this.eyeHeight, 0))
    }
    this.body.visible = this.mode === 'thirdperson' || this.mode === 'vehicle'
    this.body.scale.setScalar(this.mode === 'vehicle' ? 1.4 : 1)
    this.body.rotation.x = this.mode === 'vehicle' ? -Math.PI / 2 + 0.12 : 0
    this.syncCamera()
    this.dom.requestPointerLock?.()
  }

  unpossess() {
    this.active = false
    this.spectator = false
    this.hostPose = null
    this.replaySeek = null
    this.replayOffset = null
    this.keys.clear()
    this.body.visible = false
    if (document.pointerLockElement === this.dom) document.exitPointerLock()
  }

  /** Eject (F8): pause input/lock but keep the pawn where it is. */
  suspend() {
    this.active = false
    this.keys.clear()
    if (document.pointerLockElement === this.dom) document.exitPointerLock()
  }

  /** Re-possess after eject: resume control without resetting the pawn. */
  resume() {
    this.active = true
    this.dom.requestPointerLock?.()
  }

  /** current pawn world position (feet for characters, camera for fly) */
  get position(): THREE.Vector3 {
    return this.mode === 'fly' ? this.camera.position : this.feet
  }

  /** camera look yaw (radians) — for script hitscan */
  get viewYaw(): number {
    return this.yaw
  }

  /** camera look pitch (radians) */
  get viewPitch(): number {
    return this.pitch
  }

  /**
   * Wall collision: cast at knee and chest height along the move direction;
   * on hit, slide along the wall (strip the into-wall component).
   */
  private collideWalls(dx: number, dz: number): [number, number] {
    const len = Math.hypot(dx, dz)
    if (len === 0) return [dx, dz]
    const radius = 0.38
    const dir = new THREE.Vector3(dx / len, 0, dz / len)
    const colliders = this.collidables()
    for (const h of [0.45, 1.25]) {
      this.ray.set(this.feet.clone().add(new THREE.Vector3(0, h, 0)), dir)
      this.ray.far = len + radius
      for (const hit of this.ray.intersectObjects(colliders, false)) {
        let editorOnly = false
        let cur: THREE.Object3D | null = hit.object
        while (cur) {
          if (cur.userData.isEditorOnly) editorOnly = true
          cur = cur.parent
        }
        if (editorOnly || !hit.face) continue
        // steep faces only — ramps/floors stay walkable
        const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld)
        if (Math.abs(n.y) > 0.55) continue
        n.y = 0
        n.normalize()
        const moveV = new THREE.Vector3(dx, 0, dz)
        const into = n.dot(moveV)
        if (into < 0) moveV.addScaledVector(n, -into)
        return [moveV.x, moveV.z]
      }
    }
    return [dx, dz]
  }

  private groundHeightAt(p: THREE.Vector3): number | null {
    this.ray.set(new THREE.Vector3(p.x, p.y + 1.2, p.z), new THREE.Vector3(0, -1, 0))
    this.ray.far = 60
    const hits = this.ray.intersectObjects(this.collidables(), false)
    for (const h of hits) {
      let editorOnly = false
      let cur: THREE.Object3D | null = h.object
      while (cur) {
        if (cur.userData.isEditorOnly) editorOnly = true
        cur = cur.parent
      }
      if (!editorOnly) return h.point.y
    }
    return null
  }

  private syncSpectatorCamera() {
    const host = this.spectatorFollowHost ? this.hostPose?.() : null
    if (host) {
      this.orbitTarget.copy(host.position)
      const offset = new THREE.Vector3(
        Math.sin(this.yaw) * Math.cos(this.pitch) * this.orbitRadius,
        Math.sin(this.pitch) * this.orbitRadius + 1.6,
        Math.cos(this.yaw) * Math.cos(this.pitch) * this.orbitRadius,
      )
      this.camera.position.copy(this.orbitTarget).add(offset)
      this.camera.lookAt(this.orbitTarget)
      return
    }
    this.euler.set(this.pitch, this.yaw, 0)
    this.camera.quaternion.setFromEuler(this.euler)
  }

  private updateSpectator(dt: number) {
    if (this.keys.has('KeyQ')) this.orbitRadius = Math.max(3, this.orbitRadius - 10 * dt)
    if (this.keys.has('KeyE')) this.orbitRadius = Math.min(40, this.orbitRadius + 10 * dt)
    if (this.keys.has('KeyF')) this.spectatorFollowHost = !this.spectatorFollowHost
    if (this.replaySeek) {
      if (this.keys.has('KeyR')) {
        const cur = this.replayOffset?.() ?? 0
        this.replaySeek(cur + 4 * dt)
      } else if ((this.replayOffset?.() ?? 0) > 0) {
        this.replaySeek(0)
      }
    }

    const host = this.spectatorFollowHost ? this.hostPose?.() : null
    if (host) {
      this.syncSpectatorCamera()
      return
    }

    const move = new THREE.Vector3()
    if (this.keys.has('KeyW')) move.z -= 1
    if (this.keys.has('KeyS')) move.z += 1
    if (this.keys.has('KeyA')) move.x -= 1
    if (this.keys.has('KeyD')) move.x += 1
    if (this.keys.has('Space')) move.y += 1
    if (this.keys.has('KeyC')) move.y -= 1
    if (move.lengthSq() > 0) {
      move.normalize()
      const speed = this.flySpeed * (this.keys.has('ShiftLeft') ? 3 : 1)
      const forward = new THREE.Vector3()
      this.camera.getWorldDirection(forward)
      const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize()
      this.camera.position.addScaledVector(forward, -move.z * speed * dt)
      this.camera.position.addScaledVector(right, move.x * speed * dt)
      this.camera.position.y += move.y * speed * dt
    }
    this.syncSpectatorCamera()
  }

  private syncCamera() {
    this.euler.set(this.pitch, this.yaw, 0)
    if (this.mode === 'vehicle') {
      const head = this.feet.clone().add(new THREE.Vector3(0, 1.4, 0))
      const back = new THREE.Vector3(0, 0.35, 1).applyEuler(new THREE.Euler(0, this.carHeading, 0)).multiplyScalar(6.5)
      this.camera.position.copy(head).add(back)
      this.camera.lookAt(head)
      return
    }
    if (this.mode === 'thirdperson') {
      const head = this.feet.clone().add(new THREE.Vector3(0, 1.6, 0))
      const back = new THREE.Vector3(0, 0, 1).applyEuler(this.euler).multiplyScalar(this.boomLength)
      this.camera.position.copy(head).add(back)
      this.camera.lookAt(head)
    } else if (this.mode === 'firstperson') {
      this.camera.position.copy(this.feet).add(new THREE.Vector3(0, this.eyeHeight, 0))
      this.camera.quaternion.setFromEuler(this.euler)
    } else {
      this.camera.quaternion.setFromEuler(this.euler)
    }
  }

  setGamepadControls(env: EnvironmentSettings) {
    this.gamepadControls = shouldEnableGamepadControls(env.gamepadControls)
    this.gamepadHapticsEnv = env.gamepadHaptics
    this.hapticScaleEnv = env
  }

  private mergedMoveAxis() {
    const touch = getTouchMoveAxis()
    const gamepad = getGamepadMoveAxis()
    return {
      x: Math.abs(gamepad.x) > Math.abs(touch.x) ? gamepad.x : touch.x,
      y: Math.abs(gamepad.y) > Math.abs(touch.y) ? gamepad.y : touch.y,
    }
  }

  update(dt: number) {
    if (!this.active) {
      // keep third-person body parked where the pawn is even while ejected
      if (this.body.visible) this.body.position.copy(this.feet)
      return
    }

    if (this.spectator) {
      this.updateSpectator(dt)
      return
    }

    if (this.gamepadControls) pollGamepadInput(this.gamepadHapticsEnv, this.hapticScaleEnv)

    const move = new THREE.Vector3()
    if (this.keys.has('KeyW')) move.z -= 1
    if (this.keys.has('KeyS')) move.z += 1
    if (this.keys.has('KeyA')) move.x -= 1
    if (this.keys.has('KeyD')) move.x += 1
    const alt = this.mergedMoveAxis()
    const td = 0.28
    if (alt.y < -td) move.z -= 1
    if (alt.y > td) move.z += 1
    if (alt.x < -td) move.x -= 1
    if (alt.x > td) move.x += 1

    if (this.mode === 'vehicle') {
      if (this.useRaycastVehicle && physicsReady()) {
        const rapier = getRapier()
        const rapierWorld = world.physics.getRapierWorld()
        if (rapier && rapierWorld) ensurePlayVehicle(rapier, rapierWorld, this.feet)
      }
      if (this.useRaycastVehicle && isRaycastVehicleReady()) {
        const throttle = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 0.6 : 0)
        const steer = (this.keys.has('KeyA') ? 1 : 0) - (this.keys.has('KeyD') ? 1 : 0)
        const brake = this.keys.has('Space') ? 1 : 0
        const res = updateRaycastVehicle(dt, throttle, steer, brake)
        if (res) {
          this.feet.copy(res.position)
          this.carHeading = new THREE.Euler().setFromQuaternion(res.quaternion).y
          this.carSpeed = res.speed
          this.body.position.copy(this.feet)
          this.body.rotation.y = this.carHeading
          this.syncCamera()
          return
        }
      }
      // arcade car: throttle/brake + speed-scaled steering, ground-following
      const accel = 14
      const maxSpeed = this.keys.has('ShiftLeft') ? 28 : 16
      if (this.keys.has('KeyW')) this.carSpeed = Math.min(maxSpeed, this.carSpeed + accel * dt)
      else if (this.keys.has('KeyS')) this.carSpeed = Math.max(-7, this.carSpeed - accel * dt)
      else this.carSpeed *= Math.max(0, 1 - 1.4 * dt)
      const steer = (this.keys.has('KeyA') ? 1 : 0) - (this.keys.has('KeyD') ? 1 : 0)
      this.carHeading += steer * Math.min(1, Math.abs(this.carSpeed) / 6) * 1.9 * dt * Math.sign(this.carSpeed || 1)
      let dx = -Math.sin(this.carHeading) * this.carSpeed * dt
      let dz = -Math.cos(this.carHeading) * this.carSpeed * dt
      ;[dx, dz] = this.collideWalls(dx, dz)
      if ((dx === 0 && dz === 0) && Math.abs(this.carSpeed) > 4) this.carSpeed *= 0.4 // crash slowdown
      this.feet.x += dx
      this.feet.z += dz
      const g = this.groundHeightAt(this.feet)
      if (g !== null) this.feet.y = THREE.MathUtils.lerp(this.feet.y, g, Math.min(1, 10 * dt))
      if (this.feet.y < -60) { this.feet.copy(this.spawnPoint); this.carSpeed = 0 }
      this.body.position.copy(this.feet)
      this.body.rotation.y = this.carHeading
      this.syncCamera()
      return
    }
    if (this.mode === 'fly') {
      if (this.keys.has('Space')) move.y += 1
      if (this.keys.has('KeyC')) move.y -= 1
      if (move.lengthSq() > 0) {
        move.normalize()
        const speed = this.flySpeed * (this.keys.has('ShiftLeft') ? 3 : 1)
        const forward = new THREE.Vector3()
        this.camera.getWorldDirection(forward)
        const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize()
        this.camera.position.addScaledVector(forward, -move.z * speed * dt)
        this.camera.position.addScaledVector(right, move.x * speed * dt)
        this.camera.position.y += move.y * speed * dt
      }
      this.syncCamera()
      return
    }

    const speed = this.walkSpeed * (this.keys.has('ShiftLeft') ? 1.9 : 1)
    const sin = Math.sin(this.yaw)
    const cos = Math.cos(this.yaw)
    let vx = 0
    let vz = 0
    if (move.lengthSq() > 0) {
      move.normalize()
      vx = (move.x * cos + move.z * sin) * speed
      vz = (-move.x * sin + move.z * cos) * speed
    }

    if (this.useRapierCharacter && physicsReady() && isCharacterControllerReady()) {
      if (this.grounded && (this.keys.has('Space') || isTouchJumpDown() || isGamepadJumpDown())) this.vy = 8.5
      this.vy -= 22 * dt
      const res = moveAndSlide({
        position: this.feet,
        velocity: new THREE.Vector3(vx, this.vy, vz),
        dt,
      })
      if (res) {
        this.grounded = res.onFloor
        if (res.onFloor && this.vy < 0) this.vy = 0
        if (this.mode === 'thirdperson' && (vx !== 0 || vz !== 0)) {
          this.body.rotation.y = Math.atan2(-vx, -vz)
        }
      }
    } else {
      let dx = vx * dt
      let dz = vz * dt
      ;[dx, dz] = this.collideWalls(dx, dz)
      this.feet.x += dx
      this.feet.z += dz
      if (this.mode === 'thirdperson' && (dx !== 0 || dz !== 0)) {
        this.body.rotation.y = Math.atan2(-dx, -dz)
      }
      this.vy -= 22 * dt
      if (this.grounded && (this.keys.has('Space') || isTouchJumpDown() || isGamepadJumpDown())) {
        this.vy = 8.5
        this.grounded = false
      }
      this.feet.y += this.vy * dt
      const ground = this.groundHeightAt(this.feet)
      if (ground !== null && this.feet.y <= ground + 0.02 && this.vy <= 0) {
        this.feet.y = ground
        this.vy = 0
        this.grounded = true
      } else {
        this.grounded = false
      }
    }
    // fell out of the world — respawn
    if (this.feet.y < -60) {
      this.feet.copy(this.spawnPoint)
      this.vy = 0
    }

    this.body.position.copy(this.feet)
    this.syncCamera()
  }

  dispose() {
    window.removeEventListener('mousemove', this.onMouseMove)
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    this.dom.removeEventListener('click', this.onClick)
  }
}
