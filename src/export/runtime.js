/* Lotus Engine — standalone playable runtime. Injected into exported HTML
   alongside the level JSON. Loads three.js (+ optional Rapier physics) from
   CDN and runs the level: scripts, behaviors, particles, foliage, landscape,
   pawn controllers. Supports multi-level manifests + api.loadLevel(). */
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { Sky } from 'three/addons/objects/Sky.js'

const LEVELS =
  window.__LOTUS_LEVELS__ ??
  (window.__VEKTRA_LEVELS__ ??
    (window.__LOTUS_LEVEL__ ?? window.__VEKTRA_LEVEL__
      ? { main: window.__LOTUS_LEVEL__ ?? window.__VEKTRA_LEVEL__ }
      : null))
const MAIN_KEY = window.__LOTUS_MAIN__ ?? window.__VEKTRA_MAIN__ ?? 'main'
const EXPORT = window.__LOTUS_EXPORT__ ?? window.__VEKTRA_EXPORT__ ?? { quality: 'desktop' }
const CELL_MANIFEST = window.__LOTUS_CELLS__ ?? window.__VEKTRA_CELLS__ ?? null
const ALWAYS_LOADED = new Set(['DirectionalLight', 'AmbientLight', 'PlayerStart'])
if (!LEVELS || !LEVELS[MAIN_KEY]) throw new Error('Lotus: no level data')

let LEVEL = LEVELS[MAIN_KEY]
const pixelRatio = EXPORT.pixelRatio ?? (EXPORT.quality === 'mobile' ? 1 : Math.min(devicePixelRatio, 2))
const exportRenderTier = EXPORT.renderBackend ?? LEVEL.environment?.renderBackend ?? 'webgl'

/** Wave 14 — WebGPU export runtime when tier + API available. */
async function createPlayRenderer() {
  const antialias = EXPORT.quality !== 'mobile'
  if (exportRenderTier === 'webgpu' && navigator.gpu) {
    try {
      const { WebGPURenderer } = await import('three/webgpu')
      const r = new WebGPURenderer({ antialias, alpha: false })
      await r.init()
      r.toneMapping = THREE.ACESFilmicToneMapping
      r.toneMappingExposure = LEVEL.environment?.exposure ?? 0.75
      r.outputColorSpace = THREE.SRGBColorSpace
      r.setPixelRatio(pixelRatio)
      r.setSize(innerWidth, innerHeight)
      document.body.appendChild(r.domElement)
      return { renderer: r, tier: 'webgpu' }
    } catch {
      /* fall through to WebGL */
    }
  }
  const r = new THREE.WebGLRenderer({ antialias })
  r.shadowMap.enabled = true
  r.toneMapping = THREE.ACESFilmicToneMapping
  r.toneMappingExposure = LEVEL.environment.exposure ?? 0.75
  r.outputColorSpace = THREE.SRGBColorSpace
  r.setPixelRatio(pixelRatio)
  r.setSize(innerWidth, innerHeight)
  document.body.appendChild(r.domElement)
  return { renderer: r, tier: 'webgl' }
}

let renderer
let playRenderTier = 'webgl'
/** @type {{ render: () => void, setCamera: (cam: import('three').Camera) => void } | null} */
let exportTslPipeline = null

/** Wave 15–18 — TSL GTAO + SSGI/TRAA/denoise + SSR denoise + bloom + FXAA for WebGPU export tier. */
async function createExportTSLPipeline(primary, scene, camera) {
  if (playRenderTier !== 'webgpu') return null
  try {
    const webgpu = await import('three/webgpu')
    const tsl = await import('three/tsl')
    const { bloom } = await import('three/addons/tsl/display/BloomNode.js')
    const { fxaa } = await import('three/addons/tsl/display/FXAANode.js')
    const { ao } = await import('three/addons/tsl/display/GTAONode.js')
    const { ssgi } = await import('three/addons/tsl/display/SSGINode.js')
    const { ssr } = await import('three/addons/tsl/display/SSRNode.js')
    const { traa } = await import('three/addons/tsl/display/TRAANode.js')
    const { denoise } = await import('three/addons/tsl/display/DenoiseNode.js')
    const { dof } = await import('three/addons/tsl/display/DepthOfFieldNode.js')
    const { pass, add, mul, max, pow, mrt, output, normalView, velocity, metalness, roughness, vec3, vec4, float, reflector, perspectiveDepthToViewZ, acesFilmicToneMapping } = tsl
    const env = LEVEL.environment ?? {}
    const bloomOn = env.bloomEnabled !== false
    const strength = env.bloomStrength ?? 0.35
    const threshold = env.bloomThreshold ?? 0.9
    const radius = env.bloomRadius ?? 0.6
    const ssaoOn = env.postSsao === true || env.renderBackend === 'webgpu'
    const fxaaOn = env.postFxaa !== false
    const taaOn = env.postTaa === true
    const ssrOn = env.postSsr === true
    const ssrPreset = env.postSsrPreset ?? 'medium'
    const ssrTable = {
      off: { maxDistance: 0, opacity: 0, thickness: 0 },
      low: { maxDistance: 50, opacity: 0.28, thickness: 0.018 },
      medium: { maxDistance: 100, opacity: 0.5, thickness: 0.01 },
      high: { maxDistance: 200, opacity: 0.82, thickness: 0.005 },
    }
    const ssrRow = ssrTable[ssrPreset] ?? ssrTable.medium
    const ssgiPreset = env.postSsgiPreset ?? 'off'
    const ssgiOn = env.postSsgi === true || (ssgiPreset !== 'off' && env.renderBackend === 'webgpu')
    const ssgiTable = {
      off: { intensity: 0, radius: 0, samples: 0, slices: 1 },
      low: { intensity: 0.35, radius: 0.4, samples: 4, slices: 1 },
      medium: { intensity: 0.55, radius: 0.65, samples: 8, slices: 2 },
      high: { intensity: 0.75, radius: 0.9, samples: 12, slices: 3 },
    }
    const ssgiRow = ssgiTable[ssgiPreset] ?? ssgiTable.off
    const dofOn = env.postDof === true
    const colorGradingOn = env.postColorGrading === true
    const acesOn = env.postAces === true
    const lift = env.postLift ?? [0, 0, 0]
    const gamma = env.postGamma ?? [1, 1, 1]
    const gain = env.postGain ?? [1, 1, 1]
    const groundReflect = env.postSsrGround === true && ssrOn
    let tslGround = null
    if (groundReflect) {
      const groundReflector = reflector()
      const geo = new THREE.PlaneGeometry(120, 120)
      const mat = new webgpu.MeshBasicNodeMaterial()
      mat.colorNode = groundReflector
      const mesh = new THREE.Mesh(geo, mat)
      mesh.rotation.x = -Math.PI / 2
      mesh.userData.isSSRGround = true
      mesh.add(groundReflector.target)
      scene.add(mesh)
      tslGround = { mesh, dispose: () => { geo.dispose(); mat.dispose() } }
    }
    let activeCam = camera
    const pipeline = new webgpu.RenderPipeline(primary)
    const rebuild = () => {
      const scenePass = pass(scene, activeCam)
      const needsMRT = ssaoOn || ssgiOn || ssrOn || taaOn || dofOn
      const needsVelocity = taaOn || ssgiOn || ssrOn
      if (needsMRT) {
        const mrtOut = { output, normal: normalView }
        if (needsVelocity) mrtOut.velocity = velocity
        if (ssrOn) {
          mrtOut.metalness = metalness
          mrtOut.roughness = roughness
        }
        scenePass.setMRT(mrt(mrtOut))
      }
      let color = scenePass.getTextureNode('output')
      if (needsMRT) {
        const depth = scenePass.getTextureNode('depth')
        const normal = scenePass.getTextureNode('normal')
        if (taaOn) {
          const vel = scenePass.getTextureNode('velocity')
          const traaPass = traa(color, depth, vel, activeCam)
          color = traaPass.getTextureNode()
        }
        if (ssaoOn) {
          const aoPass = ao(depth, normal, activeCam)
          const aoTex = aoPass.getTextureNode()
          color = mul(color, vec4(vec3(aoTex.r), 1))
        }
        if (ssgiOn) {
          const ssgiPass = ssgi(color, depth, normal, activeCam)
          ssgiPass.useTemporalFiltering = taaOn
          ssgiPass.sliceCount.value = ssgiRow.slices
          ssgiPass.stepCount.value = Math.max(4, ssgiRow.samples)
          ssgiPass.giIntensity.value = Math.max(1, ssgiRow.intensity * 12)
          ssgiPass.radius.value = Math.max(2, ssgiRow.radius * 14)
          let giTex = ssgiPass.getTextureNode()
          if (!taaOn) giTex = denoise(giTex, depth, normal, activeCam)
          color = add(color, giTex)
        }
        if (ssrOn) {
          const metal = scenePass.getTextureNode('metalness')
          const rough = scenePass.getTextureNode('roughness')
          const ssrPass = ssr(color, depth, normal, metal, rough, activeCam)
          if (ssrPass.maxDistance) ssrPass.maxDistance.value = ssrRow.maxDistance
          if (ssrPass.opacity) ssrPass.opacity.value = ssrRow.opacity
          if (ssrPass.thickness) ssrPass.thickness.value = ssrRow.thickness
          let ssrTex = ssrPass.getTextureNode()
          if (taaOn && needsVelocity) {
            const vel = scenePass.getTextureNode('velocity')
            const ssrTraa = traa(ssrTex, depth, vel, activeCam)
            ssrTex = ssrTraa.getTextureNode()
          }
          ssrTex = denoise(ssrTex, depth, normal, activeCam)
          color = add(color, ssrTex)
        }
      }
      if (colorGradingOn || acesOn) {
        const zero = float(0)
        const minGamma = vec3(0.01, 0.01, 0.01)
        let rgb = color.rgb ?? color
        if (colorGradingOn) {
          const liftV = vec3(lift[0], lift[1], lift[2])
          const gammaV = vec3(gamma[0], gamma[1], gamma[2])
          const gainV = vec3(gain[0], gain[1], gain[2])
          rgb = pow(max(add(rgb, liftV), zero), max(gammaV, minGamma))
          rgb = mul(rgb, gainV)
        }
        if (acesOn) {
          rgb = acesFilmicToneMapping(rgb, float(env.exposure ?? 0.75))
        }
        color = color.a !== undefined ? vec4(rgb, color.a) : rgb
      }
      if (bloomOn) {
        const bp = bloom(color, strength, radius, threshold)
        color = add(color, bp)
      }
      if (dofOn && needsMRT) {
        const depth = scenePass.getTextureNode('depth')
        const viewZ = perspectiveDepthToViewZ(depth, float(activeCam.near), float(activeCam.far))
        const focusDist = env.postDofFocusDistance ?? 5
        const focalLen = env.postDofFocalLength ?? 2
        const bokeh = env.postDofBokehScale ?? 1.2
        color = dof(color, viewZ, focusDist, focalLen, bokeh)
      }
      if (fxaaOn) color = fxaa(color)
      pipeline.outputNode = color
      pipeline.needsUpdate = true
    }
    rebuild()
    return {
      render: () => pipeline.render(),
      setCamera(cam) {
        if (activeCam === cam) return
        activeCam = cam
        rebuild()
      },
      dispose() {
        if (tslGround) {
          scene.remove(tslGround.mesh)
          tslGround.dispose()
        }
        pipeline.dispose()
      },
    }
  } catch {
    return null
  }
}

