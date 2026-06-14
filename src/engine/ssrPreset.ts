import type { EnvironmentSettings } from './types'

/** Wave 20 — SSR quality preset (parity with WebGL SSRPass + TSL SSRNode). */

export type SSRPreset = 'off' | 'low' | 'medium' | 'high'

export interface SSRSettings {
  enabled: boolean
  preset: SSRPreset
  maxDistance: number
  opacity: number
  thickness: number
  /** Wave 21 — enable ground bounce / reflector assist */
  groundReflect?: boolean
}

const SSR_TABLE: Record<SSRPreset, Omit<SSRSettings, 'enabled' | 'preset'>> = {
  off: { maxDistance: 0, opacity: 0, thickness: 0 },
  low: { maxDistance: 50, opacity: 0.28, thickness: 0.018 },
  medium: { maxDistance: 100, opacity: 0.5, thickness: 0.01 },
  high: { maxDistance: 200, opacity: 0.82, thickness: 0.005 },
}

export function getSSRSettings(env: EnvironmentSettings): SSRSettings {
  const preset = (env.postSsrPreset ?? 'medium') as SSRPreset
  const enabled = env.postSsr === true
  const row = SSR_TABLE[preset] ?? SSR_TABLE.medium
  return { enabled, preset, ...row, groundReflect: env.postSsrGround === true }
}

export function ssrStatusLabel(env: EnvironmentSettings): string {
  const s = getSSRSettings(env)
  if (!s.enabled) return ''
  return ` SSR(${s.preset})`
}

/** Apply SSR quality to a TSL SSR pass node (when properties exist). */
export function applySSRToTSLNode(ssrPass: unknown, settings: SSRSettings): void {
  if (!settings.enabled) return
  const p = ssrPass as {
    maxDistance?: { value: number }
    opacity?: { value: number }
    thickness?: { value: number }
  }
  if (p.maxDistance) p.maxDistance.value = settings.maxDistance
  if (p.opacity) p.opacity.value = settings.opacity
  if (p.thickness) p.thickness.value = settings.thickness
  const bounce = p as { isBouncing?: boolean }
  if (settings.groundReflect && 'isBouncing' in bounce) bounce.isBouncing = true
}

/** Apply SSR quality to WebGL SSRPass. */
export function applySSRToWebGLPass(ssrPass: {
  maxDistance: number
  opacity: number
  thickness: number
}, settings: SSRSettings): void {
  if (!settings.enabled) return
  ssrPass.maxDistance = settings.maxDistance
  ssrPass.opacity = settings.opacity
  ssrPass.thickness = settings.thickness
}