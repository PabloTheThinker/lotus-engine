import * as THREE from 'three'

/**
 * Particles — the Niagara/CPUParticles3D analog. CPU-simulated sprite
 * particles over a custom shader (per-particle size, color, opacity).
 * Emitters preview in the editor and run during Play.
 */

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
  sizeStart: number
  sizeEnd: number
  opacityEnd: number
  maxParticles: number
  additive: boolean
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
  sizeStart: 0.22,
  sizeEnd: 0.04,
  opacityEnd: 0,
  maxParticles: 600,
  additive: true,
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

export class ParticleSystem {
  points: THREE.Points
  props: ParticleProps

  private positions: Float32Array
  private colors: Float32Array
  private sizes: Float32Array
  private vel: Float32Array
  private life: Float32Array
  private maxLife: Float32Array
  private alive: boolean[]
  private spawnAcc = 0
  private cap: number
  private cStart = new THREE.Color()
  private cEnd = new THREE.Color()
  private tmp = new THREE.Color()

  constructor(props: ParticleProps) {
    this.props = props
    this.cap = Math.max(1, Math.min(props.maxParticles, 5000))
    this.positions = new Float32Array(this.cap * 3)
    this.colors = new Float32Array(this.cap * 4)
    this.sizes = new Float32Array(this.cap)
    this.vel = new Float32Array(this.cap * 3)
    this.life = new Float32Array(this.cap)
    this.maxLife = new Float32Array(this.cap)
    this.alive = new Array(this.cap).fill(false)

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
    this.points.frustumCulled = false
    this.points.userData.isParticles = true
  }

  /** apply prop changes that affect the material */
  refresh() {
    const mat = this.points.material as THREE.ShaderMaterial
    mat.blending = this.props.additive ? THREE.AdditiveBlending : THREE.NormalBlending
    mat.needsUpdate = true
  }

  burst(count: number) {
    for (let i = 0; i < count; i++) this.spawn()
  }

  private spawn() {
    const idx = this.alive.indexOf(false)
    if (idx === -1) return
    const p = this.props
    this.alive[idx] = true
    const jitter = 1 - p.lifetimeJitter * Math.random()
    this.maxLife[idx] = Math.max(0.05, p.lifetime * jitter)
    this.life[idx] = this.maxLife[idx]

    // emission position (local space)
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

    // velocity
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
  }

  update(dt: number, emitting: boolean) {
    const p = this.props
    if (emitting) {
      this.spawnAcc += p.rate * dt
      while (this.spawnAcc >= 1) {
        this.spawnAcc -= 1
        this.spawn()
      }
    }
    this.cStart.set(p.colorStart)
    this.cEnd.set(p.colorEnd)
    const dragMul = Math.max(0, 1 - p.drag * dt)

    for (let i = 0; i < this.cap; i++) {
      if (!this.alive[i]) {
        this.sizes[i] = 0
        continue
      }
      this.life[i] -= dt
      if (this.life[i] <= 0) {
        this.alive[i] = false
        this.sizes[i] = 0
        continue
      }
      const i3 = i * 3
      this.vel[i3 + 1] += p.gravity * dt
      this.vel[i3] *= dragMul
      this.vel[i3 + 1] *= dragMul
      this.vel[i3 + 2] *= dragMul
      this.positions[i3] += this.vel[i3] * dt
      this.positions[i3 + 1] += this.vel[i3 + 1] * dt
      this.positions[i3 + 2] += this.vel[i3 + 2] * dt

      const t = 1 - this.life[i] / this.maxLife[i] // 0 → 1 over life
      this.tmp.copy(this.cStart).lerp(this.cEnd, t)
      const i4 = i * 4
      this.colors[i4] = this.tmp.r
      this.colors[i4 + 1] = this.tmp.g
      this.colors[i4 + 2] = this.tmp.b
      this.colors[i4 + 3] = THREE.MathUtils.lerp(1, p.opacityEnd, t)
      this.sizes[i] = THREE.MathUtils.lerp(p.sizeStart, p.sizeEnd, t)
    }

    const geo = this.points.geometry
    geo.attributes.position.needsUpdate = true
    geo.attributes.aColor.needsUpdate = true
    geo.attributes.aSize.needsUpdate = true
  }

  dispose() {
    this.points.geometry.dispose()
    ;(this.points.material as THREE.Material).dispose()
  }
}