const scene = new THREE.Scene()
const actors = new Map()
const keys = new Set()
const pressed = new Set()
addEventListener('keydown', (e) => { if (!keys.has(e.code)) pressed.add(e.code); keys.add(e.code) })
addEventListener('keyup', (e) => keys.delete(e.code))

let skyObj = null
let particleSystems = []
let ticks = []
let physWorld = null
let bindings = []
let clock = 0
let loadingLevel = false
const loadedCells = new Set()
const cellActorIds = new Map()

function streamSettings() {
  const s = LEVEL.streaming ?? {}
  return {
    enabled: s.enabled !== false,
    gridSize: Math.max(8, s.gridSize ?? 64),
    loadRadius: Math.max(0, s.loadRadius ?? 2),
  }
}

function worldToCell(x, z, gridSize) {
  return [Math.floor(x / gridSize), Math.floor(z / gridSize)]
}

function cellKey(cx, cz) { return `${cx},${cz}` }

function isCellInRadius(acx, acz, ccx, ccz, r) {
  return Math.abs(acx - ccx) <= r && Math.abs(acz - ccz) <= r
}

function actorStreamVisible(sa, camPos) {
  const cfg = streamSettings()
  if (!cfg.enabled) return true
  if (ALWAYS_LOADED.has(sa.type) || !sa.streamCell) return true
  const camCell = worldToCell(camPos.x, camPos.z, cfg.gridSize)
  return isCellInRadius(sa.streamCell[0], sa.streamCell[1], camCell[0], camCell[1], cfg.loadRadius)
}

function applyStreamingVisibility(camPos) {
  const cfg = streamSettings()
  for (const a of actors.values()) {
    const sa = a.data
    const streamOk = actorStreamVisible(sa, camPos)
    const cullOk = !sa.cullDistance || a.root.position.distanceTo(camPos) < sa.cullDistance
    a.root.visible = (sa.visible !== false) && streamOk && cullOk
  }
}

// ---- environment ----
function applyEnvironment() {
  const env = LEVEL.environment
  if (skyObj) { scene.remove(skyObj); skyObj = null }
  if (env.skyEnabled) {
    const sky = new Sky()
    sky.scale.setScalar(450000)
    const u = sky.material.uniforms
    u.turbidity.value = 4; u.rayleigh.value = 1.1; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.8
    const phi = THREE.MathUtils.degToRad(90 - env.sunElevation)
    const theta = THREE.MathUtils.degToRad(env.sunAzimuth)
    u.sunPosition.value.setFromSphericalCoords(1, phi, theta)
    scene.add(sky)
    skyObj = sky
    scene.background = null
  } else {
    scene.background = new THREE.Color(env.background)
  }
  scene.fog = env.fogEnabled ? new THREE.FogExp2(env.fogColor, env.fogDensity) : null
  if (renderer) renderer.toneMappingExposure = env.exposure ?? 0.75
}
applyEnvironment()

// ---- geometry / actor builders ----
function buildGeometry(kind) {
  switch (kind) {
    case 'sphere': return new THREE.SphereGeometry(0.5, 32, 16)
    case 'cylinder': return new THREE.CylinderGeometry(0.5, 0.5, 1, 32)
    case 'cone': return new THREE.ConeGeometry(0.5, 1, 32)
    case 'plane': return new THREE.PlaneGeometry(1, 1)
    case 'torus': return new THREE.TorusGeometry(0.5, 0.2, 16, 48)
    case 'capsule': return new THREE.CapsuleGeometry(0.3, 0.6, 8, 16)
    case 'icosahedron': return new THREE.IcosahedronGeometry(0.5, 0)
    default: return new THREE.BoxGeometry(1, 1, 1)
  }
}
function buildMaterial(m, vertexColors = false) {
  return new THREE.MeshStandardMaterial({
    color: m?.color ?? '#9da4ae', roughness: m?.roughness ?? 0.6, metalness: m?.metalness ?? 0.1,
    emissive: m?.emissive ?? '#000', emissiveIntensity: m?.emissiveIntensity ?? 1,
    transparent: !!m?.transparent || (m?.opacity ?? 1) < 1, opacity: m?.opacity ?? 1, wireframe: !!m?.wireframe,
    vertexColors,
  })
}

