import * as THREE from 'three'

/**
 * Particles — the Niagara/CPUParticles3D analog. CPU-simulated sprite
 * particles over a custom shader (per-particle size, color, opacity).
 * Emitters preview in the editor and run during Play.
 */

export type ParticleRenderMode = 'points' | 'ribbon' | 'mesh'
export type ParticleMeshShape = 'box' | 'sphere'

export interface SubEmitterProps {
  enabled: boolean
  onDeath: boolean
  onCollision: boolean
  count: number
  speed: number
  lifetime: number
}

export interface ParticleProps {
  rate: number // particles per second
  burst: number // extra particles at play start
  lifetime: number
  lifetimeJitter: number // 0..1
  shape: 'point' | 'sphere' | 'cone' | 'box'
  shapeRadius: number
  speed: number
  speedJitter: number
  spreadDeg: number // cone half-angle
  gravity: number
  drag: number
  colorStart: string
  colorEnd: string
  /** 4-stop color gradient over lifetime (0%, 33%, 66%, 100%) */
  colorGradient?: [string, string, string, string]
  sizeStart: number
  sizeEnd: number
  /** 4-stop size curve over lifetime (0%, 33%, 66%, 100%) */
  sizeCurve?: [number, number, number, number]
  opacityEnd: number
  maxParticles: number
  additive: boolean
  renderMode: ParticleRenderMode
  meshShape: ParticleMeshShape
  ribbonWidth: number
  ribbonSegments: number
  groundBounce: boolean
  bounceFactor: number
  subEmitter?: SubEmitterProps
  /** Niagara-style module stack: disabled module names */
  modulesOff?: string[]
}

export const DEFAULT_PARTICLES: ParticleProps = {
  rate: 40,
  burst: 0,
  lifetime: 1.6,
  lifetimeJitter: 0.3,
  shape: 'cone',
  shapeRadius: 0.15,
  speed: 2.5,
  speedJitter: 0.4,
  spreadDeg: 18,
  gravity: -1.5,
  drag: 0.6,
  colorStart: '#ffb347',
  colorEnd: '#e5484d',
  colorGradient: ['#ffb347', '#ff8c42', '#e86a4a', '#e5484d'],
  sizeStart: 0.22,
  sizeEnd: 0.04,
  sizeCurve: [0.22, 0.18, 0.1, 0.04],
  opacityEnd: 0,
  maxParticles: 600,
  additive: true,
  renderMode: 'points',
  meshShape: 'box',
  ribbonWidth: 0.08,
  ribbonSegments: 8,
  groundBounce: false,
  bounceFactor: 0.45,
  subEmitter: { enabled: false, onDeath: true, onCollision: false, count: 8, speed: 1.5, lifetime: 0.4 },
}

const VERT = `
attribute float aSize;
attribute vec4 aColor;
varying vec4 vColor;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (260.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}`

const FRAG = `
varying vec4 vColor;
void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  if (d > 0.5) discard;
  float soft = smoothstep(0.5, 0.15, d);
  gl_FragColor = vec4(vColor.rgb, vColor.a * soft);
}`

const RIBBON_VERT = `
attribute vec4 aColor;
varying vec4 vColor;
void main() {
  vColor = aColor;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`

const RIBBON_FRAG = `
varying vec4 vColor;
void main() {
  gl_FragColor = vColor;
}`

/** Sample a 4-point color gradient at normalized life t (0→1). */
export function sampleColorGradient(stops: [string, string, string, string], t: number, out = new THREE.Color()): THREE.Color {
  const clamped = THREE.MathUtils.clamp(t, 0, 1)
  const seg = clamped * 3
  const idx = Math.min(2, Math.floor(seg))
  const f = seg - idx
  const c0 = new THREE.Color(stops[idx])
  const c1 = new THREE.Color(stops[idx + 1])
  return out.copy(c0).lerp(c1, f)
}

/** Sample a 4-point size curve at normalized life t (0→1). */
export function sampleSizeCurve(stops: [number, number, number, number], t: number): number {
  const clamped = THREE.MathUtils.clamp(t, 0, 1)
  const seg = clamped * 3
  const idx = Math.min(2, Math.floor(seg))
  const f = seg - idx
  return THREE.MathUtils.lerp(stops[idx], stops[idx + 1], f)
}

export type TerrainHeightFn = (worldX: number, worldZ: number) => number | null

