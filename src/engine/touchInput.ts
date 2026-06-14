/**
 * Touch input — virtual joystick + jump for mobile PWA / editor PIE preview.
 * Wave 39 (v2.34): axis state, VirtualJoystick, device detection.
 */

export interface TouchAxis {
  /** MoveRight: negative = left (KeyA), positive = right (KeyD) */
  x: number
  /** MoveForward: negative = forward (KeyW), positive = back (KeyS) */
  y: number
}

const ZERO: TouchAxis = { x: 0, y: 0 }

let moveAxis: TouchAxis = { ...ZERO }
let jumpDown = false
let jumpJustPressed = false

/** True when the host has touch capability (coarse pointer or touch events). */
export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false
  if ('ontouchstart' in window) return true
  if (navigator.maxTouchPoints > 0) return true
  return window.matchMedia?.('(pointer: coarse)').matches ?? false
}

/** Current normalized move axis from the virtual left stick (-1..1 each axis). */
export function getTouchMoveAxis(): TouchAxis {
  return { ...moveAxis }
}

export function isTouchJumpDown(): boolean {
  return jumpDown
}

export function isTouchJumpJustPressed(): boolean {
  return jumpJustPressed
}

/** Internal — called by overlay / export HUD each frame. */
export function syncTouchInputState(axis: TouchAxis, jump: boolean, jumpJust: boolean) {
  moveAxis = { x: clamp(axis.x), y: clamp(axis.y) }
  jumpDown = jump
  if (jumpJust) jumpJustPressed = true
}

export function endTouchInputFrame() {
  jumpJustPressed = false
}

export function resetTouchInput() {
  moveAxis = { ...ZERO }
  jumpDown = false
  jumpJustPressed = false
}

function clamp(v: number): number {
  return Math.max(-1, Math.min(1, v))
}

export interface VirtualJoystickOptions {
  radius?: number
  deadZone?: number
}

/**
 * On-screen virtual left stick — touch-drag within a circular zone.
 * Maps stick deflection to MoveForward / MoveRight axes.
 */
export class VirtualJoystick {
  readonly root: HTMLElement
  private readonly knob: HTMLElement
  private readonly radius: number
  private readonly deadZone: number
  private activeId: number | null = null
  private axis: TouchAxis = { ...ZERO }

  constructor(parent: HTMLElement, opts: VirtualJoystickOptions = {}) {
    this.radius = opts.radius ?? 56
    this.deadZone = opts.deadZone ?? 0.12

    const base = document.createElement('div')
    base.className = 'lotus-touch-joystick'
    base.style.width = `${this.radius * 2}px`
    base.style.height = `${this.radius * 2}px`

    const knob = document.createElement('div')
    knob.className = 'lotus-touch-joystick-knob'
    base.appendChild(knob)
    parent.appendChild(base)

    this.root = base
    this.knob = knob

    const onStart = (e: TouchEvent) => {
      if (this.activeId !== null) return
      const t = pickTouch(e, base)
      if (!t) return
      e.preventDefault()
      this.activeId = t.identifier
      this.updateFromTouch(t, base)
    }
    const onMove = (e: TouchEvent) => {
      if (this.activeId === null) return
      const t = findTouch(e, this.activeId)
      if (!t) return
      e.preventDefault()
      this.updateFromTouch(t, base)
    }
    const onEnd = (e: TouchEvent) => {
      if (this.activeId === null) return
      if (!findTouch(e, this.activeId) && e.type !== 'touchcancel') return
      e.preventDefault()
      this.activeId = null
      this.axis = { ...ZERO }
      knob.style.transform = 'translate(-50%, -50%)'
    }

    base.addEventListener('touchstart', onStart, { passive: false })
    base.addEventListener('touchmove', onMove, { passive: false })
    base.addEventListener('touchend', onEnd, { passive: false })
    base.addEventListener('touchcancel', onEnd, { passive: false })
  }

  getAxis(): TouchAxis {
    return { ...this.axis }
  }

  dispose() {
    this.root.remove()
    this.activeId = null
    this.axis = { ...ZERO }
  }

  private updateFromTouch(t: Touch, base: HTMLElement) {
    const rect = base.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    let dx = t.clientX - cx
    let dy = t.clientY - cy
    const len = Math.hypot(dx, dy)
    const max = this.radius
    if (len > max) {
      dx = (dx / len) * max
      dy = (dy / len) * max
    }
    const nx = dx / max
    const ny = dy / max
    const mag = Math.hypot(nx, ny)
    if (mag < this.deadZone) {
      this.axis = { ...ZERO }
    } else {
      const scale = (mag - this.deadZone) / (1 - this.deadZone)
      this.axis = { x: (nx / mag) * scale, y: (ny / mag) * scale }
    }
    this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`
  }
}

/** Large jump button (bottom-right). */
export class TouchJumpButton {
  readonly root: HTMLElement
  private down = false
  private just = false

  constructor(parent: HTMLElement, label = 'Jump') {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'lotus-touch-jump'
    btn.textContent = label
    btn.setAttribute('aria-label', label)
    parent.appendChild(btn)
    this.root = btn

    const press = (e: Event) => {
      e.preventDefault()
      if (!this.down) this.just = true
      this.down = true
    }
    const release = (e: Event) => {
      e.preventDefault()
      this.down = false
    }
    btn.addEventListener('touchstart', press, { passive: false })
    btn.addEventListener('touchend', release, { passive: false })
    btn.addEventListener('touchcancel', release, { passive: false })
    btn.addEventListener('mousedown', press)
    btn.addEventListener('mouseup', release)
    btn.addEventListener('mouseleave', release)
  }

  isDown(): boolean {
    return this.down
  }

  justPressed(): boolean {
    return this.just
  }

  endFrame() {
    this.just = false
  }

  dispose() {
    this.root.remove()
    this.down = false
    this.just = false
  }
}

function pickTouch(e: TouchEvent, el: HTMLElement): Touch | null {
  const rect = el.getBoundingClientRect()
  for (let i = 0; i < e.changedTouches.length; i++) {
    const t = e.changedTouches[i]
    if (
      t.clientX >= rect.left &&
      t.clientX <= rect.right &&
      t.clientY >= rect.top &&
      t.clientY <= rect.bottom
    ) {
      return t
    }
  }
  return e.changedTouches[0] ?? null
}

function findTouch(e: TouchEvent, id: number): Touch | null {
  for (let i = 0; i < e.touches.length; i++) {
    if (e.touches[i].identifier === id) return e.touches[i]
  }
  for (let i = 0; i < e.changedTouches.length; i++) {
    if (e.changedTouches[i].identifier === id) return e.changedTouches[i]
  }
  return null
}

/** Whether touch HUD should show (env override or auto on touch hardware). */
export function shouldShowTouchControls(touchControls: boolean | undefined): boolean {
  if (touchControls === true) return true
  if (touchControls === false) return false
  return isTouchDevice()
}