/** Re-apply Baked AO (approx) vertex colors saved on the actor. */
function applyBakedAO(root, sa) {
  if (!sa.bakedAO || !sa.bakedAOMeshes?.length) return
  const meshes = []
  root.traverse((o) => { if (o.isMesh) meshes.push(o) })
  sa.bakedAOMeshes.forEach((colors, i) => {
    const mesh = meshes[i]
    if (!mesh || !colors?.length) return
    mesh.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3))
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const mat of mats) {
      if (mat.isMeshStandardMaterial) mat.vertexColors = true
    }
  })
}

function generateBoxProjectionUV2(geometry) {
  const pos = geometry.attributes.position
  if (!pos?.count) return false
  if (!geometry.attributes.normal) geometry.computeVertexNormals()
  const norm = geometry.attributes.normal
  geometry.computeBoundingBox()
  const bbox = geometry.boundingBox
  if (!bbox) return false
  const size = new THREE.Vector3()
  bbox.getSize(size)
  const sx = size.x || 1
  const sy = size.y || 1
  const sz = size.z || 1
  const uvs = new Float32Array(pos.count * 2)
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    const ax = Math.abs(norm.getX(i))
    const ay = Math.abs(norm.getY(i))
    const az = Math.abs(norm.getZ(i))
    let u
    let v
    if (ax >= ay && ax >= az) {
      u = (z - bbox.min.z) / sz
      v = (y - bbox.min.y) / sy
    } else if (ay >= ax && ay >= az) {
      u = (x - bbox.min.x) / sx
      v = (z - bbox.min.z) / sz
    } else {
      u = (x - bbox.min.x) / sx
      v = (y - bbox.min.y) / sy
    }
    uvs[i * 2] = THREE.MathUtils.clamp(u, 0, 1)
    uvs[i * 2 + 1] = THREE.MathUtils.clamp(v, 0, 1)
  }
  geometry.setAttribute('uv2', new THREE.BufferAttribute(uvs, 2))
  return true
}

function createAOMapTexture(pixels, size) {
  const data = new Uint8Array(size * size * 3)
  for (let i = 0; i < size * size; i++) {
    const v = Math.round(THREE.MathUtils.clamp(pixels[i] ?? 1, 0, 1) * 255)
    data[i * 3] = v
    data[i * 3 + 1] = v
    data[i * 3 + 2] = v
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBFormat)
  tex.colorSpace = THREE.NoColorSpace
  tex.needsUpdate = true
  return tex
}

/** Re-apply AO Map Bake (UV2, approx) saved on the actor. */
function applyBakedAOMap(root, sa) {
  if (!sa.bakedAOMap || !sa.bakedAOMapMeshes?.length) return
  const meshes = []
  root.traverse((o) => { if (o.isMesh) meshes.push(o) })
  const size = sa.bakedAOMapSize ?? 256
  const intensity = sa.aoMapIntensity ?? 1
  sa.bakedAOMapMeshes.forEach((pixels, i) => {
    const mesh = meshes[i]
    if (!mesh || !pixels?.length) return
    if (!mesh.geometry.attributes.uv2) generateBoxProjectionUV2(mesh.geometry)
    const tex = createAOMapTexture(pixels, size)
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const mat of mats) {
      if (mat.isMeshStandardMaterial) {
        if (mat.aoMap) mat.aoMap.dispose()
        mat.aoMap = tex
        mat.aoMapIntensity = intensity
      }
    }
  })
}

const gltfAssets = {}
async function loadAssets(level) {
  const loader = new GLTFLoader()
  for (const [id, a] of Object.entries(level.assets ?? {})) {
    if (gltfAssets[id]) continue
    const bytes = Uint8Array.from(atob(a.data), (c) => c.charCodeAt(0))
    gltfAssets[id] = (await loader.parseAsync(bytes.buffer, '')).scene
  }
}

let particleGpuKernels = null

async function bindExportParticleCompute() {
  if (playRenderTier !== 'webgpu' || (LEVEL.environment?.particleBackend ?? 'cpu') !== 'gpu' || !renderer?.compute) return
  try {
    const webgpu = await import('three/webgpu')
    const tsl = await import('three/tsl')
    const { storage, Fn, float, instanceIndex, uniform, If, sin, cos, fract } = tsl
    const StorageBufferAttribute = webgpu.StorageBufferAttribute
    particleGpuKernels = []
    for (const ps of particleSystems) {
      if (!ps.aliveF) continue
      const cap = ps.cap
      const posAttr = new StorageBufferAttribute(ps.pos, 3)
      const velAttr = new StorageBufferAttribute(ps.vel, 3)
      const aliveAttr = new StorageBufferAttribute(ps.aliveF, 1)
      const posBuf = storage(posAttr, 'vec3', cap)
      const velBuf = storage(velAttr, 'vec3', cap)
      const aliveBuf = storage(aliveAttr, 'float', cap)
      const dtU = uniform(float(0))
      const gravityU = uniform(float(0))
      const dragU = uniform(float(0))
      const spawnProbU = uniform(float(0))
      const speedU = uniform(float(1))
      const seedU = uniform(float(0))
      const integrate = Fn(() => {
        const alive = aliveBuf.element(instanceIndex)
        If(alive.greaterThan(0.5), () => {
          const p = posBuf.element(instanceIndex)
          const v = velBuf.element(instanceIndex)
          const drag = float(1).sub(dragU.mul(dtU))
          v.y.addAssign(gravityU)
          v.x.mulAssign(drag)
          v.y.mulAssign(drag)
          v.z.mulAssign(drag)
          p.x.addAssign(v.x.mul(dtU))
          p.y.addAssign(v.y.mul(dtU))
          p.z.addAssign(v.z.mul(dtU))
        })
      }).compute(cap)
      let trailShift = null
      if (ps.trail && ps.trailLen >= 2) {
        const slots = cap * ps.trailLen
        const trailAttr = new StorageBufferAttribute(ps.trail, 3)
        const trailBuf = storage(trailAttr, 'vec3', slots)
        const lenF = float(ps.trailLen)
        trailShift = Fn(() => {
          const alive = aliveBuf.element(instanceIndex)
          If(alive.greaterThan(0.5), () => {
            const base = instanceIndex.mul(lenF)
            const p = posBuf.element(instanceIndex)
            for (let s = ps.trailLen - 1; s >= 1; s--) {
              const dst = trailBuf.element(base.add(float(s)))
              const src = trailBuf.element(base.add(float(s - 1)))
              dst.assign(src)
            }
            trailBuf.element(base).assign(p)
          })
        }).compute(cap)
      }
      const emit = Fn(() => {
        const alive = aliveBuf.element(instanceIndex)
        If(alive.lessThan(0.5), () => {
          const h = fract(sin(instanceIndex.add(seedU)).mul(43758.5453))
          If(h.lessThan(spawnProbU), () => {
            alive.assign(1)
            const p = posBuf.element(instanceIndex)
            const v = velBuf.element(instanceIndex)
            const a = h.mul(6.283)
            const sp = speedU.mul(float(0.5).add(h.mul(0.5)))
            p.x.assign(sin(a).mul(0.05))
            p.y.assign(0)
            p.z.assign(cos(a).mul(0.05))
            v.x.assign(sin(a).mul(sp))
            v.y.assign(sp.mul(0.6))
            v.z.assign(cos(a).mul(sp))
          })
        })
      }).compute(cap)
      particleGpuKernels.push({ ps, dtU, gravityU, dragU, spawnProbU, speedU, seedU, integrate, emit, trailShift, seed: 0 })
      ps.gpuTier = true
    }
  } catch (e) {
    console.warn('export particle GPU bind failed', e)
    particleGpuKernels = null
  }
}

