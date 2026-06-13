import type { ParticleProps } from './particles'
import { ParticleSystem } from './particles'

/**
 * GPU particles (Wave 9 opt-in) — WebGPU/TSL compute path with CPU fallback.
 * Full compute Niagara is Wave 10; this stub gates the backend and documents the tier.
 */

export type ParticleBackend = 'cpu' | 'gpu'

export function isGPUParticlesAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator
}

/** Returns true when GPU backend is requested and the runtime can attempt it. */
export function shouldUseGPUParticles(backend: ParticleBackend | undefined): boolean {
  return backend === 'gpu' && isGPUParticlesAvailable()
}

/**
 * Factory: GPU tier when available, otherwise the proven CPU ParticleSystem.
 * GPU compute sim lands in Wave 10 — today this always returns CPU with a flag.
 */
export function createParticleSystem(props: ParticleProps, backend: ParticleBackend = 'cpu'): ParticleSystem & {
  backend: ParticleBackend
  gpuTier: boolean
} {
  const gpuTier = shouldUseGPUParticles(backend)
  const sys = new ParticleSystem(props)
  const tier: ParticleBackend = gpuTier ? 'gpu' : 'cpu'
  return Object.assign(sys, { backend: tier, gpuTier })
}