/**
 * Adaptive haptics — scale rumble by export perf gate, battery saver, and env intensity.
 * Wave 74 (v4.09–v4.13).
 */

export interface HapticScaleEnv {
  /** User intensity 0–1 (World Settings slider 0–100%). Default 1 when unset. */
  hapticIntensity?: number
  /** When true (default), reduce rumble on battery power via navigator.getBattery. */
  hapticBatterySaver?: boolean
}

export interface HapticPerfGate {
  fps?: number
  perfMinFps?: number
  perfPass?: boolean | null
}

let cachedCharging: boolean | undefined
let batteryProbeStarted = false

/** Test hook — override cached charging state. */
export function setBatteryChargingForTest(charging: boolean | undefined): void {
  cachedCharging = charging
}

interface BatteryManager {
  charging: boolean
}

interface NavigatorWithBattery extends Navigator {
  getBattery?: () => Promise<BatteryManager>
}

function probeBatteryCharging(): void {
  if (typeof navigator === 'undefined') return
  const nav = navigator as NavigatorWithBattery
  const getBattery = nav.getBattery?.bind(nav)
  if (!getBattery) return
  batteryProbeStarted = true
  void getBattery()
    .then((bat: BatteryManager) => {
      cachedCharging = bat.charging
    })
    .catch(() => {
      /* ignore — keep prior cache */
    })
}

if (typeof navigator !== 'undefined' && !batteryProbeStarted) {
  probeBatteryCharging()
  if (typeof setInterval === 'function') setInterval(probeBatteryCharging, 30_000)
}

export function readExportPerfGate(): HapticPerfGate | null {
  if (typeof window === 'undefined') return null
  const gate = (window as Window & { __LOTUS_EXPORT_PERF__?: HapticPerfGate }).__LOTUS_EXPORT_PERF__
  return gate ?? null
}

/** Perf component 0–1 from export __LOTUS_EXPORT_PERF__ fps gate. */
export function perfFpsHapticScale(gate?: HapticPerfGate | null): number {
  if (!gate?.fps || gate.fps <= 0) return 1
  const min = gate.perfMinFps ?? 24
  if (gate.perfPass === true) return 1
  return Math.max(0, Math.min(1, gate.fps / min))
}

/** Battery component 0–1; halves rumble on battery when saver is enabled. */
export function batteryHapticScale(env: HapticScaleEnv, charging?: boolean): number {
  if (env.hapticBatterySaver === false) return 1
  const state = charging ?? cachedCharging
  if (state === undefined) return 1
  return state ? 1 : 0.5
}

export function hapticIntensityFactor(intensity?: number): number {
  if (intensity == null) return 1
  return Math.max(0, Math.min(1, intensity))
}

/** Combined adaptive scale 0–1 for touch + gamepad haptics. */
export function hapticScale(
  env: HapticScaleEnv,
  perfGate?: HapticPerfGate | null,
  charging?: boolean,
): number {
  const gate = perfGate === undefined ? readExportPerfGate() : perfGate
  const intensity = hapticIntensityFactor(env.hapticIntensity)
  const perf = perfFpsHapticScale(gate)
  const battery = batteryHapticScale(env, charging)
  return Math.max(0, Math.min(1, intensity * perf * battery))
}

export function scaleHapticPattern(pattern: number | number[], scale: number): number | number[] {
  if (scale >= 1) return pattern
  if (scale <= 0) return Array.isArray(pattern) ? [0] : 0
  if (Array.isArray(pattern)) {
    return pattern.map((ms) => Math.max(1, Math.round(ms * scale)))
  }
  return Math.max(1, Math.round(pattern * scale))
}

export function scaleHapticMagnitude(value: number, scale: number): number {
  return Math.max(0, Math.min(1, value * scale))
}

export function scaleHapticDuration(ms: number, scale: number): number {
  if (scale <= 0) return 0
  return Math.max(0, Math.round(ms * scale))
}