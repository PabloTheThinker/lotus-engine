import type { ParticleProps } from './particles'
import { ParticleSystem } from './particles'
import { initParticleCompute, integrateParticleBuffers } from './particlesCompute'

/**
 * GPU particles (Wave 13–15) — compute-tier sim when WebGPU backend is available.
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
  /** Wave 14–15 — true when TSL ComputeNode path initialized */
  usesComputeNode = false
  /** Wave 15 — frames integrated via compute-tier buffer path */
  computeIntegratedFrames = 0
  private batchDt = 0

  constructor(props: ParticleProps, backend: ParticleBackend = 'cpu') {
    super(props)
    this.gpuTier = shouldUseGPUParticles(backend)
    this.backend = this.gpuTier ? 'gpu' : 'cpu'
    this.computeSim = this.gpuTier
  }

  /** Bind WebGPU renderer for TSL compute sim (Wave 14). */
  async bindComputeRenderer(renderer: unknown) {
    if (!this.gpuTier) return
    const st = await initParticleCompute(renderer)
    this.usesComputeNode = st.ready
  }

  /** Wave 13–15 — GPU tier: compute integration or fixed-substep CPU fallback. */
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

    if (this.usesComputeNode) {
      const p = this.props
      const offForces = p.modulesOff?.includes('forces')
      const gravity = offForces ? 0 : p.gravity
      const drag = offForces ? 0 : p.drag
      const { positions, velocities, alive } = this.simBuffers()
      if (integrateParticleBuffers(positions, velocities, alive, dt, gravity, drag)) {
        this.computeIntegratedFrames++
        super.update(dt, emitting, worldMatrix, terrainAt, { skipForces: true })
        return
      }
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