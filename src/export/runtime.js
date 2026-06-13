/* Vektra Engine — standalone playable runtime. Injected into exported HTML
   alongside the level JSON. Loads three.js (+ optional Rapier physics) from
   CDN and runs the level: scripts, behaviors, particles, foliage, landscape,
   pawn controllers. Supports multi-level manifests + api.loadLevel(). */
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { Sky } from 'three/addons/objects/Sky.js'

const LEVELS = window.__VEKTRA_LEVELS__ ?? (window.__VEKTRA_LEVEL__ ? { main: window.__VEKTRA_LEVEL__ } : null)
const MAIN_KEY = window.__VEKTRA_MAIN__ ?? 'main'
const EXPORT = window.__VEKTRA_EXPORT__ ?? { quality: 'desktop' }
if (!LEVELS || !LEVELS[MAIN_KEY]) throw new Error('Vektra: no level data')

let LEVEL = LEVELS[MAIN_KEY]
const pixelRatio = EXPORT.pixelRatio ?? (EXPORT.quality === 'mobile' ? 1 : Math.min(devicePixelRatio, 2))

const renderer = new THREE.WebGLRenderer({ antialias: EXPORT.quality !== 'mobile' })
renderer.shadowMap.enabled = true
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = LEVEL.environment.exposure ?? 0.75
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.setPixelRatio(pixelRatio)
renderer.setSize(innerWidth, innerHeight)
document.body.appendChild(renderer.domElement)

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
  renderer.toneMappingExposure = env.exposure ?? 0.75
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
function buildMaterial(m) {
  return new THREE.MeshStandardMaterial({
    color: m?.color ?? '#9da4ae', roughness: m?.roughness ?? 0.6, metalness: m?.metalness ?? 0.1,
    emissive: m?.emissive ?? '#000', emissiveIntensity: m?.emissiveIntensity ?? 1,
    transparent: !!m?.transparent || (m?.opacity ?? 1) < 1, opacity: m?.opacity ?? 1, wireframe: !!m?.wireframe,
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

// minimal particle sim
function makeParticles(props) {
  const cap = Math.min(props.maxParticles ?? 500, 3000)
  const pos = new Float32Array(cap * 3), col = new Float32Array(cap * 3)
  const vel = new Float32Array(cap * 3), life = new Float32Array(cap), maxLife = new Float32Array(cap)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1000)
  const mat = new THREE.PointsMaterial({
    size: (props.sizeStart + props.sizeEnd) / 2, vertexColors: true, transparent: true, opacity: 0.9,
    depthWrite: false, blending: props.additive ? THREE.AdditiveBlending : THREE.NormalBlending, sizeAttenuation: true,
  })
  const points = new THREE.Points(geo, mat)
  points.frustumCulled = false
  const c1 = new THREE.Color(props.colorStart), c2 = new THREE.Color(props.colorEnd), tmp = new THREE.Color()
  let acc = 0
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
  }
  return {
    points,
    update(dt) {
      acc += (props.rate ?? 40) * dt
      while (acc >= 1) { acc -= 1; spawn() }
      const drag = Math.max(0, 1 - (props.drag ?? 0.5) * dt)
      for (let i = 0; i < cap; i++) {
        if (life[i] <= 0) continue
        life[i] -= dt
        const i3 = i * 3
        vel[i3 + 1] += (props.gravity ?? -1) * dt
        vel[i3] *= drag; vel[i3 + 1] *= drag; vel[i3 + 2] *= drag
        pos[i3] += vel[i3] * dt; pos[i3 + 1] += vel[i3 + 1] * dt; pos[i3 + 2] += vel[i3 + 2] * dt
        const f = 1 - life[i] / maxLife[i]
        tmp.copy(c1).lerp(c2, f)
        col[i3] = tmp.r; col[i3 + 1] = tmp.g; col[i3 + 2] = tmp.b
        if (life[i] <= 0) { pos[i3 + 1] = -9999 }
      }
      geo.attributes.position.needsUpdate = true
      geo.attributes.color.needsUpdate = true
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
    const mesh = new THREE.Mesh(buildGeometry(sa.geometry), buildMaterial(sa.material))
    mesh.castShadow = sa.castShadow !== false
    mesh.receiveShadow = sa.receiveShadow !== false
    if (sa.geometry === 'plane') mesh.rotation.x = -Math.PI / 2
    actor.mesh = mesh
    root.add(mesh)
  } else if (sa.type === 'ImportedMesh' && sa.assetId && gltfAssets[sa.assetId]) {
    const inst = gltfAssets[sa.assetId].clone(true)
    inst.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (!actor.mesh) actor.mesh = o } })
    root.add(inst)
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

function spawnLevelActors(level) {
  for (const sa of level.actors) instantiate(sa)
  for (const sa of level.actors) {
    if (sa.parentId && actors.has(sa.parentId)) actors.get(sa.parentId).root.add(actors.get(sa.id).root)
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
  if (document.pointerLockElement !== renderer.domElement) return
  yaw -= e.movementX * 0.0023
  pitch = Math.max(-1.45, Math.min(1.45, pitch - e.movementY * 0.0023))
})
renderer.domElement.addEventListener('click', () => renderer.domElement.requestPointerLock())

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

// ---- scripts & behaviors ----
const api = {
  log: (...a) => console.log('[vektra]', ...a),
  isKeyDown: (c) => keys.has(c),
  keyJustPressed: (c) => pressed.has(c),
  getActor: (n) => [...actors.values()].find((a) => a.name === n),
  time: () => clock,
  pawnPosition: () => (pawnMode === 'fly' ? pawnCam.position : feet),
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
async function boot() {
  await loadAssets(LEVEL)
  spawnLevelActors(LEVEL)
  resetPawnFromStart()
  await startPhysics()
  compileScripts()
  overlay.textContent = 'Click to play — WASD + mouse · Space jump · Shift sprint'
  const c = new THREE.Clock()
  renderer.setAnimationLoop(() => {
    const dt = Math.min(c.getDelta(), 0.1)
    clock += dt
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
      for (const tr of seq.tracks) {
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
    }
    for (const ps of particleSystems) ps.update(dt)
    updatePawn(dt)
    pressed.clear()
    renderer.render(scene, pawnCam)
  })
}
addEventListener('resize', () => {
  renderer.setPixelRatio(pixelRatio)
  renderer.setSize(innerWidth, innerHeight)
  pawnCam.aspect = innerWidth / innerHeight
  pawnCam.updateProjectionMatrix()
})
boot()