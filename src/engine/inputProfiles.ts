/**
 * Wave 59 (v3.34–v3.38) — Input profiles: save/load binding presets (desktop vs mobile).
 * Wave 79 (v4.34–v4.38) — Haptic presets linked to input profiles (desktop strong / mobile light).
 * localStorage `lotus-engine.inputProfiles`.
 */

import {
  applyBindings,
  DEFAULT_GAMEPAD_BUTTONS,
  DEFAULT_TOUCH_SLOTS,
  loadInputBindings,
  type InputBindings,
} from './inputBindings'
import { normalizeTouchLayoutPreset, type TouchLayoutPreset } from './touchLayoutPresets'
import { world } from './World'

export const BUNDLED_PROFILE_IDS = ['desktop', 'mobile'] as const
export type BundledProfileId = (typeof BUNDLED_PROFILE_IDS)[number]

export interface HapticPreset {
  hapticIntensity: number
  hapticBatterySaver: boolean
}

export interface InputProfileData {
  bindings: InputBindings
  touchLayoutPreset: TouchLayoutPreset
  /** Wave 79 — master rumble strength 0–1 (desktop strong / mobile light). */
  hapticIntensity?: number
  /** Wave 79 — reduce rumble on battery when true. */
  hapticBatterySaver?: boolean
}

export const BUNDLED_INPUT_PROFILES: Record<BundledProfileId, InputProfileData> = {
  desktop: {
    bindings: {
      gamepad: { ...DEFAULT_GAMEPAD_BUTTONS },
      touch: { ...DEFAULT_TOUCH_SLOTS },
    },
    touchLayoutPreset: 'wide',
    hapticIntensity: 1,
    hapticBatterySaver: false,
  },
  mobile: {
    bindings: {
      gamepad: { ...DEFAULT_GAMEPAD_BUTTONS },
      touch: { ...DEFAULT_TOUCH_SLOTS },
    },
    touchLayoutPreset: 'compact',
    hapticIntensity: 0.5,
    hapticBatterySaver: true,
  },
}

const STORAGE_KEY = 'lotus-engine.inputProfiles'

interface StoredProfiles {
  active: string
  saved: Record<string, InputProfileData>
}

function defaultStore(): StoredProfiles {
  return { active: 'desktop', saved: {} }
}

function loadStore(): StoredProfiles {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<StoredProfiles>
    const saved: Record<string, InputProfileData> = {}
    if (raw.saved && typeof raw.saved === 'object') {
      for (const [name, entry] of Object.entries(raw.saved)) {
        const profile = normalizeProfile(entry)
        if (profile) saved[name] = profile
      }
    }
    const active =
      typeof raw.active === 'string' && (isBundledProfile(raw.active) || saved[raw.active])
        ? raw.active
        : 'desktop'
    return { active, saved }
  } catch {
    return defaultStore()
  }
}

function persistStore(store: StoredProfiles) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
}

function normalizeProfile(entry: unknown): InputProfileData | null {
  if (!entry || typeof entry !== 'object') return null
  const raw = entry as Partial<InputProfileData>
  const bindings: InputBindings = { gamepad: {}, touch: {} }
  if (raw.bindings && typeof raw.bindings === 'object') {
    bindings.gamepad = { ...(raw.bindings.gamepad ?? {}) }
    bindings.touch = { ...(raw.bindings.touch ?? {}) }
  }
  const hapticIntensity =
    typeof raw.hapticIntensity === 'number'
      ? Math.max(0, Math.min(1, raw.hapticIntensity))
      : undefined
  const hapticBatterySaver =
    typeof raw.hapticBatterySaver === 'boolean' ? raw.hapticBatterySaver : undefined
  return {
    bindings,
    touchLayoutPreset: normalizeTouchLayoutPreset(raw.touchLayoutPreset),
    hapticIntensity,
    hapticBatterySaver,
  }
}

export function isBundledProfile(name: string): name is BundledProfileId {
  return name === 'desktop' || name === 'mobile'
}