// minimal particle sim (CPU + optional WebGPU compute tier + ribbon trails)
function makeParticles(props) {
  const cap = Math.min(props.maxParticles ?? 500, 3000)
  const pos = new Float32Array(cap * 3), col = new Float32Array(cap * 3)
  const vel = new Float32Array(cap * 3), life = new Float32Array(cap), maxLife = new Float32Array(cap)
  const aliveF = new Float32Array(cap)
  const isRibbon = props.renderMode === 'ribbon'
  const trailLen = isRibbon ? Math.max(2, Math.min(props.ribbonSegments ?? 8, 16)) : 0
  const trail = isRibbon ? new Float32Array(cap * trailLen * 3) : null
  const c1 = new THREE.Color(props.colorStart), c2 = new THREE.Color(props.colorEnd), tmp = new THREE.Color()
  let display, geo
  if (isRibbon) {
    const maxVerts = cap * trailLen * 2
    geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(maxVerts * 3), 3))
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(maxVerts * 3), 3))
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(cap * (trailLen - 1) * 6), 1))
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false,
      blending: props.additive ? THREE.AdditiveBlending : THREE.NormalBlending, side: THREE.DoubleSide,
    })
    display = new THREE.Mesh(geo, mat)
  } else {
    geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1000)
    const mat = new THREE.PointsMaterial({
      size: (props.sizeStart + props.sizeEnd) / 2, vertexColors: true, transparent: true, opacity: 0.9,
      depthWrite: false, blending: props.additive ? THREE.AdditiveBlending : THREE.NormalBlending, sizeAttenuation: true,
    })
    display = new THREE.Points(geo, mat)
  }
  display.frustumCulled = false
  let acc = 0
  function shiftTrail(i) {
    const tb = i * trailLen * 3
    for (let s = trailLen - 1; s > 0; s--) {
      const dst = tb + s * 3, src = tb + (s - 1) * 3
      trail[dst] = trail[src]; trail[dst + 1] = trail[src + 1]; trail[dst + 2] = trail[src + 2]
    }
    const i3 = i * 3
    trail[tb] = pos[i3]; trail[tb + 1] = pos[i3 + 1]; trail[tb + 2] = pos[i3 + 2]
  }
  function buildRibbon() {
    const posAttr = geo.attributes.position
    const colAttr = geo.attributes.color
    const idxAttr = geo.index
    const width = Math.max(0.02, props.ribbonWidth ?? 0.08)
    let v = 0, tri = 0
    const up = new THREE.Vector3(0, 1, 0), side = new THREE.Vector3(), wp = new THREE.Vector3(), wv = new THREE.Vector3()
    for (let i = 0; i < cap; i++) {
      if (life[i] <= 0) continue
      const f = 1 - life[i] / maxLife[i]
      tmp.copy(c1).lerp(c2, f)
      const tb = i * trailLen * 3
      for (let s = 0; s < trailLen; s++) {
        wp.set(trail[tb + s * 3], trail[tb + s * 3 + 1], trail[tb + s * 3 + 2])
        if (s < trailLen - 1) {
          wv.set(trail[tb + (s + 1) * 3] - wp.x, trail[tb + (s + 1) * 3 + 1] - wp.y, trail[tb + (s + 1) * 3 + 2] - wp.z)
        } else if (s > 0) {
          wv.set(wp.x - trail[tb + (s - 1) * 3], wp.y - trail[tb + (s - 1) * 3 + 1], wp.z - trail[tb + (s - 1) * 3 + 2])
        } else wv.set(0, 1, 0)
        if (wv.lengthSq() < 1e-8) wv.set(0, 1, 0)
        wv.normalize()
        side.crossVectors(wv, up)
        if (side.lengthSq() < 1e-8) side.set(1, 0, 0)
        side.normalize().multiplyScalar(width * 0.5 * (1 - s / Math.max(1, trailLen - 1) * 0.5))
        const fade = 1 - s / Math.max(1, trailLen - 1) * 0.85
        for (const sign of [-1, 1]) {
          posAttr.setXYZ(v, wp.x + side.x * sign, wp.y + side.y * sign, wp.z + side.z * sign)
          colAttr.setXYZ(v, tmp.r * fade, tmp.g * fade, tmp.b * fade)
          v++
        }
        if (s < trailLen - 1) {
          const base = v - 2
          idxAttr.setX(tri++, base); idxAttr.setX(tri++, base + 1); idxAttr.setX(tri++, base + 2)
          idxAttr.setX(tri++, base + 1); idxAttr.setX(tri++, base + 3); idxAttr.setX(tri++, base + 2)
        }
      }
    }
    posAttr.needsUpdate = true
    colAttr.needsUpdate = true
    idxAttr.needsUpdate = true
    geo.setDrawRange(0, tri)
  }
  const se = props.subEmitter
  const subOn = se?.enabled && !(props.modulesOff ?? []).includes('subEmitter')
  function spawnBurstAt(wx, wy, wz) {
    if (!subOn || !se) return
    const n = Math.max(1, Math.min(se.count ?? 8, 24))
    for (let k = 0; k < n; k++) {
      const i = life.findIndex((l) => l <= 0)
      if (i < 0) break
      maxLife[i] = Math.max(0.05, (se.lifetime ?? 0.4) * (0.7 + Math.random() * 0.6))
      life[i] = maxLife[i]
      const i3 = i * 3
      pos[i3] = wx; pos[i3 + 1] = wy; pos[i3 + 2] = wz
      const sp = (se.speed ?? 1.5) * (0.5 + Math.random())
      const a = Math.random() * Math.PI * 2
      const incl = Math.random() * Math.PI * 0.5
      vel[i3] = Math.cos(a) * Math.sin(incl) * sp
      vel[i3 + 1] = Math.cos(incl) * sp
      vel[i3 + 2] = Math.sin(a) * Math.sin(incl) * sp
      if (trail) {
        const tb = i * trailLen * 3
        for (let s = 0; s < trailLen; s++) {
          trail[tb + s * 3] = wx; trail[tb + s * 3 + 1] = wy; trail[tb + s * 3 + 2] = wz
        }
      }
    }
  }
  function spawn() {
    const i = life.findIndex((l) => l <= 0)
    if (i < 0) return
    maxLife[i] = Math.max(0.05, props.lifetime * (1 - (props.lifetimeJitter ?? 0.3) * Math.random()))
    life[i] = maxLife[i]
    const i3 = i * 3
    pos[i3] = pos[i3 + 1] = pos[i3 + 2] = 0
    const sp = props.speed * (1 - (props.speedJitter ?? 0.3) * Math.random())
    const a = THREE.MathUtils.degToRad(props.spreadDeg ?? 20) * Math.sqrt(Math.random())
    const t = Math.random() * Math.PI * 2
    vel[i3] = Math.sin(a) * Math.cos(t) * sp
    vel[i3 + 1] = Math.cos(a) * sp
    vel[i3 + 2] = Math.sin(a) * Math.sin(t) * sp
    if (trail) {
      const tb = i * trailLen * 3
      for (let s = 0; s < trailLen; s++) {
        trail[tb + s * 3] = pos[i3]; trail[tb + s * 3 + 1] = pos[i3 + 1]; trail[tb + s * 3 + 2] = pos[i3 + 2]
      }
    }
  }
  return {
    points: display,
    display,
    subEmitterOn: subOn,
    cap,
    pos,
    vel,
    life,
    aliveF,
    trail,
    trailLen,
    gpuTier: false,
    update(dt) {
      if (this.gpuTier && particleGpuKernels) {
        const k = particleGpuKernels.find((x) => x.ps === this)
        if (k) {
          const prob = Math.min(1, ((props.rate ?? 40) * dt) / cap)
          if (prob > 0) {
            k.spawnProbU.value = prob
            k.speedU.value = props.speed ?? 2.5
            k.seedU.value = k.seed++
            renderer.compute(k.emit)
            for (let i = 0; i < cap; i++) {
              if (aliveF[i] > 0.5 && life[i] <= 0) {
                life[i] = props.lifetime ?? 1.6
                maxLife[i] = life[i]
              }
            }
          }
          for (let i = 0; i < cap; i++) aliveF[i] = life[i] > 0 ? 1 : 0
          k.dtU.value = dt
          k.gravityU.value = (props.gravity ?? -1) * dt
          k.dragU.value = props.drag ?? 0.5
          renderer.compute(k.integrate)
          if (trail && k.trailShift) renderer.compute(k.trailShift)
          else if (trail) { for (let i = 0; i < cap; i++) if (life[i] > 0) shiftTrail(i) }
          if (!isRibbon) geo.attributes.position.needsUpdate = true
        }
      }
      if (!this.gpuTier) {
        acc += (props.rate ?? 40) * dt
        while (acc >= 1) { acc -= 1; spawn() }
      }
      const drag = Math.max(0, 1 - (props.drag ?? 0.5) * dt)
      for (let i = 0; i < cap; i++) {
        if (life[i] <= 0) continue
        life[i] -= dt
        const i3 = i * 3
        if (life[i] <= 0 && subOn && se.onDeath) spawnBurstAt(pos[i3], pos[i3 + 1], pos[i3 + 2])
        if (!this.gpuTier) {
          vel[i3 + 1] += (props.gravity ?? -1) * dt
          vel[i3] *= drag; vel[i3 + 1] *= drag; vel[i3 + 2] *= drag
          pos[i3] += vel[i3] * dt; pos[i3 + 1] += vel[i3 + 1] * dt; pos[i3 + 2] += vel[i3 + 2] * dt
          if (trail) shiftTrail(i)
        }
        const f = 1 - life[i] / maxLife[i]
        tmp.copy(c1).lerp(c2, f)
        if (!isRibbon) {
          col[i3] = tmp.r; col[i3 + 1] = tmp.g; col[i3 + 2] = tmp.b
          if (life[i] <= 0) pos[i3 + 1] = -9999
        } else if (life[i] <= 0) {
          pos[i3 + 1] = -9999
        }
      }
      if (isRibbon) buildRibbon()
      else {
        geo.attributes.position.needsUpdate = true
        geo.attributes.color.needsUpdate = true
      }
    },
  }
}