export interface ParticleUpdateOpts {
  /** Skip gravity/drag integration — used when GPU compute tier already integrated motion */
  skipForces?: boolean
  /** Skip CPU spawn accumulator — GPU emit kernel already ran */
  skipSpawn?: boolean
  /** Skip CPU life/color/size — Wave 18 GPU buffers own those channels */
  skipLifeColor?: boolean
}

export interface ParticleSimBuffers {
  positions: Float32Array
  velocities: Float32Array
  alive: boolean[]
  /** Wave 17 — GPU storage buffer mask (1 = alive, 0 = dead) */
  aliveF: Float32Array
  /** Wave 18 — GPU life/color/size buffers */
  life: Float32Array
  maxLife: Float32Array
  colors: Float32Array
  sizes: Float32Array
}

export class ParticleSystem {
  points: THREE.Points
  ribbon: THREE.Mesh
  mesh: THREE.InstancedMesh
  props: ParticleProps

  private positions: Float32Array
  private colors: Float32Array
  private sizes: Float32Array
  private vel: Float32Array
  private life: Float32Array
  private maxLife: Float32Array
  private alive: boolean[]
  private aliveF: Float32Array
  private trail: Float32Array
  private trailLen: number
  private spawnAcc = 0
  private cap: number
  private cStart = new THREE.Color()
  private cEnd = new THREE.Color()
  private tmp = new THREE.Color()
  private worldPos = new THREE.Vector3()
  private worldVel = new THREE.Vector3()
  private side = new THREE.Vector3()
  private up = new THREE.Vector3(0, 1, 0)
  private instPos = new THREE.Vector3()
  private instQuat = new THREE.Quaternion()
  private instScale = new THREE.Vector3()
  private instMat = new THREE.Matrix4()
  private meshGeo: THREE.BufferGeometry
  private currentMeshShape: ParticleMeshShape
  private boundsCenter = new THREE.Vector3()
  private boundsScratch = new THREE.Vector3()

