import * as THREE from 'three'
import { Actor, nextActorId } from './Actor'
import { DEFAULT_PARTICLES } from './particles'
import { createParticleSystem, type ParticleBackend } from './particlesGPU'
import type { ActorType, CameraProps, GeometryKind, Label3DProps, LightProps, MaterialProps } from './types'
import {
  DEFAULT_FOLIAGE,
  DEFAULT_LABEL3D,
  DEFAULT_MATERIAL,
  DEFAULT_PHYSICS,
  DEFAULT_POST_PROCESS,
  DEFAULT_RAY_CAST,
  DEFAULT_SOUND_EMITTER,
  DEFAULT_TIMER,
  DEFAULT_PATH_FOLLOW,
  DEFAULT_AREA3D,
} from './types'
import { DEFAULT_PATH3D, rebuildPath3DVisual } from './path3d'
import {
  atlasIndexForRule,
  atlasUvRect,
  createAutotileAtlasTexture,
  DEFAULT_ATLAS_COLS,
  DEFAULT_ATLAS_ROWS,
  patchMaterialForAtlasUv,
  type AtlasUvRect,
} from './autotileAtlas'
import {
  atlasSlotForMask,
  createAutotileSheetTexture,
  getAtlasSheet,
} from './autotileSheetImport'
import {
  autotileRuleForMask,
  ensureGridLayerVisibility,
  GRID_TILE_KINDS,
  gridCellKind,
  gridNeighborKinds,
  previewAutotileExtendedMask,
  previewAutotileMask,
  syncGridInstancesFromLayers,
  type GridLayerCell,
  type GridTileKind,
} from './gridMap'
import type { FoliageProps } from './types'

export function buildGeometry(kind: GeometryKind): THREE.BufferGeometry {
  switch (kind) {
    case 'box':
      return new THREE.BoxGeometry(1, 1, 1)
    case 'sphere':
      return new THREE.SphereGeometry(0.5, 32, 16)
    case 'cylinder':
      return new THREE.CylinderGeometry(0.5, 0.5, 1, 32)
    case 'cone':
      return new THREE.ConeGeometry(0.5, 1, 32)
    case 'plane':
      return new THREE.PlaneGeometry(1, 1, 1, 1)
    case 'torus':
      return new THREE.TorusGeometry(0.5, 0.2, 16, 48)
    case 'capsule':
      return new THREE.CapsuleGeometry(0.3, 0.6, 8, 16)
    case 'icosahedron':
      return new THREE.IcosahedronGeometry(0.5, 0)
  }
}

export function buildMaterial(props: MaterialProps): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(props.color),
    roughness: props.roughness,
    metalness: props.metalness,
    emissive: new THREE.Color(props.emissive),
    emissiveIntensity: props.emissiveIntensity,
    wireframe: props.wireframe,
    opacity: props.opacity,
    transparent: props.transparent,
  })
}

export function applyMaterialProps(mat: THREE.MeshStandardMaterial, props: MaterialProps) {
  mat.color.set(props.color)
  mat.roughness = props.roughness
  mat.metalness = props.metalness
  mat.emissive.set(props.emissive)
  mat.emissiveIntensity = props.emissiveIntensity
  mat.wireframe = props.wireframe
  mat.opacity = props.opacity
  mat.transparent = props.transparent || props.opacity < 1
  mat.needsUpdate = true
}

export function createStaticMeshActor(kind: GeometryKind, name: string, id = nextActorId()): Actor {
  const actor = new Actor(id, name, 'StaticMesh')
  actor.geometryKind = kind
  actor.materialProps = { ...DEFAULT_MATERIAL }
  actor.physicsProps = { ...DEFAULT_PHYSICS }
  const mesh = new THREE.Mesh(buildGeometry(kind), buildMaterial(actor.materialProps))
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.userData.actorId = id
  if (kind === 'plane') mesh.rotation.x = -Math.PI / 2
  actor.mesh = mesh
  actor.root.add(mesh)
  return actor
}

