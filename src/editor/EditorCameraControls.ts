import * as THREE from 'three'

/**
 * Unreal-style viewport navigation:
 *  - RMB hold: mouselook + WASD/QE fly (scroll adjusts fly speed)
 *  - MMB drag (or LMB+Alt): pan
 *  - Scroll (without RMB): dolly toward look direction
 *  - F: focus selected handled by the viewport (calls focusOn)
 */
export class EditorCameraControls {
  enabled = true
  flySpeed = 8

  private camera: THREE.PerspectiveCamera
  private dom: HTMLElement
  private keys = new Set<string>()
  private looking = false
  private panning = false
  private yaw = 0
  private pitch = 0
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ')

  private onMouseDown = (e: MouseEvent) => {
    if (!this.enabled) return
    if (e.button === 2) {
      this.looking = true
      this.dom.requestPointerLock?.()
    } else if (e.button === 1 || (e.button === 0 && e.altKey)) {
      this.panning = true
      e.preventDefault()
    }
  }

  private onMouseUp = (e: MouseEvent) => {
    if (e.button === 2) {
      this.looking = false
      if (document.pointerLockElement === this.dom) document.exitPointerLock()
    }
    if (e.button === 1 || e.button === 0) this.panning = false
  }

  private onMouseMove = (e: MouseEvent) => {
    if (!this.enabled) return
    if (this.looking) {
      this.yaw -= e.movementX * 0.0022
      this.pitch -= e.movementY * 0.0022
      this.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.pitch))
      this.applyRotation()
    } else if (this.panning) {
      const dist = Math.max(this.camera.position.length(), 5)
      const panScale = dist * 0.0012
      const right = new THREE.Vector3()
      const up = new THREE.Vector3()
      this.camera.matrix.extractBasis(right, up, new THREE.Vector3())
      this.camera.position.addScaledVector(right, -e.movementX * panScale)
      this.camera.position.addScaledVector(up, e.movementY * panScale)
    }
  }

  /** notified when scroll-during-fly changes speed (syncs the UI) */
  onSpeedChange: ((speed: number) => void) | null = null

  private onWheel = (e: WheelEvent) => {
    if (!this.enabled) return
    e.preventDefault()
    if (this.looking) {
      // Unreal behavior: scroll while flying changes fly speed
      this.flySpeed = THREE.MathUtils.clamp(this.flySpeed * (e.deltaY < 0 ? 1.2 : 0.8), 0.5, 200)
      this.onSpeedChange?.(this.flySpeed)
    } else {
      const dir = new THREE.Vector3()
      this.camera.getWorldDirection(dir)
      const dist = Math.max(this.camera.position.length() * 0.1, 0.5)
      this.camera.position.addScaledVector(dir, e.deltaY < 0 ? dist : -dist)
    }
  }

  private onKeyDown = (e: KeyboardEvent) => {
    this.keys.add(e.code)
  }
  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code)
  }
  private onContextMenu = (e: Event) => e.preventDefault()
  private onBlur = () => {
    this.keys.clear()
    this.looking = false
    this.panning = false
  }

  constructor(camera: THREE.PerspectiveCamera, dom: HTMLElement) {
    this.camera = camera
    this.dom = dom
    // initialize yaw/pitch from current orientation
    this.euler.setFromQuaternion(camera.quaternion)
    this.yaw = this.euler.y
    this.pitch = this.euler.x

    dom.addEventListener('mousedown', this.onMouseDown)
    window.addEventListener('mouseup', this.onMouseUp)
    window.addEventListener('mousemove', this.onMouseMove)
    dom.addEventListener('wheel', this.onWheel, { passive: false })
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    dom.addEventListener('contextmenu', this.onContextMenu)
    window.addEventListener('blur', this.onBlur)
  }

  get isNavigating() {
    return this.looking || this.panning
  }

  private applyRotation() {
    this.euler.set(this.pitch, this.yaw, 0)
    this.camera.quaternion.setFromEuler(this.euler)
  }

  focusOn(target: THREE.Object3D) {
    const box = new THREE.Box3().setFromObject(target)
    const center = new THREE.Vector3()
    const size = new THREE.Vector3()
    if (box.isEmpty()) {
      target.getWorldPosition(center)
      size.setScalar(1)
    } else {
      box.getCenter(center)
      box.getSize(size)
    }
    const radius = Math.max(size.length() / 2, 0.5)
    const dir = new THREE.Vector3()
    this.camera.getWorldDirection(dir)
    this.camera.position.copy(center).addScaledVector(dir, -radius * 3)
  }

  update(dt: number) {
    if (!this.enabled || !this.looking) return
    const move = new THREE.Vector3()
    if (this.keys.has('KeyW')) move.z -= 1
    if (this.keys.has('KeyS')) move.z += 1
    if (this.keys.has('KeyA')) move.x -= 1
    if (this.keys.has('KeyD')) move.x += 1
    if (this.keys.has('KeyE')) move.y += 1
    if (this.keys.has('KeyQ')) move.y -= 1
    if (move.lengthSq() === 0) return
    move.normalize()
    const speed = this.flySpeed * (this.keys.has('ShiftLeft') ? 3 : 1)
    const forward = new THREE.Vector3()
    const right = new THREE.Vector3()
    const up = new THREE.Vector3(0, 1, 0)
    this.camera.getWorldDirection(forward)
    right.crossVectors(forward, up).normalize()
    this.camera.position.addScaledVector(forward, -move.z * speed * dt)
    this.camera.position.addScaledVector(right, move.x * speed * dt)
    this.camera.position.addScaledVector(up, move.y * speed * dt)
  }

  dispose() {
    this.dom.removeEventListener('mousedown', this.onMouseDown)
    window.removeEventListener('mouseup', this.onMouseUp)
    window.removeEventListener('mousemove', this.onMouseMove)
    this.dom.removeEventListener('wheel', this.onWheel)
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    this.dom.removeEventListener('contextmenu', this.onContextMenu)
    window.removeEventListener('blur', this.onBlur)
  }
}
