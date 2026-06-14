import * as THREE from 'three'
import type { Actor } from './Actor'
import type { ParticleProps } from './particles'
import { ParticleSystem } from './particles'
import {
  bindParticleIntegrateKernel,
  bindParticleTrailKernel,
  initParticleCompute,
  integrateParticleBuffers,
  isParticleGpuEmitReady,
  isParticleGpuKernelReady,
  runParticleGPUEmit,
  runParticleGPUIntegrate,
  runParticleGPUSubEmitterBurst,
  runParticleGPUTrailShift,
} from './particlesCompute'

/**
 * GPU particles (Wave 13–17) — compute-tier sim when WebGPU backend is available.
 * Falls back to proven CPU ParticleSystem when unavailable.
 */

export type ParticleBackend = 'cpu' | 'gpu'

export function isGPUParticlesAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator
}

export function shouldUseGPUParticles(backend: ParticleBackend | undefined): boolean {
  return backend === 'gpu' && isGPUParticlesAvailable()
}

/** Bind all GPU-tier particle systems on actors to a WebGPU renderer. */
export async function bindWorldGPUParticles(actors: Iterable<Actor>, renderer: unknown): Promise<number> {
  let bound = 0
  for (const a of actors) {
    const ps = a.particleSystem
    if (ps && 'bindComputeRenderer' in ps) {
      await (ps as GPUParticleSystem).bindComputeRenderer(renderer)
      bound++
    }
  }
  return bound
}

/** Batched sim step — same physics as CPU but flagged compute-tier for profiling. */
export class GPUParticleSystem extends ParticleSystem {
  readonly backend: ParticleBackend
  readonly gpuTier: boolean
  readonly computeSim: boolean
  usesComputeNode = false
  gpuKernelActive = false
  gpuEmitActive = false
  computeIntegratedFrames = 0
  gpuEmitFrames = 0
  private batchDt = 0
  private computeRenderer: unknown = null
  private emitSeed = 0

  constructor(props: ParticleProps, backend: ParticleBackend = 'cpu') {
    super(props)
    this.gpuTier = shouldUseGPUParticles(backend)
    this.backend = this.gpuTier ? 'gpu' : 'cpu'
    this.computeSim = this.gpuTier
    if (this.gpuTier) {
      this.gpuSubBurstSpawn = (x, y, z) => {
        if (!this.computeRenderer) return false
        const se = this.props.subEmitter
        if (!se) return false
        const modules = {
          subEmitterCount: this.gpuSubEmitterUniforms.count,
          subEmitterSpeed: this.gpuSubEmitterUniforms.speed,
          subEmitterLife: this.gpuSubEmitterUniforms.life,
          subEmitterRate: this.gpuSubEmitterUniforms.rate,
        }
        return runParticleGPUSubEmitterBurst(
          this.computeRenderer,
          x,
          y,
          z,
          modules,
          this.emitSeed++,
          this.simBuffers().alive.length,
        )
      }
    }
  }

  async bindComputeRenderer(renderer: unknown) {
    if (!this.gpuTier) return
    this.computeRenderer = renderer
    const st = await initParticleCompute(renderer)
    this.usesComputeNode = st.ready
    if (!this.usesComputeNode) {
      this.gpuKernelActive = false
      this.gpuEmitActive = false
      return
    }
    this.syncAliveMask()
    const { positions, velocities, aliveF, life, maxLife, colors, sizes, alive } = this.simBuffers()
    const ok = await bindParticleIntegrateKernel(
      renderer,
      positions,
      velocities,
      aliveF,
      life,
      maxLife,
      colors,
      sizes,
      alive.length,
    )
    this.gpuKernelActive = ok
    this.gpuEmitActive = ok && isParticleGpuEmitReady()
    const buf = this.simBuffers()
    if ((this.props.renderMode ?? 'points') === 'ribbon' && buf.trail) {
      await bindParticleTrailKernel(
        renderer,
        buf.trail,
        buf.positions,
        buf.aliveF,
        buf.alive.length,
        buf.trailLen ?? this.props.ribbonSegments,
      )
    }
  }

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