const DEFAULT_LIGHT: Record<string, LightProps> = {
  RectLight: { color: '#ffffff', intensity: 8, width: 3, height: 2 },
  PointLight: { color: '#ffffff', intensity: 10, distance: 0, decay: 2, castShadow: true },
  SpotLight: { color: '#ffffff', intensity: 20, distance: 0, decay: 2, angle: 0.5, penumbra: 0.3, castShadow: true },
  DirectionalLight: { color: '#ffffff', intensity: 2, castShadow: true },
  AmbientLight: { color: '#404a5a', intensity: 1 },
}

export function createLightActor(type: ActorType, name: string, id = nextActorId()): Actor {
  const actor = new Actor(id, name, type)
  const props = { ...DEFAULT_LIGHT[type] }
  actor.lightProps = props

  let light: THREE.Light
  let helper: THREE.Object3D | undefined
  switch (type) {
    case 'PointLight': {
      const l = new THREE.PointLight(props.color, props.intensity, props.distance, props.decay)
      l.castShadow = !!props.castShadow
      helper = new THREE.PointLightHelper(l, 0.3)
      light = l
      break
    }
    case 'SpotLight': {
      const l = new THREE.SpotLight(props.color, props.intensity, props.distance, props.angle, props.penumbra, props.decay)
      l.castShadow = !!props.castShadow
      l.target.position.set(0, -1, 0)
      helper = new THREE.SpotLightHelper(l)
      light = l
      break
    }
    case 'DirectionalLight': {
      const l = new THREE.DirectionalLight(props.color, props.intensity)
      l.castShadow = !!props.castShadow
      l.shadow.mapSize.set(2048, 2048)
      l.shadow.camera.left = -20
      l.shadow.camera.right = 20
      l.shadow.camera.top = 20
      l.shadow.camera.bottom = -20
      helper = new THREE.DirectionalLightHelper(l, 0.5)
      light = l
      break
    }
    case 'RectLight': {
      const l = new THREE.RectAreaLight(props.color, props.intensity, props.width ?? 3, props.height ?? 2)
      l.lookAt(0, -1, 0)
      helper = new THREE.Mesh(
        new THREE.PlaneGeometry(props.width ?? 3, props.height ?? 2),
        new THREE.MeshBasicMaterial({ color: props.color, wireframe: true }),
      )
      helper.rotation.x = -Math.PI / 2
      light = l
      break
    }
    default:
      light = new THREE.AmbientLight(props.color, props.intensity)
  }

  light.userData.actorId = id
  actor.light = light
  actor.root.add(light)
  if (light instanceof THREE.SpotLight) actor.root.add(light.target)
  if (helper) {
    helper.userData.isHelper = true
    actor.lightHelper = helper
    actor.root.add(helper)
  }
  return actor
}

export function createCameraActor(name: string, id = nextActorId()): Actor {
  const actor = new Actor(id, name, 'Camera')
  const props: CameraProps = { fov: 60, near: 0.1, far: 2000 }
  actor.cameraProps = props
  const cam = new THREE.PerspectiveCamera(props.fov, 16 / 9, props.near, props.far)
  cam.userData.actorId = id
  actor.camera = cam
  actor.root.add(cam)
  const helper = new THREE.CameraHelper(cam)
  helper.userData.isHelper = true
  actor.cameraHelper = helper
  return actor
}

export function createEmptyActor(name: string, id = nextActorId()): Actor {
  return new Actor(id, name, 'Empty')
}

/** ParticleEmitter — Niagara/CPUParticles3D analog with editor preview. */
export function createParticleEmitterActor(
  name: string,
  id = nextActorId(),
  particleBackend: ParticleBackend = 'cpu',
): Actor {
  const actor = new Actor(id, name, 'ParticleEmitter')
  actor.particleProps = { ...DEFAULT_PARTICLES }
  const system = createParticleSystem(actor.particleProps, particleBackend)
  system.points.userData.actorId = id
  system.ribbon.userData.actorId = id
  system.mesh.userData.actorId = id
  actor.particleSystem = system
  actor.root.add(system.points)
  actor.root.add(system.ribbon)
  actor.root.add(system.mesh)
  // editor pick proxy + icon
  const proxy = new THREE.Mesh(
    new THREE.SphereGeometry(0.25, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xf5a623, wireframe: true }),
  )
  proxy.userData.actorId = id
  proxy.userData.isEditorOnly = true
  actor.mesh = proxy
  actor.root.add(proxy)
  return actor
}