function instantiate(sa) {
  const root = new THREE.Group()
  root.position.fromArray(sa.transform.position)
  root.rotation.set(...sa.transform.rotation)
  root.scale.fromArray(sa.transform.scale)
  root.visible = sa.visible !== false
  const actor = { id: sa.id, name: sa.name, type: sa.type, root, data: sa, mesh: null, autoload: (sa.tags ?? []).some((t) => String(t).toLowerCase() === 'autoload') }

  if (sa.type === 'StaticMesh') {
    const mesh = new THREE.Mesh(buildGeometry(sa.geometry), buildMaterial(sa.material, !!sa.bakedAO))
    mesh.castShadow = sa.castShadow !== false
    mesh.receiveShadow = sa.receiveShadow !== false
    if (sa.geometry === 'plane') mesh.rotation.x = -Math.PI / 2
    actor.mesh = mesh
    root.add(mesh)
    applyBakedAO(root, sa)
    applyBakedAOMap(root, sa)
  } else if (sa.type === 'CustomMesh' && sa.customGeometry) {
    const g = sa.customGeometry
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(g.positions, 3))
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.normals, 3))
    if (g.index) geo.setIndex(g.index)
    const mesh = new THREE.Mesh(geo, buildMaterial(sa.material, !!sa.bakedAO))
    mesh.castShadow = sa.castShadow !== false
    mesh.receiveShadow = sa.receiveShadow !== false
    actor.mesh = mesh
    root.add(mesh)
    applyBakedAO(root, sa)
    applyBakedAOMap(root, sa)
  } else if (sa.type === 'ImportedMesh' && sa.assetId && gltfAssets[sa.assetId]) {
    const inst = gltfAssets[sa.assetId].clone(true)
    inst.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (!actor.mesh) actor.mesh = o } })
    root.add(inst)
    applyBakedAO(root, sa)
    applyBakedAOMap(root, sa)
  } else if (sa.type === 'DirectionalLight') {
    const l = new THREE.DirectionalLight(sa.light?.color ?? '#fff', sa.light?.intensity ?? 2)
    l.castShadow = true
    l.shadow.mapSize.set(2048, 2048)
    Object.assign(l.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30 })
    root.add(l)
  } else if (sa.type === 'PointLight') {
    root.add(new THREE.PointLight(sa.light?.color ?? '#fff', sa.light?.intensity ?? 10, sa.light?.distance ?? 0, sa.light?.decay ?? 2))
  } else if (sa.type === 'SpotLight') {
    const l = new THREE.SpotLight(sa.light?.color ?? '#fff', sa.light?.intensity ?? 20, sa.light?.distance ?? 0, sa.light?.angle ?? 0.5, sa.light?.penumbra ?? 0.3)
    l.target.position.set(0, -1, 0); root.add(l, l.target)
  } else if (sa.type === 'AmbientLight') {
    root.add(new THREE.AmbientLight(sa.light?.color ?? '#404a5a', sa.light?.intensity ?? 1))
  } else if (sa.type === 'ParticleEmitter' && sa.particles) {
    const ps = makeParticles(sa.particles)
    root.add(ps.points)
    particleSystems.push(ps)
  } else if (sa.type === 'FoliageLayer' && sa.foliage) {
    const f = sa.foliage
    const mesh = new THREE.InstancedMesh(buildGeometry(f.geometry), new THREE.MeshStandardMaterial({ color: f.color, roughness: 0.85 }), Math.max(1, f.instances.length))
    mesh.castShadow = true
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sv = new THREE.Vector3()
    f.instances.forEach(([x, y, z, sc, ry], i) => {
      e.set(0, ry, 0); q.setFromEuler(e); v.set(x, y, z); sv.setScalar(sc)
      m4.compose(v, q, sv); mesh.setMatrixAt(i, m4)
    })
    mesh.count = f.instances.length
    root.add(mesh)
    actor.mesh = mesh
  } else if (sa.type === 'Widget3D' && sa.widget3D) {
    const W = sa.widget3D
    const wPx = Math.max(32, Math.round((W.width ?? 2) * 100))
    const hPx = Math.max(32, Math.round((W.height ?? 1) * 100))
    let html = W.html ?? '<div>Widget</div>'
    if (W.hudWidgetId && LEVEL.hud) {
      const hw = LEVEL.hud.find((h) => h.id === W.hudWidgetId)
      if (hw) {
        if (hw.type === 'text') html = `<div style="padding:8px 12px;background:#1a1d24aa;border-radius:6px;color:${hw.color};font:14px system-ui;">${hw.text}</div>`
        else if (hw.type === 'bar') {
          const pct = Math.round((hw.value ?? 1) * 100)
          html = `<div style="width:160px;background:#2a2f38;border-radius:6px;overflow:hidden;height:20px;"><div style="width:${pct}%;height:100%;background:${hw.color};"></div></div>`
        } else html = `<button style="padding:8px 16px;background:${hw.color};color:#fff;border:none;border-radius:6px;">${hw.text}</button>`
      }
    }
    const canvas = document.createElement('canvas')
    canvas.width = wPx
    canvas.height = hPx
    const ctx = canvas.getContext('2d')
    const svg = `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="${wPx}" height="${hPx}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="width:${wPx}px;height:${hPx}px;overflow:hidden;">${html}</div></foreignObject></svg>`
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(W.width ?? 2, W.height ?? 1),
      new THREE.MeshBasicMaterial({ map: tex, transparent: (W.opacity ?? 1) < 1, opacity: W.opacity ?? 1, side: THREE.DoubleSide, depthWrite: false }),
    )
    mesh.userData.isWidget3D = true
    actor.mesh = mesh
    root.add(mesh)
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
    const img = new Image()
    img.onload = () => { ctx.drawImage(img, 0, 0, wPx, hPx); tex.needsUpdate = true }
    img.onerror = () => {
      ctx.fillStyle = '#1a1d24'; ctx.fillRect(0, 0, wPx, hPx)
      ctx.fillStyle = '#e8eaed'; ctx.font = '14px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText('Widget3D', wPx / 2, hPx / 2); tex.needsUpdate = true
    }
    img.src = url
  } else if (sa.type === 'Label3D' && sa.label3D) {
    const L = sa.label3D
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    const font = `600 ${L.fontSize}px system-ui, sans-serif`
    ctx.font = font
    const metrics = ctx.measureText(L.text || ' ')
    const pad = L.padding ?? 12
    canvas.width = Math.max(64, Math.ceil(metrics.width) + pad * 2)
    canvas.height = Math.max(32, L.fontSize + pad * 2)
    ctx.font = font
    if (L.background) { ctx.fillStyle = L.background; ctx.fillRect(0, 0, canvas.width, canvas.height) }
    ctx.fillStyle = L.color ?? '#fff'
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'center'
    ctx.fillText(L.text, canvas.width / 2, canvas.height / 2)
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    const aspect = canvas.width / canvas.height
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(aspect, 1),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false }),
    )
    mesh.userData.isLabel3D = true
    actor.mesh = mesh
    root.add(mesh)
  } else if (sa.type === 'Landscape' && sa.landscape) {
    const L = sa.landscape
    const geo = new THREE.PlaneGeometry(L.size, L.size, L.resolution, L.resolution)
    for (let i = 0; i < geo.attributes.position.count; i++) geo.attributes.position.setZ(i, L.heights[i] ?? 0)
    geo.computeVertexNormals()
    let mat
    if (L.weights && L.layerColors) {
      const cols = L.layerColors.map((c) => new THREE.Color(c))
      const vc = new Float32Array(geo.attributes.position.count * 3)
      for (let i = 0; i < geo.attributes.position.count; i++) {
        let r = 0, g = 0, b = 0
        for (let l = 0; l < 4; l++) { const w = L.weights[i * 4 + l] ?? 0; r += cols[l].r * w; g += cols[l].g * w; b += cols[l].b * w }
        vc[i * 3] = r; vc[i * 3 + 1] = g; vc[i * 3 + 2] = b
      }
      geo.setAttribute('color', new THREE.BufferAttribute(vc, 3))
      mat = new THREE.MeshStandardMaterial({ color: '#fff', roughness: 0.92, vertexColors: true })
    } else {
      mat = new THREE.MeshStandardMaterial({ color: L.color, roughness: 0.92 })
    }
    const mesh = new THREE.Mesh(geo, mat)
    mesh.rotation.x = -Math.PI / 2
    mesh.receiveShadow = true
    actor.mesh = mesh
    root.add(mesh)
    applyBakedAO(root, sa)
    applyBakedAOMap(root, sa)
  }
  scene.add(root)
  actors.set(sa.id, actor)
  return actor
}

