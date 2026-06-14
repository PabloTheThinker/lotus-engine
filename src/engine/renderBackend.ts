import type { EnvironmentSettings } from './types'

/** Editor / export rendering backend (Wave 10). */
export type RenderBackend = 'webgl' | 'webgpu'

export interface PostFxSettings {
  fxaa: boolean
  ssao: boolean
  dof: boolean
  /** Temporal AA — WebGPU tier only */
  taa: boolean
  /** Screen-space reflections (Wave 11) */
  ssr: boolean
}

/** Returns true when WebGPU is available in this browser. */
export async function isWebGPUAvailable(): Promise<boolean> {
  if (typeof navigator === 'undefined') return false
  const gpu = (navigator as Navigator & { gpu?: GPU }).gpu
  if (!gpu) return false
  try {
    const adapter = await gpu.requestAdapter()
    return adapter !== null
  } catch {
    return false
  }
}

export function getPostFxSettings(env: EnvironmentSettings): PostFxSettings {
  const tier = env.renderBackend ?? 'webgl'
  const webgpuTier = tier === 'webgpu'
  return {
    fxaa: env.postFxaa !== false,
    ssao: env.postSsao === true || webgpuTier,
    dof: env.postDof === true,
    taa: env.postTaa === true && webgpuTier,
    ssr: env.postSsr === true,
  }
}

/** Effective backend after capability check. */
export function getEffectiveRenderBackend(
  env: EnvironmentSettings,
  webgpuOk: boolean,
): RenderBackend {
  if (env.renderBackend === 'webgpu' && webgpuOk) return 'webgpu'
  return 'webgl'
}