const FOLIAGE_CAP = 4000
const _fm = new THREE.Matrix4()
const _fq = new THREE.Quaternion()
const _fe = new THREE.Euler()
const _fs = new THREE.Vector3()
const _fp = new THREE.Vector3()

function disposeFoliageMeshes(actor: Actor) {
  if (actor.foliageMesh) {
    actor.foliageMesh.removeFromParent()
    actor.foliageMesh.geometry.dispose()
    ;(actor.foliageMesh.material as THREE.Material).dispose()
    actor.foliageMesh = undefined
  }
  if (actor.foliageMeshes) {
    for (const mesh of Object.values(actor.foliageMeshes)) {
      if (!mesh) continue
      mesh.removeFromParent()
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose()
    }
    actor.foliageMeshes = undefined
  }
}

function setInstanceMatrices(mesh: THREE.InstancedMesh, rows: number[][]) {
  const count = Math.min(rows.length, FOLIAGE_CAP)
  for (let i = 0; i < count; i++) {
    const [x, y, z, sc, rotY] = rows[i]
    _fp.set(x, y, z)
    _fe.set(0, rotY, 0)
    _fq.setFromEuler(_fe)
    _fs.setScalar(sc)
    _fm.compose(_fp, _fq, _fs)
    mesh.setMatrixAt(i, _fm)
  }
  mesh.count = count
  mesh.instanceMatrix.needsUpdate = true
  mesh.computeBoundingSphere()
}

function setInstanceMatricesWithAtlas(
  mesh: THREE.InstancedMesh,
  rows: number[][],
  rects: AtlasUvRect[],
) {
  const count = Math.min(rows.length, FOLIAGE_CAP)
  const uvData = new Float32Array(Math.max(count, 1) * 4)
  for (let i = 0; i < count; i++) {
    const [x, y, z, sc, rotY] = rows[i]
    _fp.set(x, y, z)
    _fe.set(0, rotY, 0)
    _fq.setFromEuler(_fe)
    _fs.setScalar(sc)
    _fm.compose(_fp, _fq, _fs)
    mesh.setMatrixAt(i, _fm)
    const r = rects[i] ?? atlasUvRect(0)
    uvData[i * 4] = r.u
    uvData[i * 4 + 1] = r.v
    uvData[i * 4 + 2] = r.w
    uvData[i * 4 + 3] = r.h
  }
  mesh.count = count
  mesh.instanceMatrix.needsUpdate = true
  let attr = mesh.geometry.getAttribute('instanceUvRect') as THREE.InstancedBufferAttribute | undefined
  if (!attr || attr.count < count) {
    attr = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(count, 1) * 4), 4)
    mesh.geometry.setAttribute('instanceUvRect', attr)
  }
  attr.array.set(uvData.subarray(0, count * 4))
  attr.needsUpdate = true
  mesh.computeBoundingSphere()
}

function rebuildFoliageAutotileAtlas(actor: Actor) {
  const props = actor.foliageProps
  const mesh = actor.foliageMesh
  if (!props || !mesh) return
  const cols = props.gridAtlasCols ?? DEFAULT_ATLAS_COLS
  const rows = props.gridAtlasRows ?? DEFAULT_ATLAS_ROWS
  const vis = ensureGridLayerVisibility(props)
  const fallback = (props.geometry as GridTileKind) ?? 'box'
  const instances: number[][] = []
  const rects: AtlasUvRect[] = []

  for (let layer = 0; layer <= 3; layer++) {
    if (vis[layer] === false) continue
    const bucket = props.gridLayers?.[layer]
    if (!bucket) continue
    for (const raw of bucket) {
      const cell = raw as GridLayerCell
      const [x, y, z, sc, rotY] = cell
      const cx = x
      const cy = Math.round(y - 0.5)
      const cz = z
      const baseKind = gridCellKind(cell, fallback)
      const mask = previewAutotileMask(props, layer, cx, cy, cz)
      const extended = previewAutotileExtendedMask(props, layer, cx, cy, cz)
      const neighborKinds = gridNeighborKinds(bucket, cx, cy, cz, fallback)
      const rule = autotileRuleForMask(mask, baseKind, extended, neighborKinds)
      const idx = atlasIndexForRule(rule)
      const slot = atlasSlotForMask(idx, props.gridAtlasTileMap)
      instances.push([x, y + layer * 0.05, z, sc, rotY + rule.rotY])
      rects.push(atlasUvRect(slot, cols, rows))
    }
  }

  setInstanceMatricesWithAtlas(mesh, instances, rects)
}

