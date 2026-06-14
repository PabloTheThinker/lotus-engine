/**
 * Wave 14–18 — TSL ComputeNode particle sim (WebGPU path).
 * Wave 16: StorageBufferAttribute kernel writes position/velocity buffers on GPU.
 * Wave 17: alive-mask integrate + probabilistic GPU emit kernel.
 * Wave 18: life/color/size buffers on GPU (reduced CPU super.update sync).
 */

export interface ParticleComputeState {
  ready: boolean
  note: string
  gpuKernel?: boolean
}

let computeReady = false
let computeNote = 'not initialized'
let gpuKernelReady = false
let gpuEmitReady = false

interface UniformSlot {
  value: number
}

interface IntegrateKernel {
  computeNode: unknown
  dtU: UniformSlot
  gravityU: UniformSlot
  dragU: UniformSlot
  windXU: UniformSlot
  windYU: UniformSlot
  windZU: UniformSlot
  rotationSpeedU: UniformSlot
  windOffU: UniformSlot
  rotationOffU: UniformSlot
  collisionRadiusU: UniformSlot
  collisionBounceU: UniformSlot
  collisionOffU: UniformSlot
  groundYOffU: UniformSlot
  groundYU: UniformSlot
  groundBounceU: UniformSlot
  sizeStartU: UniformSlot
  sizeEndU: UniformSlot
  opacityEndU: UniformSlot
  colorStartRU: UniformSlot
  colorStartGU: UniformSlot
  colorStartBU: UniformSlot
  colorEndRU: UniformSlot
  colorEndGU: UniformSlot
  colorEndBU: UniformSlot
  subEmitterOnU: UniformSlot
  subEmitterCountU: UniformSlot
  subEmitterSpeedU: UniformSlot
  subEmitterLifeU: UniformSlot
  subEmitterRateU: UniformSlot
}

interface EmitKernel {
  computeNode: unknown
  spawnProbU: UniformSlot
  speedU: UniformSlot
  seedU: UniformSlot
  defaultLifeU: UniformSlot
}

/** Wave 31 — radial burst spawn at death origin into dead GPU slots. */
interface SubBurstKernel {
  computeNode: unknown
  originXU: UniformSlot
  originYU: UniformSlot
  originZU: UniformSlot
  spawnProbU: UniformSlot
  speedU: UniformSlot
  lifeU: UniformSlot
  seedU: UniformSlot
  deathCountU: UniformSlot
}

const MAX_BATCH_DEATHS = 8
let deathOriginsBuf = new Float32Array(MAX_BATCH_DEATHS * 3)

interface TrailKernel {
  computeNode: unknown
  trailLen: number
}

let kernel: IntegrateKernel | null = null
let emitKernel: EmitKernel | null = null
let subBurstKernel: SubBurstKernel | null = null
let trailKernel: TrailKernel | null = null
let kernelCap = 0

