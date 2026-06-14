/**
 * TSL / WebGPU post stack (Wave 11–14).
 * Wave 14: RenderPipeline bloom on WebGPURenderer canvas when pipeline active.
 */

export type TSLPostTier = 'inactive' | 'ready' | 'active' | 'pipeline' | 'full'

export interface TSLPostState {
  tier: TSLPostTier
  note: string
}

/** Describe WebGPU-tier post status. */
export function getTSLPostState(
  webgpuTier: boolean,
  webgpuOk: boolean,
  pipelineActive = false,
  fullStack = false,
): TSLPostState {
  if (!webgpuTier) {
    return { tier: 'inactive', note: 'WebGL + EffectComposer' }
  }
  if (!webgpuOk) {
    return { tier: 'inactive', note: 'WebGPU unavailable — using WebGL fallback' }
  }
  if (pipelineActive && fullStack) {
    return { tier: 'full', note: 'TSL RenderPipeline GTAO + bloom + FXAA' }
  }
  if (pipelineActive) {
    return { tier: 'pipeline', note: 'TSL RenderPipeline bloom on WebGPURenderer' }
  }
  return {
    tier: 'active',
    note: 'WebGPU tier: WebGL composer aux + optional TSL pipeline',
  }
}