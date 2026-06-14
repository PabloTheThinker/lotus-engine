import type { EnvironmentSettings } from './types'

/** Wave 12 — SSGI quality preset (honest Lumen skip, desktop WebGPU opt-in). */

export type SSGIPreset = 'off' | 'low' | 'medium' | 'high'

export interface SSGISettings {
  enabled: boolean
  preset: SSGIPreset
  intensity: number
  radius: number
  samples: number
}

export function getSSGISettings(env: EnvironmentSettings): SSGISettings {
  const preset = (env.postSsgiPreset ?? 'off') as SSGIPreset
  const enabled = env.postSsgi === true || (preset !== 'off' && env.renderBackend === 'webgpu')
  const table: Record<SSGIPreset, Omit<SSGISettings, 'enabled' | 'preset'>> = {
    off: { intensity: 0, radius: 0, samples: 0 },
    low: { intensity: 0.35, radius: 0.4, samples: 4 },
    medium: { intensity: 0.55, radius: 0.65, samples: 8 },
    high: { intensity: 0.75, radius: 0.9, samples: 12 },
  }
  const row = table[preset] ?? table.off
  return { enabled, preset, ...row }
}

export function ssgiStatusLabel(env: EnvironmentSettings, webgpuOk: boolean): string {
  const s = getSSGISettings(env)
  if (!s.enabled) return ''
  if (!webgpuOk) return ' SSGI(off)'
  return ` SSGI(${s.preset})`
}