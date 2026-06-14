/**
 * Gamepad haptics — Gamepad Haptic Actuators via dual-rumble playEffect.
 * Wave 69 (v3.84–v3.88): guarded vibrationActuator; opt-out via environment.gamepadHaptics.
 * Wave 74 (v4.09–v4.13): intensity + duration scaled by adaptive hapticScale.
 */

import { scaleHapticDuration, scaleHapticMagnitude } from './adaptiveHaptics'

/** Strong pulse for fire actions (0–1). */
const FIRE_INTENSITY = 0.85
/** Light tap for interact / use (0–1). */
const INTERACT_INTENSITY = 0.45
/** Fire rumble length (ms). */
const FIRE_DURATION = 28
/** Interact rumble length (ms). */
const INTERACT_DURATION = 14

let forcedEnabled: boolean | undefined

type HapticActuator = {
  playEffect: (
    type: string,
    params: { duration: number; weakMagnitude: number; strongMagnitude: number; startDelay?: number },
  ) => Promise<unknown>
}

export function isGamepadHapticsSupported(): boolean {
  return pickActuator(null) !== null
}

/** Whether haptics are allowed (env flag + optional bridge override). Default on when unset. */
export function hapticsEnabled(envFlag?: boolean): boolean {
  if (forcedEnabled !== undefined) return forcedEnabled
  if (envFlag === false) return false
  return true
}

export function setGamepadHapticsEnabled(on: boolean): void {
  forcedEnabled = on
}

/** Pulse a connected pad's vibrationActuator (pad index null = first connected). */
export function pulseGamepad(
  padIndex: number | null,
  intensity: number,
  duration: number,
  envFlag?: boolean,
  scale = 1,
): boolean {
  if (!hapticsEnabled(envFlag)) return false
  if (scale <= 0) return false
  const actuator = pickActuator(padIndex)
  if (!actuator) return false
  const mag = scaleHapticMagnitude(intensity, scale)
  const ms = scaleHapticDuration(duration, scale)
  if (ms <= 0 || mag <= 0) return false
  try {
    void actuator.playEffect('dual-rumble', {
      startDelay: 0,
      duration: ms,
      weakMagnitude: mag,
      strongMagnitude: mag,
    })
    return true
  } catch {
    return false
  }
}

export function pulseFire(envFlag?: boolean, scale = 1): boolean {
  return pulseGamepad(null, FIRE_INTENSITY, FIRE_DURATION, envFlag, scale)
}

export function pulseInteract(envFlag?: boolean, scale = 1): boolean {
  return pulseGamepad(null, INTERACT_INTENSITY, INTERACT_DURATION, envFlag, scale)
}

function pickActuator(padIndex: number | null): HapticActuator | null {
  if (typeof navigator === 'undefined' || !navigator.getGamepads) return null
  const pads = navigator.getGamepads()
  if (padIndex !== null) {
    const act = (pads[padIndex] as Gamepad & { vibrationActuator?: HapticActuator })?.vibrationActuator
    return act && typeof act.playEffect === 'function' ? act : null
  }
  for (let i = 0; i < pads.length; i++) {
    const act = (pads[i] as Gamepad & { vibrationActuator?: HapticActuator })?.vibrationActuator
    if (pads[i]?.connected && act && typeof act.playEffect === 'function') return act
  }
  return null
}