function teardownActors() {
  for (const a of [...actors.values()]) {
    if (a.autoload) continue
    scene.remove(a.root)
    actors.delete(a.id)
  }
  particleSystems = []
  ticks = []
  bindings = []
  physWorld = null
}

function spawnActorsList(list) {
  for (const sa of list) instantiate(sa)
  for (const sa of list) {
    if (sa.parentId && actors.has(sa.parentId)) actors.get(sa.parentId).root.add(actors.get(sa.id).root)
  }
}

function spawnLevelActors(level) {
  spawnActorsList(level.actors)
}

function unloadCell(cx, cz) {
  const key = cellKey(cx, cz)
  const ids = cellActorIds.get(key)
  if (!ids) return
  for (const id of ids) {
    const a = actors.get(id)
    if (!a || a.autoload) continue
    scene.remove(a.root)
    actors.delete(id)
    ticks = ticks.filter(([act]) => act.id !== id)
    bindings = bindings.filter(([act]) => act.id !== id)
    particleSystems = particleSystems.filter((ps) => ps.points.parent !== a.root)
  }
  cellActorIds.delete(key)
  loadedCells.delete(key)
}

function loadCellActors(cx, cz) {
  if (!CELL_MANIFEST) return false
  const key = cellKey(cx, cz)
  if (loadedCells.has(key)) return true
  const list = CELL_MANIFEST[key]
  if (!list?.length) return false
  spawnActorsList(list)
  loadedCells.add(key)
  cellActorIds.set(key, list.map((sa) => sa.id))
  for (const sa of list) {
    const a = actors.get(sa.id)
    if (!a?.data.script) continue
    try {
      const fn = new Function('actor', 'api', 'THREE', `"use strict";\n${a.data.script}\nreturn { b: typeof onBeginPlay === 'function' ? onBeginPlay : null, t: typeof onTick === 'function' ? onTick : null }`)
      const h = fn(a, api, THREE)
      if (h.b) h.b()
      if (h.t) ticks.push([a, h.t])
    } catch (e) { console.warn(a.name, 'script error', e) }
  }
  return true
}

function syncCellsAround(camPos) {
  if (!CELL_MANIFEST) return
  const cfg = streamSettings()
  if (!cfg.enabled) return
  const camCell = worldToCell(camPos.x, camPos.z, cfg.gridSize)
  const want = new Set()
  for (let dx = -cfg.loadRadius; dx <= cfg.loadRadius; dx++) {
    for (let dz = -cfg.loadRadius; dz <= cfg.loadRadius; dz++) {
      want.add(cellKey(camCell[0] + dx, camCell[1] + dz))
    }
  }
  for (const key of want) {
    const p = key.split(',')
    loadCellActors(parseInt(p[0], 10), parseInt(p[1], 10))
  }
  for (const key of [...loadedCells]) {
    if (!want.has(key)) {
      const p = key.split(',')
      unloadCell(parseInt(p[0], 10), parseInt(p[1], 10))
    }
  }
}

// ---- pawn ----
const pawnCam = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 5000)
let yaw = 0, pitch = 0
const euler = new THREE.Euler(0, 0, 0, 'YXZ')
const feet = new THREE.Vector3(0, 0, 8)
let vy = 0, grounded = false, pawnMode = 'fly'
const ray = new THREE.Raycaster()
function groundAt(p) {
  ray.set(new THREE.Vector3(p.x, p.y + 1.2, p.z), new THREE.Vector3(0, -1, 0))
  ray.far = 80
  const meshes = []
  for (const a of actors.values()) a.root.traverse((o) => { if (o.isMesh) meshes.push(o) })
  const hit = ray.intersectObjects(meshes, false)[0]
  return hit ? hit.point.y : null
}
addEventListener('mousemove', (e) => {
  if (!renderer?.domElement) return
  if (document.pointerLockElement !== renderer.domElement) return
  yaw -= e.movementX * 0.0023
  pitch = Math.max(-1.45, Math.min(1.45, pitch - e.movementY * 0.0023))
})
function bindPawnInput() {
  if (!renderer?.domElement) return
  renderer.domElement.addEventListener('click', () => renderer.domElement.requestPointerLock())
}

function resetPawnFromStart() {
  const start = LEVEL.actors.find((a) => a.type === 'PlayerStart')
  pawnMode = start?.pawnMode ?? 'fly'
  if (start) {
    feet.fromArray(start.transform.position)
    pawnCam.position.copy(feet).add(new THREE.Vector3(0, 1.65, 0))
    yaw = start.transform.rotation?.[1] ?? 0
    pitch = 0
  }
}

