/**
 * TSL / WebGPU post stack (Wave 10 stub).
 * Full RenderPipeline migration lands in Wave 11; this module gates the tier.
 */

export type TSLPostTier = 'inactive' | 'ready' | 'active'

export interface TSLPostState {
  tier: TSLPostTier
  note: string
}

/** Describe WebGPU-tier post status without forcing a renderer hot-swap mid-session. */
export function getTSLPostState(webgpuTier: boolean, webgpuOk: boolean): TSLPostState {
  if (!webgpuTier) {
    return { tier: 'inactive', note: 'WebGL + EffectComposer' }
  }
  if (!webgpuOk) {
    return { tier: 'inactive', note: 'WebGPU unavailable — using WebGL fallback' }
  }
  return {
    tier: 'ready',
    note: 'WebGPU tier: SSAO/FXAA enhanced on WebGL; full RenderPipeline in Wave 11',
  }
}