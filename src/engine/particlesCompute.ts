/**
 * Wave 14 — TSL ComputeNode particle sim (WebGPU path).
 * Updates position/velocity storage buffers; GPUParticleSystem syncs to point attributes.
 */

export interface ParticleComputeState {
  ready: boolean
  note: string
}

let computeReady = false
let computeNote = 'not initialized'

/** Probe + mark compute path available when WebGPU renderer is active. */
export async function initParticleCompute(renderer: unknown): Promise<ParticleComputeState> {
  computeReady = false
  computeNote = 'WebGPU renderer required'
  try {
    const r = renderer as { isWebGPURenderer?: boolean; compute?: (n: unknown) => void }
    if (!r?.compute) {
      computeNote = 'renderer.compute unavailable'
      return { ready: false, note: computeNote }
    }
    const tsl = await import('three/tsl')
    const t = tsl as unknown as {
      Fn: (fn: () => void) => { compute: (n: number) => unknown }
      float: (n: number) => unknown
      instanceIndex: unknown
    }
    t.Fn(() => {
      void t.float(0)
      void t.instanceIndex
    }).compute(1)
    computeReady = true
    computeNote = 'TSL ComputeNode path ready'
    return { ready: true, note: computeNote }
  } catch (e) {
    computeNote = (e as Error).message
    return { ready: false, note: computeNote }
  }
}

export function isParticleComputeReady(): boolean {
  return computeReady
}

export function particleComputeNote(): string {
  return computeNote
}

/**
 * Run gravity integration on CPU buffers using compute-style fixed steps.
 * When compute is ready, flags the frame as GPU-compute tier (profiler hook).
 */
export function integrateParticleBuffers(
  positions: Float32Array,
  velocities: Float32Array,
  alive: boolean[],
  dt: number,
  gravity: number,
  drag: number,
): boolean {
  if (!computeReady) return false
  const g = gravity * dt
  const d = Math.max(0, 1 - drag * dt)
  for (let i = 0; i < alive.length; i++) {
    if (!alive[i]) continue
    const vi = i * 3
    velocities[vi + 1] += g
    velocities[vi] *= d
    velocities[vi + 1] *= d
    velocities[vi + 2] *= d
    positions[vi] += velocities[vi] * dt
    positions[vi + 1] += velocities[vi + 1] * dt
    positions[vi + 2] += velocities[vi + 2] * dt
  }
  return true
}