function rebuildFoliageAutotileRules(actor: Actor) {
  const props = actor.foliageProps
  const meshes = actor.foliageMeshes
  if (!props || !meshes) return
  const vis = ensureGridLayerVisibility(props)
  const fallback = (props.geometry as GridTileKind) ?? 'box'
  const perKind: Record<GridTileKind, number[][]> = { box: [], sphere: [], plane: [] }

  for (let layer = 0; layer <= 3; layer++) {
    if (vis[layer] === false) continue
    const bucket = props.gridLayers?.[layer]
    if (!bucket) continue
    for (const raw of bucket) {
      const cell = raw as [number, number, number, number, number, number?]
      const [x, y, z, sc, rotY] = cell
      const cx = x
      const cy = Math.round(y - 0.5)
      const cz = z
      const baseKind = gridCellKind(cell, fallback)
      const mask = previewAutotileMask(props, layer, cx, cy, cz)
      const extended = previewAutotileExtendedMask(props, layer, cx, cy, cz)
      const neighborKinds = gridNeighborKinds(bucket, cx, cy, cz, fallback)
      const rule = autotileRuleForMask(mask, baseKind, extended, neighborKinds)
      const layerY = y + layer * 0.05
      perKind[rule.resolvedKind].push([x, layerY, z, sc, rotY + rule.rotY])
    }
  }

  for (const kind of GRID_TILE_KINDS) {
    const mesh = meshes[kind]
    if (!mesh) continue
    setInstanceMatrices(mesh, perKind[kind])
  }
}

/** Sync an InstancedMesh from a foliage layer's packed instance list. */
export function rebuildFoliage(actor: Actor) {
  const props = actor.foliageProps
  if (!props) return
  if (props.snap && props.gridAutotileAtlas && actor.foliageMesh) {
    rebuildFoliageAutotileAtlas(actor)
    return
  }
  if (props.snap && props.gridAutotileRules && actor.foliageMeshes) {
    rebuildFoliageAutotileRules(actor)
    return
  }
  const mesh = actor.foliageMesh
  if (!mesh) return
  if (props.snap && props.gridLayers) syncGridInstancesFromLayers(props)
  setInstanceMatrices(mesh, props.instances)
}

/** FoliageLayer — UE Foliage mode analog: paintable instanced scatter. */
export function createFoliageLayerActor(name: string, id = nextActorId()): Actor {
  const actor = new Actor(id, name, 'FoliageLayer')
  actor.foliageProps = { ...DEFAULT_FOLIAGE, instances: [] }
  buildFoliageMesh(actor)
  return actor
}

