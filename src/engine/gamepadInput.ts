/**
 * Gamepad input — standard Gamepad API stick + face buttons for PWA / PIE.
 * Wave 44 (v2.60): axis/button state mirrors touch injection into Input.
 * Wave 69 (v3.84): dual-rumble on fire / interact just-pressed via gamepadHaptics.
 */

import { hapticScale, type HapticScaleEnv } from './adaptiveHaptics'
import { pulseFire, pulseInteract } from './gamepadHaptics'
import { Input } from './Input'
import {
  DEFAULT_GAMEPAD_BUTTONS,
  GAMEPAD_FIRE_ALT,
  getEffectiveGamepadButton,
} from './inputBindings'
import type { TouchAxis } from './touchInput'

const ZERO: TouchAxis = { x: 0, y: 0 }

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
export function pollGamepadInput(hapticsEnv?: boolean, hapticScaleEnv?: HapticScaleEnv): boolean {
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
  const jumpBtn = getEffectiveGamepadButton('Jump')
  const fireBtn = getEffectiveGamepadButton('Fire')
  const interactBtn = getEffectiveGamepadButton('Interact')
  jumpDown = btn(jumpBtn)
  fireDown = btn(fireBtn) || (fireBtn === DEFAULT_GAMEPAD_BUTTONS.Fire && btn(GAMEPAD_FIRE_ALT))
  interactDown = btn(interactBtn)

  jumpJustPressed = jumpDown && !prevJump
  fireJustPressed = fireDown && !prevFire
  interactJustPressed = interactDown && !prevInteract
  const rumbleScale = hapticScaleEnv ? hapticScale(hapticScaleEnv) : 1
  if (fireJustPressed) pulseFire(hapticsEnv, rumbleScale)
  if (interactJustPressed) pulseInteract(hapticsEnv, rumbleScale)
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