    if (this.usesComputeNode && this.computeRenderer) {
      const p = this.props
      const offForces = p.modulesOff?.includes('forces')
      const offSpawn = p.modulesOff?.includes('spawn')
      const offWind = p.modulesOff?.includes('wind')
      const offRotation = p.modulesOff?.includes('rotation')
      const offCollision = p.modulesOff?.includes('collision')
      const gravity = offForces ? 0 : p.gravity
      const drag = offForces ? 0 : p.drag

      if (emitting && !offSpawn && isParticleGpuEmitReady()) {
        const prob = Math.min(1, (p.rate * dt) / Math.max(1, this.simBuffers().alive.length))
        if (
          prob > 0 &&
          runParticleGPUEmit(this.computeRenderer, prob, p.speed, this.emitSeed++, p.lifetime)
        ) {
          this.gpuEmitFrames++
          this.applyGPUAliveMask(p.lifetime)
        }
      }

      this.syncAliveMask()
      this.snapshotAliveForGPU()

      if (isParticleGpuKernelReady()) {
        const c0 = new THREE.Color(p.colorStart)
        const c1 = new THREE.Color(p.modulesOff?.includes('colorOverLife') ? p.colorStart : p.colorEnd)
        const style = {
          sizeStart: p.sizeStart,
          sizeEnd: p.sizeEnd,
          opacityEnd: p.opacityEnd,
          colorStart: [c0.r, c0.g, c0.b] as [number, number, number],
          colorEnd: [c1.r, c1.g, c1.b] as [number, number, number],
        }
        let groundYLocal = -9999
        const groundOn = p.groundBounce && !offForces && terrainAt && worldMatrix
        if (groundOn) {
          const origin = new THREE.Vector3(0, 0, 0).applyMatrix4(worldMatrix)
          const gh = terrainAt!(origin.x, origin.z)
          if (gh != null) {
            const inv = new THREE.Matrix4().copy(worldMatrix).invert()
            groundYLocal = new THREE.Vector3(origin.x, gh, origin.z).applyMatrix4(inv).y
          }
        }
        const se = p.subEmitter
        const subOn = se?.enabled && !p.modulesOff?.includes('subEmitter') && se.onDeath
        const subUniforms = {
          on: !!subOn,
          count: se?.count ?? 8,
          speed: se?.speed ?? 1.5,
          life: se?.lifetime ?? 0.4,
          rate: Math.min(1, Math.max(0, (p.rate * dt) / Math.max(1, this.simBuffers().alive.length))),
        }
        this.gpuSubEmitterUniforms = subUniforms
        const modules = {
          windX: p.windX ?? 0,
          windY: p.windY ?? 0,
          windZ: p.windZ ?? 0,
          rotationSpeed: p.rotationSpeed ?? 0,
          windOff: offWind || offForces,
          rotationOff: offRotation || offForces,
          collisionRadius: p.collisionRadius ?? 0,
          collisionBounce: p.collisionBounce ?? 0.55,
          collisionOff: offCollision || offForces,
          groundBounce: groundOn && groundYLocal > -9000,
          groundY: groundYLocal,
          bounceFactor: p.bounceFactor ?? 0.45,
          subEmitterOn: subUniforms.on,
          subEmitterCount: subUniforms.count,
          subEmitterSpeed: subUniforms.speed,
          subEmitterLife: subUniforms.life,
          subEmitterRate: subUniforms.rate,
        }
        if (runParticleGPUIntegrate(this.computeRenderer, dt, gravity, drag, style, modules)) {
          this.computeIntegratedFrames++
          this.syncGPUAliveFromBuffers()
          const prevBurst = this.gpuSubBurstFrames
          this.processGPUSubEmitterDeaths()
          if (this.gpuSubBurstFrames > prevBurst) this.syncGPUAliveFromBuffers()
          const geo = this.points.geometry
          geo.attributes.position.needsUpdate = true
          geo.attributes.aColor.needsUpdate = true
          geo.attributes.aSize.needsUpdate = true
          super.update(dt, emitting, worldMatrix, terrainAt, {
            skipForces: true,
            skipSpawn: true,
            skipLifeColor: true,
            skipGroundBounce: true,
          })
          if ((p.renderMode ?? 'points') === 'ribbon') {
            if (!runParticleGPUTrailShift(this.computeRenderer)) this.shiftAllRibbonTrails()
          }
          return
        }
      }

      const { positions, velocities, alive } = this.simBuffers()
      if (integrateParticleBuffers(positions, velocities, alive, dt, gravity, drag)) {
        this.computeIntegratedFrames++
        const posAttr = this.points.geometry.getAttribute('position')
        if (posAttr) posAttr.needsUpdate = true
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