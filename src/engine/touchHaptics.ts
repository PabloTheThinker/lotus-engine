/**
 * Touch haptics — PWA Vibration API pulses on Fire / Interact / Jump.
 * Wave 64 (v3.59–v3.63): guarded navigator.vibrate; opt-out via environment.touchHaptics.
 */

/** Short punch for fire actions (ms). */
const FIRE_PATTERN = [28]
/** Light tap for interact / use (ms). */
const INTERACT_PATTERN = [14]
/** Medium pulse for jump (ms). */
const JUMP_PATTERN = [22]

let forcedEnabled: boolean | undefined

export function isVibrationSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'
}

/** Whether haptics are allowed (env flag + optional bridge override). Default on when unset. */
export function hapticsEnabled(envFlag?: boolean): boolean {
  if (forcedEnabled !== undefined) return forcedEnabled
  if (envFlag === false) return false
  return true
}

export function setTouchHapticsEnabled(on: boolean): void {
  forcedEnabled = on
}

function tryVibrate(pattern: number | number[], envFlag?: boolean): boolean {
  if (!hapticsEnabled(envFlag)) return false
  if (!isVibrationSupported()) return false
  try {
    return navigator.vibrate(pattern)
  } catch {
    return false
  }
}

export function vibrateFire(envFlag?: boolean): boolean {
  return tryVibrate(FIRE_PATTERN, envFlag)
}

export function vibrateInteract(envFlag?: boolean): boolean {
  return tryVibrate(INTERACT_PATTERN, envFlag)
}

export function vibrateJump(envFlag?: boolean): boolean {
  return tryVibrate(JUMP_PATTERN, envFlag)
}