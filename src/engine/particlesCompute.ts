/**
 * Wave 14–16 — TSL ComputeNode particle sim (WebGPU path).
 * Wave 16: StorageBufferAttribute kernel writes position/velocity buffers on GPU.
 */

export interface ParticleComputeState {
  ready: boolean
  note: string
  gpuKernel?: boolean
}

let computeReady = false
let computeNote = 'not initialized'
let gpuKernelReady = false

interface UniformSlot {
  value: number
}

interface IntegrateKernel {
  computeNode: unknown
  dtU: UniformSlot
  gravityU: UniformSlot
  dragU: UniformSlot
}

let kernel: IntegrateKernel | null = null
let kernelCap = 0

/** Probe + mark compute path available when WebGPU renderer is active. */
export async function initParticleCompute(renderer: unknown): Promise<ParticleComputeState> {
  computeReady = false
  gpuKernelReady = false
  kernel = null
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

/** Wave 16 — bind integrate kernel to sim buffer arrays (same backing store as Points attrs). */
export async function bindParticleIntegrateKernel(
  renderer: unknown,
  positions: Float32Array,
  velocities: Float32Array,
  cap: number,
): Promise<boolean> {
  const r = renderer as { compute?: (n: unknown) => void }
  if (!r?.compute || !computeReady) return false
  if (kernel && kernelCap === cap) {
    gpuKernelReady = true
    return true
  }
  try {
    const webgpu = await import('three/webgpu')
    const tsl = await import('three/tsl')
    const StorageBufferAttribute = (webgpu as {
      StorageBufferAttribute: new (a: Float32Array, s: number) => object
    }).StorageBufferAttribute
    const t = tsl as unknown as {
      storage: (a: object, ty: string, c: number) => StorageEl
      Fn: (fn: () => void) => { compute: (n: number) => unknown }
      float: (n: number) => ScalarEl
      instanceIndex: unknown
      uniform: (n: ScalarEl) => ScalarEl & UniformSlot
    }

    const posAttr = new StorageBufferAttribute(positions, 3)
    const velAttr = new StorageBufferAttribute(velocities, 3)
    const posBuf = t.storage(posAttr, 'vec3', cap)
    const velBuf = t.storage(velAttr, 'vec3', cap)
    const dtU = t.uniform(t.float(0))
    const gravityU = t.uniform(t.float(0))
    const dragU = t.uniform(t.float(0))

    const computeNode = t.Fn(() => {
      const p = posBuf.element(t.instanceIndex)
      const v = velBuf.element(t.instanceIndex)
      const drag = t.float(1).sub(dragU.mul(dtU) as ScalarEl)
      v.y.addAssign(gravityU)
      v.x.mulAssign(drag)
      v.y.mulAssign(drag)
      v.z.mulAssign(drag)
      p.x.addAssign(v.x.mul(dtU))
      p.y.addAssign(v.y.mul(dtU))
      p.z.addAssign(v.z.mul(dtU))
    }).compute(cap)

    kernel = { computeNode, dtU, gravityU, dragU }
    kernelCap = cap
    gpuKernelReady = true
    return true
  } catch {
    gpuKernelReady = false
    kernel = null
    return false
  }
}

interface ScalarEl {
  mul: (v: unknown) => ScalarEl
  sub: (v: unknown) => ScalarEl
  addAssign: (v: unknown) => void
  mulAssign: (v: unknown) => void
}

interface VecEl {
  x: ScalarEl
  y: ScalarEl
  z: ScalarEl
  addAssign: (v: unknown) => void
  mulAssign: (v: unknown) => void
}

interface StorageEl {
  element: (i: unknown) => VecEl
}

/** Dispatch GPU integrate kernel (writes positions/velocities storage buffers). */
export function runParticleGPUIntegrate(
  renderer: unknown,
  dt: number,
  gravity: number,
  drag: number,
): boolean {
  if (!gpuKernelReady || !kernel) return false
  const r = renderer as { compute?: (n: unknown) => void }
  if (!r?.compute) return false
  try {
    kernel.dtU.value = dt
    kernel.gravityU.value = gravity * dt
    kernel.dragU.value = drag
    r.compute(kernel.computeNode)
    return true
  } catch {
    return false
  }
}

export function isParticleComputeReady(): boolean {
  return computeReady
}

export function isParticleGpuKernelReady(): boolean {
  return gpuKernelReady
}

export function particleComputeNote(): string {
  return gpuKernelReady ? `${computeNote} + GPU integrate kernel` : computeNote
}

/**
 * CPU fallback integration when GPU kernel unavailable.
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