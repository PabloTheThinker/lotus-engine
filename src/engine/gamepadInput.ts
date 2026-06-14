/**
 * Gamepad input — standard Gamepad API stick + face buttons for PWA / PIE.
 * Wave 44 (v2.60): axis/button state mirrors touch injection into Input.
 */

import { Input } from './Input'
import type { TouchAxis } from './touchInput'

const ZERO: TouchAxis = { x: 0, y: 0 }

/** Standard mapping: left stick move, A jump, Y fire, X interact. */
const BTN_JUMP = 0
const BTN_INTERACT = 2
const BTN_FIRE = 3
const BTN_FIRE_ALT = 7 // RT

let moveAxis: TouchAxis = { ...ZERO }
let jumpDown = false
let jumpJustPressed = false
let fireDown = false
let fireJustPressed = false
let interactDown = false
let interactJustPressed = false
let connected = false

let prevJump = false
let prevFire = false
let prevInteract = false

export function isGamepadConnected(): boolean {
  return connected
}

export function shouldEnableGamepadControls(gamepadControls: boolean | undefined): boolean {
  if (gamepadControls === true) return true
  if (gamepadControls === false) return false
  return pickGamepad() !== null
}

export function getGamepadMoveAxis(): TouchAxis {
  return { ...moveAxis }
}

export function isGamepadJumpDown(): boolean {
  return jumpDown
}

export function isGamepadFireDown(): boolean {
  return fireDown
}

export function isGamepadInteractDown(): boolean {
  return interactDown
}

export function isGamepadFireJustPressed(): boolean {
  return fireJustPressed
}

export function isGamepadInteractJustPressed(): boolean {
  return interactJustPressed
}

/** Poll the first active gamepad and inject into Input (call once per frame while playing). */
export function pollGamepadInput(): boolean {
  const pad = pickGamepad()
  connected = !!pad
  if (!pad) {
    moveAxis = { ...ZERO }
    jumpDown = false
    fireDown = false
    interactDown = false
    jumpJustPressed = false
    fireJustPressed = false
    interactJustPressed = false
    prevJump = false
    prevFire = false
    prevInteract = false
    Input.clearGamepadInput()
    return false
  }

  const dead = 0.18
  let x = pad.axes[0] ?? 0
  let y = pad.axes[1] ?? 0
  if (Math.hypot(x, y) < dead) {
    x = 0
    y = 0
  } else {
    const mag = Math.hypot(x, y)
    const scale = (mag - dead) / (1 - dead)
    x = (x / mag) * scale
    y = (y / mag) * scale
  }
  moveAxis = { x: clamp(x), y: clamp(y) }

  const btn = (i: number) => !!pad.buttons[i]?.pressed
  jumpDown = btn(BTN_JUMP)
  fireDown = btn(BTN_FIRE) || btn(BTN_FIRE_ALT)
  interactDown = btn(BTN_INTERACT)

  jumpJustPressed = jumpDown && !prevJump
  fireJustPressed = fireDown && !prevFire
  interactJustPressed = interactDown && !prevInteract
  prevJump = jumpDown
  prevFire = fireDown
  prevInteract = interactDown

  Input.syncGamepadInput(
    moveAxis,
    jumpDown,
    jumpJustPressed,
    fireDown,
    fireJustPressed,
    interactDown,
    interactJustPressed,
  )
  return true
}

export function endGamepadInputFrame() {
  jumpJustPressed = false
  fireJustPressed = false
  interactJustPressed = false
}

export function resetGamepadInput() {
  moveAxis = { ...ZERO }
  jumpDown = false
  fireDown = false
  interactDown = false
  jumpJustPressed = false
  fireJustPressed = false
  interactJustPressed = false
  prevJump = false
  prevFire = false
  prevInteract = false
  connected = false
  Input.clearGamepadInput()
}

function pickGamepad(): Gamepad | null {
  if (typeof navigator === 'undefined' || !navigator.getGamepads) return null
  const pads = navigator.getGamepads()
  for (let i = 0; i < pads.length; i++) {
    const p = pads[i]
    if (p?.connected) return p
  }
  return null
}

function clamp(v: number): number {
  return Math.max(-1, Math.min(1, v))
}