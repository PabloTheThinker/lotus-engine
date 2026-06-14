/**
 * TSL / WebGPU post stack (Wave 11).
 * WebGPU tier enhances WebGL passes; full RenderPipeline migration remains opt-in.
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
    tier: 'active',
    note: 'WebGPU tier: SSR/SSAO/FXAA/TAA on WebGL stack; TSL pipeline opt-in',
  }
}