/** (re)create the instanced mesh after geometry/color changes */
export function buildFoliageMesh(actor: Actor) {
  const props = actor.foliageProps as FoliageProps
  disposeFoliageMeshes(actor)

  if (props.snap && props.gridAutotileAtlas) {
    const cols = props.gridAtlasCols ?? DEFAULT_ATLAS_COLS
    const rows = props.gridAtlasRows ?? DEFAULT_ATLAS_ROWS
    const geo = buildGeometry('plane')
    geo.rotateX(-Math.PI / 2)
    const sheet = props.gridAtlasSheetId ? getAtlasSheet(props.gridAtlasSheetId) : undefined
    const texture = sheet
      ? createAutotileSheetTexture(sheet.dataUrl)
      : createAutotileAtlasTexture(cols, rows)
    const mat = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.85 })
    patchMaterialForAtlasUv(mat)
    const mesh = new THREE.InstancedMesh(geo, mat, FOLIAGE_CAP)
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.userData.actorId = actor.id
    mesh.userData.isFoliage = true
    mesh.userData.gridAutotileAtlas = true
    mesh.count = 0
    actor.foliageMesh = mesh
    actor.root.add(mesh)
    rebuildFoliage(actor)
    return
  }

  if (props.snap && props.gridAutotileRules) {
    const meshes: Partial<Record<GridTileKind, THREE.InstancedMesh>> = {}
    for (const kind of GRID_TILE_KINDS) {
      const geo = buildGeometry(kind)
      const mat = new THREE.MeshStandardMaterial({ color: props.color, roughness: 0.85 })
      const mesh = new THREE.InstancedMesh(geo, mat, FOLIAGE_CAP)
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.userData.actorId = actor.id
      mesh.userData.isFoliage = true
      mesh.userData.gridTileKind = kind
      mesh.count = 0
      meshes[kind] = mesh
      actor.root.add(mesh)
    }
    actor.foliageMeshes = meshes
    rebuildFoliage(actor)
    return
  }

  const geo = buildGeometry(props.geometry)
  const mat = new THREE.MeshStandardMaterial({ color: props.color, roughness: 0.85 })
  const mesh = new THREE.InstancedMesh(geo, mat, FOLIAGE_CAP)
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.userData.actorId = actor.id
  mesh.userData.isFoliage = true
  mesh.count = 0
  actor.foliageMesh = mesh
  actor.root.add(mesh)
  rebuildFoliage(actor)
}

/** Folder — UE World Outliner organizational node (no renderable components). */
export function createFolderActor(name: string, id = nextActorId()): Actor {
  return new Actor(id, name, 'Folder')
}

/** PostProcessVolume — local post-stack overrides when the camera is inside. */
export function createPostProcessVolumeActor(name: string, id = nextActorId()): Actor {
  const actor = new Actor(id, name, 'PostProcessVolume')
  actor.postProcessProps = { ...DEFAULT_POST_PROCESS }
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({
      color: 0x9b59b6,
      wireframe: true,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    }),
  )
  box.userData.isHelper = true
  box.userData.isEditorOnly = true
  actor.volumeHelper = box
  actor.root.add(box)
  return actor
}

/** ReflectionProbe — bakes a local cubemap and feeds nearby PBR materials. */
export function createReflectionProbeActor(name: string, id = nextActorId()): Actor {
  const actor = new Actor(id, name, 'ReflectionProbe')
  actor.probeProps = { radius: 8 }
  const gizmo = new THREE.Mesh(
    new THREE.SphereGeometry(0.35, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0x56b3c9, wireframe: true }),
  )
  gizmo.userData.actorId = id
  gizmo.userData.isEditorOnly = true
  actor.mesh = gizmo
  actor.root.add(gizmo)
  return actor
}

/** CustomMesh — arbitrary geometry (CSG results) with PBR material. */
export function createCustomMeshActor(
  name: string,
  geom: { positions: number[]; normals: number[]; index?: number[] },
  id = nextActorId(),
): Actor {
  const actor = new Actor(id, name, 'CustomMesh')
  actor.customGeometry = geom
  actor.materialProps = { ...DEFAULT_MATERIAL }
  actor.physicsProps = { ...DEFAULT_PHYSICS }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(geom.positions, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(geom.normals, 3))
  if (geom.index) g.setIndex(geom.index)
  g.computeBoundingSphere()
  const mesh = new THREE.Mesh(g, buildMaterial(actor.materialProps))
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.userData.actorId = id
  actor.mesh = mesh
  actor.root.add(mesh)
  return actor
}

/** TriggerVolume — unit box volume emitting enter:/exit: signals for the pawn. */
export function createTriggerVolumeActor(name: string, id = nextActorId()): Actor {
  const actor = new Actor(id, name, 'TriggerVolume')
  actor.triggerProps = { reverbPreset: '' }
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0x46a758, wireframe: true, transparent: true, opacity: 0.5, depthWrite: false }),
  )
  box.userData.actorId = id
  box.userData.isEditorOnly = true
  actor.mesh = box
  actor.root.add(box)
  return actor
}