function updatePawn(dt) {
  const move = new THREE.Vector3()
  if (keys.has('KeyW')) move.z -= 1
  if (keys.has('KeyS')) move.z += 1
  if (keys.has('KeyA')) move.x -= 1
  if (keys.has('KeyD')) move.x += 1
  euler.set(pitch, yaw, 0)
  if (pawnMode === 'fly') {
    if (keys.has('Space')) move.y += 1
    if (keys.has('KeyC')) move.y -= 1
    pawnCam.quaternion.setFromEuler(euler)
    if (move.lengthSq()) {
      move.normalize()
      const sp = keys.has('ShiftLeft') ? 18 : 6
      const fwd = new THREE.Vector3(); pawnCam.getWorldDirection(fwd)
      const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize()
      pawnCam.position.addScaledVector(fwd, -move.z * sp * dt)
      pawnCam.position.addScaledVector(right, move.x * sp * dt)
      pawnCam.position.y += move.y * sp * dt
    }
    return
  }
  const sp = (keys.has('ShiftLeft') ? 9.5 : 5)
  if (move.lengthSq()) {
    move.normalize()
    const sin = Math.sin(yaw), cos = Math.cos(yaw)
    feet.x += (move.x * cos + move.z * sin) * sp * dt
    feet.z += (-move.x * sin + move.z * cos) * sp * dt
  }
  vy -= 22 * dt
  if (grounded && keys.has('Space')) { vy = 8.5; grounded = false }
  feet.y += vy * dt
  const g = groundAt(feet)
  if (g !== null && feet.y <= g + 0.02 && vy <= 0) { feet.y = g; vy = 0; grounded = true } else grounded = false
  if (feet.y < -60) { feet.set(0, 2, 8); vy = 0 }
  if (pawnMode === 'thirdperson') {
    const head = feet.clone().add(new THREE.Vector3(0, 1.6, 0))
    const back = new THREE.Vector3(0, 0, 1).applyEuler(euler).multiplyScalar(4.5)
    pawnCam.position.copy(head).add(back)
    pawnCam.lookAt(head)
  } else {
    pawnCam.position.copy(feet).add(new THREE.Vector3(0, 1.65, 0))
    pawnCam.quaternion.setFromEuler(euler)
  }
}

// ---- physics (optional) ----
async function startPhysics() {
  try {
    const R = await import('@dimforge/rapier3d-compat')
    await R.init()
    physWorld = new R.World({ x: 0, y: -9.81, z: 0 })
    for (const a of actors.values()) {
      const p = a.data.physics
      if (!p || p.mode === 'none' || !a.mesh) continue
      const desc = p.mode === 'dynamic' ? R.RigidBodyDesc.dynamic().setAdditionalMass(p.mass ?? 1) : R.RigidBodyDesc.fixed()
      const wp = new THREE.Vector3(); a.root.getWorldPosition(wp)
      const wq = new THREE.Quaternion(); a.root.getWorldQuaternion(wq)
      desc.setTranslation(wp.x, wp.y, wp.z).setRotation({ x: wq.x, y: wq.y, z: wq.z, w: wq.w })
      const body = physWorld.createRigidBody(desc)
      let col
      const sc = new THREE.Vector3(); a.root.getWorldScale(sc)
      if (a.data.geometry === 'sphere') col = R.ColliderDesc.ball(0.5 * Math.max(sc.x, sc.y, sc.z))
      else if (a.data.geometry === 'plane') col = R.ColliderDesc.cuboid(0.5 * sc.x, 0.02, 0.5 * sc.z)
      else if (a.type === 'Landscape') {
        const geo = a.mesh.geometry
        const verts = new Float32Array(geo.attributes.position.array.length)
        const v = new THREE.Vector3()
        for (let i = 0; i < geo.attributes.position.count; i++) {
          v.fromBufferAttribute(geo.attributes.position, i); a.mesh.localToWorld(v)
          verts[i * 3] = v.x; verts[i * 3 + 1] = v.y; verts[i * 3 + 2] = v.z
        }
        col = R.ColliderDesc.trimesh(verts, new Uint32Array(geo.index.array))
        body.setTranslation({ x: 0, y: 0, z: 0 })
      } else {
        const box = new THREE.Box3().setFromObject(a.mesh)
        const size = new THREE.Vector3(); box.getSize(size)
        col = R.ColliderDesc.cuboid(Math.max(size.x, 0.1) / 2, Math.max(size.y, 0.1) / 2, Math.max(size.z, 0.1) / 2)
      }
      col.setFriction(p.friction ?? 0.5).setRestitution(p.restitution ?? 0.2)
      physWorld.createCollider(col, body)
      if (p.mode === 'dynamic') bindings.push([a, body])
    }
  } catch (e) {
    console.warn('physics unavailable:', e)
  }
}

// ---- audio (sequencer audio tracks) ----
let audioCtx = null
const soundBuffers = new Map()
/** @type {{ src: AudioBufferSourceNode, gain: GainNode, keys: object[] }[]} */
let seqAudioVoices = []
let seqAudioLastT = -1

async function loadSounds(level) {
  if (!level.sounds || !Object.keys(level.sounds).length) return
  if (!audioCtx) audioCtx = new AudioContext()
  if (audioCtx.state === 'suspended') void audioCtx.resume()
  for (const [name, b64] of Object.entries(level.sounds)) {
    if (soundBuffers.has(name)) continue
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    soundBuffers.set(name, await audioCtx.decodeAudioData(bytes.buffer))
  }
}

function stopSeqAudio() {
  for (const v of seqAudioVoices) {
    try { v.src.stop() } catch (_) { /* already stopped */ }
    v.src.disconnect()
    v.gain.disconnect()
  }
  seqAudioVoices = []
}

function sampleSeqValue(keys, t) {
  if (!keys.length) return null
  if (t <= keys[0].t) return keys[0].v
  if (t >= keys[keys.length - 1].t) return keys[keys.length - 1].v
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]
    const b = keys[i + 1]
    if (t >= a.t && t <= b.t) {
      const f = (b.t - a.t) ? (t - a.t) / (b.t - a.t) : 0
      if (typeof a.v === 'number' && typeof b.v === 'number') return a.v + (b.v - a.v) * f
      if (Array.isArray(a.v) && Array.isArray(b.v)) return a.v.map((av, j) => av + ((b.v[j] ?? av) - av) * f)
      return a.v
    }
  }
  return null
}

function startSeqAudioVoice(soundName, keys, t) {
  if (!audioCtx) return
  const buf = soundBuffers.get(soundName)
  if (!buf) return
  const startT = keys[0].t
  if (t < startT) return
  const offset = t - startT
  const vol = sampleSeqValue(keys, t)
  const volume = typeof vol === 'number' ? vol : 1
  const src = audioCtx.createBufferSource()
  const gain = audioCtx.createGain()
  src.buffer = buf
  src.loop = true
  gain.gain.value = volume
  src.connect(gain)
  gain.connect(audioCtx.destination)
  src.start(0, Math.min(offset, Math.max(0, buf.duration - 0.001)))
  seqAudioVoices.push({ src, gain, keys })
}

function updateSeqAudio(t) {
  if (!audioCtx) return
  const seq = LEVEL.sequence
  if (!seq) return
  const wrapped = seqAudioLastT > t
  if (wrapped || seqAudioVoices.length === 0) {
    stopSeqAudio()
    for (const tr of seq.tracks) {
      if (tr.trackType !== 'audio' || !tr.keys.length) continue
      startSeqAudioVoice(tr.actorId, tr.keys, t)
    }
  } else {
    for (const v of seqAudioVoices) {
      const vol = sampleSeqValue(v.keys, t)
      v.gain.gain.value = typeof vol === 'number' ? vol : 1
    }
  }
  seqAudioLastT = t
}

// ---- scripts & behaviors ----
const api = {
  log: (...a) => console.log('[lotus]', ...a),
  isKeyDown: (c) => keys.has(c),
  keyJustPressed: (c) => pressed.has(c),
  getActor: (n) => [...actors.values()].find((a) => a.name === n),
  time: () => clock,
  pawnPosition: () => (pawnMode === 'fly' ? pawnCam.position : feet),
  async loadCell(cx, cz) {
    const ok = loadCellActors(cx, cz)
    if (!ok) api.log('loadCell: empty or missing', cx, cz)
    else api.log('loadCell:', cx, cz)
    return ok
  },
  async loadLevel(name) {
    if (loadingLevel) return false
    const key = String(name).trim().toLowerCase()
    const resolved = LEVELS[key] ?? LEVELS[name] ?? (key === 'main' ? LEVELS[MAIN_KEY] : null)
    if (!resolved) {
      api.log('loadLevel: unknown level', name)
      return false
    }
    loadingLevel = true
    try {
      teardownActors()
      LEVEL = resolved
      applyEnvironment()
      await loadAssets(LEVEL)
      await loadSounds(LEVEL)
      stopSeqAudio()
      spawnLevelActors(LEVEL)
      resetPawnFromStart()
      await startPhysics()
      compileScripts()
      api.log('loadLevel:', name)
      return true
    } catch (e) {
      console.warn('loadLevel failed:', e)
      return false
    } finally {
      loadingLevel = false
    }
  },
}
function compileScripts() {
  ticks = []
  for (const a of actors.values()) {
    const src = a.data.script
    if (!src) continue
    try {
      const fn = new Function('actor', 'api', 'THREE', `"use strict";\n${src}\nreturn { b: typeof onBeginPlay === 'function' ? onBeginPlay : null, t: typeof onTick === 'function' ? onTick : null }`)
      const h = fn(a, api, THREE)
      if (h.b) h.b()
      if (h.t) ticks.push([a, h.t])
    } catch (e) { console.warn(a.name, 'script error', e) }
  }
}