/** Probe + mark compute path available when WebGPU renderer is active. */
export async function initParticleCompute(renderer: unknown): Promise<ParticleComputeState> {
  computeReady = false
  gpuKernelReady = false
  gpuEmitReady = false
  kernel = null
  emitKernel = null
  subBurstKernel = null
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
      instanceIndex: ScalarEl
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

/** Wave 18 — bind integrate + emit kernels to sim buffer arrays. */
export async function bindParticleIntegrateKernel(
  renderer: unknown,
  positions: Float32Array,
  velocities: Float32Array,
  aliveF: Float32Array,
  life: Float32Array,
  maxLife: Float32Array,
  colors: Float32Array,
  sizes: Float32Array,
  cap: number,
): Promise<boolean> {
  const r = renderer as { compute?: (n: unknown) => void }
  if (!r?.compute || !computeReady) return false
  if (kernel && emitKernel && subBurstKernel && kernelCap === cap) {
    gpuKernelReady = true
    gpuEmitReady = true
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
      instanceIndex: ScalarEl
      mod: (a: unknown, b: unknown) => ScalarEl
      uniform: (n: ScalarEl) => ScalarEl & UniformSlot
      If: (cond: unknown, fn: () => void) => void
      sin: (v: unknown) => ScalarEl
      cos: (v: unknown) => ScalarEl
      sqrt: (v: unknown) => ScalarEl
      fract: (v: unknown) => ScalarEl
      mix: (a: unknown, b: unknown, f: ScalarEl) => ScalarEl
    }

    const posAttr = new StorageBufferAttribute(positions, 3)
    const velAttr = new StorageBufferAttribute(velocities, 3)
    const aliveAttr = new StorageBufferAttribute(aliveF, 1)
    const lifeAttr = new StorageBufferAttribute(life, 1)
    const maxLifeAttr = new StorageBufferAttribute(maxLife, 1)
    const colorAttr = new StorageBufferAttribute(colors, 4)
    const sizeAttr = new StorageBufferAttribute(sizes, 1)
    const posBuf = t.storage(posAttr, 'vec3', cap)
    const velBuf = t.storage(velAttr, 'vec3', cap)
    const aliveBuf = t.storage(aliveAttr, 'float', cap)
    const lifeBuf = t.storage(lifeAttr, 'float', cap)
    const maxLifeBuf = t.storage(maxLifeAttr, 'float', cap)
    const colorBuf = t.storage(colorAttr, 'vec4', cap)
    const sizeBuf = t.storage(sizeAttr, 'float', cap)
    const dtU = t.uniform(t.float(0))
    const gravityU = t.uniform(t.float(0))
    const dragU = t.uniform(t.float(0))
    const windXU = t.uniform(t.float(0))
    const windYU = t.uniform(t.float(0))
    const windZU = t.uniform(t.float(0))
    const rotationSpeedU = t.uniform(t.float(0))
    const windOffU = t.uniform(t.float(0))
    const rotationOffU = t.uniform(t.float(0))
    const collisionRadiusU = t.uniform(t.float(0))
    const collisionBounceU = t.uniform(t.float(0.55))
    const collisionOffU = t.uniform(t.float(0))
    const groundYOffU = t.uniform(t.float(1))
    const groundYU = t.uniform(t.float(-9999))
    const groundBounceU = t.uniform(t.float(0.45))
    const degToRad = t.float(Math.PI / 180)
    const eps = t.float(1e-5)
    const sizeStartU = t.uniform(t.float(0.2))
    const sizeEndU = t.uniform(t.float(0.04))
    const opacityEndU = t.uniform(t.float(0))
    const colorStartRU = t.uniform(t.float(1))
    const colorStartGU = t.uniform(t.float(0.7))
    const colorStartBU = t.uniform(t.float(0.28))
    const colorEndRU = t.uniform(t.float(0.9))
    const colorEndGU = t.uniform(t.float(0.28))
    const colorEndBU = t.uniform(t.float(0.3))
    const subEmitterOnU = t.uniform(t.float(0))
    const subEmitterCountU = t.uniform(t.float(8))
    const subEmitterSpeedU = t.uniform(t.float(1.5))
    const subEmitterLifeU = t.uniform(t.float(0.4))
    const subEmitterRateU = t.uniform(t.float(1))

    const computeNode = t.Fn(() => {
      const alive = aliveBuf.element(t.instanceIndex)
      t.If(alive.greaterThan(0.5), () => {
        const p = posBuf.element(t.instanceIndex)
        const v = velBuf.element(t.instanceIndex)
        const drag = t.float(1).sub(dragU.mul(dtU) as ScalarEl)
        v.y.addAssign(gravityU)
        t.If(windOffU.lessThan(0.5), () => {
          v.x.addAssign(windXU.mul(dtU))
          v.y.addAssign(windYU.mul(dtU))
          v.z.addAssign(windZU.mul(dtU))
        })
        t.If(rotationOffU.lessThan(0.5), () => {
          const rad = rotationSpeedU.mul(degToRad).mul(dtU)
          const vx = v.x
          const vz = v.z
          const c = t.cos(rad)
          const s = t.sin(rad)
          v.x.assign(vx.mul(c).sub(vz.mul(s)))
          v.z.assign(vx.mul(s).add(vz.mul(c)))
        })
        v.x.mulAssign(drag)
        v.y.mulAssign(drag)
        v.z.mulAssign(drag)
        p.x.addAssign(v.x.mul(dtU))
        p.y.addAssign(v.y.mul(dtU))
        p.z.addAssign(v.z.mul(dtU))
        t.If(collisionOffU.lessThan(0.5), () => {
          t.If(collisionRadiusU.greaterThan(eps), () => {
            const dist = t.sqrt(p.x.mul(p.x).add(p.y.mul(p.y)).add(p.z.mul(p.z)) as ScalarEl)
            t.If(dist.greaterThan(eps), () => {
              t.If(dist.lessThan(collisionRadiusU), () => {
              const nx = p.x.div(dist)
              const ny = p.y.div(dist)
              const nz = p.z.div(dist)
              p.x.assign(nx.mul(collisionRadiusU))
              p.y.assign(ny.mul(collisionRadiusU))
              p.z.assign(nz.mul(collisionRadiusU))
              const dot = v.x.mul(nx).add(v.y.mul(ny)).add(v.z.mul(nz))
              t.If(dot.lessThan(t.float(0)), () => {
                const k = t.float(1).add(collisionBounceU).mul(dot)
                v.x.subAssign(k.mul(nx))
                v.y.subAssign(k.mul(ny))
                v.z.subAssign(k.mul(nz))
              })
              })
            })
          })
        })
        t.If(groundYOffU.lessThan(0.5), () => {
          t.If(p.y.lessThan(groundYU), () => {
            p.y.assign(groundYU)
            t.If(v.y.lessThan(t.float(0)), () => {
              v.y.assign(v.y.mul(t.float(-1)).mul(groundBounceU))
            })
            t.If(v.y.greaterThan(eps), () => {
              v.y.assign(v.y.mul(groundBounceU))
            })
          })
        })
        const lifeSlot = lifeBuf.element(t.instanceIndex)
        lifeSlot.subAssign(dtU)
        t.If(lifeSlot.lessThanEqual(t.float(0)), () => {
          alive.assign(0)
          lifeSlot.assign(0)
          sizeBuf.element(t.instanceIndex).assign(0)
        })
        t.If(lifeSlot.greaterThan(0), () => {
          const maxL = maxLifeBuf.element(t.instanceIndex)
          const tNorm = t.float(1).sub(lifeSlot.div(maxL) as ScalarEl)
          const alpha = t.float(1).sub(tNorm.mul(opacityEndU) as ScalarEl)
          const col = colorBuf.element(t.instanceIndex)
          col.x.assign(t.mix(colorStartRU, colorEndRU, tNorm))
          col.y.assign(t.mix(colorStartGU, colorEndGU, tNorm))
          col.z.assign(t.mix(colorStartBU, colorEndBU, tNorm))
          col.w.assign(alpha)
          sizeBuf.element(t.instanceIndex).assign(t.mix(sizeStartU, sizeEndU, tNorm))
        })
      })
    }).compute(cap)

    const spawnProbU = t.uniform(t.float(0))
    const speedU = t.uniform(t.float(1))
    const seedU = t.uniform(t.float(0))
    const defaultLifeU = t.uniform(t.float(1.6))
    const emitNode = t.Fn(() => {
      const alive = aliveBuf.element(t.instanceIndex)
      t.If(alive.lessThan(0.5), () => {
        const h = t.fract(t.sin(t.instanceIndex.add(seedU)).mul(43758.5453) as ScalarEl)
        t.If(h.lessThan(spawnProbU), () => {
          alive.assign(1)
          const lifeSlot = lifeBuf.element(t.instanceIndex)
          const maxL = maxLifeBuf.element(t.instanceIndex)
          lifeSlot.assign(defaultLifeU)
          maxL.assign(defaultLifeU)
          const p = posBuf.element(t.instanceIndex)
          const v = velBuf.element(t.instanceIndex)
          const a = h.mul(6.283)
          const sp = speedU.mul(t.float(0.5).add(h.mul(0.5)))
          p.x.assign(t.sin(a).mul(0.05))
          p.y.assign(0)
          p.z.assign(t.cos(a).mul(0.05))
          v.x.assign(t.sin(a).mul(sp))
          v.y.assign(sp.mul(0.6))
          v.z.assign(t.cos(a).mul(sp))
          const col = colorBuf.element(t.instanceIndex)
          col.x.assign(colorStartRU)
          col.y.assign(colorStartGU)
          col.z.assign(colorStartBU)
          col.w.assign(1)
          sizeBuf.element(t.instanceIndex).assign(sizeStartU)
        })
      })
    }).compute(cap)

    kernel = {
      computeNode,
      dtU,
      gravityU,
      dragU,
      windXU,
      windYU,
      windZU,
      rotationSpeedU,
      windOffU,
      rotationOffU,
      collisionRadiusU,
      collisionBounceU,
      collisionOffU,
      groundYOffU,
      groundYU,
      groundBounceU,
      sizeStartU,
      sizeEndU,
      opacityEndU,
      colorStartRU,
      colorStartGU,
      colorStartBU,
      colorEndRU,
      colorEndGU,
      colorEndBU,
      subEmitterOnU,
      subEmitterCountU,
      subEmitterSpeedU,
      subEmitterLifeU,
      subEmitterRateU,
    }
    emitKernel = { computeNode: emitNode, spawnProbU, speedU, seedU, defaultLifeU }

    const originXU = t.uniform(t.float(0))
    const originYU = t.uniform(t.float(0))
    const originZU = t.uniform(t.float(0))
    const burstProbU = t.uniform(t.float(0))
    const burstSpeedU = t.uniform(t.float(1))
    const burstLifeU = t.uniform(t.float(0.4))
    const burstSeedU = t.uniform(t.float(0))
    const deathCountU = t.uniform(t.float(1))
    const deathOrigAttr = new StorageBufferAttribute(deathOriginsBuf, 3)
    const deathOrigBuf = t.storage(deathOrigAttr, 'vec3', MAX_BATCH_DEATHS)
    const subBurstNode = t.Fn(() => {
      const alive = aliveBuf.element(t.instanceIndex)
      t.If(alive.lessThan(0.5), () => {
        const h = t.fract(t.sin(t.instanceIndex.add(burstSeedU)).mul(43758.5453) as ScalarEl)
        t.If(h.lessThan(burstProbU), () => {
          alive.assign(1)
          const lifeSlot = lifeBuf.element(t.instanceIndex)
          const maxL = maxLifeBuf.element(t.instanceIndex)
          lifeSlot.assign(burstLifeU)
          maxL.assign(burstLifeU)
          const p = posBuf.element(t.instanceIndex)
          const v = velBuf.element(t.instanceIndex)
          const di = t.mod(t.instanceIndex, deathCountU)
          const orig = deathOrigBuf.element(di)
          p.x.assign(orig.x)
          p.y.assign(orig.y)
          p.z.assign(orig.z)
          const a = h.mul(6.283)
          const sp = burstSpeedU.mul(t.float(0.6).add(h.mul(0.4)))
          v.x.assign(t.sin(a).mul(sp))
          v.y.assign(sp.mul(0.5))
          v.z.assign(t.cos(a).mul(sp))
          const col = colorBuf.element(t.instanceIndex)
          col.x.assign(colorStartRU)
          col.y.assign(colorStartGU)
          col.z.assign(colorStartBU)
          col.w.assign(1)
          sizeBuf.element(t.instanceIndex).assign(sizeStartU)
        })
      })
    }).compute(cap)

    subBurstKernel = {
      computeNode: subBurstNode,
      originXU,
      originYU,
      originZU,
      spawnProbU: burstProbU,
      speedU: burstSpeedU,
      lifeU: burstLifeU,
      seedU: burstSeedU,
      deathCountU,
    }
    kernelCap = cap
    gpuKernelReady = true
    gpuEmitReady = true
    return true
  } catch {
    gpuKernelReady = false
    gpuEmitReady = false
    kernel = null
    emitKernel = null
    subBurstKernel = null
    return false
  }
}