/** SoundEmitter — plays a MetaSound at this actor's world position during Play. */
export function createSoundEmitterActor(name: string, id = nextActorId()): Actor {
  const actor = new Actor(id, name, 'SoundEmitter')
  actor.soundEmitterProps = { ...DEFAULT_SOUND_EMITTER }
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(0.25, 0.5, 8),
    new THREE.MeshBasicMaterial({ color: 0xc77dff, wireframe: true }),
  )
  cone.rotation.x = Math.PI
  cone.position.y = 0.25
  cone.userData.actorId = id
  cone.userData.isEditorOnly = true
  actor.mesh = cone
  actor.root.add(cone)
  return actor
}

/** PlayerStart — where the pawn spawns when Play begins (UE PlayerStart). */
export function createPlayerStartActor(name: string, id = nextActorId()): Actor {
  const actor = new Actor(id, name, 'PlayerStart')
  const capsule = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.35, 1.1, 4, 12),
    new THREE.MeshBasicMaterial({ color: 0x2f80ed, wireframe: true }),
  )
  capsule.position.y = 0.9
  capsule.userData.actorId = id
  capsule.userData.isEditorOnly = true
  const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0.9, 0), 1, 0xf5a623, 0.3, 0.2)
  arrow.userData.isHelper = true
  actor.mesh = capsule // makes it pickable in the viewport
  actor.root.add(capsule, arrow)
  return actor
}

/** Build a canvas texture for a Label3D billboard plane. */
export function buildLabel3DTexture(props: Label3DProps): { texture: THREE.CanvasTexture; aspect: number } {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  const font = `600 ${props.fontSize}px system-ui, sans-serif`
  ctx.font = font
  const metrics = ctx.measureText(props.text || ' ')
  const textW = Math.ceil(metrics.width)
  const textH = props.fontSize
  const pad = props.padding
  canvas.width = Math.max(64, textW + pad * 2)
  canvas.height = Math.max(32, textH + pad * 2)
  ctx.font = font
  if (props.background) {
    ctx.fillStyle = props.background
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }
  ctx.fillStyle = props.color
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'
  ctx.fillText(props.text, canvas.width / 2, canvas.height / 2)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return { texture, aspect: canvas.width / canvas.height }
}

/** (re)build the Label3D plane mesh after text/style changes. */
export function rebuildLabel3D(actor: Actor) {
  const props = actor.label3DProps
  if (!props) return
  if (actor.mesh) {
    actor.mesh.geometry.dispose()
    const mat = actor.mesh.material
    if (mat instanceof THREE.Material) mat.dispose()
    actor.mesh.removeFromParent()
  }
  const { texture, aspect } = buildLabel3DTexture(props)
  const h = 1
  const w = h * aspect
  const geo = new THREE.PlaneGeometry(w, h)
  const mat = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.userData.actorId = actor.id
  mesh.userData.isLabel3D = true
  actor.mesh = mesh
  actor.root.add(mesh)
}

/** Label3D — billboard text plane using a canvas texture. */
export function createLabel3DActor(name: string, id = nextActorId()): Actor {
  const actor = new Actor(id, name, 'Label3D')
  actor.label3DProps = { ...DEFAULT_LABEL3D }
  rebuildLabel3D(actor)
  return actor
}

const _billboardCam = new THREE.Vector3()
const _billboardObj = new THREE.Vector3()
const _billboardParentQ = new THREE.Quaternion()
const _billboardInvParentQ = new THREE.Quaternion()
const _billboardLookM = new THREE.Matrix4()
const _billboardLookQ = new THREE.Quaternion()

/** Face Label3D planes toward the active camera (editor + play). */
export function updateLabel3DBillboards(camera: THREE.Camera, actors: Iterable<Actor>) {
  camera.getWorldPosition(_billboardCam)
  for (const actor of actors) {
    if (actor.type !== 'Label3D' || !actor.label3DProps?.billboard || !actor.mesh) continue
    actor.mesh.getWorldPosition(_billboardObj)
    if (actor.mesh.parent) {
      actor.mesh.parent.getWorldQuaternion(_billboardParentQ)
      _billboardInvParentQ.copy(_billboardParentQ).invert()
    } else {
      _billboardInvParentQ.identity()
    }
    _billboardLookM.lookAt(_billboardObj, _billboardCam, new THREE.Vector3(0, 1, 0))
    _billboardLookQ.setFromRotationMatrix(_billboardLookM)
    actor.mesh.quaternion.copy(_billboardInvParentQ).multiply(_billboardLookQ)
  }
}

