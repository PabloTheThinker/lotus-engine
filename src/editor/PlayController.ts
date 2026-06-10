import * as THREE from 'three'
import type { Actor } from '../engine/Actor'

/**
 * PlayController — the pawn possessed during Play-In-Editor (UE spectator
 * pawn). Spawns at the PlayerStart, pointer-lock mouselook, WASD fly with
 * Space/C for vertical and Shift to sprint.
 */
export class PlayController {
  camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 5000)
  active = false

  private dom: HTMLElement
  private keys = new Set<string>()
  private yaw = 0
  private pitch = 0
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ')
  private speed = 6

  private onMouseMove = (e: MouseEvent) => {
    if (!this.active || document.pointerLockElement !== this.dom) return
    this.yaw -= e.movementX * 0.0023
    this.pitch -= e.movementY * 0.0023
    this.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.pitch))
    this.euler.set(this.pitch, this.yaw, 0)
    this.camera.quaternion.setFromEuler(this.euler)
  }
  private onKeyDown = (e: KeyboardEvent) => this.keys.add(e.code)
  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code)
  private onClick = () => {
    if (this.active && document.pointerLockElement !== this.dom) this.dom.requestPointerLock?.()
  }

  constructor(dom: HTMLElement) {
    this.dom = dom
    window.addEventListener('mousemove', this.onMouseMove)
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    dom.addEventListener('click', this.onClick)
  }

  possess(start: Actor | undefined) {
    this.active = true
    if (start) {
      const pos = new THREE.Vector3()
      start.root.getWorldPosition(pos)
      this.camera.position.copy(pos).add(new THREE.Vector3(0, 1.6, 0))
      const q = new THREE.Quaternion()
      start.root.getWorldQuaternion(q)
      this.euler.setFromQuaternion(q)
      this.yaw = this.euler.y
      this.pitch = 0
    } else {
      // UE fallback: no PlayerStart → spawn at world origin
      this.camera.position.set(0, 1.7, 0)
      this.yaw = 0
      this.pitch = 0
    }
    this.euler.set(this.pitch, this.yaw, 0)
    this.camera.quaternion.setFromEuler(this.euler)
    this.dom.requestPointerLock?.()
  }

  unpossess() {
    this.active = false
    this.keys.clear()
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

  update(dt: number) {
    if (!this.active) return
    const move = new THREE.Vector3()
    if (this.keys.has('KeyW')) move.z -= 1
    if (this.keys.has('KeyS')) move.z += 1
    if (this.keys.has('KeyA')) move.x -= 1
    if (this.keys.has('KeyD')) move.x += 1
    if (this.keys.has('Space')) move.y += 1
    if (this.keys.has('KeyC')) move.y -= 1
    if (move.lengthSq() === 0) return
    move.normalize()
    const speed = this.speed * (this.keys.has('ShiftLeft') ? 3 : 1)
    const forward = new THREE.Vector3()
    this.camera.getWorldDirection(forward)
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize()
    this.camera.position.addScaledVector(forward, -move.z * speed * dt)
    this.camera.position.addScaledVector(right, move.x * speed * dt)
    this.camera.position.y += move.y * speed * dt
  }

  dispose() {
    window.removeEventListener('mousemove', this.onMouseMove)
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    this.dom.removeEventListener('click', this.onClick)
  }
}
