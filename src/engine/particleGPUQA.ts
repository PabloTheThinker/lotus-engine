/** Wave 18 — particle GPU tier QA matrix for editor + export probes. */

import { isGPUParticlesAvailable } from './particlesGPU'
import { isParticleComputeReady, isParticleGpuEmitReady, isParticleGpuKernelReady } from './particlesCompute'

export interface ParticleGPUQACheck {
  id: string
  label: string
  pass: boolean
  detail: string
}

export interface ParticleGPUQAResult {
  ok: boolean
  checks: ParticleGPUQACheck[]
  tierNote: string
}

/** Synchronous probe — safe in Playwright page.evaluate. */
export function runParticleGPUQAMatrix(): ParticleGPUQAResult {
  const checks: ParticleGPUQACheck[] = []
  const hasGpu = isGPUParticlesAvailable()
  checks.push({
    id: 'navigator.gpu',
    label: 'WebGPU API',
    pass: hasGpu,
    detail: hasGpu ? 'navigator.gpu present' : 'No WebGPU — CPU particle fallback',
  })
  checks.push({
    id: 'compute.ready',
    label: 'TSL compute probe',
    pass: isParticleComputeReady(),
    detail: isParticleComputeReady() ? 'ComputeNode path initialized' : 'Compute not initialized (bind renderer first)',
  })
  checks.push({
    id: 'kernel.integrate',
    label: 'GPU integrate kernel',
    pass: isParticleGpuKernelReady(),
    detail: isParticleGpuKernelReady() ? 'alive + life/color/size buffers bound' : 'Integrate kernel not bound',
  })
  checks.push({
    id: 'kernel.emit',
    label: 'GPU emit kernel',
    pass: isParticleGpuEmitReady(),
    detail: isParticleGpuEmitReady() ? 'Probabilistic emit ready' : 'Emit kernel not bound',
  })
  const ok = hasGpu
  return {
    ok,
    checks,
    tierNote: ok
      ? 'GPU particle tier eligible when particleBackend=gpu and WebGPURenderer active'
      : 'CPU particle tier only',
  }
}