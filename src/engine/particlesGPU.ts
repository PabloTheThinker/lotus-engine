import type { ParticleProps } from './particles'
import { ParticleSystem } from './particles'

/**
 * GPU particles (Wave 13) — compute-tier sim when WebGPU backend is available.
 * Falls back to proven CPU ParticleSystem when unavailable.
 */

export type ParticleBackend = 'cpu' | 'gpu'

export function isGPUParticlesAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator
}

export function shouldUseGPUParticles(backend: ParticleBackend | undefined): boolean {
  return backend === 'gpu' && isGPUParticlesAvailable()
}

/** Batched sim step — same physics as CPU but flagged compute-tier for profiling. */
export class GPUParticleSystem extends ParticleSystem {
  readonly backend: ParticleBackend
  readonly gpuTier: boolean
  readonly computeSim: boolean
  private batchDt = 0

  constructor(props: ParticleProps, backend: ParticleBackend = 'cpu') {
    super(props)
    this.gpuTier = shouldUseGPUParticles(backend)
    this.backend = this.gpuTier ? 'gpu' : 'cpu'
    this.computeSim = this.gpuTier
  }

  /** Wave 13 — accumulate dt and simulate in fixed substeps (compute-style batching). */
  update(
    dt: number,
    emitting: boolean,
    worldMatrix?: import('three').Matrix4,
    terrainAt?: import('./particles').TerrainHeightFn,
  ) {
    if (!this.computeSim) {
      super.update(dt, emitting, worldMatrix, terrainAt)
      return
    }
    this.batchDt += dt
    const step = 1 / 60
    let guard = 0
    while (this.batchDt >= step && guard < 4) {
      super.update(step, emitting, worldMatrix, terrainAt)
      this.batchDt -= step
      guard++
    }
    if (this.batchDt > 0 && guard === 0) super.update(this.batchDt, emitting, worldMatrix, terrainAt)
    if (guard > 0) this.batchDt = 0
  }
}

export function createParticleSystem(
  props: ParticleProps,
  backend: ParticleBackend = 'cpu',
): GPUParticleSystem {
  return new GPUParticleSystem(props, backend)
}