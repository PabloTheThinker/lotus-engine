/**
 * Input bindings — per-action gamepad button + touch slot overrides.
 * Wave 54 (v3.09–v3.13): localStorage `lotus-engine.inputBindings`.
 */

export type GamepadAction = 'Jump' | 'Fire' | 'Interact'
export type TouchAction = 'jump' | 'fire' | 'interact'
export type TouchSlotId = 'jump-btn' | 'fire-btn' | 'interact-btn'

export interface InputBindings {
  gamepad: Partial<Record<GamepadAction, number>>
  touch: Partial<Record<TouchAction, TouchSlotId>>
}

const STORAGE_KEY = 'lotus-engine.inputBindings'

export const DEFAULT_GAMEPAD_BUTTONS: Record<GamepadAction, number> = {
  Jump: 0,
  Interact: 2,
  Fire: 3,
}

/** RT trigger — secondary fire when Fire stays on default face button. */
export const GAMEPAD_FIRE_ALT = 7

export const DEFAULT_TOUCH_SLOTS: Record<TouchAction, TouchSlotId> = {
  jump: 'jump-btn',
  fire: 'fire-btn',
  interact: 'interact-btn',
}

export const TOUCH_SLOT_IDS: TouchSlotId[] = ['jump-btn', 'fire-btn', 'interact-btn']

export const GAMEPAD_ACTIONS: GamepadAction[] = ['Jump', 'Fire', 'Interact']
export const TOUCH_ACTIONS: TouchAction[] = ['jump', 'fire', 'interact']

let cached: InputBindings | null = null
let version = 0
const listeners = new Set<() => void>()

function normalizeGamepadButton(n: unknown): number | null {
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 31) return null
  return n
}

function normalizeTouchSlot(slot: unknown): TouchSlotId | null {
  if (slot === 'jump-btn' || slot === 'fire-btn' || slot === 'interact-btn') return slot
  return null
}

function loadFromStorage(): InputBindings {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as InputBindings
    const gamepad: Partial<Record<GamepadAction, number>> = {}
    const touch: Partial<Record<TouchAction, TouchSlotId>> = {}
    for (const action of GAMEPAD_ACTIONS) {
      const v = raw.gamepad?.[action]
      if (v !== undefined) {
        const n = normalizeGamepadButton(v)
        if (n !== null) gamepad[action] = n
      }
    }
    for (const action of TOUCH_ACTIONS) {
      const v = raw.touch?.[action]
      if (v !== undefined) {
        const s = normalizeTouchSlot(v)
        if (s !== null) touch[action] = s
      }
    }
    return { gamepad, touch }
  } catch {
    return { gamepad: {}, touch: {} }
  }
}

function persist(store: InputBindings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
}

function notify() {
  version += 1
  listeners.forEach((l) => l())
}

export function getBindingsVersion(): number {
  return version
}

export function subscribeBindings(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function loadInputBindings(): InputBindings {
  if (!cached) cached = loadFromStorage()
  return {
    gamepad: { ...cached.gamepad },
    touch: { ...cached.touch },
  }
}

export function getEffectiveGamepadButton(action: GamepadAction): number {
  const bindings = loadInputBindings()
  return bindings.gamepad[action] ?? DEFAULT_GAMEPAD_BUTTONS[action]
}

export function getEffectiveTouchSlot(action: TouchAction): TouchSlotId {
  const bindings = loadInputBindings()
  return bindings.touch[action] ?? DEFAULT_TOUCH_SLOTS[action]
}

export function getBindings(): {
  gamepad: Record<GamepadAction, number>
  touch: Record<TouchAction, TouchSlotId>
} {
  return {
    gamepad: {
      Jump: getEffectiveGamepadButton('Jump'),
      Fire: getEffectiveGamepadButton('Fire'),
      Interact: getEffectiveGamepadButton('Interact'),
    },
    touch: {
      jump: getEffectiveTouchSlot('jump'),
      fire: getEffectiveTouchSlot('fire'),
      interact: getEffectiveTouchSlot('interact'),
    },
  }
}

export function setGamepadButton(action: GamepadAction, button: number): boolean {
  const n = normalizeGamepadButton(button)
  if (n === null) return false
  const current = loadInputBindings()
  cached = { ...current, gamepad: { ...current.gamepad, [action]: n } }
  persist(cached)
  notify()
  return true
}

export function setTouchSlot(action: TouchAction, slot: TouchSlotId): boolean {
  if (!normalizeTouchSlot(slot)) return false
  const current = loadInputBindings()
  cached = { ...current, touch: { ...current.touch, [action]: slot } }
  persist(cached)
  notify()
  return true
}

export function resetBindings(): void {
  cached = { gamepad: {}, touch: {} }
  persist(cached)
  notify()
}

/** Replace all overrides with a full profile snapshot (Wave 59). */
export function applyBindings(bindings: InputBindings): InputBindings {
  const gamepad: Partial<Record<GamepadAction, number>> = {}
  const touch: Partial<Record<TouchAction, TouchSlotId>> = {}
  for (const action of GAMEPAD_ACTIONS) {
    const v = bindings.gamepad?.[action]
    if (v !== undefined) {
      const n = normalizeGamepadButton(v)
      if (n !== null) gamepad[action] = n
    }
  }
  for (const action of TOUCH_ACTIONS) {
    const v = bindings.touch?.[action]
    if (v !== undefined) {
      const s = normalizeTouchSlot(v)
      if (s !== null) touch[action] = s
    }
  }
  cached = { gamepad, touch }
  persist(cached)
  notify()
  return loadInputBindings()
}

export function bindingsForExport(): InputBindings {
  return loadInputBindings()
}

export function invalidateBindingsCache(): void {
  cached = null
}