  constructor(props: ParticleProps) {
    this.props = props
    this.cap = Math.max(1, Math.min(props.maxParticles, 5000))
    this.trailLen = Math.max(2, Math.min(props.ribbonSegments, 32))
    this.positions = new Float32Array(this.cap * 3)
    this.colors = new Float32Array(this.cap * 4)
    this.sizes = new Float32Array(this.cap)
    this.vel = new Float32Array(this.cap * 3)
    this.life = new Float32Array(this.cap)
    this.maxLife = new Float32Array(this.cap)
    this.alive = new Array(this.cap).fill(false)
    this.aliveF = new Float32Array(this.cap)
    this.trail = new Float32Array(this.cap * this.trailLen * 3)

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3))
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 4))
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1))
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 100)

    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: props.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    })
    this.points = new THREE.Points(geo, mat)
    this.points.frustumCulled = true
    this.points.userData.isParticles = true

    const maxVerts = this.cap * this.trailLen * 2
    const rGeo = new THREE.BufferGeometry()
    rGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(maxVerts * 3), 3))
    rGeo.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(maxVerts * 4), 4))
    rGeo.setIndex(new THREE.BufferAttribute(new Uint32Array(this.cap * (this.trailLen - 1) * 6), 1))
    const rMat = new THREE.ShaderMaterial({
      vertexShader: RIBBON_VERT,
      fragmentShader: RIBBON_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: props.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    })
    this.ribbon = new THREE.Mesh(rGeo, rMat)
    this.ribbon.frustumCulled = true
    this.ribbon.userData.isParticles = true

    this.currentMeshShape = props.meshShape
    this.meshGeo = this.makeMeshGeometry(this.currentMeshShape)
    const meshMat = new THREE.MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      vertexColors: true,
      blending: props.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    })
    this.mesh = new THREE.InstancedMesh(this.meshGeo, meshMat, this.cap)
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.mesh.frustumCulled = true
    this.mesh.userData.isParticles = true
    this.applyRenderMode()
  }

  private makeMeshGeometry(shape: ParticleMeshShape) {
    return shape === 'sphere'
      ? new THREE.SphereGeometry(0.5, 6, 4)
      : new THREE.BoxGeometry(1, 1, 1)
  }

  /** apply prop changes that affect the material / visible renderer */
  refresh() {
    const mat = this.points.material as THREE.ShaderMaterial
    mat.blending = this.props.additive ? THREE.AdditiveBlending : THREE.NormalBlending
    mat.needsUpdate = true
    const rMat = this.ribbon.material as THREE.ShaderMaterial
    rMat.blending = this.props.additive ? THREE.AdditiveBlending : THREE.NormalBlending
    rMat.needsUpdate = true
    const mMat = this.mesh.material as THREE.MeshBasicMaterial
    mMat.blending = this.props.additive ? THREE.AdditiveBlending : THREE.NormalBlending
    mMat.needsUpdate = true
    const shape = this.props.meshShape ?? 'box'
    if (shape !== this.currentMeshShape) {
      this.meshGeo.dispose()
      this.currentMeshShape = shape
      this.meshGeo = this.makeMeshGeometry(shape)
      this.mesh.geometry = this.meshGeo
    }
    this.trailLen = Math.max(2, Math.min(this.props.ribbonSegments, 32))
    this.applyRenderMode()
  }

  private applyRenderMode() {
    const mode = this.props.renderMode ?? 'points'
    this.points.visible = mode === 'points'
    this.ribbon.visible = mode === 'ribbon'
    this.mesh.visible = mode === 'mesh'
  }

  burst(count: number) {
    for (let i = 0; i < count; i++) this.spawn()
  }

  /** Wave 15 — sim buffer accessors for GPU compute integration */
  simBuffers(): ParticleSimBuffers {
    return {
      positions: this.positions,
      velocities: this.vel,
      alive: this.alive,
      aliveF: this.aliveF,
      life: this.life,
      maxLife: this.maxLife,
      colors: this.colors,
      sizes: this.sizes,
    }
  }

  /** Sync float alive mask from boolean slots (Wave 17 GPU path). */
  syncAliveMask(): void {
    for (let i = 0; i < this.cap; i++) this.aliveF[i] = this.alive[i] ? 1 : 0
  }

  /** Promote GPU-emitted slots (aliveF) into CPU sim state for trail/sub-emitters. */
  applyGPUAliveMask(defaultLife: number): void {
    for (let i = 0; i < this.cap; i++) {
      if (this.aliveF[i] > 0.5 && !this.alive[i]) {
        this.alive[i] = true
        if (this.life[i] <= 0) {
          this.life[i] = defaultLife
          this.maxLife[i] = defaultLife
        }
      }
    }
  }

  /** Sync boolean alive[] from GPU mask after integrate (Wave 18). */
  syncGPUAliveFromBuffers(): void {
    for (let i = 0; i < this.cap; i++) this.alive[i] = this.aliveF[i] > 0.5
  }

  private sizeAt(t: number, offSize: boolean) {
    if (offSize) return this.props.sizeStart
    const curve = this.props.sizeCurve
    if (curve && curve.length === 4) return sampleSizeCurve(curve, t)
    return THREE.MathUtils.lerp(this.props.sizeStart, this.props.sizeEnd, t)
  }

  /** Spawn a radial burst at a world-local position (sub-emitter). */
  private spawnBurstAt(x: number, y: number, z: number, se: SubEmitterProps) {
    for (let n = 0; n < se.count; n++) {
      const idx = this.alive.indexOf(false)
      if (idx === -1) return
      this.alive[idx] = true
      this.aliveF[idx] = 1
      this.maxLife[idx] = Math.max(0.05, se.lifetime)
      this.life[idx] = this.maxLife[idx]
      const i3 = idx * 3
      this.positions[i3] = x
      this.positions[i3 + 1] = y
      this.positions[i3 + 2] = z
      const dir = new THREE.Vector3().randomDirection()
      const speed = se.speed * (0.6 + Math.random() * 0.4)
      this.vel[i3] = dir.x * speed
      this.vel[i3 + 1] = dir.y * speed
      this.vel[i3 + 2] = dir.z * speed
      const tb = idx * this.trailLen * 3
      for (let s = 0; s < this.trailLen; s++) {
        this.trail[tb + s * 3] = x
        this.trail[tb + s * 3 + 1] = y
        this.trail[tb + s * 3 + 2] = z
      }
    }
  }

  private spawn() {
    const idx = this.alive.indexOf(false)
    if (idx === -1) return
    const p = this.props
    this.alive[idx] = true
    this.aliveF[idx] = 1
    const jitter = 1 - p.lifetimeJitter * Math.random()
    this.maxLife[idx] = Math.max(0.05, p.lifetime * jitter)
    this.life[idx] = this.maxLife[idx]

    const i3 = idx * 3
    if (p.shape === 'point') {
      this.positions[i3] = 0
      this.positions[i3 + 1] = 0
      this.positions[i3 + 2] = 0
    } else if (p.shape === 'sphere' || p.shape === 'cone') {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(p.shapeRadius * Math.cbrt(Math.random()))
      this.positions[i3] = v.x
      this.positions[i3 + 1] = p.shape === 'cone' ? 0 : v.y
      this.positions[i3 + 2] = v.z
    } else {
      this.positions[i3] = (Math.random() - 0.5) * p.shapeRadius * 2
      this.positions[i3 + 1] = (Math.random() - 0.5) * p.shapeRadius * 2
      this.positions[i3 + 2] = (Math.random() - 0.5) * p.shapeRadius * 2
    }

    const speed = p.speed * (1 - p.speedJitter * Math.random())
    let dir: THREE.Vector3
    if (p.shape === 'cone') {
      const a = THREE.MathUtils.degToRad(p.spreadDeg) * Math.sqrt(Math.random())
      const t = Math.random() * Math.PI * 2
      dir = new THREE.Vector3(Math.sin(a) * Math.cos(t), Math.cos(a), Math.sin(a) * Math.sin(t))
    } else {
      dir = new THREE.Vector3().randomDirection()
    }
    this.vel[i3] = dir.x * speed
    this.vel[i3 + 1] = dir.y * speed
    this.vel[i3 + 2] = dir.z * speed

    const tb = idx * this.trailLen * 3
    for (let s = 0; s < this.trailLen; s++) {
      this.trail[tb + s * 3] = this.positions[i3]
      this.trail[tb + s * 3 + 1] = this.positions[i3 + 1]
      this.trail[tb + s * 3 + 2] = this.positions[i3 + 2]
    }
  }

  private colorAt(t: number, offColor: boolean) {
    if (offColor) {
      this.tmp.copy(this.cStart)
      return
    }
    const grad = this.props.colorGradient
    if (grad && grad.length === 4) sampleColorGradient(grad, t, this.tmp)
    else this.tmp.copy(this.cStart).lerp(this.cEnd, t)
  }

  private shiftTrail(idx: number) {
    const tb = idx * this.trailLen * 3
    for (let s = this.trailLen - 1; s > 0; s--) {
      const dst = tb + s * 3
      const src = tb + (s - 1) * 3
      this.trail[dst] = this.trail[src]
      this.trail[dst + 1] = this.trail[src + 1]
      this.trail[dst + 2] = this.trail[src + 2]
    }
    const i3 = idx * 3
    this.trail[tb] = this.positions[i3]
    this.trail[tb + 1] = this.positions[i3 + 1]
    this.trail[tb + 2] = this.positions[i3 + 2]
  }

  private buildRibbon(worldMatrix?: THREE.Matrix4) {
    const posAttr = this.ribbon.geometry.attributes.position as THREE.BufferAttribute
    const colAttr = this.ribbon.geometry.attributes.aColor as THREE.BufferAttribute
    const idxAttr = this.ribbon.geometry.index as THREE.BufferAttribute
    const width = Math.max(0.01, this.props.ribbonWidth)
    const offColor = this.props.modulesOff?.includes('colorOverLife') ?? false
    const offSize = this.props.modulesOff?.includes('sizeOverLife') ?? false
    let v = 0
    let tri = 0
    const m = worldMatrix ?? new THREE.Matrix4()

    for (let i = 0; i < this.cap; i++) {
      if (!this.alive[i]) continue
      const t = 1 - this.life[i] / this.maxLife[i]
      this.colorAt(t, offColor)
      const alpha = offSize ? 1 : THREE.MathUtils.lerp(1, this.props.opacityEnd, t)
      const tb = i * this.trailLen * 3

      for (let s = 0; s < this.trailLen; s++) {
        const lx = this.trail[tb + s * 3]
        const ly = this.trail[tb + s * 3 + 1]
        const lz = this.trail[tb + s * 3 + 2]
        this.worldPos.set(lx, ly, lz).applyMatrix4(m)

        const segT = s / Math.max(1, this.trailLen - 1)
        const fade = 1 - segT * 0.85

        if (s < this.trailLen - 1) {
          const nx = this.trail[tb + (s + 1) * 3]
          const ny = this.trail[tb + (s + 1) * 3 + 1]
          const nz = this.trail[tb + (s + 1) * 3 + 2]
          this.worldVel.set(nx - lx, ny - ly, nz - lz).transformDirection(m)
        } else if (s > 0) {
          const px = this.trail[tb + (s - 1) * 3]
          const py = this.trail[tb + (s - 1) * 3 + 1]
          const pz = this.trail[tb + (s - 1) * 3 + 2]
          this.worldVel.set(lx - px, ly - py, lz - pz).transformDirection(m)
        } else {
          this.worldVel.set(0, 1, 0)
        }
        if (this.worldVel.lengthSq() < 1e-8) this.worldVel.set(0, 1, 0)
        this.worldVel.normalize()
        this.side.crossVectors(this.worldVel, this.up)
        if (this.side.lengthSq() < 1e-8) this.side.set(1, 0, 0)
        this.side.normalize().multiplyScalar(width * 0.5 * (1 - segT * 0.5))

        const sizeNorm = offSize ? 1 : this.sizeAt(t, false) / Math.max(0.01, this.props.sizeStart)
        const w = width * sizeNorm

        for (const sign of [-1, 1] as const) {
          posAttr.setXYZ(v, this.worldPos.x + this.side.x * sign * w, this.worldPos.y + this.side.y * sign * w, this.worldPos.z + this.side.z * sign * w)
          colAttr.setXYZW(v, this.tmp.r, this.tmp.g, this.tmp.b, alpha * fade)
          v++
        }

        if (s < this.trailLen - 1) {
          const base = v - 2
          idxAttr.setX(tri++, base)
          idxAttr.setX(tri++, base + 1)
          idxAttr.setX(tri++, base + 2)
          idxAttr.setX(tri++, base + 1)
          idxAttr.setX(tri++, base + 3)
          idxAttr.setX(tri++, base + 2)
        }
      }
    }

    posAttr.needsUpdate = true
    colAttr.needsUpdate = true
    idxAttr.needsUpdate = true
    this.ribbon.geometry.setDrawRange(0, tri)
  }

  private buildMesh() {
    const offColor = this.props.modulesOff?.includes('colorOverLife') ?? false
    const offSize = this.props.modulesOff?.includes('sizeOverLife') ?? false

    for (let i = 0; i < this.cap; i++) {
      if (!this.alive[i]) {
        this.instScale.set(0, 0, 0)
        this.instMat.compose(this.instPos.set(0, 0, 0), this.instQuat, this.instScale)
        this.mesh.setMatrixAt(i, this.instMat)
        continue
      }
      const i3 = i * 3
      const t = 1 - this.life[i] / this.maxLife[i]
      this.colorAt(t, offColor)
      const alpha = offSize ? 1 : THREE.MathUtils.lerp(1, this.props.opacityEnd, t)
      const size = this.sizeAt(t, offSize)
      this.instPos.set(this.positions[i3], this.positions[i3 + 1], this.positions[i3 + 2])
      this.instScale.set(size, size, size)
      this.instMat.compose(this.instPos, this.instQuat, this.instScale)
      this.mesh.setMatrixAt(i, this.instMat)
      this.mesh.setColorAt(i, this.tmp.multiplyScalar(Math.max(0, alpha)))
    }

    this.mesh.count = this.cap
    this.mesh.instanceMatrix.needsUpdate = true
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
  }

  update(
    dt: number,
    emitting: boolean,
    worldMatrix?: THREE.Matrix4,
    terrainAt?: TerrainHeightFn,
    opts?: ParticleUpdateOpts,
  ) {
    const p = this.props
    const off = (m: string) => p.modulesOff?.includes(m)
    if (emitting && !off('spawn') && !opts?.skipSpawn) {
      this.spawnAcc += p.rate * dt
      while (this.spawnAcc >= 1) {
        this.spawnAcc -= 1
        this.spawn()
      }
    }
    this.cStart.set(p.colorStart)
    this.cEnd.set(off('colorOverLife') ? p.colorStart : p.colorEnd)
    const gravity = off('forces') ? 0 : p.gravity
    const dragMul = off('forces') ? 1 : Math.max(0, 1 - p.drag * dt)
    const bounceOn = p.groundBounce && !off('forces') && terrainAt
    const se = p.subEmitter
    const subOn = se?.enabled && !off('subEmitter')
    const m = worldMatrix ?? new THREE.Matrix4()

    for (let i = 0; i < this.cap; i++) {
      if (!this.alive[i]) {
        if (!opts?.skipLifeColor) this.sizes[i] = 0
        continue
      }
      if (!opts?.skipLifeColor) {
        this.life[i] -= dt
        if (this.life[i] <= 0) {
          if (subOn && se!.onDeath) {
            const i3 = i * 3
            this.spawnBurstAt(this.positions[i3], this.positions[i3 + 1], this.positions[i3 + 2], se!)
          }
          this.alive[i] = false
          this.aliveF[i] = 0
          this.sizes[i] = 0
          continue
        }
      } else if (this.life[i] <= 0 || this.aliveF[i] < 0.5) {
        if (subOn && se!.onDeath) {
          const i3 = i * 3
          this.spawnBurstAt(this.positions[i3], this.positions[i3 + 1], this.positions[i3 + 2], se!)
        }
        this.alive[i] = false
        this.aliveF[i] = 0
        this.sizes[i] = 0
        continue
      }
      const i3 = i * 3
      if (!opts?.skipForces) {
        this.vel[i3 + 1] += gravity * dt
        this.vel[i3] *= dragMul
        this.vel[i3 + 1] *= dragMul
        this.vel[i3 + 2] *= dragMul
        this.positions[i3] += this.vel[i3] * dt
        this.positions[i3 + 1] += this.vel[i3 + 1] * dt
        this.positions[i3 + 2] += this.vel[i3 + 2] * dt
      }

      if (bounceOn) {
        this.worldPos.set(this.positions[i3], this.positions[i3 + 1], this.positions[i3 + 2]).applyMatrix4(m)
        const groundY = terrainAt!(this.worldPos.x, this.worldPos.z)
        if (groundY != null && this.worldPos.y < groundY) {
          const inv = new THREE.Matrix4().copy(m).invert()
          this.worldPos.y = groundY
          this.worldPos.applyMatrix4(inv)
          this.positions[i3] = this.worldPos.x
          this.positions[i3 + 1] = this.worldPos.y
          this.positions[i3 + 2] = this.worldPos.z
          this.vel[i3 + 1] = Math.abs(this.vel[i3 + 1]) * p.bounceFactor
          if (subOn && se!.onCollision) {
            this.spawnBurstAt(this.positions[i3], this.positions[i3 + 1], this.positions[i3 + 2], se!)
          }
        }
      }

      if (p.renderMode === 'ribbon') this.shiftTrail(i)

      if (!opts?.skipLifeColor) {
        const t = 1 - this.life[i] / this.maxLife[i]
        this.colorAt(t, !!off('colorOverLife'))
        const i4 = i * 4
        this.colors[i4] = this.tmp.r
        this.colors[i4 + 1] = this.tmp.g
        this.colors[i4 + 2] = this.tmp.b
        this.colors[i4 + 3] = off('sizeOverLife') ? 1 : THREE.MathUtils.lerp(1, p.opacityEnd, t)
        this.sizes[i] = this.sizeAt(t, !!off('sizeOverLife'))
      }
    }

    const geo = this.points.geometry
    geo.attributes.position.needsUpdate = true
    geo.attributes.aColor.needsUpdate = true
    geo.attributes.aSize.needsUpdate = true

    if (p.renderMode === 'ribbon') this.buildRibbon(worldMatrix)
    if (p.renderMode === 'mesh') this.buildMesh()
    this.updateBounds()
  }

  /** Tighten bounding spheres each tick so frustum culling stays correct. */
  private updateBounds() {
    this.boundsCenter.set(0, 0, 0)
    let aliveCount = 0
    let maxDistSq = 0.01
    for (let i = 0; i < this.cap; i++) {
      if (!this.alive[i]) continue
      aliveCount++
      const i3 = i * 3
      this.boundsScratch.set(this.positions[i3], this.positions[i3 + 1], this.positions[i3 + 2])
      this.boundsCenter.add(this.boundsScratch)
      const r = Math.max(0.05, this.sizes[i] * 0.5)
      maxDistSq = Math.max(maxDistSq, this.boundsScratch.lengthSq() + r * r)
    }
    if (aliveCount > 0) this.boundsCenter.multiplyScalar(1 / aliveCount)
    const radius = Math.sqrt(maxDistSq) + 0.25
    for (const obj of [this.points, this.ribbon, this.mesh] as const) {
      if (!obj.geometry.boundingSphere) obj.geometry.boundingSphere = new THREE.Sphere()
      obj.geometry.boundingSphere.center.copy(this.boundsCenter)
      obj.geometry.boundingSphere.radius = radius
    }
  }

  dispose() {
    this.points.geometry.dispose()
    ;(this.points.material as THREE.Material).dispose()
    this.ribbon.geometry.dispose()
    ;(this.ribbon.material as THREE.Material).dispose()
    this.meshGeo.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
  }
}