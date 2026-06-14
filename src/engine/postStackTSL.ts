/**
 * TSL / WebGPU post stack (Wave 11–16).
 * Wave 16: full tier includes SSGI + SSR on TSL RenderPipeline.
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
  ssgiOn = false,
  ssrOn = false,
): TSLPostState {
  if (!webgpuTier) {
    return { tier: 'inactive', note: 'WebGL + EffectComposer' }
  }
  if (!webgpuOk) {
    return { tier: 'inactive', note: 'WebGPU unavailable — using WebGL fallback' }
  }
  if (pipelineActive && fullStack) {
    let note = 'TSL RenderPipeline GTAO + bloom + FXAA'
    if (ssgiOn) note += ' + SSGI'
    if (ssrOn) note += ' + SSR'
    return { tier: 'full', note }
  }
  if (pipelineActive) {
    return { tier: 'pipeline', note: 'TSL RenderPipeline bloom on WebGPURenderer' }
  }
  return {
    tier: 'active',
    note: 'WebGPU tier: WebGL composer aux + optional TSL pipeline',
  }
}