/**
 * Wave 113 (v6.04–v6.08) — Buffer visualization mode registry (UE-style debug views).
 */

export const BUFFER_VIZ_MODES = [
  'none',
  'baseColor',
  'worldNormal',
  'depth',
  'roughness',
  'metallic',
  'ao',
  'emissive',
] as const

export type BufferVizMode = (typeof BUFFER_VIZ_MODES)[number]

export function isBufferVizMode(value: string): value is BufferVizMode {
  return (BUFFER_VIZ_MODES as readonly string[]).includes(value)
}

export function normalizeBufferVizMode(value: string | undefined): BufferVizMode {
  const q = String(value ?? '').trim()
  return isBufferVizMode(q) ? q : 'none'
}