interface ScalarEl {
  mul: (v: unknown) => ScalarEl
  sub: (v: unknown) => ScalarEl
  add: (v: unknown) => ScalarEl
  addAssign: (v: unknown) => void
  div: (v: unknown) => ScalarEl
  mod: (v: unknown) => ScalarEl
  subAssign: (v: unknown) => void
  mulAssign: (v: unknown) => void
  assign: (v: unknown) => void
  greaterThan: (v: unknown) => unknown
  lessThan: (v: unknown) => unknown
  lessThanEqual: (v: unknown) => unknown
}

interface VecEl {
  x: ScalarEl
  y: ScalarEl
  z: ScalarEl
  addAssign: (v: unknown) => void
  mulAssign: (v: unknown) => void
  assign: (v: unknown) => void
}

interface ColorEl {
  x: ScalarEl
  y: ScalarEl
  z: ScalarEl
  w: ScalarEl
}

interface StorageEl {
  element: (i: unknown) => VecEl & ScalarEl & ColorEl
}

/** Wave 17 — probabilistic GPU emit for dead slots (rate * dt / cap). */
export function runParticleGPUEmit(
  renderer: unknown,
  spawnProb: number,
  speed: number,
  seed: number,
  defaultLife = 1.6,
): boolean {
  if (!gpuEmitReady || !emitKernel) return false
  const r = renderer as { compute?: (n: unknown) => void }
  if (!r?.compute) return false
  try {
    emitKernel.spawnProbU.value = Math.max(0, Math.min(1, spawnProb))
    emitKernel.speedU.value = speed
    emitKernel.seedU.value = seed
    emitKernel.defaultLifeU.value = defaultLife
    r.compute(emitKernel.computeNode)
    return true
  } catch {
    return false
  }
}