// ---- boot ----
const overlay = document.getElementById('overlay')
let perfBadge = document.getElementById('perf-badge')
if (!perfBadge) {
  perfBadge = document.createElement('div')
  perfBadge.id = 'perf-badge'
  perfBadge.style.cssText =
    'position:fixed;top:8px;right:8px;padding:4px 8px;font:11px/1.4 monospace;background:rgba(0,0,0,.55);color:#9fd3ff;border-radius:4px;pointer-events:none;z-index:20'
  document.body.appendChild(perfBadge)
}
let perfFpsAcc = 0
let perfFpsFrames = 0
let perfFps = 0
async function boot() {
  const created = await createPlayRenderer()
  renderer = created.renderer
  playRenderTier = created.tier
  bindPawnInput()
  applyEnvironment()
  await loadAssets(LEVEL)
  await loadSounds(LEVEL)
  spawnLevelActors(LEVEL)
  if (CELL_MANIFEST) {
    const start = LEVEL.actors.find((a) => a.type === 'PlayerStart')
    const p = start ? new THREE.Vector3(...start.transform.position) : feet.clone()
    syncCellsAround(p)
  }
  resetPawnFromStart()
  await startPhysics()
  compileScripts()
  exportTslPipeline = await createExportTSLPipeline(renderer, scene, pawnCam)
  await bindExportParticleCompute()
  const gpuParticleCount = particleSystems.filter((p) => p.gpuTier).length
  const particleTier =
    (LEVEL.environment?.particleBackend ?? 'cpu') === 'gpu' && playRenderTier === 'webgpu'
      ? gpuParticleCount > 0
        ? `GPU particles ×${gpuParticleCount}`
        : 'GPU particles (bind pending)'
      : 'CPU particles'
  overlay.textContent =
    (playRenderTier === 'webgpu' ? (exportTslPipeline ? 'WebGPU TSL · ' : 'WebGPU · ') : '') +
    `${particleTier} · Click to play — WASD + mouse · Space jump · Shift sprint`
  const perfMinFps = EXPORT.perfMinFps ?? 24
  window.__LOTUS_EXPORT_PERF__ = {
    tier: playRenderTier,
    particleTier,
    gpuParticleCount,
    perfMinFps,
    perfPass: null,
    fps: 0,
  }
  const c = new THREE.Clock()
  renderer.setAnimationLoop(() => {
    const dt = Math.min(c.getDelta(), 0.1)
    clock += dt
    perfFpsAcc += dt
    perfFpsFrames++
    if (perfFpsAcc >= 0.5) {
      perfFps = Math.round(perfFpsFrames / perfFpsAcc)
      perfFpsAcc = 0
      perfFpsFrames = 0
      const gpuN = particleSystems.filter((p) => p.gpuTier).length
      const perfGate = window.__LOTUS_EXPORT_PERF__
      if (perfGate) {
        perfGate.fps = perfFps
        perfGate.perfPass = perfFps >= perfGate.perfMinFps
      }
      const gateOk = perfGate?.perfPass !== false
      perfBadge.textContent = `${perfFps} fps · ${playRenderTier}${gpuN ? ` · GPU×${gpuN}` : ''}${gateOk ? '' : ' · PERF!'}`
    }
    if (physWorld) {
      physWorld.timestep = Math.min(dt, 1 / 30)
      physWorld.step()
      for (const [a, body] of bindings) {
        const t = body.translation(), r = body.rotation()
        a.root.position.set(t.x, t.y, t.z)
        a.root.quaternion.set(r.x, r.y, r.z, r.w)
      }
    }
    for (const [a, t] of ticks) { try { t(dt) } catch (e) { /* script error */ } }
    for (const a of actors.values()) {
      for (const b of a.data.behaviors ?? []) {
        if (b.type === 'rotator') { a.root.rotation.x += b.speedX * dt; a.root.rotation.y += b.speedY * dt; a.root.rotation.z += b.speedZ * dt }
      }
    }
    const seq = LEVEL.sequence
    if (seq && seq.autoPlay && seq.tracks.length) {
      const t = clock % seq.duration
      let hasAudio = false
      for (const tr of seq.tracks) {
        if (tr.trackType === 'audio') { hasAudio = true; continue }
        const a = actors.get(tr.actorId)
        if (!a || !tr.keys.length) continue
        let v
        const ks = tr.keys
        if (t <= ks[0].t) v = ks[0].v
        else if (t >= ks[ks.length - 1].t) v = ks[ks.length - 1].v
        else for (let i = 0; i < ks.length - 1; i++) {
          if (t >= ks[i].t && t <= ks[i + 1].t) {
            const f = (t - ks[i].t) / (ks[i + 1].t - ks[i].t || 1)
            v = [0, 1, 2].map((j) => ks[i].v[j] + (ks[i + 1].v[j] - ks[i].v[j]) * f)
            break
          }
        }
        if (!v) continue
        if (tr.property === 'position') a.root.position.fromArray(v)
        else if (tr.property === 'rotation') a.root.rotation.set(v[0], v[1], v[2])
        else a.root.scale.fromArray(v)
      }
      if (hasAudio) updateSeqAudio(t)
    }
    for (const ps of particleSystems) ps.update(dt)
    if (particleSystems.some((p) => p.trailLen > 0)) {
      let trailTris = 0
      for (const ps of particleSystems) {
        if (!ps.trailLen || !ps.display?.geometry) continue
        trailTris = Math.max(trailTris, ps.display.geometry.drawRange?.count ?? 0)
      }
      if (trailTris > 0) window.__LOTUS_EXPORT_RIBBON_QA__ = { trailTris, ribbonSystems: particleSystems.filter((p) => p.trailLen > 0).length }
    }
    const subSystems = particleSystems.filter((p) => p.subEmitterOn)
    if (subSystems.length) window.__LOTUS_EXPORT_SUB_EMITTER_QA__ = { systems: subSystems.length }
    updatePawn(dt)
    if (CELL_MANIFEST) syncCellsAround(pawnCam.position)
    applyStreamingVisibility(pawnCam.position)
    // Widget3D export fallback — canvas billboard planes (no CSS3D)
    const camPos = pawnCam.position
    for (const a of actors.values()) {
      if (a.data.type !== 'Widget3D' || !a.data.widget3D?.billboard || !a.mesh) continue
      const obj = new THREE.Vector3(); a.root.getWorldPosition(obj)
      const parentQ = new THREE.Quaternion(); a.mesh.parent?.getWorldQuaternion(parentQ)
      const invQ = parentQ.clone().invert()
      const lookM = new THREE.Matrix4().lookAt(obj, camPos, new THREE.Vector3(0, 1, 0))
      const lookQ = new THREE.Quaternion().setFromRotationMatrix(lookM)
      a.mesh.quaternion.copy(invQ).multiply(lookQ)
    }
    pressed.clear()
    if (exportTslPipeline) {
      exportTslPipeline.setCamera(pawnCam)
      exportTslPipeline.render()
    } else {
      renderer.render(scene, pawnCam)
    }
  })
}
addEventListener('resize', () => {
  renderer.setPixelRatio(pixelRatio)
  renderer.setSize(innerWidth, innerHeight)
  pawnCam.aspect = innerWidth / innerHeight
  pawnCam.updateProjectionMatrix()
})
boot()