export function listInputProfiles(): string[] {
  const store = loadStore()
  return [...BUNDLED_PROFILE_IDS, ...Object.keys(store.saved).sort()]
}

/** Bundled + saved profile ids exposed on indie.input.profiles. */
export function profiles(): string[] {
  return listInputProfiles()
}

export function getInputProfile(name: string): InputProfileData | null {
  if (isBundledProfile(name)) return { ...BUNDLED_INPUT_PROFILES[name], bindings: loadProfileBindings(name) }
  const store = loadStore()
  const saved = store.saved[name]
  return saved ? { ...saved, bindings: { ...saved.bindings, gamepad: { ...saved.bindings.gamepad }, touch: { ...saved.bindings.touch } } } : null
}

function loadProfileBindings(name: BundledProfileId): InputBindings {
  const bundled = BUNDLED_INPUT_PROFILES[name]
  return {
    gamepad: { ...bundled.bindings.gamepad },
    touch: { ...bundled.bindings.touch },
  }
}

export function getActiveInputProfile(): string {
  return loadStore().active
}

/** Active profile name for indie.input.activeProfile. */
export function activeProfile(): string {
  return getActiveInputProfile()
}

export function captureCurrentProfile(): InputProfileData {
  const bindings = loadInputBindings()
  return {
    bindings: {
      gamepad: { ...bindings.gamepad },
      touch: { ...bindings.touch },
    },
    touchLayoutPreset: normalizeTouchLayoutPreset(world.environment.touchLayoutPreset),
    hapticIntensity: world.environment.hapticIntensity ?? 1,
    hapticBatterySaver: world.environment.hapticBatterySaver !== false,
  }
}

/** Linked haptic preset for bundled or saved input profiles (Wave 79). */
export function hapticPresetForProfile(name: string): HapticPreset | null {
  if (isBundledProfile(name)) {
    const bundled = BUNDLED_INPUT_PROFILES[name]
    return {
      hapticIntensity: bundled.hapticIntensity ?? 1,
      hapticBatterySaver: bundled.hapticBatterySaver === true,
    }
  }
  const saved = loadStore().saved[name]
  if (!saved) return null
  if (saved.hapticIntensity == null && saved.hapticBatterySaver == null) return null
  return {
    hapticIntensity: saved.hapticIntensity ?? 1,
    hapticBatterySaver: saved.hapticBatterySaver !== false,
  }
}

function applyProfileHaptics(profile: InputProfileData): void {
  if (profile.hapticIntensity != null) {
    world.environment.hapticIntensity = profile.hapticIntensity
  }
  if (profile.hapticBatterySaver != null) {
    world.environment.hapticBatterySaver = profile.hapticBatterySaver
  }
}

export function applyInputProfile(name: string): InputProfileData | null {
  const profile = getInputProfile(name)
  if (!profile) return null
  applyBindings(profile.bindings)
  world.environment.touchLayoutPreset = profile.touchLayoutPreset
  applyProfileHaptics(profile)
  world.applyEnvironment()
  const store = loadStore()
  store.active = name
  persistStore(store)
  return profile
}

export function saveInputProfile(name: string, data?: InputProfileData): boolean {
  const trimmed = name.trim()
  if (!trimmed || isBundledProfile(trimmed)) return false
  const profile = data ?? captureCurrentProfile()
  const store = loadStore()
  store.saved[trimmed] = {
    bindings: {
      gamepad: { ...profile.bindings.gamepad },
      touch: { ...profile.bindings.touch },
    },
    touchLayoutPreset: profile.touchLayoutPreset,
    hapticIntensity: profile.hapticIntensity,
    hapticBatterySaver: profile.hapticBatterySaver,
  }
  store.active = trimmed
  persistStore(store)
  return true
}

export function loadInputProfile(name: string): InputProfileData | null {
  return applyInputProfile(name)
}

export function profileNameForExport(): string {
  return getActiveInputProfile()
}

export function invalidateInputProfilesCache(): void {
  /* no in-memory cache yet — hook for tests */
}