/** Dispatch GPU integrate kernel (writes positions/velocities storage buffers). */
export interface ParticleGPUStyle {
  sizeStart: number
  sizeEnd: number
  opacityEnd: number
  colorStart: [number, number, number]
  colorEnd: [number, number, number]
}

export interface ParticleGPUModules {
  windX?: number
  windY?: number
  windZ?: number
  rotationSpeed?: number
  windOff?: boolean
  rotationOff?: boolean
  collisionRadius?: number
  collisionBounce?: number
  collisionOff?: boolean
  groundBounce?: boolean
  groundY?: number
  bounceFactor?: number
  subEmitterOn?: boolean
  subEmitterCount?: number
  subEmitterSpeed?: number
  subEmitterLife?: number
  subEmitterRate?: number
}

export function runParticleGPUIntegrate(
  renderer: unknown,
  dt: number,
  gravity: number,
  drag: number,
  style?: ParticleGPUStyle,
  modules?: ParticleGPUModules,
): boolean {
  if (!gpuKernelReady || !kernel) return false
  const r = renderer as { compute?: (n: unknown) => void }
  if (!r?.compute) return false
  try {
    kernel.dtU.value = dt
    kernel.gravityU.value = gravity * dt
    kernel.dragU.value = drag
    kernel.windXU.value = modules?.windX ?? 0
    kernel.windYU.value = modules?.windY ?? 0
    kernel.windZU.value = modules?.windZ ?? 0
    kernel.rotationSpeedU.value = modules?.rotationSpeed ?? 0
    kernel.windOffU.value = modules?.windOff ? 1 : 0
    kernel.rotationOffU.value = modules?.rotationOff ? 1 : 0
    kernel.collisionRadiusU.value = modules?.collisionRadius ?? 0
    kernel.collisionBounceU.value = modules?.collisionBounce ?? 0.55
    kernel.collisionOffU.value = modules?.collisionOff ? 1 : 0
    kernel.groundYOffU.value = modules?.groundBounce ? 0 : 1
    kernel.groundYU.value = modules?.groundY ?? -9999
    kernel.groundBounceU.value = modules?.bounceFactor ?? 0.45
    kernel.subEmitterOnU.value = modules?.subEmitterOn ? 1 : 0
    kernel.subEmitterCountU.value = modules?.subEmitterCount ?? 8
    kernel.subEmitterSpeedU.value = modules?.subEmitterSpeed ?? 1.5
    kernel.subEmitterLifeU.value = modules?.subEmitterLife ?? 0.4
    kernel.subEmitterRateU.value = modules?.subEmitterRate ?? 1
    if (style) {
      kernel.sizeStartU.value = style.sizeStart
      kernel.sizeEndU.value = style.sizeEnd
      kernel.opacityEndU.value = style.opacityEnd
      kernel.colorStartRU.value = style.colorStart[0]
      kernel.colorStartGU.value = style.colorStart[1]
      kernel.colorStartBU.value = style.colorStart[2]
      kernel.colorEndRU.value = style.colorEnd[0]
      kernel.colorEndGU.value = style.colorEnd[1]
      kernel.colorEndBU.value = style.colorEnd[2]
    }
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

export function isParticleGpuEmitReady(): boolean {
  return gpuEmitReady
}

export function isParticleGpuSubBurstReady(): boolean {
  return !!subBurstKernel
}

/** Wave 31 — spawn sub-emitter burst at world origin into dead GPU slots. */
function dispatchSubBurstKernel(
  renderer: unknown,
  modules: ParticleGPUModules | undefined,
  seed: number,
  cap: number,
  deathCount: number,
): boolean {
  if (!subBurstKernel) return false
  const r = renderer as { compute?: (n: unknown) => void }
  if (!r?.compute) return false
  try {
    const count = Math.max(1, modules?.subEmitterCount ?? 8)
    const rate = Math.max(0, Math.min(1, modules?.subEmitterRate ?? 1))
    subBurstKernel.spawnProbU.value = Math.min(1, (count / Math.max(1, cap)) * rate * Math.max(1, deathCount))
    subBurstKernel.speedU.value = modules?.subEmitterSpeed ?? 1.5
    subBurstKernel.lifeU.value = modules?.subEmitterLife ?? 0.4
    subBurstKernel.seedU.value = seed
    subBurstKernel.deathCountU.value = Math.max(1, deathCount)
    r.compute(subBurstKernel.computeNode)
    return true
  } catch {
    return false
  }
}

export function runParticleGPUSubEmitterBurst(
  renderer: unknown,
  ox: number,
  oy: number,
  oz: number,
  modules?: ParticleGPUModules,
  seed = 0,
  cap = 64,
): boolean {
  deathOriginsBuf[0] = ox
  deathOriginsBuf[1] = oy
  deathOriginsBuf[2] = oz
  return dispatchSubBurstKernel(renderer, modules, seed, cap, 1)
}

/** Wave 32 — batched multi-death sub-burst in a single kernel dispatch. */
export function runParticleGPUSubEmitterBurstBatch(
  renderer: unknown,
  origins: { x: number; y: number; z: number }[],
  modules?: ParticleGPUModules,
  seed = 0,
  cap = 64,
): boolean {
  if (!origins.length) return false
  const n = Math.min(origins.length, MAX_BATCH_DEATHS)
  for (let i = 0; i < n; i++) {
    deathOriginsBuf[i * 3] = origins[i]!.x
    deathOriginsBuf[i * 3 + 1] = origins[i]!.y
    deathOriginsBuf[i * 3 + 2] = origins[i]!.z
  }
  return dispatchSubBurstKernel(renderer, modules, seed, cap, n)
}

export function isParticleGpuTrailReady(): boolean {
  return !!trailKernel
}

/** Wave 21 — GPU ribbon trail shift kernel (per-particle history buffer). */
export async function bindParticleTrailKernel(
  renderer: unknown,
  trail: Float32Array,
  positions: Float32Array,
  aliveF: Float32Array,
  cap: number,
  trailLen: number,
): Promise<boolean> {
  const r = renderer as { compute?: (n: unknown) => void }
  if (!r?.compute || !computeReady || trailLen < 2) return false
  if (trailKernel && trailKernel.trailLen === trailLen && kernelCap === cap) return true
  try {
    const webgpu = await import('three/webgpu')
    const tsl = await import('three/tsl')
    const StorageBufferAttribute = (webgpu as {
      StorageBufferAttribute: new (a: Float32Array, s: number) => object
    }).StorageBufferAttribute
    const t = tsl as unknown as {
      Fn: (fn: () => void) => { compute: (n: number) => unknown }
      float: (n: number) => ScalarEl
      instanceIndex: ScalarEl
      storage: (a: object, ty: string, c: number) => StorageEl
      If: (cond: unknown, fn: () => void) => void
    }
    const slots = cap * trailLen
    const trailAttr = new StorageBufferAttribute(trail, 3)
    const posAttr = new StorageBufferAttribute(positions, 3)
    const aliveAttr = new StorageBufferAttribute(aliveF, 1)
    const trailBuf = t.storage(trailAttr, 'vec3', slots)
    const posBuf = t.storage(posAttr, 'vec3', cap)
    const aliveBuf = t.storage(aliveAttr, 'float', cap)
    const lenF = t.float(trailLen)

    const computeNode = t.Fn(() => {
      const alive = aliveBuf.element(t.instanceIndex)
      t.If(alive.greaterThan(0.5), () => {
        const base = t.instanceIndex.mul(lenF)
        const p = posBuf.element(t.instanceIndex)
        for (let s = trailLen - 1; s >= 1; s--) {
          const dst = trailBuf.element(base.add(t.float(s)))
          const src = trailBuf.element(base.add(t.float(s - 1)))
          dst.assign(src)
        }
        trailBuf.element(base).assign(p)
      })
    }).compute(cap)

    trailKernel = { computeNode, trailLen }
    return true
  } catch {
    trailKernel = null
    return false
  }
}

export function runParticleGPUTrailShift(renderer: unknown): boolean {
  if (!trailKernel) return false
  const r = renderer as { compute?: (n: unknown) => void }
  if (!r?.compute) return false
  try {
    r.compute(trailKernel.computeNode)
    return true
  } catch {
    return false
  }
}

export function particleComputeNote(): string {
  if (gpuKernelReady && gpuEmitReady) return `${computeNote} + GPU integrate + emit`
  if (gpuKernelReady) return `${computeNote} + GPU integrate kernel`
  return computeNote
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