/** Timer — Godot Timer node emitting timeout: signals. */
export function createTimerActor(name: string, id = nextActorId()): Actor {
  const actor = new Actor(id, name, 'Timer')
  actor.timerProps = { ...DEFAULT_TIMER }
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.2, 0.04, 8, 16),
    new THREE.MeshBasicMaterial({ color: 0x6eb5ff, wireframe: true }),
  )
  ring.rotation.x = Math.PI / 2
  ring.userData.actorId = id
  ring.userData.isEditorOnly = true
  actor.mesh = ring
  actor.root.add(ring)
  return actor
}

/** RayCast3D — dashed arrow gizmo along local cast direction. */
export function createRayCastActor(name: string, id = nextActorId()): Actor {
  const actor = new Actor(id, name, 'RayCast3D')
  actor.rayCastProps = { ...DEFAULT_RAY_CAST }
  rebuildRayCastVisual(actor)
  return actor
}

export function rebuildRayCastVisual(actor: Actor) {
  const props = actor.rayCastProps ?? DEFAULT_RAY_CAST
  actor.root.children
    .filter((c) => c.userData.isRayCastHelper)
    .forEach((c) => actor.root.remove(c))
  const dir = new THREE.Vector3(...props.localDirection).normalize()
  const arrow = new THREE.ArrowHelper(dir, new THREE.Vector3(0, 0, 0), props.length, 0xff6b6b, 0.15, 0.1)
  arrow.userData.isRayCastHelper = true
  arrow.userData.isHelper = true
  arrow.userData.actorId = actor.id
  actor.root.add(arrow)
}

/** Path3D — editable Catmull-Rom spline with waypoint handles. */
export function createPath3DActor(name: string, id = nextActorId()): Actor {
  const actor = new Actor(id, name, 'Path3D')
  actor.path3DProps = {
    waypoints: DEFAULT_PATH3D.waypoints.map((w) => [...w] as [number, number, number]),
    closed: DEFAULT_PATH3D.closed,
  }
  rebuildPath3DVisual(actor)
  return actor
}

/** PathFollow3D — follower marker that slides along a Path3D. */
export function createPathFollowActor(name: string, id = nextActorId()): Actor {
  const actor = new Actor(id, name, 'PathFollow3D')
  actor.pathFollowProps = { ...DEFAULT_PATH_FOLLOW }
  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(0.15, 10, 10),
    new THREE.MeshBasicMaterial({ color: 0x9b6bff, wireframe: true }),
  )
  marker.userData.actorId = id
  marker.userData.isEditorOnly = true
  actor.mesh = marker
  actor.root.add(marker)
  return actor
}

/** Area3D — sensor box emitting body_entered:/body_exited: for overlapping actors. */
export function createArea3DActor(name: string, id = nextActorId()): Actor {
  const actor = new Actor(id, name, 'Area3D')
  actor.area3DProps = { ...DEFAULT_AREA3D }
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0x3dd68c, wireframe: true, transparent: true, opacity: 0.45, depthWrite: false }),
  )
  box.userData.actorId = id
  box.userData.isEditorOnly = true
  actor.mesh = box
  actor.root.add(box)
  return actor
}

/** Wrap a loaded glTF scene in an actor. */
export function createImportedMeshActor(
  name: string,
  assetId: string,
  gltfScene: THREE.Object3D,
  id = nextActorId(),
): Actor {
  const actor = new Actor(id, name, 'ImportedMesh')
  actor.assetId = assetId
  actor.physicsProps = { ...DEFAULT_PHYSICS }
  gltfScene.traverse((o) => {
    o.userData.actorId = id
    if (o instanceof THREE.Mesh) {
      o.castShadow = true
      o.receiveShadow = true
      // expose ONE mesh for bounding-box physics; picking traverses anyway
      if (!actor.mesh) actor.mesh = o
    }
  })
  actor.root.add(gltfScene)
  return actor
}
